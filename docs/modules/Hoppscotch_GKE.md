---
title: "Hoppscotch on GKE Autopilot"
description: "Configuration reference for deploying Hoppscotch on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Hoppscotch on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hoppscotch_GKE.png" alt="Hoppscotch on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hoppscotch is an open-source, Postman-style API development platform for designing,
sending, and inspecting HTTP, GraphQL, and WebSocket requests from the browser. This
module deploys the **self-hosted Hoppscotch frontend** as a stateless single-page app
on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Hoppscotch uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Hoppscotch runs as a static single-page web app (served by Caddy) in a Deployment on
GKE Autopilot. It is deliberately **stateless** — no database, no cache, no persistent
storage — so the deployment wires together a small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Static SPA pods on port 3000; horizontally autoscaled; min 1 replica |
| Container image | Artifact Registry + Cloud Build | Thin custom build `FROM hoppscotch/hoppscotch-frontend`, mirrored into Artifact Registry |
| Ingress | Cloud Load Balancing | External LoadBalancer Service with a reserved static IP by default |
| Secrets | Secret Manager | **None app-specific** — Hoppscotch requires no secrets |
| Observability | Cloud Logging & Monitoring | Pod logs, GKE metrics, optional uptime check and alerts |

Services that are deliberately **not** used: **Cloud SQL** (`database_type = "NONE"`,
enforced by a plan-time guard), **Cloud Storage** (no buckets), and **Redis** (off by
default; the static frontend has no server-side rate-limiting or queue to back).

**Sensible defaults worth knowing up front:**

- **No database, ever — and it is enforced.** `database_type = "NONE"` and
  `enable_cloudsql_volume = false`. A plan-time precondition (`validation.tf`) **fails
  the plan** if `database_type` is set to anything other than `NONE`, so an operator
  cannot accidentally provision an unused Cloud SQL instance. Hoppscotch keeps all
  state in **browser local storage**.
- **The frontend-only image is used on purpose.** The all-in-one
  `hoppscotch/hoppscotch` image bundles a NestJS backend that `exit(1)`s without a
  `DATABASE_URL`. This module uses `hoppscotch/hoppscotch-frontend`, which serves the
  SPA on port 3000 with no backend requirement.
- **`HOPPSCOTCH_VERSION`, not `APP_VERSION`, pins the image.** A custom build sets an
  app-specific `HOPPSCOTCH_VERSION` ARG so the Foundation's injected `APP_VERSION`
  does not overwrite the tag; `application_version = "latest"` resolves to a pinned,
  known-good tag at build time.
- **A LoadBalancer with a reserved static IP is the default.** `service_type =
  "LoadBalancer"` and `reserve_static_ip = true`, so the external address survives
  redeploys.
- **Minimum 1 replica is maintained** (`min_instance_count = 1`; GKE does not support
  scale-to-zero), keeping the SPA always reachable. `max_instance_count = 3` by
  default and is safe to raise — there is no shared state to coordinate.
- **A stateless Deployment, not a StatefulSet.** `workload_type` is unset (resolves to
  `Deployment`) and `stateful_pvc_enabled` is unset; the SPA needs no per-pod volume.
- **`session_affinity = "None"`.** The static bundle is identical on every pod, so
  sticky routing is unnecessary.
- **No secrets and no storage buckets** are provisioned by this module.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Hoppscotch workload

Hoppscotch pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the Deployment between the minimum
(`1`) and maximum replica counts. The container listens on **port 3000** and answers
`GET /` with the app UI (HTTP 200).

- **Console:** Kubernetes Engine → Workloads → select the Hoppscotch workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Container image — Artifact Registry & Cloud Build

Because `container_image_source = "custom"`, the image is built by Cloud Build from
the thin `Dockerfile` (`FROM hoppscotch/hoppscotch-frontend:${HOPPSCOTCH_VERSION}`)
and pushed to Artifact Registry (image mirroring is on by default). Custom/mirrored
images are pulled with `imagePullPolicy=Always` on GKE so a rebuilt tag is never
served stale from a node cache.

- **Console:** Artifact Registry → Repositories; Cloud Build → History.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT" \
    --include-tags --filter="package~hoppscotch"
  # Confirm the image the running pod actually pulled:
  kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].spec.template.spec.containers[0].image}'
  ```

### C. Secret Manager

Hoppscotch provisions **no application secrets** — `secret_ids` is empty, so no
Secret Store CSI volumes are mounted for this module. You can still map your own
env-var-to-secret references through `secret_environment_variables` if you extend the
deployment, but nothing is required.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hoppscotch"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = "LoadBalancer"`), and a static IP is reserved
(`reserve_static_ip = true`) so the address survives redeploys. A custom domain with a
Google-managed certificate can be enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"                       # EXTERNAL-IP of the LoadBalancer
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks (against the LoadBalancer host) and alert policies are
available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Hoppscotch Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job, no Cloud SQL
  instance, and no schema. Pods serve a static bundle immediately.
- **No server-side persistence.** Collections, environments, request history, and
  settings live in **browser local storage** on each user's machine. Rolling pods,
  scaling, or redeploying loses no user data — there is none on the server to lose.
  Because the SPA is stateless, the default `RollingUpdate` strategy is safe (no shared
  NFS/DB lock to deadlock on).
- **No immutable keys.** With no secrets and no database, there is no cryptographic
  material that could corrupt stored data if changed.
- **Health path.** Startup and liveness probes target the root `/`, which returns the
  app UI (HTTP 200) as soon as Caddy binds port 3000 — typically within seconds. A
  failing probe almost always means the image tag is invalid, not that a backend is
  unreachable.
- **No first-run admin account.** The self-hosted frontend has no login or user
  management of its own; browse to the LoadBalancer IP and start building requests.
  (Team workspaces, which require the backend + database, are intentionally out of
  scope for this module.)
- **Scaling is unconstrained.** With no shared queue or database, any number of pods
  run independently — raise `max_instance_count` freely as a throughput ceiling.
- **Verify the running workload:**
  ```bash
  kubectl get deploy,pods -n "$NAMESPACE"
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -sS -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Hoppscotch are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `hoppscotch` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Hoppscotch image tag; `latest` resolves to a pinned known-good `hoppscotch-frontend` tag at build time. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision supporting infrastructure only. |
| `container_image_source` | `custom` | Thin custom build `FROM hoppscotch/hoppscotch-frontend`. Keep `custom`. |
| `container_port` | `3000` | The port the frontend SPA listens on. |
| `min_instance_count` | `1` | Minimum replicas; GKE has no scale-to-zero, so keep ≥ 1. |
| `max_instance_count` | `3` | Maximum replicas; safe to raise (no shared state). |
| `enable_cloudsql_volume` | `false` | Hoppscotch has no database — leave `false`. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry (avoids Docker Hub limits). |

All other inputs follow standard App_GKE behaviour.

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Optional extra plain-text env vars. None are required. |
| `secret_environment_variables` | `{}` | Optional env var → Secret Manager references. None are required. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External LoadBalancer exposes the SPA. |
| `workload_type` | `null` (→ `Deployment`) | Stateless Deployment; no StatefulSet needed. |
| `session_affinity` | `None` | The static bundle is identical on every pod; no stickiness required. |
| `reserve_static_ip` | `true` | Keep a stable external IP across redeploys. |
| `namespace_name` | `""` | Kubernetes namespace for the workload. Auto-generated from `application_name` and `tenant_deployment_id` when empty. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave unset — Hoppscotch is stateless and needs no per-pod PVC. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Off by default. The static frontend has no server-side queue or rate limiter, so leave disabled. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only relevant if you wire Redis in for a custom purpose. |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | **Must stay `NONE`.** A plan-time guard fails the plan if set to any engine. |

All other inputs follow standard App_GKE behaviour.

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
| `service_external_ip` | External LoadBalancer IP (a static IP is reserved by default). |
| `service_url` | URL to reach Hoppscotch. |
| `storage_buckets` | Created Cloud Storage buckets (empty — Hoppscotch is stateless). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of setup jobs (empty — no DB bootstrap). |
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

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_GKE](App_GKE.md) foundation engine plus a Hoppscotch-specific guard
> (`validation.tf`), which validates values *and combinations* at plan time —
> `database_type` other than `NONE`, `min_instance_count > max_instance_count`, IAP
> enabled with no OAuth credentials, `quota_memory_*` without binary unit suffixes.
> Invalid configuration fails the **plan** with a clear, named error before any
> resource is created, so most mistakes below are caught up front rather than at apply
> or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `NONE` | High | Any other engine fails the plan (guard); if it slipped through it would provision an unused, billed Cloud SQL instance. |
| `container_image_source` | `custom` | High | Switching to `prebuilt` fires the build path with no usable image and leaves pods pulling a non-existent tag. |
| `application_version` | `latest` or a real `hoppscotch-frontend` tag | High | An invalid tag makes the Cloud Build fail; pods then `ImagePullBackOff` or serve a stale image. |
| `container_port` | `3000` | High | The frontend serves only on 3000; a mismatched port fails the startup probe and pods never become Ready. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects `0`. Keeping 1 keeps the SPA reachable. |
| `enable_cloudsql_volume` | `false` | Medium | Enabling it adds an Auth Proxy sidecar for a database that does not exist — wasted cost and a needless dependency. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `session_affinity` | `None` | Low | Stickiness is unnecessary for an identical static bundle; enabling it only limits load spreading. |
| `enable_redis` | `false` | Low | The static frontend has no server-side queue; enabling Redis adds cost with no benefit. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Hoppscotch-specific application configuration shared with the Cloud Run variant is
described in **[Hoppscotch_Common](Hoppscotch_Common.md)**.
