---
title: "Mautic on GKE Autopilot — Lab Guide"
sidebar_label: "Mautic GKE Lab"
---

# Mautic on GKE Autopilot — Lab Guide

📖 **[Configuration Reference](https://docs.radmodules.dev/docs/modules/Mautic_GKE)**

## Overview

**Estimated time:** 2–3 hours

Mautic is an open-source marketing automation platform used by 200,000+ organisations as a self-hosted alternative to HubSpot and Marketo. This lab deploys Mautic 5.x on GKE Autopilot backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS for shared media storage, and Redis caching. GKE Autopilot provides managed Kubernetes with HPA-based horizontal scaling.

### What the Module Automates

- GKE Autopilot Deployment with Cloud SQL Auth Proxy sidecar
- Cloud SQL MySQL 8.0 instance, database, and user
- Cloud Filestore (NFS) instance for shared media storage
- GCS `mautic-media` bucket for application assets
- Secret Manager secrets (admin password, DB password, root password)
- Artifact Registry repository and Cloud Build custom image pipeline
- Kubernetes Service (LoadBalancer) and optional Ingress
- HPA (Horizontal Pod Autoscaler) with configurable min/max replicas
- PodDisruptionBudget for zero-downtime rolling updates
- Cloud Monitoring uptime checks and alert policies
- Automated backup Kubernetes CronJob (daily at 02:00 UTC)
- `db-init` Kubernetes Job (creates MySQL database and user on first apply)

### What You Do Manually

- Note the external IP from the Kubernetes LoadBalancer Service
- Log in to the Mautic admin panel (`/s/login`)
- Configure SMTP email settings
- Create contacts, segments, and email campaigns
- Configure Kubernetes CronJobs for campaign processing
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI Tools Used

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect GKE resources, view logs |
| `kubectl` | Inspect pods, services, jobs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

Configure `kubectl` for the GKE cluster:

```bash
gcloud container clusters get-credentials CLUSTER_NAME \
  --project=PROJECT_ID --region=REGION
```

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project (provides VPC, GKE Autopilot cluster, Cloud SQL MySQL instance, and NFS server).
3. The following APIs enabled (Services_GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `file.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. `kubectl` configured for the GKE cluster.
6. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g., `"prod"`) |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"mautic"` | Base name for Kubernetes workload and secrets |
| `application_version` | No | `"5"` | Mautic container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the workload |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `mautic_admin_email` | No | `"admin@example.com"` | Mautic admin account email |
| `mautic_admin_username` | No | `"admin"` | Mautic admin username |
| `mailer_from_email` | No | `"mautic@example.com"` | Email sender address for campaigns |
| `mailer_from_name` | No | `"Mautic"` | Email sender display name |
| `application_database_name` | No | `"gkeappdb"` | MySQL database name (consider overriding to `"mautic"`) |
| `application_database_user` | No | `"gkeappuser"` | MySQL user (consider overriding to `"mautic"`) |

### Step 1.2 — Deploy

Click **Deploy** in the RAD UI. The deployment runs `tofu init → plan → apply` via Cloud Build. Allow 15–20 minutes for:

1. GKE namespace and RBAC provisioning.
2. Cloud SQL instance provisioning (if not shared with Services_GCP).
3. Cloud Build custom image build.
4. Kubernetes Deployment rollout.
5. `db-init` Kubernetes Job execution (creates MySQL database and user).
6. Mautic container startup with database migration (allow 3–5 minutes on first boot).

### Step 1.3 — Retrieve the External IP

After deployment completes, find the LoadBalancer external IP:

```bash
kubectl get service -n appmautic<tenant><id>
```

Or:

```bash
kubectl get service appmautic<tenant><id> \
  -n appmautic<tenant><id> \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

Access Mautic at `http://<EXTERNAL_IP>/s/login`.

> **Note:** If `enable_custom_domain = true`, access Mautic via the custom domain after DNS propagation.

---

## Phase 2 — Access Mautic [MANUAL]

### Step 2.1 — Retrieve the Admin Password

```bash
# Find the secret name
gcloud secrets list --project=PROJECT_ID --filter="name:admin-password"

# Retrieve the secret value
gcloud secrets versions access latest \
  --secret="appmautic<tenant><id>-admin-password" \
  --project=PROJECT_ID
```

### Step 2.2 — Log In

Navigate to `http://<EXTERNAL_IP>/s/login` (or your custom domain). Log in with:

- **Username**: value of `mautic_admin_username` (default: `admin`)
- **Password**: retrieved from Secret Manager in Step 2.1

### Step 2.3 — Verify Pod Status

```bash
kubectl get pods -n appmautic<tenant><id>
kubectl describe pod -n appmautic<tenant><id> -l app=appmautic<tenant><id>
```

Expected output: all pods in `Running` state with `1/1` ready containers.

### Step 2.4 — Check Mautic Startup Logs

```bash
kubectl logs -n appmautic<tenant><id> -l app=appmautic<tenant><id> --tail=50
```

Look for migration completion messages:
```
Mautic database migrations complete
Apache started
```

---

## Phase 3 — Configure Email (SMTP) [MANUAL]

### Step 3.1 — Navigate to Email Settings

1. Log in to the Mautic admin panel
2. Click the gear icon (top right) → **Configuration**
3. Select the **Email Settings** tab

### Step 3.2 — Configure SMTP

| Field | Value |
|---|---|
| Mailer transport | SMTP |
| SMTP host | Your SMTP server (e.g., `smtp.sendgrid.net`) |
| SMTP port | `587` (TLS) or `465` (SSL) |
| SMTP encryption | TLS or SSL |
| SMTP username | Your SMTP username or API key |
| SMTP password | Your SMTP password |

### Step 3.3 — Store SMTP Password in Secret Manager

```bash
echo -n "your-smtp-password" | gcloud secrets create mautic-smtp-password \
  --data-file=- --project=PROJECT_ID
```

Reference it via Terraform:

```hcl
secret_environment_variables = {
  MAUTIC_MAILER_PASSWORD = "mautic-smtp-password"
}
```

### Step 3.4 — Send Test Email

Click **Send Test Email** and verify delivery.

---

## Phase 4 — Configure Cron Jobs [TERRAFORM]

Mautic requires scheduled commands for campaign processing. On GKE, these run as Kubernetes CronJobs.

### Step 4.1 — Add Cron Jobs via Terraform

Add the following to your module configuration and re-apply:

```hcl
cron_jobs = [
  {
    name     = "campaign-trigger"
    schedule = "*/15 * * * *"
    command  = ["php", "/var/www/html/bin/console", "mautic:campaigns:trigger", "--env=prod"]
    cpu_limit    = "500m"
    memory_limit = "256Mi"
    timeout_seconds = 300
    concurrency_policy = "Forbid"
  },
  {
    name     = "campaign-messages"
    schedule = "*/15 * * * *"
    command  = ["php", "/var/www/html/bin/console", "mautic:campaigns:messages", "--env=prod"]
    cpu_limit    = "500m"
    memory_limit = "256Mi"
    timeout_seconds = 300
    concurrency_policy = "Forbid"
  },
  {
    name     = "queue-process"
    schedule = "*/5 * * * *"
    command  = ["php", "/var/www/html/bin/console", "mautic:queue:process", "--env=prod"]
    cpu_limit    = "500m"
    memory_limit = "256Mi"
    timeout_seconds = 120
    concurrency_policy = "Forbid"
  },
  {
    name     = "contacts-dedup"
    schedule = "0 3 * * *"
    command  = ["php", "/var/www/html/bin/console", "mautic:contacts:deduplicate", "--env=prod"]
    cpu_limit    = "500m"
    memory_limit = "256Mi"
    timeout_seconds = 600
  }
]
```

### Step 4.2 — Verify CronJobs

```bash
kubectl get cronjobs -n appmautic<tenant><id>
kubectl get jobs -n appmautic<tenant><id>
```

### Step 4.3 — Trigger a CronJob Manually

```bash
kubectl create job --from=cronjob/campaign-trigger campaign-trigger-manual \
  -n appmautic<tenant><id>
kubectl logs -n appmautic<tenant><id> -l job-name=campaign-trigger-manual
```

---

## Phase 5 — Explore Mautic [MANUAL]

### Step 5.1 — Create Contacts

1. Navigate to **Contacts** → **New Contact**
2. Fill in Name, Email, Company fields
3. Save

Import from CSV:
1. **Contacts** → **Import** → Upload CSV
2. Map CSV columns to Mautic fields
3. Review import results

### Step 5.2 — Create a Segment

1. Navigate to **Segments** → **New Segment**
2. Name the segment
3. Add filters: **Contact Fields** → **Email** → **Not Empty**
4. Save

### Step 5.3 — Create an Email Template

1. Navigate to **Channels** → **Emails** → **New Email**
2. Choose **Segment Email** type
3. Select your segment
4. Use the drag-and-drop builder to design the email
5. Save

### Step 5.4 — Create and Publish a Campaign

1. Navigate to **Campaigns** → **New Campaign**
2. Name the campaign and assign a segment
3. Add campaign actions:
   - **Send Email**: Select your email template
   - **Wait**: Add a delay (e.g., 1 day)
   - **Check Condition**: Email opened?
   - **Send Follow-up**: Follow-up email if not opened
4. **Publish** the campaign

### Step 5.5 — View Campaign Results

After publishing and running the campaign trigger CronJob:

1. Navigate to **Campaigns** → Select your campaign → **Activity**
2. View email sends, opens, clicks, and bounces

---

## Phase 6 — Observability [MANUAL]

### Step 6.1 — View Pod Logs

```bash
# All Mautic pods
kubectl logs -n appmautic<tenant><id> -l app=appmautic<tenant><id> --tail=50

# Follow logs
kubectl logs -n appmautic<tenant><id> -l app=appmautic<tenant><id> -f
```

### Step 6.2 — View Cloud Logging

```bash
gcloud logging read \
  "resource.type=k8s_container AND resource.labels.namespace_name=appmautic<tenant><id>" \
  --project=PROJECT_ID \
  --limit=50 \
  --format="table(timestamp,textPayload)"
```

### Step 6.3 — Check HPA Status

```bash
kubectl get hpa -n appmautic<tenant><id>
kubectl describe hpa -n appmautic<tenant><id>
```

### Step 6.4 — Inspect Secrets

```bash
# List all Mautic secrets
gcloud secrets list --project=PROJECT_ID --filter="name:appmautic"

# View admin password
gcloud secrets versions access latest \
  --secret="appmautic<tenant><id>-admin-password" \
  --project=PROJECT_ID
```

---

## Phase 7 — Advanced Configuration [OPTIONAL]

### Custom Domain and SSL

```hcl
enable_custom_domain   = true
application_domains    = ["marketing.example.com"]
reserve_static_ip      = true
```

After applying, retrieve the static IP and create a DNS `A` record:

```bash
gcloud compute addresses list --project=PROJECT_ID --filter="name:appmautic"
```

### Cloud Armor WAF

```hcl
enable_cloud_armor     = true
enable_custom_domain   = true
application_domains    = ["marketing.example.com"]
```

### IAP with OAuth

IAP on GKE requires explicit OAuth credentials (unlike Cloud Run which uses native IAP):

1. Create OAuth credentials in GCP Console → APIs & Services → Credentials
2. Add `https://<your-domain>/_gcp_iap/callback` as an authorized redirect URI

```hcl
enable_iap              = true
iap_oauth_client_id     = "your-client-id.apps.googleusercontent.com"
iap_oauth_client_secret = "your-client-secret"
iap_support_email       = "admin@example.com"
iap_authorized_users    = ["user:admin@example.com"]
```

### StatefulSet with Persistent Storage

For Mautic installations requiring per-pod persistent storage:

```hcl
workload_type          = "StatefulSet"
stateful_pvc_enabled   = true
stateful_pvc_size      = "20Gi"
stateful_pvc_mount_path = "/var/www/html/var"
```

### Database Password Rotation

```hcl
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 90
secret_rotation_period         = "2592000s"   # 30 days
```

---

## Phase 8 — Backup and Restore [MANUAL]

### Step 8.1 — Check Backup CronJob

```bash
kubectl get cronjobs -n appmautic<tenant><id> | grep backup
```

### Step 8.2 — Trigger a Manual Backup

```bash
kubectl create job --from=cronjob/backup backup-manual \
  -n appmautic<tenant><id>
kubectl logs -n appmautic<tenant><id> -l job-name=backup-manual
```

### Step 8.3 — List Backup Files

```bash
gcloud storage ls gs://appmautic<tenant><id>-backup/
```

### Step 8.4 — Restore from Backup

```hcl
enable_backup_import = true
backup_source        = "gcs"
backup_uri           = "gs://appmautic<tenant><id>-backup/mautic-2026-01-01.sql"
backup_format        = "sql"
```

---

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| Pods in `CrashLoopBackOff` | Database not yet ready | Check `db-init` job completion; verify Cloud SQL is running |
| Pods stuck in `Pending` | Autopilot node provisioning | Wait 2–5 minutes for Autopilot to provision nodes |
| Mautic shows 500 on login | Database connection failure | Check pod logs; verify `MAUTIC_DB_*` env vars |
| Campaigns not sending | CronJobs not configured | Add `cron_jobs` with campaign trigger commands (see Phase 4) |
| Health probe failing | PHP/Apache still initialising | Increase `startup_probe.failure_threshold` to 30 |
| Resource quota exceeded | `quota_memory_requests` using bare integer | Use binary suffix: `"4Gi"` not `"4"` |
| Redis connection error | `redis_host` empty and NFS disabled | Set `redis_host` explicitly or ensure `enable_nfs = true` |
| IAP not working | Missing OAuth credentials | Provide `iap_oauth_client_id` and `iap_oauth_client_secret` |

### Debug Commands

```bash
# Pod status and events
kubectl describe pod -n appmautic<tenant><id> -l app=appmautic<tenant><id>

# db-init job logs
kubectl logs -n appmautic<tenant><id> -l job-name=appmautic<tenant><id>-db-init

# Pod environment variables (sensitive values are redacted in Kubernetes)
kubectl exec -n appmautic<tenant><id> \
  $(kubectl get pods -n appmautic<tenant><id> -o jsonpath='{.items[0].metadata.name}') \
  -- env | grep MAUTIC

# Check NFS mount
kubectl exec -n appmautic<tenant><id> \
  $(kubectl get pods -n appmautic<tenant><id> -o jsonpath='{.items[0].metadata.name}') \
  -- ls /mnt/nfs

# Connect to Cloud SQL MySQL via pod
kubectl exec -n appmautic<tenant><id> -it \
  $(kubectl get pods -n appmautic<tenant><id> -o jsonpath='{.items[0].metadata.name}') \
  -c cloudsql-proxy \
  -- mysql -u mautic -p -S /cloudsql/PROJECT_ID:REGION:INSTANCE_NAME mautic
```
