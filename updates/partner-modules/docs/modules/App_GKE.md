# App_GKE on Google Cloud Platform

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

**Required versions** (`versions.tf`):

| Tool / Provider | Constraint | Why |
|---|---|---|
| Terraform / OpenTofu | `>= 1.5.0` | `optional()` in object variables, `terraform_data`, `check{}`, `sensitive()` semantics |
| `hashicorp/google` | `>= 6.0.0` | Cloud Deploy v2, GKE Gateway API, Binary Authorization, Workload Identity schema |
| `hashicorp/google-beta` | `~> 6.0` | Matches google for beta-only Cloud Service Mesh / Fleet resources |
| `hashicorp/kubernetes` | `>= 2.25.0` | `kubernetes_manifest` with server-side CRD validation |
| `hashicorp/random` | `>= 3.0.0` | Random ID generation for resource naming |
| `hashicorp/external` | `>= 2.0.0` | Discovery scripts and CSI driver CRD probe |
| `hashicorp/null` | `>= 3.0.0` | IAM propagation waits and addon enablement triggers |
| `integrations/github` | `>= 5.0.0` | Cloud Build v2 GitHub connection |

---

## 2. IAM & Access Control

The module implements a least-privilege IAM strategy using dedicated Service Accounts and Workload Identity. IAM bindings are managed directly in `prerequisites.tf`. A `time_sleep` of 120 seconds (`cloudbuild_iam_propagation`) gates Cloud Build builds on IAM propagation to prevent `storage.objects.get denied` errors before the Storage Admin binding has reached GCP's storage backend. The GKE workload SA (`gke-sa-*`) and Cloud Build SA (`gke-build-sa-*`) are created unconditionally (`count = 1`) on every deployment, regardless of whether a Services_GCP network is present. The NFS SA and inline GKE node SA are conditional on whether those inline resources are needed.

### Service Accounts

1.  **GKE Workload Service Account** (`gke_sa`, format: `gke-sa-<random_id>`):
    *   **Identity**: The GCP identity bound to the Kubernetes Service Account via Workload Identity.
    *   Project-level roles: `roles/compute.networkUser`, `roles/secretmanager.secretAccessor`, `roles/storage.objectUser`, `roles/storage.objectAdmin`, `roles/cloudsql.client`, `roles/vpcaccess.user`, `roles/container.developer`, `roles/logging.logWriter`, `roles/monitoring.metricWriter`.

2.  **Cloud Build Service Account** (`cloud_build_sa`, format: `gke-build-sa-<random_id>`):
    *   **Identity**: Used by Cloud Build triggers for CI/CD.
    *   Project-level roles: `roles/secretmanager.secretAccessor`, `roles/cloudbuild.builds.editor`, `roles/viewer`, `roles/storage.objectAdmin`, `roles/artifactregistry.reader`, `roles/artifactregistry.writer`, `roles/container.admin`, `roles/iam.serviceAccountUser`, `roles/clouddeploy.operator`, `roles/logging.logWriter`, `roles/run.admin`, `roles/iam.serviceAccountTokenCreator`.
    *   **`roles/secretmanager.secretAccessor`** on the GitHub token secret (granted to three principals: the user-managed Cloud Build SA, the default Cloud Build service account, and the Cloud Build service agent `service-<project_number>@gcp-sa-cloudbuild.iam.gserviceaccount.com`).

3.  **Inline NFS Service Account** (`inline_nfs_sa`, format: `app-nfs-sa-<random_id>`):
    *   Created when no existing NFS server is found (`prereq_needs_nfs = true`).
    *   Roles: `roles/storage.objectAdmin`, `roles/logging.logWriter`, `roles/compute.instanceAdmin.v1`.

4.  **Inline GKE Node Service Account** (`inline_gke_sa`, format: `app-gke-sa-<random_id>`):
    *   Created when no existing GKE cluster is found (`prereq_needs_gke = true`).
    *   Roles: `roles/logging.logWriter`, `roles/monitoring.metricWriter`, `roles/monitoring.viewer`, `roles/stackdriver.resourceMetadata.writer`, `roles/artifactregistry.reader`, `roles/storage.objectViewer`.

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
*   **Rollout timeouts**: `deployment_timeout` (default `1800` seconds) controls how long Terraform waits for the Deployment/StatefulSet rollout during apply. Applied to `create`, `update`, and `delete` timeout blocks — raise for large images or slow-starting pods.
*   **Null-default override pattern**: Variables such as `workload_type`, `pdb_min_available`, `stateful_pvc_*`, and `container_resources` default to `null` rather than sentinel values. The module's `modules.tf` uses `!= null` checks so wrapper modules can explicitly pass the module-preset value without it being mistaken for "unset". Note that `min_instance_count` (default `1`) and `max_instance_count` (default `3`) do **not** default to `null`.

### B. Database (Cloud SQL)
*   **Discovery & Provisioning**: The module first runs a discovery script to locate an existing Cloud SQL instance in the project. If one is found it is used directly. If none is found, an **inline instance** is provisioned automatically — PostgreSQL via `google_sql_database_instance.inline_postgres` or MySQL via `google_sql_database_instance.inline_mysql` — along with a root password stored in Secret Manager.
*   **Connectivity**:
    *   **Cloud SQL Auth Proxy**: Runs as a sidecar container in each pod, exposing the database on `127.0.0.1`. The Unix socket mount path inside the container is configurable via `cloudsql_volume_mount_path` (default `/cloudsql`).
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
| 100 | Allow | Admin IP ranges bypass (`admin_ip_ranges`) — **only added when `admin_ip_ranges` is non-empty** |
| 1000 | Deny (403) | SQLi — `sqli-v33-stable` |
| 1001 | Deny (403) | XSS — `xss-v33-stable` |
| 1002 | Deny (403) | LFI — `lfi-v33-stable` |
| 1003 | Deny (403) | RCE — `rce-v33-stable` |
| 2000 | Deny (429) + ban | 500 req/min per IP; HTTP 429 on exceed; 300-second (5-minute) ban duration |
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

When `enable_vpc_sc = true`, the module provisions a full VPC-SC perimeter around the project's GCP APIs via `module.vpc_sc` (`App_Common/modules/app_vpc_sc`) — Services_GCP is not required. Two additional VPC-SC-friendly behaviours are present unconditionally:

1.  **Cloud SQL Auth Proxy image mirroring** (always active when a SQL server and Artifact Registry exist): The proxy image (`gcr.io/cloud-sql-connectors/cloud-sql-proxy:${cloud_sql_proxy_version}`) is mirrored into the project's own Artifact Registry so GKE nodes never pull from `gcr.io` (an out-of-project registry blocked by a VPC-SC perimeter). The tag is configurable via `cloud_sql_proxy_version` (default `"2-alpine"`).
2.  **VPC-SC compliant NetworkPolicy egress** (always present when `enable_network_segmentation = true`): Egress rules include `199.36.153.4/30` (`restricted.googleapis.com`) and `199.36.153.8/30` (`private.googleapis.com`) — the recommended Private Google Access endpoints for GCP APIs inside a VPC-SC perimeter.

**Perimeter provisioning (when `enable_vpc_sc = true`):**

*   **Organization auto-discovery**: Reads the project's `org_id`; falls back to `var.organization_id` for folder-nested projects. Standalone projects (e.g. Qwiklab) emit a warning and skip the perimeter automatically.
*   **Access levels** (four, all suffixed with `deployment_id`): VPC network access (from `vpc_cidr_ranges` or auto-discovered from the discovered network), admin IP ranges (`admin_ip_ranges`), IAP service agent, and CI/CD (Cloud Build SA + `resource_creator_identity`).
*   **Perimeter**: `PERIMETER_TYPE_REGULAR` restricting Cloud Run, GKE, Cloud SQL, Secret Manager, Storage, Artifact Registry, Cloud Build, Certificate Manager, IAP, Compute, KMS, Pub/Sub, Redis, Filestore, and Firestore.
*   **Dry-run mode**: `vpc_sc_dry_run = true` (default) logs violations without enforcing them. Set to `false` to actively block out-of-perimeter API calls after validating the dry-run logs.
*   **Auto-skip**: No resources are created when the project has no organization, when it is folder-nested without an explicit `organization_id`, or when `admin_ip_ranges` is empty (lockout protection). Each case emits a `null_resource` warning with remediation guidance.

*   **Key variables**: `enable_vpc_sc`, `vpc_sc_dry_run`, `vpc_cidr_ranges`, `organization_id`, `admin_ip_ranges`

### E. Secrets Store CSI Driver

Secrets are always fetched from Secret Manager and mounted into pods at start time by the GKE-managed Secrets Store CSI Driver — secret values are **never written to Terraform state**.

*   **Driver name**: The GKE managed addon uses the driver name **`secrets-store-gke.csi.k8s.io`** with provider `"gke"`. This is distinct from the community `secrets-store.csi.k8s.io` driver — using the wrong driver name causes `CSIDriver not found` errors at pod creation.
*   **Cluster enablement**: Services_GCP enables the addon via `null_resource.configure_gke_addons` using `gcloud container clusters update --enable-secret-manager`. For inline clusters (no Services_GCP), App_GKE runs the same `gcloud` command in `null_resource.enable_secret_manager_addon`. A **separate** `null_resource.enable_secret_sync_addon` then runs `gcloud beta container clusters update --enable-secret-sync` (requires GKE 1.33+) to install the Secret Manager Sync controller that materialises native Kubernetes Secrets from CSI-mounted files.
*   **120 s propagation wait**: `time_sleep.wait_for_secret_manager_addon` blocks for 120 seconds after the addon is enabled so the CSI driver DaemonSet is ready on every Autopilot node before `SecretProviderClass` resources are applied.
*   **Plan-time CRD guard**: `data.external.csi_driver_crd_installed` probes the live cluster using `kubectl get crd secretproviderclasses.secrets-store.csi.x-k8s.io`. When the CRD is absent, `SecretProviderClass` and `SecretSync` resources are excluded from the plan (`count = csi_driver_crd_ready && sm_backed_secret_count > 0 ? 1 : 0`). A second apply materialises them.
*   **`sm_backed_secret_count`**: Counts secrets that must be backed by the CSI driver (i.e. not preset "explicit" values). The filter uses **key-based exclusion** (`!contains(keys(local.preset_explicit_secret_values), k)`) rather than value comparison (`v != "explicit"`). This is required because the DB_PASSWORD value flows through `random_id.wrapper_deployment.hex` — an attribute unknown at plan time — making any value-comparison expression unknown, which breaks `count`/`for_each`. Filtering by key is always plan-time-safe.
*   **SecretProviderClass (base + per stage)**: A base `SecretProviderClass` is created in the application namespace, plus one per Cloud Deploy stage (`${service_name}-${stage}-secrets`). Each maps every entry in `secret_environment_variables` to a Secret Manager secret version with files written to the CSI volume.
*   **Native Kubernetes Secrets via SecretSync**: The GKE managed addon does **not** support the `secretObjects` field in `SecretProviderClass`. Instead, a `SecretSync` resource (`secrets-store.csi.x-k8s.io/v1alpha1`) is created alongside each SPC. The `SecretSync` controller watches the CSI-mounted files and syncs their content into a native Kubernetes `Secret`. Pods reference the standard K8s Secret via `envFrom` / `valueFrom` as normal.
*   **Drift suppression**: In google provider ≥ 7.x, `secret_manager_config` moved from `addons_config` to a top-level cluster block. The inline cluster resource now declares `secret_manager_config { enabled = true }` explicitly, so it is no longer in `ignore_changes`. `addons_config` remains in `ignore_changes` to suppress drift on legacy clusters provisioned with an older provider version. The overall effect is that spurious empty-mask PATCH requests (rejected by GKE with `400 Must specify a field to update`) are avoided.
*   **CSI driver readiness check**: `null_resource.wait_for_csi_driver_registered` runs on every apply (via `always_run = timestamp()` trigger) and blocks until the CSIDriver object (`secrets-store-gke.csi.k8s.io` or the community variant) is registered and all related DaemonSets in `kube-system` have rolled out, ensuring no workload mounts a secrets-store volume before the kubelet has registered the driver.

### F. Audit Logging

When `enable_audit_logging = true`, the module enables Cloud Audit Logs beyond the default `ADMIN_WRITE`:

*   **`google_project_iam_audit_config.all_services`**: Captures `ADMIN_READ`, `DATA_READ`, and `DATA_WRITE` for all GCP services used by the project.
*   **Per-service overrides**: Secret Manager and Cloud KMS receive explicit `DATA_READ` / `DATA_WRITE` configs so sensitive secret and key access is always logged even if `allServices` is tuned down elsewhere.
*   **Equivalent to `Services_GCP enable_audit_logging = true`** — safe to enable at any point; does not affect running workloads. Increases Cloud Logging storage costs.
*   **Key variable**: `enable_audit_logging` (default `false`)

---

## 5. Traffic & Ingress

### A. GKE Gateway API

Activated when `enable_custom_domain = true` or `enable_cdn = true` (`use_gateway` flag). Replaces the direct `LoadBalancer` service for external traffic.

*   **Gateway class**: `gke-l7-global-external-managed` — a Google-managed Global External L7 load balancer.
*   **TLS termination**: Certificate Manager certificates are provisioned per domain in `application_domains` and associated via a Certificate Map on the Gateway.
*   **HTTPRoute**: Routes traffic from the Gateway to the application Kubernetes Service.
*   **GCPBackendPolicy**: A GKE-native CRD (`networking.gke.io/v1`) attached to the Service that configures IAP, Cloud Armor security policy, and backend timeout in a single resource.
*   **Static IP**: When `reserve_static_ip = true` (default), a Global Static IP is reserved and attached to the Gateway. `static_ip_name` allows a custom name.
*   **Cloud Deploy Gateway backend** (`gateway_backend_stage`): When `enable_cloud_deploy = true`, the HTTPRoute backend must target a single stage's Service. The `gateway_backend_stage` variable (default `"dev"`) controls which stage's Service and namespace the HTTPRoute points to. Change this to route external traffic to `staging` or `prod` once those stages are promoted. When `enable_cloud_deploy = false`, this variable is ignored and the HTTPRoute targets the base application Service directly.
*   **Namespace dependency**: `kubernetes_manifest.gateway`, `kubernetes_manifest.gateway_backend_reference_grant`, and `kubernetes_manifest.backend_policy` all declare `depends_on = [kubernetes_namespace_v1.app]`. This ensures the namespace exists before Gateway API CRDs are applied — without this, the Kubernetes API server rejects the manifests with a "namespace not found" error on the first apply.
*   **Key variables**: `enable_custom_domain`, `application_domains`, `reserve_static_ip`, `static_ip_name`, `gateway_backend_stage`

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
*   **Stage isolation**: Each stage gets its own namespace, Kubernetes ServiceAccount, Kubernetes Secret, and per-stage `SecretProviderClass` (`${service_name}-${stage}-secrets`). Terraform provisions these before Cloud Deploy runs so that no hook-based setup is required.
*   **Stage initialization jobs**: When `sm_backed_secret_count > 0`, `stage_initialization_jobs` mount the Secrets Store CSI volume against the stage-specific `SecretProviderClass` so the Kubernetes Secret referenced by each job's `secretKeyRef` is materialized at pod start time. Without this mount the CSI driver never runs and pods fail with `CreateContainerConfigError: secret not found`.
*   **Rollout ownership**: `kubernetes_deployment_v1.app_cd` (the placeholder Deployment Cloud Deploy targets) is created with `wait_for_rollout = false` so Terraform does not block waiting for pods that Cloud Deploy — not Terraform — is responsible for rolling out.
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

*   **Mechanism**: A Kubernetes CronJob (the rotator) and an Eventarc trigger are provisioned. The trigger fires on Secret Manager `SECRET_VERSION_ADD` events and executes the rotator job, which generates a new password, updates the Cloud SQL user, and writes the new version to Secret Manager.
*   **Propagation delay**: `rotation_propagation_delay_sec` (default: `90`) controls how long the rotator waits before disabling the previous secret version, giving running pods time to pick up the new credentials without connection failures.
*   **Networking**: The rotator job is wired to the same VPC and subnet as the Cloud SQL instance (resolved from locally computed `rotation_vpc_network` / `rotation_vpc_subnet` — not exposed as input variables) to connect via private IP.
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
| Cloud Router + Cloud NAT | `google_compute_router`, `google_compute_router_nat` | No Services_GCP VPC found |
| GKE Autopilot cluster | `google_container_cluster.inline_gke` | `prereq_needs_gke = true` |
| NFS server (GCE MIG) | `google_compute_instance_group_manager` + `google_compute_instance_template` | No existing NFS server found (`prereq_needs_nfs = true`) |
| Cloud SQL — PostgreSQL | `google_sql_database_instance.inline_postgres` | `prereq_needs_postgres = true` |
| Cloud SQL — MySQL | `google_sql_database_instance.inline_mysql` | `prereq_needs_mysql = true` |
| ASM via Fleet Hub | `google_gke_hub_membership`, `google_gke_hub_feature` | `configure_service_mesh = true` and inline GKE |
| PSA connection | `null_resource.inline_psa` (via `gcloud services vpc-peerings connect`) | No Services_GCP VPC found |
| PSA subnet-route export | `null_resource.inline_psa_subnet_routes` | No Services_GCP VPC found |
| Service Networking service agent | `google_project_service_identity.servicenetworking_sa`, `google_project_iam_member.servicenetworking_service_agent` | No Services_GCP VPC found (PSA connection required) |

**Startup sequencing**: After the GKE cluster reports `RUNNING`, a `time_sleep` of 90 seconds (`wait_for_gke_api`) ensures the Autopilot control plane is fully reachable before any Kubernetes resources are created. This prevents transient `connection refused` errors during initial cluster warm-up.

**Inline NFS server**: Deployed as a Managed Instance Group (MIG) rather than a standalone VM, providing auto-healing and rolling replacement. Includes:
*   **Instance template** (`google_compute_instance_template.inline_nfs_server`): Ubuntu 22.04 LTS, `e2-small`, 10 GB boot disk + 10 GB SSD data disk, tagged `nfsserver` and `redisserver`.
*   **Snapshot schedule** (`google_compute_resource_policy.inline_nfs_snapshot`): Daily snapshots retained for 7 days.
*   **Static internal IP** (`google_compute_address.inline_nfs_ip`): Ensures the NFS IP remains stable across MIG instance replacements.
*   **Auto-healing**: MIG health checks on ports 2049 (NFS) and 6379 (Redis). `initial_delay_sec = 720` allows time for apt-get install on constrained VMs before the first health-check failure can trigger an auto-heal cycle.
*   **Firewall rules**: `app-allow-nfs-*` (TCP 111/2049 from subnet/pod CIDRs), `app-allow-nfs-hc-*` (TCP 2049 from GCP health-check probers `35.191.0.0/16`, `130.211.0.0/22`), `app-allow-redis-*` (TCP 6379), and `app-allow-iap-ssh-*` (TCP 22 from `35.235.240.0/20`) for SSH-in-browser access.

**PSA service agent**: GCP auto-grants `roles/servicenetworking.serviceAgent` when `servicenetworking.googleapis.com` is enabled, but the grant is asynchronous and can lag beyond the 60 s API-enablement wait on fresh projects. The module explicitly provisions `google_project_service_identity.servicenetworking_sa` and then grants `google_project_iam_member.servicenetworking_service_agent` before `null_resource.inline_psa` (the PSA connection resource — see below) is created, eliminating the race condition.

**`prereq_sql_network_self_link`**: A local that resolves the correct VPC self-link for inline Cloud SQL Private Service Access. When Services_GCP is deployed, its discovered network is used; otherwise the inline VPC is referenced. This prevents an "invalid index" error when deploying into a Services_GCP project where `google_compute_network.inline_vpc` is never created.

**Destroy ordering**: `kubernetes_namespace_v1.app` declares an explicit `depends_on` on `google_container_cluster.inline_gke`. This reverses on destroy so Terraform deletes the namespace (and all Kubernetes resources within it) before deleting the cluster, avoiding `connection refused` errors when the Kubernetes provider loses its API endpoint mid-destroy.

**PSA connection**: The PSA connection to `servicenetworking.googleapis.com` is established via `null_resource.inline_psa` using `gcloud services vpc-peerings connect`. The old `google_service_networking_connection` resource was replaced because the Terraform provider issues a READ on every plan, which VPC-SC perimeters block. A `removed` block in the code drops any lingering state entry without destroying the actual peering. A second `null_resource.inline_psa_subnet_routes` then calls `gcloud compute networks peerings update --export-subnet-routes-with-public-ip` so GKE pod CIDR routes are advertised to the Cloud SQL producer VPC.

**Drift suppression on `google_container_cluster.inline_gke`**: The resource's `lifecycle.ignore_changes` list covers every block modified out-of-band by GKE or not yet in the provider schema:

| Block | Reason |
|---|---|
| `datapath_provider` | Dataplane V2 is selected at create time and cannot be mutated safely |
| `addons_config` | Retained for legacy clusters; in google provider ≥ 7.x `secret_manager_config` is now a top-level block declared explicitly in the resource |
| `cluster_autoscaling` | GKE fills in default NAP values after creation |
| `master_authorized_networks_config` | Commonly adjusted by platform operators via `gcloud` |
| `gateway_api_config` | Auto-enabled when the Gateway API is first used |
| `vertical_pod_autoscaling` | Autopilot toggles VPA status based on usage |
| `ip_allocation_policy` | GCP rewrites secondary range references after cluster bootstrap |

Note: `secret_manager_config` is **not** in `ignore_changes` — it is now declared explicitly as a top-level block (`secret_manager_config { enabled = true }`) on the cluster resource, aligning Terraform desired state with the live cluster.

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

### Module Metadata (Platform)

These variables are consumed by the platform UI / billing system and do not affect deployed resources.

| Variable | Type | Default | Description |
|---|---|---|---|
| `module_description` | `string` | (long default) | Human-readable description of the module's purpose |
| `module_documentation` | `string` | `"https://docs.radmodules.dev/docs/applications/gke-app"` | URL to external documentation |
| `module_dependency` | `list(string)` | `["Services_GCP"]` | Other modules that must be deployed first |
| `module_services` | `list(string)` | (long list) | GCP services consumed by this module |
| `credit_cost` | `number` | `100` | Platform credits consumed on deployment |
| `require_credit_purchases` | `bool` | `true` | Enforce credit balance check before deployment |
| `enable_purge` | `bool` | `true` | Permit full deletion of resources on destroy |
| `public_access` | `bool` | `false` | Make the module publicly visible in the platform catalogue |

### Core Identity & Project

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | required | GCP project ID for all resources |
| `application_name` | `string` | `"gkeapp"` | Internal app name; used in resource naming |
| `application_display_name` | `string` | `"App_GKE Application"` | Human-readable name shown in UI and dashboards |
| `application_description` | `string` | `"App_GKE Custom Application..."` | Brief description of the application's purpose |
| `application_version` | `string` | `"1.0.0"` | Version tag applied to the container image |
| `tenant_deployment_id` | `string` | `"demo"` | Deployment environment suffix (e.g. `prod`, `dev`) |
| `deployment_id` | `string` | `""` | Optional deployment ID; auto-generated if empty |
| `support_users` | `list(string)` | `[]` | Email addresses of monitoring alert recipients |
| `resource_labels` | `map(string)` | `{}` | Common labels applied to all resources |
| `fallback_region` | `string` | `"us-central1"` | GCP region used when no Services_GCP subnet mapping can be auto-discovered |
| `impersonation_service_account` | `string` | `""` | Service account email to impersonate in discovery / mirror scripts (cross-project deployments) |
| `resource_creator_identity` | `string` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Service account used by Terraform to create resources |
| `explicit_secret_values` | `map(string)` | `{}` | Raw secret values provided directly by a wrapper module; bypasses plan-time Secret Manager lookups |
| `scripts_dir` | `string` | `""` | Path to initialisation scripts directory; defaults to module's built-in scripts |

### Compute & Scaling (§3.A)

| Variable | Type | Default | Description |
|---|---|---|---|
| `workload_type` | `string` | `null` | `Deployment` or `StatefulSet` — `null` falls through to the module preset |
| `min_instance_count` | `number` | `1` | HPA minimum replicas |
| `max_instance_count` | `number` | `3` | HPA maximum replicas |
| `container_image` | `string` | `""` | Container image URI |
| `container_image_source` | `string` | `"custom"` | `prebuilt` (use `container_image` directly) or `custom` (build from source) |
| `container_build_config` | `object` | `{enabled=true}` | Cloud Build configuration for `custom` source (Dockerfile, context, build args, repo) |
| `container_port` | `number` | `8080` | Port the container listens on |
| `container_protocol` | `string` | `"http1"` | HTTP protocol version: `http1` or `h2c` (gRPC) |
| `container_resources` | `object` | `{cpu_limit="1000m", memory_limit="512Mi"}` | CPU/memory requests and limits; also accepts `ephemeral_storage_limit/request` |
| `timeout_seconds` | `number` | `300` | Load balancer backend timeout in seconds (0–3600) |
| `service_type` | `string` | `"LoadBalancer"` | Kubernetes Service type |
| `service_annotations` | `map(string)` | `{}` | Custom annotations applied to the Kubernetes Service |
| `service_labels` | `map(string)` | `{}` | Custom labels applied to the Kubernetes Service |
| `session_affinity` | `string` | `"ClientIP"` | Kubernetes Service session affinity: `None` or `ClientIP` |
| `termination_grace_period_seconds` | `number` | `60` | Pod termination grace period in seconds (0–3600) |
| `enable_vertical_pod_autoscaling` | `bool` | `false` | Enable VPA |
| `deploy_application` | `bool` | `true` | Set `false` to provision infrastructure only |
| `deployment_timeout` | `number` | `1800` | Seconds Terraform waits for rollout during apply (create/update/delete) |

### StatefulSet Configuration (§3.A)

| Variable | Type | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | `bool` | `null` | Enable PVC provisioning for StatefulSet workloads |
| `stateful_pvc_size` | `string` | `null` | PVC size (e.g. `"20Gi"`) |
| `stateful_pvc_mount_path` | `string` | `null` | Mount path inside container (e.g. `"/var/lib/data"`) |
| `stateful_pvc_storage_class` | `string` | `null` | Kubernetes StorageClass (e.g. `"standard-rwo"`) |
| `stateful_headless_service` | `bool` | `null` | Create a headless Service for stable pod DNS |
| `stateful_pod_management_policy` | `string` | `null` | `OrderedReady` or `Parallel` |
| `stateful_update_strategy` | `string` | `null` | `RollingUpdate` or `OnDelete` |
| `stateful_fs_group` | `number` | `null` | GID set as pod-level `fsGroup` in the security context; Kubernetes chowns PVC mount to this GID on attach |

### Database (§3.B)

| Variable | Type | Default | Description |
|---|---|---|---|
| `database_type` | `string` | `"POSTGRES"` | `POSTGRES`, `MYSQL`, `SQLSERVER`, or `NONE` |
| `application_database_name` | `string` | `"gkeappdb"` | Cloud SQL database name |
| `application_database_user` | `string` | `"gkeappuser"` | Cloud SQL user |
| `enable_cloudsql_volume` | `bool` | `true` | Inject Cloud SQL Auth Proxy sidecar |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | Filesystem path inside the container where the Cloud SQL Auth Proxy Unix socket is mounted |
| `cloud_sql_proxy_version` | `string` | `"2-alpine"` | Tag for the Cloud SQL Auth Proxy sidecar image (mirrored into Artifact Registry) |
| `sql_instance_name` | `string` | `""` | Target an existing Cloud SQL instance by name |
| `database_password_length` | `number` | `32` | Length of the generated DB password (16–64) |
| `db_password_env_var_name` | `string` | `""` | Additional env var name alongside `DB_PASSWORD` for apps that expect a non-standard name (e.g. `"WORDPRESS_DB_PASSWORD"`) |
| `enable_postgres_extensions` | `bool` | `false` | Enable installation of PostgreSQL extensions after DB provisioning |
| `postgres_extensions` | `list(string)` | `[]` | PostgreSQL extensions to install (e.g. `['postgis', 'uuid-ossp']`) |
| `enable_mysql_plugins` | `bool` | `false` | Enable installation of MySQL plugins after DB provisioning |
| `mysql_plugins` | `list(string)` | `[]` | MySQL plugins to install (e.g. `['audit_log']`) |

### Storage (§3.C)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_nfs` | `bool` | `true` | Enable NFS (Filestore) mount |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | Mount path inside container |
| `nfs_volume_name` | `string` | `"nfs-data-volume"` | Kubernetes Volume name for the NFS mount — override when mounting a second NFS share alongside the first |
| `create_cloud_storage` | `bool` | `true` | Create GCS buckets |
| `storage_buckets` | `list(object)` | `[]` | Bucket configurations |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts |
| `manage_storage_kms_iam` | `bool` | `false` | Create a CMEK KMS keyring and GCS encryption key, grant the GCS service account encrypter/decrypter, and enable CMEK on all storage buckets |
| `enable_artifact_registry_cmek` | `bool` | `false` | Create an Artifact Registry KMS key in the project CMEK keyring and enable at-rest encryption of container images |

### Networking (§3.D)

| Variable | Type | Default | Description |
|---|---|---|---|
| `gke_cluster_selection_mode` | `string` | `"primary"` | `primary`, `explicit`, or `round-robin` |
| `gke_cluster_name` | `string` | `""` | Explicit cluster name (for `explicit` mode) |
| `network_name` | `string` | `""` | Name of the VPC network to use. Leave empty to auto-discover a single Services_GCP-managed network |
| `network_tags` | `list(string)` | `["nfsserver"]` | Network tags applied to GKE nodes and pods for firewall targeting |
| `enable_network_segmentation` | `bool` | `false` | Enable Kubernetes NetworkPolicies (also sets `ADVANCED_DATAPATH` on inline clusters) |
| `namespace_name` | `string` | `""` | Kubernetes namespace (auto-generated if empty) |
| `prereq_gke_subnet_cidr` | `string` | `"10.201.0.0/24"` | Subnet CIDR for the GKE subnet when a Services_GCP VPC exists but no GKE cluster is present |
| `prereq_subnet_cidr_override` | `string` | `""` | Override for the inline VPC primary subnet CIDR (pin to previously-applied value to avoid replacement) |
| `prereq_gke_pod_cidr_override` | `string` | `""` | Override for the inline GKE pod secondary range CIDR |
| `prereq_gke_service_cidr_override` | `string` | `""` | Override for the inline GKE service secondary range CIDR |

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
| `enable_vpc_sc` | `bool` | `false` | Provision a VPC Service Controls perimeter (see §4.D) |
| `vpc_sc_dry_run` | `bool` | `true` | Log perimeter violations without blocking (flip to `false` to enforce) |
| `vpc_cidr_ranges` | `list(string)` | `[]` | Explicit VPC CIDR ranges for the perimeter access level (auto-discovered when empty) |
| `organization_id` | `string` | `""` | GCP Organization ID — required for folder-nested projects |
| `enable_audit_logging` | `bool` | `false` | Enable `ADMIN_READ`/`DATA_READ`/`DATA_WRITE` audit logs plus Secret Manager / KMS overrides |

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
| `github_app_installation_id` | `string` | `""` | GitHub App installation ID (preferred for org-level repos; token used only as authorizer credential) |
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
| `quota_cpu_limits` | `string` | `""` | Total CPU limits cap |
| `quota_memory_requests` | `string` | `""` | Total memory requests limit |
| `quota_memory_limits` | `string` | `""` | Total memory limits cap |
| `quota_max_pods` | `string` | `""` | Maximum pod count |
| `enable_auto_password_rotation` | `bool` | `false` | Enable automated DB password rotation |
| `rotation_propagation_delay_sec` | `number` | `90` | Seconds to wait before disabling old secret version |
| `secret_rotation_period` | `string` | `"2592000s"` | Rotation frequency (default: 30 days) |

### Environment Variables & Secrets

| Variable | Type | Default | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Plain-text environment variables injected into the GKE pod |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager secret references injected as env vars via Kubernetes `valueFrom` |
| `secret_propagation_delay` | `number` | `30` | Seconds to wait after secret creation before proceeding (allows global replication) |

### Observability & Health

| Variable | Type | Default | Description |
|---|---|---|---|
| `health_check_config` | `object` | `{enabled=true, path="/healthz"}` | Kubernetes liveness probe configuration |
| `startup_probe_config` | `object` | `{enabled=true, path="/healthz"}` | Kubernetes startup probe configuration |
| `uptime_check_config` | `object` | `{enabled=true, path="/"}` | Cloud Monitoring uptime check configuration |
| `alert_policies` | `list(object)` | `[]` | Cloud Monitoring alert policies that notify `support_users` when thresholds are exceeded |

### Backup & Maintenance

| Variable | Type | Default | Description |
|---|---|---|---|
| `backup_schedule` | `string` | `"0 2 * * *"` | Cron expression for automated database backup job |
| `backup_retention_days` | `number` | `7` | Days to retain backup files in the GCS backup bucket |
| `enable_custom_sql_scripts` | `bool` | `false` | Run custom SQL scripts from GCS after DB provisioning |
| `custom_sql_scripts_bucket` | `string` | `""` | GCS bucket containing the SQL scripts |
| `custom_sql_scripts_path` | `string` | `""` | Path prefix within the bucket for SQL scripts |
| `custom_sql_scripts_use_root` | `bool` | `false` | Execute custom SQL scripts as the root DB user |

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

---

## 11. Outputs

Key outputs exported by the module. Full list in `outputs.tf`.

### Service

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name |
| `namespace` | Kubernetes namespace |
| `service_url` | External URL (static IP / custom domain) or internal cluster URL |
| `service_external_ip` | External LoadBalancer IP (if static IP is reserved) |
| `service_cluster_ip` | ClusterIP of the base Kubernetes Service |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific Services (when `enable_cloud_deploy = true`) |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is available and all Kubernetes resources are deployed. `false` on the first apply of an inline cluster — the pipeline must run a second apply to deploy application resources. |

### Database

| Output | Description |
|---|---|
| `database_instance_name` | Cloud SQL instance name |
| `database_name` | Application database name |
| `database_user` | Application database user |
| `database_host` | Database host (`127.0.0.1` via Cloud SQL Auth Proxy) |
| `database_port` | Database port |
| `database_password_secret` | Secret Manager secret name for the DB password |

### Infrastructure

| Output | Description |
|---|---|
| `network_name` | VPC network name |
| `network_exists` | Whether the VPC network exists |
| `regions` | Available regions in the VPC |
| `nfs_server_ip` | NFS server internal IP (sensitive) |
| `nfs_mount_path` | NFS mount path in containers |
| `nfs_share_path` | NFS share path on the server |
| `storage_buckets` | Map of created GCS bucket names |
| `container_image` | Resolved container image URI used for the deployment |
| `container_registry` | Artifact Registry repository name (when custom build is active) |
| `deployment_id` | Unique deployment identifier (random hex suffix) |
| `tenant_id` | Tenant identifier |
| `resource_prefix` | Resource naming prefix |
| `project_id` | GCP project ID |
| `project_number` | GCP project number |
| `deployment_summary` | Summary map of key deployment attributes |

### Monitoring

| Output | Description |
|---|---|
| `monitoring_enabled` | Whether monitoring is configured |
| `monitoring_notification_channels` | Cloud Monitoring notification channel names |

### CI/CD

| Output | Description |
|---|---|
| `cicd_enabled` | Whether the CI/CD pipeline is active |
| `cloudbuild_trigger_name` | Cloud Build trigger name |
| `cloudbuild_trigger_id` | Cloud Build trigger ID |
| `github_repository_url` | GitHub repository URL connected for CI/CD |
| `github_repository_owner` | GitHub repository owner/organisation |
| `github_repository_name` | GitHub repository name |
| `artifact_registry_repository` | Artifact Registry repository details (`name`, `location`, `url`) |
| `cicd_configuration` | Complete CI/CD config map (trigger, repo, SA, image URL) |

### Security

| Output | Description |
|---|---|
| `vpc_sc_enabled` | Whether the VPC-SC perimeter was successfully created |
| `vpc_sc_perimeter_name` | VPC-SC service perimeter resource name |
| `vpc_sc_dry_run_mode` | `true` if VPC-SC is in dry-run mode |
| `audit_logging_enabled` | Whether project-level Cloud Audit Logs are enabled |
| `artifact_registry_cmek_enabled` | Whether Artifact Registry CMEK encryption is configured |

### Jobs

| Output | Description |
|---|---|
| `initialization_jobs` | Map of created initialization job names |
| `cron_jobs` | Map of created cron job names |
| `nfs_setup_job` | NFS setup job name |
| `db_import_job` | Database import job name |
| `statefulset_name` | StatefulSet name (when `workload_type = "StatefulSet"`) |
