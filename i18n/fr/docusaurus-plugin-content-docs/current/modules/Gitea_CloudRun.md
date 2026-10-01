---
title: "Gitea sur Google Cloud Run"
description: "Référence de configuration pour déployer Gitea sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Gitea_CloudRun.md @ 3055034 sha256:6996ad9f2dcc -->

# Gitea sur Google Cloud Run {#gitea-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gitea_CloudRun.png" alt="Gitea sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gitea est un service Git léger et auto-hébergé ainsi qu'une forge logicielle (un fork communautaire de Gogs, plus de 45 000 étoiles sur GitHub) qui fournit l'hébergement de dépôts, le suivi des tickets, les pull requests, la revue de code, un registre de paquets et un système CI/CD Actions intégré, le tout à partir d'un seul binaire Go. Ce module déploie Gitea sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Gitea et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute application Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gitea s'exécute comme un conteneur à binaire Go unique sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | 1 vCPU / 2 GiB par défaut, facturation à la requête, mise à l'échelle jusqu'à zéro |
| Base de données | Cloud SQL for PostgreSQL 15 | Métadonnées des dépôts, utilisateurs, tickets, PR — `GITEA__database__DB_TYPE = "postgres"` |
| Fichiers partagés | Filestore / NFS | Dépôts, objets LFS et pièces jointes sur le volume partagé `/mnt/nfs` (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné par le socle, plus le bucket des sauvegardes automatisées |
| Secrets | Secret Manager | `SECRET_KEY`, `INTERNAL_TOKEN` et le mot de passe de la base de données gérés automatiquement |
| Image de conteneur | Artifact Registry + Cloud Build | Build personnalisé léger au-dessus de l'image officielle `gitea/gitea` |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur câblé.** `Gitea_Common` définit `GITEA__database__DB_TYPE = "postgres"` ; ne passez pas `database_type` à MySQL.
- **L'image est un build personnalisé quasi standard.** Cloud Build produit `FROM gitea/gitea:<version>` plus un petit point d'entrée de plateforme. Ce point d'entrée existe parce que Cloud Run n'interpole **pas** les références d'environnement `$(VAR)` — il compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}` à partir des valeurs `DB_*` injectées par le socle au démarrage du conteneur et choisit le bon mode SSL Postgres pour chaque saut de connexion.
- **L'utilisateur et le nom de la base sont préfixés par le tenant.** Le socle crée le rôle et la base sous la forme `gitea<tenant><hex>` et les injecte comme `DB_USER` / `DB_NAME` ; le point d'entrée les transmet à Gitea. Ne codez jamais `gitea` en dur dans les paramètres de base de données.
- **TCP par défaut.** `enable_cloudsql_volume = false` — Gitea se connecte à l'IP privée de Cloud SQL en TCP avec `SSL_MODE = require` (le point d'entrée bascule automatiquement sur `disable` pour les chemins par socket Unix ou par loopback du proxy).
- **Toutes les données des dépôts résident sur NFS.** `GITEA__server__APP_DATA_PATH` pointe vers le montage NFS (`/mnt/nfs`), de sorte que les dépôts, LFS et pièces jointes survivent aux redémarrages et sont partagés entre les instances.
- **L'installateur web du premier lancement est ignoré.** `GITEA__security__INSTALL_LOCK = "true"` — la configuration est entièrement fournie par des variables d'environnement. Le **premier utilisateur qui s'inscrit devient administrateur**.
- **L'auto-inscription est activée par défaut** (`GITEA__service__DISABLE_REGISTRATION = "false"`). Inscrivez votre compte administrateur immédiatement après le déploiement, puis désactivez l'inscription pour les forges privées.
- Un **job `db-init` s'exécute à chaque apply** pour créer de façon idempotente le rôle et la base PostgreSQL de Gitea.
- **Les sondes de santé ciblent `/api/healthz`** — le point de terminaison de santé non authentifié de Gitea.
- **Mise à l'échelle jusqu'à zéro, facturation à la requête.** `min_instance_count = 0`, `max_instance_count = 1`, `cpu_always_allocated = false`. Ne définissez `cpu_always_allocated = true` que si vous dépendez de la synchronisation planifiée des miroirs, du cron de santé des dépôts ou de la livraison temporisée des webhooks.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Gitea {#a-cloud-run--the-gitea-service}

Gitea s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gitea stocke toutes les données relationnelles (utilisateurs, métadonnées des dépôts, tickets, pull requests, état d'Actions) dans une instance gérée Cloud SQL for PostgreSQL 15, jointe via l'**IP VPC privée** (aucun point de terminaison public). Au premier déploiement, un Job `db-init` crée le rôle et la base de données de l'application, préfixés par le tenant.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=postgres --project "$PROJECT"
  ```

Le nom de l'instance, la base, l'utilisateur et le secret du mot de passe figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les données des dépôts — dépôts Git nus, objets LFS et pièces jointes des tickets — sont écrites sous `GITEA__server__APP_DATA_PATH` sur un partage **NFS** monté dans le service, si bien qu'elles persistent entre les redémarrages et les révisions. Un bucket **Cloud Storage** `data` est également provisionné, et les sauvegardes planifiées sont déposées dans le bucket de sauvegarde du socle. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances (ou Compute Engine → VM instances pour le serveur NFS autogéré) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Trois secrets sont gérés automatiquement : le mot de passe de la base de données (injecté comme `GITEA__database__PASSWD`), la `SECRET_KEY` de Gitea (qui chiffre les données sensibles stockées, comme les jetons 2FA et OAuth2) et son `INTERNAL_TOKEN` (qui authentifie les appels internes à l'API de Gitea). Tous sont générés une seule fois et injectés à l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gitea"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Artifact Registry et Cloud Build {#e-artifact-registry--cloud-build}

Le déploiement construit via Cloud Build une image personnalisée légère (`FROM gitea/gitea:<application_version>` + le point d'entrée de plateforme) et la stocke dans Artifact Registry. Incrémenter `application_version` déclenche une reconstruction à partir du tag amont correspondant.

- **Console :** Artifact Registry → Repositories ; Cloud Build → History.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud builds list --project "$PROJECT" --limit 5
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont transmis à Cloud Logging ; les métriques de Cloud Run et de Cloud SQL sont transmises à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gitea {#3-gitea-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init` (`postgres:15-alpine`) attend l'instance Cloud SQL, puis crée de façon idempotente le rôle applicatif préfixé par le tenant (avec `CREATEDB`), crée la base Gitea dont ce rôle est propriétaire et accorde les privilèges. Le job s'exécute à chaque apply (`execute_on_apply = true`, jusqu'à 3 nouvelles tentatives) et peut être relancé sans risque.
- **Câblage de la base de données à l'exécution.** Le point d'entrée de plateforme journalise à chaque démarrage une ligne du type `Gitea DB wired: host=… sslmode=… name=… user=…`, puis passe la main au point d'entrée standard de Gitea (qui écrit toutes les variables d'environnement `GITEA__*` dans `app.ini` et lance le serveur sous s6). Lorsque `DB_HOST` commence par `/`, il est traité comme le répertoire de socket du Cloud SQL Auth Proxy (`SSL_MODE=disable`) ; un hôte loopback signifie un sidecar proxy (`disable`) ; tout le reste correspond à l'IP privée en TCP (`SSL_MODE=require`).
- **Installateur ignoré ; le premier inscrit est administrateur.** `INSTALL_LOCK=true` supprime l'installateur web. Inscrivez le premier compte immédiatement après le déploiement — il reçoit les privilèges d'administrateur. Pour les forges privées, définissez ensuite `GITEA__service__DISABLE_REGISTRATION = "true"` via `environment_variables`.
- **Les URL de clonage proviennent de `public_domain` / `public_url`.** Celles-ci alimentent `GITEA__server__DOMAIN` et `GITEA__server__ROOT_URL`. Les valeurs par défaut (`localhost` / dérivée) produisent des URL de clonage et des redirections erronées — définissez-les sur l'hôte `run.app` du service ou sur votre domaine personnalisé.
- **Clonage HTTPS uniquement.** Cloud Run ne route que le `container_port` HTTP (3000). Le démon SSH fourni avec l'image n'est pas joignable : utilisez donc des remotes HTTPS (avec un jeton d'accès Gitea ou un mot de passe) ; le `git clone` par SSH n'est pas disponible sur cette plateforme.
- **Gitea Actions.** Le serveur CI/CD Actions intégré est livré avec Gitea, mais l'exécution des jobs nécessite une capacité de calcul `act_runner` distincte que ce module ne provisionne pas.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/healthz`, qui renvoie HTTP 200 sans authentification dès que Gitea est en service.
- **CLI de vérification :**
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/healthz"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Gitea ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gitea` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Gitea` | Nom convivial affiché dans la console. |
| `application_version` | `1` | Tag de l'image amont `gitea/gitea` sur lequel repose le build personnalisé ; incrémentez-le (par ex. `1.24`) pour mettre à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image enveloppe légère (obligatoire) ; `prebuilt` déploie l'image standard, qui **ne fonctionne pas sur Cloud Run** (pas d'interpolation d'environnement `$(VAR)` pour le câblage de la base). |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `container_port` | `3000` | Port HTTP de Gitea (`GITEA__server__HTTP_PORT`). |
| `min_instance_count` | `0` | Mise à l'échelle jusqu'à zéro par défaut ; définissez `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût. |
| `cpu_always_allocated` | `false` | Facturation à la requête. Définissez `true` si vous dépendez de la synchronisation planifiée des miroirs, du cron de santé des dépôts ou de la livraison temporisée des webhooks. |
| `enable_cloudsql_volume` | `false` | TCP vers l'IP privée de Cloud SQL (SSL exigé par le point d'entrée). Définissez `true` pour le chemin Auth Proxy par socket Unix. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy — notez qu'IAP devant Gitea filtre aussi les clients HTTP `git`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement, secrets et URL publique {#group-6--environment-variables-secrets--public-url}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | map `EMAIL_SMTP_*` d'exemple | Variables d'environnement supplémentaires fusionnées par-dessus les valeurs par défaut du module. Gitea lui-même se configure via des noms `GITEA__<section>__<KEY>` (par ex. `GITEA__mailer__SMTP_ADDR`, `GITEA__service__DISABLE_REGISTRATION`) ; les clés d'exemple `EMAIL_SMTP_*` ne sont pas lues par Gitea. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` — détermine les URL de clonage. Indiquez votre hôte réel. |
| `public_url` | `""` | Définit `GITEA__server__ROOT_URL` ; vide, la valeur est dérivée en `http://<public_domain>/`. Utilisez `https://<host>/` en production. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatisées de la base de données/NFS (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupes 8–11 — CI/CD, SQL personnalisé, domaine/CDN/WAF, stockage {#groups-811--cicd-custom-sql-domaincdnwaf-storage}

Comportement standard d'App_CloudRun — consultez [App_CloudRun](App_CloudRun.md). Entrées notables pour Gitea :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Laissez-le activé** — les dépôts, LFS et pièces jointes résident sur le partage NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage ; devient aussi `GITEA__server__APP_DATA_PATH`. |
| `storage_buckets` | un bucket `data` | Bucket GCS provisionné par le socle. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur externe — gardez-les cohérents avec `public_domain`. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Gitea est câblé pour PostgreSQL — ne le modifiez pas. |
| `db_name` | `gitea` | Nom de base de la base de données ; le socle le préfixe par le tenant et l'injecte comme `DB_NAME`. |
| `db_user` | `gitea` | Utilisateur applicatif de base ; préfixé par le tenant et injecté comme `DB_USER`. Le mot de passe est injecté comme `GITEA__database__PASSWD`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe de la base. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, 30 s delay, 10 failures | Sonde de démarrage sur le point de terminaison de santé de Gitea. |
| `liveness_probe` | HTTP `/api/healthz`, 15 s delay | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring — activez-le en production. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

Les entrées Redis (`enable_redis`, `redis_host`, `redis_port`, `redis_auth`) sont déclarées par convention de plateforme mais **ne sont pas transmises** par ce module — Gitea n'utilise pas Redis ici ; les définir n'a aucun effet.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de l'application, préfixés par le tenant. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (sensible) / port. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Le module câble `GITEA__database__DB_TYPE=postgres` ; un autre moteur casse le démarrage. |
| `db_name` / `db_user` | définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend orphelines toutes les données de la forge. |
| `enable_nfs` | `true` | Critique | Sans le partage NFS, les dépôts/LFS/pièces jointes résident sur un disque éphémère et disparaissent au redémarrage ou lors d'une mise à l'échelle jusqu'à zéro. |
| `container_image_source` | `custom` | Critique | L'image standard n'a pas de point d'entrée de plateforme ; Gitea tente de joindre un hôte littéralement nommé `$(DB_HOST)` et ne démarre jamais. |
| `container_port` | `3000` | Critique | Un port différent du port HTTP de Gitea fait échouer toutes les sondes. |
| Paramètres de base de données via l'environnement | ne jamais coder `gitea` en dur | Critique | Les vrais `DB_USER`/`DB_NAME` sont préfixés par le tenant ; les coder en dur échoue avec `password authentication failed`. |
| `GITEA__service__DISABLE_REGISTRATION` | `true` après le premier administrateur | Élevé | Laissée ouverte, n'importe qui trouvant l'URL peut s'inscrire sur votre forge (le tout premier inscrit est administrateur — revendiquez ce compte immédiatement). |
| `public_domain` / `public_url` | hôte réel | Élevé | Les valeurs par défaut (`localhost`) produisent des URL de clonage et des redirections cassées dans l'interface. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS exigent gen2. |
| `enable_cloudsql_volume` | `false` (TCP) | Élevé | En mode socket, le point d'entrée s'adapte — mais des surcharges manuelles incohérentes de `GITEA__database__HOST` cassent la sélection du mode SSL. |
| `cpu_always_allocated` | `false`, ou `true` pour les miroirs/le cron | Moyen | La facturation à la requête bride le travail en arrière-plan ; la synchronisation planifiée des miroirs et les webhooks temporisés sont bloqués pendant l'inactivité. |
| `min_instance_count` | `0` (ou `1` pour les équipes) | Moyen | La mise à l'échelle jusqu'à zéro ajoute un démarrage à froid à la première opération `git` après une période d'inactivité. |
| `uptime_check_config` | à activer en production | Moyen | Désactivé par défaut ; aucun signal de disponibilité externe. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Gitea, partagée avec la variante GKE, est décrite dans **[Gitea_Common](Gitea_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gitea sur Cloud Run](../labs/Gitea_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gitea sur GKE Autopilot](Gitea_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gitea Common — Configuration applicative partagée](Gitea_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Woodpecker CI sur GKE Autopilot](Woodpecker_GKE.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) et [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Source Control & CI/CD**.
