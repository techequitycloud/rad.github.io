---
title: "Audiobookshelf sur GKE Autopilot"
description: "Référence de configuration pour déployer Audiobookshelf sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Audiobookshelf_GKE.md @ 3055034 sha256:4c2a6ee315ac -->

# Audiobookshelf sur GKE Autopilot {#audiobookshelf-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Audiobookshelf_GKE.png" alt="Audiobookshelf sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Audiobookshelf est un serveur auto-hébergé de livres audio et de podcasts — il organise votre bibliothèque audio, diffuse vers l'interface web et les applications mobiles officielles, et synchronise la progression d'écoute de chaque utilisateur. Ce module déploie Audiobookshelf sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Audiobookshelf et sur la façon de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Audiobookshelf s'exécute comme une charge de travail Node.js unique sur GKE Autopilot. Fait inhabituel dans ce catalogue, il n'a besoin **d'aucune base de données externe, d'aucun Redis et d'aucun secret applicatif** — l'empreinte du déploiement est volontairement réduite :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 1 vCPU / 1 GiB par défaut, réplica unique |
| Base de données | Aucune | Audiobookshelf embarque sa propre base de données SQLite sous `CONFIG_PATH` — pas de Cloud SQL |
| État persistant | Persistent Volume Claim (stockage bloc) | Un PVC de StatefulSet monté sur `/data`, qui porte à la fois `CONFIG_PATH` et `METADATA_PATH` |
| Image de conteneur | Cloud Build + Artifact Registry | Wrapper léger construit `FROM ghcr.io/advplyr/audiobookshelf` et mis en miroir dans votre registre |
| Secrets | Secret Manager | Aucun secret applicatif — l'utilisateur administrateur est créé dans l'interface web lors du premier lancement |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé facultatif |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** `database_type = "NONE"` et `enable_cloudsql_volume = false` sont fixés par `Audiobookshelf_Common` ; Audiobookshelf crée et migre sa base de données SQLite interne au premier démarrage. Aucun job `db-init` ne s'exécute.
- **C'est un véritable PVC bloc, et non GCS FUSE, qui porte `/data`.** `stateful_pvc_enabled = true` par défaut — gcsfuse corrompt SQLite et l'index des fichiers multimédias ; Audiobookshelf exige donc un véritable périphérique bloc. Lorsque le PVC est activé, la variante désactive automatiquement le volume de stockage GCS-FUSE sur le même chemin (`enable_gcs_storage_volume = !stateful_pvc_enabled`) pour éviter un conflit de double montage sur `/data`. C'est la principale différence avec `Audiobookshelf_CloudRun`, qui n'a pas d'option PVC et utilise GCS FUSE à la place.
- **`stateful_pvc_enabled = true` sans `workload_type` explicite se résout en `StatefulSet`.** Un PVC par pod, provisionné par défaut à partir de la StorageClass `standard-rwo` (SSD, Balanced PD) — voir le §6 pour l'incidence sur le quota SSD.
- **Un seul montage persistant couvre tout.** `CONFIG_PATH = /data/config` (base SQLite + configuration de l'application) et `METADATA_PATH = /data/metadata` (pochettes, métadonnées en cache) sont tous deux redirigés sous l'unique `stateful_pvc_mount_path` (`/data`). Perdre ce PVC, c'est perdre tout l'état d'Audiobookshelf.
- **Réplica unique.** `min_instance_count = 1` et `max_instance_count = 1` — une bibliothèque SQLite partagée doit être servie par exactement un rédacteur. N'augmentez pas le maximum sans avoir vérifié la sécurité multi-rédacteurs (il n'y en a aucune).
- **Image personnalisée (wrapper léger).** Cloud Build encapsule l'image amont `ghcr.io/advplyr/audiobookshelf` afin qu'elle soit mise en miroir dans Artifact Registry. Le Dockerfile lit l'ARG de build propre à l'application `AUDIOBOOKSHELF_VERSION` (et non l'`APP_VERSION` générique qu'injecte le socle) ; `application_version = "latest"` correspond à la version épinglée `2.17.0`.
- **Aucun secret généré.** L'utilisateur **root** initial est créé de manière interactive dans l'interface web lors du premier lancement, et les jetons d'API sont émis ensuite dans l'interface — `Audiobookshelf_Common` expose des `secret_ids`/`secret_values` vides.
- **Les sondes de santé ciblent `/healthcheck`**, le point de terminaison d'Audiobookshelf qui renvoie 200 sans authentification (démarrage : délai initial de 15 s, période de 10 secondes, 10 échecs tolérés ; vivacité : délai de 30 s, période de 30 secondes, 3 échecs).
- **Pas de Redis.** Le `main.tf` de la variante remplace la valeur par défaut `enable_redis` du socle par `false` pour ce module.
- **Domaine personnalisé activé par défaut.** `enable_custom_domain = true` (contrairement à la plupart des autres modules GKE, où il est désactivé par défaut) — fournissez `application_domains` pour rattacher un nom d'hôte, sinon on se rabat sur l'IP du LoadBalancer.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Audiobookshelf {#a-gke-autopilot--the-audiobookshelf-statefulset}

Audiobookshelf s'exécute comme un **StatefulSet** à pod unique (le type de charge de travail résolu par défaut lorsque `stateful_pvc_enabled = true`), ce qui lui donne une identité de pod stable et un redémarrage ordonné — adapté à une charge de travail SQLite à rédacteur unique.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Audiobookshelf pour voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Persistent Volume Claim — le stockage bloc `/data` {#b-persistent-volume-claim--the-data-block-storage}

Tout l'état d'Audiobookshelf — la base de données SQLite, la configuration de l'application, les pochettes et les métadonnées en cache — réside sous `/data`, qui repose sur un **Persistent Volume Claim bloc** provisionné par pod par le StatefulSet. gcsfuse est ici explicitement évité, car il corrompt SQLite et l'index des fichiers multimédias. Des bibliothèques multimédias supplémentaires (par exemple un bucket de livres audio en lecture seule) peuvent toujours être rattachées via `gcs_volumes` sur un autre chemin de montage.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail → l'onglet Volumes/Storage. Compute Engine → Disks liste également le Persistent Disk sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Consultez le §7 d'[App_GKE](App_GKE.md) (StatefulSet / PVC) pour les options de StorageClass, et le §6 ci-dessous pour le piège du quota SSD.

### C. Cloud Build et Artifact Registry — l'image de conteneur {#c-cloud-build--artifact-registry--the-container-image}

Le module construit une image wrapper légère `FROM ghcr.io/advplyr/audiobookshelf:${AUDIOBOOKSHELF_VERSION}` via Cloud Build et la stocke dans l'Artifact Registry du locataire, ce qui protège les déploiements des limites de débit du registre amont et épingle la version.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Audiobookshelf lui-même n'a besoin d'aucun secret injecté — il n'y a ni mot de passe de base de données, ni clé maîtresse, ni secret JWT. Secret Manager reste disponible pour les éventuelles `secret_environment_variables` personnalisées que vous ajoutez. Sur GKE, les secrets sont projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~audiobookshelf"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et le renouvellement.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing (`service_type = ClusterIP` par défaut au niveau du socle, mais l'ingress d'Audiobookshelf est normalement atteint via `enable_custom_domain = true` et une IP statique réservée ; définissez `service_type = LoadBalancer` pour obtenir une IP externe directe sans domaine personnalisé). Un domaine personnalisé avec un certificat géré par Google est activé par défaut pour ce module.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles (les tests de disponibilité sont désactivés par défaut et ne réussissent que contre un point de terminaison accessible publiquement).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Audiobookshelf {#3-audiobookshelf-application-behaviour}

- **Premier démarrage autonome, sans job d'initialisation.** Au premier lancement, Audiobookshelf crée sa base de données SQLite et son arborescence de répertoires sous `CONFIG_PATH`/`METADATA_PATH` — aucun job d'initialisation, de migration ni provisionnement de base de données n'intervient. Comme les deux chemins se trouvent sous le montage persistant du PVC, la base de données survit aux redémarrages de pods et aux mises à niveau de version de l'application. `Audiobookshelf_Common` n'injecte aucun `initialization_jobs` par défaut ; des jobs personnalisés peuvent toujours être fournis pour des chargements de données ponctuels.
- **Assistant de configuration au premier lancement.** Ouvrez l'URL du service (`/`) — Audiobookshelf vous invite à créer de manière interactive l'utilisateur **root** initial. Il n'existe pas d'amorçage de l'administrateur par variables d'environnement ; les jetons d'API sont émis ensuite dans l'interface web (Settings → Users).
- **Rédacteur unique, réplica unique.** SQLite sur un PVC bloc ne tolère qu'un seul rédacteur. Le module fixe `min_instance_count = 1` / `max_instance_count = 1` ; un StatefulSet avec `stateful_pod_management_policy = OrderedReady` garantit en outre que les pods ne démarrent pas simultanément lors des événements de mise à l'échelle.
- **Point de terminaison de contrôle d'état.** `/healthcheck` renvoie HTTP 200 sans authentification dès que le serveur est prêt ; il sert à la sonde de démarrage **HTTP** (délai initial de 15 s, période de 10 secondes, jusqu'à 10 échecs ≈ 115 s de marge au premier démarrage) et à la sonde de vivacité **HTTP** (délai initial de 30 s, période de 30 secondes, 3 échecs). L'interface web se trouve à `/`.
- **Contraintes de mise à l'échelle.** S'agissant d'un StatefulSet avec un backend SQLite à rédacteur unique, ne dépassez pas 1 réplica. Les valeurs par défaut `stateful_update_strategy` et `stateful_pod_management_policy` (toutes deux `null` → valeurs par défaut du socle `RollingUpdate`/`OrderedReady`) conviennent avec un seul réplica ; elles n'ont d'importance que si vous expérimentez avec plus d'un pod, ce que l'application ne prend pas en charge.
- **CLI de vérification :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  SERVICE=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[?(@.metadata.labels.application=="audiobookshelf")].metadata.name}')
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- wget -qO- http://localhost:80/healthcheck
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 8080:80
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthcheck   # expect 200
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Audiobookshelf ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `audiobookshelf` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `ghcr.io/advplyr/audiobookshelf` utilisée comme base du build personnalisé ; `latest` correspond à la version épinglée `2.17.0` via l'ARG de build propre à l'application `AUDIOBOOKSHELF_VERSION`. |
| `application_display_name` | `Audiobookshelf Media Server` | Nom d'affichage lisible. |
| `description` | `Audiobookshelf — self-hosted audiobook and podcast server with progress sync across clients` | Description de la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU par pod. Les analyses de bibliothèque sont gourmandes en CPU — augmentez pour les imports volumineux. |
| `memory_limit` | `1Gi` | Mémoire par pod ; augmentez pour les bibliothèques volumineuses. |
| `min_instance_count` | `1` | Laissez à 1 pour éviter les démarrages à froid pendant le chargement de la bibliothèque/de l'index. |
| `max_instance_count` | `1` | **Laissez à 1** — une bibliothèque SQLite, un rédacteur. |
| `container_port` | `80` | Port HTTP d'Audiobookshelf (fixé par `Audiobookshelf_Common` ; cette variable n'est pas elle-même transmise à App_GKE). |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — laissez `false` ; Audiobookshelf ne l'utilise pas. |
| `enable_image_mirroring` | `true` | Met en miroir l'image amont dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Type de Service Kubernetes ; définissez `LoadBalancer` pour une IP externe directe. |
| `workload_type` | `null` → `StatefulSet` (via `stateful_pvc_enabled = true`) | Recommandé pour l'identité de pod stable et les redémarrages ordonnés d'Audiobookshelf. |
| `session_affinity` | `None` | Déploiement à réplica unique ; les sessions persistantes ne sont donc pas nécessaires. |
| `network_tags` | `["nfsserver"]` | Valeur par défaut héritée du socle ; Audiobookshelf n'utilise pas NFS, si bien que ce tag n'a aucun effet pratique sauf si `enable_nfs` est également activé. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Obligatoire — gcsfuse corrompt la base de données SQLite et l'index des fichiers multimédias d'Audiobookshelf ; un véritable PVC bloc porte donc `/data`. |
| `stateful_pvc_size` | `20Gi` | Taille permettant de contenir l'index complet de la bibliothèque audio plus une marge (le PVC contient la configuration/les métadonnées, pas nécessairement les fichiers audio bruts s'ils sont montés séparément via `gcs_volumes`). |
| `stateful_pvc_mount_path` | `/data` | `CONFIG_PATH` (`/data/config`) et `METADATA_PATH` (`/data/metadata`) résident tous deux sous ce montage. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD, Balanced PD) | Voir le §6 — envisagez `standard` (HDD) pour éviter d'épuiser le quota `SSD_TOTAL_GB` ; la charge de travail SQLite/multimédia d'Audiobookshelf n'a pas besoin des IOPS d'un SSD. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Nécessaire pour des redémarrages sûrs d'une charge de travail à rédacteur unique. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | N'a d'importance que si le nombre de réplicas est (hors prise en charge) porté au-dessus de 1. |
| `stateful_fs_group` | `3000` | Correspond à la convention fsGroup du chart Helm d'Audiobookshelf (l'application s'exécute en UID 1000/GID 2000) afin que le PVC soit accessible en écriture au groupe. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non utilisé par défaut — l'état d'Audiobookshelf réside sur le PVC bloc, pas sur NFS. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` du module Common ; inutilisé pour le montage principal `/data` lorsque `stateful_pvc_enabled = true` (le PVC remplace GCS FUSE sur ce chemin), mais tout de même créé et disponible pour des surcharges via `gcs_volumes`. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires, p. ex. un bucket de bibliothèque multimédia en lecture seule sur un chemin distinct. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut du socle) → forcé à `false` par `main.tf` | Audiobookshelf n'utilise pas Redis ; la variante code en dur `enable_redis = false` dans son appel à `App_GKE`, quelle que soit la valeur de cette variable. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé — Audiobookshelf n'a pas de base de données SQL ; toutes les autres entrées de base de données ne sont transmises que pour la compatibilité avec le socle et n'ont aucun effet. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut pour ce module (contrairement à la plupart des modules GKE, où il est désactivé par défaut). |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré ; fournissez-en un pour utiliser le domaine personnalisé. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite des autorisations au niveau de l'organisation). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsque le déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Audiobookshelf. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés (aucun par défaut). |
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

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé en même temps qu'un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` donnés sous forme d'entiers nus, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Plusieurs pods écrivent dans la même base SQLite via le PVC partagé — corruption de la base de données. |
| `stateful_pvc_enabled` | `true` | Critical | Le désactiver revient à un montage de type GCS-FUSE pour `/data` ; gcsfuse corrompt la base de données SQLite et l'index des fichiers multimédias d'Audiobookshelf. |
| `CONFIG_PATH` / `METADATA_PATH` (via `environment_variables`) | laisser les valeurs par défaut | Critical | Les modifier après le premier démarrage rend orphelines la base SQLite existante et les métadonnées en cache. |
| `stateful_pvc_mount_path` | `/data` | Critical | Doit rester cohérent avec `CONFIG_PATH`/`METADATA_PATH` ; une incohérence signifie que la base SQLite n'est jamais réellement conservée sur le PVC. |
| `stateful_pvc_storage_class` | `standard` (HDD) recommandé plutôt que la valeur par défaut `standard-rwo` (SSD) | High | Ce module utilise actuellement `standard-rwo` par défaut, qui puise dans le quota régional `SSD_TOTAL_GB`, restreint (p. ex. seulement 500 GB sur Qwiklabs) ; la charge de travail SQLite/multimédia d'Audiobookshelf n'a pas besoin des IOPS d'un SSD. Une série de plusieurs applications avec état adossées à des SSD peut épuiser le quota — passez `-var stateful_pvc_storage_class=standard` pour utiliser du HDD (`pd-standard`) à la place. Ramener la charge de travail à zéro ne libère **pas** le PVC ; seule sa suppression le fait. |
| `container_port` | `80` | Critical | Audiobookshelf écoute sur 80 (`PORT=80` injecté par `Audiobookshelf_Common`) ; une incohérence fait échouer toutes les sondes de santé. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms (uniquement pertinent si `enable_resource_quota = true`). |
| `enable_redis` | forcé à `false` quelle que soit l'entrée | Low | Audiobookshelf n'a aucun usage de Redis ; la variante ignore cette variable et transmet toujours `false` au socle. |
| `application_version` | tag épinglé | Medium | `latest` correspond silencieusement à la version épinglée `2.17.0` ; épinglez explicitement pour maîtriser les mises à niveau. |
| `enable_custom_domain` / `application_domains` | `true` / définir un nom d'hôte | Medium | Laissé à `true` sans `application_domains`, le module se rabat sur l'URL interne du cluster ou sur l'IP du LoadBalancer plutôt que sur un nom d'hôte stable. |
| `enable_cloudsql_volume` | `false` | Low | Il n'existe pas de Cloud SQL ; l'activer gaspille un sidecar. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation réglementaire. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Audiobookshelf partagée avec la variante Cloud Run est
décrite dans **[Audiobookshelf_Common](Audiobookshelf_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Audiobookshelf sur GKE Autopilot](../labs/Audiobookshelf_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Audiobookshelf sur Google Cloud Run](Audiobookshelf_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Audiobookshelf Common — Configuration applicative partagée](Audiobookshelf_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md), [Komga sur GKE Autopilot](Komga_GKE.md), [Kavita sur GKE Autopilot](Kavita_GKE.md) et [Navidrome sur GKE Autopilot](Navidrome_GKE.md) dans la solution **Digital Library**.
