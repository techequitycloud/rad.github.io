---
title: "PostHog Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the PostHog module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# PostHog Common — Shared Application Configuration

`PostHog_Common` is the **shared application layer** for PostHog. It is not deployed on
its own; instead it supplies the PostHog-specific configuration that
[PostHog_GKE](PostHog_GKE.md) builds on. Unlike most application pairs in this
catalogue, there is deliberately **no `PostHog_CloudRun` variant** — PostHog's event
pipeline mandates Kafka (ingestion) and ClickHouse (the analytics event store), both
stateful, long-lived services incompatible with Cloud Run's serverless, scale-to-zero
model — so `PostHog_GKE` is this layer's only consumer. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs PostHog, see the platform
guide ([PostHog_GKE](PostHog_GKE.md)) and the foundation guide ([App_GKE](App_GKE.md)).

---

## 1. What this layer provides

| Area | Provided by PostHog_Common | Where it surfaces |
|---|---|---|
| Container image | Thin custom build `FROM posthog/posthog` adding a cloud entrypoint plus a `docker-boot.sh` override; builds via Cloud Build with the app-specific `POSTHOG_VERSION` build ARG | `container_image` output of the platform deployment |
| Version resolution | `application_version = "latest"` is used as-is — `posthog/posthog` publishes a genuinely fresh `latest` tag tracking master, unlike several apps in this catalogue that need a rolling-tag substitution | Image tag on the deployed container |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) — holds only Django's own app metadata (users, teams, feature flags, dashboards); no analytics data | §Database in the platform guide |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database, user, and grants. No extensions — all analytics storage is in ClickHouse | `initialization_jobs` output |
| Object storage | Declares a single Cloud Storage bucket, reached via PostHog's **native S3-compatible client** against GCS's S3-interop API — a dedicated service account + HMAC key pair, NOT a GCS FUSE mount | `storage_buckets` output, `storage_sa_email` output |
| Secrets | Generates `SECRET_KEY` (Django signing key) and an S3-interop HMAC access/secret key pair; optionally passes through an external `CLICKHOUSE_PASSWORD` | Secret Manager, via `secret_ids` output |
| Core settings | `CLICKHOUSE_DATABASE`/`USER`/`SECURE`/`VERIFY`, `OBJECT_STORAGE_*`, `IS_BEHIND_PROXY`, `DISABLE_SECURE_SSL_REDIRECT` | Application behaviour in the platform guide |
| Health checks | Supplies the default startup/liveness probes targeting `/_readyz` and `/_livez` | §Observability in the platform guide |
| Explicitly NOT provided here | ClickHouse/Kafka endpoint resolution and the bundled Redpanda/ClickHouse `additional_services` — these need GKE-local Service DNS names only known at the `PostHog_GKE` variant | See `PostHog_GKE`'s own wiring |

---

## 2. Container image and entrypoint

The custom image wraps `posthog/posthog:<version>` with **two** scripts, layered on top
of the upstream image without touching its own `ENTRYPOINT` — the upstream final stage is
built on the `nginx/unit` application-server base (`unit:*-python3.13`), whose own
inherited entrypoint may do bootstrap work beyond "exec the CMD," so only `CMD` is
replaced:

- **`cloud-entrypoint.sh`** — PostHog's Django/Node hybrid reads full connection-string
  DSNs (`DATABASE_URL`, `REDIS_URL`), not discrete host/port/user variables (confirmed
  against `posthog/settings/data_stores.py`), so the entrypoint composes them from the
  Foundation-injected `DB_*`/`REDIS_*` primitives at container start rather than relying
  on Kubernetes `$(VAR)` references (which only resolve against env entries defined
  *earlier* in the alphabetically rendered list — an ordering trap already documented for
  Immich/GoToSocial in this catalogue). It also fails fast with a clear error if
  `REDIS_HOST`, `CLICKHOUSE_HOST`, or `KAFKA_HOSTS` is empty — all three are mandatory
  for PostHog to function.
- **`docker-boot.sh`** — a replacement for upstream's own `./bin/docker`, running the
  identical `migrate` → `(celery worker+beat, backgrounded)` → `gunicorn/docker-server`
  sequence, **minus** the `./bin/posthog-node` line. See §6.

---

## 3. Database engine and bootstrap

PostHog requires **PostgreSQL** for its own Django application metadata only —
`PostHog_Common` pins `POSTGRES_15`. **Every analytics event, person record, and session
recording index lives in ClickHouse, not Postgres.** On the first deployment a one-shot
job (`db-init`, `postgres:15-alpine`, 600s timeout) runs `scripts/db-init.sh`, which
idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket (falling back to `DB_IP`/`DB_HOST` over TCP),
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application user with the generated password,
4. Creates (or reconfigures) the application database with that user as owner,
5. Grants full privileges on the database and the `public` schema.

No PostgreSQL extensions are installed — unlike many apps in this catalogue, PostHog
needs none. The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Object storage — S3-interop, not GCS FUSE

PostHog has **no filesystem media library**: session-replay recordings and data exports
go through PostHog's native S3-compatible client, pointed at GCS's S3-interop XML API via
a dedicated service account and HMAC key pair (the same pattern already proven in this
catalogue by `GoToSocial_Common`). Consequently this layer declares no GCS FUSE volumes.

```bash
gcloud storage buckets list --project "$PROJECT"
```

The storage service account's email is exposed as the `storage_sa_email` output;
`PostHog_GKE` grants it `roles/storage.objectAdmin` on the Foundation-created bucket
directly (joining the SA from this layer with the bucket the Foundation creates), rather
than depending on the whole app module — PostHog can boot without object storage
reachable (uploads simply fail until the grant lands).

---

## 5. Core application settings

Environment defaults injected into `config.environment_variables` (caller-supplied
`environment_variables` are merged over them):

| Variable | Value | Notes |
|---|---|---|
| `CLICKHOUSE_DATABASE` / `CLICKHOUSE_USER` | `posthog` / `default` | ClickHouse database and username |
| `CLICKHOUSE_SECURE` / `CLICKHOUSE_VERIFY` | `"false"` | In-VPC/in-cluster traffic — no TLS |
| `OBJECT_STORAGE_ENABLED` / `_ENDPOINT` / `_BUCKET` / `_REGION` / `_FORCE_PATH_STYLE` | S3-interop config | See §4 |
| `IS_BEHIND_PROXY` | `"true"` | GKE's LoadBalancer/Gateway terminates externally |
| `DISABLE_SECURE_SSL_REDIRECT` | `"true"` | Prevents an HTTPS-redirect loop behind the internal proxy |

Sizing defaults: `cpu_limit = "4000m"`, `memory_limit = "8Gi"` — both bumped from generic
defaults after live verification of PostHog's genuinely heavy first-boot import/migration
sequence.

**Not defined here:** `CLICKHOUSE_HOST`/`PORT`, `KAFKA_HOSTS`, and `SITE_URL` depend on
resource names only known at the `PostHog_GKE` variant (an external endpoint, or the
in-module fallback's Service DNS name) and are injected there via `module_env_vars`. The
bundled Redpanda broker and optional in-module ClickHouse fallback are likewise wired
directly in `PostHog_GKE` so their `additional_services` list structure (including
service names) is known at Terraform plan time.

---

## 6. The missing Node.js plugin-server — a known upstream gap

Live-verified (2026-07-22, both `:latest` and a build 6 days older): the current
`posthog/posthog` image no longer ships `/code/nodejs` at all. PostHog's own
`bin/posthog-node` boot script still unconditionally tries to `cd` into that directory
and run it, wrapped in an infinite "resiliency loop" that retries every 2 seconds forever
without ever exiting. Since this runs backgrounded inside `bin/docker-worker` (itself
backgrounded from `bin/docker`), the outer container never crashes — but the tight
crash-retry loop pins CPU at ~100% indefinitely, starving the process that must answer
the startup probe's `/_readyz` in time. From the outside this looks exactly like "boots
fine but never becomes Ready," with no obvious error in the visible logs.

`docker-boot.sh` (§2) sidesteps this by running everything else identically and
omitting the `./bin/posthog-node` line. This appears to be a genuine upstream gap — a
large amount of ingestion/processing logic has visibly moved into Python `products.*`
apps in the same image, so the Node component may simply be vestigial now — rather than
something fixable by pinning an older tag. **Operators should know:** core event
ingestion and analytics work fine under this override; plugin-dependent features that
specifically relied on the Node plugin-server may not, until upstream restores it or
completes the migration away from it.

---

## 7. Health probe behaviour

Default startup and liveness probes target PostHog's own health endpoints
(source-verified against `posthog/health.py`):

- **`GET /_readyz`** — deep dependency checks (Postgres migration status, ClickHouse,
  Kafka, Celery broker, cache). `failure_threshold = 145` at a 10-second period
  (~25 minutes) is deliberately large — live-verified against a fresh Cloud SQL database,
  PostHog's inline Django `migrate` step runs its full, very large multi-app migration
  history and exceeded a previous, tighter budget.
- **`GET /_livez`** — the lightweight liveness check; does not verify downstream
  dependencies.

Both are unauthenticated — probes run unauthenticated, so an auth-gated endpoint would
401/403 and wedge the rollout.

---

## 8. Outputs

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full application configuration (image + build config, port, database contract, env vars, `db-init` job, probes). |
| `secret_ids` | `map(string)` | `SECRET_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, and (when set) `CLICKHOUSE_PASSWORD`. |
| `secret_values` | `map(string)` | `{}` (sensitive). |
| `storage_buckets` | `list(object)` | A single bucket (`name_suffix = "storage"`). |
| `resolved_version` | `string` | Image tag actually deployed — equals `application_version` unchanged. |
| `path` | `string` | Absolute path to this module directory. |
| `resource_prefix` | `string` | Resource naming prefix (forwarded from input). |
| `service_name` | `string` | `<application_name><resource_prefix>`. |
| `storage_sa_email` | `string` | Object-storage HMAC service account email — `PostHog_GKE` grants it `roles/storage.objectAdmin`. |

---

For the PostHog-specific, user-facing configuration (variables by group, outputs, and how
to explore each service from the Console and CLI), see the platform guide:
**[PostHog_GKE](PostHog_GKE.md)**.
