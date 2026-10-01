---
title: "Wallos sur GKE Autopilot"
description: "Référence de configuration pour déployer Wallos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Wallos_GKE.md @ 3055034 sha256:3a02a47c53bd -->

# Wallos sur GKE Autopilot {#wallos-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallos_GKE.png" alt="Wallos sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallos est un outil open source et auto-hébergé de suivi des abonnements et des
dépenses récurrentes, construit en PHP 8.3 pur + php-fpm (sans framework MVC). Il
suit les abonnements récurrents, convertit les prix entre devises, envoie des
notifications de renouvellement et prend en charge un mode multi-utilisateur pour
le foyer. Ce module déploie Wallos sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Wallos et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Wallos s'exécute comme une charge de travail web PHP/php-fpm unique. Il est
volontairement minimal — pas de base de données SQL, pas de cache, pas de file
d'attente — mais il exécute BIEN un véritable démon cron toujours actif, ce qui
détermine plusieurs des valeurs par défaut ci-dessous :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP unique, 1 vCPU / 1 GiB par défaut ; `min = max = 1` (toujours actif, jamais mis à zéro) |
| État persistant (base de données) | PVC bloc HDD (par défaut) ou Cloud Storage (GCS FUSE) | Monté sur `/var/www/html/db` ; contient le fichier de la base SQLite |
| État persistant (téléversements) | Cloud Storage (GCS FUSE), toujours | Monté sur `/var/www/html/images/uploads/logos` ; un PVC de StatefulSet ne prend en charge qu'un seul mount_path, consacré à la base de données |
| Base de données | Aucune (SQLite embarqué) | `database_type = NONE` ; aucun Cloud SQL n'est provisionné ; il est confirmé qu'aucune prise en charge de MySQL/Postgres n'existe dans l'application |
| Cache et file d'attente | Aucun | Wallos n'utilise pas Redis |
| Secrets | Secret Manager | Aucun secret applicatif généré ; les utilisateurs résident dans la base SQLite |
| Entrée | Cloud Load Balancing | Service `LoadBalancer` par défaut (Wallos est une interface web utilisée depuis le navigateur) ; domaine personnalisé + certificat géré disponibles |
| Jobs en arrière-plan | Démon cron dans le conteneur | 8 tâches planifiées intégrées (actualisation des taux de change, notifications de renouvellement, une interrogation de vérification d'e-mail toutes les 2 minutes, etc.) — s'exécutent en continu dans le pod principal, et non comme un CronJob distinct |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Deux chemins persistants indépendants, sans variable d'environnement pour les
  déplacer.** Wallos n'a pas de base de données Cloud SQL. Sa base SQLite réside
  dans `/var/www/html/db/wallos.db` ; les logos de fournisseurs personnalisés
  téléversés par les utilisateurs résident séparément dans
  `/var/www/html/images/uploads/logos`. Aucun de ces chemins ne peut être déplacé
  via une variable d'environnement.
- **PVC bloc HDD par défaut pour la base de données.** `stateful_pvc_enabled = true`
  (par défaut) exécute la charge de travail en tant que **StatefulSet** avec un PVC
  par pod (par défaut `10Gi`, StorageClass **`standard`** — HDD `pd-standard`, et
  non SSD) monté sur `/var/www/html/db` ; le volume GCS FUSE pour ce même chemin est
  automatiquement désactivé afin d'éviter un double montage. Le choix du HDD est
  délibéré : SQLite a besoin d'un verrouillage en écriture correct, pas d'IOPS, et
  le HDD puise dans le quota `DISKS_TOTAL_GB`, bien plus large, plutôt que dans le
  quota restreint `SSD_TOTAL_GB`. Le chemin des téléversements utilise toujours
  GCS FUSE quoi qu'il arrive, puisqu'un seul mount_path de PVC est disponible.
- **CRITIQUE — réplica unique toujours actif, pas un simple réglage contre les démarrages à froid.**
  `min_instance_count = max_instance_count = 1`. La base SQLite de Wallos ne prend
  pas en charge plusieurs écrivains (d'où l'obligation de `max = 1`), et son démon
  cron intégré ne déclenche les tâches planifiées que lorsqu'un pod s'exécute
  effectivement (d'où l'obligation de `min = 1`). La mise à zéro arrête
  silencieusement toutes les tâches planifiées sans aucune erreur.
- **L'identifiant par défaut est `admin` / `admin`.** Wallos le crée au premier
  démarrage ; modifiez-le dans l'interface web immédiatement après le déploiement.
- **Pas de Redis, pas de job d'initialisation.** `enable_redis = false` et aucun
  job `db-init` ne s'exécute ; le pod est prêt dès que le conteneur démarre.
- **Port du conteneur 80.** Wallos sert du HTTP/1.1 simple sur le port 80.
- **Exposé publiquement par défaut.** `service_type = "LoadBalancer"` — Wallos est
  une interface web utilisée depuis le navigateur, et non un service interne.
  `enable_custom_domain = true` et `reserve_static_ip = true` vous permettent de
  servir un nom d'hôte personnalisé avec un certificat géré par Google.
- **Image précompilée.** `bellamy/wallos` est une véritable image étiquetée
  « latest », maintenue par un tiers (il n'existe pas d'image officielle du projet
  Wallos) ; aucun Dockerfile ni aucune étape Cloud Build n'est utilisé.
  `container_image_source = "prebuilt"` est explicitement transmis au socle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Wallos {#a-gke-autopilot--the-wallos-workload}

Wallos s'exécute comme un StatefulSet à réplica unique (par défaut, puisque
`stateful_pvc_enabled = true`) ou comme un Deployment (si le PVC est désactivé)
planifié sur Autopilot, qui facture le CPU et la mémoire effectivement demandés par
le pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Wallos pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche le Service et toute IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud Storage et PVC bloc — état persistant {#b-cloud-storage--block-pvc--persistent-state}

Wallos n'a pas de base de données Cloud SQL. Ses deux chemins persistants reposent
sur des supports différents :

- **Base de données (`/var/www/html/db/wallos.db`) :** par défaut un
  **PersistentVolumeClaim** bloc (`stateful_pvc_enabled = true`, `10Gi`,
  StorageClass `standard` / HDD) ; si le PVC est désactivé, un bucket **Cloud
  Storage** dédié monté via GCS FUSE au moyen du pilote CSI.
- **Téléversements (`/var/www/html/images/uploads/logos`) :** toujours un bucket
  **Cloud Storage** dédié monté via GCS FUSE, quel que soit le paramètre du PVC.

- **Console :** Cloud Storage → Buckets ; ou Kubernetes Engine → Storage → PVCs.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~wallos"
  kubectl get pvc -n "$NAMESPACE"                              # database PVC (default layout)
  gcloud storage ls gs://<uploads-bucket>/                      # uploaded logo files
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK, GCS FUSE et les PVC de
StatefulSet.

### C. Secret Manager {#c-secret-manager}

Wallos ne génère **aucun secret applicatif** — il n'y a ni clé de chiffrement ni
secret JWT à gérer, car tout l'état d'identité réside dans la base SQLite. Secret
Manager reste utilisé par le socle pour les secrets gérés par la plateforme (par
exemple les jetons CI/CD s'ils sont configurés).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~wallos"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, le Service est de type `LoadBalancer`, avec `enable_custom_domain = true`
et `reserve_static_ip = true`, de sorte qu'un Ingress doté d'un certificat géré par
Google puisse servir un nom d'hôte fourni sur une IP stable.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques
GKE à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles. Le démon cron de Wallos s'exécute dans le processus ;
l'activité (ou les échecs) de ses tâches planifiées n'est donc visible que dans les
journaux propres au pod — il n'existe pas de CronJob distinct à inspecter.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Wallos {#3-wallos-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni
  job `db-init` ni instance Cloud SQL. Au premier démarrage, Wallos crée sa base
  SQLite dans `/var/www/html/db/wallos.db` si elle n'existe pas déjà et crée
  l'utilisateur par défaut `admin`/`admin`.
- **Persistance de l'état.** Les abonnements, catégories, paramètres et
  utilisateurs résident entièrement dans `/var/www/html/db/wallos.db` sur le
  montage de la base de données (PVC par défaut, ou bucket GCS FUSE), et survivent
  aux redémarrages et aux redéploiements. Les logos de fournisseurs personnalisés
  sont conservés séparément sur le montage des téléversements, toujours en GCS FUSE.
- **Les identifiants par défaut doivent être modifiés.** L'identifiant initial
  `admin`/`admin` est bien connu. Connectez-vous et modifiez le mot de passe (et
  idéalement le nom d'utilisateur) dans l'interface web immédiatement après le
  premier déploiement.
- **Contrainte d'écrivain unique.** La base SQLite embarquée ne prend pas en charge
  les écrivains concurrents. Conservez `min_instance_count = max_instance_count = 1` ;
  le PVC bloc du StatefulSet assure un verrouillage de fichiers correct mais reste
  à réplica unique.
- **Démon cron toujours actif — non déclenché par les requêtes.** Les 8 tâches
  planifiées intégrées de Wallos (actualisation des taux de change, notifications
  de renouvellement, une interrogation de vérification d'e-mail toutes les
  2 minutes, etc.) s'exécutent en continu dans le même pod. C'est pourquoi
  `min_instance_count = 1` est obligatoire — la mise à zéro arrêterait entièrement
  ces tâches.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent **`/`** — la
  page de connexion non authentifiée de Wallos. `bellamy/wallos` ne documente aucun
  point de terminaison `/health` dédié ; il s'agit donc d'un signal de disponibilité
  grossier (à vérifier au premier déploiement) :
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- wget -qO- -S http://localhost:80/ 2>&1 | head -1
  ```
- **Pas de Redis.** `enable_redis = false` ; Wallos est une application autonome
  sans file d'attente ni cache en dehors de son propre démon cron. La valeur par
  défaut d'App_GKE, `enable_redis = true`, est explicitement remplacée.
- **`stateful_fs_group` peut nécessiter un ajustement.** L'UID/GID exact
  d'exécution de bellamy/wallos n'a pas été confirmé lors des recherches ; la valeur
  par défaut laisse `fsGroup` non défini (`0`). Si le pod rencontre une erreur de
  permission en écrivant sur le PVC de la base de données, inspectez le conteneur en
  cours d'exécution pour trouver l'UID/GID réel.
- **L'image précompilée n'a besoin de `imagePullPolicy = Always` que si elle est
  dupliquée.** Comme `enable_image_mirroring = true` rehéberge le même digest amont
  dans Artifact Registry, App_GKE définit tout de même `imagePullPolicy = Always`
  pour les images mises en miroir, afin qu'un changement de version ne soit jamais servi
  périmé depuis le cache du nœud.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Wallos ou notables pour
lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md)
avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wallos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Étiquette de l'image Wallos — `bellamy/wallos:latest` est une véritable version « latest ». |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; couvre les workers php-fpm ainsi que le démon cron toujours actif. |
| `min_instance_count` | `1` | **CRITIQUE — doit rester à `1`.** Le démon cron ne se déclenche que lorsqu'un pod s'exécute. |
| `max_instance_count` | `1` | **CRITIQUE — doit rester à `1`.** SQLite ne prend pas en charge plusieurs écrivains. |
| `container_port` | `80` | Écouteur HTTP/1.1 de Wallos. |
| `enable_cloudsql_volume` | `false` | Wallos n'a pas de Cloud SQL ; laissez `false`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Wallos dans Artifact Registry. |
| `container_image_source` | `prebuilt` | **Transmis au socle** — sinon, la valeur par défaut propre à App_GKE (`custom`) l'emporterait silencieusement et déclencherait un build depuis les sources sans Dockerfile. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Wallos est une interface web utilisée depuis le navigateur ; la valeur par défaut est donc un accès externe. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (par défaut), sinon en `Deployment`. |
| `session_affinity` | `None` | Réplica unique, le routage persistant est donc inutile. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Valeur par défaut recommandée — stocke la base de données sur un PVC bloc plutôt que sur GCS FUSE (verrouillage de fichiers SQLite correct). |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod — la base SQLite de Wallos est petite. |
| `stateful_pvc_mount_path` | `/var/www/html/db` | Fixe — le répertoire contenant le fichier de la base SQLite de Wallos. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` — SQLite a besoin d'un verrouillage en écriture correct, pas d'IOPS SSD ; évite le quota restreint `SSD_TOTAL_GB`. |
| `stateful_fs_group` | `0` (unset) | L'UID/GID d'exécution de bellamy/wallos n'a pas été confirmé lors des recherches ; ajustez-le si le pod rencontre une erreur de permission sur le PVC. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay | Sonde de démarrage ; aucun point de terminaison `/health` dédié n'est documenté pour cette image. |
| `liveness_probe` | HTTP `/` 30s delay | Sonde de vivacité sur la page de connexion non authentifiée. |
| `uptime_check_config` | `{enabled=false, path="/health"}` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; inutile pour Wallos. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets Wallos `db` et `uploads` (ainsi que tout `storage_buckets` supplémentaire). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Les volumes `db` (uniquement lorsque le PVC est désactivé) et `uploads` (toujours) sont ajoutés automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Hérité d'App_GKE et **non** remplacé par ce module. Wallos n'utilise pas Redis ; définissez-le donc à `false` lors du déploiement — le laisser activé branche une dépendance inutilisée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Non applicable — Wallos n'a pas de base de données SQL. `database_password_length`
et `db_name` / `db_user` ne sont transmis au socle que pour la compatibilité ;
`database_type` est fixé à `NONE` par `Wallos_Common`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Wallos. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Wallos. |
| `storage_buckets` | Buckets Cloud Storage créés (`db` et `uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuelles jobs d'initialisation (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet (disposition par défaut). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identifiants OAuth, `min_instance_count > max_instance_count`, `workload_type = Deployment` associé à `stateful_pvc_enabled = true`, des valeurs de mémoire de ResourceQuota sans suffixe d'unité binaire. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `min_instance_count` | `1` | Critique | La mise à zéro arrête silencieusement le démon cron de Wallos — les notifications de renouvellement et toutes les autres tâches planifiées cessent de se déclencher, sans aucune erreur nulle part. |
| `max_instance_count` | `1` | Critique | Une valeur >1 place des écrivains concurrents sur l'unique base SQLite, ce qui la corrompt. |
| Volumes `db` / `uploads` (PVC/bucket) | Ne jamais supprimer | Critique | La base SQLite embarquée et les logos personnalisés résident ici ; supprimer l'un ou l'autre détruit définitivement cet état. |
| `admin` / `admin` (identifiant initial) | À modifier à la première connexion | Critique | Conserver l'identifiant par défaut permet à quiconque peut joindre le service d'en prendre le contrôle total. |
| `stateful_pvc_mount_path` | `/var/www/html/db` | Élevé | Doit correspondre au répertoire fixe du fichier SQLite ; une non-concordance stocke la base sur un disque éphémère et perd l'état au redémarrage. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Moyen | `standard-rwo` (SSD) puise dans le pool restreint et contraint par quota `SSD_TOTAL_GB` sans aucun bénéfice d'IOPS dont SQLite aurait réellement besoin. |
| `stateful_pvc_enabled` + GCS FUSE pour la base de données | Laisser Common désactiver GCS FUSE | Élevé | Les deux montés sur le même chemin de base de données provoquent un double montage ; Common définit automatiquement `enable_gcs_db_volume = false` lorsque le PVC est activé — ne forcez pas les deux. |
| `container_port` | `80` | Élevé | Wallos écoute sur le port 80 ; un autre port fait échouer la sonde de démarrage et le pod ne devient jamais Ready. |
| Chemin de `startup_probe` / `liveness_probe` | `/` | Moyen | Aucun point de terminaison `/health` dédié n'est documenté pour `bellamy/wallos` — si l'application venait à protéger son chemin racine par une authentification, le chemin de la sonde devrait être ajusté. |
| `container_image_source` | `prebuilt` (transmis) | Élevé | S'il n'est pas transmis, la valeur par défaut propre à App_GKE (`custom`) l'emporte silencieusement et déclenche un build Kaniko depuis les sources pour une image sans Dockerfile — le build échoue. |
| `enable_cloudsql_volume` | `false` | Moyen | Wallos n'a pas de Cloud SQL ; l'activer ajoute un sidecar Auth Proxy inutile. |
| `enable_redis` | `true` | Moyen | Wallos n'utilise pas Redis, mais la valeur par défaut `true` d'App_GKE est héritée telle quelle — définissez-la explicitement à `false`, sinon une dépendance inutilisée est branchée. |
| `enable_iap` | identifiants requis | Élevé | Activer IAP sans `iap_oauth_client_id`/`secret` expose silencieusement le service sans authentification (bloqué par une garde au moment du plan). |
| `stateful_fs_group` | À vérifier au premier déploiement | Moyen | L'UID/GID d'exécution de `bellamy/wallos` n'a pas été confirmé lors des recherches ; une erreur de permission refusée lors de l'écriture sur le PVC de la base de données signifie qu'il faut le définir explicitement. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Wallos, partagée
avec la variante Cloud Run, est décrite dans
**[Wallos_Common](Wallos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wallos sur GKE Autopilot](../labs/Wallos_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Wallos sur Google Cloud Run](Wallos_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wallos Common — Configuration applicative partagée](Wallos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Home & Life Management**.
