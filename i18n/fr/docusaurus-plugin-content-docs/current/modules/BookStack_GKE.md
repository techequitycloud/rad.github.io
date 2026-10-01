---
title: "BookStack sur GKE Autopilot"
description: "Référence de configuration pour déployer BookStack sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/BookStack_GKE.md @ 3055034 sha256:6fb0dcd4d577 -->

# BookStack sur GKE Autopilot {#bookstack-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/BookStack_GKE.png" alt="BookStack sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

BookStack est une plateforme de wiki et de documentation gratuite et open source,
sous licence MIT, construite sur Laravel (PHP), qui organise le contenu en
Shelves → Books → Chapters → Pages, avec édition WYSIWYG et Markdown, recherche en
texte intégral, révisions de pages et permissions granulaires. Ce module déploie
BookStack sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise BookStack et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

BookStack s'exécute comme une charge de travail web PHP sur GKE Autopilot. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP (LinuxServer), 1 vCPU / 2 GiB par défaut, réplica unique (adossé à NFS) |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — BookStack ne prend pas en charge PostgreSQL ni d'autres moteurs |
| Stockage objet | Cloud Storage | Un bucket `data` dédié (`gcs-bookstack<tenant>-data`) provisionné automatiquement |
| Fichiers persistants | Filestore / NFS | Images et pièces jointes téléversées conservées dans `/var/lib/bookstack` |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; BookStack utilise le pilote de cache/session local |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé, certificat géré et IP statique par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée (`database_type = "MYSQL_8_0"`) ; PostgreSQL n'est pas pris en
  charge et choisir un autre moteur empêche le démarrage.
- **L'image précompilée `linuxserver/bookstack` est utilisée directement.** Il n'y a
  pas de Cloud Build personnalisé ; l'image officielle LinuxServer.io est mise en miroir
  dans Artifact Registry (`enable_image_mirroring = true`) et déployée telle quelle.
- **Le conteneur écoute sur le port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **La persistance NFS des fichiers téléversés est activée par défaut.**
  `enable_nfs = true` monte NFS sur `/var/lib/bookstack` afin que les images et pièces
  jointes téléversées survivent aux redémarrages, aux redéploiements et au
  réordonnancement des pods. Comme BookStack est adossé à NFS, le Deployment utilise
  la stratégie de mise à jour `Recreate` (un seul pod sur le volume partagé).
- **Un réplica unique est maintenu** (`min_instance_count = 1`, `max_instance_count = 1` ;
  GKE ne permet pas la mise à zéro). Ne dépassez pas un pod sans coordination externe
  des sessions et du cache — plusieurs pods sur le même volume NFS et la même base se
  retrouvent en interblocage.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application Laravel
  est générée une seule fois et stockée dans Secret Manager ; la faire tourner rend
  indéchiffrables toutes les valeurs chiffrées de la base.
- **L'image exécute automatiquement `php artisan migrate --force` au démarrage**, de
  sorte que le schéma est créé au premier démarrage après que `db-init` a provisionné
  la base de données et l'utilisateur — il n'y a pas de job de migration distinct.
- **Un administrateur par défaut est créé** par l'image LinuxServer :
  `admin@admin.com` avec le mot de passe `password`. Modifiez-le immédiatement à la
  première connexion.
- **GKE se connecte à Cloud SQL via le sidecar Auth Proxy** sur `127.0.0.1:3306`
  (`enable_cloudsql_volume = true`), et le câblage GKE remplace `DB_HOST = "127.0.0.1"`.
- **Un domaine personnalisé, un certificat géré et une IP statique réservée sont
  activés par défaut** (`enable_custom_domain = true`, `reserve_static_ip = true`),
  avec `session_affinity = "ClientIP"` pour des sessions d'interface persistantes.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail BookStack {#a-gke-autopilot--the-bookstack-workload}

Les pods BookStack sont ordonnancés sur Autopilot, qui facture le CPU et la mémoire
que les pods demandent réellement. Comme l'application est adossée à NFS, la charge
de travail s'exécute comme un Deployment à réplica unique utilisant la stratégie
`Recreate`.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  BookStack pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy/<service-name> -n "$NAMESPACE"    # strategy, events
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

BookStack stocke toutes les données de l'application (livres, pages, utilisateurs,
révisions, permissions) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods y
accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:3306` (`enable_cloudsql_volume = true`) ; aucune IP publique n'est exposée.
Lors du premier déploiement, un Job d'initialisation crée la base de données et
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=bookstack --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation des mots de
passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (valeur par défaut de `storage_buckets` :
`name_suffix = "data"`, ce qui donne `gcs-bookstack<tenant>-data`) est provisionné
automatiquement. Le compte de service de la charge de travail y reçoit l'accès. Des
buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache et sessions facultatifs) {#d-redis-optional-cache--sessions}

Redis est **désactivé par défaut** (`enable_redis = false`) ; BookStack utilise ses
pilotes de cache et de session locaux. Lorsque `enable_redis = true` est défini, la
couche partagée injecte `REDIS_HOST` et `REDIS_PORT`. Lorsque `redis_host` est laissé
vide et que `enable_nfs` vaut true, l'IP Redis co-hébergée sur la VM du serveur NFS
est utilisée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the DB wiring injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|REDIS_'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
l'**`APP_KEY`** Laravel (`base64:<44-char base64>`), utilisé pour chiffrer toutes les
données que BookStack stocke sous forme chiffrée. Le mot de passe de la base de
données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base figure dans les [sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
avec un domaine personnalisé et un certificat géré par Google
(`enable_custom_domain = true`), et une IP statique est réservée
(`reserve_static_ip = true`) afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
et Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application BookStack {#3-bookstack-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il détecte le socket
  Cloud SQL ou le point de terminaison TCP, attend que MySQL soit joignable, crée la
  base de données et l'utilisateur de l'application, accorde les privilèges, vérifie
  que l'utilisateur de l'application peut se connecter, puis arrête proprement le
  sidecar Cloud SQL Auth Proxy. Le job est idempotent et peut être relancé sans risque
  (`max_retries = 3`).
- **Migration automatique du schéma au démarrage.** L'image BookStack de LinuxServer
  exécute automatiquement `php artisan migrate --force` à chaque démarrage du
  conteneur, de sorte que le schéma est créé au premier démarrage et mis à niveau lors
  des démarrages suivants — il n'y a **pas de job de migration distinct**.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application Laravel
  est générée une seule fois et écrite dans Secret Manager. La faire tourner rend
  définitivement indéchiffrables toutes les valeurs chiffrées de la base (secrets
  d'authentification à deux facteurs, certains paramètres). Ne la faites tourner que
  pendant une fenêtre de maintenance planifiée, avec un plan de re-chiffrement.
- **Administrateur au premier lancement.** L'image crée un compte administrateur par
  défaut, `admin@admin.com` / `password`. Modifiez le mot de passe (et idéalement
  l'e-mail) immédiatement après la première connexion.
- **Les fichiers téléversés résident sur NFS.** Les images, pièces jointes et autres
  fichiers téléversés sont stockés sur le système de fichiers sous
  `/var/lib/bookstack`, adossé à NFS par défaut. Le Deployment utilise donc la
  stratégie `Recreate` afin qu'un seul pod écrive à tout moment sur le volume partagé
  — ne passez pas à plusieurs réplicas sans coordination externe.
- **Chemin de santé.** La sonde de vivacité cible `/status` par défaut — le point de
  terminaison de santé JSON non authentifié de BookStack, qui indique l'état de
  l'application, de la base de données, du cache et des sessions. La sonde de
  démarrage est un contrôle TCP. Prévoyez une fenêtre généreuse au premier démarrage
  (délai initial de 300 secondes) pour les migrations automatiques.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à BookStack ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

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
| `application_name` | `bookstack` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `BookStack` | Nom lisible affiché dans la console. |
| `application_description` | `BookStack wiki on GKE Autopilot` | Description de la charge de travail. |
| `application_version` | `latest` | Tag de l'image `linuxserver/bookstack` ; épinglez-le (p. ex. `version-v24.10`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image LinuxServer mise en miroir — sans build personnalisé. |
| `container_image` | `""` | Remplace la référence de l'image ; laissez vide pour utiliser l'image mise en miroir par défaut. |
| `enable_image_mirroring` | `true` | Met en miroir l'image LinuxServer dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; laissez à 1 (pod unique adossé à NFS). |
| `max_instance_count` | `1` | Nombre maximal de réplicas. Ne l'augmentez pas sans coordination externe des sessions et du cache. |
| `container_port` | `80` | BookStack écoute sur le port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `cpu_limit` | `1000m` | CPU par pod ; 1 vCPU par défaut. |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (`127.0.0.1:3306`) ; requis sur GKE. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (p. ex. `APP_URL`, configuration de messagerie). Ne définissez pas `APP_KEY` ni `DB_*` ici. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout en `Deployment` (par défaut), sauf si un StatefulSet est demandé. |
| `session_affinity` | `ClientIP` | Le routage persistant maintient la session d'interface d'un client sur un même pod. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |
| `termination_grace_period_seconds` | `30` | Secondes d'attente après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laissez désactivé — BookStack utilise NFS, pas des PVC par pod. |
| `stateful_pvc_size` | `10Gi` | Taille du stockage PVC par pod (si activé). |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Applique un ResourceQuota à l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Quota de CPU. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Quota de mémoire — utilisez des unités binaires (`4Gi`, `8192Mi`). |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Quotas sur le nombre d'objets. |

### Groupe 9 — Fiabilité {#group-9--reliability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, path `/status`, 30s | Sonde de démarrage (vérification de l'écoute du port). |
| `liveness_probe` | HTTP `/status`, 300s delay | Sonde de vivacité sur le point de terminaison de santé non authentifié de BookStack. |
| `startup_probe_config` / `health_check_config` | Sondes au niveau d'App_GKE | Sondes au niveau de l'infrastructure. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de BookStack. |

### Groupe 12 — CI/CD et Binary Authorization {#group-12--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Conserve les images et pièces jointes téléversées sur NFS. Le désactiver fait perdre les fichiers téléversés lors d'un redéploiement. |
| `nfs_mount_path` | `/var/lib/bookstack` | Chemin de montage où BookStack stocke les fichiers téléversés. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Découverte et nommage du serveur NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `data` par défaut et ceux déclarés dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Nombre de jours après lesquels les images peuvent être supprimées. |

### Groupe 15 — Cache et sessions Redis {#group-15--redis-cache--sessions}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Injecte `REDIS_HOST`/`REDIS_PORT` afin que BookStack puisse utiliser Redis pour le cache et les sessions. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — BookStack nécessite MySQL 8.0. |
| `application_database_name` | `bookstack` | Nom de la base MySQL (préfixé par le tenant). Immuable après le premier déploiement. |
| `application_database_user` | `bookstack` | Utilisateur de base de données de l'application (préfixé par le tenant). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** activer IAP exige une authentification par identité Google pour
> **toutes** les requêtes entrantes, ce qui bloque les lecteurs anonymes du wiki.
> N'activez IAP que lorsque la documentation ne doit pas être lisible publiquement.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant BookStack. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR des niveaux d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour joindre BookStack. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et du job d'import (facultatif). |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas au moteur requis par BookStack, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critical | Le faire tourner rend définitivement indéchiffrables toutes les valeurs chiffrées de la base (secrets d'authentification à deux facteurs, certains paramètres). |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer le job d'import. |
| `database_type` | `MYSQL_8_0` | Critical | BookStack nécessite MySQL ; tout autre moteur empêche le démarrage. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés en octets et bloquent tout ordonnancement de pod dans l'espace de noms. |
| `APP_URL` (via `environment_variables`) | URL du LoadBalancer externe / du domaine personnalisé | High | Une URL de base erronée casse le chargement des ressources, les liens et les redirections de connexion. |
| `enable_nfs` | `true` | High | Le désactiver fait perdre toutes les images et pièces jointes téléversées lors d'un redéploiement ou d'un réordonnancement de pod. |
| `memory_limit` | `2Gi` | High | Des valeurs plus faibles exposent à des arrêts OOM lors d'éditions simultanées et de l'indexation en texte intégral. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité MySQL sur GKE ; le désactiver casse la connectivité à la base (ce n'est pas bloqué au moment du plan). |
| `min_instance_count` | `1` | High | GKE exige min ≥ 1 ; conserver 1 est approprié pour le déploiement à pod unique adossé à NFS. |
| `max_instance_count` | `1` | High | Plusieurs pods sur le même volume NFS et la même base se retrouvent en interblocage ; ne passez pas à l'échelle horizontalement sans coordination externe. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les sessions d'interface passent d'un pod à l'autre (pertinent uniquement en cas de passage à plus d'un pod). |
| Chemin de `liveness_probe` | `/status` (par défaut) | Medium | Pointer la sonde vers tout autre chemin ne renvoie jamais d'état sain pour BookStack — `/status` est son point de terminaison de santé JSON non authentifié. |
| `enable_iap` | uniquement lorsque les lecteurs doivent s'authentifier | High | IAP bloque tout accès anonyme, y compris pour les lecteurs de documentation publique. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à BookStack, partagée
avec la variante Cloud Run, est décrite dans
**[BookStack_Common](BookStack_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : BookStack sur GKE](../labs/BookStack_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [BookStack sur Google Cloud Run](BookStack_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [BookStack Common — Configuration applicative partagée](BookStack_Common.md) — la configuration partagée par les deux cibles de déploiement.
