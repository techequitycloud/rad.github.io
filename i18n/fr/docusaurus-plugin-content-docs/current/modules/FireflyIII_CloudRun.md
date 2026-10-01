---
title: "Firefly III sur Google Cloud Run"
description: "Référence de configuration pour déployer Firefly III sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/FireflyIII_CloudRun.md @ 3055034 sha256:cf29a74b82d5 -->

# Firefly III sur Google Cloud Run {#firefly-iii-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FireflyIII_CloudRun.png" alt="Firefly III sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Firefly III est un gestionnaire de finances personnelles gratuit, open source, sous
licence AGPL et auto-hébergé. Il suit les comptes, les transactions, les budgets,
les factures, les catégories et les transactions récurrentes, et expose une API REST
complète. Ce module déploie Firefly III sur **Cloud Run v2** en s'appuyant sur le
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Firefly III et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Firefly III s'exécute sous forme de conteneur Laravel/PHP (Apache) sur Cloud Run v2.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Moteur imposé — `DB_CONNECTION = pgsql` ; MySQL n'est pas utilisé |
| Stockage d'objets | Cloud Storage | Un bucket `fireflyiii-uploads` dédié provisionné automatiquement |
| Fichiers persistants | Filestore (NFS, facultatif) | Pièces jointes et données d'exécution montées sur `/var/lib/fireflyiii` |
| Secrets | Secret Manager | `APP_KEY` Laravel et `STATIC_CRON_TOKEN` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par
  la couche applicative partagée ; Firefly se connecte à l'**IP privée de Cloud SQL
  en TCP** avec `PGSQL_SSL_MODE = require` (Cloud SQL refuse le TCP non chiffré sur
  IP privée).
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager. Cette clé
  Laravel chiffre les champs sensibles au repos et **ne doit jamais faire l'objet
  d'une rotation après le premier démarrage** — sa rotation rend illisibles les
  données chiffrées auparavant.
- **`STATIC_CRON_TOKEN` est généré automatiquement.** Firefly n'effectue aucune
  planification en arrière-plan par lui-même ; un appelant doit interroger
  `GET /api/v1/cron/<STATIC_CRON_TOKEN>` pour exécuter les transactions récurrentes,
  les rappels de factures et les budgets automatiques. Configurez une tâche Cloud
  Scheduler pour le faire chaque jour.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`).
  Les démarrages à froid ajoutent 10–30 secondes de latence à la première requête
  après une période d'inactivité. Définissez `min_instance_count = 1` pour maintenir
  le service actif.
- **La première exécution passe par `/register`.** Aucun administrateur n'est créé
  à l'avance — le premier compte créé devient propriétaire/administrateur. Désactivez
  ensuite l'inscription ouverte dans **Administration → Settings**.
- **NFS est activé par défaut** afin de conserver les pièces jointes téléversées et
  les données d'exécution sur `/var/lib/fireflyiii` d'un démarrage à froid et d'une
  révision à l'autre ; nécessite l'environnement d'exécution gen2.
- **Redis est désactivé par défaut.** Firefly III utilise la base de données pour
  le cache et la file d'attente ; une instance unique n'a besoin d'aucun Redis
  externe.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Firefly III {#a-cloud-run--the-firefly-iii-service}

Firefly III s'exécute en tant que service Cloud Run v2 dont la mise à l'échelle
automatique suit la charge des requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

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

Firefly III stocke toutes les données de l'application (comptes, transactions,
budgets, factures, règles, utilisateurs) dans une instance gérée Cloud SQL for
PostgreSQL 15. Sur Cloud Run, le service se connecte à l'**IP privée de l'instance
en TCP** avec TLS obligatoire (`PGSQL_SSL_MODE = require`) ; aucune IP publique
n'est exposée. Lors du premier déploiement, un job d'initialisation crée le rôle
et la base de données de l'application et accorde les privilèges.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket **Cloud Storage** dédié aux téléversements est provisionné
automatiquement. Lorsque NFS est activé (par défaut), le répertoire des pièces
jointes et des données d'exécution de Firefly III est monté depuis un volume
Filestore/NFS sur `/var/lib/fireflyiii`, afin que les fichiers téléversés survivent
aux démarrages à froid et aux nouvelles révisions.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : l'`APP_KEY` Laravel (chiffre les champs sensibles au repos) et le
`STATIC_CRON_TOKEN` (authentifie le point de terminaison cron). Le mot de passe de
la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Cron (transactions récurrentes) {#e-cron-recurring-transactions}

Firefly III n'exécute les transactions récurrentes, les rappels de factures et les
budgets automatiques que lorsqu'un appelant interroge son point de terminaison cron.
Il n'existe aucun planificateur intégré au processus.

- Configurez une tâche **Cloud Scheduler** qui appelle
  `GET <service-url>/api/v1/cron/<STATIC_CRON_TOKEN>` chaque jour (définissez-la via
  l'entrée `cron_jobs` ou créez-la dans la console).
- **CLI :**
  ```bash
  # Read the token, then trigger the cron manually to verify:
  TOKEN=$(gcloud secrets versions access latest --secret=<cron-token-secret> --project "$PROJECT")
  curl -s "$SERVICE_URL/api/v1/cron/$TOKEN"
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées à Cloud Monitoring, avec en option des tests de
disponibilité et des règles d'alerte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Firefly III {#3-firefly-iii-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il crée de
  manière idempotente le rôle et la base de données de l'application et accorde les
  privilèges sur la base de données et le schéma `public`. La tâche peut être
  réexécutée sans risque.
- **Schéma créé au démarrage du conteneur.** Il n'existe **aucune tâche de
  migration séparée**. L'image `fireflyiii/core` exécute
  `php artisan migrate --force` et `firefly-iii:upgrade-database` à chaque
  démarrage ; la mise à niveau d'`application_version` applique donc automatiquement
  les modifications de schéma une fois que `db-init` a provisionné la base de
  données.
- **`APP_KEY` est immuable après le premier démarrage.** Il est généré une seule
  fois et écrit dans Secret Manager. Sa rotation rend illisibles tous les champs
  chiffrés auparavant. Ne le modifiez que dans le cadre d'une migration planifiée
  tenant compte de la perte de données.
- **La première exécution passe par `/register`.** Aucun identifiant
  administrateur n'existe dans Secret Manager. Créez le compte propriétaire sur
  `/register`, puis désactivez les inscriptions suivantes dans
  **Administration → Settings**.
- **Le point de terminaison cron pilote les éléments récurrents.** Vérifiez le
  jeton et déclenchez-le :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  curl -s "$SERVICE_URL/api/v1/cron/<STATIC_CRON_TOKEN>"
  ```
- **Chemin de santé.** La sonde de démarrage est une sonde TCP sur le port 8080
  (délai initial de 30s, 40 échecs tolérés) ; la sonde de vivacité cible le point de
  terminaison JSON non authentifié `/status` de Firefly III (HTTP 200, sans
  connexion, délai initial de 300s). Prévoyez une fenêtre généreuse au premier
  démarrage pendant l'exécution des migrations.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement.
Seuls les paramètres propres à Firefly III ou notables pour lui sont listés ; toutes
les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

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
| `application_name` | `fireflyiii` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `FireflyIII` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image `fireflyiii/core` ; épinglez une version publiée (par exemple `version-6.1.21`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `fireflyiii/core`. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum de 512Mi en gen2. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Nombre maximal d'instances. |
| `container_port` | `8080` | Firefly III (Apache) écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS/GCS. |
| `enable_cloudsql_volume` | `false` | Cloud Run atteint Cloud SQL en TCP sur IP privée, pas via le sidecar socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les imports CSV volumineux. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public via `run.app`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google devant Firefly III (recommandé pour des données de finances personnelles). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple `MAIL_*`). Les valeurs principales (`DB_CONNECTION`, `PGSQL_SSL_MODE`, `TRUSTED_PROXIES`, `APP_ENV`, `APP_URL`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Association variable d'environnement → nom du secret Secret Manager. `APP_KEY` et `STATIC_CRON_TOKEN` sont injectés automatiquement. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création des secrets avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention des images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définis)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket de téléversements provisionné automatiquement. |
| `enable_nfs` | `true` | Conserve les pièces jointes et les données d'exécution sur `/var/lib/fireflyiii`. |
| `nfs_mount_path` | `/var/lib/fireflyiii` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15. |
| `db_name` | `fireflyiii` | Nom de la base de données, injecté en tant que `DB_DATABASE`. Immuable après le premier déploiement. |
| `db_user` | `fireflyiii` | Utilisateur de l'application, injecté en tant que `DB_USERNAME`. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | Définissez un appel quotidien Cloud Scheduler → job Cloud Run vers `/api/v1/cron/<STATIC_CRON_TOKEN>`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP port 8080, 30s de délai, 40 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/status`, délai de 300s | Sonde de vivacité (200 sans authentification). |
| `uptime_check_config` | `{ enabled=false, path="/status" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend facultatif de cache/sessions ; Firefly III utilise la base de données par défaut. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison et authentification Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée Cloud SQL) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation rend illisibles tous les champs chiffrés auparavant — les données sont de fait perdues. |
| `db_name` / `db_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `PGSQL_SSL_MODE` (`require` automatique) | Laisser tel quel | High | Cloud SQL refuse le TCP non chiffré sur IP privée ; `disable` coupe la connexion. |
| `STATIC_CRON_TOKEN` / tâche cron | Planifier un appel quotidien | High | Sans appel cron planifié, les transactions récurrentes, les factures et les budgets automatiques ne se déclenchent jamais. |
| `enable_nfs` | `true` | High | Le désactiver place les pièces jointes sur un disque éphémère — les fichiers téléversés disparaissent lors d'un démarrage à froid ou d'une nouvelle révision. |
| `memory_limit` | `2Gi` | High | Une valeur inférieure à 512Mi est refusée en gen2 ; une mémoire insuffisante provoque l'arrêt OOM de PHP pendant les imports. |
| `enable_iap` | à activer pour des données privées | High | Firefly III contient des données financières ; le laisser accessible publiquement les expose à quiconque dispose de l'URL. |
| Inscription à la première exécution | Désactiver après le premier administrateur | High | Laisser l'inscription ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `min_instance_count` | `1` pour un usage quotidien | Medium | La mise à l'échelle à zéro ajoute 10–30 s de latence de démarrage à froid après une période d'inactivité. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |
| `enable_cloud_armor` | à activer en production | Medium | L'interface et l'API sont accessibles publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Firefly III partagée avec la variante GKE est décrite dans
**[FireflyIII_Common](FireflyIII_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Firefly III sur Cloud Run](../labs/FireflyIII_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Firefly III sur GKE Autopilot](FireflyIII_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Firefly III Common — Configuration applicative partagée](FireflyIII_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md), [Wallos sur Google Cloud Run](Wallos_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Finance & Wealth Tracking**.
