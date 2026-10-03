---
title: "Keycloak sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Keycloak sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Keycloak_GKE.md @ 15fd4c7 sha256:e0b6db04767a -->

# Keycloak sur GKE Autopilot {#keycloak-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Keycloak_GKE.png" alt="Keycloak sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Keycloak est une plateforme open source de gestion des identités et des accès
offrant l'authentification unique (SSO), OAuth 2.0/OIDC, SAML 2.0, la
connexion sociale, la fédération d'utilisateurs (LDAP/Active Directory) et
une autorisation granulaire — une alternative auto-hébergée à Auth0/Okta sans
frais par utilisateur. Ce module déploie Keycloak sur **GKE Autopilot** au-dessus
de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Keycloak et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Keycloak s'exécute comme une charge de travail web JVM (basée sur Quarkus)
construite en mode optimisé pour la production. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod JVM sur le port 8080, 2 vCPU / 4 Gi de mémoire par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le moteur est fixé à `POSTGRES_15` ; MySQL n'est pas pris en charge |
| Connectivité de la base de données | Sidecar Cloud SQL Auth Proxy | Écoute sur `127.0.0.1:5432` ; `KC_DB_URL` est une connexion JDBC TCP simple — pas de problème de socket Unix sur GKE |
| Secrets | Secret Manager | `KC_BOOTSTRAP_ADMIN_PASSWORD` (administrateur temporaire) et mot de passe de la base de données auto-générés |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |
| Build d'image | Cloud Build + Artifact Registry | Une image multi-étapes personnalisée exécute `kc.sh build` au moment du build, `kc.sh start --optimized` au démarrage |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` utilise par défaut
  `POSTGRES_15` et est fixé par la couche d'application partagée ;
  MySQL/SQL Server ne sont pas pris en charge pour Keycloak.
- **Cloud SQL est accessible via le sidecar Auth Proxy sur la boucle locale.**
  GKE définit `enable_cloudsql_volume = true` par défaut (contrairement à la variante Cloud Run,
  qui le définit par défaut à `false` car l'intégration Cloud SQL de
  Cloud Run est un montage de socket Unix que le pilote JDBC ne peut pas
  utiliser). Sur GKE, le sidecar expose un véritable écouteur TCP sur
  `127.0.0.1:5432`, donc `KC_DB_URL` est une simple
  `jdbc:postgresql://127.0.0.1:5432/<db>` — aucune solution de contournement de socket n'est nécessaire.
- **`KC_DB_USERNAME` n'est jamais codé en dur.** La fondation préfixe le
  rôle Postgres réel (par exemple `keycloakdemo<hash>`) ; `entrypoint.sh` mappe
  les `DB_USER`/`DB_PASSWORD` injectés par la plateforme sur
  `KC_DB_USERNAME`/`KC_DB_PASSWORD` au moment de l'exécution
  uniquement s'ils ne sont pas déjà définis — ce module n'est pas confronté
  au piège de l'utilisateur de base de données codé en dur mentionné pour
  d'autres applications dans ce dépôt.
- **Les nombres de réplicas min/max sont fixés par ce module, et non par les
  entrées `min_instance_count`/`max_instance_count`.** `Keycloak_GKE`'s
  `main.tf` code en dur la configuration de mise à l'échelle par
  application à `min_instance_count = 1`, `max_instance_count = 5` lorsqu'il construit la
  carte de configuration d'application que `App_GKE` lit
  effectivement pour la mise à l'échelle — les variables de niveau supérieur
  `min_instance_count`/`max_instance_count` sont également transmises à la
  fondation, mais sont masquées par les valeurs spécifiques à l'application.
  Voir [§6](#6-configuration-pitfalls--sensible-defaults).
- **NFS et Redis ne sont pas utilisés.** `enable_nfs` et `enable_redis`
  utilisent tous deux par défaut `false` — Keycloak conserve tout
  l'état (royaumes, clients, utilisateurs, sessions) dans PostgreSQL, et
  `Keycloak_Common` ne provisionne aucun bucket Cloud Storage
  (`storage_buckets = []`).
- **`KC_BOOTSTRAP_ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret
  Manager, associé à `KC_BOOTSTRAP_ADMIN_USERNAME` (par défaut
  `admin`). Il s'agit explicitement d'un identifiant de démarrage
  **temporaire** — connectez-vous, créez un administrateur permanent, puis
  faites pivoter ou désactivez le compte de démarrage.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un
  client atteignent le même pod.
- **La santé/les métriques sont sur un port de gestion séparé (9000), et non
  le port HTTP (8080).** Toutes les sondes sont des vérifications TCP sur le
  port 8080 (l'écouteur HTTP acceptant les connexions) plutôt que des
  vérifications HTTP sur `/health`, qui se trouve sur le port 9000 et
  échouerait toujours à une sonde visant le port 8080.
- **`KC_HOSTNAME` est défini au moment de l'exécution.** `entrypoint.sh`
  exporte le `GKE_SERVICE_URL` injecté par `App_GKE` (l'URL de
  l'équilibreur de charge, la même valeur que `service_url`), de sorte que
  l'émetteur OIDC ne flotte pas avec l'adresse utilisée par un client ;
  remplacez-le via `environment_variables` pour un domaine personnalisé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Keycloak {#a-gke-autopilot--the-keycloak-workload}

Les pods Keycloak sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Keycloak est sans état (`workload_type`
utilise par défaut `Deployment`, pas `StatefulSet`) puisque tout
l'état durable réside dans PostgreSQL.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Keycloak pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Keycloak stocke toutes les données d'application (royaumes, clients,
utilisateurs, groupes, sessions) dans une instance Cloud SQL pour PostgreSQL
15 gérée. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier
déploiement, le Job `db-init` crée de manière idempotente le rôle et la
base de données de l'application, accorde la propriété et accorde les
privilèges sur `SCHEMA public` (requis sur PostgreSQL 15+, où
`public` n'est plus accessible en écriture par tous) — Keycloak
lui-même crée et migre ensuite son schéma lors du premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Le seul secret au niveau de l'application de Keycloak est le **mot de passe
administrateur de démarrage** (`KC_BOOTSTRAP_ADMIN_PASSWORD`, une valeur aléatoire de 20
caractères associée à l'utilisateur `admin` via
`KC_BOOTSTRAP_ADMIN_USERNAME`). Le mot de passe de la base de données est généré
séparément par la fondation et est injecté directement comme
`KC_DB_PASSWORD` (via `db_password_env_var_name = "KC_DB_PASSWORD"` lors de l'appel
`App_GKE`), en plus du `DB_PASSWORD` standard. Sur GKE, les
secrets sont projetés dans les pods via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~keycloak"
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~keycloak-admin-password' --format='value(name)' --limit=1)" \
    --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré
par Google peut être activé via `enable_custom_domain` + `application_domains`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et
Cloud SQL vers Cloud Monitoring. Des vérifications de disponibilité et des
politiques d'alerte optionnelles sont disponibles — Keycloak sert une page
d'accueil publique à `/`, ce que `uptime_check_config` cible.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Keycloak {#3-keycloak-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Le Job
  `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il attend `pg_isready`, puis crée de manière
  idempotente le rôle de l'application (ou met à jour son mot de passe),
  accorde ce rôle à `postgres` afin que le superutilisateur puisse
  gérer ses objets, crée/possède la base de données et accorde les privilèges
  sur la base de données et sur `SCHEMA public`. Il se termine en envoyant
  un `POST /quitquitquit` au sidecar Cloud SQL Proxy sur
  `127.0.0.1:9091` afin que le pod du Job puisse se terminer et être marqué
  comme Réussi sur GKE. Le job peut être réexécuté en toute sécurité
  (`execute_on_apply = true`, `max_retries =
  3`).
- **Pas de job de migration séparé — Keycloak migre son propre schéma lors du
  premier démarrage.** L'image personnalisée exécute `kc.sh build` au
  moment du build (intégrant `KC_DB=postgres`, la santé et les métriques) et
  `kc.sh start --optimized` au démarrage du conteneur ; le processus de démarrage de
  Keycloak lui-même crée/migre le schéma par rapport à la base de données
  vide créée par `db-init`.
  {/* TODO: vérifier la durée exacte de création du schéma au premier démarrage
  sous charge ; le budget de la sonde de démarrage ci-dessous permet jusqu'à
  environ 330s. */}
- **Compte administrateur de démarrage.** `entrypoint.sh` exécute
  `kc.sh start --optimized` avec `KC_BOOTSTRAP_ADMIN_USERNAME=admin` et le secret
  `KC_BOOTSTRAP_ADMIN_PASSWORD` généré. Connectez-vous à `<service-url>/admin`,
  créez un administrateur permanent, puis faites pivoter ou désactivez le
  compte de démarrage — il est destiné à être temporaire.
- **Le mappage des variables d'environnement de la base de données se fait au
  moment de l'exécution, jamais intégré.** La plateforme injecte
  `DB_HOST=127.0.0.1` (le sidecar Auth Proxy), `DB_USER`,
  `DB_PASSWORD`, `DB_NAME`, `DB_PORT` ;
  `entrypoint.sh` les mappe sur `KC_DB_URL`/
  `KC_DB_USERNAME`/`KC_DB_PASSWORD` uniquement lorsque la variable
  `KC_DB_*` n'est pas déjà explicitement définie, de sorte que les
  opérateurs peuvent toujours les remplacer via `environment_variables`.
- **Chemin de santé — TCP uniquement, port 8080.** Keycloak 25+ sert
  `/health`, `/health/ready`, `/health/live` et
  `/metrics` sur le **port de gestion séparé 9000**, et non sur le
  port HTTP 8080 que la plateforme sonde. Une sonde HTTP contre
  `8080/health` renverrait toujours 404. La sonde de démarrage (délai
  initial de 30s, 30 échecs ≈ jusqu'à ~330s au total pour le démarrage de la
  JVM + la migration du schéma) et la sonde de vivacité (délai initial de
  60s, 3 échecs) sont des vérifications **TCP** sur le port 8080.
- **Mise à l'échelle horizontale / mise en garde sur le clustering.** Le
  commentaire de câblage de `Keycloak_GKE` indique que Keycloak "persiste
  tout l'état dans PostgreSQL, donc la mise à l'échelle horizontale est sûre
  (les nœuds du cluster forment un cache partagé via l'infinispan par
  défaut)".
  {/* TODO: vérifier — `KC_CACHE` n'est pas explicitement défini sur
  `ha`/kubernetes-ping nulle part dans l'environnement de
  Keycloak_Common ou les arguments de build personnalisés, et la pile de cache
  Infinispan par défaut de Keycloak en dehors d'une configuration HA/Kubernetes
  explicite est locale (par pod), ce qui NE répliquerait PAS l'état de
  session/connexion entre les réplicas. Confirmer la pile de cache réelle dans
  l'image déployée avant de se fier à `max_instance_count > 1` pour la continuité de
  session en production. */}
- **Vérifier la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^KC_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Keycloak sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `keycloak` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `26.0` | Tag de l'image Keycloak intégré dans le `kc.sh build` personnalisé. Ne jamais rétrograder — les migrations de schéma sont unidirectionnelles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Le dimensionnement CPU/mémoire **autoritaire** — il est fusionné dans la configuration de l'application *après* les `Keycloak_Common`'s `cpu_limit`/`memory_limit`, donc il l'emporte toujours. La JVM de Keycloak nécessite au moins 2 Gi. |
| `cpu_limit` / `memory_limit` | `2000m` / `4Gi` | Entrées de dimensionnement de haut niveau héritées, transmises à `Keycloak_Common` — **masquées par `container_resources`** (voir [§6](#6-configuration-pitfalls--sensible-defaults)) puisque `container_resources` a toujours une valeur par défaut non nulle. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Transmis directement à la Fondation, mais **les limites effectives des réplicas sont codées en dur à 1/5 dans le `main.tf` de ce module**, indépendamment de ces valeurs — voir [§6](#6-configuration-pitfalls--sensible-defaults). |
| `container_port` | `8080` | Écouteur HTTP de Keycloak. La santé/les métriques sont sur le port de gestion séparé 9000 — la plateforme sonde ce port via TCP, pas HTTP. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (boucle locale TCP) — requis sur GKE pour la connectivité JDBC. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin à l'intérieur du conteneur où le répertoire du socket Unix de l'Auth Proxy est monté (utilisé par les appels `db-init`/`pg_isready` du job `psql` ; le conteneur Keycloak en cours d'exécution se connecte via `127.0.0.1:5432`, pas ce chemin). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur d'administration/connexion de Keycloak. |
| `workload_type` | `null` → `Deployment` | Keycloak est sans état ; ne pas passer à `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |
| `termination_grace_period_seconds` | `60` | Temps alloué aux requêtes en cours pour se terminer avant qu'un pod ne soit forcé de s'arrêter. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | TCP, port 8080 | Entrées de sonde de la Fondation de haut niveau — **les valeurs `startup_probe`/`liveness_probe` spécifiques à l'application ci-dessous sont ce que `App_GKE` lit réellement pour les sondes de cette charge de travail.** |
| `startup_probe` | TCP, 30s de délai, 30 échecs | Transmis à `Keycloak_Common` ; budget d'échec généreux pour le démarrage de la JVM + la création du schéma au premier démarrage. |
| `liveness_probe` | TCP, 60s de délai, 3 échecs | Transmis à `Keycloak_Common`. TCP uniquement — `/health` sur le port 9000 n'est pas accessible depuis la sonde. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Keycloak sert une page d'accueil publique à `/`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Généralement non requis — Keycloak conserve tout l'état dans PostgreSQL. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Moteur fixe ; MySQL/SQL Server ne sont pas pris en charge. |
| `db_name` / `db_user` | `keycloak` / `keycloak` | **Le nom/utilisateur de la base de données faisant autorité** — ceux-ci passent par les `Keycloak_Common`'s `config.db_name`/`config.db_user`, qui est ce que `App_GKE` provisionne réellement. |
| `application_database_name` / `application_database_user` | `keycloak` / `keycloak` | Transmis directement à l'appel de la Fondation, mais **masqués par `db_name`/`db_user`** dans la résolution de configuration par application de `App_GKE` — les deux ont la même valeur par défaut, donc cela est invisible à moins qu'une seule paire ne soit modifiée. Voir [§6](#6-configuration-pitfalls--sensible-defaults). |
| `enable_postgres_extensions` | `false` | Non requis pour Keycloak. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

### Groupe 21 — Cloud Armor, CDN et Redis {#group-21--cloud-armor-cdn--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Keycloak ne nécessite pas Redis ; laissez `false` à moins qu'un SPI/plugin personnalisé ne le nécessite. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP de l'équilibreur de charge externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Keycloak. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Keycloak ne stocke aucun état en dehors de PostgreSQL). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé avec un paramètre sans état, IAP sans identités
> autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. Une
> configuration invalide échoue à la **planification** avec une erreur claire
> et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart
> des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixe) | Critique | La sélection d'un moteur non-Postgres rompt le démarrage du schéma de Keycloak et chaque requête. |
| `db_name` / `db_user` (la paire faisant autorité) | Définir une fois, avant le premier déploiement | Critique | Effectivement immuable — `App_GKE` résout la base de données/utilisateur Cloud SQL réelle à partir de ceux-ci, et les modifier après le premier déploiement pointe Keycloak vers une base de données/rôle différent (vide), orphelinant tous les royaumes/utilisateurs. |
| `application_database_name` / `application_database_user` | Laisser correspondre `db_name`/`db_user` | Moyen | Ceux-ci sont transmis à la Fondation mais masqués par `db_name`/`db_user` dans la résolution de configuration par application de `App_GKE` — ne modifier que cette paire n'a aucun effet silencieux sur le nom réel de la base de données, ce qui peut induire un opérateur en erreur en lui faisant croire qu'un renommage a eu lieu. |
| `min_instance_count` / `max_instance_count` | Comprendre qu'ils sont informatifs ici | Moyen | Ce module code en dur les limites effectives des réplicas à `1`/`5` dans `main.tf`, quelles que soient les valeurs de ces variables — définir `max_instance_count = 1` pour le contrôle des coûts ne limitera **pas** réellement les réplicas à 1. |
| `cpu_limit` / `memory_limit` | Définir `container_resources` à la place | Moyen | `container_resources` a toujours une valeur par défaut non nulle et est fusionné en dernier, donc ne modifier que les variables héritées `cpu_limit`/`memory_limit` est ignoré silencieusement. |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` (auto-généré) | Récupérer, se connecter, puis faire pivoter/désactiver | Élevé | L'administrateur de démarrage est destiné à être temporaire ; le laisser actif indéfiniment est un risque de credential permanent. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité de la base de données sur GKE ; le désactiver sans chemin TCP alternatif rompt chaque appel de base de données. |
| Chemins de sonde | TCP sur le port 8080 (par défaut) | Élevé | Le `/health` de Keycloak se trouve sur le port de gestion 9000, pas 8080 — une sonde HTTP contre `8080/health` renvoie toujours 404 et le pod ne devient jamais Prêt même si Keycloak a démarré correctement. |
| `max_instance_count > 1` (clustering de session) | Vérifier la réplication Infinispan/session avant de s'y fier | Élevé | Si la pile de cache de l'image déployée n'est pas réellement distribuée entre les pods (non confirmé — voir [§3](#3-keycloak-application-behaviour)), les utilisateurs peuvent être redirigés vers un pod sans connaissance de leur session, forçant une réauthentification. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les requêtes rebondissent entre les pods plus que nécessaire tant que la mise en garde sur le clustering ci-dessus n'est pas résolue. |
| `application_version` | Ne jamais rétrograder | Critique | Les migrations de schéma Keycloak sont unidirectionnelles ; rétrograder après l'exécution d'une migration peut corrompre le schéma. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et `KC_HOSTNAME`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Keycloak
partagée avec la variante Cloud Run (le build d'image personnalisé, le mappage
DB/nom d'hôte du point d'entrée, les secrets et les valeurs par défaut des
sondes) est décrite dans **[Keycloak_Common](Keycloak_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Keycloak sur GKE Autopilot](../labs/Keycloak_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Keycloak sur Google Cloud Run](Keycloak_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Keycloak Common — Configuration d'application partagée](Keycloak_Common.md) — la configuration partagée par les deux cibles de déploiement.
