---
title: "Vaultwarden on GKE — Lab Guide"
sidebar_label: "Vaultwarden GKE"
---

# Vaultwarden on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Vaultwarden_GKE)**

## Overview

**Estimated time:** 3–4 hours

Vaultwarden is an unofficial, lightweight Bitwarden-compatible password manager server written in Rust. This lab deploys Vaultwarden on Google Kubernetes Engine (GKE) Autopilot backed by Cloud SQL PostgreSQL 15, with a StatefulSet workload providing a persistent 10 Gi PVC at `/data` for vault data.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes StatefulSet
- Cloud SQL PostgreSQL 15 (or MySQL 8.0) instance, database, and user
- Cloud SQL Auth Proxy sidecar injection
- PersistentVolumeClaim (10 Gi) mounted at `/data`
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
- Create the admin account (signups disabled after first user)
- Connect Bitwarden clients to the self-hosted server
- Configure SMTP and admin token
- Review logs and monitor uptime

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, query GCP resources |
| `kubectl` | Inspect pods, PVCs, and services |

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
5. `kubectl` installed.
6. Bitwarden client for testing.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `application_version` | No | `"1.32.7"` | Vaultwarden image version |
| `domain` | No | `""` | Public domain for WebAuthn |
| `signups_allowed` | No | `false` | **Set `true` for initial deploy** |
| `web_vault_enabled` | No | `true` | Enable web UI |
| `database_type` | No | `"POSTGRES_15"` | `"POSTGRES_15"` or `"MYSQL_8_0"` |
| `stateful_pvc_size` | No | `"10Gi"` | PVC size for `/data` |
| `min_instance_count` | No | `1` | Minimum pod replicas |
| `max_instance_count` | No | `3` | Maximum pod replicas |
| `enable_cloud_armor` | No | `false` | Cloud Armor WAF (recommended) |
| `backup_retention_days` | No | `30` | Backup retention days |

> **Set `signups_allowed = true` for the initial deployment only.**

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| GKE namespace and StatefulSet | 2–3 min |
| Container image build | 5–10 min |
| Vaultwarden pod start | 2–4 min |
| **Total** | **17–29 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `service_external_ip` | External LoadBalancer IP |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appvaultwarden" | head -1)

export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

export VAULT_URL="http://${EXTERNAL_IP}"
echo "Vaultwarden URL: ${VAULT_URL}"
```

---

## Phase 2 — Configure kubectl [MANUAL]

### Step 2.1 — Verify Vaultwarden Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get pvc -n ${NAMESPACE}
kubectl get svc -n ${NAMESPACE}
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

**Expected result:** The StatefulSet pod shows `Running`, the PVC shows `Bound` (10 Gi), and the service shows an `EXTERNAL-IP`.

### Step 2.2 — Confirm Vaultwarden is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}/alive
```

**Expected result:** HTTP `200` with body `OK`.

---

## Phase 3 — Create Admin Account [MANUAL]

### Step 3.1 — Access the Web Vault

Navigate to `http://${EXTERNAL_IP}` in a browser.

### Step 3.2 — Create Account and Disable Signups

1. Click **Create account**, enter email and strong password.
2. After creation, redeploy with `signups_allowed = false`.

---

## Phase 4 — Connect Bitwarden Clients [MANUAL]

### Step 4.1 — Set Server URL

In the Bitwarden client, set server URL to `http://${EXTERNAL_IP}`.

Log in with your email and master password. Create and test vault items.

---

## Phase 5 — Configure Admin Panel and SMTP [MANUAL]

Add `ADMIN_TOKEN` to `environment_variables` and redeploy. Navigate to `http://${EXTERNAL_IP}/admin`.

Configure SMTP via the admin panel or `environment_variables`.

---

## Phase 6 — Explore Logs [MANUAL]

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
  --project=${PROJECT} --limit=50
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

---

## Phase 7 — Inspect StatefulSet and PVC [MANUAL]

### Step 7.1 — Check StatefulSet Status

```bash
kubectl get statefulset -n ${NAMESPACE}
kubectl describe statefulset -n ${NAMESPACE}
```

**Expected result:** StatefulSet shows 1/1 ready pod.

### Step 7.2 — Check PVC

```bash
kubectl get pvc -n ${NAMESPACE}
kubectl describe pvc -n ${NAMESPACE}
```

**Expected result:** PVC shows `Bound` with 10 Gi capacity, mounted at `/data`.

### Step 7.3 — Verify Session Affinity

```bash
kubectl get svc -n ${NAMESPACE} -o jsonpath='{.items[0].spec.sessionAffinity}'
```

**gcloud equivalent (via GKE console):**
Navigate to **Kubernetes Engine > Services & Ingress**, select the Vaultwarden service, check **Session affinity**.

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters/${CLUSTER}" \
  | jq '.nodeConfig'
```

**Expected result:** `ClientIP` — ensures Bitwarden client connections are routed consistently to the same pod.

---

## Phase 8 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** Undeploying permanently deletes all resources including the PVC and database. Export your vault before undeploying.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE StatefulSet and PVC provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 database | 1 | Yes |
| Secret Manager credentials | 1 | Yes |
| Container image build | 1 | Yes |
| Configure kubectl | 2 | No |
| Verify pod, PVC, and service | 2 | No |
| Create admin account | 3 | No |
| Disable signups | 3 | No |
| Connect Bitwarden clients | 4 | No |
| Configure admin panel and SMTP | 5 | No |
| Review logs | 6 | No |
| Inspect StatefulSet and PVC | 7 | No |
| Verify session affinity | 7 | No |
| Undeploy infrastructure | 8 | Yes |
