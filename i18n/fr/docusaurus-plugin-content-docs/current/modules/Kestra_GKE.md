---
title: "Kestra sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Kestra sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Kestra_GKE.md @ 15fd4c7 sha256:c1adb8d18ad2 -->

# Kestra sur GKE Autopilot {#kestra-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kestra_GKE.png" alt="Kestra sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kestra est une plateforme d'orchestration de données open-source (Apache 2.0) pour la
construction, la planification et la surveillance de pipelines ETL/ELT, de jobs par lots et
d'automatisation de workflows via des définitions de flux déclaratives basées sur YAML et
un écosystème de plus de 500 plugins. Ce module déploie Kestra sur **GKE Autopilot** en
mode autonome sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Kestra et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Kestra s'exécute comme un conteneur Java/JVM en mode autonome (serveur, worker et
planificateur dans un seul conteneur). Le déploiement relie un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Java/JVM, 2 vCPU / 4 GiB par défaut, mode autonome à réplica unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — stocke la file d'attente, le référentiel et l'historique d'exécution |
| Stockage d'objets | Cloud Storage | Bucket GCS dédié pour les flux, les exécutions et les artefacts |
| Secrets | Secret Manager | Mot de passe administrateur Kestra auto-généré |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Kestra utilise PostgreSQL à la fois pour sa file
  d'attente interne et son référentiel de flux. MySQL n'est pas pris en charge.
- **Le mode autonome exécute tous les composants dans un seul conteneur.** Gardez `max_instance_count = 1`
  pour éviter les conflits d'état de verrouillage de file d'attente entre les réplicas.
- **Le démarrage à froid de la JVM Java est lent.** La sonde de démarrage par défaut
  permet jusqu'à environ 14 minutes (délai initial de 30s + période de 20s × 40
  tentatives). Gardez `min_instance_count = 1` en production afin que les déclencheurs
  planifiés ne soient jamais manqués pendant les démarrages à froid.
- **Redis n'est pas utilisé.** Kestra utilise PostgreSQL pour la mise en file d'attente
  en mode autonome.
- **L'affinité de session est `ClientIP`.** Requise pour la connexion de
  streaming de logs persistante de l'interface utilisateur de Kestra — les requêtes du
  même navigateur doivent atteindre le même pod.
- **Le mot de passe administrateur est auto-généré** et stocké dans Secret Manager ; il
  n'est jamais défini en texte clair.
- **Un bucket de stockage GCS est toujours provisionné** pour les flux, les exécutions et
  les artefacts ; son nom est injecté automatiquement comme `KESTRA_STORAGE_GCS_BUCKET`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Kestra {#a-gke-autopilot--the-kestra-workload}

Les pods Kestra sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Par défaut, un seul réplica gère tous les composants d'orchestration
(serveur, worker, planificateur) dans un seul pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  Kestra pour voir les pods, les événements et l'état. Kubernetes Engine → Services et
  Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type
de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Kestra stocke tout l'état du workflow — définitions de flux, historique d'exécution,
déclencheurs, espaces de noms et la file d'attente de tâches interne — dans une instance
Cloud SQL pour PostgreSQL 15 gérée. Les pods l'atteignent via le sidecar **Cloud SQL Auth
Proxy** sur un socket TCP à `127.0.0.1:5432` (aucune IP publique n'est exposée). Lors du
premier déploiement, un job d'initialisation crée la base de données Kestra, l'utilisateur
et accorde les privilèges requis.

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
Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné pour le backend de stockage d'artefacts
GCS de Kestra. Toutes les exécutions de flux, les entrées/sorties de tâches et les objets
de stockage internes y sont écrits. Le nom du bucket est injecté dans chaque pod comme
`KESTRA_STORAGE_GCS_BUCKET`. Des buckets supplémentaires ou des volumes GCS Fuse peuvent être montés
pour l'accès aux données de flux.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<kestra-storage-bucket>/        # bucket name in Outputs
  # Confirm a GCS Fuse volume is mounted inside a pod (if configured):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i fuse
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe administrateur de Kestra est stocké comme un secret Secret Manager et
injecté dans les pods au moment de l'exécution ; le texte clair n'apparaît jamais dans la
configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

Le secret du mot de passe administrateur est nommé `<resource_prefix>-admin-password`. Le nom du secret du
mot de passe de la base de données est dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

La charge de travail est exposée via une adresse IP externe de Cloud Load Balancing.
`enable_custom_domain` par défaut à `true`, provisionnant une passerelle Kubernetes
avec un certificat géré par Google pour les noms d'hôte dans `application_domains` ; une IP
statique est réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de
l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE
et Cloud SQL sont acheminées vers Cloud Monitoring. Les sondes de santé ciblent le point
de terminaison `/health` de Kestra. Des tests de disponibilité et des politiques
d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Kestra {#3-kestra-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation
  (`db-init`) utilise `postgres:15-alpine` pour se connecter via le Cloud SQL Auth Proxy
  et crée de manière idempotente la base de données et l'utilisateur Kestra, accorde les
  privilèges et réinitialise le schéma public afin que Flyway puisse appliquer toutes les
  migrations proprement sur une nouvelle instance Cloud SQL. Le job signale au proxy de
  s'arrêter proprement une fois terminé.
- **Migrations Flyway au démarrage.** Kestra exécute ses propres migrations de schéma
  basées sur Flyway à chaque démarrage. Le paramètre `FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true` empêche les
  échecs sur Cloud SQL, qui pré-remplit le schéma public avec des objets d'extension. La
  mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Pont de socket JDBC.** Sur GKE, le sidecar Cloud SQL Auth Proxy écoute déjà sur TCP
  `127.0.0.1:5432`, de sorte que la logique du pont JDBC `entrypoint.sh` est ignorée
  automatiquement — aucun pont `socat` n'est nécessaire ici (contrairement à la
  variante Cloud Run).
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /health` sur le port 8080. Kestra (JVM Java) a un démarrage lent ; la sonde
  par défaut permet jusqu'à environ 14 minutes avant de déclarer un échec.
- **Affinité de session.** L'interface utilisateur de Kestra diffuse les logs d'exécution
  sur une connexion persistante. `session_affinity = "ClientIP"` achemine toutes les requêtes du même
  navigateur vers le même pod, empêchant les déconnexions de flux de logs.
- **Délai de grâce de terminaison.** Défini à 60 secondes (par rapport à la valeur par
  défaut de Kubernetes) pour permettre aux exécutions de tâches en cours de se terminer
  gracieusement avant que le pod ne soit terminé de force.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est
  `admin`. Le mot de passe est récupéré de Secret Manager (voir §2.D).
- **Déclencheurs planifiés.** Le planificateur interne de Kestra traite les déclencheurs
  définis par le flux (cron, intervalle, webhook). Tant qu'un pod est en cours
  d'exécution, tous les déclencheurs se déclenchent à l'heure prévue. La définition de
  `min_instance_count = 0` entraîne des déclencheurs manqués pendant les périodes de démarrage à
  froid.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Kestra sont listés ; toutes
les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement standard
et leurs valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kestra` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image Kestra ; incrémenter pour déployer une nouvelle version (par exemple `0.17.0`). |
| `display_name` | `Kestra Data Orchestration` | Nom convivial affiché dans la console et l'interface utilisateur de la plateforme. |
| `description` | `Kestra Data Orchestration - ETL/ELT pipeline and workflow orchestration on GKE Autopilot` | Annotation de description de la charge de travail. |
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU minimum recommandés pour Kestra JVM. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (minimum 2 GiB). |
| `container_port` | `8080` | Port du serveur Kestra/Micronaut. Doit correspondre à `MICRONAUT_SERVER_PORT`. |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour que les déclencheurs planifiés ne soient jamais manqués. |
| `max_instance_count` | `1` | Réplicas maximum. Garder à 1 pour le mode autonome afin d'éviter les conflits de file d'attente. |
| `timeout_seconds` | `300` | Durée maximale de la requête en secondes (0–3600). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket TCP à PostgreSQL. |
| `cloud_sql_proxy_version` | `2-alpine` | Tag de l'image du sidecar Cloud SQL Auth Proxy. Épingler à un digest pour des déploiements immuables. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Kestra dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend après SIGTERM — permet aux exécutions en cours de se terminer. |
| `deployment_timeout` | `1800` | Secondes maximales pendant lesquelles Terraform attend la fin du déploiement (grande image Java). |

`container_image_source`, `container_image`, `container_build_config`, `container_protocol` et
`container_resources` sont déclarés pour la parité de convention de la Fondation mais **ne sont pas
transmis** par ce module — `Kestra_Common` construit toujours l'image officielle
`kestra/kestra` via Cloud Build (`container_build_config`) et transmet `cpu_limit`/`memory_limit`
directement au lieu de `container_resources`. La définition de l'un d'entre eux n'a aucun effet ;
utilisez `cpu_limit`/`memory_limit` ci-dessus pour dimensionner le pod.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables Kestra Core sont injectées automatiquement ; ne les écrasez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager (par exemple `{ KESTRA_ENCRYPTION_SECRET = "kestra-enc-key" }`). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret (0–300). |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `enable_auto_password_rotation` | `false` | Rotation automatisée du mot de passe de la base de données sans interruption. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour le streaming de logs de l'interface utilisateur de Kestra. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé ; sinon, Deployment. |
| `gke_cluster_name` | `""` | Laisser vide pour découvrir automatiquement le cluster géré par Services_GCP. |
| `namespace_name` | `""` | Laisser vide pour générer automatiquement à partir du nom de l'application et de l'ID du locataire. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod pour les règles de pare-feu VPC. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |
| `configure_service_mesh` | `false` | Activer l'injection Istio pour l'espace de noms de l'application. |
| `extra_service_ports` | `[]` | Ports de service supplémentaires pour les charges de travail multi-protocoles. Déclaré mais **non transmis** — n'a aucun effet sur ce module. |

`prereq_gke_subnet_cidr`, `prereq_subnet_cidr_override`, `prereq_gke_pod_cidr_override` et
`prereq_gke_service_cidr_override` contrôlent les prérequis VPC/GKE intégrés créés uniquement lorsqu'aucun
réseau/cluster `Services_GCP` n'existe encore. `prereq_gke_subnet_cidr` est déclaré mais non
référencé ; les trois variables `*_override` sont transmises et n'importent que sur les
déploiements intégrés existants (sans `Services_GCP`), pour éviter de remplacer le
cluster lors d'une nouvelle application.

### Groupe 7 — StatefulSet {#group-7--statefulset}

Pertinent uniquement lorsque `workload_type = "StatefulSet"` ou `stateful_pvc_enabled = true`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer un PVC par pod pour le stockage local des plugins ou les fichiers d'exécution temporaires. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC. Immuable après la création — planifier la capacité à l'avance. |
| `stateful_pvc_mount_path` | `/app/storage` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `""` | Kubernetes StorageClass ; vide utilise la valeur par défaut du cluster. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds (par défaut `true` pour Kestra). |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones (pertinent uniquement lorsque `max_instance_count > 1`). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 30s de délai, période 20s, 40 échecs | Sonde de démarrage de l'application — permet jusqu'à ~14 minutes pour le démarrage de la JVM. |
| `liveness_probe` | HTTP `/health`, 180s de délai, période 30s, 5 échecs | Sonde de vivacité de l'application. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. Fournir une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour les tâches auxiliaires planifiées (par exemple, les sauvegardes). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Kestra. |

### Groupe 12 — Intégration CI/CD et GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`. `binauthz_evaluation_mode` est déclaré pour la parité de convention
mais non référencé — seul `enable_binary_authorization` est transmis.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionner un partage Cloud Filestore (NFS) et le monter dans les pods. Utile pour les scripts de flux qui écrivent des fichiers locaux. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume ; écraser lors du montage d'un deuxième partage NFS à côté du premier. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner des buckets supplémentaires dans `storage_buckets`. Le bucket de stockage Kestra est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de stockage intégré. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Déclaré pour la parité de convention de la Fondation. **Non référencé** — `main.tf` désactive Redis en dur (`enable_redis = false`) car le mode autonome de Kestra met en file d'attente via PostgreSQL, pas Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `"6379"` / `""` | Également déclaré mais non référencé, pour la même raison. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `kestra` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `kestra` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Transmis à `App_GKE` mais non applicable — Kestra est uniquement PostgreSQL. |

`database_type`, `sql_instance_name`, `sql_instance_base_name`, `application_database_name`,
`application_database_user`, `enable_postgres_extensions`, `postgres_extensions`, et l'ensemble
`db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` /
`db_password_env_var_name` / `db_port_env_var_name` sont tous déclarés pour la parité de convention de la
Fondation mais **non transmis** par ce module — `Kestra_Common` fixe le moteur à
`POSTGRES_15` et injecte uniquement les noms standard
`DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_PORT`. La
définition de l'un d'entre eux n'a aucun effet.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |
| `backup_file` | `backup.sql` | Déclaré pour la parité de convention. **Non référencé** — `main.tf` transmet `backup_uri` comme source d'importation à la place. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner une passerelle Kubernetes avec un certificat SSL pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Noms d'hôte à servir. Vide avec `enable_custom_domain = true` génère un domaine `nip.io`. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. Recommandé pour la production. |
| `gateway_backend_stage` | `dev` | Étape Cloud Deploy (`dev`/`staging`/`prod`) dont le service est ciblé par la Gateway HTTPRoute. Ignoré lorsque `enable_cloud_deploy = false`. |
| `network_name` | `""` | Déclaré pour la parité de convention de la Fondation. **Non référencé** — la découverte du réseau est gérée en interne via `module.network_discovery`. |

### Groupe 20 — Proxy d'authentification (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Kestra. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Kestra. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket de stockage Kestra). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (optionnels) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors de la première application d'un nouveau cluster intégré. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `db_name` | `kestra` — défini une fois | Critique | Immuable après le premier déploiement ; le modifier connecte Kestra à une base de données vide, perdant tous les flux, l'historique d'exécution, les déclencheurs et les espaces de noms. |
| `application_name` | `kestra` — défini une fois | Critique | Immuable après le premier déploiement ; le modifier renomme toutes les ressources GCP/Kubernetes, entraînant une recréation complète avec perte de données. |
| `KESTRA_BASICAUTH_ENABLED` (injecté `true`) | laisser tel quel | Critique | Le fait de le remplacer par `false` expose l'interface utilisateur et l'API REST complètes de Kestra sans authentification. Ne désactiver que derrière un proxy d'authentification de confiance (IAP, Cloud Armor). |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation. |
| `max_instance_count` | `1` | Élevé | Kestra Community Edition utilise le verrouillage de file d'attente PostgreSQL — plusieurs réplicas entraînent une double attribution de tâches et des conflits d'exécution. |
| `min_instance_count` | `1` | Élevé | La définition à `0` entraîne des déclencheurs manqués pendant les périodes de démarrage à froid. Le démarrage de la JVM Kestra peut prendre plusieurs minutes. |
| `memory_limit` | `4Gi` | Élevé | Des valeurs inférieures à 2 GiB provoquent des erreurs OutOfMemoryErrors de la JVM sous une charge d'exécution concurrente. |
| `enable_cloudsql_volume` | `true` | Élevé | Requis pour la connectivité PostgreSQL ; bloqué au moment de la planification lorsque `database_type != "NONE"`. |
| `KESTRA_QUEUE_TYPE` / `KESTRA_REPOSITORY_TYPE` (injecté `postgres`) | laisser tel quel | Élevé | Seul PostgreSQL est provisionné ; le remplacement par un type de backend non pris en charge entraîne un échec de démarrage. |
| `KESTRA_STORAGE_TYPE` (injecté `gcs`) | laisser tel quel | Élevé | Le fait de le remplacer par `local` entraîne l'écriture de tous les artefacts d'exécution dans le stockage éphémère du pod et leur perte au redémarrage. |
| Seuil d'échec `startup_probe` | 40 (par défaut) | Élevé | La réduction en dessous de ~10 provoque des redémarrages prématurés des pods lors de démarrages JVM lents avant que Kestra n'ait terminé de charger tous les flux. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les connexions de streaming de logs de l'interface utilisateur de Kestra se déconnectent lorsqu'elles sont acheminées vers un pod différent. |
| `termination_grace_period_seconds` | `60` | Moyen | Des valeurs inférieures à 30 s annulent les exécutions de tâches en cours de route. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation de PDB permet à GKE d'expulser le pod Kestra pendant la maintenance des nœuds, interrompant toutes les exécutions en cours. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont traités comme des octets par Kubernetes et bloquent toute planification dans l'espace de noms. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface utilisateur et l'API Kestra sont autrement accessibles publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour les exigences de rétention de conformité. |
| `organization_id` | définir lors de l'utilisation de VPC-SC | Moyen | Si vide, les VPC Service Controls sont ignorés silencieusement. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration
d'application spécifique à Kestra partagée avec la variante Cloud Run est décrite dans
**[Kestra_Common](Kestra_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Kestra sur GKE Autopilot](../labs/Kestra_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Kestra sur Google Cloud Run](Kestra_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Kestra Common — Configuration d'application partagée](Kestra_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Apache Superset sur GKE Autopilot](Superset_GKE.md), [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Analytics Warehouse**.
