---
title: "InvenTree sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'InvenTree sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/InvenTree_CloudRun.md @ a4095cd sha256:5d0cedd21028 -->

# InvenTree sur Google Cloud Run {#inventree-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/InvenTree_CloudRun.png" alt="InvenTree sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

InvenTree est un système de gestion d'inventaire gratuit et open source : il
suit les pièces et composants, les emplacements et mouvements de stock, les
fournisseurs, les nomenclatures, et les bons de commande et de vente. Il est
utilisé par les équipes matérielles, les ateliers de fabrication (makerspaces)
et les petits fabricants. Ce module déploie InvenTree sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud qu'InvenTree utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run
— identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

InvenTree s'exécute comme une application Python/Django servie par gunicorn
sur Cloud Run v2. Chaque révision exécute **deux conteneurs construits à
partir de la même image** : le conteneur web et un conteneur sidecar
django-q `qcluster` pour les tâches de fond. Le déploiement relie un ensemble
ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur web (1 vCPU / 2 Gio) plus un sidecar `qcluster` (1 vCPU / 1 Gio) ; CPU toujours alloué ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Schéma créé par les migrations Django dans un job d'initialisation `migrate` dédié |
| Système de fichiers partagé | NFS (serveur NFS Services_GCP) | Optionnel (`enable_nfs = false` par défaut) — nécessaire pour persister le répertoire de données d'InvenTree |
| Stockage d'objets | Cloud Storage | Un bucket `data` (par défaut de la fondation) et un bucket `storage` (d'InvenTree_Common) sont créés ; aucun n'est monté dans le conteneur |
| Secrets | Secret Manager | Mot de passe de la base de données uniquement — le module ne génère aucun secret d'application |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` du numéro de projet ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Utilisez l'URL du numéro de projet.** InvenTree vérifie l'hôte de chaque
  requête par rapport à `INVENTREE_SITE_URL`, que la fondation injecte à partir de
  l'URL `https://<service>-<project-number>.<region>.run.app` prédite. L'URL `*.a.run.app` sous forme de hachage
  que Cloud Run annonce également renvoie **HTTP 500** (`INVE-E7`). La
  sortie `service_url` est la forme du numéro de projet.
- **Le répertoire de données est éphémère sauf si vous activez NFS.**
  InvenTree conserve `config.yaml`, ses `secret_key.txt` générées, les médias
  téléchargés, les fichiers statiques collectés et les plugins sous
  `/home/inventree/data`. Avec la valeur par défaut `enable_nfs = false`, il s'agit du
  système de fichiers propre au conteneur et il est perdu à chaque démarrage à
  froid. Définissez `enable_nfs = true` et `nfs_mount_path = "/home/inventree/data"` pour tout
  déploiement que vous avez l'intention de conserver.
- **Les migrations sont un job, pas une étape de démarrage.** `INVENTREE_AUTO_UPDATE`
  est `"false"` ; le job d'initialisation `migrate` est
  responsable du schéma.
- **Le worker de fond a besoin de CPU en dehors des requêtes.**
  `cpu_always_allocated = true` (facturation basée sur l'instance) afin que le sidecar
  `qcluster` continue de sonder entre les requêtes.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Tant qu'aucune instance n'existe, le worker ne
  s'exécute pas non plus ; définissez `min_instance_count = 1` si le travail
  planifié est important.
- **Aucun compte administrateur n'est provisionné.** Le module ne crée
  aucun utilisateur admin et aucun secret admin (voir §3).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont
définis. Les noms de service et de ressource sont rapportés dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service InvenTree {#a-cloud-run--the-inventree-service}

InvenTree s'exécute comme un service Cloud Run v2 avec deux conteneurs par
révision : le conteneur d'ingress (gunicorn sur le port 8000) et le sidecar
`qcluster` (pas de HTTP). Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, les
  conteneurs, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

InvenTree stocke tous ses enregistrements — pièces, stock, commandes,
utilisateurs — dans une instance gérée de Cloud SQL pour MySQL 8.0. Le
service se connecte via l'**IP privée de l'instance via TCP** (`enable_cloudsql_volume = false`) :
le point d'entrée du wrapper définit `INVENTREE_DB_HOST` à partir de
`DB_IP` de la fondation. Lors du premier déploiement, le job
`db-init` crée la base de données et l'utilisateur, puis le job
`migrate` crée le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot
de passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les
sauvegardes et la rotation des mots de passe.

### C. NFS — répertoire de données d'InvenTree {#c-nfs--inventrees-data-directory}

Lorsque `enable_nfs = true`, le partage NFS Services_GCP est monté dans le
conteneur web et les jobs d'initialisation à `nfs_mount_path`, et dans le
sidecar `qcluster` à `/home/inventree/data`. Pointez `nfs_mount_path`
vers `/home/inventree/data` afin que les trois voient le même répertoire ; la
valeur par défaut `/var/lib/inventree` n'est pas un chemin qu'InvenTree lit ou
écrit.

- **Console :** Compute Engine → Instances de VM (le serveur NFS Services_GCP).
- **CLI :**
  ```bash
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Cloud Storage {#d-cloud-storage}

Deux buckets sont provisionnés par défaut : le bucket `data` de la
fondation (de `storage_buckets`) et un bucket `storage` fourni par
`InvenTree_Common`. Aucun n'est monté dans le conteneur (`gcs_volumes` est
vide), et InvenTree ne les lit ni ne les écrit. Le bucket `storage` est
un endroit pratique pour stocker des fichiers pour `enable_custom_sql_scripts`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### E. Secret Manager {#e-secret-manager}

`InvenTree_Common` ne génère aucun secret d'application. Le seul secret est
le mot de passe de la base de données, géré par la fondation. Toute clé
nommée comme une credential que vous placez dans `environment_variables` est
automatiquement déplacée vers Secret Manager pendant `protect_sensitive_environment_variables = true`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` du numéro de
projet. Un équilibreur de charge HTTPS externe avec un domaine personnalisé,
Cloud CDN et Cloud Armor peuvent être superposés ; un domaine personnalisé
contourne également le problème des deux noms d'hôte mentionné ci-dessus.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
  echo "https://<service-name>-${PROJECT_NUMBER}.${REGION}.run.app"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des deux conteneurs sont envoyés à Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring. Le test de
disponibilité est **désactivé** par défaut (`uptime_check_config.enabled = false`).

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application InvenTree {#3-inventree-application-behaviour}

- **Chaîne d'initialisation en deux étapes.** `db-init` (`mysql:8.0-debian`,
  3 tentatives, 600 s) crée l'utilisateur et la base de données MySQL et
  vérifie que l'utilisateur peut se connecter. `migrate` (l'image de
  l'application, 2 vCPU / 2 Gio, 1800 s, dépend de `db-init`) exécute
  `python3 manage.py migrate --noinput` puis compte les tables ; il échoue si moins de 10
  existent, car `migrate` peut se terminer avec 0 sans avoir rien
  appliqué.
- **Pourquoi pas `INVENTREE_AUTO_UPDATE`.** La migration en cours du processus en
  amont s'exécute dans le maître gunicorn avant que le port ne se lie (donc
  la sonde de démarrage tue la révision en pleine migration), sa branche de
  base de données vide est inaccessible, et les conteneurs web et worker
  seraient en concurrence sur le même schéma. Les deux conteneurs s'exécutent
  avec `INVENTREE_AUTO_UPDATE = "false"`.
- **Environnement requis.** Le point d'entrée du wrapper refuse de démarrer
  sans `INVENTREE_SITE_URL` (ou `CLOUDRUN_SERVICE_URL` en repli) et les
  variables `DB_IP`, `DB_NAME`, `DB_USER` et
  `DB_PASSWORD` de la fondation. Le module définit également
  `INVENTREE_USE_X_FORWARDED_PROTO = "true"` et `INVENTREE_SESSION_COOKIE_SECURE = "true"`, de sorte que les liens
  absolus sont `https://` et les cookies sont sécurisés derrière
  la terminaison TLS de Cloud Run.
- **Fichiers statiques.** Le conteneur web exécute `collectstatic` à chaque
  démarrage (le fournisseur `init.sh` ne le fait pas). Un échec est
  enregistré comme un avertissement et le conteneur démarre quand même —
  l'interface utilisateur peut alors s'afficher sans style.
- **Worker de fond.** Le sidecar `qcluster` exécute `/cloud-entrypoint.sh
  invoke worker`
  avec les variables d'environnement et les secrets de l'infrastructure de
  l'application (`inherit_app_env = true`), et avec `INVENTREE_AUTO_UPDATE` et
  `INVENTREE_COLLECTSTATIC` définis sur `false`. Désactiver
  `enable_background_worker` le supprime : l'interface utilisateur et l'API
  fonctionnent toujours, mais aucune tâche planifiée, notification ou
  génération d'étiquettes ne s'exécute.
- **Tests de santé.** Les sondes de démarrage et de vivacité sont HTTP
  `GET /` sur le port 8000. Le chemin racine répond par une
  redirection vers l'interface utilisateur web.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
  ```
- **Premier administrateur.** Le module ne crée aucun utilisateur InvenTree,
  et l'entrée `admin_email` n'est pas utilisée. Créez vous-même le
  premier superutilisateur — par exemple avec les propres paramètres
  `INVENTREE_ADMIN_USER`, `INVENTREE_ADMIN_EMAIL` et `INVENTREE_ADMIN_PASSWORD`
  d'InvenTree (voir la documentation InvenTree), fournis via
  `environment_variables` / `secret_environment_variables`.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables
pour InvenTree sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `inventree` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `InvenTree` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `1.5.4` | Tag `inventree/inventree`, passé comme ARG de build `INVENTREE_VERSION`. Épinglez une version exacte — la valeur de cette variante est celle qui prend effet. |
| `php_memory_limit` | `512M` | **Non utilisé** — InvenTree est une application Python. |
| `admin_email` | `admin@example.com` | **Non utilisé** — aucun compte administrateur n'est créé. |
| `enable_gcs_storage_volume` | `true` | **Non utilisé** — aucun bucket n'est monté par ce paramètre. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image du wrapper via Cloud Build. `"prebuilt"` ignore le point d'entrée du wrapper et son mappage `DB_*` → `INVENTREE_DB_*`. |
| `cpu_limit` | `1000m` | CPU pour le conteneur web. |
| `memory_limit` | `2Gi` | Mémoire pour le conteneur web. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. |
| `container_port` | `8000` | Port de gunicorn. |
| `execution_environment` | `gen2` | Environnement d'exécution Cloud Run. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `false` | Connexion via IP privée TCP au lieu du socket du proxy d'authentification. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `cpu_always_allocated` | `true` | Requis pour le sidecar `qcluster`. |
| `enable_background_worker` | `true` | Exécute le sidecar `qcluster`. |
| `worker_cpu_limit` / `worker_memory_limit` | `1000m` / `1Gi` | Ressources du sidecar. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres InvenTree supplémentaires (`INVENTREE_*`). Fusionnés sur les valeurs par défaut du module, donc une clé ici l'emporte — ne pas écraser `INVENTREE_AUTO_UPDATE`, `INVENTREE_DATA_DIR` ou `INVENTREE_DB_ENGINE`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `protect_sensitive_environment_variables` | `true` | Déplace les clés nommées comme des credentials de `environment_variables` vers Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et nommage NFS {#group-9--custom-sql-scripts--nfs-naming}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécute du SQL à partir d'un bucket GCS après le
provisionnement (vérifié de bout en bout sur ce module, exécuté en tant
qu'utilisateur de l'application). `nfs_instance_name` / `nfs_instance_base_name`
sélectionnent le serveur NFS ; laissez-les à leurs valeurs par défaut pour
utiliser le serveur Services_GCP. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS (nécessite Cloud Armor). |
| `max_images_to_retain` | `7` | Nettoyage des révisions/images. |
| `delete_untagged_images` / `image_retention_days` | `true` / `30` | Sans effet dans un déploiement Services_GCP — la politique propre au registre partagé s'applique. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | La définition de ceci **remplace** la liste — l'ajout d'un bucket détruit le bucket `data` par défaut. |
| `enable_nfs` | `false` | Monter NFS dans le service, les jobs et le sidecar. Définissez `true` pour persister le répertoire de données. |
| `nfs_mount_path` | `/var/lib/inventree` | Définir sur `/home/inventree/data` lorsque `enable_nfs = true`. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | InvenTree est configuré pour MySQL. |
| `db_name` / `db_user` | `inventree` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). Ne pas modifier sur un déploiement en cours. |
| `enable_auto_password_rotation` | `false` | Rotation automatique du mot de passe. |
| `db_host_env_var_name` | `DB_IP` | Nom supplémentaire pour l'IP privée de la base de données ; redondant, puisque `DB_IP` est toujours injecté. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la chaîne `db-init` → `migrate` intégrée. Une liste non vide la remplace entièrement. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut — la propre planification d'InvenTree s'exécute dans le sidecar `qcluster`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, délai de 30 s, période de 15 s, 60 tentatives | Une longue fenêtre pour un premier démarrage à froid. |
| `liveness_probe` | HTTP `GET /`, délai de 60 s, période de 30 s, 3 tentatives | Correspond au test de santé de l'image du fournisseur (la racine du document). |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring — désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | InvenTree n'est pas câblé à Redis par ce module. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` du numéro de projet du service — celle qu'InvenTree accepte. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs *et les combinaisons* au moment de la planification.
> Une configuration invalide fait échouer la **planification** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que
> la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au
> moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` / `nfs_mount_path` | `true` / `/home/inventree/data` | **Critique** | Avec les valeurs par défaut (`false` / `/var/lib/inventree`), le répertoire de données est éphémère : les médias téléchargés, les plugins, `config.yaml` et la clé secrète générée sont perdus à chaque démarrage à froid, et une nouvelle clé secrète invalide toutes les sessions et les jetons de réinitialisation de mot de passe. L'activation de NFS au chemin par défaut monte un répertoire qu'InvenTree n'utilise jamais. |
| URL de service utilisée par les personnes | l'URL du numéro de projet (sortie `service_url`) ou un domaine personnalisé | Élevé | L'URL `*.a.run.app` sous forme de hachage renvoie HTTP 500 (`INVE-E7`), car l'hôte ne correspond pas à `INVENTREE_SITE_URL`. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et perd toutes les données d'inventaire. |
| `storage_buckets` | laisser par défaut sauf si vous avez l'intention de le remplacer | Élevé | La liste remplace la valeur par défaut — l'ajout d'un bucket détruit le bucket `data` et tout ce qu'il contient. |
| `environment_variables` | ne pas définir `INVENTREE_AUTO_UPDATE=true` | Critique | Réactive les migrations en cours de processus dans les deux conteneurs : une course sur un schéma et une interruption de sonde en pleine migration. Une base de données à moitié migrée ne peut pas être réparée en réexécutant `migrate` (elle échoue avec `Duplicate column name`) — elle doit être supprimée et recréée. |
| `initialization_jobs` | `[]` | Élevé | Toute liste non vide remplace `db-init` → `migrate` ; sans eux, le schéma n'est jamais créé et l'application se termine au démarrage. |
| `container_image_source` | `custom` | Critique | `prebuilt` déploie l'image de stock sans le point d'entrée du wrapper — pas de mappage `INVENTREE_DB_*`, donc InvenTree ne peut pas atteindre MySQL. |
| `application_version` | un tag exact | Moyen | Épinglez-le sur cette variante ; une épingle définie uniquement dans `InvenTree_Common` est écrasée. |
| `cpu_always_allocated` / `enable_background_worker` | `true` / `true` | Moyen | Avec le CPU basé sur les requêtes, le worker est gelé entre les requêtes ; sans le sidecar, aucune tâche de fond ne s'exécute. Les deux échouent silencieusement. |
| `min_instance_count` | `1` pour la production | Moyen | À `0`, il n'y a pas d'instance, et donc pas de worker de fond, pendant l'inactivité ; la première requête après l'inactivité attend un démarrage à froid. |
| `database_password_length` | Définir une fois | Élevé | Le modifier sur un déploiement en cours fait pivoter le mot de passe sans mettre à jour l'utilisateur de la base de données ; chaque connexion échoue alors jusqu'à ce que `db-init` soit réexécuté. |
| `enable_cloud_armor` | activer pour la production | Moyen | Le service est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à InvenTree est décrite dans
**[InvenTree_Common](InvenTree_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : InvenTree sur Cloud Run](../labs/InvenTree_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes
  à chaque étape.
- [InvenTree Common — Configuration d'application partagée](InvenTree_Common.md)
  — la couche d'application sur laquelle ce module est construit.
