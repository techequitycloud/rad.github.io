---
title: "NetBox sur GKE Autopilot"
description: "Référence de configuration pour déployer NetBox sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Netbox_GKE.md @ 3055034 sha256:62484c2df09f -->

# NetBox sur GKE Autopilot {#netbox-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netbox_GKE.png" alt="NetBox sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

NetBox est la « source de vérité » open source de référence pour les équipes
d'ingénierie réseau — gestion des adresses IP (IPAM), inventaire des équipements et
des baies, câblage et topologie réseau, le tout modélisé sous forme de données
structurées derrière une API REST/GraphQL complète. Ce module déploie NetBox sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise NetBox et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

NetBox s'exécute sous la forme d'un pod Python/Django construit sur mesure sur GKE
Autopilot, qui encapsule l'image officielle `netboxcommunity/netbox` avec un
processus d'arrière-plan `rqworker --with-scheduler` colocalisé. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods à image construite sur mesure, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — NetBox ne prend en charge ni MySQL ni SQLite en production |
| Stockage objet | Cloud Storage (GCS Fuse CSI) | Un bucket `media` monté sur `/etc/netbox/media`, le véritable `MEDIA_ROOT` de NetBox |
| Cache et file d'attente | Redis (obligatoire) | File de tâches (`REDIS_DATABASE=0`) et cache (`REDIS_CACHE_DATABASE=1`) sur des bases logiques distinctes ; utilise par défaut l'IP du serveur NFS |
| Secrets | Secret Manager | `SECRET_KEY` et `SUPERUSER_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; NetBox ne prend en charge ni MySQL ni SQLite en
  production.
- **Redis est obligatoire, pas facultatif.** NetBox utilise Redis comme broker pour
  son système de tâches d'arrière-plan RQ (Redis Queue) — webhooks, scripts
  personnalisés, rapports et jobs planifiés/système — et comme backend de cache, sur
  **deux bases logiques distinctes** (`REDIS_DATABASE=0`, `REDIS_CACHE_DATABASE=1`).
- **Un worker d'arrière-plan est colocalisé dans le même pod.** `manage.py rqworker
  --with-scheduler` s'exécute comme processus en arrière-plan à côté du serveur web
  Granian. Sans lui, les tâches d'arrière-plan s'accumulent silencieusement en file
  d'attente et ne s'exécutent jamais.
- **Les téléversements de médias sont montés sur le véritable `MEDIA_ROOT` de
  NetBox.** `/etc/netbox/media`, confirmé en conditions réelles via
  `manage.py shell`. Voir §3 pour l'histoire complète de la découverte de ce chemin
  et des raisons pour lesquelles un chemin antérieur, plausible en apparence, était
  erroné.
- **Les options `uid=0`/`gid=0` du montage GCS Fuse sont déterminantes sur GKE.**
  L'intégration GCS Fuse propre à Cloud Run applique toujours un
  `uid:1000/gid:1000` par défaut quelle que soit la configuration (root peut y écrire
  de toute façon) ; le pilote CSI GCS Fuse de GKE n'a pas de telle valeur par défaut,
  c'est donc la fixation explicite `uid=0`/`gid=0` — correspondant au conteneur de
  NetBox exécuté en root — qui rend réellement le montage accessible en écriture.
- **Pas de mise à l'échelle jusqu'à zéro.** GKE Autopilot exécute toujours au moins
  `min_instance_count` réplicas (par défaut `1`), ce qui maintient le worker RQ
  actif en permanence.
- **Le conteneur s'exécute en tant que root** (uid 0 / gid 0) — l'image officielle
  `netboxcommunity/netbox` ne définit aucun `USER`.
- **`SECRET_KEY` et `SUPERUSER_PASSWORD` sont générés automatiquement** et stockés
  dans Secret Manager.
- **Les contrôles d'état utilisent `/login/`, et non `/api/status/`.** La page de
  connexion est publique et non authentifiée ; l'API de statut nécessite une
  authentification et ferait échouer chaque sonde.
- **`service_type = "LoadBalancer"` et `reserve_static_ip = true` sont les valeurs
  par défaut** — public par défaut. Passez à `service_type = "ClusterIP"` et
  `reserve_static_ip = false` pour un déploiement interne uniquement, accessible via
  `kubectl port-forward` (utile lorsque le quota d'IP statiques du projet est serré).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail NetBox {#a-gke-autopilot--the-netbox-workload}

Les pods NetBox sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les
pods demandent effectivement. Le Horizontal Pod Autoscaling dimensionne le
déploiement entre les nombres minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  NetBox pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

NetBox stocke toutes les données d'inventaire et d'IPAM (équipements, baies,
adresses IP, préfixes, VLAN, circuits, utilisateurs) dans une instance gérée Cloud
SQL for PostgreSQL 15. Les pods s'y connectent de manière privée via le sidecar
**Cloud SQL Auth Proxy** sur un socket Unix (exposé au conteneur en tant que boucle
locale `127.0.0.1`) ; aucune IP publique n'est exposée. Au premier déploiement, un
Job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les
[sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et
la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage (stockage des médias GCS Fuse) {#c-cloud-storage-gcs-fuse-media-store}

Un bucket `media` dédié est provisionné automatiquement et monté via le pilote CSI
GCS Fuse sur `/etc/netbox/media` — le véritable `MEDIA_ROOT` de NetBox — pour les
images d'équipements/de baies téléversées et les pièces jointes. Le montage est fixé
à `uid=0`/`gid=0` pour correspondre à l'utilisateur root du conteneur ; sans cela, la
propriété par défaut du montage du pilote CSI de GKE bloque les écritures.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Verify a real upload landed in GCS (not just the pod's local filesystem):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /etc/netbox/media
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et le réglage des montages
GCS Fuse.

### D. Redis (file de tâches et cache) {#d-redis-task-queue-and-cache}

Redis est **obligatoire** (`enable_redis = true` par défaut). Lorsque `redis_host`
est laissé vide et que `enable_nfs` vaut true, l'IP de la VM du serveur NFS est
utilisée comme point de terminaison Redis. NetBox répartit son usage entre deux bases
logiques — `REDIS_DATABASE=0` pour la file de tâches RQ, `REDIS_CACHE_DATABASE=1`
pour le cache.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> -n 0 llen rq:queue:default   # inspect the RQ default queue depth
  # Confirm the resolved Redis host injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `SECRET_KEY` (secret cryptographique Django utilisé pour les sessions, la
protection CSRF et les cookies signés) et `SUPERUSER_PASSWORD` (le mot de passe du
compte administrateur initial). Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret
Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe. Un domaine personnalisé avec un certificat géré par Google peut être activé,
et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.
Pour un déploiement interne uniquement (par exemple lorsque le quota d'IP statiques
est contraint), passez à `service_type = "ClusterIP"` et `reserve_static_ip = false`,
puis accédez au service avec `kubectl port-forward`.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  # Internal-only access:
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:8080
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques de
GKE et de Cloud SQL vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles (les tests de disponibilité nécessitent un
point de terminaison accessible publiquement).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application NetBox {#3-netbox-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via
  le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et
  l'utilisateur de l'application, puis accorde les privilèges. Le job peut être
  relancé sans risque.
- **Migrations de la base de données au démarrage.** `docker-entrypoint.sh true`
  exécute de manière synchrone la séquence de premier démarrage propre à NetBox à
  chaque démarrage du conteneur — attente de la disponibilité de la base,
  `migrate --no-input`, nettoyage des contenttypes obsolètes, nettoyage des sessions
  et réindexation paresseuse de l'index de recherche — avant le démarrage du serveur
  web et du worker RQ.
- **L'amorçage du superutilisateur est idempotent.** Le compte administrateur
  initial est créé à partir des variables d'environnement `SUPERUSER_*` au premier
  démarrage ; la création est ignorée — sans erreur — si un utilisateur portant ce
  nom existe déjà.
- **Les téléversements de médias sont persistés dans le véritable `MEDIA_ROOT` — et
  c'est là que `kubectl
  exec` a prouvé son utilité.** Le `MEDIA_ROOT` réel de NetBox est
  `/etc/netbox/media` (confirmé via `manage.py shell` sur un pod en production), et
  c'est là qu'est monté le volume GCS Fuse `media`. Avant que ce problème ne soit
  tracé, les téléversements semblaient fonctionner sur les deux plateformes — un
  `201`, et le fichier était même relisible immédiatement via l'application — mais
  `gcloud storage ls` sur le bucket sous-jacent affichait **zéro objet**, même plus
  de 50 minutes après le téléversement. Un test de contrôle a écarté la latence
  d'écriture de gcsfuse et la contention entre plusieurs workers. C'est l'obtention
  d'un véritable accès shell dans le pod en cours d'exécution (`kubectl exec ... manage.py shell`
  pour afficher le paramètre `MEDIA_ROOT` résolu par NetBox lui-même) qui a
  réellement permis de résoudre le problème : le module montait le bucket GCS sur un
  chemin différent, plausible en apparence (`/opt/netbox/netbox/media`), de celui
  dans lequel le `configuration.py` de NetBox écrit réellement. Chaque téléversement
  atterrissait silencieusement sur le système de fichiers local éphémère du pod —
  relisible immédiatement car le lecteur et l'écrivain partageaient le même disque
  local, mais jamais durable, et perdu au redémarrage suivant. Corrigé en rectifiant
  le chemin de montage ; revérifié en conditions réelles avec `gcloud storage ls`
  affichant le fichier de test téléversé avec la bonne taille en octets, le bon type
  de contenu et un horodatage dans les 5 secondes. **Ce n'est pas une lacune de la
  plateforme Cloud Run/GKE** — le même bug existait sur les deux plateformes, et
  Cloud Run n'offre aucun accès shell permettant de le diagnostiquer comme le fait
  `kubectl exec` sur GKE ; si cela n'avait été testé que sur Cloud Run, cela aurait
  ressemblé exactement à une limitation de plateforme impossible à corriger.
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py shell \
    -c "from django.conf import settings; print(settings.MEDIA_ROOT)"
  ```
- **Le worker RQ traite les tâches d'arrière-plan.** Les webhooks, scripts
  personnalisés, rapports et jobs planifiés/système sont exécutés par `manage.py rqworker
  --with-scheduler`, colocalisé dans le même pod que le serveur web. Contrairement à
  Cloud Run, GKE maintient en permanence au moins `min_instance_count` pods en cours
  d'exécution (pas de mise à l'échelle jusqu'à zéro) ; le worker est donc toujours
  actif par défaut.
- **Chemin de contrôle d'état.** Les sondes de démarrage et de vivacité ciblent
  `/login/` — la page de connexion publique et non authentifiée de NetBox.
  `/api/status/` nécessite une authentification et ferait échouer chaque sonde.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à NetBox ou notables pour lui sont
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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `netbox` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `NetBox - Network Documentation & IPAM` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image de conteneur, transmis à l'ARG de build `APPLICATION_VERSION` du Dockerfile. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; partagé par le serveur web et le worker RQ. |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `container_port` | `8080` | Le serveur Granian (WSGI) de NetBox écoute sur le port 8080. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE n'a pas de mise à l'échelle jusqu'à zéro. |
| `max_instance_count` | `3` | Nombre maximal de réplicas. |
| `enable_vertical_pod_autoscaling` | `false` | Désactive le HPA lorsqu'il est activé, pour éviter les conflits. |
| `enable_pod_disruption_budget` / `pdb_min_available` | `false` / `1` | Protection de la disponibilité pendant la maintenance des nœuds. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `SECRET_KEY`, `SUPERUSER_PASSWORD` ni `DB_*` ici. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. Utilisez `ClusterIP` pour un accès interne uniquement. |
| `workload_type` | `Deployment` (auto) | `Deployment` (sans état, par défaut) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions de l'interface. |
| `network_tags` | `["nfsserver"]` | Obligatoire lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |
| `gke_cluster_name` / `namespace_name` | découverte automatique | Laissez vide pour une découverte / génération automatique. |
| `deployment_timeout` | `1800` | Nombre maximal de secondes pendant lesquelles Terraform attend le déploiement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC par pod. Non défini, la logique de résolution propre à `App_GKE` s'applique donc — l'état persistant de NetBox est Cloud SQL + GCS, aucun PVC n'est donc nécessaire. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | (valeurs par défaut) | Taille du PVC, chemin de montage, StorageClass. |
| `stateful_headless_service` | `null` | Noms DNS de pods stables. Non défini, la logique de résolution propre à `App_GKE` s'applique donc ; n'a de sens qu'avec un StatefulSet. |
| `stateful_pod_management_policy` | `null` (effectif : `OrderedReady`) | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` (effectif : `RollingUpdate`) | `RollingUpdate` ou `OnDelete`. |

### Groupe 8 — Scripts SQL personnalisés {#group-8--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un
bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 11 — Jobs et services {#group-11--jobs--services}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services Kubernetes supplémentaires déployés aux côtés de NetBox. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore ; utilisé comme hôte Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS supplémentaires en plus du bucket de médias provisionné automatiquement. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS Fuse CSI. Lorsqu'il est vide, un volume de médias par défaut est monté automatiquement sur `/etc/netbox/media` avec des options explicites `uid=0`/`gid=0` — déterminantes sur GKE, contrairement à Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Paramètres de l'application NetBox {#group-15--netbox-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `time_zone` | `UTC` | Fuseau horaire des horodatages et des tâches planifiées de NetBox. |
| `admin_user` | `admin` | Nom d'utilisateur du superutilisateur créé automatiquement. La création est idempotente. |
| `admin_email` | `admin@example.com` | Adresse e-mail du superutilisateur créé automatiquement. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `netbox` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `netbox` | Utilisateur de la base de données de l'application. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé / `90` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Sans objet — NetBox utilise PostgreSQL. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Routage Gateway API + certificat SSL géré pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. Définissez `false` (avec `service_type = "ClusterIP"`) pour un déploiement interne uniquement, sans IP externe. |
| `static_ip_name` | `""` | Laissez vide pour une génération automatique. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant NetBox. Nécessite `enable_custom_domain = true`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor et cache Redis {#group-21--cloud-armor--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |
| `enable_redis` | `true` | **Obligatoire.** Sert de support à la file de tâches RQ et à la couche de cache de NetBox. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

### Observabilité et état (propres à NetBox, remplaçant les sondes génériques d'App_GKE) {#observability--health-netbox-specific-superseding-the-generic-app_gke-probes}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/login/`, délai de 60s, seuil d'échec de 60 | Sonde de démarrage propre à NetBox. |
| `liveness_probe` | HTTP `/login/`, fenêtre d'échec de 30s | Sonde de vivacité propre à NetBox. |
| `uptime_check_config` | _(défini)_ | Test de disponibilité Cloud Monitoring facultatif — n'a de sens que lorsque le service est accessible publiquement. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un `redis_port`/`backup_retention_days` hors plage, des valeurs `quota_memory_*` données sous forme d'entiers nus. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Chemin de montage `gcs_volumes` (défini automatiquement sur `/etc/netbox/media`) | Ne jamais le remplacer par un autre chemin sans avoir confirmé le véritable `MEDIA_ROOT` de NetBox | Critique | Un mauvais chemin de montage laisse les téléversements sur le système de fichiers éphémère du pod — relisibles immédiatement, mais silencieusement perdus à chaque redémarrage. Confirmé et corrigé sur ce module précis. |
| `uid`/`gid` du montage GCS Fuse (définis automatiquement à `0`/`0`) | Faire correspondre à l'UID d'exécution réel du conteneur | Critique | Sur GKE (contrairement à Cloud Run), un montage non fixé appartient par défaut à root ; un processus non root obtiendrait `EACCES` à chaque écriture. Le conteneur de NetBox s'exécute déjà en root ; cette fixation est donc appliquée par précaution. |
| `SECRET_KEY` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critique | Invalide toutes les sessions actives et les cookies signés ; NetBox impose également une longueur minimale de 50 caractères. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf pour une restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `enable_redis` | `true` (obligatoire) | Critique | Le système de tâches d'arrière-plan et la couche de cache de NetBox ne fonctionnent pas sans Redis. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais NFS désactivé et qu'aucun hôte n'est défini, le traitement en arrière-plan ne s'exécute jamais, sans signalement. |
| `REDIS_DATABASE` / `REDIS_CACHE_DATABASE` | Les garder distincts (`0` / `1`) | Élevé | Partager une même base Redis logique risque de faire perdre des tâches d'arrière-plan en file lors d'un vidage du cache. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures à 1Gi risquent des arrêts pour OOM, surtout avec le worker RQ colocalisé dans le même pod. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; le maintenir à 1 garantit que NetBox et le worker RQ sont toujours disponibles. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est nécessaire pour la connectivité PostgreSQL. |
| `service_type` / `reserve_static_ip` | Public par défaut ; `ClusterIP`/`false` pour un accès interne uniquement | Moyen | Passer en interne uniquement échange l'accessibilité publique contre une moindre consommation du quota d'IP statiques — vérifiez ce qui est réellement nécessaire avant le déploiement. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions d'interface en cours peuvent être routées vers un autre pod en pleine requête. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme. |
| `enable_pod_disruption_budget` | `true` en production | Moyen | Désactivé par défaut ; sans lui, GKE peut évincer tous les pods simultanément pendant la maintenance des nœuds. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à NetBox partagée avec
la variante Cloud Run est décrite dans **[Netbox_Common](Netbox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NetBox sur GKE Autopilot](../labs/Netbox_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [NetBox sur Google Cloud Run](Netbox_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [NetBox Common — Configuration applicative partagée](Netbox_Common.md) — la configuration partagée par les deux cibles de déploiement.
