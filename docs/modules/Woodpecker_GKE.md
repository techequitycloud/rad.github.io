---
title: "Woodpecker CI on GKE Autopilot"
description: "Configuration reference for deploying Woodpecker CI on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Woodpecker CI on GKE Autopilot

Woodpecker CI is a lightweight, container-native CI/CD engine — a simpler,
self-hostable alternative to Drone. Pipelines are defined as YAML files, and
each pipeline step runs in its own container. Woodpecker supports GitHub,
Gitea, Forgejo, GitLab, and Bitbucket as "forges" — the term Woodpecker uses
for the connected git host. This module deploys Woodpecker on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

**There is no `Woodpecker_CloudRun`, and there will not be one.** Woodpecker's
execution backend (`WOODPECKER_BACKEND=kubernetes`) needs real Kubernetes API
access to dynamically create a pod for every pipeline step — Cloud Run has no
privilege for docker-in-docker and no Kubernetes API to call. See
[Woodpecker_Common](Woodpecker_Common.md) for the full writeup; this is the
same architectural class of gap as this catalogue's other **Common + GKE
only** modules (Kopia, RocketChat, Immich, Temporal, Prowlarr,
VictoriaMetrics, Plausible, LobeChat, Supabase).

This guide focuses on the cloud services Woodpecker uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Woodpecker runs as a **single pod that co-locates the server and the
agent** in one container, backed by Cloud SQL PostgreSQL:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | One pod runs both the server (HTTP API + web UI) and the agent (pipeline-step executor), 2 vCPU / 4Gi by default |
| Database | Cloud SQL for PostgreSQL 15 | Server auto-migrates its own schema on boot; no separate migrate job |
| Pipeline execution | GKE Autopilot, via a namespace-scoped RBAC `Role` | The agent dynamically creates a Kubernetes Pod (plus PVCs/Services/Secrets as needed) for every pipeline step, in the SAME namespace the agent itself runs in |
| Secrets | Secret Manager | One secret: `WOODPECKER_AGENT_SECRET`, authenticating the co-located server↔agent gRPC connection |
| Forge (git host) | none provisioned — external | Placeholder Gitea/Forgejo values by default; point at a real instance post-deploy |
| Ingress | Cloud Load Balancing | `LoadBalancer` by default; the reference deployment used `ClusterIP` due to exhausted external-IP quota (see §6) |

**Sensible defaults worth knowing up front:**

- **Server and agent are co-located in one pod, not two.** Upstream Woodpecker
  ships the server and agent as two separate images (docker-compose runs them
  as two containers). This module grafts the agent binary onto the server
  image and starts it as a background process before `exec`-ing the server —
  necessary because the agent's Kubernetes backend must run under the SAME
  Kubernetes ServiceAccount that holds the elevated RBAC this module grants,
  and GKE's generic `additional_services` mechanism does not run sidecar
  Deployments under the main app's own ServiceAccount (only the primary
  Deployment does).
- **The agent needs elevated in-cluster RBAC.** `Woodpecker_GKE`'s
  `woodpecker.tf` provisions a namespace-scoped `kubernetes_role_v1` +
  `kubernetes_role_binding_v1` directly (no `App_GKE` foundation change was
  needed). See §3 for the full detail.
- **No `:latest` tag exists upstream, by design.** Confirmed live:
  `docker run woodpeckerci/woodpecker-server:latest` just prints a
  tag-schema notice and exits — a deliberate anti-accidental-major-upgrade
  measure. `application_version = "latest"` resolves internally to a pinned
  `v3.16.0`.
- **Both upstream images are genuinely distroless.** Confirmed via `docker
  export`: the entire rootfs is the single binary plus `/etc/passwd,group,
  hosts` — no shell at all. The custom image grafts a static `busybox:musl`
  binary (the default `busybox:stable` tag is dynamically linked and fails
  in this libc-less rootfs) so the cloud entrypoint can run.
- **The server hard-requires a forge to boot at all.** Confirmed live:
  omitting forge configuration is a fatal exit ("forge not configured"), not
  a degraded empty page. This module defaults to placeholder Gitea/Forgejo
  values so it deploys cleanly; real pipeline triggers need a real forge
  registered post-deploy (§6).
- **Single instance, non-negotiable.** `max_instance_count` is hard-capped at
  `1` by a plan-time validation — each pod runs a co-located server+agent,
  and Woodpecker's server has no documented/verified multi-instance
  coordination for its own database-backed state.
- **Health endpoint:** `GET /healthz`, confirmed live to return `204 No
  Content`, unauthenticated.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Woodpecker workload

A single pod runs both the server and the agent (Deployment by default).

- **Console:** Kubernetes Engine → Workloads → select the Woodpecker
  workload to see the pod and events.
- **CLI:**
  ```bash
  kubectl get deployment,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot scheduling and Workload Identity
work.

### B. Cloud SQL — PostgreSQL 15

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
```

No separate migrate job runs — confirmed live: Woodpecker's server
auto-migrates its own schema on boot ("Initializing Schema" appears
automatically against an empty database). Only a `db-init` job (role +
database creation) runs on first deploy.

### C. Secret Manager — one secret

```bash
gcloud secrets list --project "$PROJECT" --filter="name~agent-secret"
gcloud secrets versions access latest --project "$PROJECT" --secret=<secret-name>
```

`WOODPECKER_AGENT_SECRET` authenticates the co-located server's and agent's
internal gRPC connection to each other. See
[Woodpecker_Common §2](Woodpecker_Common.md#2-woodpecker_agent_secret--the-one-generated-secret)
for detail.

### D. RBAC — the agent's pipeline-execution permissions

```bash
kubectl get role,rolebinding -n "$NAMESPACE"
kubectl describe role <resource-prefix> -n "$NAMESPACE"
```

A namespace-scoped `Role` grants `{persistentvolumeclaims, services,
secrets: create, delete}`, `{pods: watch, create, delete, get, list}`, and
`{pods/log: get}` — sourced from Woodpecker's own official Helm chart RBAC
template, not guessed. The `RoleBinding` subject is the pod's own Kubernetes
ServiceAccount, bound by name. See
[Woodpecker_Common §6](Woodpecker_Common.md#6-kubernetes-execution-backend)
and §3 below for the full mechanism.

### E. Networking & ingress

```bash
kubectl get svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT"
```

`service_type` defaults to `LoadBalancer` (external), matching the Foundation
default. Forge webhooks need to reach this server from the internet for
pipelines to trigger automatically — see §6 for the reference deployment's
`ClusterIP` deviation and when to flip it back.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flows to Cloud Logging; GKE metrics flow to Cloud
Monitoring.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

An `uptime_check_config` is available, disabled by default, targeting
`/healthz`.

---

## 3. Woodpecker Application Behaviour

- **Co-located server + agent, one container.** `entrypoint.sh` starts the
  agent as a background process, then `exec`s the server into the
  foreground:
  ```sh
  if [ "${1:-}" = "/bin/woodpecker-server" ]; then
    /bin/woodpecker-agent &
  fi
  exec "$@"
  ```
  This is necessary because GKE's generic `additional_services` mechanism
  runs a sidecar Deployment under the namespace's default ServiceAccount,
  not the main app's own Kubernetes ServiceAccount — and the agent's
  Kubernetes backend must run as the identity the RBAC `Role`/`RoleBinding`
  below actually grants permissions to.
- **RBAC, bound by ServiceAccount name only.** Confirmed live via `kubectl
  get deployment -o jsonpath='{.spec.template.spec.serviceAccountName}'`:
  `App_GKE` names the pod's KSA after the **tenant-scoped** resource prefix
  (e.g. `gkee6a1e84d`) even though the KSA lives inside the **app-scoped**
  namespace (e.g. `woodpeckergkee6a1e84d`). The `RoleBinding` subject uses
  that tenant-scoped name. This required its own `provider "kubernetes" {}`
  block (`Woodpecker_GKE/provider-auth.tf`) — `App_GKE`'s own internal
  Kubernetes provider configuration is private to that module and isn't
  inherited by the calling Application module.
- **Pipeline pods run in the agent's own namespace.**
  `WOODPECKER_BACKEND_K8S_NAMESPACE` is set to the pod's actual app-scoped
  namespace, so the RBAC grant is a namespaced `Role`, not a cluster-wide
  `ClusterRole`.
- **Forge configuration is required to boot, not just to log in.** Confirmed
  live: the server exits fatally ("forge not configured") if no forge is
  set — this is unlike some other apps in this catalogue (e.g. Outline) that
  boot fine with zero auth providers and just show an empty login page.
  Placeholder Gitea/Forgejo values (`WOODPECKER_GITEA_URL`,
  `WOODPECKER_GITEA_CLIENT`, `WOODPECKER_GITEA_SECRET` — plain env vars, not
  Secret-Manager-backed) let the module deploy cleanly out of the box; an
  operator must swap them for a real registered OAuth application on an
  actual Gitea/Forgejo instance post-deploy.
- **Health path.** Both probes target `GET /healthz`, confirmed live to
  return `204 No Content`, unauthenticated.
- **Ports.** `8000` is the real HTTP port (confirmed via `docker inspect`);
  `9000` is the agent's internal gRPC connection to the server, never
  exposed via the Kubernetes Service since both processes share one pod.
- **Single-writer, single-instance.** `max_instance_count` is hard-capped at
  `1` at plan time — Woodpecker's server has no documented/verified
  multi-instance coordination for its own database-backed state.
- **Updates recreate the pod.** A version bump rebuilds the custom image
  (server + agent + busybox, re-grafted) and recreates the single pod.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Woodpecker are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults. See `modules/Woodpecker_GKE/README.md` for the exhaustive,
group-by-group input reference.

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

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `woodpecker` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Resolves internally to a pinned `v3.16.0` — Woodpecker publishes no `latest` tag. |
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `display_name` / `description` | (stale, see §7) | Left over from this module's Immich clone source — do not trust the shipped text; the values describe photo/video management, not Woodpecker CI. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU limit for the co-located server+agent container. |
| `memory_limit` | `4Gi` | Memory limit for the co-located server+agent container. |
| `container_port` | `8000` | Confirmed via `docker inspect` of the real `v3`-tagged image. |
| `min_instance_count` | `1` | |
| `max_instance_count` | `1` | **Hard-capped by plan-time validation** — see §3. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy Unix socket sidecar. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |
| `forge_url` | `http://forgejo.example.internal` | Placeholder. Point at a real Gitea/Forgejo instance post-deploy — see §6. |
| `forge_client_id` / `forge_client_secret` | `placeholder-client-id` / `placeholder-client-secret` | Placeholder OAuth application credentials. |
| `admin_username` | `admin` | Forge username(s) granted Woodpecker admin rights on first login. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain-text settings, merged over the module's forge/backend defaults. |
| `secret_environment_variables` | `{}` | Additional Secret Manager references injected as env vars. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | The reference deployment used `ClusterIP` due to exhausted quota — see §6. |
| `workload_type` | `null` | Always resolves to `Deployment` for this module (no `stateful_pvc_enabled` use case). |
| `termination_grace_period_seconds` | `60` | Seconds after SIGTERM before SIGKILL. |

### Group 7 — StatefulSet

Not used by this module — Woodpecker's state lives entirely in Cloud SQL, and
there is no per-pod filesystem state to persist via a PVC.

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | Confirmed live: `204 No Content`, unauthenticated. |
| `uptime_check_config` | disabled | If enabled, targets `/healthz`. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Empty default resolves to `Woodpecker_Common`'s single `db-init` job — Woodpecker migrates its own schema on boot, so no separate migrate job exists. |
| `cron_jobs` | `[]` | Kubernetes CronJobs. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Stale default and description**, left over from this module's Immich clone source — Woodpecker CI has no media library and no functional use for NFS. See §7. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the default `data` bucket — unused by Woodpecker. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `db_name` | `woodpecker_db` | |
| `db_user` | `woodpecker_user` | |
| `database_type` | fixed `POSTGRES_15` by `Woodpecker_Common` | Inert mirror on this module's own `database_type` variable. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Gateway for a custom hostname. |
| `reserve_static_ip` | `true` | The reference deployment used `false` due to exhausted quota — see §6. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Requires custom domain and both OAuth credentials, validated at plan time. |

### Group 21 — Redis & Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Not confirmed to be functionally required** — `Woodpecker_Common`'s entrypoint never reads `REDIS_HOST`/`REDIS_PORT`. See §7. |

### Groups 8, 9, 12, 17, 18, 22

Standard `App_GKE` behaviour — Resource Quota, Reliability Policies, CI/CD &
Binary Authorization, Backup & Maintenance, Custom SQL (not applicable), VPC
Service Controls. See [App_GKE](App_GKE.md).

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP / external LoadBalancer IP (when reserved). |
| `web_url` | Reads `additional_service_urls["web"]` — **resolves `null`** on a stock deployment, since no `"web"` additional service is wired by default. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Cloud SQL identity and connection details. |
| `storage_buckets` | Created Cloud Storage buckets (the default `data` bucket — unused). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Created initialization job names (the default `db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates
> values and combinations at plan time. `Woodpecker_GKE`'s own
> `validation.tf` additionally rejects `max_instance_count > 1` and
> `enable_iap = true` without both OAuth credentials.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Forge configuration (`forge_url`/`forge_client_id`/`forge_client_secret`) | Replace all three with a real registered OAuth application on a real Gitea/Forgejo instance post-deploy | **High** | The server boots and reports healthy with the placeholder values, but pipelines never trigger and forge login never works — a working-looking deployment that is not actually usable for CI. |
| `service_type` / `reserve_static_ip` | `LoadBalancer` / `true` once external IP quota allows | **High** | The reference deployment used `ClusterIP` / `false` purely because the test project's `IN_USE_ADDRESSES` quota was exhausted. Forge webhooks (push/PR events) need to reach this server from the internet — a `ClusterIP` deployment cannot receive them and pipelines will not auto-trigger. |
| `max_instance_count` | `1` (enforced at plan time) | **Critical** | Each pod runs a co-located server+agent; more than one replica would run multiple servers against the same database with no verified coordination. |
| Health probes | Leave as HTTP `/healthz` (module default) | **Medium** | `/healthz` is confirmed unauthenticated and returns `204`; pointing a probe at an authenticated endpoint would wedge the rollout. |
| `enable_nfs` | Leave default or verify against actual need — description text is misleading | **Low** | Description references a "photo/video library" that doesn't exist in Woodpecker CI; if `true`, an unused NFS mount is provisioned into the pod at an Immich-derived path with no functional effect, but it is not free — see Notes in `modules/Woodpecker_GKE/README.md`. |
| `enable_redis` | Leave default; not confirmed required | **Low** | Description claims Redis is "REQUIRED", but `Woodpecker_Common`'s entrypoint never reads `REDIS_HOST`/`REDIS_PORT` — this appears to be inert leftover from the module's clone source, not verified Woodpecker CI behaviour. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, and image mirroring — see
**[App_GKE](App_GKE.md)**. Woodpecker-specific application configuration is
described in **[Woodpecker_Common](Woodpecker_Common.md)**.
