---
title: "Cal.diy on Cloud Run — Lab Guide"
sidebar_label: "Cal CloudRun Lab"
---

# Cal.diy on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cal_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Cal.diy is the MIT-licensed, self-hostable fork of Cal.com — the open-source scheduling platform that eliminates the back-and-forth of meeting coordination. This lab deploys Cal.diy on Google Cloud Run backed by Cloud SQL PostgreSQL 15, Secret Manager-managed encryption keys, and serverless auto-scaling. Cloud Run provides request-based billing and scales to zero when idle.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets (`NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, DB password)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- GCS storage bucket for application data
- Cloud Monitoring uptime checks and alert policies
- Automated database backup Cloud Run job
- `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` auto-computed from the predicted Cloud Run URL

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Create your Cal.diy admin account
- Create event types and booking pages
- Share booking links and test the scheduling flow
- Configure SMTP for booking confirmation emails
- Review logs in Cloud Logging
- Examine Cloud Run revisions and scaling behaviour
- Review uptime monitoring

---

## CLI and REST API Overview

This lab uses two primary tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |
| `curl` | Test HTTP endpoints and verify service health |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, Cloud SQL instance).
3. The following APIs enabled (Services_GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `vpcaccess.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"cal"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"v6.2.0"` | Cal.diy image version — always use a versioned tag, no `latest` |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | No | `5` | Maximum Cloud Run instances |
| `cpu_limit` | No | `"2000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"2Gi"` | Memory per Cloud Run instance |
| `db_name` | No | `"calcom"` | PostgreSQL database name |
| `db_user` | No | `"calcom"` | PostgreSQL database username |
| `container_image_source` | No | `"prebuilt"` | `"prebuilt"` to use official image; `"custom"` for Cloud Build |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | VPC egress: `"ALL_TRAFFIC"` or `"PRIVATE_RANGES_ONLY"` |
| `environment_variables` | No | SMTP defaults | SMTP settings: `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL 15 instance creation | 8–12 min |
| Secret Manager secret creation and propagation | 1–2 min |
| Cloud Build image pipeline (if `container_image_source = "custom"`) | 5–10 min |
| Cloud Run first-boot (`replace-placeholder.sh` + Prisma migrations) | 4–6 min |
| **Total** | **18–30 min** |

> **Note on first boot:** Cal.diy runs `replace-placeholder.sh` on startup to rewrite `NEXT_PUBLIC_WEBAPP_URL` into all Next.js static chunks. This takes approximately 2.5 minutes on Cloud Run's Gen2 execution environment. Prisma migrations add another ~60 seconds. The startup probe is configured with a 6-minute window to accommodate this.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cal.diy Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~cal" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover Cal.diy secrets
export NEXTAUTH_SECRET_ID=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~nextauth-secret" \
  --format="value(name)" \
  --limit=1)
export ENCRYPTION_KEY_ID=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~encryption-key" \
  --format="value(name)" \
  --limit=1)

echo "Service URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the Service URL

```bash
echo "Cal.diy URL: ${SERVICE_URL}"
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
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

**Expected result:** A URL in the format `https://appcal<tenant><id>-<project_number>.<region>.run.app`.

### Step 2.2 — Check the Health Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health"
```

**Expected result:** HTTP `200`. If you see `503`, Cal.diy may still be completing its first-boot sequence. Wait 2 minutes and retry — the startup probe allows up to 6 minutes for first boot.

**Check health response body:**
```bash
curl -s "${SERVICE_URL}/api/health" | jq .
```

**Expected result:** JSON response indicating the service is healthy.

### Step 2.3 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with container image, resource limits, environment variables, and VPC connector details.

### Step 2.4 — Verify Auto-Generated Secrets

```bash
# List all secrets for this Cal.diy deployment
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~cal" \
  --format="table(name, createTime)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Acal"
```

**Expected result:** At minimum two application secrets appear: `*-nextauth-secret` and `*-encryption-key`. Both were auto-generated by `Cal_Common` during the `tofu apply`. A third secret for the database password is also present.

---

## Phase 3 — Set Up Cal.diy [MANUAL]

### Step 3.1 — Create Your Admin Account

Open `${SERVICE_URL}` in a browser.

Cal.diy presents an account creation form on first visit.

1. Enter your **name**, **email address**, and a strong **password**.
2. Click **Create account**.
3. Cal.diy redirects to the onboarding wizard.

**Expected result:** You are logged into the Cal.diy dashboard.

### Step 3.2 — Complete Onboarding

The onboarding wizard walks through:
1. **Profile setup** — username, timezone, language.
2. **Connect your calendar** — Google Calendar, Outlook, or other supported calendars.
3. **Set working hours** — define your default availability.

**Expected result:** Your Cal.diy profile is configured with your preferred username and timezone.

### Step 3.3 — View the NEXTAUTH_SECRET (Informational)

The `NEXTAUTH_SECRET` is injected from Secret Manager. You can confirm it is present in the Cloud Run environment:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" \
  | jq '[.spec.template.spec.containers[0].env[] | select(.name == "NEXTAUTH_SECRET" or .name == "CALENDSO_ENCRYPTION_KEY")] | length'
```

**Expected result:** Returns `2` — both secrets are injected as environment variables from Secret Manager. Their values are resolved at runtime and are not stored in the response.

---

## Phase 4 — Create Event Types and Test Booking [MANUAL]

### Step 4.1 — Create Your First Event Type

1. In the Cal.diy dashboard, click **Event Types** in the left sidebar.
2. Click **New event type** (or **Add** button).
3. Fill in:
   - **Title**: e.g., "30-Minute Discovery Call"
   - **URL slug**: auto-populated from the title
   - **Duration**: 30 minutes
   - **Description** (optional)
4. Click **Continue**.
5. Configure availability (which days/times this event is bookable).
6. Click **Create**.

**Expected result:** The event type appears in your list at `${SERVICE_URL}/<your-username>/30-minute-discovery-call`.

### Step 4.2 — Test Your Booking Page

```bash
echo "Your booking page: ${SERVICE_URL}/<your-username>"
```

Open the URL in a private browser window.

**Expected result:** The Cal.diy public booking page loads, showing your available event types. Clicking an event type displays available time slots based on your configured availability.

### Step 4.3 — Check the Embedded URL

The `NEXT_PUBLIC_WEBAPP_URL` environment variable is embedded in the Next.js static assets. Verify it matches your Cloud Run URL:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" \
  | jq '.spec.template.spec.containers[0].env[] | select(.name == "NEXT_PUBLIC_WEBAPP_URL")'
```

**Expected result:** The `NEXT_PUBLIC_WEBAPP_URL` matches your `SERVICE_URL`. This was auto-computed from the predicted Cloud Run URL pattern (`https://appcal<tenant><id>-<project_number>.<region>.run.app`) and baked into the static chunks via `replace-placeholder.sh` on first boot.

### Step 4.4 — Create a Second Event Type

1. Return to **Event Types** in the dashboard.
2. Click **New event type**.
3. Create a "60-Minute Strategy Session" event.

**Expected result:** Two event types appear on your public booking page.

---

## Phase 5 — Configure Email Notifications [MANUAL]

### Step 5.1 — Verify SMTP Configuration

Cal.diy sends booking confirmations and reminders via SMTP. Check which SMTP variables are currently configured:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" \
  | jq '.spec.template.spec.containers[0].env[] | select(.name | startswith("SMTP") or . == "EMAIL_FROM")'
```

**Expected result:** SMTP environment variables are present. If `SMTP_HOST` is empty, booking confirmation emails will not be sent.

### Step 5.2 — Update SMTP Settings

If you have an SMTP provider, update the `environment_variables` in the RAD UI and re-deploy, or use the following approach to verify what needs updating:

```hcl
# In your tfvars or RAD UI:
environment_variables = {
  EMAIL_FROM    = "noreply@cal.example.com"
  SMTP_HOST     = "smtp.mailgun.org"
  SMTP_PORT     = "587"
  SMTP_USER     = "postmaster@mg.example.com"
  SMTP_SECURE   = "true"
}

secret_environment_variables = {
  SMTP_PASSWORD = "cal-smtp-password-secret-name"
}
```

### Step 5.3 — Check Email Settings in Cal.diy Admin

1. Navigate to **Settings** > **Security** in the Cal.diy dashboard.
2. Review **Two-factor authentication** and **Email** notification settings.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Cal.diy Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console, or use gcloud:

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
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 30
  }'
```

**Expected result:** Cal.diy startup logs appear, including output from `replace-placeholder.sh`, Prisma migration messages (e.g., `Applying migration...`), and Next.js server start (`ready - started server on 0.0.0.0:3000`).

### Step 6.2 — View Startup Probe Events

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND textPayload:("probe" OR "startup" OR "health")' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Health probe events show the sequence of `/api/health` checks. On first boot, expect a few probe failures before the startup probe succeeds.

### Step 6.3 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, few or no warnings appear after startup completes.

---

## Phase 7 — Cloud Run Features [MANUAL]

### Step 7.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions with traffic percentages. The most recent revision serves 100% of traffic by default.

### Step 7.2 — View Traffic Splitting Configuration

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.traffic'
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '.traffic'
```

**Expected result:** Traffic shows `100%` to the latest revision.

### Step 7.3 — Check Scaling Behaviour

```bash
# Send 10 requests to the health endpoint
for i in $(seq 1 10); do
  curl -s -o /dev/null "${SERVICE_URL}/api/health"
done

# Check instance count in Cloud Monitoring
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --format="table(metric.labels.state, points[0].value.int64Value)"
```

**Expected result:** Cloud Run scales up to handle requests. With `min_instance_count = 0`, instances terminate when idle.

### Step 7.4 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check targeting `${SERVICE_URL}/api/health` shows **Passing** from multiple global locations.

### Step 7.5 — Review Environment Variables

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" \
  | jq '.spec.template.spec.containers[0].env | map(select(.name | test("NEXT_PUBLIC|NEXTAUTH|NODE_ENV"))) | .[].name'
```

**Expected result:** `NEXT_PUBLIC_WEBAPP_URL`, `NEXTAUTH_URL`, and `NODE_ENV` are listed. These are injected automatically by `Cal_CloudRun` and cannot be absent.

---

## Phase 8 — Database Operations [MANUAL]

### Step 8.1 — View the Cloud SQL Instance

```bash
gcloud sql instances list \
  --project=${PROJECT} \
  --filter="name~cal"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances"
```

**Expected result:** The Cloud SQL PostgreSQL 15 instance is listed with status `RUNNABLE`.

### Step 8.2 — View the Database Password Secret

```bash
# List the DB password secret (do NOT print the value in a lab environment)
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~db-password" \
  --format="table(name, createTime)"
```

**Expected result:** The database password secret is listed. This was auto-generated by `App_CloudRun` and injected as `DB_PASSWORD` into both the `db-init` job and the Cal.diy container.

### Step 8.3 — View Backup Job

```bash
gcloud run jobs list \
  --region=${REGION} \
  --project=${PROJECT} \
  --filter="name~backup"
```

**Expected result:** A backup Cloud Run Job is listed. It runs on the schedule defined by `backup_schedule` (default: `0 2 * * *` — 2 AM UTC daily).

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database, secrets, and GCS bucket. Export your Cal.diy data before undeploying if you need to preserve it.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying, you may encounter:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Resolution:** Wait 20–30 minutes and re-run `tofu destroy`. GCP releases serverless IPv4 addresses asynchronously after Cloud Run service deletion.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager credentials (NEXTAUTH_SECRET, ENCRYPTION_KEY) | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| NEXT_PUBLIC_WEBAPP_URL auto-wiring | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Confirm Cal.diy is reachable | 2 | No |
| Verify auto-generated secrets | 2 | No |
| Create admin account | 3 | No |
| Complete onboarding wizard | 3 | No |
| Create event types | 4 | No |
| Test booking page | 4 | No |
| Configure SMTP | 5 | No |
| Review Cloud Logging | 6 | No |
| Examine revisions and traffic | 7 | No |
| Review uptime checks | 7 | No |
| Inspect database and backup jobs | 8 | No |
| Undeploy infrastructure | 9 | Yes |
