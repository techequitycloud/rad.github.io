---
title: "Roundcube sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Roundcube sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Roundcube_CloudRun.md @ a4095cd sha256:c0bf175f2382 -->

# Roundcube sur Google Cloud Run {#roundcube-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Roundcube_CloudRun.png" alt="Roundcube sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Roundcube est un client webmail IMAP gratuit, open-source et basé sur un
navigateur. Il offre aux utilisateurs une expérience de messagerie de type
ordinateur de bureau (dossiers, carnet d'adresses, recherche et composition de
messages) avec un serveur de messagerie IMAP et SMTP existant. Roundcube est un
**client** de messagerie : ce module ne déploie aucun serveur de messagerie. Il
déploie Roundcube sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Roundcube et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les
applications Cloud Run (identité de service, entrée et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement), reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Roundcube s'exécute en tant que conteneur PHP (l'image officielle `roundcube/roundcubemail`
`-apache`, enveloppée par un point d'entrée personnalisé) sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Données propres à Roundcube — préférences, contacts, données de session. Le courrier lui-même reste sur le serveur IMAP |
| Stockage d'objets | Cloud Storage | Un bucket générique `data` est provisionné, mais Roundcube ne le lit ni ne l'écrit |
| Secrets | Secret Manager | `des_key` (`ROUNDCUBEMAIL_DES_KEY`) généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Courrier | _(aucun — externe)_ | Vous fournissez les serveurs IMAP et SMTP |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucun serveur IMAP ou SMTP n'est configuré.** Le module définit
  `ROUNDCUBEMAIL_DEFAULT_HOST` et `ROUNDCUBEMAIL_SMTP_SERVER` à des valeurs vides,
  et ce wrapper n'expose aucune entrée pour eux. Définissez-les dans
  `environment_variables` (Groupe 6) avant que quiconque ne puisse se connecter — voir
  [§3](#3-roundcube-application-behaviour).
- **Pas de comptes locaux.** Les utilisateurs se connectent avec leur nom
  d'utilisateur et leur mot de passe IMAP. Il n'y a pas de compte
  administrateur ni de secret de mot de passe administrateur.
- **MySQL 8.0 uniquement.** Le point d'entrée du wrapper compose toujours un DSN
  `mysql://`.
- **`enable_cloudsql_volume = false`.** Le DSN utilise `DB_IP`, l'IP privée de Cloud SQL,
  donc Cloud Run se connecte via **TCP IP privée**, et non via le socket Unix
  du proxy d'authentification.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent de la latence à la première
  requête après l'inactivité ; définissez `min_instance_count = 1` pour éviter cela.
- **Pas de job de schéma séparé.** L'image exécute `bin/installto.sh -y` à chaque
  démarrage, ce qui crée et met à jour le schéma de manière idempotente. Seul
  `db-init` s'exécute en tant que job Cloud Run.
- **Tag d'image épinglé.** `application_version = "1.6.19-apache"`. Gardez un tag exact — un tag
  glissant se reconstruit sans produire de nouvelle révision.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Roundcube {#a-cloud-run--the-roundcube-service}

Roundcube s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement à la charge des requêtes entre le nombre minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Roundcube stocke ses propres données (préférences utilisateur, contacts du
carnet d'adresses et données de session) dans une instance gérée de Cloud SQL
pour MySQL 8.0. Le courrier n'est jamais stocké ici ; il reste sur le serveur
IMAP. Le service se connecte via l'**IP privée de l'instance via TCP**. Lors du
premier déploiement, le job `db-init` crée la base de données et l'utilisateur de
l'application ; le schéma est ensuite créé par Roundcube lui-même
(`bin/installto.sh -y`) lorsque le conteneur démarre.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket générique `data` est provisionné par défaut (via l'entrée
`storage_buckets` de la Fondation), mais Roundcube ne le lit ni ne l'écrit jamais :
`gcs_volumes` est vide, donc aucun bucket n'est monté dans le conteneur. Les
pièces jointes en transit sont écrites dans un espace de travail local au
conteneur (`ROUNDCUBEMAIL_TEMP_DIR = /tmp/roundcube-temp`), qu'il est sûr de perdre lors d'un démarrage à froid.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret d'application est généré automatiquement : le `des_key` de 24
caractères, stocké sous le nom `secret-<prefix>-roundcube-des-key` et injecté sous le nom
`ROUNDCUBEMAIL_DES_KEY`. Roundcube l'utilise pour chiffrer les données de session et le mot
de passe IMAP qu'il détient au nom de chaque utilisateur connecté. Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~des-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés. Roundcube établit également des connexions
**sortantes** vers vos serveurs IMAP et SMTP ; avec le `vpc_egress_setting = PRIVATE_RANGES_ONLY` par défaut,
le trafic vers un serveur de messagerie public part directement plutôt que via
le VPC.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont envoyées à Cloud Monitoring. Le test de disponibilité est
**désactivé** par défaut (`uptime_check_config.enabled = false`) ; les politiques d'alerte sont
facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Roundcube {#3-roundcube-application-behaviour}

- **Pointer Roundcube vers un serveur de messagerie.** `Roundcube_Common` définit
  ces variables d'environnement, et `environment_variables` (Groupe 6) est fusionné
  par-dessus, c'est donc là que vous configurez le serveur de messagerie :

  | Variable | Valeur par défaut | Signification |
  |---|---|---|
  | `ROUNDCUBEMAIL_DEFAULT_HOST` | `""` | Serveur IMAP sur lequel les utilisateurs se connectent. `ssl://host` pour TLS implicite, `tls://host` pour STARTTLS ; un nom d'hôte nu est en clair. |
  | `ROUNDCUBEMAIL_DEFAULT_PORT` | `993` | Port IMAP — 993 pour TLS implicite, 143 pour STARTTLS. |
  | `ROUNDCUBEMAIL_SMTP_SERVER` | `""` | Serveur SMTP utilisé pour l'envoi. |
  | `ROUNDCUBEMAIL_SMTP_PORT` | `587` | Port de soumission — 587 ou 465. **Jamais 25** : Google Cloud bloque le port 25 sortant. |
  | `ROUNDCUBEMAIL_SKIN` | `elastic` | Thème Roundcube. |

  `Roundcube_Common` a des entrées `imap_host`/`imap_port`/`smtp_host`/`smtp_port`/`skin`
  qui alimentent ces valeurs, mais `Roundcube_CloudRun` ne les déclare ni ne les
  transmet, donc sur ce wrapper `environment_variables` est la seule voie d'accès.
- **Connexion.** Ouvrez l'URL du service et connectez-vous avec un compte sur le
  serveur IMAP. Roundcube n'a pas de comptes locaux ou administrateur.
- **DSN de la base de données.** Le point d'entrée du wrapper compose
  `ROUNDCUBEMAIL_DSNW=mysql://DB_USER:<password>@DB_IP:DB_PORT/DB_NAME` avec le mot de passe encodé en URL par
  `rawurlencode` de PHP, définit `ROUNDCUBEMAIL_DSNR` à la même valeur, et
  transmet à `/docker-entrypoint.sh` de l'image. Le point d'entrée du fournisseur
  interpolerait autrement le mot de passe brut, ce qui échoue sur les
  caractères `@ : / ? # % & +` que contiennent les mots de passe Cloud SQL.
- **Schéma.** Il n'y a pas de job de schéma : l'image exécute `bin/installto.sh -y` à
  chaque démarrage, créant le schéma au premier démarrage et le mettant à jour
  après un changement de version.
- **Limite de mémoire PHP.** `php_memory_limit` atteint le conteneur en tant que
  `PHP_MEMORY_LIMIT` ; le point d'entrée l'écrit dans `/usr/local/etc/php/conf.d/zz-rad-overrides.ini`,
  remplaçant `memory_limit=64M` de l'image. Le log du conteneur le confirme au
  démarrage : `[startup] PHP memory_limit set to 512M via ...`.
- **Comportement du test de santé.** Les deux sondes sont **HTTP
  `GET /`**, où Roundcube sert son formulaire de connexion. La sonde de
  démarrage autorise un délai de 30 s plus 20 tentatives de 15 s, car l'image
  exécute `installto.sh` et attend la base de données avant le démarrage
  d'Apache.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
  ```
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Roundcube sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court (1 à 7 caractères alphanumériques minuscules) qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `roundcube` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Roundcube` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `1.6.19-apache` | Tag `roundcube/roundcubemail`, passé comme ARG de build `ROUNDCUBE_VERSION`. La valeur de ce wrapper est celle qui l'emporte. Épinglez un tag `-apache` exact. |
| `php_memory_limit` | `512M` | `memory_limit` PHP, appliqué via `conf.d/zz-rad-overrides.ini`. |
| `admin_email` | `admin@example.com` | **Sans effet** — Roundcube ne crée aucun compte. |
| `enable_gcs_storage_volume` | `true` | **Sans effet** — `Roundcube_Common` le déclare mais ne l'utilise jamais ; rien n'est monté. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image du wrapper via Cloud Build. `"prebuilt"` ignore le point d'entrée du wrapper, de sorte que le DSN n'est plus encodé en URL et `php_memory_limit` cesse de fonctionner. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Limite supérieure d'autoscaling. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `false` | Le DSN utilise `DB_IP` sur TCP ; le socket n'est pas utilisé. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. Utilisez `ALL_TRAFFIC` uniquement si les serveurs IMAP/SMTP doivent être atteints via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant la connexion Roundcube. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés sur les valeurs par défaut du module. Définissez `ROUNDCUBEMAIL_DEFAULT_HOST`, `ROUNDCUBEMAIL_DEFAULT_PORT`, `ROUNDCUBEMAIL_SMTP_SERVER`, `ROUNDCUBEMAIL_SMTP_PORT` et, éventuellement, `ROUNDCUBEMAIL_SKIN` ici. |
| `secret_environment_variables` | `{}` | Carte de variable d'environnement → nom de secret Secret Manager. |
| `protect_sensitive_environment_variables` | `true` | Les clés nommées par les identifiants tapées dans `environment_variables` sont automatiquement déplacées dans Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et serveur NFS {#group-9--custom-sql-scripts--nfs-server}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. `nfs_instance_name` / `nfs_instance_base_name` sélectionnent ou nomment une
VM NFS, et n'ont d'importance que si `enable_nfs` est activé. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Liste blanche CIDR pour l'accès privilégié. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket GCS générique `data`. Non lu ou écrit par Roundcube. |
| `enable_nfs` | `false` | Non nécessaire — l'image ne déclare aucun volume et ne conserve aucun état sur disque qui doit survivre à un redémarrage. |
| `nfs_mount_path` | `/var/lib/roundcube` | Chemin de montage, utilisé uniquement lorsque `enable_nfs = true`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). Vide — rien n'est monté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Doit rester MySQL — le point d'entrée compose un DSN `mysql://`. Le sélecteur propose également `POSTGRES` et `NONE` ; aucun ne fonctionne. |
| `db_name` / `db_user` | `roundcube` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). Définir une fois — le modifier sur un déploiement en cours rompt l'authentification de la base de données. |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe de la base de données. |
| `rotation_propagation_delay_sec` | `90` | Attendre après la rotation avant de redémarrer le service. |
| `db_host_env_var_name` | `DB_IP` | Nom supplémentaire pour l'IP de l'hôte de la base de données. La Fondation injecte déjà `DB_IP`, ce que le point d'entrée lit, donc la valeur par défaut ne fait que le dupliquer. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. Fournir une liste quelconque le remplace. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, délai de 30s, timeout de 10s, période de 15s, 20 tentatives | Attend `installto.sh` et la base de données avant le démarrage d'Apache. |
| `liveness_probe` | HTTP `GET /`, délai de 60s, timeout de 10s, période de 30s, 3 tentatives | Le formulaire de connexion à la racine du document. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring — désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Ce module ne connecte aucune intégration Redis à Roundcube. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Services d'étape Cloud Deploy (lorsqu'activé). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
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
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification. Une
> configuration invalide fait échouer la **planification** avec une erreur
> claire et nommée avant la création de toute ressource, de sorte que la plupart
> des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ROUNDCUBEMAIL_DEFAULT_HOST` / `ROUNDCUBEMAIL_SMTP_SERVER` (via `environment_variables`) | Vos serveurs IMAP et SMTP | **Élevé** | Laissé vide par défaut. Le service est sain et affiche son formulaire de connexion, mais aucun utilisateur ne peut se connecter ou envoyer de courrier. Un test de santé vert ne prouve pas que le courrier fonctionne. |
| `ROUNDCUBEMAIL_SMTP_PORT` | `587` ou `465` | **Élevé** | Google Cloud bloque le port 25 sortant pour toutes les sorties ; l'envoi via le port 25 ne réussit jamais. |
| Schéma `ROUNDCUBEMAIL_DEFAULT_HOST` | `ssl://host` ou `tls://host` | **Élevé** | Un nom d'hôte nu se connecte en clair, envoyant les mots de passe IMAP des utilisateurs non chiffrés. N'utilisez un hôte nu que pour un serveur à l'intérieur du VPC. |
| `ROUNDCUBEMAIL_DES_KEY` (généré automatiquement) | Ne jamais modifier manuellement dans Secret Manager | Élevé | Il chiffre les données de session et les mots de passe IMAP stockés. Le modifier déconnecte tous les utilisateurs ; le supprimer fait que l'image du fournisseur génère une clé différente par conteneur, déconnectant les utilisateurs au hasard entre les instances et les démarrages à froid sans rien dans les logs. |
| `container_image_source` | `custom` | **Critique** | `prebuilt` déploie une image sans le point d'entrée du wrapper — le mot de passe de la base de données n'est plus encodé en URL dans le DSN, de sorte que la connexion échoue sur la ponctuation que contiennent les mots de passe Cloud SQL. |
| `database_type` | `MYSQL_8_0` | **Critique** | Le point d'entrée construit toujours un DSN `mysql://`. Tout autre moteur (ou `NONE`) laisse Roundcube sans base de données utilisable. |
| `application_version` | Un tag `-apache` exact | Moyen | `latest` ou un tag `1.6.x-apache` glissant peut modifier le contenu sous la même chaîne de tag, ce qui ne produit pas de diff Terraform et pas de nouvelle révision — le conteneur en cours d'exécution conserve silencieusement l'ancienne image. Les variantes `-fpm` n'ont pas de serveur web. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et perd les préférences et contacts stockés. |
| `database_password_length` | Définir une fois, au premier déploiement | Élevé | Le modifier sur un déploiement en cours écrit un nouveau mot de passe que la base de données ne détient pas, et chaque connexion échoue jusqu'à ce que le job de la base de données soit relancé. |
| `php_memory_limit` | `512M` ou plus | Moyen | La valeur par défaut de l'image est de 64 Mo ; les messages et pièces jointes volumineux sont les cas où un petit tas PHP s'épuise. |
| `admin_email`, `enable_gcs_storage_volume` | Laisser tel quel | Faible | Aucun n'a d'effet sur ce module, quelle que soit leur description. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid, y compris l'exécution de `installto.sh`, à la première requête après l'inactivité. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le formulaire de connexion est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long (identité de service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images), voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Roundcube est décrite dans
**[Roundcube_Common](Roundcube_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Roundcube sur Cloud Run](../labs/Roundcube_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [Roundcube Common — Configuration d'application partagée](Roundcube_Common.md)
  — la couche d'application sur laquelle ce module est construit.
