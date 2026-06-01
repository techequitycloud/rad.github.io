---
title: "Nextcloud on Cloud Run — Lab Guide"
sidebar_label: "Nextcloud CloudRun Lab"
---

# Nextcloud on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Nextcloud_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Nextcloud is the leading open-source self-hosted file sync and collaboration platform, used by 400M+ users as a GDPR-compliant alternative to Google Drive and OneDrive. This lab deploys Nextcloud 30 on Google Cloud Run backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS for persistent config and data storage, and Redis caching. Cloud Run provides serverless auto-scaling and scales to zero when idle.

### What the Module Automates

- Cloud Run v2 (Gen2) service with Cloud SQL Auth Proxy sidecar
- Cloud SQL MySQL 8.0 instance, database (utf8mb4), and user (mysql_native_password)
- Cloud Filestore (NFS) instance for shared `config/` and `data/` persistence
- GCS storage bucket provisioning
- Secret Manager secrets (admin password, DB password, root password)
- Artifact Registry repository and Cloud Build custom image pipeline (PHP limits baked in)
- Serverless VPC Access connector for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks and alert policies
- Automated backup Cloud Run job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Retrieve the admin password from Secret Manager
- Log in to Nextcloud and explore the Files, Calendar, and Contacts apps
- Upload files and test WebDAV access
- Install additional apps from the Nextcloud App Store
- Configure sharing settings and user management
- Review startup logs in Cloud Logging

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |
| `curl` | Test Nextcloud status, WebDAV, and OCS API endpoints |

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

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier (e.g. `"prod"`) |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"30"` | Nextcloud version tag |
| `nextcloud_admin_user` | No | `"admin"` | Admin account username |
| `php_memory_limit` | No | `"512M"` | PHP memory limit |
| `upload_max_filesize` | No | `"512M"` | Max upload file size |
| `post_max_size` | No | `"512M"` | Max POST body size |
| `cpu_limit` | No | `"2000m"` | CPU per instance |
| `memory_limit` | No | `"4Gi"` | Memory per instance |
| `db_name` | No | `"nextcloud"` | MySQL database name |
| `db_user` | No | `"nextcloud"` | MySQL database username |
| `enable_redis` | No | `true` | Enable Redis caching |
| `enable_nfs` | No | `true` | Mount NFS for persistence |
| `backup_schedule` | No | `"0 2 * * *"` | Backup cron schedule |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL MySQL instance creation | 8–12 min |
| Cloud Build image build | 5–10 min |
| Cloud Run service deployment | 2–4 min |
| NFS provisioning | 3–5 min |
| **Total** | **18–31 min** |

> **First-boot note:** Nextcloud runs `occ maintenance:install` before Apache starts. On a fresh Cloud SQL instance this takes 2–5 minutes. The service URL will not respond until installation completes. The startup probe allows up to 6 minutes of tolerance.

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Nextcloud Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for DB password |
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

### Step 2.1 — Confirm Nextcloud is Running

```bash
curl -s "${SERVICE_URL}/status.php" | jq .
```

**Expected result:**
```json
{
  "installed": true,
  "maintenance": false,
  "needsDbUpgrade": false,
  "version": "30.0.x",
  "versionstring": "30.0.x"
}
```

If `"installed": false`, Nextcloud is still initialising. Wait 60 seconds and retry.

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
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '.urls[0]'
```

### Step 2.2 — Retrieve Admin Credentials from Secret Manager

```bash
# Find the admin password secret
ADMIN_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~admin-password" \
  --format="value(name)" \
  --limit=1)

echo "Admin secret: ${ADMIN_SECRET}"

# Retrieve the admin password
ADMIN_PASS=$(gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project=${PROJECT})

echo "Admin password: ${ADMIN_PASS}"
```

**gcloud — list all secrets for this deployment:**
```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~nextcloud" \
  --format="table(name, createTime)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Anextcloud" \
  | jq '.secrets[].name'
```

**Expected result:** A 24-character alphanumeric admin password is returned.

### Step 2.3 — Log In to Nextcloud

Open a browser and navigate to `${SERVICE_URL}`.

Enter:
- **Username:** the value of `nextcloud_admin_user` (default: `admin`)
- **Password:** retrieved from Secret Manager in Step 2.2

**Expected result:** The Nextcloud Files dashboard appears. You are logged in as the admin user.

---

## Phase 3 — Explore the Files App [MANUAL]

### Step 3.1 — Upload a File

1. In the Nextcloud Files app, click the **+** (New) button at the top.
2. Select **Upload file**.
3. Choose a local file (e.g. a PDF, image, or text file).

**Expected result:** The file appears in the Files list with name, size, and modification date.

### Step 3.2 — Create a Folder and Move Files

1. Click the **+** button and select **New folder**.
2. Name it `Lab-Files`.
3. Drag the uploaded file into the new folder, or use the three-dot menu to **Move or copy** it.

**Expected result:** The file moves to `Lab-Files`. The folder structure persists across sessions.

### Step 3.3 — Share a File

1. Hover over a file and click the **Share** icon (person with plus sign).
2. In the sharing panel, click **Share link**.
3. Copy the generated link.

```bash
# Test the share link (replace with actual link)
SHARE_LINK="https://PASTE_YOUR_SHARE_LINK_HERE"
curl -sI "${SHARE_LINK}" | head -5
```

**Expected result:** HTTP 200 (or redirect to the shared file download page).

### Step 3.4 — Test WebDAV Access

```bash
ADMIN_USER="admin"   # your nextcloud_admin_user

# List root files via WebDAV
curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -X PROPFIND \
  "${SERVICE_URL}/remote.php/dav/files/${ADMIN_USER}/" \
  -H "Depth: 1" 2>&1 | grep -E "<d:href>|HTTP/"
```

**Expected result:** XML response with `HTTP/1.1 207 Multi-Status` and a list of `<d:href>` elements for each file and folder.

### Step 3.5 — Upload a File via WebDAV

```bash
# Create a test file
echo "Hello from WebDAV lab step" > /tmp/webdav-test.txt

# Upload via WebDAV PUT
curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -T /tmp/webdav-test.txt \
  "${SERVICE_URL}/remote.php/dav/files/${ADMIN_USER}/webdav-test.txt"
```

**Expected result:** HTTP 201 Created. The file appears in the Nextcloud Files UI.

---

## Phase 4 — Install Apps from the App Store [MANUAL]

### Step 4.1 — Browse the App Store

1. Click the **grid** icon (top-right navigation bar).
2. Select **Apps**.
3. Browse by category: Files, Collaboration, Office, Security.

**Expected result:** App Store loads with available apps. Apps flagged as installed are listed under **Active apps**.

### Step 4.2 — Enable the Calendar App

1. Search for **Calendar** in the App Store.
2. Click **Download and enable**.
3. Wait for installation to complete.
4. Navigate to the Calendar app from the top navigation.

**Expected result:** A calendar interface appears. Create a test event to verify the app works.

### Step 4.3 — Enable the Contacts App

1. Return to **Apps**.
2. Search for **Contacts** and click **Download and enable**.
3. Navigate to Contacts.

**Expected result:** The Contacts app opens. Click **+ New contact** to create a test contact.

### Step 4.4 — Enable the Talk App (Optional)

1. Search for **Talk** in the App Store.
2. Click **Download and enable**.

**Expected result:** Talk appears in the navigation. Open it to access the messaging and video call interface.

---

## Phase 5 — Administration [MANUAL]

### Step 5.1 — Access the Administration Panel

1. Click your username (top-right).
2. Select **Administration settings**.

**Expected result:** The Administration settings panel opens with sections for Overview, Basic settings, Sharing, and Security.

### Step 5.2 — Review the Overview Page

1. Navigate to **Overview** in the Administration settings.
2. Review any listed security warnings.

**Expected result:** Common first-deployment warnings appear. The `NEXTCLOUD_TRUSTED_DOMAINS`, `OVERWRITEHOST`, and `OVERWRITECLIURL` values are set automatically by `entrypoint.sh` and should not cause trust domain warnings.

### Step 5.3 — Create a Second User

1. Navigate to **Users** (top-right menu or Administration).
2. Click **New user**.
3. Enter username `testuser`, an email, and a password.

**Expected result:** The user is created and appears in the Users list.

### Step 5.4 — Verify NFS Persistence

Log out and log back in with the `testuser` account. Upload a file.

Log out, wait 30 seconds for any potential scale-to-zero to occur, then log back in as `admin`.

```bash
# Verify files are still accessible
curl -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -X PROPFIND \
  "${SERVICE_URL}/remote.php/dav/files/${ADMIN_USER}/" \
  -H "Depth: 1" 2>&1 | grep "<d:href>"
```

**Expected result:** All uploaded files are still present. NFS ensures persistence across Cloud Run instance restarts and scale-to-zero events.

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Nextcloud Application Logs

Navigate to **Cloud Console > Logging > Logs Explorer** and use:

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

**Expected result:** Startup logs include:
- `Nextcloud Container Startup`
- `NFS mount detected at /mnt/nfs — enabling persistent config/data`
- `DB_HOST is a Unix socket path; overriding to DB_IP for TCP`
- `MySQL is reachable after Xs`
- `OVERWRITECLIURL` and `NEXTCLOUD_TRUSTED_DOMAINS` values

### Step 6.2 — View db-init Job Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND labels."run.googleapis.com/job_name"~"db-init"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Database initialisation logs:
- `Cloud SQL volume mounted at /cloudsql; waiting for socket...`
- `Socket ready after Xs`
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

### Step 7.2 — Inspect the Service Configuration

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service details show container image, resource limits (2 vCPU / 4 Gi), VPC connector, and Gen2 execution environment.

### Step 7.3 — Check Scaling Behaviour

```bash
# Send concurrent requests
for i in $(seq 1 10); do curl -s -o /dev/null "${SERVICE_URL}/status.php" & done; wait

# Check instance count
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** With `max_instance_count = 1`, a single instance handles all requests. With `min_instance_count = 0`, the instance terminates when idle (scale to zero).

### Step 7.4 — View Traffic Configuration

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="json" | jq '.spec.traffic'
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  | jq '.traffic'
```

**Expected result:** 100% of traffic routed to the latest revision.

### Step 7.5 — Review Uptime Check

Navigate to **Cloud Console > Monitoring > Uptime checks**.

**Expected result:** The uptime check shows **Passing** from multiple global locations.

---

## Phase 8 — Nextcloud API Exploration [MANUAL]

### Step 8.1 — Query the OCS API

Nextcloud's OCS API provides programmatic access to users, apps, and sharing.

```bash
# List installed apps
curl -s \
  -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "OCS-APIREQUEST: true" \
  "${SERVICE_URL}/ocs/v2.php/apps?format=json" \
  | jq '.ocs.data.apps | length'
```

**Expected result:** A count of installed Nextcloud apps.

### Step 8.2 — List Users via OCS

```bash
curl -s \
  -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "OCS-APIREQUEST: true" \
  "${SERVICE_URL}/ocs/v1.php/cloud/users?format=json" \
  | jq '.ocs.data.users[]'
```

**Expected result:** Array of usernames including `admin` and `testuser`.

### Step 8.3 — Check Disk Usage

```bash
curl -s \
  -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "OCS-APIREQUEST: true" \
  "${SERVICE_URL}/ocs/v1.php/cloud/users/${ADMIN_USER}?format=json" \
  | jq '.ocs.data | {quota, used: .quota.used}'
```

**Expected result:** Quota and used storage values for the admin user. Storage is backed by NFS.

---

## Phase 9 — Undeploy [AUTOMATED]

When finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** to remove all resources.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** This permanently deletes all resources including the database, NFS volume, and all uploaded files. Export important data before undeploying: Administration settings > Export.

> **Known issue — subnet IPv4 release:** If `tofu destroy` fails with `The following serverless IPv4 address(es) on subnet ... are still in use`, wait 20–30 minutes and re-run the destroy. GCP releases these addresses asynchronously.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL MySQL 8.0 (utf8mb4) | 1 | Yes |
| Cloud Filestore NFS mount | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| VPC Access connector and IAM | 1 | Yes |
| Cloud Build image pipeline | 1 | Yes |
| Confirm Nextcloud is running (`/status.php`) | 2 | No |
| Retrieve admin credentials from Secret Manager | 2 | No |
| Log in to Nextcloud | 2 | No |
| Upload files and create folders | 3 | No |
| Share files and test WebDAV | 3 | No |
| Install Calendar and Contacts apps | 4 | No |
| Create users and configure SMTP | 5 | No |
| Verify NFS persistence across restarts | 5 | No |
| Review startup and db-init logs | 6 | No |
| Examine revisions and scaling | 7 | No |
| Query the OCS API | 8 | No |
| Undeploy infrastructure | 9 | Yes |
