---
title: "Dify sur GKE Autopilot"
description: "Référence de configuration pour déployer Dify sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Dify_GKE.md @ 3055034 sha256:a26cdfc00c4a -->

# Dify sur GKE Autopilot {#dify-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dify_GKE.png" alt="Dify sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dify est une plateforme open source de développement d'applications LLM permettant de créer des
applications d'IA de niveau production, avec un éditeur visuel de workflows, un pipeline RAG, un
framework d'agents, une gestion multi-modèles et une observabilité intégrée. Ce module déploie Dify
sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Dify et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs
à toutes les applications GKE — Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Dify s'exécute sous la forme d'un conteneur d'API Python/Flask (avec un worker Celery intégré sous
supervisord), accompagné d'un frontal web Next.js distinct. Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod API+worker (2 vCPU / 4 GiB par défaut) + pod frontal web, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — extension pgvector activée pour le stockage vectoriel |
| Base vectorielle | pgvector (dans la base de données) | Réutilise l'instance Cloud SQL ; aucune base vectorielle distincte n'est nécessaire |
| Fichiers partagés | Filestore (NFS) | Co-localisation de l'hôte Redis partagé ; la VM NFS sert aussi à l'état des tâches |
| Stockage d'objets | Cloud Storage | Un bucket `gcs-dify<resource-prefix>-storage` dédié pour les fichiers et ressources téléversés |
| Cache et file de tâches | Redis | Requis pour le broker/backend Celery et le streaming LLM SSE/WebSocket |
| Secrets | Secret Manager | SECRET_KEY et mot de passe de la base de données générés automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** MySQL et `NONE` ne sont pas pris en charge ; Dify a besoin de
  PostgreSQL pour toutes les métadonnées, l'état des workflows et les comptes utilisateur.
- **pgvector est toujours activé.** L'extension `vector` est installée automatiquement sur
  l'instance Cloud SQL, ce qui fait de cette même instance la base vectorielle — aucun service
  supplémentaire n'est requis.
- **Redis est obligatoire.** Celery (exécution des workflows, indexation des documents, appels LLM
  asynchrones) et le bus d'événements SSE/WebSocket dépendent tous deux de Redis. Le désactiver
  interrompt tout le traitement en arrière-plan.
- **NFS est activé par défaut.** La VM du serveur NFS héberge le processus Redis lorsqu'aucun hôte
  Redis externe n'est défini.
- **Un frontal web est déployé automatiquement.** Un Deployment `langgenius/dify-web` est relié à
  l'URL du service d'API — vous n'avez pas besoin de le configurer séparément.
- **SECRET_KEY est généré automatiquement** et stocké dans Secret Manager ; il signe les sessions
  Dify et ne doit jamais être modifié après le premier déploiement.
- **Les migrations de base de données s'exécutent à chaque démarrage de pod** (via
  `MIGRATION_ENABLED=true`), de sorte que les mises à niveau de version appliquent automatiquement
  les changements de schéma.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Dify {#a-gke-autopilot--the-dify-workload}

Dify exécute deux Deployments Autopilot : le pod API+worker (Flask/gunicorn + Celery via
supervisord) et le frontal web (Next.js). L'autoscaling horizontal des pods (HPA) dimensionne
chaque Deployment entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail API ou
  web de Dify pour consulter les pods, les événements et l'utilisation des ressources. Kubernetes
  Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Dify stocke toutes les données applicatives (workflows, bases de connaissances, comptes
utilisateur, clés API) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods s'y
connectent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix — aucune
adresse IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la
base de données et l'utilisateur de l'application. L'extension `pgvector` est installée
automatiquement afin que la même instance serve de base vectorielle.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatiques et la rotation du mot de passe, consultez
[App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Un partage **Filestore (NFS)** est monté dans chaque pod. La VM du serveur NFS exécute également le
processus Redis utilisé comme broker Celery lorsqu'aucun hôte Redis externe n'est configuré. Un
bucket **Cloud Storage** dédié (`gcs-dify<resource-prefix>-storage`) est provisionné pour les
fichiers et ressources téléversés ; le pilote `google-storage` de Dify y accède via Workload
Identity — aucun fichier de clé de compte de service n'est nécessaire.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<dify-storage-bucket>/
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Redis — Celery et bus d'événements {#d-redis--celery-and-event-bus}

Redis est requis pour trois fonctions dans Dify :

| Rôle | Base Redis | Objet |
|---|---|---|
| Broker et backend Celery | db 1 | Met en file d'attente et suit toutes les tâches d'arrière-plan (inférence LLM, indexation des documents) |
| Bus d'événements | db 0 | Streaming SSE/WebSocket pour la sortie LLM en temps réel |
| Cache général | db 0 | Mise en cache applicative |

Lorsqu'aucun hôte Redis externe n'est configuré, l'adresse IP de la VM du serveur NFS est utilisée
comme point de terminaison Redis. En production, faites pointer `redis_host` vers une instance
Memorystore for Redis dédiée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le `SECRET_KEY` de Dify (utilisé pour la signature des JWT et le chiffrement des sessions) et le
mot de passe de la base de données sont stockés comme secrets Secret Manager et injectés dans les
pods à l'exécution ; les valeurs en clair n'apparaissent jamais dans les spécifications des pods.
Le `SECRET_KEY` est généré une seule fois et ne doit pas faire l'objet d'une rotation tant que le
déploiement est en cours d'exécution — tous les pods doivent partager la même valeur.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, le service Dify est exposé via une adresse IP externe Cloud Load Balancing. Un domaine
personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut
être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et
l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et Cloud
SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte sont
disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Dify {#3-dify-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation
  (`db-init`) se connecte à Cloud SQL via l'Auth Proxy et crée de manière idempotente
  l'utilisateur et la base de données Dify. Il s'exécute automatiquement et peut être relancé
  sans risque.
- **Migrations au démarrage.** Chaque pod exécute les migrations de base de données Flask-Migrate
  de Dify au démarrage (`MIGRATION_ENABLED=true`), de sorte que la mise à niveau de la version de
  l'application applique automatiquement les changements de schéma. Aucune tâche de migration
  distincte n'est nécessaire.
- **API + worker dans un seul pod.** Le conteneur personnalisé encapsule `langgenius/dify-api`
  avec supervisord. Le serveur d'API gunicorn et le worker Celery s'exécutent dans le même pod —
  ils partagent l'allocation de CPU et de mémoire. Dimensionnez en conséquence : 2 vCPU et 4 GiB
  constituent le minimum recommandé.
- **Frontal web.** Un Deployment `langgenius/dify-web` est déployé automatiquement et relié à
  l'URL du service d'API. Accédez à Dify via l'adresse IP externe du service web ou la sortie
  `web_url`.
- **Clés API des fournisseurs LLM.** Les clés des fournisseurs (OpenAI, Anthropic, etc.) se
  configurent par espace de travail via la console web de Dify et sont stockées dans la base de
  données de l'application. N'utilisez `secret_environment_variables` que pour la configuration au
  niveau de l'environnement qui ne peut pas être définie dans l'interface.
- **CORS.** `WEB_API_CORS_ALLOW_ORIGINS` et `CONSOLE_CORS_ALLOW_ORIGINS` valent `"*"` par défaut.
  En production, limitez-les à votre domaine via `environment_variables`.
- **Chemin de santé.** Les sondes de préparation (readiness) et de vivacité ciblent `/health` avec un délai
  initial de 30 secondes, afin de laisser au serveur d'API et aux migrations de base de données le
  temps de se terminer au premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Dify ou notables pour lui sont listés ; toutes les
autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par
défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dify` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Dify - LLM Application Platform` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `0.15.0` | Tag de version de l'image Dify ; s'applique aux conteneurs d'API et web. Fixez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU minimum — gunicorn et Celery se partagent cette allocation. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés pour la mise en cache des workflows LLM et le traitement des documents. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour que le worker Celery maintienne sa connexion au broker Redis. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `5001` | Le serveur d'API Dify écoute sur le port 5001. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. Requis pour la connectivité à la base de données. |
| `enable_vertical_pod_autoscaling` | `false` | Le VPA ajuste automatiquement les demandes de ressources ; l'activer désactive le HPA. |
| `enable_pod_disruption_budget` | `false` | Crée un PodDisruptionBudget pour garantir une disponibilité minimale pendant la maintenance des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. À utiliser pour remplacer `WEB_API_CORS_ALLOW_ORIGINS`, `LOG_LEVEL`, etc. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. À utiliser pour les clés API des fournisseurs LLM. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant — recommandé pour l'état de session de Dify. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |
| `gke_cluster_name` | `""` | Nom du cluster GKE. Laissez vide pour une découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement s'il est vide. |
| `termination_grace_period_seconds` | `60` | Nombre de secondes pendant lesquelles Kubernetes attend après SIGTERM avant un arrêt forcé. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active des PVC par pod. Définir `true` sélectionne automatiquement le type de charge de travail `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC par pod est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour le provisionnement des PVC. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/health`, délai de 30 s | Sonde de démarrage — le conteneur ne reçoit aucun trafic tant que `/health` ne renvoie pas 200. |
| `health_check_config` / `liveness_probe` | HTTP `/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init`. Fournissez une liste non vide pour la remplacer entièrement. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Deployments Kubernetes supplémentaires aux côtés de Dify (le frontal web est relié automatiquement). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé ; fournit aussi l'hôte Redis par défaut lorsqu'aucun Redis externe n'est défini. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour une découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM GCE NFS créée en mode intégré (inline) lorsqu'aucune n'existe. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS supplémentaires. Le bucket `gcs-dify<resource-prefix>-storage` est toujours provisionné par Dify_Common. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket de stockage provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `dify_db` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `dify_user` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement.
Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. **Ne définissez pas `false` pour Dify** — voir le piège critique au [§6](#6-configuration-pitfalls--sensible-defaults) : sans elle, les appels d'API du frontal web se résolvent vers un nom d'hôte interne injoignable. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Dify. Nécessite `enable_custom_domain = true`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire.** Active Redis pour la file de tâches Celery et le streaming SSE/WebSocket. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS ; définissez-le explicitement pour une instance Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes (API Dify). |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster du service d'API. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `web_url` | URL du frontal web Dify (utilisez-la pour ouvrir l'interface dans le navigateur). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et de la tâche d'importation (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_redis` | `true` (obligatoire) | Critical | Toutes les tâches Celery (exécution des workflows, indexation des documents, appels LLM asynchrones) échouent silencieusement sans Redis. |
| `enable_cloudsql_volume` | `true` (obligatoire) | Critical | Le sidecar Auth Proxy est le seul chemin vers PostgreSQL ; le désactiver interrompt toute connectivité à la base de données. |
| `SECRET_KEY` (généré automatiquement) | immuable une fois défini | Critical | Tous les pods doivent partager la même clé ; sa rotation déconnecte tous les utilisateurs et invalide les sessions actives. |
| `db_name` / `db_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `enable_redis` + `enable_nfs` | tous deux `true` en l'absence de Redis externe | Critical | Sans NFS, il n'existe aucun hôte Redis lorsque `redis_host` est vide — Celery ne démarre pas. |
| `secret_environment_variables` pour les clés LLM | toujours utiliser des références de secrets | Critical | Des variables d'environnement en clair exposent les clés API dans les spécifications des pods, visibles via `kubectl describe pod`. |
| `enable_redis` + `redis_host` | hôte correct | High | Un `redis_host` incorrect produit une URL de broker Celery mal formée ; toutes les tâches asynchrones restent indéfiniment en file d'attente. |
| `reserve_static_ip` + `service_type` | `true` / `LoadBalancer` — **ne pas modifier pour Dify** | Critical | Les `CONSOLE_API_URL`/`APP_API_URL` du frontal web se résolvent via la sentinelle `$(GKE_SERVICE_URL)` vers `local.service_url`, qui se rabat sur le nom d'hôte interne injoignable `*.svc.cluster.local` si `reserve_static_ip=false` ou si `service_type` est remplacé par autre chose que `LoadBalancer`. La page se charge, mais chaque appel d'API côté navigateur échoue avec `net::ERR_NAME_NOT_RESOLVED`. Il s'agit d'une véritable exception à la convention `reserve_static_ip=false` appliquée à l'ensemble du parc pour économiser le quota d'adresses IP. |
| `memory_limit` | `4Gi` | High | Une mémoire insuffisante provoque des arrêts OOM lors de l'ingestion de documents ou de la mise en cache des workflows LLM. |
| `min_instance_count` | `1` | High | La mise à l'échelle à zéro provoque des démarrages à froid et abandonne les tâches Celery en cours. |
| `timeout_seconds` | `300` (à augmenter pour les workflows) | High | Les workflows à plusieurs étapes et l'indexation RAG peuvent dépasser 300 s ; augmentez à `3600` pour les déploiements complexes. |
| `WEB_API_CORS_ALLOW_ORIGINS` | à restreindre en production | High | La valeur par défaut `"*"` autorise les requêtes cross-origin depuis n'importe quel domaine. |
| `application_version` | fixer une version précise | Medium | Des versions non fixées risquent de déclencher des migrations de schéma inattendues qui cassent l'application lors d'un redéploiement. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Medium | Sans ces contrôles, la console Dify est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de rétention liées à la conformité. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à Dify partagée avec la variante Cloud Run est décrite dans
**[Dify_Common](Dify_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Dify sur GKE Autopilot](../labs/Dify_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Dify sur Google Cloud Run](Dify_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Dify Common — Configuration applicative partagée](Dify_Common.md) — la configuration partagée par les deux cibles de déploiement.
