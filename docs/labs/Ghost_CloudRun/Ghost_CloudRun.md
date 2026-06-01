---
title: "Ghost on Cloud Run — Lab Guide"
sidebar_label: "Ghost CloudRun"
---

# Ghost on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghost_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Ghost is an open-source publishing platform for creating professional online publications — blogs, newsletters, and membership sites. This lab deploys Ghost 6.x on Google Cloud Run backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS for content storage via GCS Fuse, and Redis caching. Cloud Run provides serverless auto-scaling and scales to zero when idle.

### What the Module Automates

- Cloud Run service with Cloud SQL Auth Proxy sidecar
- Cloud SQL MySQL 8.0 instance, database, and user
- Cloud Filestore (NFS) instance for shared content storage
- GCS Fuse volume mounts and Cloud Storage buckets
- Secret Manager secrets (admin password, DB password)
- Artifact Registry repository and Cloud Build image pipeline
- Serverless VPC Access connector for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks and alert policies
- Automated backup Cloud Run job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Complete the Ghost admin setup wizard
- Create and publish content (posts, pages, tags)
- Configure membership tiers and newsletter settings (SMTP)
- Explore themes and design settings
- Review logs in Cloud Logging and metrics in Cloud Monitoring
- Examine Cloud Run revisions and traffic splitting

---

## CLI and REST API Overview

This lab uses two primary tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, Cloud SQL instance, and NFS server).
3. The following APIs enabled (Services GCP handles this):
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `vpcaccess.googleapis.com`
   - `file.googleapis.com`
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
| `application_name` | No | `"ghost"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"6.14.0"` | Ghost container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 = scale to zero) |
| `max_instance_count` | No | `5` | Maximum Cloud Run instances |
| `cpu_limit` | No | `"2000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"4Gi"` | Memory per Cloud Run instance |
| `db_name` | No | `"ghost"` | MySQL database name |
| `db_user` | No | `"ghost"` | MySQL database username |
| `enable_redis` | No | `true` | Enable Redis caching (uses NFS server IP by default) |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP) |
| `redis_port` | No | `"6379"` | Redis port |
| `enable_nfs` | No | `true` | Mount NFS for Ghost content |
| `nfs_mount_path` | No | `"/mnt/nfs"` | NFS mount path inside the container |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | VPC egress: `"ALL_TRAFFIC"` or `"PRIVATE_RANGES_ONLY"` |
| `environment_variables` | No | SMTP defaults | SMTP settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM` |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL MySQL instance creation | 8–12 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| NFS provisioning and mount validation | 3–5 min |
| **Total** | **18–31 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Ghost Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps using gcloud discovery:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~ghost" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~ghost" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the Service URL

```bash
echo "Ghost URL: ${SERVICE_URL}"
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

**Expected result:** A URL in the format `https://<hash>-<hash>.a.run.app` is printed. This is the public Ghost URL.

### Step 2.2 — Confirm Ghost is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}
```

**Expected result:** HTTP `200`. If you see `503`, Cloud Run may still be starting the first instance — wait 30 seconds and retry.

### Step 2.3 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with the container image, resource limits, and VPC connector details.

---

## Phase 3 — Set Up Ghost Admin [MANUAL]

### Step 3.1 — Access the Admin Setup Wizard

Open a browser and navigate to:

```
${SERVICE_URL}/ghost
```

Ghost displays a setup wizard on the first visit.

**Expected result:** The Ghost setup wizard appears with fields for site title, admin name, email, and password.

### Step 3.2 — Retrieve Admin Credentials from Secret Manager

If admin credentials were pre-generated by the module, retrieve them:

```bash
# List Ghost-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~ghost"

# Retrieve admin password
gcloud secrets versions access latest \
  --secret="$(gcloud secrets list --project=${PROJECT} --filter='name~ghost-admin-password' --format='value(name)' --limit=1)" \
  --project=${PROJECT}
```

**gcloud — list all secrets for this deployment:**
```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="labels.app=ghost" \
  --format="table(name, createTime)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=labels.app%3Dghost"
```

**Expected result:** The secret list shows Ghost database and admin secrets. The admin password is returned as a base64-encoded payload. Decode with `base64 -d`.

### Step 3.3 — Complete Initial Setup

1. Enter a **site title** (e.g. "My Ghost Blog").
2. Enter your **admin name, email, and password**.
3. Click **Create your account**.
4. Ghost redirects to the Admin dashboard.

**Expected result:** You are logged into the Ghost Admin panel at `${SERVICE_URL}/ghost/#/dashboard`.

---

## Phase 4 — Explore the Publishing Platform [MANUAL]

### Step 4.1 — Create a New Post

1. In the Admin panel, click **Posts** in the left sidebar.
2. Click **New post** (top-right button).
3. Enter a title and body text using the card-based editor.
4. Click the settings gear (top-right) to add tags and a featured image.
5. Click **Publish** > **Publish** to confirm.

**Expected result:** The post appears in the **Posts** list with status `Published`. The public site at `${SERVICE_URL}` shows the post on the front page.

### Step 4.2 — Explore Pages and Tags

1. Navigate to **Pages** in the sidebar — create a static page (e.g. "About").
2. Navigate to **Tags** — create a tag and associate it with your post.

**Expected result:** The tag appears as a filter on the public site; the static page is accessible at `${SERVICE_URL}/about`.

### Step 4.3 — View the Public Site

Open `${SERVICE_URL}` in a browser.

**Expected result:** The default Ghost Casper theme renders with your published post on the front page.

---

## Phase 5 — Members and Newsletter Setup [MANUAL]

### Step 5.1 — Configure Membership Settings

1. In Ghost Admin, navigate to **Settings** > **Members**.
2. Review **Access** settings — toggle between Free and Paid tiers.
3. Enable the Members feature if not already active.

**Expected result:** The Members section shows zero subscribers. The membership portal is available at `${SERVICE_URL}/#/portal`.

### Step 5.2 — Explore Newsletter Settings

1. Navigate to **Settings** > **Email newsletter**.
2. Review **Sender name** and **Reply-to address**.
3. Note that SMTP is configured via the `SMTP_HOST`, `SMTP_PORT`, and `SMTP_USER` environment variables set in your deployment configuration.

**gcloud — verify SMTP env vars in the Cloud Run revision:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name | startswith("SMTP"))'
```

**Expected result:** SMTP settings are injected as environment variables. For newsletters to send, a valid SMTP provider must be configured.

### Step 5.3 — Review the Subscription Portal

1. Navigate to **Settings** > **Portal**.
2. Click **Customise** to adjust the sign-up form appearance.
3. Click **Preview** to view the subscription portal overlay.

**Expected result:** A styled sign-up portal appears. Members can subscribe using their email address.

---

## Phase 6 — Theme and Customisation [MANUAL]

### Step 6.1 — Explore Themes

1. Navigate to **Settings** > **Theme**.
2. The default **Casper** theme is active.
3. Click **Change theme** to browse or upload a custom `.zip` theme.

**Expected result:** The Themes page lists available themes. Casper is marked as active.

### Step 6.2 — Explore Design Settings

1. Navigate to **Settings** > **Design**.
2. Adjust **accent colour**, **logo**, and **cover image**.
3. Preview changes live on the public site.

**Expected result:** Changes are reflected immediately on the public front page after saving.

### Step 6.3 — Ghost Handlebars Templates (Overview)

Ghost uses [Handlebars](https://handlebarsjs.com/) templating. Custom themes are uploaded via the Admin panel and stored in the Ghost content directory on the NFS volume. Key template files:
- `index.hbs` — front page listing
- `post.hbs` — single post layout
- `default.hbs` — base wrapper layout

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Ghost Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console.

Use the following query to view Cloud Run Ghost logs:

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
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Ghost startup logs appear, including the database connection line and `Ghost boot 6.x.x` banner. Cloud SQL Auth Proxy connection logs also appear.

### Step 7.2 — Filter for Errors

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
severity>=WARNING
```

**Expected result:** Under normal operation, only informational logs appear. Warnings may appear if the NFS mount is slow to initialise on first boot.

---

## Phase 8 — Cloud Run Features [MANUAL]

### Step 8.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions, each with a traffic percentage. The most recent revision serves 100% of traffic by default.

### Step 8.2 — View Traffic Splitting Configuration

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

**Expected result:** Traffic configuration shows `100%` directed to the latest revision. Traffic can be split between revisions for canary releases by updating the service in the Cloud Console.

### Step 8.3 — Check Scaling Behaviour

Trigger a request to the service and observe instance count:

```bash
# Send 10 requests
for i in $(seq 1 10); do curl -s -o /dev/null ${SERVICE_URL}; done

# Check current instance count in Monitoring
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** Cloud Run scales up instances to handle the concurrent requests, then scales back down toward `min_instance_count` when traffic stops. With `min_instance_count = 0`, all instances terminate when idle (scale to zero).

### Step 8.4 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check shows **Passing** from multiple global locations.

---

## Phase 9 — Delete [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

**Approximate delete duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database and NFS content. Export your Ghost content before deleting: Ghost Admin > Settings > Labs > Export.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL MySQL 8.0 database | 1 | Yes |
| Cloud Filestore NFS mount | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Note service URL from RAD UI deployment panel | 2 | No |
| Confirm Ghost is reachable | 2 | No |
| Ghost admin setup wizard | 3 | No |
| Retrieve admin credentials from Secret Manager | 3 | No |
| Create and publish posts | 4 | No |
| Configure membership and newsletter | 5 | No |
| Explore themes and design settings | 6 | No |
| Review Cloud Logging | 7 | No |
| Examine revisions and traffic splitting | 8 | No |
| Review uptime checks | 8 | No |
| Delete infrastructure | 9 | Yes |
