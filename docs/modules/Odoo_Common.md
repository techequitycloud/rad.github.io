---
title: "Odoo Shared Application Configuration"
description: "Shared configuration reference for the Odoo module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Odoo Shared Application Configuration

`Odoo_Common` is the shared application-configuration layer that both `Odoo_CloudRun` and
`Odoo_GKE` consume. It is not deployed independently — it is called internally by each
platform variant to assemble the Odoo container image, environment variables, initialization
jobs, health probe settings, and storage definitions before they are forwarded to the
deployment foundation.

Everything in this document describes what `Odoo_Common` configures on your behalf. You do
not interact with this module directly; you interact with it through the variables exposed by
`Odoo_CloudRun` or `Odoo_GKE`.

---

## 1. What This Layer Provides

`Odoo_Common` is responsible for four concerns that are identical across both deployment
platforms:

1. **Auto-generated admin secret** — creates `ODOO_MASTER_PASS` in Secret Manager.
2. **Container image wiring** — sets the image source (`custom`), version channel (`18.0` by
   default), and all Odoo-specific environment variables.
3. **Storage definitions** — defines the `odoo-addons` GCS bucket for custom and community
   addons.
4. **Initialization jobs** — defines the ordered two-job sequence (`nfs-init` → `db-init`)
   that runs before the main Odoo container on every deploy.

---

## 2. Admin Credential

Odoo's database management interface (`/web/database/manager`) and the initial administrator
account are protected by the **Odoo master password**. `Odoo_Common` generates a
16-character alphanumeric master password and stores it as a Secret Manager secret. The
secret name uses an internal random identifier (not the user-supplied deployment ID) to avoid
plan-time dependency cycles.

You never set this password in plain text. After the first deploy you can retrieve it with:

```bash
# List secrets containing the master password:
gcloud secrets list --project "$PROJECT" --filter="name~master-password"
# Access the value:
gcloud secrets versions access latest \
  --secret=<master-password-secret-name> --project "$PROJECT"
```

To use a specific master password instead of the generated one, pass a value for
`ODOO_MASTER_PASS` through `explicit_secret_values` in `Odoo_CloudRun` or `Odoo_GKE`.

---

## 3. Container Image & Custom Build

Odoo is deployed from a **custom Ubuntu Noble image** built by Cloud Build from the Dockerfile
in `Odoo_Common/scripts/`. The build:

- Installs Odoo Community Edition from the official Odoo nightly `.deb` package repository
  for the selected version channel (default `18.0`).
- Installs `wkhtmltopdf` for PDF report generation (invoices, sales orders, purchase orders,
  financial reports).
- Installs `postgresql-client` for the `db-init` job and health-check scripts.
- Sets up the Odoo process user (UID 101) and the configuration file that reads database
  connection details from environment variables injected at runtime.

The image is pushed to Artifact Registry in your project and mirrored from there on every
deploy.

To verify the image currently running:

```bash
# Cloud Run:
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
# GKE:
kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].spec.containers[0].image}'
```

---

## 4. Pre-configured Environment Variables

`Odoo_Common` injects the following environment variables into every Odoo container
automatically. SMTP variables are pre-populated as defaults for you to fill in:

| Variable | Purpose |
|---|---|
| `ODOO_MASTER_PASS` | Master password injected from Secret Manager (see above). |
| `DB_HOST` | PostgreSQL host — set to `127.0.0.1` (Cloud SQL Auth Proxy Unix socket). |
| `DB_PORT` | PostgreSQL port — `5432`. |
| `DB_USER` | Application database user (from `application_database_user`). |
| `DB_NAME` | Application database name (from `application_database_name`). |
| `DB_PASSWORD` | Database password injected from Secret Manager. |
| `REDIS_HOST` | Redis endpoint (empty string when Redis is disabled). |
| `REDIS_PORT` | Redis port (default `6379`). |
| `SMTP_HOST` | Outgoing mail relay hostname. Set this for email delivery. |
| `SMTP_PORT` | SMTP port (default `587`). |
| `SMTP_USER` | SMTP authentication username. |
| `SMTP_SSL` | `ssl`, `starttls`, or `none`. |
| `EMAIL_FROM` | Default sender address for outbound email. |
| `SMTP_PASSWORD` | SMTP password — pass via `secret_environment_variables`. |

Additional plain-text variables can be added through `environment_variables` and additional
Secret Manager references through `secret_environment_variables` in the calling module.

---

## 5. Initialization Job Sequence

On every deploy, two Cloud Run Jobs (or Kubernetes Jobs) run in order before the Odoo service
or workload starts. Both jobs are idempotent and safe to re-run.

**Job 1 — `nfs-init`** (runs first)

- Image: `alpine:3.19`
- Creates the directories `/mnt/filestore`, `/mnt/sessions`, and `/mnt/extra-addons` on the
  Filestore NFS share.
- Sets ownership to `101:101` (the Odoo process UID/GID) and permissions to `777`.
- Odoo will fail to start if these directories are missing or have incorrect ownership.

**Job 2 — `db-init`** (runs after `nfs-init`)

- Image: `postgres:15-alpine`
- Runs `db-init.sh`, which creates the application database user and database in Cloud SQL
  for PostgreSQL if they do not already exist.
- Reads `DB_PASSWORD` and `ROOT_PASSWORD` from Secret Manager at execution time.
- No schema changes — schema creation is handled by Odoo on first service start.

To inspect the job logs:

```bash
# Cloud Run:
gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
gcloud run jobs executions list --job db-init  --project "$PROJECT" --region "$REGION"
# GKE:
kubectl get jobs -n "$NAMESPACE"
kubectl logs -n "$NAMESPACE" -l job-name=nfs-init
kubectl logs -n "$NAMESPACE" -l job-name=db-init
```

---

## 6. Health Probe Behaviour

`Odoo_Common` sets the following probe defaults. `Odoo_CloudRun` and `Odoo_GKE` apply them
without modification unless you explicitly override them.

**Startup probe** — tolerates long first-boot schema creation:

| Platform | Type | Initial delay | Period | Threshold | Max wait |
|---|---|---|---|---|---|
| Cloud Run | TCP (port 8069) | 60 s | — | — | ~9 min |
| GKE | HTTP `/web/health` | 180 s | 120 s | 3 | ~9 min |

Odoo's HTTP handler is not available until the `base` module is fully installed and the
database has been seeded. On the very first deploy this can take 2–10 minutes depending on
available CPU. Increase the failure threshold if you observe startup probe failures on a
fresh install.

**Liveness probe** — checks that Odoo has a live database connection:

| Platform | Type | Path | Initial delay | Period |
|---|---|---|---|---|
| Cloud Run | HTTP | `/web/health` | 120 s | 30 s |
| GKE | HTTP | `/web/health` | 30 s | 30 s |

`/web/health` returns `HTTP 200` only when Odoo has successfully connected to PostgreSQL.
A 5xx or connection-refused response from this endpoint means the database is unreachable or
Odoo has crashed.

```bash
# Manually test the health endpoint:
curl -s -o /dev/null -w "%{http_code}" "https://<service-url>/web/health"
# Expected: 200
```

---

## 7. Object Storage — Odoo Addons Bucket

`Odoo_Common` defines one Cloud Storage bucket:

| Bucket suffix | Mount path | Purpose |
|---|---|---|
| `odoo-addons` | `/mnt/extra-addons` (GCS Fuse) | Custom and community Odoo addons |

The bucket is mounted read-write into the Odoo container via GCS Fuse. Place any custom Odoo
module directories directly in the bucket root; Odoo discovers them via the `addons_path`
configuration entry that points to `/mnt/extra-addons`.

```bash
# List the addons bucket:
gcloud storage ls gs://<addons-bucket>/
# Upload a custom addon:
gcloud storage cp -r ./my_custom_addon gs://<addons-bucket>/my_custom_addon/
```

---

For deployment variables and platform-specific options, see
**[Odoo_CloudRun](Odoo_CloudRun.md)** or **[Odoo_GKE](Odoo_GKE.md)**. For the shared
infrastructure that both platforms depend on, see the
[Services_GCP platform guide](Services_GCP.md).
