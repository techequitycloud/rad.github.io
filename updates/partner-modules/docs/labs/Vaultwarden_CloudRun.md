# Vaultwarden on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Vaultwarden_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Vaultwarden is an unofficial, lightweight Bitwarden-compatible server written in Rust. It enables self-hosting of a complete password manager that works with all official Bitwarden clients. This lab deploys Vaultwarden on Google Cloud Run backed by Cloud SQL PostgreSQL 15, with single-instance reliability and 30-day backup retention.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 (or MySQL 8.0) instance, database, and user
- Secret Manager secrets (database password)
- Artifact Registry repository and Cloud Build image pipeline
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks targeting `/alive`
- GCS `vaultwarden-data` bucket
- `db-init` Cloud Run Job for database initialisation
- Automated daily backups with 30-day retention

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Register the initial admin account (signups disabled after first user)
- Install and configure Bitwarden client apps
- Connect clients to the self-hosted instance
- Configure SMTP for two-factor authentication and notifications
- Enable Cloud Armor WAF for brute-force protection (recommended)
- Review logs in Cloud Logging

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project.
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI.
6. (Recommended) Bitwarden desktop or mobile client for testing.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"1.32.7"` | Vaultwarden image version |
| `domain` | No | `""` | Public domain (e.g. `https://vault.example.com`). Required for WebAuthn. |
| `signups_allowed` | No | `false` | Set `true` for initial admin setup; disable afterwards |
| `web_vault_enabled` | No | `true` | Enable the Vaultwarden web UI |
| `database_type` | No | `"POSTGRES_15"` | `"POSTGRES_15"` or `"MYSQL_8_0"` |
| `db_name` | No | `"vaultwarden"` | Database name |
| `db_user` | No | `"vaultwarden"` | Database user |
| `cpu_limit` | No | `"1000m"` | CPU per instance (minimum `1000m`) |
| `memory_limit` | No | `"512Mi"` | Memory per instance |
| `min_instance_count` | No | `1` | Minimum instances |
| `max_instance_count` | No | `3` | Maximum instances |
| `enable_cloud_armor` | No | `false` | Enable Cloud Armor WAF (recommended for production) |
| `backup_retention_days` | No | `30` | Days to retain backups |
| `support_users` | No | `[]` | Monitoring alert emails |

> **Important:** Set `signups_allowed = true` for the initial deployment to create your admin account. After registration, redeploy with `signups_allowed = false`.

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| Artifact Registry image build | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| **Total** | **15–26 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Vaultwarden Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~vaultwarden" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Vaultwarden URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm Vaultwarden is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/alive
```

**gcloud equivalent:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.url)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

**Expected result:** HTTP `200` with response body `OK`. This is the `/alive` health endpoint.

### Step 2.2 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name | IN("SIGNUPS_ALLOWED","WEB_VAULT_ENABLED","DATA_FOLDER"))'
```

**Expected result:** Shows `SIGNUPS_ALLOWED=true` (for initial setup), `WEB_VAULT_ENABLED=true`, `DATA_FOLDER=/data`.

---

## Phase 3 — Create the Admin Account [MANUAL]

### Step 3.1 — Access the Web Vault

Open a browser and navigate to `${SERVICE_URL}`.

**Expected result:** The Vaultwarden web vault login/registration page appears.

### Step 3.2 — Create an Account

1. Click **Create account**.
2. Enter your email address and a strong master password.
3. Enter a password hint (optional but recommended).
4. Click **Create account**.

**Expected result:** The account is created and you are logged into the Vaultwarden web vault.

### Step 3.3 — Disable Signups

After creating your admin account, redeploy with `signups_allowed = false` to prevent unauthorised registrations.

Update the variable in the RAD UI and click **Redeploy**, or verify the current value:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name=="SIGNUPS_ALLOWED")'
```

---

## Phase 4 — Connect Bitwarden Clients [MANUAL]

### Step 4.1 — Configure the Server URL

In the Bitwarden desktop, mobile, or browser extension client:

1. On the login screen, click the gear icon (**Settings**) or **Self-hosted** option.
2. Set **Server URL** to `${SERVICE_URL}`.
3. Click **Save**.

**Expected result:** The client connects to your Vaultwarden instance. The login screen shows your server URL.

### Step 4.2 — Log In with the Admin Account

1. Enter your email and master password.
2. Click **Log in**.

**Expected result:** You are logged in and see an empty vault.

### Step 4.3 — Create a Vault Item

1. Click the **+** button to create a new item.
2. Add a **Login** item with a username, password, and website URL.
3. Click **Save**.

**Expected result:** The login item appears in your vault and is synchronised with Vaultwarden.

---

## Phase 5 — Configure the Admin Panel [MANUAL]

### Step 5.1 — Access the Admin Interface

Navigate to `${SERVICE_URL}/admin`.

**Expected result:** Vaultwarden prompts for the admin token. By default, the admin token is not set — you must configure it via environment variables.

### Step 5.2 — Set the Admin Token

Add the admin token to your deployment's `environment_variables`:

```hcl
environment_variables = {
  ADMIN_TOKEN = "your-secure-admin-token-here"
}
```

Redeploy the module, then navigate to `${SERVICE_URL}/admin` and enter the token.

**gcloud — verify the env var is set:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name=="ADMIN_TOKEN")'
```

**Expected result:** The Vaultwarden admin panel loads, showing user management, organisation settings, and SMTP configuration.

---

## Phase 6 — Configure SMTP [MANUAL]

Vaultwarden uses SMTP for two-factor authentication codes, account verification, and emergency access.

### Step 6.1 — Configure SMTP via Environment Variables

Update your deployment's `environment_variables`:

```hcl
environment_variables = {
  SMTP_HOST        = "smtp.mailgun.org"
  SMTP_PORT        = "587"
  SMTP_FROM        = "vault@yourdomain.com"
  SMTP_FROM_NAME   = "Vaultwarden"
  SMTP_SSL         = "true"
  SMTP_USERNAME    = "postmaster@mg.yourdomain.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "vaultwarden-smtp-password"
}
```

First, create the SMTP password secret:

```bash
echo -n "your-smtp-password" | gcloud secrets create vaultwarden-smtp-password \
  --data-file=- \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets" \
  -d '{"secretId": "vaultwarden-smtp-password", "replication": {"automatic": {}}}'
```

### Step 6.2 — Verify SMTP Configuration

In the Vaultwarden admin panel (`/admin`), navigate to the **SMTP** section and click **Send test email**.

**Expected result:** A test email is sent to the admin address.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Vaultwarden Logs

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
resource.labels.location="${REGION}"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Vaultwarden startup logs appear. Look for `Rocket launch` and database connection messages. The default log level is `warn` — only warnings and errors appear under normal operation.

### Step 7.2 — Enable Debug Logging Temporarily

Update `environment_variables` to set `LOG_LEVEL = "info"` for detailed logs, then restore to `"warn"` after investigation.

---

## Phase 8 — Undeploy [AUTOMATED]

When finished, return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 12–18 minutes.

> **Warning:** Undeploying permanently deletes the database and all stored vault data. Export your vault from the Bitwarden client (Settings > Export vault) before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Container image build | 1 | Yes |
| Note service URL | 2 | No |
| Confirm Vaultwarden reachable | 2 | No |
| Create admin account | 3 | No |
| Disable signups | 3 | No |
| Connect Bitwarden clients | 4 | No |
| Set admin token | 5 | No |
| Access admin panel | 5 | No |
| Configure SMTP | 6 | No |
| Review Cloud Logging | 7 | No |
| Undeploy infrastructure | 8 | Yes |
