---
title: "App Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# App_CloudRun Module — Configuration Guide

This guide describes every configuration variable available in the `App_CloudRun` module, organized into functional groups. For each variable it explains the available options, the implications of each choice, and how to validate the resulting configuration in the Google Cloud Console or using the `gcloud` CLI.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Security Architecture Overview

The `App_CloudRun` module implements a layered, defence-in-depth security posture. The controls below compose into a complete security architecture — each layer operates independently so that a failure or bypass of one control does not compromise the others. Enable controls progressively based on the sensitivity of the workload.

<div className="security-arch-table">

| Layer | Control | Variable(s) | Group |
|---|---|---|---|
| **Perimeter** | Cloud Armor WAF + DDoS mitigation | `enable_cloud_armor` | 16 |
| **Perimeter** | Identity-Aware Proxy authentication | `enable_iap`, `iap_authorized_users`, `iap_authorized_groups` | 15 |
| **Perimeter** | Ingress restriction to load balancer only | `ingress_settings = "internal-and-cloud-load-balancing"` | 14 |
| **Network** | All egress routed through VPC | `vpc_egress_setting = "ALL_TRAFFIC"` | 14 |
| **Network** | API-level perimeter (data exfiltration prevention) | `enable_vpc_sc` | 17 |
| **Identity** | Dedicated minimum-privilege service account | Provisioned automatically | — |
| **Identity** | Workload authenticates to Cloud SQL via IAM (no keys) | `enable_cloudsql_volume` | 3 |
| **Secrets** | Secret Manager references (plaintext never in state) | `secret_environment_variables` | 4 |
| **Secrets** | Automated database credential rotation | `enable_auto_password_rotation`, `secret_rotation_period` | 11, 4 |
| **Data** | Private-IP-only Cloud SQL | Provisioned automatically | — |
| **Data** | Customer-managed encryption keys (CMEK) | `manage_storage_kms_iam` | 9 |
| **Data** | Public access prevention on GCS buckets | `public_access_prevention = "enforced"` | 9 |
| **Data** | Object lifecycle rules for data minimisation | `lifecycle_rules`, `backup_retention_days` | 9, 12 |
| **Supply chain** | Binary Authorization attestation enforcement | `enable_binary_authorization` | 7 |
| **Supply chain** | Container images mirrored to project registry | `enable_image_mirroring` | 3 |
| **Visibility** | Cloud Monitoring alert policies | `alert_policies` | 5 |
| **Visibility** | Uptime checks from global probe locations | `uptime_check_config` | 5 |

</div>

**Recommended minimum for internet-facing production workloads:**
1. Set `ingress_settings = "internal-and-cloud-load-balancing"` and `enable_cloud_armor = true` (Groups 14 and 16) — WAF and DDoS protection with ingress locked to the load balancer
2. Set `enable_iap = true` (Group 15) for any service that should require Google identity authentication
3. Set `vpc_egress_setting = "ALL_TRAFFIC"` (Group 14) when consistent egress IP control is needed
4. Set `enable_auto_password_rotation = true` (Group 11) for all production database-backed deployments
5. Set `enable_binary_authorization = true` (Group 7) for regulated environments requiring supply chain integrity

> **PSE Certification note:** This module's security controls map directly to the Google Cloud Professional Cloud Security Engineer exam domains. See the [PSE Section 1 guide](../../certification/PSE_Section_1_Exploration_Guide.md) (identity), [PSE Section 2](../../certification/PSE_Section_2_Exploration_Guide.md) (communications and boundary protection), [PSE Section 3](../../certification/PSE_Section_3_Exploration_Guide.md) (data protection), [PSE Section 4](../../certification/PSE_Section_4_Exploration_Guide.md) (operations), and [PSE Section 5](../../certification/PSE_Section_5_Exploration_Guide.md) (compliance) for hands-on exploration guidance mapped to each group.

---

## Group 0: Module Metadata & Configuration

These variables describe the module to the platform catalogue and control platform-level behaviours such as credit billing, resource purge protection, and wrapper-module integration. They are *platform-managed* and should not be changed unless you are customising or extending the module itself.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `module_description` | `"App_CloudRun: A production-ready module…"` | Any string | Human-readable description displayed in the platform catalogue. Change only when forking or white-labelling the module. |
| `module_documentation` | `"https://docs.radmodules.dev/…"` | Valid URL | URL shown as a help link in the platform UI. Update if you host your own documentation. |
| `module_dependency` | `["Services_GCP"]` | List of module names | Declares which platform modules the platform catalogue will associate with this one for dependency tracking and display purposes. All required GCP prerequisites (APIs, networking, IAM) are provisioned automatically by this module if not already present. Optionally, deploying `Services_GCP` first is recommended when multiple deployments need to share a common set of platform resources — for example a shared Cloud SQL instance, NFS server, or VPC network — as `Services_GCP` provisions these shared resources centrally. |
| `module_services` | *(list of GCP service names)* | List of strings | Informational list of GCP services this module uses, shown in the catalogue. No operational effect. |
| `credit_cost` | `100` | Positive integer | Number of platform credits deducted when a deployment is created. Set by the platform administrator. |
| `require_credit_purchases` | `true` | `true` / `false` | Determines whether purchased credits (credits bought by the user or assigned via a subscription plan) are consumed for this deployment, as opposed to free credits which are awarded at no charge. When `true`, the platform deducts from the user's purchased credit balance. When `false`, the platform uses free credits instead. |
| `enable_purge` | `true` | `true` / `false` | Controls whether the deployment configuration can be removed from the portal. When `true`, a user can delete the deployment record from the portal without affecting the underlying GCP resources — the Cloud Run service, database, buckets, and secrets remain intact on GCP and continue to run. This is useful when resources were initially provisioned via the portal but the team wishes to manage them independently going forward. When `false`, the portal will not allow the configuration to be removed. **This setting does not destroy GCP resources.** |
| `public_access` | `false` | `true` / `false` | When `true`, the module is listed in the public platform catalogue and any user can deploy it. When `false`, the module is visible only to platform administrators and the module owner or publisher. |
| `deployment_id` | `""` *(auto-generated)* | Alphanumeric string | A unique identifier for this deployment. If left blank the platform generates one automatically. Once set, do not change this value — it is embedded in resource names and changing it will cause resources to be recreated. |
| `resource_creator_identity` | `"rad-module-creator@…"` | Service account email | The service account used to create and manage GCP resources. For enhanced security, replace with a project-scoped service account that has been granted only the permissions required by this module. |
| `application_config` | `{}` | Object (any) | Injected by wrapper modules (e.g. `Ghost_CloudRun`). Leave empty when deploying standalone. |
| `module_storage_buckets` | `[]` | List | Additional GCS bucket definitions injected by a wrapper module. Leave empty when deploying standalone. |
| `module_env_vars` | `{}` | Map of strings | Additional plain-text environment variables injected by a wrapper module. Leave empty when deploying standalone. |
| `module_secret_env_vars` | `{}` | Map of strings | Additional Secret Manager variable references injected by a wrapper module. Leave empty when deploying standalone. |
| `scripts_dir` | `""` *(built-in)* | Filesystem path | Path to the initialisation scripts directory. Leave blank to use the built-in scripts. Override only when a wrapper module supplies custom scripts. |

### Validating Group 0 Settings

These variables do not create GCP resources directly, so there is nothing to validate in the console. The effects of `enable_purge` and `public_access` are enforced by the platform layer, not by GCP.

To confirm which service account is being used to manage resources:

**Google Cloud Console:** Navigate to **IAM & Admin → IAM** and filter by the service account email set in `resource_creator_identity`.

**gcloud CLI:**
```bash
# List IAM policy bindings for the service account
gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --format="table(bindings.role)"
```

---

## Group 1: Project & Identity

> **ACE Exam Connection:** This group maps to ACE Section 1.1 (Setting up cloud projects and accounts) and Section 1.2 (Managing billing configuration). The `project_id` variable demonstrates GCP's resource hierarchy; `support_users` demonstrates IAM group-based access management; `resource_labels` demonstrates billing export and cost attribution.

These variables establish the GCP project context and the shared identity settings that apply across all resources created by the module. They must be configured correctly before any deployment can succeed.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `project_id` | *(required)* | `[a-z][a-z0-9-]{4,28}[a-z0-9]` | The GCP project ID where all resources will be provisioned. All required GCP prerequisites (APIs, networking, IAM) are provisioned automatically if not already present. Optionally, `Services_GCP` can be deployed first to provision shared platform resources (such as a shared Cloud SQL instance, NFS server, or VPC network) that multiple deployments in the same project can then reuse. **All resource names, IAM bindings, secrets, and API calls are scoped to this project.** Changing this after initial deployment will cause all resources to be recreated in the new project. |
| `tenant_deployment_id` | `"demo"` | `[a-z0-9-]{1,20}` | A short label appended to resource names (e.g. Cloud Run service, secrets, SQL instance) to distinguish this deployment from others in the same project. Use values such as `prod`, `staging`, `dev`, or a customer/tenant identifier. **Do not change this after initial deployment** — it is baked into resource names and changing it will cause all resources to be recreated with new names, leaving the old ones orphaned. |
| `support_users` | `[]` | List of email addresses | Email addresses that receive Cloud Monitoring alert notifications (uptime failures, high latency, error rate spikes). These addresses are added to a notification channel in Cloud Monitoring. Leave empty to suppress all alert emails. Adding addresses here does not grant any GCP IAM permissions. |
| `resource_labels` | `{}` | Map of `key = "value"` pairs | Key-value labels applied to every GCP resource created by this module (Cloud Run service, Cloud SQL instance, GCS buckets, secrets, etc.). Use labels to enforce organisational tagging policies — for example cost centre, environment, team ownership, or compliance classification. Labels are visible in the Billing reports and can be used to filter resources in the Console. GCP label keys and values must be lowercase, 1–63 characters, and may contain letters, numbers, hyphens, and underscores. |

### Validating Group 1 Settings

**Google Cloud Console:**
- **Project confirmation:** The project name and ID are shown in the top navigation bar. Navigate to **Home → Dashboard** to confirm you are in the correct project.
- **Labels:** Navigate to any resource (e.g. **Cloud Run → Services → *your service***) and select the **Details** tab to verify labels are applied correctly.
- **Alert notification channels:** Navigate to **Monitoring → Alerting → Notification channels** to confirm support user email addresses are registered.

**gcloud CLI:**
```bash
# Confirm the project exists and is active
gcloud projects describe PROJECT_ID

# List all resources in the project with a specific label
gcloud run services list --project=PROJECT_ID \
  --format="table(name,metadata.labels)"

# List Cloud Monitoring notification channels (alert recipients)
gcloud beta monitoring channels list --project=PROJECT_ID \
  --format="table(displayName,type,labels.email_address)"
```

---

## Group 2: Application Identity

These variables define the identity of the application being deployed. They control how the application is named across GCP services, how it appears in the console and monitoring dashboards, and how deployments are versioned and tracked.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"crapp"` | `[a-z][a-z0-9-]{0,19}` (1–20 chars) | The internal identifier for the application. Used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, Cloud SQL database, and GCS buckets. Must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens. **Do not change this after initial deployment** — it is embedded in resource names and changing it will cause all named resources to be recreated, leaving the originals orphaned. Choose a short, meaningful identifier such as `crm-app`, `payments-api`, or `customer-portal`. |
| `application_display_name` | `"App_CloudRun Application"` | Any string | A human-readable name shown in the platform UI, the Cloud Run service list, and monitoring dashboards. Unlike `application_name`, this can be updated freely at any time without affecting resource names. Use a descriptive title that helps operators identify the service at a glance, e.g. `Customer Portal`, `Payment Processing API`. |
| `application_description` | `"App_CloudRun Custom Application…"` | Any string | A brief description of the application's purpose. Populated into the Cloud Run service description field and used in platform documentation. Visible in the Cloud Run console under the service details. Update this to accurately describe your application — it is particularly useful for audit and governance purposes when multiple services exist in the same project. |
| `application_version` | `"1.0.0"` | Any string (e.g. `v1.2.3`, `latest`, `sha-8f2b1a`) | The version tag applied to the container image and used for deployment tracking. When `container_image_source` is `custom`, incrementing this value triggers a new Cloud Build run and creates a new tagged image in Artifact Registry. When using `prebuilt`, this value is informational only. Using a versioning convention such as [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`) is strongly recommended to maintain a clear audit trail of what is deployed. Avoid using `latest` in production as it makes it impossible to determine exactly which code is running. |

### Validating Group 2 Settings

**Google Cloud Console:**
- **Cloud Run service name:** Navigate to **Cloud Run → Services** and confirm the service is listed with the expected name (derived from `application_name`).
- **Service description & display name:** Click the service, then select the **Details** tab to view the description.
- **Artifact Registry repository:** Navigate to **Artifact Registry → Repositories** to confirm a repository named after `application_name` has been created.
- **Image versions:** Within the Artifact Registry repository, select the repository to view all tagged image versions and confirm the expected `application_version` tag is present.

**gcloud CLI:**
```bash
# Confirm the Cloud Run service exists and view its description
gcloud run services describe APPLICATION_NAME \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"

# List all tagged images for the application in Artifact Registry
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/APPLICATION_NAME \
  --include-tags \
  --format="table(image,tags,createTime)"

# List Secret Manager secrets associated with the application
gcloud secrets list --project=PROJECT_ID \
  --filter="name:APPLICATION_NAME" \
  --format="table(name,createTime)"
```

---

## Group 3: Runtime & Scaling

> **ACE Exam Connection:** This group maps to ACE Section 2.1 (Planning and implementing compute resources) and Section 3.1 (Managing compute resources). Key variables: `min_instance_count`/`max_instance_count` demonstrate Cloud Run autoscaling; `container_resources` demonstrates resource sizing; `traffic_split` demonstrates canary and blue-green deployment strategies; `execution_environment` demonstrates Cloud Run gen2 capabilities.

These variables control how the application container is sourced, built, deployed, and scaled on Cloud Run. They are the core settings that determine the runtime behaviour of your application.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `deploy_application` | `true` | `true` / `false` | When `true`, the Cloud Run service is deployed as part of this configuration. Set to `false` to provision all supporting infrastructure (VPC, Cloud SQL, GCS buckets, secrets) without deploying the application container. This is useful for **infrastructure-first workflows** where the database and storage need to be seeded or configured before the application starts, or for staged rollouts where infrastructure is validated independently first. |
| `container_image_source` | `"custom"` | `prebuilt` / `custom` | Determines how the container image is obtained. **`prebuilt`**: deploys an existing image directly from any accessible container registry (e.g. Docker Hub, Artifact Registry, GitHub Container Registry) using the URI in `container_image`. No build step is performed. Use this for vendor-supplied images or images built externally. **`custom`**: uses Cloud Build to build the image from source code in the connected GitHub repository using the configuration in `container_build_config`. The built image is pushed to Artifact Registry and then deployed. |
| `container_image` | `""` | Full container image URI | The fully qualified URI of the container image to deploy. Required when `container_image_source` is `prebuilt`, or when `enable_image_mirroring` is `true` (as the source image to mirror). Examples: `us-docker.pkg.dev/my-project/my-repo/app:v1.0`, `nginx:1.25`, `ghcr.io/my-org/my-app:latest`. When using a public registry image such as Docker Hub, enabling `enable_image_mirroring` is strongly recommended to avoid rate limiting and to ensure reproducibility. |
| `container_build_config` | `{ enabled = true }` | Object | Configuration passed to Cloud Build when `container_image_source` is `custom`. Key fields: **`enabled`** (`true`/`false`) — set to `false` to skip the build step entirely and deploy the last built image. **`dockerfile_path`** — relative path to the Dockerfile within the repository (default: `Dockerfile`). **`context_path`** — build context directory (default: `.`). **`build_args`** — map of `ARG` values passed to the Docker build (e.g. `{ ENV = "prod" }`). **`artifact_repo_name`** — name of the Artifact Registry repository to push the built image to; leave blank to use the auto-created repository named after `application_name`. |
| `enable_image_mirroring` | `true` | `true` / `false` | When `true`, the image specified in `container_image` is copied into the project's Artifact Registry repository before deployment. **Strongly recommended when using external public images** (Docker Hub, GitHub Container Registry, etc.) for three reasons: (1) avoids registry pull rate limits at scale; (2) ensures the image remains available even if the upstream registry is unavailable; (3) gives you a verifiable, project-scoped copy for audit and compliance purposes. Has no effect when `container_image_source` is `custom`, as the image is already built into Artifact Registry. |
| `min_instance_count` | `0` | Integer `0`–`1000` | The minimum number of container instances kept running at all times. **`0` (scale-to-zero):** instances are shut down when there is no traffic, eliminating idle compute costs. The trade-off is a **cold start** delay (typically 1–10 seconds) on the first request after a period of inactivity. **`1` or more:** at least one instance is always warm, eliminating cold starts. Recommended for latency-sensitive applications, APIs with SLA requirements, or services that maintain connections to Cloud SQL or Redis. For `cpu_always_allocated = false`, setting `min_instance_count` > 0 incurs continuous instance costs even when idle. |
| `max_instance_count` | `1` | Integer `1`–`1000` | The maximum number of container instances Cloud Run is permitted to scale up to under load. Acts as a cost ceiling and a safeguard against runaway scaling caused by traffic spikes or denial-of-service events. Each instance handles requests concurrently (Cloud Run default is 80 concurrent requests per instance). **Set this value based on your expected peak traffic and your downstream resource limits** — for example, a Cloud SQL instance has a maximum connection limit, so `max_instance_count` × connections-per-instance must not exceed it. |
| `cpu_always_allocated` | `true` | `true` / `false` | **`true`:** CPU is allocated to the container at all times, even when it is not processing a request. This enables background processing, scheduled tasks within the container, and WebSocket connections. Costs are incurred continuously per instance. **`false`:** CPU is only allocated during request processing; it is throttled to near-zero between requests. Reduces cost for low-traffic workloads but prevents any background computation. Incompatible with applications that run background threads or maintain persistent connections (e.g. message queue consumers). |
| `container_port` | `8080` | Integer `1`–`65535` | The TCP port that your application server listens on inside the container. Cloud Run routes all inbound HTTP(S) traffic to this port. **This must match the port your application actually binds to** — a mismatch will cause all requests to fail with a connection error. Common values: `8080` (Java, Go, Node.js defaults), `3000` (Node.js/Express), `5000` (Flask/Python), `80` (nginx). |
| `container_protocol` | `"http1"` | `http1` / `h2c` | The HTTP protocol version Cloud Run uses to communicate with your container. **`http1`:** standard HTTP/1.1. Compatible with all web frameworks. Use this for REST APIs, web applications, and any service that does not specifically require HTTP/2. **`h2c`:** HTTP/2 cleartext (unencrypted). Required for **gRPC services**, as gRPC is built on HTTP/2. Also beneficial for services that send large payloads or use server streaming, as HTTP/2 supports multiplexing and header compression. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Object | CPU and memory resource limits for the container. **`cpu_limit`**: specified in millicores — `1000m` = 1 vCPU, `2000m` = 2 vCPU. Cloud Run supports `1000m`, `2000m`, `4000m`, `6000m`, and `8000m`. **`memory_limit`**: specified as `Mi` (mebibytes) or `Gi` (gibibytes), e.g. `512Mi`, `1Gi`, `2Gi`, `4Gi`. Cloud Run supports up to `32Gi`. **Sizing guidance:** start with `1000m` / `512Mi` and increase based on observed CPU and memory utilisation in Cloud Monitoring. Note that CPUs above `1000m` require `cpu_always_allocated = true`. `cpu_request` and `mem_request` are optional and default to the limit values if not specified. |
| `execution_environment` | `"gen2"` | `gen1` / `gen2` | The Cloud Run execution environment generation. **`gen2` (recommended):** runs on a full Linux environment, supports NFS volume mounts, GCS Fuse mounts, larger network buffers, and has faster startup times. Required when `enable_nfs` or `gcs_volumes` are used. **`gen1`:** the legacy environment. Use only if your container image relies on behaviour specific to gen1 (e.g. certain system calls not supported in gen2). Gen1 does not support NFS mounts. |
| `timeout_seconds` | `300` | Integer `0`–`3600` | The maximum duration in seconds Cloud Run will wait for a single HTTP request to complete before returning a `504 Gateway Timeout`. **Increase** this value for long-running operations such as file processing, database migrations, report generation, or large data imports. **Keep low** for interactive APIs to surface slow responses early and free resources quickly. The maximum permitted value is `3600` (1 hour). |
| `enable_cloudsql_volume` | `true` | `true` / `false` | When `true`, a Cloud SQL Auth Proxy sidecar is injected into the Cloud Run service. The proxy creates a secure Unix socket at the path defined by `cloudsql_volume_mount_path`, which the application uses instead of a direct TCP connection. This is the **recommended and most secure** way to connect to Cloud SQL — it uses IAM authentication and encrypts the connection without exposing the database to the public internet. Set to `false` only if your application connects to Cloud SQL via a private IP address over TCP directly. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Filesystem path | The path inside the container where the Cloud SQL Auth Proxy Unix socket is mounted. Your application's database connection string must reference this path. For example, a PostgreSQL connection string would be `host=/cloudsql/PROJECT:REGION:INSTANCE`. Only relevant when `enable_cloudsql_volume` is `true`. Change this only if your application framework expects the socket at a specific non-default path. |
| `traffic_split` | `[]` *(all traffic to latest)* | List of objects | Defines how incoming traffic is distributed across Cloud Run revisions. Leave empty to send 100% of traffic to the latest revision (default behaviour). Configure this for **canary deployments** (e.g. 90% to stable, 10% to new revision) or **blue-green deployments** (switch 100% to a specific revision on demand). Each entry requires: **`type`** — `TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST` (latest revision) or `TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION` (a named revision). **`percent`** — percentage of traffic (0–100; all entries must sum to exactly 100). **`revision`** — required when type is `REVISION`; the Cloud Run revision name. **`tag`** — optional stable URL tag (e.g. `canary`, `stable`) that creates a dedicated URL for that revision for testing before shifting traffic. |

> **Real-World Example:** A team deploys a new checkout redesign as a Cloud Run revision. Rather than switching all users at once, they set `traffic_split` to route 5% to the new revision and 95% to the stable one. Cloud Monitoring dashboards show identical error rates after 30 minutes, so traffic is shifted to 50%, then 100% — all with zero downtime and no new deployment. If errors had spiked, 100% of traffic could be instantly redirected back to the stable revision by updating this variable alone.

### Validating Group 3 Settings

**Google Cloud Console:**
- **Service deployment & scaling:** Navigate to **Cloud Run → Services → *your service*** to confirm the service is deployed. The **Revisions** tab shows all deployed revisions, their traffic split, and scaling configuration.
- **Container image:** The **Revisions** tab shows the container image URI used by each revision.
- **Resource limits & scaling:** Click a revision and select **Container(s)** to view CPU, memory, min/max instances, and concurrency settings.
- **Execution environment:** Visible in the **Container(s)** tab of the revision details under **Execution environment**.
- **Artifact Registry images:** Navigate to **Artifact Registry → Repositories → *application_name*** to view all available image tags.

**gcloud CLI:**
```bash
# Describe the Cloud Run service and view scaling and resource config
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec,spec.traffic)"

# List all revisions and their traffic allocation
gcloud run revisions list \
  --service=SERVICE_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].status,spec.containerConcurrency,metadata.annotations)"

# View the current traffic split
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="table(spec.traffic)"

# List container images in Artifact Registry
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/APPLICATION_NAME \
  --include-tags \
  --format="table(image,tags,createTime)"
```

---

## Group 4: Environment Variables & Secrets

> **PSE Certification relevance:** This group directly maps to PSE exam Section 3.1 (protecting sensitive data) and Section 1.4 (fine-grained IAM). The module grants `roles/secretmanager.secretAccessor` only on the specific secrets the service requires — not at project level — demonstrating resource-level IAM as a least-privilege pattern. The `secret_rotation_period` and `enable_auto_password_rotation` (Group 11) variables relate to PSE Section 3.1's automated credential rotation objective.
> **ACE Exam Connection:** This group maps to ACE Section 4.2 (Managing service accounts — Securing Secrets). The `secret_environment_variables` variable demonstrates Secret Manager integration; `secret_rotation_period` demonstrates automated secret lifecycle management. Never store passwords in `environment_variables` — a direct ACE exam principle.

These variables control how configuration and sensitive credentials are delivered to the running container. A key principle here is the separation of **plain-text configuration** (non-sensitive settings injected directly as environment variables) from **sensitive credentials** (injected securely via Secret Manager references, never stored in plaintext).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `environment_variables` | `{}` | Map of `"VAR_NAME" = "value"` | Plain-text environment variables injected into every container instance at startup. Use for non-sensitive configuration such as feature flags, log levels, API base URLs, or application mode settings. Examples: `{ LOG_LEVEL = "info", FEATURE_NEW_UI = "true", API_BASE_URL = "https://api.example.com" }`. **Do not store passwords, tokens, API keys, or any sensitive values here** — they will be visible in the Cloud Run revision configuration and in Terraform state. Use `secret_environment_variables` for sensitive values instead. Changes to this map trigger a new Cloud Run revision. |
| `secret_environment_variables` | `{}` | Map of `"VAR_NAME" = "secret-name"` | Sensitive values injected as environment variables using Secret Manager references. The map key is the environment variable name exposed to the container; the map value is the name of an existing Secret Manager secret in the same project. Cloud Run retrieves the **latest active version** of the secret at instance startup — the plaintext value is never stored in configuration or state. Examples: `{ DB_PASSWORD = "app-db-password", STRIPE_KEY = "stripe-api-key" }`. The Cloud Run service account must have the `roles/secretmanager.secretAccessor` IAM role on each referenced secret (granted automatically by this module). If a referenced secret does not exist, the Cloud Run revision will fail to deploy. |
| `service_annotations` | `{}` | Map of `"annotation-key" = "value"` | Kubernetes-style annotations applied directly to the Cloud Run service resource. Used for advanced Cloud Run settings not exposed as first-class configuration options. Rarely needed for standard deployments. Example use case: manually specifying a Cloud SQL instance connection string via `run.googleapis.com/cloudsql-instances`. Incorrect annotations can prevent the service from deploying, so use only when specifically required. |
| `service_labels` | `{}` | Map of `"key" = "value"` | Labels applied specifically to the Cloud Run service resource, in addition to `resource_labels` which apply to all resources. Use for service-level cost attribution, operational grouping, or tagging policies that apply only to the Cloud Run service. Example: `{ tier = "frontend", billing-code = "team-a" }`. These labels appear in the Cloud Run service details and can be used to filter services in the console. |
| `secret_rotation_period` | `"2592000s"` *(30 days)* | Duration string in seconds, e.g. `"2592000s"` | How frequently Secret Manager publishes a **rotation notification** event via Pub/Sub to prompt the application or a rotation handler to update the secret value. Common values: `"604800s"` (7 days), `"2592000s"` (30 days), `"7776000s"` (90 days). **Important:** this setting does not rotate the secret automatically — it only triggers a notification. The actual rotation logic (generating a new value and updating the secret) must be implemented separately, either via `enable_auto_password_rotation` (for the database password) or a custom Cloud Function/Cloud Run Job. Applies to all secrets managed by this module. |
| `secret_propagation_delay` | `30` | Integer (seconds) | The number of seconds to wait after a secret is created or updated before proceeding with dependent operations (e.g. deploying a new Cloud Run revision). Secret Manager uses global replication, and a brief delay ensures the new secret version has fully propagated to all regions before instances attempt to read it. **Increase this value** (e.g. to `60` or `90`) if you experience deployment failures with errors indicating a secret version cannot be found, particularly in multi-region deployments. |

### Validating Group 4 Settings

**Google Cloud Console:**
- **Environment variables:** Navigate to **Cloud Run → Services → *your service* → Revisions**, select the latest revision, then click **Container(s)**. Plain-text environment variables are listed under **Environment variables**. Secret references are listed separately under **Secrets**.
- **Secret Manager secrets:** Navigate to **Security → Secret Manager** to view all secrets, their versions, rotation schedules, and access policies.
- **Secret IAM access:** In Secret Manager, click a secret and select the **Permissions** tab to confirm the Cloud Run service account has `Secret Accessor` permissions.
- **Rotation schedule:** In Secret Manager, click a secret and view the **Overview** tab — the rotation period is shown under **Rotation**.

**gcloud CLI:**
```bash
# View environment variables and secret references on the latest revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)"

# List all Secret Manager secrets in the project
gcloud secrets list --project=PROJECT_ID \
  --format="table(name,createTime,replication.automatic)"

# View the rotation config for a specific secret
gcloud secrets describe SECRET_NAME \
  --project=PROJECT_ID \
  --format="yaml(rotation,labels)"

# Confirm the Cloud Run service account has Secret Accessor access
gcloud secrets get-iam-policy SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"

# List versions of a specific secret
gcloud secrets versions list SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"
```

---

## Group 5: Observability & Health

> **ACE Exam Connection:** This group maps to ACE Section 1.1 (Provisioning Google Cloud Observability) and Section 3.4 (Monitoring and logging). The `uptime_check_config` variable creates synthetic monitors tested in the ACE exam; `alert_policies` demonstrates threshold-based alerting with MQL; startup and liveness probes demonstrate application health management on Cloud Run.

These variables configure how Cloud Run monitors the health of individual container instances and how Cloud Monitoring observes the application from the outside. Properly configured health checks prevent unhealthy instances from serving traffic; uptime checks and alert policies surface failures to your team before users notice them.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | Object | Configures the **startup probe**, which Cloud Run uses to determine when a newly started container instance is ready to receive traffic. Cloud Run will not route any requests to the instance until this probe succeeds. Sub-fields: **`enabled`** (`true`/`false`) — disable only for containers that start instantaneously and have no initialisation phase. **`type`** — `HTTP` (default; sends an HTTP GET to `path`) or `TCP` (checks that the port accepts connections, use when there is no HTTP endpoint). **`path`** — the HTTP path to check, e.g. `/healthz`, `/ready`, `/status`. **`initial_delay_seconds`** — seconds to wait after the container starts before the first probe attempt (default: `10`). **`timeout_seconds`** — seconds to wait for the probe response before marking it as failed (default: `5`). **`period_seconds`** — interval between probe attempts (default: `10`). **`failure_threshold`** — number of consecutive failures before the instance is considered failed and restarted (default: `10`). For slow-starting applications (e.g. those that run database migrations on startup), increase `failure_threshold` or `period_seconds` rather than `initial_delay_seconds` to give the container sufficient time without blocking traffic for too long. |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | Object | Configures the **liveness probe**, which Cloud Run uses to periodically check whether a running container instance is still healthy. If the probe fails `failure_threshold` consecutive times, Cloud Run restarts the container automatically. Sub-fields mirror those of `startup_probe_config`: **`enabled`**, **`type`** (`HTTP` / `TCP`), **`path`**, **`initial_delay_seconds`** (default: `15`), **`timeout_seconds`** (default: `5`), **`period_seconds`** (default: `30`), **`failure_threshold`** (default: `3`). **Important:** the health check endpoint must respond quickly and must not perform expensive operations (database queries, external API calls) — a slow health endpoint can cause false-positive restarts. It should return `HTTP 200` when the application is healthy and a non-2xx code when it is not. |
| `uptime_check_config` | `{ enabled = true, path = "/" }` | Object | Configures a **Google Cloud Monitoring uptime check** that sends periodic HTTP requests to the application from multiple global locations (typically 6 Google points of presence worldwide). If the application becomes unreachable from a majority of locations, an alert is triggered and sent to `support_users`. Sub-fields: **`enabled`** (`true`/`false`). **`path`** — the HTTP path to probe from the outside, e.g. `/healthz` or `/`. **`check_interval`** — how frequently to probe, in seconds with an `s` suffix (default: `"60s"`; minimum `"60s"`). **`timeout`** — maximum response time before the check is marked as failed (default: `"10s"`; must be less than `check_interval`). Unlike the startup and liveness probes — which are internal container-level checks — the uptime check validates end-to-end reachability from the public internet. This means it also validates DNS, load balancers, and Cloud Armor rules where applicable. |
| `alert_policies` | `[]` | List of objects | A list of Cloud Monitoring alert policies that trigger email notifications to `support_users` when application metrics exceed defined thresholds. Leave empty to deploy no custom alert policies. Each policy object requires: **`name`** — a descriptive label for the policy (e.g. `"high-latency"`, `"5xx-errors"`). **`metric_type`** — the Cloud Monitoring metric to monitor (see common values below). **`comparison`** — `COMPARISON_GT` (greater than) or `COMPARISON_LT` (less than). **`threshold_value`** — the numeric threshold that triggers the alert. **`duration_seconds`** — how long the condition must be sustained before the alert fires (use `0` to alert immediately). **`aggregation_period`** — the time window for metric aggregation (default: `"60s"`). Common `metric_type` values for Cloud Run: `run.googleapis.com/request_latencies` (request latency in ms), `run.googleapis.com/request_count` (requests per second, filter by `response_code_class` for 5xx), `run.googleapis.com/container/cpu/utilizations` (CPU utilisation, 0–1), `run.googleapis.com/container/memory/utilizations` (memory utilisation, 0–1). |

### Validating Group 5 Settings

**Google Cloud Console:**
- **Startup & liveness probes:** Navigate to **Cloud Run → Services → *your service* → Revisions**, select the latest revision, then click **Container(s)**. Probe configuration is shown under **Health checks**.
- **Uptime checks:** Navigate to **Monitoring → Uptime checks** to view active checks, their current status (passing/failing), and the last check results from each global location.
- **Alert policies:** Navigate to **Monitoring → Alerting** to view all configured alert policies, their current state (firing/OK), and notification channels.
- **Incidents:** Navigate to **Monitoring → Alerting → Incidents** to view historical alert firings.

**gcloud CLI:**
```bash
# View health probe configuration on the latest revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe,spec.template.spec.containers[0].startupProbe)"

# List all uptime checks in the project
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout,selectedRegions)"

# List all alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].conditionThreshold.filter)"

# View recent uptime check results (pass/fail per location)
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="value(name)" | head -1 | xargs -I{} \
  gcloud monitoring uptime get-config {} --project=PROJECT_ID
```

---

## Group 6: Jobs & Scheduled Tasks

These variables define workloads that run alongside the main Cloud Run service but outside the request-response cycle. Initialization jobs run once at deployment time to bootstrap the application; cron jobs handle recurring background work on a schedule; additional services deploy supplementary Cloud Run services that the main application depends on.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", … }]` | List of objects | Cloud Run Jobs executed **once during or after deployment** to initialise the application. The default includes a `db-init` job that runs database initialisation scripts. Each job runs sequentially in list order unless dependencies are specified. Key sub-fields: **`name`** — unique identifier for the job (used as the Cloud Run Job name). **`description`** — human-readable label shown in the console. **`image`** — container image to use for the job; defaults to the application image if left blank. **`command`** / **`args`** — the entrypoint command and arguments to run. **`script_path`** — path to a script file relative to the module's scripts directory; used instead of `command`/`args` when running bundled scripts. **`env_vars`** / **`secret_env_vars`** — job-specific environment variables and Secret Manager references (same format as Group 4). **`cpu_limit`** / **`memory_limit`** — resource limits for the job container (default: `1000m` / `512Mi`). **`timeout_seconds`** — maximum duration for the job (default: `600`). **`max_retries`** — number of retry attempts on failure (default: `1`). **`task_count`** — number of parallel tasks (default: `1`; increase for parallel workloads). **`mount_nfs`** — whether to mount the NFS volume (requires `enable_nfs = true`). **`mount_gcs_volumes`** — list of GCS volume names to mount. **`depends_on_jobs`** — list of other job names that must complete successfully before this job runs. **`execute_on_apply`** — when `true`, the job is re-executed on every deployment; when `false`, it runs only once on first deployment. |
| `cron_jobs` | `[]` | List of objects | Recurring scheduled tasks deployed as Cloud Run Jobs and triggered by **Cloud Scheduler** on a cron schedule. Each job creates a Cloud Run Job resource and a Cloud Scheduler job that invokes it. Key sub-fields: **`name`** — unique identifier for the job. **`schedule`** — cron expression in UTC, e.g. `"0 2 * * *"` (daily at 02:00 UTC), `"*/15 * * * *"` (every 15 minutes), `"0 9 * * 1"` (every Monday at 09:00 UTC). **`image`** — container image; defaults to the application image if blank. **`command`** / **`args`** / **`script_path`** — as per `initialization_jobs`. **`env_vars`** / **`secret_env_vars`** — job-specific configuration and secrets. **`cpu_limit`** / **`memory_limit`** — resource limits (default: `1000m` / `512Mi`). **`timeout_seconds`** — maximum duration (default: `600`). **`max_retries`** — retry attempts on failure (default: `3`). **`task_count`** / **`parallelism`** — number of tasks and how many run in parallel (default: `1` / `0` meaning use Cloud Run default). **`mount_nfs`** / **`mount_gcs_volumes`** — storage volume mounts. **`paused`** — set to `true` to disable the scheduler trigger without removing the job definition. Useful for temporarily suspending a job during maintenance. |
| `additional_services` | `[]` | List of objects | Supplementary Cloud Run services deployed alongside the main application. Use this for **sidecar-style patterns** where a separate service handles a specific function — for example a dedicated worker process, a Redis-compatible cache proxy, a background queue consumer, or an internal admin interface. Each additional service is a fully independent Cloud Run service. Key sub-fields: **`name`** — unique identifier appended to the application name (e.g. `worker` produces `APPLICATION_NAME-worker`). **`image`** — container image URI (required). **`port`** — port the additional service listens on. **`command`** / **`args`** — entrypoint override. **`env_vars`** — plain-text environment variables for this service. **`cpu_limit`** / **`memory_limit`** — resource limits (default: `1000m` / `512Mi`). **`min_instance_count`** / **`max_instance_count`** — scaling bounds (default: `0` / `1`). **`ingress`** — traffic source restriction for this service; default is `INGRESS_TRAFFIC_INTERNAL_ONLY`, meaning only the main service and other internal GCP services can call it — it is not publicly accessible. **`output_env_var_name`** — if set, the URL of this additional service is automatically injected into the **main** application container as an environment variable with this name, allowing the main app to discover and call it without hardcoding URLs. **`volume_mounts`** — NFS or GCS volumes to mount. **`startup_probe`** / **`liveness_probe`** — per-service health check configuration (same structure as Group 5 probes). |

### Validating Group 6 Settings

**Google Cloud Console:**
- **Initialization & cron jobs:** Navigate to **Cloud Run → Jobs** to view all Cloud Run Jobs, their last execution status, and execution history.
- **Job execution history:** Click a job, then select the **Executions** tab to view each run, its status (succeeded/failed), duration, and logs.
- **Cloud Scheduler triggers:** Navigate to **Cloud Scheduler** to view cron job triggers, their schedule, last run time, and status.
- **Additional services:** Navigate to **Cloud Run → Services** — additional services appear as separate services named `APPLICATION_NAME-ADDITIONAL_NAME`.

**gcloud CLI:**
```bash
# List all Cloud Run Jobs in the project
gcloud run jobs list \
  --region=REGION \
  --format="table(name,metadata.creationTimestamp,status.conditions[0].type)"

# View the execution history of a specific job
gcloud run jobs executions list \
  --job=JOB_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# Describe a specific job execution (useful for debugging failures)
gcloud run jobs executions describe EXECUTION_NAME \
  --region=REGION

# List all Cloud Scheduler jobs (cron triggers)
gcloud scheduler jobs list \
  --location=REGION \
  --format="table(name,schedule,state,lastAttemptTime,status.code)"

# Manually trigger a cron job immediately (for testing)
gcloud scheduler jobs run SCHEDULER_JOB_NAME \
  --location=REGION

# List all Cloud Run services (including additional services)
gcloud run services list \
  --region=REGION \
  --format="table(name,status.url,status.conditions[0].status)"
```

---

## Group 7: CI/CD & GitHub Integration

> **PSE Certification relevance:** This group maps to PSE exam Section 4.1 (automating infrastructure and application security). `enable_cicd_trigger` demonstrates secure CI/CD with Secret Manager secret injection (secrets never appear in build logs). `enable_binary_authorization` directly implements the PSE supply chain integrity objective — cryptographic attestation ensures only images that passed the CI/CD security pipeline can be deployed, even preventing manual deployments of unsigned images. The `cloud_deploy_stages` with `require_approval = true` is an example of the change management controls referenced in PSE Section 4.1.
> **ACE Exam Connection:** This group maps to ACE Section 3.1 (Deploying new versions of an application). The `enable_cicd_trigger` + `cicd_trigger_config` variables demonstrate Cloud Build trigger configuration; `enable_cloud_deploy` + `cloud_deploy_stages` demonstrate progressive delivery pipelines with manual approval gates; `enable_binary_authorization` demonstrates supply-chain security enforcement — an ACE Section 4 security topic.

These variables configure automated build and deployment pipelines. The module supports two pipeline models: a simple **Cloud Build** model where every qualifying code push builds and deploys directly to Cloud Run, and a more advanced **Cloud Deploy** model that introduces a promotion-based pipeline with defined stages and optional manual approvals between them.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | `true` / `false` | Master switch for the CI/CD pipeline. When `true`, a Cloud Build trigger is created that monitors the connected GitHub repository and automatically builds and deploys the application when code is pushed to the configured branch. Requires `github_repository_url` and at least one of `github_token` or `github_app_installation_id` to be set. When `false`, deployments must be triggered manually (e.g. by running a build from the Cloud Build console or by updating `application_version`). |
| `github_repository_url` | `""` | Full HTTPS URL | The HTTPS URL of the GitHub repository to connect to Cloud Build. Required when `enable_cicd_trigger` is `true`. Format: `https://github.com/ORG/REPO`. The repository must be accessible using the credentials provided in `github_token` or via the GitHub App specified in `github_app_installation_id`. |
| `github_token` | `""` | GitHub PAT string *(sensitive)* | A GitHub **Personal Access Token (PAT)** used to authorise the Cloud Build GitHub connection. Required on the **first deployment** when `enable_cicd_trigger` is `true` — GCP uses this token to establish the connection. Required scopes: `repo` (full repository access) and `admin:repo_hook` (to create webhooks). **After the initial connection is established**, the token is stored in Secret Manager and reused automatically — you do not need to re-supply it on subsequent deployments. For organisation repositories, prefer `github_app_installation_id` (GitHub App authentication) over a PAT for better auditability and key rotation. This value is treated as sensitive and is never stored in plaintext. |
| `github_app_installation_id` | `""` | Numeric string (e.g. `"12345678"`) | The installation ID of the **Cloud Build GitHub App**, used when authenticating via a GitHub App instead of a PAT. When provided alongside `github_token`, the connection uses GitHub App authentication (preferred for organisation-level repositories) with the PAT used only as the authoriser credential during the initial connection setup. The installation ID can be found in your GitHub organisation settings under **Installed GitHub Apps → Cloud Build → Configure**. GitHub App authentication is preferred over PATs for teams as it ties the connection to the app rather than an individual user account. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Object | Fine-grained configuration for the Cloud Build trigger. Sub-fields: **`branch_pattern`** — a regular expression matching the branch(es) that activate the build (default: `"^main$"` triggers only on pushes to `main`; use `"^(main\|develop)$"` for both). **`included_files`** — list of file path patterns; the build only fires if at least one matching file was changed (e.g. `["src/**", "Dockerfile"]`). Leave empty to trigger on any file change. **`ignored_files`** — list of file path patterns to exclude from triggering (e.g. `["**.md", "docs/**"]`). **`trigger_name`** — custom name for the Cloud Build trigger (auto-generated if blank). **`description`** — description shown in the Cloud Build console. **`substitutions`** — map of `_VARIABLE = "value"` pairs passed as substitution variables to the Cloud Build build steps (e.g. `{ _ENV = "prod", _REGION = "us-central1" }`). |
| `enable_cloud_deploy` | `false` | `true` / `false` | Switches the CI/CD pipeline from **direct Cloud Build deployments** to a managed **Google Cloud Deploy** progressive delivery pipeline. When `true`, a Cloud Deploy delivery pipeline and targets are created based on `cloud_deploy_stages`. Releases are promoted through stages in order (e.g. dev → staging → prod), with optional manual approvals before promotion. Requires `enable_cicd_trigger` to also be `true` for automated pipeline execution. Use this for production environments where you need controlled, audited, multi-stage rollouts rather than direct-to-production deploys. |
| `cicd_enable_cloud_deploy` | `false` | `true` / `false` | Controls whether the Cloud Build trigger creates **Cloud Deploy releases** (`true`) or updates the Cloud Run service directly (`false`). Set to `true` to have the CI/CD pipeline feed into Cloud Deploy rather than deploying directly. Both `enable_cloud_deploy` and `cicd_enable_cloud_deploy` must be `true` for the full automated pipeline (build → Cloud Deploy release → promote through stages) to function end-to-end. |
| `cloud_deploy_stages` | `[dev, staging, prod]` | List of objects | Ordered list of promotion stages for the Cloud Deploy delivery pipeline. Each stage creates a Cloud Deploy target and an associated Cloud Run service for that environment. Stages are promoted in list order. Key sub-fields: **`name`** — stage identifier (e.g. `"dev"`, `"staging"`, `"prod"`); used to name the target and Cloud Run service. **`target_name`** — override the Cloud Deploy target name (defaults to `PIPELINE-NAME`). **`service_name`** — override the Cloud Run service name for this stage (defaults to `APPLICATION_NAME-STAGE`). **`project_id`** — deploy this stage to a different GCP project (defaults to the current project; useful for cross-project prod isolation). **`region`** — deploy this stage to a different region. **`require_approval`** — when `true`, a manual approval is required in the Cloud Deploy console before a release can be promoted to this stage. **Strongly recommended for `prod`**. **`auto_promote`** — when `true`, the release is automatically promoted to the next stage upon successful deployment, without manual intervention. |
| `enable_binary_authorization` | `false` | `true` / `false` | Enforces **Binary Authorization** on the Cloud Run service, requiring all container images to carry a valid cryptographic attestation before they can be deployed. This prevents unverified, unsigned, or tampered images from running. When `true`, an existing Binary Authorization policy and attestor must already be configured in the project — deployment will fail if no policy exists. Use in regulated environments (financial services, healthcare) where supply chain security and image provenance must be enforced. Validate that your CI/CD pipeline includes an attestation step (e.g. signing the image after a vulnerability scan) before enabling. |

### Validating Group 7 Settings

**Google Cloud Console:**
- **Cloud Build triggers:** Navigate to **Cloud Build → Triggers** to view the trigger, its connected repository, branch pattern, and last build status.
- **Build history:** Navigate to **Cloud Build → History** to view all past builds, their status, duration, and logs.
- **GitHub connection:** Navigate to **Cloud Build → Repositories (2nd gen)** to confirm the GitHub connection is established and the repository is linked.
- **Cloud Deploy pipelines:** Navigate to **Cloud Deploy → Delivery Pipelines** to view the pipeline, its stages, current release, and promotion history.
- **Cloud Deploy approvals:** Pending approvals appear in the Cloud Deploy console under the relevant target — approvers receive an email notification.
- **Binary Authorization policy:** Navigate to **Security → Binary Authorization** to view the current enforcement policy.

**gcloud CLI:**
```bash
# List Cloud Build triggers
gcloud builds triggers list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,github.name,github.push.branch,disabled)"

# View recent Cloud Build build history
gcloud builds list \
  --project=PROJECT_ID \
  --region=REGION \
  --limit=10 \
  --format="table(id,status,source.repoSource.branchName,createTime,duration)"

# List Cloud Deploy delivery pipelines
gcloud deploy delivery-pipelines list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,description,condition.pipelineReadyCondition.status)"

# List Cloud Deploy releases for a pipeline
gcloud deploy releases list \
  --delivery-pipeline=PIPELINE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,buildArtifacts[0].tag,renderState,createTime)"

# List Cloud Deploy rollouts (promotion history per stage)
gcloud deploy rollouts list \
  --delivery-pipeline=PIPELINE_NAME \
  --release=RELEASE_NAME \
  --region=REGION \
  --format="table(name,targetId,state,deployStartTime)"

# View the Binary Authorization policy
gcloud container binauthz policy export \
  --project=PROJECT_ID
```

---

## Group 8: Storage & Filesystem — NFS

These variables configure **Network File System (NFS)** shared storage for the application, backed by Google Cloud Filestore. NFS provides a POSIX-compliant shared filesystem that is simultaneously accessible by all Cloud Run instances, making it suitable for workloads that require shared persistent state across multiple container instances — such as user-uploaded media files, shared caches, or application data that must survive container restarts.

> **Prerequisites:** NFS volume mounts require the `execution_environment` to be set to `gen2`. Gen1 does not support NFS mounts.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_nfs` | `true` | `true` / `false` | When `true`, an NFS volume is mounted into the Cloud Run service at the path defined by `nfs_mount_path`. The module will use an existing Filestore instance if one is discovered in the project (either named via `nfs_instance_name` or auto-discovered from a `Services_GCP` deployment), or will create an inline NFS GCE VM if none is found. **NFS provides shared persistent storage** — files written by one instance are immediately visible to all other instances. This is essential for applications that handle file uploads, shared configuration, or any data that must persist beyond the lifetime of a single container. Set to `false` if your application is entirely stateless or uses GCS/Cloud SQL for all persistence. |
| `nfs_mount_path` | `"/mnt/nfs"` | Filesystem path | The path inside the container where the NFS volume is mounted. Your application reads and writes shared files to this directory. The path must not conflict with any directory used by the container image itself. Common choices: `/mnt/nfs`, `/data`, `/shared`, `/app/storage`. Only used when `enable_nfs` is `true`. Ensure your application is configured to read/write to this path — files written elsewhere in the container filesystem are ephemeral and lost when the instance restarts. |
| `nfs_instance_name` | `""` *(auto-discover)* | String | The name of a specific existing NFS server (GCE VM) to connect to. When set, the module targets this instance directly and skips auto-discovery. Leave blank to allow the module to auto-discover a `Services_GCP`-managed NFS instance in the project, or to create a new inline NFS VM if none is found. Use this when you have multiple NFS servers in the project and need to explicitly control which one this deployment connects to, or when the auto-discovery would select the wrong instance. |
| `nfs_instance_base_name` | `"app-nfs"` | String | The base name for a new inline NFS GCE VM created when no existing NFS server is found in the project. The deployment ID is appended automatically to ensure uniqueness (e.g. `app-nfs-prod`). Change this only if the default name conflicts with an existing resource or if your naming convention requires a different prefix. Only relevant when no existing NFS instance is discovered and the module needs to provision one. |

### Validating Group 8 Settings

**Google Cloud Console:**
- **NFS instance (Filestore):** If using Cloud Filestore, navigate to **Filestore → Instances** to confirm the instance exists, its tier, capacity, and IP address.
- **NFS instance (GCE VM):** If using an NFS GCE VM, navigate to **Compute Engine → VM Instances** and filter by the instance name to confirm it is running.
- **Volume mount on Cloud Run:** Navigate to **Cloud Run → Services → *your service* → Revisions**, select the latest revision, then click **Volumes** to confirm the NFS volume is listed and mounted at the expected path.
- **NFS connectivity test:** Check Cloud Run logs (**Cloud Run → Services → *your service* → Logs**) for any NFS mount errors at container startup.

**gcloud CLI:**
```bash
# List Filestore instances in the project
gcloud filestore instances list \
  --project=PROJECT_ID \
  --format="table(name,tier,networks[0].ipAddresses[0],fileShares[0].capacityGb,state)"

# Describe a specific Filestore instance
gcloud filestore instances describe INSTANCE_NAME \
  --zone=ZONE \
  --project=PROJECT_ID

# List GCE VM instances (for inline NFS VMs)
gcloud compute instances list \
  --project=PROJECT_ID \
  --filter="name:nfs" \
  --format="table(name,zone,status,networkInterfaces[0].networkIP)"

# View volume configuration on the Cloud Run service
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.volumes,spec.template.spec.containers[0].volumeMounts)"

# View Cloud Run startup logs to check for NFS mount errors
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME AND severity>=WARNING" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

---

## Group 9: Storage & Filesystem — GCS

> **ACE Exam Connection:** This group maps to ACE Section 2.2 (Choosing and deploying storage products) and Section 3.2 (Managing and securing objects in Cloud Storage buckets). The `storage_buckets` variable demonstrates GCS bucket provisioning; the storage class options (Standard, Nearline, Coldline, Archive) map directly to ACE exam storage class selection questions; CMEK via `manage_storage_kms_iam` maps to ACE Section 4 encryption topics.

These variables configure **Google Cloud Storage (GCS)** for the application. GCS provides two distinct integration patterns: standard **object storage** (buckets the application reads and writes via the GCS API or client libraries), and **GCS Fuse** mounts (buckets surfaced as a POSIX filesystem path directly inside the container). A KMS encryption option is also available for buckets that require customer-managed encryption keys.

> **Prerequisites:** GCS Fuse volume mounts require `execution_environment` to be set to `gen2`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `create_cloud_storage` | `true` | `true` / `false` | Master switch for GCS bucket provisioning. When `true`, all buckets defined in `storage_buckets` are created. Set to `false` when buckets are managed externally, already exist, or when this deployment should share buckets provisioned by another module or deployment (e.g. a shared `Services_GCP` deployment). When `false`, the `storage_buckets` variable is ignored but `gcs_volumes` can still reference externally managed buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | List of objects | Defines the GCS buckets to provision for the application. Each bucket name is automatically prefixed with the project ID and application name for uniqueness. Only used when `create_cloud_storage` is `true`. Key sub-fields per bucket entry: **`name_suffix`** — the suffix appended to the auto-generated bucket name (e.g. `"data"` produces `PROJECT-APPLICATION-data`). **`location`** — GCS location for the bucket; can be a region (`"us-central1"`), dual-region (`"US-EAST1+US-WEST1"`), or multi-region (`"US"`, `"EU"`, `"ASIA"`). Multi-region provides higher availability but at higher cost. **`storage_class`** — `"STANDARD"` (default; for frequently accessed data), `"NEARLINE"` (for data accessed less than once per month), `"COLDLINE"` (accessed less than once per quarter), `"ARCHIVE"` (for long-term backup, rarely accessed). Choose based on access frequency to optimise cost. **`force_destroy`** — when `true`, the bucket and all its contents are deleted when the deployment is destroyed (default: `true`). **Set to `false` for buckets containing data that must be retained** beyond the lifecycle of the deployment. **`versioning_enabled`** — when `true`, GCS retains previous versions of objects on update or delete, enabling recovery from accidental overwrites. Recommended for buckets storing important data. **`lifecycle_rules`** — list of object lifecycle rules (e.g. automatically delete objects older than 90 days, transition to Coldline after 30 days). **`public_access_prevention`** — `"enforced"` (default; blocks all public access even if ACLs are set) or `"inherited"` (defers to the organisation policy). Leave as `"enforced"` unless the bucket explicitly needs to serve public content. **`uniform_bucket_level_access`** — when `true`, disables per-object ACLs and enforces IAM-only access control. Recommended for all new buckets. |
| `gcs_volumes` | `[]` | List of objects | GCS buckets to mount as **filesystem volumes** inside the container using GCS Fuse. This allows the application to read and write GCS objects using standard file I/O operations (open, read, write, ls) without using the GCS API directly. Key sub-fields: **`name`** — a logical name for the volume (referenced in `mount_gcs_volumes` in jobs). **`bucket_name`** — the name of the GCS bucket to mount; can be a bucket created by `storage_buckets` or any existing bucket the Cloud Run service account can access. Leave blank to use the auto-named bucket. **`mount_path`** — the filesystem path inside the container where the bucket appears (e.g. `/mnt/gcs`, `/app/uploads`). **`readonly`** — when `true`, the mount is read-only; the container cannot write to the bucket via this mount. **`mount_options`** — advanced GCS Fuse options (defaults: `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`). **Performance note:** GCS Fuse has higher latency than a native filesystem and is not suitable for workloads that require low-latency random reads/writes (e.g. databases). It is well suited for reading large files, serving static assets, or writing log files. |
| `manage_storage_kms_iam` | `false` | `true` / `false` | Controls whether the module manages the IAM binding that grants the Cloud Run service account `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the Cloud KMS key used to encrypt storage buckets. Set to `true` only after the KMS keyring and key have already been created in the project. **Leave as `false` during initial deployment** if the KMS key does not yet exist — attempting to set IAM on a non-existent key will cause the deployment to fail. Once the key is in place, set this to `true` on a subsequent deployment to enable customer-managed encryption. |

### Validating Group 9 Settings

**Google Cloud Console:**
- **GCS buckets:** Navigate to **Cloud Storage → Buckets** to confirm buckets are created with the expected names, locations, and storage classes. Click a bucket to view its configuration including versioning, lifecycle rules, and access settings.
- **Public access prevention:** In the bucket details, the **Permissions** tab shows whether public access prevention is enforced.
- **GCS Fuse mounts:** Navigate to **Cloud Run → Services → *your service* → Revisions**, select the latest revision, and click **Volumes** to confirm GCS volumes are mounted at the expected paths.
- **KMS encryption:** In the bucket details, the **Configuration** tab shows the encryption type and key if customer-managed encryption is enabled.

**gcloud CLI:**
```bash
# List all GCS buckets in the project
gcloud storage buckets list \
  --project=PROJECT_ID \
  --format="table(name,location,storageClass,iamConfiguration.publicAccessPrevention)"

# Describe a specific bucket (versioning, lifecycle, encryption)
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="yaml(versioning,lifecycle,encryption,iamConfiguration)"

# View GCS volume mounts on the Cloud Run service
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.volumes,spec.template.spec.containers[0].volumeMounts)"

# List objects in a bucket (validate application is writing correctly)
gcloud storage ls gs://BUCKET_NAME/ --recursive

# Check IAM policy on a KMS key
gcloud kms keys get-iam-policy KEY_NAME \
  --keyring=KEYRING_NAME \
  --location=LOCATION \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

---

## Group 10: Redis Cache

These variables configure Redis connectivity for the application. Rather than provisioning a Redis instance directly, the module injects the Redis connection details as environment variables (`REDIS_HOST`, `REDIS_PORT`, and optionally `REDIS_AUTH`) into the Cloud Run container. The application is responsible for reading these variables and establishing the connection. This design allows the module to connect to any Redis-compatible service — Google Cloud Memorystore, a self-hosted Redis VM, or a third-party Redis provider.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | When `true`, the `REDIS_HOST` and `REDIS_PORT` environment variables are injected into the Cloud Run container. The application must be configured to use these variables for its Redis connection. When `false`, no Redis environment variables are injected and the application must manage its own cache configuration independently. **If `enable_redis` is `true` and `redis_host` is left blank**, the module defaults to using the NFS server's IP address as the Redis host — this is useful in deployments where a Redis-compatible service runs on the same VM as the NFS server (a common pattern in shared `Services_GCP` environments). |
| `redis_host` | `""` *(defaults to NFS server IP)* | IP address or hostname | The hostname or IP address of the Redis server, injected as the `REDIS_HOST` environment variable. Only used when `enable_redis` is `true`. **Leave blank** to fall back to the NFS server IP (suitable for shared single-VM environments). **Set explicitly** when connecting to a dedicated Redis instance such as: Google Cloud Memorystore for Redis (use the instance's private IP — find it in **Memorystore → Redis → *instance* → Primary endpoint**), a Redis GCE VM, or an external Redis provider. The Cloud Run service communicates with this host over the VPC network — ensure the instance is reachable from Cloud Run's VPC using the `vpc_egress_setting` and that firewall rules permit traffic on `redis_port`. |
| `redis_port` | `"6379"` | Port number as string | The TCP port of the Redis server, injected as the `REDIS_PORT` environment variable. The default `6379` is the standard Redis port and is correct for most deployments including Cloud Memorystore. Change only if your Redis instance is configured to listen on a non-standard port. Only used when `enable_redis` is `true`. |
| `redis_auth` | `""` *(no authentication)* | Password string *(sensitive)* | The authentication password for the Redis server. When set, this value is stored in Secret Manager and injected securely into the container — it is never stored in plaintext. Leave empty if the Redis instance does not require authentication (acceptable for development environments or instances only accessible within a private VPC). **For production deployments using Cloud Memorystore with AUTH enabled**, set this to the instance's auth string (found in **Memorystore → Redis → *instance* → AUTH string**). For self-hosted Redis, set this to the value configured in the `requirepass` directive. Enabling AUTH is strongly recommended for any Redis instance accessible over a network, even a private one, as it provides defence in depth. |

### Validating Group 10 Settings

**Google Cloud Console:**
- **Memorystore Redis instance:** Navigate to **Memorystore → Redis** to confirm the instance exists, its IP address, port, and AUTH status.
- **Redis environment variables on Cloud Run:** Navigate to **Cloud Run → Services → *your service* → Revisions**, select the latest revision, click **Container(s)**, and view the **Environment variables** section to confirm `REDIS_HOST` and `REDIS_PORT` are present.
- **VPC connectivity:** Navigate to **VPC Network → Firewall** and confirm a rule permits TCP traffic from the Cloud Run service's VPC range to the Redis instance IP on the configured port.

**gcloud CLI:**
```bash
# List Cloud Memorystore Redis instances
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,tier,memorySizeGb,state,authEnabled)"

# Describe a specific Memorystore instance (includes IP and AUTH info)
gcloud redis instances describe INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(host,port,authEnabled,transitEncryptionMode,state)"

# Confirm REDIS_HOST and REDIS_PORT are set on the Cloud Run revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" \
  | grep -A2 "REDIS"

# Test Redis connectivity from within the VPC (using a Cloud Shell or GCE VM)
# redis-cli -h REDIS_HOST -p REDIS_PORT -a REDIS_AUTH ping
```

---

## Group 11: Database Backend

> **ACE Exam Connection:** This group maps to ACE Section 2.2 (Choosing and deploying relational data products) and Section 3.2 (Database backups and restore). The `database_type` options (PostgreSQL, MySQL, SQL Server) correspond to ACE exam database selection questions; `enable_auto_password_rotation` demonstrates Secret Manager rotation — an ACE Section 4.2 security topic; `enable_postgres_extensions` is relevant to the ACE exam's Cloud SQL configuration topics.

These variables configure the Cloud SQL database backend for the application. The module supports PostgreSQL, MySQL, and SQL Server. It can provision a new Cloud SQL instance automatically, connect to an existing instance, or skip database provisioning entirely. Database credentials are generated securely and injected into the application via Secret Manager — the application receives `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` as environment variables.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | See options below | The Cloud SQL database engine to provision. Use `"NONE"` to skip database provisioning entirely (for stateless applications or those using an external database). **Generic aliases** (`POSTGRES`, `MYSQL`) deploy the latest supported version managed by Cloud SQL. **Version-pinned values** deploy a specific engine version and are recommended for production environments where version consistency across deployments matters. Supported options: `NONE` — no database; `POSTGRES` / `POSTGRES_15` / `POSTGRES_14` / `POSTGRES_13` / `POSTGRES_12` / `POSTGRES_11` / `POSTGRES_10` / `POSTGRES_9_6`; `MYSQL` / `MYSQL_8_0` / `MYSQL_5_7` / `MYSQL_5_6`; `SQLSERVER_2019_ENTERPRISE` / `SQLSERVER_2019_STANDARD` / `SQLSERVER_2017_ENTERPRISE` / `SQLSERVER_2017_STANDARD`. **Note:** changing `database_type` after initial deployment will attempt to replace the Cloud SQL instance, which will result in data loss unless a backup is restored first. |
| `sql_instance_name` | `""` *(auto-discover)* | String | The name of a specific existing Cloud SQL instance to connect to. When set, the module uses this instance directly and skips auto-discovery and instance creation. Leave blank to allow the module to auto-discover a `Services_GCP`-managed instance in the project, or to create a new instance if none is found. Use this when you have multiple Cloud SQL instances in the project and need to explicitly target one, or when reusing a shared instance across multiple application deployments. The named instance must already exist and be of a compatible `database_type`. |
| `sql_instance_base_name` | `"app-sql"` | String | The base name for a new Cloud SQL instance created when no existing instance is found. The deployment ID is appended automatically to ensure uniqueness (e.g. `app-sql-prod`). Change this only if the default name conflicts with an existing resource or your naming convention requires a different prefix. Only relevant when `sql_instance_name` is blank and no existing instance is auto-discovered. |
| `application_database_name` | `"crappdb"` | `[a-z][a-z0-9_]{0,62}` (1–63 chars) | The name of the database created within the Cloud SQL instance. Injected into the application container as the `DB_NAME` environment variable. Must start with a lowercase letter and contain only lowercase letters, numbers, and underscores. Choose a name that reflects the application and environment, e.g. `crm_prod`, `payments_staging`. Only used when `database_type` is not `NONE`. **Do not change after initial deployment** — renaming the database requires manual data migration. |
| `application_database_user` | `"crappuser"` | `[a-z][a-z0-9_]{0,31}` (1–32 chars) | The username of the database user created for the application. Injected into the application container as the `DB_USER` environment variable. Must start with a lowercase letter and contain only lowercase letters, numbers, and underscores. Use a meaningful name such as `crm_svc` or `app_user`. The corresponding password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. Only used when `database_type` is not `NONE`. |
| `database_password_length` | `16` | Integer `8`–`64` | The length in characters of the randomly generated database user password. Longer passwords provide significantly more entropy and are harder to brute-force. **Recommended minimum for production: `32`**. The password is generated once on first deployment, stored in Secret Manager, and rotated automatically if `enable_auto_password_rotation` is enabled. Changing this value on a subsequent deployment generates a new password only if rotation is triggered — it does not retroactively change the existing password length. |
| `enable_postgres_extensions` | `false` | `true` / `false` | When `true`, the PostgreSQL extensions listed in `postgres_extensions` are installed in the application database after provisioning. Only applies when `database_type` is a PostgreSQL variant. Extensions are installed via a Cloud Run Job executed during deployment. Set to `false` if no extensions are required, or if extensions are managed by the application itself at startup. |
| `postgres_extensions` | `[]` | List of extension name strings | The PostgreSQL extensions to install in the application database. Only used when `enable_postgres_extensions` is `true`. Common extensions: `postgis` (geospatial data), `uuid-ossp` (UUID generation), `pg_trgm` (trigram text search), `pgcrypto` (cryptographic functions), `hstore` (key-value storage), `pg_stat_statements` (query performance tracking). Ensure the extension is supported by the Cloud SQL PostgreSQL version in use — not all extensions available in self-hosted PostgreSQL are available in Cloud SQL. |
| `enable_mysql_plugins` | `false` | `true` / `false` | When `true`, the MySQL plugins listed in `mysql_plugins` are installed in the application database after provisioning. Only applies when `database_type` is a MySQL variant. Functions similarly to `enable_postgres_extensions` for MySQL environments. |
| `mysql_plugins` | `[]` | List of plugin name strings | The MySQL plugins to install in the application database. Only used when `enable_mysql_plugins` is `true`. Common plugins: `audit_log` (audit logging for compliance), `validate_password` (password strength enforcement). Verify plugin availability for your specific MySQL version in Cloud SQL before enabling. |
| `enable_auto_password_rotation` | `false` | `true` / `false` | When `true`, deploys an automated password rotation mechanism consisting of a Cloud Run rotation Job and an Eventarc trigger that fires when Secret Manager publishes a rotation notification. The rotation job generates a new database password, updates both the Cloud SQL user and the Secret Manager secret, then restarts the Cloud Run service to pick up the new credentials. The rotation frequency is governed by `secret_rotation_period` (Group 4). **Recommended for production environments** to limit the blast radius of a leaked database credential. Only applies when `database_type` is not `NONE`. |
| `rotation_propagation_delay_sec` | `90` | Integer (seconds) | The number of seconds to wait after a new database password is written to Secret Manager before restarting the Cloud Run service. This delay allows Secret Manager's global replication to complete so the new secret version is available in all regions before instances attempt to read it. **Increase this value** (e.g. to `120`) in multi-region deployments or if you observe rotation failures where instances start with the new credentials before the secret has fully propagated. Only used when `enable_auto_password_rotation` is `true`. |

### Validating Group 11 Settings

**Google Cloud Console:**
- **Cloud SQL instance:** Navigate to **SQL** to confirm the instance exists, its database engine, version, region, and connection name.
- **Databases & users:** Click the instance, then select the **Databases** and **Users** tabs to confirm the application database and user have been created.
- **Database credentials in Secret Manager:** Navigate to **Security → Secret Manager** and filter by the application name to find the `DB_PASSWORD` secret. View its versions and rotation schedule.
- **Password rotation job:** Navigate to **Cloud Run → Jobs** and look for a rotation job named after the application. Navigate to **Eventarc → Triggers** to confirm the rotation trigger is configured.
- **DB environment variables on Cloud Run:** Navigate to **Cloud Run → Services → *your service* → Revisions → Container(s)** and confirm `DB_HOST`, `DB_NAME`, `DB_USER` appear as plain-text env vars and `DB_PASSWORD` appears as a secret reference.

**gcloud CLI:**
```bash
# List Cloud SQL instances in the project
gcloud sql instances list \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,region,settings.tier,state)"

# Describe a specific Cloud SQL instance (connection name, IP, flags)
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(connectionName,ipAddresses,databaseVersion,settings)"

# List databases on a Cloud SQL instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,charset,collation)"

# List users on a Cloud SQL instance
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,type)"

# List Secret Manager secrets related to the database
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name:db" \
  --format="table(name,createTime)"

# List Eventarc triggers (password rotation trigger)
gcloud eventarc triggers list \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,eventFilters,destination.cloudRun.service)"
```

---

## Group 12: Backup & Maintenance

These variables configure automated database backup scheduling and one-time backup import. The module provisions a Cloud Run Job to perform database dumps, a Cloud Scheduler trigger to run it on a defined schedule, and a GCS bucket to store the resulting backup files. A separate one-time import mechanism allows an existing backup to be restored into the database during deployment — useful for seeding a new environment with production data.

> **Note:** Backup and import operations apply only when `database_type` is not `NONE`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Unix cron expression (UTC) | The cron schedule that controls when the automated database backup job runs. All times are in **UTC**. The backup job performs a database dump and writes the output to the module's GCS backup bucket. Common schedule examples: `"0 2 * * *"` — daily at 02:00 UTC; `"0 */6 * * *"` — every 6 hours; `"0 2 * * 0"` — weekly on Sunday at 02:00 UTC; `"0 2 1 * *"` — monthly on the 1st at 02:00 UTC. **Choose a schedule that matches your Recovery Point Objective (RPO)** — for example, a daily backup means you could lose up to 24 hours of data in the worst case. For critical production databases, consider an hourly or 6-hourly schedule. Schedule the backup during low-traffic periods to minimise the performance impact on the database. |
| `backup_retention_days` | `7` | Positive integer | The number of days backup files are retained in the GCS backup bucket before being automatically deleted by a lifecycle rule. Setting a longer retention period increases storage costs but provides a longer window for recovery. **Guidance by environment:** development — `7` days is typically sufficient; staging — `14`–`30` days; production — `30`–`90` days or longer depending on compliance requirements. Some regulatory frameworks (e.g. PCI-DSS, HIPAA) mandate minimum backup retention periods — verify your requirements before reducing this value. |
| `enable_backup_import` | `false` | `true` / `false` | When `true`, a one-time database import job is executed during deployment, restoring the backup file specified by `backup_file` from the source defined in `backup_source`. This is designed for **seeding a new environment** with data from an existing backup — for example, populating a staging environment with a copy of production data, or restoring a database after a fresh deployment. **Configure `backup_source`, `backup_file`, and `backup_format` before enabling.** The import job runs after the database is provisioned. If the database already contains data, the import may produce errors or conflicts depending on the backup format — test in a non-production environment first. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | The source from which the backup file is retrieved for import. **`gcs`**: retrieves the backup file from the module's provisioned GCS backup bucket. The file must be uploaded to the bucket before deployment. **`gdrive`**: retrieves the backup file from a Google Drive location. Useful when backup files are stored in a shared Google Drive rather than GCS. Only used when `enable_backup_import` is `true`. |
| `backup_file` | `"backup.sql"` | Filename string | The filename of the backup file to import into the database. The file must exist at the configured source (`backup_source`) before deployment begins. For GCS, the file must be present in the module's backup bucket. Examples: `"backup.sql"`, `"2024-01-15-dump.sql.gz"`, `"production-snapshot.tar"`. Only used when `enable_backup_import` is `true`. Ensure the filename exactly matches the file present in the source, including extension — a mismatch will cause the import job to fail. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` / `auto` | The format of the backup file to be imported. Must match the actual format of `backup_file`. **`sql`**: plain-text SQL dump (e.g. `pg_dump` or `mysqldump` output). **`gz`**: gzip-compressed SQL dump. **`tar`** / **`tgz`** / **`tar.gz`**: tar archive (optionally compressed). **`zip`**: ZIP archive. **`auto`**: the import job attempts to detect the format automatically from the file extension — use this when the format may vary between runs, but explicit values are preferred for reliability. Only used when `enable_backup_import` is `true`. |

### Validating Group 12 Settings

**Google Cloud Console:**
- **Backup schedule (Cloud Scheduler):** Navigate to **Cloud Scheduler** to confirm the backup job trigger exists, its schedule, last run time, and status (enabled/paused).
- **Backup job (Cloud Run Jobs):** Navigate to **Cloud Run → Jobs** to confirm the backup job exists. Click the job and select **Executions** to view past runs, their status, and duration.
- **Backup files (GCS bucket):** Navigate to **Cloud Storage → Buckets** and look for the backup bucket (named after the application with a `-backup` suffix). Click the bucket to confirm backup files are being written and to verify lifecycle rules are applied.
- **Import job:** After enabling `enable_backup_import`, navigate to **Cloud Run → Jobs → Executions** to confirm the import job ran successfully. View logs for any errors.

**gcloud CLI:**
```bash
# List Cloud Scheduler jobs (backup triggers)
gcloud scheduler jobs list \
  --location=REGION \
  --project=PROJECT_ID \
  --format="table(name,schedule,state,lastAttemptTime)"

# View the last execution of the backup Cloud Run Job
gcloud run jobs executions list \
  --job=BACKUP_JOB_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# List backup files in the GCS backup bucket
gcloud storage ls gs://BACKUP_BUCKET_NAME/ \
  --recursive \
  --format="table(name,size,timeCreated)"

# View the lifecycle rules on the backup bucket (confirm retention policy)
gcloud storage buckets describe gs://BACKUP_BUCKET_NAME \
  --format="yaml(lifecycle)"

# Manually trigger the backup job immediately (for testing)
gcloud scheduler jobs run SCHEDULER_JOB_NAME \
  --location=REGION
```

---

## Group 13: Custom Initialisation & SQL

These variables enable the execution of custom SQL scripts against the application database during deployment. This provides a flexible mechanism for applying schema changes, installing stored procedures, creating roles, or loading seed data that cannot be handled by the application's own migration framework. Scripts are retrieved from a GCS bucket and executed in lexicographic (alphabetical) order, making it straightforward to version and sequence migrations.

> **Note:** Custom SQL scripts run only when `database_type` is not `NONE`. The Cloud Run service account must have read access to the GCS bucket containing the scripts.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | `true` / `false` | When `true`, the module retrieves SQL script files from the GCS bucket and path specified by `custom_sql_scripts_bucket` and `custom_sql_scripts_path`, then executes them against the application database in lexicographic order. Scripts run as part of the deployment process via a Cloud Run Job. This is intended for **schema migrations, stored procedure installation, role creation, or seed data loading** that needs to happen at the infrastructure level rather than within the application. Set to `false` if your application manages its own schema migrations at startup (e.g. via Flyway, Liquibase, Django migrations, or Alembic). **Important:** scripts are re-executed on every deployment if `execute_on_apply` is configured — design scripts to be idempotent (safe to run multiple times) to avoid errors on repeat runs. |
| `custom_sql_scripts_bucket` | `""` | GCS bucket name | The name of the GCS bucket containing the SQL script files to execute. The bucket must exist before deployment and the Cloud Run service account must have at minimum `roles/storage.objectViewer` on this bucket. This can be the module's own provisioned application bucket (e.g. `PROJECT-APPLICATION-data`) or a dedicated scripts bucket shared across multiple deployments. Required when `enable_custom_sql_scripts` is `true`. |
| `custom_sql_scripts_path` | `""` | GCS path prefix string | The path prefix within the GCS bucket from which SQL scripts are retrieved. All `.sql` files found under this prefix are executed in **lexicographic (alphabetical) order**. Use a naming convention such as `001_create_tables.sql`, `002_add_indexes.sql`, `003_seed_data.sql` to control execution order precisely. Examples: `"init/"` — runs all `.sql` files in the `init/` folder; `"migrations/v2/"` — runs all `.sql` files in a versioned subfolder. Required when `enable_custom_sql_scripts` is `true`. Ensure no unwanted `.sql` files exist under the prefix, as all matching files will be executed. |
| `custom_sql_scripts_use_root` | `false` | `true` / `false` | Controls which database user executes the custom SQL scripts. **`false` (default):** scripts run as the application database user (`application_database_user`), which has permissions scoped to the application database only. This is the **recommended setting** for most scripts. **`true`:** scripts run as the root (superuser) database account. Enable only when scripts require elevated privileges not available to the application user — for example, creating PostgreSQL extensions (`CREATE EXTENSION`), creating additional roles (`CREATE ROLE`), or modifying database-level configuration. **Use with caution:** running arbitrary SQL as root carries a higher risk of accidental or destructive changes to the database instance. |

### Validating Group 13 Settings

**Google Cloud Console:**
- **Script execution job:** Navigate to **Cloud Run → Jobs** and look for the SQL scripts job (named after the application). Select the job and click **Executions** to view run history, status, and logs.
- **Script files in GCS:** Navigate to **Cloud Storage → Buckets → *scripts bucket*** and confirm the expected `.sql` files exist at the configured path prefix.
- **IAM access on the bucket:** In the bucket details, select the **Permissions** tab and confirm the Cloud Run service account has at minimum `Storage Object Viewer` access.
- **Script execution logs:** In the job execution details, click **Logs** to view the SQL output and confirm scripts ran successfully or diagnose failures.

**gcloud CLI:**
```bash
# Confirm SQL script files exist in the GCS bucket at the configured path
gcloud storage ls gs://BUCKET_NAME/SCRIPTS_PATH \
  --recursive

# Check the Cloud Run service account has access to the scripts bucket
gcloud storage buckets get-iam-policy gs://BUCKET_NAME \
  --format="table(bindings.role,bindings.members)"

# List executions of the SQL scripts Cloud Run Job
gcloud run jobs executions list \
  --job=SQL_SCRIPTS_JOB_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View logs from the most recent SQL scripts job execution
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=SQL_SCRIPTS_JOB_NAME" \
  --project=PROJECT_ID \
  --limit=50 \
  --order=asc \
  --format="table(timestamp,severity,textPayload)"
```

---

## Group 14: Access & Networking

> **PSE Certification relevance:** This group maps to PSE exam Section 2.3 (establishing private connectivity). `vpc_egress_setting = "ALL_TRAFFIC"` is the Cloud Run implementation of routing all egress through the VPC — enabling Cloud NAT logging, consistent egress IP, and on-premises connectivity. `ingress_settings = "internal-and-cloud-load-balancing"` is a required pairing with `enable_cloud_armor` (Group 16): it ensures the Cloud Run service only accepts traffic that has already passed through the load balancer and WAF, closing the bypass path that would otherwise allow direct internet access to the service URL.
> **ACE Exam Connection:** This group maps to ACE Section 2.3 (Planning and implementing networking resources). The `vpc_egress_setting` variable demonstrates Direct VPC Egress and VPC routing choices; `ingress_settings` demonstrates serverless ingress restriction — a key ACE exam networking pattern. The combination of `ingress_settings = "internal-and-cloud-load-balancing"` with Cloud Armor (Group 16) is the recommended architecture for public applications.

These variables control how traffic reaches the Cloud Run service and how the service connects outbound to other GCP resources. Correct configuration here is essential for both security (restricting public internet exposure) and connectivity (ensuring the service can reach private Cloud SQL instances, Memorystore, or NFS volumes over VPC).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `ingress_settings` | `"all"` | `all` / `internal` / `internal-and-cloud-load-balancing` | Controls which traffic sources are permitted to invoke the Cloud Run service. **`all`:** The service is publicly reachable from the internet. Use for public-facing applications. **`internal`:** Only traffic originating within the same VPC network or from other Google internal services (e.g. Cloud Tasks, Pub/Sub push) can reach the service. Use for backend APIs, workers, or any service that should not be directly exposed to the internet. **`internal-and-cloud-load-balancing`:** Restricts direct internet access but permits traffic arriving via a Google Cloud Load Balancer (GCLB). This is the correct setting when using `enable_cloud_armor = true`, as the GCLB fronts the service and provides SSL termination, WAF rules, and CDN. Changing this setting takes effect on the next deployment without requiring a new revision. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | `ALL_TRAFFIC` / `PRIVATE_RANGES_ONLY` | Controls which outbound traffic from the Cloud Run service is routed through the configured VPC network. **`PRIVATE_RANGES_ONLY` (default):** Only traffic destined for RFC 1918 private IP ranges (e.g. `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) is sent through the VPC. Public internet traffic exits Cloud Run directly without traversing the VPC. This is suitable for most workloads where the application needs to reach Cloud SQL, Memorystore, or NFS via private IP while also calling external public APIs. **`ALL_TRAFFIC`:** All outbound traffic — including public internet requests — is routed through the VPC. Required when outbound internet access must be controlled via a Cloud NAT gateway, when on-premises connectivity is needed via VPN or Interconnect, or when egress policies enforce that all traffic exits through a specific network path. Note that `ALL_TRAFFIC` may increase latency for calls to public Google APIs and external services. |
| `network_name` | `""` *(auto-discovered)* | VPC network name string | The name of the VPC network to attach the Cloud Run service to for egress routing and Direct VPC Egress. Leave empty to allow the module to auto-discover the single Services_GCP-managed network in the project. **Specify a value** when more than one Services_GCP-managed network exists in the project, or when you want to attach the service to a specific network. The network must exist in the same project. Changing this value will trigger a new Cloud Run revision. |

### Validating Group 14 Settings

**Google Cloud Console:**
- **Ingress settings:** Navigate to **Cloud Run → Services → *your service* → Details** tab. Under **Networking**, confirm the ingress setting matches the configured value.
- **VPC egress:** In the same **Networking** section, confirm the VPC network attachment and egress setting are displayed correctly.

**gcloud CLI:**
```bash
# Confirm ingress and VPC egress settings on the Cloud Run service
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.metadata.annotations,spec.traffic)"

# List Direct VPC Egress configuration on the service revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.vpcAccess)"
```

---

## Group 15: Identity-Aware Proxy

> **PSE Certification relevance:** This group maps to PSE exam Section 1.3 (managing authentication) and Section 2.1 (perimeter security). IAP is the RAD platform's implementation of OAuth 2.0-based application perimeter authentication — all requests must carry a valid Google identity, eliminating the need for a VPN. `iap_authorized_groups` demonstrates the PSE best practice of managing access through Google Groups rather than individual user accounts (PSE Section 1.4), enabling centrally managed team access without Terraform re-applies.
> **ACE Exam Connection:** This group maps to ACE Section 4.2 (Identity-Aware Proxy). IAP is a direct ACE exam objective — `enable_iap`, `iap_authorized_users`, and `iap_authorized_groups` demonstrate zero-trust access control. Using a Google Group email in `iap_authorized_groups` rather than individual emails is the exam-recommended approach for scalable identity management.

These variables configure Identity-Aware Proxy (IAP) in front of the Cloud Run service, requiring Google-identity authentication before users can access the application. IAP enforces access at the proxy layer — no application code changes are needed to add authentication. It is recommended for internal tools, admin interfaces, or any application where access should be restricted to known Google identities. `enable_iap` is the master switch; `iap_authorized_users` and `iap_authorized_groups` define who is permitted access.

> **Note:** For IAP to function correctly, `ingress_settings` (Group 14) should be set to `internal-and-cloud-load-balancing` when the service is fronted by a GCLB, or `all` for direct IAP-protected Cloud Run services.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_iap` | `false` | `true` / `false` | Enables Identity-Aware Proxy (IAP) in front of the Cloud Run service. When `true`, all requests to the service must carry a valid Google identity credential — unauthenticated requests are redirected to a Google sign-in page. IAP enforces access at the proxy layer, meaning **no application code changes are needed** to add authentication. Use IAP for internal tools, admin interfaces, or any application where access should be restricted to known Google identities. When enabled, configure `iap_authorized_users` and `iap_authorized_groups` to define who may access the application. |
| `iap_authorized_users` | `[]` | List of `"user:email"` or `"serviceAccount:email"` strings | Individual users or service accounts granted the `IAP-secured Web App User` role, permitting them to access the application through IAP. Only active when `enable_iap` is `true`. Each entry must use the IAM member format: `"user:alice@example.com"` for a Google account, or `"serviceAccount:ci-runner@project.iam.gserviceaccount.com"` for a service account (e.g. to allow CI/CD pipelines or health check agents to bypass the sign-in page). Adding an address here does **not** grant any other GCP IAM permissions on the project — it only controls access to the IAP-protected application. For team-level access management, prefer `iap_authorized_groups` over individual user entries. |
| `iap_authorized_groups` | `[]` | List of `"group:name@domain"` strings | Google Groups granted the `IAP-secured Web App User` role. Only active when `enable_iap` is `true`. Each entry must use the IAM member format: `"group:engineering@example.com"`. Using groups is the recommended approach for granting access to teams, as membership can be managed centrally in Google Workspace or Cloud Identity without requiring a Terraform re-apply. Combining `iap_authorized_groups` with `iap_authorized_users` is supported — access is granted to the union of both lists. |

### Validating Group 15 Settings

**Google Cloud Console:**
- **IAP status:** Navigate to **Security → Identity-Aware Proxy**. The Cloud Run service should appear in the list with IAP enabled. The **Access** column shows the number of authorised principals.
- **IAP authorised members:** Click the service entry in the IAP console and select the **Principals** tab to verify that the expected users, service accounts, and groups are listed with the `IAP-secured Web App User` role.

**gcloud CLI:**
```bash
# Check which principals have IAP access to the Cloud Run service
gcloud run services get-iam-policy SERVICE_NAME \
  --region=REGION \
  --format="table(bindings.role,bindings.members)"

# Verify IAP is enabled on the backend service (when using a load balancer)
gcloud compute backend-services list \
  --project=PROJECT_ID \
  --format="table(name,iap.enabled)"
```

---

## Group 16: Cloud Armor & CDN

> **PSE Certification relevance:** This group maps to PSE exam Section 2.1 (designing and configuring perimeter security). `enable_cloud_armor` deploys Cloud Armor with OWASP CRS WAF rules and Adaptive Protection — the primary exam objective for web application firewall configuration. `admin_ip_ranges` demonstrates priority-ordered allow rules for trusted networks. **Critical pairing:** always set `ingress_settings = "internal-and-cloud-load-balancing"` (Group 14) alongside `enable_cloud_armor = true` to prevent direct internet access to the Cloud Run service URL that would bypass the WAF.
> **ACE Exam Connection:** This group maps to ACE Section 2.3 (Choosing and deploying load balancers). The `enable_cloud_armor` variable provisions a Global External Application Load Balancer with a Serverless NEG — a core ACE exam architecture. Cloud Armor WAF rules, `admin_ip_ranges`, and `application_domains` demonstrate the ACE exam's edge security and custom domain topics. This is the configuration that enables Premium Network Tier routing through Google's global backbone.

These variables configure a Global HTTPS Load Balancer fronting the Cloud Run service, with optional Cloud Armor WAF protection, custom domain SSL termination, and Cloud CDN edge caching. Enabling this group is required whenever the application needs a stable custom domain with a Google-managed SSL certificate, DDoS mitigation, IP-based access controls, or globally cached static content. All four variables work together as a unit — `enable_cloud_armor` is the master switch, and the remaining variables refine its behaviour.

> **Note:** Provisioning a Global HTTPS Load Balancer and Cloud Armor policy incurs additional GCP costs beyond Cloud Run pricing. Review the [Cloud Armor pricing page](https://cloud.google.com/armor/pricing) before enabling in production.

> **Note:** When `enable_cloud_armor` is `true`, set `ingress_settings` (Group 14) to `internal-and-cloud-load-balancing` to ensure the Cloud Run service only accepts traffic that has passed through the load balancer and Cloud Armor policy.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_cloud_armor` | `false` | `true` / `false` | Master switch for the load balancer stack. When `true`, the module provisions a Global HTTPS Load Balancer with a serverless NEG backend targeting the Cloud Run service, a Google-managed SSL certificate for each domain in `application_domains`, and a Cloud Armor security policy. This is required for **custom domain HTTPS termination**, **DDoS protection**, **WAF rules**, and **CDN**. When `false`, the Cloud Run service is accessed directly via its `*.run.app` URL and all other variables in this group have no effect. Enabling this after initial deployment creates new GCP resources but does not affect the Cloud Run service revision itself. |
| `admin_ip_ranges` | `[]` | List of CIDR strings (e.g. `["203.0.113.0/24"]`) | CIDR IP address ranges that are granted a higher-priority Cloud Armor rule exempting them from WAF inspection rules. Requests from these ranges are allowed unconditionally, bypassing any `deny` or WAF rules in the security policy. Use this for trusted networks such as corporate office egress IPs, CI/CD runner IPs, or monitoring probe sources that would otherwise trigger WAF rules. Leave empty to apply WAF rules uniformly to all traffic. Only effective when `enable_cloud_armor` is `true`. **Do not add overly broad ranges** (e.g. `0.0.0.0/0`) as this would defeat the purpose of the WAF policy. |
| `application_domains` | `[]` | List of domain name strings (e.g. `["app.example.com", "www.example.com"]`) | Custom domain names to associate with the load balancer. A Google-managed SSL certificate is provisioned automatically for each domain, handling certificate issuance and renewal without manual intervention. After deployment, the load balancer's external IP address is output by Terraform — **DNS A records for each domain must be pointed to this IP** before the certificate can be issued and the domain will serve traffic. Certificate provisioning typically takes 10–60 minutes after DNS propagation. Leave empty if you do not need a custom domain and are content with the default `*.run.app` URL. Only used when `enable_cloud_armor` is `true`. |
| `enable_cdn` | `false` | `true` / `false` | Enables Cloud CDN on the load balancer backend, caching HTTP responses at Google's global edge network. When `true`, cacheable responses (those with appropriate `Cache-Control` headers) are served from the nearest edge PoP, reducing latency for geographically distributed users and reducing load on the Cloud Run origin. Only applies when `enable_cloud_armor` is `true`. **Recommended for** applications serving static assets, images, or public API responses that change infrequently. **Not recommended for** applications with session-based or highly personalised responses where caching would cause users to receive incorrect content. Ensure your application sets correct `Cache-Control` headers to control what is and is not cached at the edge. |

> **Real-World Example:** A global e-commerce platform sets `enable_cloud_armor = true` with `application_domains = ["shop.example.com"]`. The resulting Global HTTPS Load Balancer routes a customer in Singapore and a customer in Ireland to the nearest Google PoP via Premium Tier anycast routing — both reach the same IP address. A Cloud Armor preconfigured WAF rule blocks SQL injection attempts before they reach Cloud Run. During a flash sale, the operations team adds `admin_ip_ranges` with their monitoring tool's IP range to prevent uptime check traffic from triggering WAF rules. Enabling `enable_cdn = true` for the product catalogue API (which uses `Cache-Control: max-age=300`) cuts Cloud Run invocations by 70% at peak load.

### Validating Group 16 Settings

**Google Cloud Console:**
- **Load balancer:** Navigate to **Network services → Load balancing** and confirm a HTTPS load balancer named after the application is listed. Click it to view frontends, backends, and the associated Cloud Armor policy.
- **SSL certificates:** In the load balancer details, select the **Frontend** tab. Each domain entry should show a Google-managed certificate with status `ACTIVE`. A status of `PROVISIONING` indicates DNS has not yet propagated or the certificate is still being issued.
- **Cloud Armor policy:** Navigate to **Network security → Cloud Armor policies** and confirm the policy is attached to the load balancer backend. Review the rules list to confirm admin IP range exemptions and WAF rules are configured as expected.
- **CDN status:** In the load balancer details, select the **Backend** tab and confirm that **Cloud CDN** is shown as enabled on the backend service.
- **Load balancer IP:** In the **Frontend** configuration, note the external IP address. Verify your DNS A records resolve to this IP using `dig` or `nslookup`.

**gcloud CLI:**
```bash
# List HTTPS load balancers in the project
gcloud compute forwarding-rules list \
  --project=PROJECT_ID \
  --filter="loadBalancingScheme=EXTERNAL_MANAGED" \
  --format="table(name,IPAddress,target)"

# Describe the backend service to confirm CDN and Cloud Armor policy attachment
gcloud compute backend-services describe BACKEND_SERVICE_NAME \
  --global \
  --format="yaml(enableCDN,securityPolicy)"

# List Cloud Armor security policies and their rules
gcloud compute security-policies describe POLICY_NAME \
  --project=PROJECT_ID \
  --format="yaml(rules)"

# Check SSL certificate status for custom domains
gcloud compute ssl-certificates list \
  --project=PROJECT_ID \
  --format="table(name,managed.domains,managed.status,managed.domainStatus)"

# Confirm DNS resolves to the load balancer IP
dig +short app.example.com
```

---

## Group 17: VPC Service Controls

> **PSE Certification relevance:** This group maps to PSE exam Section 2.2 (configuring boundary segmentation) and Section 5.1 (compliance). VPC Service Controls is a key PSE exam topic as a defence-in-depth control that operates independently of IAM — it blocks API access to Cloud Storage, Secret Manager, Cloud SQL, and other services from outside the defined perimeter *even if the requester holds valid IAM roles*. This is the exam's primary example of location-based access control complementing identity-based IAM. In regulated environments (PCI-DSS, HIPAA), VPC-SC is a component of the network boundary controls required to scope the compliance environment.

These variables control whether VPC Service Controls (VPC-SC) perimeters are enforced around the GCP APIs consumed by the module. VPC-SC provides a defence-in-depth layer that restricts API access to within a defined security perimeter, preventing data exfiltration even if IAM credentials are compromised. This variable acts as an opt-in integration point — the perimeter itself must be configured externally in Access Context Manager before this setting has any effect.

> **Note:** Enabling VPC-SC without a correctly configured perimeter in the project can cause API calls to fail. Ensure the VPC-SC perimeter includes all GCP services used by this module (Cloud Run, Cloud SQL, Cloud Storage, Secret Manager, Artifact Registry, etc.) and that the module's service account is included as a permitted principal before setting `enable_vpc_sc = true`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_vpc_sc` | `false` | `true` / `false` | When `true`, the module configures its resources to respect the VPC Service Controls perimeter defined in the project. VPC-SC restricts API access so that only requests originating from within the perimeter (authorised VPCs, identities, or access levels) are permitted, blocking API calls from outside regardless of IAM permissions. This is primarily a **data exfiltration prevention** control — it prevents resources such as Cloud Storage buckets or Secret Manager secrets from being accessed from outside the defined perimeter, even by principals who hold valid IAM roles. **Prerequisites:** An Access Context Manager policy and a VPC-SC perimeter must already exist in the project and must include all GCP service APIs used by this module. The module's `resource_creator_identity` service account must be listed as a permitted principal in the perimeter. When `false` (default), no VPC-SC enforcement is applied and all API access is governed solely by IAM. |

### Validating Group 17 Settings

**Google Cloud Console:**
- **VPC-SC perimeter:** Navigate to **Security → VPC Service Controls**. Confirm that a perimeter exists and that its **Restricted services** list includes the APIs used by this module (e.g. `run.googleapis.com`, `sqladmin.googleapis.com`, `storage.googleapis.com`, `secretmanager.googleapis.com`, `artifactregistry.googleapis.com`).
- **Perimeter membership:** In the perimeter details, confirm the project is listed under **Projects** and that the module's service account appears under **Access levels** or **Ingress/Egress rules** as an authorised principal.
- **Audit logs:** Navigate to **Logging → Logs Explorer** and filter for `protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"` to identify any API calls being denied by the perimeter.

**gcloud CLI:**
```bash
# List VPC-SC access policies in the organisation
gcloud access-context-manager policies list \
  --organization=ORGANIZATION_ID

# List VPC-SC perimeters under the access policy
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME \
  --format="table(name,status.resources,status.restrictedServices)"

# Describe a specific perimeter to verify restricted services and project membership
gcloud access-context-manager perimeters describe PERIMETER_NAME \
  --policy=POLICY_NAME \
  --format="yaml(status.resources,status.restrictedServices,status.accessLevels)"

# Check VPC-SC violation logs for this project
gcloud logging read \
  'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName,protoPayload.metadata.vpcServiceControlsUniqueId)"
```

---

## Deployment Prerequisites & Dependency Analysis

This section summarises every external dependency for deploying `App_CloudRun`. Dependencies are grouped by failure mode to help you identify what must be in place before deploying, what will silently not work, and what requires post-deployment manual action.

> **Notation:** *Self-provisioned* means the module (or its `App_Common` library) creates the resource automatically on first deployment — no manual pre-requisite is required.

---

### Tier 1 — Hard Prerequisites

These configurations will cause `terraform apply` to fail, or will prevent the Cloud Run service from reaching a healthy state, if the listed prerequisite is not satisfied.

| Feature | Variable(s) | Requirement |
|---|---|---|
| **Secret Manager references** | `secret_environment_variables` | Every secret named in the map must exist in Secret Manager **before running `terraform plan`**. Missing secrets are caught at plan time with the message: *`Secret '<name>' does not exist in project '<id>'. Create the secret in Secret Manager before running terraform plan.`* Previously this only surfaced when the Cloud Run revision failed to start. |
| **Custom SQL scripts** | `enable_custom_sql_scripts = true` | The GCS bucket specified in `custom_sql_scripts_bucket` must exist and all `.sql` files must be uploaded to `custom_sql_scripts_path` before deployment. The module's own application bucket can serve as the scripts bucket, but the script files must be placed there manually before the first apply. |
| **Database backup import** | `enable_backup_import = true` | The backup file named in `backup_file` must exist at the configured source — either the module's GCS backup bucket or a Google Drive location — before deployment. A missing file causes the import Cloud Run Job to fail immediately after it is triggered. |
| **CI/CD pipeline** | `enable_cicd_trigger = true` | A GitHub repository must be accessible and either a GitHub Personal Access Token (scopes: `repo` and `admin:repo_hook`) or a GitHub App installation ID must be provided. Without valid credentials, the Cloud Build GitHub connection cannot be established and `terraform apply` will fail. |
| **Custom container build** | `container_image_source = "custom"` | Requires the same GitHub repository connection and credentials as `enable_cicd_trigger`. Cloud Build will fail at apply time if the repository is unreachable or credentials are absent. |
| **VPC Service Controls** | `enable_vpc_sc = true` | An Access Context Manager policy and VPC-SC perimeter covering all GCP service APIs used by this module must already exist, and the module's service account must be a permitted principal within the perimeter. VPC-SC perimeters are organisation-level resources that cannot be created by this module — configure them via your platform team before enabling this flag. |

---

### Tier 2 — Silent Failures

These configurations deploy without a Terraform error but will not function correctly at runtime. There is no immediate error to indicate the problem.

<div className="silent-failures-table">

| Feature | Variable(s) | Failure mode | Resolution |
|---|---|---|---|
| **Redis cache** | `enable_redis = true` + explicit `redis_host` | `REDIS_HOST` and `REDIS_PORT` environment variables are injected into the container, but the application cannot connect if no Redis service exists at the specified address. There is no Terraform error. | Provision a Cloud Memorystore instance or Redis VM before deploying, or deploy `Services_GCP` which provides a shared instance that is auto-discovered when `redis_host` is left blank. |
| **Secret rotation** | `secret_rotation_period` | The Pub/Sub rotation notification is scheduled and fires at the configured interval, but **no secret value is actually rotated**. The notification is only a trigger — the handler that generates a new value and updates the secret must be implemented separately. | Use `enable_auto_password_rotation = true` for the database password (handled automatically by this module), or deploy a separate Cloud Function or Cloud Run Job that subscribes to the rotation Pub/Sub topic. |

</div>

---

### Tier 3 — Soft Prerequisites

These features deploy successfully but require a manual step outside Terraform before they become fully operational.

| Feature | Variable(s) | Required action |
|---|---|---|
| **Custom domain** | `application_domains` (with `enable_cloud_armor = true`) | After `terraform apply`, create **DNS A records** for each domain pointing to the load balancer's external IP address (emitted as a Terraform output). Google-managed SSL certificate provisioning begins automatically after DNS propagation and typically completes within 10–60 minutes. The application will not be reachable on the custom domain until the certificate reaches `ACTIVE` status. |
| **Identity-Aware Proxy** | `enable_iap = true` | Requires the GCP project to have an **OAuth consent screen** configured (one-time setup in **APIs & Services → OAuth consent screen**). The consent screen must exist before the IAP backend service can be created. |
| **Backup file staging** | `enable_backup_import = true` | The backup file must be uploaded to the GCS backup bucket (or Google Drive) **before** the deployment that enables this flag. |

---

### Previously Manual — Now Self-Provisioned

The following were documented as hard prerequisites in earlier versions of this module. They are now handled automatically and require no pre-existing resources.

| Feature | Variable(s) | How it is now handled |
|---|---|---|
| **Binary Authorization attestor, policy & KMS key** | `enable_binary_authorization = true` | `App_Common/modules/app_security` idempotently creates the KMS signing keyring (`${project_id}-binauthz-keyring`), `binauthz-signer` key, `pipeline-attestor` Container Analysis note, attestor, and Binary Authorization policy via shell scripts. If `Services_GCP` provisioned these resources first, the scripts detect their existence and skip creation. Image signing runs automatically after each build. |
| **CMEK keyring for storage encryption** | `manage_storage_kms_iam = true` | `App_Common/modules/app_cmek` idempotently creates the `${project_id}-cmek-keyring` KMS keyring and its `storage-key` CryptoKey before the storage IAM binding is applied. It is now safe to set `manage_storage_kms_iam = true` on the first deployment without any pre-existing KMS resources. If `Services_GCP` is deployed with `enable_cmek = true`, both modules target the same well-known keyring name — whichever runs first creates it; the second is a no-op. |

---

### Dependency on `Services_GCP` for Shared Resources

`Services_GCP` is declared as a module dependency (`module_dependency = ["Services_GCP"]`) but is **not required** for a standalone deployment. The module self-provisions all necessary infrastructure inline when `Services_GCP` has not been deployed. However, deploying `Services_GCP` first is strongly recommended when multiple application modules share the same GCP project — it centralises shared infrastructure, reduces per-deployment cost, and simplifies ongoing management.

| Resource | Without `Services_GCP` | With `Services_GCP` |
|---|---|---|
| **VPC network** | Module auto-provisions an inline VPC, subnet, Cloud NAT, and Cloud Router. | Module attaches to the shared centrally-managed VPC. Avoids per-project VPC and IP address quota consumption; simplifies firewall management across all deployments. |
| **Cloud SQL instance** | Module auto-provisions a dedicated Cloud SQL instance per deployment. Each deployment incurs the full instance cost. | Module auto-discovers and connects to the shared Cloud SQL instance, provisioning only a separate database and user within it. Eliminates per-deployment instance cost for projects with multiple application deployments. |
| **NFS / Filestore** | Module auto-provisions an inline NFS GCE VM when `enable_nfs = true`. The VM is a single point of failure with no managed backups. | Module auto-discovers the centrally managed Filestore instance. Provides enterprise-grade NFS with guaranteed throughput and managed snapshots. |
| **Redis / Memorystore** | `enable_redis = true` with a blank `redis_host` falls back to the NFS VM's IP address — only works if a Redis-compatible service is co-located on that VM. An explicit `redis_host` must be set to connect to any dedicated Redis instance. | Module auto-discovers the shared Memorystore instance. `redis_host` can be left blank. |
| **Artifact Registry** | Module auto-creates a per-deployment Artifact Registry repository. | Module auto-discovers and uses the shared registry, enabling image reuse and consistent vulnerability scanning policies across all deployments. |
| **Binary Authorization** | `app_security` self-provisions the attestor, KMS key, and policy automatically (see above). | `Services_GCP` (with `enable_binary_authorization = true`) provisions the same resources centrally with configurable `binauthz_evaluation_mode` (`ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`). Recommended for production environments requiring attestation enforcement. |
| **CMEK encryption** | `app_cmek` self-provisions the `${project_id}-cmek-keyring` and `storage-key` automatically (see above). | `Services_GCP` (with `enable_cmek = true`) provisions the keyring with a configurable rotation period and applies CMEK across Cloud SQL, Artifact Registry, and other shared resources simultaneously, providing a consistent encryption baseline across all shared infrastructure. |

---
