---
title: "NocoDB Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the NocoDB module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# NocoDB Common — Shared Application Configuration

`NocoDB_Common` is the **shared application layer** for NocoDB. It is not deployed on
its own; instead it supplies the NocoDB-specific configuration that both
[NocoDB_GKE](NocoDB_GKE.md) and [NocoDB_CloudRun](NocoDB_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs NocoDB, see the platform
guides ([NocoDB_GKE](NocoDB_GKE.md), [NocoDB_CloudRun](NocoDB_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by NocoDB_Common | Where it surfaces |
|---|---|---|
| JWT credential | Generates `NC_AUTH_JWT_SECRET` and stores it in **Secret Manager** | Injected at runtime; retrieve via Secret Manager |
| Container image | Pins the official `nocodb/nocodb` image and the custom Dockerfile | `container_image` output of the platform deployment |
| Database engine | Defaults to **Cloud SQL for PostgreSQL 15** (MySQL 8.0 also supported) | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database and user | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** uploads bucket | `storage_buckets` output |
| Core settings | NC_DB_* env var mapping, container port 8080, GCS bucket injection | Application behaviour in the platform guides |
| Health checks | Default startup/liveness probe pointing at `/api/v1/health` | §Observability in the platform guides |

---

## 2. JWT credential in Secret Manager

The NocoDB JWT secret (`NC_AUTH_JWT_SECRET`) is generated automatically and stored
as a Secret Manager secret — it is never set in plain text. Retrieve it after
deployment:

```bash
# List secrets and read the JWT secret:
gcloud secrets list --project "$PROJECT" --filter="name~jwt"
gcloud secrets versions access latest --secret=<jwt-secret-name> --project "$PROJECT"
```

> **Do not rotate this secret after the first deployment.** NocoDB uses it to sign
> all user sessions and API tokens. Rotating the value immediately invalidates every
> active session and token; all users are forcibly logged out.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

NocoDB defaults to **PostgreSQL 15**. MySQL 8.0 is also supported; set
`database_type` in the platform module before first deploy. On the first deployment
a one-shot `db-init` job connects to Cloud SQL and idempotently:

1. creates the NocoDB database (if absent),
2. creates the application user with the generated password,
3. grants the user full privileges on that database.

The job is safe to re-run. NocoDB then runs its own schema migrations on startup —
no external migration step is needed. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. NC_DB_* environment variable mapping

NocoDB expects connection details as `NC_DB_*` environment variables, not the
standard `DB_*` names injected by the foundation. `NocoDB_Common` handles this in
two ways:

- **Custom image (default, `container_image_source = "custom"`).** A wrapper
  Dockerfile in `scripts/` builds on top of the official `nocodb/nocodb` image. An
  entrypoint script reads the standard `DB_*` variables injected by the foundation
  and re-exports them as `NC_DB_*` before starting NocoDB. No manual configuration
  is needed.
- **Prebuilt image (`container_image_source = "prebuilt"`).** The mapping is not
  applied. Configure the `NC_DB_*` variables manually via `environment_variables` in
  the platform module.

The additional env var names exposed through the platform module — `db_host_env_var_name`,
`db_port_env_var_name`, `db_name_env_var_name`, `db_user_env_var_name`,
`db_password_env_var_name`, and `service_url_env_var_name` — default to
`NC_DB_HOST`, `NC_DB_PORT`, `NC_DB_NAME`, `NC_DB_USER`, `NC_DB_PASSWORD`, and
`NC_PUBLIC_URL` respectively.

---

## 5. Cloud SQL connection model

NocoDB's internal URL constructor does not accept Unix socket paths, so the standard
Cloud SQL Auth Proxy socket cannot be used. The platform module defaults differ
between variants:

- **Cloud Run:** `enable_cloudsql_volume = false` (default). NocoDB connects to
  Cloud SQL via its **private IP address** over Direct VPC Egress. The private IP is
  injected as `DB_HOST` (and `NC_DB_HOST`).
- **GKE:** `enable_cloudsql_volume = true` (default) — the sidecar is injected but
  NocoDB still uses the **private IP TCP connection** rather than the socket path.

Do not force the Auth Proxy socket path with either variant — NocoDB will fail to
parse the connection URL.

---

## 6. Object storage — file uploads

A dedicated **Cloud Storage** uploads bucket is declared here and provisioned by the
foundation, which also grants the workload service account access. The bucket name
is injected into the container as `GCS_BUCKET_NAME` so NocoDB can store file
attachments directly in GCS. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~uploads"
```

---

## 7. Health probe behaviour

Both probes target NocoDB's dedicated health endpoint, which returns HTTP 200 when
the application is fully initialised:

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/api/v1/health` | 30 s | 10 s | 30 |
| Liveness | HTTP | `/api/v1/health` | 30 s | 30 s | 3 |

Unlike some PHP applications that require probe adjustments between Cloud Run and
GKE (e.g., TCP vs HTTP), NocoDB's health endpoint does not issue redirects and works
as an HTTP probe on both platforms.

---

For the NocoDB-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[NocoDB_GKE](NocoDB_GKE.md)** and **[NocoDB_CloudRun](NocoDB_CloudRun.md)**.
