---
title: "Synapse sur Google Cloud Run"
description: "Référence de configuration pour déployer Synapse sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Synapse_CloudRun.md @ 3055034 sha256:a24ab3bcbefd -->

# Synapse sur Google Cloud Run {#synapse-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Synapse_CloudRun.png" alt="Synapse sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Synapse est le homeserver [Matrix](https://matrix.org/) de référence — le serveur
Python open source, sous licence Apache 2.0, du protocole Matrix, un standard ouvert
de communication en temps réel décentralisée et fédérée (messagerie sécurisée et VoIP).
Ce module déploie Synapse sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée. Les utilisateurs se connectent au homeserver avec un client Matrix tel que
l'application web [Element](https://element.io/).

Ce guide se concentre sur les services cloud qu'utilise Synapse et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Synapse s'exécute comme un conteneur Python sur Cloud Run v2. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Homeserver Python, 2 vCPU / 4 GiB par défaut, maintenu actif (`min_instance_count = 1`) |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Synapse ne prend pas en charge MySQL ; la base de données **doit** utiliser la collation `C` |
| Stockage objet | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Fichiers persistants | NFS (Filestore) | Clé de signature et dépôt de médias dans le répertoire de données ; activé par défaut |
| Secrets | Secret Manager | Secret partagé d'enregistrement généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire, avec la collation `C`.** Le moteur de base de
  données est fixé par la couche applicative partagée, et le job `db-init` du premier
  déploiement crée la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` — Synapse
  refuse de démarrer avec toute autre collation.
- **Synapse gère lui-même son schéma.** Il n'y a pas de job de migration distinct ;
  Synapse crée et met à niveau son propre schéma automatiquement à chaque démarrage.
- **`homeserver.yaml` et la clé de signature sont générés au premier démarrage.** Le
  point d'entrée cloud génère la configuration ainsi qu'une clé de signature
  persistante dans le répertoire de données, et raccorde le PostgreSQL de la
  plateforme avant de démarrer Synapse.
- **La clé de signature doit être persistante.** La régénérer casse la fédération et
  invalide toutes les sessions des appareils ; le répertoire de données repose donc sur
  un stockage NFS persistant (`enable_nfs = true` par défaut).
- **`server_name` est fixé à `matrix.local`.** C'est le domaine intégré à chaque
  identifiant utilisateur (`@user:server_name`) et à la fédération. `Synapse_CloudRun`
  n'expose pas d'entrée `server_name` — la valeur provient toujours de la valeur par
  défaut de `Synapse_Common`, si bien qu'un déploiement de production nécessitant un
  vrai domaine impose actuellement de surcharger directement le module Common.
- **Écoute sur le port 8008.** L'écouteur HTTP client + fédération est défini dans la
  configuration générée ; la santé est servie sans authentification sur `/health`.
- **Maintenu actif, sans mise à zéro.** Un homeserver entretient la fédération, la
  rétention en arrière-plan et la présence entre les requêtes ; `min_instance_count = 1`
  et `cpu_always_allocated = true` sont donc les valeurs par défaut. La mise à zéro
  convient mal à un homeserver fédéré (une instance froide manque le trafic de
  fédération entrant).
- **Redis n'est pas utilisé.** Synapse exécute un seul processus principal reposant
  entièrement sur PostgreSQL.
- **Les utilisateurs administrateurs sont créés hors bande.** L'enregistrement libre
  en libre-service est désactivé par défaut ; créez les utilisateurs avec
  `register_new_matrix_user` et le secret partagé d'enregistrement stocké dans Secret
  Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service Synapse {#a-cloud-run--the-synapse-service}

Synapse s'exécute comme un service Cloud Run v2. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements
progressifs sûrs.

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

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Synapse stocke tout l'état du homeserver (comptes, salons, événements, clés des
appareils, état de la fédération) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte de façon privée via le **Cloud SQL Auth Proxy**
par un socket Unix ; aucune IP publique n'est exposée. Au premier déploiement, un Job
`db-init` crée la base de données de l'application **avec la collation `C`** ainsi que
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Verify the mandatory collation:
  #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Outputs](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage et répertoire de données persistant {#c-cloud-storage--the-persistent-data-directory}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement. L'état
d'exécution propre à Synapse — `homeserver.yaml`, les surcharges `conf.d`, la
**clé de signature** et le dépôt de médias — réside dans le répertoire de données
(`SYNAPSE_DATA_DIR = /data`), qui repose sur le volume NFS (Filestore) monté sur le
chemin de montage configuré.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

Un **secret partagé d'enregistrement** est généré automatiquement et stocké dans
Secret Manager ; il alimente `register_new_matrix_user` pour la création de comptes
hors bande. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~synapse"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Le trafic des clients Matrix
et de la fédération exige une accessibilité publique ; `ingress_settings = "all"` est
donc la valeur par défaut. Un équilibreur de charge HTTPS externe avec un domaine
personnalisé (recommandé en production), Cloud CDN pour les médias et Cloud Armor
peuvent être ajoutés par-dessus.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run
et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et
des règles d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Synapse {#3-synapse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init`
  exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth
  Proxy et crée de façon idempotente le rôle de l'application et la base de données
  **avec la collation `C`** (`LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`), en
  recréant une base vide à la mauvaise collation si le socle en a créé une
  auparavant. Le job peut être réexécuté sans risque.
- **Pas de job de migration — schéma autogéré.** Synapse crée et met à niveau son
  schéma à chaque démarrage ; la mise à niveau de la version de l'application applique
  donc les modifications de schéma sans étape de migration distincte.
- **Configuration et clé de signature générées au premier démarrage.** Le point
  d'entrée cloud génère `homeserver.yaml` et une clé de signature persistante dans
  `/data`, écrit un fragment `conf.d` raccordant PostgreSQL et l'écouteur
  `0.0.0.0:8008`, puis lance Synapse. La clé de signature n'est générée qu'une seule
  fois — conservez `/data` sur un stockage persistant.
- **`server_name` est fixé à `matrix.local`.** `Synapse_CloudRun` n'expose pas
  d'entrée `server_name` (il utilise toujours la valeur par défaut de
  `Synapse_Common`) ; modifier la valeur sous-jacente après le premier démarrage
  invalide chaque identifiant utilisateur, chaque session d'appareil et chaque relation
  de fédération.
- **Chemin de santé.** Les sondes `startup_probe`/`liveness_probe` par défaut ciblent
  `/` (la racine). Synapse sert aussi un point de terminaison `/health` sans
  authentification (`OK`), utilisable en surchargeant ces chemins de sonde. Vérifiez
  que l'API client répond avec `GET /_matrix/client/versions` :
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/_matrix/client/versions"
  ```
- **Le job `create-admin` s'ignore lui-même ici.** `Synapse_Common` fournit aussi un
  job `create-admin` qui enregistre le superutilisateur initial via
  `register_new_matrix_user`, mais il se termine avec le code 0 sans rien faire lorsque
  `internal_service_url` est vide — et seul `Synapse_GKE` renseigne cette valeur ; sur
  Cloud Run, c'est donc toujours à vous de créer le compte administrateur.
- **Créez le premier utilisateur administrateur** avec l'outil d'enregistrement
  Matrix, en utilisant le secret partagé stocké dans Secret Manager :
  ```bash
  register_new_matrix_user -c homeserver.yaml -u admin -a https://<your-domain>
  ```
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Synapse ou notables pour lui sont
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
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `synapse` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Synapse Helpdesk` | Nom lisible affiché dans la console. La valeur par défaut fournie est un reliquat d'un modèle d'application de helpdesk — surchargez-la. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image Synapse ; fixez une version précise (p. ex. `v1.119.0`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Mettez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; **2 GiB minimum** pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Maintient le homeserver actif pour la fédération et les tâches en arrière-plan. Ne **pas** mettre `0` pour un serveur fédéré. |
| `max_instance_count` | `5` | Limite supérieure de la mise à l'échelle automatique. |
| `cpu_always_allocated` | `true` | CPU toujours alloué, afin que la fédération et la rétention en arrière-plan continuent entre les requêtes. |
| `container_port` | `8008` | Écouteur HTTP client + fédération de Synapse. |
| `execution_environment` | `gen2` | Gen2 est nécessaire pour les montages NFS/GCS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `container_image_source` | `custom` | Build personnalisé léger `FROM matrixdotorg/synapse`. |
| `enable_image_mirroring` | `true` | Duplique l'image de base Synapse dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Nécessaire pour le trafic public des clients Matrix et de la fédération. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque la fédération et les clients externes** — à réserver aux homeservers privés ou d'administration. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs `SYNAPSE_*` principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS (utile pour les médias). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket de données GCS. |
| `enable_nfs` | `true` | NFS persistant pour le répertoire de données (clé de signature + médias). |
| `nfs_mount_path` | `/opt/synapse/storage` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `synapse` | Nom de la base PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `synapse` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés : `db-init` (base de données en collation C + rôle) et `create-admin` (s'ignore lui-même sur Cloud Run — voir §3). |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs planifiés. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s | Sonde de démarrage. Synapse sert aussi un point de terminaison `/health` sans authentification, utilisable en surchargeant `path`. |
| `liveness_probe` | HTTP `/` | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Synapse utilise une file d'attente et un cache reposant sur PostgreSQL — laissez `false` sauf en cas d'externalisation. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis (uniquement en cas d'externalisation). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Outputs {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison / port de la base. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `server_name` (fixé à `matrix.local`) | Non exposé comme entrée de `Synapse_CloudRun` | Critical | Une véritable fédération et des identifiants utilisateur durables nécessitent un domaine personnalisé ; ce module n'a pas de variable `server_name`, si bien qu'un usage en production impose actuellement de surcharger directement `Synapse_Common`. Modifier la valeur sous-jacente après le premier démarrage invalide chaque identifiant utilisateur, chaque session d'appareil et chaque relation de fédération. |
| Persistance de la clé de signature (`enable_nfs`) | `true` | Critical | Si le répertoire de données n'est pas persistant, un redémarrage régénère la clé de signature, ce qui casse la fédération et invalide toutes les sessions des appareils. |
| Collation de la base de données (`db-init`) | `C` (automatique) | Critical | Synapse refuse de démarrer avec toute collation autre que `C` ; ne contournez pas le job `db-init`. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `min_instance_count` | `1` | High | La mise à zéro laisse froid un homeserver fédéré — il manque le trafic de fédération entrant et les tâches en arrière-plan sont bloquées. |
| `cpu_always_allocated` | `true` | High | La facturation à la requête réduit le CPU à ~0 entre les requêtes, ce qui bloque la rétention en arrière-plan et les nouvelles tentatives de fédération. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | High | En dessous de 2 GiB, Synapse manque de mémoire (OOM) sous une charge réelle de salons et de fédération. |
| `ingress_settings` | `all` | High | `internal` bloque les clients Matrix et toute la fédération. |
| `enable_iap` | uniquement pour les serveurs privés | High | IAP bloque la fédération et les clients externes ; à réserver aux déploiements d'administration. |
| `container_port` | `8008` | High | Synapse écoute sur 8008 ; un port incohérent fait viser à la sonde un port mort, et la révision ne devient jamais Ready. |
| Chemin de sonde | `/` (par défaut) ou `/health` | High | Pointer `startup_probe`/`liveness_probe` vers un chemin d'API Matrix authentifié renvoie 401/403, et la révision ne devient jamais Ready. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |
| `enable_cdn` | à activer pour les serveurs riches en médias | Medium | Les téléchargements de médias sont servis directement par l'instance, sans délestage vers un CDN. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication d'images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Synapse, partagée avec la variante GKE, est décrite dans
**[Synapse_Common](Synapse_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Synapse sur Cloud Run](../labs/Synapse_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Synapse sur GKE Autopilot](Synapse_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Synapse Common — Configuration applicative partagée](Synapse_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Element sur Google Cloud Run](Element_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) et [Headscale sur Google Cloud Run](Headscale_CloudRun.md) dans la solution **Secure Team Communications**.
