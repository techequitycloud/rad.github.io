---
title: "Open WebUI sur Google Cloud Run"
description: "Référence de configuration pour déployer Open WebUI sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OpenWebUI_CloudRun.md @ 3055034 sha256:a4889bc656f3 -->

# Open WebUI sur Google Cloud Run {#open-webui-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenWebUI_CloudRun.png" alt="Open WebUI sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Open WebUI est une interface d'IA auto-hébergée qui offre un frontend soigné de type
ChatGPT pour Ollama, les API compatibles OpenAI et des dizaines d'autres fournisseurs
de LLM. Ce module déploie Open WebUI sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud utilisés par Open WebUI et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Open WebUI s'exécute sous forme de conteneur web Python sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service web Python, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — les sessions, les conversations et les données RAG y sont toutes stockées |
| Fichiers partagés | Filestore (NFS) | Facultatif — nécessaire uniquement lorsque plusieurs instances partagent des fichiers téléversés |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Secrets | Secret Manager | `WEBUI_SECRET_KEY` et mot de passe de la base de données générés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Open WebUI ne prend pas en charge MySQL ni aucun
  autre moteur ; le type de base de données est fixé en interne.
- **Pas de Redis.** Open WebUI conserve les sessions et tout l'état applicatif dans
  PostgreSQL. La variable `enable_redis` vaut `false` par défaut et aucune variable
  d'environnement Redis n'est injectée.
- **`WEBUI_SECRET_KEY` est généré automatiquement** et stocké dans Secret Manager. Il
  signe toutes les sessions utilisateur ; sa rotation invalide simultanément toutes les
  sessions actives. Considérez-le comme immuable après la première utilisation.
- **Les nouveaux utilisateurs nécessitent par défaut l'approbation d'un administrateur.**
  `default_user_role = "pending"` signifie que les comptes auto-inscrits ne peuvent pas
  accéder à l'interface tant qu'un administrateur ne les a pas promus.
- **La mise à l'échelle à zéro est activée.** `min_instance_count` vaut `0` par défaut ;
  définissez-le à `1` pour disposer d'une instance chaude dans les déploiements
  interactifs d'équipe.
- **Les sondes de santé ciblent `/health`.** Open WebUI expose ce chemin nativement ;
  les sondes de démarrage et de vivacité l'interrogent toutes deux en HTTP.
- **`DATABASE_URL` est assemblée automatiquement.** Le point d'entrée personnalisé la
  construit à partir des variables d'environnement `DB_*` injectées par la plateforme —
  ne la définissez pas manuellement.
- **L'environnement d'exécution Gen2 est requis** pour les montages NFS et Direct VPC
  Egress.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Open WebUI {#a-cloud-run--the-open-webui-service}

Open WebUI s'exécute en tant que service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
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

Open WebUI stocke toutes les données applicatives — comptes utilisateur, conversations,
index RAG et embeddings des documents téléversés — dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth Proxy**
sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> \
    --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (`openwebui-data`) est provisionné automatiquement
pour le répertoire de données backend d'Open WebUI. Le compte de service de la charge de
travail y reçoit automatiquement l'accès.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Filestore (NFS) — stockage partagé facultatif {#d-filestore-nfs--optional-shared-storage}

NFS est activé par défaut. Il fournit un stockage persistant partagé entre toutes les
instances, ce qui est important lorsque plus d'une instance s'exécute et que les fichiers
téléversés doivent être visibles partout. NFS nécessite l'environnement d'exécution Gen2.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS et les exigences Gen2.

### E. Secret Manager {#e-secret-manager}

`WEBUI_SECRET_KEY` (clé de signature des sessions) et le mot de passe de la base de
données sont stockés dans Secret Manager et injectés dans le service à l'exécution ; le
texte en clair n'apparaît jamais dans la configuration ni dans les journaux.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les
paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Open WebUI {#3-open-webui-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`) exécute `postgres:15-alpine` sur l'instance Cloud SQL via
  l'Auth Proxy. Il crée de manière idempotente la base de données et l'utilisateur de
  l'application avant le démarrage du service.
- **Migrations de la base de données au démarrage.** Open WebUI exécute ses propres
  migrations de schéma Alembic à chaque démarrage ; mettre à niveau
  `application_version` applique donc automatiquement les nouvelles modifications de
  schéma. Au premier démarrage, cela peut prendre 30 à 60 secondes.
- **Assemblage de `DATABASE_URL`.** Le point d'entrée personnalisé (`entrypoint.sh`)
  assemble la `DATABASE_URL` à partir des variables d'environnement `DB_HOST`,
  `DB_USER`, `DB_PASSWORD` et `DB_NAME` injectées par la plateforme. Le mot de passe est
  encodé pour URL afin de gérer les caractères spéciaux. Ne remplacez pas `DATABASE_URL`
  directement.
- **`WEBUI_SECRET_KEY` est immuable.** La clé signe toutes les sessions utilisateur. Sa
  rotation déconnecte immédiatement tous les utilisateurs actifs et invalide tous les
  jetons « se souvenir de moi ». Considérez-la comme permanente après la première
  connexion.
- **Connexion au backend d'IA.** Open WebUI se connecte au démarrage à une instance
  Ollama ou à une API compatible OpenAI. Si ni `ollama_base_url` ni
  `openai_api_base_url` n'est configuré, l'interface démarre mais n'a aucun backend
  d'IA — toutes les requêtes d'inférence de modèle échouent. Fournissez les clés d'API
  (par ex. `OPENAI_API_KEY`) via `secret_environment_variables`, et non via
  `environment_variables`.
- **Processus d'inscription des utilisateurs.** Avec `default_user_role = "pending"`
  (la valeur par défaut), tous les comptes auto-inscrits doivent être promus par un
  administrateur avant de pouvoir utiliser l'interface. Le premier compte administrateur
  doit être créé directement via la page d'inscription lors du premier démarrage.
- **Chemin de santé.** Les sondes de démarrage et de vivacité interrogent toutes deux
  `/health` en HTTP, qui renvoie 200 dès que l'application et la connexion à la base de
  données sont prêtes. La sonde de démarrage accorde jusqu'à 300 secondes (30 échecs ×
  période de 10 secondes) pour que la migration du premier démarrage se termine.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Open WebUI ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

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
| `application_name` | `openwebui` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Open WebUI` | Nom convivial affiché dans la console. |
| `description` | `Open WebUI — self-hosted AI interface for Ollama and OpenAI-compatible APIs` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Open WebUI. Épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés pour les charges de travail RAG. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 4 GiB recommandés (les pipelines RAG peuvent utiliser 3–6 GiB). |
| `min_instance_count` | `0` | Nombre minimal d'instances ; définissez `1` pour conserver une instance chaude en usage interactif. |
| `max_instance_count` | `3` | Nombre maximal d'instances. |
| `container_port` | `8080` | Port HTTP d'Open WebUI (correspond à l'`EXPOSE` de l'image officielle). |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et Direct VPC Egress. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. Augmentez à `600`–`3600` pour l'ingestion de documents ou des backends LLM lents. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — doit valoir `true` pour se connecter à Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Open WebUI dans Artifact Registry (évite les limites de débit de GHCR). |
| `traffic_split` | `[]` | Répartition du trafic canary/blue-green entre les révisions. |

### Groupe 5 — Paramètres et accès Open WebUI {#group-5--open-webui-settings--access}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ollama_base_url` | `""` | URL de base du backend Ollama (par ex. `http://ollama:11434`). Laissez vide si vous n'utilisez pas Ollama directement. |
| `openai_api_base_url` | `""` | URL de base d'une API compatible OpenAI (par ex. `https://api.openai.com/v1`). Doit inclure le suffixe `/v1`. |
| `default_user_role` | `pending` | Rôle attribué aux nouveaux comptes auto-inscrits. `pending` exige l'approbation d'un administrateur ; `user` accorde un accès immédiat. |
| `enable_signup` | `true` | Autorise la page d'inscription. Définissez `false` en production une fois les comptes administrateur créés. |
| `webui_auth` | `true` | Active le formulaire de connexion. Ne définissez `false` que pour des déploiements mono-utilisateur ou entièrement isolés (air-gapped). |
| `ingress_settings` | `all` | Sources de trafic autorisées à atteindre le service (`all`, `internal`, `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne remplacez pas `DATABASE_URL` ni `WEBUI_SECRET_KEY`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. À utiliser pour `OPENAI_API_KEY` et d'autres valeurs sensibles similaires. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restauration à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé — nécessaire lorsque plusieurs instances partagent des fichiers téléversés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `create_cloud_storage` | `true` | Provisionne le bucket de données. |
| `storage_buckets` | `[]` | Buckets supplémentaires en plus du bucket de données provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse pour des répertoires supplémentaires adossés à des buckets. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Open WebUI nécessite PostgreSQL 15. |
| `db_name` | `openwebui_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `openwebui_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init`. |
| `cron_jobs` | `[]` | Open WebUI ne nécessite aucune commande planifiée ; ajoutez ici les tâches récurrentes propres à votre application. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 30s, timeout de 5s, période de 10s, 30 tentatives | Accorde jusqu'à ~5 minutes pour le démarrage initial. |
| `liveness_probe` | HTTP `/health`, délai de 60s, timeout de 5s, période de 30s, 3 tentatives | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Redis n'est pas nécessaire — Open WebUI conserve tout son état dans PostgreSQL. |
| `redis_host` | `""` | Point de terminaison Redis (pertinent uniquement si `enable_redis` est défini à `true`). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
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
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_cloudsql_volume` | `true` | Critique | Le désactiver rompt toutes les connexions à la base de données avec Cloud SQL. Ne le désactivez que pour vous connecter à un PostgreSQL externe en TCP. |
| `WEBUI_SECRET_KEY` (généré automatiquement) | immuable après la première utilisation | Critique | La rotation de la clé déconnecte immédiatement tous les utilisateurs actifs et invalide tous les jetons « se souvenir de moi ». |
| `webui_auth` | `true` | Critique | Le désactiver supprime le formulaire de connexion — toute personne pouvant atteindre l'URL dispose d'un accès administrateur complet sans identifiants. |
| `db_name` / `db_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les modifier recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `database_type` (fixe) | `POSTGRES_15` | Critique | Open WebUI nécessite PostgreSQL ; tout autre moteur fait échouer les migrations et le démarrage. |
| `ollama_base_url` / `openai_api_base_url` | au moins l'un des deux défini | Élevé | Sans URL de backend, Open WebUI démarre mais toutes les requêtes d'inférence de modèle échouent immédiatement. |
| `default_user_role` | `pending` | Élevé | `user` approuve automatiquement toutes les auto-inscriptions ; sur un service exposé publiquement, cela permet une inscription sans restriction. |
| `enable_signup` | `true` (définir `false` en prod après l'intégration des utilisateurs) | Élevé | Combiné à `default_user_role = "user"`, tout visiteur peut s'inscrire et accéder à tous les modèles. |
| `memory_limit` | `4Gi` | Élevé | Les pipelines RAG peuvent consommer 3–6 GiB sous charge ; une mémoire insuffisante provoque des arrêts OOM en pleine ingestion. |
| `backup_schedule` | `0 2 * * *` | Élevé | Sans sauvegardes automatiques, la base de données PostgreSQL (utilisateurs, conversations, données RAG) n'est pas protégée. |
| `ingress_settings` | restreindre en prod | Élevé | `all` expose l'interface sur l'internet public — combinez-le avec `webui_auth = true` et `default_user_role = "pending"`. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS et Direct VPC Egress ne sont pas pris en charge en gen1. |
| `application_version` | version épinglée en prod | Moyen | `latest` risque une mise à niveau involontaire avec une modification de schéma qui fait échouer le démarrage. |
| `min_instance_count` | `1` en usage interactif | Moyen | `0` ajoute 20–40 s de latence de démarrage à froid à l'arrivée de la première requête. |
| `enable_nfs` | `true` lorsque `max_instance_count > 1` | Moyen | Sans stockage partagé, les fichiers téléversés restent locaux à l'instance et invisibles des autres réplicas. |
| `timeout_seconds` | `300` (augmenter pour RAG/LLM) | Moyen | L'ingestion de documents et les longues réponses de modèle sont interrompues au timeout de Cloud Run. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Moyen | Sans eux, l'interface est accessible publiquement avec pour seule barrière l'authentification intégrée d'Open WebUI. |

---

Pour le comportement du socle auquel ce guide fait référence — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Open WebUI
partagée avec la variante GKE est décrite dans
**[OpenWebUI_Common](OpenWebUI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenWebUI sur Cloud Run](../labs/OpenWebUI_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Open WebUI sur GKE Autopilot](OpenWebUI_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Open WebUI Common — Configuration applicative partagée](OpenWebUI_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) dans la solution **Private AI Assistant**.
