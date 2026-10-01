---
title: "Emby sur GKE Autopilot"
description: "Référence de configuration pour déployer Emby sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Emby_GKE.md @ 3055034 sha256:17bb6db2469d -->

# Emby sur GKE Autopilot {#emby-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Emby_GKE.png" alt="Emby sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Emby est un serveur multimédia auto-hébergé permettant d'organiser et de diffuser vos propres films,
séries, musiques et photos, avec des applications clientes pour la plupart des téléviseurs, téléphones et navigateurs.
La lecture de base, la diffusion sans transcodage et l'assistant de configuration sont gratuits — aucune
clé de licence ni aucun compte emby.media n'est nécessaire pour démarrer ou naviguer. Emby Premiere, une
option payante achetée séparément dans l'application, conditionne le transcodage accéléré par matériel,
les applications mobiles/TV complètes, le DVR/la TV en direct et la synchronisation hors ligne ; cela diffère de
Jellyfin (également présent dans ce catalogue), un fork communautaire de la base de code d'origine d'Emby Server,
entièrement open source et sans palier restreint équivalent. Ce module
déploie Emby sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'utilise Emby et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Emby s'exécute comme une charge de travail avec état. Sur GKE, c'est l'**hébergement recommandé pour
une véritable médiathèque** : un StatefulSet adossé à un véritable **PVC en mode bloc** sur `/config`
offre une sémantique de système de fichiers POSIX correcte pour SQLite et le cache de transcodage. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod de StatefulSet, 1 vCPU / 1 GiB par défaut |
| Persistance | Persistent Disk (PVC en mode bloc) | `/config` sur un PVC par pod — le stockage recommandé pour SQLite + le cache de transcodage |
| Base de données | SQLite interne (intégré) | Pas de Cloud SQL — Emby conserve tout son état dans des fichiers SQLite sous `/config` |
| Stockage d'objets / de fichiers | Cloud Storage (GCS FUSE) / Filestore (NFS) | Facultatif, pour les grandes médiathèques |
| Secrets | Secret Manager | Clé d'API générée automatiquement, facultative ; aucun secret cryptographique obligatoire |
| Ingress | Cloud Load Balancing | `LoadBalancer` par défaut (serveur interactif, exposé aux clients) ; domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Emby stocke la totalité de son état — les bases SQLite
  de la médiathèque et de lecture, la configuration, les métadonnées et illustrations en cache,
  les plugins, le cache de transcodage et les journaux — sous `/config`. Aucune instance Cloud SQL, aucun
  job `db-init` et aucun Redis ne sont utilisés (`database_type = NONE` ; les variables Redis de la fondation
  sont sans effet pour Emby).
- **Un PVC en mode bloc sur `/config` est la meilleure option.** `stateful_pvc_enabled = true`
  fait de la charge de travail un **StatefulSet** avec un PVC par pod monté sur `/config`,
  et le volume de stockage GCS se désactive automatiquement pour éviter un double montage. Un véritable stockage
  en mode bloc offre la sémantique de système de fichiers correcte dont SQLite et le cache de transcodage
  ont besoin — la configuration recommandée pour un serveur multimédia.
- **Le conteneur écoute sur le port 8096.** Le port web/API d'Emby est défini par
  Emby_Common. L'interface web et l'assistant de configuration initiale sont servis sur `/web` (et
  `/`). Contrairement à Jellyfin, Emby n'a **aucun point de terminaison de santé HTTP non authentifié confirmé
  et documenté** — un test sur un conteneur actif a montré que `/health` renvoie `404` tandis que
  `/` répond `302` vers l'assistant de configuration — les deux sondes utilisent donc par défaut un contrôle **TCP**
  sur le port 8096 plutôt qu'un chemin HTTP supposé.
- **Il n'existe aucun identifiant par défaut.** Au premier accès, l'assistant de configuration crée le
  compte administrateur et ajoute les médiathèques. Rien n'est utilisable avant cela.
- **Réplique unique.** `min_instance_count = 1` / `max_instance_count = 1` — une seule
  médiathèque SQLite partagée sur un seul volume. **N'exécutez pas plusieurs répliques** ; des écritures
  concurrentes sur un même fichier SQLite corrompent la médiathèque.
- **NFS est facultatif, pour les grandes médiathèques.** `enable_nfs = false` par défaut. Activez-le
  pour monter un volume Filestore partagé destiné à une grande collection multimédia qui dépasse
  la capacité d'un seul PVC.
- **L'authentification par clé d'API est facultative et désactivée par défaut.** `enable_api_key = false`. L'authentification
  principale repose sur le compte administrateur créé par l'assistant ; les clés d'API par application sont
  créées dans l'application sous **Dashboard → API Keys**. La valeur générée dans Secret Manager
  est injectée sous la forme `EMBY_API_KEY` — à l'intention des opérateurs qui souhaitent un identifiant stable à fournir
  à des clients d'API externes, et non comme une valeur qu'Emby lit lui-même au démarrage.
- **Emby Premiere est un palier payant distinct et facultatif.** Il n'a aucune incidence sur la réussite
  du déploiement de ce module ni sur le fonctionnement de la diffusion de base — il ne conditionne que
  des fonctionnalités facultatives (clients, DVR, transcodage matériel) que l'opérateur peut débloquer plus tard.

> **GKE ou Cloud Run — GKE est le serveur multimédia de production.**
> **GKE (ce module)** exécute Emby sous forme de StatefulSet avec un véritable **PVC en mode bloc** sur
> `/config`, offrant une vraie sémantique POSIX pour SQLite et le cache de transcodage, ainsi
> qu'un **NFS** facultatif pour les grandes médiathèques — le choix recommandé pour un véritable serveur multimédia
> multi-utilisateur avec transcodage. **[Emby_CloudRun](Emby_CloudRun.md)**
> monte `/config` depuis un bucket GCS via FUSE ; c'est plus simple et moins coûteux pour une démo
> ou une petite médiathèque personnelle, mais la latence de FUSE et le modèle de délai d'expiration par requête
> le rendent mal adapté au transcodage en direct ou à une diffusion intensive.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Emby {#a-gke-autopilot--the-emby-workload}

Les pods Emby sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent réellement. Avec un PVC en mode bloc, la charge de travail est un StatefulSet avec une identité de pod
stable et des redémarrages ordonnés.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Emby pour voir
  les pods, les événements et le StatefulSet. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, du scaling et du type de charge de travail
(Deployment ou StatefulSet).

### B. Stockage persistant de la configuration (SQLite sur le PVC) {#b-persistent-configuration-store-sqlite-on-the-pvc}

Emby n'a **aucune base de données externe**. Tout son état — les bases SQLite de la médiathèque et
de lecture, la configuration, les métadonnées et illustrations en cache, les plugins
installés, le cache de transcodage et les journaux — réside sous `/config`
(`EMBY_CONFIG_DIR = /config`). Il n'y a ni instance Cloud SQL, ni Auth Proxy,
ni job d'initialisation pour créer un schéma ; Emby crée et migre ses propres
bases SQLite au premier démarrage.

Sur GKE, `/config` est adossé à un **PVC en mode bloc** par pod (`stateful_pvc_enabled = true`,
monté sur `/config`), qui est le stockage recommandé, car SQLite et le
cache de transcodage ont besoin d'une véritable sémantique de système de fichiers POSIX que le stockage d'objets ne peut pas
fournir.

- **Inspecter le PVC et son disque associé :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

### C. Cloud Storage et NFS (facultatifs, pour les grandes médiathèques) {#c-cloud-storage--nfs-optional-for-large-libraries}

Le bucket **Cloud Storage** provisionné automatiquement (suffixe de nom `storage`, `STANDARD`,
`force_destroy = true`, gestion des versions désactivée, `public_access_prevention = enforced`) est
disponible pour des montages GCS FUSE supplémentaires. Lorsqu'un PVC en mode bloc est activé, le volume de stockage GCS
est automatiquement désactivé pour `/config` afin d'éviter un double montage. Pour les grandes
collections multimédias, activez **NFS** (`enable_nfs = true`) pour monter un volume Filestore
partagé.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et le pilote CSI GCS FUSE.

### D. Configuration initiale et médiathèque {#d-first-run-setup--the-media-library}

Au premier accès, Emby sert un **assistant de configuration** interactif sur `/web` (et `/`)
qui crée le compte administrateur, définit la langue préférée et vous permet
d'ajouter des médiathèques (films, séries, musique, photos). Rien n'est authentifié ni utilisable
tant que vous n'avez pas terminé l'assistant — il n'existe aucun identifiant par défaut.

Les médiathèques pointent vers des chemins à l'intérieur du conteneur : le PVC en mode bloc sur `/config`, un
montage NFS facultatif pour les grandes collections, ou des volumes GCS FUSE supplémentaires.

- **Accéder à l'assistant / à l'interface web :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"      # external IP / hostname
  kubectl port-forward -n "$NAMESPACE" statefulset/<service-name> 8096:8096
  # then open http://localhost:8096/web
  ```

### E. Secret Manager et la clé d'API facultative {#e-secret-manager--the-optional-api-key}

Emby ne nécessite **aucun secret cryptographique obligatoire** — il n'y a ni clé de chiffrement,
ni JWT, ni mot de passe maître à gérer. Lorsque `enable_api_key = true`, le module
génère une valeur aléatoire de 32 caractères et la stocke dans Secret Manager sous le nom
`secret-<prefix>-<app>-api-key` (exposé par la sortie `emby_api_key_secret_id`),
injectée sous la forme `EMBY_API_KEY` via le chemin normal `module_secret_env_vars`/SecretSync
(un nom de variable d'environnement à un seul tiret bas, valide comme `targetKey` SecretSync). Emby
lui-même n'a aucune variable d'environnement qui la consomme au démarrage — la seule façon d'obtenir une clé d'API
utilisable dans Emby est de la créer dans l'application sous **Dashboard → API Keys** ; ce secret existe
comme un identifiant stable, adossé à Secret Manager, que les opérateurs peuvent référencer en externe.
L'authentification principale reste le compte administrateur de l'assistant.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, `service_type = LoadBalancer` (Emby est un serveur multimédia interactif exposé
aux clients), ce qui donne une IP externe au Service. Définissez `service_type = ClusterIP`
si vous souhaitez le garder uniquement interne, ou activez un domaine personnalisé avec un
certificat géré par Google via l'API Kubernetes Gateway. Une IP statique est
réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques GKE sont envoyées à Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Emby {#3-emby-application-behaviour}

- **Aucun job d'initialisation.** Emby n'a besoin d'aucune étape `db-init` — il crée et
  migre ses propres bases SQLite sous `/config` lors de son premier démarrage. Laissez
  `initialization_jobs` vide, sauf si vous avez des tâches personnalisées de chargement de données.
- **L'assistant de configuration initiale crée l'administrateur.** L'assistant de configuration `/web` vous guide dans
  la création du compte administrateur et l'ajout des médiathèques. Tant qu'il n'est pas terminé, le
  serveur n'a ni utilisateurs ni contenu.
- **`/config` est l'unique source de vérité — rendez-le persistant.** Tout l'état de la médiathèque se trouve sur
  le PVC en mode bloc. Supprimer le PVC efface la médiathèque, les plugins et les utilisateurs. Le
  StatefulSet maintient le PVC lié à l'identité du pod d'un redémarrage à l'autre.
- **L'image personnalisée est une encapsulation légère.** Le Dockerfile est
  `ARG EMBY_VERSION=4.10.0.15` / `FROM emby/embyserver:${EMBY_VERSION}` ; ainsi
  la fondation la réplique dans Artifact Registry (`enable_image_mirroring = true`)
  et définit `imagePullPolicy = Always` pour l'image répliquée.
  `application_version = "latest"` se résout en la version figée `4.10.0.15` via l'ARG de build
  propre à l'application `EMBY_VERSION` — elle n'est **pas** écrasée par l'injection
  générique `APP_VERSION` de la fondation. Une vérification locale par `docker build` + `docker
  run` a confirmé que l'image démarre proprement avec seulement `EMBY_CONFIG_DIR`
  et atteint la véritable logique de démarrage d'Emby Server.
- **fsGroup pour un PVC accessible en écriture au groupe.** Emby s'exécute avec l'UID 1000 / le GID 2000 ;
  `stateful_fs_group = 3000` garantit que le PVC est accessible en écriture au groupe.
- **Aucun chemin de santé dédié — sondes TCP.** Les sondes de démarrage et de vivacité utilisent toutes deux un
  contrôle **TCP** sur le port 8096, qui réussit dès que l'écouteur d'Emby se lie au port.
  Un test en conditions réelles a confirmé que `/health` renvoie `404` (aucun point de terminaison de ce type) tandis que `/`
  répond `302` vers l'assistant de configuration — ce qui exclut un chemin HTTP comme cible de sonde,
  contrairement à Jellyfin qui documente un `/health` fonctionnel.
- **Le transcodage est gourmand en CPU et sans GPU.** Les pods Autopilot n'ont pas de GPU ; privilégiez donc
  les clients en lecture directe. Augmentez `cpu_limit` pour le transcodage en direct et `memory_limit`
  pour les grandes médiathèques.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Emby ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant de l'accès au projet et des alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `emby` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Emby Media Server` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Tag de l'image Emby ; `latest` est figé sur `4.10.0.15` via l'ARG de build `EMBY_VERSION`. |
| `enable_api_key` | `false` | Génère une clé d'API aléatoire dans Secret Manager (`EMBY_API_KEY`). Recommandé lorsque le service est accessible hors de l'espace de noms. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; à augmenter pour le transcodage en direct. |
| `memory_limit` | `1Gi` | Mémoire par pod ; à augmenter pour les grandes médiathèques. |
| `min_instance_count` | `1` | Nombre minimal de répliques ; à maintenir à 1 (médiathèque partagée unique). |
| `max_instance_count` | `1` | **À maintenir à 1.** Une seule médiathèque SQLite partagée sur un seul volume — n'exécutez jamais plusieurs répliques. |
| `container_port` | `8096` | Port web/API d'Emby (défini par Emby_Common ; non transmis à App_GKE). |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Emby n'a pas de Cloud SQL — laissez `false`. |
| `enable_image_mirroring` | `true` | Réplique `emby/embyserver` dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Le VPA optimise les requêtes de ressources ; désactive le HPA lorsqu'il est actif. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets pour le conteneur Emby. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret dans Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes ; externe par défaut, car Emby est interactif et exposé aux clients. |
| `workload_type` | `null` → `StatefulSet` | Se résout en StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Mode d'affinité de session du Service. |
| `namespace_name` | `""` | Généré automatiquement à partir de `application_name` + `tenant_id` lorsqu'il est vide. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes entre SIGTERM et SIGKILL — permet aux écritures en cours d'être vidées. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active le modèle de PVC. **`true` recommandé pour Emby** — se résout automatiquement en StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; dimensionnez-la pour contenir `/config` (SQLite, métadonnées, cache de transcodage). |
| `stateful_pvc_mount_path` | `/config` | Chemin de montage du PVC dans le conteneur (répertoire de configuration/persistance d'Emby). |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré (SSD) ; utilisez `premium-rwo` pour davantage d'IOPS, ou `standard` (HDD `pd-standard`) sur un projet soumis à des contraintes de quota — voir le tableau des pièges ci-dessous. |
| `stateful_headless_service` | `null` | Service headless pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Redémarrages ordonnés et sûrs pour Emby. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | Stratégie de mise à jour. |
| `stateful_fs_group` | `3000` | fsGroup du pod afin que le PVC soit accessible en écriture au groupe (Emby UID 1000 / GID 2000). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

`enable_resource_quota` (`false`) ainsi que `quota_cpu_requests` / `quota_cpu_limits` /
`quota_memory_requests` / `quota_memory_limits` / `quota_max_pods` /
`quota_max_services` / `quota_max_pvcs` — ResourceQuota de l'espace de noms. Les valeurs de quota
`*_requests` / `*_limits` ne sont **pas transmises** dans ce module et sont sans effet ;
les valeurs de mémoire, si elles sont utilisées ailleurs, doivent porter des suffixes d'unité binaire (`4Gi`, `8192Mi`).

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP 8096, délai de 15 s | Sonde de démarrage ; TCP, car Emby n'a aucun chemin de santé confirmé. |
| `liveness_probe` | TCP 8096, délai de 30 s | Sonde de vivacité. |
| `startup_probe_config` | `{ enabled = true }` | Sonde de démarrage d'infrastructure au niveau d'App_GKE. |
| `health_check_config` | `{ enabled = true }` | Sonde de vivacité au niveau d'App_GKE. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Emby n'a besoin d'aucun job d'initialisation ; à fournir uniquement pour des tâches personnalisées de chargement de données. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (p. ex. tâches de maintenance). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés d'Emby. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne Cloud Filestore (NFS) ; à activer pour les grandes médiathèques partagées. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` d'Emby et les éventuels buckets supplémentaires. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS FUSE supplémentaires via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

`database_type` (`NONE`), `database_password_length`, `application_database_name`
(`embydb`), `application_database_user` (`embyuser`), `enable_mysql_plugins`,
`enable_postgres_extensions`, `db_*` / `db_*_env_var_name` — **tous sans effet pour
Emby** (aucune base de données SQL) ; conservés et transmis pour la compatibilité avec la fondation.

### Groupe 15 — Redis (transmis pour la compatibilité avec la fondation) {#group-15--redis-forwarded-for-foundation-compatibility}

`enable_redis`, `redis_host`, `redis_port`, `redis_auth` — **non applicables à
Emby**, qui n'utilise ni cache ni file d'attente. Transmis à la fondation uniquement pour la
compatibilité ; laissez les valeurs par défaut.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron (UTC) de sauvegarde automatique du volume `/config`. |
| `backup_retention_days` | `7` | Rétention ; à porter à 30–90 en production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure un instantané de `/config` lors du déploiement (`tar` par défaut). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `static_ip_name` | `""` | Généré automatiquement lorsqu'il est vide. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** l'activation d'IAP impose une authentification par identité Google pour **toutes**
> les requêtes entrantes. Nécessite que `enable_custom_domain` ou `enable_cdn` soit à true.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Emby. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsqu'IAP est activé (sensibles). |

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
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Emby. |
| `emby_api_key_secret_id` | ID du secret Secret Manager de la clé d'API (vide lorsque `enable_api_key = false`). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux de notification. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (vide pour un déploiement Emby par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut recommandées {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une charge de travail `Deployment` associée à `stateful_pvc_enabled = true`, IAP sans identité autorisée, `quota_memory_*` sans suffixe d'unité binaire, une valeur `timeout_seconds`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur recommandée | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC `/config` | Ne jamais le supprimer | Critique | Le PVC contient la médiathèque SQLite, les utilisateurs et les métadonnées ; le supprimer efface l'intégralité du serveur. |
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC persistant, `/config` est éphémère et la médiathèque est perdue à chaque redémarrage du pod. |
| `max_instance_count` | `1` | Critique | Plusieurs répliques écrivent dans une même médiathèque SQLite et la corrompent. |
| `workload_type` vs `stateful_pvc_enabled` | Laisser `workload_type` non défini | Critique | `Deployment` + `stateful_pvc_enabled = true` échoue au moment du plan ; laissez-le non défini pour une résolution automatique en StatefulSet. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `stateful_pvc_size` | Adaptée à la médiathèque | Élevé | Un PVC sous-dimensionné se remplit pendant la mise en cache des métadonnées/du transcodage et bloque le serveur. |
| `stateful_fs_group` | `3000` | Élevé | Un fsGroup incorrect rend le PVC non accessible en écriture pour Emby (UID 1000 / GID 2000) — le démarrage échoue. |
| `memory_limit` | `1Gi` (à augmenter pour les grandes médiathèques) | Élevé | Une mémoire insuffisante provoque l'arrêt du pod pour OOM pendant l'analyse ou le transcodage d'une grande médiathèque. |
| `cpu_limit` | `1000m` (à augmenter pour le transcodage) | Élevé | Le transcodage en direct (sans GPU) sature le CPU ; privilégiez les clients en lecture directe. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| Type de `startup_probe`/`liveness_probe` | `TCP` (par défaut) | Élevé | Un chemin HTTP `/health` supposé renvoie 404 sur Emby (vérifié en conditions réelles) — une sonde HTTP ne réussirait jamais ici. |
| `service_type` | `LoadBalancer` (par défaut), sauf si le service doit délibérément rester interne | Moyen | Un remplacement injustifié par `ClusterIP` rend un serveur multimédia interactif inaccessible depuis un navigateur. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer l'unique pod pendant la maintenance, ce qui interrompt les diffusions. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour restaurer un instantané plus ancien de la médiathèque. |
| `stateful_pvc_storage_class` | `standard` (HDD) sur les projets soumis à des contraintes de quota | Moyen | Emby est une application multimédia/SQLite — la valeur par défaut `standard-rwo` consomme le quota régional restreint `SSD_TOTAL_GB`, et la mise à l'échelle à zéro ne libère PAS le PVC. Une série de modules avec état peut épuiser le quota SSD ; basculez vers des HDD (`stateful_pvc_storage_class=standard`), car le profil d'écriture d'Emby n'a pas besoin des IOPS des SSD. |
| `enable_api_key` | Comprendre qu'elle est réservée aux opérateurs | Faible | Emby lui-même ne lit jamais `EMBY_API_KEY` au démarrage — créez des clés d'API dans l'application sous Dashboard → API Keys pour l'authentification REST réelle d'Emby. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et réplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Emby partagée avec
la variante Cloud Run est décrite dans **[Emby_Common](Emby_Common.md)**. Pour
une présentation guidée, consultez le [lab Emby_GKE](../labs/Emby_GKE.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Emby sur GKE Autopilot](../labs/Emby_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Emby sur Google Cloud Run](Emby_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Emby Common — Configuration applicative partagée](Emby_Common.md) — la configuration partagée par les deux cibles de déploiement.
