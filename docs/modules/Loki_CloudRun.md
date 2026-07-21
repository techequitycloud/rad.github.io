---
title: "Loki on Google Cloud Run"
description: "Configuration reference for deploying Loki on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Loki on Google Cloud Run

Grafana Loki is a horizontally-scalable, highly-available log aggregation system —
often described as "Prometheus for logs." Unlike full-text log indexers, Loki
indexes only a small set of labels per log stream rather than the full text of every
line, which keeps storage and operating costs low. It is normally queried with
**LogQL** through **Grafana** (as a datasource) or the **LogCLI** tool, with an
agent such as **Promtail** or **Grafana Alloy** shipping logs into it. This module
deploys **Loki itself, not Grafana**, on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Loki uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Loki runs as a single Go binary container on Cloud Run v2, in **monolithic mode**
(`-target=all`, Loki's default, which runs every internal component — distributor,
ingester, querier, compactor — in one process). The deployment wires together a
narrow, GCS-centric set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go binary service, 1 vCPU / 512Mi by default, request-based billing |
| Object storage | Cloud Storage | A single `storage` bucket — Loki's actual object-storage backend for chunks and the shipped TSDB index, not incidental file storage |
| Secrets | Secret Manager | None generated — `Loki_Common` declares `secret_ids = {}` |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** Loki's durable state (chunks, TSDB index) lives
  entirely in a GCS bucket. `database_type = "NONE"` and `enable_redis` has no
  effect on Loki's own config.
- **`max_instance_count` is effectively pinned to `1`.** `Loki_Common` overrides
  `max_instance_count = 1` in the config it hands to `App_CloudRun`, regardless of
  the value passed in. Loki's compactor (retention/deletion) is a true singleton and
  the baked config uses an **in-memory ring** (`common.ring.kvstore.store: inmemory`)
  with `replication_factor: 1`, which cannot coordinate across multiple instances.
- **Single-tenant, no auth.** The baked config sets `auth_enabled: false`. There is
  no per-tenant isolation and no built-in authentication — Loki's HTTP API is
  reachable by anyone who can reach the service URL, subject to `ingress_settings`.
- **Request-based billing by default (`cpu_always_allocated = false`).** Loki's
  ingestion, query, and internal compaction cycle all run in direct response to HTTP
  requests, with no long-lived background work that needs CPU while idle.
- **Config-file driven, not env-var driven.** Loki's storage/schema settings live
  entirely in a config file baked into the image; only the GCS bucket name is
  templated in at container start via the `LOKI_GCS_BUCKET` environment variable.
- **No init jobs.** `initialization_jobs` defaults to `[]` — Loki has nothing to
  bootstrap.
- **Custom-built, distroless-based image.** See [§4](#4-loki-application-behaviour)
  and [§7](#7-configuration-pitfalls--sensible-defaults) for why the Dockerfile in
  this module looks unusual.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#6-outputs).

### A. Cloud Run — the Loki service

Loki runs as a single Cloud Run v2 service that autoscales by request load. Because
`max_instance_count` is effectively pinned to `1`, "autoscaling" here really means
scale-to-zero-and-back rather than horizontal fan-out.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — Loki's object storage backend

A dedicated `storage` GCS bucket is Loki's actual storage backend, not an optional
extra. Loki writes compressed log chunks and the shipped TSDB index shards into it
directly via its native `gcs` storage client (Application Default Credentials — the
Cloud Run runtime service account is granted `roles/storage.objectAdmin` on the
bucket).

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

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options (not used by
Loki's own storage path, which is native GCS API access, not a mounted filesystem).

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

The service is reachable at its `run.app` URL by default (`ingress_settings =
"all"`), which allows log-shipping clients (Promtail, Alloy) outside the project's
VPC to push logs in. An external HTTPS load balancer with a custom domain, Cloud
CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Loki's own process logs (not the logs it *ingests* — those are application data
inside the Loki service, not Cloud Logging entries) flow to Cloud Logging; Cloud Run
metrics flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Querying Loki

This module deploys Loki with **no built-in web UI** — Loki is a headend for logs,
queried through LogQL. Two common ways to query it once deployed:

- **`logcli`** (Grafana's official CLI), pointed at the service URL:
  ```bash
  export LOKI_ADDR="$SERVICE_URL"
  logcli labels                                             # discover available labels
  logcli query '{job="myapp"}' --limit=50                   # LogQL query
  ```
- **Direct HTTP** against the query API:
  ```bash
  curl -s "$SERVICE_URL/loki/api/v1/query?query=%7Bjob%3D%22myapp%22%7D" | jq .
  ```
- **As a Grafana datasource** — add a Loki datasource in Grafana pointing at the
  service URL; this is the normal production pattern for exploring and dashboarding
  ingested logs.

---

## 4. Loki Application Behaviour

- **Config templating at container start, not database migrations.** `Loki_Common`
  bakes a config template into the image with a single placeholder,
  `__LOKI_GCS_BUCKET__`. The container entrypoint substitutes the real bucket name
  (injected as the `LOKI_GCS_BUCKET` env var) with `sed` and writes the result to
  `/etc/loki/local-config.yaml` before Loki starts — there is no first-boot schema
  step to wait on.
- **No init jobs needed.** Loki has no database to bootstrap, so
  `initialization_jobs` is empty by default and this module never injects one.
- **Health path is `/ready`.** Both the startup and liveness probes target Loki's
  built-in, unauthenticated readiness endpoint, which returns HTTP 200 once the
  server is listening — typically within seconds, since there is no migration or
  heavy first-boot work.
- **Monolithic mode.** `-target=all` runs every Loki component (distributor,
  ingester, querier, query-frontend, compactor) inside the single process — the
  right shape for a small/medium single-tenant deployment. Loki also supports a
  microservices mode (separate containers per component) for very large-scale
  deployments, which this module does not implement.
- **Single-instance scaling constraint.** The in-memory ring
  (`common.ring.kvstore.store: inmemory`) and the compactor's singleton retention
  job mean Loki here is not designed to run more than one instance concurrently.
  `Loki_Common` enforces this by pinning `max_instance_count = 1` in the config it
  passes to the Foundation, regardless of what the platform input is set to.
- **Retention.** The baked config sets `limits_config.retention_period: 720h` (30
  days) with the compactor performing deletion (`retention_enabled: true`,
  `delete_request_store: gcs`).
- **Inspect the running container's environment (e.g. to confirm the bucket
  actually injected):**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 5. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Loki are listed; every other input is inherited
from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `loki` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `"latest"` resolves to the pinned `LOKI_VERSION` build ARG (`3.6.12`) — **not** the generic `APP_VERSION`, which the Foundation would otherwise force to a non-existent `latest` Loki tag. Set an explicit tag (e.g. `3.6.12`) to pin a specific release. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_port` | `3100` | Loki's HTTP listener port — fixed by the baked config (`server.http_listen_port`). Changing this without also changing the config template will break the deployment. |
| `max_instance_count` | `1` | **Overridden to `1` by `Loki_Common` regardless of this value** — see [§1](#1-overview). |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Per-instance resource limits. Raise memory for high-cardinality label sets or heavy query load. |
| `cpu_always_allocated` | `false` | Request-based billing — Loki has no idle background work. |
| `enable_cloudsql_volume` | `false` | Off — Loki has no database. |
| `execution_environment` | `gen2` | Gen2 recommended. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for external log-shipping clients (Promtail, Alloy) outside the project VPC to reach the push API. |
| `enable_iap` | `false` | Enabling IAP blocks unauthenticated log pushes/queries from external agents. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain-text env vars, merged over `LOKI_GCS_BUCKET` (injected automatically). Loki reads almost nothing from the environment — its config is file-driven. |
| `secret_environment_variables` | `{}` | No secrets are needed by default. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[]` | Additional buckets beyond the auto-provisioned `storage` bucket Loki actually uses for chunks/index. |
| `enable_nfs` | `false` | Not needed for Loki's own storage (GCS-backed), unlike SQLite-backed apps in this catalog. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Loki's durable storage is the GCS bucket, not Cloud SQL. All other Group 12 variables are inert. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Loki needs no init job. Left empty by both this module and `Loki_Common`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/ready`, 30s delay | Loki's built-in readiness endpoint — becomes healthy within seconds since there is no migration step. |

### Group 16 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Loki has no built-in use for Redis; this exists only for Foundation-mirroring completeness. |

All other inputs follow standard App_CloudRun behaviour.

---

## 6. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `storage_buckets` | Created Cloud Storage buckets — includes the `storage` bucket Loki uses for chunks and the TSDB index. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Always empty — `database_type = "NONE"`. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Always empty — Loki needs no init job. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | CI/CD status and details. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 7. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

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
> touch this Dockerfile, or clone it for another distroless-based application,
> remember: **verify a grafted busybox tag is genuinely static** (`file
> <binary>` should show no `interpreter` / dynamically linked) before assuming it
> will run inside a distroless target.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | Leave at default (effectively pinned to `1`) | Critical | Even though `Loki_Common` overrides this to `1` in the config it passes to the Foundation, don't rely on scaling Loki horizontally in this deployment shape — the in-memory ring and singleton compactor are not designed for concurrent instances. |
| `container_port` | `3100` (do not change without also editing the config template) | Critical | Loki's `server.http_listen_port` is baked into the config file, not read from `container_port` at runtime — mismatching them breaks routing between Cloud Run and the container. |
| `ingress_settings` | `all` for external log-shipping | High | Setting `internal` blocks Promtail/Alloy agents running outside the project VPC from pushing logs in. |
| `enable_iap` | `false` unless all log-shipping clients can authenticate through IAP | High | IAP blocks all unauthenticated requests, including the push API used by log-shipping agents. |
| Access control | None by default (`auth_enabled: false`) | High | Loki's HTTP API (push and query) has no built-in authentication. Anyone who can reach the service URL can push or query logs. Front it with IAP, a Cloud Armor policy, or a reverse-proxy auth layer if this matters for your deployment. |
| `application_version` | Pin an explicit tag (e.g. `3.6.12`) for production | Medium | `"latest"` silently resolves to whatever tag `Loki_Common`'s Dockerfile currently pins, which changes only when the module source changes — not a live upstream `latest`, but also not something you control per-deployment without setting an explicit tag. |
| `memory_limit` | Raise above `512Mi` for high-cardinality labels or heavy query load | Medium | Loki's query engine and in-memory index cache can OOM under load with the conservative default. |
| `database_type` | Leave at `NONE` | Low | Setting anything else has no effect — `Loki_Common` never wires a database connection into Loki's config regardless. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Loki-specific application configuration shared
with the GKE variant is described in **[Loki_Common](Loki_Common.md)**.
