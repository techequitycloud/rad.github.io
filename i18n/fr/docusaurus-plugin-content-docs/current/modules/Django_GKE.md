---
title: "Django sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Django sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Django_GKE.md @ 15fd4c7 sha256:4461646567f7 -->

# Django sur GKE Autopilot {#django-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Django_GKE.png" alt="Django sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Django est un framework web Python éprouvé qui encourage le développement rapide et
une conception propre et pragmatique, alimentant certaines des applications web les plus exigeantes au monde.
Ce module déploie Django sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud
et Kubernetes partagée.

Ce guide se concentre sur les services cloud que Django utilise et sur la façon de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à chaque application GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Django s'exécute comme une charge de travail web Python/Gunicorn. Le déploiement relie un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Gunicorn, 1 vCPU / 512 Mio par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le `DB_ENGINE` de Django est fixé à `django.db.backends.postgresql` |
| Fichiers partagés | Filestore (NFS) | Médias et téléchargements partagés entre toutes les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket média dédié provisionné par Django_Common |
| Secrets | Secret Manager | `SECRET_KEY` Django auto-généré et mot de passe de la base de données |
| Cache (optionnel) | Redis / Cloud Memorystore | Désactivé par défaut ; activer pour le stockage de session et la mise en cache |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est fixe.** `Django_Common` fixe `DB_ENGINE` à PostgreSQL ;
  MySQL et `NONE` ne sont pas pris en charge par ce module.
- **Le `SECRET_KEY` de Django est auto-généré** et stocké dans Secret Manager ;
  il est injecté au moment de l'exécution et jamais défini en texte clair.
- **Quatre extensions PostgreSQL sont installées automatiquement** (`pg_trgm`, `unaccent`,
  `hstore`, `citext`) par le job `db-init`, vous n'avez donc pas besoin de les configurer.
- **Deux jobs d'initialisation s'exécutent par défaut** — `db-init` (crée la base de données et
  l'utilisateur) et `db-migrate` (exécute `manage.py migrate` et `collectstatic`).
- **NFS est activé par défaut.** Toutes les réplicas de pods partagent le même volume Filestore
  pour les fichiers média téléchargés. L'affinité de session est par défaut `ClientIP`.
- **Redis est désactivé par défaut.** Activez-le avec `enable_redis = true` et pointez vers une
  instance Cloud Memorystore pour le stockage de session et la mise en cache en production.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count` est par défaut `0` ; définissez-le à `1`
  pour la production afin d'éliminer les démarrages à froid.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Django {#a-gke-autopilot--the-django-workload}

Les pods Django sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le
nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Django pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Django stocke toutes les données de l'application dans une instance gérée Cloud SQL pour PostgreSQL 15.
Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** via un socket Unix,
de sorte qu'aucune IP publique n'est exposée. Un job `db-init` s'exécute à chaque apply (idempotent)
et crée la base de données et l'utilisateur de l'application, installe les extensions requises et
accorde les privilèges. Le job `db-migrate` exécute ensuite `manage.py migrate` et
`manage.py collectstatic`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et
  les métriques.
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
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléchargés sont écrits sur un partage **Filestore (NFS)** monté dans chaque pod afin
que toutes les réplicas voient les mêmes fichiers. Un bucket média **Cloud Storage** dédié est également
provisionné automatiquement par `Django_Common` ; le compte de service de la charge de travail est autorisé
à y accéder.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket média.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, Django reçoit
`REDIS_HOST` et `REDIS_PORT` comme variables d'environnement. Configurez `settings.py` pour
les utiliser pour `CACHES` et `SESSION_ENGINE`. Le module ne provisionne pas d'instance Redis —
utilisez une instance Cloud Memorystore et définissez `redis_host` sur son IP privée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_HOST and REDIS_PORT are injected:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Le `SECRET_KEY` de Django et le mot de passe de la base de données sont stockés comme secrets Secret Manager
et injectés dans les pods au moment de l'exécution ; le texte clair n'apparaît jamais dans la configuration.
Le mot de passe du superutilisateur (si vous en créez un via `DJANGO_SUPERUSER_PASSWORD`) doit
également être stocké ici.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé via
`enable_custom_domain`, et une IP statique peut être réservée afin que l'adresse survive
aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Django {#3-django-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` crée la base de données
  et l'utilisateur PostgreSQL, accorde les privilèges et installe les quatre extensions requises (`pg_trgm`,
  `unaccent`, `hstore`, `citext`) en utilisant le secret superutilisateur `ROOT_PASSWORD`. Le job
  est idempotent et peut être réexécuté en toute sécurité.
- **Migrations au premier déploiement.** Un job `db-migrate` exécute `manage.py migrate` et
  `manage.py collectstatic --noinput --clear` après que `db-init` soit terminé. Ces jobs
  s'exécutent avec `execute_on_apply = true` par défaut. Remplacez `initialization_jobs` par
  une liste non vide pour les remplacer par des jobs personnalisés.
- **Gestion de `SECRET_KEY`.** Une clé aléatoire de 50 caractères est générée par
  `Django_Common` et stockée dans Secret Manager. Elle est injectée comme `SECRET_KEY`.
  Ne définissez pas `SECRET_KEY` dans `environment_variables`.
- **Création de superutilisateur.** Si `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`,
  et `DJANGO_SUPERUSER_PASSWORD` sont présents comme variables d'environnement lorsque le
  conteneur démarre, `entrypoint.sh` crée un superutilisateur Django au premier démarrage. Utilisez
  `secret_environment_variables` pour le mot de passe :
  ```bash
  # Retrieve the SECRET_KEY or superuser password from Secret Manager
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```
- **Tâches planifiées.** Les commandes de gestion Django (par exemple, `clearsessions`) peuvent être
  planifiées comme CronJobs Kubernetes via la variable `cron_jobs` :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Sondes de santé.** La sonde de démarrage par défaut cible `GET /healthz` avec un
  délai initial de 90 secondes (pour permettre les migrations au premier démarrage) et la sonde de vivacité
  cible `GET /healthz` avec un délai initial de 60 secondes. `/healthz` est défini dans le
  fichier `urls.py` au niveau du projet, il continue donc de renvoyer HTTP 200 après avoir remplacé l'exemple
  d'application à `/` — ce qui est important car la sonde est mise en miroir dans la vérification de santé de la passerelle,
  et une vue racine qui redirige vers une connexion laisserait autrement la passerelle servir 503 derrière un pod prêt.
  Conservez cette route si vous restructurez `urls.py`.
- **Affinité de session.** Par défaut à `ClientIP` afin que les requêtes d'un utilisateur donné soient
  acheminées vers le même pod. Définissez `session_affinity = "None"` lorsque tout l'état de session est
  externalisé vers la base de données ou Redis.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les
paramètres spécifiques ou notables pour Django sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `django` | Nom de base pour les ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `Django Application` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image ; incrémenter pour déployer une nouvelle build. Épingler à un tag spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit via Cloud Build ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | Remplace l'URI de l'image du conteneur. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire par pod. |
| `min_instance_count` | `0` | Réplicas minimum. Définissez ≥ 1 pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `1` | Réplicas maximum (plafond de l'autoscaler). |
| `container_port` | `8080` | Django/Gunicorn écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. N'incluez pas `SECRET_KEY` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (par exemple, `DJANGO_SUPERUSER_PASSWORD`). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant recommandé pour le stockage de session en cours de traitement. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled` est défini. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC dans un StatefulSet. Normalement pas nécessaire pour Django. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage pour chaque PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limite les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau de nœuds. Désactivé par défaut car le `max_instance_count` par défaut est 1. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartit les pods sur les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /healthz`, délai initial de 90s | Sonde de démarrage passée à `Django_Common`. Augmentez le délai pour les grands ensembles de migration. |
| `liveness_probe` | HTTP `GET /healthz`, délai initial de 60s | Sonde de vivacité passée à `Django_Common`. |
| `startup_probe_config` | TCP, délai d'attente de 240s | Sonde de démarrage de l'infrastructure au niveau App_GKE. |
| `health_check_config` | HTTP `GET /`, délai d'attente de 1s | Sonde de vivacité de l'infrastructure au niveau App_GKE. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité Cloud Monitoring optionnelle ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` (utilise `db-init` + `db-migrate` intégrés) | Laissez vide pour utiliser la configuration de base de données par défaut et les jobs de migration. Fournissez une liste non vide pour les remplacer par des jobs personnalisés. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, `clearsessions`, `cleartokens`). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés avec Django. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Django (garder activé pour les réplicas multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. Doit correspondre à `MEDIA_ROOT` dans `settings.py`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données supplémentaire. Le bucket média est toujours provisionné par `Django_Common`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket média auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneurs récentes conservées dans Artifact Registry par déploiement. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images non taguées/orphelines du dépôt créé en ligne. |
| `image_retention_days` | `30` | Jours après lesquels les images deviennent éligibles à la suppression ; `0` désactive la suppression basée sur l'âge. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour le stockage de session et la mise en cache. |
| `redis_host` | `""` | IP ou nom d'hôte de l'hôte Redis. Laissez vide pour revenir à l'IP du serveur NFS lorsqu'il est activé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | **PostgreSQL requis.** Django ne prend pas en charge MySQL via ce module. |
| `application_database_name` | `gkeapp` | Nom de la base de données. **Recommandé : définissez à `django_db`.** Immuable après le premier déploiement. |
| `application_database_user` | `gkeapp` | Utilisateur de l'application. **Recommandé : définissez à `django_user`.** Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_postgres_extensions` | `false` | Définissez `true` uniquement pour installer des extensions **supplémentaires** au-delà de `pg_trgm`, `unaccent`, `hstore` et `citext` (qui sont toujours installées). |
| `postgres_extensions` | `[]` | Extensions PostgreSQL supplémentaires (par exemple, `postgis`, `uuid-ossp`). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. Définissez `enable_backup_import = false` après une importation réussie. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécute du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige la connexion Google devant Django. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services de la phase Cloud Deploy. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Django. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnels). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journaux d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` ou `POSTGRES_15` | Critique | Django nécessite PostgreSQL ; MySQL ou `NONE` feront échouer le job `db-init`. |
| `application_name` / `tenant_id` | défini une fois | Critique | Intégré dans les noms de ressources ; la modification recrée toutes les ressources nommées et détruit les données. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod. |
| `startup_probe` `failure_threshold` | ≥ 30 avec migrations | Critique | Trop faible : Kubernetes tue le pod avant la fin des migrations, provoquant une boucle de redémarrage. |
| `cloudsql_volume_mount_path` | `/cloudsql` (par défaut) | Critique | Mauvais chemin : `db-init.sh` ne peut pas trouver le socket du proxy d'authentification ; toutes les opérations de base de données échouent. |
| `enable_backup_import` | `false` après restauration | Élevé | Laisser `true` réexécute l'importation à chaque apply, écrasant les données en direct avec une sauvegarde obsolète. |
| `enable_nfs` | `true` (par défaut) | Élevé | La désactivation avec `max_instance_count > 1` signifie que chaque pod a un stockage éphémère isolé ; les téléchargements sont perdus au redémarrage. |
| `nfs_mount_path` | `/mnt/nfs` — doit correspondre à `MEDIA_ROOT` | Élevé | Une non-concordance entraîne l'écriture des médias par Django dans un stockage local éphémère ; les fichiers sont perdus au redémarrage du pod. |
| `container_resources` mémoire | ≥ `512Mi` ; augmenter pour les charges de travail intensives en ORM | Élevé | Trop peu de mémoire : le pod est OOMKilled (code de sortie 137) sur de grands ensembles de requêtes ou le traitement de fichiers. |
| `min_instance_count` | `1` pour la production | Moyen | `0` provoque des démarrages à froid (>60 s) à la première requête après l'inactivité ; les tâches planifiées peuvent ne pas trouver de pod. |
| `application_version` | tag épinglé, pas `latest` | Moyen | `latest` rend le retour arrière ambigu ; Kubernetes ne peut pas distinguer deux pulls `latest`. |
| `enable_redis` | `true` lors de l'utilisation de sessions basées sur Redis | Moyen | Laissé `false` avec `settings.py` configuré pour Redis : `ConnectionRefusedError` à chaque accès au cache/à la session. |
| `session_affinity` | `ClientIP` pour les sessions basées sur la base de données | Moyen | `None` avec mise en cache en cours de processus : les requêtes du même utilisateur peuvent atteindre différents pods, perdant le cache. |
| `enable_pod_disruption_budget` | `false` lorsque `max_instance_count = 1` | Élevé | `true` avec une seule réplica bloque les vidanges de nœuds et bloque la maintenance du cluster. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | L'interface d'administration de Django est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Django partagée avec la
variante Cloud Run est décrite dans **[Django_Common](Django_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Django sur GKE Autopilot](../labs/Django_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Django sur Cloud Run](Django_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [Django Common — Configuration d'application partagée](Django_Common.md) — la configuration partagée par les deux cibles de déploiement.
