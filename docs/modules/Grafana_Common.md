---
title: "Grafana Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Grafana module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Grafana Common — Shared Application Configuration

`Grafana_Common` is the **shared application layer** for Grafana. It is not deployed
on its own; instead it supplies the Grafana-specific configuration that both
[Grafana_GKE](Grafana_GKE.md) and [Grafana_CloudRun](Grafana_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Grafana, see the platform
guides ([Grafana_GKE](Grafana_GKE.md), [Grafana_CloudRun](Grafana_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Grafana_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official `grafana/grafana` base image and the Cloud Build context that extends it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the required engine | §Database in the platform guides |
| Object storage | Declares the **Cloud Storage** `grafana-data` bucket | `storage_buckets` output |
| Core settings | Sets `container_port = 3000`, `cloudsql_volume_mount_path = /cloudsql`, and the entrypoint that translates foundation `DB_*` variables to Grafana `GF_DATABASE_*` variables | Application behaviour in the platform guides |
| Health checks | Supplies startup, liveness, and readiness probe defaults targeting `/api/health` | §Observability in the platform guides |
| No auto-generated secrets | Returns `secret_ids = {}` — Grafana's admin password is not auto-generated; it must be injected via `secret_environment_variables` | §Application Behaviour in the platform guides |

---

## 2. Admin credential in Secret Manager

Unlike some other application modules, `Grafana_Common` does NOT auto-generate a
Grafana admin password. Grafana ships with default `admin`/`admin` credentials.
Before the first deploy, create a Secret Manager secret and inject it:

```bash
gcloud secrets create grafana-admin-password \
  --replication-policy="automatic" --project "$PROJECT"
printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
  --data-file=- --project "$PROJECT"
```

Then configure the deployment with:
`secret_environment_variables = { GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }`

Retrieve the current admin password at any time:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin"
gcloud secrets versions access latest --secret=grafana-admin-password --project "$PROJECT"
```

The database password is generated and managed by the foundation; its secret name
is reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Grafana requires **PostgreSQL 15**; the engine is fixed and no alternative is
supported. Unlike applications such as Mautic, Grafana does NOT require a separate
database initialisation job. Grafana connects to the provisioned PostgreSQL instance
on first startup and automatically creates and migrates its schema.

The custom entrypoint script (`entrypoint.sh`) translates the foundation's generic
`DB_*` environment variables into Grafana's `GF_DATABASE_*` format at container
start time. It also handles the Cloud SQL Auth Proxy socket path transparently:
when the proxy socket is detected, the entrypoint resolves the database host to the
private IP for TCP so that Grafana's PostgreSQL driver (which cannot parse Unix
socket paths) can connect correctly.

Inspect the database directly after deployment:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Grafana_Common` establishes the baseline Grafana environment so the application
comes up correctly on first boot:

- **Container port** — `3000` is Grafana's native HTTP port; no redirect or proxy
  adjustment is needed.
- **Database type** — the parent `grafana.tf` injects `GF_DATABASE_TYPE=postgres`
  into the merged environment. This is required — without it Grafana falls back to
  SQLite even when all other `GF_DATABASE_*` variables are present.
- **Auth Proxy socket** — `enable_cloudsql_volume = true` by default; the proxy
  sidecar mounts its Unix socket at `/cloudsql`. The entrypoint detects the socket
  path and falls back to the Cloud SQL private IP for TCP so Grafana's driver can
  parse the host correctly.
- **SSL mode** — set to `disable` when connecting through the Auth Proxy (which
  handles encryption at the proxy layer) and to `require` when connecting over the
  private IP directly.
- **Custom image** — Cloud Build compiles a custom image from the Dockerfile in
  `scripts/`, which extends `grafana/grafana:<version>` with bash, curl, jq, and
  the translated entrypoint.

---

## 5. Health probe behaviour

All three probes target `/api/health` — Grafana's dedicated health endpoint, which
returns HTTP 200 when the application and its database connection are healthy:

| Probe | Type | Path | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/api/health` | 30s | 10s | 12 (total tolerance: ~150s) |
| Liveness | HTTP | `/api/health` | 60s | 30s | 3 |
| Readiness | HTTP | `/api/health` | 15s | 10s | 3 |

The generous startup tolerance accommodates Grafana's first-boot schema migration,
which runs synchronously before the server starts accepting requests.

Unlike some PHP-based applications, Grafana does not issue HTTP→HTTPS redirects
on health check paths, so HTTP probes work on both the GKE and Cloud Run variants
without modification.

---

## 6. Object storage

A dedicated **Cloud Storage** `grafana-data` bucket is declared here and
provisioned by the foundation, which also grants the workload service account
access. This bucket can be used for plugin storage, dashboard exports, and backups.
List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

Additional buckets and GCS Fuse volume mounts (for direct in-container filesystem
access to GCS objects) can be declared in the platform module via `storage_buckets`
and `gcs_volumes`.

---

For the Grafana-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Grafana_GKE](Grafana_GKE.md)** and **[Grafana_CloudRun](Grafana_CloudRun.md)**.
