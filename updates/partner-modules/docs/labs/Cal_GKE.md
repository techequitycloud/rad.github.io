# Cal.diy on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cal_GKE)**

## Overview

**Estimated time:** 2–3 hours

Cal.diy is the MIT-licensed, self-hostable fork of Cal.com — the open-source scheduling platform that eliminates the back-and-forth of meeting coordination. This lab deploys Cal.diy on Google Kubernetes Engine (GKE Autopilot) backed by Cloud SQL PostgreSQL 15, Secret Manager-managed encryption keys, and horizontal pod autoscaling. GKE Autopilot handles node provisioning automatically, and Workload Identity provides the pod with scoped GCP credentials.

### What the Module Automates

- GKE Deployment with Cloud SQL Auth Proxy sidecar (injected by `App GKE`)
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets (`NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, DB password)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity binding (pod SA → GCP SA)
- Kubernetes Service (LoadBalancer) with reserved global static IP
- GCS storage bucket for application data
- Cloud Monitoring uptime checks and alert policies
- Automated database backup Kubernetes Job
- `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` auto-wired to the LoadBalancer external IP via `$(GKE_SERVICE_URL)` sentinel

### What You Do Manually

- Note the LoadBalancer external IP from the RAD UI deployment panel
- Configure kubectl access to the GKE cluster
- Create your Cal.diy admin account
- Create event types and booking pages
- Share booking links and test the scheduling flow
- Configure SMTP for booking confirmation emails
- Review logs in Cloud Logging
- Examine Kubernetes resources and scaling behaviour
- Review uptime monitoring

---

## CLI and REST API Overview

This lab uses three primary tools:

| Tool | Purpose |
|---|---|
| `gcloud` | Access secrets, inspect GKE cluster, view logs |
| `kubectl` | Inspect Kubernetes workloads, pods, services |
| `curl` | Test HTTP endpoints and verify service health |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) | [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services GCP` module deployed in the same project (provides GKE Autopilot cluster, VPC, Cloud SQL instance).
3. The following APIs enabled (Services GCP handles this):
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` authenticated: `gcloud auth application-default login`
5. `kubectl` installed and available in your PATH.
6. Access to the RAD UI with permission to deploy modules in the target GCP project.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

Configure the following variables in the RAD UI deployment form before deploying.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment (e.g. `"prod"`) |
| `deployment_id` | No | `""` | Auto-generated suffix appended to resource names |
| `region` | No | `"us-central1"` | GCP region for Cloud SQL and GCS |
| `application_name` | No | `"cal"` | Base name for resources and secrets |
| `application_version` | No | `"v6.2.0"` | Cal.diy image version — always use a versioned tag, no `latest` |
| `deploy_application` | No | `true` | Set `false` to provision infrastructure without deploying the workload |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `container_resources` | No | `{ cpu_limit="2000m", memory_limit="2Gi" }` | Container CPU and memory limits |
| `application_database_name` | No | `"calcom"` | PostgreSQL database name |
| `application_database_user` | No | `"calcom"` | PostgreSQL database username |
| `container_image_source` | No | `"prebuilt"` | `"prebuilt"` for official image; `"custom"` for Cloud Build |
| `service_type` | No | `"LoadBalancer"` | Kubernetes Service type |
| `reserve_static_ip` | No | `true` | Reserve a global static external IP |
| `environment_variables` | No | SMTP defaults | SMTP settings: `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SECURE` |
| `backup_schedule` | No | `"0 2 * * *"` | Cron schedule for automated backups |
| `backup_retention_days` | No | `7` | Days to retain backup files |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variables form and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL 15 instance creation | 8–12 min |
| Secret Manager secret creation and propagation | 1–2 min |
| Cloud Build image pipeline (if `container_image_source = "custom"`) | 5–10 min |
| GKE node pool provisioning (Autopilot) | 3–5 min |
| Kubernetes workload rollout + Prisma migrations | 4–6 min |
| Static IP reservation and LoadBalancer setup | 2–4 min |
| **Total** | **23–39 min** |

> **Note on GKE first boot:** Cal.diy runs `replace-placeholder.sh` and Prisma migrations on startup. The startup probe is configured with a generous window. If the first pod starts before the LoadBalancer IP is assigned, `NEXT_PUBLIC_WEBAPP_URL` may initially point to a placeholder — `App GKE` resolves the `$(GKE_SERVICE_URL)` sentinel once the external IP is available.

### Step 1.3 — Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `service_url` | External URL of the Cal.diy GKE LoadBalancer service |
| `static_ip_address` | Reserved external IP address |
| `database_instance_name` | Cloud SQL instance name |
| `database_password_secret` | Secret Manager secret name for the DB password |
| `namespace_name` | Kubernetes namespace |
| `deployment_id` | Unique deployment identifier |

Configure kubectl and set shell variables:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into

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

# Discover the Cal.diy namespace
export NAMESPACE=$(kubectl get namespaces \
  -o jsonpath='{.items[?(@.metadata.labels.app=="cal")].metadata.name}' 2>/dev/null)
# Fallback: list all namespaces and filter by name
if [ -z "${NAMESPACE}" ]; then
  export NAMESPACE=$(kubectl get namespaces \
    -o name | grep -E "cal" | head -1 | sed 's/namespace\///')
fi
echo "Namespace: ${NAMESPACE}"

# Get the external LoadBalancer IP
export SERVICE_IP=$(kubectl get service -n ${NAMESPACE} \
  -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
export SERVICE_URL="http://${SERVICE_IP}"
echo "Cal.diy URL: ${SERVICE_URL}"

# Discover Cal.diy secrets
export NEXTAUTH_SECRET_ID=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~nextauth-secret" \
  --format="value(name)" \
  --limit=1)
export ENCRYPTION_KEY_ID=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~encryption-key" \
  --format="value(name)" \
  --limit=1)
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Get the LoadBalancer IP

```bash
echo "Cal.diy URL: ${SERVICE_URL}"

# Also check via kubectl
kubectl get service -n ${NAMESPACE} -o wide
```

**gcloud equivalent (via Cloud SQL instance tags, for verification):**
```bash
gcloud compute addresses list \
  --project=${PROJECT} \
  --filter="name~cal" \
  --format="table(name, address, status)"
```

**Expected result:** An external IP address is printed. If `SERVICE_IP` is empty, the LoadBalancer may still be provisioning — wait 2–3 minutes and re-run.

### Step 2.2 — Check the Health Endpoint

```bash
curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health"
```

**Expected result:** HTTP `200`. If you see `503` or `Connection refused`, the pods may still be starting up. Check pod status:

```bash
kubectl get pods -n ${NAMESPACE} -w
```

Wait until all pods show `Running` status before proceeding.

**Check health response body:**
```bash
curl -s "${SERVICE_URL}/api/health" | jq .
```

**Expected result:** JSON response indicating the service is healthy.

### Step 2.3 — Inspect the Kubernetes Deployment

```bash
kubectl describe deployment -n ${NAMESPACE}
```

**Expected result:** Deployment shows the desired and available replica count, container image, resource limits, and environment variable references.

### Step 2.4 — View Pod Details

```bash
kubectl get pods -n ${NAMESPACE} -o wide

# Get the main pod name
export POD=$(kubectl get pods -n ${NAMESPACE} \
  -l app=cal \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
  kubectl get pods -n ${NAMESPACE} -o name | head -1 | sed 's/pod\///')
echo "Pod: ${POD}"
```

**Expected result:** Pods show `Running` status with `2/2` containers ready (main Cal.diy container + Cloud SQL Auth Proxy sidecar).

### Step 2.5 — Verify Auto-Generated Secrets

```bash
# List Cal.diy secrets in Secret Manager
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~cal" \
  --format="table(name, createTime)"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3Acal"
```

**Expected result:** At minimum three secrets appear: `*-nextauth-secret`, `*-encryption-key`, and `*-db-password`. The application secrets were auto-generated by `Cal Common`.

---

## Phase 3 — Set Up Cal.diy [MANUAL]

### Step 3.1 — Create Your Admin Account

Open `${SERVICE_URL}` in a browser.

Cal.diy presents an account creation form on first visit.

1. Enter your **name**, **email address**, and a strong **password**.
2. Click **Create account**.
3. Cal.diy redirects to the onboarding wizard.

**Expected result:** You are logged into the Cal.diy dashboard.

### Step 3.2 — Complete Onboarding

The onboarding wizard walks through:
1. **Profile setup** — username, timezone, language.
2. **Connect your calendar** — Google Calendar, Outlook, or other supported integrations.
3. **Set working hours** — default availability schedule.

**Expected result:** Your Cal.diy profile is configured with your preferred username and timezone.

### Step 3.3 — Confirm Secrets are Mounted in the Pod

```bash
kubectl exec -n ${NAMESPACE} ${POD} \
  -c $(kubectl get pod -n ${NAMESPACE} ${POD} \
    -o jsonpath='{.spec.containers[0].name}') \
  -- env | grep -E "NEXTAUTH_SECRET|CALENDSO_ENCRYPTION_KEY" | wc -l
```

**Expected result:** Returns `2` — both secrets are present in the pod environment, sourced from Secret Manager via Workload Identity.

### Step 3.4 — Verify NEXT_PUBLIC_WEBAPP_URL Wiring

```bash
kubectl exec -n ${NAMESPACE} ${POD} \
  -c $(kubectl get pod -n ${NAMESPACE} ${POD} \
    -o jsonpath='{.spec.containers[0].name}') \
  -- env | grep -E "NEXT_PUBLIC_WEBAPP_URL|NEXTAUTH_URL|NODE_ENV"
```

**Expected result:** Both `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` are set to the LoadBalancer IP or custom domain URL. `NODE_ENV` is `production`. These were resolved from the `$(GKE_SERVICE_URL)` sentinel by `App GKE` at apply time.

---

## Phase 4 — Create Event Types and Test Booking [MANUAL]

### Step 4.1 — Create Your First Event Type

1. In the Cal.diy dashboard, click **Event Types** in the left sidebar.
2. Click **New event type**.
3. Fill in:
   - **Title**: "30-Minute Discovery Call"
   - **Duration**: 30 minutes
   - **URL slug**: auto-populated
4. Click **Continue** and configure availability.
5. Click **Create**.

**Expected result:** The event type appears in your list at `${SERVICE_URL}/<your-username>/30-minute-discovery-call`.

### Step 4.2 — Test Your Booking Page

Open `${SERVICE_URL}/<your-username>` in a private browser window.

**Expected result:** The Cal.diy public booking page loads with your available event types.

### Step 4.3 — Test a Full Booking Flow (Optional)

1. Click the 30-minute event type.
2. Select an available time slot.
3. Enter a guest name and email.
4. Click **Confirm**.

**Expected result:** A booking confirmation page appears. If SMTP is configured, a confirmation email is sent to the guest address.

---

## Phase 5 — Configure Email Notifications [MANUAL]

### Step 5.1 — Check Current SMTP Configuration

```bash
kubectl exec -n ${NAMESPACE} ${POD} \
  -c $(kubectl get pod -n ${NAMESPACE} ${POD} \
    -o jsonpath='{.spec.containers[0].name}') \
  -- env | grep -E "SMTP|EMAIL_FROM"
```

**Expected result:** SMTP environment variables are present. If `SMTP_HOST` is empty, email notifications will not be sent.

### Step 5.2 — Update SMTP Settings

To configure SMTP, update `environment_variables` in the RAD UI and re-deploy:

```hcl
environment_variables = {
  EMAIL_FROM  = "noreply@cal.example.com"
  SMTP_HOST   = "smtp.mailgun.org"
  SMTP_PORT   = "587"
  SMTP_USER   = "postmaster@mg.example.com"
  SMTP_SECURE = "true"
}

secret_environment_variables = {
  SMTP_PASSWORD = "cal-smtp-password-secret-name"
}
```

---

## Phase 6 — Explore Cloud Logging [MANUAL]

### Step 6.1 — View Cal.diy Pod Logs

```bash
kubectl logs -n ${NAMESPACE} ${POD} \
  -c $(kubectl get pod -n ${NAMESPACE} ${POD} \
    -o jsonpath='{.spec.containers[0].name}') \
  --tail=50
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app"="cal"' \
  --project=${PROJECT} \
  --limit=50 \
  --format="table(timestamp, textPayload)"
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND labels.\"k8s-pod/app\"=\"cal\"",
    "pageSize": 30
  }'
```

**Expected result:** Cal.diy startup logs appear: `replace-placeholder.sh` output, Prisma migration messages, and `ready - started server on 0.0.0.0:3000`.

### Step 6.2 — View Cloud SQL Auth Proxy Logs

```bash
# Get the sidecar container name
PROXY_CONTAINER=$(kubectl get pod -n ${NAMESPACE} ${POD} \
  -o jsonpath='{.spec.containers[1].name}')

kubectl logs -n ${NAMESPACE} ${POD} -c ${PROXY_CONTAINER} --tail=20
```

**Expected result:** Cloud SQL Auth Proxy startup messages showing the proxy listening on the Unix socket under `/cloudsql`.

### Step 6.3 — Filter for Errors

```bash
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app"="cal" AND severity>=WARNING' \
  --project=${PROJECT} \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

**Expected result:** Under normal operation, few or no warnings appear after startup completes.

---

## Phase 7 — Kubernetes Features [MANUAL]

### Step 7.1 — Examine the Deployment

```bash
kubectl describe deployment -n ${NAMESPACE}
```

**Expected result:** Deployment details including container image, resource requests/limits, environment variable sources, and probe configurations.

### Step 7.2 — View the Horizontal Pod Autoscaler

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows current replicas, target CPU utilisation, and min/max replica bounds.

### Step 7.3 — Check the Startup Probe Configuration

```bash
kubectl get deployment -n ${NAMESPACE} \
  -o jsonpath='{.items[0].spec.template.spec.containers[0].startupProbe}' \
  | jq .
```

**Expected result:** The startup probe targets `/api/health` with a generous initial delay and failure threshold to accommodate Cal.diy's first-boot operations.

### Step 7.4 — Test Scaling

```bash
# Send requests to trigger HPA
for i in $(seq 1 50); do
  curl -s -o /dev/null "${SERVICE_URL}/api/health"
done

# Watch pod count
kubectl get pods -n ${NAMESPACE} -w
```

**Expected result:** GKE Autopilot may schedule additional pods if CPU utilisation increases. New pods start running within 1–2 minutes.

### Step 7.5 — Examine the Cloud SQL Auth Proxy Sidecar

```bash
kubectl get pod -n ${NAMESPACE} ${POD} \
  -o jsonpath='{.spec.containers[*].name}'
```

**Expected result:** Two containers are listed — the main Cal.diy container and the Cloud SQL Auth Proxy sidecar injected by `App GKE` because `enable_cloudsql_volume = true`.

### Step 7.6 — Review Uptime Check

Navigate to **Monitoring > Uptime checks** in the Cloud Console.

**Expected result:** The uptime check targeting `${SERVICE_URL}/api/health` shows **Passing** from multiple global locations.

---

## Phase 8 — Database and Secret Operations [MANUAL]

### Step 8.1 — View the Cloud SQL Instance

```bash
gcloud sql instances list \
  --project=${PROJECT} \
  --filter="name~cal"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://sqladmin.googleapis.com/v1/projects/${PROJECT}/instances"
```

**Expected result:** The Cloud SQL PostgreSQL 15 instance is listed with status `RUNNABLE`.

### Step 8.2 — View Secret Versions

```bash
# View NEXTAUTH_SECRET metadata (not the value)
gcloud secrets describe ${NEXTAUTH_SECRET_ID} \
  --project=${PROJECT}

gcloud secrets versions list ${NEXTAUTH_SECRET_ID} \
  --project=${PROJECT}
```

**Expected result:** Secret metadata shows creation time and replication policy. Version 1 is `ENABLED`.

### Step 8.3 — View Kubernetes Backup CronJob

```bash
kubectl get cronjob -n ${NAMESPACE}
```

**Expected result:** A backup CronJob appears with the schedule defined by `backup_schedule` (default: `0 2 * * *`).

### Step 8.4 — Check Workload Identity Binding

```bash
# Verify the pod service account has Workload Identity annotation
kubectl get serviceaccount -n ${NAMESPACE} \
  -o jsonpath='{.items[*].metadata.annotations}' | jq .
```

**Expected result:** The service account shows an `iam.gke.io/gcp-service-account` annotation linking it to the GCP service account.

---

## Phase 9 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources.

**Approximate undeploy duration:** 15–25 minutes.

> **Warning:** This permanently deletes all resources including the database, secrets, and GCS bucket. Export your Cal.diy data before undeploying if you need to preserve it.

Resources provisioned by the `Services GCP` module (VPC, GKE cluster, Cloud SQL instance) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE workload deployment | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager credentials (NEXTAUTH_SECRET, ENCRYPTION_KEY) | 1 | Yes |
| Workload Identity and IAM | 1 | Yes |
| Container image build (Cloud Build) | 1 | Yes |
| Static IP reservation and LoadBalancer | 1 | Yes |
| NEXT_PUBLIC_WEBAPP_URL GKE sentinel wiring | 1 | Yes |
| Configure kubectl access | 2 | No |
| Note LoadBalancer IP | 2 | No |
| Confirm Cal.diy is reachable | 2 | No |
| Verify auto-generated secrets | 2 | No |
| Create admin account | 3 | No |
| Complete onboarding wizard | 3 | No |
| Confirm secrets in pod environment | 3 | No |
| Verify NEXT_PUBLIC_WEBAPP_URL | 3 | No |
| Create event types | 4 | No |
| Test booking page and booking flow | 4 | No |
| Configure SMTP | 5 | No |
| Review pod and proxy logs | 6 | No |
| Examine HPA and startup probes | 7 | No |
| Check Workload Identity | 8 | No |
| Review database and backup jobs | 8 | No |
| Review uptime checks | 7 | No |
| Undeploy infrastructure | 9 | Yes |
