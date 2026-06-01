# OpenEMR on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenEMR_CloudRun)**

## Overview

**Estimated time:** 1–2 hours

OpenEMR is a HIPAA-compliant, open-source Electronic Health Records (EHR) and medical practice management solution. This lab deploys OpenEMR on Cloud Run Gen 2, backed by Cloud SQL MySQL 8.0 (accessed via Unix socket with Cloud SQL Auth Proxy), NFS storage for the patient sites directory, Redis for PHP session management, and Direct VPC Egress for private networking.

> **Healthcare Security Note:** This module is designed for HIPAA-compliant-ready deployments. All database credentials are stored in Secret Manager, all storage uses enforced public access prevention, and service accounts are scoped to minimum required permissions. For a production HIPAA deployment, also enable `enable_audit_logging = true`, `manage_storage_kms_iam = true`, and `ingress_settings = "internal-and-cloud-load-balancing"`.

### What the Module Automates

- Cloud Run Gen 2 service with TCP startup probe and HTTP liveness probe
- Cloud SQL MySQL 8.0 instance provisioning with private IP and Unix socket access
- Database user and password creation (stored in Secret Manager)
- NFS server (Compute Engine VM) provisioning and NFS init Cloud Run Job
- Redis integration for PHP session storage (defaults to NFS server IP)
- Artifact Registry repository and container image mirroring
- Secret Manager secrets for all credentials with rotation notifications
- Serverless VPC Access and Direct VPC Egress for private connectivity
- Cloud Storage bucket for application data and backups
- Cloud Monitoring uptime check and notification channels
- Automated daily backup via Cloud Run Job and Cloud Scheduler

### What You Do Manually

- Note the service URL and admin credentials from the RAD UI deployment panel
- Log in and review the OpenEMR main dashboard
- Create a patient record and schedule an appointment
- Explore clinical features: prescriptions, problem list, immunizations
- Review the billing and insurance workflow
- Explore the patient portal configuration
- Configure and test automated Google Drive backup
- Explore Cloud Logging and Cloud Monitoring dashboards

---

## CLI and REST API Overview

This lab uses `gcloud` CLI to inspect deployed Cloud Run, Cloud SQL, and NFS resources. The equivalent REST API calls are shown where relevant.

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

**Trigger a manual Cloud Run job:**
```bash
# gcloud
gcloud run jobs execute JOB_NAME --region=REGION --project=PROJECT_ID

# REST
POST https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/jobs/JOB_NAME:run
```

**List Cloud Run revisions:**
```bash
# gcloud
gcloud run revisions list --service=SERVICE_NAME --region=REGION --project=PROJECT_ID

# REST
GET https://run.googleapis.com/v2/projects/PROJECT_ID/locations/REGION/services/SERVICE_NAME/revisions
```

---

## Prerequisites

Before beginning this lab, ensure the following are in place:

1. **Services GCP module deployed** — OpenEMR CloudRun depends on `Services GCP` for the VPC network, Cloud SQL instance, and Artifact Registry. The `module_dependency` variable confirms this: `["Services GCP"]`.
2. **GCP project with billing enabled.**
3. **`gcloud` CLI installed and authenticated** (`gcloud auth login && gcloud auth application-default login`).
4. **Sufficient IAM permissions** — Owner or equivalent role on the target project.
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

Variables are configured in the RAD UI form before deploying. The table below describes each variable you can fill in.

**Key variables to set before deploying:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (6–30 chars, lowercase) |
| `deployment_id` | No | auto | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `openemr` | Base name for the Cloud Run service and secrets |
| `application_version` | No | `7.0.4` | OpenEMR image version tag |
| `deploy_application` | No | `true` | Set `false` to provision infra without deploying |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (1 avoids cold starts for clinicians) |
| `max_instance_count` | No | `1` | Maximum Cloud Run instances (limit to 1 unless NFS confirmed for multi-instance) |
| `cpu_limit` | No | `2000m` | Container CPU limit (min 2 vCPU recommended) |
| `memory_limit` | No | `4Gi` | Container memory limit (min 1Gi; 4Gi recommended for production) |
| `container_port` | No | `80` | Apache listens on port 80 inside the container |
| `db_name` | No | `openemr` | MySQL database name |
| `db_user` | No | `openemr` | MySQL database username |
| `database_password_length` | No | `32` | Generated password length (16–64) |
| `enable_nfs` | No | `true` | Mount NFS for sites directory (required for OpenEMR persistence) |
| `nfs_mount_path` | No | `/var/www/localhost/htdocs/openemr/sites` | Container path for NFS mount |
| `enable_redis` | No | `true` | Enable Redis for PHP session storage |
| `redis_host` | No | NFS server IP | Redis host (defaults to NFS server IP) |
| `redis_port` | No | `6379` | Redis port |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |
| `ingress_settings` | No | `all` | Traffic ingress: `all`, `internal`, or `internal-and-cloud-load-balancing` |
| `vpc_egress_setting` | No | `PRIVATE_RANGES_ONLY` | VPC egress routing for private NFS and DB connectivity |

Deployment is initiated from the RAD UI. After filling in the variable form, click **Deploy** to start the deployment.

**What the module creates:**
- Cloud Run Gen 2 service with TCP startup probe and HTTP liveness probe (`/interface/login/login.php`)
- Cloud SQL MySQL 8.0 database `openemr` with user `openemr` (password in Secret Manager)
- Cloud SQL Auth Proxy sidecar (Unix socket) for secure database connectivity
- NFS server (Compute Engine VM) and NFS init Cloud Run Job for directory setup
- Redis session store at the NFS server IP (port 6379)
- Serverless VPC Access and Direct VPC Egress for private IP routing
- GCS bucket (`<prefix>-data`) for application data and backups
- Cloud Monitoring uptime check against `/`
- Admin password secret: `admin_password_secret_id` output

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_url` | HTTPS URL of the Cloud Run service |
| `service_name` | Cloud Run service name |
| `admin_password_secret_id` | Secret Manager secret name for the admin password |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `database_instance_name` | Cloud SQL instance name |
| `nfs_server_ip` | NFS server internal IP (sensitive) |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the Cloud Run service (filter by app name "openemr")
export SERVICE=$(gcloud run services list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(metadata.name)" \
  --limit=1)
export SERVICE_URL=$(gcloud run services describe ${SERVICE} \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(status.url)")

# Discover the admin password secret (filter by app name)
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~openemr" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Get the Service URL [MANUAL]

Retrieve the Cloud Run service URL and confirm the application is reachable.

**Step 1 — Get the service URL:**
```bash
echo "OpenEMR URL: ${SERVICE_URL}"
# Expected: https://openemr-XXXX-XX.a.run.app
```

**Step 2 — Confirm the service is serving traffic:**
```bash
# Check the OpenEMR login page
curl -I "${SERVICE_URL}/openemr/interface/login/login.php"
# Expected: HTTP/2 200

# Or check the root path
curl -I "${SERVICE_URL}/"

# REST equivalent via gcloud
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT} \
  --format="table(status.url, status.conditions)"
```

**Step 3 — Review the Cloud Run service details:**
```bash
gcloud run services describe ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}
```

The OpenEMR UI is accessible at `${SERVICE_URL}/openemr`. Allow 5–10 minutes after the first deploy for the startup probe to pass (OpenEMR performs database installation and NFS directory initialization on first boot).

---

## Phase 3 — Complete OpenEMR Setup [MANUAL]

Log in to OpenEMR and review the main clinical dashboard.

**Step 1 — Retrieve admin credentials from Secret Manager:**
```bash
# List OpenEMR-related secrets
gcloud secrets list --project=${PROJECT} --filter="name~openemr"

# Access the admin password
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}

# REST equivalent
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access"
```

**Step 2 — Navigate to OpenEMR:**
1. Open `${SERVICE_URL}/openemr` in your browser.
2. If the page is not yet reachable, wait for the startup probe to pass (first-boot database installation takes 5–10 minutes).
3. Log in with username `admin` and the password retrieved from Secret Manager.

**Step 3 — Review the main dashboard:**
1. Observe the main dashboard layout:
   - **Patient Summary** widgets (recent appointments, messages, alerts)
   - **Top navigation**: Patient, Fees, Reports, Modules, Administration
   - **Calendar** view for appointment scheduling
2. Navigate to **Administration** > **Globals** to review site-level settings.
3. Under **Administration** > **Users**, confirm the admin user is configured correctly.

> **HIPAA Note:** The admin account has full access to all patient records. In a production environment, create role-specific accounts with minimum necessary privileges. For Cloud Run, also consider setting `ingress_settings = "internal-and-cloud-load-balancing"` and fronting OpenEMR with a Google Cloud Load Balancer + Cloud Armor WAF for additional protection.

---

## Phase 4 — Patient Management [MANUAL]

Create a patient record, schedule an appointment, and document a clinical encounter.

**Step 1 — Create a new patient:**
1. Navigate to **Patient** > **New Patient** (or click **New Patient** in the top navigation).
2. Fill in the **Demographics** tab:
   - **First Name:** Jane
   - **Last Name:** Doe
   - **Date of Birth:** 1985-06-15
   - **Sex:** Female
   - **Address, City, State, ZIP**
3. Navigate to the **Insurance** tab:
   - Add a primary insurance plan
   - Enter the policy holder name and policy number
4. Click **Save** to create the patient record.
5. Note the auto-assigned **PID** (Patient ID) number.

**Step 2 — Schedule an appointment:**
1. From the patient's chart, click **New Appointment**.
2. Set the appointment details:
   - **Date/Time:** select a near-future slot
   - **Appointment type:** Office Visit
   - **Provider:** select the admin user or a configured provider
3. Click **Save Appointment**.
4. Navigate to **Modules** > **Calendar** and confirm the appointment appears.

**Step 3 — View the patient chart:**
1. Search for the patient using **Patient** > **Patient Finder**.
2. Open the patient chart.
3. Review the chart tabs: Summary, Demographics, Documents, Insurance, History.

**Step 4 — Create a SOAP note encounter:**
1. From the patient chart, click **Encounter** > **New Encounter**.
2. Set the encounter date and reason for visit.
3. Click **New Encounter** to open the encounter form.
4. Navigate to the **SOAP** section:
   - **Subjective:** "Patient presents with mild headache for 3 days."
   - **Objective:** "BP 120/80, HR 72, Temp 98.6F"
   - **Assessment:** "Tension headache"
   - **Plan:** "Rest, hydration, ibuprofen PRN"
5. Click **Save** to record the encounter.

---

## Phase 5 — Clinical Features [MANUAL]

Explore the clinical modules: prescriptions, problem list, immunizations, and medication management.

**Step 1 — Write a prescription:**
1. From within an open encounter (or from the patient chart), navigate to **Rx** > **New Prescription**.
2. Fill in the prescription details:
   - **Drug:** Ibuprofen 400mg
   - **Directions:** 1 tablet every 6 hours as needed
   - **Quantity:** 30 tablets
   - **Refills:** 0
3. Click **Save** to record the prescription.
4. Optionally, click **Print** to preview the printable prescription format.

**Step 2 — Create a problem list entry:**
1. From the patient chart, navigate to the **Problems** tab (or via **Encounter** > **Problem List**).
2. Click **Add Problem**.
3. Search for a diagnosis code (e.g., search "headache" to find ICD-10 code `R51`).
4. Select the code and set the **Status** to `Active`.
5. Click **Save**.

**Step 3 — Explore the immunization record:**
1. From the patient chart, navigate to **Immunizations**.
2. Click **Add Immunization**.
3. Select a vaccine type (e.g., Influenza).
4. Fill in the administration date and lot number.
5. Click **Save**.

**Step 4 — Review medication list management:**
1. From the patient chart, navigate to **Medications**.
2. Review the active medications list.
3. Click **Add Medication** to add a non-prescription supplement.
4. Note how the medication list integrates with the encounter documentation.

---

## Phase 6 — Billing and Insurance [MANUAL]

Navigate the billing workflow: fee sheets, insurance eligibility, and claim generation.

**Step 1 — Navigate to Billing Manager:**
1. Go to **Fees** > **Billing Manager** in the top navigation.
2. Review the list of encounters pending billing.
3. Note the status column: `unprocessed`, `complete`, `waiting`.

**Step 2 — Create a fee sheet entry:**
1. From the patient's encounter, navigate to **Fee Sheet**.
2. Click **Add CPT Code**:
   - Search for code `99213` (Office visit, established patient, low complexity)
   - Set units to `1`
3. Add a diagnosis pointer linking to the ICD-10 code created in Phase 5.
4. Click **Save Fee Sheet**.

**Step 3 — Explore insurance eligibility checking:**
1. From the Billing Manager, locate the patient encounter.
2. Click **Eligibility** to check insurance eligibility (requires a configured clearinghouse in production; in this lab, observe the form fields).
3. Review the eligibility request format: payer ID, patient demographics, insurance policy.

**Step 4 — Review billing claim generation:**
1. From the Billing Manager, select the encounter.
2. Click **Generate Claim** to preview the billing claim.
3. Review the claim format (CMS 1500 structure): patient info, provider NPI, diagnosis codes, procedure codes, charges.
4. Note the claim ID assigned for tracking.

---

## Phase 7 — Patient Portal [MANUAL]

Review the patient portal configuration and understand how patients access their records securely.

**Step 1 — Navigate to Administration > Portal:**
1. Go to **Administration** > **Globals** > **Portal** tab.
2. Review the portal settings:
   - **Portal Site Address** — the URL patients will use (should be the OpenEMR Cloud Run service URL)
   - **Allow portal patient signup** — controls self-registration
   - **Portal Message** — displayed on the portal landing page

**Step 2 — Review patient portal settings:**
1. Navigate to **Administration** > **Portal** > **Portal Dashboard**.
2. Review the portal modules enabled for patients:
   - Appointment requests
   - Secure messaging
   - Health summaries and lab results
   - Prescription requests
   - Demographic updates

**Step 3 — How patients access their records securely:**
1. Patients access the portal at `${SERVICE_URL}/openemr/portal`.
2. Initial portal credentials are provided by the clinic (via printed instructions or secure email).
3. Patients authenticate with a separate portal username and password.
4. For HIPAA-compliant production use, front the Cloud Run service with a Global HTTPS Load Balancer (enable `enable_cloud_armor = true` with `application_domains`) to enforce TLS termination and WAF protection.

**Step 4 — Explore the patient portal URL:**
1. In a separate browser window (or incognito), navigate to `${SERVICE_URL}/openemr/portal`.
2. Observe the patient-facing login page.
3. Note the difference in interface between the clinician portal and the patient portal.

---

## Phase 8 — Backup Configuration [MANUAL]

Review the automated Google Drive backup integration and verify the backup schedule.

**Step 1 — Review the backup Cloud Run Job:**
```bash
# List Cloud Run Jobs in the region
gcloud run jobs list --region=${REGION} --project=${PROJECT}

# Describe the backup job
gcloud run jobs describe BACKUP_JOB_NAME \
  --region=${REGION} \
  --project=${PROJECT}

# REST
GET https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/BACKUP_JOB_NAME
```

**Step 2 — Review Google Drive backup integration:**
The backup is configured at the infrastructure level by the module. The Cloud Run backup job:
1. Dumps the MySQL database using `mysqldump` via the Cloud SQL Unix socket.
2. Archives the NFS sites directory (patient documents and configuration).
3. Uploads the compressed archive to the GCS backup bucket.
4. Optionally syncs to Google Drive when the Google Drive API is configured.

**Step 3 — Verify automated backup schedule:**
```bash
# List Cloud Scheduler jobs (backup schedule is managed by Cloud Scheduler)
gcloud scheduler jobs list --project=${PROJECT} --location=${REGION}

# REST
GET https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/jobs

# List backup files in GCS
gcloud storage ls gs://BACKUP_BUCKET_NAME/ --project=${PROJECT}

# REST
GET https://storage.googleapis.com/storage/v1/b/BACKUP_BUCKET_NAME/o
```

**Step 4 — Manually trigger a backup and verify in GCS:**
```bash
# Trigger the backup job immediately
gcloud run jobs execute BACKUP_JOB_NAME \
  --region=${REGION} \
  --project=${PROJECT}

# REST
POST https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/BACKUP_JOB_NAME:run

# Watch the job execution status
gcloud run jobs executions list \
  --job=BACKUP_JOB_NAME \
  --region=${REGION} \
  --project=${PROJECT}

# Verify the backup file appeared in GCS
gcloud storage ls gs://BACKUP_BUCKET_NAME/ --project=${PROJECT}
```

> **HIPAA Note:** For compliance, set `backup_retention_days` to meet your organization's data retention policy. Healthcare records often require 6–10 years of retention. Consider enabling versioning (`versioning_enabled = true`) on the backup bucket and `manage_storage_kms_iam = true` for CMEK encryption of backup data.

---

## Phase 9 — Explore Cloud Logging [MANUAL]

Review OpenEMR PHP/Apache logs and audit logs in Cloud Logging.

**Step 1 — Access Cloud Logging via the console:**
1. Open the Google Cloud Console at [console.cloud.google.com](https://console.cloud.google.com).
2. Navigate to **Logging** > **Log Explorer**.
3. Set the project to your deployment project.

**Step 2 — Filter OpenEMR Cloud Run logs:**

Use the following filter in the Log Explorer query field:
```
resource.type="cloud_run_revision"
resource.labels.service_name="${SERVICE}"
```

**Step 3 — Review PHP/Apache log entries:**
1. Observe Apache access logs showing clinical interface and patient portal requests.
2. Filter for PHP errors:
   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="${SERVICE}"
   textPayload=~"PHP.*Error|Fatal error|Warning"
   ```
3. Review database connection log entries confirming Cloud SQL Unix socket connectivity.

**Step 4 — Stream logs via gcloud:**
```bash
# Tail live logs from the OpenEMR Cloud Run service
gcloud run services logs tail ${SERVICE} \
  --region=${REGION} \
  --project=${PROJECT}

# Historical logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'"' \
  --project=${PROJECT} \
  --freshness=1h \
  --format="table(timestamp,severity,textPayload)"

# Filter for errors only
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="'${SERVICE}'" AND severity>=ERROR' \
  --project=${PROJECT} \
  --freshness=6h
```

> **HIPAA Note:** For a full audit trail of GCP API calls (DATA_READ, DATA_WRITE, ADMIN_READ events), set `enable_audit_logging = true` in your module configuration. This is required to meet HIPAA's audit control requirements and captures who accessed what patient-related GCP resources and when.

---

## Phase 10 — Explore Cloud Monitoring [MANUAL]

Review service health metrics and Redis cache metrics in Cloud Monitoring.

**Step 1 — Access Cloud Run metrics:**
1. Navigate to **Cloud Run** > **Services** in the Cloud Console.
2. Click on the OpenEMR service.
3. Review the built-in metrics tabs:
   - **Requests** — request count and latency distribution
   - **Container** — CPU and memory utilisation
   - **Instances** — active instance count over time

**Step 2 — Review OpenEMR Cloud Run metrics via Metrics Explorer:**
1. Navigate to **Monitoring** > **Metrics Explorer**.
2. Select resource type **Cloud Run Revision**.
3. Plot the following metrics:
   - `run.googleapis.com/request_count` — requests per second
   - `run.googleapis.com/request_latencies` — response time percentiles (watch for P99 latency during large report generation)
   - `run.googleapis.com/container/instance_count` — active instances

**Step 3 — Review the uptime check:**
1. Navigate to **Monitoring** > **Uptime checks**.
2. Find the uptime check created by the module.
3. Review the check configuration: path `/`, interval 60s, timeout 10s.
4. Confirm the check shows green (service healthy) from multiple probe locations.

**Step 4 — Review Redis session metrics (if Memorystore is used):**
If Redis is backed by Cloud Memorystore rather than the NFS server, navigate to:
1. **Monitoring** > **Metrics Explorer** > Resource type **Redis Instance**.
2. Plot:
   - `redis.googleapis.com/stats/connected_clients` — active PHP sessions
   - `redis.googleapis.com/stats/memory/usage_ratio` — memory utilisation
   - `redis.googleapis.com/stats/keyspace_hits` — session cache hit rate

**Step 5 — Review alert policies:**
1. Navigate to **Monitoring** > **Alerting**.
2. Review any alert policies configured by the module.
3. Note the notification channels (email addresses from `support_users`).

**Step 6 — Query metrics via gcloud:**
```bash
# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# REST
GET https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs
```

---

## Phase 11 — Undeploy [AUTOMATED]

When you have finished the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

The module removes all resources in reverse dependency order: Cloud Run service and jobs, Cloud SQL instance, NFS server VM, GCS buckets, Secret Manager secrets, VPC connectors, Cloud Scheduler jobs, and IAM bindings.

> Note: `enable_purge = true` (default) allows full deletion. If set to `false`, resources are retained after undeploy. For production healthcare environments, consider setting `enable_purge = false` to protect against accidental deletion of patient data.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | AUTOMATED | RAD UI deploys Cloud Run Gen 2, Cloud SQL MySQL, NFS, Redis, IAM, monitoring |
| Phase 2 — Service URL | MANUAL | Retrieve and verify Cloud Run service URL, confirm startup probe |
| Phase 3 — OpenEMR Setup | MANUAL | Log in with admin credentials from Secret Manager, review dashboard |
| Phase 4 — Patient Management | MANUAL | Create patient, schedule appointment, document SOAP note encounter |
| Phase 5 — Clinical Features | MANUAL | Write prescription, problem list, immunizations, medication management |
| Phase 6 — Billing & Insurance | MANUAL | Fee sheet, eligibility check, billing claim generation |
| Phase 7 — Patient Portal | MANUAL | Review portal settings, patient-facing access, HTTPS/security controls |
| Phase 8 — Backup Configuration | MANUAL | Review Google Drive backup, verify Cloud Scheduler, trigger manual backup |
| Phase 9 — Cloud Logging | MANUAL | View PHP/Apache logs, audit logs, database connection logs |
| Phase 10 — Cloud Monitoring | MANUAL | Cloud Run metrics, uptime check, Redis session metrics |
| Phase 11 — Undeploy | AUTOMATED | RAD UI removes all resources |
