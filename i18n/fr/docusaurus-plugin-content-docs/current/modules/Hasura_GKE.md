---
title: "Hasura sur GKE Autopilot"
description: "Référence de configuration pour déployer Hasura sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Hasura_GKE.md @ 3055034 sha256:e9c322b220b2 -->

# Hasura sur GKE Autopilot {#hasura-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hasura_GKE.png" alt="Hasura sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hasura est un moteur open source sous licence Apache 2.0 qui vous fournit instantanément une API GraphQL (et REST) en temps réel au-dessus d'une base de données PostgreSQL, avec une autorisation fine basée sur les rôles, des déclencheurs d'événements et une console d'administration intégrée. Ce module déploie le Hasura GraphQL Engine (`hasura/graphql-engine`) sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Hasura et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Hasura s'exécute sous forme d'une charge de travail web Haskell sans état. Le déploiement assemble un ensemble restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Haskell, 1 vCPU / 512 MiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le catalogue de métadonnées de Hasura et sa source de données par défaut résident tous deux dans Postgres |
| Stockage d'objets | Aucun | Hasura est sans état ; aucun bucket n'est provisionné |
| Secrets | Secret Manager | `HASURA_GRAPHQL_ADMIN_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche applicative partagée ; Hasura conserve son propre catalogue de métadonnées dans Postgres.
- **Le secret administrateur protège tout ce qui est sensible.** `HASURA_GRAPHQL_ADMIN_SECRET` est généré automatiquement, stocké dans Secret Manager et matérialisé dans l'espace de noms via le pilote Secret Store CSI. Il protège l'interface `/console` ainsi que les API `/v1/graphql` et `/v1/metadata` ; `/healthz` reste public pour les sondes.
- **Deux URL de connexion sont assemblées dans le conteneur.** Le point d'entrée de l'image personnalisée construit `HASURA_GRAPHQL_DATABASE_URL` et `HASURA_GRAPHQL_METADATA_DATABASE_URL` à partir des variables `DB_*` injectées. Sur GKE, le sidecar Cloud SQL Auth Proxy écoute sur `127.0.0.1` ; le point d'entrée utilise donc un DSN loopback simple sans `sslmode` (le proxy termine le TLS).
- **Deployment sans état, sans routage persistant.** `workload_type = "Deployment"` et `session_affinity = "None"` — chaque pod est interchangeable car tout l'état est dans Postgres ; les mises à jour progressives sont donc sûres et aucun PVC/NFS n'est utilisé.
- **Un minimum d'un réplica est maintenu** (GKE ne prend pas en charge la mise à l'échelle jusqu'à zéro) afin que l'API soit toujours joignable ; un PodDisruptionBudget (`pdb_min_available = "1"`) préserve la disponibilité pendant les mises à niveau des nœuds.
- **Exposé sur une IP externe stable.** `service_type = "LoadBalancer"`, `reserve_static_ip = true` et `enable_custom_domain = true` par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Hasura {#a-gke-autopilot--the-hasura-workload}

Les pods Hasura sont planifiés sur Autopilot, qui facture le CPU et la mémoire effectivement demandés par les pods. L'autoscaling horizontal des pods dimensionne le Deployment entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Hasura pour voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Hasura stocke son catalogue de métadonnées (tables suivies, relations, permissions, déclencheurs d'événements) **et** vos données applicatives dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods s'y connectent de manière privée via le sidecar **Cloud SQL Auth Proxy** en loopback ; aucune IP publique n'est exposée. Au premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application ; Hasura installe son schéma de métadonnées au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous indiqués dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : `HASURA_GRAPHQL_ADMIN_SECRET`. Il est matérialisé dans l'espace de noms via le pilote Secret Store CSI et injecté en tant que variable d'environnement. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe, avec une IP statique réservée afin que l'adresse survive aux redéploiements et un certificat géré par Google pour le domaine personnalisé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et Cloud SQL à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Hasura {#3-hasura-application-behaviour}

- **Initialisation de la base de données au premier déploiement.** Un job d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et l'utilisateur de l'application, puis accorde les privilèges. Le job peut être réexécuté sans risque.
- **Catalogue de métadonnées au démarrage.** Hasura installe et migre son propre schéma de catalogue de métadonnées dans Postgres au démarrage ; la mise à niveau de la version de l'image applique donc les modifications du catalogue sans étape de migration distincte. Les métadonnées des tables suivies persistent dans la base de données lors des redémarrages de pods et des mises à jour progressives.
- **Deux URL de connexion, assemblées dans le conteneur.** Le point d'entrée construit à la fois `HASURA_GRAPHQL_DATABASE_URL` et `HASURA_GRAPHQL_METADATA_DATABASE_URL` à partir des variables `DB_*` injectées. Comme le sidecar Auth Proxy écoute sur `127.0.0.1`, le DSN est un loopback simple sans SSL.
- **Le secret administrateur est la frontière de sécurité.** Envoyez-le dans l'en-tête `x-hasura-admin-secret` :
  ```bash
  ADMIN=$(gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT")
  curl -s "http://${EXTERNAL_IP}/v1/graphql" \
    -H "x-hasura-admin-secret: $ADMIN" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ __schema { queryType { name } } }"}'
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/healthz` — le point de terminaison public, sans authentification, qui renvoie 200 dès que le moteur est démarré et connecté à Postgres. Ne redirigez pas les sondes vers `/v1/graphql` ou `/console` (les deux renvoient 401 sans le secret administrateur), sinon les pods ne deviennent jamais Ready.
- **Accès à la console.** Accédez à la console sur `http://<external-ip>/console` (ou sur le domaine personnalisé) et collez le secret administrateur pour suivre des tables et exécuter des requêtes GraphQL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Hasura ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe ; un suffixe `-gke` est ajouté en interne afin que les variantes CloudRun et GKE n'entrent jamais en collision. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hasura` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Hasura` | Nom lisible affiché dans la console. |
| `application_description` | `Hasura GraphQL Engine on GKE Autopilot` | Description du service. |
| `application_version` | `v2.36.0` | Tag de l'image Hasura ; `latest` est remplacé par un tag v2.x épinglé au moment du build. |
| `application_database_name` | `hasura` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `hasura` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit une image d'encapsulation qui assemble les DSN ; `prebuilt` exige une configuration manuelle des URL. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Limites et requêtes de CPU/mémoire. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige ≥ 1 (pas de mise à l'échelle jusqu'à zéro). |
| `max_instance_count` | `10` | Nombre maximal de réplicas. Hasura se met à l'échelle horizontalement. |
| `workload_type` | `Deployment` | Sans état — Hasura conserve tout son état dans Postgres. |
| `container_port` | `8080` | Hasura écoute sur `HASURA_GRAPHQL_SERVER_PORT = 8080`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connexion Postgres. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Hasura dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant l'Ingress (API comprise). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `session_affinity` | `None` | Pas de routage persistant — Hasura est sans état. |
| `network_tags` | `[]` | Tags réseau des nœuds/pods. Ajoutez `nfsserver` si vous activez `enable_nfs`. |
| `termination_grace_period_seconds` | `30` | Secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | À laisser non défini. Déconseillé — Hasura stocke tout son état dans PostgreSQL. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` | `10Gi` / `/data` | Pertinent uniquement si un StatefulSet est imposé. |

### Groupe 8 — Variables d'environnement et secrets {#group-8--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `HASURA_GRAPHQL_*` supplémentaires. Ne définissez pas ici les deux valeurs `*_DATABASE_URL` ni le secret administrateur — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_resource_quota` | `false` | Applique un ResourceQuota à l'espace de noms (les valeurs de mémoire nécessitent des suffixes binaires, p. ex. `4Gi`). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, `failure_threshold=30` | Sonde de démarrage. |
| `health_check_config` | HTTP `/healthz`, `failure_threshold=3` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Hasura. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir [App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis pour Hasura. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Hasura n'a besoin d'aucun stockage de fichiers. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Déclarée pour refléter les variables du socle, mais non transmise à [App_GKE](App_GKE.md) dans ce module — Hasura ne nécessite pas Redis ; cette variable n'a donc aucun effet, quelle que soit sa valeur. |
| `redis_host` / `redis_port` | `""` / `6379` | Également sans effet, pour la même raison que `enable_redis`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe — Hasura nécessite PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Expression cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; à porter à 30–90 pour la production/la conformité. |
| `enable_backup_import` | `false` | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour des noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir ; vide, le nom d'hôte nip.io de l'IP réservée est utilisé. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour un accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id` pour les projets imbriqués dans un dossier). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services par étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Hasura. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Hasura). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs d'initialisation et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration non valide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `HASURA_GRAPHQL_ADMIN_SECRET` (généré automatiquement) | À conserver dans Secret Manager ; rotation délibérée | Critique | C'est la seule protection des API GraphQL/métadonnées et de la console — l'exposer accorde un accès complet en lecture/écriture à toutes les tables suivies. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelins le catalogue de métadonnées et toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans fichier de sauvegarde valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent la planification de tous les pods dans l'espace de noms. |
| Chemin de `startup_probe_config` / `health_check_config` | `/healthz` | Élevé | Faire pointer une sonde vers `/v1/graphql` ou `/console` renvoie 401 — les pods ne deviennent jamais Ready alors que le moteur a démarré. |
| `container_image_source` | `custom` | Élevé | `prebuilt` ignore le point d'entrée qui assemble les deux valeurs `*_DATABASE_URL` — le moteur démarre sans base de données et chaque requête échoue. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment du plan. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs non valides. Conserver 1 garantit que l'API est toujours joignable. |
| `workload_type` / `stateful_pvc_enabled` | `Deployment` / non défini | Moyen | Imposer un StatefulSet n'apporte rien (l'état est dans Postgres) et complique les mises à jour progressives. |
| `HASURA_GRAPHQL_ENABLE_CONSOLE` | `false` en production | Moyen | Laisser la console activée élargit la surface d'attaque ; gérez plutôt les métadonnées via la CLI `hasura`/les migrations. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention conforme aux exigences réglementaires. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Hasura partagée avec la variante Cloud Run est décrite dans **[Hasura_Common](Hasura_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hasura sur GKE Autopilot](../labs/Hasura_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Hasura sur Google Cloud Run](Hasura_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Hasura Common — Configuration applicative partagée](Hasura_Common.md) — la configuration partagée par les deux cibles de déploiement.
