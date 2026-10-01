---
title: "FreeScout sur Google Cloud Run"
description: "Référence de configuration pour déployer FreeScout sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/FreeScout_CloudRun.md @ 3055034 sha256:e72e18187560 -->

# FreeScout sur Google Cloud Run {#freescout-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreeScout_CloudRun.png" alt="FreeScout sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreeScout est une plateforme gratuite et auto-hébergée de **helpdesk et de boîte aux
lettres partagée** construite sur Laravel (PHP) — elle transforme des boîtes de
réception partagées en une file de tickets collaborative avec conversations, tags,
réponses enregistrées, profil client, API REST et système de plugins. Ce module
déploie FreeScout sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise FreeScout et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

FreeScout s'exécute sous la forme d'un unique conteneur PHP (nginx + php-fpm) sur
Cloud Run v2, construit comme une image personnalisée légère `FROM tiredofit/freescout`.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur PHP sur le port 80, 1 vCPU / 2 GiB par défaut, autoscaling serverless ; scale-to-zero pris en charge |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — FreeScout ne prend en charge ni PostgreSQL ni d'autres moteurs |
| Fichiers persistants | Cloud Filestore (NFS) | Activé par défaut ; monté sur `/var/lib/freescout` pour les pièces jointes et les données d'exécution |
| Stockage d'objets | Cloud Storage | Un bucket de téléversements (`gcs-freescout<tenant-prefix>-freescout-uploads`) provisionné automatiquement |
| Cache (facultatif) | Redis | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `APP_KEY` Laravel et `ADMIN_PASS` de premier démarrage générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée (`MYSQL_8_0`) ; choisir un autre moteur empêche le démarrage.
- **L'`APP_KEY` Laravel est généré automatiquement** et stocké dans Secret Manager.
  Il chiffre les données de session et toutes les colonnes chiffrées de la base
  (identifiants de boîtes aux lettres stockés, jetons OAuth). **Ne le renouvelez jamais
  après le premier démarrage** — cela invaliderait définitivement toutes les données
  chiffrées auparavant.
- **Un administrateur initial est créé automatiquement.** `ADMIN_EMAIL` (par défaut
  `admin@techequity.cloud`), avec le secret `ADMIN_PASS` généré, crée le premier
  administrateur au premier démarrage. Modifiez le mot de passe dans l'interface après
  la première connexion.
- **`APP_URL` / `SITE_URL` sont définis sur l'URL du service.** FreeScout construit les
  liens absolus et son parcours `/` → tableau de bord/connexion à partir d'`APP_URL` ;
  le point d'entrée du conteneur le résout à partir du `CLOUDRUN_SERVICE_URL` réel à
  l'exécution.
- **Cloud SQL est joint en TCP (IP privée), et non par socket.** `enable_cloudsql_volume`
  vaut `false` par défaut sur Cloud Run ; l'application se connecte au `DB_IP` injecté
  sur le port 3306. MySQL via l'IP privée ne nécessite pas de SSL côté client.
- **NFS est activé par défaut** afin que les pièces jointes et les fichiers d'exécution
  survivent au recyclage des conteneurs et aux démarrages à froid après un
  scale-to-zero. Nécessite l'environnement d'exécution `gen2`.
- **Le scale-to-zero est activé** (`min_instance_count = 0`, `max_instance_count = 1`).
  Les démarrages à froid ajoutent plusieurs secondes à la première requête après une
  période d'inactivité ; définissez `min_instance_count = 1` pour garder le service
  toujours actif.
- **La santé est signalée sur `GET /`.** Il n'existe pas d'endpoint de santé JSON
  dédié ; la sonde de démarrage est TCP et la sonde de vivacité est `GET /`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service FreeScout {#a-cloud-run--the-freescout-service}

FreeScout s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la
charge des requêtes entre les nombres minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre révisions
pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~freescout"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

FreeScout stocke toutes les données applicatives (conversations, boîtes aux lettres,
utilisateurs, clients, paramètres) dans une instance gérée Cloud SQL for MySQL 8.0.
Sur Cloud Run, le service se connecte via l'**IP privée de l'instance (TCP, port
3306)** — `enable_cloudsql_volume` vaut `false` par défaut. Lors du premier
déploiement, le Job `db-init` crée la base de données applicative, l'utilisateur et
les droits ; l'application exécute ensuite ses propres migrations de schéma au
démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~freescout"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (NFS) {#c-cloud-filestore-nfs}

Les pièces jointes et les fichiers d'exécution de FreeScout sont conservés sur un
volume NFS monté sur `/var/lib/freescout` (activé par défaut). Les téléversements
restent ainsi durables malgré les changements de révision et le scale-to-zero. NFS
nécessite l'environnement d'exécution `gen2`.

- **Console :** Filestore → Instances (instance gérée par Services_GCP ou intégrée).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de découverte du NFS partagé.

### D. Cloud Storage {#d-cloud-storage}

Un bucket de téléversements **Cloud Storage** dédié (`gcs-freescout<tenant-prefix>-freescout-uploads`) est provisionné
automatiquement. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~freescout"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Redis (cache d'objets facultatif) {#e-redis-optional-object-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, `REDIS_HOST`/`REDIS_PORT`
sont injectés dans le conteneur comme backend de cache d'objets. Lorsque `redis_host`
est laissé vide et que `enable_nfs` vaut true, l'IP de la VM du serveur NFS sert
d'endpoint Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager {#f-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : l'`APP_KEY`
Laravel (qui chiffre les données de session et les colonnes chiffrées de la base) et
`ADMIN_PASS` (le mot de passe de l'administrateur initial). Le mot de passe de la base
de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freescout"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### G. Réseau et ingress {#g-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings = "all"`),
ce qui permet l'accès public à l'interface du helpdesk. Un équilibreur de charge HTTPS
externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les
paramètres d'ingress et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application FreeScout {#3-freescout-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte à
  Cloud SQL (par socket s'il est monté, sinon en TCP via `DB_IP`), crée de manière
  idempotente la base de données applicative et l'utilisateur, accorde les privilèges
  et vérifie que l'utilisateur applicatif peut se connecter. Le job s'exécute à chaque
  apply et peut être relancé sans risque.
- **Les migrations s'exécutent au démarrage du conteneur.** Il n'y a pas de job de
  migration distinct — l'image tiredofit exécute `php artisan migrate --force` à chaque
  démarrage du conteneur, de sorte que la mise à niveau d'`application_version`
  applique les changements de schéma au démarrage suivant.
- **Un administrateur initial est créé.** Au premier démarrage, l'image crée
  l'administrateur défini par `ADMIN_EMAIL` / `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME`
  avec le secret `ADMIN_PASS`. Connectez-vous et modifiez immédiatement le mot de passe.
- **L'`APP_KEY` est immuable après le premier démarrage.** La clé Laravel est générée
  une seule fois et écrite dans Secret Manager. La modifier invalide définitivement
  toutes les données chiffrées auparavant (identifiants de boîtes aux lettres chiffrés,
  jetons OAuth, cookies chiffrés). Ne la renouvelez que lors d'une fenêtre de
  maintenance planifiée, avec une reconfiguration complète.
- **`APP_URL` doit correspondre à l'hôte du navigateur.** FreeScout construit les liens
  absolus et son routage `/` à partir d'`APP_URL` ; le point d'entrée le définit à
  partir du `CLOUDRUN_SERVICE_URL` injecté. Si vous placez un domaine personnalisé
  devant le service, définissez `APP_URL`/`SITE_URL` (via `environment_variables`) sur
  cet hôte afin que les liens et les redirections soient résolus correctement.
  Inspectez la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est TCP sur le port du conteneur (délai de
  30 s, 20 échecs) et la sonde de vivacité est HTTP `GET /` (délai initial de 300 s).
  Prévoyez plusieurs minutes au premier démarrage, pendant l'exécution des migrations,
  avant que le service ne soit signalé comme sain.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à FreeScout ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `freescout` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `FreeScout` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image de base pour le build léger (`latest` correspond à `php8.3-1.17.159`) ; fixez un tag explicite tel que `1.8.170` en production. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez-la pour un traitement intensif des pièces jointes. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléversement des pièces jointes / des requêtes POST. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | FreeScout se déploie sous forme de build personnalisé léger ; laissez `custom`. |
| `cpu_limit` | `1000m` | CPU par instance ; minimum 1 vCPU. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 512 Mi (plancher gen2), 2 GiB recommandés. |
| `min_instance_count` | `0` | `0` active le scale-to-zero ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Conservez 1 tant qu'il n'est pas confirmé que le NFS partagé et la gestion des sessions supportent plusieurs instances. |
| `container_port` | `80` | FreeScout (nginx/php-fpm) écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `false` | Cloud Run se connecte à MySQL en TCP (IP privée) ; laissez `false`. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à l'interface du helpdesk. |
| `enable_iap` | `false` | Exige une connexion Google devant FreeScout (IAP natif de Cloud Run). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par ex. `MAIL_*`, ou un `APP_URL` personnalisé pour un domaine personnalisé). Les valeurs essentielles de base de données et d'administration sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. `APP_KEY` et `ADMIN_PASS` sont câblés automatiquement — ne les définissez pas ici. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est **activé** par défaut — il conserve les pièces jointes et les fichiers d'exécution. |
| `nfs_mount_path` | `/var/lib/freescout` | Chemin de montage dans le conteneur. |
| `create_cloud_storage` | `true` | Crée les buckets GCS déclarés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires en plus du bucket de téléversements provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | MySQL 8.0 fixé ; ne changez pas de moteur. |
| `db_name` | `freescout` | Nom de la base de données MySQL (injecté sous `DB_DATABASE`). Immuable après le premier déploiement. |
| `db_user` | `freescout` | Utilisateur applicatif de la base (injecté sous `DB_USERNAME`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/`, délai de 30 s, 20 échecs | Fenêtre généreuse pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `GET /`, délai de 300 s | `GET /` renvoie 200 une fois l'application démarrée ; pas d'endpoint de santé dédié. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active un cache d'objets Redis. |
| `redis_host` | `""` | Endpoint Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Endpoint / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut recommandées {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (critique : perte de données / panne / sécurité) — **High**
> (élevé : service dégradé) — **Medium** (moyen : coût ou dégradation partielle) —
> **Low** (faible : mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à l'application, un `container_port`/`backup_retention_days` hors plage, IAP sans identité autorisée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur recommandée | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critical | Le renouveler invalide définitivement toutes les données chiffrées auparavant — les identifiants de boîtes aux lettres chiffrés et les jetons OAuth ne peuvent plus être déchiffrés. |
| `database_type` | `MYSQL_8_0` | Critical | FreeScout ne fonctionne qu'avec MySQL ; un moteur Postgres ou autre empêche le démarrage. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `APP_URL` / `SITE_URL` | URL réelle du service/domaine | High | Un hôte erroné casse les liens absolus, le routage `/` et les liens de réinitialisation de mot de passe / d'e-mail. |
| `enable_nfs` | `true` | High | Le désactiver fait perdre toutes les pièces jointes et les fichiers d'exécution lors du recyclage des conteneurs / du scale-to-zero. |
| `enable_cloudsql_volume` | `false` (Cloud Run) | High | Forcer le socket sans véritable fichier de socket prive l'application d'hôte TCP — la connexion échoue. |
| `memory_limit` | `2Gi` (≥512Mi) | High | Une valeur inférieure au plancher gen2 de 512 Mi est rejetée au moment du plan ; une valeur trop basse provoque des arrêts OOM sous charge. |
| `max_instance_count` | `1` | High | Dépasser 1 sans gestion confirmée du stockage partagé et des sessions peut entraîner un état incohérent entre les instances. |
| `enable_iap` | uniquement pour les déploiements privés | High | IAP bloque toutes les requêtes non authentifiées, y compris les intégrations entrantes de type webhook d'e-mail. |
| `ADMIN_PASS` (généré automatiquement) | À modifier dans l'interface après la première connexion | Medium | Le mot de passe généré se trouve dans Secret Manager ; renouvelez-le dans l'application pour obtenir un identifiant détenu par une personne. |
| `min_instance_count` | `1` en production | Medium | Le scale-to-zero (`0`) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité. |
| `application_version` | À fixer en production | Medium | `latest` peut changer l'image de base à votre insu entre deux déploiements. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à FreeScout,
partagée avec la variante GKE, est décrite dans **[FreeScout_Common](FreeScout_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : FreeScout sur Cloud Run](../labs/FreeScout_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [FreeScout sur GKE Autopilot](FreeScout_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [FreeScout Common — Configuration applicative partagée](FreeScout_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [Gotify sur Google Cloud Run](Gotify_CloudRun.md) dans la solution **Customer Support Desk**.
