---
title: "Cyclos sur GKE Autopilot"
description: "Référence de configuration pour déployer Cyclos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Cyclos_GKE.md @ 3055034 sha256:feb487bf29a3 -->

# Cyclos sur GKE Autopilot {#cyclos-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cyclos_GKE.png" alt="Cyclos sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cyclos est une plateforme bancaire et de paiement riche en fonctionnalités, utilisée par les institutions de microfinance,
les coopératives de crédit et les réseaux de monnaies complémentaires. Ce module déploie Cyclos sur **GKE
Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Cyclos et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute application
GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cyclos s'exécute comme une charge de travail web Java/Tomcat. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Java/Tomcat, 2 vCPU / 4 GiB recommandés, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Cyclos ne prend pas en charge MySQL ni SQL Server |
| Stockage d'objets | Cloud Storage | Un bucket de stockage de fichiers dédié (`<prefix>-cyclos-storage`) pour les fichiers et médias téléversés |
| Secrets | Secret Manager | Mot de passe de base de données généré automatiquement ; `ROOT_PASSWORD` pour l'installation des extensions en superutilisateur |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Cyclos exige six extensions PostgreSQL précises
  (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`). MySQL et SQL
  Server ne sont pas pris en charge.
- **Les extensions PostgreSQL sont installées automatiquement** par le job `db-init` avant le
  démarrage de Cyclos — vous n'avez pas besoin de les activer manuellement.
- **Le stockage de fichiers GCS est obligatoire.** Cyclos utilise Google Cloud Storage comme gestionnaire
  de contenu de fichiers (`cyclos.storedFileContentManager = gcs`). NFS est désactivé pour le conteneur
  Cyclos ; le nom du bucket GCS est injecté automatiquement.
- **`max_instance_count` vaut 1 par défaut.** Cyclos Community Edition exige une configuration
  Hazelcast pour évoluer horizontalement. N'augmentez cette valeur qu'après avoir configuré le clustering.
- **Gestion du schéma au démarrage.** Cyclos crée et migre son propre schéma PostgreSQL
  au premier démarrage (`cyclos.db.managed = true`). Le démarrage du premier déploiement prend 2 à 5 minutes, le temps
  de créer les extensions et d'initialiser le schéma.
- **Les sondes de santé ciblent `/api`.** Le point de terminaison `/api` ne renvoie HTTP 200 qu'une fois Cyclos
  entièrement initialisé, ce qui en fait le chemin de sonde le plus fiable.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cyclos {#a-gke-autopilot--the-cyclos-workload}

Les pods Cyclos sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods demandent
réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et le nombre maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Cyclos pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge
de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cyclos stocke toutes les données applicatives (comptes, transactions, membres) dans une instance Cloud
SQL for PostgreSQL 15 gérée. Lors du premier déploiement, un job d'initialisation se connecte en tant que
superutilisateur `postgres`, crée la base de données et l'utilisateur de l'application, et installe les six
extensions PostgreSQL requises. Les démarrages suivants utilisent l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=cyclos --database=cyclos --project "$PROJECT"
  # Inside psql — confirm required extensions are installed:
  # \dx
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques
et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage — gestionnaire de contenu de fichiers {#c-cloud-storage--file-content-manager}

Cyclos stocke tous les fichiers téléversés, photos de profil et pièces jointes de transactions dans un
bucket Cloud Storage dédié provisionné dans le cadre du déploiement. Le nom du bucket est
dérivé du préfixe de ressource du déploiement et injecté automatiquement sous la forme
`cyclos.storedFileContentManager.bucketName`. Le compte de service de la charge de travail reçoit
l'accès automatiquement.

- **Console :** Cloud Storage → Buckets → recherchez `<prefix>-cyclos-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name:cyclos-storage"
  gcloud storage ls gs://<cyclos-storage-bucket>/
  # Confirm the bucket env var is injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    sh -c 'echo $cyclos__storedFileContentManager__bucketName'
  ```

Consultez [App_GKE](App_GKE.md) pour les options de montage GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données Cyclos et celui du superutilisateur PostgreSQL (`ROOT_PASSWORD`) sont stockés comme
secrets Secret Manager et injectés dans les pods à l'exécution ; le texte en clair n'apparaît jamais dans la
configuration. Le job `db-init` utilise `ROOT_PASSWORD` pour installer les extensions ; Cyclos utilise
`DB_PASSWORD` pour se connecter à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load Balancing. Un domaine
personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée
afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur les adresses IP
statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

La sortie stdout/stderr des pods est acheminée vers Cloud Logging ; les métriques de GKE et de Cloud SQL vers Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cyclos {#3-cyclos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` s'exécute en tant que superutilisateur PostgreSQL et,
  de manière idempotente : crée l'utilisateur de base de données `cyclos`, crée la base de données de l'application,
  installe les six extensions requises (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`,
  `postgis`, `unaccent`) et accorde les privilèges nécessaires. Il peut être relancé sans risque.
- **Gestion du schéma au démarrage.** Cyclos crée et fait évoluer son propre schéma PostgreSQL
  au démarrage (`cyclos.db.managed = true`). Le démarrage du premier déploiement prend 2 à 5 minutes, le temps
  de construire le schéma. Les démarrages suivants sont plus rapides mais valident toujours le schéma.
- **Dimensionnement du tas JVM.** Définissez la variable d'environnement `CYCLOS_OPTIONS` pour plafonner l'utilisation
  du tas JVM — par exemple `{ CYCLOS_OPTIONS = "-Xmx3g" }` pour une limite mémoire de 4 GiB. Sans
  cela, la JVM peut consommer toute la mémoire disponible du conteneur et être tuée pour manque de mémoire (OOMKilled).

  ```bash
  # Confirm CYCLOS_OPTIONS is set on the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CYCLOS_OPTIONS
  ```
- **Chemin des sondes de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/api`, qui ne renvoie
  HTTP 200 qu'une fois Cyclos entièrement initialisé et le schéma appliqué. Utiliser un
  autre chemin (comme `/`) aboutit à une redirection 302 et la sonde ne réussit jamais.
- **Instance unique par défaut.** Cyclos Community Edition utilise par défaut un seul réplica
  (`max_instance_count = 1`). Augmenter ce nombre sans configuration du clustering Hazelcast
  entraîne un traitement non atomique des transactions et une corruption potentielle des données.
- **Clustering Hazelcast (facultatif).** Pour les déploiements à plusieurs réplicas, définissez
  `workload_type = "StatefulSet"` et configurez la découverte Hazelcast via
  `environment_variables`. Le fichier `hazelcast.xml` fourni utilise la découverte DNS Kubernetes via
  la variable d'environnement `CLUSTER_K8S_DNS`.
- **Envoi des e-mails.** Cyclos envoie des e-mails transactionnels (notifications, réinitialisations de mot de passe)
  via SMTP. Configurez les paramètres SMTP via `environment_variables` :

  ```bash
  environment_variables = {
    SMTP_HOST  = "smtp.sendgrid.net"
    SMTP_PORT  = "587"
    SMTP_USER  = "apikey"
    SMTP_SSL   = "true"
    EMAIL_FROM = "noreply@yourbank.example.com"
  }
  ```
  Utilisez `secret_environment_variables` pour `SMTP_PASSWORD`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls les paramètres
propres à Cyclos ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cyclos` | Nom de base des ressources. **Ne le modifiez pas après le premier déploiement.** |
| `application_display_name` | `Cyclos Community Edition` | Nom convivial affiché dans les annotations de la charge de travail GKE et l'interface de la plateforme. |
| `application_description` | `Cyclos Community Edition on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `4.16.17` | Tag de version de l'image Cyclos. Incrémentez-le pour déclencher un nouveau téléchargement de l'image et un nouveau déploiement progressif. |
| `display_name` | `Cyclos Community Edition` | Nom transmis à Cyclos_Common pour l'objet de configuration de l'application. |
| `description` | `Cyclos Banking System on GKE` | Description transmise à Cyclos_Common. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Spécification complète des ressources. **Remplacez-la par au moins `"2000m"` de CPU et `"2Gi"` de mémoire.** `"4Gi"` est recommandé en production. |
| `cpu_limit` | `2000m` | Variable de commodité transmise à Cyclos_Common. Remplacée en pratique par `container_resources`. |
| `memory_limit` | `4Gi` | Variable de commodité transmise à Cyclos_Common. Remplacée en pratique par `container_resources`. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Gardez ≥ 1 pour éviter les démarrages à froid lents de la JVM. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. Gardez `1` sauf si le clustering Hazelcast est configuré. |
| `container_port` | `8080` | Cyclos/Tomcat écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. Cyclos utilise par défaut TCP direct — activez-le uniquement si son besoin est vérifié. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. SMTP et `CYCLOS_OPTIONS` se configurent ici. Les variables Cyclos principales sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant pour une gestion cohérente des sessions. |
| `workload_type` | `null` | Sélectionne automatiquement Deployment. Définissez `StatefulSet` uniquement avec le clustering Hazelcast. |
| `network_tags` | `["nfsserver"]` | Tags de nœuds/pods ; conservés pour la compatibilité des règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active des PVC par pod. Pour Cyclos, pertinent uniquement avec un stockage de fichiers local (GCS par défaut). |
| `stateful_pvc_size` | `10Gi` | Stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes. |
| `stateful_headless_service` | `null` | Crée un Service headless pour un DNS stable — requis pour Hazelcast. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID fsGroup pour la propriété des volumes. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — des entiers nus sont lus comme des octets et bloquent l'ordonnancement. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. Activez-le uniquement lorsque `min_instance_count > 1`. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api`, 90s de délai, 60s de période, 5 échecs | Sonde de démarrage propre à Cyclos. Augmentez `failure_threshold` à `10` pour la création du schéma au premier déploiement. |
| `liveness_probe` | HTTP `/api`, 120s de délai, 60s de période, 3 échecs | Sonde de vivacité propre à Cyclos. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (crée les extensions, l'utilisateur et la base de données). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Cyclos. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas utilisé par le conteneur Cyclos (GCS sert de stockage de fichiers). Définissez `true` uniquement si vous avez besoin de NFS provisionné pour d'autres jobs. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données supplémentaire. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires (le bucket principal `cyclos-storage` est provisionné automatiquement). |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Moteur Cloud SQL. Cyclos exige PostgreSQL. Ne le remplacez pas par MySQL ou `NONE`. |
| `db_name` | `cyclos` | Nom de la base de données PostgreSQL transmis au job `db-init` propre à `Cyclos_Common` et injecté dans la configuration de l'application. **Immuable après le premier déploiement.** |
| `db_user` | `cyclos` | Utilisateur de l'application transmis à `Cyclos_Common`. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

Remarque : `application_database_name` / `application_database_user` (valeurs par défaut `gkeappdb` /
`gkeappuser`) forment une paire distincte transmise au provisionnement de base de données propre au socle
`App_GKE`. La base de données et l'utilisateur réellement utilisés par Cyclos (ceux auxquels l'application se connecte) sont déterminés par
`db_name` / `db_user` ci-dessus, provisionnés par le job `db-init` de `Cyclos_Common` — laissez la
paire `application_database_*` à ses valeurs par défaut.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. Repassez à `false` après une importation réussie. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Cyclos. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affichée sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant de joindre Cyclos. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` ou `POSTGRES_15` | Critique | Cyclos exige PostgreSQL. MySQL ou `NONE` empêche complètement le démarrage. |
| `db_name` / `db_user` | définis une fois (`cyclos` / `cyclos`) | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et rend orphelines toutes les données financières. |
| `max_instance_count` | `1` (par défaut) | Critique | Plus de 1 sans clustering Hazelcast entraîne des transactions non atomiques et une corruption potentielle des données. |
| `application_name` | `cyclos` (ne pas modifier) | Critique | Intégré à l'espace de noms GKE, au dépôt Artifact Registry, aux secrets Secret Manager et au nom du bucket GCS. Le modifier rend orphelines toutes les ressources. |
| Variable d'environnement `cyclos.storedFileContentManager` | `gcs` (codé en dur) | Critique | La surcharger avec `local` écrit les fichiers dans le stockage éphémère du pod ; tous les téléversements sont perdus au redémarrage. |
| `memory_limit` (dans `container_resources`) | `≥ 2Gi` (`4Gi` recommandé) | Critique | La JVM lève `OutOfMemoryError` ; le pod est tué pour manque de mémoire (code de sortie 137). |
| Variable d'environnement `CYCLOS_OPTIONS` | `-Xmx3g` pour une limite de 4 GiB | Critique | Sans `-Xmx`, la JVM croît jusqu'à consommer toute la mémoire du conteneur ; le pod est tué pour manque de mémoire sous charge. |
| `startup_probe.path` | `/api` | Critique | Un chemin erroné signifie que la sonde ne reçoit jamais de HTTP 200 ; GKE arrête le pod avant qu'il n'accepte du trafic. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent l'ordonnancement de tous les pods. |
| `enable_backup_import` | `false` après restauration | Élevé | Le laisser à `true` relance la restauration à chaque apply et écrase les données financières en production. |
| CPU de `container_resources` | `≥ 2000m` | Élevé | Le GC Java et le démarrage de Cyclos sont limités par le CPU ; un CPU insuffisant fait échouer la sonde de démarrage. |
| `startup_probe.failure_threshold` | `≥ 5` (porter à `10` pour le premier déploiement) | Élevé | Trop bas : la création des extensions par `db-init` prend 1 à 3 min ; le pod est arrêté avant que le schéma ne soit prêt. |
| `min_instance_count` | `1` | Élevé | `0` provoque des démarrages à froid de la JVM de 45 à 120 s ; les transactions bancaires expirent en attendant le préchauffage. |
| `enable_pod_disruption_budget` | `false` sauf si `min_instance_count > 1` | Élevé | Un PDB à `1/1` bloque le drainage des nœuds ; les mises à niveau d'Autopilot restent bloquées indéfiniment. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les accès d'administration | Moyen | Sinon, l'interface d'administration de Cyclos est joignable publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour la conservation réglementaire des données financières. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à Cyclos, partagée avec la variante Cloud Run, est décrite dans
**[Cyclos_Common](Cyclos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cyclos sur GKE Autopilot](../labs/Cyclos_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cyclos sur Google Cloud Run](Cyclos_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Cyclos Common — Configuration applicative partagée](Cyclos_Common.md) — la configuration partagée par les deux cibles de déploiement.
