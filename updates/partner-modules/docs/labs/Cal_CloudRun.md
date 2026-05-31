# Cal.diy on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cal_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Cal.diy is the MIT-licensed, self-hostable fork of Cal.com — the open-source scheduling platform that eliminates the back-and-forth of meeting coordination. This lab deploys Cal.diy on Google Cloud Run backed by Cloud SQL PostgreSQL 15, Secret Manager-managed encryption keys, and serverless auto-scaling.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets (`NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, DB password)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- GCS storage bucket for application data
- Cloud Monitoring uptime checks
- Automated database backup Cloud Run job
- `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` auto-computed from the predicted Cloud Run URL

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Log in to Cal.diy and complete initial setup
- Create your first event type and booking page
- Configure SMTP for email notifications
- Review logs in Cloud Logging and metrics in Cloud Monitoring
- Examine Cloud Run revisions and scaling behaviour

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
   - `vpcaccess.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. Access to the RAD UI with permission to deploy modules.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"cal"` | Base name for resources |
| `application_version` | No | `"v6.2.0"` | Cal.diy image version (always versioned — no `latest` tag) |
| `deploy_application` | No | `true` | Set `false` for infrastructure-only provisioning |
| `min_instance_count` | No | `0` | Minimum instances (0 = scale to zero) |
| `max_instance_count` | No | `5` | Maximum instances |
| `cpu_limit` | No | `"2000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"2Gi"` | Memory per Cloud Run instance |
| `db_name` | No | `"calcom"` | PostgreSQL database name |
| `db_user` | No | `"calcom"` | PostgreSQL database username |
| `environment_variables` | No | SMTP defaults | SMTP: `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Fill in the variables form in the RAD UI and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Secret Manager secret creation | 1–2 min |
| Cloud Build image build | 5–10 min |
| Cloud Run first-boot (migrations + replace-placeholder.sh) | 4–6 min |
| **Total** | **18–30 min** |

### Step 1.3 — Record Outputs

After deployment, the following outputs are available:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cal.diy Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

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

echo "Cal.diy URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm Cal.diy is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/health
```

**Expected result:** HTTP `200`. If you see `503`, Cal.diy may still be completing its first-boot startup (Prisma migrations + replace-placeholder.sh). Wait 2 minutes and retry.

### Step 2.2 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with resource limits and VPC connector details.

---

## Phase 3 — Set Up Cal.diy [MANUAL]

### Step 3.1 — Create Your Admin Account

Open `${SERVICE_URL}` in a browser. Cal.diy presents an account creation form.

1. Enter your name, email, and password.
2. Click **Create account**.
3. You are redirected to the Cal.diy dashboard.

### Step 3.2 — View Auto-Generated Secrets

```bash
# List Cal.diy secrets
gcloud secrets list --project=${PROJECT} --filter="name~cal"

# View the NEXTAUTH_SECRET (auto-generated by Cal_Common)
NEXTAUTH_SECRET_ID=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~nextauth-secret" \
  --format="value(name)" \
  --limit=1)
echo "NEXTAUTH_SECRET secret: ${NEXTAUTH_SECRET_ID}"
```

**Expected result:** Two application secrets appear: `*-nextauth-secret` and `*-encryption-key`. These were auto-generated by `Cal_Common` and injected into the Cloud Run service.

---

## Phase 4 — Explore Cal.diy [MANUAL]

### Step 4.1 — Create an Event Type

1. In the Cal.diy dashboard, click **Event Types** in the left sidebar.
2. Click **New event type**.
3. Set a title (e.g., "30-Minute Meeting"), duration, and description.
4. Click **Continue** and configure availability.
5. Click **Create**.

### Step 4.2 — Share Your Booking Link

1. Click the event type you created.
2. Copy the booking link (e.g., `${SERVICE_URL}/<username>/30-min`).
3. Open the link in a private browser window.

**Expected result:** The Cal.diy booking page appears with your available time slots.

---

## Phase 5 — Explore Cloud Logging [MANUAL]

### Step 5.1 — View Cal.diy Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Cal.diy startup logs appear, including Prisma migration output and Next.js server start.

### Step 5.2 — Check Health Endpoint

```bash
curl -s "${SERVICE_URL}/api/health" | jq .
```

**Expected result:** JSON response with status `ok` or similar health indicator.

---

## Phase 6 — Cloud Run Features [MANUAL]

### Step 6.1 — Examine Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

### Step 6.2 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check targeting `/api/health` shows **Passing**.

---

## Phase 7 — Undeploy [AUTOMATED]

When finished, return to the RAD UI and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** This permanently deletes all resources including the database. Export your Cal.diy data before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| VPC networking and IAM | 1 | Yes |
| Container image build | 1 | Yes |
| Note service URL | 2 | No |
| Confirm service is reachable | 2 | No |
| Create admin account | 3 | No |
| View auto-generated secrets | 3 | No |
| Create event types | 4 | No |
| Test booking links | 4 | No |
| Review Cloud Logging | 5 | No |
| Examine revisions and uptime checks | 6 | No |
| Undeploy infrastructure | 7 | Yes |
