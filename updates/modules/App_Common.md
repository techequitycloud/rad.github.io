# App_Common Shared Library

The `App_Common` module is a collection of reusable, shared Terraform modules that serve as the foundation for the RAD Modules ecosystem. It provides the core infrastructure logic used by platform-specific modules like `App_CloudRun` and `App_GKE`.

## 1. Overview

**Purpose**: To enforce consistency, reduce code duplication, and standardize infrastructure patterns across different compute platforms (Serverless vs. Kubernetes).

**Architecture**:
*   **Layer 1 (App_Common)**: Abstracted infrastructure components (Networking, Databases, Storage, IAM).
*   **Layer 2 (Platform)**: `App_CloudRun` and `App_GKE` compose these components to build a complete deployment environment.
*   **Layer 3 (Application)**: Wrappers (e.g., `Cyclos_CloudRun`) instantiate the platform layer with specific app configurations.

---

## 2. Module Reference

The functional logic is encapsulated in submodules located in `modules/App_Common/modules/`. The top-level `.tf` files at `modules/App_Common/` provide shared infrastructure resources consumed by the platform layer.

### Top-Level Shared Resources

| File | Purpose |
|---|---|
| `buildappcontainer.tf` | Renders a per-app `cloudbuild.yaml` and drives the application image build via `terraform_data.build_and_push_application_image`, which invokes `scripts/build-container.sh`. Replacement is triggered by hashes of the Dockerfile, context directory, repository ID, tag, and build args. |
| `sql.tf` | Discovers an existing Cloud SQL instance via `scripts/get-sqlserver-info.sh`, computes the canonical `${instance}-root-password` Secret Manager secret ID, and inline-provisions the secret (generated 32-char random password) when Services_GCP has not already created it. The plaintext root password is never written to Terraform state — callers retrieve it at runtime via `gcloud secrets versions access`. |
| `registry.tf` | Discovers an existing Artifact Registry repository for the deployment region. |
| `network.tf` | Base VPC network discovery (App_GKE extends this with static IP resources in its own `network.tf`). |
| `nfs.tf` | Locates the Filestore NFS server for the deployment and exposes its IP and file-share name. |
| `storage.tf` | Application bucket wiring consumed by application modules. |

### Core Integration Modules
These modules are directly used by `App_CloudRun` and `App_GKE` via `gcp_integration.tf`.

#### `app_networking`
*   **Path**: `modules/app_networking`
*   **Description**: Discovers and validates the existing VPC network topology.
*   **Capabilities**:
    *   **Auto-discovery**: When `network_name` is empty, queries all subnets with description `managed-by=services-gcp` and selects the unique Services_GCP-managed network; emits a clear error if zero or more than one is found.
    *   Verifies existence of the target (or discovered) VPC network.
    *   Retrieves subnet names, CIDR ranges, and a `region_to_subnet` map for multi-region deployments.
    *   **Network tags**: Discovers ingress firewall-rule target tags on the network (HTTP/HTTPS ports). Outputs `network_tags` — used to tag Cloud Run services with Direct VPC Egress so the correct firewall rules apply.
    *   Falls back to `fallback_region` when no subnets are discovered so downstream `available_regions` is never empty.

#### `app_sql_discovery`
*   **Path**: `modules/app_sql_discovery`
*   **Description**: Discovers an existing Cloud SQL instance and exposes connection metadata. Does not create secrets or passwords — that is handled by `app_secrets`.
*   **Capabilities**:
    *   Calls `get-sqlserver-info.sh` with an optional `sql_instance_name` hint to locate the Cloud SQL instance.
    *   Returns `sql_server_exists`, `db_instance_name`, `db_instance_region`, `db_instance_connection_name` (for Auth Proxy), `db_internal_ip` (for direct access), `database_version`, and `db_root_password` (when available from the discovery script).
    *   Derives `db_password_secret_name` as `{instance}-{resource_prefix}-db-password` for use by `app_secrets` and `app_iam`.

#### `app_storage_wrapper`
*   **Path**: `modules/app_storage_wrapper`
*   **Description**: Convenience wrapper that composes `app_cmek`, GCS KMS IAM, and `app_storage_enhanced` into a single interface for standardized Cloud Storage provisioning.
*   **Capabilities**:
    *   Invokes `app_cmek` to provision a CMEK keyring when `manage_storage_kms_iam = true`.
    *   Fetches the GCS project service account and grants it `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the storage key so encrypted buckets can be created without manual IAM setup.
    *   Delegates bucket creation to `app_storage_enhanced` (versioning, lifecycle rules, KMS encryption, backup bucket).
    *   Conditionally uploads a `backup.sql` seed object to the backup bucket when `backup_sql_source_path` is set.
    *   Provides a simplified interface that hides the three-step composition from callers.

#### `app_nfs_discovery`
*   **Path**: `modules/app_nfs_discovery`
*   **Description**: Discovers NFS infrastructure — either a Cloud Filestore instance or a GCE-based NFS server — and outputs a unified set of connection details.
*   **Capabilities**:
    *   Runs `get-nfsserver-info.sh` (with optional `nfs_instance_name` hint) and `get-filestore-info.sh` in parallel when `nfs_enabled = true`.
    *   Normalises residual `"null"` strings returned by `jq -r` on JSON null values to `""` so all downstream comparisons use a single empty-string check.
    *   **Priority**: Filestore IP takes precedence over GCE IP when both exist.
    *   Outputs `nfs_internal_ip`, `nfs_instance_name`, `nfs_instance_zone`, and `nfs_instance_tags` (GCE network tags; empty for Filestore, which is a managed service).
    *   Sets `nfs_server_exists = true` only when a non-empty IP is discovered.

#### `app_registry_discovery`
*   **Path**: `modules/app_registry_discovery`
*   **Description**: Artifact Registry repository discovery.
*   **Capabilities**:
    *   Always runs `discover_repo.sh` via `data.external` to locate the shared Artifact Registry repository.
    *   The `google_artifact_registry_repository` data source (which validates the repo exists via the GCP API) is gated on `enable_custom_build || enable_cicd_trigger` and a non-empty discovered location — avoiding API errors when neither feature is active.
    *   Outputs repository ID, project, location, and name for use by `app_build` and CI/CD resources.

#### `app_build`
*   **Path**: `modules/app_build`
*   **Description**: Container build orchestration using Cloud Build (Kaniko). Used by Foundation modules (`App_CloudRun`, `App_GKE`).
*   **Capabilities**:
    *   **Path handling**: Detects whether `container_build_config.context_path` is absolute or relative. Absolute paths (e.g. an app's own `scripts/` dir) set the build working directory to that path so all context files are included in the Cloud Build tarball; relative paths resolve against `scripts_dir` as before.
    *   **Inline Dockerfile**: When `dockerfile_content` is provided it is written to disk via `local_file`; otherwise the existing file at `{context_path}/{dockerfile_path}` is used. Falls back to a clear error comment if neither is found.
    *   **`cloudbuild.yaml` generation**: Renders `cloudbuild.yaml.tpl` into the build working directory. Template now accepts `DOCKERFILE_CONTENT` and `CLOUDBUILD_SA` so the Kaniko step can use an explicit service account and embed the Dockerfile inline when needed.
    *   **`core_scripts_dir`**: Optional override (`var.core_scripts_dir`) for the directory containing shared build scripts (`build-container.sh`, `cloudbuild.yaml.tpl`). Defaults to `var.scripts_dir` when not set.
    *   **Rich trigger hashing**: `null_resource` triggers include `script_hash`, `context_hash` (all files in the context dir, excluding `cloudbuild.yaml`, the Dockerfile, and `Dockerfile.placeholder`), `dockerfile_hash`, `build_args`, and `cloudbuild_hash` — ensuring rebuilds fire on any meaningful change.
    *   **Tagging**: Standardizes image tagging with `application_version`.

### Supporting Infrastructure Modules
These modules provide lower-level utilities or specific enhancements.

#### `app_iam`
*   **Path**: `modules/app_iam`
*   **Description**: Standardized IAM role bindings for Service Accounts (Workload, Cloud Build).
*   **Capabilities**:
    *   **Secret Manager**: Grants `roles/secretmanager.secretAccessor` to the workload service account for the database password secret, optionally the root password secret (`grant_root_password_access`), and all secrets listed in `secret_environment_variables`.
    *   **Storage Buckets**: Grants `roles/storage.objectAdmin` and `roles/storage.legacyBucketReader` to the workload service account for each bucket in `storage_buckets` (conditional on `create_cloud_storage`).
    *   **GitHub Token IAM**: When `enable_github_token_iam = true`, grants `roles/secretmanager.secretAccessor` on the GitHub token secret to: the explicit Cloud Build service account (`cloud_build_sa_email`), the Cloud Build default service identity (obtained via `google_project_service_identity`), and the Cloud Build service agent (`service-{project_number}@gcp-sa-cloudbuild.iam.gserviceaccount.com`).
    *   **Cloud Build deployment permissions**: Gated on `enable_cicd_trigger`. Grants `var.deployment_role` (e.g. `roles/run.developer` or `roles/container.developer`) and `roles/iam.serviceAccountUser` to the Cloud Build service account so it can deploy on behalf of the workload identity.
    *   **Cloud Build service identity**: When `enable_github_token_iam = true`, enables `cloudbuild.googleapis.com`, waits 60s for propagation, and creates a `google_project_service_identity` for Cloud Build so the service agent account exists before IAM bindings are applied.

#### `app_secrets`
*   **Path**: `modules/app_secrets`
*   **Description**: Full lifecycle management of secrets in Secret Manager, including generation, storage, validation, and automated rotation.
*   **Capabilities**:
    *   Generates random database passwords of configurable length and stores them in Secret Manager. Configures a `secret_propagation_delay` to ensure secrets are available before dependent resources start.
    *   **Explicit secret values**: Accepts `explicit_secret_values` (a map of key → sensitive string) for secrets whose values are provided directly by the caller. Keys in this map are excluded from the external existence check and from `data.google_secret_manager_secret_version` reads.
    *   **Additional secrets**: References user-provided secrets via `secret_environment_variables` (key → Secret Manager secret ID). Non-explicit entries are validated by `check-secret-exists.sh`.
    *   **Non-fatal validation**: A Terraform `check` block (`secret_environment_variables_exist`) emits a plan-time warning when a referenced secret is absent, without hard-failing the plan. This keeps `terraform destroy` safe even when externally-managed secrets have already been deleted.
    *   **`read_additional_secret_versions`**: When `false` (default for Cloud Run), Terraform skips reading secret versions at plan time — Cloud Run resolves them at runtime. When `true` (default for GKE, which embeds values into Kubernetes Secrets), versions are read during apply.
    *   **GitHub token**: Stored with `deletion_policy = "ABANDON"` so disabling `enable_cicd_trigger` leaves the secret version enabled in Secret Manager, preventing a "DESTROYED state" error on re-enable.
    *   **Secret Rotation**: Creates a Pub/Sub topic and grants the Secret Manager service identity `roles/pubsub.publisher` so rotation notifications are emitted at the configured `secret_rotation_period`.
    *   **Automatic Password Rotation** (`enable_auto_password_rotation = true`): Deploys a two-tier rotation architecture:
        *   **Cloud Run Job** (`pw-rotator`): Executes the zero-downtime dual-version pattern — generate new password → `ALTER USER` on Cloud SQL → add new Secret Manager version → sleep `rotation_propagation_delay_sec` (default 90s) → disable old version.
        *   **Dispatcher Cloud Run Service** (`rot-dispatch`): A minimal scale-to-zero HTTP service that bridges the Eventarc trigger to the Cloud Run Job (Eventarc does not yet support Jobs as a direct destination).
        *   **Eventarc trigger**: Fires the dispatcher on each Pub/Sub rotation notification.
        *   A dedicated least-privilege service account is created for the rotator with only `roles/cloudsql.client`, `secretVersionAdder`, `secretVersionManager`, `secretAccessor`, `roles/run.developer`, and `roles/eventarc.eventReceiver`.
    *   Optional VPC attachment (`rotation_vpc_network` / `rotation_vpc_subnet`) for the rotator job to reach Cloud SQL via private IP.

#### `app_provider_auth`
*   **Path**: `modules/app_provider_auth`
*   **Description**: Handles Service Account Impersonation logic to allow Terraform to provision resources with restricted privileges.
*   **Capabilities**:
    *   Executes the external shell script `get-impersonation-token.sh` (via `data.external`) to obtain a GCP access token by calling `gcloud auth print-access-token --impersonate-service-account`.
    *   Resolves the impersonation target: prefers `agent_service_account`, falls back to `resource_creator_identity`; impersonation is disabled when neither is set.
    *   Outputs `impersonation_token` (sensitive) and `impersonation_enabled` for use by the caller to configure a Terraform Google provider with impersonated credentials.
    *   Creates no GCP resources — purely an authentication helper.

#### `app_monitoring`
*   **Path**: `modules/app_monitoring`
*   **Description**: Shared logic for creating Cloud Monitoring Alert Policies and Uptime Checks.
*   **Capabilities**:
    *   **Notification channels**: Creates one `google_monitoring_notification_channel` (type: email) per address in `support_users`; all alert policies notify these channels.
    *   **Default CPU alert**: Creates a `google_monitoring_alert_policy` (`{service_name}-cpu-utilization-alert`) that fires when CPU utilization exceeds `cpu_threshold` (default 90%) for 60s; re-notifies every 30 minutes.
    *   **Default memory alert**: Creates a `google_monitoring_alert_policy` (`{service_name}-memory-utilization-alert`) that fires when memory utilization exceeds `memory_threshold` (default 90%) for 60s; re-notifies every 30 minutes.
    *   **Custom alert policies**: Accepts a `custom_alert_policies` map; creates additional `google_monitoring_alert_policy` resources for each entry, each with configurable filter, threshold, duration, comparison, and aggregation period.
    *   All resources are gated on `configure_monitoring = true` and a non-empty `support_users` list.

#### `app_cicd_base`
*   **Path**: `modules/app_cicd_base`
*   **Description**: Sets up the GitHub repository and Cloud Build v2 connection required for trigger-based CI/CD pipelines.
*   **Capabilities**:
    *   **Repository initialization**: Gated on `create_repository = true`. Executes `init-cicd-repo.sh` via a `null_resource` local-exec provisioner (re-runs on `repo_name`, `service_name`, `container_image`, or script hash changes) to create or reuse a GitHub repository, commit a `README.md`, `.gitignore`, `cloudbuild.yaml`, and optionally application source files from `APP_SOURCE_DIR`. Gated additionally on `github_token` being non-empty to avoid "unbound variable" errors.
    *   **Cloud Build v2 connection**: Creates a `google_cloudbuildv2_connection` linking Cloud Build to GitHub via an OAuth token (`github_token_secret_version`) and a GitHub App installation ID (`github_app_installation_id`). Waits 120s (driven by `iam_dependencies` trigger) for IAM propagation before connecting.
    *   **Cloud Build v2 repository**: Creates a `google_cloudbuildv2_repository` linked to the connection. The remote URI defaults to `https://github.com/{owner}/{repo}` but can be overridden directly via `github_repo_url`.
    *   All resources are gated on `enable_cicd = true`.

#### `app_cloud_deploy`
*   **Path**: `modules/app_cloud_deploy`
*   **Description**: Creates a Google Cloud Deploy delivery pipeline with per-stage targets, Skaffold configuration in GCS, and all required IAM bindings.
*   **Capabilities**:
    *   Creates a `google_clouddeploy_delivery_pipeline` with an ordered list of stages (e.g. `dev → staging → prod`). Each stage maps to a named target with configurable `require_approval` and `auto_promote` flags, plus per-stage `project_id` and `region` overrides for cross-project and cross-region topologies.
    *   **Auto-promote**: For stages with `auto_promote = true` (excluding the final stage), creates a `google_clouddeploy_automation` resource that advances the rollout to the next stage on success.
    *   **GCS Skaffold bucket**: Creates a deterministically-named GCS bucket (`{project_id}-{md5(pipeline_name)[0:8]}-cd-configs`) to store Skaffold YAML and per-stage deployment manifests. Cloud Build and the Cloud Deploy service agent are granted `roles/storage.objectViewer` on this bucket.
    *   **Platform IAM**: The Cloud Deploy service agent receives `roles/run.admin` for Cloud Run targets (not `roles/run.developer`, because the Skaffold after-hook that applies `allUsers` IAM bindings requires `run.services.setIamPolicy`, present only in `roles/run.admin`) and `roles/container.developer` for GKE targets.
    *   **Initial release**: When `create_initial_release = true` and a `container_image` is provided, a `null_resource` creates a first Cloud Deploy release on apply so the pipeline is immediately visible in the dashboard.
    *   **Destroy cleanup**: Per-stage `null_resource` destroy-time provisioners delete the corresponding Cloud Run service or GKE Deployment/Service when the pipeline is torn down.
    *   Enables `clouddeploy.googleapis.com` and waits 120s for the Cloud Deploy service agent to be provisioned before applying IAM bindings.

### Security Modules

#### `app_cmek`
*   **Path**: `modules/app_cmek`
*   **Description**: Provisions Cloud KMS infrastructure for Customer-Managed Encryption Keys (CMEK) for both Cloud Storage and Artifact Registry.
*   **Capabilities**:
    *   **Keyring discovery**: Runs `discover_cmek_keyring.sh` at plan time to find any pre-existing keyring created by `Services_GCP` (prefix `{project_id}-cmek-`). Reuses the discovered keyring; falls back to creating `{project_id}-cmek-keyring` when none exists. This ensures the two modules always converge on the same keyring without conflicts.
    *   **Storage CMEK** (`enable_cmek = true`): Idempotently creates the CMEK keyring and a `storage-key` CryptoKey via `gcloud kms keyrings create ... || true`. Reads the keyring via a data source (deferred to apply time by `depends_on`) and outputs `storage_key_id` for `app_storage_enhanced`.
    *   **Artifact Registry CMEK** (`enable_artifact_registry_cmek = true`): Idempotently creates an `artifact-registry-key` in the same keyring and grants the AR service identity (`service-{project_number}@gcp-sa-artifactregistry.iam.gserviceaccount.com`) `roles/cloudkms.cryptoKeyEncrypterDecrypter` — without requiring the `google-beta` provider for the service identity lookup.
    *   Set both flags to `false` to skip all provisioning.

#### `app_security`
*   **Path**: `modules/app_security`
*   **Description**: Binary Authorization image signing and policy enforcement for container images.
*   **Capabilities**:
    *   Creates a KMS keyring (`${project_id}-binauthz-keyring`) and an asymmetric RSA signing key (`binauthz-signer`). The provisioner also restores and enables key version 1 if it is in `DESTROY_SCHEDULED` state, ensuring re-deploys after a partial destroy succeed without manual intervention.
    *   Creates a Container Analysis note, `pipeline-attestor` attestor, and Binary Authorization policy via `create-binauthz-prerequisites.sh`. The script is idempotent — it exits immediately when the attestor already exists, leaving `Services_GCP`-provisioned environments untouched.
    *   Signs the application container image via `sign-image.sh`. Skips signing when the image is the placeholder `gcr.io/cloudrun/hello` (guard is inside the provisioner, not `count`, because the image value may be unknown at plan time).
    *   Optionally signs the `db-clients` image when `sql_server_exists = true`.
    *   Supports three enforcement modes via `binauthz_evaluation_mode`: `ALWAYS_ALLOW` (default, permissive), `REQUIRE_ATTESTATION` (enforce signed images), and `ALWAYS_DENY` (emergency lockdown).
    *   Set `enable_binary_authorization = false` to skip all provisioning.

#### `app_vpc_sc`
*   **Path**: `modules/app_vpc_sc`
*   **Description**: Configures VPC Service Controls to create an Access Context Manager perimeter around the project, restricting which identities and networks can access protected GCP services.
*   **Capabilities**:
    *   **Organization auto-discovery**: Reads `org_id` and `folder_id` from the project resource. Emits a clear `null_resource` warning (not a hard error) when: (a) the project is standalone with no GCP organization (VPC-SC permanently unavailable), (b) the project is nested under a folder and the org ID cannot be auto-discovered (caller must supply `organization_id` explicitly), or (c) `admin_ip_ranges` is empty (would risk lockout).
    *   **VPC CIDR auto-discovery**: When `vpc_cidr_ranges` is empty and `network_name` is set, queries subnets of the named VPC and uses their CIDR ranges as the VPC access level. Falls back to `10.0.0.0/8` when no subnets are found.
    *   **Access Context Manager policy**: Reuses an existing org-level ACM policy if one exists; creates one otherwise.
    *   **Four access levels**: `vpc_access` (VPC subnet CIDRs), `admin_access` (`admin_ip_ranges`), `iap_access` (IAP service agent), and `cicd_access` (Cloud Build SA and `resource_creator_identity`).
    *   **Service perimeter**: Restricts 15 GCP services (Cloud Run, GKE, Cloud SQL, Secret Manager, Storage, Artifact Registry, Cloud Build, Certificate Manager, IAP, Compute, KMS, Pub/Sub, Redis, Filestore, Firestore). Ingress allows all four access levels; egress policies permit outbound calls to Storage, Artifact Registry, Logging, Monitoring, Secret Manager, and Cloud SQL.
    *   **Dry-run mode**: Set `vpc_sc_dry_run = true` to enforce the perimeter in audit-only mode before going live.
    *   Skipped entirely when no organization is present or `admin_ip_ranges` is empty.

### Storage Modules

#### `app_storage_enhanced`
*   **Path**: `modules/app_storage_enhanced`
*   **Description**: Advanced Cloud Storage bucket management with fine-grained configuration. Used internally by `app_storage_wrapper`.
*   **Capabilities**:
    *   Creates one or more application storage buckets from a `storage_buckets` map with per-bucket settings.
    *   Per-bucket configuration: storage class, versioning, uniform bucket-level access, public access prevention, soft-delete retention, and lifecycle rules (Delete, SetStorageClass with age, date, state, and version conditions).
    *   Optional dedicated backup bucket with configurable location, storage class, and `backup_retention_days` lifecycle auto-deletion policy.
    *   Supports Customer-Managed Encryption Keys (`kms_key_name`) or Google-managed encryption.
    *   Destroy-time provisioners safely empty buckets before deletion, with a configurable `gcsfuse_unmount_wait` to handle GCS Fuse unmount delays.

### Database Utility Modules

#### `app_db_clients`
*   **Path**: `modules/app_db_clients`
*   **Description**: Builds and pushes a database client tools container image to Artifact Registry.
*   **Capabilities**:
    *   Builds a container image containing PostgreSQL and MySQL clients via a Cloud Build job (`cloudbuild-db-clients.yaml`).
    *   Pushes the image to Artifact Registry tagged as `db-clients:latest`. Outputs the full image URI (`db_clients_image`) consumed by `app_security` for Binary Authorization signing.
    *   Used by db-export CronJobs and db-cleanup destroy provisioners across platform modules.
    *   **No `count`**: `sql_server_exists` and `artifact_repo_id` can both be unknown at plan time, so a runtime guard inside the provisioner handles the skip logic rather than a `count` expression. An `always_run = timestamp()` trigger ensures the existence check runs on every apply, rebuilding only when the image is absent.
    *   Triggers on `dockerfile_hash` (`Dockerfile.db-clients`) and `cloudbuild_hash` so image changes are detected automatically.

### Monitoring Modules

#### `app_dashboard`
*   **Path**: `modules/app_dashboard`
*   **Description**: Creates platform-specific Cloud Monitoring dashboards.
*   **Capabilities**:
    *   Conditionally creates a dashboard when `configure_monitoring = true`.
    *   **GKE dashboard**: Displays CPU usage, memory usage, pod restart count, and network egress; filters by Kubernetes namespace.
    *   **Cloud Run dashboard**: Displays request count, request latency (p95), container instance count, and CPU utilization; filters by service name.
    *   The `platform` variable (`"gke"` or `"cloudrun"`) selects which metric set is displayed.
    *   Outputs `dashboard_id` (empty string when not created).

---

## 3. Implementation Pattern

Platform modules (`App_CloudRun`, `App_GKE`) consume `App_Common` submodules directly. The pattern below shows a typical integration:

```hcl
# Example from modules/App_CloudRun/gcp_integration.tf

module "network_discovery" {
  source = "../App_Common/modules/app_networking"

  project_id                    = local.project_id
  network_name                  = ""             # auto-discovers the Services_GCP network
  fallback_region               = "us-central1"
  impersonation_service_account = local.impersonation_service_account
}

module "app_sql_discovery" {
  source = "../App_Common/modules/app_sql_discovery"

  project_id                    = local.project_id
  database_client_type          = local.database_client_type
  impersonation_service_account = local.impersonation_service_account
  scripts_dir                   = "${path.module}/../App_Common/scripts"
  resource_prefix               = local.resource_prefix
}

locals {
  # Network outputs
  region_to_subnet   = module.network_discovery.region_to_subnet
  network_tags       = module.network_discovery.network_tags

  # SQL outputs — used by app_secrets and app_iam
  sql_server_exists  = module.app_sql_discovery.sql_server_exists
  db_connection_name = module.app_sql_discovery.db_instance_connection_name
  db_password_secret = module.app_sql_discovery.db_password_secret_name
}
```

Any improvement to the shared discovery or management logic in `App_Common` automatically benefits all consuming platform modules without changes to Application Modules.
