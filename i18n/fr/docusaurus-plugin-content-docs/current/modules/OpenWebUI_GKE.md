---
title: "Open WebUI sur GKE Autopilot"
description: "Référence de configuration pour déployer Open WebUI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OpenWebUI_GKE.md @ 3055034 sha256:e4b19b5bfcd0 -->

# Open WebUI sur GKE Autopilot {#open-webui-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenWebUI_GKE.png" alt="Open WebUI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Open WebUI est une interface d'IA auto-hébergée qui offre un frontend soigné de type
ChatGPT pour Ollama, les API compatibles OpenAI et des dizaines d'autres fournisseurs
de LLM. Ce module déploie Open WebUI sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Open WebUI et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Open WebUI s'exécute sous forme de charge de travail web Python adossée à PostgreSQL. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods web Python, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — les sessions, les conversations et les données RAG y sont toutes stockées |
| Fichiers partagés | Filestore (NFS) | Facultatif — nécessaire uniquement lorsque plusieurs réplicas partagent des fichiers téléversés |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Secrets | Secret Manager | `WEBUI_SECRET_KEY` et mot de passe de la base de données générés automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

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
- **`min_instance_count` vaut `1` par défaut** (un pod chaud, pas de mise à l'échelle à
  zéro). Définissez-le à `0` pour autoriser la mise à l'échelle à zéro, au prix d'une
  latence de démarrage à froid de 30–60 s à la première requête (démarrage du pod + du
  proxy Cloud SQL).
- **Les sondes de santé ciblent `/health`.** Open WebUI expose ce chemin nativement ;
  les sondes de démarrage et de vivacité l'utilisent toutes deux.
- **`DATABASE_URL` est assemblée automatiquement** à partir des identifiants Cloud SQL
  injectés par la plateforme — ne la remplacez pas.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Open WebUI {#a-gke-autopilot--the-open-webui-workload}

Les pods Open WebUI sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods (Horizontal Pod
Autoscaling) dimensionne le déploiement entre le nombre minimal et le nombre maximal de
réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Open
  WebUI pour consulter les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Open WebUI stocke toutes les données applicatives — comptes utilisateur, conversations,
index RAG et embeddings des documents téléversés — dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth
Proxy** sur un socket Unix ; aucune IP publique n'est donc exposée. Lors du premier
déploiement, un Job d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> \
    --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation du mot de passe,
consultez [App_GKE](App_GKE.md).

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

Consultez [App_GKE](App_GKE.md) pour les options GCS Fuse et CMEK.

### D. Filestore (NFS) — stockage partagé facultatif {#d-filestore-nfs--optional-shared-storage}

NFS est désactivé par défaut. Activez-le (`enable_nfs = true`) lorsque plus d'un réplica
s'exécute et que les fichiers téléversés doivent être visibles depuis tous les pods. Sans
stockage partagé, un fichier téléversé sur un pod n'est pas visible depuis un autre.

- **Console :** Filestore → Instances pour le partage NFS.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour les détails du provisionnement NFS.

### E. Secret Manager {#e-secret-manager}

`WEBUI_SECRET_KEY` (clé de signature des sessions) et le mot de passe de la base de
données sont stockés sous forme de secrets Secret Manager et injectés dans les pods à
l'exécution ; le texte en clair n'apparaît jamais dans la configuration ni dans les
journaux.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store
CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing. Un
domaine personnalisé avec certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE
et Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Open WebUI {#3-open-webui-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`) exécute `postgres:15-alpine` sur l'instance Cloud SQL via
  l'Auth Proxy. Il crée de manière idempotente la base de données et l'utilisateur de
  l'application avant le démarrage de celle-ci.
- **Migrations de la base de données au démarrage.** Open WebUI exécute ses propres
  migrations de schéma Alembic à chaque démarrage ; mettre à niveau
  `application_version` applique donc automatiquement les nouvelles modifications de
  schéma. Au premier démarrage, cela peut prendre 30 à 60 secondes.
- **Assemblage de `DATABASE_URL`.** Le point d'entrée personnalisé (`entrypoint.sh`)
  assemble la `DATABASE_URL` à partir des variables d'environnement `DB_HOST`,
  `DB_USER`, `DB_PASSWORD` et `DB_NAME` injectées par la plateforme. Le mot de passe est
  au passage encodé pour URL. Ne remplacez pas `DATABASE_URL` directement.
- **`WEBUI_SECRET_KEY` est immuable.** La clé signe toutes les sessions utilisateur. Sa
  rotation (par exemple en redéployant avec une nouvelle valeur aléatoire) déconnecte
  immédiatement tous les utilisateurs actifs et invalide tous les jetons « se souvenir de
  moi ». Considérez-la comme permanente après la première connexion.
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
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/health`, qui renvoie HTTP 200 dès que l'application et la connexion à la base de
  données sont prêtes. La sonde de démarrage accorde jusqu'à 300 secondes (30 échecs ×
  période de 10 secondes) pour que la migration du premier démarrage se termine.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Open WebUI ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openwebui` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Open WebUI` | Nom convivial affiché dans la console. |
| `description` | _(définie)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Open WebUI. Épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour les charges de travail RAG. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (les pipelines RAG peuvent utiliser 3–6 GiB sous charge). |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Définissez `1` pour un usage interactif en équipe ; `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8080` | Port HTTP d'Open WebUI (correspond à l'`EXPOSE` de l'image officielle). |
| `timeout_seconds` | `300` | Timeout des requêtes. Augmentez à `600`–`3600` pour un RAG riche en documents ou des backends LLM lents. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — doit valoir `true` pour se connecter à Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Open WebUI dans Artifact Registry (évite les limites de débit de GHCR). |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources (désactive le HPA s'il est activé). |

### Groupe 5 — Paramètres Open WebUI {#group-5--open-webui-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ollama_base_url` | `""` | URL de base du backend Ollama (par ex. `http://ollama:11434`). Laissez vide si vous n'utilisez pas Ollama directement. |
| `openai_api_base_url` | `""` | URL de base d'une API compatible OpenAI (par ex. `https://api.openai.com/v1`). Doit inclure le suffixe `/v1`. |
| `default_user_role` | `pending` | Rôle attribué aux nouveaux comptes auto-inscrits. `pending` exige l'approbation d'un administrateur ; `user` accorde un accès immédiat. |
| `enable_signup` | `true` | Autorise la page d'inscription. Définissez `false` en production une fois les comptes administrateur créés. |
| `webui_auth` | `true` | Active le formulaire de connexion. Ne définissez `false` que pour des déploiements mono-utilisateur ou entièrement isolés (air-gapped). |
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne remplacez pas `DATABASE_URL` ni `WEBUI_SECRET_KEY`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. À utiliser pour `OPENAI_API_KEY` et les valeurs similaires. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant — recommandé pour la cohérence des sessions d'Open WebUI. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC dans le StatefulSet pour la persistance locale des données en complément de PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC. Le chemin de montage par défaut est `/app/backend/data`. |
| `stateful_pvc_mount_path` | `/app/backend/data` | Chemin du conteneur où est monté le PVC propre à chaque pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin d'une marge pour les évictions. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | chemin `/health` | Sonde HTTP sur le point de terminaison de santé d'Open WebUI. Délai initial de 30 s avec 30 échecs tolérés pour les migrations du premier démarrage. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Tâches et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init`. |
| `cron_jobs` | `[]` | Open WebUI ne nécessite aucune commande planifiée ; ajoutez ici les tâches récurrentes propres à votre application. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé — nécessaire lorsque plusieurs réplicas doivent partager des fichiers téléversés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données. |
| `storage_buckets` | `[]` | Buckets supplémentaires en plus du bucket de données provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse pour des répertoires supplémentaires adossés à des buckets. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `openwebui_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `openwebui_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restauration à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Open WebUI. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Open WebUI. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_cloudsql_volume` | `true` | Critical | Le désactiver rompt toutes les connexions à la base de données avec Cloud SQL. Ne le désactivez que pour vous connecter à un PostgreSQL externe en TCP. |
| `WEBUI_SECRET_KEY` (généré automatiquement) | immuable après la première utilisation | Critical | La rotation de la clé déconnecte immédiatement tous les utilisateurs actifs et invalide tous les jetons « se souvenir de moi ». |
| `webui_auth` | `true` | Critical | Le désactiver supprime le formulaire de connexion — toute personne pouvant atteindre l'URL dispose d'un accès administrateur complet sans identifiants. |
| `db_name` / `db_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; les modifier recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `database_type` (fixe) | `POSTGRES_15` | Critical | Open WebUI nécessite PostgreSQL ; tout autre moteur fait échouer les migrations et le démarrage. |
| `ollama_base_url` / `openai_api_base_url` | au moins l'un des deux défini | High | Sans URL de backend, Open WebUI démarre mais toutes les requêtes d'inférence de modèle échouent immédiatement. |
| `default_user_role` | `pending` | High | `user` approuve automatiquement toutes les auto-inscriptions ; sur un service exposé publiquement, cela permet une inscription sans restriction. |
| `enable_signup` | `true` (définir `false` en prod après l'intégration des utilisateurs) | High | Combiné à `default_user_role = "user"`, tout visiteur peut s'inscrire et accéder à tous les modèles. |
| `memory_limit` | `4Gi` | High | Les pipelines RAG peuvent consommer 3–6 GiB sous charge ; une mémoire insuffisante provoque des arrêts OOM en pleine ingestion. |
| `backup_schedule` | `0 2 * * *` | High | Sans sauvegardes automatiques, la base de données PostgreSQL (utilisateurs, conversations, données RAG) n'est pas protégée. |
| `application_version` | version épinglée en prod | Medium | `latest` risque une mise à niveau involontaire avec une modification de schéma qui fait échouer le démarrage. |
| `min_instance_count` | `1` en usage interactif | Medium | `0` ajoute 30–60 s de latence de démarrage à froid à l'arrivée de la première requête (démarrage du pod + du proxy Cloud SQL). |
| `enable_nfs` | `true` lorsque `max_instance_count > 1` | Medium | Sans stockage partagé, les fichiers téléversés restent locaux au pod et invisibles des autres réplicas. |
| `timeout_seconds` | `300` (augmenter pour RAG/LLM) | Medium | L'ingestion de documents et les longues réponses de modèle sont interrompues au timeout de l'équilibreur de charge. |
| `stateful_pvc_enabled` | `null`/`false` (utiliser GCS à la place) | Medium | Les StatefulSets adossés à des PVC empêchent la migration des pods ; utilisez GCS Fuse sauf si les IOPS locales sont critiques. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Medium | Sans eux, l'interface est accessible publiquement avec pour seule barrière l'authentification intégrée d'Open WebUI. |

---

Pour le comportement du socle auquel ce guide fait référence — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Open WebUI partagée avec
la variante Cloud Run est décrite dans **[OpenWebUI_Common](OpenWebUI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenWebUI sur GKE Autopilot](../labs/OpenWebUI_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Open WebUI Common — Configuration applicative partagée](OpenWebUI_Common.md) — la configuration partagée par les deux cibles de déploiement.
