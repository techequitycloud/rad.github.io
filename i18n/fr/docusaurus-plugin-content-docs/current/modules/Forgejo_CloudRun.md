---
title: "Forgejo sur Google Cloud Run"
description: "Référence de configuration pour déployer Forgejo sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Forgejo_CloudRun.md @ 3055034 sha256:cd68e9a68a02 -->

# Forgejo sur Google Cloud Run {#forgejo-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Forgejo_CloudRun.png" alt="Forgejo sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Forgejo est un service Git auto-hébergé, léger et géré par sa communauté — un
fork de Gitea — qui offre l'hébergement de dépôts, le suivi des tickets, les
pull requests, un exécuteur CI/CD intégré (Actions), la revue de code et un
registre de paquets, le tout à partir d'un unique binaire Go. Ce module déploie
Forgejo sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Forgejo et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Forgejo s'exécute sous la forme d'un unique binaire Go à l'intérieur d'une fine
surcouche de build personnalisée de l'image d'origine
`codeberg.org/forgejo/forgejo` : cette surcouche ajoute un point d'entrée de
plateforme (`/platform-entrypoint.sh`) qui compose la connexion à la base de
données à l'exécution, puis passe la main au point d'entrée propre à Forgejo sous
`s6`. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go sur le port 3000, 1 vCPU / 2Gi par défaut, mise à l'échelle automatique serverless ; `max_instance_count` vaut `1` par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Imposé en pratique — `db-init.sh` utilise `psql` ; la liste déroulante `database_type` propose MYSQL/NONE, mais ces options ne sont pas prises en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; les dépôts, les objets LFS et les pièces jointes résident sous le point de montage NFS (`/mnt/nfs`) |
| Stockage d'objets | Cloud Storage | Un bucket générique inutilisé, suffixé `data`, est provisionné par la valeur par défaut du socle — Forgejo lui-même ne stocke rien dans GCS |
| Secrets | Secret Manager | `SECRET_KEY` et `INTERNAL_TOKEN` générés automatiquement, ainsi que le mot de passe de la base de données, tous injectés directement comme variables d'environnement `GITEA__` |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur qui fonctionne réellement.** `database_type`
  vaut `POSTGRES_15` par défaut ; le script de la tâche `db-init` est entièrement
  écrit pour `psql`, si bien que choisir MySQL ou `NONE` casse la configuration
  de la base de données, même si les métadonnées de la variable les proposent.
- **Cloud SQL est joint par défaut en TCP direct sur IP privée, et non par un socket.**
  `enable_cloudsql_volume = false` par défaut pour ce module (contrairement à de
  nombreux autres modules CloudRun), si bien que le point d'entrée de plateforme
  voit un `DB_HOST` en IP privée et définit `GITEA__database__SSL_MODE=require`
  pour ce saut. Définissez `enable_cloudsql_volume = true` pour basculer plutôt
  vers le socket Unix du Cloud SQL Auth Proxy à `/cloudsql/<connection-name>`
  (`SSL_MODE=disable`).
- **NFS est activé par défaut**, monté sur `/mnt/nfs`
  (`GITEA__server__APP_DATA_PATH`) — c'est là que persistent les dépôts, les
  objets Git LFS et les pièces jointes. La valeur par défaut de ce module
  remplace la valeur par défaut interne `/data` du module `Forgejo_Common`.
- **`max_instance_count` vaut `1` par défaut.** Associé au stockage des dépôts
  sur NFS et à un unique rôle Postgres, cela évite les conflits entre écritures
  concurrentes sans recourir à une stratégie de déploiement `Recreate` de type
  Kubernetes (Cloud Run n'a pas de concept équivalent — une nouvelle révision ne
  reçoit du trafic qu'une fois ses vérifications de santé réussies, après quoi
  les instances de la révision précédente sont drainées).
- **Pas de tâche de migration distincte.** `GITEA__security__INSTALL_LOCK = "true"`
  court-circuite l'assistant d'installation web de Forgejo ; l'image
  `forgejo/forgejo` crée et migre son propre schéma au démarrage du conteneur,
  dans la base de données vide préparée par la tâche `db-init`.
- **Aucun compte administrateur n'est amorcé par Terraform.** Aucune tâche
  d'initialisation ne crée d'utilisateur administrateur Forgejo — consultez la
  [section 3](#3-forgejo-application-behaviour) pour les options côté opérateur.
- **`SECRET_KEY` et `INTERNAL_TOKEN` sont générés automatiquement** et stockés
  dans Secret Manager. Sur Cloud Run, il n'existe aucune restriction de CRD
  SecretSync (elle ne s'applique qu'à GKE) : ils sont donc injectés directement
  comme variables d'environnement `GITEA__security__` — aucune indirection par
  fichier monté par CSI n'est nécessaire.
- **`public_domain` / `public_url` valent `localhost` par défaut.** Même si le
  service reçoit une véritable URL `run.app` au moment du déploiement,
  `GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL` ne lui sont pas
  automatiquement synchronisées — définissez `public_domain` (et éventuellement
  `public_url`) sur le véritable nom d'hôte externe pour que les URL de clonage
  et les liens se résolvent correctement.
- **L'inscription libre est ouverte par défaut** (`GITEA__service__DISABLE_REGISTRATION = "false"`).
- **Redis est provisionné, mais n'est pas réellement câblé dans la configuration de Forgejo.**
  `enable_redis = true` par défaut et le socle injecte `REDIS_HOST` /
  `REDIS_PORT` dans le conteneur, mais `Forgejo_Common` ne définit aucune
  variable `GITEA__cache__*` / `GITEA__session__*` / `GITEA__queue__*` pour les
  exploiter — Forgejo se rabat sur ses valeurs par défaut intégrées pour le
  cache et les sessions, sauf si vous ajoutez vous-même ce câblage via
  `environment_variables`.
- **Git sur SSH n'est pas joignable.** Cloud Run n'achemine que le trafic HTTP(S)
  sur un unique port de conteneur (3000, HTTP). Le `sshd` interne de Forgejo
  (également supervisé par `s6`, d'après le Dockerfile) n'a aucun chemin vers
  l'extérieur sur cette plateforme — utilisez des URL de clonage `https://`, et
  non `git+ssh://`.
- **Le tag de l'image de base est piloté par un ARG de build propre à l'application.**
  L'argument de build du Dockerfile est `FORGEJO_VERSION`, et non le
  `APP_VERSION` générique que le socle injecte dans `build_args` (et qui
  l'emporterait sinon lors de la fusion pour se résoudre en `forgejo:latest`).
  `application_version = "latest"` correspond au tag épinglé `11` dans la
  configuration de `Forgejo_Common`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définies. Les noms
des services et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Forgejo {#a-cloud-run--the-forgejo-service}

Forgejo s'exécute comme un service Cloud Run v2 qui se met automatiquement à
l'échelle selon la charge de requêtes, entre les nombres minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Forgejo stocke toutes les métadonnées de l'application (utilisateurs, dépôts,
tickets, pull requests, exécutions Actions) dans une instance gérée Cloud SQL for
PostgreSQL 15. Par défaut (`enable_cloudsql_volume = false`), le service se
connecte en **TCP direct sur IP privée** avec `sslmode=require` ; définir
`enable_cloudsql_volume = true` bascule plutôt vers le socket Unix du Cloud SQL
Auth Proxy (`sslmode=disable`). Lors du premier déploiement, une tâche Cloud Run
`db-init` crée le rôle et la base de données de l'application et accorde les
privilèges sur le schéma ; Forgejo crée et migre ensuite son propre schéma au
premier démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe figurent dans les [sorties](#5-outputs). Consultez
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Filestore (NFS) — stockage des dépôts {#c-cloud-filestore-nfs--repository-storage}

Les données des dépôts, les objets Git LFS et les pièces jointes de Forgejo
résident sur **NFS (Cloud Filestore)**, monté par défaut dans le conteneur sur
`/mnt/nfs` (`GITEA__server__APP_DATA_PATH`). C'est là que réside tout l'état
durable de l'application hors base de données — le système de fichiers du
conteneur est lui-même éphémère.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de découverte et de
création du NFS.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** générique suffixé `data` est provisionné par la
valeur par défaut `storage_buckets` du socle, mais Forgejo n'utilise GCS pour
rien — `Forgejo_Common` renvoie toujours une sortie `storage_buckets` vide.
Définissez `create_cloud_storage = false` pour ne pas le provisionner si vous
n'en avez pas besoin.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~data"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Redis (provisionné, non câblé) {#e-redis-provisioned-not-wired}

Redis est **activé par défaut** (`enable_redis = true`) ; lorsque `redis_host`
est laissée vide, l'adresse IP de la VM du serveur NFS sert de point de
terminaison Redis. Le socle injecte `REDIS_HOST` / `REDIS_PORT` dans le
conteneur, mais `Forgejo_Common` ne définit aucune configuration
`GITEA__cache__*` / `GITEA__session__*` / `GITEA__queue__*` pour les utiliser
réellement — Forgejo fonctionne avec ses valeurs par défaut intégrées en mémoire
pour le cache, les sessions et la file d'attente, sauf si vous ajoutez vous-même
les `environment_variables` correspondantes.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager {#f-secret-manager}

Deux secrets Forgejo sont générés automatiquement et stockés dans Secret Manager :
`SECRET_KEY` (chiffre les données sensibles telles que les jetons 2FA et OAuth)
et `INTERNAL_TOKEN` (authentifie les appels d'API internes de Forgejo). Le mot de
passe de la base de données est le secret géré par le socle, exposé sous l'alias
`GITEA__database__PASSWD` via `db_password_env_var_name` dans `main.tf`. Sur Cloud
Run, ces trois valeurs arrivent directement comme variables d'environnement
`GITEA__` — il n'existe aucune restriction de CRD SecretSync (elle ne s'applique
qu'à GKE), si bien qu'aucune indirection par fichier monté par CSI n'est utilisée.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~forgejo"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### G. Réseau et entrée {#g-networking--ingress}

Le service est joignable par défaut à son URL `run.app`
(`ingress_settings = "all"`), ce qui permet l'accès public à l'interface web et
aux points de terminaison Git `https://` de clonage et de push. Un équilibreur de
charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut
être ajouté. Seul le port HTTP (3000) est exposé par Cloud Run — le `sshd`
interne de Forgejo ne peut pas être joint depuis cette plateforme, si bien que
les URL de clonage `git+ssh://` ne sont pas disponibles ; clonez plutôt via
`https://`.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de
Cloud Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des
vérifications de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Forgejo {#3-forgejo-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche Cloud
  Run `db-init` exécute `db-init.sh` avec `postgres:15-alpine`. Elle attend que
  Cloud SQL accepte les connexions, crée de manière idempotente (ou redéfinit le
  mot de passe de) le rôle applicatif avec `CREATEDB`, crée la base de données
  appartenant à ce rôle et accorde tous les privilèges sur la base de données et
  sur le schéma `public` (PG15+). Le script n'installe aucune extension
  Postgres — les propres migrations de Forgejo créent tout ce dont il a besoin.
  La tâche peut être relancée sans risque (`execute_on_apply = true`,
  `max_retries = 3`).
- **Pas de tâche de migration distincte — la création du schéma a lieu au démarrage du conteneur.**
  Avec `GITEA__security__INSTALL_LOCK = "true"`, l'assistant d'installation web
  de Forgejo est ignoré ; le point d'entrée d'origine `forgejo/forgejo` crée et
  migre le schéma dans la base de données vide au premier démarrage, puis
  applique les migrations suivantes lors des mises à niveau de version.
- **Aucun compte administrateur n'est créé automatiquement.** Aucune tâche
  d'initialisation n'exécute d'étape `forgejo admin user create` (ou équivalente),
  et l'inscription libre est activée (`GITEA__service__DISABLE_REGISTRATION = "false"`) :
  toute personne pouvant joindre le service peut donc créer un compte.
  Contrairement à GKE, Cloud Run n'offre **aucun équivalent à `kubectl exec`**
  dans une instance en cours d'exécution, si bien que les options d'amorçage côté
  opérateur diffèrent : soit ajouter une entrée ponctuelle à `initialization_jobs`
  qui exécute la CLI `admin user create` de Forgejo/Gitea sur la même base de
  données (image : l'image Forgejo déployée ; nécessite les variables
  d'environnement de base de données que ce module injecte déjà), soit vous
  appuyer sur le comportement de Forgejo/Gitea selon lequel le premier
  utilisateur devient administrateur, s'il s'applique à la version déployée.
  TODO : confirmer l'invocation exacte de la CLI et vérifier si la version de
  Forgejo déployée accorde encore les droits d'administrateur au premier compte
  inscrit avant de vous appuyer sur l'une ou l'autre voie — cela n'a pas été
  vérifié à partir du code source de ce dépôt.
- **Câblage des variables d'environnement de connexion à la base de données.** Le
  socle injecte `DB_HOST` (l'IP privée par défaut, ou le répertoire de socket du
  Cloud SQL Auth Proxy lorsque `enable_cloudsql_volume = true`), `DB_NAME`,
  `DB_USER` et le secret `DB_PASSWORD` (exposé sous l'alias
  `GITEA__database__PASSWD`). Comme les références `$(VAR)` de style Kubernetes
  ne sont pas interpolées par Cloud Run,
  `/platform-entrypoint.sh` compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}`
  à l'exécution à partir des valeurs `DB_*` injectées, en fonction de la forme de
  `DB_HOST` elle-même (`/` en tête → socket, `disable` ; `127.0.0.1`/`localhost` →
  proxy en boucle locale, `disable` ; toute autre valeur → TCP direct sur IP
  privée, `require`) — ce même point d'entrée fonctionne aussi sans modification
  sur la variante GKE.
- **Une instance unique par défaut sécurise les écritures sur NFS.**
  `max_instance_count` vaut `1` par défaut, si bien qu'une seule instance Forgejo
  s'exécute à la fois sur les données de dépôts NFS partagées et la base de
  données Postgres. L'augmenter n'a pas été testé par ce module quant à
  l'exactitude des écritures Git concurrentes — traitez-le avec la même prudence
  que toute charge de travail sur un système de fichiers partagé.
- **Chemin de santé.** Les deux sondes sont des requêtes **HTTP** `GET /api/healthz`,
  que Forgejo sert sans authentification une fois les migrations de la base de
  données terminées : sonde de démarrage `initial_delay_seconds=30`,
  `timeout_seconds=5`, `period_seconds=20`, `failure_threshold=10` ; sonde de
  vivacité `initial_delay_seconds=15`, `timeout_seconds=5`, `period_seconds=30`,
  `failure_threshold=3`.
- **Inspecter l'exécution des tâches et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep GITEA__
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Forgejo ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `forgejo` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Forgejo` | Nom lisible affiché dans la console. |
| `description` | `Forgejo - Self-hosted Git service and source-code hosting` | Description du service. |
| `application_version` | `11` | Tag de l'image `codeberg.org/forgejo/forgejo`, appliqué via l'argument de build propre à l'application `FORGEJO_VERSION` ; `latest` correspond au tag épinglé `11`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Construit la fine surcouche `FROM codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}`. `prebuilt` ne fonctionnera pas sur Cloud Run — pas d'interpolation des variables d'environnement `$(VAR)`. |
| `container_port` | `3000` | Port HTTP de Forgejo ; définit aussi `GITEA__server__HTTP_PORT`. |
| `cpu_limit` | `1000m` | 1 vCPU par instance (minimum pour un fonctionnement fiable). |
| `memory_limit` | `2Gi` | Minimum 512Mi ; 2Gi recommandés en production. |
| `cpu_always_allocated` | `false` | Facturation à la requête par défaut. Définissez `true` uniquement si vous dépendez de la synchronisation planifiée des miroirs, du cron de santé des dépôts ou de l'envoi temporisé de webhooks. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Maintient une seule instance qui écrit dans les données de dépôts NFS partagées et dans la base de données. |
| `execution_environment` | `gen2` | Requis pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | TCP direct sur IP privée par défaut (`sslmode=require`) ; définissez `true` pour utiliser plutôt le socket Unix du Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Copie en miroir l'image Forgejo dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Déclarée par cohérence avec la convention ; non référencée par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour le clonage et le push Git publics via HTTPS et pour l'accès web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque le clonage et le push via la CLI Git**, qui ne peut pas mener à bien un flux OAuth Google dans un navigateur. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement, secrets et URL publique {#group-6--environment-variables-secrets--public-url}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Espaces réservés SMTP | Paramètres non secrets supplémentaires. Les valeurs `GITEA__*` principales sont définies automatiquement — ne définissez ici ni `GITEA__database__*` ni les clés secrètes générées automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` ; sert à construire les URL de clonage et les liens. À remplacer en production. |
| `public_url` | `""` → `http://<public_domain>/` | Définit `GITEA__server__ROOT_URL`. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis
un bucket GCS après le provisionnement. Le schéma propre de Forgejo ne nécessite
aucun SQL personnalisé. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et conservation des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket GCS par défaut suffixé `data`, que Forgejo n'utilise jamais. Définissez `false` pour l'ignorer. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires au-delà du bucket de données provisionné automatiquement (inutilisé). |
| `enable_nfs` | `true` | NFS est activé par défaut afin que les dépôts, les objets LFS et les pièces jointes persistent. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur ; définit `GITEA__server__APP_DATA_PATH`. Remplace la valeur par défaut interne `/data` de `Forgejo_Common`. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(découverte automatique)_ | Cible ou nomme un serveur NFS existant ou créé en ligne. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (requiert gen2) ; non utilisés par Forgejo par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `forgejo` | Nom de la base de données, injecté sous `GITEA__database__NAME`. Immuable après le premier déploiement. |
| `db_user` | `forgejo` | Utilisateur de la base de données, injecté sous `GITEA__database__USER`. Mot de passe généré automatiquement et exposé sous l'alias `GITEA__database__PASSWD` (via un `db_password_env_var_name` défini dans `main.tf`, et non une variable exposée à l'utilisateur). |
| `database_type` | `POSTGRES_15` | Le seul moteur pris en charge par `db-init.sh` — ne le modifiez pas. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `sql_instance_name` / `sql_instance_base_name` | _(découverte automatique)_ | Cible ou nomme une instance Cloud SQL existante ou créée en ligne. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivée | Rotation du mot de passe de la base de données. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | Non utilisée — Forgejo n'a par défaut aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, `initial_delay_seconds=30`, `period_seconds=20`, `failure_threshold=10` | Sonde de démarrage propre à l'application. |
| `liveness_probe` | HTTP `/api/healthz`, `initial_delay_seconds=15`, `period_seconds=30`, `failure_threshold=3` | Sonde de vivacité propre à l'application. |
| `startup_probe_config` | désactivée | Sonde structurée alternative au niveau de Cloud Run (désactivée par défaut ; c'est `startup_probe` qui s'applique). |
| `health_check_config` | HTTP `/` | Sonde de vivacité structurée alternative au niveau de Cloud Run. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut, à activer explicitement. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Injecte `REDIS_HOST` / `REDIS_PORT`, mais `Forgejo_Common` ne définit aucune configuration `GITEA__cache__*`/`session__*`/`queue__*` pour les exploiter — voir la [section 1](#1-overview). |
| `redis_host` | `""` | À remplacer pour pointer vers Cloud Memorystore ou une autre instance Redis ; par défaut, l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` (sensible) | Mot de passe d'authentification Redis facultatif. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées — y compris les reflets inertes de variables du socle
(`additional_containers`, `additional_services`, `container_resources`,
`enable_postgres_extensions`/`postgres_extensions`, `enable_mysql_plugins`/`mysql_plugins`,
`network_name`, etc.) déclarés par cohérence avec la convention mais non transmis
au déploiement de Forgejo — suivent le comportement standard
d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
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
| `storage_buckets` | Buckets Cloud Storage créés (inutilisés par Forgejo). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, une valeur `timeout_seconds`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource : la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | `db-init.sh` ne fonctionne qu'avec `psql` ; MySQL/`NONE` casse la configuration de la base de données, même si les métadonnées de la variable les proposent. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et rend orphelins tous les dépôts, tickets et PR stockés sous l'ancien rôle. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (générés automatiquement) | Ne jamais modifier | Critical | Leur rotation invalide les données chiffrées 2FA/OAuth ainsi que l'authentification de l'API interne de Forgejo, ce qui casse les opérations Git et d'API. |
| `enable_nfs` | `true` | Critical | La désactiver rend éphémères les dépôts, les objets LFS et les pièces jointes — ils sont perdus lorsque l'instance de conteneur est remplacée. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `enable_cloudsql_volume` | `false` (par défaut) ou `true` | High | Par défaut, la connexion se fait en TCP direct sur IP privée avec SSL obligatoire — assurez-vous que `vpc_egress_setting` et les règles de pare-feu l'autorisent. Définir `true` bascule vers le socket Unix ; la sélection du mode SSL par le point d'entrée suppose le mode réellement actif. |
| `public_domain` / `public_url` | Le véritable nom d'hôte externe | High | Valent par défaut `localhost` / `http://localhost/`, ce qui produit des URL de clonage Git erronées et des liens cassés tant qu'elles ne sont pas remplacées. |
| `GITEA__service__DISABLE_REGISTRATION` (via `environment_variables`) | `true` pour les instances non publiques | High | L'inscription libre est ouverte par défaut et aucun compte administrateur n'est créé automatiquement — toute personne joignant le service peut s'inscrire. |
| Compte administrateur initial | À créer manuellement après le déploiement | High | Aucune tâche d'initialisation n'amorce d'administrateur ; Cloud Run n'a pas d'équivalent à `kubectl exec`, si bien que la reprise exige une entrée ponctuelle dans `initialization_jobs` ou l'exécution de la CLI sur la même base de données. |
| `enable_iap` | uniquement si l'accès par la CLI Git n'est pas nécessaire | High | IAP exige une connexion Google interactive que la CLI `git` ne peut pas effectuer — le clonage et le push via HTTPS échouent pour tous les clients autres que les navigateurs. |
| `ingress_settings` | `all` | High | La définir sur `internal` bloque tout clonage et push Git externes ainsi que l'accès web. |
| `enable_redis` | `true`, mais vérifiez qu'elle est réellement nécessaire | Medium | `REDIS_HOST`/`REDIS_PORT` sont injectées sans effet, sauf si vous ajoutez aussi la configuration `GITEA__cache__*`/`GITEA__session__*` correspondante — sinon, vous provisionnez de la capacité Redis sans aucun bénéfice. |
| `max_instance_count` | `1` (par défaut) | Medium | L'augmenter permet à plusieurs instances de partager le même répertoire de données Git sur NFS et la même base de données Postgres ; l'exactitude multi-instance des écritures Git concurrentes n'est ni documentée ni testée ici. |
| `application_version` | `11` ou un tag épinglé précis | Medium | `latest` ne suit pas la version amont — l'argument de build `FORGEJO_VERSION` du Dockerfile fait correspondre `"latest"` au tag épinglé `11`, si bien qu'une simple valeur `latest` reste silencieusement sur ce tag. |
| `memory_limit` | `2Gi` | Medium | Minimum 512Mi ; des valeurs inférieures exposent à des arrêts pour manque de mémoire (OOM) lors d'opérations concurrentes sur les dépôts. |
| `storage_buckets` / `create_cloud_storage` | Laisser tel quel ou définir `create_cloud_storage = false` | Low | Le bucket par défaut suffixé `data` est provisionné mais inutilisé par Forgejo (toutes les données de l'application résident sur NFS/Postgres) — un léger coût inutile s'il reste activé sans raison. |
| Git sur SSH | Non disponible sur cette plateforme | Low | Cloud Run n'expose que le port HTTP(S) ; les URL de clonage `git+ssh://` ne fonctionneront pas, quelle que soit la configuration — utilisez `https://`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Forgejo (câblage de la base de données, secrets et
organisation du NFS) est définie dans le module `Forgejo_Common` et partagée avec
la variante GKE de cette application.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Forgejo sur Cloud Run](../labs/Forgejo_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Forgejo sur GKE Autopilot](Forgejo_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Forgejo Common — Configuration applicative partagée](Forgejo_Common.md) — la configuration partagée par les deux cibles de déploiement.
