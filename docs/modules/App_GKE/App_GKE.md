---
title: "App GKE Configuration Guide"
sidebar_label: "GKE"
---

# App GKE Module

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/App_GKE.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/App_GKE.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/App_GKE.pdf" target="_blank">View Presentation (PDF)</a>


This document provides a comprehensive analysis of the `modules/App_GKE` Terraform module on Google Cloud Platform. It details the architecture, IAM configuration, service integrations, and potential enhancements.

---

## 1. Module Overview

The `modules/App_GKE` module is a foundational building block for deploying containerized applications on Google Kubernetes Engine (GKE) Autopilot. It is designed to be highly configurable and orchestrates not just the compute layer, but also the surrounding ecosystem of networking, storage, databases, and observability.

**Key Capabilities:**
*   **Compute**: Deploys Kubernetes Deployments, StatefulSets, and CronJobs on GKE Autopilot with built-in auto-scaling (HPA/VPA).
*   **Data Persistence**: Integrates with Cloud SQL (via Auth Proxy sidecar), NFS, GCS (including GCS Fuse CSI Driver), and Persistent Volume Claims for stateful workloads.
*   **Recurring Tasks**: Supports scheduled operations via Kubernetes CronJobs.
*   **Lifecycle Management**: Supports initialization jobs (DB migrations, backups, setup) as Kubernetes Jobs.
*   **CI/CD**: Built-in support for Cloud Build triggers and image mirroring.
*   **Service Mesh**: When the module provisions its own GKE cluster (`configure_service_mesh = true`), it registers the cluster with GKE Fleet Hub and deploys Cloud Service Mesh with `MANAGEMENT_AUTOMATIC`. On externally-provisioned clusters, Istio sidecar injection is enabled via namespace labels only.

---

## 2. IAM & Access Control

The module implements a least-privilege IAM strategy using dedicated Service Accounts and Workload Identity. All IAM bindings are managed through the shared `App_Common/modules/app_iam` sub-module (`iam.tf`). A `time_sleep` of 120 seconds gates all Kubernetes workload creation on IAM propagation to prevent pods from starting before Secret Manager access is globally consistent.

### Service Accounts

1.  **GKE Workload Service Account** (`gke_sa`, format: `gke-sa-<random_id>`):
    *   **Identity**: The GCP identity bound to the Kubernetes Service Account via Workload Identity.
    *   **`roles/secretmanager.secretAccessor`** on the DB password secret and root password secret (when the inline SQL instance is created by this module).
    *   **`roles/secretmanager.secretAccessor`** on each secret referenced in `secret_environment_variables`.
    *   **`roles/storage.objectAdmin`** on each bucket created by the module.
    *   **`roles/storage.legacyBucketReader`** on each bucket (required by some storage client libraries for bucket metadata access).

2.  **Cloud Build Service Account** (`cloud_build_sa`, format: `gke-build-sa-<random_id>`):
    *   **Identity**: Used by Cloud Build triggers for CI/CD. Only created when `enable_cicd_trigger = true`.
    *   **`roles/container.developer`** at the project level — allows Cloud Build to deploy to the GKE cluster.
    *   **`roles/iam.serviceAccountUser`** on the GKE Workload SA — allows Cloud Build to act as the workload identity during deployment.
    *   **`roles/secretmanager.secretAccessor`** on the GitHub token secret (granted to three principals: the user-managed Cloud Build SA, the default Cloud Build service account, and the Cloud Build service agent `service-<project_number>@gcp-sa-cloudbuild.iam.gserviceaccount.com`).

### Workload Identity
*   The module creates a Kubernetes Service Account annotated with `iam.gke.io/gcp-service-account` pointing to the GCP SA.
*   An IAM binding grants the K8s SA the `roles/iam.workloadIdentityUser` role on the GCP SA, scoped as `serviceAccount:<project>.svc.id.goog[<namespace>/<ksa-name>]`.
*   This ensures pods authenticate to GCP APIs using projected service account tokens — no key files are created or stored.

---

## 3. Core Service Configuration

### A. Compute (GKE Autopilot)
*   **Workload Types**: The `workload_type` variable accepts `Deployment` (stateless) or `StatefulSet` (stateful apps). `CronJob` is **not** a workload type — scheduled tasks are defined separately via the `cron_jobs` variable (see §3.E).
*   **Resource Management**: Configurable CPU and Memory requests/limits. Autopilot enforces minimum resource requirements.
*   **Scaling**: Support for Horizontal Pod Autoscaler (HPA) and Vertical Pod Autoscaler (VPA).
*   **Replicas**: Configurable `min_instance_count` and `max_instance_count` for scaling bounds.
*   **Service Types**: Configurable Kubernetes Service type (`ClusterIP`, `LoadBalancer`, `NodePort`).
*   **Stateful Storage**: Automatic PVC provisioning for `StatefulSet` workloads via volume claim templates.

### B. Database (Cloud SQL)
*   **Discovery & Provisioning**: The module first runs a discovery script to locate an existing Cloud SQL instance in the project. If one is found it is used directly. If none is found, an **inline instance** is provisioned automatically — PostgreSQL via `google_sql_database_instance.inline_postgres` or MySQL via `google_sql_database_instance.inline_mysql` — along with a root password stored in Secret Manager.
*   **Connectivity**:
    *   **Cloud SQL Auth Proxy**: Runs as a sidecar container in each pod, exposing the database on `127.0.0.1`.
    *   **Direct TCP/IP**: Falls back to injecting the `DB_HOST` IP address if the proxy is disabled (`enable_cloudsql_volume = false`).
*   **Credentials**: Automatically retrieves or generates DB passwords, stores them in Secret Manager, and syncs to Kubernetes Secrets.

### C. Storage (NFS / GCS / GCS Fuse)
1.  **NFS (Network File System)**:
    *   **Discovery**: Automatically detects an existing NFS server in the region.
    *   **Mounting**: Mounts the NFS share as a native Kubernetes NFS volume in pods.
2.  **GCS (Object Storage)**:
    *   **Standard**: Creates buckets with configurable lifecycles and versioning.
    *   **GCS Fuse CSI Driver**: Mounts GCS buckets as file systems using the GKE-native CSI driver, with pod annotation `gke-gcsfuse/volumes=true`.

### D. Networking & Network Policies
*   **VPC Native**: Pods run directly in the VPC network. No additional connector needed.
*   **Cluster**: Connects to a GKE Autopilot cluster using the cluster's dedicated subnet and secondary IP ranges. The cluster is resolved in the following order:
    1.  An explicit cluster name supplied via `gke_cluster_name` (when `gke_cluster_selection_mode = "explicit"`).
    2.  A Services_GCP-provisioned cluster discovered on the project's managed network.
    3.  An **inline cluster** created by this module when no Services_GCP dependency is present. In this mode the module also creates its own VPC, GKE cluster, NFS server, and Cloud SQL instance, making it fully self-contained (see §9).
*   **Cluster Selection Modes** (`gke_cluster_selection_mode`):
    *   `primary` (default) — targets the primary GKE cluster discovered on the project's managed network.
    *   `explicit` — targets the cluster named in `gke_cluster_name` directly; use when multiple clusters share the same network.
    *   `round-robin` — distributes deployments across all clusters discovered on the network.
*   **Micro-segmentation (NetworkPolicies)**:
    *   **Capability**: When `enable_network_segmentation` is `true`, the module implements Kubernetes `NetworkPolicy` resources using GKE Dataplane V2 (Cilium).
    *   **Namespace Isolation**: Restricts pod-to-pod traffic to only allow communication between pods within the same namespace.
    *   **External Access**: Automatically permits ingress from Google Cloud L7 Load Balancers (Gateway API) and GKE Control Plane health checks.

### E. Initialization Jobs & CronJobs

**Initialization Jobs** (`initialization_jobs` variable) are Kubernetes Jobs that run before the application starts:
*   **`nfs-setup`**: Prepares directory structures and permissions on the NFS server.
*   **`db-init`**: Runs custom scripts for database schema migration and seeding.
*   **Cloud SQL Auth Proxy sidecar**: Jobs with `needs_db = true` get a proxy sidecar with `--quitquitquit` for graceful termination.
*   **Script ConfigMaps**: Job scripts are mounted via Kubernetes ConfigMaps from the module's `scripts/` directory.
*   **Execution control**: `execute_on_apply` maps to the Kubernetes provider's `wait_for_completion` flag. When `true` (default), Terraform blocks until the job completes before proceeding. When `false`, Terraform submits the job and continues without waiting.
*   **Job ordering**: `depends_on_jobs` is declared in the variable type and preserved in the merged job configuration, but job ordering is currently enforced implicitly through the Terraform resource dependency graph (e.g. nfs-setup completes before initialization jobs run) rather than via per-job `depends_on_jobs` chains.

**CronJobs** (`cron_jobs` variable) are recurring scheduled tasks independent of the main workload:
*   Each CronJob defines its own `schedule` (cron expression), `image`, resource limits, `concurrency_policy`, and history limits.
*   CronJobs can mount NFS volumes (`mount_nfs`) and GCS Fuse volumes (`mount_gcs_volumes`).
*   CronJobs are **distinct from the `workload_type` variable** — they always run as `kubernetes_cron_job_v1` resources alongside the main Deployment or StatefulSet.

### F. Additional Services

The `additional_services` variable defines independent helper or proxy services deployed alongside the main workload in the same namespace. Unlike sidecar containers, each entry creates its **own `kubernetes_deployment_v1`, `kubernetes_service_v1`, and optional `kubernetes_horizontal_pod_autoscaler_v2`** — they run as separate pods.

*   **Service URL injection**: The main container (and StatefulSet) automatically receives a `<SERVICE_NAME_UPPER>_URL` environment variable (or a custom name via `output_env_var_name`) resolving to `http://<name>:<port>` using the ClusterIP Service.
*   **Independent scaling**: Each additional service has its own `min_instance_count` / `max_instance_count`. An HPA is created when `max_instance_count > 1` and VPA is not enabled.
*   **Health probes**: Optional `startup_probe` and `liveness_probe` objects provide independent readiness and liveness checking.
*   **Volume mounts**: Entries in `volume_mounts` reference globally-defined volumes (NFS, GCS Fuse) by name.
*   **Key variable**: `additional_services`

**Typical uses**: Envoy/Nginx proxy, Redis Sentinel, background workers, or any tightly-coupled process that must co-locate with the main application but requires its own lifecycle and scaling.

---

## 4. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, the module creates an inline `google_compute_security_policy` and attaches it to the GKE Gateway backend via `GCPBackendPolicy`.

**Rules included in the inline policy:**

| Priority | Action | Rule |
|---|---|---|
| 100 | Allow | Admin IP ranges bypass (`admin_ip_ranges`) |
| 1000 | Deny (403) | SQLi — `sqli-v33-stable` |
| 1001 | Deny (403) | XSS — `xss-v33-stable` |
| 1002 | Deny (403) | LFI — `lfi-v33-stable` |
| 1003 | Deny (403) | RCE — `rce-v33-stable` |
| 2000 | Deny (429) + ban | 500 req/min per IP; HTTP 429 on exceed; 5-minute ban duration |
| 2147483647 | Allow | Default allow |

*   **Adaptive Protection**: L7 DDoS detection is enabled automatically on all inline policies.
*   **External policy**: When `enable_cloud_armor = false` and `cloud_armor_policy_name` is set to a non-default value, the named externally-managed policy is attached instead.
*   **Key variables**: `enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, the application is protected by Google Cloud IAP via the `GCPBackendPolicy` on the Gateway:

*   **OAuth**: Requires a pre-created OAuth 2.0 client. Client ID and secret are supplied via `iap_oauth_client_id` / `iap_oauth_client_secret` (marked `sensitive`).
*   **Access control**: `iap_authorized_users` and `iap_authorized_groups` grant access to specific users and Google Groups respectively (e.g. `user:alice@example.com`, `group:devs@example.com`).
*   **Support email**: `iap_support_email` is displayed on the IAP consent screen.
*   **Key variables**: `enable_iap`, `iap_authorized_users`, `iap_authorized_groups`, `iap_oauth_client_id`, `iap_oauth_client_secret`, `iap_support_email`

### C. Binary Authorization

When `enable_binary_authorization = true`, the module enforces image provenance before any Kubernetes workload is created.

*   **Image signing**: The module signs both the application image (`container_image`) and the DB clients image via `module.app_security` (backed by `App_Common/modules/app_security`) before Terraform creates any Kubernetes Deployment, StatefulSet, or Cloud Deploy release. Two stub `null_resource` resources (`sign_container_image`, `sign_db_clients_image`) propagate this ordering dependency to all caller resources.
*   **Enforcement modes** (controlled by `binauthz_evaluation_mode`):

| Mode | Behaviour |
|---|---|
| `ALWAYS_ALLOW` (default) | Policy is enabled but all images are permitted — safe for initial rollout |
| `REQUIRE_ATTESTATION` | Only images with a valid attestation from the signing key are admitted |
| `ALWAYS_DENY` | All image deployments are blocked (lockdown mode) |

*   **CI/CD integration**: Subsequent builds via Cloud Build sign images at build time, maintaining a continuous chain of attestation.
*   **Key variables**: `enable_binary_authorization`, `binauthz_evaluation_mode`

### D. VPC Service Controls

The `enable_vpc_sc` variable is declared as a preparatory flag for VPC Service Controls compatibility. Two VPC-SC-relevant behaviours are always present in the module regardless of this flag:

1.  **Cloud SQL Auth Proxy image mirroring** (always active when a SQL server and Artifact Registry exist): The proxy image (`gcr.io/cloud-sql-connectors/cloud-sql-proxy:2-alpine`) is unconditionally mirrored into the project's own Artifact Registry. This ensures GKE nodes never pull from `gcr.io` (an out-of-project registry that would be blocked inside a VPC-SC perimeter).
2.  **VPC-SC compliant NetworkPolicy egress** (always present when `enable_network_segmentation = true`): Egress rules include `199.36.153.4/30` (`restricted.googleapis.com`) and `199.36.153.8/30` (`private.googleapis.com`) — the recommended Private Google Access endpoints for GCP APIs inside a VPC-SC perimeter.

*   **Key variable**: `enable_vpc_sc`

> **Note**: `enable_vpc_sc` is currently declared but does not gate either of the behaviours above; both are applied unconditionally as best practices. Full VPC-SC perimeter configuration (access policies, service restrictions, ingress/egress rules) is managed at the GCP organization level by Services_GCP or a dedicated security module.

### E. Secrets Store CSI Driver

When `enable_secrets_store_csi_driver = true`, secrets are fetched from Secret Manager and mounted into pods at start time by the GKE Secrets Store CSI Driver — secret values are **never written to Terraform state**.

*   **Cluster enablement**: The module runs `gcloud container clusters update <cluster> --enable-secret-manager-config` on the target cluster to activate the driver.
*   **SecretProviderClass**: A `SecretProviderClass` manifest is created per namespace, mapping each entry in `secret_environment_variables` to a Secret Manager secret version. The CSI driver mounts these as a volume and also creates a `secretObjects` entry so they are available as standard `envFrom` / `valueFrom` references.
*   **Default behaviour**: When `enable_secrets_store_csi_driver = false` (default), secrets are fetched via Terraform data sources and stored as Kubernetes `Secret` resources in state (values appear as base64 in the Terraform state file).
*   **Key variable**: `enable_secrets_store_csi_driver`

---

## 5. Traffic & Ingress

### A. GKE Gateway API

Activated when `enable_custom_domain = true` or `enable_cdn = true` (`use_gateway` flag). Replaces the direct `LoadBalancer` service for external traffic.

*   **Gateway class**: `gke-l7-global-external-managed` — a Google-managed Global External L7 load balancer.
*   **TLS termination**: Certificate Manager certificates are provisioned per domain in `application_domains` and associated via a Certificate Map on the Gateway.
*   **HTTPRoute**: Routes traffic from the Gateway to the application Kubernetes Service.
*   **GCPBackendPolicy**: A GKE-native CRD (`networking.gke.io/v1`) attached to the Service that configures IAP, Cloud Armor security policy, and backend timeout in a single resource.
*   **Static IP**: When `reserve_static_ip = true` (default), a Global Static IP is reserved and attached to the Gateway. `static_ip_name` allows a custom name.
*   **Key variables**: `enable_custom_domain`, `application_domains`, `reserve_static_ip`, `static_ip_name`

### B. Cloud CDN

Setting `enable_cdn = true` activates the Gateway API path (`use_gateway = true`), routing all external traffic through the `gke-l7-global-external-managed` load balancer and reserving a Global Static IP. This is a prerequisite for enabling CDN on the underlying backend service.

> **Important**: `GCPBackendPolicy` (the GKE CRD used for IAP and Cloud Armor integration) does **not** support a CDN configuration field. Cloud CDN must be enabled directly on the backend service created by the L7 load balancer, outside of Kubernetes resource management — via the GCP Console or `gcloud compute backend-services update --enable-cdn`.

*   **Key variable**: `enable_cdn`

### C. Static IP Reservation

The module supports two static IP reservation paths depending on whether the Gateway API is active:

*   **Gateway path** (`enable_custom_domain = true` or `enable_cdn = true`): A **Global** static IP (`google_compute_global_address`) is reserved and attached to the Gateway via `addresses[].value`. The address name is auto-generated from the resource prefix or set via `static_ip_name`.
*   **Direct LoadBalancer path** (default, Gateway not active): A **Regional** static IP (`google_compute_address`) is reserved and assigned to the `kubernetes_service_v1` LoadBalancer. The `service_url` output uses this IP directly (e.g. `http://<ip>`).
*   When `reserve_static_ip = false`, the LoadBalancer receives an ephemeral IP assigned by GKE; the `service_url` output falls back to the internal cluster URL until the IP is known.
*   **Key variables**: `reserve_static_ip` (default: `true`), `static_ip_name`

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

When `enable_cicd_trigger = true`, the module creates a Cloud Build v2 trigger connected to a GitHub repository:
*   **GitHub connection**: Authenticated via a Personal Access Token (`github_token`) stored in Secret Manager, or via a GitHub App installation ID (`github_app_installation_id`).
*   **Re-apply safety**: On subsequent applies where `github_token` is not re-provided, the module detects the existing Secret Manager secret and preserves the trigger without destroying it.
*   **Trigger config**: Branch pattern, included/ignored file filters, substitution variables, and trigger name are all configurable via `cicd_trigger_config`.
*   **Service account**: The `cloud_build_sa` service account is granted `roles/container.developer` on the cluster and `roles/iam.serviceAccountUser` to act as the GKE workload SA.

### B. Cloud Deploy Pipeline

When `enable_cloud_deploy = true`, the module generates a full multi-stage delivery pipeline using Google Cloud Deploy:

*   **Stages**: Defined via `cloud_deploy_stages`. Default pipeline is `dev → staging → prod`. Each stage has its own Kubernetes namespace, Service, and Deployment.
*   **Skaffold manifests**: The module generates `skaffold.yaml` and per-stage `k8s-deployment-<stage>.yaml` / `k8s-service-<stage>.yaml` manifests automatically. Job manifests are intentionally excluded — Kubernetes Jobs are immutable and are run exclusively by Terraform to avoid `RELEASE_FAILED` errors.
*   **Stage isolation**: Each stage gets its own namespace, Kubernetes ServiceAccount, and Kubernetes Secret. Terraform provisions these before Cloud Deploy runs so that no hook-based setup is required.
*   **Approval gates**: `require_approval = true` on a stage pauses promotion until a human approves. `auto_promote = true` triggers automatic promotion on success.
*   **Environment variables**: Per-stage env vars (e.g. `DB_NAME`, `DB_USER`) are substituted with stage-namespaced values in the generated manifests.
*   **Key variables**: `enable_cloud_deploy`, `cloud_deploy_stages`

### C. Image Mirroring

The module mirrors container images from external registries into the project's own Artifact Registry before deployment, ensuring GKE nodes pull only from within-project sources.

*   **Application image mirroring**: When `enable_image_mirroring = true` (default), the container image specified in `container_image` is copied into Artifact Registry using Cloud Build before the Kubernetes workload is created. This is the default path for `container_image_source = "prebuilt"` images.
*   **Cloud SQL Auth Proxy mirroring**: The proxy image (`gcr.io/cloud-sql-connectors/cloud-sql-proxy:2-alpine`) is unconditionally mirrored whenever a Cloud SQL server exists and an Artifact Registry repository is available (`sql_server_exists && artifact_repo_id != ""`). This prevents GKE nodes from ever reaching `gcr.io` directly.
*   **VPC-SC benefit**: Both mirroring paths are essential in VPC Service Controls environments where egress to external container registries is blocked at the perimeter.
*   **Key variable**: `enable_image_mirroring` (default: `true`)

---

## 7. Reliability & Scheduling

### A. Pod Disruption Budgets

The module creates a `PodDisruptionBudget` to prevent Kubernetes from evicting too many pods simultaneously during voluntary disruptions (node upgrades, cluster autoscaler activity, drain operations). This is particularly important on GKE Autopilot where node management is fully automated.

*   **Standard deployment**: One PDB is created in the base namespace.
*   **Cloud Deploy**: A separate PDB is created per stage namespace.
*   **`pdb_min_available`**: Accepts an absolute count (`"1"`, `"2"`) or a percentage (`"50%"`). For single-replica workloads, `"1"` keeps the pod alive during node drains. For multi-replica workloads, `"50%"` maintains half the fleet.
*   **Key variables**: `enable_pod_disruption_budget` (default: `true`), `pdb_min_available` (default: `"1"`)

### B. Topology Spread Constraints

When `enable_topology_spread = true`, two `TopologySpreadConstraint` blocks are added to every Deployment and StatefulSet:

| Constraint | Topology key | `maxSkew` | `whenUnsatisfiable` |
|---|---|---|---|
| Zone spread | `topology.kubernetes.io/zone` | 1 | `DoNotSchedule` if `topology_spread_strict = true`, otherwise `ScheduleAnyway` |
| Node spread | `kubernetes.io/hostname` | 1 | Always `ScheduleAnyway` |

*   **Zone spread** ensures pods are distributed evenly across GCP availability zones. `topology_spread_strict = true` blocks scheduling if the zone skew constraint cannot be satisfied — useful for strict HA requirements. The default `ScheduleAnyway` permits scheduling even when the constraint is violated.
*   **Node spread** adds a best-effort distribution across individual nodes, providing additional isolation without blocking scheduling.
*   Both constraints use `app` + `deployment` label selectors to match only pods belonging to this specific deployment.
*   Combined with `enable_pod_disruption_budget` (§7.A), topology spread provides proactive distribution across failure domains and reactive protection during voluntary disruptions.
*   **Key variables**: `enable_topology_spread` (default: `false`), `topology_spread_strict` (default: `false`)

### C. Resource Quotas

When `enable_resource_quota = true`, a `ResourceQuota` is applied to every namespace managed by this module (base namespace and all Cloud Deploy stage namespaces). This prevents a single application from consuming unbounded cluster resources on a shared GKE Autopilot cluster.

**Configurable limits:**

| Variable | Kubernetes field | Example |
|---|---|---|
| `quota_cpu_requests` | `requests.cpu` | `"4"` or `"4000m"` |
| `quota_cpu_limits` | `limits.cpu` | `"8"` |
| `quota_memory_requests` | `requests.memory` | `"4Gi"` |
| `quota_memory_limits` | `limits.memory` | `"8Gi"` |
| `quota_max_pods` | `pods` | `"20"` |
| `quota_max_services` | `services` | `"10"` |
| `quota_max_pvcs` | `persistentvolumeclaims` | `"5"` |

Only fields with non-empty values are included in the quota spec; omitting a field leaves it unconstrained.

### D. Auto Password Rotation

When `enable_auto_password_rotation = true`, the module wires a fully automated database password rotation workflow via `App_Common/modules/app_secrets`:

*   **Mechanism**: A Cloud Run Job (the rotator) and an Eventarc trigger are provisioned. The trigger fires on Secret Manager `SECRET_VERSION_ADD` events and executes the rotator job, which generates a new password, updates the Cloud SQL user, and writes the new version to Secret Manager.
*   **Propagation delay**: `rotation_propagation_delay_sec` (default: `90`) controls how long the rotator waits before disabling the previous secret version, giving running pods time to pick up the new credentials without connection failures.
*   **Networking**: The rotator job runs in the same VPC and subnet as the Cloud SQL instance (`rotation_vpc_network` / `rotation_vpc_subnet`) to connect via private IP.
*   **Rotation schedule**: The frequency is controlled by `secret_rotation_period` (default: `"2592000s"` / 30 days), which configures a Pub/Sub notification on the Secret Manager secret.
*   **Validation**: `enable_auto_password_rotation = true` with `database_type = "NONE"` is rejected at plan time.
*   **Key variables**: `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, `secret_rotation_period`

---

## 8. Integrations

### A. Redis / Memorystore

When `enable_redis = true` (default), the module injects Redis connection details as environment variables into the main workload, all initialization jobs, and all CronJobs.

*   **`REDIS_HOST`**: Set to `redis_host` if provided; falls back to the NFS server's internal IP address when `redis_host` is left blank. This default is convenient for development setups where Redis runs on the same VM as the NFS server.
*   **`REDIS_PORT`**: Set to `redis_port` (default: `"6379"`).
*   **`REDIS_AUTH`**: When `redis_auth` is non-empty, the value is injected as a sensitive environment variable and also stored in the Kubernetes Secret (`explicit_secret_values` path) so it is never logged in Terraform output.
*   **Production use**: Point `redis_host` at a Google Cloud Memorystore for Redis private IP and set `redis_auth` to the instance's auth string.
*   **Key variables**: `enable_redis` (default: `true`), `redis_host`, `redis_port`, `redis_auth` (sensitive)

> **Note**: `enable_redis` defaults to `true`. Deployments that do not use Redis should explicitly set `enable_redis = false` to avoid injecting unused `REDIS_HOST` / `REDIS_PORT` env vars.

### B. Backup Import

When `enable_backup_import = true`, the module runs a `db-import` Kubernetes Job on `terraform apply` that restores a database backup into the Cloud SQL instance before the application starts.

*   **Sources**: `backup_source = "gcs"` reads the backup file from the automatically created backups GCS bucket. `backup_source = "gdrive"` downloads from Google Drive.
*   **File**: `backup_file` specifies the filename within the source (default: `"backup.sql"`). For GCS, the file must already be present in the module-created backups bucket.
*   **Formats**: `backup_format` supports `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, or `auto` (default: `"sql"`). With `auto`, the import script detects the format from the file extension.
*   **Connectivity**: The import job uses the Cloud SQL Auth Proxy sidecar (`--quitquitquit`) for database access and authenticates using the `DB_PASSWORD` / `ROOT_PASSWORD` secrets.
*   **Timeout**: The job allows up to 20 minutes (`create = "20m"`) for large database restores.
*   **Key variables**: `enable_backup_import`, `backup_source`, `backup_file`, `backup_format`

### C. Service Mesh (ASM via Fleet)

Controlled by `configure_service_mesh`. Behaviour differs based on whether the module owns the GKE cluster:

*   **Inline cluster** (`prereq_needs_gke = true`): The module registers the cluster with GKE Fleet Hub (`google_gke_hub_membership`), enables the `servicemesh` Fleet feature, and configures per-cluster membership with `MANAGEMENT_AUTOMATIC`. Required APIs (`gkehub.googleapis.com`, `mesh.googleapis.com`, `meshconfig.googleapis.com`) are enabled automatically.
*   **External cluster** (Services_GCP-provisioned): The namespace label `"istio.io/rev" = "asm-managed"` is applied, which signals to an already-running ASM control plane that it should inject sidecars into pods in this namespace. Full ASM control-plane management is assumed to be handled by Services_GCP.
*   **Key variable**: `configure_service_mesh` (default: `false`)

### D. Multi-Cluster Services (MCS)

Setting `enable_multi_cluster_service = true` enables GKE Multi-Cluster Services for the application namespace. MCS allows Kubernetes Services to be exported from one cluster and consumed by other clusters registered in the same GKE Fleet, enabling cross-cluster service discovery without requiring an external load balancer or custom DNS.

*   **Prerequisites**: All participating clusters must be registered with the same GKE Fleet. Fleet registration is managed by Services_GCP or by the inline ASM provisioning path in this module (§8.C).
*   **DNS**: Exported services become reachable at `<service>.<namespace>.svc.clusterset.local` from any cluster in the fleet.
*   **Use case**: Multi-region deployments where a service in one region must call a service in another region using a stable internal name, without traversing a public load balancer.
*   **Key variable**: `enable_multi_cluster_service`

---

## 9. Inline Infrastructure Provisioning

When no Services_GCP dependency is detected, the module is fully self-contained and provisions its own infrastructure stack. This mode is activated when the discovery scripts find no existing VPC, GKE cluster, NFS server, or Cloud SQL instance in the project.

**Resources provisioned inline:**

| Resource | Terraform resource | Condition |
|---|---|---|
| VPC network + subnets | `google_compute_network`, `google_compute_subnetwork` | No Services_GCP VPC found |
| GKE Autopilot cluster | `google_container_cluster.inline_gke` | `prereq_needs_gke = true` |
| NFS server (GCE VM) | `google_compute_instance` | No existing NFS server found |
| Cloud SQL — PostgreSQL | `google_sql_database_instance.inline_postgres` | `prereq_needs_postgres = true` |
| Cloud SQL — MySQL | `google_sql_database_instance.inline_mysql` | `prereq_needs_mysql = true` |
| ASM via Fleet Hub | `google_gke_hub_membership`, `google_gke_hub_feature` | `configure_service_mesh = true` and inline GKE |

**Startup sequencing**: After the GKE cluster reports `RUNNING`, a `time_sleep` of 90 seconds (`wait_for_gke_api`) ensures the Autopilot control plane is fully reachable before any Kubernetes resources are created. This prevents transient `connection refused` errors during initial cluster warm-up.

**Destroy ordering**: `kubernetes_namespace_v1.app` declares an explicit `depends_on` on `google_container_cluster.inline_gke`. This reverses on destroy so Terraform deletes the namespace (and all Kubernetes resources within it) before deleting the cluster, avoiding `connection refused` errors when the Kubernetes provider loses its API endpoint mid-destroy.

**Override variables**: To target an existing instance rather than provisioning inline, supply the explicit name variables:

| Variable | Default | Purpose |
|---|---|---|
| `sql_instance_name` | `""` | Use a named Cloud SQL instance directly |
| `sql_instance_base_name` | `"app-sql"` | Base name for inline SQL instance |
| `nfs_instance_name` | `""` | Use a named NFS GCE VM directly |
| `nfs_instance_base_name` | `"app-nfs"` | Base name for inline NFS VM |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` | Subnet CIDR for inline GKE cluster |

---

## 10. Variable Reference

Key variables grouped by functional area. All variables are defined in `variables.tf`.

### Core Identity & Project

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | required | GCP project ID for all resources |
| `application_name` | `string` | `"gkeapp"` | Internal app name; used in resource naming |
| `tenant_deployment_id` | `string` | `"demo"` | Deployment environment suffix (e.g. `prod`, `dev`) |
| `resource_labels` | `map(string)` | `{}` | Common labels applied to all resources |

### Compute & Scaling (§3.A)

| Variable | Type | Default | Description |
|---|---|---|---|
| `workload_type` | `string` | `"Deployment"` | `Deployment` or `StatefulSet` |
| `min_instance_count` | `number` | `1` | HPA minimum replicas |
| `max_instance_count` | `number` | `3` | HPA maximum replicas |
| `container_image` | `string` | `""` | Container image URI |
| `container_port` | `number` | `8080` | Port the container listens on |
| `container_resources` | `object` | `{cpu_limit="1000m", memory_limit="512Mi"}` | CPU/memory requests and limits |
| `service_type` | `string` | `"LoadBalancer"` | Kubernetes Service type |
| `enable_vertical_pod_autoscaling` | `bool` | `false` | Enable VPA |
| `deploy_application` | `bool` | `true` | Set `false` to provision infrastructure only |

### Database (§3.B)

| Variable | Type | Default | Description |
|---|---|---|---|
| `database_type` | `string` | `"POSTGRES"` | `POSTGRES`, `MYSQL`, or `NONE` |
| `application_database_name` | `string` | `"gkeappdb"` | Cloud SQL database name |
| `application_database_user` | `string` | `"gkeappuser"` | Cloud SQL user |
| `enable_cloudsql_volume` | `bool` | `true` | Inject Cloud SQL Auth Proxy sidecar |
| `sql_instance_name` | `string` | `""` | Target an existing Cloud SQL instance by name |

### Storage (§3.C)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_nfs` | `bool` | `true` | Enable NFS (Filestore) mount |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | Mount path inside container |
| `create_cloud_storage` | `bool` | `true` | Create GCS buckets |
| `storage_buckets` | `list(object)` | `[{name_suffix="data"}]` | Bucket configurations |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts |

### Networking (§3.D)

| Variable | Type | Default | Description |
|---|---|---|---|
| `gke_cluster_selection_mode` | `string` | `"primary"` | `primary`, `explicit`, or `round-robin` |
| `gke_cluster_name` | `string` | `""` | Explicit cluster name (for `explicit` mode) |
| `enable_network_segmentation` | `bool` | `false` | Enable Kubernetes NetworkPolicies |
| `namespace_name` | `string` | `""` | Kubernetes namespace (auto-generated if empty) |

### Advanced Security (§4)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | `bool` | `false` | Create inline Cloud Armor WAF policy |
| `admin_ip_ranges` | `list(string)` | `[]` | IP ranges that bypass WAF rules |
| `cloud_armor_policy_name` | `string` | `"default-waf-policy"` | External policy name (when not inline) |
| `enable_iap` | `bool` | `false` | Enable Identity-Aware Proxy |
| `iap_oauth_client_id` | `string` | `""` | OAuth 2.0 client ID (sensitive) |
| `iap_oauth_client_secret` | `string` | `""` | OAuth 2.0 client secret (sensitive) |
| `iap_authorized_users` | `list(string)` | `[]` | IAP user allowlist |
| `iap_authorized_groups` | `list(string)` | `[]` | IAP group allowlist |
| `enable_binary_authorization` | `bool` | `false` | Enforce Binary Authorization |
| `binauthz_evaluation_mode` | `string` | `"ALWAYS_ALLOW"` | `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, or `ALWAYS_DENY` |
| `enable_secrets_store_csi_driver` | `bool` | `false` | Fetch secrets via CSI driver (keeps values out of state) |

### Traffic & Ingress (§5)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_custom_domain` | `bool` | `false` | Enable Gateway API + Certificate Manager |
| `application_domains` | `list(string)` | `[]` | Hostnames for TLS certificates |
| `enable_cdn` | `bool` | `false` | Activate Gateway API path for CDN |
| `reserve_static_ip` | `bool` | `true` | Reserve a static IP address |
| `static_ip_name` | `string` | `""` | Custom name for the static IP |

### CI/CD & Delivery (§6)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | `bool` | `false` | Create Cloud Build trigger |
| `github_repository_url` | `string` | `""` | GitHub repository URL |
| `github_token` | `string` | `""` | GitHub PAT for repository access (sensitive) |
| `cicd_trigger_config` | `object` | `{branch_pattern="^main$"}` | Branch, file filters, substitutions |
| `enable_cloud_deploy` | `bool` | `false` | Enable Cloud Deploy pipeline |
| `cloud_deploy_stages` | `list(object)` | `[dev, staging, prod]` | Pipeline stage definitions |
| `enable_image_mirroring` | `bool` | `true` | Mirror container images to Artifact Registry |

### Reliability & Scheduling (§7)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | `bool` | `true` | Create PodDisruptionBudget |
| `pdb_min_available` | `string` | `"1"` | Minimum available pods (integer or percentage) |
| `enable_topology_spread` | `bool` | `false` | Add zone and node spread constraints |
| `topology_spread_strict` | `bool` | `false` | Use `DoNotSchedule` for zone constraint |
| `enable_resource_quota` | `bool` | `false` | Apply ResourceQuota to all namespaces |
| `quota_cpu_requests` | `string` | `""` | Total CPU requests limit |
| `quota_memory_requests` | `string` | `""` | Total memory requests limit |
| `quota_max_pods` | `string` | `""` | Maximum pod count |
| `enable_auto_password_rotation` | `bool` | `false` | Enable automated DB password rotation |
| `rotation_propagation_delay_sec` | `number` | `90` | Seconds to wait before disabling old secret version |
| `secret_rotation_period` | `string` | `"2592000s"` | Rotation frequency (default: 30 days) |

### Integrations (§8)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `true` | Inject `REDIS_HOST` / `REDIS_PORT` env vars |
| `redis_host` | `string` | `""` | Redis host (defaults to NFS server IP if blank) |
| `redis_port` | `string` | `"6379"` | Redis port |
| `redis_auth` | `string` | `""` | Redis auth string (sensitive) |
| `enable_backup_import` | `bool` | `false` | Run DB import job on apply |
| `backup_source` | `string` | `"gcs"` | `gcs` or `gdrive` |
| `backup_file` | `string` | `"backup.sql"` | Filename of backup to import |
| `backup_format` | `string` | `"sql"` | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, or `auto` |
| `configure_service_mesh` | `bool` | `false` | Enable ASM / Fleet Hub integration |
| `enable_multi_cluster_service` | `bool` | `false` | Enable GKE Multi-Cluster Services |
