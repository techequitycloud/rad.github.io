---
title: "GCP Services Configuration Guide"
sidebar_label: "GCP Services"
---

# GCP Services Module

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/GCP_Services.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/GCP_Services.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/GCP_Services.pdf" target="_blank">View Presentation (PDF)</a>

This guide describes every configuration variable available in the `GCP Services` module, organized into functional groups. For each variable it explains the available options, the implications of each choice, and how to validate the resulting configuration in the Google Cloud Console or using the `gcloud` CLI.

---

## Group 1: Project & Identity

These variables establish the GCP project context and the shared identity settings that apply across all resources created by the module. They must be configured correctly before any deployment can succeed. `project_id` is the only strictly required variable in the module — every resource provisioned by `GCP Services` is scoped to this project. `support_users` and `resource_labels` are optional but strongly recommended for production deployments to ensure operational visibility and consistent resource tagging.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `project_id` | *(required)* | `[a-z][a-z0-9-]{4,28}[a-z0-9]` | The GCP project ID into which all module resources are deployed. Select an existing project on the RAD platform or enter the ID of an external GCP project. When deploying into an external project, you must grant the Owner role to the RAD GCP Project agent service account (`rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com`). **All resource names, IAM bindings, and API calls are scoped to this project.** Changing this after initial deployment will cause all resources to be recreated in the new project. |
| `support_users` | `[]` | List of email addresses | Email addresses of users granted IAM access to the project and added as recipients for budget alerts and Cloud Monitoring notifications. These addresses are added to a notification channel in Cloud Monitoring so they receive alerts for CPU, memory, and disk threshold policies. Leave empty to suppress all alert emails. (e.g., `['admin@example.com', 'ops@example.com']`) |
| `resource_labels` | `{}` | Map of `key = "value"` pairs | Key-value labels applied to every GCP resource created by this module (VPC network, Cloud SQL instances, Redis, Filestore, GKE clusters, Compute Engine VMs, etc.). Use labels to enforce organisational tagging policies — for example cost centre, environment, team ownership, or compliance classification. Labels are visible in Billing reports and can be used to filter resources in the Console. GCP label keys and values must be lowercase, 1–63 characters, and may contain letters, numbers, hyphens, and underscores. (e.g., `{ environment = "prod", team = "platform" }`) |

### Validating Group 1 Settings

**Google Cloud Console:**
- **Project confirmation:** The project name and ID are shown in the top navigation bar. Navigate to **Home → Dashboard** to confirm you are in the correct project.
- **Support user IAM roles:** Navigate to **IAM & Admin → IAM** and verify that the support user email addresses have appropriate roles assigned.
- **Labels:** Navigate to any GCP resource created by this module (e.g. **VPC network → VPC networks → *your network***) and select the **Labels** tab to verify labels are applied correctly.
- **Alert notification channels:** Navigate to **Monitoring → Alerting → Notification channels** to confirm support user email addresses are registered.

**gcloud CLI:**
```bash
# Confirm the project exists and is active
gcloud projects describe PROJECT_ID

# View the project's IAM policy bindings
gcloud projects get-iam-policy PROJECT_ID \
  --format="table(bindings.role,bindings.members)"

# List Cloud Monitoring notification channels (alert recipients)
gcloud beta monitoring channels list --project=PROJECT_ID \
  --format="table(displayName,type,labels.email_address)"
```

---

## Group 2: Networking & VPC

These variables control the foundational networking infrastructure — the VPC network, subnets, and region selection — that underpins every other resource provisioned by this module. All services (Cloud SQL, Redis, Filestore, GKE, and the self-managed NFS VM) are attached to this VPC and communicate exclusively over private IP addresses. Getting the CIDR ranges right before first deployment is important: changing subnet ranges after resources are attached requires destroying and recreating the network, which is a disruptive operation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `network_name` | `'vpc-network'` | Any string | Name of the VPC network to create. This network is used as the base for all module resources including Cloud SQL private IP connectivity, Redis, Filestore, GKE node pools, and the self-managed NFS/Redis VM. Must be unique within the project. If a VPC with this name already exists in the project, Terraform will attempt to manage it and may conflict with existing configuration. Choose a name that reflects the environment or workload, e.g. `'app-network'`, `'platform-vpc'`. |
| `availability_regions` | `['us-central1']` | List of strings | List of GCP regions in which to provision regional resources such as subnets, Cloud SQL instances, and Redis. **The first region in the list is used as the primary region** for all single-region resources (Cloud SQL primary instance, Memorystore, Filestore, GKE clusters, and the NFS VM). Additional regions receive additional subnets. At least one region must be specified; between 1 and 2 regions are supported. Choose regions close to your end users or application workloads to minimise latency. (e.g., `['us-central1']`, `['us-central1', 'us-west1']`) |
| `subnet_cidr_range` | `['10.0.0.0/24']` | List of CIDR strings | List of CIDR ranges to assign to the VPC subnets, one per availability region. Must be valid RFC 1918 private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`) and **must not overlap** with each other, with GKE pod/service CIDRs (`gke_pod_base_cidr`, `gke_service_base_cidr`), or with any existing subnets in the project. Between 1 and 2 ranges are supported. A `/24` provides 256 addresses, which is sufficient for most deployments — use a larger range (e.g. `/20`) if you anticipate a high number of VM or GKE node IP allocations. (e.g., `['10.0.0.0/24']`, `['10.0.0.0/24', '10.0.1.0/24']`) |

### Validating Group 2 Settings

**Google Cloud Console:**
- **VPC network:** Navigate to **VPC network → VPC networks** and confirm the network named after `network_name` is listed.
- **Subnets:** Click the network name and select the **Subnets** tab to verify subnets have been created in the expected regions with the correct CIDR ranges.
- **Cloud NAT:** Navigate to **Network services → Cloud NAT** to confirm a NAT gateway has been provisioned, which allows private instances to reach the internet for updates and patching.

**gcloud CLI:**
```bash
# List all VPC networks in the project
gcloud compute networks list --project=PROJECT_ID

# List subnets for the module VPC and verify CIDR ranges and regions
gcloud compute networks subnets list \
  --network=NETWORK_NAME \
  --project=PROJECT_ID \
  --format="table(name,region,ipCidrRange)"

# Confirm Cloud NAT is configured on the network's Cloud Router
gcloud compute routers list --project=PROJECT_ID \
  --format="table(name,region,network)"
```

---

## Group 3: Database Configuration

These variables configure managed Cloud SQL instances for PostgreSQL and MySQL. Both engines are supported independently — you can provision PostgreSQL only, MySQL only, or both simultaneously if your workload requires it. All instances are configured with private IP addresses on the module VPC and have no public internet exposure. Automated daily backups (starting at 04:00 UTC) with 7-day retention and auto-resizing SSD storage are enabled by default on all instances.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `create_postgres` | `true` | `true` / `false` | Provisions a Cloud SQL PostgreSQL instance in the primary availability region. The instance is configured with a private IP address on the module VPC and is not publicly accessible. Set to `false` to skip PostgreSQL provisioning when only MySQL or no relational database is required. The root password is automatically generated and stored in Secret Manager. |
| `postgres_database_version` | `'POSTGRES_16'` | `POSTGRES_16` / `POSTGRES_15` / `POSTGRES_14` | PostgreSQL engine version to deploy on Cloud SQL. Use the most recent version for new deployments to benefit from the latest performance improvements and security patches. **Downgrading after deployment is not supported** — upgrading to a newer major version requires a database migration. (e.g., `'POSTGRES_16'`, `'POSTGRES_15'`, `'POSTGRES_14'`) |
| `postgres_database_availability_type` | `'ZONAL'` | `ZONAL` / `REGIONAL` | Availability configuration for the PostgreSQL Cloud SQL instance. **`ZONAL`**: a single-zone instance with no standby — lower cost, suitable for development and test environments, but subject to downtime during zone-level failures or planned maintenance. **`REGIONAL`**: provisions a high-availability instance with an automatic hot standby in a second zone within the same region; failover is automatic and typically completes within 60 seconds. Recommended for all production workloads. Switching from `ZONAL` to `REGIONAL` after initial deployment causes a brief instance restart. |
| `postgres_tier` | `'db-custom-1-3840'` | Any Cloud SQL machine type string | Machine type for the PostgreSQL Cloud SQL instance, determining the number of vCPUs and memory available. `db-custom-1-3840` provides 1 vCPU and 3.75 GB RAM — appropriate for most low-to-medium workloads. Increase for high-concurrency or memory-intensive applications. Use `db-f1-micro` or `db-g1-small` for minimal-cost development environments. (e.g., `'db-custom-1-3840'`, `'db-custom-2-7680'`, `'db-custom-4-15360'`) |
| `postgres_database_flags` | `[{ name = "max_connections", value = "200" }]` | List of `{ name, value }` objects | Database engine flags applied to the PostgreSQL Cloud SQL instance. Each entry is an object with a `name` (the PostgreSQL parameter name) and a `value` (the parameter value as a string). The default sets `max_connections` to `200`, which is appropriate for most workloads — increase if your application maintains a large number of concurrent database connections. Other common flags: `log_min_duration_statement` (log slow queries in ms, e.g. `"1000"`), `work_mem` (per-sort memory in KB, e.g. `"16384"`). **Changes to some flags require an instance restart**, which causes a brief outage — plan flag changes during a maintenance window for production instances. |
| `create_postgres_read_replica` | `false` | `true` / `false` | Provisions one or more read replicas for the PostgreSQL Cloud SQL instance. Read replicas serve read-only queries, offloading read-heavy workloads from the primary and improving overall throughput. A replica can also be promoted to become the new primary in a disaster recovery scenario. Requires `create_postgres = true`. Configure the number of replicas with `postgres_read_replica_count`. Note that each replica is billed at the same rate as a standalone instance of the same tier. |
| `postgres_read_replica_count` | `1` | Integer | Number of read replica instances to create for the PostgreSQL Cloud SQL instance. Each replica is provisioned in the same region as the primary and replicates data asynchronously. Only used when `create_postgres_read_replica` is `true`. Start with `1` for most workloads; increase only if a single replica cannot handle the read traffic volume. (e.g., `1`, `2`) |
| `create_mysql` | `false` | `true` / `false` | Provisions a Cloud SQL MySQL instance in the primary availability region. The instance is configured with a private IP address on the module VPC and is not publicly accessible. Set to `true` when deploying applications that require MySQL, such as WordPress, Moodle, or Odoo. The root password is automatically generated and stored in Secret Manager. |
| `mysql_database_version` | `'MYSQL_8_0'` | `MYSQL_8_0` / `MYSQL_5_7` | MySQL engine version to deploy on Cloud SQL. Use `MYSQL_8_0` for all new deployments — it includes significant performance, security, and feature improvements over 5.7. Use `MYSQL_5_7` only when migrating an existing application that has a hard dependency on MySQL 5.7 behaviour. **Downgrading after deployment is not supported.** |
| `mysql_database_availability_type` | `'ZONAL'` | `ZONAL` / `REGIONAL` | Availability configuration for the MySQL Cloud SQL instance. **`ZONAL`**: a single-zone instance — lower cost, suitable for development and test environments, but subject to downtime during zone failures or maintenance. **`REGIONAL`**: provisions a high-availability instance with an automatic hot standby in a second zone; failover is automatic and typically completes within 60 seconds. Recommended for all production workloads. |
| `mysql_tier` | `'db-custom-1-3840'` | Any Cloud SQL machine type string | Machine type for the MySQL Cloud SQL instance, determining vCPUs and memory. `db-custom-1-3840` provides 1 vCPU and 3.75 GB RAM — appropriate for most low-to-medium workloads. Increase for high-concurrency or memory-intensive applications. (e.g., `'db-custom-1-3840'`, `'db-custom-2-7680'`, `'db-custom-4-15360'`) |
| `mysql_database_flags` | `[{ name = "max_connections", value = "200" }, { name = "local_infile", value = "off" }]` | List of `{ name, value }` objects | Database engine flags applied to the MySQL Cloud SQL instance. Each entry is an object with a `name` (the MySQL system variable name) and a `value` (the variable value as a string). The defaults set `max_connections` to `200` and disable `local_infile` — a security best practice that prevents the `LOAD DATA LOCAL INFILE` command from loading files from the client filesystem into the database. Other common flags: `slow_query_log` (`"on"` to enable slow query logging), `long_query_time` (threshold in seconds, e.g. `"2"`). **Changes to some flags require an instance restart** — plan flag changes during a maintenance window for production instances. |
| `create_mysql_read_replica` | `false` | `true` / `false` | Provisions one or more read replicas for the MySQL Cloud SQL instance. Read replicas serve read-only queries, offloading read-heavy workloads from the primary. A replica can be promoted to primary in a disaster recovery scenario. Requires `create_mysql = true`. Configure the number of replicas with `mysql_read_replica_count`. |
| `mysql_read_replica_count` | `1` | Integer | Number of read replica instances to create for the MySQL Cloud SQL instance. Each replica is provisioned in the same region as the primary and replicates data asynchronously. Only used when `create_mysql_read_replica` is `true`. (e.g., `1`, `2`) |

### Validating Group 3 Settings

**Google Cloud Console:**
- **Instances:** Navigate to **SQL** to view all provisioned Cloud SQL instances. Confirm the engine version, tier, region, and availability type for each instance.
- **Private IP:** Click an instance and select the **Connections** tab. Confirm that **Private IP** is enabled and **Public IP** is disabled.
- **Backups:** Select the **Backups** tab to confirm automated backups are enabled and view recent backup history.
- **Flags:** Select the **Flags** tab to view the currently applied database flags and their values.
- **Read replicas:** If provisioned, read replicas are listed under the primary instance on the **SQL** overview page.

**gcloud CLI:**
```bash
# List all Cloud SQL instances and verify version, tier, and region
gcloud sql instances list --project=PROJECT_ID \
  --format="table(name,databaseVersion,settings.tier,region,state)"

# Describe a specific instance to view availability type and IP config
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(settings.availabilityType,ipAddresses,settings.databaseFlags)"

# List read replicas for a primary instance
gcloud sql instances list --project=PROJECT_ID \
  --filter="masterInstanceName=INSTANCE_NAME" \
  --format="table(name,databaseVersion,region,state)"
```

---

## Group 4: Network Filesystem

These variables configure a self-managed, combined NFS file server and Redis cache running on a single Compute Engine VM. This is the lower-cost alternative to the fully managed Cloud Filestore (Group 6) and Cloud Memorystore (Group 5). The VM runs on Ubuntu 22.04 LTS, uses a zonal SSD persistent disk for NFS storage, and runs Redis in-process on port 6379. It is deployed as a Managed Instance Group (MIG) of size 1 with an auto-healing policy — if the health check (TCP port 2049) fails, the MIG automatically recreates the VM. Daily snapshots of the data disk are taken automatically with a 7-day retention period. This option is recommended for development environments or cost-sensitive deployments where managed-service SLAs are not required.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `create_network_filesystem` | `true` | `true` / `false` | Provisions a Compute Engine VM configured as a combined NFS file server and Redis cache server. The VM is managed by a Managed Instance Group with auto-healing, so it is automatically recreated if it becomes unhealthy. Set to `false` when using the managed alternatives — Cloud Filestore (`create_filestore_nfs = true`) for NFS storage and Cloud Memorystore (`create_redis = true`) for caching — or when the workload does not require shared file storage or Redis. **Running both this VM and the managed services simultaneously is not recommended**, as it creates redundant infrastructure and unnecessary cost. |
| `network_filesystem_machine` | `'e2-small'` | Any Compute Engine machine type | Compute Engine machine type for the self-managed NFS and Redis VM. The `e2-small` default (2 vCPUs shared, 2 GB RAM) is sufficient for light NFS workloads and small Redis datasets. **Increase the machine type** if your Redis dataset approaches the available memory, or if NFS throughput is a bottleneck for your application. (e.g., `'e2-small'`, `'e2-medium'` (1 vCPU, 4 GB), `'n2-standard-2'` (2 vCPU, 8 GB)) |
| `network_filesystem_capacity` | `10` | Integer (GB) | Size in GB of the SSD persistent disk attached to the NFS server VM. This disk stores all NFS-mounted application data. The disk is snapshotted daily with a 7-day retention policy. **Disk capacity can be increased after provisioning but not decreased** — size it generously for the expected data volume. Note that the Redis in-process instance is limited to available VM memory, not this disk. (e.g., `10`, `50`, `100`) |

### Validating Group 4 Settings

**Google Cloud Console:**
- **VM instance:** Navigate to **Compute Engine → VM instances** and confirm the NFS/Redis VM is listed and in a `Running` state.
- **Managed Instance Group:** Navigate to **Compute Engine → Instance groups** to confirm the MIG exists and shows `1/1` instances healthy.
- **Persistent disk:** Navigate to **Compute Engine → Disks** to confirm the data disk is attached to the VM with the expected capacity.
- **Disk snapshots:** Navigate to **Compute Engine → Snapshots** to confirm daily snapshots of the data disk are being created.

**gcloud CLI:**
```bash
# List Compute Engine instances and confirm the NFS VM is running
gcloud compute instances list --project=PROJECT_ID \
  --format="table(name,zone,machineType,status)"

# List Managed Instance Groups and confirm the MIG is healthy
gcloud compute instance-groups managed list --project=PROJECT_ID \
  --format="table(name,zone,targetSize,status.isStable)"

# List persistent disks and confirm the data disk size
gcloud compute disks list --project=PROJECT_ID \
  --format="table(name,zone,sizeGb,type,status)"
```

---

## Group 5: Redis Cache

These variables configure Cloud Memorystore for Redis — the fully managed alternative to the self-managed Redis process running on the Group 4 NFS VM. Memorystore provides Google SLA-backed availability, automated patching, and built-in monitoring, at a higher cost than the self-managed option. The instance is provisioned in the primary availability region with a private IP address on the module VPC, accessible only from within the VPC. **Only enable this group when `create_network_filesystem` is `false`** — running both simultaneously creates redundant Redis infrastructure.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `create_redis` | `false` | `true` / `false` | Provisions a Cloud Memorystore for Redis instance in the primary availability region with a private IP address on the module VPC. Use as the managed alternative to the self-managed Redis VM in Group 4 when you require an SLA-backed service, automated patching, and built-in failover. Set to `true` for production caching and session storage workloads where availability and operational simplicity outweigh the additional cost. |
| `redis_tier` | `'BASIC'` | `BASIC` / `STANDARD_HA` | Service tier for the Cloud Memorystore Redis instance. **`BASIC`**: a single-node instance with no replication. If the node fails, data is lost and the instance is unavailable until it recovers. Suitable for non-critical caching workloads where cache misses are acceptable. **`STANDARD_HA`**: a high-availability instance with an automatic replica in a second zone within the same region; failover is automatic and typically completes within a few seconds. Recommended for session storage, rate-limiting counters, or any use case where Redis unavailability would directly affect users. Note that `STANDARD_HA` approximately doubles the cost of the instance. |
| `redis_memory_size_gb` | `1` | Integer `1`–`300` | Memory capacity in GB allocated to the Cloud Memorystore Redis instance. This is the total amount of memory available for storing keys, values, and Redis overhead. **Set this based on your expected dataset size plus headroom for growth** — when memory is exhausted Redis evicts keys according to the configured eviction policy, which can cause unexpected cache misses or data loss. Valid range: 1–300 GB. (e.g., `1` for small caches, `4` for moderate session stores, `16` for high-throughput caching workloads) |
| `redis_version` | `'REDIS_7_2'` | `REDIS_7_2` / `REDIS_7_0` / `REDIS_6_X` | Redis engine version to deploy on Cloud Memorystore. Use the most recent version for new deployments to benefit from the latest performance improvements, commands, and security fixes. Downgrading after deployment is not supported. (e.g., `'REDIS_7_2'`, `'REDIS_7_0'`, `'REDIS_6_X'`) |
| `redis_connect_mode` | `'DIRECT_PEERING'` | `DIRECT_PEERING` / `PRIVATE_SERVICE_ACCESS` | Network connectivity mode for the Cloud Memorystore Redis instance. **`DIRECT_PEERING`**: connects the Redis instance to the VPC via VPC peering — simpler to set up and suitable for most deployments where the VPC is not shared or subject to strict peering restrictions. **`PRIVATE_SERVICE_ACCESS`**: uses Private Service Connect to connect Redis to the VPC — required when the project uses Shared VPC, or when organisational policies restrict VPC peering. If unsure, use `DIRECT_PEERING`. This value cannot be changed after the instance is created without destroying and recreating it. |

### Validating Group 5 Settings

**Google Cloud Console:**
- **Instance:** Navigate to **Memorystore → Redis** to confirm the instance is listed and in a `Ready` state.
- **Tier and memory:** Click the instance name to view the service tier, memory size, Redis version, and connectivity mode.
- **Private IP:** On the instance details page, confirm the instance has a private IP address assigned and no public endpoint.
- **Maintenance window:** Check the **Maintenance** section to view the configured weekly maintenance window during which automated patches are applied.

**gcloud CLI:**
```bash
# List all Memorystore Redis instances in the primary region
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,tier,memorySizeGb,redisVersion,state)"

# Describe a specific instance to view IP address and connect mode
gcloud redis instances describe INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(host,port,tier,connectMode,redisVersion,memorySizeGb)"
```

---

## Group 6: Filestore NFS

These variables configure Cloud Filestore — the fully managed NFS alternative to the self-managed NFS server in Group 4. Filestore provides a dedicated, high-performance NFS file share that can be mounted simultaneously by multiple Compute Engine VMs or GKE pods, making it suitable for workloads that require shared persistent storage at scale. The instance is provisioned in the primary availability region with a private IP address on the module VPC. **Only enable this group when `create_network_filesystem` is `false`** — running both simultaneously creates redundant NFS infrastructure. Note that all Filestore tiers have a significant minimum capacity requirement, making this option considerably more expensive than the self-managed VM for small storage needs.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `create_filestore_nfs` | `false` | `true` / `false` | Provisions a Cloud Filestore NFS instance in the primary availability region. The instance exports a single NFS share that can be mounted by multiple clients simultaneously over the module VPC. Use as the managed alternative to the self-managed NFS VM in Group 4 when you require SLA-backed availability, higher and more consistent NFS throughput, or reduced operational overhead. Set to `true` for production workloads that depend on shared file storage, such as content management systems, media processing pipelines, or applications with shared upload directories. |
| `filestore_tier` | `'BASIC_HDD'` | `BASIC_HDD` / `BASIC_SSD` / `ENTERPRISE` | Service tier for the Cloud Filestore instance, determining performance characteristics, minimum capacity, and availability model. **`BASIC_HDD`**: cost-effective standard performance suitable for workloads with moderate throughput requirements; minimum capacity 1024 GB. **`BASIC_SSD`**: significantly higher IOPS and throughput for latency-sensitive or high-concurrency workloads; minimum capacity 2560 GB. **`ENTERPRISE`**: highest performance with regional (multi-zone) availability — the instance survives a full zone outage; minimum capacity 1024 GB. Use `ENTERPRISE` for production workloads where NFS availability is critical. Note that the tier **cannot be changed after provisioning** — migrating between tiers requires creating a new instance and copying data. |
| `filestore_capacity_gb` | `1024` | Integer (GB) | Storage capacity in GB for the Cloud Filestore instance. **Minimum capacity is enforced by the tier**: 1024 GB for `BASIC_HDD` and `ENTERPRISE`, 2560 GB for `BASIC_SSD`. **Capacity can be increased after provisioning but not decreased** — provision with enough headroom for expected data growth to avoid disruptive resize operations later. All capacity is billed continuously regardless of how much is actually used, so avoid over-provisioning on `BASIC_SSD` in particular. (e.g., `1024` for BASIC_HDD, `2560` for BASIC_SSD) |

### Validating Group 6 Settings

**Google Cloud Console:**
- **Instance:** Navigate to **Filestore → Instances** to confirm the instance is listed and in a `Ready` state.
- **Tier and capacity:** Click the instance name to view the service tier, allocated capacity, and NFS mount point path.
- **IP address:** On the instance details page, confirm the instance has a private IP address assigned within the module VPC.
- **File shares:** Confirm the exported NFS share name and path, which your application or GKE persistent volume will use to mount the share.

**gcloud CLI:**
```bash
# List all Filestore instances and confirm tier, capacity, and state
gcloud filestore instances list \
  --project=PROJECT_ID \
  --format="table(name,tier,fileShares[0].capacityGb,networks[0].ipAddresses[0],state)"

# Describe a specific instance to view the NFS mount point and share name
gcloud filestore instances describe INSTANCE_NAME \
  --zone=ZONE \
  --project=PROJECT_ID \
  --format="yaml(fileShares,networks,tier,state)"
```

---

## Group 7: Google Kubernetes Engine

These variables configure one or more GKE Autopilot clusters that serve as the shared compute environment for containerised application workloads deployed via the `App GKE` module. Autopilot is a fully managed cluster mode in which Google provisions, scales, and secures nodes automatically — you pay per pod rather than per node, and there is no need to manage node pools or machine types. All clusters are provisioned in the primary availability region of the module VPC and registered to a GKE fleet to enable multi-cluster features. Three optional GKE fleet add-ons — Cloud Service Mesh, Config Management, and Policy Controller — can be enabled independently on each cluster.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `create_google_kubernetes_engine` | `false` | `true` / `false` | Provisions one or more GKE Autopilot clusters in the primary availability region. Set to `true` when deploying containerised workloads via the `App GKE` module — the App GKE module will automatically discover and use clusters provisioned here. When `false`, no GKE infrastructure is created and all GKE-dependent variables in this group are ignored. Each cluster is registered to a GKE fleet automatically, enabling fleet-level features such as multi-cluster services and Config Management. |
| `gke_cluster_name_prefix` | `'gke-cluster'` | Lowercase string | Prefix applied to the name of each GKE Autopilot cluster. The zero-based cluster index is appended to generate unique names — for example, a prefix of `'gke-cluster'` with `gke_cluster_count = 2` produces `gke-cluster-0` and `gke-cluster-1`. Must be lowercase and contain only letters, numbers, and hyphens. **Do not change this after clusters are provisioned** — renaming requires destroying and recreating all clusters, which is a disruptive operation for running workloads. (e.g., `'gke-cluster'`, `'autopilot'`, `'platform'`) |
| `gke_cluster_count` | `1` | Integer `1`–`10` | Number of GKE Autopilot clusters to provision in the primary availability region. Each cluster is independent with its own node pool, networking, and workload namespace. Use `1` for most deployments. Increase for multi-tenant architectures where workloads must be isolated at the cluster level (e.g. separate clusters per environment or per customer tier), or to distribute load across multiple clusters using the `round-robin` selection mode in `App GKE`. Valid range: 1–10. |
| `gke_subnet_base_cidr` | `'10.128.0.0/12'` | CIDR notation | Base CIDR block used to generate the node subnet range for each GKE cluster. When multiple clusters are provisioned, subnets for additional clusters are automatically derived by incrementing the third octet of this base. **Must not overlap** with `subnet_cidr_range` (Group 2), `gke_pod_base_cidr`, or `gke_service_base_cidr`. The `/12` default provides a large address space suitable for multi-cluster deployments. (e.g., `'10.128.0.0/12'`) |
| `gke_pod_base_cidr` | `'10.64.0.0/10'` | CIDR notation | Base CIDR block used to generate pod IP ranges for each GKE cluster. In GKE Autopilot, each node receives a `/24` slice of this range (providing 256 pod IPs per node). The `/10` default accommodates a large number of nodes across multiple clusters. **Must not overlap** with `subnet_cidr_range`, `gke_subnet_base_cidr`, or `gke_service_base_cidr`. Size this range based on your expected maximum number of pods across all clusters. (e.g., `'10.64.0.0/10'`) |
| `gke_service_base_cidr` | `'10.8.0.0/16'` | CIDR notation | Base CIDR block used to generate Kubernetes Service (ClusterIP) IP ranges for each GKE cluster. Each Kubernetes Service is assigned an IP from this range. The `/16` default provides 65,536 service IPs, which is sufficient for all but the largest deployments. **Must not overlap** with `subnet_cidr_range`, `gke_subnet_base_cidr`, or `gke_pod_base_cidr`. (e.g., `'10.8.0.0/16'`) |
| `configure_cloud_service_mesh` | `false` | `true` / `false` | Enables Cloud Service Mesh (managed Istio) on the GKE Autopilot cluster via the GKE fleet. When enabled, the mesh provides automatic mutual TLS (mTLS) encryption between services, fine-grained traffic management (retries, timeouts, circuit breaking), and enhanced observability with service-level metrics and distributed tracing — all without requiring code changes to applications. Requires `create_google_kubernetes_engine = true`. Enabling this after initial cluster creation triggers a cluster update operation. |
| `configure_config_management` | `false` | `true` / `false` | Enables Config Sync on the GKE Autopilot cluster via the GKE fleet. Config Sync continuously reconciles cluster configuration against a Git repository, enabling GitOps workflows for Kubernetes resource management. Changes to cluster configuration are made by committing to the repository rather than running `kubectl apply` directly, providing a full audit trail and enabling rollbacks via git. Requires `create_google_kubernetes_engine = true`. |
| `configure_policy_controller` | `false` | `true` / `false` | Enables Policy Controller on the GKE Autopilot cluster via the GKE fleet. Policy Controller uses Open Policy Agent (OPA) Gatekeeper to enforce customisable security and compliance policies on all Kubernetes resources — for example, requiring resource limits on all containers, preventing privileged pods, or enforcing label standards. Policies are defined as `Constraint` and `ConstraintTemplate` custom resources. Requires `create_google_kubernetes_engine = true`. |

### Validating Group 7 Settings

**Google Cloud Console:**
- **Clusters:** Navigate to **Kubernetes Engine → Clusters** to confirm the expected number of clusters are listed and in a `Running` state.
- **Cluster details:** Click a cluster name to view its mode (Autopilot), region, Kubernetes version, and networking configuration (node, pod, and service CIDRs).
- **Fleet registration:** Navigate to **Kubernetes Engine → Fleets** to confirm each cluster is registered to the project fleet.
- **Cloud Service Mesh:** Navigate to **Kubernetes Engine → Features** to confirm Cloud Service Mesh status if `configure_cloud_service_mesh = true`.
- **Config Management:** Navigate to **Kubernetes Engine → Features → Config Management** to view sync status if `configure_config_management = true`.
- **Policy Controller:** Navigate to **Kubernetes Engine → Features → Policy Controller** to view constraint status if `configure_policy_controller = true`.

**gcloud CLI:**
```bash
# List all GKE clusters and confirm mode, region, and status
gcloud container clusters list --project=PROJECT_ID \
  --format="table(name,location,status,autopilot.enabled,currentMasterVersion)"

# Describe a cluster to view node, pod, and service CIDR ranges
gcloud container clusters describe CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(clusterIpv4Cidr,servicesIpv4Cidr,nodeConfig,network,subnetwork)"

# List fleet memberships to confirm cluster registration
gcloud container fleet memberships list --project=PROJECT_ID \
  --format="table(name,state.code,endpoint.gkeCluster.resourceLink)"
```

---

## Group 8: GKE Backup & Restore

These variables configure Backup for GKE, which creates scheduled, application-consistent backups of cluster workloads and persistent volume data to Cloud Storage. Backups capture both the Kubernetes resource state (Deployments, ConfigMaps, Secrets, Services, etc.) and the data held in PersistentVolumeClaims, allowing full workload restoration to the same cluster or to a different cluster in the event of accidental deletion, data corruption, or a disaster recovery scenario. Requires `create_google_kubernetes_engine = true`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_gke_backup` | `false` | `true` / `false` | Enables GKE Backup for Autopilot on the provisioned cluster(s). When enabled, a backup plan is created that runs on the schedule defined by `gke_backup_schedule` and retains snapshots for `gke_backup_retention_days` days. Backups are stored in a Google-managed Cloud Storage bucket and can be used to restore workloads to the same or a different GKE cluster. Requires `create_google_kubernetes_engine = true`. **Enable this for all production clusters** — GKE Backup is the recommended mechanism for protecting stateful workloads running on GKE Autopilot. |
| `gke_backup_retention_days` | `30` | Integer `1`–`365` | Number of days to retain GKE backup snapshots before they are automatically deleted. **Balance retention duration against Cloud Storage cost** — each backup stores a full snapshot of all cluster resources and PVC data, so longer retention periods accumulate significant storage. A 30-day retention is appropriate for most workloads. Increase to `90` or more for compliance-sensitive environments with longer recovery point objectives. Decrease to `7` for cost-sensitive non-production clusters. Valid range: 1–365 days. (e.g., `7`, `30`, `90`) |
| `gke_backup_schedule` | `'0 3 * * *'` | Cron expression (UTC) | Cron expression defining when GKE backup jobs run automatically. All times are interpreted as UTC. The default `'0 3 * * *'` runs a backup daily at 03:00 UTC, which typically falls outside peak usage hours for most regions. **Choose a schedule that avoids your application's peak traffic window** to minimise any performance impact during backup. For higher recovery point objectives, use a more frequent schedule such as `'0 */6 * * *'` (every 6 hours). Uses standard five-field Unix cron format: minute, hour, day-of-month, month, day-of-week. (e.g., `'0 3 * * *'` for daily at 03:00 UTC, `'0 */6 * * *'` for every 6 hours, `'0 2 * * 0'` for weekly on Sunday at 02:00 UTC) |

### Validating Group 8 Settings

**Google Cloud Console:**
- **Backup plans:** Navigate to **Kubernetes Engine → Backup for GKE → Backup plans** to confirm a backup plan has been created for the cluster with the expected schedule and retention period.
- **Backup history:** Select a backup plan and click the **Backups** tab to view completed backups, their size, and their expiry date.
- **Restore plans:** Navigate to **Kubernetes Engine → Backup for GKE → Restore plans** to view any configured restore plans for recovering workloads from a backup.

**gcloud CLI:**
```bash
# List all GKE backup plans in the region
gcloud container backup-restore backup-plans list \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,cluster,retentionPolicy.backupDeleteLockDays,state)"

# List completed backups for a specific backup plan
gcloud container backup-restore backups list \
  --backup-plan=BACKUP_PLAN_NAME \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,state,createTime,deleteLockExpireTime)"
```

---

## Group 9: VPC Service Controls

These variables configure VPC Service Controls (VPC-SC), which establishes a security perimeter around the GCP project to protect against data exfiltration. Once enforced, the perimeter restricts access to Google Cloud APIs (such as Cloud Storage, Cloud SQL, and BigQuery) to requests that originate from within the defined perimeter — requests from IP addresses or identities outside the perimeter are blocked at the API level, even if they hold valid IAM credentials. **VPC-SC is an advanced security control** with a significant risk of locking out legitimate access if misconfigured. Always enable with `vpc_sc_dry_run = true` first to audit the impact before switching to enforcement mode.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_vpc_sc` | `false` | `true` / `false` | Creates a VPC Service Controls perimeter around the project, restricting access to Google Cloud APIs to requests originating from within the defined perimeter. Prevents data exfiltration by ensuring that even a compromised IAM credential cannot be used to exfiltrate data from outside the allowlisted networks or IP ranges. **Always enable `vpc_sc_dry_run = true` first** and review the violation logs before setting `vpc_sc_dry_run = false` — enforcing an incorrectly configured perimeter can break application connectivity, CI/CD pipelines, and operator access simultaneously. Recommended for regulated environments handling sensitive data (e.g. PCI-DSS, HIPAA, or government workloads). |
| `vpc_cidr_ranges` | `[]` | List of CIDR strings | List of VPC subnet CIDR ranges whose traffic is permitted to access Google Cloud APIs through the VPC Service Controls perimeter. Add the CIDR ranges of all subnets in the module VPC (and any peered VPCs) from which your applications and GKE pods make API calls. Only used when `enable_vpc_sc = true`. Requests from addresses outside these ranges and outside `admin_ip_ranges` will be blocked when the perimeter is enforced. (e.g., `['10.0.0.0/8', '172.16.0.0/12']`) |
| `admin_ip_ranges` | `[]` | List of CIDR strings | List of administrator and operator IP CIDR ranges permitted to access Google Cloud APIs through the VPC Service Controls perimeter. Use to allowlist office egress IPs, VPN exit nodes, and CI/CD runner IP addresses that make direct API calls (e.g. `gcloud`, Terraform, Cloud Build). Only used when `enable_vpc_sc = true`. Must be in valid CIDR format. **Ensure this list is complete before enforcing the perimeter** — missing a CI/CD runner IP will cause pipeline failures. (e.g., `['203.0.113.0/24', '198.51.100.32/28']`) |
| `vpc_sc_dry_run` | `true` | `true` / `false` | Controls whether the VPC Service Controls perimeter operates in dry-run (audit) mode or enforced mode. **`true` (default — dry-run):** policy violations are logged to Cloud Audit Logs but requests are not blocked. Use this mode to identify which API calls would be denied before enabling enforcement, and to validate that `vpc_cidr_ranges` and `admin_ip_ranges` are complete. **`false` (enforced):** requests that violate the perimeter policy are actively blocked. Only set to `false` after thoroughly reviewing dry-run violation logs and confirming that all legitimate access patterns are covered by the allowlists. Only used when `enable_vpc_sc = true`. |

### Validating Group 9 Settings

**Google Cloud Console:**
- **Perimeter:** Navigate to **Security → VPC Service Controls** to confirm the perimeter has been created for the project and view its current mode (dry-run or enforced).
- **Dry-run violations:** Navigate to **Logging → Logs Explorer** and filter for `protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"` to view API calls that would be blocked by the perimeter in dry-run mode.
- **Access policy:** Navigate to **Security → VPC Service Controls → Access Policies** to view the organisation-level access policy under which the perimeter is created.

**gcloud CLI:**
```bash
# List all access policies in the organisation
gcloud access-context-manager policies list --organization=ORG_ID

# List perimeters within the access policy
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME \
  --format="table(name,status.resources,status.restrictedServices)"

# View dry-run violation logs for the project
gcloud logging read \
  'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName)"
```

---

## Group 10: Binary Authorization

These variables configure Binary Authorization, a deploy-time security control that ensures only trusted, verified container images can be deployed to GKE or Cloud Run within the project. Binary Authorization works by requiring images to carry a cryptographic attestation — a signed statement from a trusted attestor (such as a CI/CD pipeline or a vulnerability scanner) confirming the image has passed required checks. Any deployment that presents an image without a valid attestation is rejected before the container starts. This provides a strong guarantee that only images built and verified by your authorised pipeline can run in production, protecting against supply chain attacks and accidental deployment of unverified images.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_binary_authorization` | `false` | `true` / `false` | Enables Binary Authorization for the project, creating a project-level policy that is evaluated on every container deployment to Cloud Run and GKE. When enabled, the policy is applied to all services and clusters in the project — there is no per-service opt-out. **Start with `binauthz_evaluation_mode = 'ALWAYS_ALLOW'`** to enable the feature without blocking any deployments, then progressively tighten the policy once attestors and signing pipelines are in place. Recommended for production environments handling sensitive workloads where supply chain integrity is a concern. |
| `binauthz_evaluation_mode` | `'ALWAYS_ALLOW'` | `ALWAYS_ALLOW` / `ALWAYS_DENY` / `REQUIRE_ATTESTATION` | Enforcement mode for the Binary Authorization policy. **`ALWAYS_ALLOW`** (default): permits all images regardless of attestation status — effectively a no-op that allows you to enable Binary Authorization infrastructure without blocking any deployments. Use this during initial setup and pipeline integration. **`REQUIRE_ATTESTATION`**: enforces that every image must carry a valid cryptographic attestation from a configured trusted attestor before it can be deployed. This is the intended production mode — only images that have passed your CI/CD verification pipeline can be run. **`ALWAYS_DENY`**: blocks all container image deployments unconditionally, regardless of attestations. Use only for emergency lockdown scenarios where you need to immediately prevent any new workloads from being deployed to the project. Only used when `enable_binary_authorization = true`. |

### Validating Group 10 Settings

**Google Cloud Console:**
- **Policy:** Navigate to **Security → Binary Authorization** to view the current project policy, its evaluation mode, and any configured attestors.
- **Attestors:** On the Binary Authorization page, select the **Attestors** tab to view trusted attestors and their associated signing keys.
- **Deployment audit:** Navigate to **Logging → Logs Explorer** and filter for `resource.type="k8s_cluster"` or `resource.type="cloud_run_revision"` with `protoPayload.serviceName="binaryauthorization.googleapis.com"` to view Binary Authorization admission decisions.

**gcloud CLI:**
```bash
# View the current Binary Authorization policy for the project
gcloud container binauthz policy export --project=PROJECT_ID

# List configured attestors in the project
gcloud container binauthz attestors list \
  --project=PROJECT_ID \
  --format="table(name,userOwnedGrafeasNote.noteReference,userOwnedGrafeasNote.publicKeys[0].id)"

# Check whether a specific image has a valid attestation
gcloud container binauthz attestations list \
  --attestor=ATTESTOR_NAME \
  --attestor-project=PROJECT_ID \
  --artifact-url=IMAGE_URI
```

---

## Group 11: Customer-Managed Encryption Keys

These variables configure Customer-Managed Encryption Keys (CMEK) via Cloud Key Management Service (KMS). By default, GCP encrypts all data at rest using Google-managed keys, which are rotated and managed entirely by Google. Enabling CMEK replaces Google-managed keys with keys that you control — provisioned in Cloud KMS in the primary region and used to encrypt supported resources including Cloud SQL, Cloud Storage, and GKE. CMEK gives you direct control over the key lifecycle: you can rotate, disable, or destroy keys, and revoking key access immediately renders the encrypted data inaccessible. This is typically required for regulated environments (e.g. financial services, healthcare, government) where organisational policy mandates control over encryption key custody.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_cmek` | `false` | `true` / `false` | Enables Customer-Managed Encryption Keys for supported resources. When enabled, a Cloud KMS key ring and symmetric encryption key are provisioned in the primary availability region. All supported resources (Cloud SQL instances, GCS buckets, and GKE clusters) are configured to use this key for encryption at rest instead of the default Google-managed key. **Enabling CMEK after resources are already provisioned with Google-managed keys requires migrating existing data** — plan CMEK enablement at initial deployment time to avoid this complexity. Note that disabling a KMS key or destroying a key version renders all data encrypted with that version permanently inaccessible — implement key access controls and deletion policies carefully. |
| `cmek_key_rotation_period` | `'7776000s'` *(90 days)* | Duration string with `s` suffix | Rotation period for the Cloud KMS encryption key. After this period elapses, Cloud KMS automatically creates a new key version and sets it as the primary version for encrypting new data. **Older key versions are retained and continue to be used for decrypting data encrypted under them** — they are not destroyed automatically. This means rotation does not re-encrypt existing data but ensures new writes use the latest key version. Shorter rotation periods reduce the blast radius of a compromised key version. Only used when `enable_cmek = true`. Must be a number of seconds followed by `'s'`. (e.g., `'7776000s'` for 90 days, `'2592000s'` for 30 days, `'15552000s'` for 180 days) |

### Validating Group 11 Settings

**Google Cloud Console:**
- **Key ring and key:** Navigate to **Security → Key Management** to confirm the key ring and key have been created in the primary region. Verify the key's rotation period and primary key version.
- **Key versions:** Click the key name to view all versions, their state (`Enabled`, `Disabled`, `Destroyed`), and their creation dates.
- **Resource encryption:** Navigate to a Cloud SQL instance (**SQL → *instance name* → Overview**) and confirm the encryption type shows `Customer-managed` with the KMS key path. Repeat for any GCS buckets (**Cloud Storage → *bucket name* → Configuration tab**).

**gcloud CLI:**
```bash
# List all key rings in the primary region
gcloud kms keyrings list \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,createTime)"

# List keys within the key ring and view rotation period
gcloud kms keys list \
  --keyring=KEYRING_NAME \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,purpose,rotationPeriod,nextRotationTime,primary.state)"

# Confirm a Cloud SQL instance is using the CMEK key
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(diskEncryptionConfiguration,diskEncryptionStatus)"
```

---

## Group 12: Security Command Center & Auditing

These variables configure three complementary security and observability features: container image vulnerability scanning via Container Analysis, detailed Cloud Audit Logs for data access events, and Security Command Center (SCC) for centralised security findings. These controls are independent of each other and can be enabled selectively depending on the compliance and observability requirements of the environment. All three are disabled by default as they increase log volume and associated costs — they are most valuable in production environments handling sensitive data.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_vulnerability_scanning` | `false` | `true` / `false` | Enables Container Analysis and scan-on-push vulnerability scanning for all Artifact Registry repositories in the project. When enabled, every container image pushed to Artifact Registry is automatically scanned against the Common Vulnerabilities and Exposures (CVE) database. Scan results are visible in the Artifact Registry console under each image's **Security** tab and can be used as a gate in Binary Authorization attestation workflows — for example, blocking deployment of images with critical-severity CVEs. Enabling this adds a short delay to image push operations while scanning completes. Recommended for all production environments. |
| `enable_audit_logging` | `false` | `true` / `false` | Enables detailed Cloud Audit Logs (Data Access logs) for all supported services in the project. By default, GCP logs only Admin Activity events (resource creation, deletion, and IAM changes). Enabling this captures **Data Read** and **Data Write** events as well — for example, who read a Secret Manager secret, who queried a Cloud SQL database, or who read a GCS object. **This significantly increases Cloud Logging ingestion volume and cost** — assess the expected log volume before enabling in high-traffic environments. Required for compliance frameworks that mandate a full audit trail of data access (e.g. PCI-DSS, SOC 2, ISO 27001). |
| `enable_security_command_center` | `false` | `true` / `false` | Enables Security Command Center (SCC) for the project. SCC aggregates security findings, misconfigurations, and vulnerability reports from across GCP services into a single dashboard. Built-in detectors identify issues such as publicly accessible storage buckets, over-privileged service accounts, exposed secrets, and unused firewall rules. Findings can be filtered by severity and assigned for remediation. Configure Pub/Sub routing for findings using `enable_scc_notifications` to integrate with external SIEM or ticketing systems. Recommended for production projects as a continuous security posture monitoring tool. |
| `enable_scc_notifications` | `false` | `true` / `false` | Routes Security Command Center findings to a Pub/Sub topic, enabling downstream processing such as real-time alerting, automated ticketing, or SIEM ingestion. When enabled, a Pub/Sub topic and an SCC notification configuration are created automatically — new findings and finding updates are published to the topic as they are generated. Requires `enable_security_command_center = true`. Subscribe a Cloud Function, Dataflow pipeline, or external connector to the topic to process findings programmatically. |

### Validating Group 12 Settings

**Google Cloud Console:**
- **Vulnerability scanning:** Navigate to **Artifact Registry → Repositories → *repository name*** and select an image to view its **Security** tab, which lists all detected CVEs by severity.
- **Audit logs:** Navigate to **IAM & Admin → Audit Logs** to confirm that Data Read and Data Write log types are enabled for the relevant services.
- **Security Command Center:** Navigate to **Security → Security Command Center → Findings** to view active findings categorised by severity and source.
- **SCC notifications:** Navigate to **Pub/Sub → Topics** to confirm the SCC notification topic has been created (if `enable_scc_notifications = true`).

**gcloud CLI:**
```bash
# Check which audit log types are enabled for services in the project
gcloud projects get-iam-policy PROJECT_ID \
  --format="yaml(auditConfigs)"

# List active Security Command Center findings for the project
gcloud scc findings list PROJECT_ID \
  --source=- \
  --filter="state=ACTIVE" \
  --format="table(name,category,severity,eventTime)"

# List Pub/Sub topics to confirm the SCC notification topic exists
gcloud pubsub topics list --project=PROJECT_ID \
  --format="table(name)"
```

---

## Group 13: Cloud Monitoring & Alerting

These variables configure Cloud Monitoring alert policies and email notification channels for infrastructure resource utilisation — CPU, memory, and disk — across the Compute Engine VMs provisioned by this module (primarily the self-managed NFS/Redis VM from Group 4). Alert policies evaluate the average utilisation of each metric over a rolling window and fire when the value exceeds the configured threshold. Alerts are sent to the email addresses in `notification_alert_emails` via a Cloud Monitoring notification channel. This group is independent of the `support_users` variable in Group 1 — `support_users` receives platform-level notifications, while `notification_alert_emails` receives Cloud Monitoring metric threshold alerts.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `configure_email_notification` | `false` | `true` / `false` | Creates a Cloud Monitoring email notification channel using the addresses in `notification_alert_emails`, and attaches it to the CPU, memory, and disk alert policies configured by the remaining variables in this group. When `false`, no notification channel is created and no alert emails are sent regardless of the threshold settings. **Set to `true` for any environment where infrastructure issues should be surfaced to an operations team.** The notification channel is shared across all three alert policies. |
| `notification_alert_emails` | `[]` | List of email addresses | List of email addresses to receive Cloud Monitoring alert notifications when a threshold policy fires. Only used when `configure_email_notification = true`. All addresses are added to a single notification channel and will receive alerts for CPU, memory, and disk threshold events. Use a team distribution list rather than individual addresses to ensure coverage during holidays and staff changes. (e.g., `['ops@example.com', 'oncall@example.com']`) |
| `alert_cpu_threshold` | `80` | Integer `0`–`100` | CPU utilisation percentage threshold above which a Cloud Monitoring alert is triggered. The alert evaluates average CPU utilisation across monitored Compute Engine instances over a rolling window — sustained usage above this value sends a notification to the configured channel. **`80` is a sensible default** for most workloads, giving headroom before saturation while avoiding false positives during normal load spikes. Lower this value (e.g. `70`) for latency-sensitive workloads where high CPU directly impacts response times. |
| `alert_memory_threshold` | `80` | Integer `0`–`100` | Memory utilisation percentage threshold above which a Cloud Monitoring alert is triggered. Monitors average memory utilisation across Compute Engine instances. **Memory pressure is particularly important to monitor for the NFS/Redis VM** — when the VM runs low on memory, the kernel may start swapping or the OOM killer may terminate the Redis process, causing cache data loss. Consider lowering this threshold (e.g. `70`) if the VM hosts a Redis dataset that grows over time. |
| `alert_disk_threshold` | `80` | Integer `0`–`100` | Disk utilisation percentage threshold above which a Cloud Monitoring alert is triggered. Monitors average disk utilisation on the persistent disk attached to the NFS server VM. **Running out of disk space on the NFS volume will cause application write failures** — alert early (e.g. at `75`) to give the operations team time to expand the disk before it becomes full. Disk capacity can be increased online without restarting the VM by resizing the persistent disk and extending the filesystem. |

### Validating Group 13 Settings

**Google Cloud Console:**
- **Notification channel:** Navigate to **Monitoring → Alerting → Notification channels** to confirm the email notification channel has been created and lists the expected recipient addresses.
- **Alert policies:** Navigate to **Monitoring → Alerting → Policies** to view the CPU, memory, and disk threshold policies. Confirm each policy shows the correct threshold value and is linked to the notification channel.
- **Policy status:** On the Alerting overview page, the current state of each policy (`No data`, `OK`, or `Alerting`) is shown — confirm policies are in an `OK` state during normal operation.

**gcloud CLI:**
```bash
# List all Cloud Monitoring notification channels in the project
gcloud beta monitoring channels list --project=PROJECT_ID \
  --format="table(displayName,type,labels.email_address,enabled)"

# List all alert policies and their threshold conditions
gcloud alpha monitoring policies list --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].displayName)"

# Describe a specific policy to view threshold value and notification channels
gcloud alpha monitoring policies describe POLICY_NAME \
  --project=PROJECT_ID \
  --format="yaml(displayName,conditions,notificationChannels)"
```
