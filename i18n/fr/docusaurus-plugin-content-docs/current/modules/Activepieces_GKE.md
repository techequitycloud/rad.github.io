---
title: "Activepieces sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Activepieces sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Activepieces_GKE.md @ 15fd4c7 sha256:305100fef0c5 -->

# Activepieces sur GKE Autopilot {#activepieces-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Activepieces_GKE.png" alt="Activepieces sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Activepieces est une plateforme d'automatisation de flux de travail sans code,
open-source et sous licence Apache 2.0, pour connecter des applications, des API et
des sources de données. Ce module déploie Activepieces sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Activepieces utilise et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Activepieces s'exécute comme une charge de travail web Node.js. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Activepieces ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Cache et file d'attente | Redis (facultatif) | Requis pour l'autoscaling horizontal ; le mode file d'attente en mémoire est le défaut |
| Secrets | Secret Manager | `AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur empêche le
  démarrage.
- **Le mode file d'attente en mémoire est le défaut.** `AP_QUEUE_MODE = MEMORY` signifie que
  tous les jobs de flux de travail s'exécutent en interne. Cela fonctionne pour
  un seul réplica, mais la mise à l'échelle au-delà d'un pod nécessite Redis
  (`enable_redis = true`).
- **`AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` sont générés automatiquement** et stockés
  dans Secret Manager. Ces clés ne doivent jamais être renouvelées après le
  premier démarrage sans fenêtre de maintenance — le renouvellement de `AP_ENCRYPTION_KEY`
  corrompt toutes les informations d'identification de connexion stockées, et le
  renouvellement de `AP_JWT_SECRET` invalide toutes les sessions utilisateur actives.
- **L'affinité de session est `ClientIP` par défaut.** Activepieces utilise des
  connexions WebSocket persistantes pour les mises à jour de flux en temps réel
  ; les requêtes du même client doivent atteindre le même pod.
- **NFS est désactivé par défaut.** Contrairement aux applications centrées sur
  les fichiers, Activepieces stocke tout l'état du flux de travail dans
  PostgreSQL. N'activez NFS que si Redis est co-localisé sur la VM du serveur
  NFS.
- **L'extension `pgvector` est installée automatiquement** lors du job de
  configuration de la base de données au premier déploiement, permettant des
  éléments de flux de travail basés sur l'IA.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la
  mise à l'échelle à zéro) pour que les points de terminaison des webhooks
  restent toujours accessibles.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Activepieces {#a-gke-autopilot--the-activepieces-workload}

Les pods Activepieces sont planifiés sur Autopilot, qui facture le CPU/la
mémoire que les pods demandent réellement. L'autoscaling horizontal des pods
dimensionne le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Activepieces pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Activepieces stocke toutes les données d'application (flux, connexions,
historique d'exécution, utilisateurs) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth
Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, un job d'initialisation crée la base de données et l'utilisateur de
l'application et installe l'extension `pgvector`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et le renouvellement du mot de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement
pour le stockage de fichiers Activepieces. Le compte de service de la charge de
travail se voit accorder l'accès. Des buckets supplémentaires peuvent être
déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (mode file d'attente) {#d-redis-queue-mode}

Redis est **désactivé par défaut** (`AP_QUEUE_MODE = MEMORY`). Lorsque `enable_redis = true`
est défini, le backend de la file d'attente passe à `AP_QUEUE_MODE = REDIS`, ce qui est
requis avant de passer à l'échelle au-delà d'un réplica. Lorsque `redis_host`
est laissé vide et `enable_nfs` est vrai, l'IP de la VM du serveur NFS est
utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm queue mode injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep AP_QUEUE_MODE
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `AP_ENCRYPTION_KEY` (utilisé pour chiffrer toutes les informations
d'identification de connexion stockées) et `AP_JWT_SECRET` (utilisé pour signer
les jetons de session utilisateur). Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et le
renouvellement de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques
GKE et Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité
et des politiques d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Activepieces {#3-activepieces-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte
  via le Cloud SQL Auth Proxy et crée de manière idempotente la base de données
  et l'utilisateur de l'application, accorde les privilèges et installe
  l'extension `pgvector` pour les éléments de flux basés sur l'IA. Le job peut
  être réexécuté en toute sécurité.
- **Migrations de base de données au démarrage.** Activepieces applique ses
  propres migrations de schéma automatiquement à chaque démarrage, de sorte que
  la mise à niveau de la version de l'application applique les modifications de
  schéma sans étape de migration distincte.
- **`AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` sont immuables après le premier démarrage.** Ces
  clés sont générées une fois et écrites dans Secret Manager. La modification de
  `AP_ENCRYPTION_KEY` corrompt de manière permanente toutes les informations
  d'identification de connexion stockées. La modification de `AP_JWT_SECRET`
  invalide toutes les sessions utilisateur actives. Ne les renouvelez que
  pendant une fenêtre de maintenance planifiée.
- **Les points de terminaison des webhooks nécessitent une IP externe.** Le
  `service_type = LoadBalancer` par défaut expose une IP externe pour les appels de webhook
  entrants. Définissez `AP_FRONTEND_URL` et `AP_WEBHOOK_URL_PREFIX` sur l'URL externe après
  l'attribution de l'IP du LoadBalancer :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"activepieces","env":[
      {"name":"AP_FRONTEND_URL","value":"https://activepieces.example.com"},
      {"name":"AP_WEBHOOK_URL_PREFIX","value":"https://activepieces.example.com"}
    ]}]}}}}'
  ```
  Ou définissez `environment_variables` dans la configuration du module avant le déploiement.
- **L'inscription est ouverte par défaut.** `AP_SIGN_UP_ENABLED = "true"` est injecté
  automatiquement. Après avoir créé le compte administrateur initial,
  désactivez l'inscription en ajoutant `AP_SIGN_UP_ENABLED = "false"` à `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine
  `/` par défaut. Le point de terminaison `/api/v1/flags` ne répond que
  lorsque le serveur est entièrement initialisé et connecté à PostgreSQL —
  envisagez de définir `path = "/api/v1/flags"` pour une signalisation de santé plus précise.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Activepieces sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `activepieces` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de suivi du déploiement pour l'image construite. **Ne fixe pas la version amont** : le Dockerfile de `Activepieces_Common` construit toujours `FROM activepieces/activepieces:latest` sans ARG de version, donc la modification de cette valeur ne fait que réétiqueter le tag Artifact Registry poussé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimum de réplicas ; maintenir à 1 pour s'assurer que les points de terminaison des webhooks sont toujours accessibles. |
| `max_instance_count` | `1` | Nombre maximum de réplicas. **N'augmenter que lorsque `enable_redis = true`.** |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Activepieces dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs de base `AP_*` sont définies automatiquement — ne pas définir `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET` ou `AP_POSTGRES_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `Deployment` | `Deployment` (sans état par défaut) ou `StatefulSet` (avec PVC par pod). |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les connexions WebSocket et les sessions UI. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Activer les modèles PVC. Non recommandé — Activepieces stocke tout l'état dans PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_headless_service` | `true` | Créer un service sans tête pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `OrderedReady` | Ordre de création des pods : `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | Stratégie de mise à jour : `RollingUpdate` ou `OnDelete`. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Créer un ResourceQuota Kubernetes dans l'espace de noms de l'application. **Déclaré mais non transféré** dans `main.tf` — n'a aucun effet sur le déploiement de ce module. |
| `quota_cpu_requests` | `""` | Requêtes CPU totales autorisées sur tous les pods de l'espace de noms. Non transféré — aucun effet. |
| `quota_cpu_limits` | `""` | Limites CPU totales autorisées sur tous les pods de l'espace de noms. Non transféré — aucun effet. |
| `quota_memory_requests` | `""` | Requêtes mémoire totales autorisées ; nécessite un suffixe binaire (par exemple `4Gi`, `8192Mi`) selon la convention. Non transféré — aucun effet. |
| `quota_memory_limits` | `""` | Limites mémoire totales autorisées ; nécessite un suffixe binaire. Non transféré — aucun effet. |
| `quota_max_pods` | `""` | Nombre maximum de pods autorisés dans l'espace de noms. Non transféré — aucun effet. |
| `quota_max_services` | `""` | Nombre maximum de services Kubernetes autorisés dans l'espace de noms. Non transféré — aucun effet. |
| `quota_max_pvcs` | `""` | Nombre maximum de PersistentVolumeClaims autorisés. Non transféré — aucun effet. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s de délai | Sonde de démarrage. Envisagez de définir `path = "/api/v1/flags"` pour une signalisation précise du premier démarrage. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | TCP 240s | Sonde d'infrastructure au niveau App_GKE. |
| `health_check_config` | HTTP `/` | Sonde de vivacité au niveau App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité facultatif de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Sidecar ou services d'aide déployés avec Activepieces. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. N'activer que si Redis est co-localisé sur la VM du serveur NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximum d'images récentes d'Artifact Registry à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Basculer `AP_QUEUE_MODE` de `MEMORY` à `REDIS`. Requis lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `activepieces_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `ap_user` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy d'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** L'activation d'IAP nécessite une authentification d'identité
> Google pour **toutes** les requêtes entrantes, y compris les rappels de
> webhook provenant de services externes. N'activez IAP que lorsque les webhooks
> publics ne sont pas nécessaires.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Activepieces. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Activepieces. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime
> `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à
> une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou
> de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AP_ENCRYPTION_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler corrompt de manière permanente toutes les informations d'identification de connexion stockées — elles ne peuvent pas être déchiffrées. |
| `AP_JWT_SECRET` (auto-généré) | Ne renouveler que pendant une fenêtre de maintenance | Critique | Le renouveler invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate pour tout le monde. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX` | URL du LoadBalancer externe | Critique | Une URL incorrecte rompt toutes les intégrations de webhook et les rappels OAuth. |
| `max_instance_count` | `1` sauf si Redis est activé | Élevé | La mise à l'échelle au-delà de 1 en mode file d'attente en mémoire divise la file d'attente des jobs entre les pods, entraînant des exécutions en double et des exécutions perdues. |
| `enable_redis` | `true` avant la mise à l'échelle | Élevé | Sans Redis, chaque pod maintient sa propre file d'attente en mémoire — exécution incohérente avec plus d'un réplica. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais NFS est désactivé et qu'aucun hôte n'est défini, la chaîne de connexion Redis est vide et l'application ne démarre pas. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures à 1 GiB provoquent des OOM kills lors d'exécutions de flux concurrentes. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les reconnexions WebSocket se dirigent vers différents pods, perturbant les mises à jour de flux en temps réel dans l'interface utilisateur. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; le garde de validation rejette les valeurs invalides. Maintenir 1 garantit que les webhooks sont toujours disponibles. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par un garde de validation au moment de la planification. |
| `AP_SIGN_UP_ENABLED` (auto-injecté `"true"`) | Désactiver après le premier administrateur | Élevé | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `enable_iap` | uniquement lorsque les webhooks ne sont pas nécessaires | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les rappels de webhook externes. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Activepieces partagée avec la variante Cloud Run est décrite dans
**[Activepieces_Common](Activepieces_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Activepieces sur GKE Autopilot](../labs/Activepieces_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Activepieces sur Google Cloud Run](Activepieces_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Activepieces Common — Configuration d'application partagée](Activepieces_Common.md) — la configuration partagée par les deux cibles de déploiement.
