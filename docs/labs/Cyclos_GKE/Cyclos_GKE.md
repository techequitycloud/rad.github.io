---
title: "Cyclos on GKE — Lab Guide"
sidebar_label: "Cyclos GKE"
---

# Cyclos on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cyclos_GKE)**

## Overview

**Estimated time:** 1–2 hours

Cyclos is a comprehensive digital banking platform for managing custom currencies, community banking, savings, loans, payment channels, and digital wallets. This lab deploys Cyclos Community Edition on GKE Autopilot, backed by Cloud SQL PostgreSQL 15 with automated database initialization (PostGIS, pg_trgm extensions), Workload Identity, and Kubernetes-native horizontal scaling.

### What the Module Automates

- GKE Autopilot cluster discovery and namespace creation
- Cloud SQL PostgreSQL 15 instance provisioning with private IP
- Database user, password, and extensions (PostGIS, pg_trgm) via initialization Kubernetes Job
- Artifact Registry repository and container image mirroring from Docker Hub
- Secret Manager secrets for database credentials (with 30-day rotation notifications)
- Kubernetes Deployment, Service (LoadBalancer), and HPA
- Cloud Storage bucket for application data
- Workload Identity binding between the Kubernetes service account and GCP IAM
- Cloud Monitoring uptime check and notification channels
- Optional NFS Filestore mount (disabled by default; Cyclos uses GCS)
- Static external IP reservation

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Retrieve the admin password from Secret Manager
- Complete the initial Cyclos configuration wizard in the browser
- Configure payment channels, currencies, and account types
- Create test users and perform sample transactions
- Explore Cloud Logging and Cloud Monitoring dashboards

---

## CLI and REST API Overview

This lab uses `gcloud` CLI and `kubectl` to inspect deployed resources. The equivalent REST API calls are shown where relevant.

**Get service external IP:**
```bash
# gcloud
gcloud compute addresses list --project=PROJECT_ID

# REST
GET https://compute.googleapis.com/compute/v1/projects/PROJECT_ID/global/addresses
```

**Get a secret value:**
```bash
# gcloud
gcloud secrets versions access latest --secret=SECRET_NAME --project=PROJECT_ID

# REST
GET https://secretmanager.googleapis.com/v1/projects/PROJECT_ID/secrets/SECRET_NAME/versions/latest:access
```

**List GKE pods:**
```bash
# gcloud (get cluster credentials first)
gcloud container clusters get-credentials CLUSTER_NAME --region=REGION --project=PROJECT_ID

# kubectl
kubectl get pods -n NAMESPACE
```

**Describe a Kubernetes deployment:**
```bash
kubectl describe deployment cyclos -n NAMESPACE

# REST (via GKE API)
GET https://container.googleapis.com/v1/projects/PROJECT_ID/locations/REGION/clusters/CLUSTER_NAME
```

---

## Prerequisites

Before beginning this lab, ensure the following are in place:

1. **Services GCP module deployed** — Cyclos GKE depends on `Services GCP` for the VPC network, Cloud SQL instance, GKE Autopilot cluster, and Artifact Registry.
2. **GCP project with billing enabled.**
3. **Access to the RAD UI** with permission to deploy modules in the target GCP project.
4. **`gcloud` CLI installed and authenticated** (`gcloud auth login && gcloud auth application-default login`).
5. **`kubectl` installed** — available via `gcloud components install kubectl`.
6. **Sufficient IAM permissions** — Owner or equivalent role on the target project.

---

## Phase 1 — Deploy [AUTOMATED]

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

**Key variables to configure in the RAD UI form:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID (6–30 chars, lowercase) |
| `deployment_id` | No | auto | Short suffix appended to all resource names |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `cyclos` | Base name for K8s deployment and secrets |
| `application_version` | No | `4.16.17` | Cyclos image version tag |
| `deploy_application` | No | `true` | Set `false` to provision infra without deploying |
| `min_instance_count` | No | `1` | Minimum HPA pod replicas |
| `max_instance_count` | No | `1` | Maximum HPA pod replicas |
| `gke_cluster_name` | No | auto | Target GKE cluster name (auto-discovers if empty) |
| `db_name` | No | `cyclos` | PostgreSQL database name |
| `db_user` | No | `cyclos` | PostgreSQL database username |
| `database_password_length` | No | `32` | Generated password length (16–64) |
| `cpu_limit` | No | `2000m` | Container CPU limit (min 2 vCPU recommended) |
| `memory_limit` | No | `4Gi` | Container memory limit (min 2Gi; 4Gi recommended) |
| `backup_schedule` | No | `0 2 * * *` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files in GCS |
| `enable_nfs` | No | `false` | Enable NFS mount (Cyclos uses GCS by default) |

**What the deployment creates:**
- Kubernetes namespace derived from `application_name` and `tenant_deployment_id`
- Cloud SQL PostgreSQL 15 database `cyclos` with user `cyclos` (password in Secret Manager)
- A Kubernetes init Job that creates the DB user, database, and installs PostGIS and pg_trgm
- Cyclos Deployment with startup probe (HTTP `/api`, 90s initial delay) and liveness probe (HTTP `/api`, 120s initial delay)
- LoadBalancer Service with `ClientIP` session affinity
- Static external IP (reserved by default via `reserve_static_ip = true`)
- GCS bucket (`<prefix>-data`) for application data
- Cloud Monitoring uptime check against `/`

**Estimated provisioning duration:**

| Resource | Estimated Time |
|---|---|
| Cloud SQL PostgreSQL 15 instance | 5–8 min |
| Container image mirroring (Cloud Build) | 3–5 min |
| Kubernetes Deployment rollout | 3–5 min |
| Secret Manager secrets | < 1 min |
| Static IP reservation | < 1 min |
| **Total** | **~12–20 min** |

### Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | External URL for the Cyclos service |
| `service_external_ip` | LoadBalancer IP |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |

Set shell variables for use in later steps using discovery commands:

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

# Discover the namespace (pattern: app<appname><tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appcyclos" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Discover the database password secret
export DB_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~cyclos" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Access the GKE Cluster [MANUAL]

Configure `kubectl` access and verify that the Cyclos pods are running before proceeding.

**Step 1 — Get GKE cluster credentials:**
```bash
# List available clusters
gcloud container clusters list --project=${PROJECT}

# Fetch credentials for the Cyclos cluster
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}
```

**Step 2 — Verify pods are running:**
```bash
# List all pods in the Cyclos namespace
kubectl get pods -n ${NAMESPACE}

# Expected output: one pod with STATUS = Running
# NAME                      READY   STATUS    RESTARTS   AGE
# cyclos-xxxxxxxxx-xxxxx    1/1     Running   0          5m

# Check the init job completed successfully
kubectl get jobs -n ${NAMESPACE}

# View pod logs if the pod is not yet Running
kubectl logs -n ${NAMESPACE} -l app=cyclos --tail=50
```

**Step 3 — Confirm the external IP is assigned:**
```bash
kubectl get svc -n ${NAMESPACE}

# Note the EXTERNAL-IP column value
# NAME     TYPE           CLUSTER-IP    EXTERNAL-IP    PORT(S)
# cyclos   LoadBalancer   10.x.x.x      34.x.x.x       8080:xxxxx/TCP
```

The Cyclos UI is accessible at `http://${EXTERNAL_IP}:8080/cyclos` once the startup probe passes (allow 2–5 minutes for first-boot schema creation).

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
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${DB_SECRET}/versions/latest:access"
```

The default Cyclos admin credentials after first boot are `admin` / `1234`. You should change this password immediately.

**Step 2 — Navigate to the Cyclos UI:**
1. Open `http://${EXTERNAL_IP}:8080/cyclos` in your browser.
2. Wait for the startup probe to succeed if the page is not yet reachable (allow up to 5 minutes on first boot while the schema is created).
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
4. Observe that the change is reflected immediately without a restart.

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

Cyclos runs on Apache Tomcat. Review the Tomcat application logs in Cloud Logging.

**Step 1 — Access Cloud Logging via the console:**
1. Open the Google Cloud Console at [console.cloud.google.com](https://console.cloud.google.com).
2. Navigate to **Logging** > **Log Explorer**.
3. Set the project to your deployment project.

**Step 2 — Filter Cyclos Tomcat logs:**

Use the following filter in the Log Explorer query field:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="cyclos"
```

**Step 3 — Review log entries:**
1. Observe Tomcat startup messages and Cyclos initialization output.
2. Filter for `severity=ERROR` to check for any application errors.
3. Look for database connection pool messages confirming PostgreSQL connectivity.

**Step 4 — Stream logs via gcloud:**
```bash
# Stream logs from the Cyclos container
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} \
  --freshness=1h \
  --format="table(timestamp,severity,textPayload)"

# REST equivalent
GET https://logging.googleapis.com/v2/entries:list
# with filter and resourceNames in the request body
```

---

## Phase 8 — Explore Cloud Monitoring [MANUAL]

Review the Cloud Monitoring metrics and uptime check configured by the deployment.

**Step 1 — Access the Monitoring dashboard:**
1. Navigate to **Monitoring** > **Dashboards** in the Cloud Console.
2. Click on **GKE** to view the pre-built Kubernetes dashboard.

**Step 2 — Review GKE workload metrics:**
1. Navigate to **Monitoring** > **Metrics Explorer**.
2. Select resource type **Kubernetes Container**.
3. Plot the following metrics for the Cyclos namespace:
   - `kubernetes.io/container/cpu/usage_time` — CPU usage
   - `kubernetes.io/container/memory/used_bytes` — memory usage
   - `kubernetes.io/container/restart_count` — container restarts

**Step 3 — Review the uptime check:**
1. Navigate to **Monitoring** > **Uptime checks**.
2. Find the uptime check created by the deployment (named after the deployment).
3. Review the check configuration: path `/`, interval 60s, timeout 10s.
4. Observe the global check status — green indicates the service is reachable from all probe locations.

**Step 4 — Review alert policies:**
1. Navigate to **Monitoring** > **Alerting**.
2. Review any alert policies configured by the deployment.
3. Note the notification channels (email addresses from `support_users`).

**Step 5 — Query metrics via gcloud:**
```bash
# List uptime checks
gcloud monitoring uptime list-configs --project=${PROJECT}

# REST
GET https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs
```

---

## Phase 9 — Delete [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Delete** to remove all resources provisioned by this module.

**Expected result:** All Kubernetes workloads, Cloud SQL instance, GCS buckets, Secret Manager secrets, static IP, and IAM bindings are removed.

> Note: `enable_purge = true` (default) allows full deletion. If set to `false`, resources are retained after deletion.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be deleted via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | AUTOMATED | RAD UI provisions GKE workload, Cloud SQL, GCS, IAM, monitoring |
| Phase 2 — Cluster Access | MANUAL | `kubectl` access, verify pods and external IP |
| Phase 3 — Initial Config | MANUAL | Log into Cyclos, complete setup wizard, change admin password |
| Phase 4 — Payment Channels | MANUAL | Review and configure web/mobile/POS/API channels |
| Phase 5 — Users & Accounts | MANUAL | Create users, assign accounts, perform test payment |
| Phase 6 — Currency & Products | MANUAL | Explore account types, currencies, transfer types, fees |
| Phase 7 — Cloud Logging | MANUAL | View Tomcat logs in Log Explorer |
| Phase 8 — Cloud Monitoring | MANUAL | Review GKE metrics, uptime check, alert policies |
| Phase 9 — Delete | AUTOMATED | RAD UI removes all resources |
