---
title: "Maybe Finance sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Maybe Finance sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/MaybeFinance_CloudRun.md @ 15fd4c7 sha256:0d0fc3ddc8d6 -->

# Maybe Finance sur Google Cloud Run {#maybe-finance-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MaybeFinance_CloudRun.png" alt="Maybe Finance sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Maybe (Maybe Finance) est une alternative open source auto-hébergée à Mint/Monarch
pour la gestion des finances personnelles et du patrimoine — budgétisation, suivi de la valeur nette,
catégorisation des transactions et agrégation multi-comptes, basée sur Ruby on
Rails. Ce module déploie Maybe sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Maybe et sur la manière de les explorer et de les
exploiter à partir de la console Google Cloud et de la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité de service, ingress
et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Maybe s'exécute comme un conteneur Rails/Puma unique sur Cloud Run v2, avec un
processus de job en arrière-plan Sidekiq démarré à côté de lui dans le même conteneur
par le point d'entrée cloud. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut ; Sidekiq s'exécute comme un processus en arrière-plan dans le même conteneur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — une garde au moment de la planification n'accepte que `POSTGRES_13`/`14`/`15` (ou `NONE`) ; MySQL est rejeté |
| Jobs en arrière-plan et UI en temps réel | Redis (via la VM NFS partagée, ou un hôte explicite) | Obligatoire — une précondition au moment de la planification échoue si `enable_redis = false` ; alimente Sidekiq (synchronisation de compte, traitement d'importation, notifications) |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/rails/storage` ; également la source par défaut de l'adresse IP de l'hôte Redis |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est automatiquement provisionné par `MaybeFinance_Common` ; la variable `storage_buckets` par défaut ajoute un bucket `data` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré (clé de session/chiffrement Rails) ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` par défaut à `POSTGRES_15`
  et une précondition au moment de la planification (`validation.tf`) rejette tout sauf
  `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas pris en charge.
- **Redis est obligatoire, pas facultatif.** Une précondition au moment de la planification échoue
  directement si `enable_redis = false`. Lorsque `redis_host` est laissé vide,
  `enable_nfs` doit rester `true` afin que l'adresse IP du serveur NFS partagé soit utilisée comme
  hôte Redis.
- **Cloud SQL est atteint via TCP IP privée, pas un socket, par défaut.**
  Contrairement à la plupart des applications Common-module, `enable_cloudsql_volume` par défaut à
  **`false`** ici : le pilote `pg` de Rails ne peut pas analyser le DSN de socket Unix de Cloud SQL,
  donc le module ignore le sidecar Auth Proxy et se connecte via l'IP privée de l'instance
  à la place. Le point d'entrée cloud mappe les `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` de la Fondation
  sur les variables d'environnement discrètes `DB_HOST`/`DB_PORT`/`POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` de Maybe
  et définit `PGSSLMODE=require` (Cloud SQL rejette le TCP IP privée non chiffré) ;
  si `enable_cloudsql_volume` est activé, `DB_HOST` devient un répertoire de socket
  et le point d'entrée revient à `DB_IP` sur TCP au lieu
  d'essayer d'utiliser directement le chemin du socket.
- **La mise à l'échelle à zéro est la valeur par défaut (`min_instance_count = 0`,
  `cpu_always_allocated = false`).** Il s'agit d'une valeur par défaut axée sur les coûts, mais cela
  signifie que le worker Sidekiq co-localisé ne s'exécute que tant qu'une instance est
  active — définissez `min_instance_count = 1` et `cpu_always_allocated = true`
  pour que les jobs en arrière-plan (synchronisation de compte, traitement d'importation,
  notifications) s'exécutent en continu, correspondant aux valeurs par défaut de la variante GKE.
- **Conteneur web + worker combiné, pas un sidecar.** Le point d'entrée cloud
  démarre `bundle exec sidekiq` en arrière-plan puis `exec` le serveur web Rails
  au premier plan du *même* conteneur — Maybe n'est pas
  déployé avec un worker `additional_services` séparé. Si `REDIS_URL`
  est vide, le point d'entrée ignore le démarrage de Sidekiq entièrement plutôt que de
  planter.
- **`SECRET_KEY_BASE` est généré une seule fois** par `MaybeFinance_Common` et stocké
  dans Secret Manager, partagé identiquement par les processus web et Sidekiq.
  Rails l'utilise pour signer les sessions/cookies et pour dériver la clé qui chiffre
  les colonnes chiffrées d'ActiveRecord.
- **Le schéma est créé par un job d'initialisation, pas au démarrage.** Le
  job `maybefinance-migrate` exécute `rails db:prepare` pendant l'apply ; le
  point d'entrée d'exécution n'exécute jamais de migrations.
- **`container_image_source = "custom"`.** Cloud Build construit une image wrapper légère
  `FROM ghcr.io/maybe-finance/maybe:<version>`. `application_version`
  par défaut à `"stable"` ; une requête `"latest"` est mappée au
  canal de publication `stable` via l'ARG de build `MAYBE_VERSION` spécifique à l'application (l'ARG de build générique `APP_VERSION` de la Fondation n'est intentionnellement pas utilisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource
sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Maybe (web + Sidekiq) {#a-cloud-run--the-maybe-service-web--sidekiq}

Maybe s'exécute comme un service Cloud Run v2 qui s'auto-adapte en fonction de la charge de requêtes entre
le nombre minimum et maximum d'instances. Le serveur web Rails/Puma et le
worker Sidekiq s'exécutent comme deux processus dans le même conteneur, partageant
`SECRET_KEY_BASE` et la connexion Redis. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs,
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution, et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Maybe stocke toutes les données de l'application (comptes, transactions, budgets, utilisateurs) dans
une instance gérée de Cloud SQL pour PostgreSQL 15. Contrairement à la variante GKE (qui
atteint Cloud SQL via un sidecar Auth Proxy en boucle locale), le service Cloud Run
se connecte via l'**IP privée de l'instance avec `sslmode=require`** —
`enable_cloudsql_volume` par défaut `false` car Rails ne peut pas analyser le
DSN de type socket que le proxy présenterait autrement. Lors du premier déploiement, le
job `db-init` crée la base de données et l'utilisateur de l'application, accorde le rôle d'application
`cloudsqlsuperuser` (afin que la propre migration de Maybe puisse créer des extensions Postgres
sans accès superutilisateur), et pré-crée l'extension `pgcrypto` ;
`maybefinance-migrate` exécute ensuite `rails db:prepare`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (NFS) et Redis {#c-cloud-filestore-nfs--redis}

**Cloud Filestore (NFS)** est monté à `/rails/storage`
(`enable_nfs = true` par défaut) afin que les pièces jointes téléchargées persistent entre
les révisions. Maybe nécessite également **Redis**, qui est obligatoire — une précondition
au moment de la planification bloque `enable_redis = false`. Lorsque `redis_host` est laissé vide,
le `REDIS_HOST` injecté se résout à l'IP du serveur NFS partagé (la VM NFS
co-héberge Redis dans la convention de plateforme de ce dépôt), c'est pourquoi `enable_nfs`
doit rester `true` à moins qu'un `redis_host` explicite ne soit fourni.

> **Sidekiq a besoin de Redis 6.2 ou plus récent, et le Redis hébergé sur NFS est 6.0.** Le Redis partagé sur la
> VM NFS exécute la version 6.0.16, et Sidekiq 7 refuse de démarrer avec elle. L'interface web fonctionne toujours (le
> point d'entrée met Sidekiq en arrière-plan), donc le déploiement semble sain alors qu'aucun job en arrière-plan ne s'exécute.
> Pointez `redis_host` vers une instance Redis 6.2+ — par exemple Memorystore, via `create_redis = true`
> dans Services_GCP, qui provisionne Redis 7.2.

- **Console :** Filestore → Instances ; Compute Engine → Instances de VM (la VM NFS, si
  elle exécute également Redis).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la découverte/provisionnement NFS et les mécanismes d'injection Redis.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **`storage`** est provisionné automatiquement par `MaybeFinance_Common`,
et la variable `storage_buckets` par défaut ajoute un deuxième bucket **`data`**.
Aucun n'est monté dans le système de fichiers du conteneur par défaut — `gcs_volumes`
est vide par défaut — ils existent donc en tant que stockage provisionné mais sont inertes
jusqu'à ce qu'ils soient explicitement configurés.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Maybe est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (`secret-<prefix>-maybefinance-secret-key-base`),
une valeur aléatoire de 64 caractères partagée par le processus web Rails et le
worker Sidekiq. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~maybefinance"
  gcloud secrets versions access latest --secret=<secret-key-base-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings
= "all"`). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN,
et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs de conteneur (`RAILS_LOG_TO_STDOUT = "true"`) sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Maybe Finance {#3-maybe-finance-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via TCP IP privée (`sslmode=require`),
  crée de manière idempotente la base de données et l'utilisateur de l'application, accorde les privilèges,
  accorde le rôle d'application `cloudsqlsuperuser` (les utilisateurs d'applications de Cloud SQL ne sont pas de vrais
  superutilisateurs, cela permet donc à la propre migration de Maybe de créer des extensions Postgres),
  et pré-crée `pgcrypto` comme mesure de précaution. Le job peut être réexécuté en toute sécurité.
- **La migration de schéma est un job d'initialisation séparé.** `maybefinance-migrate` exécute
  `bundle exec rails db:prepare` sur l'image Maybe construite (`image = null`
  dans sa spécification de job, il réutilise donc l'image et la chaîne d'outils construites pour l'application),
  dépend de la complétion de `db-init` en premier, et réessaie jusqu'à 3 fois
  (`max_retries = 3`, `timeout_seconds = 1200`, `memory_limit = 2Gi`).
- **Enregistrement de l'administrateur à la première exécution, pas un secret auto-créé.**
  `SELF_HOSTED = "true"` active l'interface utilisateur d'auto-hébergement de Maybe, qui permet au premier
  visiteur d'enregistrer le compte administrateur initial via l'interface web — il n'y a
  pas de secret de mot de passe administrateur auto-généré à récupérer.
  {/* TODO: verify whether a first-run invite/registration lock exists after the first admin is created */}
- **`SECRET_KEY_BASE` est immuable en pratique.** Il est généré une seule fois par
  `MaybeFinance_Common` et partagé par les processus web et Sidekiq. Le faire pivoter
  après le premier démarrage invalide les sessions existantes et rend
  les colonnes chiffrées d'ActiveRecord illisibles.
- **Le mappage des variables d'environnement de la base de données se fait dans le point d'entrée cloud, pas un DSN d'URL.** La
  plateforme injecte `DB_HOST` (l'IP privée de l'instance sur Cloud Run, puisque
  `enable_cloudsql_volume` par défaut `false`), `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`, et `DB_IP` ; le point d'entrée les mappe sur
  `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` (la convention Rails `config/database.yml` de Maybe) et définit `PGSSLMODE=require` car l'hôte résolu est une vraie IP privée, pas une boucle locale.
- **Câblage Redis.** `REDIS_URL` est construit à partir des `REDIS_HOST`/
  `REDIS_PORT`/`REDIS_AUTH` injectés s'il n'est pas déjà défini. Si `REDIS_URL` est vide
  (Redis inaccessible), le point d'entrée ignore complètement le démarrage de Sidekiq —
  les jobs en arrière-plan cessent silencieusement de s'exécuter au lieu de faire planter le conteneur.
- **Les jobs en arrière-plan nécessitent une instance toujours chaude.** Parce que Sidekiq est
  démarré en cours de processus par le point d'entrée, il ne s'exécute que tant qu'une instance de conteneur
  est active. Avec les valeurs par défaut de CloudRun (`min_instance_count = 0`,
  `cpu_always_allocated = false`), les périodes de mise à l'échelle à zéro et la limitation du CPU
  entre les requêtes interrompent toutes deux le traitement des jobs en arrière-plan.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /up` avec une généreuse
  tolérance pour un démarrage lent (`initial_delay_seconds = 60`,
  `period_seconds = 15`, `failure_threshold = 30` — environ 8 minutes de
  marge). La sonde de vivacité est également **HTTP** `GET /up`
  (`initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`).
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <maybefinance-migrate-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement (le
tag `{{UIMeta group=N}}` dans la description de chaque variable dans `variables.tf`).
Seuls les paramètres spécifiques ou notables pour Maybe sont listés ; toute autre entrée
est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard
et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `maybefinance` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Maybe` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `stable` | Tag d'image `ghcr.io/maybe-finance/maybe` utilisé comme base de build personnalisé ; `latest` est mappé au canal de publication `stable` via `MAYBE_VERSION`. |

`application_display_name`/`application_description` sont des déclarations de miroir de Fondation inertes
(jamais transmises à l'appel de la Fondation) — l'identité effective provient de
`display_name`/`description` ci-dessus.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Image wrapper légère construite À PARTIR de l'image GHCR en amont. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Maybe recommande au moins 2 Gi. |
| `cpu_always_allocated` | `false` | Valeur par défaut de démarrage à froid axée sur les coûts. Définissez `true` (avec `min_instance_count >= 1`) pour que Sidekiq continue de traiter en continu. |
| `container_resources` | _(null)_ | Remplace `cpu_limit`/`memory_limit` lorsqu'il est défini. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut — diffère de la variante GKE `min=1` ; arrête le worker Sidekiq co-localisé entre les requêtes. |
| `max_instance_count` | `5` | Plafond de coût. |
| `container_port` | `3000` | Port natif Rails/Puma de Maybe. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Désactivé par défaut pour Maybe** — Rails ne peut pas analyser le DSN du socket Cloud SQL, donc l'application se connecte via TCP IP privée à la place. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Pertinent uniquement si `enable_cloudsql_volume` est activé. |
| `container_protocol` | `http1` | Version du protocole HTTP. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |
| `enable_image_mirroring` | `true` | Toujours vrai — l'image de base GHCR est mise en miroir dans Artifact Registry avant la construction du wrapper. |
| `container_build_config` | `{ enabled = true }` | Paramètres de build ; l'ARG de build `MAYBE_VERSION` est défini à partir de `application_version` dans `MaybeFinance_Common`, non exposé comme une variable de niveau supérieur. |
| `additional_services` / `additional_containers` | `[]` | Non utilisé par Maybe (Sidekiq s'exécute en cours de processus, pas comme un sidecar ou un service séparé). |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accessibilité publique pour l'interface utilisateur web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `network_name` | `""` | Découvre automatiquement le réseau VPC géré par Services_GCP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs Rails/Maybe de base (`RAILS_ENV`, `SELF_HOSTED`, `RAILS_LOG_TO_STDOUT`, etc.) sont définies automatiquement par `MaybeFinance_Common`. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS
après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket GCS supplémentaire au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Les pièces jointes persistent et sont partagées entre les révisions ; également la source par défaut de l'IP de l'hôte Redis. |
| `nfs_mount_path` | `/rails/storage` | Où Maybe stocke les pièces jointes téléchargées. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(découverte automatique)_ | Nommage de VM NFS existante/intégrée. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2) ; non utilisé par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Une précondition au moment de la planification restreint cela à `POSTGRES_13`/`14`/`15`/`NONE` ; MySQL est rejeté. |
| `db_name` | `maybefinance` | Nom effectif de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `maybefinance` | Utilisateur effectif de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Désactivé — `db-init.sh` pré-crée déjà `pgcrypto` via l'octroi `cloudsqlsuperuser`. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Inutilisé — Maybe est uniquement PostgreSQL. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Déclarations de miroir de Fondation **inertes** (jamais transmises à `main.tf`) — le vrai nom/utilisateur de la base de données proviennent de `db_name`/`db_user` ci-dessus via `MaybeFinance_Common`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs `db-init` + `maybefinance-migrate` intégrés. |
| `cron_jobs` | `[]` | Non transmis — Maybe n'a pas de tâches récurrentes planifiées par la plateforme ; son propre travail en arrière-plan s'exécute en cours de processus via Sidekiq. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, délai de 60s, 30 tentatives | Sonde de démarrage. Prévoir environ 8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/up`, délai de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/up` | Sondes structurées alternatives. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut, activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — une précondition au moment de la planification échoue si définie à `false`. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée sur Cloud Run) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `maybefinance-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_CloudRun](App_CloudRun.md), plus ses propres
> gardes `validation.tf` (`min` ≤ `max`, Redis obligatoire, un hôte Redis doit être
> résolvable, `database_type` uniquement PostgreSQL, pas d'Auth Proxy sans une vraie
> base de données). Une configuration invalide échoue à la **planification** avec une erreur claire et nommée
> avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou `13`/`14`) | Critique | Un moteur non PostgreSQL est rejeté au moment de la planification ; forcer un contournement de la garde casse l'installateur et chaque requête. |
| `enable_redis` | `true` | Critique | La précondition au moment de la planification bloque `false` directement — Maybe n'a pas de file d'attente de jobs en arrière-plan fonctionnelle sans Redis. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions et rend les colonnes chiffrées d'ActiveRecord illisibles. |
| `enable_cloudsql_volume` | `false` (Cloud Run) | Critique | L'activer change `DB_HOST` en un répertoire de socket que Rails ne peut pas analyser directement ; le point d'entrée revient à `DB_IP`, mais un `database_type = "NONE"` mal défini combiné à `enable_cloudsql_volume = true` est bloqué au moment de la planification car le sidecar proxy n'aurait aucune instance à laquelle se connecter. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais `enable_nfs` est désactivé et qu'aucun hôte n'est défini, la précondition au moment de la planification échoue ; si `enable_nfs` est désactivé après un déploiement fonctionnel, les pièces jointes téléchargées deviennent éphémères et l'hôte Redis peut devenir obsolète. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` pour la production | Élevé | Avec les valeurs par défaut axées sur les coûts (`0` / `false`), le worker Sidekiq co-localisé ne s'exécute que tant qu'une instance est active — la synchronisation de compte, le traitement d'importation et les notifications cessent silencieusement de se déclencher entre les requêtes et pendant les périodes de mise à l'échelle à zéro. |
| `memory_limit` | `4Gi` (par défaut) | Élevé | Le processus combiné Rails + Sidekiq est gourmand en mémoire sous les charges de travail d'importation/synchronisation ; Maybe recommande au moins 2 Gi. |
| `SELF_HOSTED` (auto-injecté `"true"`) | Enregistrer l'administrateur rapidement | Élevé | Laisser le déploiement accessible avant qu'un administrateur ne s'enregistre permet à quiconque ayant l'URL de revendiquer le compte administrateur initial. |
| `ingress_settings` | `all` | Moyen | Le définir à `internal` bloque l'accès à l'interface utilisateur web pour toute personne extérieure au VPC. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur d'administration est publiquement accessible sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Maybe
partagée avec la variante GKE se trouve dans le module `MaybeFinance_Common` — voir
**[MaybeFinance_Common](MaybeFinance_Common.md)** pour les secrets, le démarrage de la base de données,
le comportement du point d'entrée, les sondes de santé et le stockage.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Maybe Finance sur Cloud Run](../labs/MaybeFinance_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Maybe Finance sur GKE Autopilot](MaybeFinance_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [MaybeFinance Common — Configuration d'application partagée](MaybeFinance_Common.md) — la configuration partagée par les deux cibles de déploiement.
