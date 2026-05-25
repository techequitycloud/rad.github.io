---
title: "Odoo on Cloud Run — Lab Guide"
sidebar_label: "Odoo CloudRun"
---

# Odoo on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Odoo_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **Odoo Community Edition** — a comprehensive open-source ERP suite — on Google Cloud Run (Gen2) using the **Odoo_CloudRun** module. You will work with Odoo's App Store, CRM and Sales workflows, Inventory management, database operations, security configuration, Cloud Logging, and Cloud Monitoring.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Odoo](#exercise-1--access-odoo)
6. [Exercise 2 — Install and Configure Modules](#exercise-2--install-and-configure-modules)
7. [Exercise 3 — CRM and Sales](#exercise-3--crm-and-sales)
8. [Exercise 4 — Inventory and Products](#exercise-4--inventory-and-products)
9. [Exercise 5 — Database and Backup](#exercise-5--database-and-backup)
10. [Exercise 6 — Security](#exercise-6--security)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Odoo?

Odoo is a comprehensive open-source **ERP platform** with 16M+ users, 170,000+ enterprise customers, and €650M in 2025 billing revenue growing at 42% CAGR. It covers CRM, accounting, inventory, manufacturing, HR, and e-commerce in one integrated suite at zero licensing cost — the primary open-source alternative to SAP, Oracle, and Microsoft Dynamics.

The `Odoo_CloudRun` module deploys Odoo 18.0 Community Edition on Cloud Run Gen2 with Cloud SQL PostgreSQL, Cloud Filestore NFS for the Odoo filestore and sessions, GCS for addons, and auto-generated master password managed in Secret Manager.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Odoo App Store** | Install modules from the integrated app store |
| **CRM Module** | Lead management, opportunity pipeline, quotations |
| **Sales Module** | Product catalog, sales orders, customer management |
| **Inventory Module** | Product stock, inventory adjustments, purchase orders |
| **Database Management** | Odoo backup/restore via admin panel, Cloud SQL inspection |
| **Security** | Users, groups, access rights, Secret Manager |
| **Cloud Logging** | Structured logs from the Cloud Run revision |
| **Cloud Monitoring** | Uptime checks, memory/CPU metrics, Cloud Run insights |

---

## 2. Architecture

```
Browser
       │
       ▼
Cloud Run Gen2 (Odoo Python container)
  │  port 8069
  │  NFS mount: /mnt (filestore, sessions, extra-addons)
  │  GCS Fuse: odoo-addons bucket → /mnt/extra-addons
  │  Cloud SQL Auth Proxy sidecar (Unix socket /cloudsql)
  │
  ├── Cloud SQL PostgreSQL 15
  │     DB: odoo / user: odoo
  │
  └── Cloud Filestore NFS
        /mnt/filestore  — Odoo filestore (attachments, images)
        /mnt/sessions   — Odoo session files
        /mnt/extra-addons — Community/custom modules

Supporting services:
  ┌──────────────────────┐  ┌───────────────────┐  ┌──────────────────┐
  │  Secret Manager      │  │  Artifact Registry │  │  Cloud Build     │
  │  ODOO_MASTER_PASS    │  │  Custom Odoo image │  │  Builds from     │
  │  DB_PASSWORD         │  │  from nightly .deb │  │  nightly Ubuntu  │
  │  ROOT_PASSWORD       │  │                   │  │  Dockerfile      │
  └──────────────────────┘  └───────────────────┘  └──────────────────┘

Init jobs (run at deploy time):
  nfs-init:  Creates /mnt/filestore, /mnt/sessions, /mnt/extra-addons (UID 101)
  db-init:   Creates PostgreSQL database and odoo user

  ┌──────────────────────┐  ┌───────────────────┐
  │  Cloud Logging       │  │  Cloud Monitoring  │
  │  Structured Python   │  │  Uptime check,     │
  │  app logs via stdout │  │  CPU/memory metrics│
  └──────────────────────┘  └───────────────────┘

Module variable wiring:
  Odoo_CloudRun
    application_version    = "18.0"     → Odoo nightly package version
    container_port         = 8069       → Cloud Run container port
    enable_cloudsql_volume = true       → Auth Proxy Unix socket
    enable_nfs             = true       → NFS mandatory for Odoo
    min_instance_count     = 0          → Scale-to-zero (cold start ~120s)
    max_instance_count     = 1          → Single instance (Redis needed for multi)
    cpu_limit              = "1000m"    → 1 vCPU (increase for production)
    memory_limit           = "1Gi"      → 1 GiB (minimum 2Gi recommended)
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
  --filter="metadata.name~odoo" \
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

Deploy the `Odoo_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_version` | `18.0` | Odoo version |
| `cpu_limit` | `1000m` | Increase to `2000m` for production |
| `memory_limit` | `2Gi` | Minimum recommended |
| `min_instance_count` | `0` | Scale-to-zero |
| `max_instance_count` | `1` | Single instance (Redis needed for multi) |
| `enable_nfs` | `true` | Required for Odoo filestore |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar |

Click **Deploy** and wait for provisioning to complete (approximately 25–40 minutes).

> **What this provisions:** Cloud Run Gen2 service with Odoo 18.0 from nightly packages, Cloud SQL PostgreSQL 15 instance, Cloud Filestore NFS volume (with `nfs-init` and `db-init` jobs), GCS addons bucket, Artifact Registry with custom Ubuntu-based Odoo image, Secret Manager secret (ODOO_MASTER_PASS), Cloud Monitoring uptime check, and automated backup schedule.

### 4.2 Configure Shell Environment

```bash
# Get the Odoo master password
MASTER_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~odoo AND name~master-password" \
  --format="value(name)" \
  --limit=1)

export MASTER_PASS=$(gcloud secrets versions access latest \
  --secret="${MASTER_SECRET}" \
  --project="${PROJECT}")

echo "Master password: ${MASTER_PASS}"
echo "Odoo URL: ${SERVICE_URL}/web"
```

---

## Exercise 1 — Access Odoo

### Objective

Access the Odoo web interface, complete the initial database and admin setup, and tour the main dashboard.

### Step 1.1 — Verify the Service is Running

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="table(status.url,status.conditions[0].type,status.conditions[0].status)"
```

**REST API (health check):**
```bash
curl -s "${SERVICE_URL}/web/health" | jq .
```

**Expected result:** `{"status": "pass"}` — Odoo is up and connected to the database.

### Step 1.2 — Initial Database Setup

Open `${SERVICE_URL}/web/database/selector` in your browser.

If this is the first deploy, click **Create Database**:
- **Master Password:** value from `${MASTER_PASS}`
- **Database Name:** `odoo`
- **Email:** `admin@example.com`
- **Password:** Choose a strong admin password
- **Language:** English
- **Country:** United States

Click **Create Database** and wait 2–5 minutes for initial module installation.

### Step 1.3 — Log In and Tour the Dashboard

Open `${SERVICE_URL}/web` and log in with `admin@example.com` and your chosen password.

The main Odoo home screen shows the installed app grid. Navigate to:

| Section | Purpose |
|---|---|
| **Settings** | Company config, users, technical settings |
| **Discuss** | Internal messaging and notifications |
| **Contacts** | Customer and supplier database |
| **Calendar** | Scheduling and activity management |

**REST API (verify authentication):**
```bash
# Authenticate via JSON-RPC
curl -s -c /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/session/authenticate" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"call","params":{"db":"odoo","login":"admin@example.com","password":"your-password"}}' \
  | jq '.result | {uid, name, username}'
```

**Expected result:** Session authenticated; user ID and name returned.

### Step 1.4 — Configure Company Settings

1. Navigate to **Settings > General Settings**.
2. Under **Companies**, set:
   - **Company Name:** `Demo Corp`
   - **Currency:** USD
   - **Timezone:** America/New_York
3. Click **Save**.

**gcloud (inspect revision):**
```bash
gcloud run revisions list \
  --service="${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --limit=3 \
  --format="table(metadata.name,status.conditions[0].status)"
```

---

## Exercise 2 — Install and Configure Modules

### Objective

Use the Odoo App Store to install the CRM and Sales modules, and configure the basic company information needed for exercises 3 and 4.

### Step 2.1 — Open the App Store

1. Click the main menu icon (top-left grid) to return to the home screen.
2. Click **Apps** to open the App Store.
3. The App Store shows all available Odoo modules.

**REST API (list installed modules):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "ir.module.module",
      "method": "search_read",
      "args": [[["state","=","installed"]]],
      "kwargs": {"fields": ["name","shortdesc"], "limit": 20}
    }
  }' | jq '.result[] | {name, description: .shortdesc}'
```

### Step 2.2 — Install CRM Module

1. In the App Store, search for **CRM**.
2. Click **Install** on the CRM module.
3. Wait for the installation to complete (approximately 1–2 minutes).

**Expected result:** CRM module appears in the main menu and installed modules list.

### Step 2.3 — Install Sales Module

1. Search for **Sales** in the App Store.
2. Install the **Sales** module.

### Step 2.4 — Configure Sales Settings

1. Navigate to **Sales > Configuration > Settings**.
2. Enable:
   - **Customer Addresses** — allow multiple shipping addresses
   - **Units of Measure**
3. Click **Save**.

**REST API (verify Sales module is installed):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "ir.module.module",
      "method": "search_read",
      "args": [[["name","in",["sale","crm"]]]],
      "kwargs": {"fields": ["name","state"]}
    }
  }' | jq '.result[] | {name, state}'
```

**Expected result:** `sale` and `crm` modules show state `installed`.

---

## Exercise 3 — CRM and Sales

### Objective

Use Odoo CRM to manage leads and the opportunity pipeline, create a quotation, and confirm a sales order.

### Step 3.1 — Create a Lead

1. Navigate to **CRM** from the main menu.
2. Click **+ New** to create a new lead.
3. Fill in:
   - **Contact Name:** Jane Smith
   - **Company Name:** TechCorp Inc.
   - **Expected Revenue:** $5,000
   - **Phone:** +1-555-1234
4. Click **Save**.

**REST API (create a lead):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "crm.lead",
      "method": "create",
      "args": [{"name": "API Lead", "contact_name": "Bob Jones", "expected_revenue": 3000}],
      "kwargs": {}
    }
  }' | jq '.result'
```

**Expected result:** Lead created with an integer ID.

### Step 3.2 — Manage the Opportunity Pipeline

1. In **CRM**, switch to **Kanban view** (pipeline view).
2. Drag and drop your lead across stages: **New → Qualified → Proposition**.
3. Open the lead and click **Mark Won** to close it as successful.

**REST API (update lead stage):**
```bash
LEAD_ID="<id from step 3.1>"
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"call\",
    \"params\": {
      \"model\": \"crm.lead\",
      \"method\": \"write\",
      \"args\": [[${LEAD_ID}], {\"probability\": 80}],
      \"kwargs\": {}
    }
  }" | jq '.result'
```

### Step 3.3 — Create a Quotation

1. Navigate to **Sales > Orders > Quotations**.
2. Click **+ New**.
3. Set **Customer** to the contact you created.
4. Add a product line (any product name).
5. Click **Confirm** to convert to a Sales Order.

**REST API (list sales orders):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "sale.order",
      "method": "search_read",
      "args": [[["state","=","sale"]]],
      "kwargs": {"fields": ["name","state","amount_total","partner_id"], "limit": 10}
    }
  }' | jq '.result[] | {name, state, total: .amount_total, customer: .partner_id[1]}'
```

**Expected result:** Sales order in `sale` state with confirmed status.

### Step 3.4 — Review Revenue Reports

1. Navigate to **Sales > Reporting > Sales Analysis**.
2. Group by **Salesperson** and **Product** to see the pipeline summary.

---

## Exercise 4 — Inventory and Products

### Objective

Install the Inventory module, create a product with stock, perform an inventory adjustment, and create a purchase order.

### Step 4.1 — Install Inventory Module

In the App Store, search for and install **Inventory** if not already installed.

### Step 4.2 — Create a Product

1. Navigate to **Inventory > Products > Products**.
2. Click **+ New**.
3. Fill in:
   - **Product Name:** `Cloud Widget`
   - **Product Type:** Storable Product
   - **Sales Price:** $29.99
   - **Cost:** $12.00
4. Click **Save**.

**REST API (create a product):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "product.product",
      "method": "create",
      "args": [{"name": "API Widget", "type": "product", "list_price": 19.99, "standard_price": 8.00}],
      "kwargs": {}
    }
  }' | jq '.result'
```

### Step 4.3 — Adjust Inventory

1. Navigate to **Inventory > Operations > Physical Inventory**.
2. Click **+ New** and select your product.
3. Set **Counted Quantity** to `100`.
4. Click **Apply All** to confirm the adjustment.

**REST API (check product stock):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "product.product",
      "method": "search_read",
      "args": [[["name","ilike","Widget"]]],
      "kwargs": {"fields": ["name","qty_available","list_price"], "limit": 5}
    }
  }' | jq '.result[] | {name, qty_on_hand: .qty_available, price: .list_price}'
```

**Expected result:** Product shows `qty_available` of 100.

### Step 4.4 — Create a Purchase Order

1. Install the **Purchase** module from the App Store if not installed.
2. Navigate to **Purchase > Orders > Purchase Orders**.
3. Click **+ New**.
4. Set **Vendor** to any supplier name.
5. Add a product line with `Cloud Widget`.
6. Click **Confirm Order**.

**REST API (list purchase orders):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "purchase.order",
      "method": "search_read",
      "args": [[["state","=","purchase"]]],
      "kwargs": {"fields": ["name","state","amount_total"], "limit": 5}
    }
  }' | jq '.result[] | {name, state, total: .amount_total}'
```

---

## Exercise 5 — Database and Backup

### Objective

Inspect the Cloud SQL database, use the Odoo admin panel to create a backup, and verify backup storage in GCS.

### Step 5.1 — Inspect Cloud SQL Instance

**gcloud:**
```bash
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --filter="name~odoo" \
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

### Step 5.2 — List Odoo Databases via Admin Panel

Open `${SERVICE_URL}/web/database/manager` in your browser.

Enter the master password (`${MASTER_PASS}`) to access the database management panel. This shows all databases on the PostgreSQL instance.

**REST API:**
```bash
curl -s -X POST "${SERVICE_URL}/web/database/list" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"call","params":{}}' \
  | jq '.result'
```

### Step 5.3 — Create a Database Backup via Admin Panel

1. In the database manager at `${SERVICE_URL}/web/database/manager`:
2. Click the **Backup** button next to the `odoo` database.
3. Enter the master password.
4. Download the zip backup file.

**gcloud (list automated backups in GCS):**
```bash
BACKUP_BUCKET=$(gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~odoo AND name~backup" \
  --format="value(name)" \
  --limit=1)

if [ -n "${BACKUP_BUCKET}" ]; then
  gcloud storage ls "gs://${BACKUP_BUCKET}" | head -10
fi
```

### Step 5.4 — Verify Cloud SQL Automated Backups

**gcloud:**
```bash
gcloud sql backups list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}" \
  --limit=5 \
  --format="table(id,status,startTime,endTime)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances/${INSTANCE}/backupRuns?maxResults=5" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {id, status, startTime, endTime}'
```

**Expected result:** Recent backup listed with `SUCCESSFUL` status.

---

## Exercise 6 — Security

### Objective

Manage Odoo users and groups, configure access rights, and inspect Secret Manager secrets used by the deployment.

### Step 6.1 — Manage Users

1. Navigate to **Settings > Users & Companies > Users**.
2. Click **+ New** to create a user.
3. Set:
   - **Name:** John Doe
   - **Email:** `john@example.com`
   - **Sales:** User (this controls CRM access)
4. Click **Save** and then **Send an Invitation Email** (optional).

**REST API (list users):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "res.users",
      "method": "search_read",
      "args": [[["active","=",true]]],
      "kwargs": {"fields": ["name","login","groups_id"], "limit": 10}
    }
  }' | jq '.result[] | {name, login}'
```

### Step 6.2 — Review Groups and Access Rights

1. Navigate to **Settings > Technical > Security > Groups** (enable developer mode first: `${SERVICE_URL}/web?debug=1`).
2. Open the **Sales / User** group.
3. Review the **Access Rights** tab — shows model-level CRUD permissions.
4. Review the **Record Rules** tab — shows row-level access filters.

**REST API (list security groups):**
```bash
curl -s -b /tmp/odoo_session.txt -X POST "${SERVICE_URL}/web/dataset/call_kw" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "call",
    "params": {
      "model": "res.groups",
      "method": "search_read",
      "args": [[["category_id.name","=","Sales"]]],
      "kwargs": {"fields": ["name","full_name"], "limit": 10}
    }
  }' | jq '.result[] | {name, full_name}'
```

### Step 6.3 — Inspect Secret Manager Secrets

**gcloud:**
```bash
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~odoo" \
  --format="table(name,createTime)"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name:odoo" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.secrets[] | {name: .name, createTime}'
```

**Expected result:** Secrets for `master-password` and `db-password` (and `root-password`) appear.

### Step 6.4 — Retrieve and Verify the Master Password

```bash
MASTER_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~odoo AND name~master-password" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${MASTER_SECRET}" \
  --project="${PROJECT}" \
  | wc -c
# Expected: 17 (16-char password + newline)
```

### Step 6.5 — Review IAM Access to the Cloud Run Service

**gcloud:**
```bash
gcloud run services get-iam-policy "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="yaml"
```

**Expected result:** IAM policy shows who can invoke the Cloud Run service.

---

## Exercise 7 — Cloud Logging

### Objective

Query Cloud Logging for Odoo application logs, startup logs, database initialization logs, and filter by request URL and severity.

### Step 7.1 — View Recent Odoo Logs

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
  }" | jq '.entries[] | {timestamp, severity, message: (.textPayload // .jsonPayload.message)}'
```

### Step 7.2 — Filter Odoo Web Requests

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND httpRequest.requestUrl:\"/web\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="json" \
  | jq '.[] | {timestamp, method: .httpRequest.requestMethod, url: .httpRequest.requestUrl, status: .httpRequest.status}'
```

**Expected result:** Log entries for Odoo web interface requests.

### Step 7.3 — View Database Init Job Logs

```bash
gcloud logging read \
  "resource.type=\"cloud_run_job\" \
   AND labels.\"run.googleapis.com/job_name\"~\"db-init\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,severity,textPayload)"

gcloud logging read \
  "resource.type=\"cloud_run_job\" \
   AND labels.\"run.googleapis.com/job_name\"~\"nfs-init\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,severity,textPayload)"
```

**Expected result:** Logs from `nfs-init` (directory creation) and `db-init` (PostgreSQL setup) jobs.

### Step 7.4 — Filter by Severity

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND severity>=\"WARNING\"" \
  --project="${PROJECT}" \
  --limit=20 \
  --format="json" \
  | jq '.[] | {timestamp, severity, message: (.textPayload // .jsonPayload.message)}'
```

### Step 7.5 — Search Odoo-Specific Log Patterns

```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" \
   AND resource.labels.service_name=\"${SERVICE}\" \
   AND textPayload:\"odoo.addons\"" \
  --project="${PROJECT}" \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

---

## Exercise 8 — Cloud Monitoring

### Objective

Review Cloud Monitoring metrics for the Odoo Cloud Run service, check uptime status, and observe memory utilization patterns.

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

### Step 8.2 — Check Memory Utilization

Odoo is memory-intensive. Query memory metrics:

**REST API:**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/container/memory/utilizations | filter resource.service_name = '${SERVICE}' | within 30m | percentile(val(), 95)\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

**Expected result:** Memory utilization data — Odoo typically uses 600MB–1.2GB under normal operation.

### Step 8.3 — View Uptime Check

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
  | jq '.uptimeCheckConfigs[] | {displayName, period, path: .httpCheck.path}'
```

**Expected result:** Uptime check targeting the Odoo service root.

### Step 8.4 — Check Request Latency

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

### Step 8.5 — Open Monitoring Dashboard

```bash
echo "https://console.cloud.google.com/run/detail/${REGION}/${SERVICE}/metrics?project=${PROJECT}"
```

Review:
- **Request count** — total requests per minute
- **Request latency** — P50, P95 response times (Odoo can be 200–500ms for complex pages)
- **Instance count** — active Cloud Run instances
- **Container memory utilisation** — Odoo uses significant RAM; watch for OOM events

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Odoo_CloudRun` deployment. This removes the Cloud Run service, Cloud SQL instance, NFS Filestore, Secret Manager secrets, GCS buckets, and Artifact Registry images.

### Manual Cleanup (if needed)

**gcloud:**
```bash
gcloud run services delete "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" --quiet

gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~odoo" \
  --format="value(name)" \
  | xargs -I{} gcloud secrets delete {} --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

> **Note:** After deleting a Cloud Run service, GCP may hold serverless IPv4 addresses for 20–30 minutes. Re-run destroy after waiting if the first attempt fails on subnet deletion.

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `odoo` | Base resource name |
| `application_version` | string | `18.0` | Odoo nightly package version |
| `cpu_limit` | string | `1000m` | CPU per instance |
| `memory_limit` | string | `1Gi` | Memory per instance (min 2Gi recommended) |
| `min_instance_count` | number | `0` | Scale-to-zero |
| `max_instance_count` | number | `1` | Single instance (Redis needed for multi) |
| `container_port` | number | `8069` | Odoo HTTP port |
| `enable_nfs` | bool | `true` | Cloud Filestore NFS (required for Odoo) |
| `nfs_mount_path` | string | `/mnt/nfs` | NFS container mount path |
| `enable_cloudsql_volume` | bool | `true` | Cloud SQL Auth Proxy sidecar |
| `application_database_name` | string | `odoo` | PostgreSQL database name |
| `application_database_user` | string | `odoo` | PostgreSQL database user |
| `enable_redis` | bool | `false` | Redis session store |
| `redis_host` | string | `""` | Redis host (required when enabled) |
| `enable_cloud_armor` | bool | `false` | Global HTTPS LB + Cloud Armor WAF |
| `backup_schedule` | string | `0 2 * * *` | Daily backup cron schedule |
| `backup_retention_days` | number | `7` | GCS backup retention days |

### Useful Commands Reference

```bash
# Get service URL
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" --region="${REGION}" --format="value(status.url)"

# Get master password
gcloud secrets versions access latest --secret="${MASTER_SECRET}" --project="${PROJECT}"

# Health check
curl "${SERVICE_URL}/web/health"

# List databases
curl -X POST "${SERVICE_URL}/web/database/list" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"call","params":{}}'

# Tail logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}" \
  --project="${PROJECT}" --limit=20 --order=desc

# List secrets
gcloud secrets list --project="${PROJECT}" --filter="name~odoo"

# View Cloud SQL
INSTANCE=$(gcloud sql instances list --project="${PROJECT}" --filter="name~odoo" --format="value(name)")
gcloud sql instances describe "${INSTANCE}" --project="${PROJECT}"
```

### Further Reading

- [Odoo Documentation](https://www.odoo.com/documentation/18.0/)
- [Odoo Community Modules (OCA)](https://github.com/OCA)
- [Odoo RPC API](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html)
- [Cloud Run Gen2 Overview](https://cloud.google.com/run/docs/about-execution-environments)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Cloud Filestore Overview](https://cloud.google.com/filestore/docs/overview)
- [Secret Manager Best Practices](https://cloud.google.com/secret-manager/docs/best-practices)
