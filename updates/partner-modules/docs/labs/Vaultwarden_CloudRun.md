# Vaultwarden on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Vaultwarden_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Vaultwarden is an unofficial, lightweight Bitwarden-compatible server written in Rust. It enables self-hosting of a complete password manager that works with all official Bitwarden clients. This lab deploys Vaultwarden on Google Cloud Run backed by Cloud SQL PostgreSQL 15, with 30-day backup retention.

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
- Register the initial admin account
- Install and configure Bitwarden client apps
- Connect clients to the self-hosted instance
- Configure SMTP for two-factor authentication codes
- Enable admin panel with `ADMIN_TOKEN`
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
2. The `Services GCP` module deployed in the same project.
3. The following APIs enabled:
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI.
6. Bitwarden client (desktop/mobile/browser extension) for testing.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"1.32.7"` | Vaultwarden image version |
| `domain` | No | `""` | Public domain for WebAuthn and email links |
| `signups_allowed` | No | `false` | **Set `true` for initial deploy** to create admin account |
| `web_vault_enabled` | No | `true` | Enable web vault UI |
| `database_type` | No | `"POSTGRES_15"` | `"POSTGRES_15"` or `"MYSQL_8_0"` |
| `db_name` | No | `"vaultwarden"` | Database name |
| `db_user` | No | `"vaultwarden"` | Database user |
| `cpu_limit` | No | `"1000m"` | CPU (minimum `1000m`) |
| `memory_limit` | No | `"512Mi"` | Memory per instance |
| `min_instance_count` | No | `1` | Minimum instances |
| `max_instance_count` | No | `3` | Maximum instances |
| `enable_cloud_armor` | No | `false` | Cloud Armor WAF (recommended for production) |
| `backup_retention_days` | No | `30` | Backup retention (30 days default) |
| `support_users` | No | `[]` | Monitoring alert emails |

> **Important:** Set `signups_allowed = true` for the initial deployment to register your admin account. Redeploy with `signups_allowed = false` immediately after.

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

**Expected result:** HTTP `200` with body `OK`. The `/alive` endpoint confirms Vaultwarden is running.

### Step 2.2 — Verify Environment Variables

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name | IN("SIGNUPS_ALLOWED","WEB_VAULT_ENABLED","DATA_FOLDER","ROCKET_PORT"))'
```

**Expected result:** Shows `SIGNUPS_ALLOWED=true` (for initial setup), `WEB_VAULT_ENABLED=true`, `DATA_FOLDER=/data`, `ROCKET_PORT=80`.

---

## Phase 3 — Create the Admin Account [MANUAL]

### Step 3.1 — Access the Web Vault

Navigate to `${SERVICE_URL}` in a browser.

**Expected result:** The Vaultwarden web vault login page appears.

### Step 3.2 — Create an Account

1. Click **Create account**.
2. Enter your email address and a strong master password (minimum 12 characters).
3. Add a password hint (optional but recommended for recovery).
4. Click **Create account**.

**Expected result:** Account is created. You are redirected to the vault.

### Step 3.3 — Disable Signups

After creating your admin account, update the deployment to disable new registrations:

In the RAD UI, set `signups_allowed = false` and click **Redeploy**.

Verify after redeploy:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name=="SIGNUPS_ALLOWED")'
```

**Expected result:** `SIGNUPS_ALLOWED=false`.

---

## Phase 4 — Connect Bitwarden Clients [MANUAL]

### Step 4.1 — Configure the Server URL in Bitwarden Client

In the official Bitwarden client (desktop, mobile, or browser extension):

1. On the login screen, click the gear icon or **Self-hosted** link.
2. Enter the **Server URL**: `${SERVICE_URL}`.
3. Click **Save**.

**Expected result:** The client connects. The login screen shows your custom server URL.

### Step 4.2 — Log In

Enter your email and master password, then click **Log in**.

**Expected result:** You are logged into the vault. Items from the web vault appear.

### Step 4.3 — Test Vault Operations

1. Create a new **Login** item with a username, password, and URL.
2. Create a **Secure Note** with sensitive text.
3. Verify items sync across clients.

**Expected result:** Items are created and appear on all connected clients.

### Step 4.4 — Test the Browser Extension

1. Install the Bitwarden browser extension.
2. Set the server URL to `${SERVICE_URL}`.
3. Log in and visit a website — the extension should offer to fill credentials.

**Expected result:** Browser extension fills saved credentials automatically.

---

## Phase 5 — Configure the Admin Panel [MANUAL]

### Step 5.1 — Set the Admin Token

The admin panel (`/admin`) requires an `ADMIN_TOKEN` environment variable. Add it to your deployment:

```hcl
environment_variables = {
  ADMIN_TOKEN = "your-secure-random-token"
}
```

You can generate a secure token:
```bash
openssl rand -hex 32
```

Redeploy after updating the variable.

### Step 5.2 — Access the Admin Panel

Navigate to `${SERVICE_URL}/admin` and enter the admin token.

**gcloud — confirm token is set:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name=="ADMIN_TOKEN")'
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '.template.containers[0].env[] | select(.name=="ADMIN_TOKEN")'
```

**Expected result:** The admin panel loads. You can see all registered users, manage organisations, and configure global settings.

### Step 5.3 — Explore Admin Panel Features

1. Navigate to **Users** — view registered accounts.
2. Navigate to **Organisations** — create a shared vault for team use.
3. Navigate to **Settings** — configure IP whitelisting, password policy, and 2FA enforcement.

---

## Phase 6 — Configure SMTP [MANUAL]

Vaultwarden uses SMTP for 2FA codes, emergency access, and organisation invitations.

### Step 6.1 — Create SMTP Password Secret

```bash
echo -n "your-smtp-password-here" | gcloud secrets create vaultwarden-smtp-password \
  --data-file=- \
  --project=${PROJECT}
```

**gcloud equivalent (verify):**
```bash
gcloud secrets versions list vaultwarden-smtp-password --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets" \
  -d '{"secretId": "vaultwarden-smtp-password", "replication": {"automatic": {}}}'
```

### Step 6.2 — Add SMTP Configuration

Update `environment_variables` and `secret_environment_variables` in the RAD UI:

```hcl
environment_variables = {
  SMTP_HOST      = "smtp.mailgun.org"
  SMTP_PORT      = "587"
  SMTP_FROM      = "vault@yourdomain.com"
  SMTP_FROM_NAME = "Vaultwarden"
  SMTP_SSL       = "true"
  SMTP_USERNAME  = "postmaster@mg.yourdomain.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "vaultwarden-smtp-password"
}
```

Redeploy and test via the admin panel.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Vaultwarden Logs

In **Logging > Logs Explorer**:

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

**Expected result:** Vaultwarden startup logs include `Rocket launch` and database connection messages. At `LOG_LEVEL=warn` (default), only warnings and errors are logged under normal operation.

### Step 7.2 — Monitor Uptime

Navigate to **Monitoring > Uptime checks**.

**Expected result:** A preconfigured check polling `/alive` shows **Passing**.

---

## Phase 8 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 12–18 minutes.

> **Warning:** Undeploying permanently deletes all resources. Export your vault from any Bitwarden client (Settings > Export vault) before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Container image build | 1 | Yes |
| Confirm Vaultwarden reachable | 2 | No |
| Verify environment variables | 2 | No |
| Create admin account | 3 | No |
| Disable signups | 3 | No |
| Connect Bitwarden clients | 4 | No |
| Test vault operations | 4 | No |
| Set admin token | 5 | No |
| Access and explore admin panel | 5 | No |
| Configure SMTP | 6 | No |
| Review Cloud Logging | 7 | No |
| Monitor uptime check | 7 | No |
| Undeploy infrastructure | 8 | Yes |
