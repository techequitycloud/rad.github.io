---
title: "Mautic sur Google Cloud Run"
description: "Référence de configuration pour déployer Mautic sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Mautic_CloudRun.md @ 3055034 sha256:1bbe220ba042 -->

# Mautic sur Google Cloud Run {#mautic-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mautic_CloudRun.png" alt="Mautic sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mautic est une plateforme open source d'automatisation marketing pour les campagnes
d'e-mailing, la gestion des contacts, les pages d'atterrissage et la notation des
prospects. Ce module déploie Mautic sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Mautic et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) : ils ne sont pas répétés ici.

---

## 1. Vue d'ensemble {#1-overview}

Mautic s'exécute sous forme de conteneur PHP/Apache sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 2 vCPU / 4 GiB par défaut, autoscaling selon les requêtes (mise à l'échelle à zéro) |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Mautic ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Médias téléversés partagés entre toutes les instances (montés dans le service) |
| Stockage objet | Cloud Storage | Un bucket dédié aux médias |
| Cache et sessions | Redis | Activé par défaut |
| Secrets | Secret Manager | Mot de passe administrateur et mot de passe de la base de données générés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Choisir PostgreSQL ou `NONE` empêche le démarrage.
- **Les sondes sont détournées de la page de connexion.** Apache émet une redirection
  301 HTTP→HTTPS dès que `HTTPS=on`/`MAUTIC_SITE_URL` sont définis, ce qui fait échouer
  une sonde de type HTTP ciblant `/index.php/s/login`. Le module remplace la sonde de
  démarrage par une sonde **TCP** (vérification de port ouvert, délai initial de 60s) et
  la sonde de vivacité par une sonde **HTTP `/healthz`** (un fichier statique qu'Apache
  sert sans redirection, délai initial de 120s).
- **`HTTPS=on` et une URL de service prédite sont injectés** afin que Mautic génère des
  liens absolus corrects et évite les boucles de redirection HTTP→HTTPS derrière le
  frontal de Cloud Run (les mêmes redirections que les remplacements de sonde
  TCP/`/healthz` ci-dessus permettent de contourner).
- **Démarrage à froid par défaut.** `min_instance_count = 0` et `cpu_always_allocated =
  false` (facturation à la requête) : l'interface et le suivi des contacts fonctionnent
  à la demande ; le cron marketing est externalisé sous forme de Cloud Run Jobs
  planifiés (§3). Définissez `cpu_always_allocated = true` et `min_instance_count >= 1`
  pour rétablir un fonctionnement continu dans le processus.
- **Les migrations de la base de données s'exécutent à chaque démarrage d'instance**
  (de façon idempotente), de sorte que les montées de version s'appliquent automatiquement.
- Le **mot de passe administrateur** de Mautic est généré et stocké dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Mautic {#a-cloud-run--the-mautic-service}

Mautic s'exécute sous forme de service Cloud Run v2 qui s'adapte automatiquement à la
charge de requêtes entre les nombres minimal et maximal d'instances. Chaque déploiement
crée une révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mautic stocke toutes les données de l'application dans une instance gérée Cloud SQL for
MySQL 8.0. Le service s'y connecte de manière privée via le **Cloud SQL Auth Proxy**
sur un socket Unix (sans IP publique). Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléversés sont écrits sur un partage **Filestore (NFS)** monté dans le
service, de sorte que toutes les instances partagent les mêmes fichiers. Un bucket
**Cloud Storage** dédié est également provisionné pour les médias.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache de Mautic et la cohérence des sessions entre les instances.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Mautic et le mot de passe de la base de données sont
stockés dans Secret Manager et injectés dans le service à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les
paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run
et de Cloud SQL sont envoyées à Cloud Monitoring, avec des contrôles de disponibilité
et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Mautic {#3-mautic-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation crée la base de données et l'utilisateur de Mautic avant le
  démarrage du service. Il est idempotent.
- **Migrations au démarrage.** Chaque instance exécute les migrations de Mautic au
  démarrage, de sorte qu'une montée de version applique automatiquement les
  modifications de schéma.
- **Commandes planifiées (essentielles).** Les campagnes, la file d'envoi des e-mails et
  la mise à jour des segments de Mautic reposent sur des commandes planifiées ; sans
  elles, aucune campagne ne se déclenche et aucun e-mail n'est envoyé. Elles
  s'exécutent sous forme de Cloud Run Jobs appelés selon une planification. Les
  commandes :

  | Commande | Rôle | Fréquence type |
  |---|---|---|
  | `mautic:segments:update` | Actualise l'appartenance aux segments | toutes les 15 min |
  | `mautic:campaigns:trigger` | Déclenche les événements de campagne planifiés | toutes les 15 min |
  | `mautic:campaigns:messages` | Envoie les messages de campagne en file d'attente | toutes les 15 min |
  | `mautic:queue:process` | Traite la file d'envoi des e-mails | toutes les 5 min |
  | `mautic:maintenance:cleanup` | Purge les anciennes données | chaque semaine |

  Inspectez les jobs et leurs exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Gestion de HTTPS.** `HTTPS=on` et l'URL de service prédite sont définis afin que
  Mautic produise des URL absolues correctes et évite les boucles de redirection
  derrière Cloud Run.
- **Connexion administrateur.** Le nom d'utilisateur et l'adresse e-mail de
  l'administrateur initial sont configurables ; le mot de passe se récupère dans
  Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Mautic ou notables pour lui sont listés ;
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
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mautic` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Mautic` | Nom convivial affiché dans la console. |
| `application_description` | `Mautic - Open-source marketing automation platform` | Description du service. |
| `application_version` | `5` | Tag de version de l'image Mautic. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Mise à l'échelle à zéro par défaut ; définissez ≥ 1 (avec `cpu_always_allocated = true`) pour un travail continu dans le processus. |
| `max_instance_count` | `3` | Nombre maximal d'instances. |
| `cpu_always_allocated` | `false` | Facturation à la requête (démarrage à froid). Définissez `true` + `min_instance_count >= 1` pour exécuter en continu le cron de Mautic dans le processus. |
| `container_port` | `80` | Mautic/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `execution_environment` | `gen2` | Génération de l'environnement d'exécution Cloud Run. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |

### Groupe 5 — Contrôle de l'accès et de l'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service (all / internal / LB-only). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs `MAUTIC_*` principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles à stocker et à injecter en tant que secrets. |
| `secret_propagation_delay` / `secret_rotation_period` | _(définie)_ | Délai d'attente de réplication / fréquence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatisées (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(définie)_ | Instance NFS existante / nom de base d'une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définie)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias de Mautic. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(définie)_ | Bucket des médias / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne le modifiez pas. |
| `application_database_name` | `mautic` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mautic` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(définie)_ | Noms sous lesquels les informations de connexion sont injectées. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré de configuration de la base de données. |
| `cron_jobs` | `[]` | **Configurez les commandes planifiées de Mautic décrites au §3** — indispensables aux campagnes et aux e-mails. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | Remplacée par TCP (vérification de port ouvert), délai initial de 60s | Sonde de démarrage — TCP évite la redirection 301 HTTP→HTTPS d'Apache qui fait échouer une sonde HTTP. |
| `liveness_probe` / `health_check_config` | Remplacée par HTTP `/healthz`, délai initial de 120s | Sonde de vivacité — `/healthz` est un fichier statique servi sans redirection. |
| `uptime_check_config` | désactivé (`enabled = false`, chemin `/`) | Contrôle de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour le cache et les sessions. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définie)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

### Groupe 23 — Paramètres de l'application Mautic {#group-23--mautic-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mautic_admin_username` | `admin` | Identifiant de l'administrateur initial. |
| `mautic_admin_email` | `admin@example.com` | Adresse e-mail de l'administrateur — **indiquez une adresse réelle**. |
| `mailer_from_name` | `Mautic` | Nom affiché sur les e-mails de campagne sortants. |
| `mailer_from_email` | `mautic@example.com` | Adresse d'expédition — **utilisez un domaine doté d'enregistrements SPF/DKIM valides**. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsque le déploiement réussit — c'est le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, contrôles de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (critique : perte de données / panne / sécurité) — **High** (élevé : service dégradé) —
> **Medium** (moyen : coût ou dégradation partielle) — **Low** (faible : mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Mautic nécessite MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `cron_jobs` | configurés (§3) | Critical | Sans les commandes planifiées, aucune campagne ne se déclenche et aucun e-mail n'est envoyé. |
| `enable_nfs` | `true` | Critical | Sans stockage partagé, les fichiers téléversés sont perdus entre les instances ou lors des redémarrages. |
| `application_database_name` / `_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `startup_probe` | TCP, pas HTTP (valeur par défaut du module) | High | Une sonde HTTP ciblant `/index.php/s/login` échoue : Apache redirige en 301 les contrôles de santé en HTTP simple de Cloud Run dès que `HTTPS=on` est défini, si bien que la sonde ne reçoit jamais de 200. Le module remplace `startup_probe` par TCP et `liveness_probe` par HTTP `/healthz` pour l'éviter. |
| `enable_redis` | `true` | High | Plusieurs instances avec des caches isolés provoquent des incohérences. |
| `memory_limit` | ≥ `2Gi` | High | Une mémoire insuffisante provoque des OOM PHP pendant les imports et les envois. |
| `mautic_admin_email` / `mailer_from_email` | adresses réelles | High | Les valeurs d'exemple n'aboutissent nulle part et sont rejetées ou classées en spam. |
| `min_instance_count` | `0` (par défaut) ou `1` pour un service toujours actif | Medium | `0` ajoute une latence de démarrage à froid sur la première requête après une période d'inactivité ; les commandes planifiées s'exécutent en tant que Cloud Run Jobs distincts et ne sont pas affectées. |
| `enable_iap` / `enable_cloud_armor` | à activer pour l'accès d'administration | Medium | Sinon, l'interface d'administration est accessible publiquement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et réplication d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Mautic
partagée avec la variante GKE est décrite dans **[Mautic_Common](Mautic_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mautic sur Cloud Run](../labs/Mautic_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mautic sur GKE Autopilot](Mautic_GKE.md) — la même application sur Kubernetes, si vous avez besoin de l'autre cible de déploiement.
- [Mautic Common — Configuration applicative partagée](Mautic_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md) et [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) dans la solution **Marketing Automation Suite**.
