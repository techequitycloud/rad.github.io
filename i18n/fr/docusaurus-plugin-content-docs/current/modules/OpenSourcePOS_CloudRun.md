---
title: "OpenSourcePOS sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Open Source POS sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenSourcePOS_CloudRun.md @ a4095cd sha256:ba239a96c31f -->

# OpenSourcePOS sur Google Cloud Run {#opensourcepos-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenSourcePOS_CloudRun.png" alt="OpenSourcePOS sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Open Source Point of Sale (OSPOS) est un point de vente de détail web gratuit et
open source : enregistrez les ventes, gérez les articles, les clients et les
fournisseurs, imprimez les reçus et exécutez des rapports de ventes et
d'inventaire à partir d'un navigateur. Ce module déploie OpenSourcePOS sur
**Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'OpenSourcePOS utilise et sur la
façon de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à chaque application
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenSourcePOS s'exécute en tant que conteneur PHP / CodeIgniter 4 (un seul
processus Apache sur le port 80) sur Cloud Run v2. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Apache + PHP, 1 vCPU / 2 GiB par défaut ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — `OpenSourcePOS_Common` fixe le moteur. Contient toutes les données POS **et** les sessions utilisateur |
| Stockage d'objets | Cloud Storage | Un bucket `storage`, monté via GCS-Fuse à `/app/public/uploads` pour les images d'articles et le logo de l'entreprise ; plus un bucket générique `data` que l'application n'utilise pas |
| Secrets | Secret Manager | Mot de passe de la base de données uniquement — OpenSourcePOS n'a pas de secret de signature d'application |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur est fixé par `OpenSourcePOS_Common`.
- **`enable_cloudsql_volume = false`.** OpenSourcePOS lit un hôte TCP simple
  (`MYSQL_HOST_NAME`), de sorte que le service se connecte directement à
  l'**IP privée** de l'instance. Il n'y a pas de remplacement de port dans
  OpenSourcePOS — le port est toujours 3306.
- **La mise à l'échelle à zéro est la valeur par défaut livrée**
  (`min_instance_count = 0`, `max_instance_count = 1`). Pour une caisse
  en utilisation quotidienne, définissez `min_instance_count = 1` : un caissier
  n'attendra pas un démarrage à froid.
- **Plusieurs instances sont sûres.** Les sessions vivent dans MySQL
  (`DatabaseHandler`, table `ospos_sessions`) et les
  téléchargements vivent sur le bucket GCS partagé, donc augmenter
  `max_instance_count` ne déconnecte pas les caissiers et ne perd pas les images.
- **Les téléchargements persistent sur GCS.** `enable_gcs_storage_volume = true` monte le
  bucket `storage` à `/app/public/uploads`. L'image
  amont ne déclare aucun volume à cet endroit, donc sans le montage, les images
  téléchargées seraient perdues à chaque démarrage à froid.
- **NFS est désactivé et non nécessaire** (`enable_nfs = false`).
- **La version est épinglée** (`application_version = "3.4.1"`). N'utilisez jamais
  `latest`.
- **Le test de disponibilité est désactivé** par défaut (`uptime_check_config.enabled = false`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service OpenSourcePOS {#a-cloud-run--the-opensourcepos-service}

OpenSourcePOS s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

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

OpenSourcePOS stocke tout — ventes, articles, clients, fournisseurs, réceptions,
configuration et sessions — dans une instance Cloud SQL pour MySQL 8.0 gérée. Le
service se connecte via l'**IP privée de l'instance via TCP**. Lors du premier
déploiement, un job `db-init` crée la base de données et l'utilisateur de
l'application, suivi de `schema-load`, qui charge le schéma livré dans
l'image OpenSourcePOS.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les
sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Deux buckets d'application sont provisionnés :

- **`storage`** — ajouté par `OpenSourcePOS_Common` et monté via GCS Fuse à
  `/app/public/uploads`, où OpenSourcePOS écrit les images d'articles et le logo de
  l'entreprise (uniquement lorsque `enable_gcs_storage_volume = true`).
- **`data`** — la valeur par défaut générique de la Fondation à partir de
  `storage_buckets` ; non lue ou écrite par OpenSourcePOS.

La Fondation crée également un bucket de sauvegardes pour le job de sauvegarde
planifié.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket-name>/
  ```

### D. Secret Manager {#d-secret-manager}

OpenSourcePOS n'a pas de secret au niveau de l'application : `OpenSourcePOS_Common` ne
renvoie aucun de ses propres secrets. La seule information d'identification est
le mot de passe de la base de données, que la Fondation génère et stocke dans
Secret Manager (son nom est la sortie `database_password_secret`).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont acheminées vers Cloud Monitoring. Le test de
disponibilité est désactivé par défaut et les stratégies d'alerte sont vides
jusqu'à leur configuration.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenSourcePOS {#3-opensourcepos-application-behaviour}

- **Chaîne d'initialisation en deux étapes.** `db-init` (`mysql:8.0-debian`, `max_retries = 3`)
  crée l'utilisateur et la base de données de l'application et accorde les
  privilèges, puis vérifie que l'utilisateur de l'application peut se
  connecter. `schema-load` dépend de `db-init` et s'exécute sur
  l'**image de l'application** (`image = null`), car le fichier de schéma
  n'est livré qu'à l'intérieur de `jekkos/opensourcepos` à `/app/app/Database/database.sql`. Il
  compte d'abord les tables de la base de données : si elles existent, il se
  termine sans modifications, et après le chargement, il échoue si la base de
  données n'a toujours pas de tables. Les deux jobs s'exécutent lors de
  l'apply et peuvent être réexécutés en toute sécurité.
- **Pourquoi un job, pas le point d'entrée.** Cloud Run peut démarrer à froid
  plusieurs instances à la fois ; deux d'entre elles exécutant le même
  ensemble `CREATE TABLE` produiraient un schéma à moitié chargé sans
  erreur. Un job s'exécute une fois, avant que le service ne serve.
- **Ligne de log de démarrage.** À chaque démarrage, le wrapper imprime
  `[startup] OpenSourcePOS pointed at <ip>:3306/<db> as <user>`. Si l'une des variables
  `DB_IP`, `DB_USER`, `DB_PASSWORD` ou `DB_NAME` est vide, il imprime
  un message `FATAL:` et se termine — OpenSourcePOS reviendrait
  sinon silencieusement aux informations d'identification intégrées dans
  `.env` de l'image et s'exécuterait contre la mauvaise base de
  données.
- **Correctifs d'image.** L'image du wrapper écrit un vrai `date.timezone`
  (`UTC`) dans `timezone.ini` de PHP (l'amont le livre vide),
  définit `CI_ENVIRONMENT =
  production` (le `development` de l'amont affiche les
  traces de pile et la barre d'outils de débogage dans le navigateur), et
  ajoute une garde `X-Forwarded-Proto` à la réécriture de suppression de
  `www` dans `public/.htaccess`, qui autrement redirigerait en 301
  `https://www.<domain>` vers `http://` sur un domaine personnalisé.
- **Tests de santé.** Les sondes de démarrage et de vivacité
  `GET /`, la racine du document où OpenSourcePOS sert sa page de
  connexion — le même chemin que celui utilisé par `HEALTHCHECK` de l'image
  amont.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
  ```
- **Compte administrateur.** L'administrateur est créé par le schéma fourni
  avec le nom d'utilisateur `admin` ; le module ne le crée ni ne le
  modifie, et l'entrée `admin_email` n'est pas appliquée. Changez le mot de
  passe de l'administrateur après la première connexion.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
OpenSourcePOS sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court (1 à 7 caractères alphanumériques minuscules) qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ospos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `OpenSourcePOS` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `3.4.1` | Tag `jekkos/opensourcepos`, passé au build en tant que `OSPOS_VERSION`. La valeur par défaut de cette variante est celle qui prend effet. Épinglez une version exacte. |
| `php_memory_limit` | `512M` | Injecté en tant que variable d'environnement simple `memory_limit`. |
| `admin_email` | `admin@example.com` | Non appliqué — l'administrateur provient du schéma fourni. |
| `enable_gcs_storage_volume` | `true` | Monte le bucket `storage` à `/app/public/uploads` (la description de la variable nomme `/opt/ospos/var/data` ; le chemin monté est `/app/public/uploads`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image du wrapper via Cloud Build. `prebuilt` ignore le wrapper — pas de mappage `MYSQL_*`, pas de correctifs d'image. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; utilisez `1` pour une caisse en cours d'utilisation. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. Multi-instance est sûr. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Requis pour le montage des téléchargements GCS Fuse. |
| `timeout_seconds` | `300` | Délai d'expiration de la requête ; augmentez-le pour les importations ou les rapports volumineux. |
| `enable_cloudsql_volume` | `false` | TCP IP privée au lieu du socket Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google avant la page de connexion POS. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas les variables de connexion `MYSQL_*` ici — le wrapper les exporte depuis `DB_*` au démarrage. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager. |
| `protect_sensitive_environment_variables` | `true` | Les clés nommées par les informations d'identification dans `environment_variables` sont déplacées vers Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Âge du cycle de vie appliqué au bucket de sauvegardes. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et instance NFS {#group-9--custom-sql-scripts--nfs-instance}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. Ce groupe contient également `nfs_instance_name` / `nfs_instance_base_name`,
pertinents uniquement si `enable_nfs` est activé. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Liste blanche CIDR pour l'accès administratif. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets du module. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket générique de la Fondation ; non utilisé par OpenSourcePOS. |
| `enable_nfs` | `false` | Non nécessaire — les téléchargements persistent sur GCS. |
| `nfs_mount_path` | `/var/lib/ospos` | Utilisé uniquement si `enable_nfs = true` ; rien dans l'image n'y écrit. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires, fusionnés avec le volume de téléchargements `storage`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `OpenSourcePOS_Common`. |
| `db_name` / `db_user` | `ospos` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). Ne pas modifier sur un déploiement en cours. |
| `enable_auto_password_rotation` | `false` | Rotation automatique du mot de passe. |
| `db_host_env_var_name` | `DB_IP` | Garder comme `DB_IP` — le point d'entrée du wrapper le lit. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la chaîne intégrée `db-init` → `schema-load`. Fournir un job remplace les deux. |
| `cron_jobs` | `[]` | Pas de tâches planifiées par défaut ; OpenSourcePOS n'en a pas besoin. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, délai de 30s, période de 15s, 20 tentatives | Attend qu'Apache serve la page de connexion. |
| `liveness_probe` | HTTP `GET /`, délai de 60s, période de 30s, 3 tentatives | Racine du document. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | OpenSourcePOS n'a pas d'intégration Redis ; laisser désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Non utilisé par OpenSourcePOS. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyé lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Services de la phase Cloud Deploy (lorsqu'activé). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `schema-load`). |
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
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs *et les combinaisons* au moment de la planification.
> Une configuration invalide fait échouer la **planification** avec une erreur
> claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_version` | Une version exacte (par défaut `3.4.1`) | **Critique** | `latest` résout une image avec une disposition différente ; l'historique du module enregistre son échec de déploiement. Un tag flottant se reconstruit également sous une chaîne inchangée, de sorte qu'aucune nouvelle révision n'est déployée et que le conteneur en cours d'exécution conserve silencieusement l'ancienne image. |
| `container_image_source` | `custom` | **Critique** | `prebuilt` ignore le wrapper : pas de mappage `DB_*` → `MYSQL_*` (OpenSourcePOS revient alors aux informations d'identification `localhost` intégrées et ne peut pas atteindre Cloud SQL), et aucun des correctifs de fuseau horaire / `CI_ENVIRONMENT` / réécriture TLS. |
| `db_host_env_var_name` | `DB_IP` | **Critique** | Le point d'entrée du wrapper lit `DB_IP` ; il refuse de démarrer s'il est vide. |
| `db_name` / `db_user` | Définir une fois | **Critique** | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et perd toutes les données de vente. |
| `database_password_length` | Laisser à `32` après le déploiement | Élevé | Le modifier sur un déploiement en cours écrit un nouveau secret de mot de passe tandis que la base de données conserve l'ancien ; les connexions échouent jusqu'à ce que le job `db-init` soit réexécuté. |
| `enable_gcs_storage_volume` | `true` | Élevé | Sans le montage, les images d'articles et le logo de l'entreprise sont écrits dans le système de fichiers éphémère du conteneur et perdus à chaque démarrage à froid ou nouvelle révision. |
| `initialization_jobs` | `[]` | Élevé | Fournir un job remplace toute la chaîne par défaut, y compris `schema-load` ; l'application démarre alors contre une base de données vide. |
| `min_instance_count` | `1` pour une caisse en cours d'utilisation | Moyen | La mise à l'échelle à zéro (`0`) fait attendre la première vente après l'inactivité un démarrage à froid. |
| Mot de passe administrateur (schéma fourni, utilisateur `admin`) | Changer après la première connexion | Élevé | Le compte est créé par le schéma amont, non par ce module, et n'est pas aléatoire. |
| `enable_cloud_armor` / `enable_iap` | Activer pour la production | Moyen | La page de connexion POS est accessible publiquement par défaut. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` / `enable_nfs` | `false` | Faible / coût | OpenSourcePOS n'utilise ni l'un ni l'autre ; les activer provisionne des ressources que rien ne lit. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La
configuration d'application spécifique à OpenSourcePOS est décrite dans
**[OpenSourcePOS_Common](OpenSourcePOS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : OpenSourcePOS sur Cloud Run](../labs/OpenSourcePOS_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenSourcePOS Common — Configuration d'application partagée](OpenSourcePOS_Common.md) — la configuration de la couche application sur laquelle ce module est construit.
