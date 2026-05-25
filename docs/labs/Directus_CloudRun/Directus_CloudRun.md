# Directus on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Directus_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **Directus** — an open-source headless CMS and Backend-as-a-Service platform — on Google Cloud Run (Gen2) using the **Directus_CloudRun** module. You will work with Directus Studio, REST and GraphQL APIs, Flows automation, Secret Manager integration, Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Directus Studio](#exercise-1--access-directus-studio)
6. [Exercise 2 — Data Modeling](#exercise-2--data-modeling)
7. [Exercise 3 — Content Management](#exercise-3--content-management)
8. [Exercise 4 — REST and GraphQL APIs](#exercise-4--rest-and-graphql-apis)
9. [Exercise 5 — Flows and Automations](#exercise-5--flows-and-automations)
10. [Exercise 6 — Security and Secrets](#exercise-6--security-and-secrets)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Directus?

Directus is an open-source **composable data platform** and Backend-as-a-Service that wraps any SQL database with auto-generated REST and GraphQL APIs and a no-code Data Studio — without modifying your schema. With 34,500+ GitHub stars and customers including Tripadvisor, Adobe, and Mercedes-Benz, Directus is among the top open-source headless CMS choices in 2026. Its native MCP server support (v11.13+) enables direct AI tool integration.

The `Directus_CloudRun` module deploys Directus on Cloud Run Gen2 with Cloud SQL PostgreSQL, Cloud Filestore NFS for shared uploads, GCS for object storage, Redis caching, and Secret Manager for credentials.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Directus Studio** | No-code data modeling, content editing, user management, Insights dashboards |
| **REST API** | Auto-generated CRUD endpoints with filter/sort/relation support |
| **GraphQL API** | Interactive GraphQL Playground and query execution |
| **Flows** | Visual trigger-and-operation automation engine |
| **Secret Manager** | KEY, SECRET, ADMIN_PASSWORD, REDIS secrets auto-managed |
| **Cloud Logging** | Structured JSON logs from the Cloud Run revision |
| **Cloud Monitoring** | Uptime checks, request metrics, instance auto-scaling |
| **Redis Caching** | API response caching and rate limiting via Redis backend |

---

## 2. Architecture

```
Browser / API Client
       │
       ▼
Cloud Run Gen2 (Directus Node.js container)
  │  port 8055
  │  NFS mount: /mnt/nfs (shared uploads, sessions)
  │  GCS Fuse: directus-uploads bucket (file storage backend)
  │
  ├── Cloud SQL PostgreSQL 15 (TCP via internal IP)
  │     DB: directus / user: directus
  │
  ├── Cloud Filestore NFS
  │     Shared across all Cloud Run instances
  │
  └── Redis (co-located on NFS VM or Cloud Memorystore)
        API response caching + rate limiting

Supporting services:
  ┌──────────────────────┐  ┌───────────────────┐  ┌──────────────────┐
  │  Secret Manager      │  │  Artifact Registry │  │  Cloud Build     │
  │  KEY, SECRET,        │  │  Custom image with  │  │  Builds custom   │
  │  ADMIN_PASSWORD,     │  │  GCS storage driver │  │  Directus image  │
  │  REDIS, DB_PASSWORD  │  │                    │  │                  │
  └──────────────────────┘  └───────────────────┘  └──────────────────┘

  ┌──────────────────────┐  ┌───────────────────┐
  │  Cloud Logging       │  │  Cloud Monitoring  │
  │  Structured JSON     │  │  Uptime checks,    │
  │  request & app logs  │  │  metrics, alerts   │
  └──────────────────────┘  └───────────────────┘

Module variable wiring:
  Directus_CloudRun
    application_version    = "11.1.0"  → Directus Docker image tag
    container_port         = 8055      → Cloud Run container port
    enable_nfs             = true      → Cloud Filestore NFS mount
    enable_redis           = true      → Redis caching and rate limiting
    enable_cloudsql_volume = false     → TCP connection to Cloud SQL internal IP
    min_instance_count     = 0         → Scale-to-zero (Redis sessions)
    max_instance_count     = 1         → Single instance default
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
roles/secretmanager.admin
roles/cloudsql.admin
roles/storage.admin
roles/logging.viewer
roles/monitoring.viewer
```

### Environment Variables

```bash
export PROJECT="${PROJECT:-your-gcp-project-id}"
export REGION="${REGION:-us-central1}"

gcloud config set project "${PROJECT}"
gcloud config set run/region "${REGION}"

# Discover the deployed Directus Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --filter="metadata.name~directus" \
  --format="value(metadata.name)" \
  --limit=1)

export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Service: ${SERVICE}"
echo "URL: ${SERVICE_URL}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Directus_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_version` | `11.1.0` | Directus image tag |
| `cpu_limit` | `1000m` | Increase to `2000m` for production |
| `memory_limit` | `2Gi` | Minimum recommended |
| `min_instance_count` | `0` | Scale-to-zero |
| `max_instance_count` | `1` | Single instance |
| `enable_redis` | `true` | Enable Redis caching |
| `enable_nfs` | `true` | NFS for shared uploads |

Click **Deploy** and wait for provisioning to complete (approximately 20–36 minutes).

> **What this provisions:** Cloud Run Gen2 service, Cloud SQL PostgreSQL 15 instance, Cloud Filestore NFS volume, GCS uploads bucket, Artifact Registry repository with custom Directus image, Secret Manager secrets (KEY, SECRET, ADMIN_PASSWORD, REDIS, DB_PASSWORD), Cloud Monitoring uptime check, and automated backup Cloud Run Job.

### 4.2 Configure Shell Environment

```bash
# Get the admin password secret name
export ADMIN_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~directus AND name~admin-password" \
  --format="value(name)" \
  --limit=1)

# Retrieve the admin password
export ADMIN_PASS=$(gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" \
  --project="${PROJECT}")

echo "Admin email: admin@example.com"
echo "Admin password: ${ADMIN_PASS}"
echo "Studio URL: ${SERVICE_URL}/admin"
```

---

## Exercise 1 — Access Directus Studio

### Objective

Retrieve the Cloud Run service URL, verify the health endpoint, log in to Directus Studio, and tour the main sections of the admin panel.

### Step 1.1 — Verify the Health Endpoint

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(status.url,status.conditions[0].type,status.conditions[0].status)"
```

**REST API:**
```bash
curl -s "${SERVICE_URL}/server/health" | jq .
```

**Expected result:** `{"status":"ok"}` — Directus is running and connected to the database.

### Step 1.2 — Log In to Directus Studio

Open `${SERVICE_URL}/admin` in your browser. Log in with:
- **Email:** `admin@example.com`
- **Password:** value from `${ADMIN_PASS}`

**REST API (obtain access token):**
```bash
export DIRECTUS_TOKEN=$(curl -s -X POST "${SERVICE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"password\":\"${ADMIN_PASS}\"}" \
  | jq -r '.data.access_token')
echo "Token: ${DIRECTUS_TOKEN}"
```

**Expected result:** Token string returned; Studio loads the Content module.

### Step 1.3 — Tour the Studio Sections

Navigate to each section in the left sidebar:

| Section | Purpose |
|---|---|
| **Content** | Browse and manage content items across all collections |
| **Files** | Upload, manage, and transform media assets |
| **Users** | Manage user accounts, roles, and activity |
| **Insights** | Build custom analytics dashboards |
| **Settings** | Data Model, Roles, Webhooks, Flows, API tokens |

### Step 1.4 — Inspect Server Information

**REST API:**
```bash
curl -s "${SERVICE_URL}/server/info" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" | jq '{version, nodeVersion}'
```

**gcloud (service revision details):**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(metadata.name,status.conditions[0].status,spec.containerConcurrency)"
```

**Expected result:** Server info shows the deployed Directus version and Node.js version.

---

## Exercise 2 — Data Modeling

### Objective

Use Directus Studio to create a Collection (database table), add fields, and configure permissions — demonstrating Directus's no-code data modeling without schema migrations.

### Step 2.1 — Create a Collection

1. Navigate to **Settings > Data Model**.
2. Click **+ Create Collection**.
3. Name the collection `articles`.
4. Enable the **Status** optional field (adds a `status` field with `draft/published/archived` values).
5. Click **Finish Setup**.

**REST API (verify collection was created):**
```bash
curl -s "${SERVICE_URL}/collections" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data[] | select(.collection == "articles") | {collection, fields: .schema.columns}'
```

### Step 2.2 — Add Fields to the Collection

In **Settings > Data Model > articles**, click **+ Create Field** for each:

| Field Name | Interface | Type | Notes |
|---|---|---|---|
| `title` | Input | String | Required |
| `body` | WYSIWYG | Text | Rich text editor |
| `published_date` | DateTime | Timestamp | Publication timestamp |
| `featured_image` | File | UUID | Relation to Files collection |
| `author` | Input | String | Author name |

Click **Save** after each field. Changes apply to the database immediately.

### Step 2.3 — Configure Permissions

1. Navigate to **Settings > Roles & Permissions**.
2. Click **Public** role.
3. Under **articles**, enable **Read** access.
4. Set the **Status** filter to `status = published` so only published items are visible to public users.

**REST API (verify permissions):**
```bash
curl -s "${SERVICE_URL}/permissions?filter[role][_null]=true" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data[] | select(.collection == "articles")'
```

**Expected result:** Public role has read access to the `articles` collection filtered to published status.

### Step 2.4 — Inspect the Database Schema

**gcloud (list Cloud SQL instances):**
```bash
gcloud sql instances list \
  --project="${PROJECT}" \
  --format="table(name,region,state,databaseVersion)"
```

**REST API:**
```bash
# List all collections (tables) in the project
curl -s "${SERVICE_URL}/collections" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '[.data[] | .collection]'
```

**Expected result:** `articles` collection appears in the list alongside Directus system collections.

---

## Exercise 3 — Content Management

### Objective

Create content items in the articles collection, upload media files, and explore how Directus manages relationships between content and files.

### Step 3.1 — Create Content Items

1. Navigate to **Content > Articles** in the sidebar.
2. Click **+ Create Item**.
3. Fill in:
   - **Title:** `Getting Started with Directus`
   - **Body:** Add some rich text content
   - **Published Date:** Today's date
   - **Author:** Your name
   - **Status:** `published`
4. Click **Save** and repeat for a second article with status `draft`.

**REST API (create item programmatically):**
```bash
curl -s -X POST "${SERVICE_URL}/items/articles" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "API-Created Article",
    "body": "This article was created via the REST API.",
    "author": "API User",
    "status": "published"
  }' | jq '.data | {id, title, status}'
```

**Expected result:** Item created with a UUID id and `published` status.

### Step 3.2 — Upload Media Files

1. Navigate to **Files** in the left sidebar.
2. Click **+ Upload Files** and select an image from your machine.
3. The file appears with a thumbnail preview.

**REST API (upload a file):**
```bash
# Create a test image file
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" \
  | base64 -d > /tmp/test.png

curl -s -X POST "${SERVICE_URL}/files" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -F "file=@/tmp/test.png" \
  | jq '.data | {id, filename_download, type, filesize}'
```

### Step 3.3 — Verify GCS Storage

```bash
# List GCS buckets for this deployment
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~directus" \
  --format="table(name,location,storageClass)"

# List uploaded files in the uploads bucket
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~directus-uploads" \
  --format="value(name)" \
  --limit=1)

gcloud storage ls "gs://${BUCKET}" --recursive
```

**Expected result:** Uploaded files appear in the GCS bucket with UUID-based paths.

### Step 3.4 — Retrieve File with Image Transformation

```bash
# Get a file ID from the Files API
FILE_ID=$(curl -s "${SERVICE_URL}/files?limit=1" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq -r '.data[0].id')

# Request a resized version of the image
curl -s -o /tmp/resized.jpg \
  "${SERVICE_URL}/assets/${FILE_ID}?width=200&height=200&fit=cover" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}"

echo "File size: $(wc -c < /tmp/resized.jpg) bytes"
```

**Expected result:** A transformed image file is saved locally.

---

## Exercise 4 — REST and GraphQL APIs

### Objective

Query the Directus REST API with filtering and sorting, explore the auto-generated GraphQL API, and create API access tokens for programmatic access.

### Step 4.1 — Create an API Access Token

1. Navigate to **Settings > Access Tokens**.
2. Click **+ Create Token**.
3. Name: `lab-token`, Role: **Administrator**.
4. Copy the generated token value.

**REST API:**
```bash
curl -s -X POST "${SERVICE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"password\":\"${ADMIN_PASS}\"}" \
  | jq '.data | {access_token, expires}'
```

### Step 4.2 — Query Collections via REST

```bash
# List all published articles
curl -s "${SERVICE_URL}/items/articles?filter[status][_eq]=published" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data[] | {id, title, status}'

# Sort by published_date descending, limit 5
curl -s "${SERVICE_URL}/items/articles?sort=-published_date&limit=5&fields=id,title,published_date" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data'

# Get a single item by ID
ITEM_ID=$(curl -s "${SERVICE_URL}/items/articles?limit=1" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq -r '.data[0].id')

curl -s "${SERVICE_URL}/items/articles/${ITEM_ID}" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data | {id, title, body, status}'
```

**Expected result:** JSON responses with filtered and sorted article data.

### Step 4.3 — Query via GraphQL

Open `${SERVICE_URL}/graphql` in your browser to access the interactive GraphQL Playground.

**REST API (execute GraphQL query):**
```bash
curl -s -X POST "${SERVICE_URL}/graphql" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { articles(filter: {status: {_eq: \"published\"}}, sort: [\"-date_created\"]) { id title status author } }"
  }' | jq '.data.articles'
```

**Expected result:** GraphQL response with the same article data as the REST query.

### Step 4.4 — Explore the OpenAPI Specification

```bash
curl -s "${SERVICE_URL}/server/specs/oas" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '{openapi, info: .info, paths: (.paths | keys | length)}'
```

**Expected result:** OpenAPI 3.0 spec showing the auto-generated API paths including `/items/articles`.

### Step 4.5 — Update and Delete Items

```bash
# Update an item
curl -s -X PATCH "${SERVICE_URL}/items/articles/${ITEM_ID}" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "archived"}' \
  | jq '.data | {id, status}'

# Restore to published
curl -s -X PATCH "${SERVICE_URL}/items/articles/${ITEM_ID}" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "published"}' \
  | jq '.data.status'
```

**Expected result:** Item status updated and restored successfully.

---

## Exercise 5 — Flows and Automations

### Objective

Create a Directus Flow that triggers on item creation, adds an operation to transform data, and test the automation end-to-end.

### Step 5.1 — Create a Flow

1. Navigate to **Settings > Flows**.
2. Click **+ Create Flow**.
3. Name: `Article Created Notification`.
4. **Trigger:** Event Hook — `items.create` on collection `articles`.
5. Click **Save** to create the flow canvas.

### Step 5.2 — Add an Operation

1. On the flow canvas, click the **+** button after the trigger.
2. Select **Run Script** operation.
3. Name: `Log Article`.
4. Script:
   ```javascript
   module.exports = async function(data) {
     console.log('New article created:', data.$trigger.payload.title);
     return { logged: true, title: data.$trigger.payload.title };
   }
   ```
5. Click **Save**.

### Step 5.3 — Test the Flow

Create a new article via the REST API to trigger the flow:

```bash
curl -s -X POST "${SERVICE_URL}/items/articles" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Flow Test Article",
    "body": "This article tests the automation flow.",
    "status": "published"
  }' | jq '.data | {id, title}'
```

**gcloud (check logs for flow execution):**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload:\"New article created\"" \
  --project="${PROJECT}" \
  --limit=5 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Log entry shows the article title logged by the flow script.

### Step 5.4 — Inspect Flow Logs in Directus

1. Return to **Settings > Flows**.
2. Click on **Article Created Notification**.
3. Click the **Logs** tab to see execution history.
4. Verify the run shows as successful with the article title in the output.

### Step 5.5 — Create a Webhook Flow (Optional)

1. Create another Flow with **Webhook** trigger type.
2. Note the generated webhook URL.
3. Test it:

```bash
WEBHOOK_URL="<your-webhook-url-from-directus>"
curl -s -X POST "${SERVICE_URL}${WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{"test": "payload", "source": "lab"}' | jq .
```

**Expected result:** Flow executes and returns a response payload.

---

## Exercise 6 — Security and Secrets

### Objective

Explore Directus's roles and permissions system, inspect Secret Manager secrets provisioned by the module, and manage API tokens securely.

### Step 6.1 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~directus" \
  --format="table(name,createTime,replication.automatic)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:directus" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name, createTime}'
```

**Expected result:** Secrets for `key`, `secret`, `admin-password`, and `redis` appear in the list.

### Step 6.2 — Retrieve Secret Values

```bash
# Get the Directus KEY secret (encryption key)
KEY_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~directus AND name~-key" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${KEY_SECRET}" \
  --project="${PROJECT}" \
  | wc -c
# Expected: 33 (32 chars + newline) — the 32-char random KEY
```

### Step 6.3 — Review Roles and Permissions in Studio

1. Navigate to **Settings > Roles & Permissions**.
2. Review the **Administrator** role — full access to all collections.
3. Click **+ Create Role** and name it `Editor`.
4. Grant the Editor role **Read** and **Create** access to `articles`, but not **Delete**.
5. Navigate to **Users** and create a test user with the Editor role.

**REST API (list roles):**
```bash
curl -s "${SERVICE_URL}/roles" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data[] | {id, name, description}'
```

**Expected result:** Administrator and Editor roles listed.

### Step 6.4 — Rotate an API Token

```bash
# List existing access tokens
curl -s "${SERVICE_URL}/auth/access-tokens" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq '.data[] | {id, name, last_access}'

# Delete and recreate to rotate
TOKEN_ID=$(curl -s "${SERVICE_URL}/auth/access-tokens" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  | jq -r '.data[] | select(.name == "lab-token") | .id')

if [ -n "${TOKEN_ID}" ]; then
  curl -s -X DELETE "${SERVICE_URL}/auth/access-tokens/${TOKEN_ID}" \
    -H "Authorization: Bearer ${DIRECTUS_TOKEN}"
  echo "Token deleted — create a new one in Settings > Access Tokens"
fi
```

**Expected result:** Old token deleted; new token generated with a fresh value.

### Step 6.5 — Review IAM Bindings on the Cloud Run Service

```bash
gcloud run services get-iam-policy "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml"
```

**Expected result:** `allUsers` has `roles/run.invoker` (public access), or no public binding if IAP is enabled.

---

## Exercise 7 — Cloud Logging

### Objective

Query Cloud Logging to observe Directus API requests, application startup logs, and structured JSON log entries from the Cloud Run revision.

### Step 7.1 — View Recent Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="table(timestamp,severity,httpRequest.requestUrl,httpRequest.status)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 10
  }" | jq '.entries[] | {timestamp, severity, message: (.jsonPayload.message // .textPayload)}'
```

### Step 7.2 — Filter API Request Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND httpRequest.requestUrl:\"/items/articles\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {timestamp, method: .httpRequest.requestMethod, url: .httpRequest.requestUrl, status: .httpRequest.status}'
```

**Expected result:** Log entries for the `/items/articles` API calls made in Exercises 3 and 4.

### Step 7.3 — View Startup Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload:\"Directus\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

### Step 7.4 — Query Logs by Severity

```bash
# View all WARNING and ERROR logs
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=\"WARNING\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {timestamp, severity, message: (.jsonPayload.message // .textPayload)}'
```

**Expected result:** List of warnings and errors, if any, from the Directus service.

### Step 7.5 — Logs Explorer URL

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%0Aresource.labels.service_name%3D%22${SERVICE}%22?project=${PROJECT}"
```

Open the URL to view logs in the Google Cloud Console Logs Explorer.

---

## Exercise 8 — Cloud Monitoring

### Objective

Review Cloud Monitoring metrics for the Directus Cloud Run service, inspect uptime check status, and observe auto-scaling behavior.

### Step 8.1 — List Cloud Run Metrics

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(metricDescriptor.type,metricDescriptor.displayName)"
```

**REST API (query request count):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], sum(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

### Step 8.2 — Check Request Latency

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_latencies | filter resource.service_name = '${SERVICE}' | within 30m | percentile(val(), 95)\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

### Step 8.3 — View Uptime Check Status

**gcloud:**
```bash
gcloud monitoring uptime list \
  --project="${PROJECT}" \
  --format="table(displayName,monitoredResource.labels.host,period,timeout)"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {displayName, period, httpCheck: .httpCheck.path}'
```

**Expected result:** An uptime check targeting the Directus service is listed.

### Step 8.4 — Generate Load and Observe Scaling

Generate some API traffic to observe metrics:

```bash
for i in $(seq 1 20); do
  curl -s "${SERVICE_URL}/items/articles?limit=5" \
    -H "Authorization: Bearer ${DIRECTUS_TOKEN}" > /dev/null
  echo "Request ${i} complete"
done
```

**gcloud (check instance count):**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(status.observedGeneration,status.conditions)"
```

### Step 8.5 — Open Monitoring Dashboard

```bash
echo "https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/metrics?project=${PROJECT}"
```

Review:
- **Request count** — total requests per minute
- **Request latency** — P50, P95, P99 response times
- **Instance count** — active Cloud Run instances
- **Container memory utilisation** — compared to the 2Gi limit

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Directus_CloudRun` deployment. This removes the Cloud Run service, Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" --quiet

# List and delete Directus secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~directus" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

> **Note:** After deleting a Cloud Run service, GCP may hold serverless IPv4 addresses for 20–30 minutes. If a second destroy attempt is needed, wait and re-run.

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `directus` | Base resource name |
| `application_version` | string | `11.1.0` | Directus container image tag |
| `cpu_limit` | string | `1000m` | CPU per instance |
| `memory_limit` | string | `2Gi` | Memory per instance |
| `min_instance_count` | number | `0` | Scale-to-zero (0) or warm (1+) |
| `max_instance_count` | number | `1` | Maximum Cloud Run instances |
| `container_port` | number | `8055` | Directus default port |
| `enable_nfs` | bool | `true` | Cloud Filestore NFS for uploads |
| `nfs_mount_path` | string | `/mnt/nfs` | NFS container mount path |
| `enable_redis` | bool | `true` | Redis for caching and rate limiting |
| `redis_host` | string | `""` | Redis host (empty = NFS server IP) |
| `redis_port` | string | `6379` | Redis TCP port |
| `db_name` | string | `directus` | PostgreSQL database name |
| `db_user` | string | `directus` | PostgreSQL database user |
| `enable_cloud_armor` | bool | `false` | Global HTTPS LB + Cloud Armor WAF |
| `enable_iap` | bool | `false` | Identity-Aware Proxy |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron schedule |
| `backup_retention_days` | number | `7` | GCS backup retention days |

### Useful Commands Reference

```bash
# Get service URL
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" --region="${REGION}" --format="value(status.url)"

# Get admin password
gcloud secrets versions access latest \
  --secret="${ADMIN_SECRET}" --project="${PROJECT}"

# Health check
curl "${SERVICE_URL}/server/health"

# List collections
curl "${SERVICE_URL}/collections" -H "Authorization: Bearer ${DIRECTUS_TOKEN}"

# Query articles
curl "${SERVICE_URL}/items/articles?filter[status][_eq]=published" \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}"

# Tail logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}" \
  --project="${PROJECT}" --limit=20 --order=desc

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~directus"
```

### Further Reading

- [Directus Documentation](https://docs.directus.io/)
- [Directus REST API Reference](https://docs.directus.io/reference/introduction.html)
- [Directus Flows Documentation](https://docs.directus.io/app/flows.html)
- [Cloud Run Gen2 Overview](https://cloud.google.com/run/docs/about-execution-environments)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Secret Manager Best Practices](https://cloud.google.com/secret-manager/docs/best-practices)
- [Cloud Logging Query Language](https://cloud.google.com/logging/docs/view/logging-query-language)
