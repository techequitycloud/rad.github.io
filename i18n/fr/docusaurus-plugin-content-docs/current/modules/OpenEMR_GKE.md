---
title: "OpenEMR sur GKE Autopilot"
description: "Référence de configuration pour déployer OpenEMR sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OpenEMR_GKE.md @ 3055034 sha256:60af65a08cce -->

# OpenEMR sur GKE Autopilot {#openemr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_GKE.png" alt="OpenEMR sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenEMR est le système open source de dossiers médicaux électroniques (DME) et de gestion
de cabinet le plus largement adopté au monde, utilisé par plus de 100 000 professionnels de
santé dans plus de 100 pays. Ce module déploie OpenEMR sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise OpenEMR et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenEMR s'exécute comme une charge de travail Apache/PHP 8.3 FPM sur Alpine 3.20. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Apache/PHP, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — OpenEMR ne prend pas en charge PostgreSQL |
| Documents des patients | Filestore (NFS) | Répertoire `sites/` contenant les documents des patients, le cache de sessions et l'état de l'application, partagé entre toutes les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket de données à usage général |
| Stockage des sessions | Redis | Activé par défaut ; se rabat sur l'adresse IP du serveur NFS lorsqu'aucun hôte Redis n'est indiqué |
| Secrets | Secret Manager | Mot de passe administrateur (`OE_PASS`) et mot de passe de la base de données (`MYSQL_PASS`) générés automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est imposé ; sélectionner
  PostgreSQL ou `NONE` empêche le démarrage.
- **Le NFS est obligatoire.** Le répertoire `sites/` d'OpenEMR — qui contient
  `sqlconf.php`, les documents des patients, les caches Twig/Smarty et les fichiers
  téléversés — doit se trouver sur un volume NFS partagé. L'application ne peut pas
  fonctionner sans lui.
- **Redis est activé par défaut.** Lorsque `max_instance_count > 1`, un stockage de
  sessions partagé est nécessaire pour éviter la perte des sessions PHP entre les pods.
- **L'affinité de session est `ClientIP`.** OpenEMR s'appuie sur les sessions PHP ; les
  requêtes d'un navigateur sont donc rattachées à un seul pod.
- **L'installation au premier démarrage est automatisée et lente.** Lors du premier
  déploiement, trois jobs d'initialisation s'exécutent successivement : `nfs-init`
  (préparation du répertoire NFS), `db-init` (création de l'utilisateur et de la base de
  données MySQL) et `openemr-install` (installation du schéma via `auto_configure.php`).
  La sonde de démarrage laisse jusqu'à 120 secondes à l'application pour devenir prête une
  fois les jobs terminés.
- Le **mot de passe administrateur** d'OpenEMR est généré automatiquement et stocké dans
  Secret Manager ; vous ne le définissez jamais en clair.
- **`min_instance_count` vaut 1 par défaut.** La réduction à zéro n'est pas recommandée
  pour les systèmes de DME cliniques — les démarrages à froid ajoutent 20 à 40 secondes de
  latence que les cliniciens pourraient interpréter comme une panne du système.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OpenEMR {#a-gke-autopilot--the-openemr-workload}

Les pods OpenEMR sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les
pods demandent réellement. Le Horizontal Pod Autoscaling dimensionne le déploiement entre
le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail OpenEMR
  pour voir les pods, les événements et l'état des sondes. Kubernetes Engine → Services &
  Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, le
dimensionnement et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

OpenEMR stocke toutes les données cliniques (dossiers des patients, planification,
facturation) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent de
manière privée via le sidecar **Cloud SQL Auth Proxy** par un socket Unix, si bien
qu'aucune adresse IP publique n'est exposée. Lors du premier déploiement, le job `db-init`
crée la base de données et l'utilisateur de l'application avant que le job
`openemr-install` n'exécute l'installateur du schéma d'OpenEMR.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous indiqués dans les [sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `sites/` d'OpenEMR est écrit sur un partage **Filestore (NFS)** monté dans
chaque pod sur `/var/www/localhost/htdocs/openemr/sites`. Ce répertoire contient
`sqlconf.php` (qui signale la fin de l'installation), les documents téléversés pour les
patients, les caches de modèles Twig/Smarty et les données de session. Toutes les réplicas
doivent partager le même montage NFS. Un bucket **Cloud Storage** à usage général est
également provisionné.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  # Confirm the NFS share is mounted and sites directory exists:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    ls /var/www/localhost/htdocs/openemr/sites/default/
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Stockage des sessions dans Redis {#d-redis-session-store}

Redis sert de stockage aux sessions PHP d'OpenEMR. Lorsque `redis_host` est laissé vide et
que le NFS est activé, l'instance Redis colocalisée sur le serveur NFS est utilisée
automatiquement. Dans les déploiements à plusieurs réplicas, un stockage de sessions
partagé est nécessaire pour éviter la perte des sessions.

- **Console :** Memorystore → Redis (si vous utilisez une instance Memorystore gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_SERVER is set inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur d'OpenEMR (`OE_PASS`) et le mot de passe de la base de
données MySQL (`MYSQL_PASS`) sont stockés en tant que secrets Secret Manager et injectés
dans les pods à l'exécution via le pilote Secret Store CSI. Le texte en clair n'apparaît
jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password to log in for the first time:
  gcloud secrets versions access latest \
    --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

L'ID du secret du mot de passe administrateur est exposé dans la sortie
`admin_password_secret_id`. Le nom du secret du mot de passe de la base de données figure
dans `database_password_secret`. Consultez [App_GKE](App_GKE.md) pour l'intégration Secret
Store CSI et la rotation.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et
une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  # Test the login page from within the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s -o /dev/null -w "%{http_code}" http://localhost/interface/login/login.php
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur les adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques de GKE et
de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OpenEMR {#3-openemr-application-behaviour}

- **Initialisation en trois étapes au premier déploiement.** Les Jobs Kubernetes suivants
  s'exécutent successivement à chaque apply :

  | Job | Rôle | Dépend de |
  |---|---|---|
  | `nfs-init` | Prépare l'arborescence du répertoire NFS `sites/`, attribue la propriété à l'UID 1000 (Apache) et restaure éventuellement une sauvegarde | — |
  | `db-init` | Crée la base de données MySQL et l'utilisateur de l'application | — |
  | `openemr-install` | Exécute `auto_configure.php` en mode `K8S=admin` pour installer le schéma de la base de données et créer le compte administrateur ; écrit `$config=1` dans `sqlconf.php` sur le NFS | `nfs-init`, `db-init` |

  Le pod principal de l'application ne démarre qu'une fois `openemr-install` terminé et
  `$config=1` présent dans `sqlconf.php` — il ignore alors l'installateur et commence à
  servir les requêtes. Inspectez les jobs :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/nfs-init
  kubectl logs -n "$NAMESPACE" job/openemr-install
  ```

- **Le premier démarrage peut prendre 5 à 20 minutes.** Le job `openemr-install` exécute
  l'installateur complet du schéma en PHP, qui est lent. La sonde de démarrage (TCP sur le
  port 80, seuil de 12 échecs) laisse 120 secondes au pod pour devenir prêt une fois les
  jobs terminés. Pour une installation entièrement neuve, envisagez d'augmenter
  `failure_threshold` dans la sonde de démarrage.

- **Mises à niveau tenant compte des versions.** Lors des déploiements suivants, le script
  de démarrage compare la version de l'image à la version stockée sur le NFS et exécute
  automatiquement les scripts de mise à niveau appropriés (`fsupgrade-N.sh`).

- **Serveur temporaire de sonde de santé.** Pendant la phase d'installation, `openemr.sh`
  démarre un serveur web PHP intégré sur le port 80 qui renvoie HTTP 200 sur le chemin de
  la sonde de santé, ce qui évite que le pod soit tué pendant l'exécution de
  l'installateur.

- **Connexion administrateur.** Le nom d'utilisateur initial de l'administrateur est
  `admin`. Le mot de passe est généré automatiquement et stocké dans Secret Manager —
  récupérez-le avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```
  Si le compte administrateur est verrouillé après des tentatives de connexion échouées,
  utilisez l'utilitaire `/root/unlock_admin.sh <new_password>` dans le conteneur.

- **Variable d'environnement `K8S=yes`.** L'application reçoit `K8S=yes` à l'exécution, ce
  qui indique à `openemr.sh` d'utiliser le chemin de démarrage adapté à Kubernetes (en
  évitant les opérations `chown` récursives et lentes qui provoqueraient des échecs par
  dépassement de délai).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à OpenEMR ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `module_description` / `module_documentation` / `module_dependency` / `module_services` | _(définie)_ | Métadonnées du catalogue de la plateforme. |
| `credit_cost` | `300` | Crédits de la plateforme consommés par déploiement. |
| `require_credit_purchases` | `false` | Lorsque `true`, les frais de module ne peuvent être payés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts gratuits ou des crédits d'événement. |
| `enable_purge` | `true` | Autorise la suppression complète des ressources lors de la destruction. |
| `public_access` | `true` | Rend le module visible dans le catalogue public. |
| `require_services_gcp_module` | `true` | Échoue au moment du plan si aucun VPC géré par `Services_GCP` n'est détecté dans le projet. |
| `shared_users` / `technical_support_users` | `[]` | Utilisateurs auxquels l'accès est accordé / vers lesquels les demandes de support sont acheminées, quel que soit `public_access`. |
| `resource_creator_identity` | `rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com` | Compte de service utilisé par Terraform pour créer les ressources. |
| `impersonation_service_account` | `""` | Compte de service dont l'identité est empruntée pour les scripts shell (découverte, mise en miroir des images, configuration NFS). Laissez vide pour utiliser les identifiants de l'exécuteur. |
| `job_execution_wait_timeout` | `900` | Nombre maximal de secondes pendant lesquelles un déploiement attend le job `db-init` avant d'interrompre l'apply. |
| `explicit_secret_values` / `scripts_dir` | `{}` / `""` | Repris de la fondation, **non référencés** par ce module. |
| `requires_services` | _(create_postgres=true, create_mysql=false, create_redis=false, create_network_filesystem=true, create_google_kubernetes_engine=true, autres à false)_ | Indique à la plateforme quelles ressources `Services_GCP` provisionner automatiquement pour ce module. |

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openemr` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` / `application_description` | _(valeurs par défaut de la fondation)_ | Champs repris de la fondation. **Non référencés** — utilisez plutôt `display_name` / `description`. |
| `application_version` | `7.0.4` | Tag de version de l'image OpenEMR ; incrémentez-le pour déployer une nouvelle version. |
| `display_name` | `OpenEMR` | Nom convivial affiché dans la console et les tableaux de bord. |
| `description` | _(définie)_ | Annotation de description de la charge de travail. |

### Groupe 4 — Exécution et dimensionnement {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` / `container_image` / `container_build_config` | _(valeurs par défaut de la fondation)_ | Approvisionnement de l'image repris de la fondation. **Non référencés** — `OpenEMR_Common` construit toujours une image personnalisée. |
| `enable_image_mirroring` | `true` | Met en miroir l'image OpenEMR dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `container_port` | `8080` | Port du conteneur repris de la fondation. **Non référencé** — `main.tf` impose le port `80` en dur. |
| `container_protocol` | `http1` | Protocole HTTP repris de la fondation. **Non référencé.** |
| `container_resources` | _(valeurs par défaut de la fondation)_ | Objet CPU/mémoire repris de la fondation. **Non référencé** — utilisez plutôt `cpu_limit`/`memory_limit`/`ephemeral_storage_limit`. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour des charges de travail cliniques concurrentes. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB au minimum en production. |
| `ephemeral_storage_limit` | `8Gi` | Stockage éphémère pour l'opcache PHP, les journaux Apache et les fichiers temporaires. GKE Autopilot plafonne le stockage éphémère total d'un pod à 10 GiB ; le sidecar Auth Proxy en utilise environ 1 GiB, ce qui laisse un maximum de 9 GiB. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez une valeur ≥ 1 pour éviter les délais de démarrage à froid pour les utilisateurs cliniques. |
| `max_instance_count` | `1` | N'augmentez cette valeur qu'après avoir confirmé que le partage des sessions via Redis est opérationnel. |
| `enable_cloudsql_volume` | `true` | Activation du sidecar Cloud SQL Auth Proxy reprise de la fondation. **Non référencé** — `openemr.tf` force toujours cette valeur à `true` en interne. |
| `cloud_sql_proxy_version` | `2-alpine` | Tag de l'image du sidecar Cloud SQL Auth Proxy. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du socket de l'Auth Proxy repris de la fondation. **Non référencé.** |
| `service_annotations` / `service_labels` | `{}` | Annotations/libellés personnalisés du Service Kubernetes. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `timeout_seconds` | `300` | Durée maximale d'une requête en secondes (0–3600). |
| `deployment_timeout` | `1800` | Nombre de secondes pendant lesquelles Terraform attend le déploiement progressif. Allongé en raison de la longue installation d'OpenEMR au premier démarrage. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires en clair. Les valeurs de base `MYSQL_*` et `OE_*` sont définies automatiquement. Ajouts courants : `PHP_MEMORY_LIMIT`, `SMTP_HOST`, `SMTP_PORT`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. À utiliser pour les valeurs sensibles comme les identifiants SMTP. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster cible. Laissez vide pour la découverte automatique. |
| `gke_cluster_selection_mode` | `primary` | Stratégie de sélection du cluster reprise de la fondation. **Non référencé.** |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour le générer automatiquement. |
| `prereq_gke_subnet_cidr` / `prereq_subnet_cidr_override` / `prereq_gke_pod_cidr_override` / `prereq_gke_service_cidr_override` | _(dérivées automatiquement)_ | Remplacements de CIDR pour un VPC/cluster GKE intégré lorsque `Services_GCP` n'existe pas encore. Sur les déploiements existants, renseignez les valeurs déjà appliquées pour éviter un remplacement. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions PHP d'OpenEMR. |
| `enable_multi_cluster_service` | `false` | Activation de Multi-Cluster Services reprise de la fondation. **Non référencé.** |
| `extra_service_ports` | `[]` | Ports de Service supplémentaires pour les charges de travail multiprotocoles, repris de la fondation. **Non référencé** — déclaré uniquement pour la parité des conventions. |
| `configure_service_mesh` | `false` | Active l'injection du sidecar Istio pour l'espace de noms. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |
| `termination_grace_period_seconds` | `30` | Nombre de secondes pendant lesquelles Kubernetes attend après SIGTERM avant SIGKILL. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Requis pour la connectivité NFS via les règles de pare-feu VPC. Ne le supprimez pas. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC. OpenEMR utilise le NFS, pas des PVC — laissez non défini. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Options de PVC lorsque le mode StatefulSet est explicitement nécessaire. |
| `stateful_headless_service` | `null` | Crée un Service headless pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods : `OrderedReady` ou `Parallel`. `OrderedReady` par défaut. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. `RollingUpdate` par défaut. |
| `stateful_fs_group` | `0` | GID fsGroup défini dans le contexte de sécurité du pod ; `0` laisse fsGroup non défini. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Total des demandes/limites de CPU autorisées pour l'ensemble des pods de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers sans unité sont interprétés comme des octets et bloquent la planification. |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Nombre maximal de pods / Services / PVC dans l'espace de noms. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Désactivé par défaut car `max_instance_count = 1` — un PDB avec `min_available = 1` bloque le drainage des nœuds sur un pod unique. Ne l'activez qu'avec 2 réplicas ou plus. |
| `pdb_min_available` | `1` | Portez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |
| `topology_spread_strict` | `false` | Lorsque `true`, rejette les pods (`DoNotSchedule`) si la contrainte de répartition entre zones ne peut pas être satisfaite, au lieu de `ScheduleAnyway`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | _(valeurs par défaut de la fondation)_ | Objets de sonde repris de la fondation. **Non référencés** — utilisez plutôt `startup_probe` / `liveness_probe`. |
| `startup_probe` | TCP sur le port 80, 12 échecs × 10s | Sonde TCP ; laisse jusqu'à 120 secondes pour le démarrage. Augmentez `failure_threshold` pour les premiers déploiements avec des bases de données volumineuses. |
| `liveness_probe` | HTTP `GET /interface/login/login.php`, 10 échecs × 30s | La page de connexion ne renvoie HTTP 200 que lorsque Apache, PHP-FPM et la connexion à la base de données sont tous opérationnels. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la séquence intégrée `nfs-init` / `db-init` / `openemr-install`. |
| `cron_jobs` | `[]` | CronJobs planifiés (par exemple sauvegarde, génération de rapports). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés aux côtés d'OpenEMR. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`, `binauthz_evaluation_mode` (mode d'application —
`ALWAYS_ALLOW`, `REQUIRE_ATTESTATION` ou `ALWAYS_DENY` — utilisé uniquement lorsque
`enable_binary_authorization = true` et que `Services_GCP` n'a pas préconfiguré la
règle).

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Doit rester à `true`.** OpenEMR a besoin du NFS pour le répertoire `sites/`. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Chemin de montage dans le conteneur. Doit correspondre au chemin du répertoire sites d'OpenEMR. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | VM GCE NFS existante à cibler directement. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM GCE NFS intégrée lorsqu'il n'en existe aucune. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données. |
| `storage_buckets` | `[{name_suffix="data"}]` | Buckets supplémentaires. |
| `gcs_volumes` | `[]` | Buckets GCS montés via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Nombre de jours après lesquels les images deviennent éligibles à la suppression. |

### Groupe 15 — Stockage des sessions dans Redis {#group-15--redis-session-store}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour le stockage des sessions PHP. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS ; définissez-le explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Sélecteur du moteur de base de données repris de la fondation. **Non référencé** — `OpenEMR_Common` définit toujours `MYSQL_8_0`. |
| `sql_instance_name` / `sql_instance_base_name` | `""` / `app-sql` | Ciblage de l'instance Cloud SQL repris de la fondation. **Non référencés.** |
| `application_database_name` / `application_database_user` | `gkeappdb` / `gkeappuser` | Nom/utilisateur de base de données repris de la fondation. **Non référencés** — utilisez plutôt `db_name` / `db_user`. |
| `db_name` | `openemr` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `openemr` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installateur d'extensions PostgreSQL repris de la fondation. **Non référencés** — OpenEMR utilise MySQL. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Installateur de plugins MySQL repris de la fondation. **Non référencés** par ce module. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. Nécessite un redémarrage des pods pour prendre en compte le nouveau secret. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer les pods. |
| `db_password_env_var_name` | `""` | Variable d'environnement supplémentaire pour le mot de passe, reprise de la fondation. **Non référencé** — `main.tf` impose `MYSQL_PASS` en dur. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` | `""` | Noms de variables d'environnement de base de données supplémentaires repris de la fondation. **Non référencés** par ce module. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatisées (UTC). **Ne la désactivez pas pour les déploiements soumis à HIPAA.** |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` | `false` | Restaure à partir d'une sauvegarde lors du déploiement. |
| `backup_source` | `gcs` | Source de l'import : `gcs` ou `gdrive`. |
| `backup_file` | `backup.sql` | Nom du fichier de sauvegarde repris de la fondation. **Non référencé** — utilisez plutôt `backup_uri`. |
| `backup_uri` | `""` | URI GCS (`gs://bucket/path`) ou ID de fichier Google Drive. Lorsqu'il est défini, il est injecté dans `nfs-init` sous la forme `BACKUP_FILEID`. |
| `backup_format` | `sql` | Format du fichier de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz` ou `zip`. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, adresse IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Kubernetes Gateway pour les noms d'hôte personnalisés et un certificat géré (une Gateway avec une adresse IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôte à servir. S'il est vide, un domaine nip.io basé sur l'adresse IP statique générée automatiquement est utilisé. |
| `gateway_backend_stage` | `dev` | Étape Cloud Deploy dont le Service est ciblé par la HTTPRoute de la Gateway. Ignoré lorsque `enable_cloud_deploy` vaut false. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |
| `static_ip_name` | `""` | Nom de l'adresse IP statique réservée. Laissez vide pour le générer automatiquement. |
| `network_name` | `""` | Nom explicite du réseau VPC. Laissez vide pour découvrir automatiquement le réseau géré par `Services_GCP`. **Non référencé** par ce module. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant OpenEMR. Recommandé pour restreindre l'accès au personnel clinique. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN via GCPBackendPolicy sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC. Nécessite que `organization_id` soit défini explicitement. Recommandé pour les environnements HIPAA. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés (DATA_READ, DATA_WRITE). Recommandé pour la conformité HIPAA. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant d'accéder à OpenEMR. |
| `admin_password_secret_id` | ID du secret Secret Manager contenant le mot de passe administrateur d'OpenEMR (`OE_PASS`). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données (`MYSQL_PASS`). |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `nfs_server_ip` | Adresse IP interne du serveur NFS (sensible). |
| `nfs_mount_path` | Chemin de montage NFS dans le conteneur. |
| `nfs_share_path` | Chemin du partage NFS sur le serveur. |
| `nfs_setup_job` | Nom du job de configuration NFS. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (critique : perte de données / panne / sécurité) — **High** (élevé :
> service dégradé) — **Medium** (moyen : coût ou dégradation partielle) — **Low** (faible :
> mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | OpenEMR ne peut pas fonctionner sans NFS. Le répertoire `sites/`, `sqlconf.php` et les documents des patients résident tous sur le NFS. Le désactiver provoque un échec immédiat au démarrage. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Critical | Doit correspondre au chemin du répertoire sites d'OpenEMR. En cas de non-concordance, `openemr-install` écrit `sqlconf.php` à un emplacement que le pod principal ne vérifie jamais — le pod attend indéfiniment la fin de la configuration. |
| `database_type` (via OpenEMR_Common) | `MYSQL_8_0` | Critical | OpenEMR nécessite MySQL ; PostgreSQL ou `NONE` casse l'installateur et tous les appels PHP à la base de données. |
| `db_name` / `db_user` | défini une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données des patients. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import et peut corrompre le répertoire sites sur le NFS. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critical | Les entiers sans unité sont des octets et bloquent toute planification des pods. |
| `backup_schedule` | `0 2 * * *` | Critical | Désactiver les sauvegardes d'un DME contenant des PHI constitue une violation de la conformité HIPAA. |
| `ephemeral_storage_limit` | `8Gi` | Critical | OpenEMR écrit l'opcache PHP, les journaux Apache et les fichiers temporaires dans la couche du conteneur. La valeur par défaut de 1 GiB de GKE Autopilot est insuffisante — le pod est évincé pendant le démarrage. |
| `enable_redis` | `true` | High | Avec plus d'une réplica, des sessions PHP isolées par pod provoquent des échecs de connexion et des pertes de session. |
| `redis_host` | `""` (NFS) ou explicite | High | Un hôte Redis inaccessible provoque des échecs de session PHP et empêche toute connexion. |
| `memory_limit` | `4Gi` | High | La génération de PDF et les rapports de facturation d'OpenEMR sont gourmands en mémoire. Moins de 2 GiB provoque des arrêts OOM en cours de requête. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les déploiements à plusieurs réplicas perdent l'état des sessions entre les requêtes. |
| `min_instance_count` | `1` | High | La réduction à zéro entraîne des délais de démarrage à froid de 20 à 40 secondes — inacceptables pour l'accès clinique. |
| `enable_pod_disruption_budget` | à activer lorsque `min_instance_count` > 1 | High | Désactivé par défaut car `max_instance_count = 1` — un PDB bloquerait définitivement le drainage des nœuds sur un déploiement à pod unique. Activez-le lorsque vous dépassez une réplica. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Les environnements soumis à HIPAA doivent conserver au moins 90 jours. |
| `enable_iap` / `enable_cloud_armor` | à activer dans le secteur de la santé | Medium | L'interface d'administration d'OpenEMR est accessible publiquement sans ces contrôles. |
| `enable_audit_logging` | `true` pour HIPAA | Medium | HIPAA exige la journalisation d'audit des accès aux PHI. |
| `enable_vpc_sc` | définir `organization_id` explicitement | Medium | Sans ID d'organisation explicite, VPC-SC ignore silencieusement la création du périmètre — ce qui donne un faux sentiment de sécurité. |
| `container_image_source` / `container_port` / `container_resources` / `database_type` / `application_database_name` / `db_password_env_var_name` (Groupe 4/16/10) | laisser la valeur par défaut | Low | Ces variables reprises de la fondation ne sont déclarées que pour la parité avec `check_conventions.py` et ne sont **pas transmises** par `main.tf` — les modifier n'a aucun effet. Utilisez plutôt `cpu_limit`/`memory_limit`/`ephemeral_storage_limit`, `db_name`/`db_user` et `startup_probe`/`liveness_probe`. |

---

Pour le comportement de la fondation mentionné tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à OpenEMR partagée avec la
variante Cloud Run est décrite dans **[OpenEMR_Common](OpenEMR_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenEMR sur GKE Autopilot](../labs/OpenEMR_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [OpenEMR sur Google Cloud Run](OpenEMR_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenEMR Common — Configuration applicative partagée](OpenEMR_Common.md) — la configuration partagée par les deux cibles de déploiement.
