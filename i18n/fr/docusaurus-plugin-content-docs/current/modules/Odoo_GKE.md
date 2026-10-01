---
title: "Odoo sur GKE Autopilot"
description: "Référence de configuration pour déployer Odoo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Odoo_GKE.md @ 3055034 sha256:1c39d196b876 -->

# Odoo sur GKE Autopilot {#odoo-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_GKE.png" alt="Odoo sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Odoo est une suite ERP open source complète comptant plus de 12 millions d'utilisateurs, avec des modules couvrant le CRM,
la comptabilité, les stocks, la fabrication, les RH et l'eCommerce. Ce module déploie Odoo Community
Edition sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Odoo et sur la manière de les explorer et de les exploiter depuis
la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications
GKE — Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Odoo s'exécute comme une charge de travail ERP Python/PostgreSQL. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Odoo, 1 vCPU / 512 MiB par défaut (à porter à ≥ 2 vCPU / 4 GiB pour la production), autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL | Obligatoire — Odoo ne prend en charge ni MySQL ni SQL Server |
| Fichiers partagés | Filestore (NFS) | Répertoires filestore, sessions et extra-addons partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket d'addons dédié (`odoo-addons`) pour les addons personnalisés et communautaires |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; requis lorsque `max_instance_count > 1` pour partager l'état des sessions |
| Secrets | Secret Manager | Mot de passe maître généré automatiquement (`ODOO_MASTER_PASS`) et mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** Le moteur de base de données est fixe ; choisir MySQL ou `NONE` empêche
  le démarrage.
- **NFS est requis.** Sans volume Filestore partagé, le filestore d'Odoo (pièces jointes,
  champs binaires, ressources compilées) est isolé dans chaque pod et perdu au redémarrage.
- **L'affinité de session vaut `ClientIP`.** Odoo stocke les sessions sur NFS ; rattacher les requêtes au
  même pod évite les recherches de session entre pods.
- **Deux jobs d'initialisation s'exécutent à chaque déploiement.** `nfs-init` configure la propriété des répertoires NFS et
  `db-init` crée la base de données et l'utilisateur PostgreSQL — toutes deux sont idempotentes.
- **Le mot de passe maître Odoo** est généré automatiquement et stocké dans Secret Manager ; vous
  ne le définissez jamais en clair.
- **Le premier démarrage est lent.** Odoo installe le module de base et exécute les migrations de schéma au premier
  démarrage ; la sonde de démarrage accorde jusqu'à 9 minutes (délai de 180s + 3 × période de 120s).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Odoo {#a-gke-autopilot--the-odoo-workload}

Les pods Odoo sont planifiés sur Autopilot, qui facture la CPU/mémoire que les pods demandent
réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et le nombre maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Odoo pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Check Odoo version running in the container:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- odoo --version
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type
de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL {#b-cloud-sql-for-postgresql}

Odoo stocke toutes les données de l'ERP (contacts, factures, stocks, commandes) dans une instance gérée Cloud SQL
for PostgreSQL. Les pods s'y connectent en privé via le sidecar **Cloud SQL Auth Proxy**
sur un socket Unix ; aucune IP publique n'est donc exposée. Au premier déploiement, la tâche `db-init`
crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # Confirm database and user were created:
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  gcloud sql users list --instance=<instance-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le filestore d'Odoo (pièces jointes binaires, images, ressources compilées), les données de session et les
répertoires extra-addons sont écrits sur un partage **Filestore (NFS)** monté dans chaque
pod, afin que tous les réplicas voient les mêmes fichiers. Un bucket **Cloud Storage** dédié
(`odoo-addons`) est également provisionné pour les addons personnalisés et communautaires.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le
  bucket des addons.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<addons-bucket>/        # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  # List NFS directories:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /mnt/
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis sert de magasin de sessions à Odoo lorsque plusieurs réplicas s'exécutent. Sans Redis,
l'affinité de session (`ClientIP`) est la seule protection contre la perte de session au redémarrage d'un pod.
Redis est désactivé par défaut ; définissez `enable_redis = true` et `redis_host` pour l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^REDIS_"
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe maître Odoo (`ODOO_MASTER_PASS`) et le mot de passe de la base de données sont stockés en tant que
secrets Secret Manager et injectés dans les pods à l'exécution ; aucune valeur en clair n'apparaît dans la
configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master password:
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe. Un domaine
personnalisé avec certificat géré par Google peut être activé, et une IP statique peut être réservée afin que
l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP
statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  # Monitor startup progress:
  kubectl logs -n "$NAMESPACE" -l app=odoo --follow | grep -E "odoo.modules|http.server"
  ```

---

## 3. Comportement de l'application Odoo {#3-odoo-application-behaviour}

- **Deux jobs d'initialisation à chaque déploiement.**
  - `nfs-init` — monte le partage NFS et crée `/mnt/filestore`, `/mnt/sessions` et
    `/mnt/extra-addons` avec la propriété `101:101` (l'utilisateur du processus Odoo). Doit réussir
    avant le démarrage d'Odoo.
  - `db-init` — s'exécute après `nfs-init` et crée de manière idempotente la base de données PostgreSQL et
    l'utilisateur de l'application. Les deux tâches peuvent être relancées sans risque.
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l job-name=nfs-init
  kubectl logs -n "$NAMESPACE" -l job-name=db-init
  ```
- **Migration du schéma au démarrage.** Le conteneur démarre Odoo avec `-i base`, qui applique automatiquement
  les migrations de schéma en attente. Les mises à niveau de version sont appliquées au prochain démarrage des pods.
- **Mot de passe maître Odoo.** Un mot de passe alphanumérique de 16 caractères généré automatiquement est stocké dans
  Secret Manager et injecté sous le nom `ODOO_MASTER_PASS`. Il protège l'interface de gestion des
  bases de données à l'adresse `/web/database/manager`. Remplacez-le à l'aide de `explicit_secret_values` :
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```
- **SMTP pour les e-mails sortants.** Odoo utilise des variables d'environnement pour son transport de courrier
  sortant (confirmations de commande, réinitialisations de mot de passe, notifications CRM). Configurez `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` dans `environment_variables` avant
  la mise en service ; placez `SMTP_PASSWORD` dans `secret_environment_variables`.
- **Chemin de santé.** La sonde de démarrage accorde un délai initial de 180 secondes, puis vérifie `GET
  /web/health` (HTTP 200 uniquement lorsqu'Odoo dispose d'une connexion active à la base de données). La sonde de vivacité
  continue de vérifier `/web/health` toutes les 30 secondes. Au premier démarrage (création du schéma à partir
  de zéro), le démarrage peut prendre de 2 à 10 minutes selon la CPU disponible.
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s -o /dev/null -w "%{http_code}" http://localhost:8069/web/health
  # Expect: 200
  ```
- **Planificateur d'arrière-plan d'Odoo (cron).** Le planificateur intégré d'Odoo nécessite au moins un
  pod en cours d'exécution. Conservez `min_instance_count = 1` en production pour éviter toute interruption du cron.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Odoo ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `odoo` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Odoo ERP` | Nom convivial affiché dans la console. |
| `application_description` | `Odoo ERP on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `18.0` | Canal nightly d'Odoo à installer (`"18.0"`, `"17.0"`, `"16.0"`). Incrémentez-le pour effectuer une mise à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` construit l'image à partir du Dockerfile nightly d'Odoo ; `"prebuilt"` déploie une image existante. |
| `container_image` | `""` | URI d'image de remplacement (utilisée avec `"prebuilt"`). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de ressources par pod. **Augmentez à ≥ 2 vCPU / 4 GiB pour la production.** |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour préserver le planificateur cron d'Odoo. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8069` | Port d'écoute d'Odoo. Ne le modifiez pas, sauf si le serveur Odoo est reconfiguré. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de conteneur dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en clair. Vide par défaut — définissez ici `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` pour les e-mails sortants. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par ex. `SMTP_PASSWORD`). |
| `explicit_secret_values` | `{}` | Valeurs sensibles écrites dans Secret Manager pendant le déploiement. À utiliser pour définir un `ODOO_MASTER_PASS` personnalisé. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant ; requis lorsque Redis n'est pas activé pour le partage des sessions. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags des pods ; `nfsserver` est requis pour la connectivité NFS à travers le pare-feu. |
| `gke_cluster_name` | `""` | Nom du cluster cible ; laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laissez vide pour qu'il soit généré automatiquement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les PVC par pod dans le StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod. Prévoyez 100 GiB+ pour les déploiements d'ERP actifs. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne la CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — Kubernetes interprète des entiers nus comme des octets, ce qui bloque la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ path = "/web/health", initial_delay_seconds = 180, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | Délai généreux pour la création du schéma au premier démarrage. Portez `failure_threshold` à `5` lors des tout premiers déploiements. |
| `health_check_config` | `{ path = "/web/health", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Contrôle de vivacité. `/web/health` ne renvoie 200 que lorsqu'Odoo dispose d'une connexion active à la base de données. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les tâches intégrées `nfs-init` + `db-init`. |
| `cron_jobs` | `[]` | Tâches planifiées définies par l'utilisateur (CronJobs Kubernetes). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis — les répertoires filestore, sessions et addons d'Odoo doivent résider sur un stockage partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage NFS dans le conteneur, tel que le voit App_GKE. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket des addons. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket `odoo-addons` géré par Odoo. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour le stockage des sessions. Requis lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe — ne le remplacez pas par MySQL ou `NONE`. |
| `application_database_name` | `gkeappdb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gkeappuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installe des extensions PostgreSQL (par ex. `postgis`, `unaccent`) après le provisionnement. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 90+ pour les données financières ou de conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure un dump PostgreSQL lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Impose une connexion Google devant Odoo. Recommandé pour les déploiements d'ERP réservés aux administrateurs. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. Vivement recommandé pour tout déploiement Odoo exposé à Internet. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Odoo. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et (facultative) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` | Critical | Odoo exige exclusivement PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critical | Sans NFS, les pièces jointes et les données de session sont isolées dans chaque pod et perdues au redémarrage. |
| `application_database_name` / `_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données de l'ERP. |
| `container_resources.memory_limit` | `≥ 4Gi` pour la production | Critical | La valeur par défaut `512Mi` provoque immédiatement un OOM Python lors du chargement des modules. Augmentez-la toujours à au moins `2Gi`. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer la tâche d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Kubernetes interprète des entiers nus comme des octets, ce qui bloque toute planification. |
| `explicit_secret_values` (ODOO_MASTER_PASS) | fort et unique | Critical | Le gestionnaire de bases de données à l'adresse `/web/database/manager` n'est protégé que par ce mot de passe ; une valeur faible permet à quiconque peut atteindre l'URL de supprimer la base de données. |
| `enable_redis` | `true` lorsque `max_instance_count > 1` | High | Sans Redis ni `session_affinity = ClientIP`, les utilisateurs sont déconnectés lorsqu'ils sont routés vers un autre pod. |
| `redis_host` | point de terminaison explicite | High | Requis lorsque `enable_redis = true` ; une valeur vide provoque des défaillances du backend de sessions au démarrage. |
| `application_version` | LTS valide (`18.0`, `17.0`) | High | Un tag de version invalide fait échouer l'étape Cloud Build lors du build de l'image. |
| `container_image_source` | `custom` | High | Odoo nécessite une image personnalisée pour câbler le socket PostgreSQL et les chemins du filestore ; une image amont non configurée pour les sockets Unix Cloud SQL ne parviendra pas à se connecter. |
| `min_instance_count` | `1` | High | `0` arrête le planificateur d'arrière-plan d'Odoo (cron) et ajoute des démarrages à froid de 30 à 60 secondes. |
| `session_affinity` | `ClientIP` | High | Sans affinité ni Redis, les déploiements à plusieurs réplicas perdent continuellement l'état des sessions. |
| `backup_retention_days` | `90` pour la production | High | Odoo contient des données financières ; 7 jours ne suffisent pas pour la plupart des exigences de conformité. |
| `enable_iap` / `enable_cloud_armor` | à activer pour la production | High | Le gestionnaire de bases de données et le portail d'administration d'Odoo ne doivent pas être accessibles publiquement sans authentification. |
| `pdb_min_available` vs `min_instance_count` | prévoir de la marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds lorsque l'unique pod ne peut pas être évincé. |
| `stateful_pvc_size` | `100Gi`+ pour la production | Medium | Les pièces jointes de l'ERP (factures, contrats, images de produits) s'accumulent rapidement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, autoscaling,
entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Odoo
partagée avec la variante Cloud Run est décrite dans **[Odoo_Common](Odoo_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Odoo sur GKE Autopilot](../labs/Odoo_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Odoo sur Cloud Run](Odoo_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Configuration applicative partagée d'Odoo](Odoo_Common.md) — la configuration partagée par les deux cibles de déploiement.
