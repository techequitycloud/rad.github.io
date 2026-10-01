---
title: "PhotoPrism sur GKE Autopilot"
description: "Référence de configuration pour déployer PhotoPrism sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PhotoPrism_GKE.md @ 3055034 sha256:fc12fffe529f -->

# PhotoPrism sur GKE Autopilot {#photoprism-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhotoPrism_GKE.png" alt="PhotoPrism sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PhotoPrism est une application auto-hébergée de gestion de photos et de vidéos
fondée sur l'IA : elle permet de parcourir, d'organiser et de partager une
médiathèque personnelle avec étiquetage automatique, reconnaissance faciale et
recherche plein texte/visuelle, le tout servi par un unique binaire Go doté
d'une base de données SQLite embarquée. Ce module déploie PhotoPrism sur
**GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise PhotoPrism et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

PhotoPrism s'exécute comme une charge de travail web à binaire Go unique,
déployée sous la forme d'un **StatefulSet avec un Persistent Volume Claim bloc**
plutôt que d'un Deployment sans état. Le déploiement assemble un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod PhotoPrism sur le port 2342, StatefulSet par défaut |
| Base de données | Aucune | SQLite embarqué (`PHOTOPRISM_DATABASE_DRIVER=sqlite`) — aucune instance Cloud SQL n'est provisionnée |
| Stockage bloc | Persistent Disk (PVC bloc) | `/photoprism` (base de données SQLite, cache, originaux, imports) — **obligatoire**, gcsfuse ne peut pas adosser SQLite en toute sécurité |
| Stockage objet | Cloud Storage | Un bucket `storage` est provisionné, mais il n'est monté via GCS FUSE que si le PVC bloc est désactivé |
| Secrets | Secret Manager | Mot de passe administrateur généré automatiquement (`PHOTOPRISM_ADMIN_PASSWORD`) |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est jamais provisionnée.** `PhotoPrism_Common` code en dur
  `database_type = "NONE"` et `enable_cloudsql_volume = false` ; PhotoPrism
  gère ses propres fichiers SQLite sous `/photoprism/storage`. Les variables
  `database_type`/`application_database_*`/`enable_mysql_plugins`/etc. au niveau GKE
  sont toutes des emplacements réservés sans effet, transmis uniquement pour la
  compatibilité avec la fondation.
- **Le PVC bloc, et non gcsfuse, est obligatoire.** `stateful_pvc_enabled = true` par
  défaut, ce qui résout `workload_type` en `StatefulSet` et monte un
  Persistent Disk `standard-rwo` (SSD) de 20Gi sur `/photoprism`. gcsfuse ne peut pas
  héberger SQLite ni l'index des médias en toute sécurité ; le module définit donc automatiquement
  `enable_gcs_storage_volume = false` sur la couche Common lorsque le PVC est
  activé, ce qui évite un double montage sur le même chemin.
- **Une seule réplique, toujours.** `min_instance_count = 1`, `max_instance_count =
  1`. PhotoPrism sert une seule bibliothèque SQLite partagée depuis un seul volume accessible en écriture —
  ne dépassez pas 1.
- **Redis est forcé à off.** La variable `enable_redis` au niveau GKE vaut
  `true` par défaut (valeur par défaut de la fondation App_GKE), mais le `main.tf` de `PhotoPrism_GKE`
  la remplace en dur par `false` — PhotoPrism n'a aucune intégration Redis ; aucun
  hôte Redis Memorystore/NFS n'est donc jamais injecté.
- **NFS est désactivé par défaut** (`enable_nfs = false`). Le PVC bloc constitue le
  stockage durable ; NFS n'est pas nécessaire, sauf si vous ajoutez des jobs/services personnalisés qui
  exigent un accès à un système de fichiers partagé.
- **Le mot de passe administrateur est généré automatiquement.** Un mot de passe de 24 caractères est créé
  et stocké dans Secret Manager, puis injecté comme variable d'environnement secrète
  `PHOTOPRISM_ADMIN_PASSWORD` ; le nom d'utilisateur administrateur est la simple variable `admin_username`
  (valeur par défaut `admin`).
- **Le build d'image personnalisé est un simple miroir, pas de la logique applicative.** Le build encapsule
  l'image amont `photoprism/photoprism` (`FROM photoprism/photoprism:${PHOTOPRISM_VERSION}`)
  afin que la fondation puisse la mettre en miroir dans Artifact Registry ; l'argument de build
  propre à l'application est `PHOTOPRISM_VERSION` (et non l'`APP_VERSION` générique), épinglé à
  `240915` lorsque `application_version = "latest"`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet PhotoPrism {#a-gke-autopilot--the-photoprism-statefulset}

PhotoPrism s'exécute comme un **StatefulSet** (et non un Deployment) afin que son pod unique dispose
d'une identité stable et d'un redémarrage ordonné, en cohérence avec son unique PVC bloc
accessible en écriture. Autopilot facture le CPU et la mémoire réellement demandés par le pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet PhotoPrism
  pour consulter les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Deployment ou StatefulSet).

### B. Stockage bloc persistant (Persistent Disk) {#b-persistent-block-storage-persistent-disk}

Tout l'état de PhotoPrism — la base de données SQLite et le cache (`/photoprism/storage`),
les médias importés (`/photoprism/originals`) et les imports en attente
(`/photoprism/import`) — réside sur un unique PVC bloc par pod, provisionné par
le StatefulSet sur `/photoprism` et adossé par défaut à la StorageClass `standard-rwo`
(Persistent Disk équilibré / SSD), d'une taille de `20Gi`.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims ; Compute
  Engine → Disks.
- **CLI :**
  ```bash
  kubectl get pvc,pv -n "$NAMESPACE"
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement des PVC de StatefulSet, les options de
StorageClass et la mise en garde relative au quota GKE `SSD_TOTAL_GB`.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné par
défaut (`create_cloud_storage = true`), mais il n'est monté dans le pod
via GCS FUSE que lorsque le PVC bloc est désactivé
(`stateful_pvc_enabled = false`) — dans la configuration StatefulSet par défaut,
le bucket existe mais n'est pas utilisé par le conteneur en fonctionnement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages via le pilote CSI GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : le mot de passe administrateur de PhotoPrism
(`secret-<prefix>-photoprism-admin-password`), injecté dans le conteneur en tant que
`PHOTOPRISM_ADMIN_PASSWORD`. Sur GKE, les secrets sont projetés dans les pods via le
pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~photoprism-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via un Service `LoadBalancer`
(`service_type = "LoadBalancer"`) — PhotoPrism est une interface web publique, et non
une charge de travail de base de données ; passez à `ClusterIP` pour un accès uniquement interne, ou
activez un domaine personnalisé (`enable_custom_domain = true` par défaut) via
la Kubernetes Gateway API avec un certificat géré par Google.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP
statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE à Cloud
Monitoring. Un test de disponibilité facultatif (`uptime_check_config`, désactivé par
défaut) et des règles d'alerte personnalisées sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application PhotoPrism {#3-photoprism-application-behaviour}

- **Aucun job d'initialisation/de création de base.** `initialization_jobs` vaut `[]` par défaut — il n'y a
  aucune base de données à amorcer. PhotoPrism crée et migre son propre schéma SQLite
  au premier démarrage, sous le PVC bloc monté.
- **Organisation du stockage.** Tout l'état réside sous l'unique répertoire monté
  `/photoprism` : `PHOTOPRISM_STORAGE_PATH=/photoprism/storage` (base de données
  SQLite + cache), `PHOTOPRISM_ORIGINALS_PATH=/photoprism/originals`
  (médias importés/indexés), `PHOTOPRISM_IMPORT_PATH=/photoprism/import`
  (imports en attente).
- **Compte administrateur.** `PHOTOPRISM_ADMIN_USER` est la simple variable `admin_username`
  (valeur par défaut `admin`) ; `PHOTOPRISM_ADMIN_PASSWORD` est la valeur
  Secret Manager générée automatiquement, injectée comme variable d'environnement secrète.
  `PHOTOPRISM_AUTH_MODE = "password"` est défini explicitement. Récupérez le
  mot de passe dans Secret Manager avant la première connexion.
- **URL du site.** `PHOTOPRISM_SITE_URL` est vide par défaut — PhotoPrism
  le tolère et se rabat sur l'hôte de la requête, mais définissez `site_url` sur
  l'URL déployée pour que les liens absolus soient générés correctement.
- **fsGroup du PVC.** PhotoPrism s'exécute avec l'UID 1000 / GID 2000 ; le
  StatefulSet définit `stateful_fs_group = 3000` (la convention du chart Helm
  amont) afin que le PVC monté soit accessible en écriture par le groupe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux des sondes **HTTP**
  `GET /api/v1/status` (délai initial de 15s / 10 tentatives pour le démarrage, 30s / 3
  tentatives pour la vivacité) — aucune authentification requise. Les variables
  `startup_probe_config`/`health_check_config` du groupe 10, au niveau de la fondation, reprennent le même
  chemin comme valeurs par défaut génériques. {/* TODO: verify precedence if the two probe
  configuration surfaces (Common-level startup_probe/liveness_probe vs.
  Group-10 startup_probe_config/health_check_config) are set to conflicting
  values. */}
- **La mise à l'échelle est épinglée à un seul pod.** `min_instance_count = 1` et
  `max_instance_count = 1` — PhotoPrism conserve une seule base de données SQLite
  accessible en écriture et un seul volume de médias accessible en écriture ; il n'existe aucune prise en charge
  de plusieurs écrivains.
- **Inspecter la configuration en cours et le stockage :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep PHOTOPRISM_
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à PhotoPrism ou notables pour lui sont listés ; toutes les autres entrées
sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `photoprism` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `photoprism/photoprism` utilisé comme base du build personnalisé ; `latest` est épinglé à un tag éprouvé (`240915`) au moment du build. |
| `admin_username` | `admin` | Nom d'utilisateur du compte administrateur initial (`PHOTOPRISM_ADMIN_USER`) ; le mot de passe est généré séparément. |
| `site_url` | `""` | URL publique du site (`PHOTOPRISM_SITE_URL`). Vide, elle se rabat sur l'hôte de la requête ; définissez-la dès que l'URL externe est connue pour obtenir des liens absolus corrects. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU alloué au conteneur PhotoPrism. L'indexation et la génération des miniatures sont limitées par le CPU ; augmentez-le pour les grandes bibliothèques. |
| `memory_limit` | `2Gi` | Mémoire allouée au conteneur. PhotoPrism charge les index vectoriels en mémoire ; 2Gi est le minimum qui permet de conserver la reconnaissance faciale et la prise en charge RAW — augmentez vers 4Gi pour les grandes collections. |
| `min_instance_count` | `1` | Conservez 1 pour éviter les démarrages à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | **Conservez 1** — une seule base SQLite et un seul volume de médias accessibles en écriture. |
| `container_port` | `2342` | Non transmise à App_GKE ; PhotoPrism sert toujours sur le port 2342, fixé par `PhotoPrism_Common`. |
| `enable_cloudsql_volume` | `false` | Pas de sidecar Cloud SQL Auth Proxy — PhotoPrism n'a pas de base de données externe. |

### Groupe 7 — StatefulSet (PVC bloc) {#group-7--statefulset-block-pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Obligatoire.** gcsfuse ne peut pas adosser SQLite/l'index des médias en toute sécurité ; lorsqu'elle vaut true sans `workload_type` explicite, se résout en `StatefulSet` et désactive automatiquement le volume de stockage GCS FUSE. |
| `stateful_pvc_size` | `20Gi` | Dimensionnez le PVC pour contenir toutes les collections, plus une marge. |
| `stateful_pvc_mount_path` | `/photoprism` | Répertoire de données de PhotoPrism — couvre `storage` (SQLite/cache) et `originals`. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré (SSD) — consomme le quota `SSD_TOTAL_GB` ; voir §6. |
| `stateful_fs_group` | `3000` | GID du `fsGroup` au niveau du pod ; PhotoPrism s'exécute avec l'UID 1000/GID 2000. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Redémarrages sûrs et ordonnés pour une charge de travail avec état à pod unique. |

### Groupe 10 — Santé et observabilité {#group-10--health--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` (Common) | HTTP `/api/v1/status`, délai de 15s, 10 tentatives | Appliquée au conteneur PhotoPrism. |
| `liveness_probe` (Common) | HTTP `/api/v1/status`, délai de 30s, 3 tentatives | Appliquée au conteneur PhotoPrism. |
| `uptime_check_config` | `enabled = false`, chemin `/api/v1/status` | Test de disponibilité externe facultatif ; désactivé par défaut. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` même s'il est inutilisé lorsque le PVC bloc (par défaut) est actif. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires, au-delà du volume de stockage PhotoPrism (géré automatiquement). |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la variable) → **forcé à `false`** | `main.tf` la remplace en dur par `false` quelle que soit la valeur transmise — PhotoPrism n'a aucune intégration Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — PhotoPrism n'a pas de base de données SQL (SQLite embarqué uniquement). Toutes les autres variables `database_*`/`application_database_*`/plugins MySQL de ce groupe sont sans effet et transmises uniquement pour la compatibilité avec la fondation. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Kubernetes Gateway API + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte personnalisés ; obligatoires si `enable_custom_domain` reste à `true` sans repli sur `LoadBalancer`. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en fonctionnement.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à PhotoPrism. |
| `photoprism_admin_password_secret_id` | ID du secret Secret Manager contenant le mot de passe administrateur généré. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation personnalisés. |
| `statefulset_name` | Nom du StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs
> *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé avec un
> paramètre sans état, IAP sans identité autorisée, des `quota_memory_*`
> exprimés en entiers nus, un `container_port`/
> `backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous
> sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Le désactiver fait se rabattre sur GCS FUSE, qui ne peut pas héberger SQLite ni l'index des médias en toute sécurité — risque de corruption. |
| `max_instance_count` | `1` | Critical | Dépasser 1 donne à deux pods une unique base SQLite et un unique PVC accessibles en écriture — corruption et contention de verrous. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) — envisagez `standard` (HDD) | Medium–High | `standard-rwo` consomme le quota régional serré `SSD_TOTAL_GB` (500GB sur Qwiklabs) ; une série d'applications avec état peut l'épuiser vers la 8e application. PhotoPrism n'a pas besoin des IOPS d'un SSD pour fonctionner correctement, seulement pour le débit d'indexation et de génération des miniatures — remplacez par du HDD (`-var stateful_pvc_storage_class=standard`) sur les projets soumis à des contraintes de quota. |
| `enable_redis` | Forcé à `false` dans `main.tf` | Low | Aucune action requise — le forçage est intentionnel et ne peut pas être contourné en définissant la variable sur `true`. |
| `create_cloud_storage` | `true` | Low | Le bucket `storage` est créé mais inutilisé tant que le PVC bloc est actif ; sans conséquence, hormis un faible coût de stockage inactif. |
| `PHOTOPRISM_ADMIN_PASSWORD` (généré automatiquement) | À récupérer avant la première connexion | Medium | Ne pas le connaître vous bloque hors du premier compte administrateur jusqu'à sa réinitialisation via la base de données. |
| `site_url` | À définir sur l'URL déployée dès qu'elle est connue | Medium | Laissée vide, PhotoPrism se rabat sur l'hôte de la requête ; les liens absolus et les URL des miniatures peuvent être erronés derrière un proxy ou un domaine personnalisé. |
| `stateful_fs_group` | `3000` | High | Un fsGroup incohérent ou non défini peut rendre le PVC inaccessible en écriture pour l'UID 1000/GID 2000 de PhotoPrism, ce qui bloque le démarrage. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent la planification de tous les pods du namespace. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et `site_url`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à PhotoPrism
partagée avec la variante Cloud Run est décrite dans
**[PhotoPrism_Common](PhotoPrism_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PhotoPrism sur GKE Autopilot](../labs/PhotoPrism_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [PhotoPrism sur Google Cloud Run](PhotoPrism_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [PhotoPrism Common — Configuration applicative partagée](PhotoPrism_Common.md) — la configuration partagée par les deux cibles de déploiement.
