---
title: "Flarum sur Google Cloud Run"
description: "Référence de configuration pour déployer Flarum sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Flarum_CloudRun.md @ 3055034 sha256:f9122e702f2b -->

# Flarum sur Google Cloud Run {#flarum-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flarum_CloudRun.png" alt="Flarum sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flarum est une plateforme de forum et de discussion gratuite et open source — une
alternative moderne et extensible aux logiciels de forum traditionnels, construite en
PHP avec un front-end JavaScript/Mithril et une API REST. Ce module déploie Flarum sur
**Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Flarum et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Flarum s'exécute dans un conteneur unique nginx + php-fpm construit à partir de
l'image communautaire `mondedie/flarum`. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur nginx/php-fpm sur le port 8888, 1 vCPU / 2 GiB par défaut ; mise à zéro prise en charge |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` par `Flarum_Common` |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; les avatars/pièces jointes téléversés sont conservés sous `/flarum/app/public/assets` |
| Stockage objet | Cloud Storage | Un bucket `flarum-assets` (issu de `Flarum_Common`) et un bucket `data` par défaut sont provisionnés ; aucun n'est monté par défaut |
| Secrets | Secret Manager | `FLARUM_ADMIN_PASS` généré automatiquement ; mot de passe de la base de données géré séparément |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** `Flarum_Common` code en dur `database_type =
  "MYSQL_8_0"` dans sa configuration de sortie ; la variable
  `database_type` de la variante ne prend effet que si elle est explicitement modifiée par rapport à sa
  valeur par défaut `MYSQL_8_0`.
- **Cloud SQL est atteint par défaut en TCP direct sur IP privée, et NON via le socket
  de l'Auth Proxy.** `enable_cloudsql_volume` vaut `false` par défaut sur cette
  variante (elle remplace la valeur par défaut `true` de `Flarum_Common`), de sorte que
  `DB_HOST` se résout en l'IP privée de l'instance Cloud SQL et que le point d'entrée
  mondedie se connecte en TCP via la sortie VPC. C'est l'inverse de la variante
  [Flarum_GKE](Flarum_GKE.md), qui utilise toujours un sidecar cloud-sql-proxy sur la
  boucle locale. Définissez `enable_cloudsql_volume = true` pour basculer plutôt vers la
  connexion par socket Unix.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`), contrairement à
  la variante GKE, dont la valeur par défaut est `min_instance_count = 1`. Les
  démarrages à froid ajoutent de la latence à la première requête après une période
  d'inactivité ; définissez `min_instance_count = 1` pour un forum toujours joignable.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur
  `/flarum/app/public/assets`) afin que les avatars et pièces jointes des utilisateurs
  soient conservés et partagés entre les instances.
- **`FORUM_URL` est câblé automatiquement sur Cloud Run — contrairement à la variante
  GKE.** `main.tf` calcule l'URL de service `run.app` prédite de manière déterministe
  et la transmet à `Flarum_Common` en tant que `service_url`, ce qui définit
  automatiquement `FORUM_URL`. Si vous placez un domaine personnalisé ou l'équilibreur
  de charge HTTPS externe devant le service, remplacez `FORUM_URL` via
  `environment_variables` pour qu'il corresponde au nom d'hôte public réel.
- **`FLARUM_ADMIN_PASS` est généré automatiquement** et stocké dans Secret Manager. Le
  nom d'utilisateur et l'adresse e-mail de l'administrateur sont **fixés par les valeurs
  par défaut de `Flarum_Common`** (`admin` / `admin@techequity.cloud`) — ils ne sont
  pas exposés comme variables d'Application Module sur cette variante ; récupérez donc
  le mot de passe généré avant la première connexion plutôt que de compter configurer
  le nom d'utilisateur/l'adresse e-mail.
- **`php_memory_limit`, `upload_max_filesize` et `post_max_size` n'ont aucun effet.**
  Ces trois variables sont déclarées et transmises à `Flarum_Common`, mais la
  configuration de `Flarum_Common` ne les référence jamais — ce sont des reliquats
  inertes du modèle dérivé de WordPress à partir duquel ce module a été cloné. Les
  modifier ne change rien dans le conteneur déployé.
- **L'image est un build personnalisé minimal, pas une image précompilée.**
  `container_image_source = "custom"` construit `FROM mondedie/flarum` via Cloud
  Build, en réétiquetant l'image de base au moyen de l'ARG de build propre à
  l'application `FLARUM_VERSION` (car l'argument de build `APP_VERSION` du socle
  l'emporterait sinon lors de la fusion et imposerait un tag mouvant).
  `application_version = "latest"` correspond au tag `stable` de l'image, recommandé
  pour la production.
- **Pas de job de migration distinct.** Le point d'entrée s6-overlay propre à l'image
  `mondedie/flarum` exécute l'installateur Flarum au premier démarrage du conteneur,
  une fois que le job `db-init` a créé la base de données et l'utilisateur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Flarum {#a-cloud-run--the-flarum-service}

Flarum s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement
selon la charge de requêtes, entre les nombres minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Flarum stocke toutes les données du forum (discussions, messages, utilisateurs, tags)
dans une instance Cloud SQL for MySQL 8.0 gérée, avec des tables préfixées `flarum_`.
Par défaut (`enable_cloudsql_volume = false`), le service se connecte en **TCP direct
sur IP privée** via la sortie VPC ; définir `enable_cloudsql_volume = true` monte à la
place le **Cloud SQL Auth Proxy** sous forme de volume de socket Unix. Lors du premier
déploiement, un Job d'initialisation crée la base de données et l'utilisateur de
l'application ; l'installateur Flarum crée ensuite le schéma au premier démarrage du
conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags
  et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage et Filestore (NFS) {#c-cloud-storage--filestore-nfs}

Un bucket **Cloud Storage** `flarum-assets` (issu de `Flarum_Common`) et un bucket
`data` par défaut (issu de la variable `storage_buckets`) sont provisionnés
automatiquement, mais aucun n'est monté dans le conteneur par défaut — ajoutez une
entrée à `gcs_volumes` si vous souhaitez en utiliser un comme montage de système de
fichiers. Par ailleurs, les avatars et pièces jointes téléversés dans Flarum résident
sur **Cloud Filestore (NFS)** dans `/flarum/app/public/assets`, monté car
`enable_nfs = true` par défaut.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~flarum"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse, les options CMEK et le
comportement de découverte NFS.

### D. Secret Manager {#d-secret-manager}

Un secret propre à Flarum est généré automatiquement et stocké dans Secret Manager :
`FLARUM_ADMIN_PASS` (le mot de passe de l'administrateur au premier lancement,
24 caractères). Le nom d'utilisateur et l'adresse e-mail de l'administrateur sont fixés
à `admin` / `admin@techequity.cloud` et ne sont pas stockés comme secrets. Le mot de
passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~flarum AND name~admin-pass"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Redis (facultatif) {#e-redis-optional}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé sans
`redis_host` explicite, le socle injecte l'IP de la VM du serveur NFS partagé en tant
que `REDIS_HOST` (nécessite `enable_nfs = true` ou un serveur NFS géré par
Services_GCP détectable) — cette injection au niveau du socle l'emporte toujours sur la
valeur d'espace réservé de `Flarum_Common`, de sorte qu'un point de terminaison Redis
fonctionnel parvient au conteneur dans tous les cas.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the resolved host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être ajouté par-dessus ; les paramètres d'entrée et la sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run
et Cloud SQL alimentent Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Flarum {#3-flarum-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`) exécute `db-init.sh` avec `mysql:8.0-debian`. Il
  localise le socket Unix du Cloud SQL Auth Proxy sous `/cloudsql` (en attendant
  jusqu'à 30 s lorsque `enable_cloudsql_volume = true`) ou se replie sur l'IP privée de
  l'instance en TCP, crée de manière idempotente la base de données et l'utilisateur de
  l'application, accorde les privilèges, vérifie que l'utilisateur applicatif peut se
  connecter (ce qui réchauffe le cache côté serveur `caching_sha2_password` de
  MySQL 8) et arrête proprement le sidecar Auth Proxy. Le job peut être relancé sans
  risque.
- **Pas de job de migration distinct.** Le point d'entrée s6-overlay propre à l'image
  `mondedie/flarum` exécute automatiquement l'installateur Flarum au premier démarrage
  du conteneur, en créant le schéma (avec le préfixe de table `flarum_`) une fois que
  `db-init` a provisionné la base de données et l'utilisateur. Le Dockerfile
  personnalisé est une enveloppe minimale non modifiée de l'image de base — il ne
  remplace pas `ENTRYPOINT` et n'ajoute pas d'étape de migration.
- **Compte administrateur.** L'installateur crée un administrateur de premier lancement
  dont le nom d'utilisateur est `admin` et l'adresse e-mail `admin@techequity.cloud`
  (valeurs par défaut fixes de `Flarum_Common`, non exposées comme variables du module)
  et dont le mot de passe est le secret généré `FLARUM_ADMIN_PASS`. Celui-ci est
  généré une seule fois et jamais renouvelé par le module — modifier le secret après
  l'installation ne change **pas** l'identifiant de l'administrateur (modifiez-le
  plutôt depuis l'interface d'administration de Flarum).
- **Câblage des variables d'environnement de la base de données.** Le `main.tf` de
  `Flarum_CloudRun` définit `db_user_env_var_name = "DB_USER"`,
  `db_password_env_var_name = "DB_PASS"` et `db_name_env_var_name = "DB_NAME"` lors de
  l'appel au socle — exactement les noms de variables d'environnement qu'attend
  l'installateur mondedie/flarum — si bien qu'aucun point d'entrée d'alias n'est
  nécessaire. `Flarum_Common` définit en outre `DB_PORT = "3306"` et
  `DB_PREF = "flarum_"` directement dans `environment_variables`.
- **`FORUM_URL` est défini automatiquement** à partir de l'URL de service `run.app`
  prédite. Si vous ajoutez un domaine personnalisé ou un équilibreur de charge devant
  le service, mettez à jour `FORUM_URL` via `environment_variables` avec le nom d'hôte
  public réel, faute de quoi les liens absolus, les URL des ressources et les
  redirections pointeront vers le mauvais hôte.
- **Inscription.** Le paramètre d'inscription publique de Flarum est une préférence
  d'administration intégrée à l'application (Admin → Basics), et non un réglage que ce
  module bascule — vérifiez-le après la première connexion si vous souhaitez
  restreindre qui peut créer des comptes sur le forum.
- **Chemin de santé.** La `startup_probe` propre à l'application est par défaut une
  vérification **TCP** sur le port du conteneur (8888) avec un `failure_threshold = 20`
  généreux à `period_seconds = 15` (cinq minutes de délai de grâce) pour laisser le
  temps à l'installateur du premier démarrage. La `liveness_probe` est par défaut une
  requête **HTTP** `GET /` — la page d'accueil publique non authentifiée du forum
  Flarum — avec un `initial_delay_seconds = 300` (cinq minutes) avant la première
  vérification.
- **Redis (facultatif).** `enable_redis` vaut `false` par défaut. Lorsqu'il est activé
  sans `redis_host` explicite, le socle exige `enable_nfs =
  true` ou un serveur NFS détectable (validation au moment du plan sur
  `App_CloudRun`) — sinon l'apply échoue avec une erreur claire plutôt que de déployer un forum incapable de joindre Redis.
- **Inspecter l'exécution des jobs et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Flarum ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `flarum` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Flarum` | Nom lisible affiché dans la console. |
| `description` | `Flarum wiki on Cloud Run` | Texte de description du service. Purement cosmétique — malgré le libellé, Flarum est un forum et non un wiki ; cela n'a aucun effet fonctionnel. |
| `application_version` | `latest` | Correspond au tag `stable` de `mondedie/flarum` via l'ARG de build `FLARUM_VERSION` ; toute autre valeur est utilisée telle quelle. |
| `php_memory_limit` | `512M` | **Inerte** — déclarée et transmise à `Flarum_Common`, mais jamais consommée. N'a aucun effet sur le conteneur déployé. |
| `upload_max_filesize` | `64M` | **Inerte** — comme ci-dessus. |
| `post_max_size` | `64M` | **Inerte** — comme ci-dessus. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Build minimal `FROM mondedie/flarum`. Conservez `custom` — `prebuilt` contourne entièrement le mécanisme d'argument de build `FLARUM_VERSION`. |
| `container_image` | `""` | Laissez vide ; `Flarum_Common` fournit l'image construite. |
| `cpu_limit` | `1000m` | 1 vCPU pour nginx + php-fpm. |
| `memory_limit` | `2Gi` | Minimum d'environ 512Mi imposé par le plancher de l'environnement d'exécution gen2. |
| `min_instance_count` | `0` | Mise à zéro par défaut — diffère du `min=1` de la variante GKE. |
| `max_instance_count` | `1` | Conservez `1` sauf si le partage NFS/base de données entre plusieurs instances a été vérifié. |
| `container_port` | `8888` | mondedie/flarum sert nginx + php-fpm sur le port 8888. |
| `execution_environment` | `gen2` | Requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Remplacement propre à Cloud Run** de la valeur par défaut `true` de `Flarum_Common` — Flarum se connecte en TCP direct sur IP privée, sauf si vous passez cette valeur à `true` pour le volume de socket Unix de l'Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base mondedie/flarum dans Artifact Registry pour Cloud Build. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `container_protocol` | `http1` | `h2c` est disponible si l'application prend en charge HTTP/2 en clair. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence des conventions ; non référencée par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public au forum. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918 — suffisant pour la connexion TCP par défaut à la base de données sur IP privée. |
| `enable_iap` | `false` | Exige une connexion Google. Bloque l'accès anonyme/public au forum. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires, par ex. un `FORUM_URL` remplacé. Ne définissez pas `DB_HOST`/`DB_PORT`/`DB_PREF`/`FLARUM_ADMIN_*` ici — ils sont gérés par le module. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et ciblage de l'instance NFS {#group-9--custom-sql-scripts--nfs-instance-targeting}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un
bucket GCS après le provisionnement. `nfs_instance_name` / `nfs_instance_base_name`
permettent de cibler ou de nommer une VM GCE NFS existante au lieu de s'appuyer sur la
découverte automatique. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket GCS supplémentaire — créé en plus (et non à la place) du bucket `flarum-assets` de `Flarum_Common`. |
| `enable_nfs` | `true` | NFS est activé par défaut afin que les avatars/pièces jointes téléversés soient conservés et partagés. |
| `nfs_mount_path` | `/flarum/app/public/assets` | Emplacement où Flarum stocke les ressources téléversées par les utilisateurs. |
| `gcs_volumes` | `[]` | Aucun bucket n'est monté dans le conteneur par défaut ; ajoutez une entrée pour utiliser réellement `flarum-assets` ou `data` comme montage de système de fichiers. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Flarum_Common` ; n'a d'importance que s'il est explicitement remplacé. |
| `db_name` | `flarum` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `flarum` | Utilisateur de la base de données applicative. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé / `90` | Rotation du mot de passe de la base de données. |

Plusieurs variables miroirs du socle dans ce groupe (`application_database_name`,
`application_database_user`, `db_password_env_var_name`,
`db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`,
`db_port_env_var_name`, `service_url_env_var_name`, `sql_instance_name`,
`sql_instance_base_name`, `enable_mysql_plugins`, `mysql_plugins`,
`enable_postgres_extensions`, `postgres_extensions`) sont déclarées par souci de
cohérence des conventions mais ne sont pas transmises par `main.tf` — les noms de
variables d'environnement `DB_USER` / `DB_NAME` / `DB_PASS` qu'attend l'image mondedie
sont codés en dur directement, et non tirés de ces variables.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Transmis au socle — définissez ici, si nécessaire, des jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP sur le port 8888, 30s de délai initial, fenêtre de 20×15s | Sonde de démarrage. Fenêtre de grâce généreuse pour l'installateur du premier démarrage. |
| `liveness_probe` | HTTP `/` , délai initial de 300s | Sonde de vivacité — délai de cinq minutes pour éviter de tuer le conteneur en pleine installation. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut, activez-le explicitement pour le mettre en service. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 15 — Réseau {#group-15--networking}

`network_name` est déclarée par souci de cohérence des conventions mais n'est pas
transmise par `main.tf` — le réseau VPC est toujours découvert automatiquement.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend de cache d'objets Redis facultatif. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS partagé (nécessite `enable_nfs = true` ou un serveur NFS détectable). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

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
| `storage_buckets` | Buckets Cloud Storage créés (`flarum-assets` et `data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, `enable_redis = true` avec un `redis_host` vide et aucun serveur NFS détectable, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Choisir un moteur autre que MySQL casse l'installateur et toutes les requêtes. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend toutes les données orphelines. |
| `container_image_source` | `custom` | Critique | Passer à `prebuilt` contourne le mécanisme d'argument de build `FLARUM_VERSION` sur lequel ce module s'appuie pour épingler le tag de l'image de base mondedie. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `FORUM_URL` (injecté automatiquement) | URL publique réelle | Élevé | Si vous ajoutez un domaine personnalisé ou un équilibreur de charge, un `FORUM_URL` non concordant casse les liens absolus, les URL des ressources et les redirections. |
| `enable_cloudsql_volume` | `false` (TCP) ou `true` (socket) — choisissez délibérément | Élevé | Laissé à sa valeur par défaut avec des modifications restrictives de `vpc_egress_setting`/du pare-feu, le TCP direct sur IP privée vers Cloud SQL peut être bloqué ; passer à `true` exige que le chemin du socket soit effectivement monté. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les avatars/pièces jointes téléversés éphémères — perdus au redémarrage du conteneur ou lors de la mise à zéro. |
| `max_instance_count` | `1` | Élevé | Dépasser 1 sans comportement vérifié du stockage partagé et des verrous expose à des sessions fragmentées et à des conflits de verrous NFS/base de données. |
| `enable_iap` | uniquement si l'accès public n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les visiteurs anonymes du forum. |
| `FLARUM_ADMIN_PASS` (généré automatiquement) | À récupérer avant la première connexion | Moyen | Ne pas le connaître vous empêche d'accéder au premier compte administrateur jusqu'à sa réinitialisation via la base de données. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | N/A | Moyen | Ces variables sont inertes — les modifier ne change ni le comportement de PHP ni les limites de téléversement dans le conteneur déployé. |
| `gcs_volumes` (vide par défaut) | Ajouter une entrée pour utiliser réellement un bucket | Moyen | Les buckets `flarum-assets` et `data` sont créés et facturés mais ne servent à rien s'ils ne sont pas explicitement montés. |
| `min_instance_count` | `1` pour un forum toujours joignable | Moyen | La mise à zéro (`0`, la valeur par défaut) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité. |
| `memory_limit` | `2Gi` | Moyen | Sous-dimensionner PHP-FPM sous charge expose à des arrêts pour manque de mémoire (OOM). |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention conforme. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Flarum,
partagée avec la variante GKE — l'identifiant d'administration, l'amorçage de la base
de données, le build de l'image de conteneur, les paramètres de base et les valeurs
par défaut des sondes de santé — est décrite dans
**[Flarum_Common](Flarum_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Flarum sur Cloud Run](../labs/Flarum_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Flarum sur GKE Autopilot](Flarum_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Flarum Common — Configuration applicative partagée](Flarum_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Fider sur Google Cloud Run](Fider_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md), [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md), [Rallly sur Google Cloud Run](Rallly_CloudRun.md) dans la solution **Community & Voice of Customer**.
