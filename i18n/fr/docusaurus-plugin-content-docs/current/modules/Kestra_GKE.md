---
title: "Kestra sur GKE Autopilot"
description: "Référence de configuration pour déployer Kestra sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Kestra_GKE.md @ 3055034 sha256:5430591f6819 -->

# Kestra sur GKE Autopilot {#kestra-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kestra_GKE.png" alt="Kestra sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kestra est une plateforme open source d'orchestration de données (Apache 2.0) qui permet de construire, planifier
et superviser des pipelines ETL/ELT, des traitements par lots et des automatisations de workflows au moyen de définitions
de flux déclaratives en YAML et d'un écosystème de plus de 500 plugins. Ce module déploie Kestra sur
**GKE Autopilot** en mode autonome (standalone) en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Kestra et sur la manière de les explorer et de les exploiter depuis
la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications
GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Kestra s'exécute comme un conteneur Java/JVM en mode autonome (serveur, worker et planificateur dans un
seul conteneur). Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Java/JVM, 2 vCPU / 4 GiB par défaut, mode autonome à réplica unique |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — stocke la file d'attente, le référentiel et l'historique des exécutions |
| Stockage objet | Cloud Storage | Bucket GCS dédié pour les flux, les exécutions et les artefacts |
| Secrets | Secret Manager | Mot de passe administrateur Kestra généré automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Kestra utilise PostgreSQL à la fois pour sa file d'attente interne et pour son
  référentiel de flux. MySQL n'est pas pris en charge.
- **Le mode autonome exécute tous les composants dans un seul conteneur.** Conservez `max_instance_count = 1`
  pour éviter des états de verrouillage de file d'attente contradictoires entre réplicas.
- **Le démarrage à froid de la JVM Java est lent.** La sonde de démarrage par défaut accorde jusqu'à ~14 minutes
  (délai initial de 30s + période de 20s × 40 tentatives). Conservez `min_instance_count = 1` en
  production afin que les déclencheurs planifiés ne soient jamais manqués pendant les démarrages à froid.
- **Redis n'est pas utilisé.** Kestra s'appuie sur PostgreSQL pour la mise en file d'attente en mode autonome.
- **L'affinité de session est `ClientIP`.** Elle est requise pour la connexion persistante de diffusion des journaux
  de l'interface Kestra — les requêtes d'un même navigateur doivent atteindre le même pod.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret Manager ; il n'est jamais défini
  en clair.
- **Un bucket de stockage GCS est toujours provisionné** pour les flux, les exécutions et les artefacts ; son
  nom est injecté automatiquement sous la forme `KESTRA_STORAGE_GCS_BUCKET`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Kestra {#a-gke-autopilot--the-kestra-workload}

Les pods Kestra sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods demandent
réellement. Par défaut, un réplica unique prend en charge tous les composants d'orchestration (serveur, worker,
planificateur) dans un seul pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Kestra pour voir les pods,
  les événements et l'état. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Kestra stocke tout l'état des workflows — définitions de flux, historique des exécutions, déclencheurs, namespaces
et file d'attente interne des tâches — dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods l'atteignent
via le sidecar **Cloud SQL Auth Proxy** sur un socket TCP à `127.0.0.1:5432`
(aucune IP publique n'est exposée). Lors du premier déploiement, un job d'initialisation crée la base de données Kestra et
l'utilisateur, et accorde les privilèges nécessaires.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
figurent tous dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné pour le backend de stockage d'artefacts GCS de Kestra.
Toutes les exécutions de flux, les entrées/sorties des tâches et les objets de stockage interne y sont écrits. Le
nom du bucket est injecté dans chaque pod sous la forme `KESTRA_STORAGE_GCS_BUCKET`. Des buckets supplémentaires ou des
volumes GCS Fuse peuvent être montés pour l'accès aux données des flux.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<kestra-storage-bucket>/        # bucket name in Outputs
  # Confirm a GCS Fuse volume is mounted inside a pod (if configured):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i fuse
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe administrateur Kestra est stocké sous forme de secret Secret Manager et injecté dans les pods à
l'exécution ; il n'apparaît jamais en clair dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

Le secret du mot de passe administrateur est nommé `<resource_prefix>-admin-password`. Le nom du secret du mot de passe
de la base de données figure dans les [Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour
l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

La charge de travail est exposée via une IP Cloud Load Balancing externe. `enable_custom_domain`
vaut `true` par défaut, ce qui provisionne une Kubernetes Gateway avec un certificat géré par Google pour
les noms d'hôte de `application_domains` ; une IP statique est réservée par défaut afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP
statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud Monitoring.
Les sondes de santé ciblent le point de terminaison `/health` de Kestra. Des tests de disponibilité et des règles d'alerte
optionnels sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Kestra {#3-kestra-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) utilise `postgres:15-alpine`
  pour se connecter via le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et
  l'utilisateur Kestra, accorde les privilèges et réinitialise le schéma public afin que Flyway puisse appliquer toutes les migrations
  proprement sur une instance Cloud SQL neuve. Le job signale au proxy de s'arrêter proprement
  une fois terminé.
- **Migrations Flyway au démarrage.** Kestra exécute ses propres migrations de schéma basées sur Flyway à chaque
  démarrage. Le paramètre `FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true` évite les échecs
  sur Cloud SQL, qui pré-remplit le schéma public avec des objets d'extension. La mise à niveau de
  `application_version` applique automatiquement les modifications de schéma.
- **Pont de socket JDBC.** Sur GKE, le sidecar Cloud SQL Auth Proxy écoute déjà sur TCP
  `127.0.0.1:5432`, si bien que la logique de pont JDBC de `entrypoint.sh` est automatiquement ignorée — aucun
  pont `socat` n'est nécessaire ici (contrairement à la variante Cloud Run).
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité ciblent `GET /health` sur le port 8080.
  Kestra (JVM Java) démarre lentement ; la sonde par défaut accorde jusqu'à ~14 minutes avant de
  déclarer un échec.
- **Affinité de session.** L'interface Kestra diffuse les journaux d'exécution sur une connexion persistante.
  `session_affinity = "ClientIP"` achemine toutes les requêtes d'un même navigateur vers le même pod,
  ce qui évite les déconnexions du flux de journaux.
- **Délai de grâce de terminaison.** Fixé à 60 secondes (au-delà de la valeur par défaut de Kubernetes) pour permettre
  aux exécutions de tâches en cours de se terminer proprement avant l'arrêt forcé du pod.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est `admin`. Le mot de passe se récupère dans
  Secret Manager (voir §2.D).
- **Déclencheurs planifiés.** Le planificateur interne de Kestra traite les déclencheurs définis dans les flux (cron,
  intervalle, webhook). Tant qu'un pod est en cours d'exécution, tous les déclencheurs s'exécutent à l'heure prévue. Définir
  `min_instance_count = 0` entraîne des déclencheurs manqués pendant les périodes de démarrage à froid.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Kestra ou notables pour lui sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

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
| `application_name` | `kestra` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image Kestra ; incrémentez-le pour déployer une nouvelle version (par ex. `0.17.0`). |
| `display_name` | `Kestra Data Orchestration` | Nom convivial affiché dans la console et l'interface de la plateforme. |
| `description` | `Kestra Data Orchestration - ETL/ELT pipeline and workflow orchestration on GKE Autopilot` | Annotation de description de la charge de travail. |
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU minimum recommandés pour la JVM Kestra. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (2 GiB minimum). |
| `container_port` | `8080` | Port du serveur Kestra/Micronaut. Doit correspondre à `MICRONAUT_SERVER_PORT`. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour ne jamais manquer de déclencheurs planifiés. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. Conservez 1 en mode autonome pour éviter les conflits de file d'attente. |
| `timeout_seconds` | `300` | Durée maximale d'une requête en secondes (0–3600). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket TCP à PostgreSQL. |
| `cloud_sql_proxy_version` | `2-alpine` | Tag de l'image du sidecar Cloud SQL Auth Proxy. Épinglez-le sur un digest pour des déploiements immuables. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Kestra dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente de Kubernetes après SIGTERM — permet aux exécutions en cours de se terminer. |
| `deployment_timeout` | `1800` | Nombre maximal de secondes pendant lesquelles Terraform attend la fin du déploiement (image Java volumineuse). |

`container_image_source`, `container_image`, `container_build_config`, `container_protocol` et
`container_resources` sont déclarées par souci de cohérence avec les conventions du socle, mais ne sont **pas transmises** par
ce module — `Kestra_Common` construit toujours l'image officielle `kestra/kestra` via Cloud Build
(`container_build_config`) et transmet directement `cpu_limit`/`memory_limit` au lieu de
`container_resources`. Les définir n'a aucun effet ; utilisez `cpu_limit`/`memory_limit` ci-dessus
pour dimensionner le pod.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les variables Kestra essentielles sont injectées automatiquement ; ne les remplacez pas ici. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom de secret Secret Manager (par ex. `{ KESTRA_ENCRYPTION_SECRET = "kestra-enc-key" }`). |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret (0–300). |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `enable_auto_password_rotation` | `false` | Rotation automatisée et sans interruption du mot de passe de la base de données. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant de redémarrer les pods. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour la diffusion des journaux de l'interface Kestra. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé ; sinon en Deployment. |
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement le cluster géré par Services_GCP. |
| `namespace_name` | `""` | Laissez vide pour le générer automatiquement à partir du nom de l'application et de l'ID de tenant. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod pour les règles de pare-feu VPC. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |
| `configure_service_mesh` | `false` | Active l'injection Istio pour l'espace de noms de l'application. |
| `extra_service_ports` | `[]` | Ports de Service supplémentaires pour les charges de travail multiprotocoles. Déclarée mais **non transmise** — sans effet sur ce module. |

`prereq_gke_subnet_cidr`, `prereq_subnet_cidr_override`, `prereq_gke_pod_cidr_override` et
`prereq_gke_service_cidr_override` contrôlent les prérequis VPC/GKE intégrés (inline) créés uniquement lorsqu'aucun
réseau/cluster `Services_GCP` n'existe encore. `prereq_gke_subnet_cidr` est déclarée mais non
référencée ; les trois variables `*_override` sont transmises et n'ont d'importance que pour les déploiements existants avec prérequis intégrés
(sans `Services_GCP`), afin d'éviter de remplacer le cluster lors d'un nouvel apply.

### Groupe 7 — StatefulSet {#group-7--statefulset}

Pertinent uniquement lorsque `workload_type = "StatefulSet"` ou `stateful_pvc_enabled = true`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active un PVC par pod pour le stockage local des plugins ou les fichiers d'exécution temporaires. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC. Immuable après création — planifiez la capacité à l'avance. |
| `stateful_pvc_mount_path` | `/app/storage` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `""` | StorageClass Kubernetes ; vide utilise la valeur par défaut du cluster. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds (`true` par défaut pour Kestra). |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones (pertinent uniquement lorsque `max_instance_count > 1`). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 30s, période de 20s, 40 échecs | Sonde de démarrage de l'application — accorde jusqu'à ~14 minutes au démarrage de la JVM. |
| `liveness_probe` | HTTP `/health`, délai de 180s, période de 30s, 5 échecs | Sonde de vivacité de l'application. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Fournissez une liste non vide pour la remplacer entièrement. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour des tâches auxiliaires planifiées (par ex. sauvegardes). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés aux côtés de Kestra. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`. `binauthz_evaluation_mode` est déclarée par souci de cohérence avec les conventions
mais n'est pas référencée — seule `enable_binary_authorization` est transmise.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne un partage Cloud Filestore (NFS) et le monte dans les pods. Utile pour les scripts de flux qui écrivent des fichiers locaux. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume ; à remplacer lorsque vous montez un second partage NFS à côté du premier. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets supplémentaires de `storage_buckets`. Le bucket de stockage Kestra est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket de stockage intégré. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote GCS Fuse CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Déclarée par souci de cohérence avec les conventions du socle. **Non référencée** — `main.tf` désactive Redis en dur (`enable_redis = false`) car le mode autonome de Kestra met les tâches en file d'attente via PostgreSQL, et non via Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `"6379"` / `""` | Également déclarées mais non référencées, pour la même raison. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `kestra` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `kestra` | Utilisateur applicatif. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation sans interruption du mot de passe de la base de données. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Transmises à `App_GKE` mais sans objet — Kestra fonctionne uniquement avec PostgreSQL. |

`database_type`, `sql_instance_name`, `sql_instance_base_name`, `application_database_name`,
`application_database_user`, `enable_postgres_extensions`, `postgres_extensions` et l'ensemble
`db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` /
`db_password_env_var_name` / `db_port_env_var_name` sont toutes déclarées par souci de cohérence avec les conventions du socle
mais **ne sont pas transmises** par ce module — `Kestra_Common` fixe le moteur à
`POSTGRES_15` et n'injecte que les noms standard `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_PORT`.
Les définir n'a aucun effet.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |
| `backup_file` | `backup.sql` | Déclarée par souci de cohérence avec les conventions. **Non référencée** — `main.tf` transmet `backup_uri` comme source d'import à la place. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Kubernetes Gateway avec un certificat SSL pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Noms d'hôte à servir. S'il est vide alors que `enable_custom_domain = true`, un domaine `nip.io` est généré. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. Recommandé pour la production. |
| `gateway_backend_stage` | `dev` | Étape Cloud Deploy (`dev`/`staging`/`prod`) dont le Service est ciblé par la HTTPRoute de la Gateway. Ignorée lorsque `enable_cloud_deploy = false`. |
| `network_name` | `""` | Déclarée par souci de cohérence avec les conventions du socle. **Non référencée** — la découverte du réseau est gérée en interne via `module.network_discovery`. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Kestra. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Kestra. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de stockage Kestra). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors du premier apply d'un nouveau cluster intégré (inline). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `db_name` | `kestra` — à définir une fois | Critique | Immuable après le premier déploiement ; le modifier connecte Kestra à une base de données vide, avec perte de tous les flux, de l'historique des exécutions, des déclencheurs et des namespaces. |
| `application_name` | `kestra` — à définir une fois | Critique | Immuable après le premier déploiement ; le modifier renomme toutes les ressources GCP/Kubernetes, ce qui entraîne une recréation complète avec perte de données. |
| `KESTRA_BASICAUTH_ENABLED` (injectée à `true`) | laisser telle qu'injectée | Critique | La forcer à `false` expose l'intégralité de l'interface et de l'API REST de Kestra sans authentification. Ne la désactivez que derrière un proxy d'authentification de confiance (IAP, Cloud Armor). |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `max_instance_count` | `1` | Élevé | Kestra Community Edition utilise le verrouillage de file d'attente PostgreSQL — plusieurs réplicas provoquent une double affectation des tâches et des conflits d'exécution. |
| `min_instance_count` | `1` | Élevé | La valeur `0` entraîne des déclencheurs planifiés manqués pendant les périodes de démarrage à froid. Le démarrage de la JVM Kestra peut prendre plusieurs minutes. |
| `memory_limit` | `4Gi` | Élevé | Des valeurs inférieures à 2 GiB provoquent des erreurs OutOfMemoryError de la JVM sous une charge d'exécutions concurrentes. |
| `enable_cloudsql_volume` | `true` | Élevé | Requis pour la connectivité PostgreSQL ; bloqué au moment du plan lorsque `database_type != "NONE"`. |
| `KESTRA_QUEUE_TYPE` / `KESTRA_REPOSITORY_TYPE` (injectées à `postgres`) | laisser telles qu'injectées | Élevé | Seul PostgreSQL est provisionné ; les forcer vers un type de backend non pris en charge provoque un échec au démarrage. |
| `KESTRA_STORAGE_TYPE` (injectée à `gcs`) | laisser telle qu'injectée | Élevé | Passer à `local` fait écrire tous les artefacts d'exécution dans le stockage éphémère du pod, perdus au redémarrage. |
| Seuil d'échec de `startup_probe` | 40 (par défaut) | Élevé | Le réduire en dessous de ~10 provoque des redémarrages prématurés du pod lors des démarrages lents de la JVM, avant que Kestra ait fini de charger tous les flux. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les connexions de diffusion des journaux de l'interface Kestra se coupent lorsqu'elles sont acheminées vers un autre pod. |
| `termination_grace_period_seconds` | `60` | Moyen | Des valeurs inférieures à 30 s interrompent les exécutions de tâches en cours. |
| `enable_pod_disruption_budget` | `true` | Moyen | Désactiver le PDB permet à GKE d'évincer le pod Kestra pendant la maintenance des nœuds, interrompant toutes les exécutions en cours. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont interprétés comme des octets par Kubernetes et bloquent toute planification dans l'espace de noms. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les accès d'administration | Moyen | Sinon, l'interface et l'API Kestra sont accessibles publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de rétention liées à la conformité. |
| `organization_id` | à définir en cas d'utilisation de VPC-SC | Moyen | S'il est vide, VPC Service Controls est ignoré sans avertissement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes
et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Kestra
partagée avec la variante Cloud Run est décrite dans
**[Kestra_Common](Kestra_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Kestra sur GKE Autopilot](../labs/Kestra_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Kestra sur Google Cloud Run](Kestra_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Kestra Common — Configuration applicative partagée](Kestra_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Apache Superset sur GKE Autopilot](Superset_GKE.md) et [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Analytics Warehouse**.
