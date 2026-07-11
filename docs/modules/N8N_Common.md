---
title: "N8N Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the N8N module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# N8N Common — Shared Application Configuration

`N8N_Common` is the **shared application layer** for n8n. It is not deployed on
its own; instead it supplies the n8n-specific configuration that both
[N8N_GKE](N8N_GKE.md) and [N8N_CloudRun](N8N_CloudRun.md) build on, so the two
platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs n8n, see the platform
guides ([N8N_GKE](N8N_GKE.md), [N8N_CloudRun](N8N_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by N8N_Common | Where it surfaces |
|---|---|---|
| Encryption key | Generates `N8N_ENCRYPTION_KEY` (32-char) and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| SMTP placeholder | Generates a dummy `N8N_SMTP_PASS` (16-char) to seed the secret slot | Update in Secret Manager with the real password before sending email |
| Container image | Pins the official n8n image and the Cloud Build configuration that extends it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** data bucket | `storage_buckets` output |
| Core settings | Sets the baseline n8n environment (port, protocol, binary data mode, webhook URL, Redis queue wiring) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe behaviour | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — neither is
ever set in plain text.

**Encryption key** (`N8N_ENCRYPTION_KEY`): a 32-character random key that encrypts
all workflow credentials (API keys, passwords, OAuth tokens) stored in the
database. Retrieve it after deployment:

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~encryption-key"
gcloud secrets versions access latest --secret=<encryption-key-secret> --project "$PROJECT"
```

**SMTP password** (`N8N_SMTP_PASS`): seeded with a 16-character dummy value at
provisioning time. Replace it with the real credential before configuring n8n to
send email:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~smtp-password"
echo -n "my-real-smtp-password" | \
  gcloud secrets versions add <smtp-secret-name> --data-file=- --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared secret
and Workload Identity model.

> **Important:** `N8N_ENCRYPTION_KEY` must never be rotated or changed after the
> first deployment. All workflow credentials are encrypted with this key — changing
> it destroys access to every saved credential.

---

## 3. Database engine and bootstrap

n8n requires **PostgreSQL 15**; the engine is fixed and no other database type is
supported. On the first deployment a one-shot job (`db-init`) connects to Cloud SQL
through the Auth Proxy and idempotently:

1. creates the n8n database (if absent),
2. creates the application user with the generated password,
3. grants the user full privileges on that database.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`N8N_Common` establishes the baseline n8n environment so the application comes
up correctly on first boot:

- **Port and protocol** — n8n listens on port `5678`; `N8N_PROTOCOL` is set to
  `https` to match the load-balanced front end.
- **Binary data mode** — `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` stores binary
  files (attachments, workflow output) on the NFS-mounted filesystem rather than
  in the database, which is required for multi-replica deployments.
- **Webhook URL** — `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are set to the
  predicted service URL at deploy time. Webhooks registered in n8n use this URL
  as their base; if the URL changes (custom domain added, service recreated), the
  workload must be redeployed to update these values.
- **Redis queue wiring** — when Redis is enabled, `QUEUE_BULL_REDIS_HOST` is set
  to the explicit `redis_host` if provided, or to the runtime placeholder
  `$(NFS_SERVER_IP)`. The `entrypoint.sh` script expands that placeholder to the
  actual NFS server IP at container startup.

Platform-specific adjustments handled here:

- **GKE** sets `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` to the GKE service URL
  known at plan time; `entrypoint.sh` overrides them with `GKE_SERVICE_URL` at
  runtime if that variable is present.
- **Cloud Run** sets these values from the predicted `run.app` service URL computed
  before apply.

---

## 5. Health probe behaviour

The default probes target the n8n root path (`/`), which returns HTTP 200 only
once the application is fully initialised and the database connection is
established.

- The **startup probe** uses a 120-second initial delay to allow time for first-boot
  database setup and schema migration.
- The **liveness probe** uses a 30-second initial delay after startup succeeds.

Both GKE and Cloud Run variants use HTTP probes against `/` — n8n does not issue
HTTP→HTTPS redirects on health probe paths.

---

## 6. Object storage

A dedicated **Cloud Storage** data bucket is declared here and provisioned by the
foundation, which also grants the workload service account access. Combined with
the Filestore (NFS) volume (when `enable_nfs = true`), this gives n8n durable
storage for workflow data that is consistent across all instances. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the n8n-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[N8N_GKE](N8N_GKE.md)** and **[N8N_CloudRun](N8N_CloudRun.md)**.
