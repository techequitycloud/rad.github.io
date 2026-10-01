---
title: "Gokapi sur GKE Autopilot"
description: "Référence de configuration pour déployer Gokapi sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Gokapi_GKE.md @ 3055034 sha256:c0561b8b2220 -->

# Gokapi sur GKE Autopilot {#gokapi-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gokapi_GKE.png" alt="Gokapi sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gokapi est un serveur de partage de fichiers léger et auto-hébergé, écrit en Go —
une alternative auto-hébergée à WeTransfer. Les utilisateurs téléversent des
fichiers et génèrent des liens de téléchargement partageables, avec en option une
date d'expiration, une limite du nombre de téléchargements et une protection par
mot de passe, le tout adossé à une base de données SQLite interne (aucune base de
données externe requise). Ce module déploie Gokapi sur **GKE Autopilot** au-dessus
de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Gokapi et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gokapi s'exécute comme une charge de travail composée d'un unique binaire Go, sans
base de données externe. Le déploiement associe un ensemble restreint et ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un pod de StatefulSet à conteneur unique sur le port `53842`, `1000m` de CPU / `1Gi` de mémoire par défaut |
| Base de données / métadonnées | **Aucune (SQLite interne)** | Pas de Cloud SQL — Gokapi écrit sa propre base SQLite sous `GOKAPI_CONFIG_DIR` ; `database_type` est fixé à `NONE` |
| Persistance des fichiers | PVC GKE en mode bloc (StatefulSet) | La base SQLite et les fichiers téléversés résident tous deux sous `/data`, sur un Persistent Volume Claim propre à chaque pod par défaut |
| Stockage d'objets | Cloud Storage (conditionnel) | Un bucket `storage` est toujours déclaré, mais n'est monté (via GCS FUSE) que lorsque le PVC du StatefulSet est désactivé |
| Secrets | Secret Manager | Uniquement une clé API d'opérateur **facultative** (`GOKAPI_API_KEY`) ; aucun secret généré obligatoire |
| Ingress | Kubernetes Gateway API | `enable_custom_domain = true` par défaut, si bien qu'un point de terminaison Gateway public (et une IP statique réservée) est provisionné d'emblée |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Jamais de Cloud SQL.** `database_type` est fixé en dur à `NONE` par
  `Gokapi_Common` — toutes les variables de base de données génériques (`db_name`,
  `db_user`, `application_database_name`, etc.) ne sont transmises à la fondation
  que pour la compatibilité de mise en miroir des variables et n'ont aucun effet.
- **SQLite et les fichiers téléversés résident par défaut sur un véritable PVC en
  mode bloc, et non sur GCS FUSE.** `stateful_pvc_enabled = true` par défaut, ce
  qui résout aussi automatiquement `workload_type` en `StatefulSet` (inutile de
  définir les deux). Un PVC `standard-rwo` (SSD) de 20Gi est monté sur `/data` ;
  `GOKAPI_CONFIG_DIR=/data/config` (configuration + base de données SQLite) et
  `GOKAPI_DATA_DIR=/data/data` (fichiers téléversés) résident tous deux sous ce
  montage et survivent donc aux redémarrages/redéploiements du pod. C'est
  important, car SQLite n'est pas sûr sur gcsfuse — le module évite explicitement
  cette combinaison en désactivant le volume GCS dès que le PVC est activé (voir
  ci-dessous).
- **Le bucket GCS `storage` est tout de même créé par défaut, bien qu'il ne soit
  pas monté.** `Gokapi_Common` déclare toujours un bucket suffixé `storage`, et
  `create_cloud_storage = true` le provisionne par défaut — mais, avec le PVC de
  StatefulSet par défaut en place, `enable_gcs_storage_volume` est
  automatiquement défini à `false` pour éviter un double montage sur `/data` ; le
  bucket reste donc inutilisé, sauf si vous désactivez `stateful_pvc_enabled`.
- **Réplica unique par conception.** `min_instance_count = 1`, `max_instance_count = 1`.
  La base de données SQLite de Gokapi n'accepte qu'un seul rédacteur ; il n'existe
  aucun mode distribué/en cluster, ne dépassez donc pas 1 pod.
- **Aucun mot de passe administrateur n'est généré automatiquement.** Gokapi n'a
  aucun secret obligatoire — le compte administrateur est créé de manière
  interactive via l'assistant de premier lancement propre à Gokapi, sur
  **`/setup`** (la sortie `setup_url`). Tant qu'il n'est pas terminé, toutes les
  autres pages — `/` comprise — répondent « Server is in maintenance mode,
  please try again in a few minutes ».
- **Clé API d'opérateur facultative.** `enable_api_key` (par défaut `false`)
  génère un jeton aléatoire de 32 caractères, le stocke dans Secret Manager et
  l'injecte en tant que `GOKAPI_API_KEY` via un Secret Kubernetes natif
  (`explicit_secret_values`) plutôt que par le chemin Secret Manager → SecretSync.
  Il s'agit uniquement d'un jeton de commodité — les clés API de
  téléversement/téléchargement propres à Gokapi sont normalement créées depuis
  l'interface d'administration après la configuration.
- **Redis est désactivé de force.** La variante code en dur `enable_redis = false`
  vers la fondation, quelle que soit la valeur de la variable `enable_redis` —
  Gokapi n'a aucun usage de Redis.
- **Un point de terminaison public est provisionné d'emblée.** Contrairement à de
  nombreux modules d'application, `enable_custom_domain` vaut `true` par défaut et
  `reserve_static_ip` vaut `true` par défaut, même si `service_type` vaut
  `ClusterIP` par défaut. Gokapi dispose ainsi par défaut d'un point de
  terminaison Gateway public fonctionnel — ce qui convient à une application dont
  la raison d'être est de générer des liens de téléchargement partageables.
  Consultez [App_GKE](App_GKE.md) pour le mécanisme du nom d'hôte par défaut
  `<reserved-ip>.nip.io`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Gokapi {#a-gke-autopilot--the-gokapi-workload}

Gokapi s'exécute par défaut sous la forme d'un **StatefulSet** à pod unique
(identité de pod stable, règle de redémarrage `OrderedReady` et PVC propre à
chaque pod). Autopilot facture le CPU et la mémoire que le pod demande
réellement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Gokapi pour voir les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, le
scaling et le type de charge de travail StatefulSet ou Deployment.

### B. Stockage persistant — le PVC en mode bloc (et le bucket GCS inutilisé) {#b-persistent-storage--the-block-pvc-and-the-unused-gcs-bucket}

La base de métadonnées SQLite et chaque fichier téléversé résident sous `/data`
sur un PVC en mode bloc propre à chaque pod (`stateful_pvc_enabled = true`,
`20Gi`, `standard-rwo`/SSD par défaut). Un bucket Cloud Storage `storage` est
également déclaré et — sauf si vous désactivez le PVC — provisionné mais jamais
monté.

- **Console :** Kubernetes Engine → Storage pour le PVC ; Cloud Storage → Buckets
  pour le bucket (probablement inutilisé).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Consultez [App_GKE](App_GKE.md) pour les mécanismes StatefulSet/PVC (groupe 7) et
la question du quota SSD `SSD_TOTAL_GB` sur les projets soumis à des quotas
serrés.

### C. Secret Manager {#c-secret-manager}

Gokapi ne crée **aucun secret obligatoire**. Le seul secret que ce module peut
créer est le jeton de commodité d'opérateur facultatif `GOKAPI_API_KEY`,
conditionné par `enable_api_key` (par défaut `false`).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le modèle d'injection Secret Store CSI /
secret natif et la rotation.

### D. Réseau et ingress {#d-networking--ingress}

`enable_custom_domain = true` et `reserve_static_ip = true` sont tous deux des
valeurs par défaut ; une ressource Kubernetes Gateway API dotée d'une IP externe
statique réservée est donc provisionnée automatiquement, même si le `Service`
Kubernetes sous-jacent vaut lui-même `ClusterIP` par défaut.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le nom d'hôte par défaut
`<reserved-ip>.nip.io`, les domaines personnalisés, Cloud CDN et les détails sur
l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques GKE
sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles (`uptime_check_config` est désactivé par
défaut).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Gokapi {#3-gokapi-application-behaviour}

- **Aucune tâche d'initialisation ne s'exécute par défaut.** `Gokapi_Common` ne
  fournit aucune entrée `initialization_jobs` par défaut — Gokapi gère son propre
  stockage et n'a aucune base de données à amorcer. Seules les tâches fournies par
  l'utilisateur (pour un chargement de données ou une migration personnalisés)
  apparaissent dans les Jobs Kubernetes.
- **La configuration au premier démarrage est entièrement interactive.** Il n'y a
  ni flag d'installation automatique ni mot de passe administrateur généré. Ouvrez
  **`/setup`** sur l'URL du service (la sortie `setup_url`) et l'assistant propre
  à Gokapi crée le compte administrateur ; jusque-là, `/` n'affiche que « Server
  is in maintenance mode ».
- **Où les données persistent physiquement.** Avec la valeur par défaut `stateful_pvc_enabled =
  true`, tant `GOKAPI_CONFIG_DIR=/data/config` (la base de métadonnées SQLite et
  la configuration de l'application) que `GOKAPI_DATA_DIR=/data/data`
  (fichiers téléversés) se trouvent sur le même PVC en mode bloc propre au pod,
  monté sur `/data`. Si vous définissez à la place
  `stateful_pvc_enabled = false`, le module réactive automatiquement le montage
  GCS FUSE du bucket `storage` sur le même chemin — acceptable pour un usage
  léger, mais avec une latence plus élevée que le PVC en mode bloc pour les
  charges de travail sollicitant fortement SQLite.
- **Rédacteur unique, pod unique.** `min_instance_count = 1` / `max_instance_count =
  1` par défaut. La base de données SQLite de Gokapi ne propose ni clustering ni
  réplication ; n'augmentez donc pas `max_instance_count` au-delà de 1.
- **Les sondes de santé interrogent la racine publique, sans authentification.**
  La sonde de démarrage comme la sonde de vivacité sont des **HTTP GET `/`** (la
  racine publique de Gokapi, 200, non authentifiée — avant la configuration, il
  s'agit de l'avis de maintenance, toujours en 200) — démarrage : `initial_delay=15s, timeout=5s, period=10s,
  failure_threshold=10` ; vivacité : `initial_delay=30s, timeout=5s, period=30s,
  failure_threshold=3`.
- **Le port du conteneur est fixé à `53842`.** C'est le port natif de Gokapi,
  câblé via `GOKAPI_PORT=53842` et le `container_port` du module ; il n'est pas
  configurable via la variable générique `container_port` (documentée comme sans
  effet sur ce module).
- **Vérifiez le pod déployé et son état persistant :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /data/config /data/data
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=50
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Gokapi ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gokapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `f0rc3/gokapi` utilisée comme base du build personnalisé ; `latest` est épinglé sur un tag connu et fiable (`v1.9.6`) au moment du build via l'argument de build propre à l'application `GOKAPI_VERSION`. |
| `enable_api_key` | `false` | Génère une clé API aléatoire dans Secret Manager et l'injecte en tant que `GOKAPI_API_KEY`, simple jeton de commodité pour l'opérateur. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Limite de CPU du conteneur Gokapi. |
| `memory_limit` | `1Gi` | Limite de mémoire ; Gokapi est un binaire Go léger et a besoin de peu de mémoire. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Conservez 1 — la base SQLite de Gokapi n'accepte qu'un seul rédacteur et n'a pas de mode distribué. |
| `container_port` | `53842` | Non transmis à la fondation ; le port de Gokapi est fixé à `53842` via `Gokapi_Common`. |
| `enable_cloudsql_volume` | `false` | Doit rester `false` — Gokapi n'a pas de base de données Cloud SQL. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Joignable de l'extérieur par défaut. Définissez `ClusterIP` pour rendre le Service uniquement interne et faire passer le point d'entrée public par la Gateway du groupe 19 (`enable_custom_domain`, ci-dessous). |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet`, car `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `None` | La persistance de session n'a guère d'intérêt avec un réplica unique. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne un PVC en mode bloc propre à chaque pod pour la base SQLite + les téléversements ; fortement recommandé par rapport à GCS FUSE pour Gokapi. |
| `stateful_pvc_size` | `20Gi` | Taille permettant de contenir la base SQLite ainsi que tous les fichiers téléversés. |
| `stateful_pvc_mount_path` | `/data` | `GOKAPI_CONFIG_DIR` (`/data/config`) et `GOKAPI_DATA_DIR` (`/data/data`) résident tous deux sous ce montage. |
| `stateful_pvc_storage_class` | `standard-rwo` | Persistent Disk équilibré (SSD) par défaut sur GKE Autopilot ; consomme le quota `SSD_TOTAL_GB`. |
| `stateful_fs_group` | `3000` | Correspond à l'UID 1000 / GID 2000 de Gokapi, afin que le PVC soit accessible en écriture au groupe. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — Gokapi assure sa persistance via le PVC du StatefulSet, et non via un NFS partagé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé — Gokapi n'a pas de base de données SQL ; toutes les autres variables de base de données de ce groupe ne sont transmises que pour la compatibilité de mise en miroir des variables et n'ont aucun effet. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut (ce qui est inhabituel parmi les modules d'application), afin qu'un point de terminaison Gateway public existe d'emblée, conformément à la finalité de Gokapi, qui génère des liens partageables. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre, qui alimente le nom d'hôte par défaut `<ip>.nip.io`. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré ; s'ajoutent au point de terminaison Gateway par défaut. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Gokapi. |
| `gokapi_api_key_secret_id` | ID du secret Secret Manager de la clé API d'opérateur facultative ; vide lorsque `enable_api_key` vaut `false`. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, monté uniquement si le PVC du StatefulSet est désactivé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuelles tâches d'initialisation fournies par l'utilisateur (aucune par défaut). |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé conjointement à un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous forme d'entiers nus, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de la moindre ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Le désactiver fait basculer la base SQLite sur un montage GCS FUSE — la sémantique d'écriture de gcsfuse n'est pas sûre pour SQLite et expose à une corruption des métadonnées en usage réel. |
| `stateful_pvc_mount_path` | `/data` (conservez la valeur par défaut) | Critical | `GOKAPI_CONFIG_DIR` et `GOKAPI_DATA_DIR` sont tous deux calculés par rapport à ce chemin ; le modifier sans remplacements correspondants dans `environment_variables` rend orphelines la base SQLite et les téléversements existants. |
| `max_instance_count` | `1` | Critical | La base de données SQLite de Gokapi n'accepte qu'un seul rédacteur et ne propose pas de clustering ; exécuter plus d'un réplica expose à une corruption de la base et à des téléversements incohérents. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Convient à un usage courant ; sur un projet soumis à des quotas serrés (par exemple un `SSD_TOTAL_GB` limité), remplacez-le par le HDD `standard` conformément à [App_GKE](App_GKE.md) si le quota est rare — le profil d'E/S de Gokapi n'exige pas des IOPS de niveau SSD. |
| `create_cloud_storage` | `true` (par défaut) avec `stateful_pvc_enabled = true` | Medium | Crée un bucket GCS `storage` inutilisé, jamais monté tant que le PVC est actif — définissez `create_cloud_storage = false` pour éviter ce bucket superflu, ou laissez-le si vous pourriez désactiver le PVC ultérieurement. |
| `enable_api_key` (secret généré automatiquement) | Laissez `false`, sauf si vous avez besoin d'une clé préprovisionnée | Low | Le jeton n'est qu'un outil de commodité ; les véritables clés API de téléversement/téléchargement de Gokapi sont créées depuis l'interface d'administration, quel que soit ce paramètre. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans le namespace. |
| `enable_custom_domain` / `reserve_static_ip` | `true` / `true` (valeurs par défaut) | Medium | Désactiver les deux laisse Gokapi joignable uniquement via le `ClusterIP` interne, sans URL publique pour les liens de téléchargement qu'il génère — ce qui va à l'encontre de la finalité de l'application pour le partage externe. |
| `enable_cloudsql_volume` | `false` | Low | Le définir à `true` injecte un sidecar Cloud SQL Auth Proxy inutile ; Gokapi ne l'utilise jamais. |
| `enable_nfs` | `false` | Low | Gokapi assure par défaut sa persistance via le PVC du StatefulSet ; activer NFS ajoute une instance Filestore inutilisée, sauf si vous désactivez délibérément le PVC et souhaitez plutôt un stockage partagé. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Gokapi
partagée avec la variante Cloud Run est décrite dans
**[Gokapi_Common](Gokapi_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gokapi sur GKE Autopilot](../labs/Gokapi_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gokapi sur Google Cloud Run](Gokapi_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gokapi Common — Configuration applicative partagée](Gokapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
