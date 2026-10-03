---
title: "Cal.diy sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Cal.diy sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CalDiy_GKE.md @ 15fd4c7 sha256:70699e9bf9d8 -->

# Cal.diy sur GKE Autopilot {#caldiy-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalDiy_GKE.png" alt="Cal.diy sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.diy est le fork auto-hébergeable sous licence MIT de Cal.com — la plateforme de planification
open-source utilisée par des millions de personnes dans le monde pour éliminer les allers-retours de coordination de réunions.
Ce module déploie Cal.diy sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud
et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Cal.diy et sur la manière de les explorer et de les exploiter
à partir de la console Google Cloud et de la ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cal.diy fonctionne comme une charge de travail web Next.js (Node.js). Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Requis — Cal.diy utilise Prisma ORM ciblant PostgreSQL |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné par défaut |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` auto-générés |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ; la sélection de MySQL ou
  `NONE` provoque des erreurs au démarrage.
- **Redis est désactivé par défaut.** Activez-le pour les déploiements multi-réplicas afin de partager
  l'état de session entre les pods.
- **L'affinité de session est `None` par défaut.** Cal.diy stocke les sessions dans PostgreSQL
  (NextAuth.js), donc le routage persistant n'est pas requis — mais l'activation de Redis est recommandée
  pour la production multi-réplicas.
- **Trois jobs d'initialisation s'exécutent lors du premier déploiement :** `db-init` (configuration PostgreSQL),
  `db-migrate` (migrations de schéma Prisma) et `seed-app-store` (initialise la table
  du magasin d'applications Cal.diy). Tous sont idempotents et s'exécutent séquentiellement.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY`** sont générés automatiquement et
  stockés dans Secret Manager ; vous ne les définissez jamais en texte clair.
- **`NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL`** sont définis sur la sentinelle `$(GKE_SERVICE_URL)`,
  que `App_GKE` résout en l'adresse IP réelle du LoadBalancer ou le domaine personnalisé au moment de l'apply.
- **`calcom/cal.diy` n'a pas de tag `latest`** — toujours épingler `application_version` à une
  version spécifique (par exemple, `v6.2.0`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cal.diy {#a-gke-autopilot--the-caldiy-workload}

Les pods Cal.diy sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre les nombres
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Cal.diy pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'adresse
  IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, l'autoscaling et le type de charge de travail
(Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.diy stocke toutes les données d'application (réservations, utilisateurs, plannings, intégrations) dans une
instance gérée de Cloud SQL for PostgreSQL 15. Les pods l'atteignent en privé via le
sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte qu'aucune adresse IP publique n'est exposée. Lors du
premier déploiement, une séquence de Jobs d'initialisation crée la base de données et l'utilisateur, exécute
les migrations de schéma Prisma et initialise le magasin d'applications.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket Cloud Storage par défaut (suffixe `data`) est provisionné et le compte de service de la charge de travail
se voit accorder l'accès automatiquement. Cal.diy ne nécessite pas de stockage NFS partagé par défaut —
la base de données stocke tout l'état des réservations.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour CMEK et les options de bucket supplémentaires.

### D. Secret Manager {#d-secret-manager}

`NEXTAUTH_SECRET` (signature de session NextAuth.js) et `CALENDSO_ENCRYPTION_KEY` (chiffrement des données Cal.diy)
sont générés automatiquement et stockés en tant que secrets Secret Manager.
Le mot de passe de la base de données est également géré ici. Les secrets sont injectés dans les pods au moment de l'exécution ;
le texte clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut
être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'adresse IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud
Monitoring. Des tests de disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cal.diy {#3-caldiy-application-behaviour}

- **Séquence d'initialisation du premier déploiement.** Trois Jobs Kubernetes s'exécutent avant le
  démarrage de l'application, dans l'ordre :

  | Job | Image | Objectif |
  |---|---|---|
  | `db-init` | `postgres:15-alpine` | Crée la base de données et l'utilisateur PostgreSQL, accorde les privilèges |
  | `db-migrate` | Image de l'application Cal.diy | Exécute `prisma migrate deploy` pour appliquer le schéma complet |
  | `seed-app-store` | Image de l'application Cal.diy | Initialise la table `App` avec les intégrations disponibles |

  Les trois sont idempotents et peuvent être réexécutés en toute sécurité. Inspectez leur statut :
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl logs -n "$NAMESPACE" job/db-init
  kubectl logs -n "$NAMESPACE" job/db-migrate
  kubectl logs -n "$NAMESPACE" job/seed-app-store
  ```

- **Assemblage `DATABASE_URL`.** Le script d'entrée assemble `DATABASE_URL` et
  `DATABASE_DIRECT_URL` à partir des variables d'environnement `DB_*` au démarrage du conteneur, puis
  lance le serveur Next.js. Cela rend la connectivité de la base de données indépendante de la variante d'image
  (miroir de base ou construite par CI/CD) déployée.

- **Sonde de démarrage.** Les sondes de santé ciblent `/api/auth/session` (HTTP 200 lorsque NextAuth
  est prêt). Une fenêtre de démarrage généreuse (`initial_delay=60s`,
  `failure_threshold=12`, `period=10s` ≈ 2 minutes) permet à `db-migrate` et
  `seed-app-store` de se terminer avant que l'application ne serve les requêtes.

- **Câblage de l'URL publique.** `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL` sont définis sur la
  sentinelle `$(GKE_SERVICE_URL)` au moment du déploiement. `App_GKE` la remplace par l'adresse
  IP réelle du LoadBalancer ou le domaine personnalisé. Lors de l'utilisation d'un domaine personnalisé, définissez
  `NEXT_PUBLIC_WEBAPP_URL` dans `environment_variables` sur l'URL du domaine personnalisé afin que
  les rappels OAuth et les liens de réservation soient corrects.

- **E-mail (SMTP).** Cal.diy utilise SMTP pour les confirmations de réservation, les avis d'annulation,
  les rappels et les réinitialisations de mot de passe. Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `EMAIL_FROM` dans `environment_variables` et stockez `SMTP_PASSWORD` comme
  référence `secret_environment_variables` avant la mise en production.

- **Les rappels nécessitent un appel cron externe.** Les réservations fonctionnent sans jobs planifiés, mais
  cal.com n'envoie les rappels de réservation et de Workflow que lorsque quelque chose appelle ses
  endpoints `/api/cron/*` avec la clé partagée `CRON_API_KEY`. Sans clé, ces appels sont
  rejetés (401) et aucun rappel n'est jamais déclenché, alors que l'application semble par ailleurs saine.
  Pour activer les rappels, définissez `cron_api_key` (stocké dans Secret Manager) **ET** ajoutez une
  entrée `cron_jobs` qui appelle l'endpoint.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Cal.diy sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

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
| `application_name` | `caldiy` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Cal.com Scheduling` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `v6.2.0` | Tag de version de l'image Cal.diy — **aucun tag `latest` n'existe**, toujours épingler à une version spécifique. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build ; `prebuilt` utilise l'image officielle Cal.diy. Gardez la même que la variante Cloud Run : les deux publient sur le même tag d'image, donc une variante `prebuilt` écraserait la build `custom`. |
| `container_image` | `""` | Remplace l'URI de l'image du conteneur. Laisser vide pour utiliser la valeur par défaut. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="2Gi" }` | Limites de CPU et de mémoire ; augmenter `memory_limit` à `4Gi` pour une charge multi-utilisateurs en production. |
| `container_port` | `3000` | Port Next.js natif de Cal.diy. Ne pas modifier. |
| `container_protocol` | `http1` | Version du protocole HTTP : `http1` ou `h2c`. |
| `min_instance_count` | `1` | Réplicas minimum. GKE Autopilot n'a pas de scale-to-zero par défaut ; garder ≥ 1. |
| `max_instance_count` | `5` | Réplicas maximum (plafond de l'autoscaler). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. Doit être `true` lorsque `database_type != "NONE"`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Cal.diy dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |
| `timeout_seconds` | `300` | Secondes maximales pendant lesquelles l'équilibreur de charge attend une réponse de pod. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Squelette SMTP | Paramètres en texte clair. Définir `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM` ici. Définir également `NEXT_PUBLIC_WEBAPP_URL` une fois qu'un domaine personnalisé est connu. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. Utiliser pour `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE ; auto-découvert si vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; auto-généré si vide. |
| `service_type` | `LoadBalancer` | Comment le Service est exposé. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque le stockage par pod est activé. |
| `session_affinity` | `None` | `None` recommandé — les sessions Cal.diy sont stockées dans PostgreSQL. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu VPC. |
| `deployment_timeout` | `1800` | Secondes maximales pendant lesquelles Terraform attend la fin du déploiement. |

### Groupe 7 — Politiques de fiabilité {#group-7--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau de nœuds. Activer lorsque `max_instance_count > 1`. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations. |
| `enable_topology_spread` | `false` | Répartit les pods sur les zones de disponibilité. |
| `topology_spread_strict` | `false` | Rejette les pods si la répartition zonale ne peut être satisfaite. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limite les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/api/auth/session`, délai de 60s, fenêtre d'échec de 12 × 10s | Le `/api/auth/session` de Cal.diy renvoie 200 lorsque NextAuth est prêt. |
| `liveness_probe` / `health_check_config` | HTTP `/api/auth/session` | Sonde de vivacité après le démarrage. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `db-init`, `db-migrate` et `seed-app-store`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents. Nécessaire pour les rappels : en ajouter un qui appelle `/api/cron/*` avec `CRON_API_KEY` (voir `cron_api_key`). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires à exécuter avec le conteneur principal. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas requis pour Cal.diy — activer uniquement si un stockage personnalisé est nécessaire. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

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
| `stateful_pvc_enabled` | `false` | Active les modèles PVC (sélectionne automatiquement StatefulSet). |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `""` | Kubernetes StorageClass ; utilise la valeur par défaut du cluster si vide. |
| `stateful_headless_service` | `false` | Service sans tête pour des identités de pod DNS stables. |
| `stateful_pod_management_policy` | `OrderedReady` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `null` | GID du groupe de fichiers pour la propriété du volume. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Cal.diy nécessite PostgreSQL. |
| `application_database_name` | `calcom` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `calcom` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Installe les extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | `[]` | Liste des extensions à installer (par exemple, `['uuid-ossp']`). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécute du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. Si défini, mettez également à jour `NEXT_PUBLIC_WEBAPP_URL` dans `environment_variables`. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Cal.diy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utilise Redis pour la mise en cache de session. Recommandé lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique Cloud Armor. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Cal.diy. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (optionnels) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Cal.diy nécessite PostgreSQL avec Prisma ORM ; MySQL ou `NONE` interrompt les migrations de schéma et le démarrage. |
| `container_port` | `3000` | Critique | Le serveur Next.js de Cal.diy écoute sur le port 3000 ; toute autre valeur redirige mal les vérifications de santé et le routage du trafic. |
| `enable_cloudsql_volume` | `true` | Critique | Cal.diy se connecte à Cloud SQL via un socket Unix ; la désactivation supprime le socket et toutes les connexions à la base de données échouent. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline les données existantes. |
| `application_version` | version épinglée | Critique | `calcom/cal.diy` n'a pas de tag `latest` ; une version invalide échoue le pull de l'image. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation et peut écraser les données en direct lors des applys ultérieurs. |
| `NEXT_PUBLIC_WEBAPP_URL` | correspond à l'URL publique | Critique | Cal.diy l'intègre dans les chunks Next.js ; une non-concordance interrompt les rappels OAuth et les liens de réservation. |
| `NEXTAUTH_URL` | correspond à l'URL publique | Critique | NextAuth valide les URI de redirection OAuth par rapport à cela ; une non-concordance bloque toutes les connexions. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets — bloque toute planification de pod. |
| `container_resources.memory_limit` | `2Gi` minimum | Élevé | Le démarrage de Cal.diy (migration de la base de données + amorçage) nécessite ≥ 2 GiB ; OOM tue avant que l'application ne soit prête. |
| `startup_probe.failure_threshold` | `12` (période de 10s ≈ 2 min) | Élevé | Une réduction trop agressive tue les pods avant que `db-migrate` et `seed-app-store` ne soient terminés. |
| `enable_redis` | `true` pour multi-réplicas | Élevé | Sans Redis, les sessions sont par pod ; les utilisateurs sont déconnectés lorsque les requêtes atterrissent sur différents pods. |
| `redis_host` | requis lorsque `enable_redis=true` | Élevé | Un `redis_host` vide avec Redis activé injecte une URL mal formée ; les opérations de session échouent au moment de l'exécution. |
| `enable_pod_disruption_budget` | `true` lorsque `max > 1` | Moyen | Sans PDB, la maintenance du cluster peut expulser tous les pods simultanément. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être expulsé). |
| `enable_topology_spread` | activer pour la production | Moyen | Sans répartition, tous les réplicas peuvent s'exécuter dans une seule zone ; une défaillance de zone entraîne la panne du service. |
| `min_instance_count` | `1` | Moyen | Le démarrage initial de Cal.diy prend 3 à 5 minutes ; `0` avec scale-to-zero ajoute une latence de démarrage à froid significative. |
| `SMTP_HOST` / `EMAIL_FROM` | configuration SMTP réelle | Moyen | Sans SMTP valide, les confirmations de réservation, les rappels et les réinitialisations de mot de passe ne sont jamais livrés. |
| `organization_id` | définir explicitement pour VPC-SC | Moyen | Le périmètre VPC-SC n'est activé que lorsque `organization_id` est défini ; `enable_vpc_sc = true` seul n'a aucun effet. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Cal.diy partagée avec la
variante Cloud Run est décrite dans **[CalDiy_Common](CalDiy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : CalDiy sur GKE Autopilot](../labs/CalDiy_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cal.diy sur Google Cloud Run](CalDiy_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [CalDiy_Common — Configuration d'application partagée](CalDiy_Common.md) — la configuration partagée par les deux cibles de déploiement.
