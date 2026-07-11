---
title: "Listmonk on Google Cloud Run"
description: "Configuration reference for deploying Listmonk on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Listmonk on Google Cloud Run

This document provides a comprehensive reference for the `modules/Listmonk_CloudRun` module. It covers architecture, IAM, configuration variables, Listmonk-specific behaviours, and operational patterns for deploying Listmonk on Google Cloud Run (v2).

---

## 1. Module Overview

Listmonk is a high-performance, self-hosted newsletter and mailing list manager written in Go. `Listmonk CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning and injects Listmonk-specific application configuration, database initialisation, and storage configuration via `Listmonk Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Go binary container, 1 vCPU / 512Mi by default. Minimum 1 instance by default (`min_instance_count = 1`) with `max_instance_count = 3`.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15**. Optional GCS Fuse volume for media uploads at `/listmonk/uploads`. Optional NFS for additional shared storage.
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App CloudRun`. The admin password is auto-generated and stored in Secret Manager.
*   **Caching**: Redis **disabled by default** (`enable_redis = false`). Listmonk is a stateless Go binary and does not require Redis for normal operation.
*   **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
*   **Reliability**: Health probes target `/api/health` with a 30-second initial delay. Listmonk auto-runs PostgreSQL schema migrations on first startup.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'listmonk'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `string` | `'Listmonk'` | Human-readable name shown in the GCP Console. |
| `description` | 3 | `string` | `'Listmonk is a high-performance, self-hosted newsletter and mailing list manager'` | Cloud Run service description. |
| `application_version` | 3 | `string` | `'latest'` | Listmonk image version tag. Increment to deploy a new release. |

**Wrapper architecture:** `Listmonk CloudRun` calls `Listmonk Common` to build an `application_config` object containing Listmonk-specific environment variables, probe configuration, and the `db-init` job definition. `module_storage_buckets` carries any uploads bucket provisioned by `Listmonk Common`. `scripts_dir` is resolved to the `Listmonk_Common/scripts` directory at apply time.

**PostgreSQL note:** Listmonk requires **PostgreSQL 15**. `database_type = "POSTGRES_15"` is the default and Listmonk will not start against any other database engine.

---

## 2. IAM & Access Control

`Listmonk_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in `App_CloudRun`.

**Application secrets:** `Listmonk Common` auto-generates one application-level secret:
- `LISTMONK_app__admin_password` — the Listmonk admin user password, stored in Secret Manager and injected at runtime.

The database password is stored in a separate secret (`database_password_secret`) provisioned automatically by `App CloudRun`. Neither value is written to Terraform state.

**Database password env var name:** Listmonk reads `LISTMONK_db__password` directly. The `db_password_env_var_name` variable is pre-set to this value so that `App CloudRun` injects the secret under the correct name.

**120-second IAM propagation delay:** Inherited from `App CloudRun` — the Listmonk service is not deployed until the delay completes, preventing secret-read failures on the first revision start.

**Admin interface:** Listmonk's full UI, including subscriber management, campaigns, templates, and settings, is available at the root path `/`. The admin username and auto-generated password are the only credentials required.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Listmonk is a compiled Go binary. It is memory-efficient and starts quickly compared to interpreted-language applications. The default resource allocation (1 vCPU / 512Mi) is sufficient for moderate list sizes and campaign workloads.

**One instance always running** (`min_instance_count = 1`) — scale-to-zero is supported by setting `min_instance_count = 0`, but note that PostgreSQL connection pools are re-established on cold start.

**Startup CPU Boost** is always enabled (hardcoded in `App CloudRun`).

**Container image:** `container_image_source` defaults to `'custom'`, meaning Cloud Build compiles a custom image using `Listmonk_Common`'s Dockerfile. Set `container_image_source = 'prebuilt'` and provide a `container_image` URI to skip the build and deploy directly.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance. 1 vCPU is sufficient for Listmonk's Go binary. |
| `memory_limit` | 4 | `'512Mi'` | Memory per instance. Increase to 1–2 Gi for large subscriber lists or heavy campaign processing. |
| `min_instance_count` | 4 | `1` | Minimum running instances. Set to `0` for scale-to-zero. |
| `max_instance_count` | 4 | `3` | Maximum running instances. Listmonk scales horizontally as a stateless binary. |
| `container_port` | 4 | `9000` | Listmonk's native HTTP port. Change only if your custom Dockerfile binds to a different port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for GCS Fuse mounts. |
| `timeout_seconds` | 4 | `300` | Max request duration. Listmonk's API endpoints typically respond within seconds. |
| `enable_cloudsql_volume` | 4 | `true` | Injects the Cloud SQL Auth Proxy sidecar for Unix socket connections to PostgreSQL. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Listmonk image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Percentage-based canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep. Set `0` to disable. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App CloudRun` defaults:**

| Variable | `App CloudRun` | `Listmonk CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `9000` | Listmonk's native port. |
| `min_instance_count` | `0` | `1` | Avoids cold-start connection pool re-establishment for active mailing operations. |
| `enable_image_mirroring` | `false` | `true` | Listmonk mirrors its base image to Artifact Registry by default to avoid Docker Hub rate limits. |

### B. Database (Cloud SQL — PostgreSQL 15)

Listmonk requires **PostgreSQL 15**. `database_type = "POSTGRES_15"` is the default and should not be changed. Listmonk handles its own schema creation and migrations on first startup — the `db-init` Cloud Run Job creates only the database and user; the application populates the schema.

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. Listmonk requires PostgreSQL. Do not change. |
| `db_name` | 12 | `'listmonk'` | PostgreSQL database name. **Do not change after initial deployment.** |
| `db_user` | 12 | `'listmonk'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `db_password_env_var_name` | 12 | `'LISTMONK_db__password'` | Env var name under which the DB password is injected. Pre-set for Listmonk; do not change. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |

> `sql_instance_name` and `sql_instance_base_name` are not exposed; Cloud SQL discovery/inline provisioning is handled transparently by `App CloudRun`.

### C. Storage (GCS Fuse & NFS)

**NFS is disabled by default** (`enable_nfs = false`). Listmonk is a stateless Go binary and does not require shared filesystem storage. Multiple Cloud Run instances share a single PostgreSQL database; subscriber data and campaign content are database-backed.

**GCS Fuse uploads volume:** For persistent media/file upload storage, mount a GCS bucket at `/listmonk/uploads` using `gcs_volumes`. `Listmonk Common` sets `LISTMONK_upload__provider=filesystem` and `LISTMONK_upload__filesystem__upload_path=/listmonk/uploads` — the GCS bucket mounted at that path satisfies these settings. Without a persistent volume, uploaded attachments are ephemeral and lost on revision restart.

| Variable | Group | Default | Description |
|---|---|---|---|
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). Each entry: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Mount the uploads bucket at `/listmonk/uploads`. |
| `enable_nfs` | 11 | `false` | Provisions a shared NFS volume. Not required for standard Listmonk deployments. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where the NFS share is mounted. Only relevant when `enable_nfs = true`. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation defined in `storage_buckets`. |
| `storage_buckets` | 11 | `[]` | Additional GCS buckets to provision. |
| `manage_storage_kms_iam` | 11 | `false` | Creates a CMEK KMS keyring/key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates an Artifact Registry KMS key for at-rest CMEK image encryption. |

### D. Networking

Cloud Run uses Direct VPC Egress to reach Cloud SQL's internal IP. Because `enable_cloudsql_volume = true` is the default, the Auth Proxy sidecar handles the Cloud SQL connection via Unix socket, and the database connection does not require VPC routing.

Listmonk connects to external SMTP/Mailgun/SES/Postmark providers for campaign delivery. Ensure `vpc_egress_setting = 'PRIVATE_RANGES_ONLY'` (default) so that direct public egress is available for SMTP port 587/465/25.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. Set `'ALL_TRAFFIC'` only if all outbound traffic (including SMTP) must transit the VPC. |

### E. Initialization & Bootstrap

A `db-init` Cloud Run Job is automatically provisioned by `Listmonk Common` when `initialization_jobs` is left as the default empty list (`[]`). It uses the `postgres:15-alpine` image and executes `Listmonk_Common/scripts/db-init.sh`, which performs the following idempotent operations:

1. Connects to Cloud SQL PostgreSQL via the Auth Proxy Unix socket.
2. Creates the `listmonk` database user with the password from Secret Manager.
3. Creates the `listmonk` database if it does not exist.
4. Grants the `listmonk` user full privileges on the database.

Listmonk itself runs `--install` on first boot to populate the schema and create the admin user using `LISTMONK_app__admin_username` and `LISTMONK_app__admin_password` from the environment.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Listmonk Common` to supply the default `db-init` job. Non-empty list replaces it entirely. |
| `cron_jobs` | 13 | `[]` | Recurring jobs triggered by Cloud Scheduler. Each entry: `name`, `schedule` (cron UTC), `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy (OWASP Top 10, adaptive DDoS, rate limiting) is provisioned in front of Cloud Run.

For production Listmonk deployments processing subscriber data and sending campaigns, Cloud Armor is strongly recommended to protect against credential stuffing on the admin login and API abuse.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules (e.g., office VPN, CI/CD egress IPs). |

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled directly on the service. Google identity authentication is required before requests reach Listmonk. Recommended for internal newsletter deployments where access should be restricted to organisational Google accounts.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/service accounts granted access. Format: `'user:email'` or `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

### C. Binary Authorization

When `enable_binary_authorization = true`, Cloud Run enforces that deployed images carry a valid cryptographic attestation.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation. Requires a Binary Authorization policy and attestor pre-configured in the project. |

### D. VPC Service Controls

When `enable_vpc_sc = true`, all GCP API calls from this module are bound within an existing VPC-SC perimeter.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Registers module API calls within the project's VPC-SC perimeter. A perimeter must already exist before enabling. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. Set `false` to enforce. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs (DATA_READ, DATA_WRITE, ADMIN_READ). |

### E. Secret Manager Integration

Listmonk application secrets are stored in Secret Manager and injected natively by Cloud Run at revision start — plaintext is never written to Terraform state.

`Listmonk Common` auto-generates `LISTMONK_app__admin_password`. The database password (`LISTMONK_db__password`) is provisioned automatically by `App CloudRun`. Additional secrets can be added via `secret_environment_variables`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Map of env var name → Secret Manager secret ID. Resolved at runtime; never stored in state. |
| `secret_rotation_period` | 6 | `'2592000s'` | Frequency at which Secret Manager emits rotation notifications. Default: 30 days. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

Setting `ingress_settings = 'internal-and-cloud-load-balancing'` forces all Listmonk traffic through the LB, preventing direct `*.run.app` URL access.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

**Listmonk consideration:** Listmonk serves a mix of API endpoints and static assets. CDN is most beneficial for the static UI assets (HTML, JS, CSS). Listmonk API responses (`/api/*`) are not cacheable and should be excluded from CDN caching via Cache-Control headers or URL pattern rules.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Maximum number of recent container images to keep in Artifact Registry. Set `0` to disable. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged (dangling) images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. Set `0` to disable age-based deletion. |

### C. Custom Domains

Custom domains are attached to the Global HTTPS Load Balancer via `application_domains`. Google-managed SSL certificates are provisioned automatically. DNS must point to the load balancer IP after apply.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. (e.g., `['newsletters.example.com']`) |

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

When `enable_cicd_trigger = true`, a Cloud Build GitHub connection and push trigger are provisioned. The trigger builds and deploys a custom Listmonk image when code is pushed to the configured branch.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. Requires `github_repository_url` and credentials. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT (`repo`, `admin:repo_hook` scopes). Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID (preferred for organisation repos). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Cloud Deploy Pipeline

When `enable_cloud_deploy = true` (requires `enable_cicd_trigger = true`), the CI/CD pipeline is upgraded to a managed Cloud Deploy delivery pipeline with sequential promotion stages.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered promotion stages. Each: `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Reliability & Scheduling

### A. Scaling & Concurrency

Listmonk is a stateless Go binary — multiple Cloud Run instances can serve requests simultaneously without shared session state issues. The default `min_instance_count = 1` ensures one instance is always warm. Campaign processing (sending emails to large subscriber lists) can be resource-intensive; increase `max_instance_count` if processing throughput is a concern.

### B. Traffic Splitting

Traffic splitting is supported. Listmonk's stateless design makes canary deployments safe — all requests share the same PostgreSQL backend regardless of which instance handles them.

| Variable | Group | Default | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Percentage-based traffic allocation across named revisions. All entries must sum to 100. Empty sends 100% to the latest revision. |

### C. Health Probes & Uptime Monitoring

Listmonk exposes a dedicated `/api/health` endpoint that returns HTTP 200 when the application and database connection are healthy. Both startup and liveness probes target this endpoint.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/api/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=10, failure_threshold=30 }` | Startup readiness probe. Container receives no traffic until this succeeds. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/api/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe. Container is restarted after `failure_threshold` consecutive failures. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/health" }` | Cloud Monitoring uptime check. Alerts notify `support_users` if unreachable. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

**Startup probe behaviour:** The `failure_threshold=30` combined with `period_seconds=10` gives Listmonk up to 300 seconds (plus the 30-second initial delay) to complete schema installation on first boot. This is generous — Listmonk schema installation typically completes in under 30 seconds on a fresh PostgreSQL instance.

### D. Auto Password Rotation

When `enable_auto_password_rotation = true`, a zero-downtime password rotation pipeline is provisioned:

1. Secret Manager emits a rotation notification at every `secret_rotation_period` interval.
2. Eventarc fires a Cloud Run rotation Job.
3. The job generates a new password, updates the Cloud SQL PostgreSQL user, writes a new secret version.
4. After `rotation_propagation_delay_sec` seconds, the job restarts the Listmonk service.

Listmonk re-establishes its database connection on restart and reads the updated password from Secret Manager.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after writing the new secret before restarting the service. |

---

## 8. Integrations

### A. Mail Sending (SMTP / API)

Listmonk connects to external mail providers for sending campaigns and transactional messages. Configure the mail provider via the Listmonk admin UI at **Settings → SMTP** after deployment. Common providers include Mailgun, Amazon SES, Postmark, and SendGrid.

Listmonk supports both SMTP and native API integrations (Mailgun, SES, Postmark, Sparkpost). For high-volume sending, API integrations are preferred over SMTP.

**Configuration approach:** Mail provider credentials are not set via module variables. After deployment, navigate to the Listmonk admin interface and configure:
1. **Settings → SMTP** for SMTP-based sending.
2. **Settings → Sending settings** for rate limiting (messages per minute), concurrency, and retry settings.

To persist these settings across redeployments, export the Listmonk settings as a SQL dump and import on restore.

### B. Backup Import & Recovery

When `enable_backup_import = true`, a dedicated Cloud Run Job restores an existing PostgreSQL database backup into the provisioned Cloud SQL instance. This runs after the `db-init` job and before the Listmonk service is deployed.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. Set `false` after a successful import. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (Drive file ID). |
| `backup_uri` | 7 | `""` | Full GCS URI (e.g., `'gs://my-bucket/listmonk-backup.sql'`) or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### C. Observability & Alerting

A Cloud Monitoring uptime check polls the `/api/health` endpoint from multiple global locations. Custom alert policies can monitor Cloud Run metrics and notify `support_users`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/health" }` | Uptime check: `enabled`, `path`, `check_interval`, `timeout`. |
| `alert_policies` | 14 | `[]` | Metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 2 | `[]` | Email addresses notified by uptime and alert policy triggers. |

---

## 9. Exploring with the GCP Console

After a successful deployment, use the GCP Console to verify and explore the Listmonk deployment.

**Cloud Run Service**

Navigate to **Cloud Run** in the console and select the `listmonk` service (named `app<listmonk><tenant><id>`). Key areas to review:
- **Revisions tab**: Shows all deployed container revisions, traffic allocation percentages, and container image digests. The active revision should show the `latest` tag or a specific version.
- **Logs tab**: Streams Cloud Run container logs in real time. Filter for `severity=ERROR` to surface Listmonk startup or database connection issues. On first boot, look for Listmonk's schema installation log lines (`Running install...`, `Admin user created`).
- **Metrics tab**: Displays request count, request latency (P50/P95/P99), instance count, and container startup latency. Spike in instance count during a large campaign send is expected.
- **YAML tab**: Shows the full Cloud Run service specification including environment variable names (not values), volume mounts, health probe configuration, and resource limits.

**Secret Manager**

Navigate to **Secret Manager** and filter by the deployment name. Two secrets are relevant:
- `app<listmonk><tenant><id>-admin-password` or similar — the `LISTMONK_app__admin_password` secret. Click **View secret versions** to confirm a version exists. **Do not click View secret value** in production.
- `app<listmonk><tenant><id>-db-password` — the PostgreSQL password secret. Used by both the Cloud Run service and the `db-init` job.

Select either secret and review the **Replication** tab to confirm the secret is replicated to the deployment region.

**Cloud SQL**

Navigate to **SQL** and open the Listmonk Cloud SQL instance. Key areas:
- **Overview**: Confirms PostgreSQL 15 engine, the instance tier, and storage size.
- **Databases tab**: The `listmonk` database should be listed. After first deployment, Listmonk's schema tables will be present.
- **Users tab**: The `listmonk` application user should be listed.
- **Connections tab**: Review **Authorized networks** and confirm that only the Cloud SQL Auth Proxy (via the Cloud Run SA) has access. No public IP should be required.
- **Backups tab**: Confirms automated backup schedule and lists recent backup files.
- **Operations tab**: Shows recent operations including the `db-init` job's connection history.

**Cloud Build**

Navigate to **Cloud Build → History** to review recent build runs. The initial deployment triggers a build to package the Listmonk container image. Each build entry shows the image tag, build duration, and any step-level logs. Click a build to see the Dockerfile steps and the final `docker push` to Artifact Registry.

**Artifact Registry**

Navigate to **Artifact Registry** and open the `listmonk` repository. The repository lists all pushed image tags with their digests, push timestamps, and sizes. Confirm the latest image is present.

**Cloud Monitoring**

Navigate to **Monitoring → Uptime checks** and find the Listmonk uptime check. The check polls `/api/health` from multiple global locations. A green status confirms the service is reachable and healthy from GCP's global network.

Navigate to **Monitoring → Alerting** to see any active alert policies created by the module. `support_users` are automatically added as notification channel recipients.

---

## 10. Exploring with gcloud

The following gcloud commands provide operational visibility into the Listmonk Cloud Run deployment. Replace `PROJECT_ID`, `REGION`, and `SERVICE_NAME` with your deployment values. The service name follows the pattern `app<listmonk><tenant><id>` — retrieve it from the `service_name` Terraform output.

**Retrieve the service URL and configuration:**

```bash
# Get the Cloud Run service URL
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(status.url)"

# Describe the full service configuration
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format=yaml
```

**Check service health and revisions:**

```bash
# List all revisions and their traffic allocations
gcloud run revisions list \
  --service=SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name,status.conditions[0].status,spec.containers[0].image,status.observedGeneration)"

# Check revision traffic split
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(spec.traffic[].percent,spec.traffic[].revisionName)"
```

**Stream and filter logs:**

```bash
# Tail live logs from the Listmonk service
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME" \
  --project=PROJECT_ID \
  --limit=50 \
  --freshness=10m \
  --format="table(timestamp,severity,textPayload)"

# Filter for errors only
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME AND severity>=ERROR" \
  --project=PROJECT_ID \
  --limit=20

# View db-init job logs
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name~db-init" \
  --project=PROJECT_ID \
  --limit=30 \
  --format="table(timestamp,severity,textPayload)"
```

**Inspect secrets:**

```bash
# List all Secret Manager secrets in the project (filter by deployment)
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~listmonk" \
  --format="table(name,replication.automatic,createTime)"

# Check secret versions for the admin password
gcloud secrets versions list LISTMONK_app__admin_password_SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# Access the admin password (use with caution — only in break-glass scenarios)
gcloud secrets versions access latest \
  --secret=LISTMONK_ADMIN_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID
```

**Cloud SQL inspection:**

```bash
# List Cloud SQL instances
gcloud sql instances list \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,settings.tier,region,state)"

# Describe the Listmonk instance
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(databaseVersion,settings.tier,settings.ipConfiguration,state)"

# List databases on the instance
gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID

# List users on the instance
gcloud sql users list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID
```

**Cloud Run Jobs (db-init):**

```bash
# List all Cloud Run Jobs in the region
gcloud run jobs list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name,status.conditions[0].status,metadata.creationTimestamp)"

# Describe the db-init job
gcloud run jobs describe JOB_NAME \
  --region=REGION \
  --project=PROJECT_ID

# Manually execute the db-init job (e.g., after a database recreation)
gcloud run jobs execute JOB_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --wait
```

**Uptime and monitoring:**

```bash
# List uptime checks
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,checkerType)"

# List Cloud Monitoring alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].displayName)"
```

**Artifact Registry:**

```bash
# List images in the Listmonk repository
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/listmonk \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)" \
  --include-tags

# List all tags for the Listmonk image
gcloud artifacts docker tags list REGION-docker.pkg.dev/PROJECT_ID/listmonk/listmonk \
  --project=PROJECT_ID
```

---

## 11. Platform-Managed Behaviours

The following behaviours are applied automatically by `Listmonk CloudRun` regardless of variable values.

| Behaviour | Detail |
|---|---|
| **PostgreSQL 15 required** | `database_type = "POSTGRES_15"` default. Listmonk does not support MySQL or other engines. |
| **Admin password auto-generated** | `LISTMONK_app__admin_password` is generated by `Listmonk Common` and stored in Secret Manager. Never stored in state. |
| **DB password env var pre-set** | `db_password_env_var_name = "LISTMONK_db__password"` is pre-configured so `App CloudRun` injects the database password under the correct name for Listmonk's config. |
| **GCS Fuse upload path** | `LISTMONK_upload__provider=filesystem` and `LISTMONK_upload__filesystem__upload_path=/listmonk/uploads` are injected automatically. Mount a GCS bucket at `/listmonk/uploads` via `gcs_volumes` for persistent uploads. |
| **Default db-init job** | Supplied by `Listmonk Common` when `initialization_jobs = []`. PostgreSQL database and user are created automatically. |
| **Image mirroring enabled** | `enable_image_mirroring = true` by default. The Listmonk base image is mirrored into Artifact Registry before deployment. |
| **Redis disabled by default** | `enable_redis = false`. Listmonk does not require Redis for standard operation. |
| **Scripts directory** | `scripts_dir` is resolved to `Listmonk_Common/scripts` at apply time. |

---

## 12. Variable Reference

All user-configurable variables exposed by `Listmonk CloudRun`, sorted by UI group then order.

| Variable | Group | Default | Description |
|---|---|---|---|
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region for all resources. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'listmonk'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `'Listmonk'` | Human-readable name. |
| `description` | 3 | (Listmonk description) | Service description. |
| `application_version` | 3 | `'latest'` | Listmonk container image tag. |
| `admin_username` | 3 | `'listmonk'` | Initial admin username created on first boot. Can be changed via the UI after deployment. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance. |
| `memory_limit` | 4 | `'512Mi'` | Memory per instance. |
| `min_instance_count` | 4 | `1` | Minimum running instances. Set to `0` for scale-to-zero. |
| `max_instance_count` | 4 | `3` | Maximum running instances. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for GCS Fuse mounts. |
| `timeout_seconds` | 4 | `300` | Max request duration in seconds. |
| `enable_cloudsql_volume` | 4 | `true` | Auth Proxy sidecar for Unix socket connections to PostgreSQL. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for the Auth Proxy Unix socket. |
| `container_port` | 4 | `9000` | Listmonk's native HTTP port. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Listmonk image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{}` | Plain-text env vars. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full URI) or `'gdrive'` (file ID). |
| `backup_uri` | 7 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |
| `nfs_instance_name` | 9 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Base name for inline NFS VM. Deployment ID is appended. |
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[]` | Additional GCS buckets to provision. |
| `enable_nfs` | 11 | `false` | Provisions NFS shared storage. Not required for standard Listmonk deployments. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse. Mount uploads bucket at `/listmonk/uploads`. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. Do not change — Listmonk requires PostgreSQL. |
| `db_name` | 12 | `'listmonk'` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | 12 | `'listmonk'` | PostgreSQL application user. |
| `db_password_env_var_name` | 12 | `'LISTMONK_db__password'` | Env var name for DB password injection. Do not change. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for default `db-init` job. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 14 | `{ path="/api/health", initial_delay_seconds=30, failure_threshold=30, ... }` | Startup probe. |
| `liveness_probe` | 14 | `{ path="/api/health", initial_delay_seconds=30, failure_threshold=3, ... }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `false` | Redis integration. Not required for Listmonk. |
| `redis_host` | 21 | `""` | Redis hostname/IP. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. Auto-discovered from project when empty. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 13. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the Cloud Run service. |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |

---

## 14. Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `project_id` | _(required)_ | **Critical** | No default — deployment fails immediately. |
| `database_type` | `"POSTGRES_15"` | **Critical** | Listmonk exclusively supports PostgreSQL. Changing to MySQL or SQL Server causes Listmonk to fail at startup. |
| `db_name` | `"listmonk"` | **Critical** | Immutable after first deployment — changing this causes Terraform to recreate the database, destroying all subscribers, campaigns, and settings. |
| `db_user` | `"listmonk"` | **Critical** | Immutable after first deployment — changing this recreates the Cloud SQL user and invalidates all stored credentials. |
| `db_password_env_var_name` | `"LISTMONK_db__password"` | **Critical** | Listmonk reads this exact env var name for its database password. Changing it causes Listmonk to fail to connect to PostgreSQL at startup. |
| `min_instance_count` | `1` | **Medium** | Scale-to-zero (`0`) causes cold starts during which PostgreSQL connection pools must be re-established. For active mailing list managers processing campaign requests, cold starts can cause request timeouts. |
| `memory_limit` | `"512Mi"` | **Medium** | Sufficient for small lists. Lists with millions of subscribers or concurrent campaign processing can exhaust 512Mi under load. Increase to 1–2 Gi for production deployments with large subscriber counts. |
| `enable_cloudsql_volume` | `true` | **Critical** | Listmonk connects to PostgreSQL via the Auth Proxy Unix socket by default. Disabling the volume without providing a TCP connection path causes all database operations to fail. |
| `gcs_volumes` | `[]` | **Medium** | Without a GCS Fuse volume at `/listmonk/uploads`, media file uploads are stored ephemerally on the container filesystem and lost when the revision is replaced. Configure for any deployment that accepts file attachments or media uploads. |
| `ingress_settings` | `"all"` | **Medium** | `"all"` exposes Listmonk's admin interface to the public internet. For internal newsletter deployments, consider `enable_iap = true` or `ingress_settings = "internal"`. |
| `enable_cloud_armor` | `false` | **Medium** | Without Cloud Armor, the Listmonk API and admin interface are exposed without WAF protection. Large-scale subscriber lists are valuable targets for scraping. Recommended for any production deployment. |
| `backup_retention_days` | `7` | **Medium** | Seven days is insufficient for production subscriber databases. Losing subscriber data, campaign history, and unsubscribe records is a serious compliance risk. Increase to 30+ days for any production deployment. |
| `enable_backup_import` | `false` | **Critical** | Requires `backup_uri` to be a valid, accessible GCS or Drive path. Enabling with an empty `backup_uri` causes the restore Cloud Run job to fail during apply. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | **Medium** | Listmonk must reach external SMTP/API providers for campaign sending. `PRIVATE_RANGES_ONLY` permits direct public egress. Changing to `"ALL_TRAFFIC"` with a restrictive VPC firewall will block outbound SMTP/API connections and silently prevent campaign delivery. |
| `secret_propagation_delay` | `30` | **Low** | Occasionally insufficient in multi-region setups. Increase to 60–90s if secrets are not found during apply. |

---

## 15. Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after a Cloud Run service is deleted. These addresses are released by GCP approximately **20–30 minutes** after the Cloud Run service is removed.

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run the destroy command:

```bash
tofu destroy
```

The second run will succeed once GCP has released the reserved addresses.
