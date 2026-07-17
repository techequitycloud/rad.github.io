---
title: "Excalidraw on GKE Autopilot"
description: "Configuration reference for deploying Excalidraw on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Excalidraw on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Excalidraw_GKE.png" alt="Excalidraw on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Excalidraw is an open-source (MIT) virtual whiteboard for sketching hand-drawn-style
diagrams, wireframes, and quick collaborative drawings. The self-hosted distribution
is a **static single-page application served by nginx** — there is no backend,
database, or user accounts, and drawings are stored in the visitor's own browser. This
module deploys that static frontend on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services Excalidraw uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, and the deployment lifecycle — refer to
the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Excalidraw runs as a single stateless nginx web workload. Because the app has no
backend, the deployment wires together only a minimal set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Static nginx pods on **port 80**, horizontally autoscaled; billed for requested CPU/memory |
| Container image | Artifact Registry | Thin custom build `FROM excalidraw/excalidraw`, mirrored into the project registry |
| Database | _None_ | Excalidraw has no backend — no Cloud SQL instance is created |
| Object storage | _None_ | No GCS bucket is provisioned; drawings live in the browser |
| Cache & queue | _None_ | No Redis, no message queue |
| Secrets | _None_ | No encryption keys, JWT secrets, or DB passwords — Secret Manager is unused |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **Fully stateless — no data is stored server-side.** Drawings persist in each
  browser's local storage and are exported/imported as `.excalidraw` files. Pod
  rescheduling, redeploys, and scaling lose **no** server data because there is none.
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero) to keep the
  whiteboard always reachable. The wrapper pins `min_instance_count = 1`.
- **Deployment workload, not StatefulSet.** There is no per-pod persistent volume —
  every pod serves the same static bundle, so a plain `Deployment` is used and pods are
  fully interchangeable.
- **Fixed port 80.** The nginx listener is baked into the image; `container_port`
  defaults to 80 and should not be changed.
- **No Cloud SQL, Secret Manager, Redis, NFS, or GCS.** The corresponding foundation
  features are inert for this app — enabling them provisions unused infrastructure.
- **External LoadBalancer by default** so the whiteboard is browser-reachable; a
  reserved static IP keeps the address stable across redeploys.
- **Vestigial `homeserver_url` / `homeserver_name` inputs.** Carried over from the
  Element template and injected as `HOMESERVER_URL` / `HOMESERVER_NAME`; the Excalidraw
  static SPA ignores them. Leave them at their defaults.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Excalidraw workload

Excalidraw pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
(`1`) and maximum replica counts. Because every pod is identical and stateless, scaling
out is safe with no coordination.

- **Console:** Kubernetes Engine → Workloads → select the Excalidraw workload for pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100      # nginx access/error logs
  kubectl describe hpa -n "$NAMESPACE"                                # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type are managed.

### B. Artifact Registry — the container image

The Excalidraw image is a thin custom build `FROM excalidraw/excalidraw` that Cloud
Build produces and pushes into the project's Artifact Registry (`enable_image_mirroring
= true`). App_GKE sets `imagePullPolicy=Always` for custom-built/mirrored images so a
rebuilt tag is always re-pulled.

- **Console:** Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --include-tags
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  # Confirm the digest running in the cluster matches the freshly built image:
  kubectl get pod -n "$NAMESPACE" -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
  ```

### C. Database, Secret Manager, Cloud Storage, Redis — not used

Excalidraw provisions **none** of these. There is no Cloud SQL instance, no Secret
Manager secret, no GCS bucket, and no Redis for this deployment. The following will
return empty results for the app — that is expected:

```bash
gcloud sql instances list --project "$PROJECT" --filter="name~excalidraw"   # (none)
gcloud secrets list --project "$PROJECT" --filter="name~excalidraw"          # (none)
gcloud storage buckets list --project "$PROJECT" --filter="name~excalidraw"  # (none)
```

Multi-user real-time collaboration (a live shared canvas) requires a separate
`excalidraw-room` WebSocket server, which this module does **not** deploy.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom
domain with a Google-managed certificate can be enabled, and a static IP can be reserved
so the address survives redeploys. Cloud CDN is a good fit for the static assets.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr (nginx logs) flow to Cloud Logging; GKE metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available; a public root-path
uptime check is a natural health signal for the static frontend.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Excalidraw Application Behaviour

- **No first-deploy setup.** There is no database, no init job, and no migrations. A pod
  is Ready as soon as nginx starts serving the static bundle — usually within a second
  or two.
- **No accounts, no login, no server persistence.** The self-hosted frontend has no
  authentication and stores nothing server-side. Each user's drawings live in **their
  own browser's local storage**; use **Export** (`.excalidraw`, PNG, or SVG) to save or
  share work.
- **Pods are interchangeable.** Every replica serves the identical static bundle, so
  requests need no session affinity and scaling out requires no coordination — unlike
  the stateful application modules.
- **Real-time collaboration is not included.** The live "shareable link" collaboration
  feature depends on a separate `excalidraw-room` WebSocket service that this module
  does not deploy. Single-user editing works out of the box.
- **Health path.** Startup and liveness probes target the root `/`, which nginx answers
  with `200` immediately. Verify from inside the cluster or via the LoadBalancer IP:
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 8080:80
  curl -sI http://localhost:8080/ | head -1        # expect: HTTP/1.1 200 OK
  ```
- **Version upgrades are a rebuild + redeploy.** Bumping `application_version` rebuilds
  the image from a new `excalidraw/excalidraw` tag and rolls out new pods; because there
  is no state, upgrades and rollbacks are trivial and non-destructive.
- **Vestigial env vars.** `HOMESERVER_URL` / `HOMESERVER_NAME` are injected (Element
  carry-over) but ignored by the static SPA. Confirm/inspect env with:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep HOMESERVER
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Excalidraw are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `excalidraw` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Excalidraw image tag. Unlike DokuWiki/EspoCRM, `latest` does **not** resolve to a pinned known-good tag — `Excalidraw_Common`'s `pinned_excalidraw_version` local is itself `"latest"`, so the build always tracks Docker Hub's rolling `excalidraw/excalidraw:latest` tag. Set an explicit tag (e.g. `v1.11.86`) to actually pin a production release. |
| `homeserver_url` / `homeserver_name` | `""` | **Vestigial** Element carry-over — ignored by the Excalidraw SPA. Leave blank. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Keep `custom` — the thin build mirrors the static image into Artifact Registry. |
| `container_port` | `80` | nginx listener port; baked into the image — do not change. |
| `container_resources` | `cpu_limit=500m`, `memory_limit=512Mi` | A static file server needs little; the request drives Autopilot billing. |
| `min_instance_count` | `1` | Forced to `1` by the wrapper — GKE has no scale-to-zero; keeps the whiteboard reachable. |
| `max_instance_count` | `3` | Maximum replicas; safe to raise since pods are stateless. |
| `enable_image_mirroring` | `true` | Mirror the Excalidraw image into Artifact Registry. |

All other inputs follow standard App_GKE behaviour.

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain-text env vars. The static SPA reads none at runtime; overrides are rarely useful. |
| `secret_environment_variables` | `{}` | Unused — Excalidraw needs no secrets. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Exposes an external IP so the whiteboard is browser-reachable. |
| `workload_type` | `null` (resolves to `Deployment`) | Stateless — pods are interchangeable. Left `null`, App_GKE resolves it to `Deployment` because `stateful_pvc_enabled` also defaults to `null`/`false` for Excalidraw; explicitly setting `stateful_pvc_enabled = true` would auto-resolve this to `StatefulSet` instead (unnecessary for Excalidraw). |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet / Groups 13–16 — NFS, Storage, Redis, Database

These groups are **inert** for Excalidraw: there is no per-pod PVC to template
(`stateful_pvc_enabled` should stay `false`), no NFS, no GCS bucket, no Redis, and no
database (`database_type = NONE`). Leaving them at their defaults provisions no unused
infrastructure. All other inputs follow standard App_GKE behaviour.

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Put Google sign-in in front of Excalidraw to restrict who can reach the whiteboard. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access when IAP is enabled. |

All other inputs follow standard App_GKE behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources. Storage/database/secret outputs are present for
interface parity with other modules but resolve to empty values here.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Excalidraw. |
| `storage_buckets` | Created Cloud Storage buckets — empty for Excalidraw. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Setup job names — empty for Excalidraw. |
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
> [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at
> plan time — an out-of-range port, a StatefulSet without a PVC, IAP with no authorized
> identities, memory quota values without binary unit suffixes. Invalid configuration
> fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `container_port` | `80` | High | The image's nginx listens only on 80; a mismatched port means the startup probe never passes and the pod never becomes Ready. |
| `container_image_source` | `custom` | High | Switching to `prebuilt` without a mirrored image fires `build_and_push_application_image` with no Dockerfile / points at an unbuilt path. |
| `min_instance_count` | N/A — hardcoded to `1` | Low | `excalidraw.tf` always overrides the config to `min_instance_count = 1` regardless of this variable's value (there is no plan-time guard rejecting `0` — App_GKE itself permits `0` for scale-to-zero-capable apps). Setting this variable to `0` has no effect and will not reduce cost; a resident pod keeps the whiteboard reachable at all times. |
| `service_type` | `LoadBalancer` | Medium | `ClusterIP` makes Excalidraw unreachable from outside the cluster. |
| `application_version` | pin in production | Medium | `latest` floats — a new upstream tag can change UI/behaviour on the next rebuild. Pin a release. |
| `stateful_pvc_enabled` / `enable_redis` / database inputs | leave default (off) | Low | Enabling them provisions PVCs/Redis/Cloud SQL that Excalidraw never uses — wasted cost, no benefit. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Medium | Bare integers are treated as bytes and block all pod scheduling in the namespace (only relevant if you enable resource quotas). |
| `homeserver_url` / `homeserver_name` | leave blank | Low | Vestigial Element inputs; setting them has no effect on the Excalidraw SPA. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud CDN, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see **[App_GKE](App_GKE.md)**.
Excalidraw-specific application configuration shared with the Cloud Run variant is
described in **[Excalidraw_Common](Excalidraw_Common.md)**.
