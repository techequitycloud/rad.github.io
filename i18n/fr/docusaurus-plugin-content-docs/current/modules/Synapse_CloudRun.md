---
title: "Synapse sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Synapse sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Synapse_CloudRun.md @ 15fd4c7 sha256:67c8275a13b7 -->

# Synapse sur Google Cloud Run {#synapse-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Synapse_CloudRun.png" alt="Synapse sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Synapse est le homeserver [Matrix](https://matrix.org/) de référence — le serveur Python open-source sous licence Apache 2.0 pour le protocole Matrix, un standard ouvert pour la communication décentralisée et fédérée en temps réel (chat sécurisé et VoIP). Ce module déploie Synapse sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée. Les utilisateurs se connectent au homeserver avec un client Matrix tel que l'application web [Element](https://element.io/).

Ce guide se concentre sur les services cloud utilisés par Synapse et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Synapse s'exécute en tant que conteneur Python sur Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Homeserver Python, 2 vCPU / 4 GiB par défaut, maintenu chaud (`min_instance_count = 1`) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Synapse ne prend pas en charge MySQL ; la base de données **doit** utiliser la collation `C` |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Fichiers persistants | NFS (Filestore) | Clé de signature + dépôt de médias sous le répertoire de données ; activé par défaut |
| Secrets | Secret Manager | Secret partagé d'enregistrement auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire, avec la collation `C`.** Le moteur de base de données est fixé par la couche d'application partagée, et le job `db-init` du premier déploiement crée la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` — Synapse refuse de démarrer avec toute autre collation.
- **Synapse gère son propre schéma.** Il n'y a pas de job de migration séparé ; Synapse crée et met à jour son propre schéma automatiquement à chaque démarrage.
- **`homeserver.yaml` et la clé de signature sont générés au premier démarrage.** Le point d'entrée cloud génère la configuration plus une clé de signature persistante dans le répertoire de données et connecte la plateforme PostgreSQL avant de démarrer Synapse.
- **La clé de signature doit persister.** La régénérer interrompt la fédération et invalide toutes les sessions d'appareil, de sorte que le répertoire de données est sauvegardé par un stockage NFS persistant (`enable_nfs = true` par défaut).
- **`server_name` est fixé à `matrix.local`.** C'est le domaine intégré à chaque ID utilisateur (`@user:server_name`) et à la fédération. `Synapse_CloudRun` n'expose pas d'entrée `server_name` — la valeur provient toujours de la valeur par défaut de `Synapse_Common`, de sorte qu'un déploiement de production nécessitant un domaine réel nécessite actuellement de surcharger directement le module Common.
- **Écoute sur le port 8008.** L'écouteur HTTP client + fédération est défini dans la configuration générée ; la santé est servie sans authentification à `/health`.
- **Maintenu chaud, non mis à l'échelle à zéro.** Un homeserver maintient la fédération, la rétention en arrière-plan et la présence entre les requêtes, donc `min_instance_count = 1` et `cpu_always_allocated = true` sont les valeurs par défaut. La mise à l'échelle à zéro est mal adaptée à un homeserver fédérateur (une instance froide manque le trafic de fédération entrant).
- **Redis n'est pas utilisé.** Synapse exécute un seul processus principal entièrement soutenu par PostgreSQL.
- **Les utilisateurs administrateurs sont créés hors bande.** L'enregistrement en libre-service ouvert est désactivé par défaut ; créez des utilisateurs avec `register_new_matrix_user` et le secret partagé d'enregistrement dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Synapse {#a-cloud-run--the-synapse-service}

Synapse s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Synapse stocke tout l'état du homeserver (comptes, salles, événements, clés d'appareil, état de fédération) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, un job `db-init` crée la base de données de l'application **avec la collation `C`** et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Verify the mandatory collation:
  #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et le répertoire de données persistant {#c-cloud-storage--the-persistent-data-directory}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement. L'état d'exécution propre à Synapse — `homeserver.yaml`, les remplacements `conf.d`, la **clé de signature** et le dépôt de médias — se trouve sous le répertoire de données (`SYNAPSE_DATA_DIR = /data`), qui est sauvegardé par le volume NFS (Filestore) monté au chemin de montage configuré.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

Un **secret partagé d'enregistrement** est généré automatiquement et stocké dans Secret Manager ; il prend en charge `register_new_matrix_user` pour la création de comptes hors bande. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~synapse"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Le trafic client et de fédération Matrix nécessite une accessibilité publique, donc `ingress_settings = "all"` est la valeur par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé (recommandé pour la production), Cloud CDN pour les médias et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Synapse {#3-synapse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente le rôle d'application et la base de données **avec la collation `C`** (`LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`), recréant une base de données vide de mauvaise collation si la fondation en a créé une en premier. Le job peut être réexécuté en toute sécurité.
- **Pas de job de migration — schéma auto-géré.** Synapse crée et met à jour son schéma à chaque démarrage, de sorte que la mise à niveau de la version de l'application applique les modifications de schéma sans étape de migration séparée.
- **Configuration + clé de signature générées au premier démarrage.** Le point d'entrée cloud génère `homeserver.yaml` et une clé de signature persistante dans `/data`, écrit un extrait `conf.d` connectant PostgreSQL et l'écouteur `0.0.0.0:8008`, puis exécute Synapse. La clé de signature n'est générée qu'une seule fois — conservez `/data` sur un stockage persistant.
- **`server_name` est fixé à `matrix.local`.** `Synapse_CloudRun` n'expose pas d'entrée `server_name` (il utilise toujours la valeur par défaut `Synapse_Common`) ; modifier la valeur sous-jacente après le premier démarrage invalide chaque ID utilisateur, session d'appareil et relation de fédération.
- **Chemin de santé.** Les cibles par défaut `startup_probe`/`liveness_probe` `/` (racine). Synapse sert également un point de terminaison `/health` non authentifié (`OK`) qui peut être utilisé en remplaçant ces chemins de sonde. Confirmez que l'API client fonctionne avec `GET /_matrix/client/versions` :
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/_matrix/client/versions"
  ```
- **Le job `create-admin` s'auto-ignore ici.** `Synapse_Common` fournit également un job `create-admin` qui enregistre le superutilisateur initial via `register_new_matrix_user`, mais il se termine avec le code 0 sans rien faire lorsque `internal_service_url` est vide — et seul `Synapse_GKE` connecte cette valeur, donc sur Cloud Run, le compte administrateur est toujours à créer par vous.
- **Créez le premier utilisateur administrateur** avec l'outil d'enregistrement Matrix, en utilisant le secret partagé de Secret Manager :
  ```bash
  register_new_matrix_user -c homeserver.yaml -u admin -a https://<your-domain>
  ```
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Synapse sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `synapse` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Synapse Helpdesk` | Nom lisible par l'homme affiché dans la console. La valeur par défaut fournie est un texte passe-partout hérité d'un modèle d'application de support technique — remplacez-la. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image Synapse ; épinglez à une version spécifique (par exemple `v1.119.0`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; **minimum 2 GiB** pour un fonctionnement fiable. |
| `min_instance_count` | `1` | Maintient le homeserver chaud pour la fédération et les tâches en arrière-plan. Ne **pas** définir `0` pour un serveur fédérateur. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `cpu_always_allocated` | `true` | CPU toujours alloué pour que la fédération/rétention en arrière-plan continue de fonctionner entre les requêtes. |
| `container_port` | `8008` | Écouteur HTTP client + fédération de Synapse. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `container_image_source` | `custom` | Build personnalisé léger `FROM matrixdotorg/synapse`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base Synapse dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis pour le trafic client Matrix public et la fédération. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque la fédération et les clients externes** — à utiliser uniquement pour les homeservers privés/administrateurs uniquement. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs de base `SYNAPSE_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
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

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS (utile pour les médias). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket de données GCS. |
| `enable_nfs` | `true` | NFS persistant pour le répertoire de données (clé de signature + médias). |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `synapse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `synapse` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés : `db-init` (base de données + rôle avec collation C) et `create-admin` (s'auto-ignore sur Cloud Run — voir §3). |
| `cron_jobs` | `[]` | Jobs Cloud Scheduler + Cloud Run planifiés. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 60s | Sonde de démarrage. Synapse sert également un point de terminaison `/health` non authentifié qui peut être utilisé en remplaçant `path`. |
| `liveness_probe` | HTTP `/` | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Synapse utilise une file d'attente/cache basée sur PostgreSQL — laissez `false` sauf si vous externalisez. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis (uniquement en cas d'externalisation). |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
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
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment du plan — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide échoue le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `server_name` (fixé `matrix.local`) | Non exposé comme une entrée `Synapse_CloudRun` | Critique | La fédération réelle et les ID utilisateur durables nécessitent un domaine personnalisé ; ce module n'a pas de variable `server_name`, de sorte que l'utilisation en production nécessite actuellement de surcharger directement `Synapse_Common`. Modifier la valeur sous-jacente après le premier démarrage invalide chaque ID utilisateur, session d'appareil et relation de fédération. |
| Persistance de la clé de signature (`enable_nfs`) | `true` | Critique | Si le répertoire de données n'est pas persistant, un redémarrage régénère la clé de signature, interrompant la fédération et invalidant toutes les sessions d'appareil. |
| Collation de la base de données (`db-init`) | `C` (automatique) | Critique | Synapse refuse de démarrer avec toute collation non-`C` ; ne contournez pas le job `db-init`. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro laisse un homeserver fédérateur froid — il manque le trafic de fédération entrant et les tâches en arrière-plan stagnent. |
| `cpu_always_allocated` | `true` | Élevé | La facturation basée sur les requêtes limite le CPU à ~0 entre les requêtes, ce qui bloque la rétention en arrière-plan et les tentatives de fédération. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous de 2 GiB, Synapse manque de mémoire sous une charge réelle de salle/fédération. |
| `ingress_settings` | `all` | Élevé | `internal` bloque les clients Matrix et toute la fédération. |
| `enable_iap` | uniquement pour les serveurs privés | Élevé | IAP bloque la fédération et les clients externes ; à utiliser uniquement pour les déploiements réservés aux administrateurs. |
| `container_port` | `8008` | Élevé | Synapse écoute sur le port 8008 ; un port non concordant fait que la sonde atteint un port mort et la révision ne devient jamais prête. |
| Chemin de sonde | `/` (par défaut) ou `/health` | Élevé | Pointer `startup_probe`/`liveness_probe` vers un chemin d'API Matrix authentifié renvoie 401/403 et la révision ne devient jamais prête. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cdn` | activer pour les serveurs riches en médias | Moyen | Les téléchargements de médias sont servis directement depuis l'instance sans déchargement CDN. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Synapse partagée avec la variante GKE est décrite dans **[Synapse_Common](Synapse_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Synapse sur Cloud Run](../labs/Synapse_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Synapse sur GKE Autopilot](Synapse_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Synapse Common — Configuration d'application partagée](Synapse_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Element sur Google Cloud Run](Element_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md), [Headscale sur Google Cloud Run](Headscale_CloudRun.md) dans la solution **Communications d'équipe sécurisées**.
