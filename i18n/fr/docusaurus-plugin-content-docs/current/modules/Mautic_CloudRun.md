---
title: "Mautic sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Mautic sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mautic_CloudRun.md @ 15fd4c7 sha256:4550fcc79d40 -->

# Mautic sur Google Cloud Run {#mautic-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mautic_CloudRun.png" alt="Mautic sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mautic est une plateforme open source d'automatisation du marketing pour les
campagnes e-mail, la gestion des contacts, les pages de destination et la
notation des prospects. Ce module déploie Mautic sur **Cloud Run v2** en se
basant sur la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Mautic et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Mautic s'exécute en tant que conteneur PHP/Apache sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 2 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes (mise à l'échelle à zéro) |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Mautic ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Médias téléchargés partagés entre toutes les instances (montés dans le service) |
| Stockage d'objets | Cloud Storage | Un bucket média dédié |
| Cache et sessions | Redis | Activé par défaut |
| Secrets | Secret Manager | Mot de passe administrateur et mot de passe de base de données générés automatiquement |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app`, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** La sélection de PostgreSQL ou `NONE`
  empêche le démarrage.
- **Les sondes sont remplacées pour ne pas pointer vers la page de
  connexion.** Apache émet une redirection 301 HTTP→HTTPS une fois que `HTTPS=on`/`MAUTIC_SITE_URL` sont définis, ce qui interrompt une sonde de type HTTP
  vers `/index.php/s/login`. Le module remplace la sonde de démarrage par **TCP**
  (vérification de l'ouverture du port, délai initial de 60s) et la sonde de
  vivacité par **HTTP `/healthz`** (un fichier statique servi par Apache sans
  redirection, délai initial de 120s).
- **`HTTPS=on` et une URL de service prédite sont injectées** afin que Mautic
  génère des liens absolus corrects et évite les boucles de redirection
  HTTP→HTTPS derrière le frontal Cloud Run (les mêmes redirections que les
  sondes TCP/`/healthz` ci-dessus sont conçues pour contourner).
- **Démarrage à froid par défaut.** `min_instance_count = 0` et `cpu_always_allocated =
  false` (facturation basée sur les requêtes) : l'interface utilisateur et le
  suivi des contacts fonctionnent à la demande ; les commandes marketing
  s'exécutent en tant que Jobs Cloud Run planifiés distincts (§3), de sorte que
  la mise à l'échelle à zéro ne les arrête pas.
- **Les migrations de base de données s'exécutent à chaque démarrage
  d'instance** (idempotent), de sorte que les mises à niveau de version
  s'appliquent automatiquement.
- Le **mot de passe administrateur** de Mautic est généré et stocké dans
  Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de service et de ressource sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Mautic {#a-cloud-run--the-mautic-service}

Mautic s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimum et
maximum d'instances. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mautic stocke toutes les données d'application dans une instance Cloud SQL
gérée pour MySQL 8.0. Le service se connecte en privé via le **proxy
d'authentification Cloud SQL** sur un socket Unix (pas d'IP publique). Lors du
premier déploiement, un Job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits sur un partage **Filestore (NFS)** monté
dans le service afin que toutes les instances partagent les mêmes fichiers. Un
bucket **Cloud Storage** `media` est également provisionné, mais rien ne le
monte ou n'y écrit — il est conservé uniquement parce que le supprimer d'un
déploiement existant déclenche un cycle de dépendance Terraform.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la mise en cache et la cohérence des sessions de Mautic
entre les instances.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Mautic et le mot de passe de la base de
données sont stockés dans Secret Manager et injectés dans le service au moment
de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être ajouté ; les paramètres d'ingress et de contrôle d'egress VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Mautic {#3-mautic-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation crée la base de données et l'utilisateur Mautic avant le
  démarrage du service. Il est idempotent.
- **Migrations au démarrage.** Chaque instance exécute les migrations de
  Mautic au démarrage, de sorte que la mise à niveau de la version applique
  automatiquement les modifications de schéma.
- **Commandes planifiées (essentielles).** Les campagnes, la file d'attente
  d'e-mails et les mises à jour de segments de Mautic sont pilotées par des
  commandes planifiées ; sans elles, les campagnes ne se déclenchent jamais et
  aucun e-mail n'est envoyé. Mautic n'a pas de planificateur intégré, elles
  s'exécutent donc en tant que Jobs Cloud Run planifiés :

  | Commande | Objectif | Cadence |
  |---|---|---|
  | `mautic:segments:update` | Actualiser l'appartenance aux segments | toutes les 15 min (`:00`, `:15`, …) |
  | `mautic:campaigns:update` | Reconstruire l'appartenance aux campagnes | toutes les 15 min (`:05`, `:20`, …) |
  | `mautic:campaigns:trigger` | Déclencher les événements de campagne planifiés | toutes les 15 min (`:10`, `:25`, …) |

  Ces trois commandes sont planifiées par le module lui-même, décalées pour
  qu'elles ne se chevauchent jamais, et exécutées via `mautic-cron.sh` (qui mappe les
  paramètres de la base de données comme le fait le conteneur web et attend le
  proxy Cloud SQL). Tout ce que Mautic offre d'autre — par exemple `mautic:queue:process` si
  vous mettez en file d'attente des e-mails, ou `mautic:maintenance:cleanup` — est ajouté via
  `cron_jobs`, qui est ajouté aux trois commandes intégrées.

  Inspectez les jobs et leurs exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Gestion HTTPS.** `HTTPS=on` et l'URL de service prédite sont définies afin
  que Mautic produise des URL absolues correctes et évite les boucles de
  redirection derrière Cloud Run.
- **Connexion administrateur.** Le nom d'utilisateur et l'e-mail de
  l'administrateur initial sont configurables ; le mot de passe est récupéré
  de Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Mautic sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mautic` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Mautic` | Nom convivial affiché dans la console. |
| `application_description` | `Mautic - Open-source marketing automation platform` | Description du service. |
| `application_version` | `5` | Tag de version de l'image Mautic. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | Instances minimales. Mise à l'échelle à zéro par défaut ; définir ≥ 1 (avec `cpu_always_allocated = true`) pour un travail continu en cours de traitement. |
| `max_instance_count` | `3` | Instances maximales. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes (démarrage à froid). Mautic n'exécute pas de planificateur intégré ; ses commandes sont des Jobs Cloud Run planifiés (§3). |
| `container_port` | `80` | Mautic/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions socket. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (tous / interne / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs de base `MAUTIC_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles à stocker et à injecter en tant que secrets. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Mautic. |
| `nfs_mount_path` | `/var/www/html/docroot/media/files` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket média / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. |
| `application_database_name` | `mautic` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mautic` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job de configuration de base de données intégré. |
| `cron_jobs` | `[]` | Jobs planifiés supplémentaires, ajoutés aux trois commandes Mautic que le module planifie lui-même (§3). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | Remplacé par TCP (vérification de l'ouverture du port), délai initial de 60s | Sonde de démarrage — TCP évite la redirection 301 HTTP→HTTPS d'Apache qui interrompt une sonde HTTP. |
| `liveness_probe` / `health_check_config` | Remplacé par HTTP `/healthz`, délai initial de 120s | Sonde de vivacité — `/healthz` est un fichier statique servi sans redirection. |
| `uptime_check_config` | désactivé (`enabled = false`, chemin `/`) | Vérification de disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache/sessions. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

### Groupe 23 — Paramètres de l'application Mautic {#group-23--mautic-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mautic_admin_username` | `admin` | Connexion administrateur initiale. |
| `mautic_admin_email` | `admin@example.com` | E-mail administrateur — **définir une adresse réelle**. |
| `mailer_from_name` | `Mautic` | Nom d'affichage sur les e-mails de campagne sortants. |
| `mailer_from_email` | `mautic@example.com` | Adresse d'expéditeur — **utiliser un domaine avec SPF/DKIM valide**. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à la phase (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Mautic nécessite MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| Commandes planifiées intégrées (§3) | laisser en place | Critique | Aucune campagne ne se déclenche sans elles ; ajouter le traitement de la file d'attente d'e-mails via `cron_jobs` si vous mettez en file d'attente des e-mails. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les téléchargements sont perdus entre les instances/redémarrages. |
| `application_database_name` / `_user` | définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `startup_probe` | TCP, pas HTTP (valeur par défaut du module) | Élevé | Une sonde HTTP vers `/index.php/s/login` échoue : Apache redirige en 301 les vérifications de santé HTTP simples de Cloud Run une fois `HTTPS=on` défini, de sorte que la sonde ne voit jamais un 200. Le module remplace `startup_probe` par TCP et `liveness_probe` par HTTP `/healthz` pour éviter cela. |
| `enable_redis` | `true` | Élevé | Plusieurs instances avec des caches isolés entraînent une incohérence. |
| `memory_limit` | ≥ `2Gi` | Élevé | Trop peu de mémoire provoque un OOM PHP lors des importations/envois. |
| `mautic_admin_email` / `mailer_from_email` | adresses réelles | Élevé | Les espaces réservés envoient à nulle part et sont rejetés/classés comme spam. |
| `min_instance_count` | `0` (par défaut) ou `1` pour toujours actif | Moyen | `0` ajoute une latence de démarrage à froid lors de la première requête après l'inactivité ; les commandes planifiées s'exécutent en tant que Jobs Cloud Run distincts et ne sont pas affectées. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface utilisateur d'administration est autrement accessible publiquement. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Mautic partagée avec la variante GKE est décrite
dans **[Mautic_Common](Mautic_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mautic sur Cloud Run](../labs/Mautic_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mautic sur GKE Autopilot](Mautic_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Mautic Common — Configuration d'application partagée](Mautic_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md), [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) dans la solution **Marketing Automation Suite**.
