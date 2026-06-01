# Zammad on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Zammad_GKE)**

## Overview

**Estimated time:** 2–3 hours

Zammad is an open-source helpdesk and customer support ticketing platform. This lab deploys Zammad 6.x on GKE Autopilot backed by Cloud SQL PostgreSQL 15, Cloud Filestore NFS for attachment storage, and Redis caching. GKE Autopilot provides fully managed Kubernetes with automatic node provisioning and scaling.

### What the Module Automates

- GKE Kubernetes Deployment (or StatefulSet) with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user (via Kubernetes init Job)
- Cloud Filestore (NFS) instance mounted at `/opt/zammad/storage`
- GCS `zammad-attachments` bucket
- Custom container image built by Cloud Build (extends `zammad/zammad` with GCP entrypoint)
- Artifact Registry repository with Docker Hub mirror
- Secret Manager secrets with Workload Identity access
- Kubernetes Service (LoadBalancer with ClientIP session affinity)
- PodDisruptionBudget for high availability
- Cloud Monitoring uptime check at `/api/v1/ping`
- Automated backup Kubernetes CronJob

### What You Do Manually

- Note the external IP from the RAD UI deployment panel
- Complete the Zammad first-run setup wizard
- Create agents, groups, and roles
- Configure email channels (inbound IMAP/POP3 and outbound SMTP)
- Create and manage tickets
- Set up SLA policies
- Review Cloud Logging and Kubernetes metrics

---

## CLI Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Access GKE cluster, view Cloud Logging, manage secrets |
| `kubectl` | Inspect Kubernetes workloads, pods, and services |
| `curl` | Test the Zammad API |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (includes GKE Autopilot cluster).
3. The following APIs enabled (Services GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
   - `file.googleapis.com`
4. `gcloud` and `kubectl` authenticated:
   ```bash
   gcloud auth application-default login
   gcloud components install kubectl
   ```
5. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g., `"prod"`) |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"zammad"` | Base name for Kubernetes resources |
| `application_version` | No | `"6.4.1"` | Zammad container image version |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the workload |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `container_resources` | No | `{ cpu_limit: "2000m", memory_limit: "4Gi" }` | CPU/memory limits |
| `application_database_name` | No | `"zammad"` | PostgreSQL database name |
| `application_database_user` | No | `"zammad"` | PostgreSQL user |
| `enable_redis` | No | `true` | Enable Redis (required for Zammad) |
| `redis_host` | No | `""` | Redis host (defaults to NFS server IP when empty) |
| `redis_port` | No | `"6379"` | Redis port |
| `enable_nfs` | No | `true` | Mount NFS for attachment storage |
| `nfs_mount_path` | No | `"/opt/zammad/storage"` | NFS mount path |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |
| `session_affinity` | No | `"ClientIP"` | Session affinity mode |
| `enable_pod_disruption_budget` | No | `true` | PDB for availability during maintenance |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL instance creation | 8–12 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| NFS provisioning | 3–5 min |
| GKE workload deployment | 3–5 min |
| Kubernetes init Job (db-init) | 2–3 min |
| Zammad DB migrations (first pod start) | 2–5 min |
| **Total** | **23–40 min** |

### Step 1.3 — Set Up kubectl Access

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --region=${REGION} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

echo "kubectl context: $(kubectl config current-context)"
```

### Step 1.4 — Record Outputs and Discover Resources

```bash
# Discover the Zammad namespace
export NAMESPACE=$(kubectl get namespaces \
  -o jsonpath='{.items[*].metadata.name}' \
  | tr ' ' '\n' | grep zammad | head -1)

# Discover the Zammad service
export SVC=$(kubectl get services -n ${NAMESPACE} \
  -o jsonpath='{.items[0].metadata.name}' \
  --field-selector=spec.type=LoadBalancer 2>/dev/null || \
  kubectl get services -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')

# Get external IP
export EXTERNAL_IP=$(kubectl get service ${SVC} -n ${NAMESPACE} \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
export SERVICE_URL="http://${EXTERNAL_IP}"

echo "Zammad URL: ${SERVICE_URL}"
```

---

## Phase 2 — Verify the Deployment [MANUAL]

### Step 2.1 — Check Pod Status

```bash
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** All Zammad pods in `Running` state.

```bash
kubectl describe pod -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}')
```

**Expected result:** Events section shows successful container starts with no restart loops.

### Step 2.2 — Check the Health Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/api/v1/ping
```

**Expected result:** HTTP `200`. If you see a connection error, wait for the LoadBalancer IP to be assigned and Zammad to complete its startup migrations (allow up to 5 minutes).

### Step 2.3 — View Zammad Logs

```bash
kubectl logs -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  --tail=50
```

**Expected result:** Logs show `[cloud-entrypoint]` mapping messages, `zammad-init` migration completion, and the `Zammad is running` banner.

**gcloud Cloud Logging equivalent:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"${NAMESPACE}\"" \
  --project=${PROJECT} \
  --limit=30 \
  --format="table(timestamp, textPayload)"
```

### Step 2.4 — Inspect the Kubernetes Deployment

```bash
kubectl get deployment -n ${NAMESPACE}
kubectl get service -n ${NAMESPACE}
kubectl get pdb -n ${NAMESPACE}
```

**Expected result:**
- Deployment shows `1/1` (or more) ready replicas
- Service shows the external LoadBalancer IP
- PDB shows `1` min available

---

## Phase 3 — First-Run Setup [MANUAL]

### Step 3.1 — Access the Setup Wizard

Open a browser and navigate to `${SERVICE_URL}`.

Zammad displays a first-run wizard on the initial visit.

**Expected result:** A setup wizard appears with steps for system configuration, email settings, and admin account creation.

### Step 3.2 — Complete the Setup Wizard

1. **Language and timezone** — Select your preferred language and timezone.
2. **Email notification settings** — Configure the outbound email address (or skip and configure SMTP later).
3. **Admin account** — Enter administrator name, email, and password. Store credentials securely.
4. **Organisation name** — Enter your company/organisation name.

**Expected result:** After completing the wizard, you are redirected to the Zammad admin dashboard at `${SERVICE_URL}/#/dashboard`.

### Step 3.3 — Generate an API Token

1. Log into Zammad admin.
2. Click the user icon (top-right) → **Profile** → **Token Access**.
3. Click **Create** and note the token — it is shown only once.

```bash
export ZAMMAD_TOKEN="your-generated-api-token"
```

---

## Phase 4 — Configure Email Channels [MANUAL]

### Step 4.1 — Configure Outbound SMTP

1. Navigate to **Admin → Channels → Email**.
2. Under **Outgoing**, configure your SMTP server.
3. Click **Test Outbound Email**.

### Step 4.2 — Configure Inbound Email

1. Under **Incoming**, click **Add Account** and configure IMAP or POP3.
2. Click **Test Incoming Email**.

**Expected result:** Test emails are converted into tickets in the Zammad queue.

### Step 4.3 — Verify Email Channels via API

```bash
curl -s \
  -H "Authorization: Token token=${ZAMMAD_TOKEN}" \
  "${SERVICE_URL}/api/v1/channels" \
  | python3 -m json.tool
```

**Expected result:** A JSON array listing configured email channels.

---

## Phase 5 — Agent and Group Setup [MANUAL]

### Step 5.1 — Create Agent Groups

1. Navigate to **Admin → Groups** → **New Group**.
2. Create groups representing support teams (e.g., "IT Support", "Billing").

**kubectl — check resource quota (if configured):**
```bash
kubectl describe resourcequota -n ${NAMESPACE}
```

### Step 5.2 — Create Agent Accounts

1. Navigate to **Admin → Users** → **New User**.
2. Set **Role** to `Agent` and assign to a group.

**REST API — create an agent:**
```bash
curl -s -X POST \
  -H "Authorization: Token token=${ZAMMAD_TOKEN}" \
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

**Expected result:** Agent account created and visible in **Admin → Users**.

---

## Phase 6 — Create and Manage Tickets [MANUAL]

### Step 6.1 — Create a Test Ticket via API

```bash
curl -s -X POST \
  -H "Authorization: Token token=${ZAMMAD_TOKEN}" \
  -H "Content-Type: application/json" \
  "${SERVICE_URL}/api/v1/tickets" \
  -d '{
    "title": "GKE test ticket",
    "group": "Users",
    "customer": "customer@example.com",
    "article": {
      "subject": "GKE Test",
      "body": "Test ticket created via API on GKE deployment.",
      "type": "note",
      "internal": false
    }
  }' | python3 -m json.tool
```

**Expected result:** Ticket JSON with `id`, `number`, `state = "new"`.

### Step 6.2 — List Open Tickets

```bash
curl -s \
  -H "Authorization: Token token=${ZAMMAD_TOKEN}" \
  "${SERVICE_URL}/api/v1/tickets?state=open" \
  | python3 -m json.tool
```

### Step 6.3 — Close a Ticket via API

```bash
export TICKET_ID=1   # replace with actual ticket ID

curl -s -X PUT \
  -H "Authorization: Token token=${ZAMMAD_TOKEN}" \
  -H "Content-Type: application/json" \
  "${SERVICE_URL}/api/v1/tickets/${TICKET_ID}" \
  -d '{
    "state": "closed"
  }' | python3 -m json.tool
```

---

## Phase 7 — Kubernetes Operations [MANUAL]

### Step 7.1 — Inspect the PodDisruptionBudget

```bash
kubectl get pdb -n ${NAMESPACE} -o yaml
```

**Expected result:** PDB shows `minAvailable: 1` (or the configured value), ensuring at least one Zammad pod remains available during voluntary node maintenance.

### Step 7.2 — Scale the Deployment

```bash
# Scale to 2 replicas manually (for testing)
kubectl scale deployment -n ${NAMESPACE} \
  $(kubectl get deployment -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  --replicas=2

# Verify
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** Two Zammad pods running. HPA manages replicas automatically based on CPU/memory.

### Step 7.3 — Check Session Affinity

```bash
kubectl get service -n ${NAMESPACE} -o yaml | grep -A5 sessionAffinity
```

**Expected result:** `sessionAffinity: ClientIP` ensures each client is consistently routed to the same pod for WebSocket connection stability.

### Step 7.4 — Inspect the Cloud SQL Auth Proxy Sidecar

```bash
kubectl get pod -n ${NAMESPACE} -o jsonpath='{.items[0].spec.containers[*].name}' && echo
```

**Expected result:** Container names include both the `zammad` application container and the `cloud-sql-proxy` sidecar. The sidecar provides `127.0.0.1:5432` for PostgreSQL connectivity.

### Step 7.5 — View Zammad NFS Volume Mount

```bash
kubectl exec -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  -- ls /opt/zammad/storage
```

**Expected result:** The NFS volume is mounted and accessible. On a fresh deployment, the directory may be empty or contain initial Zammad storage structure.

---

## Phase 8 — Explore Cloud Logging [MANUAL]

### Step 8.1 — View Application Logs via gcloud

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"${NAMESPACE}\" AND resource.labels.container_name=\"zammad\"" \
  --project=${PROJECT} \
  --limit=30 \
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
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

### Step 8.2 — Filter for Errors

```bash
kubectl logs -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].metadata.name}') \
  | grep -E "ERROR|FATAL|error|fatal" | tail -20
```

**Expected result:** No critical errors under normal operation.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources.

**Approximate undeploy duration:** 20–30 minutes.

> **Warning:** This permanently deletes all Kubernetes workloads, the PostgreSQL database, NFS storage, and all Zammad ticket data. Export data before undeploying.

Resources provisioned by `Services GCP` (VPC, GKE cluster, Cloud SQL, NFS server) must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE Autopilot workload provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Kubernetes init Job (db-init) | 1 | Yes |
| Cloud Filestore NFS mount | 1 | Yes |
| GCS `zammad-attachments` bucket | 1 | Yes |
| Secret Manager credentials (Workload Identity) | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| PodDisruptionBudget | 1 | Yes |
| Configure kubectl access | 1 | No |
| Verify pod status | 2 | No |
| Health check via `/api/v1/ping` | 2 | No |
| First-run setup wizard | 3 | No |
| Generate API token | 3 | No |
| Configure email channels | 4 | No |
| Create agents and groups | 5 | No |
| Create and manage tickets | 6 | No |
| Kubernetes operations (scaling, PDB, NFS) | 7 | No |
| Review Cloud Logging | 8 | No |
| Undeploy infrastructure | 9 | Yes |
