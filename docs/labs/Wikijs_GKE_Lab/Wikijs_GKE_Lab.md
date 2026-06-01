---
title: "Wiki.js on GKE — Lab Guide"
sidebar_label: "Wikijs GKE Lab"
---

# Wiki.js on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wikijs_GKE)**

## Overview

**Estimated time:** 1–2 hours

This lab walks you through deploying Wiki.js on Google Kubernetes Engine (GKE) Autopilot using the `Wikijs_GKE` module, then verifying and exploring the deployment manually. The module handles all GCP infrastructure; you perform the post-deployment steps interactively.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment (HPA min/max replicas)
- Cloud SQL PostgreSQL 15 instance, database, and user; `pg_trgm` extension installed automatically
- Cloud Build image build and push to Artifact Registry
- GCS Fuse CSI volume for Wiki.js asset storage (`/wiki-storage`)
- Cloud Filestore (NFS) optional persistent share (`/mnt/nfs`)
- Cloud SQL Auth Proxy sidecar (Unix socket at `/cloudsql`)
- Workload Identity binding and least-privilege IAM
- Secret Manager secrets (DB password, JWT secret)
- Kubernetes Service (LoadBalancer) with static external IP
- Cloud Monitoring uptime check and alert policies
- Backup CronJob (daily at 02:00 UTC)
- Redis environment variable injection (when `enable_redis = true`)

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Complete the Wiki.js first-run setup wizard (or retrieve seeded admin credentials from Secret Manager)
- Create pages and explore the Markdown editor
- Test full-text search powered by `pg_trgm`
- Configure authentication providers and access-control groups
- Verify GCS Fuse asset storage
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

1. **Services_GCP deployed** — the `Wikijs_GKE` module depends on `Services_GCP`. Ensure it is deployed in the same project and that a GKE Autopilot cluster exists.
2. **gcloud CLI authenticated** — run `gcloud auth application-default login`.
3. **kubectl configured** — see Phase 2 for the exact `gcloud` command.
4. **Access to the RAD UI** with permission to deploy modules in the target GCP project.
5. **GCP project** with billing enabled and the following APIs active (the module enables them automatically on first deploy):
   - Kubernetes Engine, Cloud SQL, Cloud Build, Artifact Registry, Secret Manager, Cloud Storage, Cloud Monitoring.

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

In the RAD UI, open the Wikijs_GKE module and fill in the deployment form:

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | **Yes** | — | GCP project ID |
| `deployment_id` | No | *(auto-generated)* | Stable suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `wikijs` | Base name for Kubernetes deployment and secrets |
| `application_version` | No | `2.5.311` | Container image version tag |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure only |
| `min_instance_count` | No | `1` | Minimum pod replicas (HPA minReplicas) |
| `max_instance_count` | No | `3` | Maximum pod replicas (HPA maxReplicas) |
| `container_resources` | No | `{cpu_limit="1000m", memory_limit="2Gi"}` | Pod resource limits |
| `application_database_name` | No | `wikijs` | PostgreSQL database name |
| `application_database_user` | No | `wikijs` | PostgreSQL user name |
| `enable_redis` | No | `false` | Enable Redis session/cache backend |
| `redis_host` | No | `""` | Redis hostname or IP (required when `enable_redis=true`) |
| `enable_nfs` | No | `true` | Mount Cloud Filestore NFS share into pods |
| `gke_cluster_name` | No | `""` | Target GKE cluster name (auto-discovered when empty) |
| `tenant_deployment_id` | No | `demo` | Deployment environment identifier |
| `support_users` | No | `[]` | Email addresses for monitoring alert notifications |

### Deploy

Click **Deploy** in the RAD UI.

### Deployment Duration

| Stage | Estimated Duration |
|---|---|
| Cloud SQL PostgreSQL 15 provisioning | 8–12 min |
| Cloud Build image build | 3–5 min |
| GKE namespace + workload rollout | 3–5 min |
| NFS Filestore provisioning (if enabled) | 5–8 min |
| **Total (first deploy)** | **15–25 min** |

### Key Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel:

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP for the Wiki.js service |
| `service_url` | Full URL (`http://<IP>`) |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for DB password |
| `container_registry` | Artifact Registry repository |
| `namespace` | Kubernetes namespace |
| `deployment_id` | Unique deployment suffix |

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

# Discover the namespace (pattern: appwikijs<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appwikijs" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~wikijs" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Access the Cluster and Verify Pods [MANUAL]

### 1. Configure kubectl

```bash
gcloud container clusters get-credentials ${CLUSTER} \
  --region ${REGION} \
  --project ${PROJECT}
```

**Expected result:** `kubeconfig entry generated for <CLUSTER_NAME>`.

gcloud equivalent to list clusters:
```bash
gcloud container clusters list --project ${PROJECT}
```

### 2. Verify the Wiki.js Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** One or more pods with status `Running` and `READY 2/2` (main container + Cloud SQL Auth Proxy sidecar).

```bash
kubectl describe pod <POD_NAME> -n ${NAMESPACE}
kubectl logs <POD_NAME> -c wikijs -n ${NAMESPACE}
```

### 3. Retrieve the Service External IP

```bash
kubectl get svc -n ${NAMESPACE}
```

Note the `EXTERNAL-IP` for the LoadBalancer service. This matches the `service_external_ip` output shown in the RAD UI deployment panel.

**REST API equivalent:**
```bash
gcloud compute addresses list --project ${PROJECT}
```

---

## Phase 3 — Complete Wiki.js Setup [MANUAL]

### 1. Open the Wiki.js URL

Navigate to `http://${EXTERNAL_IP}` in a browser.

On first run, Wiki.js displays the setup wizard (if the database is empty) or the login page (if the module seeded initial state).

### 2. Retrieve Admin Credentials from Secret Manager

```bash
gcloud secrets versions access latest \
  --secret="${DB_SECRET}" \
  --project ${PROJECT}
```

If the secret name differs, list available secrets:
```bash
gcloud secrets list --project ${PROJECT} --filter="name~wikijs"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access"
```

### 3. Complete the Setup Wizard (if displayed)

- Enter site title, admin email, and admin password.
- Click **Install**.

**Expected result:** Wiki.js redirects to the home page or admin dashboard.

### 4. Log In and Explore the Admin Panel

- Navigate to **Administration** (gear icon in the sidebar).
- Review General settings, Theme, and SEO configuration.

---

## Phase 4 — Create Pages and Content [MANUAL]

### 1. Create a New Page

1. Click **New Page** in the top navigation.
2. Choose **Markdown** as the editor.
3. Set a page path (e.g., `lab/getting-started`).
4. Add content including:
   - Headings (`# H1`, `## H2`)
   - A code block (triple backtick)
   - A table
5. Click **Create** to save.

**Expected result:** The page renders and appears in the left navigation tree.

### 2. Create a Page Tree (Nested Pages)

Create additional pages with paths like `lab/architecture` and `lab/deployment`. Wiki.js automatically groups them under `lab/` in the navigation.

### 3. Add Tags

Open a page, click **Page Actions > Properties**, add one or more tags (e.g., `gcp`, `tutorial`), and save.

### 4. View the Public Page

Navigate to the page URL directly (without being logged in) to verify public read access if the wiki is configured for open access.

---

## Phase 5 — Search Functionality [MANUAL]

### 1. Use the Wiki.js Search

Click the search icon in the top bar, type a keyword from one of your pages, and observe the full-text results.

**Expected result:** Pages containing the keyword appear in results. Search is powered by PostgreSQL `pg_trgm` trigram indexing.

### 2. Verify the pg_trgm Search Engine

1. Navigate to **Administration > Search Engine**.
2. Confirm **Database — PostgreSQL** is selected as the search engine.
3. Click **Rebuild Index** to force a re-index of all pages.

**Verify extension directly (optional):**
```bash
kubectl exec -it <POD_NAME> -c cloud-sql-proxy -n ${NAMESPACE} -- \
  psql -U wikijs -d wikijs -c "\dx pg_trgm"
```

---

## Phase 6 — Authentication and Access Control [MANUAL]

### 1. Review Local Authentication

1. Navigate to **Administration > Authentication**.
2. Click on the **Local** strategy — this is active by default.
3. Review settings such as self-registration and login via email.

### 2. Explore Additional Auth Providers

Review the available providers listed on the Authentication page:
- **SAML 2.0** — for enterprise SSO integration
- **OAuth 2.0 / OpenID Connect** — for Google, GitHub, or custom providers
- **LDAP / Active Directory** — for corporate directory integration

No activation is required for this lab.

### 3. Manage Groups and Permissions

1. Navigate to **Administration > Groups**.
2. Observe the default **Administrators** and **Guests** groups.
3. Click **Administrators** and review the page permissions rules.
4. Click **New Group**, name it `Editors`, assign read+write permissions to `/`, and save.

---

## Phase 7 — Storage and Assets [MANUAL]

### 1. Upload an Image in the Page Editor

1. Open or create a page in Markdown editor.
2. Click the image icon in the toolbar.
3. Upload a local image file.

**Expected result:** The image is stored in the GCS bucket mounted at `/wiki-storage` via GCS Fuse.

### 2. Verify GCS Fuse Configuration

Navigate to **Administration > Storage**. Confirm that a storage target using the `/wiki-storage` path is active (this corresponds to the GCS Fuse volume mounted by the `gcs_volumes` or default storage bucket configuration).

### 3. Check the GCS Bucket

```bash
gcloud storage ls --project=${PROJECT} | grep wikijs
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://storage.googleapis.com/storage/v1/b?project=${PROJECT}&prefix=wikijs"
```

**Expected result:** Uploaded images appear as objects in the bucket.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

### 1. View Wiki.js Application Logs via kubectl

```bash
kubectl logs -l app=wikijs -n ${NAMESPACE} --tail=100 -f
```

Look for startup messages such as database connection confirmation and search index initialization.

### 2. View Logs in Cloud Logging

In the Google Cloud Console, navigate to **Logging > Log Explorer** and run:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="wikijs"
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

## Phase 9 — Explore Cloud Monitoring [MANUAL]

### 1. View GKE Metrics

In the Cloud Console, navigate to **Monitoring > Dashboards** and open the **GKE** dashboard. Observe CPU, memory, and pod count metrics for the Wiki.js namespace.

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

## Phase 10 — Undeploy [AUTOMATED]

When you are finished with the lab, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

> **Warning:** This deletes the Cloud SQL database, GCS bucket contents, and NFS data. Ensure backups are taken before undeploying if data needs to be preserved.

Resources provisioned by the `Services_GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | What You Did |
|---|---|---|
| Phase 1 — Deploy | Automated | Provisioned GKE workload, Cloud SQL (PostgreSQL 15 + pg_trgm), GCS Fuse, NFS, secrets |
| Phase 2 — Cluster Access | Manual | Configured kubectl, verified pod status and external IP |
| Phase 3 — Setup | Manual | Completed Wiki.js first-run wizard, retrieved admin credentials from Secret Manager |
| Phase 4 — Content | Manual | Created pages with Markdown, nested page tree, tags |
| Phase 5 — Search | Manual | Tested pg_trgm full-text search, verified search engine config |
| Phase 6 — Auth | Manual | Reviewed local auth, explored SAML/OAuth/LDAP providers, managed groups |
| Phase 7 — Storage | Manual | Uploaded assets, verified GCS Fuse mount and bucket contents |
| Phase 8 — Logging | Manual | Explored Wiki.js logs via kubectl and Cloud Logging |
| Phase 9 — Monitoring | Manual | Reviewed uptime check, GKE metrics, alert policies |
| Phase 10 — Undeploy | Automated | RAD UI removes all module-managed infrastructure |
