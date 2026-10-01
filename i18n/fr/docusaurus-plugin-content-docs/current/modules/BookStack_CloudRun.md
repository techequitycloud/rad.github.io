---
title: "BookStack sur Google Cloud Run"
description: "Référence de configuration pour déployer BookStack sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/BookStack_CloudRun.md @ 3055034 sha256:20028de74c58 -->

# BookStack sur Google Cloud Run {#bookstack-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/BookStack_CloudRun.png" alt="BookStack sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

BookStack est une plateforme de wiki et de documentation gratuite et open source,
sous licence MIT, construite sur Laravel (PHP), qui organise le contenu en
Shelves → Books → Chapters → Pages, avec édition WYSIWYG et Markdown, recherche en
texte intégral, révisions de pages et permissions granulaires. Ce module déploie
BookStack sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise BookStack et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

BookStack s'exécute comme un conteneur PHP sur Cloud Run v2. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur PHP (LinuxServer), 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à zéro prise en charge |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — BookStack ne prend pas en charge PostgreSQL ni d'autres moteurs |
| Stockage objet | Cloud Storage | Un bucket `data` dédié (`gcs-bookstack<tenant>-data`) provisionné automatiquement |
| Fichiers persistants | Filestore / NFS | Images et pièces jointes téléversées conservées dans `/var/lib/bookstack` |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; BookStack utilise le pilote de cache/session local |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée (`database_type = "MYSQL_8_0"`) ; PostgreSQL n'est pas pris en
  charge et choisir un autre moteur empêche le démarrage.
- **L'image précompilée `linuxserver/bookstack` est utilisée directement.** Il n'y a
  pas de Cloud Build personnalisé pour le déploiement par défaut ; l'image officielle
  LinuxServer.io est mise en miroir dans Artifact Registry (`enable_image_mirroring = true`)
  et déployée telle quelle.
- **Le conteneur écoute sur le port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **La persistance NFS des fichiers téléversés est activée par défaut.**
  `enable_nfs = true` monte NFS sur `/var/lib/bookstack` afin que les images et pièces
  jointes téléversées survivent aux redémarrages, aux redéploiements et aux événements
  de mise à l'échelle. La désactiver fait perdre les fichiers téléversés.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`, `max_instance_count = 1`).
  Les démarrages à froid ajoutent quelques secondes de latence à la première requête
  après une période d'inactivité ; BookStack est un wiki purement requête/réponse
  sans worker en arrière-plan, la facturation à la requête
  (`cpu_always_allocated = false`) est donc appropriée.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application Laravel
  est générée une seule fois et stockée dans Secret Manager ; la faire tourner rend
  indéchiffrables toutes les valeurs chiffrées de la base (secrets
  d'authentification à deux facteurs, certains paramètres).
- **L'image exécute automatiquement `php artisan migrate --force` au démarrage**, de
  sorte que le schéma est créé au premier démarrage après que `db-init` a provisionné
  la base de données et l'utilisateur — il n'y a pas de job de migration distinct.
- **Un administrateur par défaut est créé** par l'image LinuxServer :
  `admin@admin.com` avec le mot de passe `password`. Modifiez-le immédiatement à la
  première connexion.
- **Cloud Run se connecte à Cloud SQL en TCP via l'IP privée.**
  `enable_cloudsql_volume = false` par défaut, donc `DB_HOST` est l'IP privée de
  l'instance ; MySQL en TCP via l'IP privée ne nécessite pas SSL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service BookStack {#a-cloud-run--the-bookstack-service}

BookStack s'exécute comme un service Cloud Run v2 qui se met automatiquement à
l'échelle selon la charge de requêtes, entre le nombre minimal et le nombre maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

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

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

BookStack stocke toutes les données de l'application (livres, pages, utilisateurs,
révisions, permissions) dans une instance gérée Cloud SQL for MySQL 8.0. Le service se
connecte via l'**IP privée** de Cloud SQL par la sortie VPC
(`enable_cloudsql_volume = false`) ; `DB_HOST` est défini sur l'IP privée de
l'instance et aucune IP publique n'est exposée. Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=bookstack --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (valeur par défaut de `storage_buckets` :
`name_suffix = "data"`, ce qui donne `gcs-bookstack<tenant>-data`) est provisionné
automatiquement. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/       # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache et sessions facultatifs) {#d-redis-optional-cache--sessions}

Redis est **désactivé par défaut** (`enable_redis = false`) ; BookStack utilise ses
pilotes de cache et de session locaux. Lorsque `enable_redis = true` est défini, la
couche partagée injecte `REDIS_HOST` et `REDIS_PORT` afin que BookStack puisse
utiliser Redis pour le cache et les sessions. Lorsque `redis_host` est laissé vide et
que `enable_nfs` vaut true, l'IP Redis co-hébergée sur la VM du serveur NFS est
utilisée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the DB wiring in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -E 'DB_|REDIS_'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
l'**`APP_KEY`** Laravel (`base64:<44-char base64>`), utilisé pour chiffrer toutes les
données que BookStack stocke sous forme chiffrée. Le mot de passe de la base de
données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings = "all"`),
ce qui permet l'accès public attendu d'un wiki partagé. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application BookStack {#3-bookstack-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il détecte le socket
  Cloud SQL ou le point de terminaison TCP, attend que MySQL soit joignable, crée la
  base de données et l'utilisateur de l'application, accorde les privilèges, vérifie
  que l'utilisateur de l'application peut se connecter, puis arrête proprement le
  sidecar Cloud SQL Auth Proxy. Le job est idempotent et peut être relancé sans risque
  (`max_retries = 3`).
- **Migration automatique du schéma au démarrage.** L'image BookStack de LinuxServer
  exécute automatiquement `php artisan migrate --force` à chaque démarrage du
  conteneur, de sorte que le schéma est créé au premier démarrage et mis à niveau lors
  des démarrages suivants — il n'y a **pas de job de migration distinct**.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application Laravel
  est générée une seule fois et écrite dans Secret Manager. La faire tourner rend
  définitivement indéchiffrables toutes les valeurs chiffrées de la base (secrets
  d'authentification à deux facteurs, certains paramètres). Ne la faites tourner que
  pendant une fenêtre de maintenance planifiée, avec un plan de re-chiffrement.
- **Administrateur au premier lancement.** L'image crée un compte administrateur par
  défaut, `admin@admin.com` / `password`. Modifiez le mot de passe (et idéalement
  l'e-mail) immédiatement après la première connexion.
- **Les fichiers téléversés résident sur NFS.** Les images, pièces jointes et autres
  fichiers téléversés sont stockés sur le système de fichiers sous
  `/var/lib/bookstack`, adossé à NFS par défaut afin qu'ils survivent aux
  redémarrages, aux redéploiements et à la mise à zéro.
- **Chemin de santé.** La sonde de vivacité cible `/status` — le point de terminaison
  de santé JSON non authentifié de BookStack, qui indique l'état de
  l'application, de la base de données, du cache et des sessions. La sonde de
  démarrage est un contrôle TCP sur le port 80. Prévoyez une fenêtre généreuse au
  premier démarrage : la sonde de vivacité a un délai initial de 300 secondes pour
  laisser le temps aux migrations automatiques.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à BookStack ou notables pour lui sont
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
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `bookstack` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `BookStack` | Nom lisible affiché dans la console. |
| `description` | `BookStack wiki on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de l'image `linuxserver/bookstack` ; épinglez-le (p. ex. `version-v24.10`) en production. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | `512M` / `64M` / `64M` | Indications de réglage PHP ; sans effet par défaut pour l'image LinuxServer. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image LinuxServer mise en miroir — sans build personnalisé. |
| `container_image` | `""` | Remplace la référence de l'image ; laissez vide pour utiliser l'image mise en miroir par défaut. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU par défaut. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à zéro. |
| `max_instance_count` | `1` | Laissez à 1 — BookStack n'a pas de coordination de file d'attente multi-instances. |
| `container_port` | `80` | BookStack écoute sur le port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Connexion en TCP via l'IP privée de Cloud SQL (approprié pour MySQL sur Cloud Run). |
| `enable_image_mirroring` | `true` | Met en miroir l'image LinuxServer dans Artifact Registry. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Entrée et VPC {#group-5--ingress--vpc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet l'accès public au wiki. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque les lecteurs anonymes.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (p. ex. `APP_URL`, configuration de messagerie). Ne définissez pas `APP_KEY` ni `DB_*` ici. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor, CDN et domaine personnalisé {#group-10--cloud-armor-cdn--custom-domain}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Cloud Storage et NFS {#group-11--cloud-storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `data` par défaut et ceux déclarés dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS à provisionner. |
| `enable_nfs` | `true` | Conserve les images et pièces jointes téléversées sur NFS. |
| `nfs_mount_path` | `/var/lib/bookstack` | Chemin de montage où BookStack stocke les fichiers téléversés. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — BookStack nécessite MySQL 8.0. |
| `db_name` | `bookstack` | Nom de la base MySQL (préfixé par le tenant). Immuable après le premier déploiement. |
| `db_user` | `bookstack` | Utilisateur de base de données de l'application (préfixé par le tenant). Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Rotation du mot de passe de la base. |

### Groupe 13 — Automatisation des charges de travail {#group-13--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | BookStack n'a aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP port 80, 30s delay | Sonde de démarrage (vérification de l'écoute du port). |
| `liveness_probe` | HTTP `/status`, 300s delay | Sonde de vivacité sur le point de terminaison de santé non authentifié. |
| `uptime_check_config` | `{ enabled=false, path="/status" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache et sessions Redis {#group-21--redis-cache--sessions}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Injecte `REDIS_HOST`/`REDIS_PORT` afin que BookStack puisse utiliser Redis pour le cache et les sessions. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR des niveaux d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
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
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (IP privée, sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas au moteur requis par BookStack, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critique | Le faire tourner rend définitivement indéchiffrables toutes les valeurs chiffrées de la base (secrets d'authentification à deux facteurs, certains paramètres). |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `database_type` | `MYSQL_8_0` | Critique | BookStack nécessite MySQL ; tout autre moteur empêche le démarrage. |
| `APP_URL` (via `environment_variables`) | URL réelle du service | Élevé | Une URL de base erronée casse le chargement des ressources, les liens et les redirections de connexion. |
| `enable_nfs` | `true` | Élevé | Le désactiver fait perdre toutes les images et pièces jointes téléversées lors d'un redéploiement ou d'une mise à zéro. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs plus faibles exposent à des arrêts OOM lors d'éditions simultanées et de l'indexation en texte intégral. |
| `enable_cloudsql_volume` | `false` (TCP via IP privée) | Élevé | Sur Cloud Run, BookStack se connecte en TCP via l'IP privée ; forcer le chemin du socket est inutile et peut casser la connectivité à la base. |
| `ingress_settings` | `all` | Élevé | Le définir sur `internal` bloque tous les lecteurs externes du wiki. |
| `enable_iap` | uniquement lorsque les lecteurs doivent s'authentifier | Élevé | IAP bloque tout accès anonyme, y compris pour les lecteurs de documentation publique. |
| `max_instance_count` | `1` | Moyen | BookStack n'a pas de coordination multi-instances ; la mise à l'échelle horizontale expose à des incohérences de cache/session. |
| `min_instance_count` | `0` (CR) | Moyen | La mise à zéro ajoute un délai de démarrage à froid à la première requête après une période d'inactivité. |
| Mot de passe par défaut de `admin@admin.com` | À modifier à la première connexion | Moyen | Conserver le `password` par défaut permet à quiconque connaît l'URL de se connecter en tant qu'administrateur. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
BookStack, partagée avec la variante GKE, est décrite dans
**[BookStack_Common](BookStack_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : BookStack sur Cloud Run](../labs/BookStack_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [BookStack sur GKE Autopilot](BookStack_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [BookStack Common — Configuration applicative partagée](BookStack_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [Gotify sur Google Cloud Run](Gotify_CloudRun.md) dans la solution **Customer Support Desk**.
