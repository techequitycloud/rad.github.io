---
title: "LibreChat on GKE Autopilot"
---

# LibreChat on GKE Autopilot

LibreChat is an open-source AI chat interface with 20,000+ GitHub stars that replicates and
extends the ChatGPT experience across 20+ LLM providers (OpenAI, Anthropic, Google Gemini,
Mistral, Groq, Ollama, and many more). This module deploys LibreChat on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services LibreChat uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics that are common to every
GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

LibreChat runs as a Node.js web workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Firestore (MongoDB-compatible) | MongoDB URI required — Cloud SQL is not used |
| Object storage | Cloud Storage | A dedicated file-uploads bucket, plus optional extra buckets |
| Secrets | Secret Manager | JWT keys, credential encryption keys, and MongoDB URI auto-generated |
| Cache & sessions | Redis (optional) | Required for multi-replica deployments to maintain session consistency |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No Cloud SQL.** LibreChat uses MongoDB. By default the module auto-provisions a Firestore
  ENTERPRISE database with MongoDB compatibility. Provide `mongodb_uri` to skip auto-provisioning.
- **Firestore database is never deleted on destroy.** The database is retained to prevent data
  loss; delete it manually if no longer needed.
- **JWT and credential secrets are auto-generated** on first deploy and stored in Secret Manager.
  Rotating `CREDS_KEY` or `CREDS_IV` after users have saved AI provider credentials renders all
  stored credentials undecryptable.
- **Redis is disabled by default.** Enable it for any deployment with more than one replica —
  without Redis, session state is isolated per pod and users lose sessions on pod restarts.
- **Session affinity is `ClientIP`.** LibreChat uses WebSocket connections; sticky routing keeps
  a user's traffic on the same pod.
- **Timeout defaults to 600 seconds.** Long-running AI responses over SSE streaming require a
  generous timeout.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers are
reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the LibreChat workload

LibreChat pods are scheduled on Autopilot, which bills for the CPU and memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum replica
counts.

- **Console:** Kubernetes Engine → Workloads → select the LibreChat workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Firestore (MongoDB-compatible) — the LibreChat database

LibreChat stores all chat history, user accounts, and configuration in MongoDB. By default the
module discovers or creates a **Firestore ENTERPRISE database with MongoDB compatibility** and
injects the connection URI as `MONGO_URI`. Alternatively you can point `mongodb_uri` at MongoDB
Atlas or any self-hosted MongoDB instance accessible from the VPC.

- **Console:** Firestore → select the database to browse documents, indexes, and usage. The
  database ID matches `firestore_mongodb_database` (default: `LibreChat`).
- **CLI:**
  ```bash
  gcloud firestore databases list --project "$PROJECT"
  gcloud firestore databases describe LibreChat --project "$PROJECT"
  ```

Retrieve the auto-generated MongoDB URI from Secret Manager to verify connectivity:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~mongo-uri"
gcloud secrets versions access latest --secret=<mongo-uri-secret> --project "$PROJECT"
```

### C. Cloud Storage — file uploads

`LibreChat_Common` provisions a dedicated **`librechat-uploads`** Cloud Storage bucket for user
file uploads shared in chat (images, documents). The workload service account is granted access
automatically.

- **Console:** Cloud Storage → Buckets → look for the bucket with the `uploads` suffix.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/
  # Confirm the GCS Fuse mount is active inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i fuse
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Secret Manager — auto-generated application secrets

LibreChat requires several cryptographic secrets that are generated automatically on first deploy
and never exposed in plain text.

| Secret suffix | Environment variable | Purpose |
|---|---|---|
| `creds-key` | `CREDS_KEY` | 32-byte hex AES-GCM key for saved provider credentials |
| `creds-iv` | `CREDS_IV` | 16-byte hex AES-GCM IV — paired with `CREDS_KEY` |
| `jwt-secret` | `JWT_SECRET` | Signs user access tokens |
| `jwt-refresh-secret` | `JWT_REFRESH_SECRET` | Signs long-lived refresh tokens |
| `mongo-uri` | `MONGO_URI` | MongoDB connection string |

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Redis cache (optional)

Redis backs LibreChat's session management and real-time message queuing. It is required when
more than one pod replica is running — without it, each pod has isolated in-memory session state
and users lose sessions when requests route to a different pod.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # From inside the cluster:
  kubectl run redis-check --rm -it --image=redis --restart=Never -- redis-cli -h <redis-host> ping
  ```

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom domain
with a Google-managed certificate can be enabled, and a static IP can be reserved so the address
survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flows to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional uptime
checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. LibreChat Application Behaviour

- **No database migration job.** LibreChat auto-migrates its MongoDB schema on first startup;
  no separate initialization job is needed.
- **Firestore auto-provisioning.** When `mongodb_uri` is empty and no `firestore_mongodb_host`
  is set, the module discovers or creates a Firestore ENTERPRISE database with MongoDB
  compatibility. A SCRAM user is provisioned automatically. The database is never destroyed with
  the module.
- **AI provider API keys.** LibreChat itself connects to AI provider APIs at request time.
  Inject provider keys (OpenAI, Anthropic, etc.) via `secret_environment_variables`, which
  references pre-existing Secret Manager secrets. Do not pass keys as plain `environment_variables`
  — they would appear in pod specs visible via `kubectl describe pod`.
- **Health path.** Both the startup and liveness probes target `/` (LibreChat's root), which
  returns HTTP 200 once the application is fully initialised and connected to MongoDB. The
  startup probe has a generous failure threshold to allow MongoDB connection establishment on
  first boot.
- **WebSocket and SSE continuity.** LibreChat uses Server-Sent Events (SSE) for streaming AI
  responses and WebSocket for real-time updates. Session affinity (`ClientIP`) keeps a user's
  connection on the same pod. Ensure `timeout_seconds` is set high enough (600 s default) to
  avoid truncating long AI responses mid-stream.
- **User registration.** Self-registration is enabled by default. Set `allow_registration = false`
  after creating the initial admin account to prevent unauthorized sign-ups on public deployments.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for LibreChat are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
| `firestore_mongodb_host` | `""` | Firestore MongoDB endpoint host (manual override). Leave empty for auto-discovery. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `librechat` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `LibreChat AI Chat` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | LibreChat image version tag — **pin to a specific release in production**. |
| `mongodb_uri` | `""` | MongoDB connection URI (sensitive). Leave empty to use Firestore auto-provisioning. |
| `app_title` | `LibreChat` | Title shown in the LibreChat UI header and browser tab. |
| `allow_registration` | `true` | Allow new users to self-register. **Set `false` after initial admin account creation.** |
| `allow_social_login` | `false` | Enable OAuth social login providers. Requires OAuth app configuration in `librechat.yaml`. |
| `allow_social_registration` | `null` | Allow account creation via social login. Defaults to the value of `allow_social_login`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | `prebuilt` (GHCR) or `custom` (Cloud Build). |
| `container_image` | `ghcr.io/danny-avila/librechat` | Container image URI. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory per pod; 2 vCPU / 2 GiB minimum. |
| `container_port` | `3080` | LibreChat's native HTTP port. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold starts and dropped SSE streams. |
| `max_instance_count` | `5` | Maximum replicas (HPA ceiling). |
| `timeout_seconds` | `600` | Request timeout; increase for slow LLM backends or long AI responses. |
| `enable_cloudsql_volume` | `false` | **Must remain `false`.** LibreChat does not use Cloud SQL. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `enable_image_mirroring` | `true` | Mirror GHCR image to Artifact Registry — avoids rate limits. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core LibreChat vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. **Use this for AI provider API keys.** |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing for WebSocket and SSE continuity. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before forcibly terminating; increase for in-flight AI requests. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVC. Auto-selects `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Create a PodDisruptionBudget (disabled by default because max replicas defaults to 1 pod). |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | `{ path="/", initial_delay_seconds=30, failure_threshold=12 }` | HTTP probe allowing time for MongoDB connection and asset load. |
| `health_check_config` | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Liveness probe targeting LibreChat's root path. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty — LibreChat auto-migrates MongoDB on startup. Add custom setup tasks if needed. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs for periodic tasks (data cleanup, cache warming, etc.). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Provision a Filestore NFS volume shared across all replicas. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional GCS buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Extra buckets beyond the auto-provisioned uploads bucket. |
| `gcs_volumes` | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session management. **Required for multi-replica deployments.** |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database / MongoDB

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | **Fixed — do not change.** LibreChat does not use Cloud SQL. |
| `firestore_mongodb_database` | `LibreChat` | Firestore database ID / MongoDB database name. |
| `firestore_mongodb_username` | `""` | SCRAM username for Firestore authentication. |
| `firestore_mongodb_password` | `""` | SCRAM password (sensitive). Auto-generated when not set. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated NFS backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |

### Group 18 — Custom SQL Scripts

Not applicable — LibreChat does not use Cloud SQL. See [App_GKE](App_GKE.md) for
the shared mechanics.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Kubernetes Gateway for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of LibreChat. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach LibreChat. |
| `storage_buckets` | Created Cloud Storage buckets (includes the uploads bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs that were run. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster and workload are ready. False on first apply of a new inline cluster — re-run apply to complete. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `CREDS_KEY` / `CREDS_IV` (auto-generated) | set once | Critical | AES-GCM keys for saved AI provider credentials. Rotating after users have saved keys destroys all stored credentials — every user must re-enter their API keys. |
| `mongodb_uri` / Firestore auto-provisioning | configured | Critical | LibreChat requires MongoDB. If auto-discovery fails and no URI is provided, the pod crashes on startup and serves no traffic. |
| `enable_cloudsql_volume` | `false` | Critical | Must remain `false`. Enabling injects a Cloud SQL Auth Proxy sidecar that conflicts with the MongoDB-only connection routing. |
| `database_type` | `NONE` | Critical | Setting to a SQL engine provisions an unused Cloud SQL instance at extra cost without benefiting LibreChat. |
| `secret_environment_variables` (AI keys) | use secrets | Critical | AI provider keys passed as plain `environment_variables` are visible in `kubectl describe pod` and GCP audit logs. Always use Secret Manager references. |
| `iap_oauth_client_id` / `_secret` | set when IAP enabled | Critical | Required when `enable_iap = true`. If not provided, the IAP gateway fails to initialise and the service becomes unreachable. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `allow_registration` | `false` after setup | High | Open registration on a LoadBalancer-exposed deployment allows anyone to create an account. Disable after admin creation or restrict with IAP. |
| `enable_redis` | `true` for multi-replica | High | Without Redis, pod restarts and rescheduling drop all active sessions and SSE streams routed to that pod. |
| `redis_host` | explicit endpoint | High | Required when `enable_redis = true`. If empty, LibreChat fails to connect to Redis on startup. |
| `timeout_seconds` | `600` | High | SSE streaming for long AI responses can exceed several minutes. Insufficient timeout truncates responses mid-stream. |
| `min_instance_count` | `1` | High | Scale-to-zero drops all in-flight SSE streams and causes cold-start latency on wakeup. |
| `JWT_SECRET` (auto-generated) | set once | High | Rotating invalidates all active sessions simultaneously. Plan rotation during a maintenance window. |
| `application_version` | pinned release | Medium | `latest` can introduce breaking MongoDB schema changes or API incompatibilities on unplanned upgrades. |
| `enable_nfs` | `true` for multi-replica | Medium | Without NFS or GCS Fuse, uploaded files are pod-local and invisible to other replicas. |
| `backup_schedule` | set for production | High | Without backups, conversation history and user data in MongoDB/Firestore have no GCS-level snapshots. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | LibreChat is otherwise directly reachable from the public internet with only application-level login protecting it. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. LibreChat-specific application configuration
shared with the Cloud Run variant is described in **[LibreChat_Common](LibreChat_Common.md)**.
