---
title: "Wiki.js on Cloud Run — Lab Guide"
sidebar_label: "Wikijs CloudRun"
---

# Wiki.js on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wikijs_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

This lab walks you through deploying Wiki.js on Google Cloud Run Gen2 using the `Wikijs CloudRun` module, then verifying and exploring the deployment manually. The module handles all GCP infrastructure; you perform the post-deployment steps interactively.

### What the Module Automates

- Cloud Run Gen2 service with auto-scaling (configurable min/max instances)
- Cloud SQL PostgreSQL 15 instance, database, and user; `pg_trgm` extension installed automatically
- Cloud Build image build and push to Artifact Registry
- GCS Fuse volume mounted at `/wiki-storage` for persistent asset storage
- Cloud Filestore (NFS) optional persistent share (`/mnt/nfs`) — requires gen2 execution environment
- Cloud SQL Auth Proxy sidecar via Cloud Run volume (Unix socket at `/cloudsql`)
- Serverless VPC Access connector for private Cloud SQL and Redis connectivity
- Secret Manager secrets (DB password, JWT secret)
- Cloud Monitoring uptime check and alert policies
- Backup Cloud Run Job (daily at 02:00 UTC via Cloud Scheduler)
- Redis environment variable injection (when `enable_redis = true`)

### What You Do Manually

- Note the service URL from the RAD UI deployment panel
- Complete the Wiki.js first-run setup wizard (or retrieve seeded admin credentials from Secret Manager)
- Create pages and explore the Markdown editor
- Test full-text search powered by `pg_trgm`
- Configure authentication providers and access-control groups
- Verify GCS Fuse asset storage
- Explore Cloud Logging and Cloud Monitoring

---

## CLI and REST API Overview

Key tools used in this lab:

| Tool | Purpose |
|---|---|
| `gcloud` | Authenticate, query GCP resources, read secrets, inspect Cloud Run |
| Google Cloud Console | Cloud Logging, Cloud Monitoring, Secret Manager UI |

---

## Prerequisites

1. **Services GCP deployed** — the `Wikijs CloudRun` module depends on `Services GCP`. Ensure it is deployed in the same project.
2. **gcloud CLI authenticated** — run `gcloud auth application-default login`.
3. **GCP project** with billing enabled and the following APIs active (the module enables them automatically on first deploy):
   - Cloud Run, Cloud SQL, Cloud Build, Artifact Registry, Secret Manager, Cloud Storage, Cloud Monitoring, Serverless VPC Access.
4. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | **Yes** | — | GCP project ID |
| `deployment_id` | No | *(auto-generated)* | Stable suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `wikijs` | Base name for the Cloud Run service and secrets |
| `application_version` | No | `2.5.311` | Container image version tag |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 enables scale-to-zero) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances |
| `cpu_limit` | No | `1000m` | CPU limit per instance (millicores) |
| `memory_limit` | No | `2Gi` | Memory limit per instance |
| `db_name` | No | `wikijs` | PostgreSQL database name |
| `db_user` | No | `wikijs` | PostgreSQL user name |
| `enable_redis` | No | `false` | Enable Redis session/cache backend |
| `redis_host` | No | `""` | Redis hostname or IP (required when `enable_redis=true`) |
| `enable_nfs` | No | `true` | Mount Cloud Filestore NFS share into the service |
| `tenant_deployment_id` | No | `demo` | Deployment environment identifier |
| `support_users` | No | `[]` | Email addresses for monitoring alert notifications |
| `ingress_settings` | No | `all` | Traffic sources allowed: `all`, `internal`, `internal-and-cloud-load-balancing` |

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Deployment Duration

| Stage | Estimated Duration |
|---|---|
| Cloud SQL PostgreSQL 15 provisioning | 8–12 min |
| Cloud Build image build | 3–5 min |
| Cloud Run service deployment | 1–2 min |
| NFS Filestore provisioning (if enabled) | 5–8 min |
| **Total (first deploy)** | **15–25 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for DB password |
| `container_registry` | Artifact Registry repository |
| `deployment_id` | Unique deployment suffix |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "wikijs")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret (filter by app name)
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~wikijs" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

### 1. Retrieve the Cloud Run Service URL

```bash
echo "Wiki.js URL: ${SERVICE_URL}"
```

Using gcloud:

```bash
gcloud run services describe ${SERVICE} \
  --region ${REGION} \
  --project ${PROJECT} \
  --format "value(status.url)"
```

**Expected result:** A URL in the form `https://<service-name>-<hash>-<region>.run.app`.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

### 2. Verify the Service is Healthy

```bash
gcloud run services list --project ${PROJECT} --region ${REGION}
```

**Expected result:** The service appears with status `Ready`.

Check the health endpoint:
```bash
curl -s -o /dev/null -w "%{http_code}" https://${SERVICE_URL}/healthz
```

**Expected result:** `200`

---

## Phase 3 — Complete Wiki.js Setup [MANUAL]

### 1. Open the Wiki.js URL

Navigate to the `service_url` in a browser.

On first run, Wiki.js displays the setup wizard (if the database is empty) or the login page (if the module seeded initial state).

### 2. Retrieve Admin Credentials from Secret Manager

```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project ${PROJECT}
```

List available secrets if the name is uncertain:
```bash
gcloud secrets list --project ${PROJECT} --filter="name~wikijs"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access"
```

### 3. Complete the Setup Wizard (if displayed)

- Enter site title, admin email, and admin password.
- Click **Install**.

**Expected result:** Wiki.js redirects to the home page or admin dashboard.

### 4. Log In and Explore the Admin Panel

- Navigate to **Administration** (gear icon in the sidebar).
- Review General settings, Theme, and SEO configuration.

---

## Phase 4 — Create Pages and Content [MANUAL]

### 1. Create a New Page

1. Click **New Page** in the top navigation.
2. Choose **Markdown** as the editor.
3. Set a page path (e.g., `lab/getting-started`).
4. Add content including:
   - Headings (`# H1`, `## H2`)
   - A code block (triple backtick)
   - A table
5. Click **Create** to save.

**Expected result:** The page renders and appears in the left navigation tree.

### 2. Create a Page Tree (Nested Pages)

Create additional pages with paths like `lab/architecture` and `lab/deployment`. Wiki.js automatically groups them under `lab/` in the navigation.

### 3. Add Tags

Open a page, click **Page Actions > Properties**, add one or more tags (e.g., `gcp`, `tutorial`), and save.

### 4. View the Public Page

Navigate to the page URL directly (without being logged in) to verify public read access if the wiki is configured for open access.

---

## Phase 5 — Search Functionality [MANUAL]

### 1. Use the Wiki.js Search

Click the search icon in the top bar, type a keyword from one of your pages, and observe the full-text results.

**Expected result:** Pages containing the keyword appear in results. Search is powered by PostgreSQL `pg_trgm` trigram indexing.

### 2. Verify the pg_trgm Search Engine

1. Navigate to **Administration > Search Engine**.
2. Confirm **Database — PostgreSQL** is selected as the search engine.
3. Click **Rebuild Index** to force a re-index of all pages.

---

## Phase 6 — Authentication and Access Control [MANUAL]

### 1. Review Local Authentication

1. Navigate to **Administration > Authentication**.
2. Click on the **Local** strategy — this is active by default.
3. Review settings such as self-registration and login via email.

### 2. Explore Additional Auth Providers

Review the available providers listed on the Authentication page:
- **SAML 2.0** — for enterprise SSO integration
- **OAuth 2.0 / OpenID Connect** — for Google, GitHub, or custom providers
- **LDAP / Active Directory** — for corporate directory integration

No activation is required for this lab.

### 3. Manage Groups and Permissions

1. Navigate to **Administration > Groups**.
2. Observe the default **Administrators** and **Guests** groups.
3. Click **Administrators** and review the page permission rules.
4. Click **New Group**, name it `Editors`, assign read+write permissions to `/`, and save.

---

## Phase 7 — Storage and Assets [MANUAL]

### 1. Upload an Image in the Page Editor

1. Open or create a page in Markdown editor.
2. Click the image icon in the toolbar.
3. Upload a local image file.

**Expected result:** The image is stored in the GCS bucket mounted at `/wiki-storage` via GCS Fuse.

### 2. Verify GCS Fuse Configuration

Navigate to **Administration > Storage**. Confirm that a storage target using the `/wiki-storage` path is active (this corresponds to the GCS Fuse volume mounting the `wikijs-data-*` bucket).

### 3. Check the GCS Bucket

```bash
gcloud storage ls gs://<PROJECT_ID>-wikijs-data-<DEPLOYMENT_ID>/
```

List all buckets for the project and filter by deployment:
```bash
gcloud storage buckets list --project ${PROJECT} --filter="name~wikijs"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}"
```

**Expected result:** Uploaded images appear as objects in the bucket.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

### 1. View Cloud Run Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project ${PROJECT} \
  --limit 50 \
  --format "table(timestamp, textPayload)"
```

Or stream logs in real time:
```bash
gcloud beta run services logs tail ${SERVICE} \
  --region ${REGION} \
  --project ${PROJECT}
```

### 2. View Logs in Cloud Logging Console

Navigate to **Logging > Log Explorer** and run:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

Look for startup messages confirming database connection and `pg_trgm` index initialization.

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

### 1. View Cloud Run Metrics

In the Cloud Console, navigate to **Monitoring > Dashboards** and open the **Cloud Run** dashboard. Observe request count, latency, and instance count metrics.

### 2. Check the Uptime Check

1. Navigate to **Monitoring > Uptime checks**.
2. Find the uptime check created for this deployment.
3. Verify that the check is passing (green) from multiple global locations.

**gcloud equivalent:**
```bash
gcloud monitoring uptime list-configs --project ${PROJECT}
```

### 3. View Alert Policies

Navigate to **Monitoring > Alerting** to review any alert policies created by the module.

---

## Phase 10 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

> **Warning:** This deletes the Cloud SQL database, GCS bucket contents, and NFS data. Ensure backups are taken before undeploying if data needs to be preserved.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | What You Did |
|---|---|---|
| Phase 1 — Deploy | Automated | Provisioned Cloud Run service, Cloud SQL (PostgreSQL 15 + pg_trgm), GCS Fuse, NFS, secrets |
| Phase 2 — Service URL | Manual | Retrieved Cloud Run service URL, verified health endpoint |
| Phase 3 — Setup | Manual | Completed Wiki.js first-run wizard, retrieved admin credentials from Secret Manager |
| Phase 4 — Content | Manual | Created pages with Markdown, nested page tree, tags |
| Phase 5 — Search | Manual | Tested pg_trgm full-text search, verified search engine config |
| Phase 6 — Auth | Manual | Reviewed local auth, explored SAML/OAuth/LDAP providers, managed groups |
| Phase 7 — Storage | Manual | Uploaded assets, verified GCS Fuse mount and bucket contents |
| Phase 8 — Logging | Manual | Explored Wiki.js logs via Cloud Logging and gcloud |
| Phase 9 — Monitoring | Manual | Reviewed uptime check, Cloud Run metrics, alert policies |
| Phase 10 — Undeploy | Automated | Tore down all module-managed infrastructure |
