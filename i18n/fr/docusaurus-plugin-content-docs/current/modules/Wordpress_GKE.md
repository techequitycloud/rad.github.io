---
title: "WordPress sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de WordPress sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wordpress_GKE.md @ 15fd4c7 sha256:c3f51d734052 -->

# WordPress sur GKE Autopilot {#wordpress-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wordpress_GKE.png" alt="WordPress sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

WordPress est le système de gestion de contenu le plus populaire au monde, alimentant plus de 43 % de tous les sites web à l'échelle mondiale. Ce module déploie WordPress sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par WordPress et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

WordPress fonctionne comme une charge de travail web PHP/Apache. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 1 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — WordPress ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Répertoire `wp-content` (téléchargements, plugins, thèmes) partagé entre toutes les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket média `wp-uploads` dédié |
| Cache | Redis | Cache d'objets optionnel ; activé par défaut pour réduire la charge de la base de données |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré et huit clés et sels d'authentification WordPress |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ; la sélection de PostgreSQL ou `NONE` empêche le démarrage.
- **NFS est requis pour un site fonctionnel.** WordPress stocke les médias téléchargés, les plugins installés et les thèmes actifs sous `wp-content/`. Sans un volume NFS partagé, chaque pod a un `wp-content` isolé et éphémère — les plugins sont perdus au redémarrage et les réplicas servent des versions différentes du site.
- **Huit clés et sels d'authentification WordPress sont auto-générés** et stockés dans Secret Manager ; vous ne les définissez jamais en texte clair.
- **Le cache d'objets Redis est activé par défaut.** Réduit la charge de la base de données en mettant en cache les résultats des requêtes coûteuses. Nécessite qu'un hôte Redis soit accessible (par défaut, l'adresse IP du serveur NFS lorsque `redis_host` est laissé vide).
- **L'affinité de session est `ClientIP`.** WordPress utilise les sessions PHP pour le panneau d'administration ; les requêtes d'un navigateur doivent être épinglées à un seul pod.
- **La sonde de démarrage est TCP, pas HTTP.** WordPress peut ne pas encore répondre aux requêtes HTTP pendant l'initialisation de la base de données au premier démarrage ; une sonde TCP vérifie uniquement que le port d'Apache est ouvert.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail WordPress {#a-gke-autopilot--the-wordpress-workload}

Les pods WordPress sont planifiés sur Autopilot, qui facture le CPU/la mémoire réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail WordPress pour voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, le scaling et le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WordPress stocke toutes les données du site (articles, utilisateurs, paramètres, commentaires) dans une instance gérée de Cloud SQL pour MySQL 8.0. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** via un socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `wp-content` de WordPress est mappé sur un partage **Filestore (NFS)** monté dans chaque pod afin que toutes les réplicas partagent les mêmes plugins, thèmes et médias téléchargés. Un bucket **Cloud Storage** dédié (`wp-uploads`) est également provisionné pour les ressources multimédias ; le compte de service de la charge de travail se voit accorder l'accès automatiquement.

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

Voir [App_GKE](App_GKE.md) pour les options de provisionnement NFS, GCS Fuse et CMEK.

### D. Cache d'objets Redis {#d-redis-object-cache}

Redis prend en charge le cache d'objets de WordPress via le plugin **WP Redis**, stockant les résultats des requêtes de base de données coûteuses en mémoire et réduisant considérablement les temps de chargement des pages et la charge de la base de données sur les sites très fréquentés. Lorsque `redis_host` est laissé vide et que NFS est activé, l'adresse IP du serveur NFS est utilisée comme point de terminaison Redis (le modèle de déploiement partagé par défaut).

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

Le mot de passe de la base de données WordPress et les huit clés et sels d'authentification WordPress sont stockés en tant que secrets Secret Manager et injectés dans les pods au moment de l'exécution ; les valeurs en texte clair n'apparaissent jamais dans la configuration ou l'état Terraform.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # List all secrets belonging to this deployment:
  gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application WordPress {#3-wordpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation utilisant l'image `mysql:8.0-debian` crée la base de données et l'utilisateur WordPress et accorde les privilèges avant le démarrage de l'application. Il s'exécute à **chaque** `tofu apply` car il est idempotent — il ignore en toute sécurité les étapes déjà terminées.
- **Clés et sels d'authentification.** Huit secrets de sécurité WordPress de 64 caractères (clé d'authentification, clé d'authentification sécurisée, clé de connexion, clé nonce et leurs sels correspondants) sont générés automatiquement lors du premier déploiement et stockés dans Secret Manager. La rotation de ces secrets invalide immédiatement toutes les sessions de navigateur actives — chaque utilisateur connecté sera déconnecté.
- **Configuration PHP intégrée au moment de la build.** `php_memory_limit`, `upload_max_filesize` et `post_max_size` sont appliqués à l'image du conteneur au moment de la build Cloud Build. Les modifier déclenche une nouvelle build d'image et une mise à jour progressive.
- **Préfixe de table WordPress.** `WORDPRESS_TABLE_PREFIX` est automatiquement défini sur `wp_`. Ne le remplacez via `environment_variables` que lors de la migration d'une base de données existante avec un préfixe non standard.
- **Comportement de la sonde.** La sonde de démarrage utilise TCP (vérification de l'ouverture du port) plutôt que HTTP pour éviter les échecs pendant la phase d'initialisation de la base de données de WordPress. La sonde de vivacité interroge `/wp-admin/install.php` — qui renvoie HTTP 200, que WordPress soit fraîchement installé ou déjà configuré — avec un délai initial de 300 secondes pour permettre au job `db-init` de se terminer. Ne réduisez pas `failure_threshold` en dessous de 10 pour la sonde de démarrage sur les déploiements de production.
- **WP_HOME et WP_SITEURL.** Ces deux constantes sont définies au moment de l'exécution à partir de `GKE_SERVICE_URL` injecté par la plateforme, de sorte qu'elles priment sur les lignes `siteurl`/`home` stockées par WordPress lors de l'installation. Si l'adresse de la passerelle change, le site la suit au lieu de rediriger vers un hôte obsolète.
- **Tâches planifiées.** Le pseudo-cron `wp-cron` intégré de WordPress repose sur le trafic du site pour se déclencher. Pour les sites de production avec des exigences de disponibilité constantes, désactivez `wp-cron` dans `wp-config.php` et planifiez `wp cron event run --due-now` comme une entrée `cron_jobs`.

  Inspecter les tâches planifiées :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour WordPress sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wordpress` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Wordpress` | Nom convivial affiché dans la console. |
| `application_description` | `Wordpress CMS on GKE` | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image WordPress passé comme argument de build `APP_VERSION`. Utilisez une version épinglée (par exemple `6.7.1`) en production pour des builds reproductibles. |
| `php_memory_limit` | `512M` | `memory_limit` PHP intégré à l'image du conteneur au moment de la build. Augmentez pour les charges de travail de plugins lourds (par exemple WooCommerce, Elementor). |
| `upload_max_filesize` | `64M` | Taille maximale d'un seul téléchargement de fichier. Doit être ≤ `post_max_size`. |
| `post_max_size` | `64M` | Taille maximale de toutes les données POST dans une seule requête HTTP. Doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; 1 vCPU est suffisant pour les sites typiques. |
| `memory_limit` | `2Gi` | Mémoire par pod ; 2 GiB recommandés pour WordPress avec des plugins. |
| `min_instance_count` | `1` | Réplicas minimum. Gardez ≥ 1 pour éviter la latence de démarrage à froid. |
| `max_instance_count` | `1` | Réplicas maximum. N'augmentez qu'après avoir vérifié que tous les plugins installés gèrent correctement l'accès concurrentiel des pods. |
| `container_port` | `80` | WordPress/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. Requis. |
| `enable_vertical_pod_autoscaling` | `false` | Laissez Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `WORDPRESS_TABLE_PREFIX`, `WORDPRESS_DEBUG` et les variables Redis sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. Huit secrets d'authentification WordPress sont injectés automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions PHP WordPress dans le panneau d'administration. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activez les PVC par pod lors de l'utilisation de StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. Les bibliothèques multimédias WordPress augmentent rapidement — prévoyez 50 à 200 GiB sur les sites actifs. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur pour le PVC par pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonnez les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. La valeur par défaut est `false` car le `max_instance_count` par défaut est 1 ; n'activez que lorsque plusieurs réplicas sont en cours d'exécution. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 pour laisser une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartissez les pods sur plusieurs zones pour les déploiements multi-réplicas. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s, seuil 20 | Sonde TCP sur le port 80 — évite les échecs HTTP pendant l'initialisation de la base de données au premier démarrage. Ne réduisez pas `failure_threshold` en dessous de 10. |
| `liveness_probe` | HTTP `/wp-admin/install.php`, délai de 300s | Sonde HTTP ; le délai initial de 300 secondes permet au job `db-init` de se terminer. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Fournir une liste non vide remplace entièrement la valeur par défaut. |
| `cron_jobs` | `[]` | Tâches planifiées récurrentes. Utilisez pour remplacer `wp-cron` par un calendrier dédié pour une exécution fiable du cron WordPress. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard de Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour WordPress `wp-content` (garder activé). |
| `nfs_mount_path` | `/var/www/html/wp-content` | Chemin de montage à l'intérieur du conteneur. Le script de démarrage crée un lien symbolique `wp-content` ici. |

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
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS (modèle partagé par défaut) ; définissez explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` (résolu en `MYSQL_8_0` par Wordpress_Common) | Fixe — ne pas modifier. WordPress nécessite MySQL. |
| `application_database_name` | `wp` | Nom de la base de données. **Immuable après le premier déploiement.** |
| `application_database_user` | `wp` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restauration à partir d'une sauvegarde lors du déploiement. Remarque : ce module utilise `backup_file` (nom de fichier dans le bucket de sauvegarde GCS), pas `backup_uri`. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant WordPress. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. Fortement recommandé — les pages de connexion WordPress sont des cibles privilégiées pour les attaques par force brute. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services de la phase Cloud Deploy. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre WordPress. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. Lors d'un premier apply d'un nouveau cluster inline, c'est `false` — exécutez apply une deuxième fois pour terminer le déploiement. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (auto-défini) | Critique | WordPress nécessite MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les plugins/thèmes/téléchargements sont isolés par pod et perdus au redémarrage ; les déploiements multi-réplicas servent des versions de site incohérentes. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données WordPress. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_file` valide dans le bucket GCS fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `container_image_source` | `custom` | Élevé | L'image WordPress personnalisée connecte le lien symbolique NFS et le socket Cloud SQL. L'utilisation de `prebuilt` avec l'image WordPress standard interrompt la connectivité du socket Cloud SQL. |
| `nfs_mount_path` | `/mnt/nfs` (ne pas modifier après le déploiement) | Élevé | Le script de démarrage crée un lien symbolique `wp-content` vers ce chemin ; le modifier après le déploiement initial rompt le lien symbolique. |
| `memory_limit` | `2Gi` | Élevé | WordPress avec des plugins populaires (WooCommerce, Elementor) nécessite au moins 2 GiB ; une mémoire insuffisante provoque des erreurs fatales PHP. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les utilisateurs administrateurs sont déconnectés à chaque requête qui atterrit sur un pod différent. |
| `enable_redis` | `true` | Moyen | Avec plusieurs réplicas, les caches en mémoire isolés par pod entraînent des requêtes de base de données redondantes. |
| `redis_host` | `""` (IP NFS) ou explicite | Élevé | Pas de point de terminaison Redis valide si Redis est activé, NFS est désactivé et aucun hôte n'est défini. |
| `enable_cloud_armor` | activer pour les sites publics | Élevé | Les pages de connexion WordPress (`/wp-login.php`, `xmlrpc.php`) sont des cibles privilégiées pour la force brute. |
| `php_memory_limit` | `512M` | Moyen | Doit être dans `memory_limit` ; trop faible provoque des échecs d'activation de plugins et des écrans blancs de la mort. |
| `min_instance_count` | `1` | Moyen | `0` provoque des démarrages à froid de 30 à 60 secondes et des erreurs visibles potentielles pour le premier visiteur après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour les sites de commerce électronique ou à fort contenu ; une semaine d'articles/commandes perdue. |
| `stateful_pvc_size` | `10Gi` (augmenter pour la production) | Moyen | Les bibliothèques multimédias WordPress augmentent rapidement ; prévoyez 50 à 200 GiB pour les sites actifs. |
| `enable_network_segmentation` | activer pour les clusters partagés | Moyen | Sans NetworkPolicy, tout pod du cluster peut atteindre directement les pods WordPress. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (un seul pod ne peut pas être évincé). |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à WordPress partagée avec la
variante Cloud Run est décrite dans **[Wordpress_Common](Wordpress_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WordPress sur GKE Autopilot](../labs/Wordpress_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WordPress sur Google Cloud Run](Wordpress_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [WordPress Common — Configuration d'application partagée](Wordpress_Common.md) — la configuration partagée par les deux cibles de déploiement.
