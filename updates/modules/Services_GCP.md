# Services_GCP Module

## Overview

`Services_GCP` is the **foundational infrastructure module** in the RAD Modules ecosystem. It runs before any application module and provisions the shared GCP services that all applications depend on: VPC networking, Cloud SQL databases, NFS file storage, Redis cache, Artifact Registry, IAM service accounts, and optional security controls (CMEK, Binary Authorization, VPC Service Controls).

Unlike `*_Common` modules (which are pure configuration libraries), `Services_GCP` creates real GCP resources and is a prerequisite for `App_CloudRun` and `App_GKE`. It must be deployed first and its outputs — service account emails, VPC name, database connection names, NFS IP — are passed as inputs to downstream modules.

**Platform metadata variables** (Section 0 in `variables.tf`) such as `module_description`, `credit_cost`, and `require_credit_purchases` are consumed by the RAD platform UI and have no effect on resource provisioning.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Services_GCP                                        │
│                                                                              │
│  ALWAYS CREATED                      OPTIONAL (feature flags)                │
│  ─────────────                       ──────────────────────                  │
│  • 46 GCP APIs enabled               • PostgreSQL (create_postgres)          │
│  • VPC network + subnets             • MySQL (create_mysql)                  │
│  • Cloud NAT (egress)                • NFS+Redis VM (create_network_fs)      │
│  • Private Service Connect           • Managed Filestore (create_filestore)  │
│  • Artifact Registry (Docker)        • Managed Redis (create_redis)          │
│  • 4 Service Accounts + IAM          • GKE Autopilot (create_gke)            │
│  • Root DB password (Secret Mgr)     • CMEK (enable_cmek)                    │
│  • Firewall rules                    • VPC Service Controls                  │
│                                      • Binary Authorization                  │
│                                      • Security Command Center               │
│                                      • Audit logging / Monitoring alerts     │
└──────────────────────────────────────────────────────────────────────────────┘
         │ outputs
         ▼
  App_CloudRun / App_GKE (Layer 2)
  (service_account, vpc_network_name, postgres_instance_connection_name, ...)
```

**Deployment order:**
```
Services_GCP  →  App_CloudRun / App_GKE  →  *_Common modules
```

---

## GCP APIs Enabled

When `enable_services = true` (default), the module enables 46 APIs on the project. Key APIs include:

| Category | APIs |
|----------|------|
| Core platform | `iam`, `cloudresourcemanager`, `serviceusage`, `compute` |
| Networking | `servicenetworking`, `dns`, `networkmanagement` |
| Containers | `run`, `container`, `artifactregistry`, `cloudbuild`, `clouddeploy` |
| Database | `sqladmin`, `redis`, `memorystore` |
| Storage | `storage`, `file`, `firestore` |
| Security | `secretmanager`, `cloudkms`, `binaryauthorization`, `accesscontextmanager`, `websecurityscanner`, `containersecurity` |
| GKE advanced | `gkehub`, `gkeconnect`, `mesh`, `anthospolicycontroller`, `anthosconfigmanagement` |
| Observability | `monitoring`, `logging` |
| AI/ML | `aiplatform`, `discoveryengine`, `cloudaicompanion` |
| Other | `pubsub`, `iap`, `certificatemanager`, `eventarc`, `cloudbilling`, `billingbudgets` |

A `time_sleep` of **360 seconds** runs after API enablement to allow full propagation before dependent resources are created.

---

## Always-Created Resources

These resources are provisioned on every deployment regardless of feature flags.

### Networking (`network.tf`)

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_compute_network` | `{network_name}` | Custom-mode VPC (no auto subnets) |
| `google_compute_subnetwork` | `{network_name}-subnet-{region}` | One subnet per `availability_regions` entry |
| `google_compute_firewall` (×8) | `{network_name}-fw-*` | See firewall rules table below |
| Cloud Router + Cloud NAT | `{network_name}-nat-gw-{region}` | Egress NAT for private instances |
| `google_compute_global_address` | `{network_name}-psconnect-ip-range` | /16 RFC 1918 range for Private Service Connect |
| `google_service_networking_connection` | — | VPC peering to Google managed services |
| `google_compute_network_peering_routes_config` | — | Exports/imports custom routes for GKE→Cloud SQL |

**Firewall rules always created:**

| Rule | Direction | Source | Ports | Purpose |
|------|-----------|--------|-------|---------|
| `fw-allow-lb-hc` | INGRESS | `35.191.0.0/16`, `130.211.0.0/22` | TCP 80, 2049, 6379 | Load balancer health checks |
| `fw-allow-iap-ssh` | INGRESS | `35.235.240.0/20` | TCP 22 | SSH via Identity-Aware Proxy |
| `fw-allow-intra-vpc-tcp` | INGRESS | All internal CIDRs | TCP all | Intra-VPC TCP |
| `fw-allow-intra-vpc-udp` | INGRESS | All internal CIDRs | UDP all | Intra-VPC UDP |
| `fw-allow-intra-vpc-icmp` | INGRESS | All internal CIDRs | ICMP | Intra-VPC ICMP |
| `fw-allow-nfs-tcp` | INGRESS | GCE subnet CIDRs | TCP 2049 | NFS service (tag: `nfsserver`) |
| `fw-allow-nfs-udp` | INGRESS | GCE subnet CIDRs | UDP 2049 | NFS service (tag: `nfsserver`) |
| `fw-allow-http-tcp` | INGRESS | All internal CIDRs | TCP 80, 443, 8080, 8443 | HTTP/HTTPS (tags: `httpserver`, `webserver`) |

When GKE is enabled with `gke_cluster_count > 1`, two additional Istio east-west firewall rules are created (ports 15012, 15017, 15443).

> **On destroy:** A `local-exec` provisioner on the VPC runs `gcloud` commands to delete all orphan GKE firewall rules and Network Endpoint Groups (NEGs) that GKE controllers create outside Terraform state, unblocking VPC deletion.

### Artifact Registry (`registry.tf`)

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_artifact_registry_repository` | `shared-repo-{random_id}` | Shared Docker repository for all application images |

Vulnerability scanning uses `INHERITED` when `enable_vulnerability_scanning = true`, `DISABLED` otherwise. CMEK encryption applied when `enable_cmek = true`.

### Service Accounts (`sa.tf`)

Four service accounts are always created:

| Account ID | Display Name | Key Roles |
|------------|-------------|-----------|
| `cloudbuild-sa-{id}` | Cloud Build Service Account | `cloudbuild.builds.editor`, `run.admin`, `storage.admin`, `artifactregistry.writer`, `cloudkms.admin`, `containeranalysis.admin`, `clouddeploy.operator`, `iam.serviceAccountTokenCreator` (17 total) |
| `clouddeploy-sa-{id}` | Cloud Deploy Service Account | `clouddeploy.jobRunner`, `run.admin`, `container.admin`, `artifactregistry.reader` (8 total) |
| `cloudrun-sa-{id}` | Cloud Run Service Account | `run.admin`, `secretmanager.secretAccessor`, `storage.objectAdmin`, `cloudsql.client`, `vpcaccess.user` (7 total) |
| `app-nfs-sa-{id}` | NFS Server Service Account | `storage.admin`, `logging.logWriter`, `compute.instanceAdmin.v1` |

The default Cloud Build service agent (`<project_number>@cloudbuild.gserviceaccount.com`) also receives binary auth, KMS, and container admin roles.

Cloud Build SA is granted `iam.serviceAccountUser` on Cloud Deploy SA (impersonation for pipeline deployments).

Additionally, a `google_project_service_identity` is created for both `run.googleapis.com` (Cloud Run agent) and `servicenetworking.googleapis.com`, each receiving required VPC/networking roles after a 30-second propagation wait.

### Root Password

A shared 16-character password (`special = true`, `override_special = "_%@"`) is generated as the root/admin password for all Cloud SQL instances provisioned by this module.

---

## Optional Resources

### Self-Managed NFS + Redis VM (`nfs.tf`)

**Enabled by:** `create_network_filesystem = true` (default)

The lower-cost alternative to managed Filestore and Memorystore. A single Compute Engine VM serves both NFS (port 2049) and Redis (port 6379).

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_compute_address` (static) | `app-nfs-ip-{id}` | Static internal IP reserved in the GCE subnet |
| `google_compute_instance_template` | `app-nfs-tpl-{id}-*` | VM template: Ubuntu 22.04, e2-small default |
| `google_compute_instance_group_manager` | `app-nfs-mig-{id}` | Managed Instance Group, target_size=1 |
| `google_compute_health_check` (NFS) | `app-nfs-hc-{id}` | TCP 2049, 30s interval, 10s timeout |
| `google_compute_health_check` (Redis) | `app-redis-hc-{id}` | TCP 6379, 30s interval, 10s timeout |
| `google_compute_resource_policy` | `app-nfs-snapshot-{id}` | Daily snapshots at 00:00, 7-day retention |
| `google_compute_firewall` (Redis) | `app-allow-redis-{id}` | TCP 6379 from RFC 1918 to `redisserver` tag |
| `google_compute_firewall` (NFS) | `app-allow-nfs-{id}` | TCP 111 + 2049 from RFC 1918 to `nfsserver` tag |

**VM disk layout:**
- Boot disk: `pd-standard`, 10 GB, Ubuntu 22.04 LTS
- Data disk: `pd-ssd`, `network_filesystem_capacity` GB (default 10 GB), `auto_delete = false`, daily snapshot policy attached

The data disk survives instance replacement (MIG update policy = RECREATE) due to `stateful_disk { delete_rule = "ON_PERMANENT_INSTANCE_DELETION" }`.

Startup script (`scripts/create_nfs.sh`) configures NFS exports and Redis on first boot.

**Outputs when enabled:** `nfs_server_ip`, `redis_on_nfs_server_ip`, `redis_on_nfs_connection_string` (all point to the same static IP).

### PostgreSQL Cloud SQL (`pgsql.tf`)

**Enabled by:** `create_postgres = true` (default)

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_sql_database_instance` | `cloud-sql-postgres-{id}` | Primary PostgreSQL instance |
| `google_sql_database_instance` (replica) | `cloud-sql-postgres-replica-{id}` | Optional read replica(s) |
| `google_secret_manager_secret` | `cloud-sql-postgres-{id}-root-password` | Stores root password |
| `google_secret_manager_secret` (replica) | `cloud-sql-postgres-replica-{id}-host` | Stores replica private IP |

**Default configuration:**
- Version: `POSTGRES_16`, tier: `db-custom-1-3840`, availability: `ZONAL`
- Edition: `ENTERPRISE`
- Private IP only (`ipv4_enabled = false`), SSL mode: `ENCRYPTED_ONLY`
- Disk: 10 GB PD_SSD, autoresize enabled
- Backups: daily at 04:00, 7 retained, PITR enabled, 7-day transaction log retention
- Default flag: `max_connections = 200`

Read replicas are deployed in the secondary region (`availability_regions[1]`) if configured, otherwise in the primary region. Replicas do not inherit `backup_configuration` and use `ZONAL` availability.

A `null_resource` with a 60-second `sleep` ensures Private Service Connect peering is fully established before SQL instance creation begins.

### MySQL Cloud SQL (`mysql.tf`)

**Enabled by:** `create_mysql = false` (disabled by default)

Identical structure to PostgreSQL with these differences:
- Version: `MYSQL_8_0`, same tier/availability defaults
- Binary log enabled (required for PITR on MySQL)
- Default flags: `max_connections = 200`, `local_infile = off`
- No read replica secret for replica host (replicas inherit via MySQL replication protocol)

### Managed Filestore NFS (`filestore.tf`)

**Enabled by:** `create_filestore_nfs = false` (disabled by default)

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_filestore_instance` | `filestore-{id}` | Managed NFS share |

- File share name: `share`, access mode: `READ_WRITE`, squash: `NO_ROOT_SQUASH`
- ENTERPRISE/REGIONAL tiers deploy at region level; BASIC tiers deploy at zone level
- Default: `BASIC_HDD`, 1024 GB

**Outputs when enabled:** `filestore_ip`, `filestore_name`, `filestore_file_share_name`.

### Cloud Memorystore Redis (`redis.tf`)

**Enabled by:** `create_redis = false` (disabled by default)

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_redis_instance` | `redis-cache-{id}` | Managed Redis instance |
| `google_secret_manager_secret` | `redis-host-{id}` | Stores Redis host IP |
| `google_secret_manager_secret` | `redis-port-{id}` | Stores Redis port |
| `google_secret_manager_secret` | `redis-auth-{id}` | Stores Redis auth string |

- Auth enabled (`auth_enabled = true`)
- Maintenance window: Sunday 02:00 UTC
- Default: `BASIC` tier, 1 GB, `REDIS_7_2`, `DIRECT_PEERING`

**Outputs when enabled:** `redis_host`, `redis_port`, `redis_connection_string`.

### GKE Autopilot (`gke.tf`)

**Enabled by:** `create_google_kubernetes_engine = false` (disabled by default)

Creates 1–10 GKE Autopilot clusters. CIDR ranges for nodes, pods, and services are auto-derived from base CIDRs by incrementing the third octet per cluster index.

| Resource | Name Pattern | Description |
|----------|-------------|-------------|
| `google_compute_subnetwork` | `{network_name}-gke-subnet-{n}-{region}` | Dedicated subnet per cluster with secondary pod/service ranges |
| `google_container_cluster` | `{gke_cluster_name_prefix}-{n}` | GKE Autopilot cluster |
| `google_service_account` | `gke-sa-*` | GKE node service account |
| Fleet/mesh/config-sync | — | Optional; enabled by `configure_*` flags |

Multi-cluster mode is automatically detected when `gke_cluster_count > 1`. Cluster 1 is the Multi-Cluster Ingress config cluster.

Optional add-ons (all require `create_google_kubernetes_engine = true`):
- `configure_cloud_service_mesh` — Enables Cloud Service Mesh (Istio/ASM) via Fleet
- `configure_config_management` — Enables Config Sync for GitOps
- `configure_policy_controller` — Enables Policy Controller (OPA Gatekeeper)
- `enable_gke_backup` — Scheduled GKE Backup (default daily at 03:00 UTC, 30-day retention)

**Outputs:** `gke_cluster_name`, `gke_cluster_endpoint` (sensitive), `gke_cluster_ca_certificate` (sensitive), `gke_cluster_location`, `gke_service_account_email`, `gke_clusters` (map, sensitive), `gke_cluster_mode`, `gke_mci_config_cluster`, `gke_fleet_membership_ids`.

---

## Security Features

### Customer-Managed Encryption Keys — CMEK (`cmek.tf`)

**Enabled by:** `enable_cmek = false` (disabled by default)

Creates a KMS key ring (`{project_id}-cmek-{id}`) and separate crypto keys for:
- Cloud SQL (PostgreSQL and MySQL)
- Artifact Registry
- Cloud Storage

Key ring creation uses a `null_resource` + `gcloud kms keyrings create … || true` pattern because KMS key rings are immutable in GCP and cannot be deleted — re-applies would fail with a 409 if Terraform tried to recreate them.

Key rotation period defaults to 90 days (`7776000s`), configurable via `cmek_key_rotation_period`.

**Output:** `storage_kms_key_name` — KMS key resource name for Cloud Storage.

### Binary Authorization (`binauthz.tf`)

**Enabled by:** `enable_binary_authorization = false` (disabled by default)

Enforces cryptographic image attestation before deployment to Cloud Run or GKE.

| Resource | Description |
|----------|-------------|
| KMS key ring + ASYMMETRIC_SIGN key | Signs attestations (`binauthz` key ring, separate from CMEK) |
| `google_container_analysis_note` | Attestation note anchor |
| `google_binary_authorization_attestor` | Named attestor referencing the note and KMS key |
| `google_binary_authorization_policy` | Project-wide enforcement policy |

Evaluation modes: `ALWAYS_ALLOW` (default, effectively disabled), `REQUIRE_ATTESTATION`, `ALWAYS_DENY`.

**Outputs:** `binauthz_attestor_name`, `binauthz_kms_key_id`, `binauthz_note_id`.

### VPC Service Controls (`vpc_sc.tf`)

**Enabled by:** `enable_vpc_sc = false` (disabled by default)

Creates a VPC Service Controls perimeter around the project, restricting Google Cloud API access to requests from allowed IP ranges and VPC networks. Prevents data exfiltration.

- `vpc_sc_dry_run = true` (default) — violations logged but not enforced
- `vpc_cidr_ranges` — VPC ranges allowed through the perimeter
- `admin_ip_ranges` — Admin/VPN IP ranges allowed through the perimeter

### Security Command Center (`scc.tf`)

**Enabled by:** `enable_security_command_center = false` (disabled by default)

Activates SCC for the project. When `enable_scc_notifications = true`, creates a Pub/Sub topic and SCC notification config to route findings downstream.

### Audit Logging (`audit.tf`)

**Enabled by:** `enable_audit_logging = false` (disabled by default)

Enables `DATA_READ` and `DATA_WRITE` data access audit logs for all services in the project via `google_project_iam_audit_config`.

### Monitoring Alerts (`monitoring.tf`)

**Enabled by:** `configure_email_notification = false` (disabled by default)

Creates Cloud Monitoring alert policies with email notification channel:
- CPU utilisation > `alert_cpu_threshold`% (default 80%)
- Memory utilisation > `alert_memory_threshold`% (default 80%)
- Disk utilisation > `alert_disk_threshold`% (default 80%)

---

## Input Variables Summary

### Section 0: Module Configuration (Platform metadata, no resource effect)

| Variable | Default | Description |
|----------|---------|-------------|
| `enable_services` | `true` | Enable 46 GCP APIs |
| `enable_purge` | `true` | Allow full resource deletion on destroy |
| `resource_creator_identity` | `rad-module-creator@…` | Terraform service account |
| `credit_cost` | `100` | Platform credit cost (metadata) |

### Section 1: Project

| Variable | Default | Description |
|----------|---------|-------------|
| `project_id` | — | GCP project ID (required) |
| `support_users` | `[]` | IAM + budget alert email list |
| `resource_labels` | `{}` | Labels on all resources |

### Section 2: Networking

| Variable | Default | Description |
|----------|---------|-------------|
| `network_name` | `"vpc-network"` | VPC name |
| `availability_regions` | `["us-central1"]` | Regions; first is primary |
| `subnet_cidr_range` | `["10.0.0.0/24"]` | One CIDR per region (1–2 supported) |

### Section 3: Databases

| Variable | Default | Description |
|----------|---------|-------------|
| `create_postgres` | `true` | Provision PostgreSQL Cloud SQL |
| `postgres_database_version` | `POSTGRES_16` | Engine version |
| `postgres_database_availability_type` | `ZONAL` | `ZONAL` or `REGIONAL` |
| `postgres_tier` | `db-custom-1-3840` | Machine type |
| `postgres_database_flags` | `[{max_connections=200}]` | DB flags |
| `create_postgres_read_replica` | `false` | Enable read replicas |
| `postgres_read_replica_count` | `1` | Number of replicas |
| `create_mysql` | `false` | Provision MySQL Cloud SQL |
| `mysql_database_version` | `MYSQL_8_0` | Engine version |
| `mysql_database_availability_type` | `ZONAL` | `ZONAL` or `REGIONAL` |
| `mysql_tier` | `db-custom-1-3840` | Machine type |
| `mysql_database_flags` | `[max_connections=200, local_infile=off]` | DB flags |
| `create_mysql_read_replica` | `false` | Enable read replicas |
| `mysql_read_replica_count` | `1` | Number of replicas |

### Section 4: Self-Managed NFS + Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `create_network_filesystem` | `true` | Deploy NFS+Redis VM |
| `network_filesystem_machine` | `e2-small` | Compute Engine machine type |
| `network_filesystem_capacity` | `10` | Data disk size in GB |

### Section 5: Managed Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `create_redis` | `false` | Deploy Cloud Memorystore |
| `redis_tier` | `BASIC` | `BASIC` or `STANDARD_HA` |
| `redis_memory_size_gb` | `1` | Memory (1–300 GB) |
| `redis_version` | `REDIS_7_2` | Redis version |
| `redis_connect_mode` | `DIRECT_PEERING` | `DIRECT_PEERING` or `PRIVATE_SERVICE_ACCESS` |

### Section 6: Managed Filestore

| Variable | Default | Description |
|----------|---------|-------------|
| `create_filestore_nfs` | `false` | Deploy Cloud Filestore |
| `filestore_tier` | `BASIC_HDD` | `BASIC_HDD`, `BASIC_SSD`, or `ENTERPRISE` |
| `filestore_capacity_gb` | `1024` | Storage capacity (min 1024 for HDD/ENTERPRISE, 2560 for SSD) |

### Section 7: GKE Autopilot

| Variable | Default | Description |
|----------|---------|-------------|
| `create_google_kubernetes_engine` | `false` | Deploy GKE Autopilot |
| `gke_cluster_name_prefix` | `gke-cluster` | Cluster name prefix |
| `gke_cluster_count` | `1` | Number of clusters (1–10) |
| `gke_subnet_base_cidr` | `10.128.0.0/12` | Base CIDR for node subnets |
| `gke_pod_base_cidr` | `10.64.0.0/10` | Base CIDR for pod ranges |
| `gke_service_base_cidr` | `10.8.0.0/16` | Base CIDR for service ranges |
| `configure_cloud_service_mesh` | `false` | Enable Cloud Service Mesh |
| `configure_config_management` | `false` | Enable Config Sync |
| `configure_policy_controller` | `false` | Enable Policy Controller |

### Section 8: GKE Backup

| Variable | Default | Description |
|----------|---------|-------------|
| `enable_gke_backup` | `false` | Enable GKE Backup for Autopilot |
| `gke_backup_retention_days` | `30` | Backup retention (1–365 days) |
| `gke_backup_schedule` | `0 3 * * *` | Cron schedule (UTC) |

### Section 9–16: Security & Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `enable_vpc_sc` | `false` | VPC Service Controls perimeter |
| `vpc_sc_dry_run` | `true` | Audit mode (not enforced) |
| `vpc_cidr_ranges` | `[]` | Allowed VPC CIDRs for perimeter |
| `admin_ip_ranges` | `[]` | Allowed admin IP CIDRs for perimeter |
| `enable_binary_authorization` | `false` | Binary Authorization |
| `binauthz_evaluation_mode` | `ALWAYS_ALLOW` | `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY` |
| `enable_cmek` | `false` | Customer-Managed Encryption Keys |
| `cmek_key_rotation_period` | `7776000s` | KMS key rotation (90 days default) |
| `enable_vulnerability_scanning` | `false` | Container Analysis scan-on-push |
| `enable_audit_logging` | `false` | Data access audit logs |
| `enable_security_command_center` | `false` | Security Command Center |
| `enable_scc_notifications` | `false` | SCC → Pub/Sub routing |
| `configure_email_notification` | `false` | Cloud Monitoring email alerts |
| `notification_alert_emails` | `[]` | Alert recipient emails |
| `alert_cpu_threshold` | `80` | CPU alert % |
| `alert_memory_threshold` | `80` | Memory alert % |
| `alert_disk_threshold` | `80` | Disk alert % |

---

## Outputs

### Always Available

| Output | Description |
|--------|-------------|
| `deployment_id` | Random hex ID used in all resource names |
| `primary_deployment_region` | First region from `availability_regions` |
| `host_project_id` | GCP project ID |
| `vpc_network_name` | VPC network name |
| `vpc_network_id` | VPC network resource ID |
| `cloudrun_service_account` | Email of the Cloud Run service account |
| `cloudbuild_service_account` | Email of the Cloud Build service account |
| `artifact_registry_repository_name` | Shared Docker repository name |
| `artifact_registry_repository_location` | Repository region |
| `artifact_registry_repository_project` | Repository project ID |

### Conditional Outputs

| Output | Condition | Description |
|--------|-----------|-------------|
| `nfs_server_ip` | `create_network_filesystem` | Static internal IP of NFS+Redis VM |
| `redis_on_nfs_server_ip` | `create_network_filesystem` | Same as `nfs_server_ip` |
| `redis_on_nfs_connection_string` | `create_network_filesystem` | `redis://{ip}:6379` |
| `postgres_instance_ip` | `create_postgres` | Private IP of PostgreSQL instance |
| `postgres_instance_connection_name` | `create_postgres` | Connection name for Cloud SQL Auth Proxy |
| `mysql_instance_ip` | `create_mysql` | Private IP of MySQL instance |
| `mysql_instance_connection_name` | `create_mysql` | Connection name for Cloud SQL Auth Proxy |
| `redis_host` | `create_redis` | Memorystore Redis host IP |
| `redis_port` | `create_redis` | Memorystore Redis port |
| `redis_connection_string` | `create_redis` | `{host}:{port}` |
| `filestore_ip` | `create_filestore_nfs` | Filestore NFS server IP |
| `filestore_name` | `create_filestore_nfs` | Filestore instance name |
| `filestore_file_share_name` | `create_filestore_nfs` | Share name (`"share"`) |
| `gke_cluster_name` | `create_google_kubernetes_engine` | Primary cluster name |
| `gke_cluster_endpoint` | `create_google_kubernetes_engine` | Primary cluster API endpoint (sensitive) |
| `gke_cluster_ca_certificate` | `create_google_kubernetes_engine` | Primary cluster CA cert (sensitive) |
| `gke_cluster_location` | `create_google_kubernetes_engine` | Primary cluster region |
| `gke_service_account_email` | `create_google_kubernetes_engine` | GKE node service account |
| `gke_cluster_mode` | `create_google_kubernetes_engine` | `"single"` or `"multi"` |
| `gke_clusters` | `create_google_kubernetes_engine` | Map of all cluster details (sensitive) |
| `gke_mci_config_cluster` | Multi-cluster GKE | Config cluster name for MCI |
| `gke_fleet_membership_ids` | GKE + Fleet | Fleet membership IDs |
| `storage_kms_key_name` | `enable_cmek` | KMS key for Cloud Storage |
| `binauthz_attestor_name` | `enable_binary_authorization` | Binary Authorization attestor |
| `binauthz_kms_key_id` | `enable_binary_authorization` | KMS key ID for attestation signing |
| `binauthz_note_id` | `enable_binary_authorization` | Container Analysis note ID |

---

## Timing & Dependencies

The module uses several `time_sleep` resources to handle GCP API propagation delays:

| Sleep | Duration | Purpose |
|-------|----------|---------|
| `wait_for_apis` | 360s | After API enablement — all resource creation blocked until complete |
| `wait_for_servicenetworking_sa` | 30s | After Service Networking service identity creation |
| `wait_for_servicenetworking_iam` | 60s | After Service Networking IAM grants — Cloud SQL depends on this |
| `wait_for_cloudrun_sa` | 30s | After Cloud Run service identity creation |
| `wait_for_pgsql_secret` | 10s | After PostgreSQL root password secret version |
| `wait_30_seconds` (NFS) | 30s | After NFS MIG creation |
| `null_resource.wait_for_dependencies` | 60s (sleep) | Before SQL instance creation — ensures PSC peering is ready |

The `null_resource.wait_for_dependencies` (60s sleep) runs after Private Service Connect peering and NFS MIG creation, ensuring both are fully established before Cloud SQL instance provisioning begins.

---

## Usage Example

```hcl
module "services_gcp" {
  source = "./modules/Services_GCP"

  project_id           = "my-project-id"
  availability_regions = ["us-central1"]
  subnet_cidr_range    = ["10.0.0.0/24"]
  network_name         = "vpc-network"

  # Databases
  create_postgres               = true
  postgres_database_version     = "POSTGRES_16"
  postgres_database_availability_type = "ZONAL"

  create_mysql = true   # required for Ghost, WordPress, OpenEMR

  # NFS + Redis (self-managed, cost-effective)
  create_network_filesystem   = true
  network_filesystem_machine  = "e2-medium"
  network_filesystem_capacity = 50

  resource_labels = {
    environment = "production"
    team        = "platform"
  }
}

# Pass outputs to application platform modules
module "app_cloudrun" {
  source = "./modules/App_CloudRun"

  project_id              = module.services_gcp.host_project_id
  deployment_region       = module.services_gcp.primary_deployment_region
  vpc_network_name        = module.services_gcp.vpc_network_name
  service_account_email   = module.services_gcp.cloudrun_service_account
  cloudbuild_sa_email     = module.services_gcp.cloudbuild_service_account
  nfs_server_ip           = module.services_gcp.nfs_server_ip
  db_instance_connection_name = module.services_gcp.postgres_instance_connection_name

  config          = module.my_app_common.config
  storage_buckets = module.my_app_common.storage_buckets
}
```

### NFS vs Filestore Decision Guide

| Requirement | Recommendation |
|-------------|---------------|
| Development / cost-sensitive | `create_network_filesystem = true` (default) |
| Production / SLA required | `create_filestore_nfs = true` + `create_network_filesystem = false` |
| Redis only (no NFS) | `create_redis = true` + `create_network_filesystem = false` |
| High-availability Redis | `create_redis = true`, `redis_tier = "STANDARD_HA"` |
| Both NFS and managed Redis | `create_filestore_nfs = true` + `create_redis = true` |

> **Note:** `create_network_filesystem` and `create_filestore_nfs` are independent flags. Both can be enabled simultaneously, but typically only one is used for NFS.



