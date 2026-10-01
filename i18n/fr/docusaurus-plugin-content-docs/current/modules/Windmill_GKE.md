---
title: "Windmill sur GKE Autopilot"
description: "Référence de configuration pour déployer Windmill sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Windmill_GKE.md @ 3055034 sha256:b7f7c10df3f4 -->

# Windmill sur GKE Autopilot {#windmill-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Windmill_GKE.png" alt="Windmill sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Windmill est une plateforme de développement open source permettant de créer des outils internes, des scripts, des flux et des automatisations. Ce module déploie Windmill sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Windmill et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Windmill s'exécute sous forme de charge de travail combinée serveur+worker. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods combinés serveur+worker, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 16 | Obligatoire — Windmill nécessite PostgreSQL 16 ou une version ultérieure |
| Stockage d'objets | Cloud Storage | Un bucket `data` (`gcs-<app><tenant-prefix>-data`) pour les sorties de workflows et les artefacts |
| Secrets | Secret Manager | Mot de passe de la base de données généré automatiquement et secret SMTP provisoire |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 16 est obligatoire.** Windmill utilise des fonctionnalités propres à PostgreSQL ; le moteur de base de données est fixe. Sélectionner une version plus ancienne ou `NONE` fait échouer le job d'initialisation.
- **Mode combiné serveur+worker.** `MODE=server,worker` et `NUM_WORKERS=3` exécutent le serveur d'API et les workers d'exécution de scripts dans le même pod. Pour une mise à l'échelle indépendante des workers, définissez des Deployments Kubernetes supplémentaires via `additional_services`.
- **`DISABLE_NSJAIL=true` est injecté automatiquement.** GKE Autopilot n'accorde ni `CAP_SYS_ADMIN` ni les espaces de noms utilisateur ; l'isolation par espaces de noms Linux de Windmill est donc désactivée.
- **Redis est désactivé par défaut.** Windmill fonctionne sans Redis pour les déploiements à un seul réplica. Activez Redis pour un comportement de file d'attente distribuée avec plusieurs réplicas.
- **`session_affinity` vaut `None`.** L'API de Windmill est sans état et utilise une authentification par cookie ; un routage persistant n'est donc pas nécessaire.
- **Les sondes de santé ciblent `/api/version`.** Ce point de terminaison léger renvoie la chaîne de version de Windmill lorsque le service est prêt — aucun délai de migration au démarrage n'est nécessaire.
- **Un secret SMTP provisoire est provisionné automatiquement.** Remplacez la valeur `{prefix}-smtp-password` dans Secret Manager avant d'activer les notifications par e-mail.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Windmill {#a-gke-autopilot--the-windmill-workload}

Les pods Windmill sont planifiés sur Autopilot, qui facture le CPU et la mémoire effectivement demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le déploiement entre le nombre minimal et le nombre maximal de réplicas. Le type de charge de travail par défaut est `Deployment` ; définissez `stateful_pvc_enabled = true` pour sélectionner automatiquement `StatefulSet` avec des volumes persistants par pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Windmill pour consulter les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 16 {#b-cloud-sql-for-postgresql-16}

Windmill stocke toutes les données applicatives — scripts, flux, variables, ressources, planifications et historique des jobs — dans une instance gérée Cloud SQL for PostgreSQL 16. Les pods s'y connectent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée de manière idempotente la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `data`, c'est-à-dire `gcs-<app><tenant-prefix>-data`) est provisionné pour les sorties de workflows, les artefacts et les dépendances des scripts. L'accès est accordé automatiquement au compte de service de la charge de travail.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options de buckets supplémentaires, les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données et le mot de passe SMTP provisoire sont stockés en tant que secrets Secret Manager et injectés dans les pods à l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Replace the SMTP placeholder before enabling email features:
  echo -n "your-smtp-password" | gcloud secrets versions add \
    <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging au format JSON structuré (`JSON_FMT=true`). Les métriques GKE et Cloud SQL sont envoyées à Cloud Monitoring. Un point de terminaison de métriques Prometheus est exposé sur `:9001` pour une collecte au sein du VPC.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Windmill {#3-windmill-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) s'exécute au premier déploiement avec `postgres:16-alpine`. Il crée de manière idempotente les rôles `windmill_admin` et `windmill_user`, l'utilisateur de l'application et la base de données de l'application, puis accorde tous les privilèges. Le job peut être relancé sans risque.
- **Migrations de schéma automatiques.** Windmill exécute ses propres migrations de base de données au démarrage ; la mise à niveau de `application_version` applique donc automatiquement les modifications de schéma.
- **Mode combiné serveur+worker.** Chaque pod exécute à la fois l'API/le planificateur Windmill et `NUM_WORKERS=3` workers d'exécution de scripts. Les workers exécutent des scripts Python, TypeScript, Bash, Go et SQL dans des sous-processus isolés. L'affectation `WORKER_GROUP=default` signifie que tous les flux et scripts sont acheminés par défaut vers ces pods.
- **`BASE_URL` et `BASE_INTERNAL_URL`.** Le shim `entrypoint.sh` construit `DATABASE_URL` au démarrage à partir des variables `DB_*` injectées par la plateforme. Lorsque `GKE_SERVICE_URL` est défini (injecté par App_GKE une fois l'IP du LoadBalancer allouée), `BASE_URL` est mise à jour automatiquement afin que les callbacks OAuth et les URL de webhook soient résolus correctement.
- **Métriques Prometheus.** `METRICS_ADDR=:9001` expose les métriques Windmill sur `http://<pod-ip>:9001/metrics` pour une collecte depuis le cluster.
- **Chemin de santé.** Les sondes de démarrage et d'activité utilisent toutes deux `GET /api/version`. Ce point de terminaison renvoie HTTP 200 avec la chaîne de version lorsque Windmill est prêt à servir du trafic.
- **Notifications par e-mail SMTP.** Le secret `WINDMILL_SMTP_PASS` est initialisé avec une valeur provisoire de 16 caractères. Remplacez-la et fournissez `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT` et `WINDMILL_SMTP_FROM` via `environment_variables` pour activer les notifications par e-mail depuis les flux et les scripts.
- **Inspecter les flux planifiés et les jobs :**
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Windmill ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `windmill` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Windmill` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Windmill ; définissez une version précise (par ex. `1.400.0`) pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image avec le Dockerfile fourni ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `""` | URI d'image de remplacement. Laissez vide pour que Cloud Build la gère. |
| `cpu_limit` | `2000m` | CPU par pod. 2 vCPU est le minimum recommandé pour le mode combiné serveur+worker. |
| `memory_limit` | `2Gi` | Mémoire par pod. 4 GiB recommandés pour les charges de travail Python/TypeScript en production. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Gardez ≥ 1 pour que les webhooks et les flux planifiés disposent d'un pod sur lequel s'exécuter. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8000` | Windmill écoute sur le port 8000. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis pour la connexion par socket Unix. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Windmill dans Artifact Registry pour éviter les limites de débit de ghcr.io. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente après SIGTERM ; augmentez cette valeur pour laisser les jobs en cours se terminer proprement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés avec les valeurs par défaut de Windmill. Permet de définir `WINDMILL_SMTP_HOST`, des remplacements de `NUM_WORKERS`, etc. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. `WINDMILL_SMTP_PASS` est injecté automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `None` | L'API de Windmill est sans état ; un routage persistant n'est pas nécessaire. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags de nœuds/pods pour les règles de pare-feu. |
| `gke_cluster_name` | `""` | Cluster GKE à utiliser. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour le générer automatiquement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC dans un StatefulSet. La valeur `true` sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité lors des mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `/api/version`, période de 10s, 10 échecs | Sonde HTTP sur le point de terminaison de version de Windmill. |
| `health_check_config` | `/api/version`, période de 30s, 3 échecs | Sonde d'activité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job PostgreSQL `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents pour des tâches de maintenance ou d'intégration. |
| `additional_services` | `[]` | Deployments sidecar ou auxiliaires aux côtés de Windmill (par ex. des pools de workers dédiés). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut — Windmill ne nécessite pas de stockage de fichiers partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur lorsque NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `data` et les éventuels buckets supplémentaires. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_16` | Fixe — Windmill nécessite PostgreSQL 16. Ne la modifiez pas. |
| `db_name` | `windmill` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `windmill` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage des pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; passez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `['nfsserver']` | Tags de nœuds/pods GKE pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Windmill. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor et Redis {#group-21--cloud-armor--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `enable_redis` | `false` | Active Redis pour un comportement de file d'attente distribuée (facultatif). |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide et activez NFS pour la découverte automatique. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Windmill. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. `false` lors du premier apply d'un nouveau cluster intégré ; relancez l'apply pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_16` | Critical | Windmill nécessite PostgreSQL 16 ; une version plus ancienne fait échouer le job d'initialisation et la base de données reste non initialisée. |
| `db_name` / `db_user` | défini une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit tous les scripts, flux et l'historique des jobs. |
| `enable_cloudsql_volume` | `true` | Critical | Windmill se connecte via le socket Unix de l'Auth Proxy ; le désactiver provoque une défaillance immédiate de la base de données et un CrashLoopBackOff. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification. |
| `cpu_limit` | `2000m` | High | Le mode combiné exécute 3 workers dans le processus ; un CPU insuffisant ralentit toute l'exécution des scripts. Chaque worker nécessite environ 500m. |
| `memory_limit` | `2Gi` | High | Les workers Windmill exécutent des scripts utilisateur arbitraires ; les arrêts pour manque de mémoire (OOM) en cours d'exécution produisent des échecs silencieux dans l'interface. |
| `min_instance_count` | `1` | High | `0` permet la mise à l'échelle à zéro ; les flux planifiés seront manqués et les webhooks renverront 503 jusqu'à ce qu'un pod soit prêt. |
| `service_url` / `BASE_URL` | IP de l'équilibreur de charge ou domaine personnalisé | High | Une valeur vide ou incorrecte casse les callbacks OAuth, les points de terminaison de webhook et les liens profonds de l'interface Windmill. |
| `enable_redis` | `false` pour un seul réplica, `true` pour plusieurs | Medium | Sans Redis, chaque pod ne traite que sa propre file d'attente locale ; avec plusieurs réplicas, cela provoque un routage des jobs imprévisible. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |
| `backup_schedule` | `0 2 * * *` | Medium | Une chaîne vide désactive les sauvegardes ; Windmill stocke toutes les définitions d'automatisation dans PostgreSQL. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Medium | Sans ces options, l'interface et l'API Windmill sont accessibles publiquement. |
| `WINDMILL_SMTP_*` (via les variables d'environnement) | tous les champs définis ensemble | Medium | Une configuration SMTP partielle provoque des échecs silencieux de remise des e-mails, sans erreur à l'exécution. |
| `enable_auto_password_rotation` | `false` | Medium | Lorsqu'elle est activée, les pods doivent être redémarrés après la rotation ; sinon ils utilisent un mot de passe expiré jusqu'à ce que les connexions échouent. |
| `enable_vpc_sc` | `false` sauf si nécessaire | High | Nécessite un `organization_id` explicite ; sans lui, VPC-SC est ignoré silencieusement, ce qui donne une fausse impression de sécurité périmétrique. |

---

Pour le comportement du socle référencé tout au long de ce guide — IAM et Workload Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Windmill, partagée avec la variante Cloud Run, est décrite dans **[Windmill_Common](Windmill_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Windmill sur GKE Autopilot](../labs/Windmill_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Windmill sur Google Cloud Run](Windmill_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Windmill Common — Configuration applicative partagée](Windmill_Common.md) — la configuration partagée par les deux cibles de déploiement.
