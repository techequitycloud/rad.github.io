---
title: "Jellyfin sur GKE Autopilot"
description: "Référence de configuration pour déployer Jellyfin sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Jellyfin_GKE.md @ 3055034 sha256:29361c5a10b8 -->

# Jellyfin sur GKE Autopilot {#jellyfin-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellyfin_GKE.png" alt="Jellyfin sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Jellyfin est un serveur multimédia auto-hébergé, gratuit et open source (GPLv2),
qui diffuse vos propres films, séries, musiques, photos et la télévision en direct.
Écrit en .NET/C# et maintenu comme fork communautaire d'Emby, il ne comporte ni
pistage, ni publicité, ni offre premium. Ce module déploie Jellyfin sur
**GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Jellyfin et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Jellyfin s'exécute comme une charge de travail .NET avec état. Sur GKE, c'est
**l'environnement recommandé pour une véritable médiathèque** : un StatefulSet
adossé à un véritable **PVC bloc** sur `/config` offre la sémantique de système de
fichiers POSIX correcte pour SQLite et le cache de transcodage. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod StatefulSet .NET, 1 vCPU / 1 GiB par défaut |
| Persistance | Persistent Disk (PVC bloc) | `/config` sur un PVC par pod — le stockage recommandé pour SQLite + le cache de transcodage |
| Base de données | SQLite interne (intégrée) | Pas de Cloud SQL — Jellyfin conserve tout son état dans des fichiers SQLite sous `/config` |
| Stockage objet / fichiers | Cloud Storage (GCS FUSE) / Filestore (NFS) | Facultatif, pour les grandes médiathèques |
| Secrets | Secret Manager | Clé d'API générée automatiquement facultative ; aucun secret cryptographique obligatoire |
| Entrée | Cloud Load Balancing | ClusterIP par défaut ; domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Jellyfin stocke l'intégralité de son
  état — les bases SQLite de la bibliothèque et de la lecture, le XML de
  configuration, les métadonnées et illustrations en cache, les plugins, le cache de
  transcodage et les journaux — sous `/config`. Aucune instance Cloud SQL, aucun job
  `db-init` et aucun Redis ne sont utilisés (`database_type = NONE` ; les variables
  Redis du socle sont inertes pour Jellyfin).
- **Un PVC bloc sur `/config` est la solution la plus adaptée.**
  `stateful_pvc_enabled = true` résout la charge de travail en **StatefulSet** avec un
  PVC par pod monté sur `/config`, et le volume de stockage GCS se désactive
  automatiquement pour éviter un double montage. Un véritable stockage bloc offre la
  sémantique de système de fichiers correcte dont SQLite et le cache de transcodage
  ont besoin — la configuration recommandée pour un serveur multimédia.
- **Le conteneur écoute sur le port 8096.** Le port web/API de Jellyfin est défini par
  Jellyfin_Common. L'interface web et l'assistant de configuration initiale sont
  servis sur `/web` (et `/`) ; `GET /health` renvoie `Healthy` (200, sans
  authentification).
- **Il n'y a pas d'identifiants par défaut.** Au premier accès, l'assistant de
  configuration crée le compte administrateur et ajoute les médiathèques. Rien n'est
  utilisable avant cela.
- **Réplica unique.** `min_instance_count = 1` / `max_instance_count = 1` — une seule
  bibliothèque SQLite partagée sur un seul volume. **N'exécutez pas plusieurs
  réplicas** ; des écrivains concurrents sur un même fichier SQLite corrompent la
  bibliothèque.
- **NFS est facultatif, pour les grandes médiathèques.** `enable_nfs = false` par
  défaut. Activez-le pour monter un volume Filestore partagé pour une grande
  collection multimédia qui dépasse la capacité d'un seul PVC.
- **L'authentification par clé d'API est facultative et désactivée par défaut.**
  `enable_api_key = false`. L'authentification principale repose sur le compte
  administrateur créé par l'assistant ; les clés d'API par application se créent dans
  l'application sous **Dashboard → API Keys**.

> **GKE ou Cloud Run — GKE est le serveur multimédia de production.**
> **GKE (ce module)** exécute Jellyfin comme StatefulSet avec un véritable **PVC
> bloc** sur `/config`, offrant une vraie sémantique POSIX pour SQLite et le cache de
> transcodage, ainsi qu'un **NFS** facultatif pour les grandes médiathèques — le choix
> recommandé pour un véritable serveur multimédia multi-utilisateur avec transcodage.
> **[Jellyfin_CloudRun](Jellyfin_CloudRun.md)** monte `/config` depuis un bucket GCS
> via FUSE ; il est plus simple et moins cher pour une démo ou une petite bibliothèque
> personnelle, mais la latence de FUSE et le modèle de délai d'expiration par requête
> le rendent peu adapté au transcodage en direct ou à une diffusion intensive.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Jellyfin {#a-gke-autopilot--the-jellyfin-workload}

Les pods Jellyfin sont planifiés sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par les pods. Avec un PVC bloc, la charge de travail est un
StatefulSet doté d'une identité de pod stable et de redémarrages ordonnés.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Jellyfin pour voir les pods, les événements et le StatefulSet. Kubernetes Engine →
  Services & Ingress affiche l'IP externe (lorsqu'elle est exposée).
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Stockage persistant de la configuration (SQLite sur le PVC) {#b-persistent-configuration-store-sqlite-on-the-pvc}

Jellyfin n'a **aucune base de données externe**. L'intégralité de son état — les
bases SQLite de la bibliothèque et de la lecture, le XML de configuration, les
métadonnées et illustrations en cache, les plugins installés, le cache de transcodage
et les journaux — réside sous `/config` (`JELLYFIN_CONFIG_DIR = /config`). Il n'y a
ni instance Cloud SQL, ni Auth Proxy, ni Job d'initialisation pour créer un schéma ;
Jellyfin crée et migre ses propres bases SQLite au premier démarrage.

Sur GKE, `/config` est adossé à un **PVC bloc** par pod (`stateful_pvc_enabled = true`,
monté sur `/config`), qui est le stockage recommandé, car SQLite et le cache de
transcodage ont besoin d'une véritable sémantique de système de fichiers POSIX que le
stockage objet ne peut pas fournir.

- **Inspecter le PVC et le disque associé :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

### C. Cloud Storage et NFS (facultatif, pour les grandes médiathèques) {#c-cloud-storage--nfs-optional-for-large-libraries}

Le bucket **Cloud Storage** provisionné automatiquement (suffixe de nom `storage`,
`STANDARD`, `force_destroy = true`, gestion des versions désactivée,
`public_access_prevention = enforced`) est disponible pour des montages GCS FUSE
supplémentaires. Lorsqu'un PVC bloc est activé, le volume de stockage GCS est
automatiquement désactivé pour `/config` afin d'éviter un double montage. Pour les
grandes collections multimédias, activez **NFS** (`enable_nfs = true`) pour monter un
volume Filestore partagé.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et le pilote CSI GCS FUSE.

### D. Configuration initiale et médiathèque {#d-first-run-setup--the-media-library}

Au premier accès, Jellyfin sert un **assistant de configuration** interactif sur
`/web` (et `/`) qui crée le compte administrateur, définit la langue préférée et vous
permet d'ajouter des médiathèques (Films, Séries, Musique, Photos). Rien n'est
authentifié ni utilisable tant que vous n'avez pas terminé l'assistant — il n'y a pas
d'identifiants par défaut.

Les médiathèques pointent vers des chemins à l'intérieur du conteneur : le PVC bloc
sur `/config`, un montage NFS facultatif pour les grandes collections, ou des volumes
GCS FUSE supplémentaires.

- **Accéder à l'assistant / à l'interface web :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"      # external IP / hostname
  kubectl port-forward -n "$NAMESPACE" statefulset/<service-name> 8096:8096
  # then open http://localhost:8096/web
  ```

### E. Secret Manager et la clé d'API facultative {#e-secret-manager--the-optional-api-key}

Jellyfin n'exige **aucun secret cryptographique obligatoire** — il n'y a ni clé de
chiffrement, ni JWT, ni mot de passe maître à gérer. Lorsque `enable_api_key = true`,
le module génère une valeur aléatoire de 32 caractères et la stocke dans Secret
Manager sous le nom `secret-<prefix>-<app>-api-key` (exposé par l'output
`jellyfin_api_key_secret_id`). **Bogue connu :** la valeur est fournie via
`explicit_secret_values` sous la clé `QDRANT__SERVICE__API_KEY` — le commentaire du
propre `main.tf` du module la documente même comme « la convention de configuration
imbriquée `__` de Jellyfin », mais Jellyfin n'a pas de telle convention ; il s'agit
d'un reliquat de copier-coller hérité de Qdrant_GKE. Rien dans le conteneur Jellyfin
ne lit cette variable d'environnement (ni aucune autre) pour l'authentification par
clé d'API ; aujourd'hui, `enable_api_key = true` ne fait donc que matérialiser un
Secret Kubernetes inutilisé — il ne permet **pas** aux appelants externes de
s'authentifier. Le seul moyen d'obtenir une clé d'API utilisable est de la créer dans
l'application sous **Dashboard → API Keys** ; l'authentification principale reste le
compte administrateur créé par l'assistant.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, `service_type = ClusterIP`, ce qui maintient le serveur multimédia à
l'intérieur du cluster. Définissez `service_type = LoadBalancer` pour obtenir une IP
externe, ou activez un domaine personnalisé avec un certificat géré par Google via
l'API Kubernetes Gateway. Une IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur les IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE
vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs
sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Jellyfin {#3-jellyfin-application-behaviour}

- **Pas de Job d'initialisation.** Jellyfin n'a besoin d'aucune étape `db-init` — il
  crée et migre ses propres bases SQLite sous `/config` lors de son premier
  démarrage. Laissez `initialization_jobs` vide, sauf si vous avez des tâches de
  chargement de données personnalisées.
- **L'assistant de premier lancement crée l'administrateur.** L'assistant de
  configuration `/web` vous guide dans la création du compte administrateur et l'ajout
  des bibliothèques. Tant qu'il n'est pas terminé, le serveur n'a ni utilisateurs ni
  contenu.
- **`/config` est la source de vérité unique — persistez-le.** Tout l'état de la
  bibliothèque se trouve sur le PVC bloc. Supprimer le PVC efface la bibliothèque, les
  plugins et les utilisateurs. Le StatefulSet maintient le PVC lié à l'identité du pod
  au fil des redémarrages.
- **L'image personnalisée est un simple wrapper.** Le Dockerfile est
  `ARG JELLYFIN_VERSION=10.10.3` / `FROM jellyfin/jellyfin:${JELLYFIN_VERSION}` ; le
  socle la met en miroir donc dans Artifact Registry (`enable_image_mirroring = true`) et
  définit `imagePullPolicy = Always` pour l'image mise en miroir.
  `application_version = "latest"` se résout en `10.10.3` épinglé via l'argument de
  build `JELLYFIN_VERSION` propre à l'application — il n'est **pas** écrasé par
  l'injection générique `APP_VERSION` du socle.
- **fsGroup pour un PVC accessible en écriture au groupe.** Jellyfin s'exécute avec
  l'UID 1000 / GID 2000 ; `stateful_fs_group = 3000` (la valeur par défaut du chart
  Helm Jellyfin) garantit que le PVC est accessible en écriture au groupe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `GET /health`,
  qui renvoie `Healthy` (200) sans authentification dès que le serveur est prêt. La
  sonde de démarrage prévoit un délai initial de 15 secondes avec une large fenêtre de
  nouvelles tentatives ; la sonde de vivacité interroge toutes les 30 secondes.
- **Le transcodage est gourmand en CPU et sans GPU.** Les pods Autopilot n'ont pas de
  GPU ; privilégiez donc les clients en lecture directe. Augmentez `cpu_limit` pour le
  transcodage en direct et `memory_limit` pour les grandes bibliothèques.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Jellyfin ou notables pour lui sont
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
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `jellyfin` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Jellyfin Media Server` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Tag de l'image Jellyfin ; `latest` épingle `10.10.3` via l'argument de build `JELLYFIN_VERSION`. |
| `enable_api_key` | `false` | Génère une clé d'API aléatoire dans Secret Manager. Recommandé lorsque le service est joignable en dehors de l'espace de noms. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; augmentez-le pour le transcodage en direct. |
| `memory_limit` | `1Gi` | Mémoire par pod ; augmentez-la pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; conservez 1 (bibliothèque partagée unique). |
| `max_instance_count` | `1` | **Conservez 1.** Une seule bibliothèque SQLite partagée sur un seul volume — n'exécutez jamais plusieurs réplicas. |
| `container_port` | `8096` | Port web/API de Jellyfin (défini par Jellyfin_Common ; non transmis à App_GKE). |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Jellyfin n'utilise pas Cloud SQL — laissez `false`. |
| `enable_image_mirroring` | `true` | Duplique `jellyfin/jellyfin` dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Le VPA optimise les demandes de ressources ; il désactive le HPA lorsqu'il est actif. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets pour le conteneur Jellyfin. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes ; `LoadBalancer` pour un accès externe. |
| `workload_type` | `null` → `StatefulSet` | Se résout en StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Mode d'affinité de session du Service. |
| `namespace_name` | `""` | Généré automatiquement à partir de `application_name` + `tenant_id` s'il est vide. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes entre SIGTERM et SIGKILL — permet de vider les écritures en cours. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active le modèle de PVC. **`true` recommandé pour Jellyfin** — se résout automatiquement en StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; dimensionnez-la pour contenir `/config` (SQLite, métadonnées, cache de transcodage). |
| `stateful_pvc_mount_path` | `/config` | Chemin de montage du PVC dans le conteneur (répertoire de configuration/persistance de Jellyfin). |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré (SSD) ; utilisez `premium-rwo` pour davantage d'IOPS, ou `standard` (HDD `pd-standard`) sur un projet soumis à des quotas serrés — voir le tableau des pièges ci-dessous. |
| `stateful_headless_service` | `null` | Service headless pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Redémarrages ordonnés et sûrs pour Jellyfin. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | Stratégie de mise à jour. |
| `stateful_fs_group` | `3000` | fsGroup du pod pour que le PVC soit accessible en écriture au groupe (Jellyfin UID 1000 / GID 2000). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

`enable_resource_quota` (`false`) ainsi que `quota_cpu_requests` / `quota_cpu_limits` /
`quota_memory_requests` / `quota_memory_limits` / `quota_max_pods` /
`quota_max_services` / `quota_max_pvcs` — ResourceQuota de l'espace de noms. Les valeurs de
quota `*_requests` / `*_limits` ne sont **pas transmises** dans ce module et sont
inertes ; les valeurs de mémoire, si elles sont utilisées ailleurs, doivent porter des
suffixes d'unité binaires (`4Gi`, `8192Mi`).

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` délai de 15 s | Sonde de démarrage ; `/health` renvoie 200 dès que le service est prêt. |
| `liveness_probe` | HTTP `/health` délai de 30 s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage d'infrastructure au niveau d'App_GKE. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité au niveau d'App_GKE. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jellyfin n'a besoin d'aucun job d'initialisation ; à fournir uniquement pour des tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par ex. tâches de maintenance). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés à côté de Jellyfin. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne Cloud Filestore (NFS) ; à activer pour de grandes médiathèques partagées. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` de Jellyfin et les éventuels buckets supplémentaires. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS FUSE supplémentaires via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

`database_type` (`NONE`), `database_password_length`, `application_database_name`
(`jellyfindb`), `application_database_user` (`jellyfinuser`), `enable_mysql_plugins`,
`enable_postgres_extensions`, `db_*` / `db_*_env_var_name` — **tous inertes pour
Jellyfin** (pas de base SQL) ; conservés et transmis pour la compatibilité avec le
socle.

### Groupe 15 — Redis (transmis pour la compatibilité avec le socle) {#group-15--redis-forwarded-for-foundation-compatibility}

`enable_redis`, `redis_host`, `redis_port`, `redis_auth` — **sans objet pour
Jellyfin**, qui n'utilise ni cache ni file d'attente. Transmis au socle uniquement par
souci de compatibilité ; laissez les valeurs par défaut.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron (UTC) de sauvegarde automatique du volume `/config`. |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 en production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure un instantané de `/config` lors du déploiement (`tar` par défaut). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Ingress pour des noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `static_ip_name` | `""` | Généré automatiquement s'il est vide. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** l'activation d'IAP impose une authentification par identité
> Google pour **toutes** les requêtes entrantes. Nécessite que `enable_custom_domain`
> ou `enable_cdn` soit à true.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Jellyfin. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Jellyfin. |
| `jellyfin_api_key_secret_id` | ID du secret Secret Manager de la clé d'API (vide lorsque `enable_api_key = false`). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (vide pour un déploiement Jellyfin par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une charge de travail `Deployment` associée à `stateful_pvc_enabled = true`, IAP sans identités autorisées, `quota_memory_*` sans suffixes d'unité binaires, un `timeout_seconds`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC `/config` | Ne jamais supprimer | Critique | Le PVC contient la bibliothèque SQLite, les utilisateurs et les métadonnées ; le supprimer efface l'intégralité du serveur. |
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC persistant, `/config` est éphémère et la bibliothèque est perdue à chaque redémarrage du pod. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent dans une même bibliothèque SQLite et la corrompent. |
| `workload_type` vs `stateful_pvc_enabled` | Laisser `workload_type` non défini | Critique | `Deployment` + `stateful_pvc_enabled = true` échoue au moment du plan ; laissez-le non défini pour une résolution automatique en StatefulSet. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `stateful_pvc_size` | Adaptée à la bibliothèque | Élevé | Un PVC sous-dimensionné se remplit pendant la mise en cache des métadonnées/du transcodage et bloque le serveur. |
| `stateful_fs_group` | `3000` | Élevé | Un mauvais fsGroup rend le PVC non inscriptible par Jellyfin (UID 1000 / GID 2000) — le démarrage échoue. |
| `memory_limit` | `1Gi` (à augmenter pour les grandes bibliothèques) | Élevé | Trop peu de mémoire provoque l'arrêt OOM du pod pendant l'analyse ou le transcodage d'une grande bibliothèque. |
| `cpu_limit` | `1000m` (à augmenter pour le transcodage) | Élevé | Le transcodage en direct (sans GPU) sature le CPU ; privilégiez les clients en lecture directe. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_api_key` | Laisser `false` ; non fonctionnel actuellement | Moyen | Le secret généré est fourni sous `QDRANT__SERVICE__API_KEY` (un reliquat de copier-coller de Qdrant_GKE) — Jellyfin ne le lit jamais ; il ne matérialise donc qu'un Secret Kubernetes inutilisé. Créez plutôt les clés d'API dans l'application sous Dashboard → API Keys. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer l'unique pod pendant la maintenance, ce qui interrompt les diffusions. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour restaurer un instantané plus ancien de la bibliothèque. |
| `stateful_pvc_storage_class` | `standard` (HDD) sur les projets soumis à des quotas serrés | Moyen | Jellyfin est une application multimédia/SQLite — la valeur par défaut `standard-rwo` puise dans le quota régional serré `SSD_TOTAL_GB`, et la mise à zéro ne libère PAS le PVC. Une série de modules avec état peut épuiser le quota SSD ; remplacez-la par du HDD (`stateful_pvc_storage_class=standard`), car le profil d'écriture de Jellyfin ne nécessite pas les IOPS d'un SSD. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Jellyfin, partagée
avec la variante Cloud Run, est décrite dans **[Jellyfin_Common](Jellyfin_Common.md)**.
Pour une présentation guidée, consultez le [lab Jellyfin_GKE](../labs/Jellyfin_GKE.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Jellyfin sur GKE Autopilot](../labs/Jellyfin_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Jellyfin sur Google Cloud Run](Jellyfin_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Jellyfin Common — Configuration applicative partagée](Jellyfin_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md), [Seerr sur GKE Autopilot](Seerr_GKE.md), [Jellystat sur GKE Autopilot](Jellystat_GKE.md) et [Homepage sur GKE Autopilot](Homepage_GKE.md) dans la solution **Media Server**.
