---
title: "Cal.diy sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Cal.diy sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CalDiy_CloudRun.md @ 15fd4c7 sha256:612a4d761caa -->

# Cal.diy sur Google Cloud Run {#caldiy-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalDiy_CloudRun.png" alt="Cal.diy sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.diy est le fork auto-hébergeable sous licence MIT de Cal.com — la plateforme de
planification open source utilisée par des millions de personnes dans le monde pour
éliminer les allers-retours de coordination de réunions. Ce module déploie Cal.diy
sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Cal.diy et sur la façon de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité de service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cal.diy s'exécute comme un conteneur Next.js (Node.js) sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 2 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Cal.diy utilise Prisma ORM ciblant PostgreSQL |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné par défaut |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` auto-générés |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** La sélection de MySQL ou `NONE`
  empêche le démarrage.
- **La mise à l'échelle à zéro est la valeur par défaut** (`min_instance_count = 0`). Le
  premier démarrage de Cal.diy prend 4 à 5 minutes ; définissez `min_instance_count = 1`
  pour la production afin d'éviter la latence de démarrage à froid.
- **Une image wrapper personnalisée est construite par défaut.** `CalDiy_Common`
  définit toujours `image_source = "custom"` et fournit un Dockerfile. Le point d'entrée
  assemble `DATABASE_URL` à partir des variables d'environnement `DB_*`
  injectées par la plateforme, rendant la connexion robuste quelle que soit la
  version de l'image déployée.
- **Trois jobs d'initialisation s'exécutent lors du premier déploiement :**
  `db-init` (configuration PostgreSQL), `db-migrate` (migrations de
  schéma Prisma) et `seed-app-store` (initialise la table du magasin d'applications
  Cal.diy). Tous sont idempotents.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY`** sont générés automatiquement et
  stockés dans Secret Manager ; vous ne les définissez jamais en texte clair.
- **`NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL`** sont calculés automatiquement à
  partir de l'URL de service Cloud Run prédite. Remplacez via `environment_variables`
  lors de l'utilisation d'un domaine personnalisé.
- **`calcom/cal.diy` n'a pas de tag `latest`** — toujours épingler
  `application_version` à une version (par exemple, `v6.2.0`).
- **Redis est désactivé par défaut.** Les sessions NextAuth.js sont stockées dans
  PostgreSQL. Activez Redis pour les déploiements multi-instances à forte
  concurrence.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Cal.diy {#a-cloud-run--the-caldiy-service}

Cal.diy s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la
charge de requêtes entre les nombres minimum et maximum d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.diy stocke toutes les données d'application (réservations, utilisateurs,
plannings, intégrations) dans une instance gérée Cloud SQL pour PostgreSQL 15. Le
service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas
d'IP publique). Lors du premier déploiement, une séquence de jobs Cloud Run crée la
base de données et l'utilisateur, exécute les migrations de schéma Prisma et
initialise le magasin d'applications.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket Cloud Storage par défaut (suffixe `data`) est provisionné et le
compte de service se voit accorder l'accès automatiquement. Cal.diy ne nécessite pas
de stockage NFS partagé par défaut — la base de données stocke tout l'état des
réservations.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

`NEXTAUTH_SECRET` (signature de session NextAuth.js) et `CALENDSO_ENCRYPTION_KEY` (chiffrement
des données Cal.diy) sont générés automatiquement et stockés en tant que secrets
Secret Manager. Le mot de passe de la base de données est également géré ici. Les
secrets sont injectés dans le service au moment de l'exécution ; le texte clair
n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible via son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
superposé ; les paramètres d'entrée et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Cal.diy {#3-caldiy-application-behaviour}

- **Séquence d'initialisation du premier déploiement.** Trois jobs Cloud Run
  s'exécutent dans l'ordre avant que le service ne serve le trafic :

  | Job | Image | Objectif |
  |---|---|---|
  | `db-init` | `postgres:15-alpine` | Crée la base de données et l'utilisateur PostgreSQL, accorde les privilèges |
  | `db-migrate` | Image de l'application Cal.diy | Exécute `prisma migrate deploy` pour appliquer le schéma complet |
  | `seed-app-store` | Image de l'application Cal.diy | Initialise la table `App` avec les intégrations disponibles |

  Les trois sont idempotents et peuvent être réexécutés en toute sécurité.
  Inspectez leurs exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

- **Assemblage `DATABASE_URL`.** Le script de point d'entrée assemble
  `DATABASE_URL` et `DATABASE_DIRECT_URL` à partir des variables d'environnement
  `DB_*` au démarrage du conteneur, puis lance le serveur Next.js. Cela
  rend la connectivité de la base de données indépendante de la variante d'image
  déployée.

- **Sonde de démarrage.** Les sondes de santé ciblent `/api/auth/session` (HTTP 200
  lorsque NextAuth est prêt). `CalDiy_Common` définit une fenêtre de démarrage
  totale de 6 minutes (`initial_delay=180s`, `failure_threshold=18`, `period=10s`)
  pour accommoder `replace-placeholder.sh` (~2,5 min), `db-migrate` (~60s) et
  `seed-app-store` (~30s) qui s'exécutent au premier démarrage à l'intérieur du
  conteneur `start.sh`.

- **Câblage de l'URL publique.** `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL` sont
  calculés automatiquement à partir de l'URL de service Cloud Run prédite.
  Remplacez les deux dans `environment_variables` lors de l'utilisation d'un domaine
  personnalisé afin que les rappels OAuth et les liens de réservation pointent vers
  le bon hôte.

- **E-mail (SMTP).** Cal.diy utilise SMTP pour les confirmations de réservation, les
  avis d'annulation, les rappels et les réinitialisations de mot de passe. Configurez
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM` dans
  `environment_variables` et stockez `SMTP_PASSWORD` comme référence
  `secret_environment_variables` avant la mise en production.

- **Les rappels nécessitent un appel cron externe.** Les réservations
  fonctionnent sans jobs planifiés, mais cal.com n'envoie les rappels de réservation
  et de Workflow que lorsque quelque chose appelle ses points d'extrémité
  `/api/cron/*` avec la clé partagée `CRON_API_KEY`. Sans clé, ces appels
  sont rejetés (401) et aucun rappel ne se déclenche, alors que l'application semble
  par ailleurs saine. Pour activer les rappels, définissez `cron_api_key` (stocké
  dans Secret Manager) **ET** ajoutez une entrée `cron_jobs` qui appelle le
  point d'extrémité.

- **Lacune de fiabilité du flux planifié (pas de remplacement `cpu_always_allocated`).**
  L'audit `cpu_always_allocated` à l'échelle du dépôt (CLAUDE.md, 2026-07-10 OPEN CAVEAT)
  liste Cal.diy (ainsi qu'Activepieces) comme livrant des composants
  planificateur/travailleur/cron/file d'attente qui par défaut utilisent la
  facturation basée sur les requêtes avec `min_instance_count = 0`, et avertit que si un
  déploiement active les flux *planifiés* de Cal.diy, ces déclencheurs ne se
  déclencheront pas silencieusement tant que le service est mis à l'échelle à zéro —
  la solution documentée étant un remplacement de `cpu_always_allocated = true` + `min_instance_count = 1`
  (le même modèle utilisé pour n8n). **`CalDiy_CloudRun` n'a actuellement aucun moyen
  d'appliquer cette solution** : `cpu_always_allocated` est une variable de la
  Fondation (`App_CloudRun`) qui n'est pas déclarée dans `CalDiy_CloudRun/variables.tf` et
  non transmise dans `main.tf`, elle ne peut donc pas être définie via les
  entrées de ce module. `min_instance_count = 1` seul (déjà exposé) évite la mise à
  l'échelle à zéro, mais laisse la moitié du problème de la limitation du CPU basée
  sur les requêtes sans solution pour tout cas d'utilisation de flux planifié.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour Cal.diy sont listés
; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `caldiy` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Cal.com Scheduling` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `v6.2.0` | Tag de version de l'image Cal.diy — **aucun tag `latest` n'existe**, toujours épingler à une version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build (requis pour Cloud Run — assemble `DATABASE_URL`) ; `prebuilt` déploie directement l'image officielle. |
| `container_image` | `""` | Remplace l'URI de l'image du conteneur. Laisser vide pour utiliser la valeur par défaut. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; augmenter à `4Gi` pour une charge multi-utilisateur en production. |
| `container_port` | `3000` | Port Next.js natif de Cal.diy. Ne pas modifier. |
| `execution_environment` | `gen2` | Gen2 recommandé ; requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale par requête. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Cal.diy dans Artifact Registry. |
| `min_instance_count` | `0` | Instances minimales (0 = mise à l'échelle à zéro). Définir à `1` pour éviter la latence de démarrage à froid en production. |
| `max_instance_count` | `5` | Instances maximales. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. Toutes les entrées doivent totaliser 100. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service : `all`, `internal` ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Squelette SMTP | Paramètres en texte clair. Définir `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM` ici. Définir également `NEXT_PUBLIC_WEBAPP_URL` une fois qu'un domaine personnalisé est connu. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Utiliser pour `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définir `false` après une importation réussie. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global avec Cloud Armor WAF. Requis pour les domaines personnalisés et la protection DDoS. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. Si défini, mettez également à jour `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL`. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. Nécessite `enable_cloud_armor`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket `data` par défaut. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires à provisionner. |
| `enable_nfs` | `false` | NFS n'est pas requis pour Cal.diy. Activer uniquement si un stockage partagé personnalisé est nécessaire (nécessite `gen2`). |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Cal.diy nécessite PostgreSQL. |
| `db_name` | `calcom` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `calcom` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Alias des noms de variables d'environnement à côté des variables `DB_*` standard. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs `db-init`, `db-migrate` et `seed-app-store` intégrés. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. Nécessaire pour les rappels : en ajouter un qui appelle `/api/cron/*` avec `CRON_API_KEY` (voir `cron_api_key`). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/auth/session`, initial_delay=180s, failure_threshold=18 | Fenêtre généreuse pour le premier démarrage `start.sh` (réécriture d'URL + migrations + initialisation). |
| `liveness_probe` | HTTP `/api/auth/session`, initial_delay=60s | Sonde de vivacité après le démarrage. |
| `uptime_check_config` | désactivé, chemin `/api/auth/session` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utiliser Redis pour le cache de session. Recommandé lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point d'extrémité Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'extrémité / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Cal.diy nécessite PostgreSQL avec Prisma ; MySQL ou `NONE` interrompt les migrations de schéma et le démarrage. |
| `container_port` | `3000` | Critique | Le serveur Next.js de Cal.diy écoute sur le port 3000 ; toute autre valeur redirige mal les vérifications de santé et le routage du trafic de Cloud Run. |
| `enable_cloudsql_volume` | `true` | Critique | Cal.diy se connecte via un socket Unix ; la désactivation supprime le socket et toutes les connexions à la base de données échouent. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline les données existantes. |
| `application_version` | version épinglée | Critique | `calcom/cal.diy` n'a pas de tag `latest` ; une version invalide échoue le pull de l'image. |
| `NEXT_PUBLIC_WEBAPP_URL` | correspond à l'URL publique | Critique | Cal.diy l'intègre dans les morceaux statiques de Next.js via `replace-placeholder.sh` ; une non-concordance interrompt les rappels OAuth et les liens de réservation. |
| `NEXTAUTH_URL` | correspond à l'URL publique | Critique | NextAuth valide les URI de redirection OAuth par rapport à cela ; une non-concordance bloque toutes les connexions. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation et peut écraser les données en direct lors des applications ultérieures. |
| `startup_probe.initial_delay_seconds` | `180` (via CalDiy_Common) | Élevé | Cal.diy `start.sh` exécute la réécriture d'URL (~2,5 min) + les migrations Prisma + l'initialisation avant de servir les requêtes ; une fenêtre trop courte provoque une boucle de redémarrage. |
| `startup_probe.failure_threshold` | `18` à `period=10s` | Élevé | Donne ~6 minutes au total ; réduire en dessous de 12 tue le conteneur avant que l'initialisation ne soit terminée. |
| `container_image_source` | `custom` | Élevé | Cloud Run nécessite l'image wrapper qui assemble `DATABASE_URL` ; l'utilisation de `prebuilt` sans le point d'entrée du wrapper laisse `DATABASE_URL` non défini et toutes les requêtes à la base de données échouent. |
| `memory_limit` | `2Gi` minimum | Élevé | Le démarrage de Cal.diy (réécriture d'URL + migrations) nécessite ≥ 2 GiB ; OOM tue avant que l'application ne soit prête. |
| `enable_redis` | `true` pour multi-instance | Élevé | Sans Redis, les sessions sont par instance ; les utilisateurs sont déconnectés lorsque la mise à l'échelle à zéro ou la rotation d'instance se produit. |
| `redis_host` | requis lorsque `enable_redis=true` | Élevé | Un `redis_host` vide avec Redis activé injecte une URL mal formée ; les opérations de session échouent au moment de l'exécution. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro est la valeur par défaut ; le démarrage à froid de Cal.diy de 4 à 5 minutes ajoute une latence inacceptable pour la planification en production. |
| flux planifiés/cron | non pris en charge sans modification du module | Moyen | Selon l'audit `cpu_always_allocated` de CLAUDE.md (2026-07-10 OPEN CAVEAT), les composants planificateur/travailleur/cron/file d'attente de Cal.diy ont besoin de `cpu_always_allocated = true` pour se déclencher de manière fiable lorsqu'ils sont mis à l'échelle à zéro — mais ce module ne déclare ni ne transmet cette variable de la Fondation, elle ne peut donc pas être définie aujourd'hui. |
| `SMTP_HOST` / `EMAIL_FROM` | configuration SMTP réelle | Moyen | Sans SMTP valide, les confirmations de réservation, les rappels et les réinitialisations de mot de passe ne sont jamais livrés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Moyen | Si vous utilisez Memorystore Redis, son IP privée peut ne pas se trouver dans les plages VPC par défaut ; passez à `ALL_TRAFFIC` ou assurez-vous d'un routage VPC correct. |
| `organization_id` | défini explicitement pour VPC-SC | Moyen | Le périmètre VPC-SC n'est activé que lorsque `organization_id` est défini ; `enable_vpc_sc = true` seul n'a aucun effet. |
| `execution_environment` | `gen2` | Moyen | `gen1` ne prend pas en charge les montages NFS ; si `enable_nfs = true`, `gen2` est requis. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
Cal.diy partagée avec la variante GKE est décrite dans
**[CalDiy_Common](CalDiy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : CalDiy sur Cloud Run](../labs/CalDiy_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cal.diy sur GKE Autopilot](CalDiy_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [CalDiy_Common — Configuration d'application partagée](CalDiy_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Monica sur Google Cloud Run](Monica_CloudRun.md), [Radicale sur Google Cloud Run](Radicale_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Organiseur Personnel**.
