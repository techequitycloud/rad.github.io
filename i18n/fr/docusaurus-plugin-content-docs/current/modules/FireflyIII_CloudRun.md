---
title: "Firefly III sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Firefly III sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/FireflyIII_CloudRun.md @ 15fd4c7 sha256:28aafb3ed364 -->

# Firefly III sur Google Cloud Run {#firefly-iii-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FireflyIII_CloudRun.png" alt="Firefly III sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Firefly III est un gestionnaire de finances personnelles auto-hébergé, gratuit,
open-source et sous licence AGPL. Il suit les comptes, les transactions, les
budgets, les factures, les catégories et les transactions récurrentes, et expose
une API REST complète. Ce module déploie Firefly III sur **Cloud Run v2** sur la
base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Firefly III et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Firefly III s'exécute en tant que conteneur Laravel/PHP (Apache) sur Cloud Run
v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Moteur fixe — `DB_CONNECTION = pgsql` ; MySQL n'est pas utilisé |
| Stockage d'objets | Cloud Storage | Un bucket `fireflyiii-uploads` dédié provisionné automatiquement |
| Fichiers persistants | Filestore (NFS, facultatif) | Pièces jointes et données d'exécution montées à `/var/lib/fireflyiii` |
| Secrets | Secret Manager | `APP_KEY` et `STATIC_CRON_TOKEN` Laravel auto-générés ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; Firefly se connecte via l'**IP privée de Cloud
  SQL via TCP** avec `PGSQL_SSL_MODE = require` (Cloud SQL rejette le TCP IP privée non chiffré).
- **`APP_KEY` est générée automatiquement** et stockée dans Secret Manager. Cette
  clé Laravel chiffre les champs sensibles au repos et **ne doit jamais être
  renouvelée après le premier démarrage** — la renouveler rend les données
  précédemment chiffrées illisibles.
- **`STATIC_CRON_TOKEN` est générée automatiquement.** Firefly ne planifie pas de tâches en
  arrière-plan par lui-même ; un appelant doit atteindre `GET /api/v1/cron/<STATIC_CRON_TOKEN>` pour
  exécuter les transactions récurrentes, les rappels de factures et les
  budgets automatiques. Le module inclut un job `firefly-cron` intégré qui le fait
  quotidiennement à 03:00 UTC ; tout `cron_jobs` que vous
  ajoutez s'exécute en même temps.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les
  démarrages à froid ajoutent 10 à 30 secondes de latence à la première requête
  après l'inactivité. Définissez `min_instance_count = 1` pour maintenir le service actif.
- **La première exécution est `/register`.** Aucun administrateur n'est
  pré-initialisé — le premier compte créé devient le propriétaire/administrateur.
  Désactivez l'enregistrement ouvert par la suite dans
  **Administration → Settings**.
- **NFS est activé par défaut** pour persister les pièces jointes téléchargées et
  les données d'exécution à `/var/lib/fireflyiii` lors des démarrages à froid et des
  révisions ; nécessite l'environnement d'exécution gen2.
- **Redis est désactivé par défaut.** Firefly III utilise la base de données
  pour le cache et la file d'attente ; une seule instance n'a pas besoin de
  Redis externe.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Firefly III {#a-cloud-run--the-firefly-iii-service}

Firefly III s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge des requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Firefly III stocke toutes les données d'application (comptes, transactions,
budgets, factures, règles, utilisateurs) dans une instance gérée de Cloud SQL
pour PostgreSQL 15. Sur Cloud Run, le service se connecte via l'**IP privée de
l'instance via TCP** avec TLS requis (`PGSQL_SSL_MODE = require`) ; aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée le rôle et la
base de données de l'application et accorde les privilèges.

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
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket de téléchargement **Cloud Storage** dédié est provisionné
automatiquement. Lorsque NFS est activé (par défaut), les pièces jointes et le
répertoire d'exécution de Firefly III sont montés à partir d'un volume
Filestore/NFS à `/var/lib/fireflyiii` afin que les fichiers téléchargés survivent aux
démarrages à froid et aux nouvelles révisions.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : la `APP_KEY` Laravel (chiffre les champs sensibles au repos) et
le `STATIC_CRON_TOKEN` (authentifie le point de terminaison cron). Le mot de passe de la
base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Cron (transactions récurrentes) {#e-cron-recurring-transactions}

Firefly III exécute les transactions récurrentes, les rappels de factures et les
budgets automatiques uniquement lorsqu'un appelant atteint son point de
terminaison cron. Il n'y a pas de planificateur intégré.

- Un job planifié `firefly-cron` intégré (`curlimages/curl`, `0 3 * * *`) appelle
  `GET <service-url>/api/v1/cron/<STATIC_CRON_TOKEN>` quotidiennement. Il est toujours ajouté, et toutes les
  entrées `cron_jobs` que vous définissez lui sont ajoutées plutôt que de le
  remplacer.
- **CLI :**
  ```bash
  # Read the token, then trigger the cron manually to verify:
  TOKEN=$(gcloud secrets versions access latest --secret=<cron-token-secret> --project "$PROJECT")
  curl -s "$SERVICE_URL/api/v1/cron/$TOKEN"
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'entrée et le contrôle de la sortie
VPC gèrent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Firefly III {#3-firefly-iii-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de
  manière idempotente le rôle et la base de données de l'application et accorde
  les privilèges sur la base de données et le schéma `public`. Le job peut être
  réexécuté en toute sécurité.
- **Schéma créé au démarrage du conteneur.** Il n'y a **pas de job de migration
  séparé**. L'image `fireflyiii/core` exécute `php artisan migrate --force` et
  `firefly-iii:upgrade-database` à chaque démarrage, donc la mise à niveau de `application_version`
  applique automatiquement les modifications de schéma une fois que `db-init` a
  provisionné la base de données.
- **`APP_KEY` est immuable après le premier démarrage.** Elle est générée une
  fois et écrite dans Secret Manager. La renouveler rend tous les champs
  précédemment chiffrés illisibles. Ne la modifiez que lors d'une migration
  planifiée tenant compte de la perte de données.
- **La première exécution est `/register`.** Aucune information d'identification
  d'administrateur n'existe dans Secret Manager. Créez le compte propriétaire à
  `/register`, puis désactivez toute autre inscription dans
  **Administration → Settings**.
- **Le point de terminaison cron gère les éléments récurrents.** Confirmez le
  jeton et déclenchez-le :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  curl -s "$SERVICE_URL/api/v1/cron/<STATIC_CRON_TOKEN>"
  ```
- **Chemin de santé.** La sonde de démarrage est TCP sur le port 8080 (délai
  initial de 30 s, 40 échecs autorisés) ; la sonde de vivacité cible le point de
  terminaison JSON non authentifié `/status` de Firefly III (HTTP 200, pas de
  connexion, délai initial de 300 s). Prévoyez une fenêtre généreuse pour le
  premier démarrage pendant l'exécution des migrations.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Firefly III sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fireflyiii` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `FireflyIII` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image `fireflyiii/core` ; épingler à une version (par exemple `version-6.1.21`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `fireflyiii/core`. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 512 Mio minimum sur gen2. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définir `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Nombre maximal d'instances. |
| `container_port` | `8080` | Firefly III (Apache) écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS. |
| `enable_cloudsql_volume` | `false` | Cloud Run atteint Cloud SQL via TCP IP privée, pas le sidecar de socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmenter pour les importations CSV volumineuses. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public `run.app`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Firefly III (recommandé pour les données financières personnelles). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `MAIL_*`). Les valeurs principales (`DB_CONNECTION`, `PGSQL_SSL_MODE`, `TRUSTED_PROXIES`, `APP_ENV`, `APP_URL`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. `APP_KEY` et `STATIC_CRON_TOKEN` sont injectés automatiquement. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention d'images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket de téléchargement auto-provisionné. |
| `enable_nfs` | `true` | Persister les pièces jointes et les données d'exécution à `/var/lib/fireflyiii`. |
| `nfs_mount_path` | `/var/www/html/storage/upload` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15. |
| `db_name` | `fireflyiii` | Nom de la base de données, injecté comme `DB_DATABASE`. Immuable après le premier déploiement. |
| `db_user` | `fireflyiii` | Utilisateur de l'application, injecté comme `DB_USERNAME`. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs planifiés supplémentaires. L'appel quotidien `firefly-cron` à `/api/v1/cron/<STATIC_CRON_TOKEN>` est intégré et toujours ajouté à ceux-ci. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | Port TCP 8080, délai 30s, 40 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/status`, délai 300s | Sonde de vivacité (200 non authentifié). |
| `uptime_check_config` | `{ enabled=false, path="/status" }` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend de cache/session facultatif ; Firefly III utilise la base de données par défaut. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison et authentification Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

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
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée Cloud SQL) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> réplica en lecture sans son primaire, IAP sans identités autorisées, un
> environnement d'exécution `gen1` avec des montages NFS/GCS, un
> `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer la
> **planification** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (auto-générée) | Ne jamais renouveler après le premier démarrage | Critique | La renouveler rend tous les champs précédemment chiffrés illisibles — les données sont effectivement perdues. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `PGSQL_SSL_MODE` (auto `require`) | Laisser tel quel | Élevé | Cloud SQL rejette le TCP IP privée non chiffré ; `disable` interrompt la connexion. |
| `STATIC_CRON_TOKEN` / job cron | Laisser le job `firefly-cron` intégré en place | Élevé | Sans appel cron planifié, les transactions récurrentes, les factures et les budgets automatiques ne se déclenchent jamais. |
| `enable_nfs` | `true` | Élevé | Le désactiver place les pièces jointes sur un disque éphémère — les fichiers téléchargés disparaissent au démarrage à froid / nouvelle révision. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio est rejeté sur gen2 ; une faible mémoire tue PHP par manque de mémoire lors des importations. |
| `enable_iap` | activer pour les données privées | Élevé | Firefly III contient des données financières ; le laisser publiquement accessible l'expose à toute personne ayant l'URL. |
| Enregistrement au premier démarrage | Désactiver après le premier administrateur | Élevé | Laisser l'enregistrement ouvert permet à toute personne ayant l'URL de créer un compte. |
| `min_instance_count` | `1` pour une utilisation quotidienne | Moyen | La mise à l'échelle à zéro ajoute 10 à 30 s de latence au démarrage à froid après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur et l'API sont publiquement accessibles sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Firefly III partagée avec la variante GKE est décrite
dans **[FireflyIII_Common](FireflyIII_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Firefly III sur Cloud Run](../labs/FireflyIII_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Firefly III sur GKE Autopilot](FireflyIII_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Firefly III Common — Configuration d'application partagée](FireflyIII_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md), [Wallos sur Google Cloud Run](Wallos_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Suivi des finances et du patrimoine**.
