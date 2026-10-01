---
title: "Services GCP — module socle de la plateforme"
description: "Référence de configuration du module RAD Services GCP sur Google Cloud — variables, architecture, réseau et opérations courantes (day-2)."
---

<!-- translated-from: docs/modules/Services_GCP.md @ 3055034 sha256:6a8ba9474996 -->

# Services GCP — module socle de la plateforme {#services-gcp--platform-foundation-module}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Services_GCP.png" alt="Services GCP — module socle de la plateforme" style={{maxWidth: "100%", borderRadius: "8px"}} />

`Services GCP` est la couche socle de la plateforme : il provisionne l'infrastructure partagée dont dépend chaque application — le VPC et le réseau, les bases de données Cloud SQL et AlloyDB, Memorystore Redis, Cloud Filestore (ou une VM NFS/Redis autogérée), le cluster GKE Autopilot, le dépôt Artifact Registry partagé, les comptes de service et l'IAM de la plateforme, ainsi que des contrôles de sécurité facultatifs (Binary Authorization, CMEK, VPC Service Controls et Security Command Center).

Comme tout le reste dépend de ses outputs, `Services GCP` doit être provisionné et sain avant le déploiement d'`App CloudRun`, d'`App GKE` ou de tout module applicatif — mais vous n'avez pas à l'organiser vous-même. Lorsque vous déployez un module applicatif dans un projet qui ne dispose pas encore de `Services GCP`, la plateforme le détecte, le provisionne automatiquement en premier (avec les ressources précises que déclare le `requires_services` de l'application — par exemple Postgres ou MySQL, GKE ou non), attend qu'il réussisse, puis déploie votre application par-dessus. Le déploiement direct de `Services GCP`, documenté ci-dessous, reste pris en charge pour le préconfigurer avant qu'une application n'en dépende, ou pour partager délibérément un même déploiement entre plusieurs applications.

**Ordre de déploiement :**

```
Services GCP  →  App CloudRun / App GKE  →  Application Modules
```

---

## Services GCP déployés {#deployed-gcp-services}

Un déploiement `Services GCP` entièrement configuré provisionne et intègre les services GCP suivants :

| Fonctionnalité | Service Google Cloud |
|---|---|
| Réseau privé | Compute Engine VPC, sous-réseaux, Cloud Router, Cloud NAT, Private Service Connect, règles de pare-feu |
| Bases de données relationnelles | Cloud SQL (PostgreSQL / MySQL), AlloyDB for PostgreSQL |
| Base de données orientée documents *(facultatif)* | Firestore (Native, édition Enterprise) |
| Cache géré *(facultatif)* | Memorystore for Redis |
| Stockage de fichiers géré *(facultatif)* | Cloud Filestore (NFS) |
| Fichiers/cache autogérés *(facultatif)* | VM Compute Engine (NFS + Redis) dans un groupe d'instances géré |
| Orchestration de conteneurs *(facultatif)* | Clusters GKE Autopilot / Standard, GKE Fleet, Backup for GKE |
| Registre de conteneurs | Artifact Registry (Docker) |
| Identité et accès | Cloud IAM, comptes de service de la plateforme, Workload Identity Federation *(facultatif)* |
| Secrets | Secret Manager (mot de passe root de la base de données) |
| Sécurité de la chaîne d'approvisionnement *(facultatif)* | Binary Authorization, clé d'attestation Cloud KMS, Container Analysis |
| Chiffrement *(facultatif)* | Cloud KMS (CMEK) |
| Contrôles contre l'exfiltration de données *(facultatif)* | VPC Service Controls, Access Context Manager |
| Posture de sécurité *(facultatif)* | Security Command Center, analyse des vulnérabilités Container Analysis |
| Observabilité | Cloud Monitoring (règles d'alerte, canaux de notification), Cloud Logging |
| Gestion des coûts *(facultatif)* | Cloud Billing Budgets |

---

## Prérequis {#prerequisites}

Avant de déployer `Services GCP` :

1. **Un projet GCP** avec la facturation activée.
2. **Identité de déploiement** : le compte de service utilisé par la plateforme pour appliquer le module doit être autorisé à créer l'infrastructure partagée qu'il gère. Préférez l'ensemble de rôles de moindre privilège que `Project GCP` accorde à son identité de déploiement (voir le guide de ce module) plutôt qu'un rôle primitif étendu ; accordez-le dans le projet cible, idéalement de manière limitée dans le temps et conditionnelle. `roles/owner` fonctionne, mais est bien plus large que nécessaire — si vous l'accordez lors de l'intégration d'un projet externe, limitez-le à la fenêtre d'intégration plutôt que de le laisser en place.
3. **API requises** : le module active automatiquement les API dont son ensemble de fonctionnalités par défaut a besoin, avec un délai de propagation avant le provisionnement des ressources. Deux exceptions délibérées : les API de flotte GKE Enterprise / Anthos (`gkehub`, `gkeconnect`, `anthosconfigmanagement`, `anthospolicycontroller`, `mesh`) sont activées par `Project_GCP` au Tier-0, et non ici — sur un projet non provisionné par `Project_GCP`, `configure_config_management` / `configure_policy_controller` / `configure_cloud_service_mesh` échouent à l'apply avec `Error 403: GKE Hub API has not been used in project ...` et doivent être fournies via `additional_apis` ; quant à `alloydb.googleapis.com`, elle a été purement et simplement retirée, si bien que `enable_alloydb` échoue à l'apply.
4. **Accès au compte de facturation** (uniquement pour le budget de facturation facultatif) : l'identité de déploiement a besoin d'un accès en lecture au compte de facturation.
5. **Rôles au niveau de l'organisation** (uniquement pour VPC Service Controls et les notifications SCC) : la création du périmètre et des notifications est ignorée silencieusement lorsque l'identité appelante ne dispose pas des rôles requis au niveau de l'organisation.

---

## Réseau (VPC) {#networking-vpc}

Provisionne un réseau VPC en mode personnalisé avec un sous-réseau régional par région de disponibilité configurée. Toutes les ressources — Cloud SQL, Redis, Filestore, GKE et la VM NFS autogérée — communiquent exclusivement par IP privée au sein de ce réseau. Un Cloud Router et une passerelle Cloud NAT sont provisionnés par région pour l'accès Internet sortant des instances privées, et une plage est réservée à Private Service Connect afin que les services gérés par Google soient joignables de manière privée. Des règles de pare-feu sont créées pour les vérifications de santé des équilibreurs de charge, le SSH via IAP, le trafic TCP/UDP/ICMP intra-VPC, NFS et le trafic HTTP/HTTPS. Lorsque plusieurs clusters GKE sont provisionnés, des règles de pare-feu Istio est-ouest supplémentaires sont créées pour le trafic de maillage inter-clusters.

**Console :** VPC network → VPC networks → sélectionnez le réseau → onglet Subnets (CIDR par région) ; onglet Firewall (règles et tags cibles). Cloud NAT se trouve sous Network services → Cloud NAT.

```bash
# List all VPC networks in the project
gcloud compute networks list --project=PROJECT_ID

# List subnets — verify CIDR ranges and regions
gcloud compute networks subnets list \
  --project=PROJECT_ID \
  --format="table(name,region,ipCidrRange,network)"

# Confirm Cloud NAT is configured
gcloud compute routers nats list \
  --router=ROUTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

# List firewall rules
gcloud compute firewall-rules list --project=PROJECT_ID \
  --format="table(name,direction,sourceRanges,allowed)"
```

---

## Cloud SQL {#cloud-sql}

Provisionne des instances Cloud SQL PostgreSQL et/ou MySQL dans la région principale, avec une IP privée uniquement (aucun point de terminaison public), des sauvegardes quotidiennes automatiques et un stockage SSD redimensionné automatiquement. Les deux moteurs prennent en charge une disponibilité `ZONAL` (zone unique) ou `REGIONAL` (haute disponibilité avec instance de secours active automatique), des réplicas en lecture facultatifs (inter-régions lorsqu'une seconde région est configurée), une fenêtre de maintenance et un canal de mise à jour configurables, Query Insights en option et l'authentification IAM aux bases de données Cloud SQL en option. Le mot de passe root de la base de données est généré et stocké dans Secret Manager.

**Dans un projet géré par RAD, l'instance est bornée de trois manières :** taille (2 vCPU au maximum), réplicas en lecture (1 au maximum dans un projet sandbox ou lab, 2 en développement ou en production) et croissance automatique du disque (100 GB en sandbox et lab, 500 GB en développement, 1 TB en production — sinon Cloud SQL agrandit un disque sans limite). Le plafond du disque est fixé à la création d'une instance ; une instance existante conserve la limite qu'elle a déjà. Un projet apporté par l'utilisateur (votre propre projet) n'est soumis à aucune de ces bornes.

**Console :** SQL → sélectionnez l'instance. L'onglet Connections confirme Private IP enabled / Public IP disabled ; les onglets Backups, Flags et Maintenance affichent les paramètres correspondants ; les réplicas en lecture apparaissent sous l'instance principale dans la vue d'ensemble SQL.

```bash
# List all Cloud SQL instances
gcloud sql instances list --project=PROJECT_ID \
  --format="table(name,databaseVersion,settings.tier,region,state)"

# Describe a specific instance — availability type, flags, maintenance window
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(settings.availabilityType,ipAddresses,settings.databaseFlags,settings.maintenanceWindow)"

# List read replicas for a primary instance
gcloud sql instances list --project=PROJECT_ID \
  --filter="masterInstanceName=INSTANCE_NAME" \
  --format="table(name,databaseVersion,region,state)"
```

---

## AlloyDB for PostgreSQL {#alloydb-for-postgresql}

> **AlloyDB n'est plus utilisable dans ce module.** `alloydb.googleapis.com` a été retirée de l'ensemble des API activées à la suite d'une décision explicite liée aux coûts (PR #2673), si bien que `enable_alloydb = true` échoue à l'apply au lieu de créer un cluster. Les ressources de `alloydb.tf`, les variables `enable_alloydb` / `alloydb_cpu_count` / `alloydb_database_flags` / `enable_alloydb_read_pool` / `alloydb_read_pool_node_count` et les outputs `alloydb_*` restent déclarés, mais sont inaccessibles à moins que l'API ne soit fournie via `additional_apis` (refusé dans les dossiers gérés par RAD). Utilisez plutôt Cloud SQL PostgreSQL (`create_postgres`).

**Console :** AlloyDB for PostgreSQL → Clusters pour afficher les détails du cluster et des instances, y compris l'état du moteur en colonnes.

```bash
# List AlloyDB clusters
gcloud alloydb clusters list \
  --region=REGION \
  --project=PROJECT_ID

# List AlloyDB instances in a cluster (primary and read pool)
gcloud alloydb instances list \
  --cluster=CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID
```

---

## Firestore {#firestore}

Crée en option une base de données Firestore Native en édition Enterprise — une base de données orientée documents serverless adaptée aux schémas flexibles, à la synchronisation en temps réel et à la prise en charge des clients hors ligne. L'ID et l'emplacement de la base de données sont configurables ; l'ID vaut par défaut `firestore-db-<random_id>` et l'emplacement correspond par défaut à la région principale lorsqu'il est laissé vide.

**Console :** Firestore pour parcourir la base de données, les collections et les documents.

```bash
# List Firestore databases
gcloud firestore databases list --project=PROJECT_ID
```

---

## Memorystore (Redis) {#memorystore-redis}

Provisionne en option une instance Cloud Memorystore for Redis dans la région principale, en tant qu'alternative gérée à la VM NFS/Redis autogérée. Prend en charge le niveau `BASIC` (nœud unique) ou `STANDARD_HA` (basculement inter-zones), une taille de mémoire et une version de moteur configurables, la connectivité `DIRECT_PEERING` ou `PRIVATE_SERVICE_ACCESS`, et une persistance facultative (instantanés RDB ou AOF, uniquement en `STANDARD_HA`). La chaîne AUTH est stockée dans Secret Manager.

**Console :** Memorystore → Redis → sélectionnez l'instance pour afficher le niveau, la taille de mémoire, la version, le mode de connectivité, l'IP privée et la fenêtre de maintenance.

```bash
# List all Memorystore Redis instances
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,tier,memorySizeGb,redisVersion,state)"

# Describe a specific instance — IP, connect mode, persistence config
gcloud redis instances describe INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(host,port,tier,connectMode,redisVersion,memorySizeGb,persistenceConfig)"
```

---

## Filestore {#filestore}

Provisionne en option une instance Cloud Filestore dans la région principale, en tant que stockage NFS partagé, géré et couvert par un SLA — l'alternative à la VM NFS autogérée. Prend en charge les niveaux `BASIC_HDD`, `BASIC_SSD` et `ENTERPRISE` (régional, multizone), chacun avec des capacités minimales imposées. L'instance exporte un unique partage NFS pouvant être monté simultanément par plusieurs clients.

**Console :** Filestore → Instances → sélectionnez l'instance pour afficher le niveau, la capacité, l'IP privée, ainsi que le nom du partage de fichiers exporté et son chemin de montage.

```bash
# List all Filestore instances — tier, capacity, IP, state
gcloud filestore instances list \
  --project=PROJECT_ID \
  --format="table(name,tier,fileShares[0].capacityGb,networks[0].ipAddresses[0],state)"

# Describe a specific instance — NFS mount point and share name
gcloud filestore instances describe INSTANCE_NAME \
  --zone=ZONE \
  --project=PROJECT_ID \
  --format="yaml(fileShares,networks,tier,state)"
```

---

## VM NFS et Redis autogérée {#self-managed-nfs--redis-vm}

L'alternative moins coûteuse à Filestore et Memorystore gérés. Provisionne une unique VM Compute Engine exécutant à la fois un serveur NFS (port 2049) et Redis (port 6379), déployée sous forme de groupe d'instances géré **régional** de taille 1, avec réparation automatique en cas d'échec de la vérification de santé TCP, un disque de données persistant SSD (un disque avec état propre à l'instance, conservé lors d'une recréation) et des instantanés quotidiens du disque avec une conservation de 7 jours. Recommandé pour le développement et les déploiements sensibles aux coûts.

Le MIG est réparti sur **toutes les zones de la région** avec `distribution_policy_target_shape = "ANY"`, de sorte que GCE place l'instance unique là où de la capacité est disponible. Cela remplace un ancien épinglage sur une seule zone, qui restait bloqué indéfiniment sur `ZONE_RESOURCE_POOL_EXHAUSTED` — une défaillance de **capacité**, et non de quota, ce qui explique pourquoi les quotas de CPU/d'instances peuvent sembler entièrement disponibles alors que la VM ne démarre jamais.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_excluded_zones` | `[]` | Zones à exclure de la règle de distribution du MIG. Nécessaire pour le mode de défaillance résiduel dans lequel même `target_shape = "ANY"` engage l'instance dans une zone en rupture de capacité et y réessaie indéfiniment ; exclure cette zone reconstruit le MIG avec une règle qui ne peut pas la choisir. **Modifier cette liste force le remplacement du MIG** (`distribution_policy_zones` est immuable) — le disque de données survit grâce à l'instantané quotidien, et un déploiement neuf n'a rien à perdre. Ne vaut la peine d'être défini que lorsqu'un *sous-ensemble* de zones est en rupture ; si toutes les zones sont épuisées, les exclusions ne peuvent rien y faire et le MIG se réparera de lui-même dès le retour de la capacité. |

> La VM autogérée et les services gérés Filestore/Memorystore sont indépendants. Exécuter les deux crée une infrastructure redondante et expose à un risque de split-brain du stockage de fichiers — utilisez l'un ou l'autre.

**Console :** Compute Engine → VM instances (VM `Running`) ; Instance groups (MIG `1/1` sain) ; Disks (capacité du disque de données) ; Snapshots (instantanés quotidiens).

```bash
# List Compute Engine instances — confirm the NFS/Redis VM is running
gcloud compute instances list --project=PROJECT_ID \
  --format="table(name,zone,machineType,status)"

# List Managed Instance Groups — confirm health
gcloud compute instance-groups managed list --project=PROJECT_ID \
  --format="table(name,zone,targetSize,status.isStable)"

# List recent disk snapshots
gcloud compute snapshots list --project=PROJECT_ID \
  --format="table(name,sourceDisk,status,creationTimestamp)"
```

---

## Cluster GKE Autopilot {#gke-autopilot-cluster}

Provisionne en option un ou plusieurs clusters GKE dans la région principale, enregistrés dans une GKE Fleet. Le mode **Autopilot** (par défaut) est entièrement géré par Google — le provisionnement des nœuds, la mise à l'échelle et le durcissement de la sécurité sont automatiques, et la facturation se fait par pod. Le mode **Standard** offre un contrôle complet sur le type de machine, le disque et le nombre de nœuds du pool via les variables de pool de nœuds, pour les charges de travail ayant des exigences strictes de planification ou de matériel. Les CIDR des nœuds, des pods et des services sont configurables et ne doivent pas se chevaucher. Trois modules complémentaires Fleet indépendants sont disponibles : Cloud Service Mesh (Istio géré, mTLS), Config Sync (réconciliation GitOps) et Policy Controller (OPA Gatekeeper). Lorsque plusieurs clusters sont provisionnés, Multi-Cluster Ingress est disponible via le cluster de configuration.

**Les nœuds sont toujours privés, et ce n'est pas configurable.** Chaque cluster est créé avec `private_cluster_config { enable_private_nodes = true }`. Les projets gérés par RAD appliquent une règle d'administration DENY `constraints/compute.vmExternalIpAccess` ; sans nœuds privés, GKE tente d'attribuer des IP externes à ses nœuds, la création des nœuds échoue avec `Constraint constraints/compute.vmExternalIpAccess violated`, et le cluster reste bloqué à l'état `ERROR`. Seuls les nœuds sont concernés — `enable_private_endpoint` conserve sa valeur par défaut (`false`), si bien que le plan de contrôle garde son point de terminaison public et que les outils CI/CD extérieurs au VPC peuvent toujours l'atteindre.

Le plan de contrôle de chaque cluster a également besoin de son propre `/28` privé, découpé par cluster dans un CIDR de base dédié appartenant à un bloc RFC1918 différent de ceux des plages de sous-réseau, de pods et de services, afin de ne pas pouvoir entrer en collision avec elles. Comme les trois autres plages, il est fixé à la création du cluster — le modifier force le remplacement du cluster.

**Console :** Kubernetes Engine → Clusters (état, mode, version, CIDR) ; Fleets (enregistrement) ; Features → Service Mesh / Config Management / Policy Controller (état des modules complémentaires).

```bash
# List all GKE clusters
gcloud container clusters list --project=PROJECT_ID \
  --format="table(name,location,status,autopilot.enabled,currentMasterVersion)"

# Describe a cluster — view CIDRs and configuration
gcloud container clusters describe CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(clusterIpv4Cidr,servicesIpv4Cidr,network,subnetwork,autopilot)"

# List fleet memberships — confirm cluster registration
gcloud container fleet memberships list --project=PROJECT_ID \
  --format="table(name,state.code,endpoint.gkeCluster.resourceLink)"

# Get credentials and inspect the cluster
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION --project=PROJECT_ID
kubectl get nodes -o wide
kubectl get pods --all-namespaces
```

### Backup for GKE {#backup-for-gke}

Active en option Backup for GKE sur le ou les clusters provisionnés, en créant des sauvegardes planifiées à la fois de l'état des ressources Kubernetes (Deployments, ConfigMaps, Secrets, Services) et des données des PersistentVolumeClaim vers Cloud Storage, avec une planification et une durée de conservation configurables. Les sauvegardes peuvent être restaurées sur le même cluster ou sur un autre.

**Console :** Kubernetes Engine → Backup for GKE → Backup plans (planification, conservation) ; sélectionnez un plan → Backups (sauvegardes terminées, taille, expiration) ; utilisez Restore à partir d'une sauvegarde terminée.

```bash
# List all GKE backup plans in the region
gcloud beta container backup-restore backup-plans list \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,cluster,retentionPolicy.backupDeleteLockDays,state)"

# List completed backups for a backup plan
gcloud beta container backup-restore backups list \
  --backup-plan=BACKUP_PLAN_NAME \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,state,createTime,deleteLockExpireTime)"
```

---

## Artifact Registry {#artifact-registry}

Provisionne un dépôt Docker partagé dans la région principale pour stocker et distribuer les images de conteneurs. Tous les modules applicatifs envoient leurs images vers ce dépôt et les en récupèrent. L'analyse des vulnérabilités à l'envoi et le chiffrement CMEK peuvent être appliqués en option.

**Console :** Artifact Registry → Repositories → sélectionnez le dépôt pour parcourir les images et les tags.

```bash
# List Artifact Registry repositories
gcloud artifacts repositories list --project=PROJECT_ID

# List images in the shared repository
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --include-tags
```

---

## IAM et comptes de service {#iam--service-accounts}

Met en œuvre une stratégie IAM de moindre privilège à l'aide de comptes de service dédiés à la plateforme, exposés en tant qu'outputs pour les modules applicatifs en aval :

- **Compte de service Cloud Build** — exécution des pipelines CI/CD ; construit les images et gère les déploiements.
- **Compte de service Cloud Deploy** — livraison progressive ; gère les pipelines de livraison et les jobs de déploiement progressif.
- **Compte de service Cloud Run** — identité d'exécution des conteneurs Cloud Run ; accède aux secrets, à Cloud SQL et au stockage.
- **Compte de service de la VM NFS/Redis** — identité de la VM NFS/Redis autogérée.

Ces comptes sont propres au tenant et partagés. Un déploiement avec GKE gère également `gke-sa`, que `App GKE` crée sous le même nom. `Services GCP` n'est pas le seul à créer quatre d'entre eux (`cloudbuild-sa`, `cloudrun-sa`, `nfs-sa`, `gke-sa`) — une application déployée avant `Services GCP` provisionne `cloudbuild-sa` et `cloudrun-sa` (`App CloudRun`), `cloudbuild-sa` (`App GKE`) et `nfs-sa` sur le chemin NFS intégré, et ne les supprime jamais. `clouddeploy-sa` n'est créé qu'ici. Un compte qui existe déjà est importé dans l'état et géré normalement ; il est donc lui aussi supprimé lorsque ce module est détruit. Chaque compte est par conséquent sondé avant l'apply ; un compte déjà existant est importé dans l'état et géré comme n'importe quel autre, de sorte que déployer `Services GCP` dans un projet qu'un module applicatif a atteint en premier n'échoue pas avec `already exists`. Les liaisons IAM sont appliquées dans tous les cas.

`support_users` n'accorde aucun accès IAM. Son seul effet est d'ajouter des destinataires e-mail aux canaux de notification du budget Cloud Billing, et uniquement lorsque `create_billing_budget = true` ; les destinataires des alertes Cloud Monitoring proviennent de `notification_alert_emails` avec `configure_email_notification`.

**Console :** IAM & Admin → Service Accounts (vérifiez que les comptes de service de la plateforme existent) ; IAM (filtrez par e-mail de compte de service ou d'utilisateur de support pour afficher les liaisons).

```bash
# Confirm the platform service accounts were created
gcloud iam service-accounts list --project=PROJECT_ID \
  --format="table(displayName,email)"

# View the project's IAM policy bindings
gcloud projects get-iam-policy PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

### Workload Identity Federation {#workload-identity-federation}

Crée en option un pool et un fournisseur Workload Identity Federation afin que des identités CI/CD externes — GitHub Actions, GitLab CI ou tout fournisseur conforme à OIDC — puissent s'authentifier auprès des API GCP à l'aide de jetons de courte durée, sans fichiers de clés de compte de service de longue durée. Les identités externes authentifiées peuvent emprunter l'identité des comptes de service CI/CD de la plateforme. Le type de fournisseur ne peut pas être modifié après le provisionnement sans recréer le fournisseur.

**Console :** IAM & Admin → Workload Identity Federation → sélectionnez le pool et le fournisseur pour afficher l'émetteur autorisé, les audiences et les conditions d'attributs.

```bash
# List Workload Identity pools
gcloud iam workload-identity-pools list \
  --location=global --project=PROJECT_ID \
  --format="table(name,displayName,state)"

# Describe a provider — view issuer and attribute mappings
gcloud iam workload-identity-pools providers describe PROVIDER_NAME \
  --workload-identity-pool=POOL_NAME \
  --location=global --project=PROJECT_ID
```

---

## Binary Authorization {#binary-authorization}

Applique en option la provenance des images au moment du déploiement, de sorte que seules les images de conteneurs portant une attestation cryptographique valide d'un attestateur de confiance puissent être déployées sur Cloud Run ou GKE dans le projet. L'attestateur et la clé de signature Cloud KMS sont provisionnés par le module ; les pipelines CI/CD signent les images au moment du build. La règle s'applique à l'ensemble du projet, sans possibilité d'exclusion par service. Modes d'évaluation : `ALWAYS_ALLOW` (tout autoriser — pour la configuration initiale), `REQUIRE_ATTESTATION` (le mode de production visé) et `ALWAYS_DENY` (verrouillage d'urgence).

**Console :** Security → Binary Authorization → Policy (mode d'évaluation) et Attestors (attestateurs de confiance et clés de signature).

```bash
# View the current Binary Authorization policy
gcloud container binauthz policy export --project=PROJECT_ID

# List configured attestors
gcloud container binauthz attestors list \
  --project=PROJECT_ID \
  --format="table(name,userOwnedGrafeasNote.noteReference)"

# Check whether a specific image has a valid attestation
gcloud container binauthz attestations list \
  --attestor=ATTESTOR_NAME \
  --attestor-project=PROJECT_ID \
  --artifact-url=IMAGE_URI
```

---

## Chiffrement CMEK {#cmek-encryption}

Remplace en option le chiffrement géré par Google par des clés gérées par le client via Cloud KMS. Un trousseau de clés et une clé de chiffrement symétrique sont provisionnés dans la région principale, et les ressources prises en charge (Cloud SQL, Cloud Storage, Artifact Registry, GKE) sont configurées pour les utiliser pour le chiffrement au repos. La clé effectue une rotation automatique selon une planification configurable, les versions précédentes étant conservées pour le déchiffrement. Prévoyez CMEK dès le déploiement initial — l'activer après le provisionnement de ressources avec des clés gérées par Google exige une migration des données, et les comptes de service doivent détenir le rôle KMS de chiffrement/déchiffrement, faute de quoi la création des ressources échoue.

**Console :** Security → Key Management → vérifiez le trousseau et la clé dans la région principale ; contrôlez la période de rotation et l'état de la version principale de la clé. Dans la vue Overview d'une instance Cloud SQL, vérifiez que le chiffrement indique `Customer-managed`.

```bash
# List key rings in the primary region
gcloud kms keyrings list \
  --location=REGION --project=PROJECT_ID \
  --format="table(name,createTime)"

# List keys — view rotation period and primary key state
gcloud kms keys list \
  --keyring=KEYRING_NAME \
  --location=REGION --project=PROJECT_ID \
  --format="table(name,purpose,rotationPeriod,nextRotationTime,primary.state)"

# Confirm a Cloud SQL instance is encrypted with the CMEK key
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(diskEncryptionConfiguration,diskEncryptionStatus)"
```

---

## VPC Service Controls {#vpc-service-controls}

Établit en option un périmètre VPC Service Controls autour du projet pour se prémunir contre l'exfiltration de données. Une fois appliqué, le périmètre restreint l'accès aux API Google Cloud aux requêtes provenant de l'intérieur du périmètre — des identifiants IAM valides ne suffisent pas à eux seuls depuis l'extérieur des réseaux autorisés. Le périmètre autorise les requêtes provenant des plages de sous-réseaux VPC, des plages d'IP des administrateurs/opérateurs, de l'agent de service IAP et des comptes de service CI/CD. La création du périmètre est ignorée, avec un avertissement, lorsque l'identité appelante ne dispose pas du rôle requis au niveau de l'organisation. Validez toujours en mode simulation (dry-run) (la valeur par défaut) pendant 24 à 72 heures avant de passer à l'application.

**Console :** Security → VPC Service Controls (périmètre et mode). Pour les violations en mode simulation, utilisez Logging → Logs Explorer et filtrez sur le type de métadonnées d'audit VPC Service Control.

```bash
# List access policies in the organisation
gcloud access-context-manager policies list --organization=ORG_ID

# List perimeters within the access policy
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME \
  --format="table(name,status.resources,status.restrictedServices)"

# View dry-run violation logs
gcloud logging read \
  'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName)"
```

---

## Security Command Center {#security-command-center}

Active en option Security Command Center pour regrouper dans un seul tableau de bord les constats de sécurité, les erreurs de configuration et les rapports de vulnérabilités issus de l'ensemble des services GCP. Des détecteurs intégrés identifient les buckets de stockage accessibles publiquement, les comptes de service disposant de privilèges excessifs et les règles de pare-feu inutilisées. Les constats SCC peuvent en option être acheminés vers un sujet Pub/Sub pour des alertes en temps réel ou une ingestion dans un SIEM. La création de la configuration de notification est ignorée, avec un avertissement, lorsque l'identité appelante ne dispose pas du rôle requis au niveau de l'organisation.

L'analyse des vulnérabilités à l'envoi (Container Analysis) peut également être activée indépendamment pour les images Artifact Registry, et des journaux d'audit Cloud détaillés (Data Read et Data Write) peuvent être activés à des fins de conformité — les deux augmentent sensiblement le volume de journaux et le coût.

**Console :** Security → Security Command Center → Findings (constats actifs par gravité et par source). Pour les analyses de vulnérabilités, Artifact Registry → sélectionnez une image → onglet Security. Pour les notifications SCC, Pub/Sub → Topics.

```bash
# List active Security Command Center findings
gcloud scc findings list PROJECT_ID \
  --source=- \
  --filter="state=ACTIVE" \
  --format="table(name,category,severity,eventTime)"

# Check which audit log types are enabled for the project
gcloud projects get-iam-policy PROJECT_ID \
  --format="yaml(auditConfigs)"

# List Pub/Sub topics — confirm SCC notification topic
gcloud pubsub topics list --project=PROJECT_ID \
  --format="table(name)"
```

---

## Monitoring et budgets {#monitoring--budgets}

Crée en option des canaux de notification par e-mail et des règles d'alerte Cloud Monitoring pour l'utilisation des ressources d'infrastructure — CPU, mémoire et disque — sur les VM Compute Engine provisionnées par le module (principalement la VM NFS/Redis autogérée). Les règles d'alerte évaluent l'utilisation moyenne sur une fenêtre glissante et se déclenchent lorsque le seuil configuré est dépassé. Un budget Cloud Billing avec des alertes de seuil par e-mail peut également être créé pour suivre et maîtriser les dépenses GCP.

**Console :** Monitoring → Alerting → Notification channels et Policies ; Monitoring → Metrics Explorer pour l'utilisation en direct. Billing → Budgets & alerts pour le budget ; Billing → Reports pour la ventilation des coûts.

```bash
# List Cloud Monitoring notification channels
gcloud beta monitoring channels list --project=PROJECT_ID \
  --format="table(displayName,type,labels.email_address,enabled)"

# List all alert policies
gcloud alpha monitoring policies list --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].displayName)"

# List budgets for the billing account
gcloud billing budgets list \
  --billing-account=BILLING_ACCOUNT_ID \
  --format="table(name,displayName,amount.specifiedAmount.units,thresholdRules)"
```

---

## Variables de configuration {#configuration-variables}

Les variables sont organisées en groupes correspondant aux sections affichées dans l'interface de déploiement. Configurez un groupe à la fois avant de déployer.

> **Les entrées sont validées au moment du plan.** Le module applique des règles sur les valeurs et leurs combinaisons *avant* la création de toute ressource (il requiert OpenTofu ≥ 1.9). Les valeurs invalides — un `tenant_id` mal formé, un seuil hors limites, une version de base de données inexistante — et les *combinaisons* invalides — un réplica en lecture sans son instance principale, un périmètre VPC-SC appliqué sans IP autorisée, un module complémentaire GKE sans cluster — font échouer le plan avec une erreur claire et nommée, plutôt que de se manifester par un échec obscur en cours d'apply ou, pire, de réussir silencieusement sans rien faire. Chaque groupe ci-dessous indique les règles qui s'appliquent. L'objectif est qu'un plan déploie ce que vous avez demandé ou vous explique précisément pourquoi il ne le peut pas.

### Groupe 1 — Projet et services de base {#group-1--project--core-services}

> **Choisir vos services de base.** Ce groupe constitue l'ensemble de décisions le plus lourd de conséquences — il sélectionne les backends de données et de calcul auxquels chaque module applicatif en aval se liera. Les indicateurs de base de données ne s'excluent *pas* mutuellement dans le code, mais choisissez délibérément selon la charge de travail : **`create_postgres`** pour les applications relationnelles généralistes (le choix sûr par défaut) ; **`create_mysql`** spécifiquement pour les applications natives MySQL (WordPress, Moodle, OpenEMR) ; **`enable_alloydb`** à la place de Postgres lorsque la charge de travail est fortement orientée analytique, vectorielle ou IA (moteur en colonnes + pgvector/SCANN) ; **`create_firestore`** en complément, et non en remplacement, lorsqu'une application a besoin d'un magasin de documents serverless avec synchronisation en temps réel. Activer des backends que vous n'utiliserez pas est la source la plus courante de coûts évitables — chacun est facturé, qu'une application s'y connecte ou non. Définissez **`create_google_kubernetes_engine = true`** uniquement si vous comptez déployer des modules applicatifs GKE ; les applications Cloud Run n'en ont pas besoin, et un cluster Autopilot inactif entraîne malgré tout des frais de plan de contrôle.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(obligatoire)* | ID du projet GCP dans lequel toutes les ressources du module sont déployées. Le modifier après le déploiement initial recrée toutes les ressources dans le nouveau projet. |
| `tenant_id` | `"demo"` | Identifiant court (**lettres minuscules et chiffres uniquement, sans tiret** — imposé au moment du plan) utilisé comme préfixe de chaque nom de ressource. Ne le modifiez jamais après le déploiement initial — cela renommerait, et donc recréerait, chaque ressource. |
| `availability_regions` | `["us-central1"]` | Régions des ressources régionales (sous-réseaux, Cloud SQL, Redis). La première région est la région principale ; une seconde région active les réplicas en lecture inter-régions. 1 à 2 régions sont prises en charge, et vous devez fournir au moins un `subnet_cidr_range` par région (imposé au moment du plan). |
| `create_postgres` | `false` | Provisionne une instance Cloud SQL PostgreSQL dans la région principale. Le choix généraliste pour les charges de travail relationnelles — mais **désactivé par défaut** : un déploiement qui a besoin de Postgres doit donc le demander. Les modules applicatifs qui en ont besoin déclarent `create_postgres = true` dans leur propre map `requires_services`, que la plateforme lit lorsqu'elle provisionne automatiquement ce module. |
| `create_mysql` | `false` | Provisionne une instance Cloud SQL MySQL. À activer pour les applications natives MySQL (WordPress, Moodle, OpenEMR) ; à laisser désactivé sinon, pour éviter une instance inutilisée. |
| `enable_alloydb` | `false` | **Non pris en charge — laissez désactivé.** `alloydb.googleapis.com` a été retirée de l'ensemble des API activées par le module à la suite d'une décision explicite liée aux coûts (PR #2673), si bien que `enable_alloydb = true` échoue à l'apply avec une erreur de service non activé, à moins qu'un opérateur ne fournisse l'API via `additional_apis` (et les dossiers gérés par RAD la refusent dans la liste d'autorisation du dossier). Utilisez plutôt `create_postgres`. |
| `create_firestore` | `false` | Crée une base de données Firestore Native en édition Enterprise. Un magasin de documents serverless — facturé à l'usage, avec mise à l'échelle jusqu'à zéro, donc peu risqué à activer par anticipation. |
| `create_google_kubernetes_engine` | `false` | Provisionne le ou les clusters GKE. Doit valoir `true` avant le déploiement de tout module applicatif GKE ; inutile (et source de frais de plan de contrôle superflus) pour les déploiements exclusivement Cloud Run. |

### Groupe 2 — Notifications et libellés {#group-2--notifications--labels}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | Adresses e-mail ajoutées comme destinataires **des alertes de budget de facturation uniquement**, et seulement lorsque `create_billing_budget = true` (fusionnées avec `budget_alert_emails`). N'accorde **aucun** accès IAM et n'alimente **pas** les alertes Cloud Monitoring — les destinataires de la supervision proviennent de `notification_alert_emails` avec `configure_email_notification`. Sans effet tant que `create_billing_budget = false`. |
| `resource_labels` | `{}` | Libellés clé-valeur appliqués à toutes les ressources créées par le module (centre de coûts, environnement, équipe). |

### Groupe 3 — Réseau et VPC {#group-3--networking--vpc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `subnet_cidr_range` | `["10.0.0.0/24"]` | Plages CIDR des sous-réseaux VPC, une par région de disponibilité. Doivent être des plages RFC 1918 valides et ne doivent se chevaucher ni entre elles ni avec les CIDR de pods/services GKE. De 1 à 2 plages prises en charge. |

### Groupe 4 — Services de base de données et de stockage {#group-4--database--storage-services}

> **Choisir la configuration de la base de données.** Trois axes déterminent ici le coût et la résilience. Le **type de disponibilité** (`ZONAL` ou `REGIONAL`) est le plus important : `ZONAL` est moins cher, mais une panne d'une seule zone met la base de données — et chaque application qui l'utilise — entièrement hors ligne ; `REGIONAL` double environ le coût de l'instance en échange d'une instance de secours active automatique et d'un basculement en moins d'une minute, et constitue le bon choix pour tout ce qui est exposé en production. Le **niveau** (`*_tier`) définit les vCPU/la mémoire : un sous-dimensionnement se traduit par une latence des requêtes et une accumulation dans la file des connexions ; dimensionnez donc selon la charge soutenue et augmentez lorsque le CPU se maintient au-dessus d'environ 70 %. Les **réplicas en lecture** déchargent le trafic à forte composante de lecture et fournissent une cible de promotion pour la reprise après sinistre — utiles dès qu'une instance principale unique est limitée par les lectures, et exempts de trafic sortant inter-régions uniquement si vous les conservez dans la région principale (configurez une seconde entrée `availability_regions` pour la localité inter-régions et la reprise après sinistre). Un réplica sans son instance principale (`create_*_read_replica = true` alors que `create_* = false`) est rejeté au moment du plan plutôt que de ne rien faire silencieusement. Augmentez les **`*_database_flags`** (notamment `max_connections`) au rythme du nombre de réplicas et d'applications pour éviter l'épuisement `too many clients`. Pour **AlloyDB**, dimensionnez `alloydb_cpu_count` selon la charge analytique et n'ajoutez un pool de lecture que lorsque le débit de lecture exige réellement une mise à l'échelle horizontale.

**Cloud SQL — PostgreSQL**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `postgres_database_version` | `"POSTGRES_17"` | Version du moteur PostgreSQL (`POSTGRES_17` / `POSTGRES_16` / `POSTGRES_15` / `POSTGRES_14`). Le passage à une version inférieure n'est pas pris en charge. |
| `postgres_database_availability_type` | `"ZONAL"` | `ZONAL` (zone unique, dev/test) ou `REGIONAL` (haute disponibilité avec basculement automatique, recommandé pour la production). |
| `postgres_tier` | `"db-custom-1-3840"` | Type de machine (vCPU / mémoire) de l'instance PostgreSQL. **Plafonné à 2 vCPU dans un projet géré par RAD** (`gcp-rad-*`) : une `lifecycle.precondition` dans `pgsql.tf` n'admet que `db-f1-micro`, `db-g1-small`, `db-custom-1-*` et `db-custom-2-*`, et fait échouer le plan dans le cas contraire. Un projet apporté par l'utilisateur n'est pas concerné — vous choisissez la taille et la payez. |
| `postgres_database_flags` | `[{ name = "max_connections", value = "200" }]` | Paramètres du serveur PostgreSQL. Certaines modifications d'indicateurs nécessitent un redémarrage de l'instance. |
| `create_postgres_read_replica` | `false` | Provisionne des réplicas en lecture pour l'instance PostgreSQL. |
| `postgres_read_replica_count` | `1` | Nombre de réplicas en lecture PostgreSQL (inter-régions lorsqu'une seconde région est configurée). Nombre entier de 0 à 10 ; dans un projet géré par RAD, 1 au maximum (sandbox, lab) ou 2 (développement, production). |
| `enable_cloudsql_iam_auth` | `false` | Active l'authentification IAM aux bases de données Cloud SQL sur toutes les instances, ce qui supprime la rotation des mots de passe. |

**Cloud SQL — MySQL**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mysql_database_version` | `"MYSQL_8_4"` | Version du moteur MySQL (`MYSQL_8_4` / `MYSQL_8_0` / `MYSQL_5_7`). Le passage à une version inférieure n'est pas pris en charge. |
| `mysql_database_availability_type` | `"ZONAL"` | `ZONAL` (zone unique) ou `REGIONAL` (haute disponibilité). `REGIONAL` est recommandé pour la production. |
| `mysql_tier` | `"db-custom-1-3840"` | Type de machine de l'instance MySQL. **Plafonné à 2 vCPU dans un projet géré par RAD** (`gcp-rad-*`) par la `lifecycle.precondition` correspondante dans `mysql.tf` — même ensemble autorisé que pour `postgres_tier`. |
| `mysql_database_flags` | `[{ name = "max_connections", value = "200" }, { name = "local_infile", value = "off" }]` | Variables du serveur MySQL. Les valeurs par défaut désactivent `local_infile` par bonne pratique de sécurité. |
| `create_mysql_read_replica` | `false` | Provisionne des réplicas en lecture pour l'instance MySQL. |
| `mysql_read_replica_count` | `1` | Nombre de réplicas en lecture MySQL (inter-régions lorsqu'une seconde région est configurée). Nombre entier de 0 à 10 ; dans un projet géré par RAD, 1 au maximum (sandbox, lab) ou 2 (développement, production). |

**Cloud SQL — paramètres de maintenance partagés**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_maintenance_window_day` | `7` | Jour de la semaine (1=lundi … 7=dimanche) de la fenêtre de maintenance Cloud SQL sur les instances principales. |
| `sql_maintenance_window_hour` | `3` | Heure (0–23, UTC) de la fenêtre de maintenance Cloud SQL. |
| `sql_maintenance_update_track` | `"stable"` | Canal de maintenance : `canary` (anticipé), `stable` ou `week5`. |
| `enable_query_insights` | `false` | Active Cloud SQL Query Insights sur les instances principales PostgreSQL et MySQL (sans coût supplémentaire). |

**AlloyDB**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `alloydb_cpu_count` | `2` | vCPU par instance AlloyDB (`2` / `4` / `8` / `16` / `32` / `64`). Utilisé uniquement lorsque `enable_alloydb = true`. |
| `alloydb_database_flags` | `[]` | Indicateurs PostgreSQL appliqués à l'instance principale AlloyDB. |
| `enable_alloydb_read_pool` | `false` | Provisionne un pool de lecture AlloyDB pour décharger l'analytique. |
| `alloydb_read_pool_node_count` | `1` | Nombre de nœuds du pool de lecture AlloyDB (1–20). Utilisé uniquement lorsque `enable_alloydb_read_pool = true`. |

**Firestore**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `firestore_database_id` | `""` | ID de la base de données Firestore (généré automatiquement sous la forme `firestore-db-<random_id>` s'il est vide). Utilisé uniquement lorsque `create_firestore = true`. |
| `firestore_location_id` | `""` | Emplacement Firestore (par défaut, la région principale s'il est vide). Utilisé uniquement lorsque `create_firestore = true`. |

> **Stockage et cache : une seule décision, trois groupes.** Les groupes 5, 6 et 7 offrent les deux mêmes capacités — un stockage de fichiers partagé (NFS) et un cache Redis — selon deux modèles de fourniture. **L'autogéré (groupe 5)** regroupe les deux sur une seule petite VM : de loin le moins cher, sans SLA, point de défaillance unique, adapté au développement et aux déploiements sensibles aux coûts. **Le géré (groupes 6 et 7)** les répartit entre Memorystore Redis et Cloud Filestore : couverts par un SLA, compatibles avec la haute disponibilité, mis à jour par Google, et d'autant plus coûteux. Choisissez *un seul* modèle — exécuter la VM autogérée aux côtés de Filestore géré crée deux partages NFS indépendants (split-brain : une écriture sur l'un est invisible pour les clients de l'autre). Les valeurs par défaut vous donnent volontairement la VM à faible coût (`create_network_filesystem = true`) et laissent les services gérés désactivés ; si vous passez au géré, définissez d'abord `create_network_filesystem = false`.

### Groupe 5 — NFS et Redis autogérés {#group-5--self-managed-nfs--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_network_filesystem` | `true` | Provisionne une VM Compute Engine faisant office à la fois de serveur NFS et de cache Redis. L'alternative moins coûteuse à Filestore et Memorystore gérés ; sans SLA et point de défaillance unique — adaptée au dev/test, pas à la production. |
| `network_filesystem_machine` | `"e2-small"` | Type de machine Compute Engine de la VM NFS/Redis. Sous-dimensionnée pour un NFS à haut débit ou de grands jeux de données Redis — passez à `e2-medium`/`n2-standard-2` pour un usage plus intensif. |
| `network_filesystem_capacity` | `10` | Taille en GB du disque persistant des données NFS. Peut être augmentée mais **pas** réduite — provisionnez largement, car un disque plein provoque des échecs d'écriture `ENOSPC` dans les applications. |

### Groupe 6 — Redis géré (Memorystore) {#group-6--managed-redis-memorystore}

> **Choisir la configuration de Redis.** Le choix déterminant est le **niveau** : `BASIC` est un nœud unique sans réplication — un événement de maintenance ou une défaillance du nœud vide l'intégralité du jeu de données et (pour les magasins de sessions) déconnecte tous les utilisateurs ; `STANDARD_HA` ajoute un réplica inter-zones avec basculement automatique pour environ le double du coût, et c'est le seul niveau sur lequel la **persistance** (instantanés `RDB` ou `AOF`) prend effet. Pour tout ce qui conserve un état devant survivre à un basculement — sessions, compteurs de limitation de débit, files de jobs — utilisez `STANDARD_HA` *avec* un mode de persistance autre que `DISABLED` (une instance `STANDARD_HA` de production laissée à `DISABLED` est rejetée au moment du plan). Définir une persistance sur `BASIC` est également rejeté, car elle serait ignorée silencieusement. `redis_connect_mode` ne peut pas être modifié après la création ; décidez donc d'emblée entre l'appairage et Private Service Access.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_redis` | `false` | Provisionne une instance Cloud Memorystore Redis. À activer uniquement lorsque `create_network_filesystem = false`, pour éviter une infrastructure redondante. |
| `redis_tier` | `"BASIC"` | `BASIC` (nœud unique, sans réplication — cache uniquement) ou `STANDARD_HA` (basculement inter-zones, coût ~2× — requis pour un état durable). |
| `redis_memory_size_gb` | `1` | Capacité mémoire en GB (1–300). Dimensionnez selon le jeu de données actif plus une marge ; une instance sous-dimensionnée évince les clés les plus sollicitées. |
| `redis_version` | `"REDIS_7_2"` | Version du moteur Redis (`REDIS_7_2` / `REDIS_7_0` / `REDIS_6_X`). |
| `redis_connect_mode` | `"DIRECT_PEERING"` | `DIRECT_PEERING` (plus simple, convient à la plupart des cas) ou `PRIVATE_SERVICE_ACCESS` (segmentation plus stricte). **Ne peut pas être modifié après la création.** |
| `redis_persistence_mode` | `"DISABLED"` | Mode de persistance (**effectif uniquement sur `STANDARD_HA`** — imposé) : `DISABLED`, `RDB` (instantanés périodiques) ou `AOF` (perte minimale, surcoût d'écriture plus élevé). |
| `redis_rdb_snapshot_period` | `"ONE_HOUR"` | Intervalle des instantanés RDB. Utilisé uniquement lorsque `redis_persistence_mode = "RDB"`. |

### Groupe 7 — Filestore NFS géré {#group-7--managed-filestore-nfs}

> **Choisir la configuration de Filestore.** Le niveau détermine à la fois les performances et la capacité *minimale* que vous devez payer : `BASIC_HDD` (≥ 1024 GB) pour un débit standard sensible aux coûts ; `BASIC_SSD` (≥ 2560 GB) pour davantage d'IOPS ; `ENTERPRISE` (≥ 1024 GB) pour les performances les plus élevées avec une disponibilité régionale multizone. Le minimum de capacité associé à chaque niveau est imposé au moment du plan, si bien qu'un `BASIC_SSD` sous-dimensionné échoue rapidement plutôt qu'au niveau de l'API. Le niveau ne peut pas être modifié après le provisionnement, et la capacité ne peut qu'augmenter — choisissez donc le niveau délibérément et commencez avec une marge réaliste.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_filestore_nfs` | `false` | Provisionne une instance Cloud Filestore NFS. À activer uniquement lorsque `create_network_filesystem = false`. |
| `filestore_tier` | `"BASIC_HDD"` | `BASIC_HDD` (min. 1024 GB), `BASIC_SSD` (min. 2560 GB) ou `ENTERPRISE` (min. 1024 GB, haute disponibilité régionale). **Ne peut pas être modifié après le provisionnement.** |
| `filestore_capacity_gb` | `1024` | Capacité en GB. Minimum par niveau imposé au moment du plan. Peut être augmentée mais **pas** réduite après le provisionnement. |

### Groupe 8 — Google Kubernetes Engine {#group-8--google-kubernetes-engine}

> **Choisir la configuration de GKE.** Optez par défaut pour **`AUTOPILOT`** — Google gère le provisionnement des nœuds, la mise à l'échelle et le durcissement, vous êtes facturé par pod, et les variables `gke_node_*` sont entièrement ignorées. Ne passez à **`STANDARD`** que lorsqu'une charge de travail a besoin d'un contrôle qu'Autopilot n'offre pas : types de machines spécifiques, SSD local ou planification sensible à la latence (par exemple le service History de Temporal). En mode Standard, les variables de pool de nœuds s'appliquent, et `gke_node_min_count ≤ gke_node_initial_count ≤ gke_node_max_count` est imposé au moment du plan. Les variables **CIDR** sont les paramètres les plus risqués de ce groupe : les plages des nœuds, des pods et des services ne doivent se chevaucher ni entre elles *ni* avec `subnet_cidr_range`, et la plage des pods doit être assez grande pour votre nombre maximal de pods — les chevauchements font échouer la création du cluster, et un CIDR de pods sous-dimensionné provoque plus tard des échecs de planification `no available IP addresses`. Les valeurs par défaut sont dimensionnées pour un usage courant ; ne les modifiez qu'avec un plan d'adressage IP réfléchi. Les trois **modules complémentaires Fleet** exigent chacun un cluster (`create_google_kubernetes_engine = true`, imposé) et ajoutent une charge de réconciliation continue — activez-les lorsque vous utilisez réellement mTLS (Service Mesh), GitOps (Config Sync) ou l'application de règles (Policy Controller), et non par défaut.

**Paramètres du cluster**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name_prefix` | `"gke-cluster"` | Préfixe des noms de cluster ; un index commençant à 1 est ajouté (par exemple `gke-cluster-1`). Ne le modifiez pas après le provisionnement. |
| `gke_cluster_count` | `1` | Nombre de clusters GKE à provisionner (1–10). |
| `gke_cluster_mode` | `"AUTOPILOT"` | `AUTOPILOT` (recommandé, entièrement géré) ou `STANDARD` (contrôle manuel du pool de nœuds). |
| `gke_autoscaling_profile` | `"BALANCED"` | `BALANCED` (priorité à la disponibilité) ou `OPTIMIZE_UTILIZATION` (réduction agressive). |

**CIDR réseau**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_subnet_base_cidr` | `"10.128.0.0/12"` | CIDR de base des sous-réseaux des nœuds GKE. Ne doit pas chevaucher les CIDR de sous-réseau, de pods ou de services. |
| `gke_pod_base_cidr` | `"10.64.0.0/10"` | CIDR de base des plages d'IP des pods. Ne doit pas chevaucher les autres CIDR. |
| `gke_service_base_cidr` | `"10.8.0.0/16"` | CIDR de base des plages ClusterIP des Services Kubernetes. Ne doit pas chevaucher les autres CIDR. |
| `gke_master_base_cidr` | `"172.16.0.0/16"` | CIDR de base dans lequel est découpée la plage privée du plan de contrôle (un `/28` par cluster). Délibérément situé dans un bloc RFC1918 différent (`172.16.0.0/12`, et non `10.x`) des trois précédents, afin de ne jamais pouvoir entrer en collision avec eux, quel que soit leur redimensionnement. Requis car les clusters s'exécutent avec des nœuds privés — le plan de contrôle d'un cluster privé a toujours besoin de son propre `/28` dédié, que son point de terminaison d'API soit privé ou non. |

**Pool de nœuds en mode Standard** *(ignoré en Autopilot)*

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_node_machine_type` | `"e2-standard-4"` | Type de machine du pool de nœuds en mode Standard. |
| `gke_node_initial_count` | `1` | Nombre initial de nœuds par zone (1–10), ajusté par l'autoscaler. |
| `gke_node_min_count` | `1` | Nombre minimal de nœuds par zone que maintient l'autoscaler (0–10). |
| `gke_node_max_count` | `5` | Nombre maximal de nœuds par zone jusqu'auquel l'autoscaler peut monter (1–100). |
| `gke_node_disk_size_gb` | `50` | Taille du disque de démarrage par nœud en GB (10–65536). Vaut 50 par défaut plutôt que 100 afin de conserver une marge sous la règle d'administration `custom.devDiskSizeCeiling` du niveau développement, qui plafonne un disque individuel à 100GB — l'ancienne valeur par défaut se trouvait exactement sur ce plafond, si bien que toute augmentation était rejetée. |
| `gke_node_disk_type` | `"pd-balanced"` | Type de disque de démarrage : `pd-balanced`, `pd-ssd` ou `pd-standard`. |

**Modules complémentaires Fleet**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `configure_cloud_service_mesh` | `false` | Active Cloud Service Mesh (Istio géré) avec mTLS et gestion du trafic. Requiert `create_google_kubernetes_engine = true`. |
| `configure_config_management` | `false` | Active Config Sync pour la réconciliation GitOps à partir d'un dépôt Git. Requiert `create_google_kubernetes_engine = true`. |
| `configure_policy_controller` | `false` | Active Policy Controller (OPA Gatekeeper) pour l'application de la conformité. Requiert `create_google_kubernetes_engine = true`. |

### Groupe 9 — Sauvegarde et restauration GKE {#group-9--gke-backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gke_backup` | `false` | Active Backup for GKE sur le ou les clusters provisionnés. Requiert `create_google_kubernetes_engine = true`. |
| `gke_backup_retention_days` | `30` | Nombre de jours de conservation des instantanés de sauvegarde GKE (1–365). |
| `gke_backup_schedule` | `"0 3 * * *"` | Planification cron (UTC) des jobs de sauvegarde GKE automatiques. |

### Groupe 11 — VPC Service Controls {#group-11--vpc-service-controls}

> **Choisir la configuration de VPC-SC — à manier avec précaution.** C'est la fonctionnalité du module dont le rayon d'impact est le plus large : un périmètre appliqué restreint *tout* accès aux API Google aux requêtes provenant de l'intérieur, si bien que des identifiants IAM valides cessent à eux seuls de fonctionner depuis l'extérieur de la liste d'autorisation. La démarche sûre n'est pas négociable : activez avec `vpc_sc_dry_run = true` (la valeur par défaut), surveillez les journaux d'audit à la recherche d'entrées `POLICY_VIOLATION` pendant 24 à 72 heures, ajoutez chaque IP/réseau légitime à `admin_ip_ranges`/`vpc_cidr_ranges`, *puis* définissez `vpc_sc_dry_run = false`. Appliquer le périmètre avec un `admin_ip_ranges` vide vous bloquerait l'accès à votre propre projet — cette combinaison précise est désormais rejetée au moment du plan, mais le risque plus large d'une liste d'autorisation incomplète reste à votre charge via le mode simulation (dry-run). N'activez cette fonctionnalité que lorsque le contrôle de l'exfiltration de données est une exigence réelle.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Crée un périmètre VPC Service Controls autour du projet. Activez-le toujours d'abord avec `vpc_sc_dry_run = true`. |
| `vpc_cidr_ranges` | `[]` | Plages CIDR de sous-réseaux VPC autorisées à traverser le périmètre. Utilisé uniquement lorsque `enable_vpc_sc = true`. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'IP des administrateurs/opérateurs autorisées à traverser le périmètre (bureau, VPN, runners CI/CD). Obligatoire (non vide) en mode application — `enable_vpc_sc = true` avec `vpc_sc_dry_run = false` et aucune plage est rejeté au moment du plan. |
| `vpc_sc_dry_run` | `true` | `true` = audit uniquement (violations journalisées, non bloquées). Définissez `false` uniquement après avoir examiné les journaux du mode simulation. |

### Groupe 12 — Binary Authorization {#group-12--binary-authorization}

> **Choisir la configuration de Binary Authorization.** L'état final visé est `REQUIRE_ATTESTATION` — seules les images signées par votre attestateur CI/CD peuvent être déployées sur Cloud Run ou GKE dans l'ensemble du projet. Mais l'*ordre des opérations* compte : passer à `REQUIRE_ATTESTATION` avant que le pipeline de signature ne produise des attestations valides bloque **tous** les déploiements du projet — et ce module ne permet pas de revenir en arrière. La mise à jour de la règle est additive et **uniquement durcissante** (plusieurs tenants partagent une même règle de projet), si bien que redéfinir `binauthz_evaluation_mode` à `ALWAYS_ALLOW` est ignoré : l'apply réussit, journalise un WARNING, et la règle en vigueur continue de s'appliquer. La récupération se fait hors bande avec `gcloud container binauthz policy import <file>`. Activez d'abord avec `ALWAYS_ALLOW`, mettez en place le pipeline d'attestation, vérifiez que les images sont bien signées, puis durcissez vers `REQUIRE_ATTESTATION`. `ALWAYS_DENY` est un interrupteur de verrouillage d'urgence, pas un paramètre normal.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_binary_authorization` | `false` | Active la vérification des images au moment du déploiement par Binary Authorization pour le projet. S'applique à l'ensemble du projet, sans exclusion par service. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | `ALWAYS_ALLOW` (configuration initiale — tout autoriser), `REQUIRE_ATTESTATION` (production — imposer les signatures) ou `ALWAYS_DENY` (verrouillage d'urgence — tout bloquer). |

### Groupe 14 — Clés de chiffrement gérées par le client (CMEK) {#group-14--customer-managed-encryption-keys-cmek}

> **Choisir la configuration de CMEK — décidez dès le jour zéro.** CMEK vous donne le contrôle du cycle de vie des clés de chiffrement au repos pour Cloud SQL, Cloud Storage, Artifact Registry et GKE. Le point critique est le moment : l'activer sur un déploiement *neuf* se fait sans heurt, mais l'activer *après* que des ressources existent déjà avec des clés gérées par Google exige une migration des données. Il s'agit d'une fonctionnalité de conformité/gouvernance — ne l'activez que si la garde des clés est une exigence réelle et, dans ce cas, activez-la dès le premier déploiement. `cmek_key_rotation_period` arbitre entre hygiène cryptographique et charge opérationnelle ; la valeur par défaut de 90 jours est un équilibre judicieux.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cmek` | `false` | Provisionne des clés Cloud KMS pour le chiffrement géré par le client de Cloud SQL, Cloud Storage, Artifact Registry et GKE. Décidez-en lors du déploiement initial — une mise en place a posteriori exige une migration des données. |
| `cmek_key_rotation_period` | `"7776000s"` | Période de rotation automatique de la clé KMS, exprimée comme une durée en secondes avec le suffixe `s` (90 jours par défaut). |

### Groupe 16 — Workload Identity Federation {#group-16--workload-identity-federation}

> **Choisir la configuration de WIF — le champ de restriction est obligatoire en pratique.** WIF permet à une CI/CD externe (GitHub Actions, GitLab CI, tout fournisseur OIDC) d'emprunter l'identité des comptes de service de la plateforme avec des jetons de courte durée au lieu de fichiers de clés de longue durée — une amélioration nette de la sécurité *à condition* d'en limiter correctement la portée. Le piège est le champ de portée : pour `github`, un `wif_github_org` vide supprime la restriction `repository_owner`, de sorte que **n'importe quel dépôt GitHub sur Internet pourrait échanger un jeton et emprunter l'identité de votre compte de service** ; pour `generic`, un `wif_oidc_issuer_uri` vide ou invalide fait simplement échouer la création du fournisseur. Les deux cas sont désormais détectés au moment du plan — `github` requiert `wif_github_org`, et `generic` requiert un émetteur `https://` — mais le principe demeure : épinglez toujours la fédération à *votre* organisation/émetteur/audience. `wif_provider_type` ne peut pas être modifié après le provisionnement sans recréer le fournisseur.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_workload_identity_federation` | `false` | Crée un pool et un fournisseur WIF pour une authentification CI/CD sans clé (aucun fichier de clé de compte de service). |
| `wif_provider_type` | `"github"` | Type de fournisseur : `github`, `gitlab` ou `generic`. Ne peut pas être modifié après le provisionnement. |
| `wif_github_org` | `""` | Organisation GitHub à laquelle restreindre l'échange de jetons. **Obligatoire lorsque `wif_provider_type = "github"`** (imposé) — une valeur vide permettrait à n'importe quel dépôt d'emprunter l'identité du compte de service. |
| `wif_gitlab_hostname` | `"gitlab.com"` | Nom d'hôte GitLab de l'émetteur OIDC. Utilisé uniquement lorsque `wif_provider_type = "gitlab"`. |
| `wif_oidc_issuer_uri` | `""` | URI de l'émetteur OIDC pour un fournisseur générique. Doit être une URL `https://` — obligatoire et validée lorsque `wif_provider_type = "generic"`. |
| `wif_allowed_audiences` | `[]` | Audiences de jetons OIDC autorisées. Utilisé uniquement lorsque `wif_provider_type = "generic"`. |

### Groupe 17 — Sécurité, audit et conformité {#group-17--security-auditing--compliance}

> **Choisir la configuration de sécurité et d'audit.** Il s'agit en grande partie d'options indépendantes et peu risquées, dont le principal coût relève des dépenses d'observabilité plutôt que du rayon d'impact. `enable_vulnerability_scanning` est une assurance peu coûteuse — la détection des CVE à l'envoi, qui alimente aussi l'attestation Binary Authorization. `enable_security_command_center` centralise les constats ; `enable_scc_notifications` les achemine vers Pub/Sub pour les alertes/le SIEM et **requiert que SCC soit activé** (la combinaison est vérifiée au moment du plan). Celle à activer *délibérément* est `enable_audit_logging` : les journaux d'audit Data Read/Write sont précieux pour la conformité, mais peuvent multiplier le coût d'ingestion de Cloud Logging — activez-la pour les environnements réglementés, pas par réflexe.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vulnerability_scanning` | `false` | Active l'analyse des CVE à l'envoi par Container Analysis pour les images Artifact Registry. Faible coût, forte valeur. |
| `enable_audit_logging` | `false` | Active les journaux d'audit Cloud Data Read et Data Write pour tous les services pris en charge. **Augmente sensiblement le volume de journaux et le coût** — à activer pour la conformité, pas par défaut. |
| `enable_security_command_center` | `false` | Active Security Command Center pour centraliser les constats de sécurité. |
| `enable_scc_notifications` | `false` | Achemine les constats SCC vers un sujet Pub/Sub. **Requiert `enable_security_command_center = true`** (imposé au moment du plan). |

### Groupe 18 — Cloud Monitoring et alertes {#group-18--cloud-monitoring--alerting}

> **Choisir la configuration des alertes.** Peu d'enjeux, mais facile à rendre inopérant. Les seuils (0–100, imposés) surveillent principalement la VM NFS/Redis autogérée ; ils comptent donc surtout lorsque `create_network_filesystem = true`. L'erreur courante consiste à activer `configure_email_notification` avec un `notification_alert_emails` vide — le canal est créé sans destinataire et chaque alerte est perdue silencieusement. Si vous activez les alertes, fournissez au moins une adresse.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `configure_email_notification` | `false` | Crée un canal de notification par e-mail Cloud Monitoring pour les règles d'alerte sur les seuils de CPU, de mémoire et de disque. À associer à un `notification_alert_emails` non vide. |
| `notification_alert_emails` | `[]` | Adresses e-mail destinataires des notifications d'alerte d'infrastructure. Utilisé uniquement lorsque `configure_email_notification = true`. |
| `alert_cpu_threshold` | `80` | Pourcentage d'utilisation du CPU au-delà duquel une alerte est déclenchée (0–100, imposé). |
| `alert_memory_threshold` | `80` | Pourcentage d'utilisation de la mémoire au-delà duquel une alerte est déclenchée (0–100, imposé). |
| `alert_disk_threshold` | `80` | Pourcentage d'utilisation du disque au-delà duquel une alerte est déclenchée (0–100, imposé). |

### Groupe 19 — Facturation et budget {#group-19--billing--budget}

> **Choisir la configuration du budget.** Un garde-fou peu coûteux contre les dépenses incontrôlées. La seule subtilité concerne `budget_alert_thresholds` : il s'agit de **fractions** de `budget_amount`, et non de pourcentages — `0.5` signifie 50 %. Saisir `50` ne déclencherait l'alerte qu'à 5000 % du budget (c'est-à-dire jamais) ; le module restreint donc chaque valeur à l'intervalle `(0, 1]` au moment du plan. Comme pour la supervision, fournissez `budget_alert_emails`, sinon les alertes n'ont aucun destinataire.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_billing_budget` | `false` | Crée un budget Cloud Billing avec des alertes de seuil de dépenses. Requiert un accès au compte de facturation. |
| `budget_alert_emails` | `[]` | Adresses e-mail destinataires des notifications d'alerte du budget de facturation. |
| `budget_amount` | `100` | Plafond budgétaire mensuel en USD. |
| `budget_alert_thresholds` | `[0.5, 0.9, 1.0]` | Seuils de dépenses exprimés en **fractions** de `budget_amount` (chacune dans `(0, 1]`, imposé) auxquels les alertes se déclenchent — `0.5` = 50 %, et non `50`. |

---

## Sorties {#outputs}

Après un déploiement réussi, les valeurs suivantes sont disponibles dans l'interface de la plateforme et sont utilisées par les modules applicatifs en aval.

| Sortie | Description |
|---|---|
| `deployment_id` | ID hexadécimal aléatoire utilisé comme suffixe dans tous les noms de ressources. |
| `primary_region` | La région GCP principale dans laquelle les ressources mono-région sont provisionnées. |
| `host_project_id` | L'ID du projet GCP dans lequel toutes les ressources ont été déployées. |
| `vpc_network_name` | Nom du réseau VPC. |
| `vpc_network_id` | ID de ressource complet du réseau VPC. |
| `cloudrun_service_account` | E-mail du compte de service Cloud Run. |
| `cloudbuild_service_account` | E-mail du compte de service Cloud Build. |
| `nfs_server_ip` | IP interne statique de la VM du serveur NFS (lorsque `create_network_filesystem = true`). |
| `redis_on_nfs_server_ip` | IP interne statique de la VM NFS/Redis combinée (lorsque `create_network_filesystem = true`). |
| `redis_on_nfs_connection_string` | URI de connexion Redis `redis://{ip}:6379` (lorsque `create_network_filesystem = true`). |
| `postgres_instance_ip` | IP privée de l'instance Cloud SQL PostgreSQL (lorsque `create_postgres = true`). |
| `postgres_instance_connection_name` | Nom de connexion PostgreSQL pour le Cloud SQL Auth Proxy (lorsque `create_postgres = true`). |
| `mysql_instance_ip` | IP privée de l'instance Cloud SQL MySQL (lorsque `create_mysql = true`). |
| `mysql_instance_connection_name` | Nom de connexion MySQL pour le Cloud SQL Auth Proxy (lorsque `create_mysql = true`). |
| `redis_host` | IP de l'hôte de l'instance Memorystore Redis (lorsque `create_redis = true`). |
| `redis_port` | Port de l'instance Memorystore Redis (lorsque `create_redis = true`). |
| `redis_connection_string` | Chaîne de connexion Memorystore Redis `{host}:{port}` (lorsque `create_redis = true`). |
| `filestore_ip` | IP privée du serveur NFS Filestore (lorsque `create_filestore_nfs = true`). |
| `filestore_name` | Nom de l'instance Filestore (lorsque `create_filestore_nfs = true`). |
| `filestore_file_share_name` | Nom du partage de fichiers NFS Filestore exporté (lorsque `create_filestore_nfs = true`). |
| `alloydb_cluster_name` | Nom du cluster AlloyDB (lorsque `enable_alloydb = true`). |
| `alloydb_primary_ip` | IP privée de l'instance principale AlloyDB (lorsque `enable_alloydb = true`). |
| `alloydb_read_pool_ip` | IP privée de l'instance du pool de lecture AlloyDB (lorsque `enable_alloydb` + `enable_alloydb_read_pool`). |
| `gke_cluster_name` | Nom du cluster GKE principal (lorsque `create_google_kubernetes_engine = true`). |
| `gke_cluster_endpoint` | Point de terminaison du cluster GKE principal (sensible ; lorsque `create_google_kubernetes_engine = true`). |
| `gke_cluster_ca_certificate` | Certificat CA du cluster GKE principal (sensible ; lorsque `create_google_kubernetes_engine = true`). |
| `gke_cluster_location` | Région du cluster GKE principal (lorsque `create_google_kubernetes_engine = true`). |
| `gke_cluster_mode` | `"single"` ou `"multi"`, déterminé à partir du nombre de clusters (lorsque `create_google_kubernetes_engine = true`). |
| `gke_service_account_email` | E-mail du compte de service des nœuds GKE (lorsque `create_google_kubernetes_engine = true`). |
| `gke_clusters` | Map de tous les détails des clusters — nom, point de terminaison, certificat CA, emplacement et CIDR (sensible ; lorsque `create_google_kubernetes_engine = true`). |
| `gke_mci_config_cluster` | Nom du cluster de configuration pour Multi-Cluster Ingress (GKE multicluster). |
| `gke_fleet_membership_ids` | ID d'appartenance à la Fleet de tous les clusters (GKE avec Config Management, Policy Controller ou Service Mesh). |
| `artifact_registry_repository_name` | Nom du dépôt Artifact Registry partagé. |
| `artifact_registry_repository_location` | Région du dépôt Artifact Registry. |
| `artifact_registry_repository_project` | ID du projet du dépôt Artifact Registry. |
| `storage_kms_key_name` | Nom de ressource de la clé Cloud KMS utilisée pour le chiffrement de Cloud Storage (lorsque `enable_cmek = true`). |
| `binauthz_attestor_name` | Nom de l'attestateur Binary Authorization (lorsque `enable_binary_authorization = true`). |
| `binauthz_kms_key_id` | ID de la clé KMS utilisée pour la signature des attestations (lorsque `enable_binary_authorization = true`). |
| `binauthz_note_id` | ID de la note Container Analysis pour Binary Authorization (lorsque `enable_binary_authorization = true`). |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

Comme `Services GCP` est la couche de plateforme dont dépend chaque module applicatif, une erreur de configuration à ce niveau peut bloquer simultanément tous les déploiements en aval.

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

> **Beaucoup de ces erreurs sont désormais détectées au moment du plan.** Les lignes marquées **🛡 au moment du plan** sont validées *avant* la création de toute ressource — le plan échoue avec une erreur claire et nommée, si bien que vous n'atteignez jamais la conséquence décrite. Les autres lignes (chevauchement de CIDR, dimensionnement des niveaux, ZONAL en production) relèvent de choix que le module ne peut pas trancher sans risque à votre place ; elles sont listées pour que vous fassiez ce choix délibérément. Un plan sans erreur confirme que les règles sur les valeurs et les combinaisons sont respectées — mais il ne valide ni les choix de dimensionnement ni ceux de topologie.

> **Fiabilité du provisionnement.** Les ressources lentes à créer comportent des `timeouts` explicites et généreux, de sorte qu'un provisionnement normalement lent n'est jamais abandonné en cours d'apply : jusqu'à 60 minutes pour Cloud SQL et AlloyDB, 40 à 60 minutes pour les clusters GKE, 30 minutes pour Memorystore/Filestore et la connexion Private Service Access. Vous n'avez pas besoin de surveiller de près un apply long. Si une erreur d'API *transitoire* (ou un identifiant qui expire pendant un apply très long) laisse malgré tout une ressource active dans GCP mais absente de l'état Terraform, relancez le déploiement — un état partiel se complète simplement ; une ressource qui signale « already exists » peut être importée dans l'état plutôt que recréée. Consultez la phase *Troubleshoot & Debug* du lab pour les commandes de récupération exactes.

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `tenant_id` | alphanumérique en minuscules, défini une seule fois | **Élevé** 🛡 au moment du plan | Les majuscules, tirets ou traits de soulignement sont rejetés au moment du plan — il préfixe chaque nom de ressource, et des caractères invalides casseraient sinon le nommage GCP de dizaines de ressources. Le modifier ultérieurement renomme (recrée) tout. |
| `wif_github_org` (avec `wif_provider_type = "github"`) | votre organisation GitHub | **Critique** 🛡 au moment du plan | Une valeur vide supprime la restriction `repository_owner`, ce qui permet à **n'importe quel** dépôt GitHub d'emprunter l'identité des comptes de service de la plateforme. Désormais rejeté au moment du plan lorsque WIF + github est activé. |
| `wif_oidc_issuer_uri` (avec `wif_provider_type = "generic"`) | votre émetteur `https://` | **Élevé** 🛡 au moment du plan | Un émetteur vide ou non HTTPS fait échouer la création du fournisseur ; désormais validé au moment du plan. |
| `create_*_read_replica` sans `create_*` | aligner sur l'instance principale | **Moyen** 🛡 au moment du plan | Auparavant, le réplica était ignoré silencieusement (vous pensiez avoir des réplicas ; vous n'en aviez aucun). Désormais rejeté au moment du plan. |
| `enable_alloydb_read_pool` sans `enable_alloydb` | aligner sur le cluster | **Moyen** 🛡 au moment du plan | Pool de lecture ignoré silencieusement en l'absence de cluster AlloyDB ; désormais rejeté au moment du plan. |
| `enable_scc_notifications` sans `enable_security_command_center` | activer SCC d'abord | **Faible** 🛡 au moment du plan | Configuration de notification ignorée silencieusement sans SCC ; désormais rejetée au moment du plan. |
| `gke_node_min_count` / `gke_node_max_count` (mode Standard) | `min ≤ initial ≤ max` | **Moyen** 🛡 au moment du plan | `min > max` est une configuration d'autoscaler invalide qui fait échouer la création du pool de nœuds ; l'ordre est désormais imposé au moment du plan. |
| `budget_alert_thresholds` | `[0.5, 0.9, 1.0]` | **Moyen** 🛡 au moment du plan | Les valeurs sont des fractions, pas des pourcentages — saisir `50` pour « 50 % » ne déclencherait l'alerte qu'à 5000 % du budget (jamais). Restreint à `(0, 1]` au moment du plan. |
| `enable_vpc_sc` | `false` ; toujours activer d'abord avec `vpc_sc_dry_run = true` | **Critique** | L'activer avec `vpc_sc_dry_run = false` dès la première activation bloque immédiatement l'accès aux API pour Cloud Build, Cloud Run, GKE et Secret Manager pour toute identité, IP ou tout réseau absent du niveau d'accès. Mode simulation (dry-run) pendant 24 à 72 heures, puis application. |
| `vpc_sc_dry_run` | `true` — ne jamais sauter le mode simulation lors de la première activation | **Critique** | `false` sans audit préalable en mode simulation provoque un blocage immédiat des API, au rayon d'impact étendu, sans retour arrière automatique — le niveau d'accès doit être corrigé manuellement. |
| `admin_ip_ranges` | CIDR du bureau/VPN + IP des runners CI/CD | **Critique** (en partie 🛡 au moment du plan) | Une valeur vide en mode *application* (`enable_vpc_sc = true`, `vpc_sc_dry_run = false`) est rejetée au moment du plan. En mode simulation, elle est autorisée, mais une liste d'autorisation incomplète se manifeste toujours par des `POLICY_VIOLATION` dans les journaux d'audit — c'est la raison d'être du mode simulation. |
| `enable_binary_authorization` | `false` ; à activer uniquement une fois le pipeline d'attestation en place | **Critique** | `REQUIRE_ATTESTATION` sans pipeline d'attestation fonctionnel bloque tous les déploiements d'images du projet. **Rétablir `binauthz_evaluation_mode` ne l'annule pas** — la mise à jour de la règle est additive et uniquement durcissante, si bien qu'un assouplissement est ignoré (l'apply réussit malgré tout en journalisant un WARNING). La récupération se fait hors bande : `gcloud container binauthz policy import <file>`. |
| `subnet_cidr_range` | `["10.0.0.0/24"]` — ne doit pas chevaucher les CIDR de pods/services GKE | **Élevé** | Un chevauchement avec `gke_pod_base_cidr` ou `gke_service_base_cidr` fait échouer la création du cluster GKE sur un conflit de CIDR, ce qui bloque tous les modules applicatifs GKE. |
| `gke_pod_base_cidr` | `"10.64.0.0/10"` — assez grand pour la densité de pods | **Élevé** | Trop petit pour le nombre de pods attendu : GKE ne peut plus planifier de nouveaux pods une fois le CIDR des pods épuisé (`no available IP addresses`). |
| `postgres_database_availability_type` | `"ZONAL"` ; utiliser `"REGIONAL"` en production | **Élevé** | `"ZONAL"` en production n'a pas d'instance de secours active — une panne de zone rend la base de données totalement indisponible pour tous les modules applicatifs qui en dépendent. |
| `postgres_tier` / `mysql_tier` | `"db-custom-1-3840"` | **Élevé** (en partie 🛡 au moment du plan) | Sous-dimensionné : la limitation du CPU entraîne des requêtes lentes, une accumulation dans la file des connexions et des délais d'expiration applicatifs. Augmentez lorsque le CPU soutenu dépasse 70 % — mais dans un projet géré par RAD (`gcp-rad-*`), l'augmentation est plafonnée à **2 vCPU** par une précondition au moment du plan, si bien que toute taille supérieure fait échouer le plan avec une erreur nommée au lieu d'être provisionnée. Cela a remplacé le 2026-08-19 la règle d'administration `custom.radSqlTierCeiling`, dont les tests ont montré qu'elle ne refusait rien. Dépasser ce plafond implique de déployer dans votre propre projet. |
| `postgres_database_flags` | `max_connections = "200"` | **Élevé** | Trop bas pour le nombre de réplicas : épuisement du pool de connexions (`FATAL: sorry, too many clients already`) dans tous les modules. |
| `mysql_database_availability_type` | `"ZONAL"` ; utiliser `"REGIONAL"` en production | **Élevé** | Même risque de défaillance d'une zone unique que pour PostgreSQL, pour les applications adossées à MySQL (WordPress, Moodle, OpenEMR). |
| `network_filesystem_capacity` | `10` GB | **Élevé** | Trop petit : le disque NFS se remplit et les applications ne parviennent plus à écrire (`ENOSPC`). La capacité ne peut qu'être augmentée — provisionnez largement. |
| `filestore_capacity_gb` | `1024` GB (minimum BASIC_HDD) | **Élevé** 🛡 au moment du plan | En dessous du minimum du niveau, le provisionnement de Filestore échouerait au niveau de l'API ; le minimum par niveau (1024 GB pour BASIC_HDD/ENTERPRISE, 2560 GB pour BASIC_SSD) est désormais imposé au moment du plan. |
| `redis_tier` | `"BASIC"` | **Élevé** | `"BASIC"` pour le stockage des sessions en production : une défaillance du nœud ou un événement de maintenance fait perdre toutes les données Redis et déconnecte tous les utilisateurs. Utilisez `"STANDARD_HA"`. |
| `redis_persistence_mode` | `"DISABLED"` ; utiliser `"RDB"`/`"AOF"` pour `STANDARD_HA` en production | **Élevé** (en partie 🛡 au moment du plan) | `"DISABLED"` avec `STANDARD_HA` en production vide toutes les données Redis lors d'un basculement (imposé pour `environment = production`). Définir `RDB`/`AOF` sur `BASIC` est rejeté au moment du plan, car ce niveau ignore la persistance. |
| `enable_cmek` | `false` | **Élevé** | L'activer après le provisionnement de ressources avec des clés gérées par Google exige une migration des données ; les comptes de service doivent détenir le rôle KMS de chiffrement/déchiffrement, faute de quoi la création des ressources échoue. |
| `create_google_kubernetes_engine` | `true` avant tout module applicatif GKE | **Élevé** | `false` lors du déploiement d'un module applicatif GKE : le cluster n'existe pas et tous les déploiements GKE échouent. |
| `create_network_filesystem` + `create_filestore_nfs` | Utiliser l'un ou l'autre | **Moyen** | Les deux à `true` créent deux infrastructures NFS indépendantes, ce qui aboutit à un stockage de fichiers en split-brain où les écritures sur un partage sont invisibles pour les clients de l'autre. |
| `network_filesystem_machine` | `"e2-small"` | **Moyen** | Sous-dimensionné pour un NFS à haut débit ou de grands jeux de données Redis. Passez à `e2-medium` ou `n2-standard-2` pour la production. |
| `enable_gke_backup` | `false` — requiert `create_google_kubernetes_engine = true` | **Moyen** 🛡 au moment du plan | L'activer sans cluster GKE (de même que les autres modules complémentaires GKE : Service Mesh, Config Sync, Policy Controller) est désormais rejeté au moment du plan. Activez d'abord GKE. |
| `enable_audit_logging` | `false` | **Moyen** | `true` augmente sensiblement le volume d'ingestion et le coût de Cloud Logging. À activer délibérément pour les environnements soumis à des exigences de conformité. |
| `configure_email_notification` | `false` | **Faible** | `true` avec une liste `notification_alert_emails` vide crée un canal de notification sans destinataire — les alertes sont perdues silencieusement. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Services GCP](../labs/Services_GCP.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
