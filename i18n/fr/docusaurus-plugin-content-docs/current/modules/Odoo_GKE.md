---
title: "Odoo sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Odoo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Odoo_GKE.md @ 15fd4c7 sha256:794a3e2ade1c -->

# Odoo sur GKE Autopilot {#odoo-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_GKE.png" alt="Odoo sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Odoo est une suite ERP open source complète avec plus de 12 millions d'utilisateurs et des
modules couvrant la GRC, la comptabilité, les stocks, la fabrication, les RH et le
commerce électronique. Ce module déploie Odoo Community Edition sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'Odoo utilise et sur la façon de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Odoo fonctionne comme une charge de travail ERP Python/PostgreSQL. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Odoo, 1 vCPU / 512 Mio par défaut (augmenter à ≥ 2 vCPU / 4 Gio pour la production), autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL | Requis — Odoo ne prend pas en charge MySQL ou SQL Server |
| Fichiers partagés | Filestore (NFS) | Répertoires Filestore, sessions et extra-addons partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket d'addons dédié (`odoo-addons`) pour les addons personnalisés et communautaires |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; requis lorsque `max_instance_count > 1` pour partager l'état de la session |
| Secrets | Secret Manager | Mot de passe maître auto-généré (`ODOO_MASTER_PASS`) et mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** Le moteur de base de données est fixe ; la sélection de
  MySQL ou `NONE` empêche le démarrage.
- **NFS est requis.** Sans volume Filestore partagé, le filestore d'Odoo (pièces
  jointes, champs binaires, actifs compilés) est isolé de chaque pod et perdu au
  redémarrage.
- **L'affinité de session est `ClientIP`.** Odoo stocke les sessions sur NFS ; l'épinglage
  des requêtes au même pod évite les recherches de session inter-pods.
- **Deux jobs d'initialisation s'exécutent à chaque déploiement.** `nfs-init` configure la
  propriété du répertoire NFS et `db-init` crée la base de données et l'utilisateur
  PostgreSQL — les deux sont idempotents.
- **Le mot de passe maître Odoo** est généré automatiquement et stocké dans Secret
  Manager ; vous ne le définissez jamais en texte clair.
- **Le premier démarrage est lent.** Odoo installe le module de base et exécute les
  migrations de schéma au premier démarrage ; la sonde de démarrage autorise jusqu'à 9
  minutes (délai de 180 s + 3 × période de 120 s).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Odoo {#a-gke-autopilot--the-odoo-workload}

Les pods Odoo sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre
les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  Odoo pour voir les pods, les révisions et les événements. Kubernetes Engine → Services
  et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Check Odoo version running in the container:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- odoo --version
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL {#b-cloud-sql-for-postgresql}

Odoo stocke toutes les données ERP (contacts, factures, inventaire, commandes) dans une
instance Cloud SQL pour PostgreSQL gérée. Les pods l'atteignent en privé via le sidecar
**Cloud SQL Auth Proxy** via un socket Unix, de sorte qu'aucune IP publique n'est
exposée. Lors du premier déploiement, le job `db-init` crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
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

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs).
Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de
passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le filestore d'Odoo (pièces jointes binaires, images, actifs compilés), les données de
session et les répertoires d'addons supplémentaires sont écrits dans un partage
**Filestore (NFS)** monté dans chaque pod afin que tous les réplicas voient les mêmes
fichiers. Un bucket **Cloud Storage** dédié (`odoo-addons`) est également provisionné
pour les addons personnalisés et communautaires.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket d'addons.
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

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis prend en charge le stockage de session d'Odoo lorsque plusieurs réplicas sont en
cours d'exécution. Sans Redis, l'affinité de session (`ClientIP`) est la seule
protection contre la perte de session lors du redémarrage du pod. Redis est désactivé
par défaut ; définissez `enable_redis = true` et `redis_host` pour l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^REDIS_"
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe maître Odoo (`ODOO_MASTER_PASS`) et le mot de passe de la base de données
sont stockés en tant que secrets Secret Manager et injectés dans les pods au moment de
l'exécution ; le texte clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master password:
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL
vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte
facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
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
    `/mnt/extra-addons` avec la propriété `101:101` (l'utilisateur du processus Odoo). Doit
    réussir avant le démarrage d'Odoo.
  - `db-init` — s'exécute après `nfs-init` et crée de manière idempotente la base de
    données PostgreSQL et l'utilisateur de l'application. Les deux jobs peuvent être
    réexécutés en toute sécurité.
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l job-name=nfs-init
  kubectl logs -n "$NAMESPACE" -l job-name=db-init
  ```
- **Migration de schéma au démarrage.** Le conteneur démarre Odoo avec `-i base`,
  qui applique automatiquement toutes les migrations de schéma en attente. Les mises à
  niveau de version sont appliquées au prochain démarrage du pod.
- **Mot de passe maître Odoo.** Un mot de passe alphanumérique de 16 caractères
  auto-généré est stocké dans Secret Manager et injecté en tant que `ODOO_MASTER_PASS`. Il
  protège l'interface de gestion de la base de données à `/web/database/manager`. Remplacez-le
  en utilisant `explicit_secret_values` :
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```
- **SMTP pour les e-mails sortants.** Odoo utilise des variables d'environnement pour
  son transport de courrier sortant (confirmations de commande, réinitialisations de mot
  de passe, notifications CRM). Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_SSL` et `EMAIL_FROM` dans `environment_variables` avant de passer en production ;
  déplacez `SMTP_PASSWORD` vers `secret_environment_variables`.
- **Chemin de santé.** La sonde de démarrage autorise 180 secondes de délai initial,
  puis vérifie `GET
  /web/health` (HTTP 200 uniquement lorsque Odoo a une connexion de base de
  données active). La sonde de vivacité continue de vérifier `/web/health` toutes les 30
  secondes. Au premier démarrage (création de schéma à partir de zéro), le démarrage peut
  prendre 2 à 10 minutes selon le CPU disponible.
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s -o /dev/null -w "%{http_code}" http://localhost:8069/web/health
  # Expect: 200
  ```
- **Planificateur d'arrière-plan Odoo (cron).** Le planificateur intégré d'Odoo
  nécessite au moins un pod en cours d'exécution. Gardez `min_instance_count = 1` en production pour
  éviter les interruptions de cron.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Odoo sont listés ;
chaque autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement
standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails accordés pour l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `odoo` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Odoo ERP` | Nom convivial affiché dans la console. |
| `application_description` | `Odoo ERP on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `18.0` | Canal nocturne Odoo à installer (`"18.0"`, `"17.0"`, `"16.0"`). Incrémenter pour mettre à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` construit à partir du Dockerfile nocturne d'Odoo ; `"prebuilt"` déploie une image existante. |
| `container_image` | `""` | Remplace l'URI de l'image (utilisé avec `"prebuilt"`). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de ressources par pod. **Augmenter à ≥ 2 vCPU / 4 Gio pour la production.** |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour préserver le planificateur cron d'Odoo. |
| `max_instance_count` | `3` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `8069` | Port sur lequel Odoo écoute. Ne pas modifier sauf si le serveur Odoo est reconfiguré. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image du conteneur dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en texte clair. Vide par défaut — définissez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` ici pour les e-mails sortants. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager (par exemple `SMTP_PASSWORD`). |
| `explicit_secret_values` | `{}` | Valeurs sensibles écrites dans Secret Manager lors du déploiement. Utilisez-les pour définir un `ODOO_MASTER_PASS` personnalisé. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant ; requis lorsque Redis n'est pas activé pour le partage de session. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags de pod ; `nfsserver` est requis pour la connectivité du pare-feu NFS. |
| `gke_cluster_name` | `""` | Nom du cluster cible ; laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laisser vide pour la génération automatique. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les PVC par pod dans le StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de PVC par pod. Prévoir 100 Gio+ dans les déploiements ERP actifs. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage à l'intérieur du pod pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont traités comme des octets par Kubernetes et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ path = "/web/health", initial_delay_seconds = 180, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | Délai généreux pour la création du schéma au premier démarrage. Augmenter `failure_threshold` à `5` lors des tout premiers déploiements. |
| `health_check_config` | `{ path = "/web/health", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Vérification de la vivacité. `/web/health` renvoie 200 uniquement lorsque Odoo a une connexion de base de données active. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Vérification de disponibilité Cloud Monitoring facultative ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `nfs-init` + `db-init`. |
| `cron_jobs` | `[]` | Tâches planifiées définies par l'utilisateur (CronJobs Kubernetes). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard de Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Requis — le filestore, les sessions et les répertoires d'addons d'Odoo doivent résider sur un stockage partagé. |
| `nfs_mount_path` | `/mnt` | Chemin de montage NFS à l'intérieur du conteneur tel que vu par App_GKE. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket d'addons. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket `odoo-addons` géré par Odoo. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage de session. Requis lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe — ne pas changer pour MySQL ou `NONE`. |
| `application_database_name` | `gkeappdb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gkeappuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installer les extensions PostgreSQL (par exemple `postgis`, `unaccent`) après le provisionnement. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 90+ pour les données financières/de conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer un dump PostgreSQL lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Odoo. Recommandé pour les déploiements ERP réservés aux administrateurs. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. Fortement recommandé pour tout déploiement Odoo exposé à Internet. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées en cas de déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Odoo. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES` | Critique | Odoo nécessite exclusivement PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans NFS, les pièces jointes et les données de session sont isolées de chaque pod et perdues au redémarrage. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données ERP. |
| `container_resources.memory_limit` | `≥ 4Gi` pour la production | Critique | La valeur par défaut `512Mi` provoque un OOM Python immédiat lors du chargement du module. Toujours augmenter à au moins `2Gi`. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont traités comme des octets par Kubernetes et bloquent toute planification. |
| `explicit_secret_values` (ODOO_MASTER_PASS) | fort, unique | Critique | Le gestionnaire de base de données à `/web/database/manager` est protégé uniquement par ce mot de passe ; une valeur faible expose la suppression de la base de données à quiconque peut atteindre l'URL. |
| `enable_redis` | `true` lorsque `max_instance_count > 1` | Élevé | Sans Redis et `session_affinity = ClientIP`, les utilisateurs sont déconnectés lorsqu'ils sont acheminés vers un pod différent. |
| `redis_host` | point de terminaison explicite | Élevé | Requis lorsque `enable_redis = true` ; vide provoque des échecs de backend de session au démarrage. |
| `application_version` | LTS valide (`18.0`, `17.0`) | Élevé | Une balise de version invalide échoue l'étape Cloud Build lors de la création de l'image. |
| `container_image_source` | `custom` | Élevé | Odoo nécessite une image personnalisée pour connecter le socket PostgreSQL et les chemins du filestore ; une image amont non configurée pour les sockets Unix Cloud SQL échouera à se connecter. |
| `min_instance_count` | `1` | Élevé | `0` arrête le planificateur d'arrière-plan Odoo (cron) et ajoute des démarrages à froid de 30 à 60 secondes. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance et sans Redis, les déploiements multi-réplicas perdent continuellement l'état de la session. |
| `backup_retention_days` | `90` pour la production | Élevé | Odoo contient des enregistrements financiers ; 7 jours sont insuffisants pour la plupart des exigences de conformité. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Élevé | Le gestionnaire de base de données Odoo et le portail d'administration ne doivent pas être accessibles publiquement sans authentification. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds lorsque le pod unique ne peut pas être évincé. |
| `stateful_pvc_size` | `100Gi`+ pour la production | Moyen | Les pièces jointes ERP (factures, contrats, images de produits) s'accumulent rapidement. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Odoo partagée avec la variante Cloud Run est
décrite dans **[Odoo_Common](Odoo_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Odoo sur GKE Autopilot](../labs/Odoo_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Odoo sur Cloud Run](Odoo_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Configuration d'application partagée Odoo](Odoo_Common.md) — la configuration partagée par les deux cibles de déploiement.
