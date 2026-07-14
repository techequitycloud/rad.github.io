---
title: "RAGFlow Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the RAGFlow module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# RAGFlow Common — Shared Application Configuration

`RAGFlow_Common` is the **shared application layer** for RAGFlow. It is not deployed on
its own; instead it supplies the RAGFlow-specific configuration that both
[RAGFlow_GKE](RAGFlow_GKE.md) and [RAGFlow_CloudRun](RAGFlow_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs RAGFlow, see the platform
guides ([RAGFlow_GKE](RAGFlow_GKE.md), [RAGFlow_CloudRun](RAGFlow_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by RAGFlow_Common | Where it surfaces |
|---|---|---|
| Container image | Builds a custom image from `infiniflow/ragflow` via Cloud Build; `APP_VERSION` is set from the caller's `application_version` | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the `rag_flow` database, `ragflow` user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** documents bucket (suffix `documents`) | `storage_buckets` output |
| Core settings | Injects MySQL, Elasticsearch, and Redis connection env vars; sets the service port to 80 | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probe configuration targeting RAGFlow's health endpoints | §Observability in the platform guides |
| Startup config | Bundles the custom `entrypoint.sh` that generates `service_conf.yaml` at container start | Container startup behaviour |

---

## 2. Container image and custom build

Unlike most application modules that pull a prebuilt image, `RAGFlow_Common` sets
`image_source = "custom"` unconditionally. Cloud Build runs the `Dockerfile` in
`RAGFlow_Common/scripts/` using `infiniflow/ragflow` as the base image and passes
`APP_VERSION` as a build argument. The result is pushed to Artifact Registry and
deployed to the target platform. To deploy a different RAGFlow version, increment
`application_version` in the platform module — this re-triggers the Cloud Build.

---

## 3. Database engine and bootstrap

RAGFlow requires **MySQL 8.0**; the engine is fixed and PostgreSQL is not supported.
On the first deployment a one-shot `db-init` job connects to Cloud SQL through the
Auth Proxy and idempotently:

1. creates the `rag_flow` database with `utf8mb4_unicode_ci` collation (if absent),
2. creates the `ragflow` application user with the generated password,
3. grants the user full privileges on that database,
4. sends a shutdown signal to the Cloud SQL Auth Proxy sidecar so the Job completes.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=ragflow --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings and environment variables

`RAGFlow_Common` establishes the environment so the application comes up correctly
on first boot. The following variables are always injected and must not be overridden
via `environment_variables`:

| Variable | Value | Purpose |
|---|---|---|
| `MYSQL_HOST` | `127.0.0.1` | Cloud SQL Auth Proxy address (GKE: TCP via proxy; Cloud Run: socat bridge) |
| `MYSQL_PORT` | `3306` | MySQL standard port |
| `MYSQL_DATABASE` | `db_name` (default: `rag_flow`) | RAGFlow database name |
| `MYSQL_USER` | `db_user` (default: `ragflow`) | RAGFlow database user |
| `ELASTICSEARCH_HOSTS` | `elasticsearch_hosts` | Elasticsearch HTTP endpoint |
| `ELASTICSEARCH_USERNAME` | `elasticsearch_username` | Elasticsearch username (empty when security is off) |
| `REDIS_HOST` | `redis_host` | Redis server host (injected only when non-empty) |
| `REDIS_PORT` | `redis_port` | Redis server port (injected only when non-empty) |

Platform-specific adjustments:

- **Cloud Run** uses a `socat` bridge inside the container entrypoint to map the Cloud SQL
  Auth Proxy Unix socket to `127.0.0.1:3306`, because RAGFlow's PyMySQL client cannot
  connect via a Unix socket path directly.
- **GKE** connects to the Auth Proxy via TCP; no socket bridging is needed.
- **Redis host resolution.** The bundled `entrypoint.sh` prefers an explicit
  `REDIS_HOST`; when that is unset it falls back to `NFS_SERVER_IP` (the
  platform's NFS VM, which co-hosts Redis) before finally defaulting to
  `127.0.0.1`. Both `RAGFlow_CloudRun` and `RAGFlow_GKE` forward `enable_redis`
  through unconditionally (not gated on `redis_host` being set), so this
  fallback reliably resolves to a working Redis instance.

---

## 5. Startup configuration — `service_conf.yaml`

RAGFlow requires a `service_conf.yaml` file at `/ragflow/conf/service_conf.yaml`
before it starts. The custom `entrypoint.sh` bundled by this module generates that
file from the injected environment variables at container startup. The file wires
together the MySQL connection, Elasticsearch endpoint, Redis connection, and optional
MinIO/OAuth settings. The entrypoint then delegates to the RAGFlow image's own
startup script.

This means the container image itself contains no secrets — all connection details
are injected at runtime via Secret Manager and environment variables.

---

## 6. Health probe behaviour

RAGFlow loads embedding models during first boot, which can take 2–3 minutes. The
default probes are tuned to accommodate this:

| Probe | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|
| Startup | `/v1/health` | 120 s | 10 s | 60 retries |
| Liveness | `/v1/system/version` | 120 s | 30 s | 3 retries |
| Readiness | `/v1/system/version` | 30 s | 10 s | 3 retries |

Cloud Run uses `/v1/system/version` for startup and liveness probes (set in
`RAGFlow_CloudRun`) to detect when the application is fully initialised. GKE uses
`/v1/health`. Both variants allow ample time before the probes begin checking.

---

## 7. Object storage

A dedicated **Cloud Storage** documents bucket is declared here with the suffix
`documents` and provisioned by the foundation in the deployment region. The
workload service account is granted access automatically. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~ragflow"
```

Additional buckets and GCS Fuse volume mounts are configured at the platform module
level via `storage_buckets` and `gcs_volumes`.

---

For the RAGFlow-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[RAGFlow_GKE](RAGFlow_GKE.md)** and **[RAGFlow_CloudRun](RAGFlow_CloudRun.md)**.
