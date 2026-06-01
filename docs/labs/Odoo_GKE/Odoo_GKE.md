---
title: "Odoo ERP on GKE — Lab Guide"
sidebar_label: "Odoo GKE"
---

# Odoo ERP on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Odoo_GKE)**

## Overview

**Estimated time:** 2–3 hours (ERP complexity requires additional setup and exploration time)

This lab walks you through deploying Odoo ERP on Google Kubernetes Engine (GKE) Autopilot using the `Odoo_GKE` module, then verifying and exploring the deployment manually. The module handles all GCP infrastructure; you perform the post-deployment steps interactively.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment (HPA min/max replicas)
- Cloud SQL PostgreSQL instance, database, and user
- Cloud Build custom Odoo image build and push to Artifact Registry
- GCS Fuse CSI volume for Odoo file storage
- Cloud Filestore (NFS) persistent share (`/mnt/nfs`) for shared attachments
- Cloud SQL Auth Proxy sidecar (Unix socket at `/cloudsql`)
- Workload Identity binding and least-privilege IAM
- Secret Manager secrets (DB password, Odoo master/admin password)
- Kubernetes Service (LoadBalancer) with static external IP
- Cloud Monitoring uptime check and alert policies
- Backup CronJob (daily at 02:00 UTC)
- Redis environment variable injection (when `enable_redis = true`)

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
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
| `gcloud` | Authenticate, query GCP resources, read secrets |
| `kubectl` | Inspect pods, logs, exec into containers |
| Google Cloud Console | Cloud Logging, Cloud Monitoring, Secret Manager UI |

---

## Prerequisites

1. **Services_GCP deployed** — the `Odoo_GKE` module depends on `Services_GCP`. Ensure it is deployed in the same project and that a GKE Autopilot cluster exists.
2. **gcloud CLI authenticated** — run `gcloud auth application-default login`.
3. **kubectl configured** — see Phase 2 for the exact `gcloud` command.
4. **GCP project** with billing enabled and the following APIs active (the module enables them automatically on first deploy):
   - Kubernetes Engine, Cloud SQL, Cloud Build, Artifact Registry, Secret Manager, Cloud Storage, Cloud Monitoring.
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the Odoo_GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | **Yes** | — | GCP project ID |
| `deployment_id` | No | *(auto-generated)* | Stable suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `odoo` | Base name for Kubernetes deployment and secrets |
| `application_version` | No | `18.0` | Odoo version (maps to nightly build URL) |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum pod replicas (HPA minReplicas) |
| `max_instance_count` | No | `3` | Maximum pod replicas (HPA maxReplicas) |
| `container_resources` | No | `{cpu_limit="1000m", memory_limit="512Mi"}` | Pod resource limits |
| `application_database_name` | No | `gkeappdb` | PostgreSQL database name |
| `application_database_user` | No | `gkeappuser` | PostgreSQL user name |
| `enable_nfs` | No | `true` | Mount Cloud Filestore NFS share into pods |
| `gke_cluster_name` | No | `""` | Target GKE cluster name (auto-discovered when empty) |
| `tenant_deployment_id` | No | `demo` | Deployment environment identifier |
| `support_users` | No | `[]` | Email addresses for monitoring alert notifications |

> **Note on Odoo memory:** Odoo loads all active modules at startup and performs database migrations on first boot. For production, set `container_resources.memory_limit` to at least `2Gi` and allow generous `startup_probe_config.initial_delay_seconds` (default: 180 s).

### Deploy

Click **Deploy** in the RAD UI.

### Deployment Duration

| Stage | Estimated Duration |
|---|---|
| Cloud SQL PostgreSQL provisioning | 8–12 min |
| Cloud Build Odoo image build | 5–8 min |
| GKE namespace + workload rollout | 5–10 min (Odoo startup is slow on first boot) |
| NFS Filestore provisioning | 5–8 min |
| **Total (first deploy)** | **20–35 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP for the Odoo service |
| `service_url` | Full URL (`http://<IP>`) |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for DB password |
| `container_registry` | Artifact Registry repository |
| `namespace` | Kubernetes namespace |
| `deployment_id` | Unique deployment suffix |
| `nfs_server_ip` | NFS server internal IP (sensitive) |

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

# Discover the namespace (pattern: appodoodemo<deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appodoo" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~odoo" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Access the Cluster and Verify Pods [MANUAL]

### 1. Configure kubectl

```bash
gcloud container clusters get-credentials <CLUSTER_NAME> \
  --region <REGION> \
  --project <PROJECT_ID>
```

List available clusters:
```bash
gcloud container clusters list --project <PROJECT_ID>
```

**Expected result:** `kubeconfig entry generated for <CLUSTER_NAME>`.

### 2. Verify the Odoo Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One or more pods with status `Running` and `READY 2/2` (Odoo + Cloud SQL Auth Proxy sidecar).

> **Note:** Odoo performs database initialization on first boot and may take 2–5 minutes before its health endpoint (`/web/health`) responds. The startup probe waits up to 6 minutes by default (180 s initial delay + 3 retries × 120 s period).

```bash
kubectl describe pod <POD_NAME> -n ${NAMESPACE}
kubectl logs <POD_NAME> -c odoo -n ${NAMESPACE} --tail=100 -f
```

Look for log lines such as `Modules loaded` and `HTTP service (werkzeug) running`.

### 3. Retrieve the Service External IP

```bash
kubectl get svc -n ${NAMESPACE}
```

Note the `EXTERNAL-IP` for the LoadBalancer service.

**gcloud equivalent:**
```bash
gcloud compute addresses list --project <PROJECT_ID>
```

---

## Phase 3 — Complete Odoo Setup [MANUAL]

### 1. Open the Odoo URL

Navigate to `http://${EXTERNAL_IP}` in a browser.

On first visit, Odoo displays the **database manager** page at `/web/database/manager`.

### 2. Create the Odoo Database

Fill in the form:
- **Master Password** — retrieve from Secret Manager (see below)
- **Database Name** — e.g., `gkeappdb` (must match `application_database_name`)
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

### 2. Verify Files in NFS or GCS

Files uploaded through the Odoo UI are stored in the Odoo filestore path, which is mapped to the NFS mount (`/mnt/nfs`) or GCS Fuse volume.

Check from a pod:

```bash
kubectl exec -it <POD_NAME> -c odoo -n ${NAMESPACE} -- \
  ls /mnt/nfs/filestore/
```

Or check the GCS bucket directly:
```bash
gcloud storage ls gs://<BUCKET_NAME>/
```

**Expected result:** Uploaded files appear in the filestore directory or GCS bucket.

### 3. Check GCS Bucket Contents

```bash
gcloud storage ls --recursive gs://<PROJECT_ID>-odoo-data-<DEPLOYMENT_ID>/
```

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### 1. View Odoo Application Logs via kubectl

```bash
kubectl logs -l app=odoo -n ${NAMESPACE} --tail=100 -f
```

Look for:
- Gunicorn worker startup messages
- Database connection confirmation
- Module load logs (e.g., `Loading module crm`)

### 2. View Logs in Cloud Logging

Navigate to **Logging > Log Explorer** and run:

```
resource.type="k8s_container"
resource.labels.namespace_name="<NAMESPACE>"
resource.labels.container_name="odoo"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project ${PROJECT} \
  --limit 50 \
  --format "table(timestamp, jsonPayload.message)"
```

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

### 1. View GKE Metrics

In the Cloud Console, navigate to **Monitoring > Dashboards** and open the **GKE** dashboard. Observe CPU, memory, and pod count metrics for the Odoo namespace.

### 2. Check the Uptime Check

1. Navigate to **Monitoring > Uptime checks**.
2. Find the uptime check created for this deployment (named after `application_name`).
3. Verify that the check is passing (green) from multiple global locations.

**gcloud equivalent:**
```bash
gcloud monitoring uptime list-configs --project ${PROJECT}
```

### 3. View Alert Policies

Navigate to **Monitoring > Alerting** to review any alert policies created by the module.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

> **Warning:** This deletes the Cloud SQL database, GCS bucket contents, and NFS data. Ensure database backups are taken before undeploying if data needs to be preserved.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | What You Did |
|---|---|---|
| Phase 1 — Deploy | Automated | Provisioned GKE workload, Cloud SQL (PostgreSQL), NFS (Filestore), GCS, Artifact Registry, secrets |
| Phase 2 — Cluster Access | Manual | Configured kubectl, verified Odoo pod status and external IP |
| Phase 3 — Setup | Manual | Created Odoo database, retrieved master password from Secret Manager, logged in |
| Phase 4 — ERP Modules | Manual | Installed CRM and Project; created leads, opportunities, and tasks |
| Phase 5 — Settings | Manual | Activated developer mode, explored data model, multi-company, user roles |
| Phase 6 — Storage | Manual | Uploaded documents, verified NFS and GCS Fuse file storage |
| Phase 7 — Logging | Manual | Explored Odoo gunicorn/worker logs via kubectl and Cloud Logging |
| Phase 8 — Monitoring | Manual | Reviewed uptime check, GKE metrics, alert policies |
| Phase 9 — Undeploy | Automated | Tore down all module-managed infrastructure |
