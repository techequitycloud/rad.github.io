---
title: "Filebrowser sur GKE Autopilot"
description: "Référence de configuration pour déployer Filebrowser sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Filebrowser_GKE.md @ 3055034 sha256:2c56c4ed7abc -->

# Filebrowser sur GKE Autopilot {#filebrowser-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Filebrowser_GKE.png" alt="Filebrowser sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

File Browser est un gestionnaire de fichiers web léger et open source écrit en Go —
il sert une arborescence de répertoires en HTTP pour parcourir, téléverser, modifier
et partager des fichiers. Ce module déploie Filebrowser sur **GKE Autopilot** en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Filebrowser et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Filebrowser s'exécute sous forme d'une unique charge de travail web en Go. Il est
volontairement minimal — ni base de données SQL, ni cache, ni file d'attente — si
bien que le déploiement assemble un petit ensemble de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod Go, 1 vCPU / 1 GiB par défaut ; `min = max = 1` |
| État persistant | Cloud Storage (GCS FUSE) **ou** un PVC bloc | Monté sur `/database` ; contient la base SQLite embarquée |
| Base de données | Aucune (SQLite embarquée) | `database_type = NONE` ; aucune instance Cloud SQL n'est provisionnée |
| Cache et file d'attente | Aucun | Filebrowser n'utilise pas Redis |
| Secrets | Secret Manager | Aucun secret applicatif généré ; les utilisateurs résident dans la base SQLite |
| Entrée | Cloud Load Balancing | Service `ClusterIP` par défaut ; domaine personnalisé + certificat géré disponibles |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **L'état réside dans un fichier SQLite embarqué sur `/database`.** Filebrowser
  n'a pas de base de données Cloud SQL. Ses utilisateurs, ses paramètres et ses liens
  de partage sont stockés dans `/database/filebrowser.db`. Par défaut, `/database`
  est un bucket Cloud Storage monté via GCS FUSE ; activer un StatefulSet le remplace
  par un PVC bloc (voir ci-dessous).
- **GCS FUSE ou PVC bloc.** Avec `stateful_pvc_enabled = true`, la charge de travail
  devient un **StatefulSet** doté d'un PVC bloc persistant (`20Gi` par défaut) monté
  sur `/database`, et le volume GCS FUSE est automatiquement désactivé pour éviter un
  double montage sur le même chemin. Un PVC bloc offre à SQLite un véritable
  verrouillage de fichiers POSIX et constitue le choix le plus robuste pour un
  gestionnaire de fichiers avec état.
- **Instance unique par conception.** `min_instance_count = max_instance_count = 1`.
  SQLite ne tolère pas les écritures concurrentes — conservez un seul réplica.
- **L'identifiant par défaut est `admin` / `admin`.** Filebrowser le crée au premier
  démarrage ; modifiez-le dans l'interface web immédiatement après le déploiement.
- **Pas de Redis, pas de tâche d'initialisation.** `enable_redis = false` et aucune
  tâche `db-init` ne s'exécute ; le pod est prêt dès que le conteneur démarre.
- **Port du conteneur 80.** Filebrowser sert du HTTP/1.1 simple sur le port 80.
- **Le domaine personnalisé est activé par défaut.** `enable_custom_domain = true`
  et `reserve_static_ip = true` ; renseignez `application_domains` pour servir un nom
  d'hôte avec un certificat géré par Google.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Filebrowser {#a-gke-autopilot--the-filebrowser-workload}

Filebrowser s'exécute en tant que Deployment à réplica unique (ou StatefulSet
lorsque `stateful_pvc_enabled = true`) planifié sur Autopilot, qui facture le CPU et
la mémoire réellement demandés par le pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Filebrowser pour consulter les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche le Service et l'éventuelle IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud Storage / PVC bloc — état persistant {#b-cloud-storage--block-pvc--persistent-state}

Filebrowser n'a pas de base de données Cloud SQL. Sa base de données SQLite
embarquée (`/database/filebrowser.db`) est stockée sur le montage `/database` :

- **Par défaut (Deployment) :** un bucket **Cloud Storage** dédié monté via GCS FUSE
  au moyen du pilote CSI.
- **StatefulSet (`stateful_pvc_enabled = true`) :** un **PersistentVolumeClaim**
  bloc (`20Gi` par défaut, StorageClass `standard-rwo`) monté sur `/database` ; le
  volume GCS FUSE est désactivé pour éviter un double montage.

- **Console :** Cloud Storage → Buckets ; ou Kubernetes Engine → Storage → PVCs.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"   # GCS FUSE mode
  gcloud storage ls gs://<data-bucket>/filebrowser.db
  kubectl get pvc -n "$NAMESPACE"                                            # PVC mode
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK, GCS FUSE et les PVC de
StatefulSet.

### C. Secret Manager {#c-secret-manager}

Filebrowser ne génère **aucun secret applicatif** — il n'y a ni clé de chiffrement
ni secret JWT à gérer, car tout l'état d'identité réside dans la base SQLite. Secret
Manager reste utilisé par le socle pour les secrets gérés par la plateforme (par
exemple les jetons CI/CD s'ils sont configurés).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~filebrowser"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, le Service est de type `ClusterIP`, avec `enable_custom_domain = true`
et `reserve_static_ip = true`, de sorte qu'un Ingress doté d'un certificat géré par
Google puisse servir le nom d'hôte fourni sur une IP stable. Sans domaine
personnalisé, la charge de travail est accessible au sein du cluster à l'adresse
`http://<service>.<namespace>.svc.cluster.local`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques de
GKE sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Filebrowser {#3-filebrowser-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni
  tâche `db-init` ni instance Cloud SQL. Au premier démarrage, le binaire Filebrowser
  crée sa base de données SQLite à `/database/filebrowser.db` si elle n'existe pas
  encore et crée l'utilisateur par défaut `admin`/`admin`.
- **Persistance de l'état.** Les utilisateurs, les paramètres et les liens de
  partage résident entièrement dans `/database/filebrowser.db` sur le montage
  `/database` (bucket GCS FUSE ou PVC bloc) et survivent aux redémarrages et aux
  redéploiements. `FB_ROOT = /srv` est l'arborescence de fichiers servie par
  l'application.
- **Les identifiants par défaut doivent être modifiés.** La connexion
  `admin`/`admin` créée initialement est bien connue. Connectez-vous et modifiez le
  mot de passe (et idéalement le nom d'utilisateur) dans l'interface web
  immédiatement après le premier déploiement.
- **Contrainte d'écrivain unique.** La base de données SQLite embarquée ne prend pas
  en charge les écritures concurrentes. Conservez
  `min_instance_count = max_instance_count = 1` ; un PVC bloc de StatefulSet offre
  un verrouillage de fichiers correct mais reste à réplica unique.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent **`/health`** —
  le point de terminaison de santé non authentifié de Filebrowser, qui renvoie `200`
  dès que le serveur écoute :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- wget -qO- http://localhost:80/health
  ```
- **Pas de Redis.** `enable_redis = false` ; Filebrowser est un gestionnaire de
  fichiers autonome, sans file d'attente ni cache. La valeur par défaut
  `enable_redis = true` d'App_GKE est explicitement remplacée.
- **Une image construite sur mesure nécessite `imagePullPolicy = Always`.** L'image
  est une fine surcouche construite et dupliquée dans Artifact Registry ; App_GKE
  définit `imagePullPolicy = Always` pour les images personnalisées/dupliquées, afin
  qu'un redéploiement après reconstruction récupère toujours la nouvelle couche.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement.
Seuls les paramètres propres à Filebrowser ou notables pour lui sont listés ; toutes
les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `filebrowser` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Filebrowser. `latest` se résout vers la version épinglée `v2.32.0` au moment du build ; épinglez explicitement une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; Filebrowser est léger. |
| `memory_limit` | `1Gi` | Mémoire par pod ; 256Mi suffisent largement pour le serveur Go. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez 1 — SQLite n'accepte qu'un seul écrivain. |
| `max_instance_count` | `1` | **Conservez 1** pour éviter les écritures SQLite concurrentes. |
| `container_port` | `80` | L'écouteur HTTP/1.1 de Filebrowser. |
| `enable_cloudsql_volume` | `false` | Filebrowser n'utilise pas Cloud SQL ; laissez `false`. |
| `enable_image_mirroring` | `true` | Duplique l'image Filebrowser dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes ; placez un Ingress devant via `enable_custom_domain`. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`, sinon en `Deployment`. |
| `session_affinity` | `None` | Réplica unique : le routage persistant est inutile. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour stocker `/database` sur un PVC bloc plutôt que sur GCS FUSE (recommandé pour le verrouillage de fichiers SQLite). |
| `stateful_pvc_size` | `20Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/database` | Chemin de montage — doit correspondre au répertoire de `FB_DATABASE`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass (`standard-rwo` pour un PD équilibré ; `premium-rwo` pour davantage d'IOPS). |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 15s | Sonde de démarrage ; Filebrowser expose `/health` une fois prêt. |
| `liveness_probe` | HTTP `/health`, délai de 30s | Sonde d'activité sur le point de terminaison non authentifié `/health`. |
| `uptime_check_config` | `{enabled=false, path="/health"}` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; inutile pour Filebrowser. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `/database` de Filebrowser (et les éventuels `storage_buckets` supplémentaires). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Le bucket `/database` est ajouté automatiquement (sauf si un PVC est utilisé). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Hérité d'App_GKE et **non** remplacé par ce module. Filebrowser n'utilise pas Redis ; définissez-le donc à `false` lors du déploiement — le laisser activé ajoute une dépendance inutilisée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Sans objet — Filebrowser n'a pas de base de données SQL. `database_password_length`
et `db_name` / `db_user` ne sont transmis au socle que pour des raisons de
compatibilité ; `database_type` est fixé à `NONE` par `Filebrowser_Common`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Filebrowser. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Association des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Filebrowser. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/database` en mode GCS FUSE). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `initialization_jobs` | Noms des éventuelles tâches d'initialisation (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsque `stateful_pvc_enabled = true`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster / la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identifiants OAuth, `min_instance_count > max_instance_count`, `workload_type = Deployment` combiné à `stateful_pvc_enabled = true`, des valeurs de mémoire de ResourceQuota sans suffixe d'unité binaire. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Volume `/database` (bucket ou PVC) | Ne jamais le supprimer | Critical | La base SQLite embarquée réside ici ; la supprimer détruit tous les utilisateurs, paramètres et liens de partage. |
| `admin` / `admin` (identifiant créé initialement) | Modifier à la première connexion | Critical | Conserver l'identifiant par défaut permet à quiconque peut atteindre le service d'en prendre le contrôle total. |
| `max_instance_count` | `1` | High | Une valeur >1 place des écrivains concurrents sur l'unique base SQLite, ce qui la corrompt. |
| `stateful_pvc_mount_path` | `/database` | High | Doit correspondre au répertoire de `FB_DATABASE` ; une incohérence stocke la base sur un disque éphémère et perd l'état au redémarrage. |
| `stateful_pvc_enabled` + `enable_gcs_storage_volume` | Laisser Common désactiver GCS FUSE | High | Les deux sur `/database` provoquent un double montage ; Common définit automatiquement `enable_gcs_storage_volume = false` lorsque le PVC est activé — ne forcez pas les deux. |
| `container_port` | `80` | High | Filebrowser écoute sur le port 80 ; un autre port fait échouer la sonde de démarrage et le pod ne devient jamais Ready. |
| Chemin de `startup_probe` / `liveness_probe` | `/health` | High | Faire pointer les sondes vers un chemin authentifié renvoie 401/403 et le pod ne devient jamais Ready. |
| `enable_cloudsql_volume` | `false` | Medium | Filebrowser n'utilise pas Cloud SQL ; l'activer ajoute un sidecar Auth Proxy inutile. |
| `enable_redis` | `true` | Medium | Filebrowser n'utilise pas Redis, mais la valeur par défaut `true` d'App_GKE est héritée telle quelle — définissez-la explicitement à `false`, sinon une dépendance inutilisée est ajoutée. |
| `enable_iap` | identifiants requis | High | Activer IAP sans `iap_oauth_client_id`/`secret` exposerait silencieusement le service sans authentification (bloqué par une vérification au moment du plan). |
| `application_version` | épingler en production | Medium | `latest` se résout vers la version épinglée `v2.32.0` au moment du build ; épinglez explicitement une version pour maîtriser les mises à niveau. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et duplication des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à
Filebrowser partagée avec la variante Cloud Run est décrite dans
**[Filebrowser_Common](Filebrowser_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Filebrowser sur GKE Autopilot](../labs/Filebrowser_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Filebrowser Common — Configuration applicative partagée](Filebrowser_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Kopia sur GKE Autopilot](Kopia_GKE.md), [UrBackup sur GKE Autopilot](UrBackup_GKE.md) dans la solution **Backup & Disaster Recovery**.
