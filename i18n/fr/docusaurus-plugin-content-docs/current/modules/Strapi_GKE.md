---
title: "Strapi sur GKE Autopilot"
description: "Référence de configuration pour déployer Strapi sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Strapi_GKE.md @ 3055034 sha256:9e6866df5dbb -->

# Strapi sur GKE Autopilot {#strapi-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Strapi_GKE.png" alt="Strapi sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Strapi est le principal CMS headless open source — il fournit une API de contenu
entièrement personnalisable (REST et GraphQL) avec un panneau d'administration riche,
utilisée par des entreprises et des développeurs du monde entier pour la gestion de
contenu et les architectures API-first. Ce module déploie Strapi sur **GKE Autopilot**
en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Strapi et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Strapi s'exécute sous forme de conteneur Node.js sur GKE Autopilot. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Strapi requiert PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Médias téléversés et ressources partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux téléversements (suffixe `strapi-uploads`) |
| Cache (facultatif) | Redis / Memorystore | Facultatif ; désactivé par défaut |
| Secrets | Secret Manager | Cinq secrets cryptographiques générés automatiquement, plus le mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** La couche de données de Strapi est câblée sur
  PostgreSQL ; MySQL et `NONE` empêchent le démarrage.
- **Une image de conteneur personnalisée est construite via Cloud Build.**
  `container_image_source` vaut `"custom"` par défaut — le module construit une image
  Node.js 20 en deux étapes, prête pour la production, à chaque incrément de version.
- **Cinq secrets cryptographiques sont générés automatiquement.** `JWT_SECRET`,
  `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` et `APP_KEYS` sont
  générés et stockés dans Secret Manager lors du premier déploiement et ne doivent
  jamais changer ensuite — ils signent toutes les sessions et tous les jetons d'API
  actifs.
- **NFS est activé par défaut.** Strapi stocke les médias téléversés sous `/uploads`.
  Sans volume NFS partagé, les médias sont perdus au redémarrage d'un pod.
- **Redis est désactivé par défaut.** Activez-le uniquement lorsque vous utilisez des
  plugins qui requièrent explicitement un cache ou un magasin de sessions partagé.
- **Le port du conteneur est 1337.** Le serveur HTTP de Strapi écoute par défaut sur
  le port 1337.
- **Les variables du bucket de médias GCS sont injectées automatiquement — mais
  pointent actuellement vers le mauvais bucket.** `GCS_BUCKET_NAME` et
  `GCS_BASE_URL` sont définies automatiquement, mais `Strapi_GKE/strapi.tf` calcule le
  nom du bucket à partir du préfixe de ressources propre au tenant au lieu du nom de
  bucket propre à l'application que le module socle (`App_GKE`) crée réellement
  (`gcs-${service_name}-strapi-uploads`). Les valeurs injectées référencent donc par
  défaut un bucket qui n'existe pas — consultez la section 3 et les notes du README du
  module pour le correctif.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Strapi {#a-gke-autopilot--the-strapi-workload}

Les pods Strapi sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre les nombres minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Strapi pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Strapi stocke toutes les données applicatives (types de contenu, contenu,
utilisateurs, jetons d'API) dans une instance gérée Cloud SQL for PostgreSQL 15. Les
pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur un
socket Unix, si bien qu'aucune IP publique n'est exposée. Lors du premier déploiement,
un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléversés sont écrits sur un partage **Filestore (NFS)** monté dans
chaque pod, afin que tous les réplicas voient les mêmes fichiers. Un bucket **Cloud
Storage** dédié (suffixe `strapi-uploads`) est également provisionné par le module
socle, et l'accès à ce bucket est accordé automatiquement au compte de service de la
charge de travail — mais consultez le bogue connu décrit à la section 3 : les valeurs
`GCS_BUCKET_NAME`/`GCS_BASE_URL` injectées dans le conteneur ne correspondent
actuellement pas au nom réel de ce bucket, si bien que le fournisseur de
téléversement GCS de Strapi ne s'y connecte pas d'emblée.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets
  pour le bucket des téléversements.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Secret Manager {#d-secret-manager}

Cinq secrets cryptographiques de Strapi sont générés lors du premier déploiement et
stockés dans Secret Manager : `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`,
`TRANSFER_TOKEN_SALT` et `APP_KEYS` (quatre clés jointes par des virgules). Le mot de
passe de la base de données y est également stocké. Tous les secrets sont injectés
dans les pods à l'exécution ; aucune valeur en clair n'apparaît dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret
Store CSI et la rotation.

### E. Cache Redis (facultatif) {#e-redis-cache-optional}

Lorsque `enable_redis = true`, Redis sert de magasin de sessions et de cache des
réponses de l'API REST via les plugins `strapi-plugin-redis` et
`strapi-plugin-rest-cache`. Lorsque `redis_host` est laissé vide et que NFS est
activé, l'IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^REDIS|ENABLE_REDIS"
  ```

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing.
Un domaine personnalisé avec certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et
des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Strapi {#3-strapi-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation s'exécute avec `postgres:15-alpine` et crée de manière idempotente
  la base de données et l'utilisateur Strapi, accorde les privilèges nécessaires (dont
  `CREATEDB`, requis par le système de migration de Strapi) et signale au Cloud SQL
  Auth Proxy de s'arrêter proprement.
- **Fournisseur de médias GCS — incohérence connue du nom de bucket.**
  `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont injectées automatiquement dans le
  conteneur, et le fichier `config/plugins.js` de Strapi détecte ces variables et
  bascule vers le fournisseur
  `@strapi-community/strapi-provider-upload-google-cloud-storage`. Cependant,
  `Strapi_GKE/strapi.tf` construit `GCS_BUCKET_NAME` sous la forme
  `${resource_prefix}-strapi-uploads` à partir de `tenant_resource_prefix`, propre au
  tenant, alors que le module socle (`App_GKE`) nomme en réalité le bucket créé
  `gcs-${service_name}-strapi-uploads` (propre à l'application). Les deux noms ne
  correspondent pas : par défaut, la valeur injectée pointe donc vers un bucket qui n'a
  jamais été créé et les téléversements de médias échouent. (Le module frère
  `Strapi_CloudRun` n'a pas ce bogue — il résout le nom du bucket via
  `module.app_cloudrun.storage_buckets["strapi-uploads"]`.) En attendant un correctif,
  définissez explicitement `GCS_BUCKET_NAME`/`GCS_BASE_URL` dans
  `environment_variables` avec le nom réel du bucket issu de la sortie
  `storage_buckets` de ce module.
- **Envoi d'e-mails (facultatif).** Si `SMTP_HOST` est défini dans
  `environment_variables`, `config/plugins.js` active automatiquement le fournisseur
  d'e-mails `nodemailer` pour les notifications de Strapi (invitations d'utilisateurs,
  réinitialisations de mot de passe, événements de workflow). Définissez
  `SMTP_PASSWORD` via `secret_environment_variables`.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/_health` — un point de terminaison de Strapi qui ne renvoie 200 que lorsque
  l'application et la connexion à la base de données sont prêtes. La sonde de
  démarrage laisse jusqu'à ~300 secondes pour l'initialisation au premier démarrage.
- **Affinité de session.** Vaut `ClientIP` par défaut — recommandé car le panneau
  d'administration de Strapi utilise des connexions WebSocket persistantes pour les
  mises à jour de contenu en temps réel.
- **Les secrets cryptographiques sont immuables après le premier déploiement.** Les
  cinq secrets générés automatiquement signent les sessions actives et les jetons
  d'API. Régénérer l'un d'entre eux invalide immédiatement toutes les sessions et tous
  les jetons actifs.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Strapi ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `strapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Strapi CMS` | Nom lisible affiché dans la console. |
| `application_description` | `Strapi Headless CMS on GKE` | Annotation de description de la charge de travail. |
| `application_version` | `5.0.0` | Tag de l'image ; incrémentez-le pour déclencher une nouvelle exécution Cloud Build et une nouvelle révision de la charge de travail. Ne sélectionne **pas** la version du paquet Strapi — `@strapi/strapi` est figé dans `Strapi_Common/scripts/package.json` (actuellement `4.24.2`) et cette variable n'a aucun effet dessus. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` déclenche Cloud Build ; `"prebuilt"` déploie une URI d'image existante. |
| `container_image` | `""` | URI d'image de remplacement ; laissez vide pour utiliser l'image construite par le module. |
| `container_build_config` | `{ enabled = true }` | Chemin du Dockerfile, contexte de build et arguments de build pour Cloud Build. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pods. |
| `max_instance_count` | `10` | Nombre maximal de réplicas de pods (plafond de l'autoscaler). |
| `container_port` | `1337` | Le serveur Node.js de Strapi écoute sur le port 1337. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites CPU/mémoire et requêtes facultatives. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les opérations longues de traitement de médias. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont injectées automatiquement, mais consultez l'incohérence connue du nom de bucket à la section 3 — remplacez-les explicitement si les téléversements échouent. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager pour des secrets supplémentaires. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation Pub/Sub. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant recommandé pour les connexions WebSocket d'administration de Strapi. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque le stockage par pod est activé. |
| `network_tags` | `["nfsserver"]` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |
| `gke_cluster_name` | `""` | Nom du cluster cible ; découvert automatiquement s'il est vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; généré automatiquement s'il est vide. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active des PVC par pod dans un StatefulSet. Inutile pour la configuration par défaut adossée à NFS. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. Immuable après la création. |
| `stateful_pvc_mount_path` | `/data` | Chemin dans le conteneur pour le PVC par pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass des PVC. |
| `stateful_headless_service` | `null` | Crée un Service headless pour un DNS de pod stable. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité lors des mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/_health`, délai de 10 s | Sonde de démarrage ciblant le point de terminaison de santé de Strapi. |
| `health_check_config` | HTTP `/_health`, délai de 15 s | Sonde de vivacité ciblant le point de terminaison de santé de Strapi. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés aux côtés de Strapi. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Strapi (à laisser activé). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket `strapi-uploads` provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utilise Redis pour le cache et les sessions (désactivé par défaut). |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour se rabattre sur l'IP de l'hôte NFS lorsque `enable_nfs = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | PostgreSQL est obligatoire — ne remplacez pas par MySQL ou `NONE`. |
| `application_database_name` | `strapi` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `strapi` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `enable_postgres_extensions` | `false` | Installe des extensions PostgreSQL supplémentaires après le provisionnement. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Strapi. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Strapi. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEYS` / `JWT_SECRET` / `ADMIN_JWT_SECRET` / `API_TOKEN_SALT` (générés automatiquement) | générés une fois, jamais modifiés | Critique | Leur rotation après le premier déploiement invalide immédiatement toutes les sessions et tous les jetons d'API actifs ; tous les utilisateurs sont déconnectés et toutes les intégrations clientes cessent de fonctionner. |
| `database_type` | `POSTGRES` ou `POSTGRES_15` | Critique | Strapi requiert PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les médias téléversés sont perdus au redémarrage d'un pod et ne sont pas partagés entre réplicas. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; le modifier renomme toutes les ressources GCP et Kubernetes, ce qui déclenche une recréation complète et une perte de données. |
| `application_database_name` / `application_database_user` | définis une fois | Critique | Immuables après le premier déploiement ; les renommer conduit Strapi à se connecter à une base de données vide, avec perte de tout le contenu et de tous les utilisateurs. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_file` valide fait échouer la tâche d'import. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification. |
| `enable_cloudsql_volume` | `true` | Élevé | Requis pour la connectivité PostgreSQL ; bloqué au moment du plan lorsqu'il est désactivé avec un type de base de données autre que `NONE`. |
| `memory_limit` | `512Mi` minimum | Élevé | Strapi est une application Node.js ; une mémoire insuffisante provoque des arrêts OOM lors des opérations du panneau d'administration. Portez-la à `1Gi` ou plus en production. |
| `enable_redis` | `false` | Élevé | À activer uniquement lorsque des plugins le requièrent ; l'activer sans `redis_host` valide (et sans repli NFS) provoque une erreur de connexion au démarrage. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les connexions WebSocket du panneau d'administration de Strapi sont interrompues et produisent des avertissements « unsaved changes ». |
| `min_instance_count` | `1` | Élevé | GKE ne prend pas en charge une véritable mise à l'échelle à zéro sans KEDA ; une valeur de `0` peut laisser le HPA dans un état incohérent. |
| `enable_iap` | à activer pour l'administration | Moyen | Sinon, le panneau d'administration de Strapi est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |
| `enable_topology_spread` | à envisager en production | Faible | Avec plusieurs réplicas, la répartition topologique évite que tous les pods se retrouvent dans la même zone. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Strapi
partagée avec la variante Cloud Run est décrite dans
**[Strapi_Common](Strapi_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Strapi sur GKE Autopilot](../labs/Strapi_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Strapi sur Google Cloud Run](Strapi_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Strapi Common — Configuration applicative partagée](Strapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
