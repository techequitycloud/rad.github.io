---
title: "Cal.diy sur Google Cloud Run"
description: "Référence de configuration pour déployer Cal.diy sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CalDiy_CloudRun.md @ 3055034 sha256:51d0b002d17f -->

# Cal.diy sur Google Cloud Run {#caldiy-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalDiy_CloudRun.png" alt="Cal.diy sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.diy est le fork sous licence MIT et auto-hébergeable de Cal.com — la plateforme
de planification open source utilisée par des millions de personnes dans le monde
pour en finir avec les allers-retours de coordination des réunions.
Ce module déploie Cal.diy sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Cal.diy et sur la manière
de les explorer et de les exploiter depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cal.diy s'exécute sous la forme d'un conteneur Next.js (Node.js) sur Cloud Run v2.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 2 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Cal.diy utilise l'ORM Prisma ciblant PostgreSQL |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné par défaut |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` générés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Sélectionner MySQL ou `NONE` empêche le démarrage.
- **La mise à l'échelle jusqu'à zéro est le comportement par défaut** (`min_instance_count = 0`).
  Le premier démarrage de Cal.diy prend 4 à 5 minutes ; définissez
  `min_instance_count = 1` en production pour éviter la latence de démarrage à froid.
- **Une image wrapper personnalisée est construite par défaut.** `CalDiy_Common` définit
  toujours `image_source = "custom"` et fournit un Dockerfile. Le point d'entrée assemble
  `DATABASE_URL` à partir des variables d'environnement `DB_*` injectées par la plateforme,
  ce qui rend la connexion robuste quelle que soit la version de l'image déployée.
- **Trois jobs d'initialisation s'exécutent au premier déploiement :** `db-init`
  (configuration de PostgreSQL), `db-migrate` (migrations de schéma Prisma) et
  `seed-app-store` (alimente la table de l'app store de Cal.diy). Tous sont idempotents.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY`** sont générés automatiquement et
  stockés dans Secret Manager ; vous ne les définissez jamais en clair.
- **`NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL`** sont calculés automatiquement à partir
  de l'URL prévue du service Cloud Run. Remplacez-les via `environment_variables` si vous
  utilisez un domaine personnalisé.
- **`calcom/cal.diy` n'a pas de tag `latest`** — épinglez toujours `application_version`
  sur une version publiée (par exemple `v6.2.0`).
- **Redis est désactivé par défaut.** Les sessions NextAuth.js sont stockées dans
  PostgreSQL. Activez Redis pour les déploiements multi-instances à forte concurrence.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Cal.diy {#a-cloud-run--the-caldiy-service}

Cal.diy s'exécute sous la forme d'un service Cloud Run v2 qui s'adapte automatiquement
à la charge des requêtes entre le nombre minimal et le nombre maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.diy stocke toutes les données applicatives (réservations, utilisateurs, plannings,
intégrations) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service se
connecte de façon privée via le **Cloud SQL Auth Proxy** sur un socket Unix (aucune IP
publique). Au premier déploiement, une séquence de Cloud Run Jobs crée la base de
données et l'utilisateur, exécute les migrations de schéma Prisma et alimente l'app store.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket Cloud Storage par défaut (suffixe `data`) est provisionné et le compte de
service y reçoit automatiquement l'accès. Cal.diy ne nécessite pas de stockage NFS
partagé par défaut — la base de données stocke tout l'état des réservations.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

`NEXTAUTH_SECRET` (signature des sessions NextAuth.js) et `CALENDSO_ENCRYPTION_KEY`
(chiffrement des données Cal.diy) sont générés automatiquement et stockés sous forme
de secrets Secret Manager. Le mot de passe de la base de données est également géré
ici. Les secrets sont injectés dans le service à l'exécution ; le texte en clair
n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Cal.diy {#3-caldiy-application-behaviour}

- **Séquence d'initialisation au premier déploiement.** Trois Cloud Run Jobs
  s'exécutent dans l'ordre avant que le service ne reçoive du trafic :

  | Job | Image | Objectif |
  |---|---|---|
  | `db-init` | `postgres:15-alpine` | Crée la base de données PostgreSQL et l'utilisateur, accorde les privilèges |
  | `db-migrate` | Image de l'application Cal.diy | Exécute `prisma migrate deploy` pour appliquer le schéma complet |
  | `seed-app-store` | Image de l'application Cal.diy | Alimente la table `App` avec les intégrations disponibles |

  Les trois sont idempotents et peuvent être réexécutés sans risque. Inspectez leurs
  exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

- **Assemblage de `DATABASE_URL`.** Le script de point d'entrée assemble `DATABASE_URL`
  et `DATABASE_DIRECT_URL` à partir des variables d'environnement `DB_*` au démarrage
  du conteneur, puis lance le serveur Next.js. La connectivité à la base de données
  devient ainsi indépendante de la variante d'image déployée.

- **Sonde de démarrage.** Les sondes de santé ciblent `/api/auth/session` (HTTP 200
  lorsque NextAuth est prêt). `CalDiy_Common` définit une fenêtre de démarrage totale
  de 6 minutes (`initial_delay=180s`, `failure_threshold=18`, `period=10s`) pour
  laisser le temps à `replace-placeholder.sh` (~2,5 min), `db-migrate` (~60s) et
  `seed-app-store` (~30s), qui s'exécutent au premier démarrage dans le `start.sh` du
  conteneur.

- **Câblage de l'URL publique.** `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL` sont
  calculés automatiquement à partir de l'URL prévue du service Cloud Run. Remplacez-les
  tous deux dans `environment_variables` si vous utilisez un domaine personnalisé, afin
  que les callbacks OAuth et les liens de réservation pointent vers le bon hôte.

- **E-mail (SMTP).** Cal.diy utilise SMTP pour les confirmations de réservation, les
  avis d'annulation, les rappels et les réinitialisations de mot de passe. Configurez
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM` dans `environment_variables` et
  stockez `SMTP_PASSWORD` sous forme de référence `secret_environment_variables` avant
  la mise en production.

- **Aucune tâche planifiée requise.** Cal.diy ne nécessite pas de jobs d'arrière-plan
  planifiés séparément — les réservations et les rappels sont gérés par les routes API
  de Next.js.

- **Lacune de fiabilité des flux planifiés (pas de surcharge de `cpu_always_allocated`).**
  L'audit `cpu_always_allocated` à l'échelle du dépôt (CLAUDE.md, 2026-07-10 OPEN
  CAVEAT) cite Cal.diy (aux côtés d'Activepieces) comme livrant des composants
  planificateur/worker/cron/file d'attente dont la facturation par défaut est basée sur
  les requêtes avec `min_instance_count = 0`, et avertit que si un déploiement active
  les flux *planifiés* de Cal.diy, ces déclencheurs ne se déclencheront pas, sans aucun
  signal, tant que le service est réduit à zéro — le correctif documenté étant de
  passer à `cpu_always_allocated = true` + `min_instance_count = 1` (le même schéma que
  pour n8n). **`CalDiy_CloudRun` ne permet actuellement pas d'appliquer ce correctif** :
  `cpu_always_allocated` est une variable du socle (`App_CloudRun`) qui n'est ni
  déclarée dans `CalDiy_CloudRun/variables.tf` ni transmise dans `main.tf`, si bien
  qu'elle ne peut pas être définie via les entrées de ce module. `min_instance_count = 1`
  seul (déjà exposé) évite la mise à l'échelle jusqu'à zéro, mais laisse non traitée la
  moitié du problème liée à la limitation du CPU basée sur les requêtes pour tout cas
  d'usage de flux planifié.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Cal.diy ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `caldiy` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Cal.com Scheduling` | Nom convivial affiché dans la Console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `v6.2.0` | Tag de version de l'image Cal.diy — **aucun tag `latest` n'existe**, épinglez toujours une version publiée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build (obligatoire pour Cloud Run — assemble `DATABASE_URL`) ; `prebuilt` déploie directement l'image officielle. |
| `container_image` | `""` | Remplace l'URI de l'image de conteneur. Laissez vide pour utiliser la valeur par défaut. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; passez à `4Gi` pour une charge multi-utilisateur en production. |
| `container_port` | `3000` | Port Next.js natif de Cal.diy. Ne le modifiez pas. |
| `execution_environment` | `gen2` | Gen2 recommandé ; obligatoire pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale par requête. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Cal.diy dans Artifact Registry. |
| `min_instance_count` | `0` | Nombre minimal d'instances (0 = mise à l'échelle jusqu'à zéro). Définissez `1` pour éviter la latence de démarrage à froid en production. |
| `max_instance_count` | `5` | Nombre maximal d'instances. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. La somme de toutes les entrées doit être égale à 100. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service : `all`, `internal` ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Squelette SMTP | Paramètres en texte clair. Définissez ici `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM`. Définissez aussi `NEXT_PUBLIC_WEBAPP_URL` une fois le domaine personnalisé connu. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. À utiliser pour `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. Définissez `false` après une importation réussie. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global avec le WAF Cloud Armor. Obligatoire pour les domaines personnalisés et la protection DDoS. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. S'ils sont définis, mettez aussi à jour `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL`. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. Nécessite `enable_cloud_armor`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `data` par défaut. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires à provisionner. |
| `enable_nfs` | `false` | NFS n'est pas nécessaire pour Cal.diy. Activez-le uniquement si un stockage partagé personnalisé est requis (nécessite `gen2`). |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas. Cal.diy nécessite PostgreSQL. |
| `db_name` | `calcom` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `calcom` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement alias en plus des variables `DB_*` standard. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init`, `db-migrate` et `seed-app-store`. |
| `cron_jobs` | `[]` | Cloud Run Jobs récurrents déclenchés par Cloud Scheduler. Cal.diy ne nécessite pas de tâches planifiées par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/auth/session`, initial_delay=180s, failure_threshold=18 | Fenêtre généreuse pour le `start.sh` du premier démarrage (réécriture d'URL + migrations + alimentation initiale). |
| `liveness_probe` | HTTP `/api/auth/session`, initial_delay=60s | Sonde de vivacité après le démarrage. |
| `uptime_check_config` | désactivé, chemin `/api/auth/session` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utilise Redis pour la mise en cache des sessions. Recommandé lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Obligatoire lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (s'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Cal.diy nécessite PostgreSQL avec Prisma ; MySQL ou `NONE` font échouer les migrations de schéma et le démarrage. |
| `container_port` | `3000` | Critique | Le serveur Next.js de Cal.diy écoute sur le port 3000 ; toute autre valeur fausse les contrôles de santé de Cloud Run et le routage du trafic. |
| `enable_cloudsql_volume` | `true` | Critique | Cal.diy se connecte via un socket Unix ; le désactiver supprime le socket et toutes les connexions à la base de données échouent. |
| `db_name` / `db_user` | définis une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données ou l'utilisateur et rend orphelines les données existantes. |
| `application_version` | version publiée épinglée | Critique | `calcom/cal.diy` n'a pas de tag `latest` ; une version invalide fait échouer l'extraction de l'image. |
| `NEXT_PUBLIC_WEBAPP_URL` | identique à l'URL publique | Critique | Cal.diy intègre cette valeur dans les blocs statiques Next.js via `replace-placeholder.sh` ; une discordance casse les callbacks OAuth et les liens de réservation. |
| `NEXTAUTH_URL` | identique à l'URL publique | Critique | NextAuth valide les URI de redirection OAuth par rapport à cette valeur ; une discordance bloque toutes les connexions. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'importation et peut écraser des données en production lors des applications suivantes. |
| `startup_probe.initial_delay_seconds` | `180` (via CalDiy_Common) | Élevé | Le `start.sh` de Cal.diy exécute la réécriture d'URL (~2,5 min) + les migrations Prisma + l'alimentation initiale avant de servir les requêtes ; une fenêtre trop courte provoque une boucle de redémarrage. |
| `startup_probe.failure_threshold` | `18` à `period=10s` | Élevé | Donne environ 6 minutes au total ; descendre sous 12 tue le conteneur avant la fin de l'initialisation. |
| `container_image_source` | `custom` | Élevé | Cloud Run nécessite l'image wrapper qui assemble `DATABASE_URL` ; utiliser `prebuilt` sans le point d'entrée du wrapper laisse `DATABASE_URL` non défini et toutes les requêtes à la base de données échouent. |
| `memory_limit` | `2Gi` minimum | Élevé | Le démarrage de Cal.diy (réécriture d'URL + migrations) nécessite ≥ 2 GiB ; des arrêts OOM surviennent avant que l'application ne soit prête. |
| `enable_redis` | `true` en multi-instance | Élevé | Sans Redis, les sessions sont propres à chaque instance ; les utilisateurs sont déconnectés lors d'une mise à l'échelle jusqu'à zéro ou d'une rotation d'instances. |
| `redis_host` | obligatoire lorsque `enable_redis=true` | Élevé | Un `redis_host` vide avec Redis activé injecte une URL malformée ; les opérations de session échouent à l'exécution. |
| `min_instance_count` | `1` en production | Moyen | La mise à l'échelle jusqu'à zéro est le comportement par défaut ; le démarrage à froid de 4 à 5 minutes de Cal.diy ajoute une latence inacceptable pour la planification en production. |
| flux planifiés / pilotés par cron | non pris en charge sans modification du module | Moyen | Selon l'audit `cpu_always_allocated` de CLAUDE.md (2026-07-10 OPEN CAVEAT), les composants planificateur/worker/cron/file d'attente de Cal.diy nécessitent `cpu_always_allocated = true` pour se déclencher de façon fiable lorsqu'ils sont réduits à zéro — mais ce module ne déclare ni ne transmet cette variable du socle, elle ne peut donc pas être définie aujourd'hui. |
| `SMTP_HOST` / `EMAIL_FROM` | configuration SMTP réelle | Moyen | Sans SMTP valide, les confirmations de réservation, les rappels et les réinitialisations de mot de passe ne sont jamais envoyés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Moyen | Si vous utilisez Memorystore Redis, son IP privée peut ne pas figurer dans les plages VPC par défaut ; passez à `ALL_TRAFFIC` ou assurez un routage VPC correct. |
| `organization_id` | défini explicitement pour VPC-SC | Moyen | Le périmètre VPC-SC n'est activé que lorsque `organization_id` est défini ; `enable_vpc_sc = true` seul n'a aucun effet. |
| `execution_environment` | `gen2` | Moyen | `gen1` ne prend pas en charge les montages NFS ; si `enable_nfs = true`, `gen2` est obligatoire. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Cal.diy partagée avec la variante GKE est décrite dans
**[CalDiy_Common](CalDiy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : CalDiy sur Cloud Run](../labs/CalDiy_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Cal.diy sur GKE Autopilot](CalDiy_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [CalDiy_Common — Configuration applicative partagée](CalDiy_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Monica sur Google Cloud Run](Monica_CloudRun.md), [Radicale sur Google Cloud Run](Radicale_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Personal Organiser**.
