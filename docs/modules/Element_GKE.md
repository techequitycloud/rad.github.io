---
title: "Element on GKE Autopilot"
description: "Configuration reference for deploying Element on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Element on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Element_GKE.png" alt="Element on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Element is the leading open-source (AGPLv3) [Matrix](https://matrix.org/) web
client — a self-hosted, end-to-end-encrypted messaging and collaboration app. This
module deploys Element on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

Element is a **static nginx single-page application (SPA)**: the browser talks
directly to a Matrix homeserver (such as Synapse or Dendrite) over HTTPS, so the pod
itself holds no server-side state — no database, no Redis, no persistent volume, and
no secrets.

This guide focuses on the cloud services Element uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, and the deployment lifecycle — refer
to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Element runs as a stateless nginx web workload. The deployment wires together a
deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | nginx static SPA pods, 500m vCPU / 512 MiB by default, horizontally autoscaled |
| Container build | Cloud Build + Artifact Registry | Thin custom image `FROM vectorim/element-web` with a runtime `config.json` entrypoint |
| Ingress | Cloud Load Balancing | External LoadBalancer Service, optional custom domain + managed certificate |
| Secrets | — | **None.** Element requires no secrets |
| Database | — | **None.** The Matrix homeserver holds all state, not Element |
| Object storage | — | **None.** Element is stateless (no PVC, no bucket, no NFS) |

**Sensible defaults worth knowing up front:**

- **Element is stateless.** All chat state, encryption keys, and media live on the
  Matrix homeserver and in the user's browser. Element itself stores nothing
  server-side, so the workload is a plain `Deployment` with no database, Redis, PVC,
  GCS bucket, or Secret Manager secret.
- **The homeserver is runtime configuration.** `homeserver_url` / `homeserver_name`
  are written into `/app/config.json` by the container entrypoint on every start, so
  one image can point at any homeserver without a rebuild. Leaving them blank
  defaults to the public `matrix.org`.
- **Custom build with a pinned version.** `container_image_source = "custom"` builds
  a thin image over `vectorim/element-web`. `application_version = "latest"` resolves
  to the pinned known-good tag `v1.11.86` via an app-specific `ELEMENT_VERSION` build
  ARG. `App_GKE` sets `imagePullPolicy=Always` for the reused custom tag so rebuilds
  are actually pulled.
- **Minimum 1 replica is maintained** (GKE does not scale to zero) so the client UI
  is always reachable. No session affinity is needed because Element is stateless.
- **Port 80.** nginx serves the SPA on port 80; probes target `/`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Element workload

Element pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Element workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Container image — Cloud Build & Artifact Registry

The Element image is built by Cloud Build from a thin Dockerfile that layers a
`config.json`-generating entrypoint on top of `vectorim/element-web`, then pushed to
Artifact Registry. `application_version = "latest"` builds the pinned `v1.11.86`.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/<project>/<repo> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the build pipeline, image mirroring, and the
`imagePullPolicy=Always` behaviour for reused custom tags.

### C. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP is reserved by default so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### D. Identity-Aware Proxy (optional)

Element ships open by default so users can log in against the homeserver. To restrict
who can even load the client UI to your Google identities, enable IAP
(`enable_iap = true`) with an OAuth client.

- **Console:** Security → Identity-Aware Proxy.
- **CLI:**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the IAP + BackendConfig wiring.

### E. Cloud Logging & Monitoring

Pod stdout/stderr (nginx access/error logs) flow to Cloud Logging; GKE metrics flow
to Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Element Application Behaviour

- **Runtime config generation.** The container entrypoint writes `/app/config.json`
  on every start from `HOMESERVER_URL` / `HOMESERVER_NAME`, then hands off to nginx.
  Changing the homeserver is a redeploy with new env values — no image rebuild.
- **No database, no migrations, no init job.** Element serves static assets; the pod
  is Ready as soon as nginx binds port 80.
- **Login is a browser-to-homeserver flow.** Element authenticates the user directly
  against the configured Matrix homeserver; there is no server-side session in the pod
  and nothing to seed in Secret Manager.
- **Verify the injected homeserver.** Confirm the running pod's env matches your
  intended homeserver, and that the LoadBalancer answers:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep HOMESERVER
  kubectl get svc -n "$NAMESPACE" <service-name> -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
  Then `curl -s http://<external-ip>/config.json` should return the JSON with your
  `base_url`.
- **Health path.** Startup and liveness probes target `/`, which nginx answers
  immediately and unauthenticated.
- **Upgrading Element.** Bump `application_version` (or pin a newer `element-web` tag)
  and redeploy; a new image builds and, because `imagePullPolicy=Always` is set for
  the reused custom tag, the rollout pulls the fresh layers.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Element are listed; every other input is inherited
from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `element` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Element image tag; `latest` builds the pinned `v1.11.86`. Pin a specific `element-web` tag in production. |
| `homeserver_url` | `""` | Matrix homeserver base URL written into `config.json`. Blank → `matrix.org`. |
| `homeserver_name` | `""` | Matrix server name (delegation identity) advertised by Element. Blank → `matrix.org`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the thin Element image via Cloud Build. |
| `container_image` | `""` | Override with a prebuilt/mirrored image URI. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry before deployment. |
| `min_instance_count` | `1` | Minimum replicas; GKE does not scale to zero. |
| `max_instance_count` | `3` | Maximum replicas. |
| `container_port` | `80` | nginx listens on port 80. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | CPU/memory limits — Element is lightweight. |
| `enable_cloudsql_volume` | `false` | No database — Auth Proxy sidecar not deployed. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra settings merged with the injected `HOMESERVER_URL` / `HOMESERVER_NAME`. |
| `secret_environment_variables` | `{}` | Secret Manager references. Element needs none. |
| `secret_rotation_period` / `secret_propagation_delay` | _(set)_ | Rotation notification / propagation wait. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Element is stateless; the foundation auto-resolves this to a Deployment. |
| `session_affinity` | `None` | No sticky routing needed — Element holds no server-side session. |
| `namespace_name` | `""` | Namespace for the workload; empty means auto-derived from the service name. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |

### Group 7 — StatefulSet

Inherited and **not used by Element** (stateless Deployment). `stateful_pvc_enabled`
(default `null`), `stateful_pvc_size`, `stateful_pvc_mount_path`,
`stateful_pvc_storage_class`, `stateful_headless_service`,
`stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group`.

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Enforce a namespace ResourceQuota. |
| `quota_cpu_requests` / `quota_cpu_limits` | _(set)_ | Namespace CPU quota. |
| `quota_memory_requests` / `quota_memory_limits` | _(set)_ | Namespace memory quota. **Must use binary units** (`4Gi`, `8192Mi`). |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | _(set)_ | Namespace object caps. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` / `topology_spread_strict` | _(set)_ | Spread pods across zones/nodes. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 10 s delay, 6 failures | Startup probe. |
| `liveness_probe` | HTTP `/` 15 s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | _(set)_ | App_GKE-level infrastructure probes. |
| `uptime_check_config` | disabled — `/` | Optional Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Element declares no init jobs. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md).
Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

Inherited and **off by default** — Element is stateless. `enable_nfs` (`false`),
`nfs_mount_path`, `nfs_volume_name`, `nfs_instance_name`, `nfs_instance_base_name`.

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Create GCS buckets defined in `storage_buckets`. Off — Element is stateless and declares none. |
| `storage_buckets` | `[]` | Additional buckets. Element declares none. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis Cache & Queue

Inherited from [App_GKE](App_GKE.md) and **inert** — a static SPA has no server-side
cache or queue. `enable_redis`, `redis_host`, `redis_port`, `redis_auth`.

### Group 16 — Database Backend

Inherited from [App_GKE](App_GKE.md) and **inert** — `Element_Common` sets
`database_type = "NONE"`. No Cloud SQL instance, user, or password is created.

### Group 17 — Backup & Maintenance

Inherited and **no-ops for Element** (nothing to back up). `backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`.

### Group 18 — Custom SQL Scripts

Inherited; not used by Element. `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root`.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `static_ip_name` / `network_tags` / `network_name` | _(set)_ | IP name, node tags, VPC network. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Note:** Enabling IAP requires Google identity authentication before the client UI
> even loads. Users still authenticate to the homeserver afterwards; IAP is an outer
> access gate, not a replacement for Matrix login.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Element. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend — worthwhile for static assets. |

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
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Element. |
| `storage_buckets` | Created Cloud Storage buckets (empty for Element). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of setup jobs (none for Element). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `Deployment` workload with `stateful_pvc_enabled = true`, bare-integer `quota_memory_*` values. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `homeserver_url` / `homeserver_name` | Your real homeserver, or blank for matrix.org | High | A wrong or unreachable homeserver leaves users unable to log in — the UI loads but authentication fails. |
| `application_version` | Pin a real `element-web` tag | High | `latest` is not a valid `element-web` tag; the module pins `v1.11.86`, but a hand-set raw `latest` build ARG would fail with `MANIFEST_UNKNOWN`. |
| `container_image_source` | `custom` | High | `prebuilt` with an image lacking the `config.json` entrypoint ships Element pointed at the wrong homeserver. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. Keeping 1 ensures the UI is always reachable. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_iap` | Enable to gate the UI | Medium | Without IAP anyone with the URL can load the client (they still need homeserver credentials to log in). |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| Database / Redis / Backup / NFS inputs | Leave default | Low | Inert for Element; setting them has no effect. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, and image mirroring — see **[App_GKE](App_GKE.md)**. Element-specific
application configuration shared with the Cloud Run variant is described in
**[Element_Common](Element_Common.md)**.
