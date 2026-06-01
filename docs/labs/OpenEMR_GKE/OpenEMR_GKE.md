---
title: "OpenEMR on GKE — Lab Guide"
sidebar_label: "OpenEMR GKE"
---

# OpenEMR on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenEMR_GKE)**

## Overview

**Estimated time:** 1–2 hours

OpenEMR is a HIPAA-compliant, open-source Electronic Health Records (EHR) and medical practice management solution. This lab deploys OpenEMR on GKE Autopilot, backed by Cloud SQL MySQL 8.0 (accessed via Cloud SQL Auth Proxy sidecar), NFS storage for the patient sites directory, Redis for PHP session management, and Workload Identity for secure GCP API access.

> **Healthcare Security Note:** This module is designed for HIPAA-compliant-ready deployments. All database credentials are stored in Secret Manager, all storage uses enforced public access prevention, and Workload Identity eliminates the need for service account key files. For a production HIPAA deployment, also enable `enable_audit_logging = true`, `manage_storage_kms_iam = true`, and `enable_artifact_registry_cmek = true`.

### What the Module Automates

- GKE Autopilot cluster discovery and namespace creation
- Cloud SQL MySQL 8.0 instance provisioning with private IP
- Database user and password creation (stored in Secret Manager)
- Cloud SQL Auth Proxy sidecar injection into the OpenEMR pod
- NFS server (Compute Engine VM) provisioning and NFS init Kubernetes Job
- Redis integration for PHP session storage (defaults to NFS server IP)
- Artifact Registry repository and container image mirroring
- Secret Manager secrets for all credentials with 30-day rotation notifications
- Kubernetes Deployment, Service (LoadBalancer), and HPA
- Cloud Storage bucket for application data and backups
- Workload Identity binding between Kubernetes service account and GCP IAM
- Cloud Monitoring uptime check and notification channels
- Static external IP reservation

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Retrieve the admin password from Secret Manager
- Log in and review the OpenEMR main dashboard
- Create a patient record and schedule an appointment
- Explore clinical features: prescriptions, problem list, immunizations
- Review the billing and insurance workflow
- Explore the patient portal configuration
- Configure and test automated Google Drive backup
- Explore Cloud Logging and Cloud Monitoring dashboards

---

## CLI and REST API Overview

This lab uses `gcloud` CLI and `kubectl` to inspect deployed resources. The equivalent REST API calls are shown where relevant.

**Get GKE cluster credentials:**
```bash
# gcloud
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

# REST
GET https://container.googleapis.com/v1/projects/PROJECT_ID/locations/REGION/clusters/CLUSTER_NAME
```

**Get a secret value:**
```bash
# gcloud
gcloud secrets versions access latest --secret=SECRET_NAME --project=PROJECT_ID

# REST
GET https://secretmanager.googleapis.com/v1/projects/PROJECT_ID/secrets/SECRET_NAME/versions/latest:access
```

**List pods in a namespace:**
```bash
kubectl get pods -n NAMESPACE

# Get logs from the OpenEMR container (multi-container pod)
kubectl logs -n NAMESPACE POD_NAME -c openemr
```

**Describe a Cloud SQL instance:**
```bash
# gcloud
gcloud sql instances describe INSTANCE_NAME --project=PROJECT_ID

# REST
GET https://sqladmin.googleapis.com/v1/projects/PROJECT_ID/instances/INSTANCE_NAME
```

---

## Prerequisites

Before beginning this lab, ensure the following are in place:

1. **Services_GCP module deployed** — OpenEMR_GKE depends on `Services_GCP` for the VPC network, Cloud SQL instance, GKE Autopilot cluster, and Artifact Registry. The `module_dependency` variable confirms this: `["Services_GCP"]`.
2. **GCP project with billing enabled.**
3. **`gcloud` CLI installed and authenticated** (`gcloud auth login && gcloud auth application-default login`).
4. **`kubectl` installed** — available via `gcloud components install kubectl`.
5. **Sufficient IAM permissions** — Owner or equivalent role on the target project.
6. **Access to the RAD UI** with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

The module provisions all infrastructure end-to-end. No manual steps are required during this phase.

**Key variables to set in the RAD UI deployment form:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (6–30 chars, lowercase) |
| `deployment_id` | No | auto | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `openemr` | Base name for K8s deployment and secrets |
| `application_version` | No | `7.0.4` | OpenEMR image version tag |
| `deploy_application` | No | `true` | Set `false` to provision infra without deploying |
| `min_instance_count` | No | `1` | Minimum HPA pod replicas |
| `max_instance_count` | No | `1` | Maximum HPA pod replicas |
| `gke_cluster_name` | No | auto | Target GKE cluster name (auto-discovers if empty) |
| `db_name` | No | `openemr` | MySQL database name |
| `db_user` | No | `openemr` | MySQL database username |
| `database_password_length` | No | `32` | Generated password length (16–64) |
| `cpu_limit` | No | `2000m` | Container CPU limit (min 2 vCPU recommended) |
| `memory_limit` | No | `4Gi` | Container memory limit (min 2Gi; 4Gi recommended) |
| `ephemeral_storage_limit` | No | `8Gi` | Ephemeral storage for PHP opcache, logs (max 8Gi in Autopilot) |
| `enable_nfs` | No | `true` | Mount NFS for sites directory (required for OpenEMR persistence) |
| `nfs_mount_path` | No | `/var/www/localhost/htdocs/openemr/sites` | Container path for NFS mount |
| `enable_redis` | No | `true` | Enable Redis for PHP session storage |
| `redis_host` | No | NFS server IP | Redis host (defaults to NFS server IP) |
| `redis_port` | No | `6379` | Redis port |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |

Click **Deploy** in the RAD UI.

**What the module creates:**
- Kubernetes namespace derived from `application_name` and `tenant_deployment_id`
- Cloud SQL MySQL 8.0 database `openemr` with user `openemr` (password in Secret Manager)
- Cloud SQL Auth Proxy sidecar injected into each OpenEMR pod for Unix socket DB access
- NFS server (Compute Engine VM) and NFS init Kubernetes Job for directory setup
- OpenEMR Deployment with TCP startup probe and HTTP liveness probe (`/interface/login/login.php`)
- LoadBalancer Service with `ClientIP` session affinity
- Static external IP (reserved by default via `reserve_static_ip = true`)
- Redis session store at the NFS server IP (port 6379)
- GCS bucket (`<prefix>-data`) for application data
- Cloud Monitoring uptime check against `/`
- Admin password secret: `admin_password_secret_id` output

**Key outputs available in the RAD UI deployment panel after deployment completes:**

| Output | Description |
|---|---|
| `service_url` | OpenEMR application URL |
| `service_external_ip` | External LoadBalancer IP |
| `admin_password_secret_id` | Secret Manager secret name for admin password |
| `database_password_secret` | Secret Manager secret name for DB password |
| `namespace` | Kubernetes namespace |
| `nfs_server_ip` | NFS server IP (sensitive) |

Set shell variables for use in later steps:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace (pattern: appopenemr<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appopenemr" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~openemr" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Access the GKE Cluster [MANUAL]

Configure `kubectl` access and verify that the OpenEMR pods are running before proceeding.

**Step 1 — Get GKE cluster credentials:**
```bash
# List available clusters
gcloud container clusters list --project=${PROJECT}

# Fetch credentials for the cluster
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Step 2 — Verify pods are running:**
```bash
# List all pods in the OpenEMR namespace
kubectl get pods -n ${NAMESPACE}

# Expected: one pod with STATUS = Running (may take 5+ minutes on first boot)
# NAME                       READY   STATUS    RESTARTS   AGE
# openemr-xxxxxxxxx-xxxxx    2/2     Running   0          8m
# (2/2 because Cloud SQL Auth Proxy runs as a sidecar)

# Check the NFS init job completed successfully
kubectl get jobs -n ${NAMESPACE}

# View OpenEMR container logs
kubectl logs -n ${NAMESPACE} -l app=openemr -c openemr --tail=50

# View Cloud SQL Auth Proxy sidecar logs
kubectl logs -n ${NAMESPACE} -l app=openemr -c cloud-sql-proxy --tail=20
```

**Step 3 — Confirm the external IP is assigned:**
```bash
kubectl get svc -n ${NAMESPACE}

# Note the EXTERNAL-IP column value
# NAME      TYPE           CLUSTER-IP    EXTERNAL-IP    PORT(S)
# openemr   LoadBalancer   10.x.x.x      34.x.x.x       80:xxxxx/TCP
```

The OpenEMR UI is accessible at `http://${EXTERNAL_IP}/openemr` once the startup probe passes (allow 5–10 minutes for first-boot installation and database setup).

---

## Phase 3 — Complete OpenEMR Setup [MANUAL]

Log in to OpenEMR and review the main clinical dashboard.

**Step 1 — Retrieve admin credentials from Secret Manager:**
```bash
# List secrets related to OpenEMR
gcloud secrets list --project=${PROJECT} --filter="name~openemr"

# Access the admin password (use the secret name from the RAD UI outputs)
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project=${PROJECT}

# REST equivalent
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access"
```

**Step 2 — Navigate to OpenEMR:**
1. Open `http://${EXTERNAL_IP}/openemr` in your browser.
2. If the page is not yet reachable, wait for the startup probe to pass (OpenEMR performs database installation on first boot — allow up to 10 minutes).
3. Log in with username `admin` and the password retrieved from Secret Manager.

**Step 3 — Review the main dashboard:**
1. Observe the main dashboard layout:
   - **Patient Summary** widgets (recent appointments, messages)
   - **Top navigation**: Patient, Fees, Reports, Modules, Administration
   - **Calendar** view for appointment scheduling
2. Navigate to **Administration** > **Globals** to review site-level settings.
3. Under **Administration** > **Users**, confirm the admin user is configured correctly.

> **HIPAA Note:** The admin account has full access to all patient records. In a production environment, create role-specific accounts with minimum necessary privileges and enable audit logging (`enable_audit_logging = true`).

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
   - **Portal Site Address** — the URL patients will use (should be the OpenEMR public URL)
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
1. Patients access the portal at `http://${EXTERNAL_IP}/openemr/portal`.
2. Initial portal credentials are provided by the clinic (via printed instructions or secure email).
3. Patients authenticate with a separate portal username and password (not the admin credentials).
4. All portal traffic is encrypted in transit via the HTTPS load balancer (when SSL is configured).

**Step 4 — Explore the patient portal URL:**
1. In a separate browser window (or incognito), navigate to `http://${EXTERNAL_IP}/openemr/portal`.
2. Observe the patient-facing login page.
3. Note the difference in interface between the clinician portal and the patient portal.

---

## Phase 8 — Backup Configuration [MANUAL]

Review the automated Google Drive backup integration and verify the backup schedule.

**Step 1 — Navigate to Administration > Backup:**
1. In OpenEMR, go to **Administration** > **Backup** (if available in this version).
2. Review the backup configuration settings.

**Step 2 — Review Google Drive backup integration:**
The backup is configured at the infrastructure level by the module. It creates a Kubernetes CronJob that:
1. Dumps the MySQL database using `mysqldump`.
2. Archives the NFS sites directory.
3. Uploads the compressed archive to the GCS backup bucket.
4. Optionally syncs to Google Drive when configured.

Inspect the backup job:
```bash
# List Kubernetes CronJobs in the namespace
kubectl get cronjobs -n ${NAMESPACE}

# View the backup job specification
kubectl describe cronjob BACKUP_JOB_NAME -n ${NAMESPACE}

# Check recent backup job executions
kubectl get jobs -n ${NAMESPACE} --sort-by=.metadata.creationTimestamp
```

**Step 3 — Verify automated backup schedule:**
```bash
# The backup schedule is set by backup_schedule variable (default: daily at 02:00 UTC)
kubectl get cronjob -n ${NAMESPACE} -o jsonpath='{.items[*].spec.schedule}'

# List backup files in GCS
gcloud storage ls gs://BACKUP_BUCKET_NAME/ --project=${PROJECT}

# REST
GET https://storage.googleapis.com/storage/v1/b/BACKUP_BUCKET_NAME/o
```

**Step 4 — Manually trigger a backup:**
```bash
# Trigger the backup CronJob immediately (creates a one-off Job)
kubectl create job --from=cronjob/BACKUP_CRONJOB_NAME manual-backup-$(date +%s) -n ${NAMESPACE}

# Watch the job complete
kubectl get jobs -n ${NAMESPACE} -w

# Verify the backup file appeared in GCS
gcloud storage ls gs://BACKUP_BUCKET_NAME/ --project=${PROJECT}
```

> **HIPAA Note:** For compliance, set `backup_retention_days` to meet your organization's data retention policy requirements. Healthcare records often require 6–10 years of retention. Consider enabling versioning (`versioning_enabled = true`) on the backup bucket.

---

## Phase 9 — Explore Cloud Logging [MANUAL]

Review OpenEMR PHP/Apache logs and audit logs in Cloud Logging.

**Step 1 — Access Cloud Logging via the console:**
1. Open the Google Cloud Console at [console.cloud.google.com](https://console.cloud.google.com).
2. Navigate to **Logging** > **Log Explorer**.
3. Set the project to your deployment project.

**Step 2 — Filter OpenEMR application logs:**

Use the following filter in the Log Explorer query field:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="openemr"
```

**Step 3 — Review PHP/Apache log entries:**
1. Observe Apache access logs showing patient portal and clinical interface requests.
2. Filter for PHP errors:
   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   resource.labels.container_name="openemr"
   textPayload=~"PHP.*Error|Fatal error|Warning"
   ```
3. Review audit log entries for administrative actions.

**Step 4 — Review Cloud SQL Auth Proxy logs:**
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="cloud-sql-proxy"
```

**Step 5 — Stream logs via gcloud:**
```bash
# Stream all OpenEMR namespace logs
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} \
  --freshness=1h \
  --format="table(timestamp,severity,labels.\"k8s-pod/app\",textPayload)"

# Filter for errors only
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'" AND severity>=ERROR' \
  --project=${PROJECT} \
  --freshness=6h
```

> **HIPAA Note:** For audit logging of all GCP API calls (DATA_READ, DATA_WRITE, ADMIN_READ), set `enable_audit_logging = true` in your module configuration. This captures who accessed what data and when, which is required for HIPAA audit trail compliance.

---

## Phase 10 — Explore Cloud Monitoring [MANUAL]

Review service health metrics and Redis cache metrics in Cloud Monitoring.

**Step 1 — Access GKE workload metrics:**
1. Navigate to **Monitoring** > **Dashboards** > **GKE** in the Cloud Console.
2. Select the cluster and filter by namespace.

**Step 2 — Review OpenEMR container metrics:**
1. Navigate to **Monitoring** > **Metrics Explorer**.
2. Select resource type **Kubernetes Container**.
3. Plot the following metrics for the `openemr` container:
   - `kubernetes.io/container/cpu/usage_time` — CPU usage (watch for spikes during report generation)
   - `kubernetes.io/container/memory/used_bytes` — memory usage (OpenEMR requires at least 2Gi)
   - `kubernetes.io/container/restart_count` — container restarts (should be 0 in steady state)

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

The module removes all resources in reverse dependency order: Kubernetes workloads, Cloud SQL instance, NFS server VM, GCS buckets, Secret Manager secrets, static IP, and IAM bindings.

> Note: `enable_purge = true` (default) allows full deletion. If set to `false`, resources are retained after undeployment. For production healthcare environments, consider setting `enable_purge = false` to protect against accidental deletion of patient data.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | AUTOMATED | Module provisions GKE, Cloud SQL MySQL, NFS, Redis, IAM, monitoring |
| Phase 2 — Cluster Access | MANUAL | `kubectl` access, verify pods (incl. Cloud SQL Auth Proxy sidecar) |
| Phase 3 — OpenEMR Setup | MANUAL | Log in with admin credentials from Secret Manager, review dashboard |
| Phase 4 — Patient Management | MANUAL | Create patient, schedule appointment, document SOAP note encounter |
| Phase 5 — Clinical Features | MANUAL | Write prescription, problem list, immunizations, medication management |
| Phase 6 — Billing & Insurance | MANUAL | Fee sheet, eligibility check, billing claim generation |
| Phase 7 — Patient Portal | MANUAL | Review portal settings, patient-facing access, security controls |
| Phase 8 — Backup Configuration | MANUAL | Review Google Drive backup, verify schedule, trigger manual backup |
| Phase 9 — Cloud Logging | MANUAL | View PHP/Apache logs, audit logs, Cloud SQL Auth Proxy logs |
| Phase 10 — Cloud Monitoring | MANUAL | GKE metrics, uptime check, Redis session metrics |
| Phase 11 — Undeploy | AUTOMATED | RAD UI removes all resources |
