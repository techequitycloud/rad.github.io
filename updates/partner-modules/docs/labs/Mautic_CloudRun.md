# Mautic on Cloud Run — Lab Guide

📖 **[Configuration Reference](https://docs.radmodules.dev/docs/modules/Mautic_CloudRun)**

## Overview

**Estimated time:** 2–3 hours

Mautic is an open-source marketing automation platform used by 200,000+ organisations as a self-hosted alternative to HubSpot and Marketo. This lab deploys Mautic 5.x on Google Cloud Run backed by Cloud SQL MySQL 8.0, Cloud Filestore NFS for shared media storage, and Redis caching. Cloud Run provides serverless auto-scaling with a minimum of 1 instance to avoid cold-start latency on campaign processing.

### What the Module Automates

- Cloud Run v2 (Gen2) service with Cloud SQL Auth Proxy sidecar
- Cloud SQL MySQL 8.0 instance, database, and user
- Cloud Filestore (NFS) instance for shared media storage
- GCS `mautic-media` bucket for application assets
- Secret Manager secrets (admin password, DB password, root password)
- Artifact Registry repository and Cloud Build custom image pipeline
- Serverless VPC Access connector for private networking
- Cloud Run IAM and service account bindings
- Cloud Monitoring uptime checks and alert policies
- Automated backup Cloud Run job (daily at 02:00 UTC)

### What You Do Manually

- Note the Cloud Run service URL from the RAD UI deployment panel
- Log in to the Mautic admin panel (`/s/login`)
- Configure SMTP email settings
- Create contacts, segments, and email campaigns
- Set up cron jobs for campaign processing
- Review logs in Cloud Logging and metrics in Cloud Monitoring

---

## CLI Tools Used

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect Cloud Run services, view logs |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides VPC, Cloud SQL MySQL instance, and NFS server).
3. The following APIs enabled (Services GCP handles this):
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
| `region` | No | `"us-central1"` | GCP region for Cloud Run and Cloud SQL |
| `application_name` | No | `"mautic"` | Base name for Cloud Run service and secrets |
| `application_version` | No | `"5"` | Mautic container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the service |
| `min_instance_count` | No | `1` | Minimum Cloud Run instances (1 = always warm) |
| `max_instance_count` | No | `3` | Maximum Cloud Run instances |
| `mautic_admin_email` | No | `"admin@example.com"` | Mautic admin account email |
| `mautic_admin_username` | No | `"admin"` | Mautic admin username |
| `mailer_from_email` | No | `"mautic@example.com"` | Email sender address for campaigns |
| `mailer_from_name` | No | `"Mautic"` | Email sender display name |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |

### Step 1.2 — Deploy

Click **Deploy** in the RAD UI. The deployment runs `tofu init → plan → apply` via Cloud Build. Allow 10–15 minutes for:

1. Cloud SQL instance provisioning (if not shared with Services GCP).
2. Cloud Build custom image build (`mautic/mautic:5-apache` extended with `Mautic Common`'s Dockerfile).
3. Cloud Run service deployment.
4. `db-init` Cloud Run Job execution (creates MySQL database and user).
5. Mautic container startup (first boot runs database migrations — allow 2–3 minutes).

### Step 1.3 — Retrieve the Service URL

After deployment completes, find the Cloud Run service URL:

```bash
gcloud run services list --project=PROJECT_ID --format="table(metadata.name, status.url)"
```

Or retrieve from the RAD UI deployment panel under **Outputs**.

The URL format is: `https://appmautic<tenant><id>-<project_number>.<region>.run.app`

---

## Phase 2 — Access Mautic [MANUAL]

### Step 2.1 — Retrieve the Admin Password

The Mautic admin password is stored in Secret Manager.

```bash
# Find the secret name
gcloud secrets list --project=PROJECT_ID --filter="name:admin-password"

# Retrieve the secret value
gcloud secrets versions access latest \
  --secret="appmautic<tenant><id>-admin-password" \
  --project=PROJECT_ID
```

### Step 2.2 — Log In

Navigate to `https://<service-url>/s/login`. Log in with:

- **Username**: value of `mautic_admin_username` (default: `admin`)
- **Password**: retrieved from Secret Manager in Step 2.1

### Step 2.3 — Complete Initial Setup

On first login you may be prompted with the Mautic installation wizard if migrations have not fully completed. If the wizard appears:

1. **Database Settings**: Leave defaults — the database is pre-configured via environment variables.
2. **Admin User**: The admin user is pre-created via `MAUTIC_ADMIN_LOGIN` and `MAUTIC_ADMIN_PASSWORD` environment variables.
3. **Email Settings**: Configure your SMTP server (see Phase 3).

If the admin login page appears directly (no wizard), the container entrypoint has already configured Mautic automatically.

---

## Phase 3 — Configure Email (SMTP) [MANUAL]

Mautic requires a working SMTP configuration to send campaigns. Without this, all emails will fail silently.

### Step 3.1 — Navigate to Email Settings

In the Mautic admin panel:
1. Click the gear icon (top right) → **Configuration**
2. Select the **Email Settings** tab

### Step 3.2 — Configure SMTP

| Field | Value |
|---|---|
| Mailer transport | SMTP |
| SMTP host | Your SMTP server (e.g., `smtp.sendgrid.net`) |
| SMTP port | `587` (TLS) or `465` (SSL) |
| SMTP encryption | TLS or SSL |
| SMTP username | Your SMTP username or API key |
| SMTP password | Your SMTP password |

**Recommended SMTP providers for Cloud Run:**
- SendGrid (SMTP relay)
- Mailgun
- Amazon SES
- Postmark

> **Tip:** Store your SMTP password in Secret Manager and inject it via `secret_environment_variables = { MAUTIC_MAILER_PASSWORD = "my-smtp-password-secret" }`.

### Step 3.3 — Set Sender Details

These are pre-configured via module variables but can be overridden in the UI:

- **From name**: `mailer_from_name` (default: `"Mautic"`)
- **From email**: `mailer_from_email` (default: `"mautic@example.com"`)

### Step 3.4 — Send Test Email

Click **Send Test Email** and verify delivery.

---

## Phase 4 — Configure Cron Jobs [MANUAL/TERRAFORM]

Mautic requires scheduled commands for campaign processing. Without cron jobs, campaigns will not send and the contact tracking queue will fill up.

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
  },
  {
    name     = "campaign-messages"
    schedule = "*/15 * * * *"
    command  = ["php", "/var/www/html/bin/console", "mautic:campaigns:messages", "--env=prod"]
    cpu_limit    = "500m"
    memory_limit = "256Mi"
    timeout_seconds = 300
  },
  {
    name     = "queue-process"
    schedule = "*/5 * * * *"
    command  = ["php", "/var/www/html/bin/console", "mautic:queue:process", "--env=prod"]
    cpu_limit    = "500m"
    memory_limit = "256Mi"
    timeout_seconds = 120
  },
  {
    name     = "fetch-email"
    schedule = "*/10 * * * *"
    command  = ["php", "/var/www/html/bin/console", "mautic:email:fetch", "--env=prod"]
    cpu_limit    = "500m"
    memory_limit = "256Mi"
    timeout_seconds = 120
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

### Step 4.2 — Verify Cron Jobs

After re-applying:

```bash
gcloud scheduler jobs list --project=PROJECT_ID
```

---

## Phase 5 — Explore Mautic [MANUAL]

### Step 5.1 — Create Contacts

1. Navigate to **Contacts** → **New Contact**
2. Fill in Name, Email, Company fields
3. Save and note the contact record

Or import contacts from a CSV:
1. **Contacts** → **Import** → Upload CSV
2. Map CSV columns to Mautic fields
3. Review the import results

### Step 5.2 — Create a Segment

Segments are dynamic lists of contacts filtered by criteria:

1. Navigate to **Segments** → **New Segment**
2. Name the segment (e.g., "Newsletter Subscribers")
3. Add filters: **Contact Fields** → **Email** → **Not Empty**
4. Save the segment

Rebuild the segment:
```bash
# Manually trigger segment rebuild (or wait for cron)
gcloud run jobs execute appmautic<tenant><id>-segment-rebuild \
  --project=PROJECT_ID --region=REGION
```

### Step 5.3 — Create an Email

1. Navigate to **Channels** → **Emails** → **New Email**
2. Choose **Segment Email** type
3. Select your segment
4. Use the drag-and-drop email builder
5. Add subject, from name, from email
6. Save and **Send Example** to verify layout

### Step 5.4 — Create a Campaign

1. Navigate to **Campaigns** → **New Campaign**
2. Name the campaign and assign a segment
3. Add campaign actions:
   - **Send Email**: Select your email template
   - **Wait**: Add a 1-day delay
   - **Send Follow-up Email**: Follow-up email
4. Add campaign conditions (e.g., check if email was opened)
5. **Publish** the campaign

### Step 5.5 — View Campaign Results

After publishing and running the campaign trigger cron:

1. Navigate to **Campaigns** → Select your campaign → **Activity**
2. View email sends, opens, clicks, and bounces
3. Navigate to **Contacts** → **Segments** → View segment membership

---

## Phase 6 — Observability [MANUAL]

### Step 6.1 — View Cloud Run Logs

```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=appmautic<tenant><id>" \
  --project=PROJECT_ID \
  --limit=50 \
  --format="table(timestamp,textPayload)"
```

### Step 6.2 — Monitor Cloud Run Metrics

In the GCP Console:
- Navigate to **Cloud Run** → Select your Mautic service
- View **Metrics**: Request count, Latency, Instance count, CPU utilization, Memory utilization

### Step 6.3 — Inspect the Cloud Run Service

```bash
gcloud run services describe appmautic<tenant><id> \
  --project=PROJECT_ID \
  --region=REGION \
  --format=yaml
```

### Step 6.4 — Check Secret Manager

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

### Custom Domain with Cloud Armor

To add a custom domain and WAF protection:

```hcl
enable_cloud_armor     = true
application_domains    = ["marketing.example.com"]
ingress_settings       = "internal-and-cloud-load-balancing"
```

After applying, retrieve the load balancer IP and create a DNS `A` record:

```bash
gcloud compute addresses list --project=PROJECT_ID --filter="name:appmautic"
```

SSL certificate provisioning takes 10–30 minutes after DNS propagation.

### Enable IAP for Admin-Only Access

To restrict Mautic to authenticated Google users:

```hcl
enable_iap             = true
iap_authorized_users   = ["user:admin@example.com"]
iap_authorized_groups  = ["group:marketing-team@example.com"]
```

### Database Password Rotation

```hcl
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 90
secret_rotation_period         = "2592000s"   # 30 days
```

### SMTP via Secret Manager

Store your SMTP password as a Secret Manager secret:

```bash
echo -n "your-smtp-password" | gcloud secrets create mautic-smtp-password \
  --data-file=- --project=PROJECT_ID
```

Reference it in the module:

```hcl
secret_environment_variables = {
  MAUTIC_MAILER_PASSWORD = "mautic-smtp-password"
}
```

---

## Phase 8 — Backup and Restore [MANUAL]

### Step 8.1 — Trigger a Manual Backup

```bash
gcloud run jobs execute appmautic<tenant><id>-backup \
  --project=PROJECT_ID --region=REGION
```

### Step 8.2 — List Backup Files

```bash
gcloud storage ls gs://appmautic<tenant><id>-backup/
```

### Step 8.3 — Restore from Backup

To restore from an existing backup:

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
| Cloud Run service fails health checks | Startup taking longer than probe allows | Increase `startup_probe_config.failure_threshold` to 30 |
| `/s/login` returns 500 | Database connection failure | Check `db-init` job logs; verify Cloud SQL instance is running |
| Mautic shows "Not Installed" on login | `DOCKER_MAUTIC_RUN_MIGRATIONS=true` not completed | Wait 3–5 minutes; check Cloud Run container logs for migration output |
| Campaigns not sending | Cron jobs not configured | Add `cron_jobs` with campaign trigger commands (see Phase 4) |
| Emails deliver to spam | Sender domain not verified | Verify sending domain with your SMTP provider; check SPF/DKIM/DMARC records |
| Redis connection error | `redis_host` empty and `enable_nfs = false` | Set `redis_host` explicitly or enable NFS |
| HTTP→HTTPS redirect loop | `HTTPS=on` missing | This is injected automatically by the module; verify the container image build |

### Debug Commands

```bash
# View recent Cloud Run container logs
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=appmautic<tenant><id>" \
  --project=PROJECT_ID --limit=100

# Check db-init job execution status
gcloud run jobs executions list \
  --job=appmautic<tenant><id>-db-init \
  --project=PROJECT_ID --region=REGION

# Connect to Cloud SQL MySQL directly (requires Cloud SQL Auth Proxy)
gcloud sql connect INSTANCE_NAME --user=mautic --project=PROJECT_ID
```
