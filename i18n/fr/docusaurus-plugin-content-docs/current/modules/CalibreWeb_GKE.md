---
title: "Calibre-Web sur GKE Autopilot"
description: "Référence de configuration pour déployer Calibre-Web sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CalibreWeb_GKE.md @ 3055034 sha256:ce2973053cf7 -->

# Calibre-Web sur GKE Autopilot {#calibre-web-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalibreWeb_GKE.png" alt="Calibre-Web sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Calibre-Web est une application web auto-hébergée et épurée permettant de parcourir, lire et
télécharger des livres numériques depuis une bibliothèque Calibre existante — elle fournit une
liseuse dans le navigateur, un flux OPDS, la gestion des utilisateurs et la synchronisation
Kobo, au-dessus de l'image `calibre-web` amont de LinuxServer.io. Ce module déploie
Calibre-Web sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée ; `CalibreWeb_GKE`
est une fine surcouche qui fournit la configuration propre à Calibre-Web (image, ports,
sondes, raccordement du stockage) et transmet tout le reste tel quel.

Ce guide se concentre sur les services cloud qu'utilise Calibre-Web et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Calibre-Web s'exécute comme une charge de travail unique avec état. Il n'a **aucune base de
données externe** — tout son état (la base de données de l'application, la base de métadonnées
de la bibliothèque Calibre, la configuration, le cache et les journaux) réside dans des
fichiers SQLite internes sous `/config`. Le déploiement assemble un ensemble restreint de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Calibre-Web sur le port 8083, 1 vCPU / 1 GiB par défaut |
| Type de charge de travail | **StatefulSet** Kubernetes | Sélectionné automatiquement parce que `stateful_pvc_enabled = true` par défaut |
| Persistance de la configuration et de la bibliothèque | **Persistent Volume bloc** GKE (`standard-rwo`, sur SSD) | Monté sur `/config` ; contient `app.db`, le `metadata.db` de Calibre, la configuration, le cache et les journaux |
| Stockage d'objets | Cloud Storage | Un bucket suffixé `storage` est toujours provisionné, mais il n'est **pas monté** tant que le PVC du StatefulSet est utilisé (voir §2.C) |
| Secrets | Secret Manager | `CALIBRE_ADMIN_PASSWORD` généré automatiquement — provisionné, mais ce n'est **pas** l'identifiant avec lequel Calibre-Web authentifie réellement la première connexion (voir §3) |
| Base de données | Aucune | `database_type = "NONE"` ; aucune instance, aucun utilisateur Cloud SQL ni job `db-init` |
| Ingress | Kubernetes Gateway API (si un domaine personnalisé est configuré) ou `ClusterIP` interne au cluster | `service_type` vaut par défaut `ClusterIP`, **et non** `LoadBalancer` (voir §2.E) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Avec état, adossé à un PVC par défaut.** `stateful_pvc_enabled = true` et
  `workload_type` est laissé à `null`, ce qui se résout automatiquement en `StatefulSet`
  (selon le comportement de « sélection automatique du StatefulSet » d'App_GKE). Un vrai PVC
  bloc est utilisé à la place de gcsfuse précisément parce que les fichiers SQLite de
  Calibre-Web (`app.db`, `metadata.db`) seraient corrompus par le modèle de cohérence relâchée
  de GCS FUSE.
- **La classe de stockage du PVC est par défaut SSD (`standard-rwo`).** Elle consomme le quota
  régional `SSD_TOTAL_GB`, qui est faible sur les projets limités en quota. Calibre-Web n'a pas
  besoin des IOPS d'un SSD pour sa charge SQLite — envisagez de remplacer par
  `stateful_pvc_storage_class = "standard"` (HDD `pd-standard`) pour préserver le quota SSD
  pour d'autres applications, tout en conservant l'intégrité du verrouillage en écriture
  d'un périphérique bloc dont SQLite a besoin.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`.
  Comme le StatefulSet utilise des `volumeClaimTemplates`, chaque réplica obtient **son propre
  PVC indépendant** — passer au-delà de 1 ne partage pas `/config` entre les pods ; cela
  scinde silencieusement la bibliothèque et la configuration en copies séparées et non
  synchronisées par pod. N'augmentez pas `max_instance_count` sans stratégie de
  synchronisation externe.
- **Aucune base de données.** `database_type = "NONE"` ; il n'y a pas de job `db-init` et
  aucune des variables liées à la base de données de ce module n'est référencée.
- **Pas de Redis.** `enable_redis` est déclaré pour refléter les variables du socle,
  mais il n'est **pas transmis** — `main.tf` impose en dur `enable_redis = false` dans l'appel
  au socle, quelle que soit la valeur de la variable.
- **`service_type` vaut par défaut `ClusterIP`, et non `LoadBalancer`.** Combiné à la valeur
  par défaut `application_domains = []`, le déploiement n'a **aucun accès externe configuré
  d'emblée**, même si `enable_custom_domain = true` par défaut — la Gateway est provisionnée
  mais n'a aucun nom d'hôte à router tant que vous ne fournissez pas `application_domains` ou
  ne passez pas `service_type` à `LoadBalancer`.
- **Le mot de passe administrateur généré n'est pas l'identifiant fonctionnel.** L'image
  LinuxServer amont est livrée avec un identifiant par défaut intégré (`admin` / `admin123`) ;
  le secret Secret Manager `CALIBRE_ADMIN_PASSWORD` est provisionné pour disposer d'un
  identifiant plus robuste, mais il n'est pas raccordé automatiquement au conteneur. Changez
  le mot de passe dans l'interface de Calibre-Web lors de la première connexion.
- **Un bucket Cloud Storage est créé mais inutilisé par défaut.** `create_cloud_storage
  = true` provisionne toujours le bucket suffixé `storage`, mais celui-ci n'est monté sur
  `/config` que lorsque `stateful_pvc_enabled = false` (mode Deployment). Avec le chemin
  StatefulSet/PVC par défaut, le bucket existe mais n'est pas rattaché à la charge de travail.
- **La version de l'image est épinglée via un ARG de build propre à l'application.** Le
  Dockerfile lit `CALIBREWEB_VERSION` (et non le `APP_VERSION` générique qu'injecte le
  socle) ; lorsque `application_version = "latest"`, le build est épinglé sur une version
  connue pour fonctionner, `0.6.24`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Calibre-Web {#a-gke-autopilot--the-calibre-web-statefulset}

Les pods Calibre-Web sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. La charge de travail s'exécute comme un `StatefulSet` (et
non un `Deployment`), ce qui lui donne une identité de pod stable et une séquence de
redémarrage ordonnée (`stateful_pod_management_policy` vaut par défaut `OrderedReady`
lorsqu'il est laissé à `null`).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Calibre-Web
  pour voir les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle
et la sélection du type de charge de travail.

### B. Stockage bloc — le Persistent Volume Claim `/config` {#b-block-storage--the-config-persistent-volume-claim}

Les fichiers SQLite de Calibre-Web (`app.db`, le `metadata.db` de Calibre), la configuration,
le cache et les journaux résident sur un PVC bloc par pod monté sur `/config`
(`stateful_pvc_mount_path`), d'une taille de `20Gi` par défaut
(`stateful_pvc_size`), sur la StorageClass `standard-rwo` (SSD `pd-balanced`)
(`stateful_pvc_storage_class`).

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims ; Compute
  Engine → Storage → Disks.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

Comme les PVC SSD consomment le quota serré `SSD_TOTAL_GB` et que la mise à zéro d'une
application avec état **conserve** son PVC (seule la suppression du PVC ou de l'espace de noms
libère le quota), vérifiez l'utilisation actuelle avant une large campagne d'applications GKE
avec état. Consultez [App_GKE](App_GKE.md) pour le cycle de vie des StatefulSet et des PVC en
général.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** (suffixe `storage`) est toujours provisionné lorsque
`create_cloud_storage = true` (la valeur par défaut) et le compte de service de la charge de
travail y reçoit un accès — mais il n'est **monté** dans le pod sur `/config` via GCS FUSE
que lorsque `stateful_pvc_enabled = false` (c'est-à-dire lors d'une exécution en tant que
`Deployment` au lieu du `StatefulSet` par défaut). Avec la configuration par défaut, le bucket
existe mais n'est pas rattaché à la charge de travail en cours d'exécution.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Consultez [App_GKE](App_GKE.md) pour les montages GCS FUSE et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret Calibre-Web est généré automatiquement et stocké dans Secret Manager :
`CALIBRE_ADMIN_PASSWORD` (une valeur aléatoire de 24 caractères, `secret-<prefix>-<app>-admin-password`),
injecté dans le conteneur en tant que variable d'environnement secrète. Sur GKE, les secrets
sont projetés via le pilote Secret Store CSI / SecretSync ; la clé ne contient pas `__`, c'est
donc un `targetKey` valide.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Remarque : le secret injecté n'est pas appliqué automatiquement comme identifiant de
Calibre-Web — voir §3 pour les identifiants réels de la première connexion. Consultez
[App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

`service_type` vaut par défaut **`ClusterIP`** (interne uniquement), et
`enable_custom_domain = true` par défaut provisionne une ressource Kubernetes Gateway API —
mais avec la valeur par défaut vide `application_domains = []`, la Gateway n'a aucun nom
d'hôte à router ; le déploiement n'a donc **aucun accès externe configuré d'emblée**. Pour
exposer Calibre-Web à l'extérieur, définissez `application_domains` avec un vrai nom d'hôte,
ou passez `service_type` à `LoadBalancer` (qui récupère en outre le nom d'hôte
`<reserved-ip>.nip.io` par défaut d'App_GKE lorsque `reserve_static_ip = true`).

- **Console :** Network services → Load balancing / Gateways ; VPC network → IP
  addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les adresses IP
statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE vers
Cloud Monitoring. Les tests de disponibilité sont désactivés par défaut
(`uptime_check_config.enabled = false`).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Calibre-Web {#3-calibre-web-application-behaviour}

- **Aucun job d'initialisation par défaut.** `initialization_jobs` vaut `[]` par défaut ;
  Calibre-Web gère son propre stockage SQLite et n'a besoin d'aucun amorçage de base de
  données (il n'y a pas de job `db-init` puisque `database_type = "NONE"`). Seuls les jobs
  fournis par l'utilisateur s'exécutent.
- **Image de type fine surcouche, sans point d'entrée personnalisé.** Le Dockerfile est
  `FROM lscr.io/linuxserver/calibre-web:${CALIBREWEB_VERSION}` sans script de point d'entrée
  ajouté — l'initialisation amont de LinuxServer, fondée sur s6, s'exécute telle quelle.
  `image_source = "custom"` est défini uniquement pour que le socle construise ou
  mette en miroir l'image dans Artifact Registry.
- **Organisation du stockage au premier démarrage.** L'image LinuxServer abandonne ses
  privilèges au profit de `PUID=1000`/`PGID=1000` et conserve tout son état sous `/config`
  (`app.db`, le `metadata.db` de Calibre, la configuration, le cache, les journaux) ; la
  bibliothèque de livres elle-même réside sous `/books` (vide au premier lancement — l'assistant
  de configuration intégré à l'application y fait pointer Calibre-Web). `stateful_fs_group`
  vaut `3000` par défaut (convention du chart Helm CalibreWeb) afin que le PVC soit accessible
  en écriture au groupe.
- **Identifiants de connexion.** Les identifiants de première connexion intégrés à l'image
  amont sont `admin` / `admin123`. Le `CALIBRE_ADMIN_PASSWORD` généré par Secret Manager
  n'est **pas** appliqué automatiquement — il existe pour qu'un mot de passe robuste soit
  disponible dans Secret Manager et pour qu'une future image ou un futur point d'entrée puisse
  l'utiliser. Changez le mot de passe administrateur dans l'interface de Calibre-Web
  immédiatement après la première connexion.
- **Sondes de santé.** Les sondes de démarrage et de vivacité émettent toutes deux un
  **HTTP GET `/`** (la page de connexion de Calibre-Web), qui renvoie `200` sans
  authentification — les sondes réussissent donc dès que le serveur répond, indépendamment de
  tout état de connexion.
  Démarrage : `initial_delay=15s`, `timeout=5s`, `period=10s`, `failure_threshold=10`.
  Vivacité : `initial_delay=30s`, `timeout=5s`, `period=30s`, `failure_threshold=3`.
- **Contrainte de mise à l'échelle.** `min_instance_count = 1` / `max_instance_count = 1` par
  défaut. Comme le StatefulSet provisionne un PVC distinct par réplica
  (`volumeClaimTemplates`), augmenter `max_instance_count` ne donne **pas** aux pods une
  bibliothèque partagée — chaque pod obtient son propre `/config` indépendant et non
  synchronisé.
- **Vérifier le déploiement :**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /config
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Calibre-Web ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs
valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calibreweb` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag `lscr.io/linuxserver/calibre-web` utilisé comme base du build personnalisé ; `latest` est épinglé sur un tag connu pour fonctionner (`0.6.24`) au moment du build via l'ARG de build propre à l'application `CALIBREWEB_VERSION`. |
| `application_display_name` | `Calibre-Web` | Nom lisible utilisé à des fins d'affichage. |
| `description` | `Calibre-Web — a web app for browsing, reading and downloading ebooks from a Calibre library.` | Renseigne la description de la charge de travail GKE. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | Limite de mémoire du conteneur Calibre-Web. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Conservez 1 — voir la contrainte de mise à l'échelle au §3 (scission des PVC par réplica). |
| `container_port` | `8083` | Fixé par `CalibreWeb_Common` ; la variable du module n'est pas transmise à App_GKE et n'a aucun effet. |
| `enable_cloudsql_volume` | `false` | Laissé désactivé à juste titre — Calibre-Web n'utilise pas Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Accessible depuis l'extérieur par défaut. Définissez `ClusterIP` pour un accès interne uniquement — voir au §2.E le piège d'ingress que cela crée en combinaison avec `application_domains = []`. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement parce que `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Pas de routage persistant par défaut (le réplica unique rend ce point sans objet à l'échelle par défaut). |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne un PVC bloc par pod — requis, car gcsfuse corromprait les fichiers SQLite de Calibre-Web. |
| `stateful_pvc_size` | `20Gi` | Taille de `/config` et de la bibliothèque Calibre. |
| `stateful_pvc_mount_path` | `/config` | Emplacement où Calibre-Web stocke ses bases SQLite, sa configuration, son cache et ses journaux. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Consomme le quota régional `SSD_TOTAL_GB`. La charge SQLite de Calibre-Web n'a pas besoin des IOPS d'un SSD — envisagez `standard` (HDD `pd-standard`) pour économiser le quota SSD. |
| `stateful_fs_group` | `3000` | Correspond à la convention du chart Helm CalibreWeb, afin que le PVC soit accessible en écriture au groupe pour `PUID:PGID=1000:1000`. |

### Groupe 9 — PodDisruptionBudget {#group-9--poddisruptionbudget}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut (contrairement à la plupart des modules). |
| `pdb_min_available` | `1` | Avec `max_instance_count = 1`, un PDB de `1` bloque de fait l'éviction volontaire de l'unique pod tant qu'il ne peut pas être replanifié. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` (depuis `CalibreWeb_Common`) | HTTP `/` | Page de connexion, `200`, sans authentification — réussit dès que le serveur répond. |
| `uptime_check_config.enabled` | `false` | Les tests de disponibilité sont désactivés par défaut. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est **pas** utilisé par Calibre-Web — la persistance passe par le PVC du StatefulSet (ou GCS FUSE en mode Deployment). |
| `network_tags` | `["nfsserver"]` | Inclut par défaut le tag `nfsserver` bien que NFS soit désactivé par défaut ; sans conséquence, mais pertinent uniquement si vous activez NFS séparément. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne toujours le bucket suffixé `storage`, mais voir §2.C — il n'est pas monté tant que `stateful_pvc_enabled = true` (la valeur par défaut). |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (déclaré) | **Inerte** — `main.tf` impose en dur `enable_redis = false` dans l'appel au socle, quelle que soit la valeur de cette variable. Calibre-Web n'utilise pas Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Déclarés pour refléter les variables du socle, mais **pas du tout transmis** à App_GKE. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `CalibreWeb_Common` ; aucune instance, base ni utilisateur Cloud SQL n'est créé. Toutes les autres variables `database_*`/`sql_*` de ce groupe sont explicitement « Not referenced. » |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la ressource Gateway API, mais ne sert à rien en externe sans `application_domains` défini (voir §2.E). |
| `application_domains` | `[]` | Vide par défaut — définissez-le pour obtenir un nom d'hôte externe fonctionnel tant que `service_type = ClusterIP`. |
| `reserve_static_ip` | `true` | Se raccorde au nom d'hôte `<reserved-ip>.nip.io` par défaut d'App_GKE uniquement lorsque `service_type = LoadBalancer` ; le comportement combiné au `ClusterIP` par défaut n'est pas explicitement documenté par le socle. {/* TODO: confirm whether reserve_static_ip provisions/attaches an address when service_type stays ClusterIP with enable_custom_domain=true */} |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée et que `service_type = LoadBalancer`). |
| `service_url` | URL permettant d'accéder à Calibre-Web. |
| `calibreweb_admin_password_secret_id` | ID du secret Secret Manager contenant le `CALIBRE_ADMIN_PASSWORD` généré (voir au §3 pourquoi ce n'est pas l'identifiant initial). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous forme d'entiers bruts, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Chaque réplica du StatefulSet obtient son propre PVC (`volumeClaimTemplates`) — augmenter le nombre de réplicas scinde `/config` en copies indépendantes et non synchronisées par pod, et non en une bibliothèque partagée. |
| `stateful_pvc_enabled` | `true` (à conserver) | Critical | Passer à `false`/mode `Deployment` déplace `/config` sur GCS FUSE, ce qui peut corrompre les fichiers SQLite de Calibre-Web (`app.db`, `metadata.db`) avec ses schémas d'accès. |
| `service_type` + `application_domains` | Définir `application_domains`, ou utiliser `LoadBalancer` | High | Avec les valeurs par défaut (`ClusterIP` + `application_domains` vide), le déploiement n'a **aucun accès externe configuré** malgré `enable_custom_domain = true`. |
| `stateful_pvc_storage_class` | `standard` (HDD) pour les projets limités en quota | Medium | La valeur par défaut `standard-rwo` (SSD) consomme le quota serré `SSD_TOTAL_GB` ; une campagne d'applications GKE avec état peut l'épuiser vers la 8e application. La mise à zéro ne libère **pas** le PVC — seule sa suppression le fait. |
| `CALIBRE_ADMIN_PASSWORD` (généré automatiquement) | Changer l'identifiant dans l'interface lors de la première connexion | High | Le secret généré n'est pas appliqué automatiquement ; l'identifiant fonctionnel de première connexion est la valeur amont par défaut `admin`/`admin123` jusqu'à ce qu'il soit modifié manuellement. |
| `enable_resource_quota` | Bien comprendre avant d'activer | Medium | Les variables `quota_cpu_*`/`quota_memory_*`/`quota_max_*` de ce module sont déclarées mais **pas transmises** à App_GKE — activer le quota utilise les valeurs par défaut propres au socle (4 CPU / 4Gi–8Gi de mémoire / 20 pods), et non une valeur définie sur ce module. |
| `enable_redis` | À ignorer — inerte | Low | `main.tf` impose en dur `enable_redis = false` quelle que soit cette variable ; Calibre-Web ne dépend pas de Redis. |
| `create_cloud_storage` | `false` si vous n'avez pas besoin du bucket de repli | Low | Avec le chemin StatefulSet par défaut, le bucket `storage` est provisionné mais jamais monté — un coût faible et évitable si vous ne prévoyez pas de passer en mode Deployment. |
| `memory_limit` | `1Gi` (à augmenter pour les grandes bibliothèques) | Medium | Calibre-Web charge en mémoire les index de la bibliothèque et des collections ; une sous-dimension expose à un OOM avec une grande bibliothèque Calibre. |
| `quota_memory_requests` / `_limits` (au niveau du socle, si vous activez les quotas directement sur App_GKE) | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La
configuration applicative propre à Calibre-Web, partagée entre les variantes de plateforme,
est décrite dans **[CalibreWeb_Common](CalibreWeb_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Calibre-Web sur GKE Autopilot](../labs/CalibreWeb_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Calibre-Web sur Google Cloud Run](CalibreWeb_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Calibre-Web Common — Configuration applicative partagée](CalibreWeb_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Komga sur GKE Autopilot](Komga_GKE.md), [Kavita sur GKE Autopilot](Kavita_GKE.md), [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md), [Navidrome sur GKE Autopilot](Navidrome_GKE.md) dans la solution **Digital Library**.
