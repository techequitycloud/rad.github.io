---
title: "Cyclos on Cloud Run — Lab Guide"
sidebar_label: "Cyclos CloudRun"
---

# Cyclos on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cyclos_CloudRun)**

This lab guide walks you through deploying, exploring, and operating **Cyclos Community Edition**
on Google Cloud Run with the **Cyclos_CloudRun** module. You will explore a production-grade
digital banking platform covering payment channels, user management, transaction processing,
REST API integration, and Google Cloud observability — all running on a fully serverless runtime
backed by Cloud SQL PostgreSQL and Secret Manager.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Cyclos](#exercise-1--access-cyclos)
6. [Exercise 2 — User Management](#exercise-2--user-management)
7. [Exercise 3 — Payment Channels and Currencies](#exercise-3--payment-channels-and-currencies)
8. [Exercise 4 — Transactions](#exercise-4--transactions)
9. [Exercise 5 — API Access](#exercise-5--api-access)
10. [Exercise 6 — Database and Security](#exercise-6--database-and-security)
11. [Exercise 7 — Cloud Logging](#exercise-7--cloud-logging)
12. [Exercise 8 — Cloud Monitoring](#exercise-8--cloud-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Cyclos?

Cyclos is open-source banking and payment software powering 1,500+ payment systems worldwide,
particularly in developing economies and community currency initiatives. It enables financial
inclusion for microfinance institutions, local banks, barter networks, and remittance operators,
providing mobile-first online banking, POS integration, QR payments, and marketplace tools.
The `Cyclos_CloudRun` module deploys **Cyclos Community Edition v4.16.17** on Cloud Run Gen 2,
backed by Cloud SQL PostgreSQL 15 with full serverless auto-scaling and private VPC connectivity.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Serverless Banking** | Cloud Run Gen 2 hosting a Java/Tomcat financial platform with startup and liveness probes |
| **Private Database** | Cloud SQL PostgreSQL 15 with private IP via Serverless VPC Access connector |
| **Secret Management** | Database credentials and encryption keys stored in Secret Manager with rotation notifications |
| **Payment Channels** | Web, Mobile, POS, and REST API payment channels with configurable transfer types |
| **User & Account Model** | Multi-tier user groups, account types, and credit limits |
| **REST API** | Cyclos REST API for programmatic access to payments, accounts, and user data |
| **GCS File Storage** | Uploaded files stored in Cloud Storage (`cyclos.storedFileContentManager = gcs`) |
| **Observability** | Cloud Logging (Tomcat logs) and Cloud Monitoring with uptime checks |

---

## 2. Architecture

```
Browser / Mobile App / REST Client
         │
         ▼
Cloud Run Gen 2 Service (cyclos)
  ├── Apache Tomcat + Cyclos 4.16.17
  ├── Startup probe: HTTP /api, 90s delay, 10 failures
  ├── Liveness probe: HTTP /api, 120s delay
  └── Serverless VPC Access connector
         │
         ├── Cloud SQL PostgreSQL 15 (private IP)
         │     └── database: cyclos, user: cyclos
         │         extensions: pg_trgm, uuid-ossp,
         │                     postgis, earthdistance
         │
         ├── Cloud Storage bucket (cyclos-storage)
         │     └── Uploaded files and media (GCS content manager)
         │
         └── Secret Manager
               └── DB password secret (30-day rotation alerts)
```

### Infrastructure

```
┌──────────────────────────────────────────────────────────────────┐
│  Google Cloud Project                                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Cloud Run Gen 2                                          │   │
│  │  cyclos service → https://<hash>.run.app/cyclos           │   │
│  │  min_instances=1, max_instances=1 (standalone mode)       │   │
│  └─────────────────────┬────────────────────────────────────┘    │
│                         │ VPC connector (private ranges)         │
│  ┌──────────────────────▼─────────────────────────────────────┐  │
│  │  VPC Network                                                │ │
│  │  ┌──────────────────┐  ┌────────────────────────────────┐  │  │
│  │  │  Cloud SQL        │  │  Serverless VPC Access          │  ││
│  │  │  PostgreSQL 15    │  │  Connector                      │  ││
│  │  │  (private IP)     │  │  (PRIVATE_RANGES_ONLY egress)   │  ││
│  │  └──────────────────┘  └────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │  Secret Manager  │  │  Cloud Storage   │  │  Artifact     │   │
│  │  (db password,   │  │  (cyclos-storage │  │  Registry     │   │
│  │   rotation alert)│  │   bucket)        │  │  (image)      │   │
│  └──────────────────┘  └──────────────────┘  └───────────────┘   │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Cloud Logging   │  │  Cloud Monitoring (uptime check,     │  │
│  │  (Tomcat logs,   │  │   request count, latency, CPU,       │  │
│  │   request logs)  │  │   memory, instance count)            │  │
│  └──────────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Module variable wiring:

  Cyclos_CloudRun
    application_version     = "4.16.17"  → cyclos/cyclos:4.16.17
    min_instance_count      = 1          → always-warm instance
    max_instance_count      = 1          → single-instance (standalone)
    enable_cloudsql_volume  = false      → TCP to Cloud SQL private IP
    enable_nfs              = false      → GCS file storage instead
    ingress_settings        = "all"      → public HTTPS endpoint
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
roles/secretmanager.admin
roles/iam.serviceAccountAdmin
roles/monitoring.admin
roles/logging.admin
roles/storage.admin
```

### Environment Variables

```bash
export PROJECT="${PROJECT_ID}"   # your GCP project ID
export REGION="us-central1"      # region you deployed into

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(metadata.name)" \
  --filter="metadata.name~cyclos" \
  --limit=1)

# Discover the service URL
export SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --project="${PROJECT}" \
  --region="${REGION}" \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~cyclos" \
  --format="value(name)" \
  --limit=1)
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Cyclos_CloudRun` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `cyclos` | Base name for all resources |
| `application_version` | `4.16.17` | Cyclos image tag |
| `min_instance_count` | `1` | Keep one warm instance |
| `max_instance_count` | `1` | Single-instance standalone mode |
| `cpu_limit` | `2000m` | Minimum 2 vCPU for Java |
| `memory_limit` | `4Gi` | Recommended for production |
| `db_name` | `cyclos` | PostgreSQL database name |
| `db_user` | `cyclos` | PostgreSQL user |
| `enable_nfs` | `false` | Uses GCS storage instead |
| `ingress_settings` | `all` | Public HTTPS endpoint |

Click **Deploy** and wait for provisioning to complete (approximately 10–18 minutes).

> **What this provisions:** Cloud Run Gen 2 service, Cloud SQL PostgreSQL 15 with PostGIS and
> pg_trgm extensions, Serverless VPC Access connector, Cloud Storage bucket for file storage,
> Secret Manager secret for DB credentials, Artifact Registry repository, and Cloud Monitoring
> uptime check.

### 4.2 Configure Shell Environment

After deployment completes, set the shell variables from Section 3 and verify:

```bash
# Confirm service is running
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(status.url, status.conditions[0].type)"

# Test connectivity (allow 5 minutes for first-boot schema creation)
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api"
# Expected: 200
```

---

## Exercise 1 — Access Cyclos

### Objective

Retrieve the Cloud Run service URL, verify Cyclos is running, complete the initial configuration
wizard, and explore the admin panel.

### Step 1.1 — Get the Service URL

**gcloud:**
```bash
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(status.url)"

echo "Cyclos UI: ${SERVICE_URL}/cyclos"
```

**REST API:**
```bash
curl -s \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, url: .uri, state: .terminalCondition.state}'
```

**Expected result:** A URL in the format `https://<hash>.run.app` is returned. The `/api` endpoint returns HTTP 200.

### Step 1.2 — Retrieve Admin Credentials

The default Cyclos credentials are `admin` / `1234`. Retrieve the database password from Secret Manager:

```bash
# List deployment secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~cyclos"

# Access the database password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq -r '.payload.data' | base64 -d
```

### Step 1.3 — Log In and Complete Setup Wizard

1. Open `${SERVICE_URL}/cyclos` in your browser.
2. Wait up to 5 minutes for the first-boot schema creation (startup probe allows up to 11m30s).
3. Log in with `admin` / `1234`.
4. Accept the licence agreement.
5. Set the **Network name** and administrator email; change the default password.
6. Configure **Time zone** and **Language**, then click **Finish**.

**Expected result:** The Cyclos admin dashboard loads. The navigation bar shows System, Users, and other sections.

### Step 1.4 — Explore the Admin Panel

1. Click **System** in the top navigation bar.
2. Review: **Network configuration**, **Products & Services**, and **Users** sections.
3. Navigate to **System > Channels** — note the preconfigured Web, Mobile App, POS, REST API, and WebServices channels.

**Expected result:** All five default payment channels are visible and enabled.

### Step 1.5 — Inspect the Cloud Run Service

```bash
# View service details including VPC connector and resource limits
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"

# List service revisions
gcloud run revisions list \
  --service="${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="table(name, status.conditions[0].type, spec.containerConcurrency)"
```

**Expected result:** The service shows one active revision with the startup and liveness probes targeting `/api`, and the VPC connector for private Cloud SQL access.

---

## Exercise 2 — User Management

### Objective

Create test users, assign groups and roles, configure account types, and explore the Cyclos
permission model.

### Step 2.1 — Create Test Users

1. Navigate to **Users > Search users**.
2. Click **New user** and fill in:
   - **Name:** `Test User One`
   - **Username:** `testuser1`
   - **Email:** `testuser1@example.com`
   - Set a temporary password
3. Click **Save**. Repeat to create `testuser2`.

**Expected result:** Both users appear in the user list with active status.

### Step 2.2 — Assign User Groups and Roles

1. Open the profile of `testuser1`.
2. Click the **Groups** tab and assign the default **Members** group.
3. Review the permissions inherited from the group: payment visibility, account access, and channel restrictions.
4. Navigate to **System > User groups** to explore the group hierarchy and permission matrix.

**Expected result:** `testuser1` is a member of the Members group and inherits the default permissions.

### Step 2.3 — Configure Account Types

1. Navigate to **System > Account types**.
2. Click on the **Member account** type.
3. Review: currency, account limits (upper credit / lower credit), and fee configuration.
4. Navigate to **System > Currencies** and review the default currency symbol and enabled channels.

**Expected result:** The Member account type is linked to the default currency with configurable credit limits.

### Step 2.4 — Create Accounts for Test Users

1. Open `testuser1` profile and click the **Accounts** tab.
2. Click **New account**, select **Member account**, set initial credit to `100.00`, and save.
3. Repeat for `testuser2` with initial credit `50.00`.
4. Verify the account balances appear correctly on each user profile.

**Expected result:** Both users have Member accounts with the configured credit balances.

### Step 2.5 — Verify User Configuration via gcloud

```bash
# View Cloud Run environment variables (DB connection, GCS bucket)
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="json" \
  | jq '.spec.template.spec.containers[0].env[] | {name, value}'
```

**Expected result:** Environment variables include `DB_HOST` (Cloud SQL private IP), `DB_NAME`, `DB_USER`, and `cyclos.storedFileContentManager.bucketName`.

---

## Exercise 3 — Payment Channels and Currencies

### Objective

Configure payment channels, explore digital currency setup, and understand the transfer type
and fee model that governs how payments flow between accounts.

### Step 3.1 — Configure the Web Channel

1. Navigate to **System > Channels > Web**.
2. Click **Edit** and review:
   - **Enabled** toggle
   - **Session timeout** (default 30 minutes)
   - **Max concurrent sessions** per user
3. Modify the **Session timeout** to 60 minutes and save.

**Expected result:** The change takes effect immediately without a Cloud Run revision deployment.

### Step 3.2 — Review the REST API Channel

1. Navigate to **System > Channels > REST API**.
2. Note the **API base URL** — this is the endpoint for external integrations.
3. Review the **Access clients** settings for token-based authentication.
4. Note which transfer types are enabled for the REST API channel.

**Expected result:** The REST API channel shows the base URL at `/api` and supports token-based access clients.

### Step 3.3 — Explore Transfer Types

1. Navigate to **System > Transfer types**.
2. Click on a member-to-member payment transfer type.
3. Review:
   - **From** and **To** account types
   - **Channels** where this transfer is available
   - **Fees** tab — any percentage or fixed fees
4. Review the **Limits** tab for maximum and minimum payment amounts.

**Expected result:** The transfer type is available on Web and REST API channels with configurable fee structures.

### Step 3.4 — Create a Digital Currency Configuration

1. Navigate to **System > Currencies > New currency**.
2. Fill in:
   - **Name:** `Lab Token`
   - **Symbol:** `LBT`
   - **Decimal places:** `2`
3. Enable the currency for the **Web** channel.
4. Create a new **Account type** using the `Lab Token` currency.

**Expected result:** The new currency appears in the currency list and can be assigned to new account types.

### Step 3.5 — Inspect GCS Storage Backend

```bash
# List the Cyclos GCS storage bucket
gcloud storage buckets list \
  --project="${PROJECT}" \
  --filter="name~cyclos"

# REST API
curl -s \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=cyclos" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name, location, storageClass}'
```

**Expected result:** A bucket named `<prefix>-cyclos-storage` exists in STANDARD storage class. Cyclos uploads files here via the GCS content manager.

---

## Exercise 4 — Transactions

### Objective

Create payments between users, view transaction history, check account balances, and understand
how Cyclos records financial transfers.

### Step 4.1 — Create a Payment

1. Open `testuser1` profile and click **Make payment**.
2. Set recipient to `testuser2`.
3. Enter amount `25.00` and description `Lab payment`.
4. Click **Submit payment** and confirm.

**Expected result:** The payment is processed and both accounts are updated immediately.

### Step 4.2 — View Transaction History

1. Open `testuser1` profile and click the **Accounts** tab.
2. Click on the Member account.
3. Review the transaction history showing the `25.00` debit.
4. Open `testuser2` profile and verify the `25.00` credit.

**Expected result:** Transaction history shows debit on testuser1 and credit on testuser2 with matching timestamps and descriptions.

### Step 4.3 — Check Account Balances

1. Navigate to **Users > testuser1 > Accounts**.
2. Verify balance is `75.00` (100.00 initial - 25.00 payment).
3. Navigate to **Users > testuser2 > Accounts**.
4. Verify balance is `75.00` (50.00 initial + 25.00 received).

**Expected result:** Both balances reflect the completed transaction correctly.

### Step 4.4 — Review System Account Transactions

1. Navigate to **System > Accounts**.
2. Click on the **System account** to view system-level transactions.
3. Review any initial credit or system fee transactions.

**Expected result:** System account shows any configured initial credits or fee collections.

### Step 4.5 — Perform a Reversal

1. From `testuser1`'s transaction history, click on the `25.00` payment.
2. Click **Reverse transaction** (if available for this transfer type).
3. Confirm the reversal.
4. Verify both account balances return to their original values.

**Expected result:** After reversal, testuser1 balance returns to 100.00 and testuser2 to 50.00.

---

## Exercise 5 — API Access

### Objective

Explore the Cyclos REST API, authenticate using an access token, and make payment API calls
programmatically.

### Step 5.1 — Explore the API Reference Page

1. Navigate to `${SERVICE_URL}/api` in your browser.
2. The Cyclos API reference page lists all available endpoints.
3. Review the authentication section — Cyclos supports Basic Auth, access tokens, and OAuth.

**Expected result:** The API reference page loads showing endpoints for auth, users, accounts, payments, and more.

### Step 5.2 — Authenticate via REST API

```bash
# Get the list of available API authentication methods
curl -s "${SERVICE_URL}/api/auth" \
  -H "Accept: application/json" | jq '.'

# Authenticate with admin credentials (Basic Auth)
curl -s "${SERVICE_URL}/api/auth" \
  -u "admin:your-new-password" \
  -H "Accept: application/json" | jq '{sessionToken: .sessionToken, user: .user.display}'
```

**Expected result:** A session token is returned. Store it for subsequent API calls.

### Step 5.3 — Query User Accounts via API

```bash
# Set session token from previous step
export SESSION_TOKEN="your-session-token"

# List users
curl -s "${SERVICE_URL}/api/users?fields=id,username,display" \
  -H "Session-Token: ${SESSION_TOKEN}" \
  -H "Accept: application/json" | jq '.[]'

# Get account balance for testuser1
USERID=$(curl -s "${SERVICE_URL}/api/users?username=testuser1&fields=id" \
  -H "Session-Token: ${SESSION_TOKEN}" | jq -r '.[0].id')

curl -s "${SERVICE_URL}/api/${USERID}/accounts" \
  -H "Session-Token: ${SESSION_TOKEN}" \
  -H "Accept: application/json" | jq '.[] | {type: .type.name, balance: .status.balance}'
```

**Expected result:** User list and account balances are returned as JSON objects.

### Step 5.4 — Make a Payment via REST API

```bash
# Get testuser2's ID
USER2_ID=$(curl -s "${SERVICE_URL}/api/users?username=testuser2&fields=id" \
  -H "Session-Token: ${SESSION_TOKEN}" | jq -r '.[0].id')

# Make a payment from testuser1 to testuser2
curl -s -X POST "${SERVICE_URL}/api/${USERID}/payments" \
  -H "Session-Token: ${SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"member-to-member\",
    \"amount\": 10.00,
    \"currency\": \"DEFAULT\",
    \"subject\": \"${USER2_ID}\",
    \"description\": \"API test payment\"
  }" | jq '{id: .id, amount: .amount, status: .status}'
```

**Expected result:** Payment is created and returns a transaction ID with `PROCESSED` status.

### Step 5.5 — Inspect API Channel Configuration

```bash
# View Cloud Run revision environment (confirms /api endpoint is enabled)
gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="yaml(spec.template.spec.containers[0])" \
  | grep -A3 "startupProbe"
```

**Expected result:** Startup probe targets `/api`, confirming the REST API reference page is the health indicator used by Cloud Run.

---

## Exercise 6 — Database and Security

### Objective

Inspect the Cloud SQL instance, view Secret Manager bindings, and review IAM permissions for
the Cloud Run service account.

### Step 6.1 — Inspect the Cloud SQL Instance

**gcloud:**
```bash
# List Cloud SQL instances
gcloud sql instances list --project="${PROJECT}"

# Get instance details
INSTANCE=$(gcloud sql instances list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --filter="name~cyclos" \
  --limit=1)

gcloud sql instances describe "${INSTANCE}" --project="${PROJECT}" \
  --format="table(name, databaseVersion, settings.tier, ipAddresses[0].ipAddress)"
```

**REST API:**
```bash
curl -s \
  "https://sqladmin.googleapis.com/sql/v1beta4/projects/${PROJECT}/instances" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.items[] | {name, version: .databaseVersion, state}'
```

**Expected result:** A PostgreSQL 15 instance is listed with a private IP address only (no public IP).

### Step 6.2 — Verify PostgreSQL Extensions

```bash
# List databases on the instance
gcloud sql databases list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}"

# List database users
gcloud sql users list \
  --instance="${INSTANCE}" \
  --project="${PROJECT}"
```

**Expected result:** Database `cyclos` and user `cyclos` are present. The db-init job installed pg_trgm, uuid-ossp, postgis, earthdistance, cube, and unaccent extensions.

### Step 6.3 — Inspect Secret Manager

```bash
# List all Cyclos-related secrets
gcloud secrets list \
  --project="${PROJECT}" \
  --filter="name~cyclos"

# View secret metadata (not the value)
gcloud secrets describe "${DB_SECRET}" --project="${PROJECT}"

# View secret IAM binding (who can access it)
gcloud secrets get-iam-policy "${DB_SECRET}" \
  --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '{name: .name, replication: .replication, createTime: .createTime}'
```

**Expected result:** The secret uses automatic replication. The Cloud Run service account has `secretmanager.secretAccessor` binding.

### Step 6.4 — Review IAM Bindings

```bash
# List service accounts
gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~cyclos"

# Get the Cloud Run service account
CR_SA=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format="value(spec.template.spec.serviceAccountName)")

echo "Cloud Run SA: ${CR_SA}"

# View IAM bindings for the project
gcloud projects get-iam-policy "${PROJECT}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${CR_SA}" \
  --format="table(bindings.role)"
```

**Expected result:** The Cloud Run service account has `cloudsql.client`, `secretmanager.secretAccessor`, and `storage.objectAdmin` roles.

---

## Exercise 7 — Cloud Logging

### Objective

Query Cyclos application logs, filter Tomcat startup messages, identify errors, and stream
live logs using gcloud.

### Step 7.1 — View Cyclos Logs in Log Explorer

Navigate to **Cloud Console > Logging > Log Explorer** and use this filter:

```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
resource.labels.location="${REGION}"
```

**Expected result:** Tomcat startup messages, Cyclos initialization output, and HTTP request logs appear.

### Step 7.2 — Filter Application Logs via gcloud

**gcloud:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'"' \
  --project="${PROJECT}" \
  --freshness=1h \
  --limit=50 \
  --format="table(timestamp,severity,textPayload)"
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectIds\": [\"${PROJECT}\"],
    \"filter\": \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp: .timestamp, text: .textPayload}'
```

**Expected result:** Tomcat/Cyclos log entries appear including database connection pool messages confirming PostgreSQL connectivity.

### Step 7.3 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND severity>=ERROR' \
  --project="${PROJECT}" \
  --freshness=24h \
  --format="table(timestamp,severity,textPayload)"
```

**Expected result:** Under normal operation, no errors should appear. Any startup probe retry messages may appear as warnings during initial deployment.

### Step 7.4 — Stream Live Logs

```bash
gcloud run services logs tail "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}"
```

**Expected result:** Live log stream appears. Making requests to the Cyclos UI generates access log entries visible in real time.

### Step 7.5 — View Startup Probe History

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'"${SERVICE}"'" AND textPayload=~"startup|probe|health"' \
  --project="${PROJECT}" \
  --freshness=24h \
  --limit=10 \
  --format="table(timestamp,textPayload)"
```

**Expected result:** Startup probe success messages appear from the time of initial deployment.

---

## Exercise 8 — Cloud Monitoring

### Objective

Explore Cloud Run metrics, review the uptime check configured by the module, inspect alert
policies, and query metrics via the REST API.

### Step 8.1 — View Cloud Run Metrics in Console

Navigate to **Cloud Console > Cloud Run > Services > cyclos** and review the built-in metric tabs:

| Metric Tab | Key Metrics |
|---|---|
| **Requests** | Request count, latency P50/P95/P99 |
| **Container** | CPU utilisation, memory utilisation |
| **Instances** | Active instance count over time |

**Expected result:** At least one active instance (since `min_instance_count = 1`). Memory usage reflects JVM heap allocation (typically 1–2 Gi for Cyclos).

### Step 8.2 — Review the Uptime Check

```bash
# List uptime checks
gcloud monitoring uptime list-configs --project="${PROJECT}"
```

**REST API:**
```bash
curl -s \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  | jq '.uptimeCheckConfigs[] | {name: .displayName, path: .httpCheck.path, period: .period}'
```

**Expected result:** An uptime check targeting the Cyclos service root path (`/`) runs every 60 seconds from multiple global locations.

### Step 8.3 — Explore Metrics Explorer

1. Navigate to **Cloud Console > Monitoring > Metrics Explorer**.
2. Select resource type **Cloud Run Revision**.
3. Plot these metrics for the Cyclos service:
   - `run.googleapis.com/request_count`
   - `run.googleapis.com/request_latencies`
   - `run.googleapis.com/container/instance_count`

**gcloud:**
```bash
gcloud monitoring metrics list \
  --filter="metric.type:run.googleapis.com" \
  --project="${PROJECT}" \
  | grep -E "request_count|request_latencies|instance_count"
```

**Expected result:** Request metrics accumulate as you interact with the Cyclos UI. Instance count stays at 1 (due to `min_instance_count = 1`).

### Step 8.4 — Query Request Count via REST API

```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch cloud_run_revision::run.googleapis.com/request_count | filter resource.service_name = '${SERVICE}' | within 1h | group_by [], sum(val())\"
  }" | jq '.timeSeriesData[].pointData[-1].values'
```

**Expected result:** Total request count for the past hour is returned as a numeric value.

### Step 8.5 — Review Alert Policies

```bash
# List alert policies
gcloud alpha monitoring policies list --project="${PROJECT}"
```

Navigate to **Cloud Console > Monitoring > Alerting** to view any alert policies created by
the module for the Cyclos uptime check.

**Expected result:** Alert policies are configured to notify `support_users` when the uptime check fails or latency exceeds thresholds.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Cyclos_CloudRun` deployment. This removes
the Cloud Run service, Cloud SQL instance, GCS bucket, Secret Manager secrets, VPC connector,
and all IAM bindings.

> **Note:** Cloud SQL deletion takes 3–5 minutes. GCP may hold serverless VPC addresses for
> 20–30 minutes after the Cloud Run service is deleted — if subnet deletion fails, wait and
> re-run the undeploy.

### Manual Cleanup (if needed)

**gcloud:**
```bash
# Delete the Cloud Run service
gcloud run services delete "${SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" --quiet

# Delete the Cloud SQL instance
gcloud sql instances delete "${INSTANCE}" \
  --project="${PROJECT}" --quiet

# Delete Secret Manager secrets
gcloud secrets delete "${DB_SECRET}" \
  --project="${PROJECT}" --quiet
```

**REST API — delete Cloud Run service:**
```bash
curl -s -X DELETE \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)"
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `cyclos` | Base name for Cloud Run service and resources |
| `application_version` | string | `4.16.17` | Cyclos Docker image tag |
| `min_instance_count` | number | `1` | Minimum Cloud Run instances (1 = always warm) |
| `max_instance_count` | number | `1` | Maximum instances (single-instance standalone) |
| `cpu_limit` | string | `1000m` | Container CPU limit (2000m recommended) |
| `memory_limit` | string | `2Gi` | Container memory limit (4Gi recommended) |
| `db_name` | string | `cyclos` | PostgreSQL database name |
| `db_user` | string | `cyclos` | PostgreSQL application user |
| `database_password_length` | number | `32` | Generated password length |
| `enable_nfs` | bool | `false` | NFS disabled; GCS used for file storage |
| `enable_cloudsql_volume` | bool | `false` | TCP connection to Cloud SQL private IP |
| `ingress_settings` | string | `all` | Traffic ingress: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | string | `PRIVATE_RANGES_ONLY` | VPC egress routing |
| `backup_schedule` | string | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | number | `7` | Days to retain backup files in GCS |
| `deploy_application` | bool | `true` | Set `false` to provision infra only |

### Useful Commands

```bash
# Get service URL
gcloud run services describe ${SERVICE} --region=${REGION} --project=${PROJECT} --format="value(status.url)"

# View service environment variables
gcloud run services describe ${SERVICE} --region=${REGION} --format="json" | jq '.spec.template.spec.containers[0].env[]'

# List Cloud SQL instances
gcloud sql instances list --project=${PROJECT} --filter="name~cyclos"

# Access database password secret
gcloud secrets versions access latest --secret=${DB_SECRET} --project=${PROJECT}

# Tail Cloud Run logs
gcloud run services logs tail ${SERVICE} --region=${REGION} --project=${PROJECT}

# List Cloud Run revisions
gcloud run revisions list --service=${SERVICE} --region=${REGION} --project=${PROJECT}

# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# List GCS buckets
gcloud storage buckets list --project=${PROJECT} --filter="name~cyclos"

# View IAM bindings
gcloud projects get-iam-policy ${PROJECT} --format="table(bindings.role,bindings.members)"
```

### Further Reading

- [Cyclos official documentation](https://www.cyclos.org/documentation/)
- [Cyclos REST API reference](https://demo.cyclos.org/api)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)
- [Secret Manager overview](https://cloud.google.com/secret-manager/docs)
- [Cloud Monitoring for Cloud Run](https://cloud.google.com/run/docs/monitoring)
- [Serverless VPC Access](https://cloud.google.com/vpc/docs/configure-serverless-vpc-access)
