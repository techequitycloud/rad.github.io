---
title: "Django sur GKE Autopilot"
description: "Référence de configuration pour déployer Django sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Django_GKE.md @ 3055034 sha256:95e0720c903d -->

# Django sur GKE Autopilot {#django-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Django_GKE.png" alt="Django sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Django est un framework web Python éprouvé qui favorise un développement rapide et
une conception propre et pragmatique, et qui fait fonctionner certaines des applications web les plus exigeantes au monde.
Ce module déploie Django sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud
et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Django et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée (ingress), autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie
du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Django s'exécute comme une charge de travail web Python/Gunicorn. Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Gunicorn, 1 vCPU / 512 MiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le `DB_ENGINE` de Django est fixé à `django.db.backends.postgresql` |
| Fichiers partagés | Filestore (NFS) | Médias et téléversements partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket de médias dédié provisionné par Django_Common |
| Secrets | Secret Manager | `SECRET_KEY` Django et mot de passe de la base de données générés automatiquement |
| Cache (facultatif) | Redis / Cloud Memorystore | Désactivé par défaut ; à activer pour le stockage des sessions et la mise en cache |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est imposé.** `Django_Common` fixe `DB_ENGINE` sur PostgreSQL ;
  MySQL et `NONE` ne sont pas pris en charge par ce module.
- **La `SECRET_KEY` Django est générée automatiquement** et stockée dans Secret Manager ;
  elle est injectée à l'exécution et n'est jamais définie en clair.
- **Quatre extensions PostgreSQL sont installées automatiquement** (`pg_trgm`, `unaccent`,
  `hstore`, `citext`) par le job `db-init`, vous n'avez donc pas à les configurer.
- **Deux jobs d'initialisation s'exécutent par défaut** — `db-init` (crée la base de données et
  l'utilisateur) et `db-migrate` (exécute `manage.py migrate` et `collectstatic`).
- **NFS est activé par défaut.** Tous les réplicas de pods partagent le même volume Filestore
  pour les fichiers médias téléversés. L'affinité de session vaut par défaut `ClientIP`.
- **Redis est désactivé par défaut.** Activez-le avec `enable_redis = true` et pointez-le vers une
  instance Cloud Memorystore pour le stockage des sessions et la mise en cache en production.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count` vaut `0` par défaut ; définissez-le à `1`
  en production pour éliminer les démarrages à froid.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Django {#a-gke-autopilot--the-django-workload}

Les pods Django sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods. L'autoscaling horizontal des pods dimensionne le Deployment entre le
nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Django pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à l'échelle et le type de charge
de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Django stocke toutes les données applicatives dans une instance gérée Cloud SQL for PostgreSQL 15.
Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** par un socket
Unix, de sorte qu'aucune IP publique n'est exposée. Un job `db-init` s'exécute à chaque apply (idempotent)
et crée la base de données applicative et l'utilisateur, installe les extensions requises et
accorde les privilèges. Le job `db-migrate` exécute ensuite `manage.py migrate` et
`manage.py collectstatic`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les
  métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # Confirm DB env vars are injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^(DB_|SECRET_KEY)"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous exposés dans les [sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléversés sont écrits sur un partage **Filestore (NFS)** monté dans chaque pod, afin que
tous les réplicas voient les mêmes fichiers. Un bucket de médias **Cloud Storage** dédié est également
provisionné automatiquement par `Django_Common` ; le compte de service de la charge de travail y reçoit
l'accès.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket de médias.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, Django reçoit
`REDIS_HOST` et `REDIS_PORT` comme variables d'environnement. Configurez `settings.py` pour
les utiliser dans `CACHES` et `SESSION_ENGINE`. Le module ne provisionne pas d'instance
Redis — utilisez une instance Cloud Memorystore et définissez `redis_host` sur son IP privée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_HOST and REDIS_PORT are injected:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

La `SECRET_KEY` Django et le mot de passe de la base de données sont stockés sous forme de secrets
Secret Manager et injectés dans les pods à l'exécution ; aucune valeur en clair n'apparaît dans la configuration.
Le mot de passe du superutilisateur (si vous en créez un via `DJANGO_SUPERUSER_PASSWORD`) doit
également être stocké ici.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé via
`enable_custom_domain`, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des tests de disponibilité (uptime checks) et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Django {#3-django-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` crée la base de données PostgreSQL
  et l'utilisateur, accorde les privilèges et installe les quatre extensions requises (`pg_trgm`,
  `unaccent`, `hstore`, `citext`) à l'aide du secret de superutilisateur `ROOT_PASSWORD`. Le job
  est idempotent et peut être réexécuté sans risque.
- **Migrations au premier déploiement.** Un job `db-migrate` exécute `manage.py migrate` et
  `manage.py collectstatic --noinput --clear` une fois `db-init` terminé. Ces jobs
  s'exécutent par défaut avec `execute_on_apply = true`. Remplacez `initialization_jobs` par
  une liste non vide pour les remplacer par des jobs personnalisés.
- **Gestion de `SECRET_KEY`.** Une clé aléatoire de 50 caractères est générée par
  `Django_Common` et stockée dans Secret Manager. Elle est injectée sous le nom `SECRET_KEY`.
  Ne définissez pas `SECRET_KEY` dans `environment_variables`.
- **Création du superutilisateur.** Si `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`
  et `DJANGO_SUPERUSER_PASSWORD` sont présents comme variables d'environnement au démarrage du
  conteneur, `entrypoint.sh` crée un superutilisateur Django au premier démarrage. Utilisez
  `secret_environment_variables` pour le mot de passe :
  ```bash
  # Retrieve the SECRET_KEY or superuser password from Secret Manager
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```
- **Tâches planifiées.** Les commandes de gestion Django (par ex. `clearsessions`) peuvent être
  planifiées sous forme de CronJobs Kubernetes via la variable `cron_jobs` :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Sondes de santé.** La sonde de démarrage par défaut cible `GET /` avec un délai initial de
  90 secondes (pour laisser le temps aux migrations du premier démarrage) et la sonde de vivacité cible
  `GET /` avec un délai initial de 60 secondes. Implémentez une vue `/healthz/` légère
  qui renvoie un HTTP 200 et définissez `path = "/healthz/"` dans les deux variables de sonde pour
  un signal de santé plus fiable.
- **Affinité de session.** Vaut par défaut `ClientIP` afin que les requêtes d'un même utilisateur soient
  acheminées vers le même pod. Définissez `session_affinity = "None"` lorsque tout l'état des sessions est
  externalisé dans la base de données ou dans Redis.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Django ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails bénéficiant de l'accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `django` | Nom de base des ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `Django Application` | Nom convivial affiché dans la console. |
| `application_description` | _(set)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image ; incrémentez-le pour déployer un nouveau build. Épinglez un tag précis en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | URI d'image de conteneur de remplacement. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire par pod. |
| `min_instance_count` | `0` | Nombre minimal de réplicas. Définissez ≥ 1 pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `1` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8080` | Django/Gunicorn écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. N'y incluez pas `SECRET_KEY` ni `DB_*`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par ex. `DJANGO_SUPERUSER_PASSWORD`). |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant (sticky) recommandé pour le stockage des sessions en processus. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled` est défini. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles de PVC dans un StatefulSet. Normalement inutile pour Django. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protéger la disponibilité lors des mises à niveau des nœuds. Désactivé par défaut car la valeur par défaut de `max_instance_count` est 1. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartir les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, 90s initial delay | Sonde de démarrage transmise à `Django_Common`. Augmentez le délai pour les ensembles de migrations volumineux. |
| `liveness_probe` | HTTP `GET /`, 60s initial delay | Sonde de vivacité transmise à `Django_Common`. Utilisez un point de terminaison `/healthz/` léger. |
| `startup_probe_config` | TCP, 240s timeout | Sonde de démarrage d'infrastructure au niveau d'App_GKE. |
| `health_check_config` | HTTP `GET /`, 1s timeout | Sonde de vivacité d'infrastructure au niveau d'App_GKE. |
| `uptime_check_config` | disabled, path `/` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` (uses built-in `db-init` + `db-migrate`) | Laissez vide pour utiliser les jobs par défaut de configuration de la base de données et de migration. Fournissez une liste non vide pour les remplacer par des jobs personnalisés. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par ex. `clearsessions`, `cleartokens`). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés aux côtés de Django. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Django (à garder activé en multi-réplica). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. Doit correspondre à `MEDIA_ROOT` dans `settings.py`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de données supplémentaire. Le bucket de médias est toujours provisionné par `Django_Common`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket de médias provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneur récentes conservées dans Artifact Registry par déploiement. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images sans tag ou orphelines du dépôt créé en mode intégré (inline). |
| `image_retention_days` | `30` | Nombre de jours au-delà duquel les images deviennent éligibles à la suppression ; `0` désactive la suppression fondée sur l'âge. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage des sessions et la mise en cache. |
| `redis_host` | `""` | IP ou nom d'hôte Redis. Laissez vide pour revenir à l'IP du serveur NFS lorsque Redis est activé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | **PostgreSQL obligatoire.** Django ne prend pas en charge MySQL via ce module. |
| `application_database_name` | `gkeapp` | Nom de la base de données. **Recommandé : définir `django_db`.** Immuable après le premier déploiement. |
| `application_database_user` | `gkeapp` | Utilisateur applicatif. **Recommandé : définir `django_user`.** Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_postgres_extensions` | `false` | Définissez `true` uniquement pour installer des extensions **supplémentaires** en plus de `pg_trgm`, `unaccent`, `hstore` et `citext` (qui sont toujours installées). |
| `postgres_extensions` | `[]` | Extensions PostgreSQL supplémentaires (par ex. `postgis`, `uuid-ossp`). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définissez `enable_backup_import = false` après un import réussi. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Django. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP pour les services des étapes Cloud Deploy. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Django. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` ou `POSTGRES_15` | Critical | Django exige PostgreSQL ; MySQL ou `NONE` fera échouer le job `db-init`. |
| `application_name` / `tenant_id` | définis une seule fois | Critical | Intégrés aux noms des ressources ; les modifier recrée toutes les ressources nommées et détruit les données. |
| `application_database_name` / `_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critical | Les entiers nus sont des octets et bloquent la planification de tous les pods. |
| `failure_threshold` de `startup_probe` | ≥ 30 avec des migrations | Critical | Trop bas : Kubernetes tue le pod avant la fin des migrations, ce qui provoque une boucle de redémarrage. |
| `cloudsql_volume_mount_path` | `/cloudsql` (par défaut) | Critical | Chemin erroné : `db-init.sh` ne trouve pas le socket de l'Auth Proxy ; toutes les opérations sur la base de données échouent. |
| `enable_backup_import` | `false` après restauration | High | Le laisser à `true` relance l'import à chaque apply, écrasant les données en production par la sauvegarde obsolète. |
| `enable_nfs` | `true` (par défaut) | High | Le désactiver avec `max_instance_count > 1` signifie que chaque pod dispose d'un stockage éphémère isolé ; les téléversements sont perdus au redémarrage. |
| `nfs_mount_path` | `/mnt/nfs` — doit correspondre à `MEDIA_ROOT` | High | Une incohérence amène Django à écrire les médias sur un stockage local éphémère ; les fichiers sont perdus au redémarrage du pod. |
| Mémoire de `container_resources` | ≥ `512Mi` ; à augmenter pour les charges de travail intensives en ORM | High | Mémoire insuffisante : le pod est arrêté en OOMKilled (code de sortie 137) sur les querysets volumineux ou le traitement de fichiers. |
| `min_instance_count` | `1` en production | Medium | `0` provoque des démarrages à froid (> 60 s) sur la première requête après une période d'inactivité ; les tâches planifiées peuvent ne trouver aucun pod. |
| `application_version` | tag épinglé, pas `latest` | Medium | `latest` rend le retour arrière ambigu ; Kubernetes ne peut pas distinguer deux tirages de `latest`. |
| `enable_redis` | `true` en cas de sessions stockées dans Redis | Medium | Laissé à `false` avec un `settings.py` configuré pour Redis : `ConnectionRefusedError` à chaque accès au cache ou aux sessions. |
| `session_affinity` | `ClientIP` pour les sessions stockées en base de données | Medium | `None` avec une mise en cache en processus : les requêtes d'un même utilisateur peuvent atteindre des pods différents et perdre le cache. |
| `enable_pod_disruption_budget` | `false` lorsque `max_instance_count = 1` | High | `true` avec un seul réplica bloque le drainage des nœuds et paralyse la maintenance du cluster. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les accès d'administration | Medium | Sinon, l'interface d'administration Django est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Django, partagée avec la
variante Cloud Run, est décrite dans **[Django_Common](Django_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Django sur GKE Autopilot](../labs/Django_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Django sur Cloud Run](Django_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Django Common — Configuration applicative partagée](Django_Common.md) — la configuration partagée par les deux cibles de déploiement.
