---
title: "Temporal on GKE Autopilot"
description: "Configuration reference for deploying Temporal on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Temporal on GKE Autopilot

Temporal is an open-source workflow orchestration engine used by organisations such
as Stripe, Netflix, Coinbase, and HashiCorp to build reliable distributed
applications. This module deploys Temporal on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Temporal uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Temporal runs as a Go application using the official `temporalio/auto-setup`
all-in-one image, which starts all four Temporal services — Frontend, History,
Matching, and Worker — in a single pod and handles PostgreSQL schema initialisation
automatically on first boot. The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | All-in-one pod, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL | Two databases: primary persistence + visibility; accessed via private IP, no Auth Proxy sidecar |
| Secrets | Secret Manager | Auto-generated database password |
| Ingress | Cloud Load Balancing | ClusterIP (internal) by default; LoadBalancer for external SDK workers |
| Advanced visibility | Elasticsearch (optional) | Full-text workflow search and custom search attributes |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is the only supported database.** Temporal's architecture requires
  PostgreSQL; MySQL is not used. The `auto-setup` image connects directly via the
  Cloud SQL private IP — no Auth Proxy sidecar is deployed.
- **All four Temporal services run in one pod.** Frontend (gRPC on port 7233),
  History, Matching, and Worker share the same CPU and memory allocation.
- **Schema initialisation is automatic.** `temporalio/auto-setup` creates both
  databases and runs schema migrations on first start. No separate init job is
  required. A generous TCP startup probe (30 s initial delay, 10 failure threshold)
  accommodates Autopilot node provisioning plus schema setup time.
- **`num_history_shards` is permanently immutable.** This value is written into the
  database schema on first deploy and cannot be changed without wiping and
  re-initialising all workflow data. Default is `4` (dev/demo); use `512` or higher
  for production.
- **`service_type` defaults to `ClusterIP`.** SDK workers connect over the cluster
  network. Change to `LoadBalancer` only if SDK workers run outside the cluster.
- **Elasticsearch is optional.** Without it, standard workflow search is powered by
  the PostgreSQL visibility database. Enabling Elasticsearch adds full-text search and
  custom search attributes but requires a reachable Elasticsearch 7.x or 8.x cluster.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Temporal workload

Temporal pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. The deployment runs the `temporalio/auto-setup` image, which
launches all four Temporal services in a single container.

- **Console:** Kubernetes Engine → Workloads → select the Temporal workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  Service.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type are managed.

### B. Cloud SQL for PostgreSQL

Temporal stores all workflow execution state in a managed Cloud SQL for PostgreSQL
instance. Two databases are created:

- **Primary persistence database** — workflow state, task queues, namespace metadata,
  timers, and activity records.
- **Visibility database** — running workflow execution records used for search and
  filtering in the Temporal Web UI and via `tctl`.

The Temporal server connects to Cloud SQL directly via the **private IP** (no Auth
Proxy sidecar). TLS is required by Cloud SQL and is enabled in the Temporal
configuration automatically.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive session to inspect schemas and data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database names, user, and the Secret Manager secret for the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation see [App_GKE](App_GKE.md).

### C. Secret Manager

The Temporal database password is generated automatically and stored as a Secret
Manager secret injected into the pod at runtime; it is never exposed in plain text.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The secret name is in the [Outputs](#5-outputs) as `temporal_db_password_secret_id`.
See [App_GKE](App_GKE.md) for the Secret Store CSI integration.

### D. Networking & ingress

By default the Temporal Frontend gRPC service is a `ClusterIP` and is only reachable
from inside the cluster on port **7233**. SDK workers deployed on the same GKE
cluster connect using the `temporal_frontend_address` output directly.

To expose Temporal externally, set `service_type = "LoadBalancer"` and optionally
`reserve_static_ip = true` for a stable address. A custom domain with a
Google-managed certificate can also be enabled.

- **Console:** Kubernetes Engine → Services & Ingress; Network services →
  Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, CDN, and static IP
details.

### E. Elasticsearch (optional — advanced visibility)

When `enable_elasticsearch = true`, Temporal replaces the PostgreSQL visibility
database with Elasticsearch as the advanced visibility store, enabling full-text
workflow search and custom search attributes. The `temporalio/auto-setup` image
auto-creates the visibility index (`temporal_visibility_v1` by default) on first
start.

- **Console:** If using Elasticsearch_GKE, Kubernetes Engine → Workloads.
- **CLI:**
  ```bash
  # Check Elasticsearch cluster health (from within the cluster):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s http://<es-host>:9200/_cluster/health | python3 -m json.tool
  ```

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Temporal Application Behaviour

- **First-deploy database setup.** Before the Temporal server pod starts, a
  `temporal-db-init` Kubernetes Job connects as the PostgreSQL superuser and creates
  the Temporal role with `CREATEDB` privilege. The `temporalio/auto-setup` image then
  creates both databases and runs all schema migrations on its own first start. The
  init job is idempotent.
- **Schema initialisation on every start.** `auto-setup` detects the current schema
  version at startup. If the schema is already up-to-date, startup proceeds
  immediately. If pending migrations exist, they are applied before any Temporal
  services begin accepting connections.
- **Upgrading Temporal.** Update `application_version` to the target tag. The
  `auto-setup` image applies pending schema migrations automatically on next startup.
  For large deployments, review the
  [Temporal release notes](https://github.com/temporalio/temporal/releases) for
  breaking schema changes before updating.
- **Temporal Web UI.** No Web UI is deployed automatically. Add one as a companion
  service via the `additional_services` variable. A typical Temporal Web UI image is
  `temporalio/ui`, configuring it to point at the Frontend service on port 7233.
- **Temporal namespaces.** Temporal uses its own internal namespace concept (separate
  from Kubernetes namespaces). The `default` Temporal namespace is created
  automatically by `auto-setup`. Additional namespaces can be created with:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    temporal operator namespace create my-namespace
  ```
- **Connecting SDK workers.** SDK workers connect to the Temporal Frontend gRPC
  address. Use the `temporal_frontend_address` output directly for workers inside the
  cluster. For workers outside the cluster, set `service_type = "LoadBalancer"` and
  use `service_external_ip:7233`.
- **Health probes.** TCP probes are used for both startup and liveness checks because
  Temporal Frontend exposes gRPC (not HTTP/1.1) on port 7233. The startup probe
  allows up to 5 minutes (10 attempts × 30-second period) for schema initialisation
  to complete.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Temporal are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `temporal` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Temporal` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `1.25.0` | Temporal server image tag. Pin to a specific version; schema migrations must be completed before upgrading. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision databases and secrets without deploying pods. |
| `cpu_limit` | `2000m` | CPU per pod; all four Temporal services share this allocation. |
| `memory_limit` | `4Gi` | Memory per pod; all four services share this allocation. |
| `min_instance_count` | `1` | Minimum replicas. Must be ≥ 1 — Temporal requires at least one running pod to process timers and retries. |
| `max_instance_count` | `1` | Maximum replicas. |
| `container_port` | `7233` | Temporal Frontend gRPC port (informational — the service port is hardcoded to 7233). |
| `container_protocol` | `h2c` | HTTP/2 cleartext — required for gRPC. Do not change. |
| `enable_image_mirroring` | `true` | Mirror the Temporal image from Docker Hub into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged with the Temporal server configuration. Override built-in defaults with caution. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Use `ClusterIP` for cluster-internal SDK workers (recommended). Use `LoadBalancer` only if SDK workers run outside the cluster. |
| `workload_type` | `null` (Deployment) | Temporal is stateless — `Deployment` is appropriate. |
| `session_affinity` | `None` | No sticky routing required for gRPC. |
| `gke_cluster_name` | `""` | Target cluster name. Leave empty for auto-discovery. |
| `namespace_name` | `""` | Kubernetes namespace. Leave empty to auto-generate. |
| `enable_network_segmentation` | `false` | Create NetworkPolicy resources to restrict traffic. |
| `deployment_timeout` | `600` | Seconds Terraform waits for the rollout. The default covers Autopilot node provisioning plus schema initialisation on first deploy. |

### Group 7 — StatefulSet

Not required for Temporal. All durable state lives in Cloud SQL PostgreSQL. Setting
`stateful_pvc_enabled = true` is not recommended — see
[App_GKE](App_GKE.md) for PVC options.

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all scheduling. |
| `quota_max_pods` | `20` | Maximum pods in the namespace. |
| `quota_max_services` | `10` | Maximum Services in the namespace. |
| `quota_max_pvcs` | `5` | Maximum PVCs in the namespace. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades (recommended for production). |
| `pdb_min_available` | `1` | Minimum pods available during disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | TCP on port 7233 | 10-attempt window (5 minutes) for schema init on first start. |
| `health_check_config` | TCP on port 7233 | Liveness probe; 60 s initial delay. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Additional Jobs to run before the server pod. The built-in `temporal-db-init` job is always included. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Companion services — use this to deploy the Temporal Web UI (`temporalio/ui`). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

NFS is not required for Temporal. See [App_GKE](App_GKE.md) for NFS
options if needed for companion workloads.

### Group 14 — Cloud Storage & Artifact Registry

Temporal requires no Cloud Storage buckets. Artifact Registry is used for the
mirrored Temporal image. See [App_GKE](App_GKE.md).

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Off by default — Temporal does not use GCS. |
| `max_images_to_retain` | `7` | Artifact Registry image retention count. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Database & Temporal-Specific Settings

| Variable | Default | Description |
|---|---|---|
| `sql_instance_name` | `""` | Existing Cloud SQL PostgreSQL instance name. Leave empty for auto-discovery from Services_GCP. |
| `temporal_database_name` | `""` | Primary persistence database name. Leave empty to auto-generate from the deployment resource prefix (recommended). |
| `temporal_visibility_database_name` | `""` | Visibility database name. Leave empty to auto-generate as `<prefix>_visibility`. |
| `temporal_db_user` | `""` | PostgreSQL username. Leave empty to auto-generate from the deployment resource prefix. |
| `num_history_shards` | `4` | **Immutable after first deploy.** Number of history shards (power of two). Use `4` for dev/demo, `512` or higher for production. |
| `enable_elasticsearch` | `false` | Enable Elasticsearch for advanced visibility (full-text search, custom search attributes). |
| `elasticsearch_url` | `""` | Elasticsearch endpoint. Required when `enable_elasticsearch = true`. Format: `host:9200` or `http://host:9200`. |
| `elasticsearch_version` | `v7` | Must match the actual cluster version: `v7` for Elasticsearch 7.x, `v8` for 8.x. |
| `elasticsearch_index_visibility` | `temporal_visibility_v1` | Elasticsearch index name. Auto-created by `auto-setup` on first start. |

### Group 16 — Secret Rotation

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Rotate the database password on a schedule. The pod must be restarted after rotation to pick up the new secret. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |

### Group 18 — Custom SQL Scripts

Not applicable for Temporal. See [App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `false` | Stable external IP across redeploys (only useful with `LoadBalancer`). |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | IAP is not recommended for Temporal gRPC — use `enable_network_segmentation` instead. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | _(set)_ | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name for the Temporal server. |
| `namespace` | Kubernetes namespace where Temporal is deployed. |
| `service_url` | Cluster-internal service URL (ClusterIP by default). |
| `service_external_ip` | External LoadBalancer IP (non-null only when `service_type = "LoadBalancer"`). |
| `temporal_frontend_address` | gRPC address for SDK workers — `<service-url>:7233`. |
| `temporal_db_user` | PostgreSQL username for Temporal server connections. |
| `temporal_db_name` | Name of the primary persistence database. |
| `temporal_visibility_db_name` | Name of the visibility database. |
| `temporal_db_password_secret_id` | Secret Manager secret ID holding the database password. |
| `storage_buckets` | Created Cloud Storage buckets (empty — Temporal does not use GCS). |
| `container_image` | Container image used for the Temporal server deployment. |
| `kubernetes_ready` | Whether the cluster endpoint is available and workloads are deployed. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_registry` | Artifact Registry repository name. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub repository details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `num_history_shards` | `4` (dev/demo), `512`+ (prod) | Critical | Permanently immutable after first deploy. Changing it requires wiping all workflow data and re-initialising from scratch. |
| `container_protocol` | `h2c` | Critical | Temporal uses gRPC; changing to `http1` breaks all SDK worker connections and the Web UI. |
| `temporal_database_name` / `temporal_visibility_database_name` | set once | Critical | Immutable after first deploy. Changing after deployment orphans the schema, causing Temporal to start with an uninitialised database. |
| `enable_elasticsearch` with `elasticsearch_url` | set together | Critical | An unreachable Elasticsearch endpoint when `enable_elasticsearch = true` causes Temporal to crash on startup — it does not fall back to PostgreSQL visibility. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `min_instance_count` | `1` | High | Scale-to-zero (`0`) causes missed timers, stalled activity retries, and dropped workflow progress. |
| `cpu_limit` | `2000m` | High | All four Temporal services share this allocation. Below 1000m, scheduling latency rises sharply and timer fires are delayed, directly impacting workflow SLAs. |
| `memory_limit` | `4Gi` | High | Temporal holds shard state in memory; insufficient memory causes OOM kills during workflow processing. |
| `temporal_db_user` | auto-generated | High | Changing after deploy without updating Cloud SQL grants and Secret Manager causes all server connections to fail. |
| `elasticsearch_version` | match actual cluster | High | A mismatch causes incompatible index mappings, missing workflow entries, and visibility write failures. |
| `elasticsearch_url` | `host:port` or `http://host:port` | High | Required when `enable_elasticsearch = true`; an empty value causes immediate startup crash. |
| `service_type` | `ClusterIP` (internal) | Medium | Exposing Temporal Frontend as `LoadBalancer` without network policy allows any external host to submit workflows. |
| `enable_pod_disruption_budget` | `true` | Medium | Without PDB, GKE node upgrades can evict all Temporal pods simultaneously, interrupting all in-flight workflow executions. |
| `backup_schedule` | `0 2 * * *` | Medium | An empty or disabled schedule leaves no recovery path for a Cloud SQL failure. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `stateful_pvc_enabled` | `false` | Medium | Temporal stores all state in Cloud SQL; PVCs add no benefit and can cause Autopilot scheduling failures. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Temporal-specific
database and secret provisioning shared across deployments is described in
**[Temporal_Common](Temporal_Common.md)**.
