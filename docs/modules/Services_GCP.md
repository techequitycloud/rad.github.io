---
title: "Services GCP \u2014 Platform Foundation Module"
---

# Services GCP — Platform Foundation Module

`Services GCP` is the platform foundation layer. It is deployed **once per GCP project**, before any application module, and provisions the shared infrastructure that every application depends on: the VPC and networking, Cloud SQL and AlloyDB databases, Memorystore Redis, Cloud Filestore (or a self-managed NFS/Redis VM), the GKE Autopilot cluster, the shared Artifact Registry repository, the platform service accounts and IAM, and optional security controls (Binary Authorization, CMEK, VPC Service Controls, and Security Command Center).

Because everything else depends on its outputs, `Services GCP` must be provisioned and healthy before `App CloudRun`, `App GKE`, or any application module is deployed.

**Deployment order:**

```
Services GCP  →  App CloudRun / App GKE  →  Application Modules
```

---

## Deployed GCP Services

A fully configured `Services GCP` deployment provisions and integrates the following GCP services:

| Capability | Google Cloud Service |
|---|---|
| Private networking | Compute Engine VPC, Subnets, Cloud Router, Cloud NAT, Private Service Connect, Firewall Rules |
| Relational databases | Cloud SQL (PostgreSQL / MySQL), AlloyDB for PostgreSQL |
| Document database *(optional)* | Firestore (Native, Enterprise edition) |
| Managed cache *(optional)* | Memorystore for Redis |
| Managed file storage *(optional)* | Cloud Filestore (NFS) |
| Self-managed file/cache *(optional)* | Compute Engine VM (NFS + Redis) in a Managed Instance Group |
| Container orchestration *(optional)* | GKE Autopilot / Standard clusters, GKE Fleet, Backup for GKE |
| Container registry | Artifact Registry (Docker) |
| Identity & access | Cloud IAM, platform Service Accounts, Workload Identity Federation *(optional)* |
| Secrets | Secret Manager (root database password) |
| Supply-chain security *(optional)* | Binary Authorization, Cloud KMS attestation key, Container Analysis |
| Encryption *(optional)* | Cloud KMS (CMEK) |
| Data-exfiltration controls *(optional)* | VPC Service Controls, Access Context Manager |
| Security posture *(optional)* | Security Command Center, Container Analysis vulnerability scanning |
| Observability | Cloud Monitoring (alert policies, notification channels), Cloud Logging |
| Cost management *(optional)* | Cloud Billing Budgets |

---

## Prerequisites

Before deploying `Services GCP`:

1. **A GCP project** with billing enabled.
2. **Deployment identity**: the service account used by the platform to apply the module must hold the Owner role (ideally time-limited and conditional) in the target project. When deploying into an external project, grant Owner to the RAD GCP Project agent service account (`rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com`).
3. **Required APIs**: the module enables the full set of GCP APIs it needs automatically. A propagation delay after enablement ensures services are ready before resources are provisioned.
4. **Billing account access** (only for the optional billing budget): the deployment identity needs billing account viewer access.
5. **Organization-level roles** (only for VPC Service Controls and SCC notifications): perimeter and notification creation are silently skipped when the calling identity lacks the required org-level roles.

---

## Networking (VPC)

Provisions a custom-mode VPC network with one regional subnet per configured availability region. All resources — Cloud SQL, Redis, Filestore, GKE, and the self-managed NFS VM — communicate exclusively over private IP within this network. A Cloud Router and Cloud NAT gateway are provisioned per region for outbound internet access from private instances, and a range is reserved for Private Service Connect so Google-managed services are reachable privately. Firewall rules are created for load-balancer health checks, IAP SSH, intra-VPC TCP/UDP/ICMP, NFS, and HTTP/HTTPS traffic. When more than one GKE cluster is provisioned, additional Istio east-west firewall rules are created for cross-cluster mesh traffic.

**Console:** VPC network → VPC networks → select the network → Subnets tab (per-region CIDRs); Firewall tab (rules and target tags). Cloud NAT under Network services → Cloud NAT.

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

## Cloud SQL

Provisions Cloud SQL PostgreSQL and/or MySQL instances in the primary region, with private IP only (no public endpoint), automated daily backups, and auto-resizing SSD storage. Both engines support `ZONAL` (single-zone) or `REGIONAL` (HA with automatic hot standby) availability, optional read replicas (cross-region when a second region is configured), a configurable maintenance window and update track, optional Query Insights, and optional Cloud SQL IAM database authentication. The root database password is generated and stored in Secret Manager.

**Console:** SQL → select the instance. Connections tab confirms Private IP enabled / Public IP disabled; Backups, Flags, and Maintenance tabs show the corresponding settings; read replicas appear under the primary on the SQL overview.

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

## AlloyDB for PostgreSQL

Provisions an AlloyDB for PostgreSQL cluster in the primary region — PostgreSQL-compatible and optimised for analytics and AI/vector workloads with a columnar engine and pgvector/SCANN support. Use instead of Cloud SQL PostgreSQL for mixed OLTP/analytics workloads. The vCPU size is configurable, and an optional horizontally scalable read pool can be provisioned alongside the primary for analytics offload.

**Console:** AlloyDB for PostgreSQL → Clusters to view cluster and instance details, including columnar engine status.

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

## Firestore

Optionally creates a Firestore Native database in Enterprise edition — a serverless document database suited to flexible schemas, real-time sync, and offline client support. The database ID and location are configurable; the ID defaults to `firestore-db-<random_id>` and the location defaults to the primary region when left empty.

**Console:** Firestore to browse the database, collections, and documents.

```bash
# List Firestore databases
gcloud firestore databases list --project=PROJECT_ID
```

---

## Memorystore (Redis)

Optionally provisions a Cloud Memorystore for Redis instance in the primary region as the managed alternative to the self-managed NFS/Redis VM. Supports `BASIC` (single-node) or `STANDARD_HA` (cross-zone failover) tier, configurable memory size and engine version, `DIRECT_PEERING` or `PRIVATE_SERVICE_ACCESS` connectivity, and optional persistence (RDB snapshots or AOF, on `STANDARD_HA` only). The AUTH string is stored in Secret Manager.

**Console:** Memorystore → Redis → select the instance to view tier, memory size, version, connectivity mode, private IP, and maintenance window.

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

## Filestore

Optionally provisions a Cloud Filestore instance in the primary region as managed, SLA-backed shared NFS storage — the alternative to the self-managed NFS VM. Supports `BASIC_HDD`, `BASIC_SSD`, and `ENTERPRISE` (regional, multi-zone) tiers, each with enforced minimum capacities. The instance exports a single NFS share mountable by multiple clients simultaneously.

**Console:** Filestore → Instances → select the instance to view tier, capacity, private IP, and the exported file share name and mount path.

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

## Self-Managed NFS & Redis VM

The lower-cost alternative to managed Filestore and Memorystore. Provisions a single Compute Engine VM running both an NFS server (port 2049) and Redis (port 6379), deployed as a Managed Instance Group of size 1 with auto-healing on TCP health-check failure, an SSD persistent data disk, and daily disk snapshots with 7-day retention. Recommended for development and cost-sensitive deployments.

> The self-managed VM and the managed Filestore/Memorystore services are independent. Running both creates redundant infrastructure and risks split-brain file storage — use one or the other.

**Console:** Compute Engine → VM instances (VM `Running`); Instance groups (MIG `1/1` healthy); Disks (data disk capacity); Snapshots (daily snapshots).

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

## GKE Autopilot Cluster

Optionally provisions one or more GKE clusters in the primary region, registered to a GKE Fleet. **Autopilot** mode (default) is fully managed by Google — node provisioning, scaling, and security hardening are automatic and billing is per pod. **Standard** mode gives full control over node pool machine type, disk, and count via the node-pool variables, for workloads with strict scheduling or hardware requirements. Node, pod, and service CIDRs are configurable and must not overlap. Three independent Fleet add-ons are available: Cloud Service Mesh (managed Istio, mTLS), Config Sync (GitOps reconciliation), and Policy Controller (OPA Gatekeeper). When more than one cluster is provisioned, Multi-Cluster Ingress is available via the config cluster.

**Console:** Kubernetes Engine → Clusters (status, mode, version, CIDRs); Fleets (registration); Features → Service Mesh / Config Management / Policy Controller (add-on status).

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

### Backup for GKE

Optionally enables Backup for GKE on the provisioned cluster(s), creating scheduled backups of both Kubernetes resource state (Deployments, ConfigMaps, Secrets, Services) and PersistentVolumeClaim data to Cloud Storage, with a configurable schedule and retention period. Backups can be restored to the same or a different cluster.

**Console:** Kubernetes Engine → Backup for GKE → Backup plans (schedule, retention); select a plan → Backups (completed backups, size, expiry); use Restore from a completed backup.

```bash
# List all GKE backup plans in the region
gcloud container backup-restore backup-plans list \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,cluster,retentionPolicy.backupDeleteLockDays,state)"

# List completed backups for a backup plan
gcloud container backup-restore backups list \
  --backup-plan=BACKUP_PLAN_NAME \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,state,createTime,deleteLockExpireTime)"
```

---

## Artifact Registry

Provisions a shared Docker repository in the primary region for storing and distributing container images. All application modules push to and pull from this repository. Optional scan-on-push vulnerability scanning and optional CMEK encryption can be applied.

**Console:** Artifact Registry → Repositories → select the repository to browse images and tags.

```bash
# List Artifact Registry repositories
gcloud artifacts repositories list --project=PROJECT_ID

# List images in the shared repository
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --include-tags
```

---

## IAM & Service Accounts

Implements a least-privilege IAM strategy using dedicated platform service accounts, created on every deployment and exposed as outputs for downstream application modules:

- **Cloud Build service account** — CI/CD pipeline execution; builds images and manages deployments.
- **Cloud Deploy service account** — progressive delivery; manages delivery pipelines and rollout jobs.
- **Cloud Run service account** — runtime identity for Cloud Run containers; accesses secrets, Cloud SQL, and storage.
- **NFS/Redis VM service account** — identity for the self-managed NFS/Redis VM.

Users listed in `support_users` are granted project-level IAM access and added as alert recipients.

**Console:** IAM & Admin → Service Accounts (confirm the platform service accounts exist); IAM (filter by service account email or support user to view bindings).

```bash
# Confirm the platform service accounts were created
gcloud iam service-accounts list --project=PROJECT_ID \
  --format="table(displayName,email)"

# View the project's IAM policy bindings
gcloud projects get-iam-policy PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

### Workload Identity Federation

Optionally creates a Workload Identity Federation pool and provider so external CI/CD identities — GitHub Actions, GitLab CI, or any OIDC-compliant provider — can authenticate to GCP APIs using short-lived tokens, without long-lived service account key files. Authenticated external identities can impersonate the platform CI/CD service accounts. The provider type cannot be changed after provisioning without recreating the provider.

**Console:** IAM & Admin → Workload Identity Federation → select the pool and provider to view the allowed issuer, audiences, and attribute conditions.

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

## Binary Authorization

Optionally enforces image provenance at deploy time so only container images carrying a valid cryptographic attestation from a trusted attestor can be deployed to Cloud Run or GKE in the project. The attestor and Cloud KMS signing key are provisioned by the module; CI/CD pipelines sign images at build time. The policy applies project-wide with no per-service opt-out. Evaluation modes: `ALWAYS_ALLOW` (permit all — for initial setup), `REQUIRE_ATTESTATION` (the intended production mode), and `ALWAYS_DENY` (emergency lockdown).

**Console:** Security → Binary Authorization → Policy (evaluation mode) and Attestors (trusted attestors and signing keys).

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

## CMEK Encryption

Optionally replaces Google-managed encryption with customer-managed keys via Cloud KMS. A key ring and symmetric encryption key are provisioned in the primary region, and supported resources (Cloud SQL, Cloud Storage, Artifact Registry, GKE) are configured to use them for at-rest encryption. The key rotates automatically on a configurable schedule, with older versions retained for decryption. Plan CMEK at initial deployment — enabling it after resources are provisioned with Google-managed keys requires data migration, and service accounts must hold the KMS encrypter/decrypter role or resource creation fails.

**Console:** Security → Key Management → confirm the key ring and key in the primary region; verify rotation period and primary key version state. On a Cloud SQL instance Overview, confirm encryption shows `Customer-managed`.

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

## VPC Service Controls

Optionally establishes a VPC Service Controls perimeter around the project to protect against data exfiltration. Once enforced, the perimeter restricts Google Cloud API access to requests originating from within the perimeter — valid IAM credentials alone are not sufficient from outside the allowlisted networks. The perimeter allows requests from VPC subnet ranges, admin/operator IP ranges, the IAP service agent, and CI/CD service accounts. Perimeter creation is skipped with a warning when the calling identity lacks the required org-level role. Always validate in dry-run mode (the default) for 24–72 hours before switching to enforcement.

**Console:** Security → VPC Service Controls (perimeter and mode). For dry-run violations, use Logging → Logs Explorer and filter on the VPC Service Control audit metadata type.

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

## Security Command Center

Optionally enables Security Command Center to aggregate security findings, misconfigurations, and vulnerability reports from across GCP services into a single dashboard. Built-in detectors identify publicly accessible storage buckets, over-privileged service accounts, and unused firewall rules. SCC findings can optionally be routed to a Pub/Sub topic for real-time alerting or SIEM ingestion. Notification config creation is skipped with a warning when the calling identity lacks the required org-level role.

Scan-on-push vulnerability scanning (Container Analysis) can also be enabled for Artifact Registry images independently, and detailed Cloud Audit Logs (Data Read and Data Write) can be enabled for compliance — both significantly increase log volume and cost.

**Console:** Security → Security Command Center → Findings (active findings by severity and source). For vulnerability scans, Artifact Registry → select an image → Security tab. For SCC notifications, Pub/Sub → Topics.

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

## Monitoring & Budgets

Optionally creates Cloud Monitoring email notification channels and alert policies for infrastructure resource utilisation — CPU, memory, and disk — across the Compute Engine VMs provisioned by the module (primarily the self-managed NFS/Redis VM). Alert policies evaluate average utilisation over a rolling window and fire when the configured threshold is exceeded. A Cloud Billing budget with email threshold alerts can also be created to track and control GCP spend.

**Console:** Monitoring → Alerting → Notification channels and Policies; Monitoring → Metrics Explorer for live utilisation. Billing → Budgets & alerts for the budget; Billing → Reports for cost breakdown.

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

## Configuration Variables

Variables are organised into groups that correspond to the sections shown in the deployment UI. Configure one group at a time before deploying.

### Group 1 — Project & Core Services

| Variable | Default | Description |
|---|---|---|
| `project_id` | *(required)* | GCP project ID into which all module resources are deployed. Changing it after initial deployment recreates all resources in the new project. |
| `tenant_deployment_id` | `"demo"` | Short identifier (lowercase letters and numbers only, no hyphens) used as the prefix of every resource name. Never change after initial deployment. |
| `availability_regions` | `["us-central1"]` | Regions for regional resources (subnets, Cloud SQL, Redis). The first region is the primary. Between 1 and 2 regions are supported. |
| `create_postgres` | `true` | Provision a Cloud SQL PostgreSQL instance in the primary region. |
| `create_mysql` | `false` | Provision a Cloud SQL MySQL instance in the primary region. |
| `enable_alloydb` | `false` | Provision an AlloyDB for PostgreSQL cluster (analytics and AI/vector workloads). |
| `create_firestore` | `false` | Create a Firestore Native database in Enterprise edition. |
| `create_google_kubernetes_engine` | `false` | Provision GKE cluster(s). Must be `true` before deploying any GKE application module. |

### Group 2 — Notifications & Labels

| Variable | Default | Description |
|---|---|---|
| `support_users` | `[]` | Email addresses granted IAM access to the project and added as recipients for budget alerts and monitoring notifications. |
| `resource_labels` | `{}` | Key-value labels applied to all resources created by the module (cost centre, environment, team). |

### Group 3 — Networking & VPC

| Variable | Default | Description |
|---|---|---|
| `subnet_cidr_range` | `["10.0.0.0/24"]` | CIDR ranges for the VPC subnets, one per availability region. Must be valid RFC 1918 ranges and must not overlap with each other or with GKE pod/service CIDRs. Between 1 and 2 ranges supported. |

### Group 4 — Database & Storage Services

**Cloud SQL — PostgreSQL**

| Variable | Default | Description |
|---|---|---|
| `postgres_database_version` | `"POSTGRES_17"` | PostgreSQL engine version (`POSTGRES_17` / `POSTGRES_16` / `POSTGRES_15` / `POSTGRES_14`). Downgrading is not supported. |
| `postgres_database_availability_type` | `"ZONAL"` | `ZONAL` (single-zone, dev/test) or `REGIONAL` (HA with automatic failover, recommended for production). |
| `postgres_tier` | `"db-custom-1-3840"` | Machine type (vCPUs / memory) for the PostgreSQL instance. |
| `postgres_database_flags` | `[{ name = "max_connections", value = "200" }]` | PostgreSQL server parameters. Some flag changes require an instance restart. |
| `create_postgres_read_replica` | `false` | Provision read replicas for the PostgreSQL instance. |
| `postgres_read_replica_count` | `1` | Number of PostgreSQL read replicas (cross-region when a second region is configured). |
| `enable_cloudsql_iam_auth` | `false` | Enable Cloud SQL IAM database authentication on all instances, eliminating password rotation. |

**Cloud SQL — MySQL**

| Variable | Default | Description |
|---|---|---|
| `mysql_database_version` | `"MYSQL_8_4"` | MySQL engine version (`MYSQL_8_4` / `MYSQL_8_0` / `MYSQL_5_7`). Downgrading is not supported. |
| `mysql_database_availability_type` | `"ZONAL"` | `ZONAL` (single-zone) or `REGIONAL` (HA). Recommended `REGIONAL` for production. |
| `mysql_tier` | `"db-custom-1-3840"` | Machine type for the MySQL instance. |
| `mysql_database_flags` | `[{ name = "max_connections", value = "200" }, { name = "local_infile", value = "off" }]` | MySQL server variables. The defaults disable `local_infile` as a security best practice. |
| `create_mysql_read_replica` | `false` | Provision read replicas for the MySQL instance. |
| `mysql_read_replica_count` | `1` | Number of MySQL read replicas (cross-region when a second region is configured). |

**Cloud SQL — Shared Maintenance Settings**

| Variable | Default | Description |
|---|---|---|
| `sql_maintenance_window_day` | `7` | Day of week (1=Mon … 7=Sun) for the Cloud SQL maintenance window on primary instances. |
| `sql_maintenance_window_hour` | `3` | Hour (0–23, UTC) for the Cloud SQL maintenance window. |
| `sql_maintenance_update_track` | `"stable"` | Maintenance track: `canary` (early), `stable`, or `week5`. |
| `enable_query_insights` | `false` | Enable Cloud SQL Query Insights on PostgreSQL and MySQL primaries (no additional cost). |

**AlloyDB**

| Variable | Default | Description |
|---|---|---|
| `alloydb_cpu_count` | `2` | vCPUs per AlloyDB instance (`2` / `4` / `8` / `16` / `32` / `64`). Only used when `enable_alloydb = true`. |
| `alloydb_database_flags` | `[]` | PostgreSQL flags applied to the AlloyDB primary instance. |
| `enable_alloydb_read_pool` | `false` | Provision an AlloyDB read pool for analytics offload. |
| `alloydb_read_pool_node_count` | `1` | Number of nodes in the AlloyDB read pool (1–20). Only used when `enable_alloydb_read_pool = true`. |

**Firestore**

| Variable | Default | Description |
|---|---|---|
| `firestore_database_id` | `""` | Firestore database ID (auto-generated as `firestore-db-<random_id>` when empty). Only used when `create_firestore = true`. |
| `firestore_location_id` | `""` | Firestore location (defaults to the primary region when empty). Only used when `create_firestore = true`. |

### Group 5 — Self-Managed NFS & Redis

| Variable | Default | Description |
|---|---|---|
| `create_network_filesystem` | `true` | Provision a Compute Engine VM as a combined NFS server and Redis cache. The lower-cost alternative to managed Filestore and Memorystore. |
| `network_filesystem_machine` | `"e2-small"` | Compute Engine machine type for the NFS/Redis VM. |
| `network_filesystem_capacity` | `10` | Size in GB of the persistent disk for NFS data. Can be increased but not decreased. |

### Group 6 — Managed Redis (Memorystore)

| Variable | Default | Description |
|---|---|---|
| `create_redis` | `false` | Provision a Cloud Memorystore Redis instance. Enable only when `create_network_filesystem = false` to avoid redundant infrastructure. |
| `redis_tier` | `"BASIC"` | `BASIC` (single-node) or `STANDARD_HA` (high-availability, ~2× cost). |
| `redis_memory_size_gb` | `1` | Memory capacity in GB (1–300). |
| `redis_version` | `"REDIS_7_2"` | Redis engine version (`REDIS_7_2` / `REDIS_7_0` / `REDIS_6_X`). |
| `redis_connect_mode` | `"DIRECT_PEERING"` | `DIRECT_PEERING` or `PRIVATE_SERVICE_ACCESS`. Cannot be changed after creation. |
| `redis_persistence_mode` | `"DISABLED"` | Persistence mode (effective on `STANDARD_HA` only): `DISABLED`, `RDB`, or `AOF`. |
| `redis_rdb_snapshot_period` | `"ONE_HOUR"` | RDB snapshot interval. Only used when `redis_persistence_mode = "RDB"`. |

### Group 7 — Managed Filestore NFS

| Variable | Default | Description |
|---|---|---|
| `create_filestore_nfs` | `false` | Provision a Cloud Filestore NFS instance. Enable only when `create_network_filesystem = false`. |
| `filestore_tier` | `"BASIC_HDD"` | `BASIC_HDD` (min 1024 GB), `BASIC_SSD` (min 2560 GB), or `ENTERPRISE` (min 1024 GB, regional HA). Cannot be changed after provisioning. |
| `filestore_capacity_gb` | `1024` | Capacity in GB. Tier minimums enforced. Can be increased but not decreased after provisioning. |

### Group 8 — Google Kubernetes Engine

**Cluster Settings**

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name_prefix` | `"gke-cluster"` | Prefix for cluster names; a 1-based index is appended (e.g. `gke-cluster-1`). Do not change after provisioning. |
| `gke_cluster_count` | `1` | Number of GKE clusters to provision (1–10). |
| `gke_cluster_mode` | `"AUTOPILOT"` | `AUTOPILOT` (recommended, fully managed) or `STANDARD` (manual node pool control). |
| `gke_autoscaling_profile` | `"BALANCED"` | `BALANCED` (availability-first) or `OPTIMIZE_UTILIZATION` (aggressive scale-down). |

**Network CIDRs**

| Variable | Default | Description |
|---|---|---|
| `gke_subnet_base_cidr` | `"10.128.0.0/12"` | Base CIDR for GKE node subnets. Must not overlap with subnet, pod, or service CIDRs. |
| `gke_pod_base_cidr` | `"10.64.0.0/10"` | Base CIDR for pod IP ranges. Must not overlap with other CIDRs. |
| `gke_service_base_cidr` | `"10.8.0.0/16"` | Base CIDR for Kubernetes Service ClusterIP ranges. Must not overlap with other CIDRs. |

**Standard Mode Node Pool** *(ignored in Autopilot)*

| Variable | Default | Description |
|---|---|---|
| `gke_node_machine_type` | `"e2-standard-4"` | Node pool machine type for Standard mode. |
| `gke_node_initial_count` | `1` | Initial node count per zone (1–10), adjusted by the autoscaler. |
| `gke_node_min_count` | `1` | Minimum nodes per zone the autoscaler maintains (0–10). |
| `gke_node_max_count` | `5` | Maximum nodes per zone the autoscaler may scale to (1–100). |
| `gke_node_disk_size_gb` | `100` | Boot disk size per node in GB (10–65536). |
| `gke_node_disk_type` | `"pd-balanced"` | Boot disk type: `pd-balanced`, `pd-ssd`, or `pd-standard`. |

**Fleet Add-ons**

| Variable | Default | Description |
|---|---|---|
| `configure_cloud_service_mesh` | `false` | Enable Cloud Service Mesh (managed Istio) with mTLS and traffic management. Requires `create_google_kubernetes_engine = true`. |
| `configure_config_management` | `false` | Enable Config Sync for GitOps reconciliation from a Git repository. Requires `create_google_kubernetes_engine = true`. |
| `configure_policy_controller` | `false` | Enable Policy Controller (OPA Gatekeeper) for compliance enforcement. Requires `create_google_kubernetes_engine = true`. |

### Group 9 — GKE Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `enable_gke_backup` | `false` | Enable Backup for GKE on the provisioned cluster(s). Requires `create_google_kubernetes_engine = true`. |
| `gke_backup_retention_days` | `30` | Days to retain GKE backup snapshots (1–365). |
| `gke_backup_schedule` | `"0 3 * * *"` | Cron schedule (UTC) for automatic GKE backup jobs. |

### Group 11 — VPC Service Controls

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Create a VPC Service Controls perimeter around the project. Always enable with `vpc_sc_dry_run = true` first. |
| `vpc_cidr_ranges` | `[]` | VPC subnet CIDR ranges permitted through the perimeter. Only used when `enable_vpc_sc = true`. |
| `admin_ip_ranges` | `[]` | Administrator/operator IP CIDR ranges permitted through the perimeter (office, VPN, CI/CD runners). Only used when `enable_vpc_sc = true`. |
| `vpc_sc_dry_run` | `true` | `true` = audit-only (violations logged, not blocked). Set to `false` only after reviewing dry-run logs. |

### Group 12 — Binary Authorization

| Variable | Default | Description |
|---|---|---|
| `enable_binary_authorization` | `false` | Enable Binary Authorization deploy-time image verification for the project. Applies project-wide. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | `ALWAYS_ALLOW` (initial setup), `REQUIRE_ATTESTATION` (production), or `ALWAYS_DENY` (lockdown). |

### Group 14 — Customer-Managed Encryption Keys (CMEK)

| Variable | Default | Description |
|---|---|---|
| `enable_cmek` | `false` | Provision Cloud KMS keys for customer-managed encryption of Cloud SQL, Cloud Storage, Artifact Registry, and GKE. |
| `cmek_key_rotation_period` | `"7776000s"` | KMS key auto-rotation period as a duration in seconds with an `s` suffix (default 90 days). |

### Group 16 — Workload Identity Federation

| Variable | Default | Description |
|---|---|---|
| `enable_workload_identity_federation` | `false` | Create a WIF pool and provider for keyless CI/CD authentication (no service account key files). |
| `wif_provider_type` | `"github"` | Provider type: `github`, `gitlab`, or `generic`. |
| `wif_github_org` | `""` | GitHub organisation to restrict token exchange (empty = accept all repos). Only used when `wif_provider_type = "github"`. |
| `wif_gitlab_hostname` | `"gitlab.com"` | GitLab hostname for the OIDC issuer. Only used when `wif_provider_type = "gitlab"`. |
| `wif_oidc_issuer_uri` | `""` | OIDC issuer URI for a generic provider. Only used when `wif_provider_type = "generic"`. |
| `wif_allowed_audiences` | `[]` | Allowed OIDC token audiences. Only used when `wif_provider_type = "generic"`. |

### Group 17 — Security, Auditing & Compliance

| Variable | Default | Description |
|---|---|---|
| `enable_vulnerability_scanning` | `false` | Enable Container Analysis scan-on-push CVE scanning for Artifact Registry images. |
| `enable_audit_logging` | `false` | Enable Data Read and Data Write Cloud Audit Logs for all supported services. Significantly increases log volume and cost. |
| `enable_security_command_center` | `false` | Enable Security Command Center for centralised security findings. |
| `enable_scc_notifications` | `false` | Route SCC findings to a Pub/Sub topic. Requires `enable_security_command_center = true`. |

### Group 18 — Cloud Monitoring & Alerting

| Variable | Default | Description |
|---|---|---|
| `configure_email_notification` | `false` | Create a Cloud Monitoring email notification channel for the CPU, memory, and disk threshold alert policies. |
| `notification_alert_emails` | `[]` | Email addresses for infrastructure alert notifications. Only used when `configure_email_notification = true`. |
| `alert_cpu_threshold` | `80` | CPU utilisation % above which an alert is triggered (0–100). |
| `alert_memory_threshold` | `80` | Memory utilisation % above which an alert is triggered (0–100). |
| `alert_disk_threshold` | `80` | Disk utilisation % above which an alert is triggered (0–100). |

### Group 19 — Billing & Budget

| Variable | Default | Description |
|---|---|---|
| `create_billing_budget` | `false` | Create a Cloud Billing budget with spend threshold alerts. Requires billing account access. |
| `budget_alert_emails` | `[]` | Email addresses for billing budget alert notifications. |
| `budget_amount` | `100` | Monthly budget limit in USD. |
| `budget_alert_thresholds` | `[0.5, 0.9, 1.0]` | Spend thresholds as fractions of `budget_amount` at which alerts fire. |

---

## Outputs

After a successful deployment, the following values are available in the platform UI and are consumed by downstream application modules.

| Output | Description |
|---|---|
| `deployment_id` | Random hex ID used as a suffix in all resource names. |
| `primary_region` | The primary GCP region where single-region resources are provisioned. |
| `host_project_id` | The GCP project ID into which all resources were deployed. |
| `vpc_network_name` | Name of the VPC network. |
| `vpc_network_id` | Full resource ID of the VPC network. |
| `cloudrun_service_account` | Email of the Cloud Run service account. |
| `cloudbuild_service_account` | Email of the Cloud Build service account. |
| `nfs_server_ip` | Static internal IP of the NFS server VM (when `create_network_filesystem = true`). |
| `redis_on_nfs_server_ip` | Static internal IP of the combined NFS/Redis VM (when `create_network_filesystem = true`). |
| `redis_on_nfs_connection_string` | Redis connection URI `redis://{ip}:6379` (when `create_network_filesystem = true`). |
| `postgres_instance_ip` | Private IP of the PostgreSQL Cloud SQL instance (when `create_postgres = true`). |
| `postgres_instance_connection_name` | PostgreSQL connection name for Cloud SQL Auth Proxy (when `create_postgres = true`). |
| `mysql_instance_ip` | Private IP of the MySQL Cloud SQL instance (when `create_mysql = true`). |
| `mysql_instance_connection_name` | MySQL connection name for Cloud SQL Auth Proxy (when `create_mysql = true`). |
| `redis_host` | Host IP of the Memorystore Redis instance (when `create_redis = true`). |
| `redis_port` | Port of the Memorystore Redis instance (when `create_redis = true`). |
| `redis_connection_string` | Memorystore Redis connection string `{host}:{port}` (when `create_redis = true`). |
| `filestore_ip` | Private IP of the Filestore NFS server (when `create_filestore_nfs = true`). |
| `filestore_name` | Name of the Filestore instance (when `create_filestore_nfs = true`). |
| `filestore_file_share_name` | Name of the exported Filestore NFS file share (when `create_filestore_nfs = true`). |
| `alloydb_cluster_name` | Name of the AlloyDB cluster (when `enable_alloydb = true`). |
| `alloydb_primary_ip` | Private IP of the AlloyDB primary instance (when `enable_alloydb = true`). |
| `alloydb_read_pool_ip` | Private IP of the AlloyDB read pool instance (when `enable_alloydb` + `enable_alloydb_read_pool`). |
| `gke_cluster_name` | Name of the primary GKE cluster (when `create_google_kubernetes_engine = true`). |
| `gke_cluster_endpoint` | Endpoint of the primary GKE cluster (sensitive; when `create_google_kubernetes_engine = true`). |
| `gke_cluster_ca_certificate` | CA certificate of the primary GKE cluster (sensitive; when `create_google_kubernetes_engine = true`). |
| `gke_cluster_location` | Region of the primary GKE cluster (when `create_google_kubernetes_engine = true`). |
| `gke_cluster_mode` | `"single"` or `"multi"`, determined from cluster count (when `create_google_kubernetes_engine = true`). |
| `gke_service_account_email` | Email of the GKE node service account (when `create_google_kubernetes_engine = true`). |
| `gke_clusters` | Map of all cluster details — name, endpoint, CA cert, location, and CIDRs (sensitive; when `create_google_kubernetes_engine = true`). |
| `gke_mci_config_cluster` | Config cluster name for Multi-Cluster Ingress (multi-cluster GKE). |
| `gke_fleet_membership_ids` | Fleet membership IDs for all clusters (GKE with Config Management or Service Mesh). |
| `artifact_registry_repository_name` | Name of the shared Artifact Registry repository. |
| `artifact_registry_repository_location` | Region of the Artifact Registry repository. |
| `artifact_registry_repository_project` | Project ID of the Artifact Registry repository. |
| `storage_kms_key_name` | Cloud KMS key resource name used for Cloud Storage encryption (when `enable_cmek = true`). |
| `binauthz_attestor_name` | Name of the Binary Authorization attestor (when `enable_binary_authorization = true`). |
| `binauthz_kms_key_id` | KMS key ID used for attestation signing (when `enable_binary_authorization = true`). |
| `binauthz_note_id` | Container Analysis note ID for Binary Authorization (when `enable_binary_authorization = true`). |

---

## Configuration Pitfalls & Sensible Defaults

Because `Services GCP` is the platform layer that every application module depends on, misconfiguration here can block all downstream deployments simultaneously.

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `enable_vpc_sc` | `false`; always enable with `vpc_sc_dry_run = true` first | **Critical** | Enabling with `vpc_sc_dry_run = false` on first enable immediately blocks API access across Cloud Build, Cloud Run, GKE, and Secret Manager for any identity, IP, or network missing from the access level. Dry-run for 24–72 hours, then enforce. |
| `vpc_sc_dry_run` | `true` — never skip dry-run on first enable | **Critical** | `false` without a prior dry-run audit causes immediate, wide-blast-radius API blocking with no automatic rollback — the access level must be corrected manually. |
| `admin_ip_ranges` | Office/VPN CIDR + CI/CD runner IPs | **Critical** | Empty with `enable_vpc_sc = true` blocks all Google Cloud API calls from developer machines; audit logs show `POLICY_VIOLATION` until IPs are added. |
| `enable_binary_authorization` | `false`; enable only after attestation pipeline is in place | **Critical** | `REQUIRE_ATTESTATION` without a functioning attestation pipeline blocks every image deployment across the project; recovery requires reverting to `ALWAYS_ALLOW`. |
| `subnet_cidr_range` | `["10.0.0.0/24"]` — must not overlap GKE pod/service CIDRs | **High** | Overlap with `gke_pod_base_cidr` or `gke_service_base_cidr` fails GKE cluster creation with a CIDR conflict, blocking all GKE application modules. |
| `gke_pod_base_cidr` | `"10.64.0.0/10"` — large enough for pod density | **High** | Too small for the expected pod count: GKE cannot schedule new pods once the pod CIDR is exhausted (`no available IP addresses`). |
| `postgres_database_availability_type` | `"ZONAL"`; use `"REGIONAL"` for production | **High** | `"ZONAL"` in production has no hot standby — a zone outage causes complete database unavailability for all dependent application modules. |
| `postgres_tier` | `"db-custom-1-3840"` | **High** | Under-provisioned: CPU throttling causes slow queries, connection queue buildup, and application timeouts. Upgrade when sustained CPU exceeds 70%. |
| `postgres_database_flags` | `max_connections = "200"` | **High** | Too low for the number of replicas: connection-pool exhaustion (`FATAL: sorry, too many clients already`) across all modules. |
| `mysql_database_availability_type` | `"ZONAL"`; use `"REGIONAL"` for production | **High** | Same single-zone failure risk as PostgreSQL for MySQL-backed apps (WordPress, Moodle, OpenEMR). |
| `network_filesystem_capacity` | `10` GB | **High** | Too small: the NFS disk fills and applications fail to write (`ENOSPC`). Capacity can only be increased — provision generously. |
| `filestore_capacity_gb` | `1024` GB (BASIC_HDD minimum) | **High** | Below the tier minimum, Filestore provisioning fails. Minimums: 1024 GB (BASIC_HDD/ENTERPRISE), 2560 GB (BASIC_SSD). |
| `redis_tier` | `"BASIC"` | **High** | `"BASIC"` for production session storage: a node failure or maintenance event loses all Redis data and logs out all users. Use `"STANDARD_HA"`. |
| `redis_persistence_mode` | `"DISABLED"`; use `"RDB"`/`"AOF"` for production `STANDARD_HA` | **High** | `"DISABLED"` with `STANDARD_HA` in production: a failover flushes all Redis data — sessions, cached pages, rate-limit counters. |
| `enable_cmek` | `false` | **High** | Enabling after resources are provisioned with Google-managed keys requires data migration; service accounts must hold the KMS encrypter/decrypter role or resource creation fails. |
| `create_google_kubernetes_engine` | `true` before any GKE application module | **High** | `false` when a GKE application module is deployed: the cluster does not exist and all GKE deployments fail. |
| `create_network_filesystem` + `create_filestore_nfs` | Use one or the other | **Medium** | Both `true` creates two independent NFS infrastructures, leading to split-brain file storage where writes to one share are invisible to clients of the other. |
| `network_filesystem_machine` | `"e2-small"` | **Medium** | Under-provisioned for high-throughput NFS or large Redis datasets. Upgrade to `e2-medium` or `n2-standard-2` for production. |
| `enable_gke_backup` | `false` — requires `create_google_kubernetes_engine = true` | **Medium** | Enabling without a GKE cluster fails with a dependency error. Enable GKE first. |
| `enable_audit_logging` | `false` | **Medium** | `true` significantly increases Cloud Logging ingestion volume and cost. Enable deliberately for compliance environments. |
| `configure_email_notification` | `false` | **Low** | `true` with an empty `notification_alert_emails` list creates a notification channel with no recipients — alerts are silently dropped. |
