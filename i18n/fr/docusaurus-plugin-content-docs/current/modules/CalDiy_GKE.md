---
title: "Cal.diy sur GKE Autopilot"
description: "Référence de configuration pour déployer Cal.diy sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CalDiy_GKE.md @ 3055034 sha256:13e096da2d39 -->

# Cal.diy sur GKE Autopilot {#caldiy-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalDiy_GKE.png" alt="Cal.diy sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.diy est le fork sous licence MIT et auto-hébergeable de Cal.com — la plateforme
de planification open source utilisée par des millions de personnes dans le monde
pour en finir avec les allers-retours de coordination des réunions.
Ce module déploie Cal.diy sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Cal.diy et sur la manière de
les explorer et de les exploiter depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cal.diy s'exécute sous la forme d'une charge de travail web Next.js (Node.js). Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Cal.diy utilise l'ORM Prisma ciblant PostgreSQL |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné par défaut |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` générés automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ;
  sélectionner MySQL ou `NONE` empêche le démarrage.
- **Redis est désactivé par défaut.** Activez-le pour les déploiements à plusieurs
  réplicas afin de partager l'état des sessions entre les pods.
- **L'affinité de session est `None` par défaut.** Cal.diy stocke les sessions dans
  PostgreSQL (NextAuth.js), si bien qu'un routage persistant n'est pas nécessaire —
  mais l'activation de Redis est recommandée pour une production à plusieurs réplicas.
- **Trois jobs d'initialisation s'exécutent au premier déploiement :** `db-init`
  (configuration de PostgreSQL), `db-migrate` (migrations de schéma Prisma) et
  `seed-app-store` (alimente la table de l'app store de Cal.diy). Tous sont idempotents
  et s'exécutent séquentiellement.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY`** sont générés automatiquement et
  stockés dans Secret Manager ; vous ne les définissez jamais en clair.
- **`NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL`** reçoivent la sentinelle
  `$(GKE_SERVICE_URL)`, qu'`App_GKE` résout vers l'IP réelle du LoadBalancer ou le
  domaine personnalisé au moment de l'application.
- **`calcom/cal.diy` n'a pas de tag `latest`** — épinglez toujours `application_version`
  sur une version publiée (par exemple `v6.2.0`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cal.diy {#a-gke-autopilot--the-caldiy-workload}

Les pods Cal.diy sont planifiés sur Autopilot, qui facture le CPU et la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Cal.diy pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.diy stocke toutes les données applicatives (réservations, utilisateurs, plannings,
intégrations) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent
de façon privée via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, si bien
qu'aucune IP publique n'est exposée. Au premier déploiement, une séquence de jobs
d'initialisation crée la base de données et l'utilisateur, exécute les migrations de
schéma Prisma et alimente l'app store.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket Cloud Storage par défaut (suffixe `data`) est provisionné et le compte de
service de la charge de travail y reçoit automatiquement l'accès. Cal.diy ne nécessite
pas de stockage NFS partagé par défaut — la base de données stocke tout l'état des
réservations.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour CMEK et les options de buckets supplémentaires.

### D. Secret Manager {#d-secret-manager}

`NEXTAUTH_SECRET` (signature des sessions NextAuth.js) et `CALENDSO_ENCRYPTION_KEY`
(chiffrement des données Cal.diy) sont générés automatiquement et stockés sous forme
de secrets Secret Manager. Le mot de passe de la base de données est également géré
ici. Les secrets sont injectés dans les pods à l'exécution ; le texte en clair
n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret
Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et
des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cal.diy {#3-caldiy-application-behaviour}

- **Séquence d'initialisation au premier déploiement.** Trois Jobs Kubernetes
  s'exécutent dans l'ordre avant le démarrage de l'application :

  | Job | Image | Objectif |
  |---|---|---|
  | `db-init` | `postgres:15-alpine` | Crée la base de données PostgreSQL et l'utilisateur, accorde les privilèges |
  | `db-migrate` | Image de l'application Cal.diy | Exécute `prisma migrate deploy` pour appliquer le schéma complet |
  | `seed-app-store` | Image de l'application Cal.diy | Alimente la table `App` avec les intégrations disponibles |

  Les trois sont idempotents et peuvent être réexécutés sans risque. Inspectez leur
  état :
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl logs -n "$NAMESPACE" job/db-init
  kubectl logs -n "$NAMESPACE" job/db-migrate
  kubectl logs -n "$NAMESPACE" job/seed-app-store
  ```

- **Assemblage de `DATABASE_URL`.** Le script de point d'entrée assemble `DATABASE_URL`
  et `DATABASE_DIRECT_URL` à partir des variables d'environnement `DB_*` au démarrage
  du conteneur, puis lance le serveur Next.js. La connectivité à la base de données
  devient ainsi indépendante de la variante d'image déployée (miroir de base ou image
  construite par le CI/CD).

- **Sonde de démarrage.** Les sondes de santé ciblent `/api/auth/session` (HTTP 200
  lorsque NextAuth est prêt). Une fenêtre de démarrage généreuse (`initial_delay=60s`,
  `failure_threshold=12`, `period=10s` ≈ 2 minutes) laisse le temps à `db-migrate` et
  `seed-app-store`, qui doivent se terminer avant que l'application ne serve des
  requêtes.

- **Câblage de l'URL publique.** `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL` reçoivent
  la sentinelle `$(GKE_SERVICE_URL)` au moment du déploiement. `App_GKE` la remplace par
  l'IP réelle du LoadBalancer ou par le domaine personnalisé. Si vous utilisez un
  domaine personnalisé, définissez `NEXT_PUBLIC_WEBAPP_URL` dans `environment_variables`
  sur l'URL du domaine personnalisé afin que les callbacks OAuth et les liens de
  réservation soient corrects.

- **E-mail (SMTP).** Cal.diy utilise SMTP pour les confirmations de réservation, les
  avis d'annulation, les rappels et les réinitialisations de mot de passe. Configurez
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM` dans `environment_variables` et
  stockez `SMTP_PASSWORD` sous forme de référence `secret_environment_variables` avant
  la mise en production.

- **Aucune tâche planifiée requise.** Contrairement aux applications traditionnelles
  fondées sur des files d'attente, Cal.diy ne nécessite pas de jobs d'arrière-plan
  planifiés séparément — les réservations et les rappels sont gérés par des routes API
  Next.js déclenchées par les webhooks de calendrier et les interactions des clients.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Cal.diy ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement
et leurs valeurs par défaut standard.

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
| `application_name` | `caldiy` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Cal.com Scheduling` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `v6.2.0` | Tag de version de l'image Cal.diy — **aucun tag `latest` n'existe**, épinglez toujours une version publiée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | `prebuilt` utilise l'image officielle de Cal.diy ; `custom` construit via Cloud Build. |
| `container_image` | `""` | Remplace l'URI de l'image de conteneur. Laissez vide pour utiliser la valeur par défaut. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="2Gi" }` | Limites de CPU et de mémoire ; passez `memory_limit` à `4Gi` pour une charge multi-utilisateur en production. |
| `container_port` | `3000` | Port Next.js natif de Cal.diy. Ne le modifiez pas. |
| `container_protocol` | `http1` | Version du protocole HTTP : `http1` ou `h2c`. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. GKE Autopilot n'a pas de mise à l'échelle jusqu'à zéro par défaut ; conservez ≥ 1. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. Doit valoir `true` lorsque `database_type != "NONE"`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Cal.diy dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `timeout_seconds` | `300` | Nombre maximal de secondes pendant lesquelles l'équilibreur de charge attend la réponse d'un pod. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Squelette SMTP | Paramètres en texte clair. Définissez ici `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM`. Définissez aussi `NEXT_PUBLIC_WEBAPP_URL` une fois le domaine personnalisé connu. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. À utiliser pour `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `enable_auto_password_rotation` | `false` | Rotation sans interruption du mot de passe de la base de données. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer les pods. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE ; découvert automatiquement s'il est vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; généré automatiquement s'il est vide. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque le stockage par pod est activé. |
| `session_affinity` | `None` | `None` recommandé — les sessions Cal.diy sont stockées dans PostgreSQL. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu VPC. |
| `deployment_timeout` | `1800` | Nombre maximal de secondes pendant lesquelles Terraform attend la fin du déploiement progressif. |

### Groupe 7 — Règles de fiabilité {#group-7--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. À activer lorsque `max_instance_count > 1`. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones de disponibilité. |
| `topology_spread_strict` | `false` | Rejette les pods si la répartition entre zones ne peut pas être respectée. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Utilisez obligatoirement des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/api/auth/session`, délai de 60s, fenêtre d'échec de 12 × 10s | Le point de terminaison `/api/auth/session` de Cal.diy renvoie 200 lorsque NextAuth est prêt. |
| `liveness_probe` / `health_check_config` | HTTP `/api/auth/session` | Sonde de vivacité après le démarrage. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init`, `db-migrate` et `seed-app-store`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents. Cal.diy ne nécessite pas de tâches planifiées par défaut. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires à exécuter aux côtés du conteneur principal. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas nécessaire pour Cal.diy — activez-le uniquement si un stockage personnalisé est requis. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `data` par défaut. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — StatefulSet {#group-15--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Active les modèles de PVC (sélectionne automatiquement StatefulSet). |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `""` | StorageClass Kubernetes ; utilise celle par défaut du cluster si vide. |
| `stateful_headless_service` | `false` | Service headless pour des identités DNS de pods stables. |
| `stateful_pod_management_policy` | `OrderedReady` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `null` | GID fsGroup pour la propriété des volumes. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas. Cal.diy nécessite PostgreSQL. |
| `application_database_name` | `calcom` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `calcom` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Installe des extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | `[]` | Liste des extensions à installer (par exemple `['uuid-ossp']`). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; passez à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. S'ils sont définis, mettez aussi à jour `NEXT_PUBLIC_WEBAPP_URL` dans `environment_variables`. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Cal.diy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utilise Redis pour la mise en cache des sessions. Recommandé lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Obligatoire lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR bénéficiant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle Cloud Armor. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant de joindre Cal.diy. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Cal.diy nécessite PostgreSQL avec l'ORM Prisma ; MySQL ou `NONE` font échouer les migrations de schéma et le démarrage. |
| `container_port` | `3000` | Critique | Le serveur Next.js de Cal.diy écoute sur le port 3000 ; toute autre valeur fausse les contrôles de santé et le routage du trafic. |
| `enable_cloudsql_volume` | `true` | Critique | Cal.diy se connecte à Cloud SQL via un socket Unix ; le désactiver supprime le socket et toutes les connexions à la base de données échouent. |
| `application_database_name` / `_user` | définis une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données ou l'utilisateur et rend orphelines les données existantes. |
| `application_version` | version publiée épinglée | Critique | `calcom/cal.diy` n'a pas de tag `latest` ; une version invalide fait échouer l'extraction de l'image. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'importation et peut écraser des données en production lors des applications suivantes. |
| `NEXT_PUBLIC_WEBAPP_URL` | identique à l'URL publique | Critique | Cal.diy intègre cette valeur dans les blocs Next.js ; une discordance casse les callbacks OAuth et les liens de réservation. |
| `NEXTAUTH_URL` | identique à l'URL publique | Critique | NextAuth valide les URI de redirection OAuth par rapport à cette valeur ; une discordance bloque toutes les connexions. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets — cela bloque toute planification de pods. |
| `container_resources.memory_limit` | `2Gi` minimum | Élevé | Le démarrage de Cal.diy (migration de la base de données + alimentation initiale) nécessite ≥ 2 GiB ; des arrêts OOM surviennent avant que l'application ne soit prête. |
| `startup_probe.failure_threshold` | `12` (période de 10s ≈ 2 min) | Élevé | Une réduction trop agressive tue les pods avant la fin de `db-migrate` et `seed-app-store`. |
| `enable_redis` | `true` en multi-réplica | Élevé | Sans Redis, les sessions sont propres à chaque pod ; les utilisateurs sont déconnectés lorsque leurs requêtes arrivent sur des pods différents. |
| `redis_host` | obligatoire lorsque `enable_redis=true` | Élevé | Un `redis_host` vide avec Redis activé injecte une URL malformée ; les opérations de session échouent à l'exécution. |
| `enable_pod_disruption_budget` | `true` lorsque `max > 1` | Moyen | Sans PDB, la maintenance du cluster peut évincer tous les pods simultanément. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `enable_topology_spread` | à activer en production | Moyen | Sans répartition, tous les réplicas peuvent s'exécuter dans une seule zone ; une panne de zone met le service hors ligne. |
| `min_instance_count` | `1` | Moyen | Le premier démarrage de Cal.diy prend 3 à 5 minutes ; `0` avec mise à l'échelle jusqu'à zéro ajoute une latence de démarrage à froid importante. |
| `SMTP_HOST` / `EMAIL_FROM` | configuration SMTP réelle | Moyen | Sans SMTP valide, les confirmations de réservation, les rappels et les réinitialisations de mot de passe ne sont jamais envoyés. |
| `organization_id` | défini explicitement pour VPC-SC | Moyen | Le périmètre VPC-SC n'est activé que lorsque `organization_id` est défini ; `enable_vpc_sc = true` seul n'a aucun effet. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Cal.diy partagée avec
la variante Cloud Run est décrite dans **[CalDiy_Common](CalDiy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : CalDiy sur GKE Autopilot](../labs/CalDiy_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Cal.diy sur Google Cloud Run](CalDiy_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [CalDiy_Common — Configuration applicative partagée](CalDiy_Common.md) — la configuration partagée par les deux cibles de déploiement.
