---
title: "SimpleRisk sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de SimpleRisk sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SimpleRisk_CloudRun.md @ a4095cd sha256:300a4b9e44bd -->

# SimpleRisk sur Google Cloud Run {#simplerisk-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SimpleRisk_CloudRun.png" alt="SimpleRisk sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SimpleRisk est une plateforme gratuite et open-source de gouvernance, de gestion
des risques et de conformité (GRC). Les équipes de sécurité et de conformité
l'utilisent pour tenir un registre des risques, évaluer les risques, planifier
et suivre les mesures d'atténuation, effectuer des revues de gestion et
conserver un historique auditable pour les évaluateurs. Ce module déploie
SimpleRisk sur **Cloud Run v2** en s'appuyant sur la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par SimpleRisk et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run
— identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

SimpleRisk fonctionne comme une application PHP sous Apache sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Apache + PHP, 1 vCPU / 2 GiB par défaut ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — `SimpleRisk_Common` fixe le moteur ; contient le registre des risques, les utilisateurs et les sessions |
| Stockage d'objets | Cloud Storage (GCS FUSE) | Un bucket `storage` monté à `/var/www/simplerisk/files` pour les fichiers téléchargés ; un bucket générique `data` est également créé mais inutilisé |
| Secrets | Secret Manager | Le mot de passe de la base de données uniquement — SimpleRisk n'a pas besoin d'autre secret généré |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **L'image du fournisseur n'est pas utilisée telle quelle.** `simplerisk/simplerisk` est une
  appliance tout-en-un qui exécute son propre serveur MySQL à l'intérieur du
  conteneur et conserve toutes les données d'état dans des volumes Docker —
  éphémères sur Cloud Run, de sorte que l'image standard reviendrait avec un
  registre des risques vide après chaque démarrage à froid, sans erreur.
  `SimpleRisk_Common` construit une image wrapper dont le point d'entrée dirige
  SimpleRisk vers Cloud SQL à la place (voir
  [SimpleRisk_Common](SimpleRisk_Common.md)).
- **MySQL 8.0 est obligatoire**, accessible via l'**IP privée** de l'instance
  (`DB_IP`) — `enable_cloudsql_volume = false`, pas de socket Auth Proxy.
- **Il n'y a pas de justificatifs par défaut.** Lors du premier accès, SimpleRisk
  affiche un formulaire *Default Admin Account Creation*, et quiconque le
  soumet devient l'administrateur. Le service est public par défaut, alors
  créez le compte dès que le déploiement est terminé (voir
  [§6](#6-configuration-pitfalls--sensible-defaults)).
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les sessions sont stockées dans la base de données, donc
  l'augmentation de `max_instance_count` ne déconnecte pas les utilisateurs lorsque les
  requêtes arrivent sur différentes instances.
- **Épingler une balise d'image exacte.** Les balises SimpleRisk sont des ID de
  build datés (`20260909-001`, la valeur par défaut), pas des semver.
- **NFS n'est pas utilisé** (`enable_nfs = false`) ; les fichiers téléchargés vont dans le
  volume GCS FUSE.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service SimpleRisk {#a-cloud-run--the-simplerisk-service}

SimpleRisk fonctionne comme un service Cloud Run v2 qui s'adapte automatiquement
à la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs.

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

Toutes les données SimpleRisk — risques, évaluations, atténuations, utilisateurs
et sessions PHP — résident dans une instance Cloud SQL gérée pour MySQL 8.0. Le
service se connecte à l'**IP privée** de l'instance **via TCP**. Lors du
premier déploiement, deux jobs s'exécutent dans l'ordre : `db-init` crée la
base de données et l'utilisateur de l'application, puis `schema-load` charge le
schéma de SimpleRisk (`/simplerisk.sql`, livré à l'intérieur de l'image du
fournisseur).

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

`SimpleRisk_Common` déclare un bucket `storage` (prévention de l'accès public
appliquée) et, avec `enable_gcs_storage_volume = true`, le monte avec GCS FUSE à
`/var/www/simplerisk/files`, où SimpleRisk conserve les fichiers téléchargés. Le
bucket générique `data` de la fondation (`storage_buckets`) est également
créé mais SimpleRisk ne l'utilise pas. Les deux ne sont créés que lorsque
`create_cloud_storage = true`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket-name>/
  ```

### D. Secret Manager {#d-secret-manager}

SimpleRisk lui-même ne crée pas de secrets. La seule information d'identification
générée est le mot de passe de la base de données, que la fondation crée et
injecte sous le nom `DB_PASSWORD` ; son nom de secret est la sortie
`database_password_secret`. Le chiffrement des données au repos (un extra SimpleRisk) n'est
délibérément pas activé : il introduirait un fichier de clé sur le système de
fichiers du conteneur, qui est éphémère sur Cloud Run.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~simplerisk"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (invocateur
`ingress_settings =
"all"`, `allUsers`). Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés avec
`enable_cloud_armor`.

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
et Cloud SQL sont envoyées à Cloud Monitoring. Un test de disponibilité n'est
créé que lorsque `uptime_check_config` est activé **et** `min_instance_count >= 1` — un service
à mise à l'échelle à zéro n'est pas sondé.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application SimpleRisk {#3-simplerisk-application-behaviour}

- **Ce que fait le point d'entrée du wrapper à chaque démarrage.** Il rend
  `/var/www/simplerisk/includes/config.php` à partir de `config.sample.php` du fournisseur, en
  substituant les `DB_IP`, `DB_PORT`, `DB_NAME`,
  `DB_USER` et `DB_PASSWORD` injectés par la fondation avec PHP
  `str_replace` (un mot de passe généré contenant `/`,
  `&` ou `\` casserait une substitution `sed`), et
  définit `USE_DATABASE_FOR_SESSIONS` à `true`. Il démarre ensuite Apache. Si
  `DB_IP`, `DB_NAME`, `DB_USER` ou `DB_PASSWORD` est
  manquant, le conteneur se termine plutôt que de démarrer sans rien.
- **Le port 80 sert l'application.** L'image du fournisseur sert SimpleRisk
  uniquement sur le port 443 et transforme le port 80 en une redirection
  HTTP vers HTTPS, ce qui, derrière la terminaison TLS de Cloud Run, est une
  boucle de redirection infinie. Le wrapper réécrit l'hôte virtuel du port 80
  pour servir `/var/www/simplerisk` directement (en conservant les en-têtes de sécurité
  du fournisseur, en abandonnant délibérément HSTS) et supprime l'hôte virtuel
  443.
- **Chaîne d'initialisation en deux étapes.** `db-init` (`mysql:8.0-debian`,
  jusqu'à 3 tentatives) crée l'utilisateur et la base de données, accorde les
  privilèges et vérifie que l'utilisateur de l'application peut se connecter.
  `schema-load` (image de l'application, dépend de `db-init`, jusqu'à 2
  tentatives) compte les tables dans la base de données et charge
  `/simplerisk.sql` uniquement s'il n'y en a pas, puis compte à nouveau pour
  confirmer que le chargement a réussi. Les deux jobs sont créés avec
  `execute_on_apply = true` et peuvent être réexécutés en toute sécurité. Un nouveau
  chargement produit environ 154 tables.
- **Comportement de la vérification de l'état.** Les sondes de démarrage et de
  vivacité sont des HTTP `GET /` (démarrage : délai initial de 30 s,
  période de 15 s, 20 échecs autorisés). Notez que la page se rend avant que
  SimpleRisk n'ait besoin de la base de données, donc une sonde réussie ne
  prouve pas que la connexion à la base de données fonctionne — utilisez le
  formulaire de première exécution ou une connexion pour vérifier cela.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
  ```
- **Administrateur de première exécution.** Lors du premier accès, SimpleRisk
  affiche un formulaire *Default Admin Account Creation* ; sa soumission crée
  l'administrateur. Voir ce formulaire est également la preuve que l'application
  communique avec la base de données Cloud SQL (vide d'utilisateurs).
- **Tâches planifiées.** Le wrapper exécute Apache uniquement — le
  `cron` géré par supervisord du fournisseur n'est pas démarré — de sorte
  que les rapports et notifications planifiés de SimpleRisk ne s'exécutent pas
  dans le conteneur. Utilisez `cron_jobs` si vous en avez besoin ; une entrée
  sans `image` exécute l'image de l'application.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
SimpleRisk sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court (1 à 7 caractères alphanumériques minuscules) qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. Une clé `module` est réservée par la fondation et est écrasée. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `simplerisk` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `SimpleRisk` | Nom lisible par l'homme affiché dans la console. |
| `description` | `SimpleRisk IT asset management on Cloud Run` | Description du service Cloud Run ; le libellé fourni est un vestige et purement cosmétique. |
| `application_version` | `20260909-001` | Balise `simplerisk/simplerisk`, passée au build comme `SIMPLERISK_VERSION`. ID de build datés, pas semver. |
| `php_memory_limit` | `512M` | Injecté comme variable d'environnement `memory_limit` en minuscules. Le point d'entrée du fournisseur qui la lisait est remplacé par celui du module, qui ne le fait pas. |
| `admin_email` | `admin@example.com` | Non utilisé — l'administrateur est créé via le formulaire de première exécution de SimpleRisk. |
| `enable_gcs_storage_volume` | `true` | Monte le bucket `storage` avec GCS-FUSE à `/var/www/simplerisk/files`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image wrapper via Cloud Build. `prebuilt` ignore le wrapper — l'image standard ne peut pas utiliser Cloud SQL. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. |
| `container_port` | `80` | Apache sert SimpleRisk sur le port 80. |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600). |
| `enable_cloudsql_volume` | `false` | Conservez `false` — l'application se connecte à `DB_IP` via TCP. |
| `enable_image_mirroring` | `true` | Mise en miroir de l'image dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `service_annotations` | `{}` | Clés d'espace de noms personnalisé uniquement ; les clés `run.googleapis.com/*` sont rejetées par l'API Cloud Run v2 au moment de l'apply. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `internal-and-cloud-load-balancing` ferme l'URL publique `run.app`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Valeurs en majuscules (`ALL_TRAFFIC`), contrairement à `ingress_settings`. |
| `enable_iap` | `false` | Nécessite une connexion Google ; supprime également la liaison d'invocateur `allUsers`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionné sur les valeurs par défaut du module (`DB_PORT = "3306"`, `memory_limit`) ; les variables `DB_*` de la fondation sont conservées. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `protect_sensitive_environment_variables` | `true` | Déplace les `environment_variables` ressemblant à des identifiants dans Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde de base de données automatisée (UTC), exécuté par Cloud Scheduler. |
| `backup_retention_days` | `7` | Rétention, appliquée comme règle de cycle de vie sur le bucket de sauvegardes. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restauration à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et instance NFS {#group-9--custom-sql-scripts--nfs-instance}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le
provisionnement. Ne les utilisez pas pour modifier les propres tables de
SimpleRisk. `nfs_instance_name` et `nfs_instance_base_name` s'appliquent uniquement lorsque
`enable_nfs = true`. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | S'appliquent uniquement à un dépôt Artifact Registry créé en ligne — aucun effet lorsque les images vont au dépôt partagé `Services_GCP`. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` et le bucket générique `data`. |
| `enable_nfs` | `false` | Non nécessaire pour SimpleRisk. |
| `nfs_mount_path` | `/var/lib/simplerisk` | Utilisé uniquement lorsque `enable_nfs = true` ; SimpleRisk n'y écrit pas. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires (le montage `storage` est ajouté automatiquement). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `SimpleRisk_Common`. |
| `db_name` / `db_user` | `simplerisk` | Passé à `SimpleRisk_Common`. Ne pas modifier après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). Le modifier sur un déploiement en cours rompt l'authentification (voir §6). |
| `enable_auto_password_rotation` | `false` | Rotation automatique du mot de passe. |
| `db_host_env_var_name` | `DB_IP` | Conservez `DB_IP` — le point d'entrée et `schema-load` le lisent. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne intégrée `db-init` → `schema-load` ; une liste non vide remplace les deux. |
| `cron_jobs` | `[]` | Pas de tâches planifiées par défaut. Une entrée sans `image` exécute l'image de l'application. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, délai de 30 s, période de 15 s, 20 tentatives | Le chemin de santé propre à l'image du fournisseur. |
| `liveness_probe` | HTTP `GET /`, délai de 60 s, période de 30 s, 3 tentatives | Même chemin. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Créé uniquement lorsque activé et `min_instance_count >= 1`. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | SimpleRisk n'a pas d'intégration Redis. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite une organisation). |
| `vpc_sc_dry_run` | `true` | Enregistre les violations sans les bloquer. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `schema-load`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de l'audit logging et CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou
> de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Formulaire d'administrateur de première exécution | Créez le compte administrateur immédiatement après le déploiement, ou restreignez d'abord l'accès | **Critique** | SimpleRisk n'a pas de justificatifs par défaut ; quiconque soumet le formulaire *Default Admin Account Creation* en premier devient administrateur. Avec `ingress_settings = "all"` et la liaison d'invocateur `allUsers`, cela peut être n'importe qui qui trouve l'URL. `ingress_settings = "internal-and-cloud-load-balancing"` ou `enable_iap = true` ferme l'URL publique. |
| `container_image_source` | `custom` | **Critique** | `prebuilt` déploie une image sans le point d'entrée du wrapper ; l'image standard ignore Cloud SQL, exécute son propre MySQL dans le conteneur et perd toutes les données à chaque démarrage à froid, silencieusement. |
| `db_name` / `db_user` | Définir une fois | **Critique** | Les modifier pointe SimpleRisk vers une nouvelle base de données vide. |
| `database_password_length` | Ne pas modifier après le premier déploiement | **Élevé** | Le modifier écrit un nouveau mot de passe dans Secret Manager sans mettre à jour l'utilisateur Cloud SQL, de sorte que le service et les deux jobs ne parviennent pas à s'authentifier. Les sondes HTTP restent vertes car `/` se rend sans la base de données. Réexécutez le job `db-init` (il exécute `ALTER USER`) pour resynchroniser. |
| `application_version` | Une balise datée exacte | **Élevé** | Une reconstruction sous une balise inchangée ne produit pas de diff Terraform et pas de nouvelle révision — le service en cours d'exécution conserve l'ancienne image. |
| `initialization_jobs` | `[]` | **Élevé** | Toute liste non vide remplace `db-init` et `schema-load` ; le schéma n'est alors jamais chargé dans une nouvelle base de données. |
| `db_host_env_var_name` | `DB_IP` | **Élevé** | Le point d'entrée nécessite `DB_IP` ; sans cela, le conteneur se termine au démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | **Critique** | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro ajoute une latence de démarrage à froid, et aucun test de disponibilité n'est créé tant qu'elle est `0`. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le service est publiquement accessible sans protection WAF par défaut. |
| `service_annotations` | clés d'espace de noms personnalisé uniquement | Faible | Les clés `run.googleapis.com/*` passent le plan et échouent à l'apply ("les annotations système ne sont pas prises en charge"). |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La couche
d'application spécifique à SimpleRisk est décrite dans
**[SimpleRisk_Common](SimpleRisk_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SimpleRisk sur Cloud Run](../labs/SimpleRisk_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [SimpleRisk Common — Configuration d'application partagée](SimpleRisk_Common.md)
  — la couche d'application sur laquelle ce module est construit.
