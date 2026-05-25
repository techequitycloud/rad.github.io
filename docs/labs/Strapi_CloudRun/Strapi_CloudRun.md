# Strapi on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Strapi_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **Strapi** — the leading open-source headless CMS — on Google Cloud Run (Gen2) using the **Strapi_CloudRun** module. You will work with the Strapi Admin Panel, Content Type Builder, REST and GraphQL APIs, roles and permissions, Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Strapi Admin](#exercise-1--access-strapi-admin)
6. [Exercise 2 — Content Type Builder](#exercise-2--content-type-builder)
7. [Exercise 3 — Content Manager](#exercise-3--content-manager)
8. [Exercise 4 — REST and GraphQL APIs](#exercise-4--rest-and-graphql-apis)
9. [Exercise 5 — Roles and Permissions](#exercise-5--roles-and-permissions)
10. [Exercise 6 — Database and Storage](#exercise-6--database-and-storage)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Strapi?

Strapi is the leading open-source **headless CMS** with 71,000+ GitHub stars and a 4.5/5 rating on G2. Trusted by Adidas, Airbus, Amazon, Cisco, and Toyota for omnichannel content delivery across websites, mobile apps, digital signage, and IoT surfaces, Strapi delivers a fully customizable admin panel and REST/GraphQL API layer with no vendor lock-in.

The `Strapi_CloudRun` module deploys Strapi 5.0 on Cloud Run Gen2 with Cloud SQL PostgreSQL, Cloud Filestore NFS for media uploads, GCS for object storage, and five auto-generated cryptographic secrets managed in Secret Manager.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Content Type Builder** | No-code schema design — create content types and components |
| **Content Manager** | Create, manage, and publish content entries |
| **REST API** | Auto-generated CRUD endpoints with filtering, sorting, pagination |
| **GraphQL API** | Interactive playground and query execution |
| **Roles and Permissions** | Public/authenticated/custom role access control |
| **Secret Manager** | APP_KEYS, JWT_SECRET, API_TOKEN_SALT auto-managed |
| **GCS Media Storage** | Files uploaded via Strapi stored in a GCS bucket |
| **Cloud Logging** | Structured JSON logs from the Cloud Run revision |
| **Cloud Monitoring** | Uptime checks, request metrics, auto-scaling |

---

## 2. Architecture

```
Browser / API Client
       │
       ▼
Cloud Run Gen2 (Strapi Node.js container)
  │  port 8080 (mapped from Strapi's 1337)
  │  NFS mount: /mnt/nfs (shared media uploads)
  │  Cloud SQL Auth Proxy sidecar (Unix socket)
  │
  ├── Cloud SQL PostgreSQL 15
  │     DB: strapidb / user: strapiuser
  │
  ├── Cloud Filestore NFS
  │     Shared across all Cloud Run instances
  │
  └── GCS bucket: strapi-uploads
        Media library storage backend

Supporting services:
  ┌──────────────────────┐  ┌───────────────────┐  ┌──────────────────┐
  │  Secret Manager      │  │  Artifact Registry │  │  Cloud Build     │
  │  APP_KEYS,           │  │  Two-stage Node.js │  │  Builds custom   │
  │  JWT_SECRET,         │  │  production image  │  │  Strapi image    │
  │  ADMIN_JWT_SECRET,   │  │                   │  │                  │
  │  API_TOKEN_SALT,     │  │                   │  │                  │
  │  TRANSFER_TOKEN_SALT │  └───────────────────┘  └──────────────────┘
  └──────────────────────┘

  ┌──────────────────────┐  ┌───────────────────┐
  │  Cloud Logging       │  │  Cloud Monitoring  │
  │  Structured JSON     │  │  Uptime checks,    │
  │  request & app logs  │  │  metrics, alerts   │
  └──────────────────────┘  └───────────────────┘

Module variable wiring:
  Strapi_CloudRun
    application_version       = "5.0.0"    → Strapi image tag
    container_port            = 8080       → Cloud Run container port
    enable_cloudsql_volume    = true       → Auth Proxy sidecar socket
    enable_nfs                = true       → Cloud Filestore NFS mount
    min_instance_count        = 0          → Scale-to-zero
    max_instance_count        = 1          → Single instance default
    cpu_limit                 = "2000m"    → 2 vCPU
    memory_limit              = "2Gi"      → 2 GiB RAM
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

export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --filter="metadata.name~strapi" \
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

Deploy the `Strapi_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_version` | `5.0.0` | Strapi image tag |
| `cpu_limit` | `2000m` | 2 vCPU |
| `memory_limit` | `2Gi` | Minimum recommended |
| `min_instance_count` | `0` | Scale-to-zero |
| `max_instance_count` | `1` | Single instance |
| `enable_nfs` | `true` | NFS for shared media |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar |

Click **Deploy** and wait for provisioning to complete (approximately 20–36 minutes).

> **What this provisions:** Cloud Run Gen2 service, Cloud SQL PostgreSQL 15 instance, Cloud Filestore NFS volume, GCS uploads bucket (suffix `strapi-uploads`), Artifact Registry repository with two-stage Strapi Node.js image, Secret Manager secrets (APP_KEYS, JWT_SECRET, ADMIN_JWT_SECRET, API_TOKEN_SALT, TRANSFER_TOKEN_SALT, DB_PASSWORD), Cloud Monitoring uptime check, and `db-init` Cloud Run Job for database setup.

### 4.2 Configure Shell Environment

```bash
# Verify the health endpoint
curl -s "${SERVICE_URL}/_health"

# Expected: {"status":"ok"}
```

---

## Exercise 1 — Access Strapi Admin

### Objective

Access the Strapi Admin Panel, complete the initial admin registration, and tour the main dashboard sections.

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
curl -s "${SERVICE_URL}/_health" | jq .
```

**Expected result:** `{"status":"ok"}` — Strapi is running and connected to the database.

### Step 1.2 — Complete Initial Admin Registration

Open `${SERVICE_URL}/admin` in your browser. On first access you will see the **Create your first Administrator** form.

Fill in:
- **First name:** Admin
- **Last name:** User
- **Email:** `admin@example.com`
- **Password:** Choose a strong password

Click **Let's start** to complete registration.

### Step 1.3 — Obtain an API Token via REST

```bash
export STRAPI_TOKEN=$(curl -s -X POST "${SERVICE_URL}/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}' \
  | jq -r '.data.token')

echo "Admin token: ${STRAPI_TOKEN}"
```

### Step 1.4 — Tour the Admin Panel

Navigate to each section in the left sidebar:

| Section | Purpose |
|---|---|
| **Content Manager** | Browse and edit content entries for all types |
| **Content-Type Builder** | Design schemas — add collections and components |
| **Media Library** | Upload and manage media assets |
| **Settings** | Users, roles, API tokens, webhooks, internationalization |

### Step 1.5 — Inspect Server Information

**REST API:**
```bash
curl -s "${SERVICE_URL}/admin/information" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  | jq '{strapiVersion, nodeVersion, communityEdition}'
```

**gcloud (service revision):**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(metadata.name,status.conditions[0].status,spec.containerConcurrency)"
```

**Expected result:** Strapi version, Node.js version, and Community Edition flag.

---

## Exercise 2 — Content Type Builder

### Objective

Use the Strapi Content-Type Builder to design a new Collection Type, add fields of various types, and save the schema to the database.

### Step 2.1 — Create a Collection Type

1. Navigate to **Content-Type Builder** in the left sidebar.
2. Click **+ Create new collection type**.
3. Display name: `Article`
4. Click **Continue**.

### Step 2.2 — Add Fields

Add the following fields:

| Field Name | Type | Options |
|---|---|---|
| `title` | Short text | Required |
| `content` | Rich text | |
| `publishedAt` | Date | |
| `slug` | UID | Attached to `title` |
| `featuredImage` | Media | Single media |
| `tags` | JSON | |

Click **Save** after adding all fields. Strapi restarts to apply the schema changes.

**REST API (verify content type):**
```bash
curl -s "${SERVICE_URL}/api/articles" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  | jq '{data: (.data | length), meta}'
```

### Step 2.3 — Add a Component

1. In **Content-Type Builder**, click **+ Create new component**.
2. Display name: `SEO Metadata`
3. Category: `shared`
4. Add fields: `metaTitle` (Short text), `metaDescription` (Long text).
5. Click **Finish**.

Back in the Article type, add a field of type **Component** (single) using the `SEO Metadata` component.

**Expected result:** Article type now includes a nested SEO component structure.

### Step 2.4 — Inspect the Database Schema

**gcloud (Cloud SQL):**
```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~strapi" \
  --format="value(name)" \
  --limit=1)

gcloud sql databases list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}"
```

**REST API (admin schema endpoint):**
```bash
curl -s "${SERVICE_URL}/admin/content-types" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  | jq '.data[] | select(.apiID == "article") | {apiID, kind, attributes: (.schema.attributes | keys)}'
```

**Expected result:** Article content type appears with all defined attributes.

---

## Exercise 3 — Content Manager

### Objective

Create content entries in the Article collection, upload media files to the Media Library, and manage content lifecycle.

### Step 3.1 — Create Articles

1. Navigate to **Content Manager > Collection Types > Article**.
2. Click **+ Create new entry**.
3. Fill in all fields including title, content, and slug.
4. Set **Published At** to today.
5. Click **Save**, then **Publish**.

**REST API (create an article):**
```bash
curl -s -X POST "${SERVICE_URL}/api/articles" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Hello from Strapi API",
      "content": "This article was created via the REST API.",
      "slug": "hello-from-strapi-api",
      "publishedAt": "2026-05-25T00:00:00.000Z"
    }
  }' | jq '.data | {id, attributes: {title: .attributes.title, slug: .attributes.slug}}'
```

**Expected result:** Article created with an integer ID and the provided attributes.

### Step 3.2 — Upload Media to Media Library

1. Navigate to **Media Library** in the left sidebar.
2. Click **+ Add new assets** and upload an image.

**REST API (upload a file):**
```bash
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" \
  | base64 -d > /tmp/sample.png

curl -s -X POST "${SERVICE_URL}/api/upload" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  -F "files=@/tmp/sample.png" \
  | jq '.[0] | {id, name, url, mime}'
```

### Step 3.3 — Verify GCS Storage

```bash
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~strapi-uploads" \
  --format="value(name)" \
  --limit=1)

echo "Uploads bucket: ${BUCKET}"
gcloud storage ls "gs://${BUCKET}" --recursive | head -20
```

**Expected result:** Uploaded files stored in the GCS bucket with Strapi-generated paths.

### Step 3.4 — Manage Content Lifecycle

```bash
# List published articles
curl -s "${SERVICE_URL}/api/articles?filters[publishedAt][$notNull]=true&populate=*" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  | jq '.data[] | {id, title: .attributes.title, published: .attributes.publishedAt}'

# Unpublish an article (set publishedAt to null)
ARTICLE_ID=$(curl -s "${SERVICE_URL}/api/articles?pagination[limit]=1" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  | jq '.data[0].id')

curl -s -X PUT "${SERVICE_URL}/api/articles/${ARTICLE_ID}" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"data": {"publishedAt": null}}' \
  | jq '.data.attributes.publishedAt'
```

**Expected result:** Article unpublished (publishedAt is null).

---

## Exercise 4 — REST and GraphQL APIs

### Objective

Query the Strapi REST API with filtering and population, execute GraphQL queries in the Playground, and use API tokens for programmatic access.

### Step 4.1 — Create an API Token

1. Navigate to **Settings > API Tokens**.
2. Click **+ Create new API Token**.
3. Name: `lab-api-token`, Type: **Full access**.
4. Copy the generated token value.

**REST API:**
```bash
curl -s -X POST "${SERVICE_URL}/api/auth/local" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@example.com","password":"your-password"}' \
  | jq '.jwt'
```

### Step 4.2 — REST API Queries

```bash
API_TOKEN="your-full-access-api-token"

# List all articles with pagination
curl -s "${SERVICE_URL}/api/articles?pagination[page]=1&pagination[pageSize]=10" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  | jq '{total: .meta.pagination.total, count: (.data | length)}'

# Filter by title
curl -s "${SERVICE_URL}/api/articles?filters[title][\$containsi]=hello" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  | jq '.data[] | {id, title: .attributes.title}'

# Populate relations
curl -s "${SERVICE_URL}/api/articles?populate=featuredImage" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  | jq '.data[] | {id, title: .attributes.title, image: .attributes.featuredImage.data.attributes.url}'
```

**Expected result:** Filtered, paginated, and populated article responses.

### Step 4.3 — GraphQL Queries

Open `${SERVICE_URL}/graphql` in your browser to access the GraphQL Playground.

**REST API (execute a GraphQL query):**
```bash
curl -s -X POST "${SERVICE_URL}/graphql" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { articles { data { id attributes { title slug publishedAt } } } }"
  }' | jq '.data.articles.data[] | {id, title: .attributes.title}'
```

**Expected result:** GraphQL response with article data matching the REST result.

### Step 4.4 — GraphQL Mutation

```bash
curl -s -X POST "${SERVICE_URL}/graphql" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { createArticle(data: {title: \"GraphQL Article\", slug: \"graphql-article\", publishedAt: \"2026-05-25T00:00:00.000Z\"}) { data { id attributes { title slug } } } }"
  }' | jq '.data.createArticle.data | {id, title: .attributes.title}'
```

**Expected result:** New article created via GraphQL mutation.

### Step 4.5 — Inspect the REST API Documentation

```bash
# Strapi auto-generates OpenAPI documentation
curl -s "${SERVICE_URL}/documentation/v1.0.0/openapi.json" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  | jq '{openapi, info: .info, paths: (.paths | keys | length)}'
```

**Expected result:** OpenAPI 3.0 spec with all content type endpoints.

---

## Exercise 5 — Roles and Permissions

### Objective

Configure public and authenticated access levels in Strapi, manage API tokens with specific permissions, and test access control.

### Step 5.1 — Configure Public Role

1. Navigate to **Settings > Roles > Public**.
2. Under **Article**, enable **find** and **findOne** actions.
3. Click **Save**.

**Test public access (no token):**
```bash
curl -s "${SERVICE_URL}/api/articles" | jq '{count: (.data | length), error: .error}'
```

**Expected result:** Articles returned without an authentication token.

### Step 5.2 — Configure Authenticated Role

1. Navigate to **Settings > Roles > Authenticated**.
2. Under **Article**, enable **create**, **update**, **find**, and **findOne** actions.
3. Click **Save**.

### Step 5.3 — Create a Limited API Token

**REST API:**
```bash
curl -s -X POST "${SERVICE_URL}/admin/api-tokens" \
  -H "Authorization: Bearer ${STRAPI_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "read-only-token",
    "description": "Read-only access to articles",
    "type": "read-only",
    "lifespan": null
  }' | jq '{id: .data.id, name: .data.name, type: .data.type}'
```

### Step 5.4 — Test Access Control

```bash
READ_ONLY_TOKEN="your-read-only-token"

# Read-only token can read
curl -s "${SERVICE_URL}/api/articles" \
  -H "Authorization: Bearer ${READ_ONLY_TOKEN}" \
  | jq '.data | length'

# Read-only token cannot create
curl -s -X POST "${SERVICE_URL}/api/articles" \
  -H "Authorization: Bearer ${READ_ONLY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"data": {"title": "Blocked"}}' \
  | jq '.error.status'
```

**Expected result:** Read returns 200; create returns 403 Forbidden.

### Step 5.5 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~strapi" \
  --format="table(name,createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:strapi" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name}'
```

**Expected result:** Secrets for APP_KEYS, JWT_SECRET, ADMIN_JWT_SECRET, API_TOKEN_SALT, and TRANSFER_TOKEN_SALT.

---

## Exercise 6 — Database and Storage

### Objective

Inspect the Cloud SQL database schema, verify media file storage in GCS, and explore the NFS file system used by Strapi for shared uploads.

### Step 6.1 — Inspect Cloud SQL Instance

**gcloud:**
```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~strapi" \
  --format="value(name)" \
  --limit=1)

gcloud sql instances describe "${INSTANCE}" \
  --project="${PROJECT}" \
  --format="yaml(name,region,databaseVersion,settings.tier,state)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${INSTANCE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name, region: .region, version: .databaseVersion, state: .state}'
```

### Step 6.2 — Verify GCS Media Storage

```bash
BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~strapi-uploads" \
  --format="value(name)" \
  --limit=1)

# List uploaded files
gcloud storage ls "gs://${BUCKET}" --recursive | head -20

# Show bucket metadata
gcloud storage buckets describe "gs://${BUCKET}" \
  --format="table(name,location,storageClass)"
```

**REST API:**
```bash
curl -s \
  "https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?maxResults=5" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name, size, contentType}'
```

**Expected result:** Uploaded media files stored in the GCS bucket.

### Step 6.3 — Inspect NFS Mount via Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload:\"nfs\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

### Step 6.4 — View Database User and Schema

**gcloud:**
```bash
gcloud sql users list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}" \
  --format="table(name,host)"

gcloud sql databases list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}"
```

**Expected result:** `strapiuser` user and `strapidb` database exist on the Cloud SQL instance.

### Step 6.5 — Check Backup Configuration

**gcloud:**
```bash
gcloud sql backups list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}" \
  --limit=5 \
  --format="table(id,status,startTime,endTime)"
```

**Expected result:** Automated daily backup listed (scheduled at 02:00 UTC by default).

---

## Exercise 7 — Cloud Logging

### Objective

Query Cloud Logging to observe Strapi API requests, application logs, database initialization logs, and filter by severity.

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
   AND httpRequest.requestUrl:\"/api/articles\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {timestamp, method: .httpRequest.requestMethod, url: .httpRequest.requestUrl, status: .httpRequest.status}'
```

**Expected result:** Log entries for the `/api/articles` requests made in Exercises 3 and 4.

### Step 7.3 — View Database Initialization Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_job\" \
   AND labels.\"run.googleapis.com/job_name\"~\"db-init\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,severity,textPayload)"
```

**Expected result:** Logs from the `db-init` Cloud Run Job showing database creation steps.

### Step 7.4 — Filter by Severity

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=\"WARNING\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {timestamp, severity, message: (.jsonPayload.message // .textPayload)}'
```

### Step 7.5 — Logs Explorer URL

```bash
echo "https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%0Aresource.labels.service_name%3D%22${SERVICE}%22?project=${PROJECT}"
```

---

## Exercise 8 — Cloud Monitoring

### Objective

Review Cloud Monitoring metrics for the Strapi Cloud Run service, inspect uptime check status, and observe request latency.

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

### Step 8.3 — View Uptime Check

**gcloud:**
```bash
gcloud monitoring uptime list \
  --project="${PROJECT}" \
  --format="table(displayName,monitoredResource.labels.host,period,timeout)"
```

**Expected result:** Uptime check targeting the Strapi `/_health` endpoint.

### Step 8.4 — Generate Load and Observe

```bash
for i in $(seq 1 25); do
  curl -s "${SERVICE_URL}/api/articles" \
    -H "Authorization: Bearer ${STRAPI_TOKEN}" > /dev/null
  echo "Request ${i} done"
done
```

**gcloud (check instance count):**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml(status.observedGeneration)"
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

Return to the RAD UI and click **Undeploy** on the `Strapi_CloudRun` deployment. This removes the Cloud Run service, Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images.

### Manual Cleanup (if needed)

**gcloud:**
```bash
gcloud run services delete "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" --quiet

gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~strapi" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

> **Note:** After deleting a Cloud Run service, GCP may hold serverless IPv4 addresses for 20–30 minutes before the subnet can be fully removed. If a second destroy attempt is needed, wait and re-run.

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `strapi` | Base resource name |
| `application_version` | string | `5.0.0` | Strapi container image tag |
| `cpu_limit` | string | `2000m` | CPU per instance (2 vCPU) |
| `memory_limit` | string | `2Gi` | Memory per instance |
| `min_instance_count` | number | `0` | Scale-to-zero |
| `max_instance_count` | number | `1` | Maximum Cloud Run instances |
| `container_port` | number | `8080` | Cloud Run container port |
| `enable_nfs` | bool | `true` | Cloud Filestore NFS for media |
| `nfs_mount_path` | string | `/mnt/nfs` | NFS container mount path |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar |
| `application_database_name` | string | `strapidb` | PostgreSQL database name |
| `application_database_user` | string | `strapiuser` | PostgreSQL database user |
| `enable_redis` | bool | `false` | Redis session cache |
| `redis_host` | string | `null` | Redis host (must be set when enabled) |
| `enable_cloud_armor` | bool | `false` | Global HTTPS LB + Cloud Armor WAF |
| `enable_iap` | bool | `false` | Identity-Aware Proxy |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron schedule |
| `backup_retention_days` | number | `7` | GCS backup retention days |

### Useful Commands Reference

```bash
# Get service URL
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" --region="${REGION}" --format="value(status.url)"

# Health check
curl "${SERVICE_URL}/_health"

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~strapi"

# Query articles
curl "${SERVICE_URL}/api/articles" -H "Authorization: Bearer ${STRAPI_TOKEN}"

# Tail logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}" \
  --project="${PROJECT}" --limit=20 --order=desc

# List revisions
gcloud run revisions list --service="${SERVICE}" --project="${PROJECT}" --region="${REGION}"
```

### Further Reading

- [Strapi Documentation](https://docs.strapi.io/)
- [Strapi REST API Reference](https://docs.strapi.io/dev-docs/api/rest)
- [Strapi GraphQL API](https://docs.strapi.io/dev-docs/api/graphql)
- [Cloud Run Gen2 Overview](https://cloud.google.com/run/docs/about-execution-environments)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Cloud Storage for Media](https://cloud.google.com/storage/docs)
- [Secret Manager Best Practices](https://cloud.google.com/secret-manager/docs/best-practices)
