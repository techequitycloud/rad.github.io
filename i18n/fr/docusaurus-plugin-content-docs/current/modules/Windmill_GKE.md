---
title: "Windmill sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Windmill sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Windmill_GKE.md @ 15fd4c7 sha256:9e474031c546 -->

# Windmill sur GKE Autopilot {#windmill-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Windmill_GKE.png" alt="Windmill sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Windmill est une plateforme de développement open source pour la création d'outils internes, de scripts, de flux et d'automatisations. Ce module déploie Windmill sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services Google Cloud utilisés par Windmill et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Windmill fonctionne comme une charge de travail combinée serveur+worker. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods combinés serveur+worker, 2 vCPU / 2 GiB par défaut, autoscalés horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 16 | Requis — Windmill nécessite PostgreSQL 16 ou ultérieur |
| Stockage d'objets | Cloud Storage | Un bucket `data` (`gcs-<app><tenant-prefix>-data`) pour les sorties et artefacts de workflow |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré et secret de remplacement SMTP |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 16 est requis.** Windmill utilise des fonctionnalités spécifiques à PostgreSQL ; le moteur de base de données est fixe. La sélection d'une version plus ancienne ou `NONE` entraînera l'échec du job d'initialisation.
- **Mode combiné serveur+worker.** `MODE=server,worker` et `NUM_WORKERS=3` exécutent le serveur API et les workers d'exécution de scripts dans le même pod. Pour une mise à l'échelle indépendante des workers, définissez des déploiements Kubernetes supplémentaires via `additional_services`.
- **`DISABLE_NSJAIL=true` est injecté automatiquement.** GKE Autopilot n'accorde pas `CAP_SYS_ADMIN` ou les espaces de noms utilisateur ; l'isolation des espaces de noms Linux de Windmill est désactivée en conséquence.
- **Redis est désactivé par défaut.** Windmill fonctionne sans Redis pour les déploiements à réplica unique. Activez Redis pour un comportement de file d'attente distribuée avec plusieurs réplicas.
- **`session_affinity` est `None`.** L'API de Windmill est stateless et utilise une authentification basée sur les cookies, de sorte que le routage persistant n'est pas requis.
- **Les sondes de santé ciblent `/api/version`.** Ce point de terminaison léger renvoie la chaîne de version de Windmill lorsque le service est prêt — aucun délai de migration au démarrage n'est requis.
- **Un secret de remplacement SMTP est provisionné automatiquement.** Remplacez la valeur `{prefix}-smtp-password` dans Secret Manager avant d'activer les notifications par e-mail.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Windmill {#a-gke-autopilot--the-windmill-workload}

Les pods Windmill sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et maximal de réplicas. Le type de charge de travail par défaut est `Deployment` ; définissez `stateful_pvc_enabled = true` pour sélectionner automatiquement `StatefulSet` avec des volumes persistants par pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Windmill pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 16 {#b-cloud-sql-for-postgresql-16}

Windmill stocke toutes les données d'application — scripts, flux, variables, ressources, plannings et historique des jobs — dans une instance gérée de Cloud SQL pour PostgreSQL 16. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée de manière idempotente la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `data`, c'est-à-dire `gcs-<app><tenant-prefix>-data`) est provisionné pour les sorties de workflow, les artefacts et les dépendances de scripts. Le compte de service de la charge de travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour des options de bucket supplémentaires, les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données et le mot de passe de remplacement SMTP sont stockés en tant que secrets Secret Manager et injectés dans les pods au moment de l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Replace the SMTP placeholder before enabling email features:
  echo -n "your-smtp-password" | gcloud secrets versions add \
    <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du CSI du Secret Store.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging au format JSON structuré (`JSON_FMT=true`). Les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Un point de terminaison de métriques Prometheus est exposé à `:9001` pour le scraping au sein du VPC.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Windmill {#3-windmill-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) s'exécute au premier déploiement en utilisant `postgres:16-alpine`. Il crée de manière idempotente les rôles `windmill_admin` et `windmill_user`, l'utilisateur de l'application et la base de données de l'application, puis accorde tous les privilèges et l'appartenance aux deux rôles (Windmill doit `SET ROLE windmill_admin`). Le job peut être réexécuté en toute sécurité.
- **Migrations automatiques de schémas.** Windmill exécute ses propres migrations de base de données au démarrage, de sorte que la mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Mode combiné serveur+worker.** Chaque pod exécute à la fois l'API/ordonnanceur Windmill et `NUM_WORKERS=3` workers d'exécution de scripts. Les workers exécutent des scripts Python, TypeScript, Bash, Go et SQL dans des sous-processus isolés. L'affectation `WORKER_GROUP=default` signifie que tous les flux et scripts sont acheminés vers ces pods par défaut.
- **`BASE_URL` et `BASE_INTERNAL_URL`.** Le shim `entrypoint.sh` construit `DATABASE_URL` à partir de variables `DB_*` injectées par la plateforme au démarrage. Lorsque `GKE_SERVICE_URL` est défini (injecté par App_GKE une fois l'IP du LoadBalancer allouée), `BASE_URL` est mis à jour automatiquement afin que les rappels OAuth et les URL de webhook se résolvent correctement.
- **Métriques Prometheus.** `METRICS_ADDR=:9001` expose les métriques Windmill à `http://<pod-ip>:9001/metrics` pour le scraping depuis le cluster.
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent `GET /api/version`. Ce point de terminaison renvoie HTTP 200 avec la chaîne de version lorsque Windmill est prêt à servir le trafic.
- **Notifications par e-mail SMTP.** Le secret `WINDMILL_SMTP_PASS` est initialisé avec un espace réservé de 16 caractères. Remplacez-le et fournissez `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT` et `WINDMILL_SMTP_FROM` via `environment_variables` pour activer les notifications par e-mail des flux et des scripts.
- **Inspecter les flux et jobs planifiés :**
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Windmill sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `windmill` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Windmill` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Windmill ; défini sur une version spécifique (par exemple `1.400.0`) pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit avec le Dockerfile inclus ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `""` | Remplace l'URI de l'image. Laissez vide pour que Cloud Build gère. |
| `cpu_limit` | `2000m` | CPU par pod. 2 vCPU est le minimum recommandé pour le mode combiné serveur+worker. |
| `memory_limit` | `2Gi` | Mémoire par pod. 4 GiB recommandé pour les charges de travail Python/TypeScript en production. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Gardez ≥ 1 pour que les webhooks et les flux planifiés aient un pod sur lequel s'exécuter. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8000` | Windmill écoute sur le port 8000. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis pour la connexion par socket Unix. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Windmill dans Artifact Registry pour éviter les limites de débit de ghcr.io. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM ; augmenter pour permettre aux jobs en cours de se terminer gracieusement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets fusionnés avec les valeurs par défaut de Windmill. Utilisez pour définir `WINDMILL_SMTP_HOST`, les remplacements `NUM_WORKERS`, etc. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager. `WINDMILL_SMTP_PASS` est injecté automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le Service est exposé. |
| `session_affinity` | `None` | L'API de Windmill est stateless ; le routage persistant n'est pas requis. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu. |
| `gke_cluster_name` | `""` | Cluster GKE à utiliser. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour générer automatiquement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC dans un StatefulSet. La définition de `true` sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `/api/version`, période de 10s, 10 échecs | Sonde HTTP contre le point de terminaison de version de Windmill. |
| `health_check_config` | `/api/version`, période de 30s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job PostgreSQL `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents pour la maintenance ou les tâches d'intégration. |
| `additional_services` | `[]` | Déploiements sidecar ou auxiliaires à côté de Windmill (par exemple, des pools de workers dédiés). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut — Windmill ne nécessite pas de stockage de fichiers partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur lorsque NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `data` et tout bucket supplémentaire. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_16` | Fixe — Windmill nécessite PostgreSQL 16. Ne pas modifier. |
| `db_name` | `windmill` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `windmill` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod GKE pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Windmill. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor et Redis {#group-21--cloud-armor--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_redis` | `false` | Active Redis pour un comportement de file d'attente distribuée (facultatif). |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide et activez NFS pour la découverte automatique. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Windmill. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatifs). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors du premier apply d'un nouveau cluster inline ; réexécutez apply pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_16` | Critique | Windmill nécessite PostgreSQL 16 ; l'utilisation d'une version plus ancienne entraîne l'échec du job d'initialisation et la base de données reste non initialisée. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les scripts, flux et l'historique des jobs. |
| `enable_cloudsql_volume` | `true` | Critique | Windmill se connecte via le socket Unix du Auth Proxy ; la désactivation de cela entraîne une défaillance immédiate de la base de données et un CrashLoopBackOff. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `cpu_limit` | `2000m` | Élevé | Le mode combiné exécute 3 workers in-process ; un CPU insuffisant étrangle toute exécution de script. Chaque worker a besoin d'environ 500m. |
| `memory_limit` | `2Gi` | Élevé | Les workers Windmill exécutent des scripts utilisateur arbitraires ; les OOM kills en cours d'exécution produisent des échecs silencieux dans l'interface utilisateur. |
| `min_instance_count` | `1` | Élevé | `0` permet la mise à l'échelle à zéro ; les flux planifiés seront manqués et les webhooks renverront 503 jusqu'à ce qu'un pod soit prêt. |
| `service_url` / `BASE_URL` | IP de l'équilibreur de charge ou domaine personnalisé | Élevé | Une valeur vide ou incorrecte rompt les rappels OAuth, les points de terminaison de webhook et les liens profonds de l'interface utilisateur de Windmill. |
| `enable_redis` | `false` pour un réplica unique, `true` pour plusieurs | Moyen | Sans Redis, chaque pod ne traite que sa propre file d'attente locale ; avec plusieurs réplicas, cela entraîne un routage de job imprévisible. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |
| `backup_schedule` | `0 2 * * *` | Moyen | Une chaîne vide désactive les sauvegardes ; Windmill stocke toutes les définitions d'automatisation dans PostgreSQL. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | Sans cela, l'interface utilisateur et l'API de Windmill sont accessibles publiquement. |
| `WINDMILL_SMTP_*` (via variables d'environnement) | tous les champs définis ensemble | Moyen | Une configuration SMTP partielle entraîne des échecs silencieux de livraison d'e-mails sans erreur d'exécution. |
| `enable_auto_password_rotation` | `false` | Moyen | Lorsqu'il est activé, les pods doivent être redémarrés après la rotation ; sinon, ils utilisent un mot de passe expiré jusqu'à ce que les connexions échouent. |
| `enable_vpc_sc` | `false` sauf si nécessaire | Élevé | Nécessite `organization_id` explicite ; sans cela, VPC-SC est silencieusement ignoré, donnant un faux sentiment de sécurité périmétrique. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Windmill partagée avec la variante Cloud Run est décrite dans **[Windmill_Common](Windmill_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Windmill sur GKE Autopilot](../labs/Windmill_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Windmill sur Google Cloud Run](Windmill_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Windmill Common — Configuration d'application partagée](Windmill_Common.md) — la configuration partagée par les deux cibles de déploiement.
