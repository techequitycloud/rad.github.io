# Vaultwarden on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Vaultwarden_GKE)**

## Overview

**Estimated time:** 3–4 hours

Vaultwarden is an unofficial, lightweight Bitwarden-compatible server written in Rust. This lab deploys Vaultwarden on Google Kubernetes Engine (GKE) Autopilot with a StatefulSet backed by a persistent 10 Gi PVC, Cloud SQL PostgreSQL 15, and `ClientIP` session affinity for reliable client connections.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes StatefulSet
- Cloud SQL PostgreSQL 15 (or MySQL 8.0) instance, database, and user
- Cloud SQL Auth Proxy sidecar injection
- PersistentVolumeClaim (10 Gi) at `/data`
- Secret Manager secrets (database password)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer) with `ClientIP` session affinity
- PodDisruptionBudget (min 1 available)
- Cloud Monitoring uptime checks targeting `/alive`
- Automated daily backups with 30-day retention

### What You Do Manually

- Note deployment outputs from the RAD UI panel
- Configure kubectl with cluster credentials
- Create admin account (with `signups_allowed = true` initially)
- Disable signups after first account creation
- Connect Bitwarden clients to the self-hosted server
- Configure admin token and admin panel
- Configure SMTP for two-factor authentication
- Review logs and inspect the StatefulSet

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, query GCP resources |
| `kubectl` | Inspect pods, PVCs, StatefulSets, services |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project.
3. The following APIs enabled:
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. `kubectl` installed and in PATH.
6. Bitwarden client (desktop, mobile, or browser extension) for testing.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"1.32.7"` | Vaultwarden image version |
| `domain` | No | `""` | Public domain (e.g. `http://34.x.x.x`) for WebAuthn and email links |
| `signups_allowed` | No | `false` | **Set `true` for initial deploy** to register admin |
| `web_vault_enabled` | No | `true` | Enable the Vaultwarden web UI |
| `database_type` | No | `"POSTGRES_15"` | `"POSTGRES_15"` or `"MYSQL_8_0"` |
| `stateful_pvc_size` | No | `"10Gi"` | PVC size for Vaultwarden data |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `session_affinity` | No | `"ClientIP"` | Ensures consistent pod routing for clients |
| `enable_cloud_armor` | No | `false` | Cloud Armor WAF (recommended) |
| `backup_retention_days` | No | `30` | Backup retention days |
| `support_users` | No | `[]` | Monitoring alert emails |
| `resource_labels` | No | `{}` | Labels for all resources |

> **Important:** Set `signups_allowed = true` for the first deployment only. Redeploy with `signups_allowed = false` immediately after registering your admin account.

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| GKE namespace and StatefulSet provisioning | 2–3 min |
| Artifact Registry image build (Cloud Build) | 5–10 min |
| Vaultwarden pod start and health checks | 2–4 min |
| **Total** | **17–29 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `service_name` | Kubernetes service name |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret for the DB password |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
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

# Discover the namespace
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appvaultwarden" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

export VAULT_URL="http://${EXTERNAL_IP}"
echo "Vaultwarden URL: ${VAULT_URL}"
```

---

## Phase 2 — Configure kubectl [MANUAL]

### Step 2.1 — Fetch Cluster Credentials

```bash
gcloud container clusters get-credentials \
  $(gcloud container clusters list --project=${PROJECT} --format="value(name)" | head -1) \
  --region=${REGION} \
  --project=${PROJECT}
```

**gcloud equivalent:**
```bash
gcloud container clusters list --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters"
```

### Step 2.2 — Verify StatefulSet and PVC

```bash
kubectl get statefulset -n ${NAMESPACE}
kubectl get pods -n ${NAMESPACE}
kubectl get pvc -n ${NAMESPACE}
kubectl get svc -n ${NAMESPACE}
```

**Expected result:**
- StatefulSet shows `1/1` ready.
- Pod shows `Running`, `1/1` containers ready.
- PVC shows `Bound` with `10Gi`.
- Service shows an `EXTERNAL-IP`.

Wait for external IP:
```bash
kubectl get svc -n ${NAMESPACE} --watch
```

### Step 2.3 — Confirm Vaultwarden is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}/alive
```

**Expected result:** HTTP `200` with body `OK`.

### Step 2.4 — Verify Session Affinity

```bash
kubectl get svc -n ${NAMESPACE} -o jsonpath='{.items[0].spec.sessionAffinity}'
```

**Expected result:** `ClientIP` — ensures Bitwarden clients are routed to the same pod consistently.

---

## Phase 3 — Create Admin Account [MANUAL]

### Step 3.1 — Access the Web Vault

Open `http://${EXTERNAL_IP}` in a browser.

**Expected result:** The Vaultwarden login/registration page appears.

### Step 3.2 — Create an Admin Account

1. Click **Create account**.
2. Enter your email and a strong master password (minimum 12 characters).
3. Add a password hint (optional).
4. Click **Create account**.

**Expected result:** You are logged into the web vault.

### Step 3.3 — Disable Signups

Update `signups_allowed = false` in the RAD UI and redeploy.

Verify:
```bash
kubectl describe deployment -n ${NAMESPACE} | grep SIGNUPS_ALLOWED
```

**Expected result:** `SIGNUPS_ALLOWED = false`.

---

## Phase 4 — Connect Bitwarden Clients [MANUAL]

### Step 4.1 — Configure the Server URL

In the Bitwarden client (desktop, mobile, or browser extension):

1. On the login screen, click the gear icon.
2. Set **Server URL**: `http://${EXTERNAL_IP}`.
3. Click **Save**.

**Expected result:** The client connects and shows your custom server URL.

### Step 4.2 — Log In and Test Vault

1. Log in with your email and master password.
2. Create a **Login** item: username, password, URL.
3. Create a **Secure Note** with sensitive text.
4. Verify items sync across multiple clients.

**Expected result:** Items appear on all connected clients within seconds.

### Step 4.3 — Test Session Affinity Behaviour

Connect multiple clients simultaneously. All connections from the same source IP are routed to the same Vaultwarden pod. This prevents authentication issues with shared session state.

---

## Phase 5 — Configure Admin Panel [MANUAL]

### Step 5.1 — Set Admin Token

Generate a secure token:
```bash
openssl rand -hex 32
```

Add to your deployment's `environment_variables`:
```hcl
environment_variables = {
  ADMIN_TOKEN = "your-generated-token-here"
}
```

Redeploy via the RAD UI.

Verify:
```bash
kubectl describe deployment -n ${NAMESPACE} | grep ADMIN_TOKEN
```

### Step 5.2 — Access and Explore the Admin Panel

Navigate to `http://${EXTERNAL_IP}/admin` and enter the admin token.

**gcloud equivalent (check env vars):**
```bash
gcloud secrets list --project=${PROJECT} --filter="name~vaultwarden"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3A~vaultwarden"
```

**Expected result:** The admin panel loads showing:
- **Users** — manage registered accounts
- **Organisations** — create shared vaults
- **Settings** — global security policies

---

## Phase 6 — Configure SMTP [MANUAL]

### Step 6.1 — Create SMTP Password Secret

```bash
echo -n "your-smtp-password" | gcloud secrets create vaultwarden-smtp-password \
  --data-file=- --project=${PROJECT}
```

**gcloud equivalent (list secrets):**
```bash
gcloud secrets list --project=${PROJECT} --filter="name~vaultwarden"
```

### Step 6.2 — Add SMTP Configuration

Update deployment variables:

```hcl
environment_variables = {
  SMTP_HOST      = "smtp.mailgun.org"
  SMTP_PORT      = "587"
  SMTP_FROM      = "vault@yourdomain.com"
  SMTP_FROM_NAME = "Vaultwarden"
  SMTP_SSL       = "true"
  SMTP_USERNAME  = "postmaster@mg.yourdomain.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "vaultwarden-smtp-password"
}
```

After redeploy, restart the pod to pick up the new secret:

```bash
kubectl rollout restart statefulset -n ${NAMESPACE}
kubectl rollout status statefulset -n ${NAMESPACE}
```

---

## Phase 7 — Explore Cloud Logging [MANUAL]

### Step 7.1 — View Vaultwarden Pod Logs

In **Logging > Logs Explorer**:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="vaultwarden"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\"",
    "pageSize": 20
  }'
```

**Expected result:** Vaultwarden startup logs showing `Rocket launch`. At `LOG_LEVEL=warn`, only warnings/errors appear under normal operation.

---

## Phase 8 — Inspect StatefulSet Behaviour [MANUAL]

### Step 8.1 — Simulate Pod Restart

```bash
kubectl delete pod -n ${NAMESPACE} $(kubectl get pods -n ${NAMESPACE} -o name | head -1)
kubectl get pods -n ${NAMESPACE} --watch
```

**Expected result:** Kubernetes immediately recreates the pod. The PVC remains bound — all vault data is preserved.

### Step 8.2 — Verify PVC Contents Persist

After pod restart, log in to the web vault.

**Expected result:** All vault items created before the restart are still present. The PVC persists data across pod restarts.

### Step 8.3 — Check PodDisruptionBudget

```bash
kubectl get pdb -n ${NAMESPACE}
kubectl describe pdb -n ${NAMESPACE}
```

**Expected result:** PDB shows `minAvailable: 1`. GKE Autopilot node upgrades will not evict the Vaultwarden pod unless a replacement is ready.

---

## Phase 9 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** Undeploying permanently deletes all resources including the PVC and database. Export your vault from any Bitwarden client (Settings > Export vault > .json) before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE StatefulSet and PVC provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Container image build | 1 | Yes |
| Configure kubectl | 2 | No |
| Verify StatefulSet, PVC, service | 2 | No |
| Confirm Vaultwarden reachable | 2 | No |
| Verify session affinity | 2 | No |
| Create admin account | 3 | No |
| Disable signups | 3 | No |
| Connect Bitwarden clients | 4 | No |
| Test vault synchronisation | 4 | No |
| Set admin token | 5 | No |
| Explore admin panel | 5 | No |
| Configure SMTP | 6 | No |
| Review Cloud Logging | 7 | No |
| Simulate pod restart | 8 | No |
| Verify PVC data persistence | 8 | No |
| Check PodDisruptionBudget | 8 | No |
| Undeploy infrastructure | 9 | Yes |
