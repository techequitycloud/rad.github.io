# Zammad on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Zammad_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Zammad is an open-source helpdesk and customer support ticketing platform. It provides multi-channel ticket management (email, phone, web, chat), SLA tracking, agent groups, a knowledge base, and rich reporting. This lab deploys Zammad 6.x on Google Cloud Run backed by Cloud SQL PostgreSQL 15, Cloud Filestore NFS for attachment storage, and Redis caching. Cloud Run provides serverless auto-scaling.

### What the Module Automates

- Cloud Run v2 service with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user (via `db-init` Cloud Run Job)
- Cloud Filestore (NFS) instance mounted at `/opt/zammad/storage`
- GCS `zammad-attachments` bucket
- Custom container image built by Cloud Build (extends `zammad/zammad` with GCP entrypoint)
- Artifact Registry repository with Docker Hub mirror
- Secret Manager secrets (DB password, root password)
- Serverless VPC Access for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime check at `/api/v1/ping`
- Automated backup Cloud Run Job

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Complete the Zammad first-run setup wizard
- Create agents, groups, and roles
- Configure email channels (inbound and outbound SMTP)
- Create and manage tickets
- Set up SLA policies
- Review Cloud Logging and Cloud Monitoring

---

## CLI Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |
| `curl` | Test the Zammad API and health endpoint |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, Cloud SQL, NFS server, and Redis).
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

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g., `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"zammad"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"6.4.1"` | Zammad container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (keep at 1 to avoid cold starts) |
| `max_instance_count` | No | `5` | Maximum Cloud Run instances |
| `cpu_limit` | No | `"2000m"` | CPU per Cloud Run instance (minimum 2 vCPU) |
| `memory_limit` | No | `"4Gi"` | Memory per Cloud Run instance (minimum 2 Gi) |
| `db_name` | No | `"zammad"` | PostgreSQL database name |
| `db_user` | No | `"zammad"` | PostgreSQL database username |
| `enable_redis` | No | `true` | Enable Redis (required for Zammad) |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP when empty) |
| `redis_port` | No | `"6379"` | Redis port |
| `enable_nfs` | No | `true` | Mount NFS for Zammad attachment storage |
| `nfs_mount_path` | No | `"/opt/zammad/storage"` | NFS mount path inside the container |
| `ingress_settings` | No | `"all"` | `"all"` (public), `"internal"`, or `"internal-and-cloud-load-balancing"` |
| `vpc_egress_setting` | No | `"PRIVATE_RANGES_ONLY"` | Use `"ALL_TRAFFIC"` for Memorystore Redis |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| NFS provisioning and mount validation | 3–5 min |
| `db-init` Cloud Run Job | 2–3 min |
| Cloud Run service deployment | 3–5 min |
| Zammad DB migrations (first startup) | 2–5 min |
| **Total** | **23–40 min** |

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Zammad Cloud Run service |
| `service_name` | Cloud Run service name |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~zammad" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

echo "Zammad URL: ${SERVICE_URL}"
```

---

## Phase 2 — Verify the Deployment [MANUAL]

### Step 2.1 — Check the Health Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/v1/ping
```

**Expected result:** HTTP `200`. If you see `503`, Zammad may still be completing its database migrations — wait 60 seconds and retry.

**gcloud logs equivalent:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=30 \
  --format="table(timestamp, textPayload)"
```

Look for the line `Zammad is running` in the logs, which confirms the railsserver started successfully.

### Step 2.2 — Inspect the Cloud Run Service

```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** Service status shows `Ready` with the container image, resource limits (`2 CPU / 4 Gi`), and VPC connector details.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${SERVICE}"
```

### Step 2.3 — View the Zammad Ping Response

```bash
curl -s ${SERVICE_URL}/api/v1/ping | python3 -m json.tool
```

**Expected result:**
```json
{
  "pong": "PONG"
}
```

---

## Phase 3 — First-Run Setup [MANUAL]

### Step 3.1 — Access the Setup Wizard

Open a browser and navigate to:

```
${SERVICE_URL}
```

Zammad displays a first-run wizard on the initial visit.

**Expected result:** A setup wizard appears with steps for system configuration, email settings, and admin account creation.

### Step 3.2 — Complete the Setup Wizard

The wizard has several steps:

1. **Language and timezone** — Select your preferred language and timezone.
2. **Email notification settings** — Configure the outbound email address Zammad uses for system notifications. You can skip this and configure SMTP later.
3. **Admin account** — Enter your administrator name, email, and password. Store these credentials securely.
4. **Organisation name** — Enter your company/organisation name.

Click through each step and click **Next** to advance.

**Expected result:** After completing the wizard, you are redirected to the Zammad admin dashboard.

### Step 3.3 — Verify Admin Access

Navigate to `${SERVICE_URL}/#/dashboard` to confirm you are logged in as the administrator.

**Expected result:** The Zammad dashboard shows zero open tickets and the admin navigation menu.

---

## Phase 4 — Configure Email Channels [MANUAL]

Zammad is a multi-channel helpdesk. Email is the primary channel. This phase sets up inbound and outbound email.

### Step 4.1 — Configure Outbound Email (SMTP)

1. In the Zammad admin panel, navigate to **Admin → Channels → Email**.
2. Click **Add Channel** and select **Email**.
3. Under **Outgoing** (SMTP), enter your SMTP server details:
   - **Host:** e.g., `smtp.sendgrid.net`
   - **Port:** `587` (TLS) or `465` (SSL)
   - **Username/Password:** your SMTP credentials
   - **From address:** e.g., `helpdesk@example.com`
4. Click **Test Outbound Email** to verify connectivity.

**Alternative — inject via environment variables before deployment:**

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  EMAIL_FROM = "helpdesk@example.com"
}
```

### Step 4.2 — Configure Inbound Email (IMAP/POP3)

1. In **Admin → Channels → Email**, under **Incoming**, click **Add Account**.
2. Choose **IMAP** or **POP3** and enter your email server details.
3. Zammad will poll this mailbox and convert incoming messages into tickets.
4. Click **Test Incoming Email** to verify.

**Expected result:** A test email sent to the configured address appears as a new ticket in the **Tickets → Unassigned** queue.

### Step 4.3 — Verify Email Flow via API

```bash
# Check configured email channels
curl -s \
  -u "admin@example.com:your-password" \
  "${SERVICE_URL}/api/v1/channels" \
  | python3 -m json.tool
```

**REST API — list channels (authenticated):**
```bash
curl -H "Authorization: Token token=YOUR_API_TOKEN" \
  "${SERVICE_URL}/api/v1/channels"
```

To generate an API token: **Admin → Integrations → API** → create a token.

---

## Phase 5 — Agent and Group Setup [MANUAL]

### Step 5.1 — Create Agent Groups

Groups in Zammad represent support teams (e.g., "IT Support", "Billing", "Customer Success"). Tickets are assigned to groups.

1. Navigate to **Admin → Groups**.
2. Click **New Group**.
3. Enter a **Name** (e.g., "IT Support") and optional **Email** address for the group.
4. Configure **Signature** and **Note** fields.
5. Click **Create**.

**gcloud — verify the Cloud Run service is running and healthy:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="value(status.conditions[0].type, status.conditions[0].status)"
```

**Expected result:** `Ready True`

### Step 5.2 — Create Agent Accounts

1. Navigate to **Admin → Users** → **New User**.
2. Enter the agent's name, email, and password.
3. Set **Role** to `Agent`.
4. Assign the agent to a **Group** created in Step 5.1.
5. Click **Create**.

**REST API — create a user:**
```bash
curl -s -X POST \
  -H "Authorization: Token token=YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  "${SERVICE_URL}/api/v1/users" \
  -d '{
    "firstname": "Alice",
    "lastname": "Support",
    "email": "alice@example.com",
    "password": "SecurePassword123!",
    "roles": ["Agent"]
  }' | python3 -m json.tool
```

**Expected result:** The agent account is created and appears in **Admin → Users**.

### Step 5.3 — Configure Roles and Permissions

1. Navigate to **Admin → Roles**.
2. Review the built-in roles: `Admin`, `Agent`, `Customer`.
3. Create a custom role if needed: click **New Role**, select the permissions, and assign it to users.

---

## Phase 6 — Create and Manage Tickets [MANUAL]

### Step 6.1 — Create a Test Ticket via the UI

1. Navigate to **New Ticket** (the pencil icon in the top-left).
2. Select **Inbound Call** or **Email** as the ticket type.
3. Search for or create a customer.
4. Fill in the **Subject**, **Body**, and **Group**.
5. Click **Create**.

**Expected result:** The ticket appears in the **Tickets → Open** queue.

### Step 6.2 — Create a Ticket via API

```bash
curl -s -X POST \
  -H "Authorization: Token token=YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  "${SERVICE_URL}/api/v1/tickets" \
  -d '{
    "title": "Test ticket from API",
    "group": "Users",
    "customer": "customer@example.com",
    "article": {
      "subject": "Test",
      "body": "This is a test ticket created via the Zammad API.",
      "type": "note",
      "internal": false
    }
  }' | python3 -m json.tool
```

**Expected result:** A JSON object with the new ticket `id`, `number`, and `state`.

### Step 6.3 — List Open Tickets via API

```bash
curl -s \
  -H "Authorization: Token token=YOUR_API_TOKEN" \
  "${SERVICE_URL}/api/v1/tickets?state=open" \
  | python3 -m json.tool
```

**Expected result:** A JSON array containing all open tickets including the test ticket created in Step 6.2.

### Step 6.4 — Assign and Close a Ticket

1. Open the test ticket in the Zammad UI.
2. In the right sidebar, assign an **Owner** (an agent from Step 5.2).
3. Change **State** to `Pending close` then `Closed`.
4. Click **Update**.

**Expected result:** The ticket state changes to `Closed` and it moves to the closed queue.

---

## Phase 7 — SLA Configuration [MANUAL]

### Step 7.1 — Create an SLA Policy

1. Navigate to **Admin → SLA**.
2. Click **New SLA**.
3. Configure:
   - **Name:** e.g., "Standard SLA"
   - **First response time:** e.g., 4 hours
   - **Update time:** e.g., 8 hours
   - **Solution time:** e.g., 48 hours
4. Under **Calendars**, assign a business hours calendar.
5. Click **Create**.

**Expected result:** The SLA policy appears in the list and is applied to tickets matching the defined conditions.

### Step 7.2 — Verify SLA on a Ticket

1. Open any open ticket.
2. In the right sidebar, confirm the **SLA** section shows the first response deadline.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

### Step 8.1 — View Zammad Application Logs

Navigate to **Logging → Logs Explorer** in the Cloud Console, or use the CLI:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -s -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"'"${SERVICE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Logs show Zammad startup, the `zammad-init` migration step, and the `Zammad is running` banner confirming the service started.

### Step 8.2 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** No critical errors under normal operation. Warnings may appear if the NFS volume took longer than expected to mount on first startup.

### Step 8.3 — View db-init Job Logs

```bash
# Discover the db-init Cloud Run Job name
export DBJOB=$(gcloud run jobs list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --filter="metadata.name~db-init" \
  --limit=1)

# View job execution logs
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="'${DBJOB}'"' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

**Expected result:** Logs showing the PostgreSQL user and database creation steps, followed by a successful exit.

---

## Phase 9 — Cloud Run Features [MANUAL]

### Step 9.1 — Examine Cloud Run Revisions

```bash
gcloud run revisions list \
  --service=${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Expected result:** A list of revisions with traffic percentages. The latest revision serves 100% of traffic.

### Step 9.2 — Check Scaling Behaviour

```bash
# Send several requests
for i in $(seq 1 15); do
  curl -s -o /dev/null ${SERVICE_URL}/api/v1/ping
done

# Check instance count metric
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/instance_count" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT}
```

**Expected result:** Cloud Run scales up to handle concurrent requests. With `min_instance_count = 1`, at least one instance remains running at all times.

### Step 9.3 — Review Uptime Check

Navigate to **Monitoring → Uptime checks** in the Cloud Console.

**Expected result:** The Zammad uptime check at `/api/v1/ping` shows **Passing** from multiple global locations.

### Step 9.4 — Retrieve Database Password

```bash
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~zammad" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access" \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); print(base64.b64decode(d['payload']['data']).decode())"
```

**Expected result:** The auto-generated database password is returned. This is stored in Secret Manager and injected into the container at runtime — it is never written to Terraform state.

---

## Phase 10 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

**Approximate undeploy duration:** 15–25 minutes (Cloud SQL deletion takes the longest).

> **Warning:** This permanently deletes all resources including the PostgreSQL database, NFS attachment storage, and all Zammad tickets. Export data before undeploying: use the Zammad API or the PostgreSQL `pg_dump` tool.

Resources provisioned by `Services_GCP` (VPC, Cloud SQL instance, GKE cluster, NFS server) are managed separately and must be undeployed via their own RAD UI deployment entry.

### Known Deletion Issue: Serverless IPv4 Address Release

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

Wait 20–30 minutes and re-run `tofu destroy`. GCP releases the reserved addresses asynchronously.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Cloud Run service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| `db-init` Cloud Run Job (user + schema) | 1 | Yes |
| Cloud Filestore NFS mount | 1 | Yes |
| GCS `zammad-attachments` bucket | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Note service URL from RAD UI | 2 | No |
| Health check via `/api/v1/ping` | 2 | No |
| First-run setup wizard | 3 | No |
| Configure email channels | 4 | No |
| Create agents and groups | 5 | No |
| Create and manage tickets | 6 | No |
| Configure SLA policies | 7 | No |
| Review Cloud Logging | 8 | No |
| Examine revisions and scaling | 9 | No |
| Review uptime checks | 9 | No |
| Undeploy infrastructure | 10 | Yes |
