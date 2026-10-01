---
title: "Tandoor sur GKE Autopilot"
description: "Référence de configuration pour déployer Tandoor sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Tandoor_GKE.md @ 3055034 sha256:9ad263f47e3c -->

# Tandoor sur GKE Autopilot {#tandoor-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tandoor_GKE.png" alt="Tandoor sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tandoor Recipes est un gestionnaire de recettes et planificateur de repas auto-hébergé,
open source et sous licence AGPL-3.0, doté d'un backend d'API REST Python/Django et d'un
frontend Vue 3 intégré. Ce module déploie Tandoor sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Tandoor et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Tandoor s'exécute comme une charge de travail web unique tout-en-un — nginx s'exécute
*à l'intérieur* du conteneur et sert de proxy vers gunicorn via un socket Unix, de sorte
qu'aucun sidecar ni aucune entrée `additional_services` n'est nécessaire. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods à conteneur unique (nginx + gunicorn), 1 vCPU / 512Mi par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Tandoor n'a pas de moteur de repli pris en charge en production |
| Stockage d'objets | Cloud Storage | Un bucket `data` dédié provisionné automatiquement et monté sur `/opt/recipes/mediafiles` (pour les images des recettes) |
| Cache | Redis (optionnel) | Réellement optionnel — Django se rabat sur un cache en mémoire locale lorsqu'il n'est pas défini ; pas de Celery ni de worker d'arrière-plan |
| Secrets | Secret Manager | `SECRET_KEY` Django et mot de passe initial du superutilisateur générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `Tandoor_Common` fixe `database_type =
  "POSTGRES_15"` et `DB_ENGINE = django.db.backends.postgresql`. Le
  `boot.sh` de Tandoor interroge `pg_isready` avant de poursuivre — pas de connexion
  différée.
- **Des variables d'environnement Postgres distinctes, pas une DSN.** Tandoor lit
  directement `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_HOST` / `POSTGRES_PORT` /
  `POSTGRES_DB`. Les valeurs `DB_*` standard de la plateforme sont associées à ces noms
  via les variables du socle `db_*_env_var_name` — sur GKE, cela se résout en la
  boucle locale `127.0.0.1` du sidecar Cloud SQL Auth Proxy.
- **`SECRET_KEY` et le mot de passe du superutilisateur sont générés automatiquement** et
  stockés dans Secret Manager. `SECRET_KEY` ne doit jamais faire l'objet d'une rotation
  après le premier démarrage sans fenêtre de maintenance.
- **Aucun identifiant administrateur fixe ou codé en dur.** Contrairement à l'autre
  module de gestion de recettes de ce catalogue (Mealie), Tandoor dispose d'un job
  d'initialisation `create-superuser` qui crée un identifiant réel et unique à partir de
  Secret Manager à chaque déploiement.
- **`service_type = LoadBalancer` et une IP statique réservée par défaut.** Tandoor est
  une interface interactive pilotée depuis le navigateur ; il obtient donc une véritable
  IP externe — et non `ClusterIP` (qui ne convient qu'aux services uniquement internes).
- **NFS est désactivé par défaut.** Tandoor stocke toutes les données de l'application
  dans PostgreSQL et les images des recettes dans un bucket GCS monté automatiquement.
- **Redis est réellement optionnel et désactivé par défaut.** Il n'y a ni worker Celery
  ni file d'attente à maintenir actifs — activer Redis n'affecte que le backend de cache
  de Django.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Tandoor {#a-gke-autopilot--the-tandoor-workload}

Les pods Tandoor sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'Horizontal Pod Autoscaling dimensionne le déploiement
entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Tandoor
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Tandoor stocke toutes les données de l'application (recettes, plans de repas, listes de
courses, utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods
l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix. Au
premier déploiement, un Job d'initialisation crée la base de données et l'utilisateur de
l'application, et un second job crée le compte superutilisateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous indiqués dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `data` dédié est provisionné automatiquement pour les images
de recettes. Le compte de service de la charge de travail y reçoit l'accès, et le bucket
est monté par défaut sur `/opt/recipes/mediafiles` (le `MEDIA_ROOT` de Tandoor) via le
pilote CSI GCS Fuse, de sorte que les images téléversées persistent après les
redémarrages de pods.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut**. Tandoor n'a ni worker Celery ni file d'attente
d'arrière-plan — activer Redis ne fait que basculer le backend de cache de Django d'un
cache en mémoire locale vers une instance Redis partagée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm REDIS_HOST injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets applicatifs sont générés automatiquement et stockés dans Secret Manager : la
`SECRET_KEY` Django et `DJANGO_SUPERUSER_PASSWORD`. Le mot de passe de la base de données
est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=secret-<prefix>-tandoor-superuser-password --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe avec
une adresse statique réservée. Un domaine personnalisé avec un certificat géré par Google
peut être activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte optionnels sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Tandoor {#3-tandoor-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job
  d'initialisation `db-init` crée de manière idempotente la base de données et
  l'utilisateur de l'application, puis accorde les privilèges. Le job peut être relancé
  sans risque.
- **Création du superutilisateur.** Le job d'initialisation `create-superuser` dépend de
  `db-init`. Il applique les migrations Django (idempotentes — un filet de sécurité,
  puisque le `execute_on_apply` de GKE détermine seulement si Terraform *attend* le job,
  et non si le pod sous-jacent est planifié avant le tout premier démarrage du Deployment
  principal), puis exécute `python manage.py createsuperuser --noinput`, en lisant
  `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` /
  `DJANGO_SUPERUSER_PASSWORD` depuis l'environnement. Il vérifie d'abord l'existence d'un
  compte, de sorte que réappliquer le module ne provoque pas d'erreur.
- **Migrations à chaque démarrage.** Le `boot.sh` propre à Tandoor applique les
  migrations Django à chaque démarrage du conteneur (de manière idempotente).
- **`SECRET_KEY` est immuable après le premier démarrage.** Sa rotation invalide toutes
  les sessions actives et tous les jetons signés en cours de validité.
- **Chemin de santé.** La sonde de démarrage cible `/accounts/login/` — la vue de
  connexion publique et non authentifiée de Django. La sonde de liveness utilise plutôt
  un simple contrôle TCP (écoute du port), de sorte qu'un incident passager de la base de
  données ne fait pas osciller un pod déjà sain.
- **Connectez-vous avec l'identifiant généré.** Récupérez `DJANGO_SUPERUSER_PASSWORD`
  dans Secret Manager et connectez-vous sur `/accounts/login/` avec le `admin_username`
  configuré (par défaut `admin`).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Tandoor ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tandoor` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tandoor publie un véritable tag `latest`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Tandoor utilise directement l'image officielle. |
| `container_image` | `""` | Laissez vide pour la valeur par défaut du module (`vabene1111/recipes`). |
| `min_instance_count` | `0` | Nombre minimal de réplicas. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. |
| `container_port` | `80` | Le nginx de Tandoor écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Tandoor dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DB_ENGINE`, `ALLOWED_HOSTS`, `PGSSLMODE`, `DJANGO_SUPERUSER_USERNAME`/`EMAIL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Tandoor est une interface web interactive ; il est donc exposé à l'extérieur par défaut. |
| `workload_type` | `Deployment` | Sans état — aucun PVC nécessaire. |
| `session_affinity` | `None` | Aucune exigence de session persistante (contrairement aux applications fortement basées sur WebSocket). |
| `termination_grace_period_seconds` | `30` | Secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — Sauvegarde et maintenance / StatefulSet {#group-7--backup--maintenance--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production ou la conformité. |
| `stateful_pvc_enabled` | `null` | Inutile — Tandoor est sans état (toutes les données dans Postgres + GCS optionnel). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée une ResourceQuota Kubernetes dans l'espace de noms de l'application. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Total des requêtes/limites CPU autorisées pour l'ensemble des pods. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Doivent utiliser des suffixes d'unité binaire (p. ex. `4Gi`, `8192Mi`) — des entiers nus sont interprétés en octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité et SQL personnalisé {#group-9--reliability-policies--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_custom_sql_scripts` | `false` | Exécute du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/accounts/login/` | Réussit une fois la connectivité Postgres et les migrations établies. |
| `health_check_config` | TCP | Un simple contrôle d'écoute du port. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques optionnelles. |

### Groupe 11 — Stockage et jobs {#group-11--storage--jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la paire de jobs intégrés `db-init` + `create-superuser`. |
| `cron_jobs` | `[]` | Non utilisé — Tandoor n'a pas de tâches récurrentes planifiées par la plateforme. |
| `additional_services` | `[]` | Inutile — aucun sidecar ni routeur nginx n'est requis. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS supplémentaires en plus du bucket `data` provisionné automatiquement. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Laissez vide pour utiliser la valeur par défaut du module (le bucket `data` monté sur `/opt/recipes/mediafiles` via le pilote CSI) ; une valeur fournie par l'opérateur la remplace. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé par `Tandoor_Common` ; non transmis. |
| `application_database_name` | `tandoor` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `tandoor` | Utilisateur de base de données de l'application. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` | `POSTGRES_HOST` | Nom de la variable d'environnement de l'hôte Postgres de Tandoor. |
| `db_user_env_var_name` | `POSTGRES_USER` | Nom de la variable d'environnement de l'utilisateur Postgres de Tandoor. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Nom de la variable d'environnement du mot de passe Postgres de Tandoor. |
| `db_name_env_var_name` | `POSTGRES_DB` | Nom de la variable d'environnement de la base de données Postgres de Tandoor. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Nom de la variable d'environnement du port Postgres de Tandoor. |
| `admin_username` | `admin` | Nom d'utilisateur du superutilisateur initial. |
| `admin_email` | `admin@techequity.cloud` | E-mail du superutilisateur initial. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Import de sauvegarde {#group-17--backup-import}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre — recommandé pour toute application exposée sur le web. |

### Groupe 21 — Redis et Cloud Armor {#group-21--redis--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une politique Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Tandoor. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `create-superuser`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et
> leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant toute création de ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY` (générée automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation invalide toutes les sessions actives et tous les jetons signés (p. ex. les liens de réinitialisation de mot de passe) en cours de validité. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer le job d'import. |
| Chemin de `startup_probe_config` | `/accounts/login/` | Critical | Tandoor n'a pas d'autre point de terminaison de santé non authentifié ; pointer la sonde ailleurs renvoie 401/403 et le pod ne devient jamais Ready. |
| `service_type` | `LoadBalancer` | High | `ClusterIP` (le bug de copier-coller constaté sur l'ensemble du parc dans de nombreux modules antérieurs) rend une application web interactive injoignable depuis un navigateur. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est nécessaire à la connectivité PostgreSQL. |
| `DJANGO_SUPERUSER_PASSWORD` (généré automatiquement) | À récupérer dans Secret Manager avant la première connexion | Medium | Sans le récupérer, vous ne pouvez pas vous connecter — il n'existe aucun identifiant de repli comme la valeur fixe par défaut de Mealie. |
| `db_ssl_mode` (`PGSSLMODE`, défini en interne) | `prefer` sur GKE | Low | La boucle locale du sidecar Cloud SQL Auth Proxy est déjà en clair ; la couche Common de ce module définit correctement la valeur par défaut, de sorte que cela ne devrait nécessiter aucune intervention manuelle. |
| `enable_pod_disruption_budget` | `true` | Medium | La désactivation permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP du LoadBalancer peut changer lors d'un redéploiement, ce qui casse les URL enregistrées en favoris. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Tandoor, partagée avec
la variante Cloud Run, est décrite dans **[Tandoor_Common](Tandoor_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Tandoor sur GKE Autopilot](../labs/Tandoor_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Tandoor sur Google Cloud Run](Tandoor_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Tandoor Common — Configuration applicative partagée](Tandoor_Common.md) — la configuration partagée par les deux cibles de déploiement.
