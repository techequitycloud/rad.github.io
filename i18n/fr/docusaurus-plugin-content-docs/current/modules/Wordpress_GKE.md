---
title: "WordPress sur GKE Autopilot"
description: "Référence de configuration pour déployer WordPress sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Wordpress_GKE.md @ 3055034 sha256:3edf7217cc3c -->

# WordPress sur GKE Autopilot {#wordpress-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wordpress_GKE.png" alt="WordPress sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

WordPress est le système de gestion de contenu le plus populaire au monde, utilisé par plus de 43 % de tous les sites web. Ce module déploie WordPress sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise WordPress et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute application GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

WordPress s'exécute comme une charge de travail web PHP/Apache. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — WordPress ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Répertoire `wp-content` (fichiers téléversés, extensions, thèmes) partagé entre tous les réplicas |
| Stockage objet | Cloud Storage | Un bucket média `wp-uploads` dédié |
| Cache | Redis | Cache d'objets facultatif ; activé par défaut pour réduire la charge sur la base de données |
| Secrets | Secret Manager | Mot de passe de la base de données et huit clés et sels d'authentification WordPress générés automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ; choisir PostgreSQL ou `NONE` empêche le démarrage.
- **NFS est indispensable à un site fonctionnel.** WordPress stocke les médias téléversés, les extensions installées et les thèmes actifs sous `wp-content/`. Sans volume NFS partagé, chaque pod dispose d'un `wp-content` isolé et éphémère — les extensions sont perdues au redémarrage et les réplicas servent des versions différentes du site.
- **Huit clés et sels d'authentification WordPress sont générés automatiquement** et stockés dans Secret Manager ; vous ne les saisissez jamais en clair.
- **Le cache d'objets Redis est activé par défaut.** Il réduit la charge sur la base de données en mettant en cache les résultats des requêtes coûteuses. Il nécessite un hôte Redis joignable (par défaut l'adresse IP du serveur NFS lorsque `redis_host` est laissé vide).
- **L'affinité de session est `ClientIP`.** WordPress utilise des sessions PHP pour le panneau d'administration ; les requêtes d'un navigateur doivent être rattachées à un seul pod.
- **La sonde de démarrage est TCP, pas HTTP.** WordPress peut ne pas encore répondre aux requêtes HTTP pendant l'initialisation de la base de données au premier démarrage ; une sonde TCP vérifie seulement que le port d'Apache est ouvert.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail WordPress {#a-gke-autopilot--the-wordpress-workload}

Les pods WordPress sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail WordPress pour voir les pods, les révisions et les événements. Kubernetes Engine → Services et entrées affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WordPress stocke toutes les données du site (articles, utilisateurs, paramètres, commentaires) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent de façon privée via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte qu'aucune adresse IP publique n'est exposée. Au premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `wp-content` de WordPress est placé sur un partage **Filestore (NFS)** monté dans chaque pod, afin que tous les réplicas partagent les mêmes extensions, thèmes et médias téléversés. Un bucket **Cloud Storage** dédié (`wp-uploads`) est également provisionné pour les ressources média ; l'accès est accordé automatiquement au compte de service de la charge de travail.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le bucket média.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  # Confirm PHP limits (useful for diagnosing upload failures):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- php -r "
    echo 'memory_limit: ' . ini_get('memory_limit') . PHP_EOL;
    echo 'upload_max_filesize: ' . ini_get('upload_max_filesize') . PHP_EOL;
    echo 'post_max_size: ' . ini_get('post_max_size') . PHP_EOL;
  "
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache d'objets Redis {#d-redis-object-cache}

Redis sert de cache d'objets à WordPress via l'extension **WP Redis**, en conservant en mémoire les résultats des requêtes coûteuses vers la base de données, ce qui réduit considérablement les temps de chargement des pages et la charge sur la base de données des sites très fréquentés. Lorsque `redis_host` est laissé vide et que NFS est activé, l'adresse IP du serveur NFS est utilisée comme point de terminaison Redis (le modèle de déploiement partagé par défaut).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # From inside a WordPress pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    sh -c 'redis-cli -h $WP_REDIS_HOST -p $WP_REDIS_PORT ping'
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données WordPress ainsi que les huit clés et sels d'authentification WordPress sont stockés en tant que secrets Secret Manager et injectés dans les pods à l'exécution ; les valeurs en clair n'apparaissent jamais dans la configuration ni dans l'état Terraform.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # List all secrets belonging to this deployment:
  gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques de GKE et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application WordPress {#3-wordpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation utilisant l'image `mysql:8.0-debian` crée la base de données et l'utilisateur WordPress et accorde les privilèges avant le démarrage de l'application. Il s'exécute à **chaque** `tofu apply` car il est idempotent — il ignore sans risque les étapes déjà effectuées.
- **Clés et sels d'authentification.** Huit secrets de sécurité WordPress de 64 caractères (auth key, secure auth key, logged-in key, nonce key et les sels correspondants) sont générés automatiquement au premier déploiement et stockés dans Secret Manager. La rotation de ces secrets invalide immédiatement toutes les sessions de navigateur actives — tous les utilisateurs connectés seront déconnectés.
- **Configuration PHP figée au build.** `php_memory_limit`, `upload_max_filesize` et `post_max_size` sont appliqués à l'image du conteneur au moment du build Cloud Build. Les modifier déclenche un nouveau build d'image et une mise à jour progressive.
- **Préfixe des tables WordPress.** `WORDPRESS_TABLE_PREFIX` est défini automatiquement à `wp_`. Ne le remplacez via `environment_variables` que lors de la migration d'une base de données existante utilisant un préfixe non standard.
- **Comportement des sondes.** La sonde de démarrage utilise TCP (vérification de port ouvert) plutôt que HTTP afin d'éviter les échecs pendant la phase d'initialisation de la base de données de WordPress. La sonde de vivacité interroge `/wp-admin/install.php` — qui renvoie HTTP 200 que WordPress vienne d'être installé ou soit déjà configuré — avec un délai initial de 300 secondes pour laisser le job `db-init` se terminer. Ne réduisez pas `failure_threshold` en dessous de 10 pour la sonde de démarrage des déploiements de production.
- **WP_HOME et WP_SITEURL.** Sur GKE, l'URL du service n'est pas connue au moment du plan ; ces constantes ne sont donc pas définies automatiquement. WordPress découvre l'URL du site à partir de la base de données lors de la configuration initiale. Définissez `WP_HOME` via `environment_variables` si vous devez imposer une URL précise avant l'installation de WordPress.
- **Tâches planifiées.** Le pseudo-cron intégré `wp-cron` de WordPress dépend du trafic du site pour se déclencher. Pour les sites de production ayant des exigences de disponibilité constantes, désactivez `wp-cron` dans `wp-config.php` et planifiez `wp cron event run --due-now` comme entrée `cron_jobs`.

  Inspectez les tâches planifiées :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à WordPress ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

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
| `application_name` | `wordpress` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Wordpress` | Nom convivial affiché dans la console. |
| `application_description` | `Wordpress CMS on GKE` | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image WordPress transmis comme argument de build `APP_VERSION`. Utilisez une version figée (par ex. `6.7.1`) en production pour des builds reproductibles. |
| `php_memory_limit` | `512M` | `memory_limit` PHP figé dans l'image du conteneur au build. Augmentez-le pour les charges de travail riches en extensions (par ex. WooCommerce, Elementor). |
| `upload_max_filesize` | `64M` | Taille maximale d'un fichier téléversé. Doit être ≤ `post_max_size`. |
| `post_max_size` | `64M` | Taille maximale de l'ensemble des données POST d'une requête HTTP. Doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; 1 vCPU suffit pour les sites courants. |
| `memory_limit` | `2Gi` | Mémoire par pod ; 2 GiB recommandés pour WordPress avec des extensions. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Gardez-le ≥ 1 pour éviter la latence de démarrage à froid. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. Augmentez-le seulement après avoir vérifié que toutes les extensions installées gèrent correctement l'accès concurrent depuis plusieurs pods. |
| `container_port` | `80` | WordPress/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. Obligatoire. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `WORDPRESS_TABLE_PREFIX`, `WORDPRESS_DEBUG` et les variables Redis sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. Huit secrets d'authentification WordPress sont injectés automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions PHP de WordPress dans le panneau d'administration. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active des PVC par pod lors de l'utilisation d'un StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. Les médiathèques WordPress grossissent vite — prévoyez 50 à 200 GiB pour les sites actifs. |
| `stateful_pvc_mount_path` | `/data` | Chemin dans le conteneur pour le PVC par pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent toute planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. La valeur par défaut est `false` car le `max_instance_count` par défaut vaut 1 ; activez-le uniquement lorsque vous exécutez plusieurs réplicas. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 pour laisser une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones pour les déploiements à plusieurs réplicas. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai 30s, seuil 20 | Sonde TCP sur le port 80 — évite les échecs HTTP pendant l'initialisation de la base de données au premier démarrage. Ne réduisez pas `failure_threshold` en dessous de 10. |
| `liveness_probe` | HTTP `/wp-admin/install.php`, délai 300s | Sonde HTTP ; le délai initial de 300 secondes laisse le temps au job `db-init`. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Fournir une liste non vide remplace entièrement celui par défaut. |
| `cron_jobs` | `[]` | Tâches planifiées récurrentes. À utiliser pour remplacer `wp-cron` par une planification dédiée afin d'exécuter le cron WordPress de façon fiable. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le `wp-content` de WordPress (à laisser activé). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. Le script de démarrage crée un lien symbolique de `wp-content` vers ce chemin. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket média `wp-uploads`. |
| `storage_buckets` | `[{name_suffix="data"}]` | Buckets supplémentaires. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour le cache d'objets WordPress. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS (modèle partagé par défaut) ; définissez-la explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` (résolu en `MYSQL_8_0` par Wordpress_Common) | Fixe — ne pas modifier. WordPress exige MySQL. |
| `application_database_name` | `wp` | Nom de la base de données. **Immuable après le premier déploiement.** |
| `application_database_user` | `wp` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 jours pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. Remarque : ce module utilise `backup_file` (nom du fichier dans le bucket de sauvegarde GCS), et non `backup_uri`. |

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
| `enable_iap` | `false` | Exige une connexion Google devant WordPress. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. Fortement recommandé — les pages de connexion WordPress sont des cibles privilégiées des attaques par force brute. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services d'étape Cloud Deploy. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à WordPress. |
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
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. Lors du premier apply d'un nouveau cluster inline, cette valeur est `false` — exécutez l'apply une seconde fois pour terminer le déploiement. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (défini automatiquement) | Critical | WordPress exige MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critical | Sans stockage partagé, les extensions, thèmes et fichiers téléversés sont isolés par pod et perdus au redémarrage ; les déploiements à plusieurs réplicas servent des versions incohérentes du site. |
| `application_database_name` / `_user` | défini une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données WordPress. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide dans le bucket GCS fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers nus sont des octets et bloquent toute planification. |
| `container_image_source` | `custom` | High | L'image WordPress personnalisée met en place le lien symbolique NFS et le socket Cloud SQL. Utiliser `prebuilt` avec l'image WordPress standard rompt la connectivité au socket Cloud SQL. |
| `nfs_mount_path` | `/mnt/nfs` (ne pas modifier après le déploiement) | High | Le script de démarrage crée un lien symbolique de `wp-content` vers ce chemin ; le modifier après le déploiement initial casse le lien symbolique. |
| `memory_limit` | `2Gi` | High | WordPress avec des extensions populaires (WooCommerce, Elementor) nécessite au moins 2 GiB ; une mémoire insuffisante provoque des erreurs fatales PHP. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les administrateurs sont déconnectés à chaque requête qui aboutit sur un autre pod. |
| `enable_redis` | `true` | Medium | Avec plusieurs réplicas, des caches en mémoire isolés par pod provoquent des requêtes redondantes vers la base de données. |
| `redis_host` | `""` (IP NFS) ou explicite | High | Aucun point de terminaison Redis valide si Redis est activé, NFS désactivé et aucun hôte défini. |
| `enable_cloud_armor` | à activer pour les sites publics | High | Les pages de connexion WordPress (`/wp-login.php`, `xmlrpc.php`) sont des cibles privilégiées des attaques par force brute. |
| `php_memory_limit` | `512M` | Medium | Doit rester dans les limites de `memory_limit` ; une valeur trop basse provoque des échecs d'activation d'extensions et des écrans blancs. |
| `min_instance_count` | `1` | Medium | `0` entraîne des démarrages à froid de 30 à 60 secondes et peut provoquer des erreurs visibles pour le premier visiteur après une période d'inactivité. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les sites e-commerce ou riches en contenu ; une semaine d'articles ou de commandes perdue. |
| `stateful_pvc_size` | `10Gi` (à augmenter en production) | Medium | Les médiathèques WordPress grossissent vite ; prévoyez 50 à 200 GiB pour les sites actifs. |
| `enable_network_segmentation` | à activer pour les clusters partagés | Medium | Sans NetworkPolicy, n'importe quel pod du cluster peut joindre directement les pods WordPress. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et duplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à WordPress, partagée avec la
variante Cloud Run, est décrite dans **[Wordpress_Common](Wordpress_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WordPress sur GKE Autopilot](../labs/Wordpress_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WordPress sur Google Cloud Run](Wordpress_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [WordPress Common — Configuration applicative partagée](Wordpress_Common.md) — la configuration partagée par les deux cibles de déploiement.
