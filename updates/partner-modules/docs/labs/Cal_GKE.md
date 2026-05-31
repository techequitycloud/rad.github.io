# Cal.diy on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cal_GKE)**

## Overview

**Estimated time:** 2–3 hours

Cal.diy is the MIT-licensed, self-hostable fork of Cal.com — the open-source scheduling platform that eliminates the back-and-forth of meeting coordination. This lab deploys Cal.diy on Google Kubernetes Engine (GKE Autopilot) backed by Cloud SQL PostgreSQL 15, Secret Manager-managed encryption keys, and horizontal pod autoscaling.

### What the Module Automates

- GKE Deployment/StatefulSet with Cloud SQL Auth Proxy sidecar
- Cloud SQL PostgreSQL 15 instance, database, and user
- Secret Manager secrets (`NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, DB password)
- Artifact Registry repository and Cloud Build image pipeline
- Workload Identity bindings for the pod service account
- Kubernetes Service (LoadBalancer) with reserved static IP
- GCS storage bucket for application data
- Cloud Monitoring uptime checks
- Automated database backup Kubernetes Job
- `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` auto-wired to the LoadBalancer external IP

### What You Do Manually

- Note the LoadBalancer external IP from the RAD UI deployment panel
- Log in to Cal.diy and complete initial setup
- Create event types and booking pages
- Configure SMTP for email notifications
- Review logs in Cloud Logging
- Examine Kubernetes resources and scaling behaviour
- Review uptime monitoring

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed (provides GKE Autopilot cluster, VPC, Cloud SQL instance).
3. The following APIs enabled:
   - `container.googleapis.com`
   - `sqladmin.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `cloudbuild.googleapis.com`
4. `gcloud` and `kubectl` authenticated.
5. Access to the RAD UI.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short identifier for this deployment |
| `region` | No | `"us-central1"` | GCP region |
| `application_name` | No | `"cal"` | Base name for resources |
| `application_version` | No | `"v6.2.0"` | Cal.diy image version — always use a versioned tag |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `5` | Maximum pod replicas |
| `container_resources` | No | `{ cpu_limit="2000m", memory_limit="2Gi" }` | Container resource limits |
| `application_database_name` | No | `"calcom"` | PostgreSQL database name |
| `application_database_user` | No | `"calcom"` | PostgreSQL database username |
| `reserve_static_ip` | No | `true` | Reserve a global static IP for the LoadBalancer |
| `environment_variables` | No | SMTP defaults | SMTP settings |
| `support_users` | No | `[]` | Email addresses for monitoring alerts |

### Step 1.2 — Initiate Deployment

Fill in the variables form in the RAD UI and click **Deploy**.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL PostgreSQL 15 instance creation | 8–12 min |
| Secret Manager secret creation | 1–2 min |
| Cloud Build image build (if custom) | 5–10 min |
| GKE workload deployment and first boot | 5–8 min |
| **Total** | **19–32 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_url` | External URL of the GKE LoadBalancer service |
| `static_ip_address` | Reserved external IP address |
| `database_instance_name` | Cloud SQL instance name |
| `namespace_name` | Kubernetes namespace |
| `deployment_id` | Unique deployment identifier |

Set shell variables:

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

export NAMESPACE=$(kubectl get namespaces \
  --selector="app.kubernetes.io/name=cal" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
  kubectl get namespaces -o name | grep cal | head -1 | sed 's/namespace\///')

export SERVICE_URL=$(kubectl get service -n ${NAMESPACE} \
  -l "app=cal" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null)
echo "Cal.diy URL: http://${SERVICE_URL}"
```

---

## Phase 2 — Access the Application [MANUAL]

### Step 2.1 — Confirm Cal.diy is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" "http://${SERVICE_URL}/api/health"
```

**Expected result:** HTTP `200`.

### Step 2.2 — Inspect the Kubernetes Deployment

```bash
kubectl get deployment -n ${NAMESPACE}
kubectl get pods -n ${NAMESPACE}
```

**Expected result:** All pods show `Running` status with `1/1` or `2/2` containers ready (main container + Cloud SQL Auth Proxy sidecar).

---

## Phase 3 — Set Up Cal.diy [MANUAL]

### Step 3.1 — Create Admin Account

Open `http://${SERVICE_URL}` in a browser and complete account creation.

### Step 3.2 — Verify Secrets Mounted in Pods

```bash
kubectl describe pod -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o name | head -1 | sed 's/pod\///') \
  | grep -A 5 "Environment"
```

**Expected result:** `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` are listed as environment variables sourced from Secret Manager.

---

## Phase 4 — Explore Cal.diy [MANUAL]

### Step 4.1 — Create Event Types

1. Navigate to **Event Types** in the dashboard.
2. Create a "30-Minute Meeting" event type.
3. Configure availability.

### Step 4.2 — Test Booking Page

Open `http://${SERVICE_URL}/<your-username>` in a private browser window.

**Expected result:** The booking page shows your available time slots.

---

## Phase 5 — Explore Kubernetes Resources [MANUAL]

### Step 5.1 — View Pod Logs

```bash
kubectl logs -n ${NAMESPACE} \
  $(kubectl get pods -n ${NAMESPACE} -o name | head -1 | sed 's/pod\///') \
  --container=$(kubectl get pods -n ${NAMESPACE} -o jsonpath='{.items[0].spec.containers[0].name}')
```

**Expected result:** Next.js server startup logs, Prisma migration output, and `ready - started server on 0.0.0.0:3000`.

### Step 5.2 — Check Horizontal Pod Autoscaler

```bash
kubectl get hpa -n ${NAMESPACE}
```

**Expected result:** HPA shows current and target replica counts.

---

## Phase 6 — Undeploy [AUTOMATED]

Click **Undeploy** in the RAD UI to remove all resources.

**Approximate undeploy duration:** 15–25 minutes.

> **Warning:** This permanently deletes all resources including the database. Export your Cal.diy data before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE workload and service provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Workload Identity and IAM | 1 | Yes |
| Container image build | 1 | Yes |
| Static IP reservation | 1 | Yes |
| Note service URL | 2 | No |
| Confirm service is reachable | 2 | No |
| Create admin account | 3 | No |
| Verify secrets in pod environment | 3 | No |
| Create event types | 4 | No |
| Test booking page | 4 | No |
| Review pod logs | 5 | No |
| Check HPA | 5 | No |
| Undeploy infrastructure | 6 | Yes |
