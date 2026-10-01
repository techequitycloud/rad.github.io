---
title: "Keycloak sur GKE Autopilot"
description: "Référence de configuration pour déployer Keycloak sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Keycloak_GKE.md @ 3055034 sha256:dd4cc68eb7a2 -->

# Keycloak sur GKE Autopilot {#keycloak-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Keycloak_GKE.png" alt="Keycloak sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Keycloak est une plateforme open source de gestion des identités et des accès qui fournit
l'authentification unique (SSO), OAuth 2.0/OIDC, SAML 2.0, la connexion via les réseaux sociaux, la fédération d'utilisateurs
(LDAP/Active Directory) et une autorisation fine — une alternative auto-hébergée
à Auth0/Okta sans frais par utilisateur. Ce module déploie Keycloak
sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Keycloak et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Keycloak s'exécute comme une charge de travail web JVM unique (basée sur Quarkus), construite en
mode optimisé pour la production. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod JVM sur le port 8080, 2 vCPU / 4Gi de mémoire par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le moteur est fixé à `POSTGRES_15` ; MySQL n'est pas pris en charge |
| Connectivité à la base de données | Sidecar Cloud SQL Auth Proxy | Écoute sur `127.0.0.1:5432` ; `KC_DB_URL` est une simple connexion JDBC TCP — aucun problème de socket Unix sur GKE |
| Secrets | Secret Manager | `KC_BOOTSTRAP_ADMIN_PASSWORD` (administrateur temporaire) et mot de passe de la base de données générés automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec IP statique réservée ; domaine personnalisé et certificat géré en option |
| Build de l'image | Cloud Build + Artifact Registry | Une image multi-étapes personnalisée exécute `kc.sh build` au moment du build et `kc.sh start --optimized` au démarrage |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut `POSTGRES_15` par défaut
  et est fixé par la couche applicative partagée ; MySQL/SQL Server ne sont pas
  pris en charge pour Keycloak.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur l'interface de bouclage.** GKE définit
  `enable_cloudsql_volume = true` par défaut (contrairement à la variante CloudRun,
  qui le définit à `false` car l'intégration Cloud SQL de Cloud Run est un
  montage de socket Unix que le pilote JDBC ne peut pas utiliser). Sur GKE, le sidecar expose un
  véritable écouteur TCP sur `127.0.0.1:5432`, si bien que `KC_DB_URL` est un simple
  `jdbc:postgresql://127.0.0.1:5432/<db>` — aucun contournement de socket n'est nécessaire.
- **`KC_DB_USERNAME` n'est jamais codé en dur.** Le socle préfixe par le tenant le
  vrai rôle Postgres (par ex. `keycloakdemo<hash>`) ; `entrypoint.sh` mappe les
  variables `DB_USER`/`DB_PASSWORD` injectées par la plateforme sur `KC_DB_USERNAME`/
  `KC_DB_PASSWORD` à l'exécution, uniquement si elles ne sont pas déjà définies — ce
  module n'est pas concerné par le piège de l'utilisateur de base de données codé en dur signalé pour d'autres
  applications de ce dépôt.
- **Les nombres minimal/maximal de réplicas sont fixés par ce module, et non par les
  entrées `min_instance_count`/`max_instance_count`.** Le
  `main.tf` de `Keycloak_GKE` code en dur la configuration de mise à l'échelle par application à `min_instance_count = 1`,
  `max_instance_count = 5` lorsqu'il construit le mappage de configuration de l'application que
  `App_GKE` lit réellement pour la mise à l'échelle — les variables de premier niveau
  `min_instance_count`/`max_instance_count` sont également transmises au
  socle, mais sont masquées par les valeurs propres à l'application. Voir
  [§6](#6-configuration-pitfalls--sensible-defaults).
- **NFS et Redis ne sont pas utilisés.** `enable_nfs` et `enable_redis` valent tous deux
  `false` par défaut — Keycloak conserve tout son état (realms, clients, utilisateurs, sessions) dans
  PostgreSQL, et `Keycloak_Common` ne provisionne aucun bucket Cloud Storage
  (`storage_buckets = []`).
- **`KC_BOOTSTRAP_ADMIN_PASSWORD` est généré automatiquement** et stocké dans
  Secret Manager, associé à `KC_BOOTSTRAP_ADMIN_USERNAME` (par défaut
  `admin`). Il s'agit explicitement d'un identifiant d'amorçage **temporaire** — connectez-vous,
  créez un administrateur permanent, puis changez le mot de passe du compte d'amorçage ou
  désactivez-le.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client atteignent le même
  pod.
- **La santé et les métriques sont exposées sur un port de gestion distinct (9000), et non sur le port
  HTTP (8080).** Toutes les sondes sont des contrôles TCP sur le port 8080 (l'écouteur
  HTTP qui accepte les connexions) plutôt que des contrôles HTTP sur `/health`,
  qui se trouve sur 9000 et ferait toujours échouer une sonde dirigée vers 8080.
- **`KC_HOSTNAME` est détecté automatiquement à l'exécution.** `entrypoint.sh` interroge d'abord le
  serveur de métadonnées GCP / l'API Cloud Run Admin, puis se replie sur la
  `SERVICE_URL` injectée par `App_GKE` ; remplacez-le via
  `environment_variables` pour fixer une URL publique.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Keycloak {#a-gke-autopilot--the-keycloak-workload}

Les pods Keycloak sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les
pods demandent réellement. Keycloak est sans état (`workload_type` vaut par défaut
`Deployment`, et non `StatefulSet`) puisque tout l'état durable réside dans PostgreSQL.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Keycloak
  pour les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress
  affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Keycloak stocke toutes les données applicatives (realms, clients, utilisateurs, groupes,
sessions) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods l'atteignent
via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` ; aucune IP
publique n'est exposée. Lors du premier déploiement, le Job `db-init` crée de manière idempotente le
rôle et la base de données de l'application, attribue la propriété et accorde les privilèges sur
`SCHEMA public` (requis sur PostgreSQL 15+, où `public` n'est plus
accessible en écriture à tous) — Keycloak crée et migre ensuite lui-même son schéma au
premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les
  métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Le seul secret de niveau applicatif de Keycloak est le **mot de passe de l'administrateur d'amorçage**
(`KC_BOOTSTRAP_ADMIN_PASSWORD`, une valeur aléatoire de 20 caractères associée au
nom d'utilisateur `admin` via `KC_BOOTSTRAP_ADMIN_USERNAME`). Le mot de passe de la base de données est
généré séparément par le socle et injecté directement sous la forme
`KC_DB_PASSWORD` (via `db_password_env_var_name = "KC_DB_PASSWORD"` dans l'appel
`App_GKE`), en plus du `DB_PASSWORD` standard. Sur GKE, les secrets
sont projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~keycloak"
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~keycloak-admin-password' --format='value(name)' --limit=1)" \
    --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut être
activé via `enable_custom_domain` + `application_domains`.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP
statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE et Cloud SQL vers
Cloud Monitoring. Des tests de disponibilité et des règles d'alerte optionnels sont disponibles —
Keycloak sert une page d'accueil publique sur `/`, qui est la cible de
`uptime_check_config`.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Keycloak {#3-keycloak-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job `db-init` exécute `db-init.sh` avec
  `postgres:15-alpine`. Il attend `pg_isready`, puis crée de manière idempotente
  le rôle applicatif (ou met à jour son mot de passe), accorde ce rôle à
  `postgres` afin que le superutilisateur puisse gérer ses objets, crée la
  base de données et en devient propriétaire, et accorde les privilèges sur la base de données et sur `SCHEMA public`. Elle
  se termine en envoyant un `POST /quitquitquit` au sidecar Cloud SQL Proxy
  sur `127.0.0.1:9091` afin que le pod du Job puisse s'arrêter et être marqué Succeeded sur
  GKE. La tâche peut être relancée sans risque (`execute_on_apply = true`, `max_retries =
  3`).
- **Pas de tâche de migration distincte — Keycloak migre son propre schéma au premier
  démarrage.** L'image personnalisée exécute `kc.sh build` au moment du build (en y intégrant
  `KC_DB=postgres`, la santé et les métriques) et `kc.sh start --optimized` au
  démarrage du conteneur ; le processus d'amorçage propre à Keycloak crée/migre le
  schéma sur la base de données vide créée par `db-init`.
  {/* TODO: verify exact first-boot schema-creation duration under load; the
  startup probe budget below allows up to ~330s. */}
- **Compte administrateur d'amorçage.** `entrypoint.sh` lance `kc.sh start --optimized` par exec
  avec `KC_BOOTSTRAP_ADMIN_USERNAME=admin` et le secret
  `KC_BOOTSTRAP_ADMIN_PASSWORD` généré. Connectez-vous sur `<service-url>/admin`,
  créez un administrateur permanent, puis changez le mot de passe du compte d'amorçage ou désactivez-le
  — il est destiné à être temporaire.
- **Le mappage des variables d'environnement de la base de données se fait à l'exécution, jamais au build.** La plateforme
  injecte `DB_HOST=127.0.0.1` (le sidecar Auth Proxy), `DB_USER`,
  `DB_PASSWORD`, `DB_NAME`, `DB_PORT` ; `entrypoint.sh` les mappe sur
  `KC_DB_URL`/`KC_DB_USERNAME`/`KC_DB_PASSWORD` uniquement lorsque la variable `KC_DB_*`
  n'est pas déjà définie explicitement, afin que les opérateurs puissent toujours remplacer
  n'importe laquelle d'entre elles via `environment_variables`.
- **Chemin de santé — TCP uniquement, port 8080.** Keycloak 25+ sert `/health`,
  `/health/ready`, `/health/live` et `/metrics` sur le **port de
  gestion distinct 9000**, et non sur le port HTTP 8080 que sonde la plateforme. Une
  sonde HTTP sur `8080/health` renverrait toujours 404. La sonde de démarrage
  (délai initial de 30s, 30 échecs ≈ jusqu'à ~330s au total pour le démarrage de la JVM et la migration
  du schéma) et la sonde de vivacité (délai initial de 60s, 3 échecs) sont toutes deux des
  contrôles **TCP** sur le port 8080.
- **Mise en garde sur la mise à l'échelle horizontale / le clustering.** Le commentaire de câblage de `Keycloak_GKE`
  indique que Keycloak « persists all state in PostgreSQL, so horizontal scaling is
  safe (cluster nodes form a shared cache via the default infinispan) ».
  {/* TODO: verify — `KC_CACHE` is not explicitly set to `ha`/kubernetes-ping
  anywhere in Keycloak_Common's environment or the custom build args, and
  Keycloak's default Infinispan cache stack outside an explicit HA/Kubernetes
  configuration is local (per-pod), which would NOT replicate session/login
  state across replicas. Confirm the actual cache stack in the deployed
  image before relying on `max_instance_count > 1` for session continuity in
  production. */}
- **Vérifier la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^KC_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Keycloak ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `keycloak` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `26.0` | Tag de l'image Keycloak intégré au `kc.sh build` personnalisé. Ne jamais rétrograder — les migrations de schéma sont à sens unique. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Le dimensionnement CPU/mémoire **qui fait foi** — il est fusionné dans la configuration de l'application *après* les `cpu_limit`/`memory_limit` propres à `Keycloak_Common`, si bien qu'il l'emporte toujours. La JVM de Keycloak a besoin d'au moins 2Gi. |
| `cpu_limit` / `memory_limit` | `2000m` / `4Gi` | Anciennes entrées de dimensionnement de premier niveau, transmises à `Keycloak_Common` — **masquées par `container_resources`** (voir [§6](#6-configuration-pitfalls--sensible-defaults)) puisque `container_resources` a toujours une valeur par défaut non nulle. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Transmises directement au socle, mais **les bornes effectives de réplicas sont codées en dur à 1/5 dans le `main.tf` de ce module**, indépendamment de ces valeurs — voir [§6](#6-configuration-pitfalls--sensible-defaults). |
| `container_port` | `8080` | Écouteur HTTP de Keycloak. La santé et les métriques sont sur le port de gestion distinct 9000 — la plateforme sonde ce port en TCP, et non en HTTP. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (TCP en bouclage) — requis sur GKE pour la connectivité JDBC. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin dans le conteneur où est monté le répertoire du socket Unix de l'Auth Proxy (utilisé par les appels `pg_isready`/`psql` de la tâche `db-init` ; le conteneur Keycloak en cours d'exécution se connecte quant à lui via `127.0.0.1:5432`, et non via ce chemin). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface d'administration/de connexion de Keycloak. |
| `workload_type` | `null` → `Deployment` | Keycloak est sans état ; ne passez pas à `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |
| `termination_grace_period_seconds` | `60` | Délai accordé aux requêtes en cours pour se terminer avant l'arrêt forcé d'un pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | TCP, port 8080 | Entrées de sonde de premier niveau du socle — **ce sont les valeurs `startup_probe`/`liveness_probe` propres à l'application ci-dessous que `App_GKE` lit réellement pour les sondes de cette charge de travail.** |
| `startup_probe` | TCP, délai de 30s, 30 échecs | Transmise à `Keycloak_Common` ; budget d'échecs généreux pour le démarrage de la JVM et la création du schéma au premier démarrage. |
| `liveness_probe` | TCP, délai de 60s, 3 échecs | Transmise à `Keycloak_Common`. TCP uniquement — `/health` sur le port 9000 n'est pas accessible à la sonde. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Keycloak sert une page d'accueil publique sur `/`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Généralement inutile — Keycloak conserve tout son état dans PostgreSQL. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Moteur fixe ; MySQL/SQL Server ne sont pas pris en charge. |
| `db_name` / `db_user` | `keycloak` / `keycloak` | **Le nom et l'utilisateur de base de données qui font foi** — ils transitent par `config.db_name`/`config.db_user` de `Keycloak_Common`, qui est ce que `App_GKE` provisionne réellement. |
| `application_database_name` / `application_database_user` | `keycloak` / `keycloak` | Transmises directement à l'appel du socle, mais **masquées par `db_name`/`db_user`** dans la résolution de la configuration par application d'`App_GKE` — les deux ont la même valeur par défaut, si bien que cela reste invisible tant qu'une seule paire n'est pas modifiée. Voir [§6](#6-configuration-pitfalls--sensible-defaults). |
| `enable_postgres_extensions` | `false` | Non requis pour Keycloak. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés et certificat géré. |

### Groupe 21 — Cloud Armor, CDN et Redis {#group-21--cloud-armor-cdn--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Keycloak ne nécessite pas Redis ; laissez `false` sauf si un SPI/plugin personnalisé en a besoin. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Keycloak. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Keycloak ne stocke aucun état en dehors de PostgreSQL). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration (`db-init`) et d'import (optionnelle). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs
> *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé en même temps qu'un
> paramètre sans état, IAP sans identités autorisées, des `quota_memory_*`
> fournis sous forme d'entiers nus, un `container_port`/
> `backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant la création de toute ressource, si bien que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixe) | Critical | Choisir un moteur autre que Postgres casse l'amorçage du schéma de Keycloak et toutes les requêtes. |
| `db_name` / `db_user` (la paire qui fait foi) | À définir une fois, avant le premier déploiement | Critical | Pratiquement immuables — `App_GKE` résout à partir d'eux la base de données/l'utilisateur Cloud SQL réels, et les modifier après le premier déploiement fait pointer Keycloak vers une base de données/un rôle différent (vide), rendant orphelins tous les realms et utilisateurs. |
| `application_database_name` / `application_database_user` | À laisser identiques à `db_name`/`db_user` | Medium | Elles sont transmises au socle mais masquées par `db_name`/`db_user` dans la résolution de la configuration par application d'`App_GKE` — ne modifier que cette paire n'a silencieusement aucun effet sur le nom réel de la base de données, ce qui peut faire croire à tort à un opérateur qu'un renommage a eu lieu. |
| `min_instance_count` / `max_instance_count` | Sachez qu'elles sont informatives ici | Medium | Ce module code en dur les bornes effectives de réplicas à `1`/`5` dans `main.tf`, quelles que soient les valeurs de ces variables — définir `max_instance_count = 1` pour maîtriser les coûts ne limitera **pas** réellement les réplicas à 1. |
| `cpu_limit` / `memory_limit` | Définissez plutôt `container_resources` | Medium | `container_resources` a toujours une valeur par défaut non nulle et est fusionné en dernier, si bien que modifier uniquement les anciennes variables `cpu_limit`/`memory_limit` est ignoré silencieusement. |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` (généré automatiquement) | Récupérer, se connecter, puis changer le mot de passe ou désactiver le compte | High | L'administrateur d'amorçage est destiné à être temporaire ; le laisser actif indéfiniment constitue un risque permanent lié aux identifiants. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité à la base de données sur GKE ; le désactiver sans autre chemin TCP casse tous les appels à la base de données. |
| Chemins des sondes | TCP sur le port 8080 (par défaut) | High | Le `/health` de Keycloak se trouve sur le port de gestion 9000, et non 8080 — une sonde HTTP sur `8080/health` renvoie toujours 404 et le pod ne devient jamais Ready alors que Keycloak a bien démarré. |
| `max_instance_count > 1` (clustering des sessions) | Vérifiez la réplication Infinispan/des sessions avant de vous y fier | High | Si la pile de cache de l'image déployée n'est pas réellement distribuée entre les pods (non confirmé — voir [§3](#3-keycloak-application-behaviour)), les utilisateurs peuvent être renvoyés vers un pod qui ignore leur session, ce qui impose une nouvelle authentification. |
| `session_affinity` | `ClientIP` | Medium | Sans persistance, les requêtes passent d'un pod à l'autre plus que nécessaire tant que la mise en garde ci-dessus sur le clustering n'est pas levée. |
| `application_version` | Ne jamais rétrograder | Critical | Les migrations de schéma de Keycloak sont à sens unique ; rétrograder après l'exécution d'une migration peut corrompre le schéma. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et `KC_HOSTNAME`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de rétention liées à la conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Keycloak partagée
avec la variante Cloud Run (build de l'image personnalisée, mappage de la base de données et du nom d'hôte par le point d'entrée,
secrets et valeurs par défaut des sondes) est décrite dans
**[Keycloak_Common](Keycloak_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Keycloak sur GKE Autopilot](../labs/Keycloak_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Keycloak sur Google Cloud Run](Keycloak_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Keycloak Common — Configuration applicative partagée](Keycloak_Common.md) — la configuration partagée par les deux cibles de déploiement.
