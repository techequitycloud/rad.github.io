---
title: "Odoo ERP on Cloud Run — Lab Guide"
sidebar_label: "Odoo CloudRun"
---

# Odoo ERP on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Odoo_CloudRun)**

## Overview

**Estimated time:** 2–3 hours (ERP complexity requires additional setup and exploration time)

This lab walks you through deploying Odoo ERP on Google Cloud Run using the `Odoo CloudRun` module, then verifying and exploring the deployment manually. The module handles all GCP infrastructure; you perform the post-deployment steps interactively.

### What the Module Automates

- Cloud Run Gen2 service with auto-scaling (configurable min/max instances)
- Cloud SQL PostgreSQL instance, database, and user
- Cloud Build custom Odoo image build and push to Artifact Registry
- GCS Fuse volume for Odoo file storage
- Cloud Filestore (NFS) persistent share (`/mnt/nfs`) for shared attachments — requires gen2 environment
- Cloud SQL Auth Proxy sidecar via Cloud Run volume (Unix socket at `/cloudsql`)
- Direct VPC Egress for private Cloud SQL and Redis connectivity
- Secret Manager secrets (DB password, Odoo master/admin password)
- Cloud Monitoring uptime check and alert policies
- Backup Cloud Run Job (daily at 02:00 UTC via Cloud Scheduler)
- Redis environment variable injection (when `enable_redis = true`)

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Create the Odoo master password and initialize the first database
- Log in with admin credentials from Secret Manager
- Install CRM and Project ERP modules, explore pipelines
- Review settings, developer mode, multi-company, and user roles
- Verify GCS Fuse / NFS file storage with document uploads
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

1. **Services GCP deployed** — the `Odoo CloudRun` module depends on `Services GCP`. Ensure it is deployed in the same project.
2. **gcloud CLI authenticated** — run `gcloud auth application-default login`.
3. **GCP project** with billing enabled and the following APIs active (the module enables them automatically on first apply):
   - Cloud Run, Cloud SQL, Cloud Build, Artifact Registry, Secret Manager, Cloud Storage, Cloud Monitoring.
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
| `application_name` | No | `odoo` | Base name for the Cloud Run service and secrets |
| `application_version` | No | `18.0` | Odoo version (maps to nightly build URL) |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `min_instance_count` | No | `0` | Minimum Cloud Run instances (0 enables scale-to-zero) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances |
| `cpu_limit` | No | `1000m` | CPU limit per instance (millicores) |
| `memory_limit` | No | `1Gi` | Memory limit per instance |
| `container_resources` | No | `{cpu_limit="1000m", memory_limit="512Mi"}` | Container resource limits (overridden by `cpu_limit`/`memory_limit`) |
| `application_database_name` | No | `odoo` | PostgreSQL database name |
| `application_database_user` | No | `odoo` | PostgreSQL user name |
| `enable_nfs` | No | `true` | Mount Cloud Filestore NFS share into the service |
| `tenant_deployment_id` | No | `demo` | Deployment environment identifier |
| `support_users` | No | `[]` | Email addresses for monitoring alert notifications |
| `ingress_settings` | No | `all` | Traffic sources allowed: `all`, `internal`, `internal-and-cloud-load-balancing` |

> **Note on Odoo resources:** Odoo loads all active modules and may perform database migrations at startup. For production, set `memory_limit` to at least `2Gi`. The startup probe uses a TCP check (port availability only) with a 60 s initial delay to handle Odoo's slow initialization.

### Deploy

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

### Deployment Duration

| Stage | Estimated Duration |
|---|---|
| Cloud SQL PostgreSQL provisioning | 8–12 min |
| Cloud Build Odoo image build | 5–8 min |
| Cloud Run service deployment | 1–2 min |
| NFS Filestore provisioning (if enabled) | 5–8 min |
| **Total (first deploy)** | **20–30 min** |

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
| `nfs_mount_path` | NFS mount path inside the container |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "odoo")
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
  --filter="name~odoo" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

### 1. Retrieve the Cloud Run Service URL

```bash
echo "Odoo URL: ${SERVICE_URL}"
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

> **Note:** Odoo may take 60–120 seconds after the first request before HTTP responses are reliable. The startup probe uses a TCP check to handle this delay. The `/web/health` endpoint returns `200` only after database initialization completes.

Check the health endpoint:
```bash
curl -s -o /dev/null -w "%{http_code}" https://${SERVICE_URL}/web/health
```

**Expected result:** `200`

---

## Phase 3 — Complete Odoo Setup [MANUAL]

### 1. Open the Odoo URL

Navigate to `https://${SERVICE_URL}` in a browser.

On first visit, Odoo displays the **database manager** page at `/web/database/manager`.

### 2. Create the Odoo Database

Fill in the form:
- **Master Password** — retrieve from Secret Manager (see below)
- **Database Name** — e.g., `odoo` (should match `application_database_name`)
- **Email** — admin email address
- **Password** — admin user password
- **Language** — select your locale
- **Country** — select your country
- **Demo data** — optionally check to load sample records

Click **Create database**.

**Expected result:** Odoo initializes the schema (1–3 minutes), then redirects to the main dashboard.

### 3. Retrieve the Master Password from Secret Manager

The Odoo master password controls database management operations. It is stored in Secret Manager:

```bash
gcloud secrets versions access latest \
  --secret="odoo-master-password" \
  --project ${PROJECT}
```

List all Odoo-related secrets:
```bash
gcloud secrets list --project ${PROJECT} --filter="name~odoo"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/odoo-master-password/versions/latest:access"
```

### 4. Log In and Explore the Home Menu

Log in with the admin email and password you set during database creation. The **Home Menu** (Apps screen) displays all available Odoo modules. Modules must be installed individually.

---

## Phase 4 — Install and Explore Core ERP Modules [MANUAL]

### 1. Install the CRM Module

1. Navigate to **Settings > Apps** (or click the main menu and select **Apps**).
2. Search for `CRM`.
3. Click **Install** on the CRM module.

**Expected result:** The Apps page refreshes, and CRM appears in the main navigation.

### 2. Explore CRM — Leads and Opportunities

1. Click **CRM** in the top navigation.
2. Navigate to **CRM > Leads** (or **Opportunities**).
3. Click **New** to create a test lead:
   - **Contact Name**: Lab Contact
   - **Company**: Lab Corp
   - **Email**: lab@example.com
4. Save the record.
5. Click **Convert to Opportunity** and assign it to a sales team.
6. Drag the opportunity card between pipeline stages (New → Qualified → Proposition → Won).

**Expected result:** The Kanban pipeline updates stage counts in real time.

### 3. Install the Project Module

1. Navigate to **Apps**, search for `Project`, and click **Install**.
2. Navigate to **Project > Projects > New**.
3. Create a project named `GCP Lab`, set a deadline, and save.
4. Create two tasks within the project: `Deploy Infrastructure` and `Verify Deployment`.
5. Assign tasks, set priorities, and move between stages.

---

## Phase 5 — Explore Settings and Configuration [MANUAL]

### 1. Activate Developer Mode

Navigate to **Settings > General Settings**, scroll to the bottom, and click **Activate the developer mode**.

**Expected result:** A debug icon (bug) appears in the top navigation bar, and additional technical menus are enabled.

Alternatively, append `?debug=1` to any Odoo URL.

### 2. Explore the ERP Data Model

Navigate to **Settings > Technical > Database Structure > Models**.

Browse the list of Odoo models (e.g., `crm.lead`, `project.task`, `res.partner`). Click any model to see its fields, access rights, and related records.

### 3. Review Company Settings (Multi-Company)

Navigate to **Settings > Companies**. Observe the default company created during setup. Click **New** to explore creating a second company (multi-company mode allows a single Odoo instance to serve multiple legal entities).

### 4. Review User Roles and Access Rights

1. Navigate to **Settings > Users & Companies > Users**.
2. Click your admin user and review the **Access Rights** tab — which modules the user can access and at what privilege level.
3. Click **New** to explore the user creation form.

---

## Phase 6 — Explore Storage and Attachments [MANUAL]

### 1. Upload a Document

1. Navigate to **Discuss** in the main menu.
2. Open any channel or direct message thread.
3. Click the attachment icon and upload a local file (e.g., a PDF or image).

Alternatively, open any CRM opportunity or Project task and attach a file using the chatter at the bottom.

**Expected result:** The file is uploaded and displayed as an attachment on the record.

### 2. Verify Files in NFS or GCS Fuse

Files uploaded through the Odoo UI are stored in the Odoo filestore path, which is mapped to the NFS mount (`/mnt/nfs`) or GCS Fuse volume.

Check the GCS bucket directly:
```bash
gcloud storage ls --recursive gs://<PROJECT_ID>-odoo-data-<DEPLOYMENT_ID>/
```

List all Odoo-related buckets:
```bash
gcloud storage buckets list --project ${PROJECT} --filter="name~odoo"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}"
```

**Expected result:** Uploaded files appear as objects in the bucket.

---

## Phase 7 — Explore Cloud Logging [MANUAL]

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

Look for:
- Gunicorn worker startup messages (e.g., `Booting worker with pid`)
- Database connection confirmation
- Module load logs (e.g., `Loading module crm`)
- Werkzeug request logs

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

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

## Phase 9 — Delete [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

> **Warning:** This deletes the Cloud SQL database, GCS bucket contents, and NFS data. Ensure database backups are taken before deleting if data needs to be preserved.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | What You Did |
|---|---|---|
| Phase 1 — Deploy | Automated | Provisioned Cloud Run service, Cloud SQL (PostgreSQL), NFS (Filestore), GCS Fuse, Artifact Registry, secrets |
| Phase 2 — Service URL | Manual | Retrieved Cloud Run service URL, verified health endpoint |
| Phase 3 — Setup | Manual | Created Odoo database, retrieved master password from Secret Manager, logged in |
| Phase 4 — ERP Modules | Manual | Installed CRM and Project; created leads, opportunities, and tasks |
| Phase 5 — Settings | Manual | Activated developer mode, explored data model, multi-company, user roles |
| Phase 6 — Storage | Manual | Uploaded documents, verified NFS and GCS Fuse file storage |
| Phase 7 — Logging | Manual | Explored Odoo gunicorn/worker logs via Cloud Logging and gcloud |
| Phase 8 — Monitoring | Manual | Reviewed uptime check, Cloud Run metrics, alert policies |
| Phase 9 — Delete | Automated | Tore down all module-managed infrastructure |
