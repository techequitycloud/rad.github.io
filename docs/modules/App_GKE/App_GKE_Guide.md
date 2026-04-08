---
title: "App GKE Configuration Guide"
sidebar_label: "GKE"
---

# App_GKE Module — Configuration Guide

This guide describes every configuration variable available in the `App_GKE` module, organized into functional groups. For each variable it explains the available options, the implications of each choice, and how to validate the resulting configuration in the Google Cloud Console or using the `gcloud` CLI.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Security Architecture Overview

The `App_GKE` module deploys onto **GKE Autopilot**, where Google manages the node OS, node pool configuration, system pods, and OS security patching — significantly narrowing the customer's compliance scope compared to GKE Standard. The module implements a layered, defence-in-depth security posture on top of these Autopilot-managed foundations. Enable controls progressively based on the sensitivity of the workload.

| Layer | Control | Variable(s) | Group |
|---|---|---|---|
| **Perimeter** | Cloud Armor WAF + DDoS mitigation | `enable_cloud_armor`, `cloud_armor_policy_name` | 18 |
| **Perimeter** | Identity-Aware Proxy authentication | `enable_iap`, `iap_authorized_users`, `iap_authorized_groups` | 17 |
| **Network** | Pod-to-pod microsegmentation (eBPF/Cilium) | `enable_network_segmentation` | 5 |
| **Network** | Service mesh mTLS (east-west traffic) | `configure_service_mesh` | 5 |
| **Network** | API-level perimeter (data exfiltration prevention) | `enable_vpc_sc` | Prerequisites |
| **Identity** | Workload Identity (no JSON keys in containers) | Provisioned automatically | — |
| **Identity** | Dedicated minimum-privilege GKE service account | Provisioned automatically | — |
| **Identity** | Workload authenticates to Cloud SQL via IAM (no keys) | `enable_cloudsql_volume` | 3 |
| **Secrets** | Secret Manager environment variable references | `secret_environment_variables` | 4 |
| **Secrets** | Secrets Store CSI Driver (plaintext never in etcd or state) | `enable_secrets_store_csi_driver` | 4 |
| **Secrets** | Automated database credential rotation | `enable_auto_password_rotation`, `secret_rotation_period` | 10, 4 |
| **Data** | Private-IP-only Cloud SQL | Provisioned automatically | — |
| **Data** | Customer-managed encryption keys (CMEK) on GCS | `manage_storage_kms_iam` | 4 |
| **Data** | Public access prevention on GCS buckets | `public_access_prevention = "enforced"` | 9 |
| **Data** | Object lifecycle rules for data minimisation | `lifecycle_rules`, `backup_retention_days` | 9, 11 |
| **Supply chain** | Binary Authorization attestation enforcement | `enable_binary_authorization` | 7 |
| **Supply chain** | Container images mirrored to project Artifact Registry | `enable_image_mirroring` | 3 |
| **Reliability** | Pod Disruption Budget (prevents full-service eviction) | `enable_pod_disruption_budget` | 14 |
| **Visibility** | Cloud Monitoring alert policies | `alert_policies` | 13 |
| **Visibility** | Uptime checks from global probe locations | `uptime_check_config` | 13 |

**GKE Autopilot shared responsibility model:** Google manages node OS hardening, system pod security, OS patch management, and Shielded Node enablement — these are the customer's responsibility in GKE Standard but are Google-managed in Autopilot. The customer retains responsibility for workload IAM, network controls, secret management, data encryption, and application security. Navigate to **Kubernetes Engine > Clusters > [cluster] > Security** to review the security controls applied automatically by Autopilot.

**Recommended minimum for internet-facing production workloads:**
1. Set `enable_cloud_armor = true` (Group 18) — WAF and DDoS protection at the Google network edge
2. Set `enable_iap = true` (Group 17) for services requiring Google identity authentication
3. Set `enable_network_segmentation = true` (Group 5) — pod-to-pod microsegmentation for all production workloads handling sensitive data
4. Set `enable_secrets_store_csi_driver = true` (Group 4) for PCI-DSS or HIPAA workloads requiring the highest secret delivery assurance
5. Set `enable_auto_password_rotation = true` (Group 10) for all production database-backed deployments
6. Set `enable_binary_authorization = true` (Group 7) for regulated environments requiring supply chain integrity

> **PSE Certification note:** This module's security controls map directly to the Google Cloud Professional Cloud Security Engineer exam domains. See the [PSE Section 1 guide](../../certification/PSE_Section_1_Exploration_Guide.md) (identity), [PSE Section 2](../../certification/PSE_Section_2_Exploration_Guide.md) (communications and boundary protection), [PSE Section 3](../../certification/PSE_Section_3_Exploration_Guide.md) (data protection), [PSE Section 4](../../certification/PSE_Section_4_Exploration_Guide.md) (operations), and [PSE Section 5](../../certification/PSE_Section_5_Exploration_Guide.md) (compliance) for hands-on exploration guidance mapped to each group.

---

## Group 0: Module Metadata & Configuration

These variables describe the module to the platform catalogue and control platform-level behaviours such as credit billing, resource purge protection, and wrapper-module integration. They are *platform-managed* and should not be changed unless you are customising or extending the module itself.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `module_description` | `"App_GKE: A production-ready module…"` | Any string | Human-readable description displayed in the platform catalogue. Change only when forking or white-labelling the module. |
| `module_documentation` | `"https://docs.radmodules.dev/docs/applications/gke-app"` | Valid URL | URL shown as a help link in the platform UI. Update if you host your own documentation. |
| `module_dependency` | `["Services_GCP"]` | List of module names | Declares which platform modules the platform catalogue will associate with this one for dependency tracking and display purposes. All required GCP prerequisites (APIs, networking, IAM) are provisioned automatically by this module if not already present. Optionally, deploying `Services_GCP` first is recommended when multiple deployments need to share a common set of platform resources — for example a shared Cloud SQL instance, NFS/Filestore server, or VPC network — as `Services_GCP` provisions these shared resources centrally. |
| `module_services` | *(list of GCP service names)* | List of strings | Informational list of GCP services this module uses, shown in the catalogue. The default list includes: GKE Autopilot, Kubernetes Deployments, Kubernetes Services, Cloud Build, Artifact Registry, Cloud Storage, GCS Fuse CSI Driver, Cloud SQL, Cloud SQL Auth Proxy, Filestore (NFS), VPC Network, Secret Manager, Workload Identity, Cloud IAM, Cloud Logging, Cloud Monitoring, and Uptime Checks. No operational effect — changing this does not enable or disable any GCP API or resource. |
| `credit_cost` | `100` | Positive integer | Number of platform credits deducted when a deployment is created. Set by the platform administrator. |
| `require_credit_purchases` | `true` | `true` / `false` | Determines whether purchased credits (credits bought by the user or assigned via a subscription plan) are consumed for this deployment, as opposed to free credits which are awarded at no charge. When `true`, the platform deducts from the user's purchased credit balance. When `false`, the platform uses free credits instead. |
| `enable_purge` | `true` | `true` / `false` | Controls whether the deployment configuration can be removed from the portal. When `true`, a user can delete the deployment record from the portal without affecting the underlying GCP resources — the GKE workloads, Cloud SQL instance, GCS buckets, and secrets remain intact and continue to run. This is useful when resources were initially provisioned via the portal but the team wishes to manage them independently going forward. When `false`, the portal will not allow the configuration to be removed. **This setting does not destroy GCP resources.** |
| `public_access` | `false` | `true` / `false` | When `true`, the module is listed in the public platform catalogue and any user can deploy it. When `false`, the module is visible only to platform administrators and the module owner or publisher. |
| `deployment_id` | `""` *(auto-generated)* | Alphanumeric string | A unique identifier for this deployment. If left blank the platform generates one automatically. Once set, do not change this value — it is embedded in GKE resource names, Kubernetes namespace names, and supporting infrastructure names (Cloud SQL, GCS buckets, secrets). Changing it after initial deployment will cause all named resources to be recreated with new names, leaving the originals orphaned. |

### Validating Group 0 Settings

These variables do not create GCP resources directly, so there is nothing to validate in the console. The effects of `enable_purge` and `public_access` are enforced by the platform layer, not by GCP.

To confirm the GCP APIs this module relies on are active in the project:

**Google Cloud Console:** Navigate to **APIs & Services → Enabled APIs & Services** and verify that the core services listed in `module_services` (e.g. Kubernetes Engine API, Cloud Build API, Artifact Registry API, Cloud SQL Admin API, Secret Manager API) are all enabled.

**gcloud CLI:**
```bash
# List all currently enabled APIs in the project
gcloud services list --enabled --project=PROJECT_ID \
  --format="table(config.name,config.title)"

# Check a specific API, e.g. Kubernetes Engine
gcloud services describe container.googleapis.com \
  --project=PROJECT_ID \
  --format="table(config.title,state)"
```

---

## Group 1: Project & Identity

These variables establish the GCP project context and the shared identity settings that apply across all resources created by the module. They must be configured correctly before any deployment can succeed.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `project_id` | *(required)* | `[a-z][a-z0-9-]{4,28}[a-z0-9]` | The GCP project ID where all resources will be provisioned. All required GCP prerequisites (APIs, networking, IAM) are provisioned automatically if not already present. Optionally, `Services_GCP` can be deployed first to provision shared platform resources (such as a shared Cloud SQL instance, NFS/Filestore server, or VPC network) that multiple deployments in the same project can then reuse. **All resource names, IAM bindings, Kubernetes namespaces, secrets, and API calls are scoped to this project.** Changing this after initial deployment will cause all resources to be recreated in the new project. |
| `tenant_deployment_id` | `"demo"` | `[a-z0-9-]{1,20}` | A short label appended to resource names (e.g. Kubernetes namespace, Cloud SQL instance, GCS buckets, secrets) to distinguish this deployment from others in the same project. Use values such as `prod`, `staging`, `dev`, or a customer/tenant identifier. **Do not change this after initial deployment** — it is baked into resource names and changing it will cause all resources to be recreated with new names, leaving the old ones orphaned. |
| `support_users` | `[]` | List of email addresses | Email addresses that receive Cloud Monitoring alert notifications (uptime failures, high error rates, resource exhaustion). These addresses are added to a notification channel in Cloud Monitoring and are also granted project-level access so that they can view logs and metrics for the deployed workloads. Leave empty to suppress all alert emails. |
| `resource_labels` | `{}` | Map of `key = "value"` pairs | Key-value labels applied to every GCP resource created by this module (GKE workloads, Cloud SQL instance, GCS buckets, Filestore instance, secrets, etc.). Use labels to enforce organisational tagging policies — for example cost centre, environment, team ownership, or compliance classification. Labels are visible in Billing reports and can be used to filter resources in the Console. GCP label keys and values must be lowercase, 1–63 characters, and may contain letters, numbers, hyphens, and underscores. Note that Kubernetes resource labels (applied to Pods, Deployments, and Services) are set separately via `service_labels`. |

### Validating Group 1 Settings

**Google Cloud Console:**
- **Project confirmation:** The project name and ID are shown in the top navigation bar. Navigate to **Home → Dashboard** to confirm you are in the correct project.
- **Labels:** Navigate to any GCP resource created by this module (e.g. **Kubernetes Engine → Clusters → *your cluster***) and select the **Labels** tab to verify labels are applied correctly.
- **Alert notification channels:** Navigate to **Monitoring → Alerting → Notification channels** to confirm support user email addresses are registered.

**gcloud CLI:**
```bash
# Confirm the project exists and is active
gcloud projects describe PROJECT_ID

# List GKE clusters in the project and verify labels
gcloud container clusters list --project=PROJECT_ID \
  --format="table(name,location,resourceLabels)"

# List Cloud Monitoring notification channels (alert recipients)
gcloud beta monitoring channels list --project=PROJECT_ID \
  --format="table(displayName,type,labels.email_address)"
```

---

## Group 2: Application Identity

These variables define the identity of the application being deployed. They control how the application is named across GCP and Kubernetes resources, how it appears in the console and monitoring dashboards, and how deployments are versioned and tracked.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"gkeapp"` | `[a-z][a-z0-9-]{0,19}` (1–20 chars) | The internal identifier for the application. Used as the base name for the Kubernetes Deployment, Service, Namespace, Artifact Registry repository, Secret Manager secrets, Cloud SQL database, and GCS buckets. Must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens. **Do not change this after initial deployment** — it is embedded in resource names and changing it will cause all named resources to be recreated, leaving the originals orphaned. Choose a short, meaningful identifier such as `crm-app`, `payments-api`, or `customer-portal`. |
| `application_display_name` | `"App_GKE Application"` | Any string | A human-readable name shown in the platform UI and monitoring dashboards. Unlike `application_name`, this can be updated freely at any time without affecting resource names. Use a descriptive title that helps operators identify the workload at a glance, e.g. `Customer Portal`, `Payment Processing API`. |
| `application_description` | `"App_GKE Custom Application…"` | Any string | A brief description of the application's purpose. Populated into Kubernetes resource annotations and used in platform documentation. Update this to accurately describe your application — it is particularly useful for audit and governance purposes when multiple workloads exist in the same cluster or project. |
| `application_version` | `"1.0.0"` | Any string (e.g. `v1.2.3`, `latest`, `sha-8f2b1a`) | The version tag applied to the container image and used for deployment tracking. When `container_image_source` is `custom`, incrementing this value triggers a new Cloud Build run and creates a new tagged image in Artifact Registry, which is then rolled out to the GKE Deployment. When using `prebuilt`, this value is informational only. Using a versioning convention such as [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`) is strongly recommended to maintain a clear audit trail of what is running in the cluster. Avoid using `latest` in production as it makes it impossible to determine exactly which code is deployed and prevents reliable rollbacks. |

### Validating Group 2 Settings

**Google Cloud Console:**
- **Kubernetes Deployment name:** Navigate to **Kubernetes Engine → Workloads** and confirm a Deployment is listed with the expected name (derived from `application_name`).
- **Namespace:** Navigate to **Kubernetes Engine → Workloads**, filter by namespace, and confirm the namespace derived from `application_name` and `tenant_deployment_id` has been created.
- **Artifact Registry repository:** Navigate to **Artifact Registry → Repositories** to confirm a repository named after `application_name` has been created.
- **Image versions:** Within the Artifact Registry repository, select the repository to view all tagged image versions and confirm the expected `application_version` tag is present.

**gcloud CLI:**
```bash
# List Kubernetes Deployments in the application namespace
kubectl get deployments -n NAMESPACE \
  -o wide

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

These variables control how the application container is sourced, built, deployed, and scaled on GKE Autopilot. They are the core settings that determine the runtime behaviour of your application, including how the Horizontal Pod Autoscaler (HPA) manages replicas and how container resources are allocated by the Kubernetes scheduler.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `deploy_application` | `true` | `true` / `false` | When `true`, the Kubernetes Deployment (or StatefulSet) is created and the application container is scheduled onto the cluster. Set to `false` to provision all supporting infrastructure (VPC, Cloud SQL, GCS buckets, Filestore, secrets) without deploying the application workload. This is useful for **infrastructure-first workflows** where the database and storage need to be seeded or configured before the application starts, or for staged rollouts where infrastructure is validated independently first. |
| `container_image_source` | `"custom"` | `prebuilt` / `custom` | Determines how the container image is obtained. **`prebuilt`**: deploys an existing image directly from any accessible container registry (e.g. Docker Hub, Artifact Registry, GitHub Container Registry) using the URI in `container_image`. No build step is performed. Use this for vendor-supplied images or images built externally. **`custom`**: uses Cloud Build to build the image from source code in the connected GitHub repository using the configuration in `container_build_config`. The built image is pushed to Artifact Registry and then deployed to GKE. |
| `container_image` | `""` | Full container image URI | The fully qualified URI of the container image to deploy. Required when `container_image_source` is `prebuilt`, or when `enable_image_mirroring` is `true` (as the source image to mirror). Examples: `us-docker.pkg.dev/my-project/my-repo/app:v1.0`, `nginx:1.25`, `ghcr.io/my-org/my-app:latest`. When using a public registry image such as Docker Hub, enabling `enable_image_mirroring` is strongly recommended to avoid rate limiting and to ensure reproducibility. |
| `container_build_config` | `{ enabled = true }` | Object | Configuration passed to Cloud Build when `container_image_source` is `custom`. Key fields: **`enabled`** (`true`/`false`) — set to `false` to skip the build step entirely and deploy the last built image. **`dockerfile_path`** — relative path to the Dockerfile within the repository (default: `Dockerfile`). **`dockerfile_content`** — inline Dockerfile content as a string; takes precedence over `dockerfile_path` when set. **`context_path`** — build context directory (default: `.`). **`build_args`** — map of `ARG` values passed to the Docker build (e.g. `{ ENV = "prod" }`). **`artifact_repo_name`** — name of the Artifact Registry repository to push the built image to; leave blank to use the auto-created repository named after `application_name`. |
| `enable_image_mirroring` | `true` | `true` / `false` | When `true`, the image specified in `container_image` is copied into the project's Artifact Registry repository before deployment. **Strongly recommended when using external public images** (Docker Hub, GitHub Container Registry, etc.) for three reasons: (1) avoids registry pull rate limits at scale; (2) ensures the image remains available even if the upstream registry is unavailable; (3) gives you a verifiable, project-scoped copy for audit and compliance purposes. Has no effect when `container_image_source` is `custom`, as the image is already built into Artifact Registry. |
| `min_instance_count` | `1` | Integer `0`–`1000` | The minimum number of pod replicas the Horizontal Pod Autoscaler (HPA) will maintain at all times. Sets the `minReplicas` field of the HPA. Unlike Cloud Run, GKE Autopilot does not natively support true scale-to-zero for standard Deployments, so the effective minimum in most configurations is `1`. Setting this to `0` requires additional cluster configuration. **`1` or more** is recommended for production workloads to ensure at least one pod is always ready to serve traffic without a cold start. Increase this value if your application must handle burst traffic immediately without waiting for new pods to schedule and start. |
| `max_instance_count` | `3` | Integer `1`–`1000` | The maximum number of pod replicas the HPA is permitted to scale up to under load. Sets the `maxReplicas` field of the HPA. Acts as a cost ceiling and a safeguard against runaway scaling caused by traffic spikes or misbehaving applications. **Set this value based on your expected peak traffic and your downstream resource limits** — for example, a Cloud SQL instance has a maximum connection limit, so `max_instance_count` × connections-per-pod must not exceed it. In GKE Autopilot, each additional pod consumes node resources that are billed per-pod. |
| `enable_vertical_pod_autoscaling` | `false` | `true` / `false` | When `true`, enables the **Vertical Pod Autoscaler (VPA)** for the application Deployment. The VPA monitors actual CPU and memory consumption over time and automatically adjusts the pod's resource *requests* (not limits) to better match observed usage. This helps right-size pods for efficient bin-packing on nodes, reducing cost and improving scheduling. **Important trade-offs:** (1) The VPA may evict running pods to apply updated resource recommendations — set `min_instance_count` ≥ 2 to avoid downtime during evictions. (2) The VPA and HPA should not both target CPU-based scaling simultaneously, as this can cause conflicting scaling decisions. Use VPA alongside HPA when HPA is configured to scale on custom metrics (e.g. request throughput) rather than CPU. |
| `container_port` | `8080` | Integer `1`–`65535` | The TCP port that your application server listens on inside the container. The Kubernetes Service routes inbound traffic to this port on each pod. **This must match the port your application actually binds to** — a mismatch will cause all requests to fail with a connection refused error. Common values: `8080` (Java, Go, Node.js defaults), `3000` (Node.js/Express), `5000` (Flask/Python), `80` (nginx). |
| `container_protocol` | `"http1"` | `http1` / `h2c` | The application-layer protocol the Kubernetes Service uses to communicate with your container. **`http1`:** standard HTTP/1.1. Compatible with all web frameworks. Use this for REST APIs, web applications, and any service that does not specifically require HTTP/2. **`h2c`:** HTTP/2 cleartext (unencrypted). Required for **gRPC services**, as gRPC is built on HTTP/2. Also beneficial for services that send large payloads or use server streaming, as HTTP/2 supports multiplexing and header compression. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Object | CPU, memory, and ephemeral storage resource requests and limits for the application container. In Kubernetes, **requests** determine how the scheduler places pods onto nodes (guaranteed allocation), while **limits** cap maximum usage. Sub-fields: **`cpu_limit`** — maximum CPU in millicores (`1000m` = 1 vCPU). **`memory_limit`** — maximum memory (e.g. `512Mi`, `1Gi`, `2Gi`). **`cpu_request`** — minimum CPU guaranteed by the scheduler (defaults to `cpu_limit` if not set; consider setting lower to improve bin-packing). **`mem_request`** — minimum memory guaranteed (defaults to `memory_limit` if not set). **`ephemeral_storage_limit`** — maximum local disk the container may use for writable layers and emptyDir volumes (e.g. `1Gi`). **`ephemeral_storage_request`** — minimum ephemeral storage guaranteed (defaults to `ephemeral_storage_limit` if not set). **Sizing guidance:** start with `1000m` / `512Mi` and adjust based on observed utilisation in Cloud Monitoring. In GKE Autopilot, resource requests directly determine billing — you are charged for requested resources, not limits. Setting requests significantly below limits can result in OOMKill events if memory spikes; setting them equal provides predictable scheduling but may increase cost. |
| `timeout_seconds` | `300` | Integer `0`–`3600` | The maximum duration in seconds the Google Cloud Load Balancer will wait for the application to respond to a request before returning a timeout error to the client. **Increase** this value for long-running operations such as file processing, database migrations, report generation, or large data imports. **Keep low** for interactive APIs to surface slow responses early and free resources quickly. This value is applied as the `timeoutSec` field of the `GCPBackendPolicy` CRD (`networking.gke.io/v1`) attached to the application Service — the GKE Gateway API mechanism for configuring backend service timeout on the Google Cloud Load Balancer. The Kubernetes Service itself does not enforce a request timeout. |
| `enable_cloudsql_volume` | `true` | `true` / `false` | When `true`, a Cloud SQL Auth Proxy sidecar container is injected into the application pod. The proxy creates a secure Unix socket at the path defined by `cloudsql_volume_mount_path`, which the application uses instead of a direct TCP connection. This is the **recommended and most secure** way to connect to Cloud SQL from GKE — it uses Workload Identity for IAM authentication and encrypts the connection without exposing the database to the public internet. Set to `false` only if your application connects to Cloud SQL via a private IP address over TCP directly (e.g. through a VPC peering). |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Filesystem path | The path inside the application container where the Cloud SQL Auth Proxy Unix socket is mounted. Your application's database connection string must reference this path. For example, a PostgreSQL connection string would be `host=/cloudsql/PROJECT:REGION:INSTANCE`. Only relevant when `enable_cloudsql_volume` is `true`. Change this only if your application framework expects the socket at a specific non-default path. |
| `service_annotations` | `{}` | Map of `"annotation-key" = "value"` | Annotations applied to the Kubernetes Service resource. Used for advanced load balancer configuration not exposed as first-class variables — for example, controlling GCP load balancer behaviour via `cloud.google.com/` annotations or enabling GKE-specific features. Rarely needed for standard deployments. Incorrect annotations can prevent the Service from obtaining an external IP, so use only when specifically required and consult the [GKE Services documentation](https://cloud.google.com/kubernetes-engine/docs/how-to/exposing-apps). |
| `service_labels` | `{}` | Map of `"key" = "value"` | Labels applied specifically to the Kubernetes Service resource, in addition to `resource_labels` which apply to GCP-level resources. Use for operational grouping, cost attribution at the Kubernetes object level, or tagging policies that apply only to the Service. Example: `{ tier = "frontend", billing-code = "team-a" }`. These labels are visible in `kubectl get service -o yaml` and in the GKE console under the Service details. |

### Validating Group 3 Settings

**Google Cloud Console:**
- **Workload deployment & scaling:** Navigate to **Kubernetes Engine → Workloads** and confirm the Deployment is listed with the expected number of ready replicas. Click the workload to view the HPA configuration and current replica count.
- **Container image:** The workload details page shows the container image URI under the **Containers** tab.
- **Resource limits & requests:** Under **Kubernetes Engine → Workloads → *your workload* → Containers**, view the CPU and memory requests and limits configured for each container.
- **Horizontal Pod Autoscaler:** Navigate to **Kubernetes Engine → Workloads** and look for the HPA object associated with your Deployment, or run `kubectl get hpa -n NAMESPACE`.
- **Artifact Registry images:** Navigate to **Artifact Registry → Repositories → *application_name*** to view all available image tags.
- **Cloud SQL Auth Proxy sidecar:** On the workload details page, confirm a second container named `cloud-sql-proxy` is listed alongside the main application container when `enable_cloudsql_volume` is `true`.

**gcloud CLI / kubectl:**
```bash
# Describe the Deployment and view resource requests, limits, and image
kubectl describe deployment APPLICATION_NAME -n NAMESPACE

# View the HPA configuration and current scaling status
kubectl get hpa -n NAMESPACE
kubectl describe hpa APPLICATION_NAME -n NAMESPACE

# View all pods and their current status
kubectl get pods -n NAMESPACE -o wide

# View resource usage per pod (requires metrics-server)
kubectl top pods -n NAMESPACE

# List container images in Artifact Registry
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/APPLICATION_NAME \
  --include-tags \
  --format="table(image,tags,createTime)"

# View VPA recommendations (if enable_vertical_pod_autoscaling = true)
kubectl describe vpa APPLICATION_NAME -n NAMESPACE
```

---

## Group 4: Environment Variables & Secrets

> **PSE Certification relevance:** This group maps to PSE exam Section 3.1 (protecting sensitive data) and Section 1.4 (fine-grained IAM). The module grants `roles/secretmanager.secretAccessor` only on the specific secrets the workload requires — not at project level — demonstrating resource-level IAM as a least-privilege pattern. `enable_secrets_store_csi_driver` is the highest-assurance secret delivery mechanism: plaintext is never written to Kubernetes Secrets in etcd or to Terraform state, satisfying the most stringent PCI-DSS and HIPAA secret handling requirements. `secret_rotation_period` and `enable_auto_password_rotation` (Group 10) map to PSE Section 3.1's automated credential rotation objective.

These variables control how configuration and sensitive credentials are delivered to the running container. A key principle here is the separation of **plain-text configuration** (non-sensitive settings injected directly as environment variables) from **sensitive credentials** (injected securely via Secret Manager, never stored in plaintext). The module offers two mechanisms for secrets: environment-variable injection via `secret_environment_variables`, and file-based injection via the Secrets Store CSI Driver (`enable_secrets_store_csi_driver`).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `environment_variables` | `{}` | Map of `"VAR_NAME" = "value"` | Plain-text environment variables injected into every pod at startup. Use for non-sensitive configuration such as feature flags, log levels, API base URLs, or application mode settings. Examples: `{ LOG_LEVEL = "info", FEATURE_NEW_UI = "true", API_BASE_URL = "https://api.example.com" }`. **Do not store passwords, tokens, API keys, or any sensitive values here** — they will be visible in the Kubernetes Deployment manifest and in Terraform state. Use `secret_environment_variables` or `enable_secrets_store_csi_driver` for sensitive values instead. Changes to this map trigger a rolling update of the Deployment. |
| `secret_environment_variables` | `{}` | Map of `"VAR_NAME" = "secret-name"` | Sensitive values injected as environment variables sourced from Secret Manager. The map key is the environment variable name exposed to the container; the map value is the name of an existing Secret Manager secret in the same project. The module creates a Kubernetes Secret containing the plaintext value fetched at apply time, and injects it into the pod via `valueFrom.secretKeyRef`. **Note:** the plaintext value is stored in the Kubernetes Secret object (in etcd) and in Terraform state. For higher security requirements where secret values must not appear in state or etcd, use `enable_secrets_store_csi_driver` instead. Examples: `{ DB_PASSWORD = "app-db-password", STRIPE_KEY = "stripe-api-key" }`. The Workload Identity service account is granted `roles/secretmanager.secretAccessor` on each referenced secret automatically by this module. |
| `secret_rotation_period` | `"2592000s"` *(30 days)* | Duration string in seconds, e.g. `"2592000s"` | How frequently Secret Manager publishes a **rotation notification** event via Pub/Sub to prompt the application or a rotation handler to update the secret value. Common values: `"604800s"` (7 days), `"2592000s"` (30 days), `"7776000s"` (90 days). **Important:** this setting does not rotate the secret automatically — it only triggers a notification. The actual rotation logic (generating a new value and updating the secret) must be implemented separately, either via `enable_auto_password_rotation` (for the database password) or a custom Cloud Function. Applies to all secrets managed by this module. |
| `secret_propagation_delay` | `30` | Integer (seconds) | The number of seconds to wait after a secret is created or updated before proceeding with dependent operations (e.g. deploying a new revision of the Kubernetes Deployment). Secret Manager uses global replication and a brief delay ensures the new secret version has fully propagated to all regions before pods attempt to read it. **Increase this value** (e.g. to `60` or `90`) if you experience pod startup failures with errors indicating a secret version cannot be found, particularly in multi-region deployments. |
| `manage_storage_kms_iam` | `false` | `true` / `false` | Controls whether the module manages IAM permissions on the Cloud KMS key used to encrypt GCS storage buckets with Customer-Managed Encryption Keys (CMEK). When `true`, the module grants the GCS service account the `roles/cloudkms.cryptoKeyEncrypterDecrypter` role on the KMS key, enabling server-side encryption of bucket data with your own key. Set to `false` (default) if the KMS keyring and key have not yet been created, or if KMS IAM is managed separately. Attempting to manage KMS IAM before the key exists will cause a Terraform apply failure. |
| `enable_secrets_store_csi_driver` | `false` | `true` / `false` | When `true`, uses the **Secrets Store CSI Driver** to fetch secrets directly from Secret Manager at pod start time and expose them as mounted files or environment variables inside the container. This is the most secure method of secret delivery in GKE — secret plaintext values are never stored in Terraform state, never written to Kubernetes Secrets in etcd, and are fetched fresh from Secret Manager on each pod start. **Prerequisite:** the Secret Manager CSI add-on must be enabled on the GKE cluster before applying: `gcloud container clusters update CLUSTER --enable-secret-manager-config --region=REGION`. When `false` (default), secrets are delivered via `secret_environment_variables` using Kubernetes Secrets. Use this option for workloads with strict compliance requirements around secret handling (e.g. PCI-DSS, HIPAA). |

### Validating Group 4 Settings

**Google Cloud Console:**
- **Environment variables:** Navigate to **Kubernetes Engine → Workloads → *your workload***, click the pod, then select **Environment** to view plain-text variables. Secret-sourced variables are listed with a reference to the Kubernetes Secret rather than a plaintext value.
- **Kubernetes Secrets:** Navigate to **Kubernetes Engine → Config & Storage → Secrets** to view the secrets created by this module and confirm they are present in the correct namespace.
- **Secret Manager secrets:** Navigate to **Security → Secret Manager** to view all secrets, their versions, rotation schedules, and access policies.
- **Secret IAM access:** In Secret Manager, click a secret and select the **Permissions** tab to confirm the Workload Identity service account has `Secret Accessor` permissions.
- **Rotation schedule:** In Secret Manager, click a secret and view the **Overview** tab — the rotation period is shown under **Rotation**.
- **CSI Driver (if enabled):** Navigate to **Kubernetes Engine → Config & Storage** and look for `SecretProviderClass` objects in the application namespace.

**gcloud CLI / kubectl:**
```bash
# View environment variables configured on the Deployment
kubectl get deployment APPLICATION_NAME -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].env}' | jq .

# List Kubernetes Secrets in the application namespace
kubectl get secrets -n NAMESPACE

# List all Secret Manager secrets in the project
gcloud secrets list --project=PROJECT_ID \
  --format="table(name,createTime,replication.automatic)"

# View the rotation config for a specific secret
gcloud secrets describe SECRET_NAME \
  --project=PROJECT_ID \
  --format="yaml(rotation,labels)"

# Confirm the Workload Identity service account has Secret Accessor access
gcloud secrets get-iam-policy SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"

# List versions of a specific secret
gcloud secrets versions list SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# List SecretProviderClass objects (if enable_secrets_store_csi_driver = true)
kubectl get secretproviderclass -n NAMESPACE
```

---

## Group 5: GKE Backend Configuration

> **PSE Certification relevance:** This group contains two significant security controls. `enable_network_segmentation` maps to PSE exam Section 2.2 (boundary segmentation) — it creates Kubernetes NetworkPolicies enforced by GKE Dataplane V2 (eBPF/Cilium), implementing pod-level microsegmentation so that only permitted pod-to-pod flows are allowed. `configure_service_mesh` maps to PSE Section 2.1 (perimeter security) — enabling Istio sidecar injection delivers automatic mutual TLS (mTLS) for all east-west traffic within the cluster, providing cryptographic service identity verification without Certificate Authority Service configuration.

These variables configure how the application workload is hosted within the GKE cluster — which cluster it targets, how the Kubernetes namespace and workload type are set up, how the Service exposes the application, and what reliability and networking policies govern the pods. These settings have a direct impact on availability, traffic routing, and infrastructure topology.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `gke_cluster_name` | `""` | String (cluster name) | The name of an existing GKE cluster to deploy the application workload into. When set, the module targets this specific cluster directly. Leave empty to allow automatic cluster selection according to the strategy defined by `gke_cluster_selection_mode`. If the named cluster does not exist in the project and region, the Terraform apply will fail. |
| `gke_cluster_selection_mode` | `"primary"` | `explicit` / `round-robin` / `primary` | The strategy used to select the target GKE cluster when `gke_cluster_name` is not set. **`primary`** (default): targets the cluster tagged as the primary Services_GCP-managed cluster in the project — the simplest option for single-cluster deployments. **`explicit`**: requires `gke_cluster_name` to be set; fails if it is empty. Use this to guarantee a specific cluster is always targeted regardless of what other clusters exist in the project. **`round-robin`**: distributes successive deployments across all available Services_GCP-managed clusters in the project in rotation — useful for spreading workloads across multiple clusters for load distribution or isolation. |
| `namespace_name` | `""` *(auto-generated)* | String (Kubernetes namespace) | The Kubernetes namespace into which all workload resources (Deployment or StatefulSet, Service, ConfigMaps, Secrets, HPA, etc.) are deployed. Leave empty to have the module generate a namespace name automatically from `application_name` and `tenant_deployment_id`. Set an explicit value to deploy into a pre-existing namespace, for example when co-locating multiple application components. **Namespace names must be unique within a cluster** — deploying two instances of this module with the same namespace into the same cluster will cause resource conflicts unless the workload names are also distinct. |
| `workload_type` | `"Deployment"` | `Deployment` / `StatefulSet` | The Kubernetes workload controller used to manage the application pods. **`Deployment`** (recommended for most applications): manages stateless pods with rolling update and rollback capabilities. All pods are interchangeable and can be rescheduled onto any node. Use for web APIs, microservices, and any application that stores state externally (in Cloud SQL or GCS). **`StatefulSet`**: manages pods with stable, persistent identities and ordered startup/shutdown. Each pod has a unique hostname and a dedicated PersistentVolumeClaim. Use when the application itself requires stable network identity or per-pod storage — for example message brokers, databases running inside the cluster, or applications that rely on leader-election via hostname. **Do not change this after initial deployment** — switching workload type recreates all pods and their associated resources. |
| `service_type` | `"LoadBalancer"` | `ClusterIP` / `LoadBalancer` / `NodePort` | The Kubernetes Service type that controls how the application is exposed. **`LoadBalancer`** (default): provisions a Google Cloud external or internal load balancer with a dedicated IP address, accessible from outside the cluster. Use for public-facing web applications and APIs. **`ClusterIP`**: exposes the Service only within the cluster on a stable internal IP. Use for backend services or microservices that should only be called by other workloads in the same cluster, not directly from the internet. **`NodePort`**: exposes the Service on a static port on every cluster node's IP. Rarely used directly in production — typically serves as a building block for custom ingress configurations. For internet-facing workloads, `LoadBalancer` is the recommended choice; combine with `enable_iap` or `enable_cloud_armor` for access control and DDoS protection. |
| `session_affinity` | `"ClientIP"` | `None` / `ClientIP` | Controls whether the Kubernetes Service routes repeated requests from the same client to the same pod. **`ClientIP`** (default): enables session affinity based on the client's IP address. Requests from the same source IP are consistently routed to the same pod for the duration of the session timeout (default 3 hours). Use for applications that maintain in-memory session state, WebSocket connections, or any workload where routing consistency across requests is required. **`None`**: each request is load-balanced independently across all available pods using round-robin. Use for fully stateless applications where any pod can serve any request equally — this gives better load distribution and makes rolling updates faster since no session state is pinned to specific pods. |
| `enable_multi_cluster_service` | `false` | `true` / `false` | When `true`, enables GKE Multi-Cluster Services (MCS) for this workload. MCS exports the Kubernetes Service from this cluster so it can be discovered and consumed by workloads running in other GKE clusters in the same fleet, using a stable DNS name (`SERVICE.NAMESPACE.svc.clusterset.local`). This enables cross-cluster service discovery without exposing services via external load balancers. **Prerequisite:** the clusters must be registered to the same GKE fleet and the Multi-Cluster Services API must be enabled on the project. Only enable for architectures that explicitly require cross-cluster service communication. |
| `configure_service_mesh` | `false` | `true` / `false` | When `true`, configures the application namespace and workload for participation in a service mesh by enabling **Istio sidecar injection**. The Istio proxy sidecar (`istio-proxy`) is automatically injected alongside the application container in every pod. This enables mutual TLS (mTLS) between services, fine-grained traffic management (retries, circuit breaking, fault injection), and distributed tracing without any code changes to the application. **Prerequisite:** Cloud Service Mesh (Istio) must be installed and configured on the GKE cluster. Enabling sidecar injection on a cluster without a service mesh will prevent pods from starting. |
| `enable_network_segmentation` | `false` | `true` / `false` | When `true`, creates Kubernetes **NetworkPolicy** objects for the application namespace, restricting which pods can send traffic to the application and what egress traffic the application pods are permitted to initiate. This enforces the principle of least-privilege at the network layer — pods outside the allowed set cannot reach the application even if they are in the same cluster. **Prerequisite:** the GKE cluster must have network policy enforcement enabled (Calico or Dataplane V2). Without network policy enforcement on the cluster, NetworkPolicy objects are created but have no effect. Recommended for production workloads handling sensitive data. |
| `termination_grace_period_seconds` | `30` | Integer `0`–`3600` | The number of seconds Kubernetes waits after sending `SIGTERM` to a pod before forcibly killing it with `SIGKILL`. During this window, the application should finish processing in-flight requests, close database connections, and release any held resources cleanly. **Increase** this value for applications with long-running requests (e.g. batch processing, file uploads) to avoid abrupt termination mid-operation. **Decrease** with caution — setting this too low will cause in-flight requests to be dropped during rolling updates or node maintenance. The default of `30` seconds is appropriate for most web APIs. Ensure this value exceeds your `timeout_seconds` setting to avoid requests being terminated before they can time out gracefully. |
| `deployment_timeout` | `1200` | Integer (seconds) | The Terraform resource timeout (in seconds) applied to Kubernetes Deployment and StatefulSet apply operations. Terraform will wait up to this duration for the Deployment to reach its desired ready state before declaring the apply as failed. **Increase** this value for applications with slow startup times (e.g. those that run database migrations at startup, or large container images with slow pull times on first deploy). The default of `1200` seconds (20 minutes) accommodates most GKE Autopilot cold-start scenarios where new nodes may need to be provisioned. |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` | CIDR notation (e.g. `"10.x.x.x/24"`) | The IP CIDR range for the inline GKE subnet created when a Services_GCP VPC exists in the project but no GKE cluster is present. The module provisions a new subnet in this CIDR range within the existing VPC in order to create the GKE cluster. **This CIDR must not overlap with any other subnet in the VPC.** Each App_GKE deployment sharing the same VPC must use a distinct, non-overlapping CIDR. Consult your network administrator before changing this value. This variable has no effect when a GKE cluster already exists in the project, as the module will reuse the existing cluster. |

### Validating Group 5 Settings

**Google Cloud Console:**
- **Target cluster:** Navigate to **Kubernetes Engine → Clusters** to confirm the cluster selected by the module is as expected, and that it is in a `Running` state.
- **Namespace:** Navigate to **Kubernetes Engine → Workloads** and filter by namespace, or go to **Kubernetes Engine → Config & Storage → Namespaces** to confirm the namespace was created.
- **Workload type:** Navigate to **Kubernetes Engine → Workloads** — the `Type` column shows whether the workload is a `Deployment` or `StatefulSet`.
- **Service type & IP:** Navigate to **Kubernetes Engine → Services & Ingress** to confirm the Service was created, its type (`LoadBalancer`, `ClusterIP`, `NodePort`), and its assigned external or cluster IP address.
- **Network policies:** Navigate to **Kubernetes Engine → Config & Storage** and look for `NetworkPolicy` objects in the application namespace (if `enable_network_segmentation = true`).

**gcloud CLI / kubectl:**
```bash
# List GKE clusters in the project
gcloud container clusters list --project=PROJECT_ID \
  --format="table(name,location,status,currentMasterVersion)"

# Confirm the namespace exists and view its labels
kubectl get namespace NAMESPACE -o yaml

# Check the Deployment or StatefulSet status
kubectl rollout status deployment/APPLICATION_NAME -n NAMESPACE
kubectl rollout status statefulset/APPLICATION_NAME -n NAMESPACE

# Describe the Kubernetes Service and confirm type and IP
kubectl describe service APPLICATION_NAME -n NAMESPACE

# View NetworkPolicies in the namespace (if enable_network_segmentation = true)
kubectl get networkpolicies -n NAMESPACE

# View the subnet created for the GKE cluster
gcloud compute networks subnets list --project=PROJECT_ID \
  --format="table(name,region,ipCidrRange,network)"
```

---

## Group 6: Jobs & Scheduled Tasks

These variables define workloads that run alongside the main GKE Deployment but outside the request-response cycle. Initialization jobs run once at deployment time to bootstrap the application; cron jobs handle recurring background work on a schedule; additional services deploy supplementary GKE workloads that the main application depends on.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", … }]` | List of objects | Kubernetes Jobs executed **once during or after deployment** to initialise the application. The default includes a `db-init` job that runs database initialisation scripts using a `postgres:15-alpine` image. Each job runs sequentially in list order unless dependencies are specified via `depends_on_jobs`. Key sub-fields: **`name`** — unique identifier for the job (used as the Kubernetes Job name). **`description`** — human-readable label applied as an annotation. **`image`** — container image to use for the job; defaults to the application image if left blank. **`command`** / **`args`** — the entrypoint command and arguments to execute. **`script_path`** — path to a script file relative to the module's scripts directory; used instead of `command`/`args` when running bundled scripts. **`env_vars`** / **`secret_env_vars`** — job-specific plain-text and Secret Manager-backed environment variables (same format as Group 4). **`cpu_limit`** / **`memory_limit`** — Kubernetes resource limits for the job container (default: `1000m` / `512Mi`). **`timeout_seconds`** — maximum duration for the job before it is marked as failed (default: `600`). **`max_retries`** — number of retry attempts on failure (default: `1`). **`task_count`** — number of parallel pod completions required (default: `1`; increase for parallel workloads). **`mount_nfs`** — whether to mount the NFS/Filestore volume (requires `enable_nfs = true`). **`mount_gcs_volumes`** — list of GCS Fuse volume names to mount. **`depends_on_jobs`** — list of other job names that must complete successfully before this job runs. **`execute_on_apply`** — when `true`, the job is re-executed on every Terraform apply; when `false`, it runs only on first deployment. **`needs_db`** — when `true`, the job waits for the Cloud SQL instance to be ready and the database credentials to be available before starting; set to `false` for jobs that do not require database access. |
| `cron_jobs` | `[]` | List of objects | Recurring scheduled tasks deployed as Kubernetes **CronJobs**. Each entry creates a Kubernetes CronJob resource that the cluster's controller manager triggers automatically on the configured schedule. Key sub-fields: **`name`** — unique identifier for the CronJob. **`schedule`** — cron expression in UTC, e.g. `"0 2 * * *"` (daily at 02:00 UTC), `"*/15 * * * *"` (every 15 minutes), `"0 9 * * 1"` (every Monday at 09:00 UTC). **`image`** — container image; defaults to the application image if blank. **`command`** / **`args`** / **`script_path`** — as per `initialization_jobs`. **`env_vars`** — plain-text environment variables for this job. **`cpu_limit`** / **`memory_limit`** — resource limits (default: `500m` / `256Mi`). **`restart_policy`** — Kubernetes restart policy for job pods; `"OnFailure"` (default) retries the pod on the same node, `"Never"` creates a new pod on each failure. **`concurrency_policy`** — controls what happens when the previous job run is still active when the next schedule fires: `"Forbid"` (default) skips the new run if the previous is still running, `"Allow"` allows concurrent runs, `"Replace"` cancels the previous run and starts a new one. **`failed_jobs_history_limit`** — number of failed job records to retain for inspection (default: `1`). **`successful_jobs_history_limit`** — number of successful job records to retain (default: `3`). **`starting_deadline_seconds`** — maximum seconds past the scheduled time within which the job may still start; missed runs beyond this window are counted as failed. **`suspend`** — set to `true` to pause the CronJob without deleting it; useful during maintenance windows. **`mount_nfs`** / **`mount_gcs_volumes`** — storage volume mounts. |
| `additional_services` | `[]` | List of objects | Supplementary GKE Deployments deployed alongside the main application workload. Use this for **sidecar-architecture patterns** where a separate process handles a specific function — for example a dedicated background worker, an internal cache proxy, a queue consumer, or a management interface. Each additional service is a fully independent Kubernetes Deployment with its own HPA and Service. Key sub-fields: **`name`** — unique identifier appended to the application name. **`image`** — container image URI (required). **`port`** — the port the additional service listens on. **`command`** / **`args`** — entrypoint override. **`env_vars`** — plain-text environment variables for this service. **`cpu_limit`** / **`memory_limit`** — resource limits (default: `1000m` / `512Mi`). **`ephemeral_storage_limit`** / **`ephemeral_storage_request`** — local disk limits (optional). **`min_instance_count`** / **`max_instance_count`** — HPA scaling bounds (default: `0` / `1`). **`output_env_var_name`** — if set, the in-cluster DNS address of this additional service is automatically injected into the **main** application container as an environment variable with this name, allowing the main app to discover and call it without hardcoding service addresses. **`volume_mounts`** — list of volume mount objects referencing globally defined NFS or GCS volumes; each entry specifies a `name` (matching the volume name), `mount_path`, and optional `read_only` flag. **`startup_probe`** / **`liveness_probe`** — per-service health check configuration (same structure as the Group 9 probe objects). |

### Validating Group 6 Settings

**Google Cloud Console:**
- **Initialization jobs:** Navigate to **Kubernetes Engine → Workloads** and filter by `Job` type to view all Kubernetes Jobs, their completion status, and the number of succeeded pods.
- **Job logs:** Click a Job, then click the associated Pod to view its logs and confirm the initialisation script completed successfully.
- **CronJobs:** Navigate to **Kubernetes Engine → Workloads** and filter by `CronJob` type to view all CronJobs, their schedules, and the status of the most recent execution.
- **Additional services:** Navigate to **Kubernetes Engine → Workloads** — additional service Deployments appear alongside the main application Deployment. Navigate to **Kubernetes Engine → Services & Ingress** to confirm each additional service has a corresponding Kubernetes Service.

**kubectl:**
```bash
# List all Kubernetes Jobs in the namespace
kubectl get jobs -n NAMESPACE \
  -o wide

# View the status and logs of a specific initialization job
kubectl describe job JOB_NAME -n NAMESPACE
kubectl logs -l job-name=JOB_NAME -n NAMESPACE

# List all CronJobs in the namespace and their schedules
kubectl get cronjobs -n NAMESPACE

# Describe a CronJob to view its schedule and last run status
kubectl describe cronjob CRONJOB_NAME -n NAMESPACE

# List Job runs created by a CronJob
kubectl get jobs -n NAMESPACE \
  --selector=app=CRONJOB_NAME

# Suspend a CronJob temporarily
kubectl patch cronjob CRONJOB_NAME -n NAMESPACE \
  -p '{"spec":{"suspend":true}}'

# List Deployments for additional services
kubectl get deployments -n NAMESPACE -o wide

# Confirm environment variable injection from an additional service
kubectl exec -n NAMESPACE POD_NAME -- env | grep OUTPUT_ENV_VAR_NAME
```

---

## Group 7: CI/CD & GitHub Integration

> **PSE Certification relevance:** This group maps to PSE exam Section 4.1 (automating infrastructure and application security). `enable_cicd_trigger` demonstrates secure CI/CD: secrets are injected from Secret Manager into Cloud Build steps — never written to build logs. `enable_binary_authorization` implements supply chain integrity enforcement — the GKE admission controller rejects any image that was not cryptographically attested by the approved build pipeline, even if a developer attempts a direct `kubectl apply` with an unsigned image. `cloud_deploy_stages` with `require_approval = true` models the manual approval gates referenced in PSE Section 4.1 change management objectives.

These variables configure automated build and deployment pipelines. The module supports two pipeline models: a simple **Cloud Build** model where every qualifying code push builds a new image and rolls it out directly to the GKE Deployment, and a more advanced **Cloud Deploy** model that introduces a promotion-based pipeline with defined stages and optional manual approvals between them.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | `true` / `false` | Master switch for the CI/CD pipeline. When `true`, a Cloud Build trigger is created that monitors the connected GitHub repository and automatically builds a new container image and rolls it out to the GKE Deployment when code is pushed to the configured branch. Requires `github_repository_url` and at least one of `github_token` or `github_app_installation_id` to be set. When `false`, deployments must be triggered manually (e.g. by running a build from the Cloud Build console or by updating `application_version`). |
| `github_repository_url` | `""` | Full HTTPS URL | The HTTPS URL of the GitHub repository to connect to Cloud Build. Required when `enable_cicd_trigger` is `true`. Format: `https://github.com/ORG/REPO`. The repository must be accessible using the credentials provided in `github_token` or via the GitHub App specified in `github_app_installation_id`. |
| `github_token` | `""` | GitHub PAT string *(sensitive)* | A GitHub **Personal Access Token (PAT)** used to authorise the Cloud Build GitHub connection. Required on the **first deployment** when `enable_cicd_trigger` is `true` — GCP uses this token to establish the connection. Required scopes: `repo` (full repository access) and `admin:repo_hook` (to create webhooks). **After the initial connection is established**, the token is stored in Secret Manager and reused automatically — you do not need to re-supply it on subsequent deployments. For organisation repositories, prefer `github_app_installation_id` (GitHub App authentication) over a PAT for better auditability and key rotation. This value is treated as sensitive and is never stored in plaintext. |
| `github_app_installation_id` | `""` | Numeric string (e.g. `"12345678"`) | The installation ID of the **Cloud Build GitHub App**, used when authenticating via a GitHub App instead of a PAT. When provided alongside `github_token`, the connection uses GitHub App authentication (preferred for organisation-level repositories) with the PAT used only as the authoriser credential during the initial connection setup. The installation ID can be found in your GitHub organisation settings under **Installed GitHub Apps → Cloud Build → Configure**. GitHub App authentication is preferred over PATs for teams as it ties the connection to the app rather than an individual user account. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Object | Fine-grained configuration for the Cloud Build trigger. Sub-fields: **`branch_pattern`** — a regular expression matching the branch(es) that activate the build (default: `"^main$"` triggers only on pushes to `main`; use `"^(main\|develop)$"` for both). **`included_files`** — list of file path patterns; the build only fires if at least one matching file was changed (e.g. `["src/**", "Dockerfile"]`). Leave empty to trigger on any file change. **`ignored_files`** — list of file path patterns to exclude from triggering (e.g. `["**.md", "docs/**"]`). **`trigger_name`** — custom name for the Cloud Build trigger (auto-generated if blank). **`description`** — description shown in the Cloud Build console. **`substitutions`** — map of `_VARIABLE = "value"` pairs passed as substitution variables to the Cloud Build build steps (e.g. `{ _ENV = "prod", _REGION = "us-central1" }`). |
| `enable_cloud_deploy` | `false` | `true` / `false` | Switches the CI/CD pipeline from **direct Cloud Build rollouts to GKE** to a managed **Google Cloud Deploy** progressive delivery pipeline. When `true`, a Cloud Deploy delivery pipeline and targets are created based on `cloud_deploy_stages`. Releases are promoted through stages in order (e.g. dev → staging → prod), with optional manual approvals before promotion. Requires `enable_cicd_trigger` to also be `true` for automated pipeline execution. Use this for production environments where you need controlled, audited, multi-stage rollouts across multiple GKE clusters or namespaces, rather than direct-to-production deploys. |
| `cloud_deploy_stages` | `[dev, staging, prod]` | List of objects | Ordered list of promotion stages for the Cloud Deploy delivery pipeline. Each stage creates a Cloud Deploy target pointing to a GKE cluster and namespace for that environment. Stages are promoted in list order. Key sub-fields: **`name`** — stage identifier (e.g. `"dev"`, `"staging"`, `"prod"`); used to name the Cloud Deploy target and the Kubernetes namespace for that stage. **`target_name`** — override the Cloud Deploy target name (defaults to `PIPELINE-NAME`). **`namespace`** — Kubernetes namespace to deploy into for this stage (defaults to `SERVICE_NAME-STAGE`). **`cluster`** — GKE cluster name to target for this stage (defaults to the current deployment cluster, enabling cross-cluster promotion). **`project_id`** — deploy this stage to a different GCP project (defaults to the current project; useful for cross-project prod isolation). **`region`** — deploy this stage to a different region. **`require_approval`** — when `true`, a manual approval is required in the Cloud Deploy console before a release can be promoted to this stage. **Strongly recommended for `prod`**. **`auto_promote`** — when `true`, the release is automatically promoted to the next stage upon successful deployment, without manual intervention. |
| `enable_binary_authorization` | `false` | `true` / `false` | Enforces **Binary Authorization** on the GKE cluster, requiring all container images to carry a valid cryptographic attestation before they can be scheduled onto the cluster. This prevents unverified, unsigned, or tampered images from running. When `true`, an existing Binary Authorization policy and attestor must already be configured in the project — pod scheduling will fail if no policy exists or if the image lacks a valid attestation. Use in regulated environments (financial services, healthcare) where supply chain security and image provenance must be enforced. Validate that your CI/CD pipeline includes an attestation step (e.g. signing the image after a vulnerability scan passes) before enabling. |

### Validating Group 7 Settings

**Google Cloud Console:**
- **Cloud Build triggers:** Navigate to **Cloud Build → Triggers** to view the trigger, its connected repository, branch pattern, and last build status.
- **Build history:** Navigate to **Cloud Build → History** to view all past builds, their status, duration, and logs. Click a build to view the full step-by-step log including the `kubectl rollout` step.
- **GitHub connection:** Navigate to **Cloud Build → Repositories (2nd gen)** to confirm the GitHub connection is established and the repository is linked.
- **Cloud Deploy pipelines:** Navigate to **Cloud Deploy → Delivery Pipelines** to view the pipeline, its stages, current release, and promotion history.
- **Cloud Deploy approvals:** Pending approvals appear in the Cloud Deploy console under the relevant target — approvers receive an email notification.
- **Binary Authorization policy:** Navigate to **Security → Binary Authorization** to view the current enforcement policy and any active attestors.

**gcloud CLI / kubectl:**
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

# Confirm the GKE Deployment was updated by the latest build
kubectl rollout history deployment/APPLICATION_NAME -n NAMESPACE

# View the Binary Authorization policy
gcloud container binauthz policy export \
  --project=PROJECT_ID
```

---

## Group 8: Storage & Filesystem — NFS

These variables configure **Network File System (NFS)** shared storage for the application, backed by a Filestore instance or NFS GCE VM. NFS provides a POSIX-compliant shared filesystem that is simultaneously accessible by all pods, making it suitable for workloads that require shared persistent state across multiple container replicas — such as user-uploaded media files, shared caches, or application data that must survive pod restarts.

> **Note:** In GKE, NFS volumes are mounted via Kubernetes PersistentVolumes (PV) and PersistentVolumeClaims (PVC). All pods in the Deployment share the same PVC, giving every replica read/write access to the same underlying filesystem.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_nfs` | `true` | `true` / `false` | When `true`, an NFS PersistentVolume and PersistentVolumeClaim are created and mounted into the application pods at the path defined by `nfs_mount_path`. The module will use an existing NFS server if one is discovered in the project (either named via `nfs_instance_name` or auto-discovered from a `Services_GCP` deployment), or will create an inline NFS GCE VM if none is found. **NFS provides shared persistent storage** — files written by one pod replica are immediately visible to all other replicas. This is essential for applications that handle file uploads, shared configuration, or any data that must persist beyond the lifetime of individual pods. Set to `false` if your application is entirely stateless or uses GCS/Cloud SQL for all persistence. |
| `nfs_mount_path` | `"/mnt/nfs"` | Filesystem path | The path inside each container where the NFS volume is mounted. Your application reads and writes shared files to this directory. The path must not conflict with any directory used by the container image itself. Common choices: `/mnt/nfs`, `/data`, `/shared`, `/app/storage`. Only used when `enable_nfs` is `true`. Ensure your application is configured to read/write to this path — files written elsewhere in the container filesystem are ephemeral and lost when the pod restarts. |
| `nfs_instance_name` | `""` *(auto-discover)* | String | The name of a specific existing NFS server (GCE VM or Filestore instance) to connect to. When set, the module targets this instance directly and skips auto-discovery. Leave blank to allow the module to auto-discover a `Services_GCP`-managed NFS instance in the project, or to create a new inline NFS VM if none is found. Use this when you have multiple NFS servers in the project and need to explicitly control which one this deployment connects to, or when auto-discovery would select the wrong instance. |
| `nfs_instance_base_name` | `"app-nfs"` | String | The base name for a new inline NFS GCE VM created when no existing NFS server is found in the project. The deployment ID is appended automatically to ensure uniqueness (e.g. `app-nfs-prod`). Change this only if the default name conflicts with an existing resource or if your naming convention requires a different prefix. Only relevant when no existing NFS instance is discovered and the module needs to provision one. |

### Validating Group 8 Settings

**Google Cloud Console:**
- **NFS instance (Filestore):** If using Cloud Filestore, navigate to **Filestore → Instances** to confirm the instance exists, its tier, capacity, and IP address.
- **NFS instance (GCE VM):** If using an NFS GCE VM, navigate to **Compute Engine → VM Instances** and filter by the instance name to confirm it is running and reachable from the GKE node subnet.
- **PersistentVolume and PersistentVolumeClaim:** Navigate to **Kubernetes Engine → Config & Storage → Storage** to confirm the PV and PVC have been created in the application namespace and that the PVC is in `Bound` state.
- **Volume mount on pods:** Navigate to **Kubernetes Engine → Workloads → *your workload***, click a pod, and select the **Volumes** tab to confirm the NFS volume is mounted at the expected path.
- **NFS connectivity:** Check pod logs (**Kubernetes Engine → Workloads → *your workload* → Logs**) for any NFS mount errors at pod startup.

**gcloud CLI / kubectl:**
```bash
# List Filestore instances in the project
gcloud filestore instances list \
  --project=PROJECT_ID \
  --format="table(name,tier,networks[0].ipAddresses[0],fileShares[0].capacityGb,state)"

# List GCE VM instances (for inline NFS VMs)
gcloud compute instances list \
  --project=PROJECT_ID \
  --filter="name:nfs" \
  --format="table(name,zone,status,networkInterfaces[0].networkIP)"

# List PersistentVolumes in the cluster
kubectl get pv \
  -o wide

# List PersistentVolumeClaims in the application namespace
kubectl get pvc -n NAMESPACE

# Describe the PVC to confirm it is bound and check the NFS server IP
kubectl describe pvc -n NAMESPACE

# Check pod volume mounts and confirm the NFS path
kubectl describe pod POD_NAME -n NAMESPACE | grep -A5 "Volumes:"

# View pod logs for NFS mount errors at startup
kubectl logs POD_NAME -n NAMESPACE --previous 2>/dev/null || \
  kubectl logs POD_NAME -n NAMESPACE
```

---

## Group 9: Storage & Filesystem — GCS

These variables configure **Google Cloud Storage (GCS)** for the application. GCS provides two distinct integration patterns: standard **object storage** (buckets the application reads and writes via the GCS API or client libraries), and **GCS Fuse** mounts (buckets surfaced as a POSIX filesystem path directly inside the container via the GCS Fuse CSI Driver). See also `manage_storage_kms_iam` in Group 4 for customer-managed encryption key configuration.

> **Prerequisites:** GCS Fuse volume mounts (`gcs_volumes`) require the **GCS Fuse CSI Driver** add-on to be enabled on the GKE cluster. Enable it with: `gcloud container clusters update CLUSTER --update-addons GcsFuseCsiDriver=ENABLED --region=REGION`. Workload Identity must also be enabled and correctly configured so that pods have permission to access the target buckets.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `create_cloud_storage` | `true` | `true` / `false` | Master switch for GCS bucket provisioning. When `true`, all buckets defined in `storage_buckets` are created. Set to `false` when buckets are managed externally, already exist, or when this deployment should share buckets provisioned by another module (e.g. a shared `Services_GCP` deployment). When `false`, the `storage_buckets` variable is ignored but `gcs_volumes` can still reference externally managed buckets by name. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | List of objects | Defines the GCS buckets to provision for the application. Each bucket name is automatically prefixed with the project ID and application name for uniqueness. Only used when `create_cloud_storage` is `true`. Key sub-fields per bucket entry: **`name_suffix`** — the suffix appended to the auto-generated bucket name (e.g. `"data"` produces `PROJECT-APPLICATION-data`). **`location`** — GCS location for the bucket; can be a region (`"us-central1"`), dual-region (`"US-EAST1+US-WEST1"`), or multi-region (`"US"`, `"EU"`, `"ASIA"`). Multi-region provides higher availability but at higher cost. **`storage_class`** — `"STANDARD"` (default; for frequently accessed data), `"NEARLINE"` (accessed less than once per month), `"COLDLINE"` (accessed less than once per quarter), `"ARCHIVE"` (for long-term backup, rarely accessed). Choose based on access frequency to optimise cost. **`force_destroy`** — when `true`, the bucket and all its contents are deleted when the deployment is destroyed (default: `true`). **Set to `false` for buckets containing data that must be retained** beyond the lifecycle of the deployment. **`versioning_enabled`** — when `true`, GCS retains previous versions of objects on update or delete, enabling recovery from accidental overwrites. Recommended for buckets storing important application data. **`lifecycle_rules`** — list of object lifecycle rules (e.g. automatically delete objects older than 90 days, or transition to Coldline after 30 days). **`public_access_prevention`** — `"enforced"` (default; blocks all public access even if ACLs are set) or `"inherited"` (defers to the organisation policy). Leave as `"enforced"` unless the bucket explicitly needs to serve public content. **`uniform_bucket_level_access`** — when `true`, disables per-object ACLs and enforces IAM-only access control. Recommended for all new buckets as it simplifies access management and is required for some organisation policies. |
| `gcs_volumes` | `[]` | List of objects | GCS buckets to mount as **filesystem volumes** inside the application container using the **GCS Fuse CSI Driver**. This allows the application to read and write GCS objects using standard file I/O operations (open, read, write, ls) without using the GCS API directly — the CSI Driver handles the translation transparently. The module creates a Kubernetes PersistentVolume and PersistentVolumeClaim backed by the specified bucket for each entry. Key sub-fields: **`name`** — a logical name for the volume, used to reference the volume in `mount_gcs_volumes` in initialization and cron jobs. **`bucket_name`** — the name of an existing GCS bucket to mount; can reference a bucket created by `storage_buckets` or any bucket the Workload Identity service account can access. Leave blank to use the auto-named application bucket. **`mount_path`** — the filesystem path inside the container where the bucket appears (e.g. `/mnt/gcs`, `/app/uploads`). **`readonly`** — when `true`, the mount is read-only; the container cannot write to the bucket via this mount. Use for buckets that serve as read-only configuration or asset sources. **`mount_options`** — advanced GCS Fuse options (defaults: `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`). `implicit-dirs` allows listing of directories that exist only as object key prefixes. **Performance note:** GCS Fuse has higher latency than a native filesystem and is not suitable for workloads that require low-latency random reads/writes (e.g. databases). It is well suited for reading large files, writing log outputs, or serving static assets. |

### Validating Group 9 Settings

**Google Cloud Console:**
- **GCS buckets:** Navigate to **Cloud Storage → Buckets** to confirm buckets are created with the expected names, locations, and storage classes. Click a bucket to view its configuration including versioning, lifecycle rules, and access settings.
- **Public access prevention:** In the bucket details, the **Permissions** tab shows whether public access prevention is enforced.
- **GCS Fuse CSI Driver:** Navigate to **Kubernetes Engine → Clusters → *your cluster* → Details** and confirm the GCS Fuse CSI Driver add-on is listed as enabled under **Add-ons**.
- **PersistentVolumes for GCS:** Navigate to **Kubernetes Engine → Config & Storage → Storage** to confirm a PV and PVC have been created for each `gcs_volumes` entry and that the PVC is in `Bound` state.
- **Volume mount on pods:** Navigate to **Kubernetes Engine → Workloads → *your workload***, click a running pod, and select the **Volumes** tab to confirm GCS volumes are mounted at the expected paths.

**gcloud CLI / kubectl:**
```bash
# List all GCS buckets in the project
gcloud storage buckets list \
  --project=PROJECT_ID \
  --format="table(name,location,storageClass,iamConfiguration.publicAccessPrevention)"

# Describe a specific bucket (versioning, lifecycle, encryption)
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="yaml(versioning,lifecycle,encryption,iamConfiguration)"

# List objects in a bucket (validate application is writing correctly)
gcloud storage ls gs://BUCKET_NAME/ --recursive

# Confirm the GCS Fuse CSI Driver is enabled on the cluster
gcloud container clusters describe CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(addonsConfig.gcsFuseCsiDriverConfig)"

# List PersistentVolumeClaims for GCS volumes in the namespace
kubectl get pvc -n NAMESPACE

# Describe a GCS-backed PVC to confirm it is bound and view its source bucket
kubectl describe pvc PVC_NAME -n NAMESPACE

# Check IAM policy on a KMS key (if manage_storage_kms_iam = true)
gcloud kms keys get-iam-policy KEY_NAME \
  --keyring=KEYRING_NAME \
  --location=LOCATION \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

---

## Group 10: Database Configuration

These variables configure the Cloud SQL database backend for the application. The module supports PostgreSQL, MySQL, and SQL Server. It can provision a new Cloud SQL instance automatically, connect to an existing instance, or skip database provisioning entirely. Database credentials are generated securely and injected into the application pods via Secret Manager — the application receives `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` as environment variables. The Cloud SQL Auth Proxy sidecar (configured in Group 3 via `enable_cloudsql_volume`) handles the secure connection from the pod to the Cloud SQL instance using Workload Identity.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | See options below | The Cloud SQL database engine to provision. Use `"NONE"` to skip database provisioning entirely (for stateless applications or those using an external database). **Generic aliases** (`POSTGRES`, `MYSQL`) deploy the latest supported version managed by Cloud SQL. **Version-pinned values** deploy a specific engine version and are recommended for production environments where version consistency across deployments matters. Supported options: `NONE` — no database; `POSTGRES` / `POSTGRES_15` / `POSTGRES_14` / `POSTGRES_13` / `POSTGRES_12` / `POSTGRES_11` / `POSTGRES_10` / `POSTGRES_9_6`; `MYSQL` / `MYSQL_8_0` / `MYSQL_5_7` / `MYSQL_5_6`; `SQLSERVER_2019_ENTERPRISE` / `SQLSERVER_2019_STANDARD` / `SQLSERVER_2017_ENTERPRISE` / `SQLSERVER_2017_STANDARD`. **Note:** changing `database_type` after initial deployment will attempt to replace the Cloud SQL instance, resulting in data loss unless a backup is restored first. |
| `sql_instance_name` | `""` *(auto-discover)* | String | The name of a specific existing Cloud SQL instance to connect to. When set, the module uses this instance directly and skips auto-discovery and instance creation. Leave blank to allow the module to auto-discover a `Services_GCP`-managed instance in the project, or to create a new instance if none is found. Use this when you have multiple Cloud SQL instances in the project and need to explicitly target one, or when reusing a shared instance across multiple application deployments. The named instance must already exist and be of a compatible `database_type`. |
| `sql_instance_base_name` | `"app-sql"` | String | The base name for a new Cloud SQL instance created when no existing instance is found. The deployment ID is appended automatically to ensure uniqueness (e.g. `app-sql-prod`). Change this only if the default name conflicts with an existing resource or your naming convention requires a different prefix. Only relevant when `sql_instance_name` is blank and no existing instance is auto-discovered. |
| `application_database_name` | `"gkeappdb"` | `[a-z][a-z0-9_]{0,62}` (1–63 chars) | The name of the database created within the Cloud SQL instance. Injected into the application pods as the `DB_NAME` environment variable. Must start with a lowercase letter and contain only lowercase letters, numbers, and underscores. Choose a name that reflects the application and environment, e.g. `crm_prod`, `payments_staging`. Only used when `database_type` is not `NONE`. **Do not change after initial deployment** — renaming the database requires manual data migration. |
| `application_database_user` | `"gkeappuser"` | `[a-z][a-z0-9_]{0,31}` (1–32 chars) | The username of the database user created for the application. Injected into the application pods as the `DB_USER` environment variable. Must start with a lowercase letter and contain only lowercase letters, numbers, and underscores. Use a meaningful name such as `gke_svc` or `app_user`. The corresponding password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. Only used when `database_type` is not `NONE`. |
| `database_password_length` | `16` | Integer `8`–`64` | The length in characters of the randomly generated database user password. Longer passwords provide significantly more entropy and are harder to brute-force. **Recommended minimum for production: `32`**. The password is generated once on first deployment and stored in Secret Manager. Changing this value on a subsequent deployment generates a new password only if rotation is triggered — it does not retroactively change the existing password. |
| `enable_postgres_extensions` | `false` | `true` / `false` | When `true`, the PostgreSQL extensions listed in `postgres_extensions` are installed in the application database after provisioning. Only applies when `database_type` is a PostgreSQL variant. Extensions are installed via a Kubernetes Job executed during deployment. Set to `false` if no extensions are required, or if extensions are managed by the application itself at startup. |
| `postgres_extensions` | `[]` | List of extension name strings | The PostgreSQL extensions to install in the application database. Only used when `enable_postgres_extensions` is `true`. Common extensions: `postgis` (geospatial data), `uuid-ossp` (UUID generation), `pg_trgm` (trigram text search), `pgcrypto` (cryptographic functions), `hstore` (key-value storage), `pg_stat_statements` (query performance tracking). Ensure the extension is supported by the Cloud SQL PostgreSQL version in use — not all extensions available in self-hosted PostgreSQL are available in Cloud SQL. |
| `enable_mysql_plugins` | `false` | `true` / `false` | When `true`, the MySQL plugins listed in `mysql_plugins` are installed in the application database after provisioning. Only applies when `database_type` is a MySQL variant. Functions similarly to `enable_postgres_extensions` for MySQL environments. |
| `mysql_plugins` | `[]` | List of plugin name strings | The MySQL plugins to install in the application database. Only used when `enable_mysql_plugins` is `true`. Common plugins: `audit_log` (audit logging for compliance), `validate_password` (password strength enforcement). Verify plugin availability for your specific MySQL version in Cloud SQL before enabling. |
| `enable_auto_password_rotation` | `false` | `true` / `false` | When `true`, deploys an automated password rotation mechanism consisting of a Kubernetes rotation Job and a Secret Manager rotation notification trigger. The rotation job generates a new database password, updates both the Cloud SQL user and the Secret Manager secret, then triggers a rolling restart of the application Deployment so pods pick up the new credentials. The rotation frequency is governed by `secret_rotation_period` (Group 4). **Recommended for production environments** to limit the blast radius of a leaked database credential. Only applies when `database_type` is not `NONE`. |

### Validating Group 10 Settings

**Google Cloud Console:**
- **Cloud SQL instance:** Navigate to **SQL** to confirm the instance exists, its database engine, version, region, and connection name.
- **Databases & users:** Click the instance, then select the **Databases** and **Users** tabs to confirm the application database and user have been created.
- **Database credentials in Secret Manager:** Navigate to **Security → Secret Manager** and filter by the application name to find the `DB_PASSWORD` secret. View its versions and rotation schedule.
- **DB environment variables on pods:** Navigate to **Kubernetes Engine → Workloads → *your workload***, click a pod, and select **Environment** to confirm `DB_HOST`, `DB_NAME`, and `DB_USER` appear as plain-text variables and `DB_PASSWORD` is sourced from a Kubernetes Secret.
- **Cloud SQL Auth Proxy sidecar:** On the workload details page under the **Containers** tab, confirm the `cloud-sql-proxy` container is present alongside the application container.

**gcloud CLI / kubectl:**
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

# Confirm DB environment variables are available in a running pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^DB_"

# Check the Cloud SQL Auth Proxy sidecar logs for connection errors
kubectl logs -n NAMESPACE POD_NAME -c cloud-sql-proxy
```

---

## Group 11: Backup Schedule & Retention

These variables configure automated database backup scheduling for the application. The module provisions a Kubernetes CronJob to perform database dumps on a defined schedule and writes the output to a GCS bucket, with a lifecycle rule applied to enforce the configured retention period.

> **Note:** Backup operations apply only when `database_type` is not `NONE`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Unix cron expression (UTC) | The cron schedule that controls when the automated database backup Kubernetes CronJob runs. All times are in **UTC**. The backup job performs a database dump and writes the output to the module's GCS backup bucket. Common schedule examples: `"0 2 * * *"` — daily at 02:00 UTC; `"0 */6 * * *"` — every 6 hours; `"0 2 * * 0"` — weekly on Sunday at 02:00 UTC; `"0 2 1 * *"` — monthly on the 1st at 02:00 UTC. **Choose a schedule that matches your Recovery Point Objective (RPO)** — a daily backup means you could lose up to 24 hours of data in the worst case. For critical production databases, consider an hourly or 6-hourly schedule. Schedule the backup during low-traffic periods to minimise performance impact on the database. |
| `backup_retention_days` | `7` | Positive integer | The number of days backup files are retained in the GCS backup bucket before being automatically deleted by a lifecycle rule. Setting a longer retention period increases storage costs but provides a longer window for recovery. **Guidance by environment:** development — `7` days is typically sufficient; staging — `14`–`30` days; production — `30`–`90` days or longer depending on compliance requirements. Some regulatory frameworks (e.g. PCI-DSS, HIPAA) mandate minimum backup retention periods — verify your requirements before reducing this value. |

### Validating Group 11 Settings

**Google Cloud Console:**
- **Backup CronJob:** Navigate to **Kubernetes Engine → Workloads** and filter by `CronJob` type. Confirm the backup CronJob is listed with the expected schedule. Click the CronJob to view the most recent Job runs and their status.
- **Backup files in GCS:** Navigate to **Cloud Storage → Buckets** and look for the backup bucket (named after the application with a `-backup` suffix). Confirm backup files are being written and that lifecycle rules are applied to enforce `backup_retention_days`.

**gcloud CLI / kubectl:**
```bash
# List CronJobs in the namespace (confirm backup CronJob exists)
kubectl get cronjobs -n NAMESPACE \
  -o wide

# View the most recent backup Job runs created by the CronJob
kubectl get jobs -n NAMESPACE \
  --selector=app=BACKUP_CRONJOB_NAME

# View backup job pod logs to confirm a successful dump
kubectl logs -n NAMESPACE \
  -l job-name=BACKUP_JOB_NAME

# List backup files in the GCS backup bucket
gcloud storage ls gs://BACKUP_BUCKET_NAME/ \
  --recursive

# View the lifecycle rules on the backup bucket (confirm retention policy)
gcloud storage buckets describe gs://BACKUP_BUCKET_NAME \
  --format="yaml(lifecycle)"

# Manually trigger the backup CronJob immediately (for testing)
kubectl create job --from=cronjob/BACKUP_CRONJOB_NAME \
  manual-backup-$(date +%s) -n NAMESPACE
```

---

## Group 12: Custom SQL Scripts

These variables enable the execution of custom SQL scripts against the application database during deployment. This provides a flexible mechanism for applying schema changes, installing stored procedures, creating roles, or loading seed data that cannot be handled by the application's own migration framework. Scripts are retrieved from a GCS bucket and executed in lexicographic (alphabetical) order, making it straightforward to version and sequence migrations.

> **Note:** Custom SQL script operations apply only when `database_type` is not `NONE`. The Workload Identity service account must have read access to the GCS bucket containing the scripts.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | `true` / `false` | When `true`, the module retrieves SQL script files from the GCS bucket and path specified by `custom_sql_scripts_bucket` and `custom_sql_scripts_path`, then executes them against the application database in lexicographic order. Scripts run as part of the deployment process via a Kubernetes Job. This is intended for **schema migrations, stored procedure installation, role creation, or seed data loading** that needs to happen at the infrastructure level rather than within the application. Set to `false` if your application manages its own schema migrations at startup (e.g. via Flyway, Liquibase, Django migrations, or Alembic). **Important:** design scripts to be idempotent (safe to run multiple times) to avoid errors if they are re-executed on subsequent deployments. |
| `custom_sql_scripts_bucket` | `""` | GCS bucket name | The name of the GCS bucket containing the SQL script files to execute. The bucket must exist before deployment and the Workload Identity service account must have at minimum `roles/storage.objectViewer` on this bucket. This can be the module's own provisioned application bucket or a dedicated scripts bucket shared across multiple deployments. Required when `enable_custom_sql_scripts` is `true`. |
| `custom_sql_scripts_path` | `""` | GCS path prefix string | The path prefix within the GCS bucket from which SQL scripts are retrieved. All `.sql` files found under this prefix are executed in **lexicographic (alphabetical) order**. Use a naming convention such as `001_create_tables.sql`, `002_add_indexes.sql`, `003_seed_data.sql` to control execution order precisely. Examples: `"init/"` — runs all `.sql` files in the `init/` folder; `"migrations/v2/"` — runs all `.sql` files in a versioned subfolder. Required when `enable_custom_sql_scripts` is `true`. Ensure no unwanted `.sql` files exist under the prefix, as all matching files will be executed. |
| `custom_sql_scripts_use_root` | `false` | `true` / `false` | Controls which database user executes the custom SQL scripts. **`false` (default):** scripts run as the application database user (`application_database_user`), which has permissions scoped to the application database only. This is the **recommended setting** for most scripts. **`true`:** scripts run as the root (superuser) database account. Enable only when scripts require elevated privileges not available to the application user — for example, creating PostgreSQL extensions (`CREATE EXTENSION`), creating additional roles (`CREATE ROLE`), or modifying database-level configuration. **Use with caution:** running arbitrary SQL as root carries a higher risk of accidental or destructive changes to the database instance. |

### Validating Group 12 Settings

**Google Cloud Console:**
- **Custom SQL script job:** Navigate to **Kubernetes Engine → Workloads** and filter by `Job` type. Look for the SQL scripts Job (named after the application). Click the Job and view its associated Pod logs to confirm scripts ran successfully.
- **Script files in GCS:** Navigate to **Cloud Storage → Buckets → *scripts bucket*** and confirm the expected `.sql` files exist at the configured path prefix.
- **IAM access on the scripts bucket:** In the bucket details, select the **Permissions** tab and confirm the Workload Identity service account has at minimum `Storage Object Viewer` access.

**gcloud CLI / kubectl:**
```bash
# List custom SQL script Jobs in the namespace
kubectl get jobs -n NAMESPACE \
  --selector=app=SQL_SCRIPTS_JOB_NAME

# View custom SQL script job logs to confirm scripts executed successfully
kubectl logs -n NAMESPACE \
  -l job-name=SQL_SCRIPTS_JOB_NAME

# Confirm the Workload Identity service account has read access to the scripts bucket
gcloud storage buckets get-iam-policy gs://SCRIPTS_BUCKET_NAME \
  --format="table(bindings.role,bindings.members)"
```

---

## Group 13: Observability & Health

These variables configure how GKE monitors the health of individual pods and how Cloud Monitoring observes the application from the outside. Properly configured probes prevent unhealthy pods from receiving traffic and trigger automatic restarts when an application becomes unresponsive; uptime checks and alert policies surface failures to your team before users notice them.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | Object | Configures the **startup probe**, which Kubernetes uses to determine when a newly started pod is ready to receive traffic. The pod is held out of the Service's load-balancing pool until this probe succeeds — no requests are routed to it in the meantime. Sub-fields: **`enabled`** (`true`/`false`) — disable only for containers that start instantaneously and have no initialisation phase. **`type`** — `HTTP` (default; sends an HTTP GET to `path`) or `TCP` (checks that the port accepts connections, used when there is no HTTP endpoint). **`path`** — the HTTP path to check, e.g. `/healthz`, `/ready`, `/status`. **`initial_delay_seconds`** — seconds to wait after the container starts before the first probe attempt (default: `10`). **`timeout_seconds`** — seconds to wait for the probe response before marking it as failed (default: `5`). **`period_seconds`** — interval between probe attempts (default: `10`). **`failure_threshold`** — number of consecutive failures before the pod is considered failed and restarted (default: `3`). For slow-starting applications (e.g. those that run database migrations on startup), increase `failure_threshold` or `period_seconds` to give the container sufficient startup time without being prematurely killed. The startup probe runs only during pod initialisation; once it succeeds, the liveness probe takes over. |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | Object | Configures the **liveness probe**, which Kubernetes uses to periodically verify that a running pod is still healthy. If the probe fails `failure_threshold` consecutive times, Kubernetes restarts the container automatically. Sub-fields mirror those of `startup_probe_config`: **`enabled`**, **`type`** (`HTTP` / `TCP`), **`path`**, **`initial_delay_seconds`** (default: `15`), **`timeout_seconds`** (default: `5`), **`period_seconds`** (default: `30`), **`failure_threshold`** (default: `3`). **Important:** the health check endpoint must respond quickly and must not perform expensive operations (database queries, external API calls) — a slow or overloaded health endpoint can trigger false-positive restarts, causing a restart loop under high load. The endpoint should return `HTTP 200` when the application is healthy and a non-2xx code when it is not. |
| `uptime_check_config` | `{ enabled = true, path = "/" }` | Object | Configures a **Google Cloud Monitoring uptime check** that sends periodic HTTP requests to the application's external load balancer IP from multiple global locations (typically 6 Google points of presence worldwide). If the application becomes unreachable from a majority of locations, an alert is triggered and sent to `support_users`. Sub-fields: **`enabled`** (`true`/`false`). **`path`** — the HTTP path to probe from the outside, e.g. `/healthz` or `/`. **`check_interval`** — how frequently to probe, in seconds with an `s` suffix (default: `"60s"`; minimum `"60s"`). **`timeout`** — maximum response time before the check is marked as failed (default: `"10s"`; must be less than `check_interval`). Unlike the startup and liveness probes — which are internal pod-level checks — the uptime check validates end-to-end reachability from the public internet, covering the load balancer, Kubernetes Service, and Cloud Armor rules where applicable. Only meaningful when `service_type` is `LoadBalancer` or a custom domain with an external IP is configured. |
| `alert_policies` | `[]` | List of objects | A list of Cloud Monitoring alert policies that trigger email notifications to `support_users` when application metrics exceed defined thresholds. Leave empty to deploy no custom alert policies. Each policy object requires: **`name`** — a descriptive label for the policy (e.g. `"high-cpu"`, `"oom-kills"`). **`metric_type`** — the Cloud Monitoring metric to monitor (see common values below). **`comparison`** — `COMPARISON_GT` (greater than) or `COMPARISON_LT` (less than). **`threshold_value`** — the numeric threshold that triggers the alert. **`duration_seconds`** — how long the condition must be sustained before the alert fires (use `0` to alert immediately). **`aggregation_period`** — the time window for metric aggregation (default: `"60s"`). Common `metric_type` values for GKE: `kubernetes.io/container/cpu/request_utilization` (CPU usage as a fraction of requested CPU, 0–1), `kubernetes.io/container/memory/used_bytes` (container memory usage in bytes), `kubernetes.io/container/restart_count` (number of container restarts — a rising value indicates a crash loop), `kubernetes.io/pod/volume/used_bytes` (volume storage utilisation), `kubernetes.io/node/cpu/allocatable_utilization` (node-level CPU utilisation, 0–1), `kubernetes.io/node/memory/allocatable_utilization` (node-level memory utilisation, 0–1). |

### Validating Group 13 Settings

**Google Cloud Console:**
- **Startup & liveness probes:** Navigate to **Kubernetes Engine → Workloads → *your workload***, select the Deployment, and click **Yaml** to view the probe configuration in the Pod spec. Alternatively, click a Pod and select the **Events** tab to see probe failure events if health checks are failing.
- **Pod readiness:** Navigate to **Kubernetes Engine → Workloads** — a green tick indicates all pods are passing their probes and are in the Ready state. A yellow warning indicates one or more pods are failing probes.
- **Uptime checks:** Navigate to **Monitoring → Uptime checks** to view active checks, their current status (passing/failing), and the last check results from each global location.
- **Alert policies:** Navigate to **Monitoring → Alerting** to view all configured alert policies, their current state (firing/OK), and notification channels.
- **Incidents:** Navigate to **Monitoring → Alerting → Incidents** to view historical alert firings and their resolution times.

**gcloud CLI / kubectl:**
```bash
# View probe configuration on the Deployment's pod spec
kubectl get deployment APPLICATION_NAME -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' | jq .
kubectl get deployment APPLICATION_NAME -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].startupProbe}' | jq .

# View pod readiness and restart counts (rising restarts indicate probe failures)
kubectl get pods -n NAMESPACE \
  -o wide

# Describe a specific pod to view probe failure events
kubectl describe pod POD_NAME -n NAMESPACE

# View recent container restart events across the namespace
kubectl get events -n NAMESPACE \
  --field-selector reason=BackOff \
  --sort-by='.lastTimestamp'

# List all uptime checks in the project
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout,selectedRegions)"

# List all alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].conditionThreshold.filter)"
```

---

## Group 14: Reliability Policies

These variables configure Kubernetes reliability mechanisms that protect application availability during voluntary disruptions and control how pods are distributed across the cluster topology. Together they ensure that rolling updates, node drains, and cluster upgrades do not cause unplanned downtime, and that pod replicas are spread across nodes and zones to eliminate single points of failure.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_pod_disruption_budget` | `true` | `true` / `false` | When `true`, creates a Kubernetes **PodDisruptionBudget (PDB)** for the application Deployment. A PDB is a policy object that limits how many pods may be voluntarily taken offline simultaneously during disruptions such as node drains, cluster version upgrades, or node pool migrations. Without a PDB, Kubernetes may evict all pods of a Deployment at once during a node drain, causing a complete service outage. With a PDB in place, Kubernetes will only proceed with a disruption if the minimum availability threshold defined by `pdb_min_available` is met. **Strongly recommended for production workloads.** Set to `false` only for development or single-replica deployments where disruption tolerance is not a concern. |
| `pdb_min_available` | `"1"` | Integer string or percentage string | The minimum number or percentage of pod replicas that must remain available during a voluntary disruption before Kubernetes is permitted to evict further pods. Expressed as either an **integer** (e.g. `"1"` — at least one pod must always be running) or a **percentage** (e.g. `"50%"` — at least 50% of the desired replica count must remain available). Only used when `enable_pod_disruption_budget` is `true`. **Sizing guidance:** for a Deployment with `min_instance_count = 2`, setting `pdb_min_available = "1"` ensures one pod is always serving traffic while the other is being updated or evicted. For higher-traffic workloads, consider a percentage such as `"75%"` to maintain throughput during disruptions. Setting `pdb_min_available` equal to `max_instance_count` will prevent all voluntary disruptions — avoid this as it will block node upgrades indefinitely. |
| `enable_topology_spread` | `false` | `true` / `false` | When `true`, adds **TopologySpreadConstraints** to the pod spec, instructing the Kubernetes scheduler to distribute pod replicas evenly across topology domains — by default across nodes and availability zones. This eliminates single-zone or single-node failure as a cause of complete service outage. For example, with three replicas and topology spreading enabled across three zones, one replica runs in each zone: a single zone failure takes down only one third of capacity. Without topology spreading, the scheduler may place all replicas on the same node or in the same zone, which provides no redundancy against zone-level failures. **Recommended for production workloads with `max_instance_count` ≥ 2** deployed in multi-zone clusters. Has no meaningful effect on single-node or single-zone clusters. |
| `topology_spread_strict` | `false` | `true` / `false` | Controls the scheduling action taken when the topology spread constraint defined by `enable_topology_spread` cannot be fully satisfied — for example when there are fewer available zones than pod replicas, or when one zone has no schedulable nodes. **`false` (default — `ScheduleAnyway`):** the scheduler still places the pod even if doing so violates the spread constraint, choosing the topology domain that minimises the imbalance. This ensures pods are always scheduled and the application remains available, at the cost of potentially uneven distribution. **`true` (`DoNotSchedule`):** the pod is held in `Pending` state and not scheduled until a topology domain becomes available that satisfies the constraint. This guarantees strict enforcement of spread rules but risks pods remaining unscheduled indefinitely if the cluster has insufficient capacity in all required zones. Use `true` only when even distribution is a hard requirement and you have guaranteed multi-zone node capacity. |

### Validating Group 14 Settings

**Google Cloud Console:**
- **PodDisruptionBudget:** Navigate to **Kubernetes Engine → Config & Storage** and look for a `PodDisruptionBudget` object in the application namespace, or use `kubectl` to describe it.
- **Pod distribution across zones:** Navigate to **Kubernetes Engine → Workloads → *your workload*** and click individual pods to view which node and zone each is scheduled on. An even distribution across zones confirms topology spreading is working.
- **Pending pods (strict topology spread):** If `topology_spread_strict = true` and pods are stuck in `Pending`, navigate to the pod details and view the **Events** tab for scheduling failure reasons.

**kubectl:**
```bash
# Confirm the PodDisruptionBudget exists and view its current status
kubectl get pdb -n NAMESPACE
kubectl describe pdb APPLICATION_NAME -n NAMESPACE

# View the topology spread constraints on the Deployment pod spec
kubectl get deployment APPLICATION_NAME -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.topologySpreadConstraints}' | jq .

# View which node and zone each pod is running on
kubectl get pods -n NAMESPACE \
  -o wide \
  --label-columns=topology.kubernetes.io/zone

# Check for pending pods and view scheduling failure events
kubectl get pods -n NAMESPACE --field-selector=status.phase=Pending
kubectl describe pod PENDING_POD_NAME -n NAMESPACE

# Simulate a node drain to verify the PDB protects availability (dry run)
kubectl drain NODE_NAME \
  --ignore-daemonsets \
  --delete-emptydir-data \
  --dry-run=client
```

---

## Group 15: Resource Quota

These variables configure a Kubernetes **ResourceQuota** for the application namespace, setting hard upper bounds on the total aggregate resource consumption across all pods, services, and volumes within it. ResourceQuotas are the primary mechanism for enforcing multi-tenancy guardrails in shared clusters — they prevent any single namespace from monopolising cluster capacity and provide predictable cost ceilings per application or team.

> **Note:** All quota threshold variables default to `""` (empty), meaning no limit is applied for that resource type even when `enable_resource_quota` is `true`. You can selectively enforce quotas on only the dimensions you care about — for example, setting `quota_cpu_limits` without setting `quota_memory_limits`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_resource_quota` | `false` | `true` / `false` | Master switch for namespace ResourceQuota enforcement. When `true`, a Kubernetes `ResourceQuota` object is created in the application namespace with limits derived from the remaining quota variables. When `false`, no quota is applied and workloads in the namespace may consume cluster resources without bound. **Enable in production multi-tenant clusters** where multiple application namespaces share the same cluster nodes, to ensure one misbehaving or scaling runaway application cannot starve others of resources. Leave disabled for dedicated single-application clusters or development environments where resource ceilings are not required. |
| `quota_cpu_requests` | `""` *(no limit)* | Kubernetes CPU quantity string (e.g. `"4"`, `"4000m"`) | The maximum total CPU **requests** permitted across all pods in the namespace. CPU requests determine how the Kubernetes scheduler allocates pods to nodes — the scheduler will not place a pod if doing so would cause the namespace's aggregate requests to exceed this quota. Examples: `"4"` (4 cores), `"4000m"` (4000 millicores, equivalent to 4 cores). **Size this based on your expected steady-state pod count × per-pod `cpu_request`.** For example, with `max_instance_count = 5` and `cpu_request = "500m"`, set `quota_cpu_requests` to at least `"2500m"`. Leave empty to apply no limit on CPU requests. |
| `quota_cpu_limits` | `""` *(no limit)* | Kubernetes CPU quantity string (e.g. `"8"`, `"8000m"`) | The maximum total CPU **limits** permitted across all pods in the namespace. CPU limits cap the maximum CPU each pod can burst to — the aggregate of all pod limits must not exceed this quota. Typically set higher than `quota_cpu_requests` to allow bursting. If a new pod would cause the namespace's aggregate CPU limits to exceed this quota, the pod will fail to schedule. Leave empty to apply no limit on CPU limits. |
| `quota_memory_requests` | `""` *(no limit)* | Kubernetes memory quantity string (e.g. `"4Gi"`, `"8192Mi"`) | The maximum total memory **requests** permitted across all pods in the namespace. Memory requests are the guaranteed allocation used by the scheduler for pod placement. **Size this based on your expected pod count × per-pod `mem_request`.** For example, with `max_instance_count = 5` and `mem_request = "512Mi"`, set `quota_memory_requests` to at least `"2560Mi"`. Leave empty to apply no limit on memory requests. |
| `quota_memory_limits` | `""` *(no limit)* | Kubernetes memory quantity string (e.g. `"8Gi"`, `"16384Mi"`) | The maximum total memory **limits** permitted across all pods in the namespace. Memory limits cap the maximum memory each pod can consume before being OOMKilled. The aggregate of all pod memory limits must not exceed this quota. Typically set higher than `quota_memory_requests` to accommodate memory spikes. Leave empty to apply no limit on memory limits. |
| `quota_max_pods` | `""` *(no limit)* | Integer string (e.g. `"20"`) | The maximum number of pods (in any state) permitted in the namespace at any time. This includes application pods, initialisation job pods, and cron job pods. Set this to a value that exceeds your `max_instance_count` plus the maximum number of concurrent job pods to avoid quota-induced scheduling failures during deployments or backup runs. Leave empty to apply no pod count limit. |
| `quota_max_services` | `""` *(no limit)* | Integer string (e.g. `"10"`) | The maximum number of Kubernetes Service objects permitted in the namespace. Each application, additional service, and any manually created services count toward this total. Leave empty to apply no limit on Service objects. |
| `quota_max_pvcs` | `""` *(no limit)* | Integer string (e.g. `"5"`) | The maximum number of PersistentVolumeClaims permitted in the namespace. Each NFS volume mount and each GCS Fuse volume mount creates one PVC. Leave empty to apply no limit on PVCs. **Ensure this value is at least equal to the number of NFS and GCS volumes configured** (`enable_nfs` + the length of `gcs_volumes`) to avoid blocking volume provisioning. |

### Validating Group 15 Settings

**Google Cloud Console:**
- **ResourceQuota object:** Navigate to **Kubernetes Engine → Config & Storage** and look for a `ResourceQuota` object in the application namespace to confirm it was created.
- **Current quota usage:** The ResourceQuota details page shows current usage versus the configured hard limits for each resource dimension, making it easy to see how close the namespace is to any ceiling.

**kubectl:**
```bash
# View the ResourceQuota and current usage in the namespace
kubectl get resourcequota -n NAMESPACE
kubectl describe resourcequota -n NAMESPACE

# Check if a pod failed to schedule due to quota exhaustion
kubectl get events -n NAMESPACE \
  --field-selector reason=FailedCreate \
  --sort-by='.lastTimestamp'

# View aggregate resource requests and limits across all pods in the namespace
kubectl describe namespace NAMESPACE

# List all PVCs in the namespace (verify against quota_max_pvcs)
kubectl get pvc -n NAMESPACE

# List all Services in the namespace (verify against quota_max_services)
kubectl get services -n NAMESPACE
```

---

## Group 16: Custom Domain, Static IP & Network Configuration

These variables configure a custom domain, reserved static external IP address, and the VPC network settings for the application's load balancer and GKE cluster nodes. A static IP ensures the load balancer address is stable across redeployments; a custom domain enables SSL/TLS termination via a Google-managed certificate; network tags and the VPC network name control which firewall rules apply to cluster nodes and which network they join.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_custom_domain` | `false` | `true` / `false` | When `true`, configures the Kubernetes Ingress or Gateway resource to use the hostnames defined in `application_domains`, enabling host-based routing and Google-managed SSL certificate provisioning for each domain. When `false`, the application is accessible only via the load balancer's raw IP address (or the default `*.svc.cluster.local` name within the cluster). **Enable for any production workload that requires a stable, human-readable HTTPS URL.** After enabling, DNS A records for each domain in `application_domains` must be pointed to the load balancer's external IP before certificates can be issued — certificate provisioning typically takes 10–60 minutes after DNS propagation. |
| `application_domains` | `[]` | List of domain name strings (e.g. `["app.example.com", "www.example.com"]`) | Custom hostnames to associate with the application's Ingress or Gateway resource. A Google-managed SSL certificate is provisioned automatically for each domain, handling certificate issuance and renewal without manual intervention. Only used when `enable_custom_domain` is `true`. The load balancer's external IP is output by Terraform after deployment — **DNS A records for each domain must be pointed to this IP** before HTTPS traffic can be served. Leave empty if using only the raw IP address or an internal cluster DNS name. |
| `reserve_static_ip` | `true` | `true` / `false` | When `true`, reserves a named Global Static IP address in the project and associates it with the application's external load balancer. A reserved static IP persists independently of the load balancer — if the load balancer is recreated or the deployment is updated, the same IP address is reattached automatically. **Strongly recommended for any deployment that has DNS records pointed at it**, as an ephemeral IP may change between deployments, causing DNS to become stale. When `false`, an ephemeral IP is assigned at load balancer creation time and may change if the load balancer is recreated. |
| `static_ip_name` | `""` *(auto-generated)* | String | The name to assign to the reserved Global Static IP address resource. Leave empty to have the module generate a name automatically from the application name and deployment ID. Set an explicit value to reference a pre-existing reserved IP (for example, if the IP was reserved manually in advance and DNS records have already been configured to point to it). The name must be unique within the project. Only used when `reserve_static_ip` is `true`. |
| `network_tags` | `["nfsserver"]` | List of strings | GCP network tags applied to the GKE cluster nodes. Network tags are used to target VPC firewall rules — only nodes carrying the matching tag will have the corresponding firewall rule applied to them. The default tag `"nfsserver"` ensures firewall rules that permit NFS traffic (TCP port 2049) are applied to the cluster nodes when `enable_nfs = true`. Add further tags if your firewall rules require them, for example to permit specific monitoring agents or custom ingress ports. Tags must be lowercase and may contain letters, numbers, and hyphens. |
| `network_name` | `""` *(auto-discover)* | VPC network name string | The name of the VPC network the GKE cluster nodes should join. Leave empty to allow the module to auto-discover the single Services_GCP-managed network in the project. **Specify a value** when more than one Services_GCP-managed network exists in the project and you need to target a specific one. The network must exist in the same project and region. This value is used during cluster provisioning — changing it after the cluster has been created has no effect on the existing cluster but will apply to any new clusters created by subsequent deployments. |

### Validating Group 16 Settings

**Google Cloud Console:**
- **Reserved static IP:** Navigate to **VPC Network → IP Addresses** and filter for `External, Global` addresses to confirm the static IP has been reserved and is attached to the forwarding rule.
- **Ingress resource:** Navigate to **Kubernetes Engine → Services & Ingress** and confirm the Ingress is listed with the expected hostname(s) and that the load balancer IP matches the reserved static IP.
- **SSL certificate status:** In the Ingress details, the **Load Balancer** section shows the certificate status for each domain. Certificates remain in `PROVISIONING` state until DNS records are correctly pointed to the IP and propagated.
- **Network tags on nodes:** Navigate to **Kubernetes Engine → Clusters → *your cluster* → Nodes** and click a node to view its network tags under the **Details** tab.
- **VPC network:** Navigate to **Kubernetes Engine → Clusters → *your cluster*** and confirm the VPC network name shown matches the expected network.

**gcloud CLI / kubectl:**
```bash
# List all reserved global static IP addresses in the project
gcloud compute addresses list \
  --global \
  --project=PROJECT_ID \
  --format="table(name,address,status,users)"

# Describe a specific reserved IP address
gcloud compute addresses describe STATIC_IP_NAME \
  --global \
  --project=PROJECT_ID

# View the Ingress resource and its assigned IP and hostnames
kubectl describe ingress APPLICATION_NAME -n NAMESPACE

# Check the status of Google-managed SSL certificates
kubectl get managedcertificate -n NAMESPACE
kubectl describe managedcertificate CERT_NAME -n NAMESPACE

# List GKE cluster nodes and their network tags
gcloud compute instances list \
  --project=PROJECT_ID \
  --filter="tags.items=nfsserver" \
  --format="table(name,zone,tags.items)"

# Confirm the VPC network the cluster is attached to
gcloud container clusters describe CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(network,subnetwork)"
```

---

## Group 17: Identity-Aware Proxy

> **PSE Certification relevance:** This group maps to PSE exam Section 1.3 (managing authentication) and Section 2.1 (perimeter security). IAP implements OAuth 2.0-based authentication at the application perimeter — all requests must carry a valid Google identity credential, eliminating VPN dependency. `iap_authorized_groups` demonstrates the PSE best practice from Section 1.4 of managing access through Google Groups rather than individual user accounts, enabling centrally managed team access without Terraform re-applies when membership changes.

These variables configure Identity-Aware Proxy (IAP) for the application's load balancer, requiring Google-identity authentication before users can access the application. IAP enforces access at the proxy layer — no application code changes are needed to add authentication. It is recommended for internal tools, admin interfaces, or any application where access should be restricted to known Google identities.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_iap` | `false` | `true` / `false` | Enables **Identity-Aware Proxy (IAP)** on the application's external HTTPS load balancer. When `true`, all requests must carry a valid Google identity credential — unauthenticated requests are redirected to a Google sign-in page. IAP enforces access at the proxy layer, meaning **no application code changes are needed** to add authentication. Use for internal tools, admin interfaces, or any application where access should be restricted to known Google identities. Requires the load balancer to be configured (set `reserve_static_ip = true` and define `application_domains`). When enabled, configure `iap_authorized_users` and `iap_authorized_groups` to define who may access the application, and supply `iap_oauth_client_id`, `iap_oauth_client_secret`, and `iap_support_email` for the OAuth consent screen. |
| `iap_authorized_users` | `[]` | List of `"user:email"` or `"serviceAccount:email"` strings | Individual users or service accounts granted the `IAP-secured Web App User` role, permitting them to access the application through IAP. Only active when `enable_iap` is `true`. Each entry must use the IAM member format: `"user:alice@example.com"` for a Google account, or `"serviceAccount:ci-runner@project.iam.gserviceaccount.com"` for a service account. Adding an address here does **not** grant any other GCP IAM permissions — it only controls access to the IAP-protected application. For team-level access management, prefer `iap_authorized_groups` over individual user entries to reduce Terraform re-applies when team membership changes. |
| `iap_authorized_groups` | `[]` | List of `"group:name@domain"` strings | Google Groups granted the `IAP-secured Web App User` role. Only active when `enable_iap` is `true`. Each entry must use the IAM member format: `"group:engineering@example.com"`. Using groups is the recommended approach for granting access to teams, as membership can be managed centrally in Google Workspace or Cloud Identity without requiring a Terraform re-apply each time a team member joins or leaves. |
| `iap_oauth_client_id` | `""` | OAuth 2.0 client ID string *(sensitive)* | The OAuth 2.0 client ID associated with the IAP-protected backend. Required when `enable_iap` is `true`. Create an OAuth client in **APIs & Services → Credentials → Create Credentials → OAuth client ID** (application type: Web Application) and paste the resulting client ID here. This value is stored in Secret Manager and is never exposed in plaintext in the Terraform state. |
| `iap_oauth_client_secret` | `""` | OAuth 2.0 client secret string *(sensitive)* | The OAuth 2.0 client secret paired with `iap_oauth_client_id`. Required when `enable_iap` is `true`. Retrieved from the same credential creation step as the client ID. This value is treated as sensitive, stored in Secret Manager, and never exposed in plaintext in the Terraform state. Rotate this secret via the Google Cloud Console if it is ever compromised — then update this variable and re-apply. |
| `iap_support_email` | `""` | Valid email address | The support email address displayed on the Google OAuth consent screen shown to users when they are prompted to sign in via IAP. Must be either a user account email or a Google Group email that you own or administer. Required when `enable_iap` is `true`. This address is visible to users authenticating through IAP — use a team distribution list (e.g. `it-support@example.com`) rather than an individual's personal address. |

### Validating Group 17 Settings

**Google Cloud Console:**
- **IAP status:** Navigate to **Security → Identity-Aware Proxy**. The application's backend service should appear with IAP enabled. The **Access** column shows the number of authorised principals.
- **IAP authorised members:** Click the backend service entry and select the **Principals** tab to verify expected users and groups are listed with the `IAP-secured Web App User` role.

**gcloud CLI:**
```bash
# Confirm IAP is enabled on the backend service (load balancer backend)
gcloud compute backend-services list \
  --global \
  --project=PROJECT_ID \
  --format="table(name,iap.enabled,iap.oauth2ClientId)"

# List principals with IAP access
gcloud compute backend-services get-iam-policy BACKEND_SERVICE_NAME \
  --global \
  --project=PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

---

## Group 18: Cloud Armor

> **PSE Certification relevance:** This group maps to PSE exam Section 2.1 (designing and configuring perimeter security). `enable_cloud_armor` attaches a Cloud Armor security policy enforcing OWASP CRS WAF rules (blocking SQL injection, XSS, RFI, and other web exploits) with Adaptive Protection for AI-driven DDoS mitigation. `admin_ip_ranges` demonstrates the PSE pattern of higher-priority allow rules for trusted networks, exempting corporate egress IPs and monitoring probes from WAF inspection while all other traffic remains subject to the policy.

These variables attach a **Cloud Armor security policy** to the application's external HTTPS load balancer, providing DDoS mitigation, Web Application Firewall (WAF) rules, and IP-based access controls. Cloud Armor operates at the Google network edge — malicious or unwanted traffic is blocked before it reaches the GKE cluster, reducing both attack surface and unnecessary load on cluster resources.

> **Note:** Cloud Armor requires an external HTTPS load balancer. Ensure `reserve_static_ip = true` (Group 16) and a `service_type = "LoadBalancer"` (Group 5) are configured. Cloud Armor policies incur additional GCP costs — review the [Cloud Armor pricing page](https://cloud.google.com/armor/pricing) before enabling in production.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_cloud_armor` | `false` | `true` / `false` | Master switch for Cloud Armor. When `true`, the module attaches the Cloud Armor security policy named in `cloud_armor_policy_name` to the application's external load balancer backend service. The policy intercepts all inbound requests at the Google network edge and applies its rules before traffic is forwarded to the cluster. When `false`, no security policy is attached and all traffic reaching the load balancer is forwarded to the cluster without WAF inspection. **Recommended for internet-facing production workloads** handling sensitive data or exposed to untrusted traffic. The referenced policy must already exist in the project — this module attaches an existing policy rather than creating one. |
| `admin_ip_ranges` | `[]` | List of CIDR strings (e.g. `["203.0.113.0/24"]`) | CIDR IP address ranges that are granted a higher-priority Cloud Armor rule exempting them from WAF inspection. Requests from these ranges are allowed unconditionally, bypassing any `deny` or rate-limiting rules in the security policy. Use this for trusted networks such as corporate office egress IPs, CI/CD runner IPs, or monitoring probe sources that might otherwise trigger WAF rules. Leave empty to apply the security policy uniformly to all traffic. Only effective when `enable_cloud_armor` is `true`. **Do not add overly broad ranges** (e.g. `0.0.0.0/0`) — this would bypass the WAF policy for all traffic and defeat its purpose. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | String (policy name) | The name of the existing Cloud Armor security policy to attach to the load balancer backend. The policy must already exist in the same project before applying this configuration — Terraform will fail if the named policy is not found. Create and manage Cloud Armor policies in **Network Security → Cloud Armor Policies** or via the `gcloud compute security-policies` commands. Use descriptive policy names that reflect their scope, e.g. `"public-api-waf"`, `"admin-portal-waf"`. Only used when `enable_cloud_armor` is `true`. |

### Validating Group 18 Settings

**Google Cloud Console:**
- **Cloud Armor policy attachment:** Navigate to **Network Security → Cloud Armor Policies** and click the policy named in `cloud_armor_policy_name`. Under the **Targets** tab, confirm the application's backend service is listed as an attached target.
- **Policy rules:** In the policy details, view the **Rules** tab to confirm WAF rules and any admin IP allowlist rules are configured as expected.
- **Request logs:** Navigate to **Network Security → Cloud Armor Policies → *your policy* → Logs** to view requests that were allowed, denied, or flagged by WAF rules. This is the primary tool for diagnosing false positives or verifying that attack traffic is being blocked.
- **Backend service:** Navigate to **Network Services → Load Balancing**, click the load balancer, and under the **Backend** section confirm the security policy name is shown next to the backend service.

**gcloud CLI:**
```bash
# Confirm the Cloud Armor policy exists and view its rules
gcloud compute security-policies describe CLOUD_ARMOR_POLICY_NAME \
  --project=PROJECT_ID \
  --format="yaml(name,rules)"

# List all backend services and confirm the policy is attached
gcloud compute backend-services list \
  --global \
  --project=PROJECT_ID \
  --format="table(name,securityPolicy)"

# View recent Cloud Armor request logs (allowed and denied)
gcloud logging read \
  "resource.type=http_load_balancer AND jsonPayload.enforcedSecurityPolicy.name=CLOUD_ARMOR_POLICY_NAME" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,jsonPayload.remoteIp,jsonPayload.enforcedSecurityPolicy.outcome,jsonPayload.requestUrl)"

# List admin IP allowlist rules on the policy
gcloud compute security-policies rules list CLOUD_ARMOR_POLICY_NAME \
  --project=PROJECT_ID \
  --format="table(priority,action,match.config.srcIpRanges,description)"
```

---

## Deployment Prerequisites & Dependency Analysis

This section summarises every external dependency for deploying `App_GKE`. Dependencies are grouped by failure mode to help you identify what must be in place before deploying, what will silently not work, and what requires post-deployment manual action. GKE-specific dependencies that differ from the equivalent `App_CloudRun` behaviour are highlighted.

> **Notation:** *Self-provisioned* means the module (or its `App_Common` library) creates the resource automatically on first deployment — no manual pre-requisite is required.

---

### Tier 1 — Hard Prerequisites

These configurations will cause `terraform apply` to fail, or will prevent GKE pods from reaching a healthy state, if the listed prerequisite is not satisfied.

| Feature | Variable(s) | Requirement |
|---|---|---|
| **Secret Manager references** | `secret_environment_variables` | Every secret named in the map must exist in Secret Manager **before running `terraform plan`**. Missing secrets are caught at plan time with the message: *`Secret '<name>' does not exist in project '<id>'. Create the secret in Secret Manager before running terraform plan.`* Previously this only surfaced when GKE pods failed to schedule because the referenced Kubernetes Secret could not be populated. |
| **Custom SQL scripts** | `enable_custom_sql_scripts = true` | The GCS bucket specified in `custom_sql_scripts_bucket` must exist and all `.sql` files must be uploaded to `custom_sql_scripts_path` before deployment. The module's own application bucket can serve as the scripts bucket, but the script files must be placed there manually before the first apply. |
| **Database backup import** | `enable_backup_import = true` | The backup file named in `backup_file` must exist at the configured source — either the module's GCS backup bucket or a Google Drive location — before deployment. A missing file causes the Kubernetes Job that performs the import to fail immediately. |
| **CI/CD pipeline** | `enable_cicd_trigger = true` | A GitHub repository must be accessible and either a GitHub Personal Access Token (scopes: `repo` and `admin:repo_hook`) or a GitHub App installation ID must be provided. Without valid credentials, the Cloud Build GitHub connection cannot be established and `terraform apply` will fail. |
| **Custom container build** | `container_image_source = "custom"` | Requires the same GitHub repository connection and credentials as `enable_cicd_trigger`. Cloud Build will fail at apply time if the repository is unreachable or credentials are absent. |
| **External Cloud Armor policy** | `enable_cloud_armor = false` + non-default `cloud_armor_policy_name` | When `enable_cloud_armor` is `false` but `cloud_armor_policy_name` is set to a custom value, the module references an existing externally-managed Cloud Armor policy. That policy must already exist in the project. Setting `enable_cloud_armor = true` (recommended) creates an inline WAF policy automatically and removes this prerequisite entirely. |
| **VPC Service Controls** | `enable_vpc_sc = true` | An Access Context Manager policy and VPC-SC perimeter covering all GCP service APIs used by this module must already exist, and the module's service account must be a permitted principal within the perimeter. VPC-SC perimeters are organisation-level resources that cannot be created by this module — configure them via your platform team before enabling this flag. **PSE relevance (Section 2.2, 5.1):** VPC-SC is a key exam control — it blocks API access from outside the perimeter even from principals holding valid IAM roles, providing location-based access control that complements identity-based IAM. In regulated environments, VPC-SC is a component of the network boundary controls used to scope PCI-DSS and HIPAA compliance environments. |
| **Multiple inline deployments — subnet CIDR conflict** | `prereq_gke_subnet_cidr` | When `Services_GCP` has not been deployed and more than one `App_GKE` deployment is created in the same VPC, each deployment that provisions its own inline GKE cluster must use a distinct, non-overlapping `prereq_gke_subnet_cidr`. The default value (`10.201.0.0/24`) will cause an address conflict if used by more than one deployment in the same project. This constraint is eliminated entirely by using a `Services_GCP`-managed shared cluster. |

---

### Tier 2 — Silent Failures

These configurations deploy without a Terraform error but will not function correctly at runtime. There is no immediate error to indicate the problem.

| Feature | Variable(s) | Failure mode | Resolution |
|---|---|---|---|
| **Identity-Aware Proxy** | `enable_iap = true` with blank `iap_oauth_client_id` or `iap_oauth_client_secret` | IAP is **silently disabled** when either OAuth credential field is empty. The load balancer is created without IAP enforcement — the application is publicly accessible with no authentication gate and Terraform reports no error. | Manually create an OAuth 2.0 client in **APIs & Services → Credentials → Create Credentials → OAuth client ID** (type: Web Application) and supply the resulting client ID and secret via `iap_oauth_client_id` and `iap_oauth_client_secret` before applying. |
| **Multi-Cluster Service** | `enable_multi_cluster_service = true` | The variable is declared but **no Kubernetes or GCP resources are created** in the current version of the module. Enabling it has no effect. | Use `Services_GCP` with `configure_cloud_service_mesh = true` for Fleet-based multi-cluster connectivity. Multi-Cluster Service support within `App_GKE` is planned for a future release. |
| **Redis cache** | `enable_redis = true` + explicit `redis_host` | `REDIS_HOST` and `REDIS_PORT` environment variables are injected into pods, but applications cannot connect if no Redis service exists at the specified address. There is no Terraform error. | Provision a Cloud Memorystore instance or Redis VM before deploying, or deploy `Services_GCP` which provides a shared instance that is auto-discovered when `redis_host` is left blank. |
| **Secret rotation** | `secret_rotation_period` | The Pub/Sub rotation notification is scheduled and fires at the configured interval, but no secret value is actually rotated. The notification is only a trigger — the handler that updates the secret must be implemented separately. | Use `enable_auto_password_rotation = true` for the database password, or deploy a separate handler (Cloud Function or Kubernetes CronJob) subscribing to the rotation Pub/Sub topic. |

---

### Tier 3 — Soft Prerequisites

These features deploy successfully but require a manual step outside Terraform before they become fully operational.

| Feature | Variable(s) | Required action |
|---|---|---|
| **Custom domain** | `application_domains` (with `enable_custom_domain = true`) | After `terraform apply`, create **DNS A records** for each domain pointing to the GKE Gateway's reserved static IP address (emitted as a Terraform output). Certificate Manager certificate provisioning begins after DNS propagation and typically completes within 10–60 minutes. The application will not be reachable on the custom domain until the certificate is active. |
| **Identity-Aware Proxy OAuth credentials** | `enable_iap = true` | Before enabling IAP, create an OAuth 2.0 client credential in **APIs & Services → Credentials** (see Tier 2 above). Also ensure the project has an OAuth consent screen configured in **APIs & Services → OAuth consent screen**. This is a one-time per-project step. |
| **Backup file staging** | `enable_backup_import = true` | The backup file must be uploaded to the GCS backup bucket (or Google Drive) **before** the deployment that enables this flag. |

---

### Previously Manual — Now Self-Provisioned

The following were documented as hard prerequisites in earlier versions of this module. They are now handled automatically and require no pre-existing resources.

| Feature | Variable(s) | How it is now handled |
|---|---|---|
| **Binary Authorization attestor, policy & KMS key** | `enable_binary_authorization = true` | `App_Common/modules/app_security` idempotently creates the KMS signing keyring, `binauthz-signer` key, `pipeline-attestor` Container Analysis note, attestor, and Binary Authorization policy via shell scripts. If `Services_GCP` provisioned these first, the scripts detect their existence and skip creation. Image signing runs automatically after each build. |
| **CMEK keyring for storage encryption** | `manage_storage_kms_iam = true` | `App_Common/modules/app_cmek` idempotently creates the `${project_id}-cmek-keyring` KMS keyring and its `storage-key` CryptoKey. Safe to set on the first deployment with no pre-existing KMS resources. If `Services_GCP` is deployed with `enable_cmek = true`, both modules target the same well-known keyring name — whichever runs first creates it; the second is a no-op. |
| **Dataplane V2 for NetworkPolicies** | `enable_network_segmentation = true` | The inline GKE cluster now sets `datapath_provider = "ADVANCED_DATAPATH"` when `enable_network_segmentation = true`. When `Services_GCP` provisions the cluster, Dataplane V2 is also enabled. Previously this had to be set at cluster creation time via `Services_GCP`. |
| **Anthos Service Mesh for inline cluster** | `configure_service_mesh = true` | `App_GKE/gke-mesh.tf` automatically provisions Fleet Hub membership, required IAM bindings for the Hub service identity, `google_gke_hub_feature`, and `google_gke_hub_feature_membership` when `configure_service_mesh = true` and the module is creating its own inline cluster. Only applies for inline cluster deployments — when `Services_GCP` manages the cluster, ASM is configured there via `configure_cloud_service_mesh = true`. |
| **Secrets Store CSI add-on** | `enable_secrets_store_csi_driver = true` | `prerequisites.tf` now automatically runs `gcloud container clusters update ... --enable-secret-manager-config` when `enable_secrets_store_csi_driver = true` and the cluster name is resolved. The manual `gcloud` command previously noted in the variable description is no longer required. |
| **Two-apply bootstrap for inline cluster** | *(first deployment without `Services_GCP`)* | The inline GKE Autopilot cluster still requires **two Terraform applies** on the very first deployment — the first apply creates the cluster; the second deploys workloads once the cluster API endpoint is available. This is a Terraform/GKE bootstrapping constraint rather than a user action, and subsequent applies are single-step. It is eliminated entirely by using a `Services_GCP`-managed cluster. |

---

### Dependency on `Services_GCP` for Shared Resources

`Services_GCP` is declared as a module dependency (`module_dependency = ["Services_GCP"]`) but is **not required**. The module self-provisions all necessary infrastructure inline, including the GKE Autopilot cluster itself. However, deploying `Services_GCP` first is strongly recommended when multiple application modules share the same GCP project — it centralises shared infrastructure, eliminates the two-apply bootstrap, and removes per-deployment subnet CIDR management.

| Resource | Without `Services_GCP` | With `Services_GCP` |
|---|---|---|
| **GKE Autopilot cluster** | Module auto-provisions an inline GKE Autopilot cluster with its own subnet, secondary pod and service CIDR ranges, Cloud NAT, and Cloud Router. Requires **two Terraform applies** on first deployment. Each `App_GKE` deployment using inline cluster creation in the same VPC must use a distinct `prereq_gke_subnet_cidr`. | Module discovers and deploys workloads to the shared GKE cluster in a single apply. No subnet CIDR coordination required. |
| **VPC network** | Module auto-provisions an inline VPC. | Module attaches to the shared centrally-managed VPC, simplifying firewall and connectivity management across all deployments. |
| **Cloud SQL instance** | Module auto-provisions a dedicated Cloud SQL instance per deployment. Each deployment incurs the full instance cost. | Module auto-discovers and connects to the shared Cloud SQL instance, provisioning only a separate database and user. Eliminates per-deployment instance cost. |
| **NFS / Filestore** | Module auto-provisions an inline NFS GCE VM when `enable_nfs = true`. | Module auto-discovers the centrally managed Filestore instance. Provides enterprise-grade NFS with guaranteed throughput and managed backups. |
| **Redis / Memorystore** | `enable_redis = true` with a blank `redis_host` falls back to the NFS VM's IP address — only works if Redis is co-located on that VM. An explicit `redis_host` is required for any other instance. | Module auto-discovers the shared Memorystore instance. `redis_host` can be left blank. |
| **Anthos Service Mesh** | `gke-mesh.tf` provisions Fleet Hub membership and ASM for the inline cluster when `configure_service_mesh = true`. | `Services_GCP` (with `configure_cloud_service_mesh = true`) provisions ASM with full fleet-wide configuration, multi-cluster ingress, and mesh observability dashboards. Recommended for production mesh deployments. |
| **Artifact Registry** | Module auto-creates a per-deployment Artifact Registry repository. | Module auto-discovers and uses the shared registry, enabling image reuse and consistent vulnerability scanning policies across all deployments. |
| **Binary Authorization** | `app_security` self-provisions the attestor, KMS key, and policy automatically (see above). | `Services_GCP` (with `enable_binary_authorization = true`) provisions these centrally with configurable enforcement mode. Recommended for production. |
| **CMEK encryption** | `app_cmek` self-provisions the `${project_id}-cmek-keyring` and `storage-key` automatically (see above). | `Services_GCP` (with `enable_cmek = true`) provisions the keyring with configurable rotation and applies CMEK across all shared resources simultaneously. |

---
