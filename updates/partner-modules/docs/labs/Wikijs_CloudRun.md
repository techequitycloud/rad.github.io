# Wiki.js on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wikijs_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **Wiki.js** on Google
Cloud Run Gen2 using the **Wikijs_CloudRun** module. You will experience a modern open-source
wiki platform backed by Cloud SQL PostgreSQL with full-text search, GCS Fuse asset storage,
and Secret Manager credential management — all running as a scalable serverless service.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Wiki.js](#exercise-1--access-wikijs)
6. [Exercise 2 — Create and Edit Pages](#exercise-2--create-and-edit-pages)
7. [Exercise 3 — Navigation and Search](#exercise-3--navigation-and-search)
8. [Exercise 4 — User Management and Permissions](#exercise-4--user-management-and-permissions)
9. [Exercise 5 — Assets and Storage](#exercise-5--assets-and-storage)
10. [Exercise 6 — Storage and Database](#exercise-6--storage-and-database)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Wiki.js?

Wiki.js is a modern, powerful open-source wiki platform built on Node.js with 28,000+ GitHub
stars. It is adopted by software teams, healthcare organisations, educational institutions, and
government agencies as a cost-effective replacement for Confluence ($5–10/user/month savings).
The `Wikijs_CloudRun` module deploys version **2.5.311** on Cloud Run Gen2 backed by Cloud SQL
PostgreSQL 15 with the `pg_trgm` extension for native full-text search.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Rich Editing** | Markdown editor, visual editor, diagram support, page tree navigation |
| **Full-Text Search** | PostgreSQL `pg_trgm` trigram-based search engine with instant results |
| **Authentication** | Local auth, SAML 2.0, OAuth 2.0/OIDC, LDAP/Active Directory |
| **Access Control** | Groups, page-level permissions, role-based access |
| **Asset Storage** | GCS Fuse volume mounted at `/wiki-storage` for persistent file uploads |
| **Serverless Scaling** | Cloud Run Gen2 auto-scaling with scale-to-zero, Direct VPC Egress |
| **Secret Management** | Database password managed by Secret Manager, injected at runtime |
| **Observability** | Cloud Logging structured logs, Cloud Monitoring uptime checks |

---

## 2. Architecture

```
Browser / Client
       │
       ▼ HTTPS
┌─────────────────────────────────────────────────────────────────┐
│  Cloud Run Gen2 Service (wikijs)                                │
│                                                                 │
│  ┌──────────────────────────────────────────┐                   │
│  │  Container: requarks/wiki:2 (custom)      │                  │
│  │  Port: 3000  │  Chromium (PDF export)     │                  │
│  │  DB_TYPE=postgres  DB_PORT=5432           │                  │
│  │  HA_STORAGE_PATH=/wiki-storage            │                  │
│  └──────────────────────────────────────────┘                   │
│                                                                 │
│  ┌──────────────────┐  ┌───────────────────┐                    │
│  │  GCS Fuse Volume  │  │  NFS Filestore     │                  │
│  │  /wiki-storage    │  │  /mnt/nfs          │                  │
│  └──────────────────┘  └───────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
       │ Unix socket via Cloud SQL Auth Proxy (sidecar)
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Cloud SQL PostgreSQL 15                                        │
│  pg_trgm extension (full-text search)                           │
│  DB password → Secret Manager                                   │
└─────────────────────────────────────────────────────────────────┘

Supporting Services:
  Artifact Registry  ← container image (custom build)
  Secret Manager     ← DB_PASS, JWT secret
  GCS Bucket         ← wikijs-storage (asset uploads)
  Cloud Scheduler    ← daily backup job at 02:00 UTC
  Cloud Monitoring   ← uptime check, alert policies
```

Module variable wiring:

```
  Wikijs_CloudRun
    application_name      = "wikijs"     →  Cloud Run service name prefix
    application_version   = "2.5.311"   →  container image tag
    min_instance_count    = 0            →  scale-to-zero
    max_instance_count    = 1            →  cost ceiling
    enable_nfs            = true         →  Filestore NFS at /mnt/nfs
    enable_cloudsql_volume = true        →  Auth Proxy sidecar
    cpu_limit             = "1000m"      →  1 vCPU
    memory_limit          = "2Gi"        →  Chromium/PDF export
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` | Any | System package manager |
| `jq` | 1.6+ | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/cloudsql.admin
roles/secretmanager.admin
roles/storage.admin
roles/monitoring.admin
roles/logging.admin
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set run/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Wikijs_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `wikijs` | Base resource name |
| `application_version` | `2.5.311` | Wiki.js version |
| `min_instance_count` | `0` | Scale-to-zero |
| `max_instance_count` | `1` | Single instance |
| `enable_nfs` | `true` | Filestore NFS mount |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy |

Click **Deploy** and wait for provisioning to complete (approximately 15–25 minutes).

> **What this provisions:** Cloud Run Gen2 service, Cloud SQL PostgreSQL 15 with `pg_trgm`
> extension, Artifact Registry (custom image build), GCS bucket (`wikijs-storage`), Cloud
> Filestore NFS, Secret Manager secrets (DB password, JWT), uptime check, and alert policies.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~wikijs" \
  --limit=1)

# Get the service URL
export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="value(name)" \
  --limit=1)

echo "Wiki.js URL: ${SERVICE_URL}"
echo "Service: ${SERVICE}"
echo "DB Secret: ${DB_SECRET}"
```

---

## Exercise 1 — Access Wiki.js

### Objective

Retrieve the Wiki.js service URL, verify the health endpoint, obtain admin credentials from
Secret Manager, and complete the first-run setup wizard.

### Step 1.1 — Get the Service URL

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '{name, uri: .urls[0], latestReadyRevision}'
```

**Expected result:** A URL in the form `https://wikijs-<hash>-uc.a.run.app`.

### Step 1.2 — Verify the Health Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/healthz"
```

**Expected result:** `200` — the health endpoint confirms the application is running and
connected to PostgreSQL.

### Step 1.3 — Retrieve Admin Credentials from Secret Manager

**gcloud:**
```bash
# Access the DB password (also used as initial admin credential)
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.payload.data' | base64 --decode
```

Note the password for the Wiki.js admin setup.

### Step 1.4 — Complete the Setup Wizard

1. Navigate to `${SERVICE_URL}` in a browser.
2. On first run, the Wiki.js setup wizard appears — enter site title, admin email, and admin
   password (from Step 1.3).
3. Click **Install**.

**Expected result:** Wiki.js redirects to the home page or admin dashboard.

### Step 1.5 — Explore the Admin Panel

1. Navigate to **Administration** (gear icon in the sidebar).
2. Review **General** settings, **Theme**, and **SEO** configuration.
3. Note the **System Info** page showing Node.js version and database connection status.

**Expected result:** Administration panel loads confirming database and storage are connected.

---

## Exercise 2 — Create and Edit Pages

### Objective

Use the Markdown editor and visual editor to create pages, build a page tree, and apply tags.

### Step 2.1 — Create a Page with the Markdown Editor

1. Click **New Page** in the top navigation bar.
2. Select **Markdown** as the editor type.
3. Set the path to `lab/getting-started`.
4. Add content including:
   - Heading: `# Getting Started with Wiki.js on Cloud Run`
   - A paragraph describing the module
   - A code block with a gcloud command
   - A table with two columns
5. Click **Create** to save.

**Expected result:** The page renders with formatted content and appears in the left navigation
tree under `lab/`.

### Step 2.2 — Build a Page Tree

Create two additional pages at these paths:
- `lab/architecture` — describe the Cloud Run architecture
- `lab/deployment` — describe the deployment steps

Wiki.js automatically groups them under `lab/` in the sidebar navigation.

**Expected result:** The left sidebar shows a `lab` section with three nested pages.

### Step 2.3 — Use the Visual (WYSIWYG) Editor

1. Create another page at `lab/visual-test`.
2. Select **Visual Editor** instead of Markdown.
3. Use the toolbar to add bold text, a bulleted list, and an image placeholder.
4. Save the page.

**Expected result:** The page is saved and displays with the visual formatting applied.

### Step 2.4 — Add Tags to a Page

1. Open one of the created pages.
2. Click **Page Actions** (three-dot menu or gear) → **Properties**.
3. In the **Tags** field, add `gcp`, `cloud-run`, and `tutorial`.
4. Save.

**Expected result:** Tags appear below the page title and are searchable.

### Step 2.5 — View Page History

1. On any page you edited, click **Page Actions** → **History**.
2. Review the list of versions with timestamps and editor information.

**Expected result:** Each save appears as a version entry, demonstrating Wiki.js's built-in
version control.

---

## Exercise 3 — Navigation and Search

### Objective

Explore sidebar navigation, test full-text search powered by PostgreSQL `pg_trgm`, and verify
search engine configuration.

### Step 3.1 — Explore Sidebar Navigation

1. From the home page, observe the left sidebar showing the page tree.
2. Expand the `lab/` folder to see nested pages.
3. Click **Browse** in the navigation to see all pages in a flat or tree view.

**Expected result:** All created pages appear in the navigation hierarchy.

### Step 3.2 — Test Full-Text Search

1. Click the **Search** icon in the top bar (or press `S`).
2. Type `Cloud Run` — observe instant results appearing.
3. Try a partial word like `arch` — `pg_trgm` trigram matching finds `architecture`.

**Expected result:** Pages containing the search terms appear with highlighted excerpts.

### Step 3.3 — Verify the Search Engine Configuration

**gcloud (verify pg_trgm extension was installed):**
```bash
# Check the Cloud SQL database for the pg_trgm extension
gcloud sql databases list \
  --instance=$(gcloud sql instances list \
    --project="${PROJECT}" \
    --format="value(name)" --limit=1) \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, state, databaseVersion}'
```

1. Navigate to **Administration > Search Engine** in the Wiki.js admin panel.
2. Confirm **Database — PostgreSQL** is selected.
3. Click **Rebuild Index** to force re-indexing all pages.

**Expected result:** Search engine shows `Database - PostgreSQL` as active, confirming `pg_trgm`
full-text search is operational.

### Step 3.4 — Browse by Tags

1. Click on one of the tags you added in Exercise 2 (`gcp`, `cloud-run`, etc.).
2. Observe the tag page showing all pages with that tag.

**Expected result:** Pages tagged with the selected tag appear in a filtered list view.

---

## Exercise 4 — User Management and Permissions

### Objective

Create user groups with different permission levels, add users, and configure page-level
access control.

### Step 4.1 — Review Default Groups

1. Navigate to **Administration > Groups**.
2. Observe the two default groups: **Administrators** and **Guests**.
3. Click **Administrators** and review the permission rules — note that administrators have
   full access to all pages.

**Expected result:** Two default groups exist with different permission scopes.

### Step 4.2 — Create an Editors Group

1. Click **New Group** and name it `Editors`.
2. Under **Page Rules**, add a rule:
   - Path: `/` (all pages)
   - Access: Read + Write + Comment
3. Save the group.

**Expected result:** `Editors` group appears in the list with the configured page rules.

### Step 4.3 — Create a New User

1. Navigate to **Administration > Users**.
2. Click **New User**.
3. Enter:
   - Email: `editor@example.com`
   - Name: `Lab Editor`
   - Password: a test password
4. Assign the user to the **Editors** group.
5. Save.

**gcloud (verify Secret Manager not involved for local auth — secrets are for DB only):**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="table(name, createTime)"
```

**Expected result:** New user appears in the Users list assigned to the Editors group.

### Step 4.4 — Configure Page Permissions

1. Open the `lab/getting-started` page.
2. Click **Page Actions** → **Page Permissions**.
3. Under **Specific Rules**, restrict the page to **Administrators only** for write access.
4. Save.

**Expected result:** The page now has explicit permission rules restricting write access.

### Step 4.5 — Test Authentication Providers

1. Navigate to **Administration > Authentication**.
2. Review the available providers: Local, SAML 2.0, OAuth 2.0/OIDC, LDAP/AD.
3. Click **Google** (under OAuth providers) to review the configuration options — note the
   Client ID and Client Secret fields that would be populated for production SSO.

**Expected result:** Authentication strategy list shows multiple provider options including
enterprise SSO protocols.

---

## Exercise 5 — Assets and Storage

### Objective

Upload images and files via the page editor, verify storage in the GCS bucket via GCS Fuse,
and inspect the bucket contents.

### Step 5.1 — Upload an Image

1. Open or create a page in Markdown editor.
2. Click the **Image** icon in the toolbar.
3. In the **Assets Manager**, click **Upload** and select a local image file.
4. Insert the image into the page.
5. Save the page.

**Expected result:** The image appears rendered in the page and is stored in the GCS bucket
mounted at `/wiki-storage` via GCS Fuse.

### Step 5.2 — Verify GCS Fuse Configuration

1. Navigate to **Administration > Storage**.
2. Verify a storage target is active with path `/wiki-storage`.

**gcloud:**
```bash
# List GCS buckets for this project (filter by wikijs)
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="table(name, location, storageClass)"
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | select(.name | test("wikijs")) | {name, location, storageClass}'
```

**Expected result:** A `wikijs-storage` bucket appears in the project.

### Step 5.3 — List Bucket Contents

```bash
# Get the bucket name
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="value(name)" \
  --limit=1)

# List objects in the bucket
gcloud storage ls "gs://${BUCKET}/"
```

**Expected result:** Uploaded image files appear as objects within the GCS bucket, confirming
GCS Fuse is writing assets through to Cloud Storage.

### Step 5.4 — Verify Cloud Run Service Volume Configuration

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(spec.template.spec.volumes)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.template.volumes'
```

**Expected result:** Volume entries appear for the Cloud SQL socket, GCS Fuse (`wikijs-storage`),
and NFS (`/mnt/nfs`) mounts.

---

## Exercise 6 — Storage and Database

### Objective

Inspect the Cloud SQL PostgreSQL instance, verify database connectivity, and explore the
database schema created by Wiki.js.

### Step 6.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
gcloud sql instances list --project="${PROJECT}" \
  --format="table(name, state, databaseVersion, region, settings.tier)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, state, databaseVersion, region}'
```

**Expected result:** A Cloud SQL PostgreSQL 15 instance appears with status `RUNNABLE`.

### Step 6.2 — List Databases in the Instance

```bash
SQL_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --format="value(name)" --limit=1)

gcloud sql databases list \
  --instance="${SQL_INSTANCE}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}/databases" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.items[] | {name, charset, collation}'
```

**Expected result:** The `wikijs` database appears in the list.

### Step 6.3 — Verify Cloud SQL Auth Proxy Sidecar

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(spec.template.spec.containers)"
```

**Expected result:** Container configuration shows the main `wikijs` container and the Cloud
SQL Auth Proxy configured as a volume-based Unix socket connection at `/cloudsql`.

### Step 6.4 — Check Cloud Run Environment Variables

```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**Expected result:** Environment variables include `DB_TYPE=postgres`, `DB_PORT=5432`,
`DB_USER=wikijs`, `DB_NAME=wikijs`, `DB_SSL=false`, and `HA_STORAGE_PATH=/wiki-storage`.

---

## Exercise 7 — Cloud Logging

### Objective

Explore Wiki.js application logs via Cloud Logging, including startup messages, database
connection events, and HTTP request logs.

### Step 7.1 — View Cloud Run Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp,severity,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"cloud_run_revision\\\" AND resource.labels.service_name=\\\"${SERVICE}\\\"\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp, severity, textPayload}'
```

### Step 7.2 — Stream Live Logs

```bash
gcloud beta run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

Then in another terminal, make a request to generate log entries:
```bash
curl -s "${SERVICE_URL}/healthz"
```

**Expected result:** Log stream shows the incoming HTTP request and health check response.

### Step 7.3 — Filter for Startup Messages

In the Cloud Console Log Explorer, run:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"wiki|database|pg_trgm|started"
```

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload=~\"database|pg_trgm|started\"" \
  --project="${PROJECT}" \
  --limit=20
```

**Expected result:** Log entries confirming database connection established and `pg_trgm`
search engine initialised on startup.

### Step 7.4 — Filter for Error Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=ERROR" \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** Under normal operation, no error entries should appear. If errors exist,
they indicate connectivity or configuration issues to investigate.

### Step 7.5 — View Cloud SQL Auth Proxy Logs

In the Cloud Console Log Explorer:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
textPayload=~"cloud-sql-proxy|pq:"
```

**Expected result:** Log entries showing the Auth Proxy establishing the Cloud SQL connection
at startup.

---

## Exercise 8 — Cloud Monitoring

### Objective

Explore Cloud Monitoring metrics for the Cloud Run service, inspect the uptime check, and
review alert policies created by the module.

### Step 8.1 — View Cloud Run Request Metrics

Navigate to the Cloud Console and open:
```bash
echo "https://console.cloud.google.com/monitoring/metrics-explorer?project=${PROJECT}"
```

Query request count by response code class:

**REST API (MQL):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision | metric 'run.googleapis.com/request_count' | filter resource.service_name = '${SERVICE}' | group_by [metric.response_code_class], sum(val()) | within 1h\"
  }" | jq '.timeSeriesData[] | {labels: .labelValues, count: .pointData[-1].values[0].int64Value}'
```

### Step 8.2 — Check the Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(displayName, httpCheck.path, period, selectedRegions)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.uptimeCheckConfigs[] | {displayName, period, httpCheck}'
```

**Expected result:** An uptime check for the Wiki.js service appears, probing the service URL
from multiple global locations every 60 seconds.

### Step 8.3 — View Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --format="table(displayName, conditions[0].displayName, enabled)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.alertPolicies[] | {displayName, enabled: .enabled}'
```

**Expected result:** Alert policies for CPU utilisation and memory appear, configured to notify
the `support_users` email addresses.

### Step 8.4 — Monitor Instance Count

In the Cloud Console Metrics Explorer, plot:
- Metric: `run.googleapis.com/container/instance_count`
- Filter: `service_name = ${SERVICE}`

Generate load to observe scale-up:
```bash
for i in {1..20}; do
  curl -s "${SERVICE_URL}/healthz" &
done
wait
```

**Expected result:** Instance count rises from 0 (cold start) to 1 as requests arrive, then
scales back to zero after the idle period.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Wikijs_CloudRun` deployment. This removes
the Cloud Run service, Cloud SQL database and user, GCS bucket, NFS Filestore, Secret Manager
secrets, and monitoring resources.

> **Warning:** Undeploy deletes the Cloud SQL database, GCS bucket contents, and NFS data.
> Back up any important data before proceeding.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" --quiet

# Delete secrets
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet

# List and delete GCS bucket
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~wikijs" \
  --format="value(name)" --limit=1)
gcloud storage rm -r "gs://${BUCKET}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `wikijs` | Base name for Cloud Run service and secrets |
| `application_version` | string | `2.5.311` | Wiki.js image tag |
| `min_instance_count` | number | `0` | Scale-to-zero (set to `1` to eliminate cold starts) |
| `max_instance_count` | number | `1` | Maximum instances (cost ceiling) |
| `cpu_limit` | string | `1000m` | CPU per instance (increase for heavy editing) |
| `memory_limit` | string | `2Gi` | Memory per instance (required for Chromium) |
| `db_name` | string | `wikijs` | PostgreSQL database name |
| `db_user` | string | `wikijs` | PostgreSQL user name |
| `enable_nfs` | bool | `true` | Mount Cloud Filestore at `/mnt/nfs` |
| `enable_redis` | bool | `false` | Enable Redis session cache |
| `redis_host` | string | `""` | Redis hostname (required when `enable_redis=true`) |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar |
| `ingress_settings` | string | `all` | `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | string | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `tenant_deployment_id` | string | `demo` | Tenant identifier appended to resource names |
| `support_users` | list | `[]` | Email addresses for monitoring alerts |
| `enable_iap` | bool | `false` | Identity-Aware Proxy authentication |
| `enable_cloud_armor` | bool | `false` | Cloud Armor WAF |

### Useful Commands

```bash
# Get Wiki.js service URL
gcloud run services describe ${SERVICE} \
  --region=${REGION} --project=${PROJECT} \
  --format="value(status.url)"

# Check service health
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/healthz"

# View latest logs
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\"" \
  --project=${PROJECT} --limit=20

# List revisions
gcloud run revisions list \
  --service=${SERVICE} --region=${REGION} --project=${PROJECT}

# Access DB password secret
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" --project=${PROJECT}

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# List GCS buckets
gcloud storage buckets list --project=${PROJECT} --filter="name~wikijs"
```

### Further Reading

- [Wiki.js documentation](https://docs.requarks.io/)
- [Wiki.js GitHub repository](https://github.com/requarks/wiki)
- [Cloud Run Gen2 documentation](https://cloud.google.com/run/docs/about-execution-environments)
- [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
- [GCS Fuse for Cloud Run](https://cloud.google.com/run/docs/tutorials/network-filesystems-fuse)
- [Secret Manager for Cloud Run](https://cloud.google.com/run/docs/configuring/secrets)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
