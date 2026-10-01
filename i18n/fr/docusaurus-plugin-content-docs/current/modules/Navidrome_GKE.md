---
title: "Navidrome sur GKE Autopilot"
description: "Référence de configuration pour déployer Navidrome sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Navidrome_GKE.md @ 3055034 sha256:60ad3c902b13 -->

# Navidrome sur GKE Autopilot {#navidrome-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Navidrome_GKE.png" alt="Navidrome sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Navidrome est un serveur de streaming musical gratuit, open source et auto-hébergé,
écrit en Go. Il expose une API compatible Subsonic/OpenSubsonic (de sorte que
n'importe quel client Subsonic — DSub, Symfonium, Sublime Music, play:Sub, etc. —
peut parcourir et diffuser votre bibliothèque) ainsi que sa propre interface web, et
stocke son état dans une base de données **SQLite** embarquée plutôt que dans un
backend SQL géré. Ce module déploie Navidrome sur **GKE Autopilot** en s'appuyant sur
le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Navidrome et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Navidrome s'exécute sous la forme d'un unique binaire Go servant HTTP sur un seul
port. Comme il n'a pas de base de données externe, le déploiement assemble un
ensemble de services Google Cloud plus restreint qu'une application classique
adossée à une base de données :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un pod `StatefulSet` sur le port `4533`, 1 vCPU / 1 GiB par défaut |
| Données applicatives | PVC de stockage en mode bloc (Persistent Disk, via `stateful_pvc_enabled`) | Sert de support à la base SQLite embarquée, au cache des pochettes et à l'index de recherche sous `/data` — **pas** Cloud SQL |
| Bibliothèque musicale | Volume GCS FUSE ou Cloud Filestore (NFS) fourni par l'opérateur sur `/music` | Fichiers audio sources en lecture seule ; non provisionnés automatiquement |
| Stockage objet | Cloud Storage | Un bucket `storage` est toujours créé mais reste **non monté** tant que le PVC en mode bloc par défaut gère `/data` |
| Secrets | Secret Manager | Un mot de passe administrateur généré automatiquement (`ND_DEVAUTOCREATEADMINPASSWORD`), injecté sous forme de Secret Kubernetes natif |
| Ingress | Kubernetes Gateway API / ClusterIP | Pas de `LoadBalancer` par défaut — accès interne uniquement tant qu'un domaine personnalisé ou une modification de `service_type` n'est pas configuré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL.** `database_type` est fixé à `NONE` par
  `Navidrome_Common` ; chaque variable `db_*`/`database_*`/`sql_instance_*` de ce
  module est transmise au socle uniquement par compatibilité structurelle et
  n'a aucun effet.
- **SQLite a besoin d'un vrai PVC en mode bloc, pas de `gcsfuse`.** Selon la
  convention de stockage de ce dépôt, `gcsfuse` ne peut pas servir de support fiable
  au modèle de verrouillage en écriture de SQLite. GKE donne ici à Navidrome un réel
  avantage sur la variante Cloud Run : `stateful_pvc_enabled` vaut **`true`** par
  défaut, ce qui provisionne un Persistent Disk par pod monté sur `/data`
  (`ND_DATAFOLDER`) contenant la base SQLite, le cache des pochettes et l'index de
  recherche. La charge de travail est alors résolue automatiquement en `StatefulSet`.
- **La classe de stockage du PVC est `standard-rwo` (SSD Balanced PD) par défaut.**
  Elle consomme le quota régional `SSD_TOTAL_GB`, très limité, documenté dans les
  conventions de stockage de ce dépôt. Le répertoire de données de Navidrome a la
  taille de métadonnées/d'un index, pas celle de médias volumineux ; le SSD est donc
  raisonnable ici — mais sur un projet soumis à des contraintes de quota, envisagez
  `-var stateful_pvc_storage_class=standard` (HDD `pd-standard`) si vous rencontrez
  `Quota 'SSD_TOTAL_GB' exceeded` sur un ensemble plus large d'applications avec état.
- **La bibliothèque musicale n'est pas montée automatiquement.**
  `ND_MUSICFOLDER=/music` est défini comme variable d'environnement, mais aucun volume
  n'est attaché à `/music` par défaut — vous devez ajouter un volume GCS FUSE en
  lecture seule (`gcs_volumes`) ou un montage NFS (`enable_nfs = true`,
  `nfs_mount_path = "/music"`) pointant vers vos fichiers audio sources.
  Contrairement à `/data`, `/music` est en lecture seule et ne contient aucun état
  SQLite ; `gcsfuse` convient donc pour celui-ci.
- **Un seul réplica par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. Navidrome sert une unique bibliothèque SQLite partagée
  depuis un seul PVC ; il n'existe aucun mode multi-écrivain/cluster, ne dépassez
  donc pas 1.
- **Pas d'ingress externe par défaut.** `service_type = "ClusterIP"` et
  `enable_custom_domain = true` mais avec une liste `application_domains` vide — par
  défaut, Navidrome n'est donc accessible qu'à l'intérieur du cluster/VPC. Définissez
  `application_domains` (Gateway + certificat géré) ou passez `service_type` à
  `LoadBalancer` pour l'exposer à l'extérieur.
- **Le compte administrateur est créé automatiquement.**
  `enable_admin_password = true` génère un mot de passe aléatoire, le stocke dans
  Secret Manager et l'injecte sous `ND_DEVAUTOCREATEADMINPASSWORD` afin que Navidrome
  crée l'utilisateur `admin` au premier démarrage. Définissez-le à `false` pour
  utiliser plutôt l'assistant de configuration web du premier lancement.
- **Les sondes de santé interrogent le point de terminaison public `GET /ping`**
  (renvoie `{"status":"ok"}`, aucune authentification requise).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Navidrome {#a-gke-autopilot--the-navidrome-statefulset}

Avec la valeur par défaut `stateful_pvc_enabled = true`, Navidrome est déployé en
tant que `StatefulSet` (et non `Deployment`) afin que son unique pod conserve une
identité stable et un PVC qui survit aux replanifications. Autopilot facture le
CPU/la mémoire que le pod demande effectivement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Navidrome pour voir les pods, les révisions et les événements. Vérifiez que le type
  de charge de travail indique `StatefulSet`.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour le fonctionnement général de la planification
Autopilot et de la résolution automatique `StatefulSet`/`Deployment`.

### B. PVC de stockage en mode bloc — le volume de données SQLite {#b-block-storage-pvc--the-sqlite-data-volume}

Le PersistentVolumeClaim par pod sur `/data` est l'unique source de vérité de
Navidrome : la base SQLite, le cache de métadonnées/de pochettes, les fichiers
temporaires de transcodage (s'il est activé) et l'index de recherche y résident
tous. Perdre ce PVC fait perdre les métadonnées de votre bibliothèque, vos
playlists, vos notes et vos utilisateurs (l'audio source lui-même n'est pas affecté,
puisque `/music` est un montage distinct fourni par l'opérateur).

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims et
  PersistentVolumes ; Compute Engine → Disks pour voir le Persistent Disk sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Consultez le groupe 7 d'[App_GKE](App_GKE.md) pour l'ensemble des mécanismes
`stateful_pvc_*` (classe de stockage, politique de gestion des pods, stratégie de
mise à jour).

### C. Stockage de la bibliothèque musicale (GCS FUSE ou NFS) {#c-music-library-storage-gcs-fuse-or-nfs}

`/music` est l'emplacement où Navidrome recherche les fichiers audio. Rien n'y est
monté par défaut — configurez soit un **volume GCS FUSE en lecture seule**
(`gcs_volumes`, reposant sur le pilote CSI, adapté ici puisque `/music` ne contient
aucun état SQLite) pointant vers un bucket d'audio téléversé, soit un partage
**Cloud Filestore (NFS)** (`enable_nfs = true`, `nfs_mount_path = "/music"`) si vous
avez besoin d'un accès en écriture depuis un autre hôte pour ajouter des fichiers. Un
bucket GCS `storage` distinct, toujours créé, existe par compatibilité avec la
variante Cloud Run mais reste non monté tant que le PVC en mode bloc sert `/data`.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~<service-name>"
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls /music
  ```

Consultez les groupes 13–14 d'[App_GKE](App_GKE.md) pour les mécanismes des volumes
NFS et GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : le mot de passe administrateur, stocké sous
`secret-<prefix>-navidrome-admin-password` et injecté dans le pod sous forme de
Secret Kubernetes natif (et non via le pilote Secret Store CSI) pour la variable
d'environnement `ND_DEVAUTOCREATEADMINPASSWORD`, que Navidrome lit au premier
démarrage pour créer le compte `admin`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration générale Secret Manager / Secret
Store CSI utilisée par les secrets des autres applications.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, `service_type = "ClusterIP"` et `application_domains` est vide ;
Navidrome n'est donc accessible que depuis l'intérieur du VPC/cluster
(`http://<service>.<namespace>.svc.cluster.local`). Définissez `application_domains`
(avec `enable_custom_domain = true`, déjà la valeur par défaut du module) pour
provisionner une Kubernetes Gateway avec un certificat TLS géré, ou passez
`service_type` à `LoadBalancer` pour obtenir une simple IP externe.

- **Console :** Kubernetes Engine → Services & Ingress ; Network services → Load
  balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez le groupe 19 d'[App_GKE](App_GKE.md) pour les mécanismes de la Gateway
API, de l'IP statique et du nom d'hôte `nip.io` par défaut.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE
vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs
sont disponibles (`uptime_check_config` vaut `false` par défaut).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Navidrome {#3-navidrome-application-behaviour}

- **Pas de job d'initialisation/de migration.** Navidrome n'a pas de base de données
  externe ; il n'y a donc aucun Job `db-init` ni de migration — le schéma SQLite est
  créé par le binaire lui-même au premier démarrage sur le PVC `/data` vide.
  `initialization_jobs` vaut `[]` par défaut et ne sert qu'à des tâches
  personnalisées fournies par l'opérateur.
- **Amorçage de l'administrateur.** Avec `enable_admin_password = true` (valeur par
  défaut), le conteneur démarre avec `ND_DEVAUTOCREATEADMINPASSWORD` défini à partir
  du secret généré, et Navidrome crée automatiquement l'utilisateur `admin` avec ce
  mot de passe au premier démarrage. Avec `enable_admin_password = false`, la
  première personne qui ouvre l'interface web termine l'assistant de configuration et
  choisit ses propres identifiants administrateur — recommandé uniquement pour des
  déploiements internes au cluster, à accès de confiance.
- **Identité du PVC quasi immuable.** Comme le pod est un `StatefulSet`, le PVC est
  lié à l'identité stable du pod (`<service-name>-0`) et survit aux
  replanifications/redémarrages du pod. Porter `max_instance_count` au-delà de 1
  n'est pas pris en charge — Navidrome n'a aucun mode SQLite multi-écrivain.
- **Chemin de contrôle d'état.** La sonde de démarrage et la sonde de vivacité sont
  toutes deux des requêtes **HTTP** `GET /ping`, un point de terminaison non
  authentifié qui renvoie `{"status":"ok"}`. Prévoyez quelques minutes au premier
  démarrage pendant l'analyse de la bibliothèque (les grandes bibliothèques prennent
  plus de temps).
- **Analyse de la bibliothèque.** Navidrome analyse `/music` au démarrage puis selon
  une planification périodique ; la progression et les résultats de l'analyse sont
  visibles dans les journaux du pod et dans l'interface web.
- **Vérifiez la configuration en cours d'exécution et le montage de la
  bibliothèque :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep ^ND_
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls /music
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=50 | grep -i scan
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Navidrome ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `navidrome` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `deluan/navidrome` utilisé comme base du build personnalisé ; `latest` est fixé à un tag éprouvé (`0.54.3`) au moment du build. |
| `application_display_name` | `Navidrome Music Server` | Nom lisible affiché dans l'interface de la plateforme. |
| `enable_admin_password` | `true` | Génère automatiquement le mot de passe administrateur et crée l'utilisateur `admin` au premier démarrage via `ND_DEVAUTOCREATEADMINPASSWORD`. Définissez `false` pour utiliser plutôt l'assistant web du premier lancement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU ; augmentez-le pour le transcodage à la volée, qui sollicite fortement le CPU. |
| `memory_limit` | `1Gi` | Navidrome conserve son index de recherche en mémoire ; dimensionnez selon la taille de la bibliothèque. |
| `min_instance_count` | `1` | Conservez 1 — évite les démarrages à froid pendant le chargement de l'index/de la bibliothèque. |
| `max_instance_count` | `1` | **Conservez 1.** Aucune prise en charge de SQLite multi-écrivain. |
| `enable_cloudsql_volume` | `false` | Navidrome n'a pas de base de données Cloud SQL — conservez `false`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement en `StatefulSet` car `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | Accessible depuis l'extérieur par défaut — une IP externe est provisionnée. Définissez `ClusterIP` pour un accès interne uniquement ; accédez-y alors via un domaine personnalisé ou `kubectl port-forward`. |
| `session_affinity` | `None` | Aucun routage persistant nécessaire avec un seul réplica. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne un vrai PVC en mode bloc sur `/data` — nécessaire pour que `gcsfuse` ne serve jamais de support à la base SQLite embarquée. |
| `stateful_pvc_size` | `20Gi` | Dimensionné pour la base SQLite, le cache de métadonnées et l'index de recherche (pas pour la bibliothèque musicale, montée séparément). |
| `stateful_pvc_mount_path` | `/data` | Doit correspondre au `ND_DATAFOLDER` de Navidrome. |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD Balanced PD par défaut ; passez à `standard` (HDD) si le quota `SSD_TOTAL_GB` est contraint. |
| `stateful_fs_group` | `3000` | Correspond à la convention UID 1000/GID 2000 du chart Helm de Navidrome, garantissant que le PVC est accessible en écriture par le groupe. |

### Groupe 13 — Stockage NFS {#group-13--nfs-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Activez-le et définissez `nfs_mount_path = "/music"` pour monter une bibliothèque musicale partagée, accessible en écriture, via Cloud Filestore. |
| `nfs_mount_path` | `/mnt/nfs` | Pas `/music` par défaut — doit être remplacé si vous utilisez NFS pour la bibliothèque. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée toujours le bucket `storage` ; il reste non monté tant que le PVC en mode bloc par défaut sert `/data`. |
| `gcs_volumes` | `[]` | Ajoutez une entrée en lecture seule avec `mount_path = "/music"` pour alimenter votre bibliothèque depuis GCS plutôt que NFS. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Navidrome_Common` — Navidrome n'a pas de base de données SQL ; toutes les autres variables `database_*`/`sql_*` sont sans effet. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la ressource Gateway, mais n'a aucun effet tant que `application_domains` est vide. |
| `application_domains` | `[]` | À définir pour exposer Navidrome à l'extérieur via Gateway + certificat géré. |
| `reserve_static_ip` | `true` | IP stable une fois l'ingress externe (LoadBalancer ou Gateway) configuré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Navidrome. |
| `navidrome_admin_password_secret_id` | ID du secret Secret Manager du mot de passe administrateur généré (vide lorsque `enable_admin_password = false`). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation fournis par l'opérateur. |
| `statefulset_name` | Nom du StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` forcé avec un paramètre sans état, IAP sans identité autorisée, des `quota_memory_*` donnés sous forme d'entiers nus, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver (ou faire reposer `/data` sur `gcsfuse` d'une autre manière) risque de corrompre le modèle de verrouillage en écriture de SQLite — corruption de la base, perte des métadonnées de la bibliothèque. |
| `stateful_pvc_storage_class` | `standard-rwo` (ou `standard` en cas de pression sur le quota) | Élevé | Le SSD consomme le quota régional `SSD_TOTAL_GB`, très limité ; un large ensemble d'applications avec état peut l'épuiser — passez alors au HDD `standard`. |
| `max_instance_count` | `1` | Critique | Navidrome n'a aucun mode SQLite multi-écrivain ; dépasser 1 risque des écritures concurrentes sur le même PVC et une corruption de la base. |
| Volume `/music` (`gcs_volumes` ou `enable_nfs`) | Configurer explicitement | Élevé | Rien n'est monté sur `/music` par défaut — l'analyse de la bibliothèque ne trouve aucun fichier et Navidrome sert un catalogue vide tant qu'aucun volume n'est ajouté. |
| `enable_admin_password` | `true` pour tout déploiement accessible depuis l'extérieur | Élevé | `false` laisse l'assistant du premier lancement exposé à la première personne qui atteint l'URL — elle devient administrateur. |
| `application_domains` / `service_type` | Définir l'un des deux pour exposer à l'extérieur | Moyen | La combinaison par défaut `ClusterIP` + `application_domains` vide rend Navidrome accessible uniquement à l'intérieur du VPC — normal pour un usage interne, surprenant si vous vouliez un accès public. |
| `stateful_pvc_size` | `20Gi` (à augmenter pour les très grandes bibliothèques) | Moyen | Un sous-dimensionnement risque que la base SQLite/le cache/l'index remplissent le PVC sur les grandes bibliothèques ; le pod n'étend pas automatiquement le stockage. |
| `quota_cpu_requests` / `quota_memory_requests` / etc. | N/A | Faible | Ces variables `quota_*` sont déclarées mais **non transmises** au socle par ce module — les définir n'a aucun effet ; seul `enable_resource_quota` est relayé (en se rabattant sur les valeurs de quota par défaut d'App_GKE). |
| `memory_limit` | `1Gi` | Moyen | En dessous d'environ 512Mi, le pod risque un OOM en conservant l'index de recherche en mémoire pendant l'analyse d'une grande bibliothèque. |
| `stateful_fs_group` | `3000` | Moyen | Un `fsGroup` incohérent peut rendre le PVC non inscriptible par l'UID non root de Navidrome, bloquant les écritures de la base au démarrage. |
| `backup_retention_days` | `7` (à augmenter en production) | Faible | Trop court pour une conservation conforme des sauvegardes de `/data`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Navidrome partagée
avec la variante Cloud Run est décrite dans **[Navidrome_Common](Navidrome_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Navidrome sur GKE Autopilot](../labs/Navidrome_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Navidrome sur Google Cloud Run](Navidrome_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Navidrome Common — Configuration applicative partagée](Navidrome_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md), [Komga sur GKE Autopilot](Komga_GKE.md), [Kavita sur GKE Autopilot](Kavita_GKE.md), [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md) dans la solution **Digital Library**.
