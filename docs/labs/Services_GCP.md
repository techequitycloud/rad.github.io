---
title: "Services GCP \u2014 Lab Guide"
---

# Services GCP — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Services_GCP)**

## Overview

`Services GCP` is the **foundational infrastructure module** in the RAD Modules ecosystem. It must be deployed before any application module and provisions the shared GCP services that all applications depend on: VPC networking, Cloud SQL databases, a self-managed NFS and Redis VM, Artifact Registry, IAM service accounts, and a broad set of optional capabilities — AlloyDB for PostgreSQL, Firestore, Cloud Memorystore (Redis), Cloud Filestore (NFS), GKE Autopilot/Standard clusters, and security/governance controls (CMEK, Binary Authorization, VPC Service Controls, Security Command Center, Workload Identity Federation, audit logging, monitoring alerts, and billing budgets).

**Estimated time:** 1.5–2.5 hours (add 30–40 minutes if deploying a GKE cluster)

### What the Module Automates

- Enables up to 46 GCP APIs in the target project (with a 360-second propagation wait)
- Creates a custom-mode VPC network with subnets, Cloud NAT, and Private Service Connect peering
- Provisions four IAM service accounts (Cloud Build, Cloud Deploy, Cloud Run, NFS/Redis) with all required role bindings
- Creates a shared Artifact Registry Docker repository
- Provisions Cloud SQL PostgreSQL (enabled by default) and optionally MySQL or AlloyDB instances with private IP, automated backups, and Secret Manager root passwords
- Optionally creates a Firestore Native (Enterprise edition) document database
- Deploys a self-managed NFS + Redis VM as a Managed Instance Group with auto-healing and daily disk snapshots (enabled by default)
- Optionally provisions Cloud Memorystore for Redis, Cloud Filestore NFS, GKE Autopilot/Standard cluster(s), CMEK, Binary Authorization, VPC Service Controls, Security Command Center, Workload Identity Federation, and Cloud Monitoring alert policies
- Validates your inputs at **plan time** — invalid values or feature combinations are rejected with a clear error before any resource is created

### What You Do Manually

- Note the deployment outputs from the deployment's **Outputs** tab
- Verify the VPC network, subnets, and Cloud NAT in the Cloud Console
- Inspect Cloud SQL instances, private IP connectivity, and Secret Manager passwords
- Confirm the NFS/Redis VM MIG is healthy and the data disk is attached
- (Optional) Configure `kubectl` access to the GKE cluster and verify it joined the fleet
- Review IAM bindings for the provisioned service accounts
- Explore Cloud Monitoring alert policies and notification channels

---

## CLI and REST API Overview

```bash
# Set these variables at the start of each session
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the VPC network created by this module
export NETWORK=$(gcloud compute networks list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

# Discover the Cloud SQL PostgreSQL instance
export PG_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="databaseVersion~POSTGRES" \
  --format="value(name)" \
  --limit=1)

# Discover the NFS/Redis VM (if created)
export NFS_VM=$(gcloud compute instances list \
  --project=${PROJECT} \
  --filter="tags.items:nfsserver" \
  --format="value(name)" \
  --limit=1)
```

---

## Prerequisites

| Requirement | Detail |
|---|---|
| GCP project with billing | Active billing account linked |
| Service account | `roles/owner` granted in the target project to the RAD module creator SA |
| `gcloud` CLI | Authenticated (`gcloud auth login`) |
| `kubectl` (optional) | Required only if deploying a GKE cluster |
| RAD platform access | Permission to deploy modules in the target GCP project |

`Services GCP` is a standalone module with no runtime dependencies on other RAD modules. The only prerequisite is an existing GCP project with billing enabled.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Variables are configured in the module configuration form in the RAD platform before deploying. The table below covers the most commonly adjusted variables; the **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Services_GCP)** documents every variable, grouped exactly as the form presents them, with a *"Choosing…"* decision note for each group explaining the cost / availability / security trade-offs behind the choice.

> **Inputs are validated at plan time.** You do not have to get every combination right by memory — the module rejects invalid values (a malformed `tenant_deployment_id`, a Filestore capacity below the tier minimum, a budget threshold outside `0–1`) and invalid combinations (a read replica with no primary, an enforced VPC-SC perimeter with no allow-listed IPs, a GKE add-on with no cluster) *before* anything is created, with a message naming the offending variable. Treat a clean plan as confirmation that the value and combination rules passed — sizing and CIDR-topology choices are still yours to get right.

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | GCP project ID to deploy into |
| `tenant_deployment_id` | `demo` | **Prefix of every resource name** (lowercase letters/numbers only, no hyphens — enforced). Application modules must use this same value to bind to this foundation. Never change after first deploy. |
| `availability_regions` | `['us-central1']` | List of regions for subnets and resources; first entry is the primary region. A second region enables cross-region read replicas. |
| `subnet_cidr_range` | `['10.0.0.0/24']` | CIDR ranges for VPC subnets, one per region (at least one per region is enforced). The VPC network name is derived automatically from the tenant — it is not a configurable variable. |
| `support_users` | `[]` | Email addresses added to monitoring notification channels and IAM |
| `resource_labels` | `{}` | Labels applied to all provisioned resources |
| `create_postgres` | `true` | Provision a Cloud SQL PostgreSQL instance |
| `postgres_database_version` | `POSTGRES_17` | PostgreSQL engine version (`POSTGRES_17`/`16`/`15`/`14` — validated) |
| `postgres_database_availability_type` | `ZONAL` | `ZONAL` for dev/test; `REGIONAL` for high-availability production |
| `postgres_tier` | `db-custom-1-3840` | Cloud SQL machine type (1 vCPU, 3.75 GB RAM) |
| `create_mysql` | `false` | Provision a Cloud SQL MySQL instance (required by WordPress, Moodle, Odoo) |
| `enable_alloydb` | `false` | Provision an AlloyDB for PostgreSQL cluster (analytics/AI/vector workloads). Higher cost than a small Cloud SQL instance. |
| `create_firestore` | `false` | Create a Firestore Native (Enterprise) document database. Serverless, pay-per-use. |
| `create_network_filesystem` | `true` | Deploy self-managed NFS + Redis VM as a Managed Instance Group |
| `network_filesystem_machine` | `e2-small` | Compute Engine machine type for the NFS/Redis VM |
| `network_filesystem_capacity` | `10` | NFS data disk size in GB (grow-only) |
| `create_redis` | `false` | Provision Cloud Memorystore for Redis (managed alternative; set `create_network_filesystem = false`) |
| `create_filestore_nfs` | `false` | Provision Cloud Filestore NFS (managed alternative; set `create_network_filesystem = false`) |
| `create_google_kubernetes_engine` | `false` | Provision one or more GKE Autopilot/Standard clusters |
| `enable_vulnerability_scanning` | `false` | Scan-on-push CVE scanning for Artifact Registry images (low cost, high value) |
| `enable_cmek` | `false` | Encrypt resources with Customer-Managed Encryption Keys via Cloud KMS (decide at first deploy) |
| `enable_binary_authorization` | `false` | Enable Binary Authorization image policy enforcement (start in `ALWAYS_ALLOW`) |
| `enable_vpc_sc` | `false` | Create a VPC Service Controls perimeter around the project (start in `vpc_sc_dry_run = true`) |
| `enable_security_command_center` | `false` | Enable Security Command Center for centralised security findings |
| `configure_email_notification` | `false` | Create Cloud Monitoring alert policies for CPU, memory, and disk (supply `notification_alert_emails`) |

### Step 1.1b — Choose Your Lab Path

This lab supports two configurations. Pick one based on how much of the module you want to exercise (and how much lab time/cost you can spend).

**Path A — Minimal (fastest, ~20–35 min).** Accept the defaults: PostgreSQL + the self-managed NFS/Redis VM. This is enough to back a single Cloud Run application and to walk Phases 2–4 and 7. Set only `project_id` and `tenant_deployment_id`.

**Path B — Full-Feature (recommended for this lab, ~45–70 min with GKE).** Turn on a representative breadth of capabilities so every verification phase has something to demonstrate. Suggested configuration:

```hcl
project_id                      = "<your-project-id>"
tenant_deployment_id            = "demo"

# Databases — exercise all three relational engines + Firestore
create_postgres                 = true
create_mysql                    = true
create_firestore                = true
# enable_alloydb                = true   # optional: highest-cost item, enable to see AlloyDB

# Compute
create_google_kubernetes_engine = true   # adds ~10–20 min for the Autopilot cluster

# Storage & cache — keep the default self-managed VM, OR switch to managed:
create_network_filesystem       = true
# create_redis                  = true   # if set, also set create_network_filesystem = false
# create_filestore_nfs          = true   # if set, also set create_network_filesystem = false

# Security & governance (all in safe/audit modes — no lockout risk)
enable_vulnerability_scanning   = true
enable_binary_authorization     = true   # stays in ALWAYS_ALLOW until you add an attestation pipeline
enable_cmek                     = true
enable_vpc_sc                   = true   # remains dry-run (vpc_sc_dry_run = true) — audit only
enable_security_command_center  = true

# Observability & cost
configure_email_notification    = true
notification_alert_emails       = ["you@example.com"]
create_billing_budget           = true
budget_amount                   = 100
budget_alert_emails             = ["you@example.com"]
```

> Path B leaves the two highest-blast-radius features (`enable_binary_authorization`, `enable_vpc_sc`) in their **safe modes** — `ALWAYS_ALLOW` and dry-run — so you can observe them in the console without risking a project-wide block. Tighten them only after reading the Configuration Guide's rollout notes. The remainder of this lab assumes Path B and marks engine-specific steps with the feature flag that enables them, so Path A users can simply skip those.

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD platform: click **Deploy** in the top navigation, open **Services GCP** from the **Platform Modules** list, fill in the configuration form, and click **Deploy**.

**Expected resource provisioning times:**

| Phase | Typical duration |
|---|---|
| GCP API enablement (46 APIs + 360 s propagation wait) | 6–8 min |
| VPC network, subnets, Cloud NAT, Private Service Connect | 2–4 min |
| Artifact Registry repository + service accounts | 2–3 min |
| NFS/Redis VM + Managed Instance Group | 3–5 min |
| Cloud SQL PostgreSQL instance | 5–10 min |
| Cloud SQL MySQL instance (if enabled) | 3–5 min |
| Cloud Memorystore Redis (if enabled) | 3–5 min |
| Cloud Filestore NFS (if enabled) | 3–5 min |
| GKE Autopilot cluster + Fleet registration (if enabled) | 10–20 min |
| CMEK / Binary Authorization / VPC-SC (if enabled) | 2–5 min |
| Cloud Monitoring alert policies | 1–2 min |
| **Total (defaults: PostgreSQL + NFS VM)** | **20–35 min** |
| **Total (with GKE cluster)** | **35–55 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available on the deployment's **Outputs** tab.

| Output | Description |
|---|---|
| `deployment_id` | Random hex ID used as a suffix in all resource names |
| `primary_region` | First region from `availability_regions` |
| `host_project_id` | GCP project ID |
| `vpc_network_name` | VPC network name |
| `vpc_network_id` | VPC network resource ID |
| `cloudrun_service_account` | Email of the Cloud Run service account |
| `cloudbuild_service_account` | Email of the Cloud Build service account |
| `artifact_registry_repository_name` | Shared Docker repository name |
| `artifact_registry_repository_location` | Repository region |
| `nfs_server_ip` | Static internal IP of the NFS+Redis VM (if `create_network_filesystem = true`) |
| `redis_on_nfs_connection_string` | `redis://{ip}:6379` (if `create_network_filesystem = true`) |
| `postgres_instance_connection_name` | Cloud SQL Auth Proxy connection name (if `create_postgres = true`) |
| `postgres_instance_ip` | Private IP of the PostgreSQL instance (if `create_postgres = true`) |
| `mysql_instance_connection_name` | Cloud SQL Auth Proxy connection name (if `create_mysql = true`) |
| `redis_host` | Memorystore Redis host IP (if `create_redis = true`) |
| `filestore_ip` | Filestore NFS server IP (if `create_filestore_nfs = true`) |
| `alloydb_cluster_name` | AlloyDB cluster name (if `enable_alloydb = true`) |
| `alloydb_primary_ip` | Private IP of the AlloyDB primary instance (if `enable_alloydb = true`) |
| `gke_cluster_name` | Primary GKE cluster name (if `create_google_kubernetes_engine = true`) |
| `binauthz_attestor_name` | Binary Authorization attestor name (if `enable_binary_authorization = true`) |
| `storage_kms_key_name` | KMS key resource name for Cloud Storage (if `enable_cmek = true`) |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

export NETWORK=$(gcloud compute networks list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

export PG_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="databaseVersion~POSTGRES" \
  --format="value(name)" \
  --limit=1)

export NFS_VM=$(gcloud compute instances list \
  --project=${PROJECT} \
  --filter="tags.items:nfsserver" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Verify Networking & IAM [MANUAL]

### Step 2.1 — Confirm the VPC Network

Verify the VPC network was created:

```bash
gcloud compute networks describe ${NETWORK} \
  --project=${PROJECT} \
  --format="yaml(name,autoCreateSubnetworks,routingConfig)"
```

**Expected result:** The network appears with `autoCreateSubnetworks: false` (custom-mode) and the name you configured.

In the Cloud Console, navigate to **VPC network → VPC networks** and confirm the network is listed.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/networks/${NETWORK}" \
>   | jq '{name, autoCreateSubnetworks, routingConfig}'
> ```

### Step 2.2 — Inspect Subnets

```bash
gcloud compute networks subnets list \
  --network=${NETWORK} \
  --project=${PROJECT} \
  --format="table(name,region,ipCidrRange,privateIpGoogleAccess)"
```

**Expected result:** One subnet per configured availability region with the CIDR range you specified. `privateIpGoogleAccess` should be `True`.

### Step 2.3 — Confirm Cloud NAT

```bash
gcloud compute routers list \
  --project=${PROJECT} \
  --format="table(name,region,network)"
```

```bash
gcloud compute routers nats list \
  --router=$(gcloud compute routers list \
    --project=${PROJECT} \
    --format="value(name)" \
    --limit=1) \
  --router-region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A Cloud Router and NAT gateway are present in the primary region. This allows private VM instances to reach the internet for updates without a public IP.

### Step 2.4 — Verify Firewall Rules

```bash
gcloud compute firewall-rules list \
  --project=${PROJECT} \
  --filter="network~${NETWORK}" \
  --format="table(name,direction,sourceRanges[0],allowed[0].ports)"
```

**Expected result:** Rules include `fw-allow-lb-hc` (load balancer health checks), `fw-allow-iap-ssh` (SSH via IAP), `fw-allow-intra-vpc-tcp/udp/icmp` (internal traffic), and `fw-allow-nfs-tcp/udp` (NFS port 2049).

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/global/firewalls" \
>   | jq '.items[] | select(.network | endswith("'${NETWORK}'")) | {name, direction, allowed}'
> ```

### Step 2.5 — Inspect IAM Service Accounts

```bash
gcloud iam service-accounts list \
  --project=${PROJECT} \
  --format="table(displayName,email,disabled)"
```

**Expected result:** Four service accounts are listed — `cloudbuild-sa-*`, `clouddeploy-sa-*`, `cloudrun-sa-*`, and `app-nfs-sa-*` — each with the naming suffix from the deployment ID.

Inspect the IAM bindings for the Cloud Run service account:

```bash
export CLOUDRUN_SA=$(gcloud iam service-accounts list \
  --project=${PROJECT} \
  --filter="email~cloudrun-sa" \
  --format="value(email)" \
  --limit=1)

gcloud projects get-iam-policy ${PROJECT} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${CLOUDRUN_SA}" \
  --format="table(bindings.role)"
```

**Expected result:** The Cloud Run SA holds roles including `run.admin`, `secretmanager.secretAccessor`, `storage.objectAdmin`, `cloudsql.client`, and `vpcaccess.user`.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts" \
>   | jq '.accounts[] | {displayName, email, disabled}'
> ```

### Step 2.6 — Verify Artifact Registry Repository

```bash
gcloud artifacts repositories list \
  --project=${PROJECT} \
  --location=${REGION} \
  --format="table(name,format,location,encryptionConfig)"
```

**Expected result:** A Docker repository named `shared-repo-*` exists in the primary region. If `enable_cmek = true`, `encryptionConfig.kmsKeyName` is populated with the KMS key.

In the Cloud Console, navigate to **Artifact Registry → Repositories** and confirm the repository is listed with Format `Docker`.

---

## Phase 3 — Verify Databases [MANUAL]

### Step 3.1 — Confirm Cloud SQL PostgreSQL Instance

```bash
gcloud sql instances describe ${PG_INSTANCE} \
  --project=${PROJECT} \
  --format="yaml(name,databaseVersion,settings.tier,settings.availabilityType,ipAddresses,state)"
```

**Expected result:** The instance is in `RUNNABLE` state, the database version matches your configuration, no public IP address is listed, and a private IP address is present.

In the Cloud Console, navigate to **SQL** and click the instance name. Review the **Overview**, **Connections**, and **Backups** tabs.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${PG_INSTANCE}" \
>   | jq '{name, state, databaseVersion, settings: {tier: .settings.tier, availabilityType: .settings.availabilityType}}'
> ```

### Step 3.2 — Verify Private IP Only

```bash
gcloud sql instances describe ${PG_INSTANCE} \
  --project=${PROJECT} \
  --format="yaml(ipAddresses)"
```

**Expected result:** Only a `PRIVATE` type IP address is listed. No `PRIMARY` (public) IP exists — the instance is accessible only from within the VPC.

### Step 3.3 — Verify Automated Backups

```bash
gcloud sql backups list \
  --instance=${PG_INSTANCE} \
  --project=${PROJECT} \
  --format="table(id,windowStartTime,status,backupKind)" \
  --limit=5
```

**Expected result:** If the instance is more than 24 hours old, completed backups appear. If newly deployed, the list may be empty but the backup configuration is already active (04:00 UTC daily, 7-day retention).

### Step 3.4 — Retrieve the Root Password Secret

The root password is automatically generated and stored in Secret Manager:

```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~postgres" \
  --format="table(name,createTime)"
```

```bash
export PG_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~postgres" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${PG_SECRET}" \
  --project=${PROJECT}
```

**Expected result:** The root password is returned. Keep this secure — it is the database superuser credential.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${PG_SECRET}/versions/latest:access" \
>   | jq -r '.payload.data' | base64 --decode
> ```

### Step 3.5 — Check Database Flags

```bash
gcloud sql instances describe ${PG_INSTANCE} \
  --project=${PROJECT} \
  --format="yaml(settings.databaseFlags)"
```

**Expected result:** The `max_connections` flag is set to `200` (default) or your configured value.

### Step 3.6 — Confirm Cloud SQL MySQL Instance [`create_mysql = true`]

```bash
export MY_INSTANCE=$(gcloud sql instances list \
  --project=${PROJECT} \
  --filter="databaseVersion~MYSQL" \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe ${MY_INSTANCE} \
  --project=${PROJECT} \
  --format="yaml(name,databaseVersion,settings.tier,settings.availabilityType,ipAddresses,state)"
```

**Expected result:** A second Cloud SQL instance in `RUNNABLE` state with a `MYSQL_*` version, private IP only, and its own root password in Secret Manager (`gcloud secrets list --filter="name~mysql"`). PostgreSQL and MySQL coexist as independent instances — applications bind to whichever their stack requires.

### Step 3.7 — Confirm AlloyDB Cluster [`enable_alloydb = true`]

```bash
gcloud alloydb clusters list --region=${REGION} --project=${PROJECT} \
  --format="table(name,state)"

export ALLOYDB_CLUSTER=$(gcloud alloydb clusters list \
  --region=${REGION} --project=${PROJECT} \
  --format="value(name)" --limit=1)

gcloud alloydb instances list \
  --cluster=$(basename ${ALLOYDB_CLUSTER}) \
  --region=${REGION} --project=${PROJECT} \
  --format="table(name,instanceType,state)"
```

**Expected result:** A `READY` cluster with at least a `PRIMARY` instance (plus a `READ_POOL` instance if `enable_alloydb_read_pool = true`). The connection IP is exposed as the `alloydb_primary_ip` output. AlloyDB is PostgreSQL-compatible — use it instead of Cloud SQL PostgreSQL for analytics/vector workloads.

### Step 3.8 — Confirm Firestore Database [`create_firestore = true`]

```bash
gcloud firestore databases list --project=${PROJECT} \
  --format="table(name,type,locationId)"
```

**Expected result:** A Firestore database in `FIRESTORE_NATIVE` mode (Enterprise edition uses a *named* database, not `(default)`). In the Cloud Console, navigate to **Firestore** to browse collections. Firestore is serverless and scales to zero, so it incurs no idle compute cost.

---

## Phase 4 — Verify File Storage & Cache [MANUAL]

This phase verifies whichever storage/cache model you chose. **Steps 4.1–4.4** apply to the self-managed VM (`create_network_filesystem = true`, the default); **Step 4.5** applies to the managed services (`create_redis` / `create_filestore_nfs`). You normally use one model or the other — running both creates redundant, split-brain file storage.

### (Self-Managed VM)

Steps 4.1–4.4 apply when `create_network_filesystem = true` (the default). If you chose the managed services instead, skip to Step 4.5.

### Step 4.1 — Confirm the VM is Running

```bash
gcloud compute instances describe ${NFS_VM} \
  --project=${PROJECT} \
  --zone=$(gcloud compute instances list \
    --project=${PROJECT} \
    --filter="tags.items:nfsserver" \
    --format="value(zone)" \
    --limit=1) \
  --format="yaml(name,status,machineType,networkInterfaces[0].networkIP)"
```

**Expected result:** The VM is in `RUNNING` status with a private IP address on the module VPC. No public IP is assigned.

In the Cloud Console, navigate to **Compute Engine → VM instances** and confirm the NFS server VM is listed and running.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://compute.googleapis.com/compute/v1/projects/${PROJECT}/aggregated/instances" \
>   | jq '.items | to_entries[] | .value.instances[]? | select(.tags.items[]? == "nfsserver") | {name, status, zone, networkIP: .networkInterfaces[0].networkIP}'
> ```

### Step 4.2 — Confirm the Managed Instance Group

```bash
gcloud compute instance-groups managed list \
  --project=${PROJECT} \
  --format="table(name,zone,targetSize,status.isStable)"
```

**Expected result:** The MIG shows `targetSize: 1` and `isStable: True`. The auto-healing policy monitors TCP port 2049 (NFS) — if the VM becomes unhealthy, the MIG automatically recreates it.

### Step 4.3 — Verify the Data Disk

```bash
gcloud compute disks list \
  --project=${PROJECT} \
  --filter="users~${NFS_VM}" \
  --format="table(name,zone,sizeGb,type,status)"
```

**Expected result:** An SSD persistent disk of the configured capacity (default 10 GB) is attached to the VM with status `READY`.

In the Cloud Console, navigate to **Compute Engine → Disks** to view the disk and confirm daily snapshot creation under **Compute Engine → Snapshots**.

### Step 4.4 — Verify NFS Server IP in Outputs

The NFS server IP is exposed as `nfs_server_ip` in the module outputs and is used by App CloudRun and App GKE to mount the NFS share. Confirm it matches the VM's internal IP:

```bash
NFS_IP=$(gcloud compute instances describe ${NFS_VM} \
  --project=${PROJECT} \
  --zone=$(gcloud compute instances list \
    --project=${PROJECT} \
    --filter="tags.items:nfsserver" \
    --format="value(zone)" \
    --limit=1) \
  --format="value(networkInterfaces[0].networkIP)")
echo "NFS server IP: ${NFS_IP}"
```

### (Managed Services)

### Step 4.5 — Confirm Memorystore Redis & Filestore [`create_redis` / `create_filestore_nfs = true`]

If you switched to the managed alternatives, verify each one. **Memorystore Redis:**

```bash
gcloud redis instances list --region=${REGION} --project=${PROJECT} \
  --format="table(name,tier,memorySizeGb,redisVersion,host,state)"
```

**Expected result:** A `READY` instance at the configured tier. On `STANDARD_HA`, confirm the persistence mode under `gcloud redis instances describe ... --format="yaml(persistenceConfig)"` — `BASIC` ignores persistence by design, which is why the module rejects that combination at plan time. The host/port are exposed as the `redis_host` / `redis_port` outputs.

**Cloud Filestore:**

```bash
gcloud filestore instances list --project=${PROJECT} \
  --format="table(name,tier,fileShares[0].capacityGb,networks[0].ipAddresses[0],state)"
```

**Expected result:** A `READY` instance at the chosen tier, with capacity at or above the tier minimum (1024 GB BASIC_HDD/ENTERPRISE, 2560 GB BASIC_SSD — enforced at plan time). The server IP is exposed as the `filestore_ip` output.

---

## Phase 5 — Verify GKE Cluster [MANUAL]

This phase applies only when `create_google_kubernetes_engine = true`. Skip to Phase 6 if GKE was not enabled.

### Step 5.1 — List GKE Clusters

```bash
gcloud container clusters list \
  --project=${PROJECT} \
  --format="table(name,location,status,autopilot.enabled,currentMasterVersion)"
```

**Expected result:** The cluster(s) are listed with `status: RUNNING` and `autopilot.enabled: True`.

In the Cloud Console, navigate to **Kubernetes Engine → Clusters** to confirm the expected number of clusters are present.

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters" \
>   | jq '.clusters[] | {name, status, autopilot, currentMasterVersion}'
> ```

### Step 5.2 — Configure kubectl Access

```bash
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

kubectl config current-context
```

**Expected result:** A kubeconfig context referencing your project and cluster is shown, e.g. `gke_my-project_us-central1_gke-cluster-1`.

### Step 5.3 — Verify Cluster CIDR Configuration

```bash
gcloud container clusters describe ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="yaml(clusterIpv4Cidr,servicesIpv4Cidr,network,subnetwork)"
```

**Expected result:** Pod and service CIDR ranges match your configured `gke_pod_base_cidr` and `gke_service_base_cidr`. The cluster is attached to the module VPC.

### Step 5.4 — Verify Fleet Registration

```bash
gcloud container fleet memberships list \
  --project=${PROJECT} \
  --format="table(name,state.code,endpoint.gkeCluster.resourceLink)"
```

**Expected result:** Each cluster appears with `state.code: READY`, confirming it has joined the GKE fleet and is eligible for fleet features such as Config Management and Cloud Service Mesh.

---

## Phase 6 — Verify Security Controls [MANUAL]

This phase covers optional security controls. Steps apply only when the relevant feature was enabled during deployment.

### Step 6.1 — CMEK: Verify KMS Key Ring and Key

Applies when `enable_cmek = true`:

```bash
gcloud kms keyrings list \
  --location=${REGION} \
  --project=${PROJECT} \
  --format="table(name,createTime)"
```

```bash
export KEYRING=$(gcloud kms keyrings list \
  --location=${REGION} \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

gcloud kms keys list \
  --keyring=${KEYRING} \
  --location=${REGION} \
  --project=${PROJECT} \
  --format="table(name,purpose,rotationPeriod,nextRotationTime,primary.state)"
```

**Expected result:** A key ring and at least one `ENCRYPT_DECRYPT` purpose key exist in the primary region. The primary key version state is `ENABLED`. Confirm that the Cloud SQL instance and Artifact Registry repository show Customer-managed encryption in their respective console pages.

### Step 6.2 — Binary Authorization: Verify Policy

Applies when `enable_binary_authorization = true`:

```bash
gcloud container binauthz policy export --project=${PROJECT}
```

**Expected result:** A Binary Authorization policy is returned showing the configured `evaluationMode` (`ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, or `ALWAYS_DENY`).

List configured attestors:

```bash
gcloud container binauthz attestors list \
  --project=${PROJECT} \
  --format="table(name,userOwnedGrafeasNote.noteReference)"
```

In the Cloud Console, navigate to **Security → Binary Authorization** to view the policy and attestors.

### Step 6.3 — VPC Service Controls: Verify Perimeter

Applies when `enable_vpc_sc = true`:

```bash
gcloud access-context-manager policies list --organization=ORG_ID
```

```bash
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME \
  --format="table(name,status.resources,status.restrictedServices)"
```

**Expected result:** A perimeter exists and lists the project as a protected resource. When `vpc_sc_dry_run = true` (default), the perimeter is in audit mode — violations are logged but requests are not blocked.

View dry-run violations to identify any access patterns that would be blocked before enforcing:

```bash
gcloud logging read \
  'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName)"
```

In the Cloud Console, navigate to **Security → VPC Service Controls** to view the perimeter and its current mode.

### Step 6.4 — Security Command Center: Verify Findings [`enable_security_command_center = true`]

```bash
gcloud scc findings list ${PROJECT} \
  --source=- \
  --filter="state=\"ACTIVE\"" \
  --format="table(category,severity,eventTime)" \
  --limit=10
```

**Expected result:** SCC is active and surfacing findings from its built-in detectors (publicly accessible buckets, over-privileged service accounts, open firewall rules). Findings on a freshly-deployed project may be sparse — the point is that the scanner is running. If `enable_scc_notifications = true`, confirm the Pub/Sub topic exists with `gcloud pubsub topics list --project=${PROJECT}` (the notification config requires SCC to be enabled, which is enforced at plan time). Perimeter and notification creation are skipped with a warning if the deploying identity lacks the org-level role.

In the Cloud Console, navigate to **Security → Security Command Center → Findings** to browse by severity and source.

---

## Phase 7 — Cloud Logging & Monitoring [MANUAL]

### Step 7.1 — Confirm API Enablement Logs

View the audit log entries generated when APIs were enabled during deployment:

```bash
gcloud logging read \
  'protoPayload.methodName="google.api.serviceusage.v1.ServiceUsage.EnableService"' \
  --project=${PROJECT} \
  --limit=10 \
  --format="table(timestamp,protoPayload.resourceName)"
```

**Expected result:** Log entries show the 46+ APIs enabled by this module during initial deployment.

### Step 7.2 — View Admin Activity Audit Logs

```bash
gcloud logging read \
  'logName="projects/'${PROJECT}'/logs/cloudaudit.googleapis.com%2Factivity" AND protoPayload.serviceName="compute.googleapis.com"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp,protoPayload.methodName,protoPayload.authenticationInfo.principalEmail)"
```

**Expected result:** Infrastructure creation events are logged, including VPC network, subnet, and firewall rule creation.

### Step 7.3 — Check Cloud Monitoring Alert Policies

Applies when `configure_email_notification = true`:

```bash
gcloud beta monitoring channels list \
  --project=${PROJECT} \
  --format="table(displayName,type,labels.email_address,enabled)"
```

**Expected result:** An email notification channel is listed with the address(es) from `notification_alert_emails`.

```bash
gcloud alpha monitoring policies list \
  --project=${PROJECT} \
  --format="table(displayName,enabled,conditions[0].displayName)"
```

**Expected result:** Three alert policies are listed — for CPU, memory, and disk utilisation thresholds — each linked to the notification channel.

In the Cloud Console, navigate to **Monitoring → Alerting → Policies** to view the policies and their current state (`OK`, `No data`, or `Alerting`).

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
>   | jq '.alertPolicies[] | {displayName, enabled, conditions: [.conditions[].displayName]}'
> ```

### Step 7.4 — Explore Compute Engine Metrics (NFS VM)

Applies when `create_network_filesystem = true`. In the Cloud Console, navigate to **Monitoring → Metrics Explorer** and query:

**NFS VM CPU utilisation:**
```
fetch gce_instance
| metric 'compute.googleapis.com/instance/cpu/utilization'
| filter resource.instance_id == 'INSTANCE_ID'
| every 1m
```

**NFS VM disk utilisation:**
```
fetch gce_instance
| metric 'compute.googleapis.com/instance/disk/write_bytes_count'
| filter resource.instance_id == 'INSTANCE_ID'
| every 1m
```

Replace `INSTANCE_ID` with the VM's instance ID, which can be retrieved with:

```bash
gcloud compute instances describe ${NFS_VM} \
  --project=${PROJECT} \
  --zone=$(gcloud compute instances list \
    --project=${PROJECT} \
    --filter="tags.items:nfsserver" \
    --format="value(zone)" \
    --limit=1) \
  --format="value(id)"
```

---

## Phase 8 — Troubleshoot & Debug [MANUAL]

Durable, platform-level diagnostics for the most common issues when standing up or
running the shared platform. These techniques do not change with product releases.

- **APIs not enabled / deploy fails early:** confirm the required services are
  enabled, then re-run.
  ```bash
  gcloud services list --enabled --project="$PROJECT" | grep -E 'compute|sqladmin|container|file|redis|servicenetworking'
  ```
- **VPC peering / private services access errors (Cloud SQL, Filestore):** verify the
  `servicenetworking` connection and the allocated peering range exist.
  ```bash
  gcloud services vpc-peerings list --network="$(gcloud compute networks list --project=$PROJECT --format='value(name)' --limit=1)" --project="$PROJECT"
  ```
- **IAM / org-policy denials (SA creation, VPC-SC, SCC):** the deploying identity may
  lack org-level roles; the module skips org-scoped features (VPC-SC perimeter, SCC
  notifications) with a warning rather than failing. Review the deploy logs and the
  project IAM bindings.
- **Quota errors (CPU, IP addresses, SSD):** check quota usage in the region.
  ```bash
  gcloud compute regions describe "$REGION" --project="$PROJECT" --format="value(quotas)"
  ```
- **GKE cluster not ready:** inspect cluster status and operations.
  ```bash
  gcloud container clusters describe "$(gcloud container clusters list --project=$PROJECT --format='value(name)' --limit=1)" --region="$REGION" --project="$PROJECT" --format="value(status)"
  gcloud container operations list --project="$PROJECT" --region="$REGION" --limit=5
  ```
- **Long-running creates are expected, not stuck.** The module sets generous
  create/update timeouts on slow resources — Cloud SQL and AlloyDB up to 60 min,
  GKE clusters 40–60 min, Memorystore/Filestore and the Private Service Access
  connection 30 min — so a slow provision is allowed to finish rather than being
  abandoned. A 10–15 minute GKE Autopilot create or a multi-minute Cloud SQL
  create is normal.
- **Resource exists in GCP but not in Terraform state (orphan).** Rarely, a
  transient API/operation error (or a deploy credential that expires during a
  very long apply) ends the apply *after* the resource has actually come up,
  leaving it live but unmanaged. This is recoverable, not data loss:
  - **Re-run the deployment.** A partial state simply continues — most resources
    are already present, so the re-apply completes quickly without rebuilding the
    image or the slow resources.
  - **If a resource reports "already exists" on re-apply, import it** rather than
    deleting/recreating (which is slow and, for Cloud SQL, blocked by name
    reservation). For example, to adopt a Cloud SQL instance that came up but was
    not recorded:
    ```bash
    # Platform deploys run via the RAD pipeline; for a manual recovery from the
    # module directory:
    tofu import 'google_sql_database_instance.postgres_instance[0]' "${PROJECT}/${PG_INSTANCE}"
    ```
    then re-plan and confirm the resource shows "update in-place", not "replace".
- **Resource exploration:** use the per-service verify steps in Phases 2–6 above to
  confirm each component is healthy. For setting-specific gotchas, see the
  Configuration Guide's *Configuration Pitfalls* section.

---

## Phase 9 — Tear Down [AUTOMATED]

When you are finished, open the **Deployments** page in the RAD platform, find your `Services GCP` deployment, and click the **Trash** icon (**Delete**) to tear down all resources provisioned by this module (this runs `terraform destroy`).

> **Important:** All application modules (`*_CloudRun`, `*_GKE`) that depend on this `Services GCP` deployment **must be undeployed first**. Destroying `Services GCP` while application modules are still running will break their database, NFS, and network connectivity.

**Expected undeploy times:**

| Resource | Typical duration |
|---|---|
| GKE cluster + Fleet deregistration (if enabled) | 5–10 minutes |
| Cloud SQL instances | 3–5 minutes |
| Cloud Memorystore Redis (if enabled) | 2–3 minutes |
| Cloud Filestore NFS (if enabled) | 2–3 minutes |
| NFS/Redis VM and Managed Instance Group | 2–3 minutes |
| VPC network, subnets, firewall rules, Cloud NAT | 2–4 minutes |
| Artifact Registry repository | 1–2 minutes |
| KMS key ring and keys (if CMEK enabled) | 1–2 minutes |
| Secret Manager secrets | < 1 minute |
| IAM service accounts | < 1 minute |
| **Total (defaults)** | **12–20 minutes** |
| **Total (with GKE)** | **20–30 minutes** |

> **Note:** KMS key versions may enter a `DESTROY_SCHEDULED` state with a 24-hour grace period before permanent deletion. This is a Cloud KMS safety feature — the key and its encrypted data remain accessible until the grace period expires.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Choose a lab path and configure variables in the RAD platform | 1.1 | Manual |
| Deploy APIs, networking, databases, NFS VM, Artifact Registry | 1.2 | Automated |
| Note outputs from the deployment Outputs tab | 1.3 | Manual |
| Verify VPC network, subnets, NAT, firewall rules | 2 | Manual |
| Inspect IAM service accounts and Artifact Registry | 2 | Manual |
| Confirm Cloud SQL (PostgreSQL + MySQL), AlloyDB, and Firestore | 3 | Manual |
| Verify the self-managed NFS/Redis VM, or managed Memorystore + Filestore | 4 | Manual |
| Configure kubectl and verify GKE cluster and fleet (if enabled) | 5 | Manual |
| Verify CMEK, Binary Authorization, and VPC-SC (if enabled) | 6 | Manual |
| Review audit logs, alert policies, and Compute metrics | 7 | Manual |
| Troubleshoot common platform issues | 8 | Manual |
| Delete all module resources | 9 | Automated |
