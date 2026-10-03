---
title: "Wallos sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Wallos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wallos_GKE.md @ 15fd4c7 sha256:172e7de3c3a0 -->

# Wallos sur GKE Autopilot {#wallos-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallos_GKE.png" alt="Wallos sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallos est un traqueur open-source auto-hébergé d'abonnements et de dépenses
récurrentes, basé sur PHP 8.3 + php-fpm (sans framework MVC). Il suit les
abonnements récurrents, convertit les prix entre devises, envoie des
notifications de renouvellement et prend en charge un mode multi-utilisateur
pour le foyer. Ce module déploie Wallos sur **GKE Autopilot** sur la base de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Wallos et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Wallos fonctionne comme une seule charge de travail web PHP/php-fpm. Il est
délibérément minimal — pas de base de données SQL, pas de cache, pas de file
d'attente — mais il exécute un véritable démon cron, toujours actif, qui
détermine plusieurs des valeurs par défaut ci-dessous :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod PHP, 1 vCPU / 1 GiB par défaut ; `min = max = 1` (toujours actif, ne se met jamais à l'échelle à zéro) |
| État persistant (base de données) | PVC de bloc HDD (par défaut) ou Cloud Storage (GCS FUSE) | Monté sur `/var/www/html/db` ; contient le fichier de base de données SQLite |
| État persistant (téléchargements) | Cloud Storage (GCS FUSE), toujours | Monté sur `/var/www/html/images/uploads/logos` ; un PVC StatefulSet ne prend en charge qu'un seul mount_path, utilisé pour la base de données |
| Base de données | Aucune (SQLite embarquée) | `database_type = NONE` ; aucune instance Cloud SQL n'est provisionnée ; aucune prise en charge MySQL/Postgres n'existe dans l'application |
| Cache et file d'attente | Aucun | Wallos n'utilise pas Redis |
| Secrets | Secret Manager | Aucun secret d'application généré ; les utilisateurs vivent dans la base de données SQLite |
| Ingress | Cloud Load Balancing | `LoadBalancer` Service par défaut (Wallos est une interface utilisateur web pilotée par navigateur) ; domaine personnalisé + certificat géré disponible |
| Tâches de fond | Démon cron intégré au conteneur | 8 tâches planifiées intégrées (actualisation du taux de change, notifications de renouvellement, un sondage de vérification d'e-mail toutes les 2 minutes, etc.) — s'exécute en continu à l'intérieur du pod principal, pas comme un CronJob séparé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Deux chemins persistants indépendants, pas de variable d'environnement de
  relocalisation pour l'un ou l'autre.** Wallos n'a pas de base de données
  Cloud SQL. Sa base de données SQLite se trouve à `/var/www/html/db/wallos.db` ;
  les logos de fournisseurs personnalisés téléchargés par l'utilisateur se
  trouvent séparément à `/var/www/html/images/uploads/logos`. Aucun de ces chemins ne peut être
  relocalisé via une variable d'environnement.
- **PVC de bloc HDD par défaut pour la base de données.** `stateful_pvc_enabled = true`
  (par défaut) exécute la charge de travail en tant que **StatefulSet** avec un
  PVC par pod (par défaut `10Gi`, StorageClass **`standard`** — HDD
  `pd-standard`, pas SSD) monté sur `/var/www/html/db` ; le volume GCS FUSE
  pour ce même chemin est automatiquement désactivé pour éviter un double
  montage. Le HDD est délibéré : SQLite a besoin de la correction du
  verrouillage en écriture, pas d'IOPS, et le HDD utilise le quota beaucoup plus
  important de `DISKS_TOTAL_GB` au lieu du quota restreint de `SSD_TOTAL_GB`. Le
  chemin des téléchargements utilise toujours GCS FUSE, car un seul mount_path
  de PVC est disponible.
- **CRITIQUE — réplica unique toujours actif, pas seulement un réglage de
  démarrage à froid.** `min_instance_count = max_instance_count = 1`. La base de données SQLite de Wallos
  ne prend pas en charge l'écriture multiple (donc `max = 1` est requis), et
  son démon cron intégré ne déclenche les tâches planifiées que lorsqu'un pod
  est réellement en cours d'exécution (donc `min = 1` est requis). La mise à
  l'échelle à zéro arrête silencieusement toutes les tâches planifiées sans
  erreur.
- **La connexion par défaut est `admin` / `admin`.** Wallos
  initialise cela au premier démarrage ; changez-le dans l'interface utilisateur
  web immédiatement après le déploiement.
- **Pas de Redis, pas de job d'initialisation.** `enable_redis = false` et aucun
  job `db-init` ne s'exécute ; le pod est prêt dès que le conteneur démarre.
- **Port de conteneur 80.** Wallos sert du HTTP/1.1 simple sur le port 80.
- **Accessible au public par défaut.** `service_type = "LoadBalancer"` — Wallos est une
  interface utilisateur web pilotée par navigateur, pas un service interne.
  `enable_custom_domain = true` et `reserve_static_ip = true` vous permettent de servir un nom d'hôte
  personnalisé avec un certificat géré par Google.
- **Image pré-construite.** `bellamy/wallos` est une image authentique,
  maintenue par un tiers, avec le tag "latest" (il n'y a pas d'image officielle
  du projet Wallos) ; aucun Dockerfile ou étape Cloud Build n'est utilisé.
  `container_image_source = "prebuilt"` est explicitement transmis à la fondation.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Wallos {#a-gke-autopilot--the-wallos-workload}

Wallos s'exécute en tant que StatefulSet à réplica unique (par défaut, puisque
`stateful_pvc_enabled = true`) ou un déploiement (si le PVC est désactivé) planifié
sur Autopilot, qui facture le CPU/la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Wallos pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche le service et toute adresse
  IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud Storage et PVC de bloc — état persistant {#b-cloud-storage--block-pvc--persistent-state}

Wallos n'a pas de base de données Cloud SQL. Ses deux chemins persistants sont
sauvegardés différemment :

- **Base de données (`/var/www/html/db/wallos.db`) :** par défaut un **PersistentVolumeClaim**
  de bloc (`stateful_pvc_enabled = true`, `10Gi`, StorageClass `standard` / HDD) ; si le
  PVC est désactivé, un bucket **Cloud Storage** dédié monté via GCS FUSE
  par l'intermédiaire du pilote CSI à la place.
- **Téléchargements (`/var/www/html/images/uploads/logos`) :** toujours un bucket **Cloud Storage**
  dédié monté via GCS FUSE, quelle que soit la configuration du PVC.

- **Console :** Cloud Storage → Buckets ; ou Kubernetes Engine → Stockage → PVCs.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~wallos"
  kubectl get pvc -n "$NAMESPACE"                              # database PVC (default layout)
  gcloud storage ls gs://<uploads-bucket>/                      # uploaded logo files
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK, GCS FUSE et les PVC
StatefulSet.

### C. Secret Manager {#c-secret-manager}

Wallos ne génère **aucun secret d'application** — il n'y a pas de clé de
chiffrement ou de secret JWT à gérer, car tout l'état d'identité réside dans
la base de données SQLite. Secret Manager est toujours utilisé par la
fondation pour les secrets gérés par la plateforme (par exemple, les jetons
CI/CD si configurés).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~wallos"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le service est `LoadBalancer`, avec `enable_custom_domain = true` et
`reserve_static_ip = true` afin qu'un Ingress avec un certificat géré par Google puisse
servir un nom d'hôte fourni sur une IP stable.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte optionnelles sont disponibles. Le
démon cron de Wallos s'exécute en interne, de sorte que son activité (ou ses
échecs) de tâches planifiées n'est visible que dans les journaux du pod
lui-même — il n'y a pas de CronJob séparé à inspecter.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Wallos {#3-wallos-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` et pas d'instance Cloud SQL. Au premier démarrage,
  Wallos crée sa base de données SQLite à `/var/www/html/db/wallos.db` si elle n'existe
  pas déjà et initialise l'utilisateur par défaut `admin`/`admin`.
- **Persistance de l'état.** Les abonnements, catégories, paramètres et
  utilisateurs résident entièrement dans `/var/www/html/db/wallos.db` sur le montage de la
  base de données (PVC par défaut, ou bucket GCS FUSE), survivant aux
  redémarrages et redéploiements. Les logos de fournisseurs personnalisés
  persistent séparément sur le montage des téléchargements toujours en GCS FUSE.
- **Les identifiants par défaut doivent être modifiés.** La connexion
  initialisée `admin`/`admin` est bien connue. Connectez-vous et
  modifiez le mot de passe (et idéalement le nom d'utilisateur) dans l'interface
  utilisateur web immédiatement après le premier déploiement.
- **Contrainte d'écriture unique.** La base de données SQLite embarquée ne
  prend pas en charge les écritures concurrentes. Gardez `min_instance_count = max_instance_count = 1` ; le
  PVC de bloc StatefulSet offre un verrouillage de fichier approprié mais reste
  à réplica unique.
- **Démon cron toujours actif — non déclenché par une requête.** Les 8 tâches
  planifiées intégrées de Wallos (actualisation du taux de change,
  notifications de renouvellement, un sondage de vérification d'e-mail toutes
  les 2 minutes, etc.) s'exécutent en continu dans le même pod. C'est pourquoi
  `min_instance_count = 1` est requis — la mise à l'échelle à zéro arrêterait
  complètement ces tâches.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  **`/`** — la page de connexion non authentifiée de Wallos.
  `bellamy/wallos` ne documente aucun point de terminaison `/health` dédié,
  il s'agit donc d'un signal de disponibilité grossier (à vérifier au premier
  déploiement) :
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- wget -qO- -S http://localhost:80/ 2>&1 | head -1
  ```
- **Pas de Redis.** `enable_redis = false` ; Wallos est une application
  autonome sans file d'attente ni cache au-delà de son propre démon cron. La
  valeur par défaut d'App_GKE de `enable_redis = true` est explicitement
  outrepassée.
- **`stateful_fs_group` peut nécessiter un ajustement.** L'UID/GID d'exécution
  exact de bellamy/wallos n'a pas été confirmé lors de la recherche ; la valeur
  par défaut laisse `fsGroup` non défini (`0`). Si le pod
  rencontre une erreur de permission lors de l'écriture sur le PVC de la base
  de données, inspectez le conteneur en cours d'exécution pour trouver l'UID/GID
  réel.
- **L'image pré-construite n'a besoin de `imagePullPolicy = Always` que si elle est
  mise en miroir.** Puisque `enable_image_mirroring = true` réhéberge le même digest en
  amont dans Artifact Registry, App_GKE définit toujours `imagePullPolicy = Always` pour
  les images mises en miroir afin qu'une mise à jour de version ne soit jamais
  servie périmée depuis le cache du nœud.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Wallos sont listés ; toute autre entrée est héritée de [App_GKE](App_GKE.md)
avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wallos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Wallos — `bellamy/wallos:latest` est une véritable version "latest". |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; couvre les workers php-fpm plus le démon cron toujours en cours d'exécution. |
| `min_instance_count` | `1` | **CRITIQUE — doit rester `1`.** Le démon cron ne se déclenche que lorsqu'un pod est en cours d'exécution. |
| `max_instance_count` | `1` | **CRITIQUE — doit rester `1`.** SQLite ne prend pas en charge l'écriture multiple. |
| `container_port` | `80` | Écouteur HTTP/1.1 de Wallos. |
| `enable_cloudsql_volume` | `false` | Wallos n'a pas de Cloud SQL ; laisser `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Wallos dans Artifact Registry. |
| `container_image_source` | `prebuilt` | **Transmis à la fondation** — la propre valeur par défaut d'App_GKE (`custom`) l'emporterait sinon silencieusement et déclencherait une build à partir de la source sans Dockerfile. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Wallos est une interface utilisateur web pilotée par navigateur, donc cela par défaut est un accès externe. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (par défaut), sinon `Deployment`. |
| `session_affinity` | `None` | Réplica unique, donc le routage persistant est inutile. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Valeur par défaut recommandée — stocke la base de données sur un PVC de bloc au lieu de GCS FUSE (correction du verrouillage de fichier SQLite). |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod — la base de données SQLite de Wallos est petite. |
| `stateful_pvc_mount_path` | `/var/www/html/db` | Fixe — le répertoire contenant le fichier de base de données SQLite de Wallos. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` — SQLite a besoin de la correction du verrouillage en écriture, pas des IOPS SSD ; évite le quota restreint de `SSD_TOTAL_GB`. |
| `stateful_fs_group` | `0` (non défini) | L'UID/GID d'exécution de bellamy/wallos n'a pas été confirmé lors de la recherche ; ajuster si le pod rencontre une erreur de permission sur le PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s de délai | Sonde de démarrage ; aucun point de terminaison `/health` dédié n'est documenté pour cette image. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité sur la page de connexion non authentifiée. |
| `uptime_check_config` | `{enabled=false, path="/health"}` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; non nécessaire pour Wallos. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets Wallos `db` et `uploads` (et tout `storage_buckets` supplémentaire). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Les volumes `db` (uniquement lorsque le PVC est désactivé) et `uploads` (toujours) sont ajoutés automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Hérité d'App_GKE et **non** outrepassé par ce module. Wallos n'utilise pas Redis, donc définissez-le sur `false` lors du déploiement — le laisser activé crée une dépendance inutilisée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Non applicable — Wallos n'a pas de base de données SQL. `database_password_length` et
`db_name` / `db_user` sont transmis à la fondation uniquement pour la
compatibilité ; `database_type` est fixé à `NONE` par `Wallos_Common`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Wallos. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Wallos. |
| `storage_buckets` | Buckets Cloud Storage créés (`db` et `uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet (mise en page par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — IAP sans
> identifiants OAuth, `min_instance_count > max_instance_count`, `workload_type = Deployment` avec `stateful_pvc_enabled = true`,
> valeurs de mémoire ResourceQuota sans suffixes d'unité binaire. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou
> de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `min_instance_count` | `1` | Critique | La mise à l'échelle à zéro arrête silencieusement le démon cron de Wallos — les notifications de renouvellement et toutes les autres tâches planifiées cessent de se déclencher, sans aucune erreur. |
| `max_instance_count` | `1` | Critique | >1 place des écrivains concurrents sur la base de données SQLite unique, la corrompant. |
| Volumes `db` / `uploads` (PVC/bucket) | Ne jamais supprimer | Critique | La base de données SQLite embarquée et les logos personnalisés y résident ; la suppression de l'un ou l'autre détruit cet état de manière permanente. |
| `admin` / `admin` (connexion initiale) | Changer à la première connexion | Critique | Laisser l'identifiant par défaut permet à quiconque pouvant atteindre le service de prendre le contrôle total. |
| `stateful_pvc_mount_path` | `/var/www/html/db` | Élevé | Doit correspondre au répertoire fixe du fichier SQLite ; une non-concordance stocke la base de données sur un disque éphémère et perd l'état au redémarrage. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Moyen | `standard-rwo` (SSD) utilise le pool restreint et soumis à quota de `SSD_TOTAL_GB` sans aucun avantage en termes d'IOPS dont SQLite a réellement besoin. |
| `stateful_pvc_enabled` + GCS FUSE pour la base de données | Laisser Common désactiver GCS FUSE | Élevé | Les deux montés sur le même chemin de base de données créent un double montage ; Common définit automatiquement `enable_gcs_db_volume = false` lorsque le PVC est activé — ne forcez pas les deux. |
| `container_port` | `80` | Élevé | Wallos écoute sur le port 80 ; un port différent fait échouer la sonde de démarrage et le pod ne devient jamais prêt. |
| Chemin `startup_probe` / `liveness_probe` | `/` | Moyen | Aucun point de terminaison `/health` dédié n'est documenté pour `bellamy/wallos` — si l'application protège un jour son chemin racine par une authentification, le chemin de la sonde devra être ajusté. |
| `container_image_source` | `prebuilt` (transmis) | Élevé | S'il n'est pas transmis, la propre valeur par défaut d'App_GKE (`custom`) l'emporte silencieusement et déclenche une build Kaniko à partir de la source contre une image sans Dockerfile — la build échoue. |
| `enable_cloudsql_volume` | `false` | Moyen | Wallos n'a pas de Cloud SQL ; l'activation ajoute un sidecar Auth Proxy inutile. |
| `enable_redis` | `true` | Moyen | Wallos n'a pas de Redis, mais la valeur par défaut d'App_GKE de `true` est héritée inchangée — définissez-la explicitement sur `false`, sinon une dépendance inutilisée est câblée. |
| `enable_iap` | identifiants requis | Élevé | L'activation de l'IAP sans `iap_oauth_client_id`/`secret` expose silencieusement le service non authentifié (bloqué par une protection au moment de la planification). |
| `stateful_fs_group` | Vérifier au premier déploiement | Moyen | L'UID/GID d'exécution pour `bellamy/wallos` n'a pas été confirmé lors de la recherche ; une erreur de permission lors de l'écriture sur le PVC de la base de données signifie que cela doit être défini explicitement. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Wallos
partagée avec la variante Cloud Run est décrite dans
**[Wallos_Common](Wallos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wallos sur GKE Autopilot](../labs/Wallos_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Wallos sur Google Cloud Run](Wallos_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wallos Common — Configuration d'application partagée](Wallos_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Gestion de la maison et de la vie**.
