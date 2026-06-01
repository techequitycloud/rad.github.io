---
title: "Cyclos on Cloud Run — Lab Guide"
sidebar_label: "Cyclos CloudRun Lab"
---

# Cyclos on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cyclos_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

Cyclos is a comprehensive digital banking platform for managing custom currencies, community banking, savings, loans, payment channels, and digital wallets. This lab deploys Cyclos Community Edition on Cloud Run Gen 2, backed by Cloud SQL PostgreSQL 15 with automated PostgreSQL extension installation (PostGIS, pg_trgm), serverless auto-scaling, and Serverless VPC Access for private database connectivity.

### What the Module Automates

- Cloud Run Gen 2 service with startup and liveness probes
- Cloud SQL PostgreSQL 15 instance provisioning with private IP
- Database user, password, and schema initialization via Cloud Run Job
- Artifact Registry repository and container image mirroring from Docker Hub
- Secret Manager secrets for database credentials (with 30-day rotation notifications)
- Serverless VPC Access connector for private VPC egress
- Cloud Storage bucket for application data
- Cloud Monitoring uptime check and notification channels
- Optional NFS Filestore mount (disabled by default; Cyclos uses GCS)
- SMTP environment variable scaffolding (configurable)

### What You Do Manually

- Note the service URL and other deployment outputs from the RAD UI deployment panel
- Log in to Cyclos and complete the initial configuration wizard
- Configure payment channels, currencies, and account types
- Create test users and perform sample transactions
- Explore Cloud Logging and Cloud Monitoring dashboards

---

## CLI and REST API Overview

This lab uses `gcloud` CLI to inspect deployed Cloud Run and Cloud SQL resources. The equivalent REST API calls are shown where relevant.

**Get the Cloud Run service URL:**
```bash
# gcloud
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(status.url)"

# REST
GET https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/services/SERVICE_NAME
```

**Get a secret value:**
```bash
# gcloud
gcloud secrets versions access latest --secret=SECRET_NAME --project=PROJECT_ID

# REST
GET https://secretmanager.googleapis.com/v1/projects/PROJECT_ID/secrets/SECRET_NAME/versions/latest:access
```

**List Cloud Run revisions:**
```bash
# gcloud
gcloud run revisions list --service=SERVICE_NAME --region=REGION --project=PROJECT_ID

# REST
GET https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/services/SERVICE_NAME/revisions
```

**Trigger a manual job execution:**
```bash
# gcloud
gcloud run jobs execute JOB_NAME --region=REGION --project=PROJECT_ID

# REST
POST https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/jobs/JOB_NAME:run
```

---

## Prerequisites

Before beginning this lab, ensure the following are in place:

1. **Services GCP module deployed** — Cyclos_CloudRun depends on `Services_GCP` for the VPC network, Cloud SQL instance, and Artifact Registry. The `module_dependency` variable confirms this: `["Services_GCP"]`.
2. **GCP project with billing enabled.**
3. **`gcloud` CLI installed and authenticated** (`gcloud auth login && gcloud auth application-default login`).
4. **Sufficient IAM permissions** — Owner or equivalent role on the target project.
5. **Access to the RAD UI** with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

Deployment is initiated from the RAD UI. Configure the following variables in the deployment form and click **Deploy**.

**Key variables to configure before deploying:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (6–30 chars, lowercase) |
| `deployment_id` | No | auto | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `cyclos` | Base name for the Cloud Run service and secrets |
| `application_version` | No | `4.16.17` | Cyclos image version tag |
| `deploy_application` | No | `true` | Set `false` to provision infra without deploying |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (1 avoids cold starts) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances |
| `cpu_limit` | No | `1000m` | Container CPU limit (min 2 vCPU recommended) |
| `memory_limit` | No | `2Gi` | Container memory limit (min 2Gi; 4Gi recommended) |
| `db_name` | No | `cyclos` | PostgreSQL database name |
| `db_user` | No | `cyclos` | PostgreSQL database username |
| `database_password_length` | No | `32` | Generated password length (16–64) |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |
| `enable_nfs` | No | `false` | Enable NFS mount (Cyclos uses GCS by default) |
| `ingress_settings` | No | `all` | Traffic ingress: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing for private connectivity |

**What the module creates:**
- Cloud Run Gen 2 service with startup probe (HTTP `/api`, 90s initial delay, failure_threshold=10) and liveness probe (HTTP `/api`, 120s initial delay)
- Cloud SQL PostgreSQL 15 database `cyclos` with user `cyclos` (password in Secret Manager)
- A Cloud Run Job that initializes the database schema and installs PostgreSQL extensions
- Serverless VPC Access connector for private Cloud SQL connectivity
- GCS bucket (`<prefix>-data`) for application data
- Cloud Monitoring uptime check against `/`
- SMTP environment variable scaffolding (pre-populated with empty defaults)

**Approximate provisioning duration:**

| Resource | Estimated Time |
|---|---|
| Cloud SQL PostgreSQL 15 instance | 5–8 min |
| Container image build (Cloud Build) | 3–5 min |
| Cloud Run service deployment | 2–4 min |
| Secret Manager secrets | < 1 min |
| **Total** | **~10–18 min** |

**Key outputs** — after deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `database_instance_name` | Cloud SQL instance name |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps using gcloud discovery:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~cyclos" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~cyclos" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

Retrieve the Cloud Run service URL and confirm the application is reachable.

**Step 1 — Confirm the service is serving traffic:**
```bash
# Check the /api endpoint (Cyclos health indicator)
curl -I "${SERVICE_URL}/api"
# Expected: HTTP/2 200

# REST equivalent via gcloud
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="table(status.url, status.conditions)"
```

**Step 2 — Review the Cloud Run service details:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

The Cyclos UI is accessible at `${SERVICE_URL}/cyclos`. Allow 2–5 minutes after the first deploy for the startup probe to pass (Cyclos creates the database schema on first boot, which the startup probe is configured to accommodate with a 10-failure threshold at 60s intervals — up to 11m30s total).

---

## Phase 3 — Initial Cyclos Configuration [MANUAL]

Complete the one-time Cyclos setup wizard and explore the admin panel.

**Step 1 — Retrieve admin credentials from Secret Manager:**
```bash
# List secrets managed by this deployment
gcloud secrets list --filter="name~cyclos" --project=${PROJECT}

# Access the database password secret
gcloud secrets versions access latest \
  --secret=${DB_SECRET} \
  --project=${PROJECT}

# REST equivalent
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access"
```

The default Cyclos admin credentials after first boot are `admin` / `1234`. You should change this password immediately after logging in.

**Step 2 — Navigate to the Cyclos UI:**
1. Open `${SERVICE_URL}/cyclos` in your browser.
2. Wait for the startup probe to succeed if the page is not yet reachable (allow up to 5 minutes on first boot).
3. Log in with `admin` / `1234`.

**Step 3 — Complete the initial configuration wizard:**
1. Accept the licence agreement when prompted.
2. Set the **Network name** and **Network description** for your Cyclos instance.
3. Configure the administrator email address and change the default password.
4. Select your **Time zone** and **Language** settings.
5. Click **Finish** to complete the wizard.

**Step 4 — Explore the admin panel structure:**
1. Navigate to **System** in the top navigation bar.
2. Review the following sections:
   - **Network configuration** — global settings, themes, and branding
   - **Products & Services** — account types, currencies, and fee structures
   - **Users** — user management, groups, and access controls

---

## Phase 4 — Configure Payment Channels [MANUAL]

Cyclos supports multiple payment channels (web, mobile, POS, REST API). This phase walks through reviewing and configuring them.

**Step 1 — Navigate to System > Channels:**
1. Go to **System** > **Channels** in the left sidebar.
2. Review the list of preconfigured channels: Web, Mobile App, POS, REST API, WebServices.

**Step 2 — Explore channel configuration settings:**
1. Click on the **Web** channel.
2. Review the following settings:
   - **Enabled** — whether the channel is active
   - **Allowed payment types** — which transfer types can be performed via this channel
   - **Session timeout** — inactivity expiry for web sessions
   - **Max concurrent sessions** — concurrent session limit per user

**Step 3 — Review the REST API channel:**
1. Click on the **REST API** channel.
2. Note the API base URL — this is the endpoint external applications will call.
3. Review the **Access clients** settings for token-based API authentication.

**Step 4 — Create a test payment channel configuration:**
1. Click **Edit** on the Web channel.
2. Modify the **Session timeout** to a value of your choice (e.g., 60 minutes).
3. Click **Save**.
4. Observe that the change is reflected immediately without requiring a Cloud Run revision deployment.

---

## Phase 5 — User Management and Accounts [MANUAL]

Create a test user, assign a currency account, and perform a sample payment.

**Step 1 — Create a test user:**
1. Navigate to **Users** > **Search users**.
2. Click **New user**.
3. Fill in the required fields:
   - **Name:** Test User One
   - **Username:** testuser1
   - **Email:** testuser1@example.com
   - **Password:** set a temporary password
4. Click **Save**.
5. Repeat to create a second user: `testuser2`.

**Step 2 — Create a user account and assign a currency:**
1. Open the profile of `testuser1`.
2. Navigate to the **Accounts** tab.
3. Click **New account**.
4. Select an **Account type** (e.g., Member account).
5. Set the initial credit balance to `100.00` of the default currency.
6. Click **Save**.

**Step 3 — Perform a test payment between users:**
1. From the `testuser1` profile, click **Make payment**.
2. Set the recipient to `testuser2`.
3. Enter an amount (e.g., `25.00`).
4. Add a description: "Test payment".
5. Click **Submit payment**.
6. Confirm the payment in the confirmation dialog.

**Step 4 — View transaction history:**
1. Navigate to **Users** > **testuser1** > **Accounts**.
2. Click on the account to see the transaction history.
3. Verify the debit of `25.00` appears correctly.
4. Navigate to `testuser2`'s account to verify the corresponding credit.

---

## Phase 6 — Currency and Product Configuration [MANUAL]

Explore the financial product configuration to understand how Cyclos models currencies, fees, and account types.

**Step 1 — Navigate to Products & Plans:**
1. Go to **System** > **Account types**.
2. Review the existing account types (Member Account, System Account).
3. Note the currency assigned to each account type.

**Step 2 — Review default currency setup:**
1. Go to **System** > **Currencies**.
2. Click on the default currency.
3. Review:
   - **Symbol** and **Decimal places**
   - **Enabled channels** for this currency

**Step 3 — Explore transfer types and fee configurations:**
1. Go to **System** > **Transfer types**.
2. Click on a transfer type (e.g., member-to-member payment).
3. Review:
   - **From** and **To** account types
   - **Channels** where this transfer type is available
   - **Fees** tab — review any configured transaction fees

**Step 4 — Explore account limits:**
1. Go to **System** > **Account types** > click an account type.
2. Review the **Limits** tab:
   - **Upper credit limit** — maximum positive balance
   - **Lower credit limit** — maximum overdraft (negative balance)
   - **Custom limits** — per-user overrides

---

## Phase 7 — Explore Cloud Logging [MANUAL]

Cyclos runs on Apache Tomcat inside the Cloud Run container. Review the application logs in Cloud Logging.

**Step 1 — Access Cloud Logging via the console:**
1. Open the Google Cloud Console at [console.cloud.google.com](https://console.cloud.google.com).
2. Navigate to **Logging** > **Log Explorer**.
3. Set the project to your deployment project.

**Step 2 — Filter Cyclos Cloud Run logs:**

Use the following filter in the Log Explorer query field:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

**Step 3 — Review log entries:**
1. Observe Tomcat startup messages and Cyclos initialization output.
2. Filter for `severity=ERROR` to check for any application errors:
   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   severity>=ERROR
   ```
3. Look for database connection pool messages confirming PostgreSQL connectivity.

**Step 4 — Stream logs via gcloud:**
```bash
# Tail live logs from the Cloud Run service
gcloud run services logs tail ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}

# Historical logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --freshness=1h \
  --format="table(timestamp,severity,textPayload)"
```

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

Review the Cloud Monitoring metrics and uptime check configured by the module.

**Step 1 — Access Cloud Run metrics:**
1. Navigate to **Cloud Run** > **Services** in the Cloud Console.
2. Click on the Cyclos service.
3. Review the built-in metrics tabs:
   - **Requests** — request count and latency distribution
   - **Container** — CPU and memory utilisation
   - **Instances** — active instance count over time

**Step 2 — Review the uptime check:**
1. Navigate to **Monitoring** > **Uptime checks**.
2. Find the uptime check created by the module (named after the deployment).
3. Review the check configuration: path `/`, interval 60s, timeout 10s.
4. Observe the global check status — green indicates the service is reachable from all probe locations.

**Step 3 — Explore Metrics Explorer:**
1. Navigate to **Monitoring** > **Metrics Explorer**.
2. Select resource type **Cloud Run Revision**.
3. Plot the following metrics:
   - `run.googleapis.com/request_count` — requests per second
   - `run.googleapis.com/request_latencies` — response time percentiles
   - `run.googleapis.com/container/instance_count` — active instances

**Step 4 — Review alert policies:**
1. Navigate to **Monitoring** > **Alerting**.
2. Review any alert policies configured by the module.
3. Note the notification channels (email addresses from `support_users`).

**Step 5 — Query metrics via gcloud:**
```bash
# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# REST
GET https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs
```

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

The module removes all resources in reverse dependency order: Cloud Run service and jobs, Cloud SQL instance, GCS buckets, Secret Manager secrets, VPC connector, and IAM bindings.

> Note: `enable_purge = true` (default) allows full deletion. If set to `false`, resources are retained after undeployment.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | AUTOMATED | RAD UI deployment provisions Cloud Run, Cloud SQL, GCS, IAM, monitoring |
| Phase 2 — Service URL | MANUAL | Retrieve and verify Cloud Run service URL |
| Phase 3 — Initial Config | MANUAL | Log into Cyclos, complete setup wizard, change admin password |
| Phase 4 — Payment Channels | MANUAL | Review and configure web/mobile/POS/API channels |
| Phase 5 — Users & Accounts | MANUAL | Create users, assign accounts, perform test payment |
| Phase 6 — Currency & Products | MANUAL | Explore account types, currencies, transfer types, fees |
| Phase 7 — Cloud Logging | MANUAL | View Tomcat logs for Cloud Run service |
| Phase 8 — Cloud Monitoring | MANUAL | Review Cloud Run metrics, uptime check, alert policies |
| Phase 9 — Undeploy | AUTOMATED | RAD UI Undeploy removes all resources |
