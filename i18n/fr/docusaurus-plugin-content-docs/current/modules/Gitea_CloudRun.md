---
title: "Gitea sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Gitea sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gitea_CloudRun.md @ 15fd4c7 sha256:428246befcd1 -->

# Gitea sur Google Cloud Run {#gitea-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gitea_CloudRun.png" alt="Gitea sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gitea est un service Git léger et auto-hébergé, ainsi qu'une forge logicielle (un fork communautaire de Gogs, plus de 45 000 étoiles sur GitHub) qui offre l'hébergement de dépôts, le suivi des problèmes, les requêtes de tirage (pull requests), la révision de code, un registre de paquets et un système CI/CD Actions intégré à partir d'un seul binaire Go. Ce module déploie Gitea sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Gitea et sur la manière de les explorer et de les opérer depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gitea s'exécute comme un conteneur binaire Go unique sur Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | 1 vCPU / 2 Gio par défaut, facturation basée sur les requêtes, mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Métadonnées des dépôts, utilisateurs, problèmes, PRs — `GITEA__database__DB_TYPE = "postgres"` |
| Fichiers partagés | Filestore / NFS | Dépôts, objets LFS et pièces jointes sur le volume partagé `/mnt/nfs` (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné par la fondation, plus le bucket de sauvegarde automatisée |
| Secrets | Secret Manager | `SECRET_KEY`, `INTERNAL_TOKEN` et le mot de passe de la base de données gérés automatiquement |
| Image de conteneur | Artifact Registry + Cloud Build | Build personnalisé léger sur l'image officielle `gitea/gitea` |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur câblé.** `Gitea_Common` définit `GITEA__database__DB_TYPE = "postgres"` ; ne pas changer `database_type` pour MySQL.
- **L'image est un build personnalisé quasi-standard.** Cloud Build produit `FROM gitea/gitea:<version>` plus un petit point d'entrée de plateforme. Le point d'entrée existe parce que Cloud Run **n'interpole pas** les références d'environnement `$(VAR)` — il compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}` à partir des valeurs `DB_*` injectées par la fondation au démarrage du conteneur et choisit le bon mode SSL Postgres par saut de connexion.
- **L'utilisateur et le nom de la base de données sont préfixés par le locataire.** La fondation crée le rôle et la base de données comme `gitea<tenant><hex>` et les injecte comme `DB_USER` / `DB_NAME` ; le point d'entrée les mappe dans Gitea. Ne jamais coder en dur `gitea` dans les paramètres de la base de données.
- **TCP par défaut.** `enable_cloudsql_volume = false` — Gitea se connecte à l'IP privée de Cloud SQL via TCP avec `SSL_MODE = require` (le point d'entrée passe automatiquement à `disable` sur les chemins de socket Unix ou de bouclage proxy).
- **Toutes les données du dépôt résident sur NFS.** `GITEA__server__APP_DATA_PATH` est défini sur le montage NFS (`/mnt/nfs`), de sorte que les dépôts, LFS et pièces jointes survivent aux redémarrages et sont partagés entre les instances.
- **L'installateur web de première exécution est ignoré.** `GITEA__security__INSTALL_LOCK = "true"` — la configuration est entièrement fournie via des variables d'environnement. Le **premier utilisateur à s'inscrire devient l'administrateur**.
- **L'auto-inscription est activée par défaut** (`GITEA__service__DISABLE_REGISTRATION = "false"`). Enregistrez votre compte administrateur immédiatement après le déploiement, puis désactivez l'inscription pour les forges privées.
- Un job **`db-init` s'exécute à chaque apply** pour créer de manière idempotente le rôle et la base de données PostgreSQL de Gitea.
- **Les sondes de santé ciblent `/api/healthz`** — le point de terminaison de santé non authentifié de Gitea.
- **Mise à l'échelle à zéro, facturation basée sur les requêtes.** `min_instance_count = 0`, `max_instance_count = 1`, `cpu_always_allocated = false`. Définissez `cpu_always_allocated = true` uniquement si vous comptez sur la synchronisation miroir planifiée, le cron de santé du dépôt ou la livraison de webhook temporisée.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Gitea {#a-cloud-run--the-gitea-service}

Gitea s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gitea stocke toutes les données relationnelles (utilisateurs, métadonnées des dépôts, problèmes, requêtes de tirage, état des Actions) dans une instance gérée de Cloud SQL pour PostgreSQL 15, accessible via l'**IP privée du VPC** (pas de point de terminaison public). Lors du premier déploiement, un job `db-init` crée le rôle et la base de données de l'application préfixés par le locataire.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=postgres --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les données du dépôt — dépôts Git nus, objets LFS et pièces jointes — sont écrites sous `GITEA__server__APP_DATA_PATH` sur un partage **NFS** monté dans le service, de sorte qu'elles persistent après les redémarrages et les révisions. Un bucket **Cloud Storage** `data` est également provisionné, et les sauvegardes planifiées atterrissent dans le bucket de sauvegarde de la fondation. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances (ou Compute Engine → Instances de VM pour le serveur NFS autogéré) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Trois secrets sont gérés automatiquement : le mot de passe de la base de données (injecté comme `GITEA__database__PASSWD`), le `SECRET_KEY` de Gitea (chiffre les données sensibles stockées telles que la 2FA et les jetons OAuth2), et son `INTERNAL_TOKEN` (authentifie les propres appels d'API internes de Gitea). Tous sont générés une seule fois et injectés au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gitea"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Artifact Registry et Cloud Build {#e-artifact-registry--cloud-build}

Le déploiement construit une image personnalisée légère (`FROM gitea/gitea:<application_version>` + le point d'entrée de la plateforme) via Cloud Build et la stocke dans Artifact Registry. L'incrémentation de `application_version` déclenche une reconstruction par rapport à la balise amont correspondante.

- **Console :** Artifact Registry → Dépôts ; Cloud Build → Historique.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud builds list --project "$PROJECT" --limit 5
  ```

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gitea {#3-gitea-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` (`postgres:15-alpine`) attend l'instance Cloud SQL, puis crée de manière idempotente le rôle d'application préfixé par le locataire (avec `CREATEDB`), crée la base de données Gitea appartenant à ce rôle et accorde les privilèges. Le job s'exécute à chaque apply (`execute_on_apply = true`, jusqu'à 3 tentatives) et peut être réexécuté en toute sécurité.
- **Câblage de la base de données à l'exécution.** Le point d'entrée de la plateforme logue une ligne comme `Gitea DB wired: host=… sslmode=… name=… user=…` à chaque démarrage, puis passe la main au point d'entrée standard de Gitea (qui écrit toutes les variables d'environnement `GITEA__*` dans `app.ini` et lance le serveur sous s6). Lorsque `DB_HOST` démarre avec `/`, il est traité comme le répertoire de socket du proxy d'authentification Cloud SQL (`SSL_MODE=disable`) ; un hôte de bouclage signifie un sidecar proxy (`disable`) ; tout le reste est l'IP privée via TCP (`SSL_MODE=require`).
- **Installateur ignoré ; le premier inscrit est administrateur.** `INSTALL_LOCK=true` supprime l'installateur web. Enregistrez le premier compte immédiatement après le déploiement — il reçoit les privilèges d'administrateur. Pour les forges privées, définissez ensuite `GITEA__service__DISABLE_REGISTRATION = "true"` via `environment_variables`.
- **Les URL de clonage proviennent de `public_domain` / `public_url`.** Celles-ci pilotent `GITEA__server__DOMAIN` et `GITEA__server__ROOT_URL`. Les valeurs par défaut (`localhost` / dérivées) produisent des URL de clonage et des redirections incorrectes — définissez-les sur l'hôte `run.app` du service ou votre domaine personnalisé.
- **Clonage HTTPS uniquement.** Cloud Run ne route que le port HTTP `container_port` (3000). Le démon SSH intégré à l'image n'est pas accessible, utilisez donc des remotes HTTPS (avec un jeton d'accès Gitea ou un mot de passe) ; le `git clone` basé sur SSH n'est pas disponible sur cette plateforme.
- **Gitea Actions.** Le serveur CI/CD Actions intégré est livré avec Gitea, mais l'exécution des jobs nécessite un calcul `act_runner` séparé que ce module ne provisionne pas.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/healthz`, qui renvoie HTTP 200 sans authentification une fois que Gitea est en service.
- **CLI de vérification :**
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/healthz"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Gitea sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gitea` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Gitea` | Nom convivial affiché dans la Console. |
| `application_version` | `1` | Balise d'image `gitea/gitea` amont sur laquelle le build personnalisé est basé ; incrémenter (par exemple `1.24`) pour mettre à jour. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper légère (requise) ; `prebuilt` déploie l'image standard, qui **ne fonctionne pas sur Cloud Run** (pas d'interpolation d'environnement `$(VAR)` pour le câblage de la base de données). |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `container_port` | `3000` | Port HTTP de Gitea (`GITEA__server__HTTP_PORT`). |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut ; définir `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes. Définir `true` si vous comptez sur la synchronisation miroir planifiée, le cron de santé du dépôt ou la livraison de webhook temporisée. |
| `enable_cloudsql_volume` | `false` | TCP vers l'IP privée de Cloud SQL (SSL requis par le point d'entrée). Définir `true` pour le chemin du proxy d'authentification par socket Unix. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy — notez que l'IAP devant Gitea protège également les clients HTTP `git`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement, secrets et URL publique {#group-6--environment-variables-secrets--public-url}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | carte `EMAIL_SMTP_*` de substitution | Variables d'environnement supplémentaires fusionnées sur les valeurs par défaut du module. Gitea lui-même est configuré via des noms `GITEA__<section>__<KEY>` (par exemple `GITEA__mailer__SMTP_ADDR`, `GITEA__service__DISABLE_REGISTRATION`) ; les clés `EMAIL_SMTP_*` de substitution ne sont pas lues par Gitea. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` — pilote les URL de clonage. Définir sur votre hôte réel. |
| `public_url` | `""` | Définit `GITEA__server__ROOT_URL` ; vide dérive `http://<public_domain>/`. Définir sur `https://<host>/` en production. |
| `secret_environment_variables` | `{}` | Carte de variable d'environnement → nom de secret Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée de la base de données/NFS (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupes 8-11 — CI/CD, SQL personnalisé, Domaine/CDN/WAF, Stockage {#groups-811--cicd-custom-sql-domaincdnwaf-storage}

Comportement standard d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées notables pour Gitea :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Garder activé** — les dépôts, LFS et pièces jointes résident sur le partage NFS. |
| `nfs_mount_path` | `/data` | Chemin de montage ; devient également `GITEA__server__APP_DATA_PATH`. |
| `storage_buckets` | un bucket `data` | Bucket GCS provisionné par la fondation. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe — maintenir synchronisé avec `public_domain`. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Gitea est configuré pour PostgreSQL — ne pas modifier. |
| `db_name` | `gitea` | Nom de base de données ; la fondation le préfixe par le locataire et l'injecte comme `DB_NAME`. |
| `db_user` | `gitea` | Utilisateur de base de l'application ; préfixé par le locataire et injecté comme `DB_USER`. Le mot de passe est injecté comme `GITEA__database__PASSWD`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, délai de 30 s, 10 échecs | Sonde de démarrage contre le point de terminaison de santé de Gitea. |
| `liveness_probe` | HTTP `/api/healthz`, délai de 15 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring — activer pour la production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

Les entrées Redis (`enable_redis`, `redis_host`, `redis_port`, `redis_auth`) sont déclarées pour la convention de la plateforme mais ne sont **pas transmises** par ce module — Gitea n'utilise pas Redis ici ; les définir n'a aucun effet.

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application préfixés par le locataire. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Le module câble `GITEA__database__DB_TYPE=postgres` ; un autre moteur bloque le démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données de la forge. |
| `enable_nfs` | `true` | Critique | Sans le partage NFS, les dépôts/LFS/pièces jointes résident sur un disque éphémère et disparaissent au redémarrage ou à la mise à l'échelle à zéro. |
| `container_image_source` | `custom` | Critique | L'image standard n'a pas de point d'entrée de plateforme ; Gitea essaie de composer un hôte littéralement nommé `$(DB_HOST)` et ne démarre jamais. |
| `container_port` | `3000` | Critique | Un port HTTP de Gitea non concordant fait échouer toutes les sondes. |
| Paramètres de la base de données via env | ne jamais coder en dur `gitea` | Critique | Les vrais `DB_USER`/`DB_NAME` sont préfixés par le locataire ; le codage en dur échoue avec `password authentication failed`. |
| `GITEA__service__DISABLE_REGISTRATION` | `true` après le premier admin | Élevé | Laissé ouvert, quiconque trouve l'URL peut s'inscrire sur votre forge (le tout premier inscrit est admin — réclamez-le immédiatement). |
| `public_domain` / `public_url` | hôte réel | Élevé | Les valeurs par défaut (`localhost`) produisent des URL de clonage et des redirections cassées dans l'interface utilisateur. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent gen2. |
| `enable_cloudsql_volume` | `false` (TCP) | Élevé | Si basculé en mode socket, le point d'entrée s'adapte — mais des remplacements manuels `GITEA__database__HOST` non concordants cassent la sélection du mode SSL. |
| `cpu_always_allocated` | `false`, ou `true` pour les miroirs/cron | Moyen | La facturation basée sur les requêtes ralentit le travail en arrière-plan ; la synchronisation miroir planifiée et les webhooks temporisés s'arrêtent au ralenti. |
| `min_instance_count` | `0` (ou `1` pour les équipes) | Moyen | La mise à l'échelle à zéro ajoute un démarrage à froid à la première opération `git` après l'inactivité. |
| `uptime_check_config` | activer pour la production | Moyen | Désactivé par défaut ; pas de signal de disponibilité externe. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Gitea partagée avec la variante GKE est décrite dans **[Gitea_Common](Gitea_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gitea sur Cloud Run](../labs/Gitea_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gitea sur GKE Autopilot](Gitea_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gitea Common — Configuration d'application partagée](Gitea_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Woodpecker CI sur GKE Autopilot](Woodpecker_GKE.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Contrôle de source et CI/CD**.
