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

The functional logic is encapsulated in submodules located in `modules/App_Common/modules/`.

### Core Integration Modules
These modules are directly used by `App_CloudRun` and `App_GKE` via `gcp_integration.tf`.

#### `app_networking`
*   **Path**: `modules/app_networking`
*   **Description**: Discovers and validates the existing VPC network topology.
*   **Capabilities**:
    *   Verifies existence of the target VPC network.
    *   Retrieves Subnet IDs, CIDR ranges, and Gateway information.
    *   Outputs regional subnet maps for multi-region deployments.

#### `app_sql_discovery`
*   **Path**: `modules/app_sql_discovery`
*   **Description**: Handles Cloud SQL database discovery and connection management.
*   **Capabilities**:
    *   **Discovery**: Finds existing Cloud SQL instances in the project.
    *   **Connection Info**: Returns Connection Name (for Auth Proxy) and IP address (for direct access).
    *   **Credentials**: Generates random passwords for new database users and stores them in Secret Manager.

#### `app_storage_wrapper`
*   **Path**: `modules/app_storage_wrapper`
*   **Description**: Convenience wrapper that composes `app_cmek` and `app_storage_enhanced` into a single interface for standardized Cloud Storage provisioning.
*   **Capabilities**:
    *   Invokes `app_cmek` to provision a CMEK keyring when `manage_storage_kms_iam = true`.
    *   Delegates bucket creation to `app_storage_enhanced` (versioning, lifecycle rules, KMS encryption, backup bucket).
    *   Provides a simplified interface that hides the two-module composition from callers.

#### `app_nfs_discovery`
*   **Path**: `modules/app_nfs_discovery`
*   **Description**: Integrates with Cloud Filestore (NFS).
*   **Capabilities**:
    *   Discovers existing Filestore instances.
    *   Outputs the NFS Server IP and File Share Name required for mounting volumes.

#### `app_registry_discovery`
*   **Path**: `modules/app_registry_discovery`
*   **Description**: Artifact Registry repository discovery.
*   **Capabilities**:
    *   Discovers an existing Artifact Registry repository via an external shell script (`discover_repo.sh`).
    *   Outputs repository ID, project, location, and GitHub URL for use by build and deployment processes.
    *   Skips discovery when `enable_custom_build` and `enable_cicd_trigger` are both false.

#### `app_build`
*   **Path**: `modules/app_build`
*   **Description**: Container build orchestration using Cloud Build.
*   **Capabilities**:
    *   **Custom Build**: Builds containers from source using a provided `Dockerfile`.
    *   **Image Mirroring**: Pulls public images and pushes them to the private Artifact Registry.
    *   **Tagging**: Standardizes image tagging with application versions.
    *   **Path Handling**: Resolves both absolute and relative Dockerfile context paths.

### Supporting Infrastructure Modules
These modules provide lower-level utilities or specific enhancements.

#### `app_iam`
*   **Path**: `modules/app_iam`
*   **Description**: Standardized IAM role bindings for Service Accounts (Workload, Cloud Build).
*   **Capabilities**:
    *   **Secret Manager**: Grants `roles/secretmanager.secretAccessor` to the workload service account for the database password secret, optionally the root password secret (`grant_root_password_access`), and all secrets listed in `secret_environment_variables`.
    *   **Storage Buckets**: Grants `roles/storage.objectAdmin` and `roles/storage.legacyBucketReader` to the workload service account for each bucket in `storage_buckets` (conditional on `create_cloud_storage`).
    *   **GitHub Token IAM**: When `enable_github_token_iam = true`, grants `roles/secretmanager.secretAccessor` on the GitHub token secret to the Cloud Build service account, the Cloud Build default service identity, and the Cloud Build service agent (`service-{project_number}@gcp-sa-cloudbuild.iam.gserviceaccount.com`).
    *   **Cloud Build deployment permissions**: Grants `var.deployment_role` (e.g., `roles/run.developer` or `roles/container.developer`) and `roles/iam.serviceAccountUser` to the Cloud Build service account so it can deploy on behalf of the workload identity.
    *   **Cloud Build service identity**: When `enable_github_token_iam = true`, enables `cloudbuild.googleapis.com`, waits 60s for propagation, and creates a `google_project_service_identity` for Cloud Build so the service agent account exists before IAM bindings are applied.

#### `app_secrets`
*   **Path**: `modules/app_secrets`
*   **Description**: Full lifecycle management of secrets in Secret Manager, including generation, storage, and automated rotation.
*   **Capabilities**:
    *   Generates random database passwords of configurable length and stores them in Secret Manager.
    *   Supports additional secrets sourced from Secret Manager via `secret_environment_variables`.
    *   Configures a `secret_propagation_delay` to ensure secrets are available before dependent resources start.
    *   **Secret Rotation**: Creates a Pub/Sub topic and configures Secret Manager to emit rotation notifications at a configurable `secret_rotation_period` (e.g., `"2592000s"` for 30 days).
    *   **Automatic Password Rotation**: When `enable_auto_password_rotation = true`, deploys a Cloud Run Job and Eventarc trigger that automatically rotates the Cloud SQL database password on the rotation schedule — generates a new password, updates Cloud SQL, adds a new Secret Manager version, and disables the old version.
    *   Configurable `rotation_propagation_delay_sec` to allow running application instances to pick up the new secret before the old version is disabled (default: 90s, safe for both Cloud Run and GKE CSI driver).
    *   Optional VPC attachment for the rotator job to reach Cloud SQL via private IP.
    *   Supports GitHub token storage for CI/CD integration.

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

#### `app_cicd_base` & `app_cloud_deploy`
*   **Path**: `modules/app_cicd_base`, `modules/app_cloud_deploy`
*   **Description**: Components for setting up advanced CI/CD pipelines using Cloud Build and Google Cloud Deploy.
*   **`app_cicd_base` Capabilities**:
    *   **Repository initialization**: Executes `init-cicd-repo.sh` via a `null_resource` local-exec provisioner to create (or reuse) a GitHub repository, commit a `README.md`, `.gitignore`, `cloudbuild.yaml` (Kaniko-based build), and optionally application source files from `APP_SOURCE_DIR`.
    *   **Cloud Build v2 connection**: Creates a `google_cloudbuildv2_connection` linking Cloud Build to GitHub via an OAuth token (`github_token_secret_version`) and a GitHub App installation ID; waits 120s for IAM propagation before connecting.
    *   **Cloud Build v2 repository**: Creates a `google_cloudbuildv2_repository` that links the GitHub repository to the Cloud Build connection, enabling trigger-based builds directly from GitHub.
    *   All resources are gated on `enable_cicd = true`.
*   **`app_cloud_deploy` Capabilities**:
    *   Creates a Cloud Deploy delivery pipeline with an ordered list of stages (e.g., `dev → staging → prod`).
    *   Each stage maps to a named target with configurable `require_approval` and `auto_promote` flags.
    *   Manages platform-specific IAM bindings (Cloud Run vs. GKE) for the Cloud Deploy service agent.
    *   Uploads pre-rendered Skaffold YAML and deployment manifests to a GCS bucket for use by each release.
    *   Optionally creates an initial Cloud Deploy release on first apply so the pipeline is visible in the dashboard immediately.
    *   Supports cross-project and cross-region targets via per-stage `project_id` and `region` overrides.
    *   Includes destroy-time provisioners to clean up deployments when the pipeline is torn down.

### Security Modules

#### `app_cmek`
*   **Path**: `modules/app_cmek`
*   **Description**: Provisions Cloud KMS infrastructure for Customer-Managed Encryption Keys (CMEK).
*   **Capabilities**:
    *   Creates a KMS keyring named `${project_id}-cmek-keyring` in the specified region.
    *   Creates a `storage-key` CryptoKey within the keyring for encrypting Cloud Storage buckets.
    *   Idempotent: uses `gcloud kms keyrings create ... || true` to avoid errors on re-apply.
    *   Outputs the full KMS key resource ID (`storage_key_id`) consumed by `app_storage_enhanced`.
    *   Set `enable_cmek = false` to skip provisioning (returns an empty `storage_key_id`).

#### `app_security`
*   **Path**: `modules/app_security`
*   **Description**: Binary Authorization image signing and policy enforcement for container images.
*   **Capabilities**:
    *   Creates a CMEK keyring (`${project_id}-binauthz-keyring`) and an asymmetric signing key (`binauthz-signer`) for attestation.
    *   Creates a Container Analysis attestor and Binary Authorization policy.
    *   Signs application container images using the `pipeline-attestor` pattern via `sign-image.sh`.
    *   Optionally signs the `db-clients` image when a Cloud SQL instance exists.
    *   Supports three enforcement modes: `ALWAYS_ALLOW` (default, permissive), `REQUIRE_ATTESTATION` (enforce signed images), and `ALWAYS_DENY` (emergency lockdown).
    *   Self-sufficient fallback: creates Binary Authorization prerequisites (via `create-binauthz-prerequisites.sh`) if `Services_GCP` has not pre-configured them.
    *   Set `enable_binary_authorization = false` to skip all provisioning.

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
    *   Builds a container image containing PostgreSQL and MySQL clients via a Cloud Build job.
    *   Pushes the image to Artifact Registry tagged as `db-clients:latest`.
    *   Used by db-export CronJobs and db-cleanup destroy provisioners across platform modules.
    *   Idempotent: skips the build if the image already exists in the registry.
    *   Build is skipped when `sql_server_exists = false` or `artifact_repo_id` is empty.
    *   Outputs the full image URI (`db_clients_image`) consumed by `app_security` for Binary Authorization signing.

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

Platform modules integrate `App_Common` using the following pattern:

```hcl
# Example from modules/App_CloudRun/gcp_integration.tf

module "app_sql_discovery" {
  source = "../App_Common/modules/app_sql_discovery"

  project_id                    = local.project_id
  application_database_name     = local.db_name
  # ... other inputs
}

locals {
  # Expose module outputs as locals for internal use
  db_connection_name = module.app_sql_discovery.db_instance_connection_name
  db_password_secret = module.app_sql_discovery.db_password_secret_name
}
```

This ensures that any improvements to the discovery or management logic in `App_Common` automatically benefit all consuming platform modules.
