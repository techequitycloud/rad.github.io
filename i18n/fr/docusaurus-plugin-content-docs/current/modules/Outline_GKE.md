---
title: "Outline sur GKE Autopilot"
description: "Référence de configuration pour déployer Outline sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Outline_GKE.md @ 3055034 sha256:4e955acea821 -->

# Outline sur GKE Autopilot {#outline-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Outline_GKE.png" alt="Outline sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Outline est une base de connaissances et un wiki d'équipe open source, dans le
style de Notion : documents Markdown collaboratifs en temps réel, recherche en
texte intégral performante et collections de documents imbriquées, avec une
authentification assurée exclusivement par un fournisseur d'identité externe
(OIDC, Google, Slack, etc.) plutôt que par son propre stockage de noms
d'utilisateur et de mots de passe. Ce module déploie Outline sur **GKE
Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Outline et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Outline s'exécute comme une charge de travail Node.js unique avec une dépendance
Redis obligatoire (utilisée pour la coordination de la collaboration en temps
réel et des sessions, pas seulement comme cache). Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js sur le port 3000, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Outline (Sequelize) ne prend en charge que Postgres |
| Cache / coordination | Redis (autogéré, co-hébergé sur la VM NFS par défaut) | **Obligatoire**, et non facultatif — Outline en a besoin même avec un seul réplica |
| Persistance des fichiers | Cloud Filestore (NFS) | Les fichiers téléversés sont conservés sous `/var/lib/outline/data`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Deux buckets provisionnés par défaut (`...-storage`, `...-data`) ; aucun n'est monté dans le pod d'emblée |
| Secrets | Secret Manager | `SECRET_KEY` et `UTILS_SECRET` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée par défaut ; domaine personnalisé + certificat géré, IAP et Cloud Armor en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est de fait obligatoire** (`database_type` vaut par défaut
  `POSTGRES_15`) — les migrations Sequelize d'Outline, l'extension de recherche
  `pg_trgm` et la logique de chaîne de connexion du point d'entrée supposent
  toutes Postgres.
- **Redis est obligatoire, et non facultatif.** `enable_redis = true` par
  défaut ; avec `enable_nfs = true` (également par défaut), le socle fait
  pointer `REDIS_HOST` vers l'IP du serveur NFS, qui co-héberge Redis — aucune
  instance Memorystore séparée n'est nécessaire.
- **Plusieurs réplicas par défaut** (`min_instance_count = 1`,
  `max_instance_count = 3`) — contrairement à la plupart des applications
  adossées à NFS ici, Outline est conçu pour exécuter plusieurs réplicas
  simultanément (Redis coordonne l'état).
- **Les déploiements adossés à NFS utilisent toujours `Recreate`,** ce qui arrête
  **tous** les réplicas avant de démarrer le nouvel ensemble — avec
  `max_instance_count = 3`, cela représente une brève interruption totale à
  chaque redéploiement, et non un déploiement progressif.
- **Deux buckets Cloud Storage sont créés mais inutilisés par défaut** — l'un
  provenant de `Outline_Common` (`storage`), l'autre de la valeur par défaut
  propre à cette variante (`data`). Outline stocke en réalité les fichiers
  téléversés sur NFS (`FILE_STORAGE=local`) ; aucun des deux buckets n'est monté
  via `gcs_volumes` sauf configuration explicite.
- **`SECRET_KEY`/`UTILS_SECRET` sont générés automatiquement** dans Secret
  Manager et injectés à la fois comme références Secret Manager et comme
  `explicit_secret_values` brutes (une précaution de lecture après écriture ; le
  chemin par ID Secret Manager l'emporte).
- **Un fournisseur d'authentification est requis avant que la connexion
  fonctionne.** Les variables `OIDC_*` sont livrées vides ; Outline construit son
  `redirect_uri` OIDC à partir de `URL`, si bien qu'en l'absence de fournisseur
  configuré, il n'enregistre **aucune** méthode d'authentification. Voir la
  [section 3](#3-outline-application-behaviour).
- **Le LoadBalancer par défaut est en HTTP simple**, ce qui empêche purement et
  simplement les connexions OAuth tant qu'un domaine et TLS ne sont pas
  ajoutés — voir la
  [section 6](#6-configuration-pitfalls--sensible-defaults).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Outline {#a-gke-autopilot--the-outline-workload}

Les pods Outline sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Comme `enable_nfs = true`, le Deployment
utilise la stratégie `Recreate` — avec `max_instance_count > 1`, chaque
déploiement arrête tous les réplicas avant de démarrer l'ensemble de
remplacement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Outline pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app~outline
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Outline stocke l'ensemble des documents, collections, utilisateurs et index de
recherche dans une instance gérée Cloud SQL for PostgreSQL 15, accessible via le
side-car **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` (`enable_cloudsql_volume
= true`) ; aucune IP publique n'est exposée. Au premier déploiement, le job
`db-init` crée la base de données, l'utilisateur et les droits ; le point
d'entrée personnalisé exécute les migrations Sequelize d'Outline à chaque
démarrage du conteneur (de manière idempotente).

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatiques et la rotation des mots de passe.

### C. Redis {#c-redis}

La couche de collaboration et de sessions d'Outline ainsi que la limitation de
débit de son API nécessitent Redis — il ne s'agit pas d'un niveau de cache
facultatif comme pour de nombreuses applications. Par défaut, le socle fait
pointer `REDIS_HOST` vers l'IP interne de la VM du serveur NFS (qui co-héberge un
processus Redis) ; définissez `redis_host` pour utiliser Memorystore à la place.

- **Console :** Compute Engine → VM instances (Redis autohébergé sur la VM NFS),
  ou Memorystore → Redis instances si vous êtes passé à une instance gérée.
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^REDIS_'
  gcloud redis instances list --project "$PROJECT" --region "$REGION"   # only if using Memorystore
  ```

Voir [App_GKE](App_GKE.md) pour la façon dont `enable_redis`/`redis_host` sont
résolus.

### D. Cloud Filestore (NFS) et Cloud Storage {#d-cloud-filestore-nfs--cloud-storage}

Les fichiers téléversés dans Outline (`FILE_STORAGE=local`) résident sur **NFS
(Cloud Filestore)**, monté sur `/var/lib/outline/data` et partagé entre tous les
pods. Deux buckets **Cloud Storage** (suffixes `storage` et `data`) sont
également provisionnés automatiquement — aucun n'est monté dans le pod par
défaut, puisque Outline est configuré pour un stockage local/NFS plutôt que pour
un stockage d'objets compatible S3.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~outline"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse
(`gcs_volumes`) si vous souhaitez raccorder l'un des buckets provisionnés en tant
que volume monté.

### E. Secret Manager {#e-secret-manager}

Deux secrets propres à Outline sont générés automatiquement et stockés dans
Secret Manager : `SECRET_KEY` (chiffre les cookies et les données sensibles au
repos) et `UTILS_SECRET` (authentification interne de l'API et des utilitaires).
Le mot de passe de la base de données est géré séparément par le socle. Sur GKE,
les valeurs adossées à Secret Manager sont matérialisées dans le cluster sous
forme de Secrets Kubernetes natifs par le contrôleur **SecretSync** (le CRD
`secretsyncs.secret-sync.gke.io`), que le socle App_GKE attend lors de
l'amorçage du cluster.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~outline"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"   # the SecretSync-materialised "<prefix>-secrets" object
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration SecretSync/CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true`, HTTP
simple — sans terminaison TLS). Un domaine personnalisé avec un certificat géré
par Google peut être activé via `enable_custom_domain` + `application_domains`,
ce qui est indispensable pour que les connexions OAuth d'Outline fonctionnent
tout court (voir la
[section 6](#6-configuration-pitfalls--sensible-defaults)).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN, IAP,
Cloud Armor et les détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques
GKE et Cloud SQL sont envoyées vers Cloud Monitoring. `uptime_check_config` est
désactivé par défaut pour ce module (`enabled = false`) — activez-le une fois
l'application accessible en HTTPS.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Outline {#3-outline-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte à
  Cloud SQL via le side-car Auth Proxy, crée de manière idempotente le rôle
  applicatif et la base de données (appartenant à ce rôle), accorde les
  privilèges sur la base de données et sur le schéma `public`, puis signale au
  side-car proxy de s'arrêter (`quitquitquit`) afin que le Job se termine. Peut
  être réexécuté sans risque (`execute_on_apply = true`).
- **Les migrations s'exécutent à chaque démarrage du conteneur, et non dans un
  job distinct.** Le script personnalisé `entrypoint.sh` (intégré à l'image au
  moment du build) assemble `DATABASE_URL` à partir des valeurs `DB_*` injectées
  par la plateforme (selon que `DB_HOST` est un chemin de socket, `127.0.0.1` ou
  une IP privée), attend que Postgres accepte les connexions, exécute les
  migrations Sequelize d'Outline
  (`sequelize db:migrate --env=production-ssl-disabled`, idempotent), et
  seulement ensuite lance le serveur Node.
- **`URL` doit correspondre à l'adresse publique, sinon OIDC n'enregistre aucun
  fournisseur.** Outline dérive son `redirect_uri` OIDC de `URL`. Contrairement à
  la variante Cloud Run (qui définit `service_url_env_var_name = "URL"` afin que
  le socle injecte directement l'URL prévue), la variante GKE ne déclare
  **aucune** variable `service_url_env_var_name` — `App_GKE` injecte
  systématiquement l'URL calculée sous le nom `GKE_SERVICE_URL`, et le point
  d'entrée applique `URL="${CLOUDRUN_SERVICE_URL:-${GKE_SERVICE_URL:-}}"`
  uniquement **si `URL` n'est pas déjà défini**. Un nouveau déploiement renseigne
  donc `URL` automatiquement à partir de l'IP externe du LoadBalancer (ou de
  `https://<domain>` une fois `application_domains` défini) — aucune surcharge
  manuelle de `URL` n'est nécessaire, sauf pour imposer un nom d'hôte avant le
  provisionnement du DNS et du certificat.
- **Espaces réservés OIDC — l'opérateur doit les configurer après le
  déploiement.** `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTH_URI`,
  `OIDC_TOKEN_URI` et `OIDC_USERINFO_URI` sont livrés vides
  (`OIDC_DISPLAY_NAME`/`OIDC_SCOPES` sont pré-remplis). Définissez-les via
  `environment_variables` ou, de préférence, liez
  `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` en tant que
  `secret_environment_variables` (voir la
  [section 6](#6-configuration-pitfalls--sensible-defaults)). Enregistrez
  `<URL>/auth/oidc.callback` sur le **même hôte** que `URL`.
- **Sondes de santé.** Démarrage : **HTTP** `GET /`, délai initial de 60s,
  période de 10s, seuil d'échec de 6 (budget d'environ 120s). Liveness :
  **HTTP** `GET /`, délai initial de 60s, période de 30s, seuil d'échec de 3 —
  le délai généreux couvre l'exécution des migrations au premier démarrage.
  `FORCE_HTTPS` est forcé à `"false"` par `Outline_Common` afin que ces sondes
  HTTP ne soient pas redirigées en 301 vers un `:443` sans écouteur derrière le
  LoadBalancer HTTP simple par défaut.
- **Contraintes de mise à l'échelle.** `min_instance_count = 1`,
  `max_instance_count =
  3` par défaut. Comme `enable_nfs = true`, les déploiements utilisent la
  stratégie `Recreate` — tous les réplicas sont arrêtés avant que les
  nouveaux ne démarrent ; attendez-vous donc à une courte interruption totale à
  chaque redéploiement (et non à un déploiement progressif sans interruption).
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^(URL|OIDC_|REDIS_|DATABASE_URL)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (conformément aux balises `{{UIMeta group=N}}` de
`variables.tf`). Seuls les paramètres propres à Outline ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec
leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `outline` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `outlinewiki/outline` utilisée comme base du build personnalisé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Le serveur Node.js d'Outline écoute sur le port 3000. |
| `container_resources.cpu_limit` / `.memory_limit` | `1000m` / `2Gi` | 1 vCPU / 2 GiB recommandés au minimum. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Plafond par défaut plus élevé que la plupart des modules — Outline prend en charge plusieurs réplicas grâce à la coordination par Redis. |
| `enable_cloudsql_volume` | `true` | Side-car Auth Proxy (boucle locale `127.0.0.1:5432`) — obligatoire sur GKE. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | (voir [Outline_Common](Outline_Common.md)) | Pré-rempli avec `PGSSLMODE`, `FORCE_HTTPS=false`, `FILE_STORAGE*` et des espaces réservés `OIDC_*` vides ; **définissez ici le fournisseur d'authentification et, éventuellement, `URL`.** |
| `secret_environment_variables` | `{}` | Références Secret Manager injectées via SecretSync ; à utiliser pour `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` plutôt que du texte en clair. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface d'Outline ; HTTP simple par défaut. |
| `workload_type` | `null` → `Deployment` | Deployment, stratégie `Recreate` (adossé à NFS). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne toujours le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Indispensable pour que les fichiers téléversés persistent et soient partagés entre les réplicas. |
| `nfs_mount_path` | `/var/lib/outline/data` | Doit correspondre à `FILE_STORAGE_LOCAL_ROOT_DIR` défini par `Outline_Common`. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Fusionné avec le bucket `storage` propre à `Outline_Common` — deux buckets sont créés ; aucun n'est utilisé par l'application par défaut. |
| `gcs_volumes` | `[]` | Non renseigné par défaut ; Outline utilise NFS, et non GCS Fuse, pour les fichiers téléversés. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis par Outline** — ne pas désactiver. |
| `redis_host` | `""` | Laissez vide pour utiliser le Redis co-hébergé sur la VM NFS ; renseignez-le pour une instance Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL uniquement — les migrations d'Outline et l'extension `pg_trgm` supposent Postgres. |
| `application_database_name` | `outline` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `outline` | Utilisateur de base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |
| `postgres_extensions` | `["pg_trgm"]` | Requise pour la recherche en texte intégral dans les documents d'Outline. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress ; nécessaire pour un véritable TLS (hors nip.io). |
| `application_domains` | `[]` | C'est en définissant ici un vrai nom d'hôte (avec un certificat) que `service_url`/`URL` passent effectivement en `https://` — voir la [section 6](#6-configuration-pitfalls--sensible-defaults). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Outline (également injectée dans le conteneur sous le nom `GKE_SERVICE_URL`). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / interruption / sécurité) — **High**
> (service dégradé) — **Medium** (coût ou dégradation partielle) — **Low**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `StatefulSet` imposé conjointement à un
> paramètre sans état, IAP sans identités autorisées, des `quota_memory_*`
> fournis sous forme d'entiers bruts, un `container_port`/
> `backup_retention_days` hors plage. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute
> ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont
> plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Les migrations Sequelize d'Outline et l'extension de recherche `pg_trgm` supposent Postgres ; un moteur autre que Postgres casse le schéma et la recherche. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et rend orphelins tous les documents. |
| `SECRET_KEY` (généré automatiquement) | Ne jamais modifier | Critical | Sa rotation invalide tous les cookies de session existants ainsi que toutes les données chiffrées au repos avec l'ancienne clé. |
| `URL` / `GKE_SERVICE_URL` injecté automatiquement | Laissé non défini (automatique) ou explicitement égal à la véritable URL publique | Critical | S'il correspond au mauvais hôte, le `redirect_uri` OIDC d'Outline ne correspondra pas à celui enregistré auprès de l'IdP, et/ou aucun fournisseur ne s'enregistrera — page de connexion inutilisable. |
| HTTPS devant le Service | Configurer `enable_custom_domain` + `application_domains` + TLS avant d'activer l'authentification | Critical | Passport définit le cookie OAuth `state` avec `secure: true` ; derrière le LoadBalancer L4 en HTTP simple par défaut, `/auth/<provider>` renvoie `500 — Cannot send secure cookie over unencrypted connection`. La page d'accueil se charge normalement, ce qui masque la véritable cause. |
| `enable_redis` | `true` | Critical | Outline exige Redis même avec un seul réplica ; le désactiver casse la coordination en temps réel et des sessions, et l'application ne fonctionnera pas correctement. |
| `enable_nfs` | `true` | High | Le désactiver rend les fichiers téléversés éphémères — perdus à la recréation du pod — et empêche leur partage entre les réplicas. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` passés du texte en clair à une valeur adossée à un secret | À définir uniquement dans `secret_environment_variables` ; à retirer de `environment_variables` lors du même apply | High | Ces variables sont livrées sous forme de **variables d'environnement en clair contenant une chaîne vide**. Contrairement au `gcloud run services update` impératif de Cloud Run (qui exige d'abord une étape `--remove-env-vars`, avec l'erreur « already set with a different type »), le basculement sur GKE est déclaratif — `tofu apply` produit en une seule passe toute la liste `env` souhaitée. Mais laisser la clé dans **les deux** maps à la fois place **deux entrées `env` portant le même nom** dans la spécification du Pod (l'une `value`, l'autre `valueFrom.secretKeyRef`) ; Kubernetes l'accepte, mais la valeur effectivement vue par le processus n'est pas vérifiée ici — retirez la clé en texte clair lorsque vous ajoutez celle adossée au secret. {/* TODO: verify observed env precedence for a duplicate plain+secret env name on this cluster's container runtime */} |
| `max_instance_count` avec `enable_nfs = true` | Comprendre le compromis de `Recreate` | High | Chaque redéploiement arrête **tous** les réplicas en cours d'exécution (et pas seulement un pod de surplus) avant de démarrer l'ensemble de remplacement — une brève interruption totale à chaque mise à jour, pire que le cas à réplica unique de la plupart des autres modules adossés à NFS. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS, l'URI de redirection OIDC enregistrée et `URL`. |
| `uptime_check_config.enabled` | `false` par défaut | Medium | Aucune alerte automatique en cas d'interruption tant que vous ne l'activez pas — il est judicieux de la laisser désactivée jusqu'à la configuration de HTTPS et de l'authentification, puisque l'application est censée être inutilisable (redémarrages en boucle ou erreur 500 à la connexion) d'ici là. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — voir **[App_GKE](App_GKE.md)**. La configuration applicative propre à
Outline partagée avec la variante Cloud Run — les secrets générés
automatiquement, les variables d'environnement par défaut,
`entrypoint.sh`/`Dockerfile` et le job `db-init` — est décrite dans
**[Outline_Common](Outline_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Outline sur GKE Autopilot](../labs/Outline_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Outline sur Google Cloud Run](Outline_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Outline Common — Configuration applicative partagée](Outline_Common.md) — la configuration partagée par les deux cibles de déploiement.
