---
title: "Loki on GKE Autopilot"
description: "Configuration reference for deploying Loki on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Loki on GKE Autopilot

Grafana Loki is a horizontally-scalable, highly-available log aggregation system —
often described as "Prometheus for logs." Unlike full-text log indexers, Loki
indexes only a small set of labels per log stream rather than the full text of every
line, which keeps storage and operating costs low. It is normally queried with
**LogQL** through **Grafana** (as a datasource) or the **LogCLI** tool, with an
agent such as **Promtail** or **Grafana Alloy** shipping logs into it. This module
deploys **Loki itself, not Grafana**, on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Loki uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Loki runs as a single Go binary pod, in **monolithic mode** (`-target=all`, Loki's
default, which runs every internal component — distributor, ingester, querier,
compactor — in one process). The deployment wires together a narrow, GCS-centric
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go binary pod, 1 vCPU / 512Mi by default, `Deployment` workload type |
| Object storage | Cloud Storage | A single `storage` bucket — Loki's actual object-storage backend for chunks and the shipped TSDB index, not incidental file storage |
| Secrets | Secret Manager | None generated — `Loki_Common` declares `secret_ids = {}` |
| Ingress | Cloud Load Balancing | `service_type = "LoadBalancer"` by default; optional custom domain + static IP |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** Loki's durable state (chunks, TSDB index) lives
  entirely in a GCS bucket. `database_type = "NONE"` and `enable_redis` has no
  effect on Loki's own config.
- **`max_instance_count` is effectively pinned to `1`.** `Loki_Common` overrides
  `max_instance_count = 1` in the config it hands to `App_GKE`, regardless of the
  value passed in. Loki's compactor (retention/deletion) is a true singleton and the
  baked config uses an **in-memory ring** (`common.ring.kvstore.store: inmemory`)
  with `replication_factor: 1`, which cannot coordinate across multiple replicas.
- **Single-tenant, no auth.** The baked config sets `auth_enabled: false`. There is
  no per-tenant isolation and no built-in authentication — Loki's HTTP API is
  reachable by anyone who can reach the LoadBalancer IP, subject to
  `service_type`/ingress configuration.
- **`workload_type = "Deployment"`, not `"StatefulSet"`.** Loki's durable state is
  GCS, not local disk, so a per-pod block PVC is not required for correctness (a
  `StatefulSet` option exists via `stateful_pvc_enabled` for local index-cache
  durability, but is not the default).
- **`service_type = "LoadBalancer"`** exposes Loki externally by default, so
  log-shipping clients outside the cluster (or even outside the project) can reach
  it. Set `reserve_static_ip = true` (the default) for a stable address across
  redeploys.
- **Config-file driven, not env-var driven.** Loki's storage/schema settings live
  entirely in a config file baked into the image; only the GCS bucket name is
  templated in at pod start via the `LOKI_GCS_BUCKET` environment variable.
- **No init jobs.** `initialization_jobs` defaults to `[]` — Loki has nothing to
  bootstrap.
- **Custom-built, distroless-based image.** See [§4](#4-loki-application-behaviour)
  and [§7](#7-configuration-pitfalls--sensible-defaults) for why the Dockerfile in
  this module looks unusual.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#6-outputs).

### A. GKE Autopilot — the Loki workload

Loki runs as a single pod on Autopilot, deployed as a `Deployment` by default.
Because `max_instance_count` is effectively pinned to `1`, this workload does not
horizontally fan out — its "scaling" is really about resource sizing (`cpu_limit`,
`memory_limit`), not replica count.

- **Console:** Kubernetes Engine → Workloads → select the Loki workload for pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external
  IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud Storage — Loki's object storage backend

A dedicated `storage` GCS bucket is Loki's actual storage backend, not an optional
extra. Loki writes compressed log chunks and the shipped TSDB index shards into it
directly via its native `gcs` storage client (Application Default Credentials — the
GKE Workload Identity SA is granted `roles/storage.objectAdmin` on the bucket).

- **Console:** Cloud Storage → Buckets → select the `storage` bucket.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/                 # top-level layout
  gcloud storage ls gs://<storage-bucket>/index_*/          # TSDB index shards (schema prefix "index_")
  gcloud storage du -s gs://<storage-bucket>/                # total bytes stored
  ```
  Chunk objects and index shards accumulate under the bucket root and `index_*`
  prefixes respectively, per the `schema_config` baked into the image (`schema:
  v13`, `index.prefix: index_`, `index.period: 24h`).

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts (not used by Loki's
own storage path, which is native GCS API access, not a mounted filesystem).

### C. Secret Manager

No secrets are generated for Loki — `Loki_Common` declares `secret_ids = {}` and
`secret_values = {}`. Any secrets you add via `secret_environment_variables` are
your own operator-supplied values (e.g. if you front Loki with a reverse-proxy auth
layer).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### D. Networking & ingress

By default the workload is exposed through an external `LoadBalancer` Service IP
(`service_type = "LoadBalancer"`), so log-shipping clients outside the cluster can
push logs in. A custom domain with a Google-managed certificate can be enabled, and
`reserve_static_ip = true` (the default) keeps the address stable across redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr (Loki's own process logs, not the logs it *ingests*) flow to
Cloud Logging; GKE metrics flow to Cloud Monitoring.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Querying Loki

This module deploys Loki with **no built-in web UI** — Loki is a headend for logs,
queried through LogQL. Two common ways to query it once deployed:

- **`logcli`** (Grafana's official CLI), pointed at the external service address:
  ```bash
  export LOKI_ADDR="http://<external-ip>:3100"
  logcli labels                                             # discover available labels
  logcli query '{job="myapp"}' --limit=50                   # LogQL query
  ```
- **Direct HTTP** against the query API:
  ```bash
  curl -s "http://<external-ip>:3100/loki/api/v1/query?query=%7Bjob%3D%22myapp%22%7D" | jq .
  ```
- **As a Grafana datasource** — add a Loki datasource in Grafana pointing at the
  external LoadBalancer address; this is the normal production pattern for exploring
  and dashboarding ingested logs.

---

## 4. Loki Application Behaviour

- **Config templating at pod start, not database migrations.** `Loki_Common` bakes a
  config template into the image with a single placeholder, `__LOKI_GCS_BUCKET__`.
  The container entrypoint substitutes the real bucket name (injected as the
  `LOKI_GCS_BUCKET` env var) with `sed` and writes the result to
  `/etc/loki/local-config.yaml` before Loki starts — there is no first-boot schema
  step to wait on.
- **No init jobs needed.** Loki has no database to bootstrap, so
  `initialization_jobs` is empty by default and this module never injects one.
- **Health path is `/ready`.** Both the startup and liveness probes target Loki's
  built-in, unauthenticated readiness endpoint, which returns HTTP 200 once the
  server is listening — typically within seconds.
- **Monolithic mode.** `-target=all` runs every Loki component in the single
  process — the right shape for a small/medium single-tenant deployment.
- **Single-instance scaling constraint.** The in-memory ring and singleton
  compactor mean Loki here is not designed to run more than one instance
  concurrently. `Loki_Common` enforces this by pinning `max_instance_count = 1` in
  the config it passes to the Foundation, regardless of what the platform input is
  set to.
- **`workload_type` and durability.** `Deployment` is the default and is sufficient
  — Loki's durable state is GCS, not local disk. A `StatefulSet` with
  `stateful_pvc_enabled = true` (mounted at `/var/cache/loki`) exists as an option
  for local index-cache/compactor-scratch durability across pod restarts, but is not
  required for correctness.
- **Retention.** The baked config sets `limits_config.retention_period: 720h` (30
  days) with the compactor performing deletion (`retention_enabled: true`,
  `delete_request_store: gcs`).
- **Inspect the running pod's environment (e.g. to confirm the bucket actually
  injected):**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep LOKI_GCS_BUCKET
  ```

---

## 5. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Loki are listed; every other input is inherited
from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `loki` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `"latest"` resolves to the pinned `LOKI_VERSION` build ARG (`3.6.12`) — **not** the generic `APP_VERSION`, which the Foundation would otherwise force to a non-existent `latest` Loki tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `min_instance_count` / `max_instance_count` | `1` / `1` | `max_instance_count` is **overridden to `1` by `Loki_Common` regardless of this value** — see [§1](#1-overview). |
| `container_port` | `3100` | Loki's HTTP listener port — fixed by the baked config (`server.http_listen_port`). Changing this without also changing the config template will break the deployment. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Raise memory for high-cardinality label sets or heavy query load. |
| `enable_cloudsql_volume` | `false` | Off — Loki has no database. |

### Group 6 — GKE Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External exposure is the default — required for log-shipping clients outside the cluster. |
| `workload_type` | `Deployment` | Sufficient since Loki's durable state is GCS, not local disk. |
| `session_affinity` | `None` | No pod stickiness needed at the single-replica default scale. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (off) | Optional: switch to a per-pod block PVC (mount at `/var/cache/loki`) for local index-cache durability across restarts. Not required — Loki's durable state is GCS. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Loki needs no init job. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[]` | Additional buckets beyond the auto-provisioned `storage` bucket Loki actually uses for chunks/index. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Loki has no built-in use for Redis; this exists only for Foundation-mirroring completeness. |

### Group 16 — Database Configuration

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Loki's durable storage is the GCS bucket, not Cloud SQL. All other Group 16 database variables are inert. |

### Group 19 — Custom Domain & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Keeps the LoadBalancer address stable across redeploys — recommended when external clients hard-code the Loki push endpoint. |

All other inputs follow standard App_GKE behaviour.

---

## 6. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Loki. |
| `storage_buckets` | Created storage buckets — includes the `storage` bucket Loki uses for chunks and the TSDB index. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Always empty — `database_type = "NONE"`. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Always empty — Loki needs no init job. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 7. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

> **Note for operators/maintainers: why the Dockerfile in this module looks
> unusual.** The official `grafana/loki` image is **genuinely distroless** —
> inspecting its filesystem shows only `/usr/bin/loki`, with no shell, no coreutils,
> and no dynamic linker at all. A standard Dockerfile pattern (`RUN chmod +x
> /entrypoint.sh`) fails outright at build time (`exec: /bin/sh: no such file or
> directory`) because `RUN` needs a shell. The first fix attempt — grafting a
> busybox binary from the default `busybox:stable` tag via a multi-stage `COPY` —
> *also* failed, with the more confusing error `exec /bin/busybox: no such file or
> directory`, because `busybox:stable`'s binary is **dynamically linked** and the
> distroless target has no dynamic linker to satisfy it. The fix was to switch to
> `busybox:musl`, verified via `file` to be genuinely **statically linked** (no
> interpreter needed): `FROM busybox:musl AS busybox` in a build-only stage, `COPY
> --from=busybox /bin/busybox /bin/busybox` into the final distroless-based image,
> and `ENTRYPOINT ["/bin/busybox", "sh", "/entrypoint.sh"]` (busybox invoked
> directly by absolute path — no applet symlinks exist, so even the entrypoint
> script itself calls `/bin/busybox sed ...` rather than a bare `sed`). If you ever
> touch this Dockerfile, or clone it for another distroless-based application on
> GKE, remember: **verify a grafted busybox tag is genuinely static** (`file
> <binary>` should show no `interpreter` / dynamically linked) before assuming it
> will run inside a distroless target.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | Leave at default (effectively pinned to `1`) | Critical | Even though `Loki_Common` overrides this to `1` in the config it passes to the Foundation, don't rely on scaling Loki horizontally in this deployment shape — the in-memory ring and singleton compactor are not designed for concurrent replicas. |
| `container_port` | `3100` (do not change without also editing the config template) | Critical | Loki's `server.http_listen_port` is baked into the config file, not read from `container_port` at runtime — mismatching them breaks routing between the Kubernetes Service and the pod. |
| `service_type` | `LoadBalancer` for external log-shipping | High | Setting `ClusterIP` makes Loki reachable only from inside the cluster, blocking Promtail/Alloy agents running elsewhere. |
| Access control | None by default (`auth_enabled: false`) | High | Loki's HTTP API (push and query) has no built-in authentication. Anyone who can reach the external IP can push or query logs. Front it with Cloud Armor, IAP, or a reverse-proxy auth layer if this matters for your deployment. |
| `application_version` | Pin an explicit tag (e.g. `3.6.12`) for production | Medium | `"latest"` silently resolves to whatever tag `Loki_Common`'s Dockerfile currently pins, which changes only when the module source changes. |
| `container_resources.memory_limit` | Raise above `512Mi` for high-cardinality labels or heavy query load | Medium | Loki's query engine and in-memory index cache can OOM under load with the conservative default. |
| `reserve_static_ip` | `true` | Medium | With `false`, the external IP can change on redeploy and (per the fleet-wide GKE finding documented for other modules) `GKE_SERVICE_URL`-style self-referencing values can fall back to an unreachable internal DNS name if computed before the ephemeral LoadBalancer IP is known. |
| `database_type` | Leave at `NONE` | Low | Setting anything else has no effect — `Loki_Common` never wires a database connection into Loki's config regardless. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Loki-specific application configuration shared with the
Cloud Run variant is described in **[Loki_Common](Loki_Common.md)**.
