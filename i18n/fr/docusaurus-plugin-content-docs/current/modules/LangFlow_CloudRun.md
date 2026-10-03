---
title: "LangFlow sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de LangFlow sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LangFlow_CloudRun.md @ 15fd4c7 sha256:18ac286b374e -->

# LangFlow sur Google Cloud Run {#langflow-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LangFlow_CloudRun.png" alt="LangFlow sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LangFlow est un constructeur visuel open source et low-code pour les agents et
les workflows d'IA, basé sur LangChain. Il permet d'assembler des chaînes de
modèles de langage, des pipelines RAG et des agents en faisant glisser et en
connectant des composants sur un canevas, puis de les exposer en tant qu'API. Ce
module déploie LangFlow sur **Cloud Run v2** sur la base de
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LangFlow et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — veuillez-vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

LangFlow s'exécute comme un conteneur Python (FastAPI + React) unique sur Cloud
Run v2. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python sur le port **7860**, 1 vCPU / 2 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — LangFlow persiste tous les flux, composants et identifiants dans Postgres |
| Stockage d'objets | Cloud Storage | Un bucket `data` est provisionné par défaut (`storage_buckets`) mais laissé non monté (`gcs_volumes = []`) — LangFlow conserve tout l'état de l'application dans PostgreSQL |
| Cache et file d'attente | Redis (facultatif) | Non requis par LangFlow ; câblé pour la compatibilité ascendante uniquement |
| Secrets | Secret Manager | `LANGFLOW_SECRET_KEY` et `LANGFLOW_SUPERUSER_PASSWORD` auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée (`database_type = "POSTGRES_15"`) ; la sélection de tout autre moteur
  entraîne un échec au démarrage.
- **`LANGFLOW_SECRET_KEY` est généré automatiquement** et stocké dans Secret Manager. Il
  chiffre toutes les informations d'identification stockées et intégrées dans un
  flux. Il ne doit jamais être renouvelé après le premier démarrage — le
  renouveler rompt de manière permanente toutes les informations d'identification
  stockées, qui doivent alors être ressaisies dans chaque flux.
- **Le compte administrateur est provisionné à partir d'un mot de passe
  généré.** `LANGFLOW_AUTO_LOGIN = "false"` active l'authentification ; LangFlow crée l'administrateur
  initial (`admin` par défaut) en utilisant le secret `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez-le
  depuis Secret Manager pour vous connecter.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les
  démarrages à froid ajoutent plusieurs secondes de latence — plus les
  migrations Alembic au premier démarrage sur une nouvelle instance. Définissez
  `min_instance_count = 1` pour maintenir le canevas chaud pour l'édition interactive.
- **`max_instance_count = 1` par défaut.** LangFlow conserve l'état de session et de flux
  en cours de traitement ; exécutez une seule instance, sauf si vous avez
  externalisé l'état et comprenez les implications.
- **Ingress public par défaut.** `ingress_settings = "all"` expose l'URL `run.app`. L'activation
  d'IAP place la connexion Google devant l'ensemble du service, y compris son
  API.
- **NFS contient les téléchargements, et le bucket GCS par défaut n'est pas
  monté.** Les flux, les utilisateurs et les identifiants résident dans
  PostgreSQL ; NFS est activé par défaut (`enable_nfs = true`, monté à `/data` comme
  répertoire de configuration de LangFlow, où les fichiers téléchargés sont
  conservés) et doit rester activé, tandis que le bucket `data`
  auto-provisionné n'est pas monté dans le conteneur (`gcs_volumes = []`) — il existe pour
  que vous le connectiez uniquement si un composant personnalisé a besoin de
  stockage d'objets.
- **`LANGFLOW_DATABASE_URL` est composé au moment de l'exécution** par le point d'entrée du
  conteneur à partir des variables `DB_*` injectées (DSN TCP, `sslmode=require` sur Cloud
  Run) — vous ne le définissez pas vous-même.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service LangFlow {#a-cloud-run--the-langflow-service}

LangFlow s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge des requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~langflow"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LangFlow stocke toutes les données d'application (flux, composants,
informations d'identification, historique d'exécution, utilisateurs) dans une
instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte en privé
via l'**adresse IP privée** de l'instance (le point d'entrée compose un DSN TCP
avec `sslmode=require`) ; le socket Unix du proxy d'authentification Cloud SQL est
également monté. Lors du premier déploiement, un job d'initialisation crée la
base de données de l'application, le rôle et les autorisations.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~langflow"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Redis (facultatif — non utilisé par LangFlow) {#c-redis-optional--not-used-by-langflow}

Redis est **désactivé par défaut** et LangFlow ne le requiert pas ; les entrées
`enable_redis` sont câblées uniquement pour la compatibilité ascendante. Laissez
`enable_redis = false` à moins qu'une fonctionnalité future ne le nécessite.

- **CLI (uniquement si activé) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`LANGFLOW_SECRET_KEY` (chiffre toutes les informations d'identification stockées) et
`LANGFLOW_SUPERUSER_PASSWORD` (le mot de passe de connexion administrateur initial). Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~langflow"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé ; les paramètres d'ingress et l'egress VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Journalisation → Explorateur de journaux ; Surveillance →
  Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LangFlow {#3-langflow-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) exécute le script générique `db-init.sh` de la
  Fondation en utilisant `postgres:15-alpine`. Il attend PostgreSQL, puis crée de manière
  idempotente le rôle et la base de données de l'application, définit la
  propriété et accorde les privilèges sur la base de données. Il peut être
  réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** LangFlow exécute ses **migrations
  Alembic à chaque démarrage de conteneur**, de sorte que les tables sont créées
  et mises à niveau par l'application elle-même — le job `db-init` ne gère que le
  rôle/la base de données/les autorisations. Prévoyez un temps supplémentaire
  au premier démarrage.
- **`LANGFLOW_SECRET_KEY` est immuable après le premier démarrage.** Il est généré une
  fois et écrit dans Secret Manager. Le modifier rompt de manière permanente
  toutes les informations d'identification stockées et intégrées dans un flux ;
  elles ne peuvent plus être déchiffrées. Ne le renouvelez que pendant une
  fenêtre de maintenance planifiée avec un plan de ressaisie des informations
  d'identification.
- **Compte administrateur initial.** Avec `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow crée le
  super-utilisateur (`admin` par défaut, défini via `langflow_username`) en utilisant le
  secret `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez le mot de passe et connectez-vous :
  ```bash
  gcloud secrets versions access latest \
    --secret=<langflow-password-secret> --project "$PROJECT"
  ```
- **L'URL de la base de données est composée au moment de l'exécution.** Le
  point d'entrée construit `LANGFLOW_DATABASE_URL` à partir des variables `DB_*` injectées via
  TCP (`DB_IP`, `sslmode=require` sur Cloud Run) — ne le définissez pas manuellement, sauf
  si vous avez l'intention de remplacer l'ensemble du DSN.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  **`/health`**, le point de terminaison de vivacité public de LangFlow qui
  renvoie `200` une fois le serveur démarré. La sonde de démarrage par défaut
  permet un délai initial de 60 secondes plus une fenêtre d'échec de 60 × 10s
  (600s) pour couvrir le chargement des composants au premier démarrage et les
  migrations Alembic.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
LangFlow sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langflow` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `LangFlow` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image LangFlow ; épingle l'image de base `1.10.2` lorsque `latest`. Épinglez explicitement en production. |
| `langflow_username` | `admin` | Nom d'utilisateur du super-utilisateur (administrateur) initial ; le mot de passe est auto-généré dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | LangFlow est construit à partir de l'image encapsulée via Cloud Build. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; maintenez ≥ 1 GiB pour l'exécution Python. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour maintenir le canevas chaud. |
| `max_instance_count` | `1` | Maintenez à `1` — LangFlow conserve l'état de session en cours de traitement. |
| `container_port` | `7860` | LangFlow écoute sur le port 7860. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Montage du socket du proxy d'authentification Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image du conteneur dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` expose l'URL publique `run.app`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'ensemble du service. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés sur les valeurs par défaut de LangFlow. Ne définissez pas `LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD` ou `LANGFLOW_DATABASE_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple, clés API de fournisseur LLM). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisé (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy de App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et initialisation {#group-9--custom-sql-scripts--initialization}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS
après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; étendez la liste pour les composants personnalisés. |
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : le montage est le répertoire de configuration de LangFlow, où résident les fichiers téléchargés. Les flux, les utilisateurs et les informations d'identification sont de toute façon dans Cloud SQL. |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur (lorsque NFS est activé). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — LangFlow nécessite PostgreSQL 15. |
| `application_database_name` | `langflowdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `langflowuser` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé | Extensions Postgres facultatives. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", image = "postgres:15-alpine", script_path = "scripts/db-init.sh", execute_on_apply = true }]` | Job intégré qui crée le rôle de l'application, la base de données et les autorisations lors du premier déploiement. Remplacez par une liste non vide pour exécuter différents jobs. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés (aucun requis par LangFlow). |
| `additional_services` | `[]` | Services auxiliaires/sidecar déployés avec LangFlow. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 60s, fenêtre d'échec de 60 × 10s | Sonde de démarrage. La généreuse fenêtre de 600s après le délai de 60s tient compte du premier démarrage de LangFlow (chargement de tous les composants + amorçage des projets de démarrage avant la liaison uvicorn — 2 à 4 minutes) ainsi que des migrations Alembic au premier démarrage. |
| `liveness_probe` | HTTP `/health`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/health`, activé | Sonde structurée au niveau App_CloudRun (parallèle à `startup_probe`, qui est passée à LangFlow_Common). |
| `health_check_config` | HTTP `/health`, activé | Sonde de vivacité structurée au niveau App_CloudRun (parallèle à `liveness_probe`). |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring ; activez pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 21 — Cache Redis (facultatif) {#group-21--redis-cache-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par LangFlow ; câblé pour la compatibilité ascendante uniquement. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Paramètres de connexion Redis (uniquement si activé). |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode d'exécution à sec. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — IAP
> sans identités autorisées, un environnement d'exécution `gen1` avec des
> montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée,
> un `redis_port`/`backup_retention_days` hors plage, et plus encore. Une configuration invalide
> échoue à la **planification** avec une erreur claire et nommée avant la
> création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LANGFLOW_SECRET_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler rompt de manière permanente toutes les informations d'identification stockées et intégrées dans un flux — elles ne peuvent pas être déchiffrées et doivent être ressaisies. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les flux et informations d'identification. |
| `database_type` | `POSTGRES_15` | Critique | LangFlow nécessite PostgreSQL 15 ; tout autre moteur entraîne un échec au démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide échoue au job d'importation. |
| `LANGFLOW_SUPERUSER_PASSWORD` (auto-généré) | Récupérer depuis Secret Manager | Élevé | C'est la connexion administrateur ; la perdre signifie qu'il n'y a aucun moyen de se connecter tant qu'elle n'est pas réinitialisée. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures à 1 GiB risquent des arrêts OOM pour l'exécution Python sous charge. |
| `max_instance_count` | `1` | Élevé | LangFlow conserve l'état de session/flux en cours de traitement ; la mise à l'échelle au-delà de 1 divise l'état entre les instances et entraîne un comportement incohérent. |
| `enable_iap` | uniquement lorsque l'authentification API n'est pas nécessaire en externe | Élevé | IAP place la connexion Google devant l'ensemble du service, y compris son API programmatique. |
| `container_port` | `7860` | Élevé | LangFlow écoute sur le port 7860 ; un port non concordant échoue à toutes les sondes de santé. |
| `min_instance_count` | `1` pour une utilisation interactive | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid plus le temps de migration au premier démarrage sur une nouvelle instance. |
| `enable_cloudsql_volume` | `true` | Moyen | La désactivation supprime le montage du socket ; le point d'entrée s'appuie alors uniquement sur le chemin TCP de l'IP privée. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur et l'API sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
construction d'images — voir **[App_CloudRun](App_CloudRun.md)**. La
configuration d'application spécifique à LangFlow partagée avec la variante GKE
est décrite dans **[LangFlow_Common](LangFlow_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LangFlow sur Cloud Run](../labs/LangFlow_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LangFlow sur GKE Autopilot](LangFlow_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [LangFlow Common — Configuration d'application partagée](LangFlow_Common.md) — la configuration partagée par les deux cibles de déploiement.
