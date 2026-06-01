---
title: "Nextcloud on Cloud Run — Lab Guide"
sidebar_label: "Nextcloud CloudRun"
---

# Nextcloud on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Nextcloud_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Nextcloud is the leading open-source self-hosted file sync and collaboration platform. This lab deploys Nextcloud 30 on Google Cloud Run backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS for persistent config and data storage, and Redis caching. Cloud Run provides serverless auto-scaling and scales to zero when idle.

### What the Module Automates

- Cloud Run v2 (Gen2) service with Cloud SQL Auth Proxy sidecar
- Cloud SQL MySQL 8.0 instance, database (utf8mb4), and user (mysql_native_password)
- Cloud Filestore (NFS) instance for shared `config/` and `data/` persistence
- GCS storage bucket provisioning
- Secret Manager secrets (admin password, DB password)
- Artifact Registry repository and Cloud Build custom image pipeline (PHP limits baked in)
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks
- Automated backup Cloud Run job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Log in to Nextcloud with the admin credentials from Secret Manager
- Upload files and explore the Files app
- Install additional Nextcloud apps from the App Store
- Configure sharing and external storage settings
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |
| `curl` | Test Nextcloud WebDAV and status endpoints |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, Cloud SQL instance, and NFS server).
3. The following APIs enabled (Services_GCP handles this):
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
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"nextcloud"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"30"` | Nextcloud version tag |
| `nextcloud_admin_user` | No | `"admin"` | Admin account username |
| `php_memory_limit` | No | `"512M"` | PHP memory limit (baked into image) |
| `upload_max_filesize` | No | `"512M"` | Maximum upload file size |
| `post_max_size` | No | `"512M"` | Maximum POST body size |
| `cpu_limit` | No | `"2000m"` | CPU per Cloud Run instance |
| `memory_limit` | No | `"4Gi"` | Memory per Cloud Run instance |
| `min_instance_count` | No | `0` | Minimum instances (0 = scale to zero) |
| `max_instance_count` | No | `1` | Maximum instances |
| `db_name` | No | `"nextcloud"` | MySQL database name |
| `db_user` | No | `"nextcloud"` | MySQL database username |
| `enable_redis` | No | `true` | Enable Redis caching (uses NFS server IP by default) |
| `enable_nfs` | No | `true` | Mount NFS for config and data persistence |
| `nfs_mount_path` | No | `"/mnt/nfs"` | NFS mount path inside the container |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
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

> **First-boot note:** Nextcloud runs `occ maintenance:install` synchronously before Apache starts. With a cold Cloud SQL instance this can take 2–5 minutes. The startup probe allows up to 6 minutes (60s initial + 20×15s = 360s). The Cloud Run service URL will not serve traffic until installation completes.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Nextcloud Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~nextcloud" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Nextcloud URL: ${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Check the Status Endpoint

```bash
curl -s "${SERVICE_URL}/status.php"
```

**Expected result:** JSON output like:
```json
{"installed":true,"maintenance":false,"needsDbUpgrade":false,"version":"30.0.x","versionstring":"30.0.x","edition":"","productname":"Nextcloud","extendedSupport":false}
```

If `"installed":false`, Nextcloud is still running `occ maintenance:install` — wait 60–120 seconds and retry.

### Step 2.2 — Retrieve Admin Credentials from Secret Manager

```bash
# List Nextcloud-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~nextcloud"

# Retrieve the admin password
ADMIN_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~admin-password" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project=${PROJECT}
```

**Expected result:** The 24-character alphanumeric admin password is printed. Save it for the login step.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Anextcloud" \
  | jq '.secrets[].name'
```

### Step 2.3 — Log In to Nextcloud

Open a browser and navigate to `${SERVICE_URL}`.

Enter:
- **Username:** the value of `nextcloud_admin_user` (default: `admin`)
- **Password:** retrieved in Step 2.2

**Expected result:** The Nextcloud Files dashboard appears.

---

## Phase 3 — Explore the Files App [MANUAL]

### Step 3.1 — Upload a File

1. In the Nextcloud Files app, click the **+** (New) button.
2. Select **Upload file**.
3. Choose any local file (e.g. a PDF or image).
4. Click **Open** to upload.

**Expected result:** The file appears in the Files list with its name, size, and modification date.

### Step 3.2 — Create a Folder

1. Click the **+** button and select **New folder**.
2. Name the folder (e.g. `Documents`).
3. Click the folder to open it, then upload another file into it.

**Expected result:** The folder and its contents are visible. Files persist across browser sessions because they are stored on NFS (`/mnt/nfs/nextcloud-data`).

### Step 3.3 — Share a File

1. Hover over a file and click the **Share** (person+) icon.
2. In the Sharing panel, click **Share link**.
3. Copy the generated public link.

```bash
# Test the share link
curl -sI "PASTE_SHARE_LINK_HERE" | head -5
```

**Expected result:** HTTP 200 or 301 redirect. The link is publicly accessible if `ingress_settings = "all"`.

### Step 3.4 — Test WebDAV Access

Nextcloud exposes a WebDAV endpoint at `/remote.php/dav/files/<username>/`.

```bash
ADMIN_USER="admin"        # your nextcloud_admin_user value
ADMIN_PASS="PASTE_PASSWORD_HERE"

# List root files via WebDAV
curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -X PROPFIND \
  "${SERVICE_URL}/remote.php/dav/files/${ADMIN_USER}/" \
  -H "Depth: 1" \
  --verbose 2>&1 | grep -E "href|status"
```

**Expected result:** WebDAV XML response listing files in the root directory with HTTP 207 Multi-Status.

---

## Phase 4 — App Store & Integrations [MANUAL]

### Step 4.1 — Browse the App Store

1. In the Nextcloud Admin panel, navigate to **Apps** (grid icon in top-right).
2. Browse available apps by category: Files, Collaboration, Office, Security, Integration.

**Expected result:** The App Store lists available apps. Apps are installed directly into the Nextcloud data directory on NFS.

### Step 4.2 — Install the Calendar App

1. Search for **Calendar** in the App Store.
2. Click **Download and enable**.

**Expected result:** Calendar appears in the navigation menu. Navigate to it to create an event.

### Step 4.3 — Install the Contacts App

1. Return to **Apps** and search for **Contacts**.
2. Click **Download and enable**.

**Expected result:** Contacts appears in the navigation menu. Import a `.vcf` file to populate it.

### Step 4.4 — Verify App Persistence

1. Log out and log back in.
2. Confirm the Calendar and Contacts apps are still enabled.

**Expected result:** Apps remain installed because the app data is stored on NFS and persists across Cloud Run restarts.

---

## Phase 5 — Admin Configuration [MANUAL]

### Step 5.1 — Access Admin Settings

1. Click your username in the top-right corner.
2. Select **Administration settings**.

**Expected result:** The Administration panel opens showing Overview, Basic settings, Sharing, and more.

### Step 5.2 — Review Security Warnings

1. In Administration settings, navigate to **Overview**.
2. Review any security warnings listed at the top.

Common warnings in a fresh deployment:
- **Maintenance window** — Set in `config.php` or via `occ` command.
- **Default phone region** — Set `default_phone_region` in `config.php`.
- **Hashing cost** — Adjust if recommended.

### Step 5.3 — Create a User

1. Navigate to **Users** (top-right menu).
2. Click **New user**.
3. Enter a username, email, and password.
4. Assign the user to a group if desired.

```bash
# List users via OCC (requires kubectl exec for GKE; for Cloud Run use gcloud exec)
gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)"
```

**Expected result:** The new user can log in and access their own file storage space.

### Step 5.4 — Configure Email (SMTP)

1. Navigate to **Administration settings** > **Basic settings**.
2. Scroll to **Email server**.
3. Enter SMTP server details matching your `environment_variables` configuration.

To verify SMTP environment variables are set in the Cloud Run revision:

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].env[] | select(.name | startswith("SMTP"))'
```

**Expected result:** SMTP env vars appear in the Cloud Run container spec. Click **Send email** to test delivery.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Nextcloud Application Logs

Navigate to **Logging > Logs Explorer** in the Cloud Console.

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

**Expected result:** Nextcloud startup logs appear, including:
- `NFS mount detected at /mnt/nfs — enabling persistent config/data`
- `DB_HOST is a Unix socket path; overriding to DB_IP for TCP`
- `MySQL is reachable after Xs`
- `OVERWRITECLIURL:` and `NEXTCLOUD_TRUSTED_DOMAINS:` lines
- Apache access logs after the first request

### Step 6.2 — View db-init Job Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND labels."run.googleapis.com/job_name"~"db-init"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Database creation and user setup logs from `db-init.sh`:
- `✓ MySQL is ready`
- `✓ Database created`
- `✓ User created with privileges`
- `✓ Nextcloud database initialization complete`

### Step 6.3 — Filter for Errors

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
severity>=WARNING
```

**Expected result:** Under normal operation, only informational logs appear.

---

## Phase 7 — Cloud Run Features [MANUAL]

### Step 7.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** One or more revisions listed. The most recent serves 100% of traffic.

### Step 7.2 — Check the Startup Probe

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.template.spec.containers[0].startupProbe'
```

**Expected result:** The startup probe targets `/status.php` with a 60-second initial delay and 20 failure thresholds.

### Step 7.3 — Check Scaling Behaviour

```bash
# Send concurrent requests to trigger scale-up
for i in $(seq 1 5); do curl -s -o /dev/null "${SERVICE_URL}/status.php" & done; wait

# Check instance count
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** With `max_instance_count = 1`, a single instance handles all requests. Increase `max_instance_count` for production concurrency.

### Step 7.4 — Review the Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check shows **Passing** from multiple global locations.

---

## Phase 8 — Nextcloud OCC Commands [MANUAL]

The `occ` tool is Nextcloud's command-line administration interface. On Cloud Run, you run OCC commands by invoking them inside a running container using `gcloud run jobs` or through a temporary Cloud Run Job.

### Step 8.1 — Check Nextcloud Status via OCC

Create a one-off Cloud Run Job to run an `occ` command:

```bash
# Get the current container image
IMAGE=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(spec.template.spec.containers[0].image)")

echo "Using image: ${IMAGE}"
```

**Alternative — check status via HTTP:**
```bash
curl -s "${SERVICE_URL}/status.php" | jq .
```

**Expected result:** JSON with `"installed":true` and the current Nextcloud version.

### Step 8.2 — List Installed Apps via the Admin API

```bash
ADMIN_USER="admin"
ADMIN_PASS="PASTE_PASSWORD_HERE"

curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "OCS-APIREQUEST: true" \
  "${SERVICE_URL}/ocs/v2.php/apps?format=json" \
  | jq '.ocs.data.apps[]'
```

**Expected result:** List of all installed Nextcloud app names.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 15–20 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the database, NFS volume, and uploaded files. Export important data before undeploying: Nextcloud Admin > Administration settings > Export.

> **Known issue:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after Cloud Run service deletion. If `tofu destroy` fails with a subnet deletion error, wait 20–30 minutes and re-run.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL MySQL 8.0 database (utf8mb4) | 1 | Yes |
| Cloud Filestore NFS mount | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| VPC Access and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Retrieve admin credentials from Secret Manager | 2 | No |
| Log in and explore Files | 3 | No |
| Upload and share files | 3 | No |
| Test WebDAV access | 3 | No |
| Install Calendar and Contacts apps | 4 | No |
| Configure admin settings and SMTP | 5 | No |
| Review Cloud Logging | 6 | No |
| Examine revisions and scaling | 7 | No |
| Undeploy infrastructure | 9 | Yes |
