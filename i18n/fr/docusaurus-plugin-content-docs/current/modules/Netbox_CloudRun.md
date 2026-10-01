---
title: "NetBox sur Google Cloud Run"
description: "Référence de configuration pour déployer NetBox sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Netbox_CloudRun.md @ 3055034 sha256:3b785fac1ac0 -->

# NetBox sur Google Cloud Run {#netbox-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netbox_CloudRun.png" alt="NetBox sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

NetBox est la « source de vérité » open source de référence pour les équipes
d'ingénierie réseau — gestion des adresses IP (IPAM), inventaire des équipements et
des baies, câblage et topologie réseau, le tout modélisé sous forme de données
structurées derrière une API REST/GraphQL complète. Ce module déploie NetBox sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise NetBox et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, ingress et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

NetBox s'exécute sous la forme d'un conteneur Python/Django construit sur mesure sur
Cloud Run v2, qui encapsule l'image officielle `netboxcommunity/netbox` avec un
processus d'arrière-plan `rqworker --with-scheduler` colocalisé. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Image construite sur mesure, 2 vCPU / 2 GiB par défaut, autoscaling serverless ; mise à l'échelle jusqu'à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — NetBox ne prend en charge ni MySQL ni SQLite en production |
| Stockage objet | Cloud Storage (GCS Fuse) | Un bucket `media` monté sur `/etc/netbox/media`, le véritable `MEDIA_ROOT` de NetBox |
| Cache et file d'attente | Redis (obligatoire) | File de tâches (`REDIS_DATABASE=0`) et cache (`REDIS_CACHE_DATABASE=1`) sur des bases logiques distinctes ; utilise par défaut l'IP du serveur NFS |
| Secrets | Secret Manager | `SECRET_KEY` et `SUPERUSER_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; NetBox ne prend en charge ni MySQL ni SQLite en
  production.
- **Redis est obligatoire, pas facultatif.** NetBox utilise Redis comme broker pour
  son système de tâches d'arrière-plan RQ (Redis Queue) — webhooks, scripts
  personnalisés, rapports et jobs planifiés/système — et comme backend de cache. Il
  s'agit de **deux bases Redis logiques distinctes** (`REDIS_DATABASE=0`,
  `REDIS_CACHE_DATABASE=1`) ; la documentation de NetBox avertit que partager un même
  numéro de base risque de faire perdre des tâches d'arrière-plan en file d'attente
  lors d'un vidage du cache.
- **Un worker d'arrière-plan est colocalisé dans le même conteneur.** L'image exécute
  `manage.py rqworker --with-scheduler` comme processus en arrière-plan à côté du
  serveur web Granian. Sans lui, les tâches d'arrière-plan s'accumulent silencieusement
  en file d'attente et ne s'exécutent jamais — aucune erreur distincte n'est signalée.
- **Les téléversements de médias sont montés sur le véritable `MEDIA_ROOT` de
  NetBox.** `/etc/netbox/media`, et non `/opt/netbox/netbox/media` qui semble plus
  évident — confirmé en conditions réelles via `manage.py shell`. Une erreur sur ce
  chemin ne produit aucune erreur ; les téléversements ne sont simplement jamais
  persistés dans GCS (voir §4 pour l'histoire complète).
- **Démarrage à froid privilégiant le coût par défaut** (`cpu_always_allocated = false`,
  `min_instance_count = 0`). **Compromis :** le worker RQ ne s'exécute que tant
  qu'une requête maintient l'instance active — les tâches d'arrière-plan sont mises
  en file et traitées à la requête suivante au lieu de s'exécuter immédiatement.
  Définissez ensemble `cpu_always_allocated = true` et `min_instance_count >= 1` pour
  rétablir un traitement continu.
- **Le conteneur s'exécute en tant que root** (uid 0 / gid 0) — l'image officielle
  `netboxcommunity/netbox` ne définit aucun `USER`. C'est intentionnel et conforme à
  l'amont ; le montage GCS Fuse est fixé en conséquence à `uid=0`/`gid=0`.
- **`SECRET_KEY` et `SUPERUSER_PASSWORD` sont générés automatiquement** et stockés
  dans Secret Manager. `SECRET_KEY` doit comporter au moins 50 caractères (NetBox
  l'impose) ; il est généré avec 64 caractères.
- **Les contrôles d'état utilisent `/login/`, et non `/api/status/`.** La page de
  connexion est publique et non authentifiée ; l'API de statut nécessite une
  authentification et ferait échouer chaque sonde.
- **`ALLOWED_HOSTS = "*"` et `CORS_ORIGIN_ALLOW_ALL = "true"` sont ouverts par
  défaut** pour un premier déploiement sans intervention — restreignez-les via
  `environment_variables` avant d'exposer une instance de production sur Internet.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service NetBox {#a-cloud-run--the-netbox-service}

NetBox s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la
charge des requêtes entre les nombres minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
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

NetBox stocke toutes les données d'inventaire et d'IPAM (équipements, baies,
adresses IP, préfixes, VLAN, circuits, utilisateurs) dans une instance gérée Cloud
SQL for PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL
Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Au premier
déploiement, un Job d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage (stockage des médias GCS Fuse) {#c-cloud-storage-gcs-fuse-media-store}

Un bucket `media` dédié est provisionné automatiquement et monté sur
`/etc/netbox/media` — le véritable `MEDIA_ROOT` de NetBox — pour les images
d'équipements/de baies téléversées et les pièces jointes.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse et les options CMEK.

### D. Redis (file de tâches et cache) {#d-redis-task-queue-and-cache}

Redis est **obligatoire** (`enable_redis = true` par défaut). Lorsque `redis_host`
est laissé vide et que `enable_nfs` vaut true, l'IP de la VM du serveur NFS est
utilisée comme point de terminaison Redis. NetBox répartit son usage entre deux bases
logiques — `REDIS_DATABASE=0` pour la file de tâches RQ, `REDIS_CACHE_DATABASE=1`
pour le cache.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> -n 0 llen rq:queue:default   # inspect the RQ default queue depth
  # Confirm the resolved Redis host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `SECRET_KEY` (secret cryptographique Django utilisé pour les sessions, la
protection CSRF et les cookies signés) et `SUPERUSER_PASSWORD` (le mot de passe du
compte administrateur initial). Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ;
les paramètres d'ingress et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application NetBox {#3-netbox-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via
  le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et
  l'utilisateur de l'application, puis accorde les privilèges. Le job peut être
  relancé sans risque.
- **Migrations de la base de données au démarrage.** `docker-entrypoint.sh true`
  exécute de manière synchrone la séquence de premier démarrage propre à NetBox à
  chaque démarrage du conteneur — attente de la disponibilité de la base,
  `migrate --no-input`, nettoyage des contenttypes obsolètes, nettoyage des sessions
  et réindexation paresseuse de l'index de recherche — avant le démarrage du serveur
  web et du worker RQ. C'est idempotent ; sans effet lorsqu'il n'y a rien de nouveau à
  migrer.
- **L'amorçage du superutilisateur est idempotent.** Le compte administrateur
  initial (`admin_user`/`admin_email`, mot de passe issu de Secret Manager) est créé
  à partir des variables d'environnement `SUPERUSER_*` au premier démarrage ; la
  création est ignorée — sans erreur — si un utilisateur portant ce nom existe déjà,
  ce qui la rend sûre à chaque redémarrage.
- **Les téléversements de médias sont persistés dans le véritable `MEDIA_ROOT`.** Le
  `MEDIA_ROOT` réel de NetBox est `/etc/netbox/media` (confirmé en conditions réelles
  via `manage.py shell`), et c'est là qu'est monté le volume GCS Fuse `media`. Une
  révision antérieure de ce module montait à la place `/opt/netbox/netbox/media`, qui
  semble plus évident — un chemin NetBox réel mais inexistant — ce qui faisait écrire
  les téléversements sur le système de fichiers éphémère du conteneur : ils étaient
  relisibles immédiatement (même système de fichiers local, donc l'aller-retour
  « fonctionnait »), mais n'atteignaient jamais GCS et étaient perdus à chaque
  redémarrage du conteneur, de façon identique sur Cloud Run **et** sur GKE. Le
  problème a été corrigé en rectifiant le chemin de montage, vérifié en conditions
  réelles avec `gcloud storage ls` affichant le fichier de test téléversé avec la
  bonne taille en octets, le bon type de contenu et un horodatage dans les 5 secondes
  suivant le téléversement. **Leçon :** cela ressemblait exactement à une limitation
  de stockage propre à Cloud Run jusqu'à ce qu'on le trace avec un véritable accès
  shell — c'était un banal bug de chemin de montage Terraform affectant les deux
  plateformes de façon identique, et non une lacune de la plateforme.
- **`CSRF_TRUSTED_ORIGINS` reflète l'URL réelle du service.** Calculé à partir de
  `module.deployment_id.service_name`, propre à l'application, et du numéro de
  projet — et non du préfixe de ressources propre au seul tenant, qui construirait
  l'URL d'un service inexistant et rejetterait chaque POST authentifié (y compris la
  connexion) avec un échec CSRF. Vérifiez la valeur déployée :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Le worker RQ traite les tâches d'arrière-plan.** Les webhooks, scripts
  personnalisés, rapports et jobs planifiés/système sont exécutés par `manage.py rqworker
  --with-scheduler`, colocalisé dans le même conteneur que le serveur web. Avec la
  valeur par défaut de démarrage à froid privilégiant le coût, ce worker ne s'exécute
  que tant qu'une instance est active ; activez `cpu_always_allocated = true` +
  `min_instance_count >= 1` pour un traitement continu en arrière-plan.
- **Chemin de contrôle d'état.** Les sondes de démarrage et de vivacité ciblent
  `/login/` — la page de connexion publique et non authentifiée de NetBox.
  `/api/status/` nécessite une authentification et ferait échouer chaque sonde.
- **Inspectez l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à NetBox ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `netbox` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `NetBox - Network Documentation & IPAM` | Nom lisible affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image de conteneur, transmis à l'ARG de build `APPLICATION_VERSION` du Dockerfile. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; partagé par le serveur web et le worker RQ. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 1Gi. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle jusqu'à zéro ; le worker RQ ne s'exécute que tant qu'une instance est active. |
| `max_instance_count` | `3` | Limite supérieure de l'autoscaling. |
| `cpu_always_allocated` | `false` | `true` + `min_instance_count >= 1` rétablit le traitement continu des tâches d'arrière-plan. |
| `container_port` | `8080` | Le serveur Granian (WSGI) de NetBox écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Contrôle d'ingress Cloud Run. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `SECRET_KEY`, `SUPERUSER_PASSWORD` ni `DB_*` ici — ils sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un
bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket de médias provisionné automatiquement. |
| `enable_nfs` | `true` | Provisionne NFS ; utilisé comme hôte Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. Lorsqu'il est vide, `Netbox_Common` monte automatiquement `netbox-media` sur `/etc/netbox/media` (le véritable `MEDIA_ROOT` de NetBox). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe ; NetBox nécessite PostgreSQL 14+. |
| `db_name` | `netbox` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `netbox` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non transmis — NetBox n'a aucune tâche récurrente planifiée par la plateforme ; ses propres jobs planifiés s'exécutent plutôt via le worker RQ colocalisé. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires déployés aux côtés de NetBox. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/login/`, délai de 60s, seuil d'échec de 60 | Sonde de démarrage propre à NetBox (prise en compte). |
| `liveness_probe` | HTTP `/login/`, fenêtre d'échec de 30s | Sonde de vivacité propre à NetBox. |
| `startup_probe_config` / `health_check_config` | valeurs par défaut génériques d'App_CloudRun | Sondes structurées alternatives ; remplacées par `startup_probe`/`liveness_probe` ci-dessus. |
| `uptime_check_config` | `{ enabled=true, path="/login/" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 15 — Paramètres de l'application NetBox {#group-15--netbox-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `time_zone` | `UTC` | Fuseau horaire des horodatages et des tâches planifiées de NetBox. |
| `admin_user` | `admin` | Nom d'utilisateur du superutilisateur créé automatiquement. La création est idempotente — ignorée s'il existe déjà. |
| `admin_email` | `admin@example.com` | Adresse e-mail du superutilisateur créé automatiquement. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire.** Sert de support à la file de tâches RQ et à la couche de cache de NetBox. NetBox ne peut pas fonctionner sans. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique `run.app` de l'interface web de NetBox. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Chemin de montage `gcs_volumes` (défini automatiquement sur `/etc/netbox/media`) | Ne jamais le remplacer par un autre chemin sans avoir confirmé le véritable `MEDIA_ROOT` de NetBox | Critique | Un mauvais chemin de montage laisse les téléversements sur le système de fichiers éphémère du conteneur — ils sont relisibles immédiatement, mais silencieusement perdus à chaque redémarrage, sans aucune erreur. Ce bug précis a été trouvé et corrigé sur l'ancien montage `/opt/netbox/netbox/media` de ce module. |
| `SECRET_KEY` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critique | Le renouveler invalide toutes les sessions actives et les cookies signés ; NetBox impose également une longueur minimale de 50 caractères. |
| `SUPERUSER_PASSWORD` (généré automatiquement) | Le changer via l'interface de NetBox, pas en régénérant le secret | Moyen | Régénérer la valeur dans Secret Manager ne modifie pas rétroactivement le mot de passe du compte administrateur déjà créé. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf pour une restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `enable_redis` | `true` (obligatoire) | Critique | Le système de tâches d'arrière-plan de NetBox (webhooks, rapports, scripts, jobs planifiés) et sa couche de cache ne fonctionnent pas sans Redis — il n'existe aucun mode de repli. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais NFS désactivé et qu'aucun hôte n'est défini, la connexion Redis est vide et le traitement en arrière-plan ne s'exécute jamais, sans signalement. |
| `REDIS_DATABASE` / `REDIS_CACHE_DATABASE` | Les garder distincts (`0` / `1`) | Élevé | Partager une même base Redis logique risque de faire perdre des tâches d'arrière-plan en file lors d'un vidage du cache, selon la documentation de NetBox. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures à 1Gi risquent des arrêts pour OOM, surtout avec le worker RQ colocalisé dans le même conteneur. |
| `cpu_always_allocated` / `min_instance_count` | `true` + `>=1` si les jobs d'arrière-plan doivent s'exécuter en continu | Moyen | Avec la valeur par défaut privilégiant le coût (`false` / `0`), les webhooks/rapports/jobs planifiés ne s'exécutent que tant qu'une requête maintient l'instance active — ils sont mis en file au lieu de s'exécuter immédiatement. |
| `ALLOWED_HOSTS` / `CORS_ORIGIN_ALLOW_ALL` (injectés automatiquement à `"*"` / `"true"`) | Les restreindre pour un usage en production exposé sur Internet | Moyen | Laissés ouverts, tout nom d'hôte/toute origine est accepté — acceptable pour un premier déploiement, pas pour une instance de production renforcée. |
| `CSRF_TRUSTED_ORIGINS` (calculé automatiquement) | Vérifier après le déploiement qu'il correspond à l'URL réelle du service | Élevé | Une valeur obsolète ou incorrecte rejette chaque POST authentifié, y compris la connexion, avec un échec CSRF. |
| `ingress_settings` | `all` pour un accès public | Moyen | `internal` bloque l'accès du navigateur au parcours de connexion/configuration, sauf via VPN/IAP. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme. |
| `enable_cloud_armor` | à activer en production | Moyen | L'interface d'administration est accessible publiquement sans protection WAF par défaut. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à NetBox partagée avec la variante GKE est décrite dans
**[Netbox_Common](Netbox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NetBox sur Cloud Run](../labs/Netbox_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [NetBox sur GKE Autopilot](Netbox_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [NetBox Common — Configuration applicative partagée](Netbox_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Snipe-IT sur Google Cloud Run](SnipeIT_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Homepage sur Google Cloud Run](Homepage_CloudRun.md) dans la solution **IT Asset & Infrastructure Records**.
