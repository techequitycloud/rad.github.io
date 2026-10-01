---
title: "ClassicPress sur Google Cloud Run"
description: "Référence de configuration pour déployer ClassicPress sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/ClassicPress_CloudRun.md @ 3055034 sha256:a85ed6ec847e -->

# ClassicPress sur Google Cloud Run {#classicpress-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ClassicPress_CloudRun.png" alt="ClassicPress sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ClassicPress est un CMS gratuit, open source et orienté entreprise — un fork léger de
WordPress 4.9.x qui préserve l'expérience d'édition classique (antérieure à Gutenberg),
avec extensions, thèmes, médiathèque et API REST. Ce module déploie ClassicPress sur
**Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise ClassicPress et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toute application Cloud Run — identité du service, entrée
et équilibrage de charge, scaling et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

ClassicPress s'exécute dans un unique conteneur PHP/Apache construit à partir d'une image
personnalisée minimale `FROM classicpress/classicpress`. Le déploiement assemble un
ensemble restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut ; la mise à l'échelle à zéro (`min_instance_count = 0`) est le comportement par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Fixe — `ClassicPress_Common` code en dur `database_type = "MYSQL_8_0"` |
| Persistance des fichiers | Cloud Filestore (NFS), facultatif | Monté par défaut sur `/var/www/html/wp-content` (`enable_nfs = true`) — consultez la [section 3](#3-classicpress-application-behaviour) pour savoir comment cela assure la persistance des téléversements, extensions et thèmes |
| Stockage d'objets | Cloud Storage | Un bucket `data` (issu de la valeur par défaut `storage_buckets` de la variante) et un bucket `classicpress-uploads` (issu de `ClassicPress_Common`) sont provisionnés automatiquement ; aucun n'est monté dans le conteneur par défaut |
| Secrets | Secret Manager | `CLASSICPRESS_SALT_SEED` généré automatiquement (dont dérivent les 8 clés et sels d'authentification de type WordPress) ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire et codé en dur.** Le `config` de `ClassicPress_Common`
  définit directement `database_type = "MYSQL_8_0"` ; la variable `database_type` propre
  à la variante est en grande partie décorative — la remplacer casse le job `db-init` et
  le point d'entrée propres à MySQL. Laissez-la à sa valeur par défaut.
- **Build personnalisé, pas d'image préconstruite.** `container_image_source` vaut
  `"custom"` par défaut — Cloud Build produit une image minimale
  `FROM classicpress/classicpress` qui greffe un script d'entrée intermédiaire
  associant les variables `DB_*` injectées par le socle aux variables
  `CLASSICPRESS_DB_*` de ClassicPress et dérivant des sels d'authentification stables.
  L'image amont d'origine n'est jamais déployée directement.
- **Cloud SQL est joint par défaut en TCP sur IP privée**, et non via un socket Unix.
  `enable_cloudsql_volume` vaut `false` par défaut (la variante impose explicitement
  cette valeur dans la configuration de l'application, en remplaçant ce que
  `ClassicPress_Common` pourrait définir par ailleurs) ; le point d'entrée construit
  `CLASSICPRESS_DB_HOST` à partir de `DB_IP:DB_PORT`. MySQL sur la plage privée de
  Cloud SQL ne nécessite pas de SSL. Définissez `enable_cloudsql_volume =
  true` pour utiliser plutôt le socket de l'Auth Proxy.
- **L'installation *de base* de ClassicPress réside sur le système de fichiers éphémère
  du conteneur, mais les téléversements, extensions et thèmes persistent via NFS.**
  Cloud Run ne dispose d'aucun volume bloc persistant par instance équivalent au PVC de
  StatefulSet de GKE ; le point d'entrée amont recopie donc l'application de base
  ClassicPress dans `/var/www/html` au premier démarrage de *chaque* instance de
  conteneur — ce qui est attendu, puisque ces fichiers de base sont livrés avec l'image
  et n'ont pas besoin de persistance. `enable_nfs = true` monte par défaut Filestore sur
  `/var/www/html/wp-content`, et la logique de copie du point d'entrée amont ignore
  explicitement un répertoire `wp-content` existant au lieu de l'écraser ; les médias
  téléversés, les extensions et les thèmes installés sous `wp-content` sont *donc*
  conservés lors des démarrages à froid, des redéploiements et des remplacements
  d'instance — c'est ainsi que la persistance est réellement assurée, il ne s'agit pas
  d'une lacune.
- **`CLASSICPRESS_SALT_SEED` est généré automatiquement** et stocké dans Secret
  Manager ; le point d'entrée en dérive de manière déterministe les 8 valeurs
  `AUTH_KEY`/`SALT` de type WordPress, de sorte que les cookies et les sessions survivent
  aux redémarrages et concordent entre toutes les instances démarrées à froid, sans
  persister l'état de `wp-config.php`.
- **Pas d'installation automatique — la première connexion est manuelle.**
  `ClassicPress_Common` ne génère aucun secret de mot de passe administrateur et ne
  définit aucun indicateur d'installation automatique. ClassicPress crée son schéma et
  son compte administrateur via son propre programme d'installation web au premier
  lancement, une fois que `db-init` a provisionné la base de données vide.
- **Deux buckets GCS sont créés mais inutilisés par défaut.** La valeur par défaut
  `storage_buckets` de la variante (`data`) et le préréglage de `ClassicPress_Common`
  (`classicpress-uploads`) sont tous deux créés (avec des suffixes de nom différents,
  ils n'entrent donc pas en conflit) — aucun n'est branché comme montage `gcs_volumes`,
  sauf si vous en ajoutez un.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service ClassicPress {#a-cloud-run--the-classicpress-service}

ClassicPress s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la
charge des requêtes entre le nombre minimal et le nombre maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions
pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

ClassicPress stocke toutes les données de l'application (articles, pages, utilisateurs,
options, paramètres des extensions et des thèmes) dans une instance gérée Cloud SQL for
MySQL 8.0. Par défaut, le service se connecte en **TCP sur IP privée**
(`enable_cloudsql_volume = false`) ; Cloud SQL MySQL accepte le TCP non chiffré sur la
plage privée, aucune configuration SSL n'est donc nécessaire. Lors du premier
déploiement, un Job d'initialisation (`db-init`) crée la base de données et l'utilisateur
de l'application, puis vérifie que l'utilisateur applicatif peut se connecter.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes,
  les flags et les métriques.
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

Deux buckets Cloud Storage sont provisionnés par défaut : un bucket `data` (déclaré par
la valeur par défaut `storage_buckets` propre à cette variante) et un bucket
`classicpress-uploads` (déclaré par `ClassicPress_Common`). Aucun n'est monté dans le
conteneur par défaut — la persistance des médias, extensions et thèmes est assurée par le
montage NFS sur `/var/www/html/wp-content` (voir la [section D](#d-cloud-filestore-nfs)) ;
un montage `gcs_volumes` n'est une alternative que si vous préférez un stockage adossé à
GCS plutôt qu'à Filestore.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/        # bucket names are in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse et les options CMEK.

### D. Cloud Filestore (NFS) {#d-cloud-filestore-nfs}

`enable_nfs = true` est la valeur par défaut ; elle monte une instance Filestore partagée
sur `/var/www/html/wp-content`. ClassicPress (un fork de WordPress) lit et écrit les
médias téléversés, les extensions installées et les thèmes sous `wp-content`, et la
logique de copie au premier démarrage du point d'entrée amont ignore explicitement un
répertoire `wp-content` existant ; ce montage est donc le moyen confirmé d'assurer la
persistance lors des redémarrages, des redéploiements et des démarrages à froid.
`enable_nfs = true` est aussi ce qui fait que `redis_host = ""` se replie sur l'IP du
Redis hébergé sur le serveur NFS (voir le groupe 21).

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la découverte NFS et les mécanismes de
montage.

### E. Secret Manager {#e-secret-manager}

Un secret propre à ClassicPress est généré automatiquement et stocké dans Secret
Manager : `CLASSICPRESS_SALT_SEED`, une graine aléatoire de 64 caractères à partir de
laquelle le point d'entrée dérive les 8 valeurs `AUTH_KEY`/`SECURE_AUTH_KEY`/
`LOGGED_IN_KEY`/`NONCE_KEY` de type WordPress et les valeurs `SALT` correspondantes
(SHA-256 de la graine suivie d'un suffixe fixe propre à chaque clé). Le mot de passe de
la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~classicpress"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings =
"all"`). Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et
Cloud Armor peut s'y ajouter ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud Run
et de Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application ClassicPress {#3-classicpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`, `mysql:8.0-debian`) attend que la connectivité soit
  établie (socket Unix si `enable_cloudsql_volume = true`, sinon TCP via `DB_IP`), crée
  de manière idempotente la base de données et l'utilisateur de l'application avec
  `CREATE USER IF NOT EXISTS` / `GRANT ALL PRIVILEGES`, vérifie que l'utilisateur
  applicatif peut se connecter et arrête proprement le sidecar Cloud SQL Auth Proxy s'il
  a été démarré. Le job peut être réexécuté sans risque (`execute_on_apply = true`,
  `max_retries = 3`).
- **Pas de job de migration distinct — installation manuelle au premier lancement.** Il
  n'existe pas d'indicateur d'installation automatique pour ClassicPress. Une fois que
  `db-init` a provisionné la base de données vide, ClassicPress crée son propre schéma et
  son compte administrateur via le programme d'installation web du premier lancement
  (`/wp-admin/install.php` dans l'image amont). Ouvrez l'URL du service après le premier
  déploiement et terminez l'installation pour définir le nom d'utilisateur, le mot de
  passe et l'adresse e-mail de l'administrateur — aucun secret de mot de passe
  administrateur n'est généré.
- **Alias des variables d'environnement de base de données en TCP.** Le socle injecte
  `DB_IP` (l'IP privée de Cloud SQL sur Cloud Run), `DB_HOST`, `DB_PORT`, `DB_NAME`,
  `DB_USER` et `DB_PASSWORD` ; ClassicPress lit `CLASSICPRESS_DB_*`. Le script
  `entrypoint.sh` greffé construit `CLASSICPRESS_DB_HOST` sous la forme
  `<DB_IP>:<DB_PORT>` (ou sous la forme `localhost:<socket>` si un répertoire de socket
  Cloud SQL est trouvé avec `enable_cloudsql_volume = true`) et crée les autres alias,
  avant de passer la main au script amont `docker-entrypoint.sh`.
- **Les clés et sels d'authentification sont dérivés, et non stockés individuellement.**
  `CLASSICPRESS_SALT_SEED` est le seul secret généré ; le point d'entrée calcule les 8
  valeurs `CLASSICPRESS_AUTH_KEY` / `..._SALT` sous la forme `sha256(seed-<key-name>)`,
  de sorte que chaque redémarrage et chaque instance démarrée à froid s'accordent sur les
  mêmes valeurs sans persister l'état de `wp-config.php` — les sessions et les cookies de
  connexion restent valides malgré le renouvellement des instances, même si le système de
  fichiers ne l'est pas.
- **Les fichiers *de base* de l'installation résident sur le système de fichiers
  éphémère du conteneur ; `wp-content` persiste via NFS.** Le script amont
  `docker-entrypoint.sh` écrit `wp-config.php` et copie l'application ClassicPress dans
  `/var/www/html` au premier démarrage de chaque instance de conteneur. Avec
  `enable_nfs = true` (la valeur par défaut), Filestore est monté directement sur
  `/var/www/html/wp-content`, et la logique de copie ignore explicitement un répertoire
  `wp-content` existant au lieu de l'écraser — les médias téléversés ainsi que les
  extensions et thèmes installés via wp-admin survivent donc à chaque recyclage de
  l'instance (redéploiement, mise à l'échelle à zéro puis remontée, remplacement
  d'instance). Seuls les fichiers de base situés en dehors de `wp-content` sont recopiés
  à chaque fois, ce qui est attendu puisqu'ils sont livrés avec l'image.
- **Le chemin de montage NFS est le mécanisme de persistance confirmé.**
  `enable_nfs = true` monte par défaut Filestore sur `/var/www/html/wp-content`.
  ClassicPress (un fork de WordPress) lit et écrit les médias téléversés, les extensions
  et les thèmes sous `wp-content`, relativement à sa racine web, et la logique du point
  d'entrée amont qui ignore la copie d'un répertoire `wp-content` existant est
  précisément ce qui rend sûr et efficace le montage de NFS à cet endroit — c'est ainsi
  que la persistance est réellement assurée, il ne s'agit pas d'un stockage superflu ou
  inutilisé.
- **`php_memory_limit`, `upload_max_filesize` et `post_max_size` sont acceptés mais ne
  sont actuellement reliés à aucun paramètre PHP.** Ces variables sont transmises à
  `ClassicPress_Common`, mais son `config.environment_variables` ne définit aucune
  variable d'environnement `PHP_*`/`UPLOAD_MAX_FILESIZE`/`POST_MAX_SIZE` correspondante
  que l'image amont pourrait lire — les modifier n'a aujourd'hui aucun effet observé sur
  le conteneur déployé.
- **Redis est facultatif et désactivé par défaut.** Lorsque `enable_redis = true`,
  laisser `redis_host` vide permet au socle de se replier sur l'IP du Redis hébergé sur
  le serveur NFS (nécessite `enable_nfs = true`) ; définir `redis_host` explicitement
  dirige plutôt ClassicPress vers une instance Redis/Memorystore externe.
- **Chemins de santé.** La sonde de démarrage est une sonde **TCP** sur le port 80 (avec
  un `failure_threshold = 20` généreux, laissant au point d'entrée propre à l'image amont
  le temps de remplir le répertoire `/var/www/html` vide au premier démarrage d'une
  nouvelle instance). La sonde de vivacité est une requête **HTTP** `GET /` avec un délai
  initial de 300 secondes — une réponse 200 (site installé) comme une redirection 302
  vers le programme d'installation (nouvelle installation) sont considérées comme saines.
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
déploiement (selon leur tag `{{UIMeta group=N}}`, et non selon les commentaires de
section du fichier `.tf`, qui sont parfois désynchronisés des tags). Seuls les paramètres
propres à ClassicPress ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `classicpress` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `ClassicPress` | Nom lisible affiché dans la console. |
| `description` | `ClassicPress wiki on Cloud Run` | Description du service. |
| `application_version` | `latest` | Correspond au tag de l'image `classicpress/classicpress` via l'argument de build propre à l'application `CLASSICPRESS_VERSION` (`latest` est résolu en `php8.3-apache` ; l'argument de build générique `APP_VERSION` injecté par le socle écraserait sinon silencieusement un argument du même nom). |
| `php_memory_limit` | `512M` | Accepté mais n'est actuellement relié à aucun paramètre PHP — voir la section 3. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | Même réserve que ci-dessus ; validés au moment du plan (`upload_max_filesize ≤ post_max_size`) mais pas appliqués par ailleurs. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image minimale `FROM classicpress/classicpress` avec le script d'entrée intermédiaire greffé — obligatoire, l'image d'origine ne peut pas créer seule les alias `DB_*`. |
| `cpu_limit` | `1000m` | CPU par instance ; ClassicPress avec MySQL nécessite au moins 1 vCPU. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum d'environ 512Mi pour PHP/Apache. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro — mais consultez la réserve sur le système de fichiers éphémère à la section 3 avant de vous y fier en production. |
| `max_instance_count` | `1` | Conservez `1` — le système de fichiers du conteneur est propre à chaque instance et n'est pas partagé. |
| `container_port` | `80` | ClassicPress s'exécute sur Apache, port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | La valeur par défaut est le TCP sur IP privée ; définissez `true` pour utiliser plutôt le socket Unix de Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Déclarée pour la parité des conventions ; non référencée par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour le front-end du CMS et l'interface d'administration. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google pour l'ensemble du service (y compris le site public). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires, fusionnés avec les valeurs par défaut de `ClassicPress_Common` (`DB_PORT`, `CLASSICPRESS_TABLE_PREFIX=cp_`, `CLASSICPRESS_DB_CHARSET=utf8mb4`). |
| `secret_environment_variables` | `{}` | Table associant une variable d'environnement au nom d'un secret Secret Manager. `CLASSICPRESS_SALT_SEED` est injecté automatiquement et n'a pas besoin d'être défini ici. |
| `secret_propagation_delay` | `30` | Nombre de secondes à attendre après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatisées (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure un dump MySQL depuis GCS ou Google Drive lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry pour l'image construite. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket GCS supplémentaire, en plus du bucket `classicpress-uploads` propre à `ClassicPress_Common` (les deux sont créés ; aucun n'est monté par défaut). |
| `enable_nfs` | `true` | Activé par défaut, monté sur `/var/www/html/wp-content` — c'est ainsi qu'est assurée la persistance des téléversements, extensions et thèmes (voir la section 3). |
| `nfs_mount_path` | `/var/www/html/wp-content` | Chemin de montage dans le conteneur. La logique de copie du point d'entrée amont ignore un répertoire `wp-content` existant ; le montage à cet endroit est donc sûr. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2) ; ajoutez une entrée montée sur `/var/www/html/wp-content/uploads` pour une véritable persistance des médias. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Codé en dur par `ClassicPress_Common` ; modifier la variable ne change pas le moteur de base de données déployé. |
| `db_name` | `classicpress` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `classicpress` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Déclarées uniquement pour refléter les conventions — `main.tf` code en dur des alias vides pour cette variante, de sorte que les définir n'a aucun effet ; le point d'entrée propre à ClassicPress gère les alias `CLASSICPRESS_DB_*`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré de `ClassicPress_Common`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP port 80, `failure_threshold = 20` | Seuil généreux pour le remplissage de `/var/www/html` au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 300 s | Une réponse 200 comme une redirection 302 vers le programme d'installation sont considérées comme saines. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active le backend de cache d'objets de type WordPress de ClassicPress. |
| `redis_host` | `""` | Laissez vide pour vous replier sur l'injection `REDIS_HOST` propre au socle (l'IP du Redis de la VM NFS lorsque `enable_nfs = true`) ; définissez-le explicitement pour une instance Redis/Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
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
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (`data` et `classicpress-uploads`). |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation au moment du plan héritée.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur explicite et nommée avant la création de toute ressource. ClassicPress exécute également sa propre précondition (`validations.tf`) pour `upload_max_filesize ≤ post_max_size`.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Persistance des médias et extensions sur `/var/www/html/wp-content` | Conservez `enable_nfs = true` (la valeur par défaut) | Low | Avec `enable_nfs = true`, Filestore est monté sur `/var/www/html/wp-content` et la logique de copie du point d'entrée amont l'ignore au démarrage ; les médias téléversés et les extensions et thèmes installés via wp-admin survivent donc aux démarrages à froid. Désactiver `enable_nfs` supprime cette persistance — chaque instance démarrée à froid repartirait alors d'un `wp-content` vide. |
| `CLASSICPRESS_SALT_SEED` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critical | Sa rotation invalide tous les cookies signés et toutes les sessions connectées sur l'ensemble des instances. |
| `database_type` | Laisser la valeur par défaut (`MYSQL_8_0`) | Critical | Le job `db-init` et le point d'entrée de `ClassicPress_Common` sont propres à MySQL ; la valeur est codée en dur quelle que soit la variable, mais compter sur la variable pour choisir un moteur est une impasse. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et rend orphelines toutes les données. |
| `enable_backup_import` | `false` sauf pour une restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `max_instance_count` | `1` | Medium | `wp-content` (téléversements, extensions, thèmes) est partagé via le montage NFS, mais les fichiers de base de ClassicPress situés en dehors sont copiés indépendamment pour chaque instance ; dépasser 1 n'a pas été validé quant à la sûreté des écritures concurrentes sur `wp-content`. |
| Configuration de l'administrateur au premier lancement | Terminez `/wp-admin/install.php` rapidement après le déploiement | High | Tant que le programme d'installation n'a pas été exécuté, le site n'a ni schéma ni compte administrateur — aucun secret de mot de passe administrateur généré ne permet de le récupérer. |
| `enable_nfs` | `true` | Medium | Provisionne et facture une instance Filestore montée sur `/var/www/html/wp-content` — le mécanisme confirmé de persistance des téléversements, extensions et thèmes (voir la section 3). La désactiver supprime cette persistance. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | N'importe quelle valeur | Low | Ne sont actuellement reliés à aucun paramètre PHP — ne supposez pas que les modifier affecte les limites de téléversement ou la mémoire PHP du conteneur déployé. |
| `memory_limit` | `2Gi` | Medium | En dessous d'environ 512Mi, le conteneur PHP/Apache risque un OOM sous charge ou avec des extensions plus lourdes. |
| `min_instance_count` | `1` pour la production | Medium | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid pendant la recopie des fichiers de base dans `/var/www/html` ; les téléversements, extensions et thèmes sous `wp-content` ne sont pas affectés puisqu'ils persistent via NFS. |
| `enable_cloud_armor` | à activer pour la production | Medium | L'interface d'administration et le site public sont joignables sans protection WAF par défaut. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
scaling et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à ClassicPress,
partagée avec la variante GKE, réside dans le module `ClassicPress_Common` (aucun guide
autonome `ClassicPress_Common.md` n'existe encore dans cette documentation) ; voir aussi
[ClassicPress_GKE](ClassicPress_GKE.md) pour le comportement de la même application sur
un StatefulSet avec un PVC bloc par pod.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ClassicPress sur Cloud Run](../labs/ClassicPress_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [ClassicPress sur GKE Autopilot](ClassicPress_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [ClassicPress Common — Configuration applicative partagée](ClassicPress_Common.md) — la configuration partagée par les deux cibles de déploiement.
