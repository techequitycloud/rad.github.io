---
title: "Ghost on Cloud Run — Lab Guide"
sidebar_label: "Ghost CloudRun"
---

# Ghost on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghost_CloudRun)**

This lab guide walks you through deploying, exploring, and operating the **Ghost** publishing
platform on Google Cloud Run using the **Ghost_CloudRun** module. You will explore a
production-grade serverless CMS architecture backed by Cloud SQL MySQL 8.0, Cloud Filestore
NFS shared content storage, Redis page caching, and Secret Manager credentials — and practice
content management, theme customization, integrations, security inspection, and observability
using gcloud CLI, REST API, and the Ghost Admin UI.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Ghost](#exercise-1--access-ghost)
6. [Exercise 2 — Content Management](#exercise-2--content-management)
7. [Exercise 3 — Theme Customization](#exercise-3--theme-customization)
8. [Exercise 4 — Integrations and API](#exercise-4--integrations-and-api)
9. [Exercise 5 — Database and Storage](#exercise-5--database-and-storage)
10. [Exercise 6 — Security and Secrets](#exercise-6--security-and-secrets)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#13-cleanup)
14. [Reference](#14-reference)

---

## 1. Overview

### What Is Ghost?

Ghost is a professional open-source publishing platform for newsletters, memberships, and
content sites — trusted by Buffer, Cloudflare, DuckDuckGo, Duolingo, FreeCodeCamp, Revolut,
and Kickstarter. With 22,000+ active customers and 100,000+ websites, Ghost delivers built-in
subscription monetization, native SEO, and superior page speed. The `Ghost_CloudRun` module
deploys Ghost 6.x on Cloud Run (gen2) backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS,
Redis caching, and Secret Manager.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Serverless CMS** | Cloud Run gen2 with scale-to-zero and automatic scaling up to 5 instances |
| **MySQL 8.0 Backend** | Cloud SQL MySQL 8.0 connected via Cloud SQL Auth Proxy Unix socket |
| **Shared NFS Storage** | Cloud Filestore NFS mount at `/mnt/nfs` for consistent content across all instances |
| **Redis Page Caching** | Redis backend reducing database load and improving page delivery speed |
| **Secret Manager** | DB password, admin credentials stored securely and injected at runtime |
| **Content Publishing** | Posts, pages, tags, featured images, and membership tiers |
| **Observability** | Cloud Logging structured logs, Cloud Monitoring uptime checks and metrics |

---

## 2. Architecture

```
Browser / API Client
        │
        ▼
  Cloud Run Service (gen2)
  Ghost 6.x — port 2368
  ┌─────────────────────────────────────┐
  │  ghost container                    │
  │    entrypoint.sh → Ghost Node.js    │
  │    reads DB_HOST, DB_USER, etc.     │
  │                                     │
  │  cloudsql-proxy sidecar             │
  │    Unix socket: /cloudsql/<inst>    │
  └──────────────┬──────────────────────┘
                 │ VPC Egress (Serverless VPC Access)
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
  Cloud SQL          Cloud Filestore
  MySQL 8.0          NFS /mnt/nfs
  (ghost DB)         (images, themes)
        │
        ▼
  Redis (NFS VM IP:6379)
  page cache backend
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Cloud Run Service (gen2)   region: us-central1            │  │
│  │  Ghost 6.x · port 2368 · min=0 · max=5                    │  │
│  │  Sidecar: Cloud SQL Auth Proxy (Unix socket)               │  │
│  │  NFS mount: /mnt/nfs (Cloud Filestore)                     │  │
│  └─────────────────────────┬──────────────────────────────────┘  │
│                             │ VPC Access Connector                │
│  ┌──────────────────────────▼──────────────────────────────────┐  │
│  │  VPC Network (Services_GCP)                                  │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │  Cloud SQL   │  │  Filestore   │  │  Redis (NFS VM)  │  │  │
│  │  │  MySQL 8.0   │  │  NFS share   │  │  port 6379       │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Secret Manager  │  │  Cloud Logging   │  │  Monitoring  │  │
│  │  DB & admin creds│  │  structured logs │  │  uptime check│  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Ghost_CloudRun
    application_version   = "6.14.0"  →  Ghost container image tag
    min_instance_count    = 0 [fixed] →  scale-to-zero enabled
    max_instance_count    = 5 [fixed] →  up to 5 concurrent instances
    enable_nfs            = true      →  Cloud Filestore NFS mounted
    enable_redis          = true      →  Redis page caching enabled
    enable_cloudsql_volume= true      →  Auth Proxy Unix socket
    database_type         = MYSQL_8_0 →  Ghost requires MySQL 8.0
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `curl` / `jq` | Any | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/run.admin
roles/cloudsql.admin
roles/secretmanager.viewer
roles/logging.viewer
roles/monitoring.viewer
roles/iam.serviceAccountViewer
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

gcloud config set project "${PROJECT}"
gcloud config set run/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Ghost_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `ghost` | Base resource name |
| `application_version` | `6.14.0` | Ghost image tag |
| `tenant_deployment_id` | `demo` | Short deployment suffix |
| `deploy_application` | `true` | Deploy the Ghost service |
| `enable_nfs` | `true` | Cloud Filestore NFS for content |
| `enable_redis` | `true` | Redis page caching |
| `db_name` | `ghost` | MySQL database name |
| `db_user` | `ghost` | MySQL application user |
| `min_instance_count` | `0` | Scale to zero when idle |
| `max_instance_count` | `5` | Maximum concurrent instances |
| `cpu_limit` | `2000m` | 2 vCPU per instance |
| `memory_limit` | `4Gi` | 4 GiB memory per instance |
| `support_users` | `[your-email]` | Alert notification recipients |

Click **Deploy** and wait for provisioning to complete (approximately 20–30 minutes).

> **What this provisions:** Cloud Run service (gen2) with Cloud SQL Auth Proxy sidecar,
> Cloud SQL MySQL 8.0 instance with `ghost` database and user, Cloud Filestore NFS instance
> mounted at `/mnt/nfs`, GCS `ghost-content` bucket, Secret Manager secrets for DB password,
> Serverless VPC Access connector, Artifact Registry repository, Cloud Build image pipeline,
> and Cloud Monitoring uptime check.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"

# Discover the Ghost Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~ghost" \
  --limit=1)

# Get the service URL
export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Ghost URL: ${SERVICE_URL}"

# Discover DB-related secrets
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ghost" \
  --format="value(name)" \
  --limit=1)

echo "DB Secret: ${DB_SECRET}"
```

---

## Exercise 1 — Access Ghost

### Objective

Retrieve the Cloud Run service URL, confirm Ghost is reachable, and log into the Ghost
Admin panel for the first time.

### Step 1.1 — Retrieve the Service URL

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uri'
```

**Expected result:** A URL in the format `https://<hash>.a.run.app` is printed.

### Step 1.2 — Confirm Ghost is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}"
```

**Expected result:** HTTP `200`. If you see `503`, Cloud Run may be starting a new instance
(cold start can take 15–30 seconds) — wait and retry.

### Step 1.3 — Inspect the Cloud Run Service

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, uri: .uri, generation: .generation, containers: [.template.containers[].image]}'
```

**Expected result:** Service status shows `Ready`. Note the container image, CPU/memory limits (2000m / 4Gi), and VPC connector configuration.

### Step 1.4 — Access the Ghost Admin Panel

Navigate to `${SERVICE_URL}/ghost` in your browser.

On the first visit, Ghost displays a setup wizard. Complete it:
1. Enter a site title (e.g. "My Ghost Blog").
2. Enter your admin name, email, and password.
3. Click **Create your account**.
4. Ghost redirects to the Admin dashboard at `${SERVICE_URL}/ghost/#/dashboard`.

**Expected result:** You are logged into the Ghost Admin panel.

### Step 1.5 — Retrieve Admin Credentials from Secret Manager

```bash
# List Ghost-related secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ghost" \
  --format="table(name, createTime)"

# Access the DB password secret
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aghost" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[].name'
```

**Expected result:** Ghost-related secrets are listed. The DB password is returned as a plaintext value.

---

## Exercise 2 — Content Management

### Objective

Create and publish posts, manage pages and tags, upload images, and verify content appears
on the public Ghost site.

### Step 2.1 — Create and Publish a Post

1. In Ghost Admin, click **Posts** in the left sidebar.
2. Click **New post** (top-right).
3. Enter a title and body text using the card-based editor.
4. Click the settings gear (top-right) to add a tag and featured image.
5. Click **Publish** → **Publish** to confirm.

**Expected result:** The post appears in the Posts list with status `Published`. Navigate to `${SERVICE_URL}` — the post is visible on the front page.

### Step 2.2 — Create a Static Page

1. Click **Pages** in the sidebar.
2. Click **New page**, enter "About" as the title and add some content.
3. Click **Publish** → **Publish**.

**Expected result:** The page is accessible at `${SERVICE_URL}/about`.

### Step 2.3 — Upload an Image via the Editor

1. Open a post in the editor.
2. Click **+** to add a new card, select **Image**.
3. Upload a PNG or JPG file.

**Expected result:** The image uploads to Ghost's content directory on the NFS volume and appears in the post editor. The image is served from `${SERVICE_URL}/content/images/`.

### Step 2.4 — Manage Tags

1. Navigate to **Tags** in the left sidebar.
2. Click **New tag**, enter a name and description.
3. Go back to your post and associate the new tag via the post settings panel.

**gcloud — verify NFS is mounted and content directory exists:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.volumes[] | select(.name | test("nfs"))'
```

**Expected result:** The NFS volume configuration appears in the service template, confirming shared content storage is active.

### Step 2.5 — View the Public Site

```bash
curl -s "${SERVICE_URL}" | grep -o '<title>.*</title>'
```

**REST API (HEAD request to verify):**
```bash
curl -I "${SERVICE_URL}"
```

**Expected result:** The Ghost Casper theme renders with your published post on the front page.

---

## Exercise 3 — Theme Customization

### Objective

Inspect the active theme, explore design settings, upload a custom theme, and configure
brand settings using the Ghost Admin panel.

### Step 3.1 — View the Active Theme

1. In Ghost Admin, navigate to **Settings** → **Theme**.
2. The default **Casper** theme is marked as active.

**REST API (Ghost Admin API — list themes):**
```bash
# First, generate a Ghost Admin API key from Settings > Integrations > Add custom integration
# Then use it to query the Admin API
curl -s "${SERVICE_URL}/ghost/api/admin/themes/" \
  -H "Authorization: Ghost <your-admin-api-key>"
```

**Expected result:** The Themes page lists available themes. Casper is active with a checkmark.

### Step 3.2 — Upload and Switch a Theme

1. Download a free Ghost theme (e.g., [Source](https://github.com/TryGhost/Source)) as a `.zip` file.
2. In Ghost Admin, navigate to **Settings** → **Theme** → **Change theme** → **Upload theme**.
3. Upload the `.zip` file and activate the new theme.

**Expected result:** The new theme is listed and can be activated. The public site refreshes with the new theme's layout.

### Step 3.3 — Configure Brand Settings

1. Navigate to **Settings** → **Design** → **Brand**.
2. Set an **accent colour** (e.g. `#FF5733`).
3. Upload a **publication icon** and **logo**.
4. Click **Save**.

**Expected result:** The accent colour and logo appear on the public site within seconds of saving.

### Step 3.4 — Configure Navigation

1. Navigate to **Settings** → **Design** → **Navigation**.
2. Add a navigation item: Label = "About", URL = `/about/`.
3. Click **Save**.

**Expected result:** The About page link appears in the site's primary navigation menu.

### Step 3.5 — Verify Theme Files on NFS

**gcloud — inspect NFS volume mount in the service template:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.containers[].volumeMounts[] | select(.name | test("nfs"))'
```

**Expected result:** The NFS volume is mounted at `/mnt/nfs`. Ghost theme files uploaded via Admin are stored in the NFS content directory, ensuring they persist across container restarts and are shared between all instances.

---

## Exercise 4 — Integrations and API

### Objective

Explore the Ghost Admin API, create custom integrations, configure webhooks, and inspect
newsletter and membership settings.

### Step 4.1 — Create a Custom Integration

1. In Ghost Admin, navigate to **Settings** → **Integrations** → **Add custom integration**.
2. Enter a name (e.g. "Lab Integration").
3. Ghost generates an **Admin API key** and **Content API key**.
4. Note the Admin API key for use in subsequent steps.

**Expected result:** An integration is created with API keys. These keys authenticate API requests to the Ghost Admin and Content APIs.

### Step 4.2 — Query the Ghost Admin API

```bash
# Use the Admin API key from Step 4.1
export GHOST_ADMIN_KEY="your-admin-api-key"

# List all posts via Admin API
curl -s "${SERVICE_URL}/ghost/api/admin/posts/?limit=5" \
  -H "Authorization: Ghost ${GHOST_ADMIN_KEY}" \
  | jq '.posts[] | {id, title, status, published_at}'
```

**REST API (Content API — public, no auth required for published posts):**
```bash
export GHOST_CONTENT_KEY="your-content-api-key"

curl -s "${SERVICE_URL}/ghost/api/content/posts/?key=${GHOST_CONTENT_KEY}&limit=5" \
  | jq '.posts[] | {id, title, url, published_at}'
```

**Expected result:** A list of published posts with their IDs, titles, statuses, and publication timestamps is returned.

### Step 4.3 — Configure a Webhook

1. In Ghost Admin, navigate to **Settings** → **Integrations** → your lab integration.
2. Under **Webhooks**, click **Add webhook**.
3. Set **Event** to `Post published`.
4. Set **Target URL** to a test endpoint (e.g. `https://httpbin.org/post`).
5. Click **Save**.

**Expected result:** The webhook is configured. When a new post is published, Ghost will POST the event payload to the target URL.

### Step 4.4 — Inspect Newsletter Settings

1. Navigate to **Settings** → **Email newsletter**.
2. Review the **Sender name** and **Reply-to address** fields.

**gcloud — verify SMTP environment variables:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.containers[0].env[] | select(.name | startswith("SMTP"))'
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.template.containers[0].env[] | select(.name | startswith("SMTP"))'
```

**Expected result:** SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL`, `EMAIL_FROM`) are injected as environment variables. For newsletters to send, a valid SMTP provider must be configured.

### Step 4.5 — Review Member Portal Settings

1. Navigate to **Settings** → **Portal**.
2. Click **Customise** to adjust the sign-up form appearance.
3. Click **Preview** to see the subscription portal overlay.

**Expected result:** The Ghost membership portal is accessible at `${SERVICE_URL}/#/portal`.

---

## Exercise 5 — Database and Storage

### Objective

Inspect the Cloud SQL MySQL instance, verify the Ghost content GCS bucket, and confirm
the NFS volume is mounted and in use.

### Step 5.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
# List Cloud SQL instances in the project
gcloud sql instances list \
  --project="${PROJECT}" \
  --format="table(name, databaseVersion, region, state)"

# Store the instance name
export SQL_INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="databaseVersion:MYSQL_8_0" \
  --format="value(name)" \
  --limit=1)

# Describe the instance
gcloud sql instances describe "${SQL_INSTANCE}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '{name: .name, version: .databaseVersion, tier: .settings.tier, state: .state}'
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name: .name, version: .databaseVersion, state: .state}'
```

**Expected result:** A MySQL 8.0 Cloud SQL instance is listed as `RUNNABLE`.

### Step 5.2 — List Ghost Databases

**gcloud:**
```bash
gcloud sql databases list \
  --instance="${SQL_INSTANCE}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${SQL_INSTANCE}/databases" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[].name'
```

**Expected result:** The `ghost` database is listed with `utf8mb4` character set, confirming the `db-init` job ran successfully.

### Step 5.3 — Inspect the GCS Content Bucket

**gcloud:**
```bash
# List GCS buckets related to Ghost
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~ghost" \
  --format="table(name, location, storageClass)"

# List objects in the ghost-content bucket
export GHOST_BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~ghost-content" \
  --format="value(name)" \
  --limit=1)

gcloud storage ls "gs://${GHOST_BUCKET}/" 2>/dev/null || echo "Bucket may be empty before uploads"
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=ghost" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[].name'
```

**Expected result:** A `ghost-content` GCS bucket is listed. It may contain content uploaded via the Ghost Admin panel.

### Step 5.4 — Verify NFS Volume Configuration

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '{
    volumes: [.template.volumes[] | {name: .name, type: (if .nfs then "nfs" elif .cloudSqlInstance then "cloudsql" else "other" end)}],
    mounts: [.template.containers[].volumeMounts[]]
  }'
```

**Expected result:** The service template shows an NFS volume mounted at `/mnt/nfs` and a Cloud SQL volume at `/cloudsql`.

### Step 5.5 — Check the DB Backup Schedule

**gcloud:**
```bash
gcloud run jobs list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(name, lastRunTime, status.latestCreatedExecution.completionTime)"
```

**Expected result:** A Cloud Run Job named after the Ghost deployment handles automated backups on the configured schedule (`0 2 * * *` by default).

---

## Exercise 6 — Security and Secrets

### Objective

Inspect Secret Manager secrets, review IAM bindings, verify Cloud SQL Auth Proxy
configuration, and understand the database password rotation mechanism.

### Step 6.1 — Inspect Ghost Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~ghost" \
  --format="table(name, createTime, replication.automatic)"

# View secret metadata (not the value)
gcloud secrets describe "${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Aghost" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name, createTime: .createTime, state: .replication}'
```

**Expected result:** Ghost-related secrets are listed (DB password, admin credentials). Secrets use automatic replication.

### Step 6.2 — View Secret Versions

```bash
gcloud secrets versions list "${DB_SECRET}" \
  --project="${PROJECT}" \
  --format="table(name, state, createTime)"
```

**Expected result:** One or more secret versions are listed. The `ENABLED` version is the one currently injected into the Cloud Run service.

### Step 6.3 — Review Cloud Run Service Account IAM

**gcloud:**
```bash
# Find the Cloud Run service account
export CR_SA=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(spec.template.spec.serviceAccountName)")

echo "Cloud Run SA: ${CR_SA}"

# List IAM bindings for this service account
gcloud projects get-iam-policy "${PROJECT}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${CR_SA}" \
  --format="table(bindings.role)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq --arg sa "${CR_SA}" '.bindings[] | select(.members[] | test($sa)) | .role'
```

**Expected result:** The Cloud Run service account has roles including `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`, and `roles/storage.objectAdmin`.

### Step 6.4 — Verify Auth Proxy Connection

**gcloud:**
```bash
# Check the Cloud SQL volume configuration (Auth Proxy sidecar)
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.template.volumes[] | select(.cloudSqlInstance) | .cloudSqlInstance.instances'
```

**Expected result:** The Cloud SQL instance connection string (format: `project:region:instance`) is listed, confirming the Auth Proxy sidecar is configured to connect to the MySQL instance via Unix socket.

### Step 6.5 — Check Database Password Rotation Configuration

**gcloud:**
```bash
# Check if auto-rotation is configured via Pub/Sub
gcloud pubsub subscriptions list \
  --project="${PROJECT}" \
  --filter="name~ghost OR name~rotation" \
  --format="table(name, topic, pushConfig.pushEndpoint)"
```

**Expected result:** If `enable_auto_password_rotation = true` was set, a Pub/Sub subscription for rotation events appears. By default (`false`), no rotation subscription exists — rotation is manual.

---

## Exercise 7 — Cloud Logging

### Objective

Query Ghost application logs, filter for HTTP requests, and inspect Cloud SQL Auth Proxy
logs using Cloud Logging.

### Step 7.1 — View Ghost Application Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND resource.labels.location=\"${REGION}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "orderBy": "timestamp desc",
    "pageSize": 20
  }' | jq '.entries[] | {timestamp: .timestamp, payload: (.textPayload // .jsonPayload)}'
```

**Expected result:** Ghost startup logs appear, including `Ghost boot 6.x.x` banner and database connection confirmation.

### Step 7.2 — Filter HTTP Access Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND httpRequest.status>=200" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {
    timestamp: .timestamp,
    method: .httpRequest.requestMethod,
    url: .httpRequest.requestUrl,
    status: .httpRequest.status,
    latency: .httpRequest.latency
  }'
```

**Expected result:** HTTP request logs show GET requests to Ghost pages with 200 status codes and latency measurements.

### Step 7.3 — Filter for Warnings and Errors

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=WARNING" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, only informational logs appear. Warnings may appear during first boot while NFS mounts initialize or during database migration.

### Step 7.4 — Inspect Cloud SQL Proxy Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload=~\"cloud-sql-proxy|cloudsql\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**REST API (using the Logging API query):**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\" AND textPayload=~\"proxy\"",
    "pageSize": 10
  }' | jq '.entries[].textPayload'
```

**Expected result:** Cloud SQL Auth Proxy startup messages and connection establishment logs are visible.

### Step 7.5 — Navigate to Logs Explorer

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%0Aresource.labels.service_name%3D%22${SERVICE}%22?project=${PROJECT}"
```

Open the URL to use the interactive Logs Explorer with filtering, time range selection, and log streaming.

---

## Exercise 8 — Cloud Monitoring

### Objective

Explore Cloud Run request metrics, review uptime check status, examine instance scaling
behavior, and inspect alert policies.

### Step 8.1 — View Cloud Run Request Metrics

Navigate to Metrics Explorer:
```bash
echo "https://console.cloud.google.com/monitoring/metrics-explorer?project=${PROJECT}"
```

Select:
- **Resource type:** `Cloud Run Revision`
- **Metric:** `run.googleapis.com/request_count`
- **Filter:** `service_name = ${SERVICE}`

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com/request_count" \
  --project="${PROJECT}"
```

**REST API (query time series):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = \"'"${SERVICE}"'\" | within 1h | group_by [], sum(val())"
  }' | jq '.timeSeriesData[].pointData[-1].values'
```

**Expected result:** A chart shows HTTP request counts per minute for the Ghost service, broken down by response code.

### Step 8.2 — Check the Uptime Monitor

**gcloud:**
```bash
gcloud monitoring uptime list-configs \
  --project="${PROJECT}" \
  --format="table(name, displayName, httpCheck.path, period, timeout)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {name: .name, displayName: .displayName, path: .httpCheck.path}'
```

**Expected result:** An uptime check for the Ghost service URL polls `GET /` every 60 seconds from multiple global locations and shows **Passing** status.

### Step 8.3 — View Instance Scaling Behavior

Send a burst of requests to observe autoscaling:

```bash
# Send 20 concurrent requests
for i in $(seq 1 20); do
  curl -s -o /dev/null "${SERVICE_URL}" &
done
wait
```

**gcloud (query instance count metric):**
```bash
gcloud monitoring time-series list \
  --filter="metric.type=\"run.googleapis.com/container/instance_count\" AND resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.[].points[-1].value.int64Value'
```

**Expected result:** Cloud Run scales up instances to handle concurrent requests. With `min_instance_count = 0`, instances terminate when traffic stops (scale to zero).

### Step 8.4 — Review Alert Policies

**gcloud:**
```bash
gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --format="table(name, displayName, enabled)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.alertPolicies[] | {name: .name, displayName: .displayName, enabled: .enabled}'
```

**Expected result:** Alert policies for the Ghost deployment are listed, including the uptime check alert. If `support_users` was configured, alerts notify those email addresses.

### Step 8.5 — View Cloud Run Revision Summary

**gcloud:**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, traffic.percent, lastTransitionTime, status.conditions[0].status)"
```

**Expected result:** The latest revision serves 100% of traffic. Multiple revisions may appear from previous deployments.

---

## 13. Cleanup

Return to the RAD UI and click **Undeploy** on the `Ghost_CloudRun` deployment. This
removes the Cloud Run service, Cloud SQL instance, NFS Filestore, GCS buckets, Secret
Manager secrets, and all associated IAM bindings.

> **Warning:** This permanently deletes all resources including the database and NFS content.
> Export Ghost content before undeploying: Ghost Admin → Settings → Labs → Export.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" --quiet

# Delete Cloud SQL instance
gcloud sql instances delete "${SQL_INSTANCE}" \
  --project="${PROJECT}" --quiet

# Delete secrets
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet

# Delete GCS bucket
gcloud storage rm -r "gs://${GHOST_BUCKET}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

> **Note:** GCP holds serverless IPv4 addresses on the VPC subnet for 20–30 minutes after
> Cloud Run deletion. If a full VPC teardown is needed, wait before running the subnet delete.

---

## 14. Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | — | GCP project ID (required) |
| `region` | `string` | `us-central1` | GCP region for all resources |
| `application_name` | `string` | `ghost` | Base resource name |
| `application_version` | `string` | `6.14.0` | Ghost container image tag |
| `tenant_deployment_id` | `string` | `demo` | Short suffix appended to resource names |
| `deploy_application` | `bool` | `true` | Deploy the Ghost service (false = infra only) |
| `cpu_limit` | `string` | `2000m` | CPU per Cloud Run instance |
| `memory_limit` | `string` | `4Gi` | Memory per Cloud Run instance |
| `min_instance_count` | — | `0` [fixed] | Scale-to-zero; hardcoded in module |
| `max_instance_count` | — | `5` [fixed] | Max concurrent instances; hardcoded in module |
| `enable_nfs` | `bool` | `true` | Cloud Filestore NFS for shared content |
| `nfs_mount_path` | `string` | `/mnt/nfs` | NFS mount path inside container |
| `enable_redis` | `bool` | `true` | Redis page caching (uses NFS server IP by default) |
| `redis_host` | `string` | `""` | Redis hostname (blank = NFS server IP) |
| `redis_port` | `string` | `6379` | Redis TCP port |
| `db_name` | `string` | `ghost` | MySQL database name |
| `db_user` | `string` | `ghost` | MySQL application user |
| `database_password_length` | `number` | `32` | Auto-generated password length |
| `enable_auto_password_rotation` | `bool` | `false` | Automated DB password rotation |
| `ingress_settings` | `string` | `all` | Cloud Run ingress: all / internal / internal-and-cloud-load-balancing |
| `vpc_egress_setting` | `string` | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `execution_environment` | `string` | `gen2` | Gen2 required for NFS and GCS Fuse |
| `timeout_seconds` | `number` | `300` | Max request duration |
| `backup_schedule` | `string` | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | `number` | `7` | Days to retain backup files |
| `enable_cloud_armor` | `bool` | `false` | Global HTTPS LB + Cloud Armor WAF |
| `support_users` | `list(string)` | `[]` | Email addresses for monitoring alerts |

### Useful Commands Reference

```bash
# Get Ghost service URL
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --format="value(status.url)"

# Tail Ghost logs
gcloud logging tail \
  "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}" \
  --project="${PROJECT}"

# List Cloud Run revisions
gcloud run revisions list --service="${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}"

# Access a secret value
gcloud secrets versions access latest --secret="${DB_SECRET}" --project="${PROJECT}"

# List Cloud SQL instances
gcloud sql instances list --project="${PROJECT}"

# Check uptime monitor
gcloud monitoring uptime list-configs --project="${PROJECT}"

# View Cloud Run instance count
gcloud monitoring time-series list \
  --filter="metric.type=run.googleapis.com/container/instance_count AND resource.labels.service_name=${SERVICE}" \
  --project="${PROJECT}"

# List GCS buckets
gcloud storage buckets list --project="${PROJECT}" --filter="name~ghost"
```

### Further Reading

- [Ghost documentation](https://ghost.org/docs/)
- [Ghost Admin API reference](https://ghost.org/docs/admin-api/)
- [Ghost Content API reference](https://ghost.org/docs/content-api/)
- [Cloud Run gen2 execution environment](https://cloud.google.com/run/docs/about-execution-environments)
- [Cloud SQL Auth Proxy overview](https://cloud.google.com/sql/docs/mysql/sql-proxy)
- [Cloud Filestore NFS for Cloud Run](https://cloud.google.com/run/docs/tutorials/network-filesystems-fuse)
- [Secret Manager for Cloud Run](https://cloud.google.com/run/docs/configuring/secrets)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
