---
title: "Supabase on GKE — Lab Guide"
sidebar_label: "Supabase GKE"
---

# Supabase on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Supabase_GKE)**

## Overview

**Estimated time:** 3–4 hours

Supabase is an open-source Firebase alternative providing PostgreSQL, Auth, Storage, Realtime, and REST APIs. This lab deploys Supabase on Google Kubernetes Engine (GKE) Autopilot with the Kong API gateway as the primary ingress, backed by Cloud SQL PostgreSQL 15 with pgvector support.

### What the Module Automates

- GKE Autopilot namespace and Kubernetes Deployment (Kong gateway)
- Cloud SQL PostgreSQL 15 instance with pgvector extension
- Three Secret Manager secrets: JWT secret (auto-generated), anon key (placeholder), service role key (placeholder)
- Artifact Registry image mirroring (always enabled)
- Workload Identity and IAM bindings
- Kubernetes Service (LoadBalancer) for Kong
- Cloud Monitoring uptime checks targeting `/health`
- GCS `supabase-storage` bucket
- `db-init` Kubernetes Job

### What You Do Manually

- Note deployment outputs from the RAD UI panel
- Configure kubectl with GKE cluster credentials
- Replace anon key and service role key placeholders with valid signed JWTs
- Deploy Supabase microservices (Auth, PostgREST, Storage, Realtime) via `additional_services`
- Connect client applications using the Supabase JS client
- Test authentication, database queries, and file storage
- Review logs

---

## CLI and REST API Overview

| Tool | Purpose |
|---|---|
| `gcloud` | Retrieve secrets, manage JWT keys |
| `kubectl` | Inspect pods and services |

Install: [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), [kubectl](https://kubernetes.io/docs/tasks/tools/)

---

## Prerequisites

1. A GCP project with billing enabled.
2. The `Services_GCP` module deployed in the same project.
3. APIs enabled: `container.googleapis.com`, `sqladmin.googleapis.com`, `secretmanager.googleapis.com`, `artifactregistry.googleapis.com`, `cloudbuild.googleapis.com`
4. `gcloud` authenticated and `kubectl` installed.

---

## Phase 1 — Deploy Infrastructure [AUTOMATED]

### Step 1.1 — Configure Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `tenant_deployment_id` | No | `"demo"` | Short deployment identifier |
| `region` | No | `"us-central1"` | GCP region |
| `db_name` | No | `"postgres"` | Supabase uses `postgres` database |
| `db_user` | No | `"supabase_admin"` | Supabase admin user |
| `jwt_secret` | No | `""` | JWT signing secret (auto-generated if empty). **Sensitive.** |
| `anon_key` | No | `""` | Pre-generated anon JWT (placeholder if empty). **Sensitive.** |
| `service_role_key` | No | `""` | Pre-generated service role JWT (placeholder if empty). **Sensitive.** |
| `cpu_limit` | No | `"1000m"` | CPU for Kong gateway |
| `memory_limit` | No | `"2Gi"` | Memory for Kong gateway |
| `additional_services` | No | `[]` | Supabase microservices (Auth, PostgREST, etc.) |

### Step 1.2 — Initiate Deployment

Click **Deploy** in the RAD UI.

**Approximate deployment durations:**

| Phase | Duration |
|---|---|
| Cloud SQL instance creation | 8–12 min |
| GKE namespace and workload identity | 2–3 min |
| Artifact Registry image mirroring | 3–5 min |
| Kong pod start | 2–4 min |
| **Total** | **15–24 min** |

### Step 1.3 — Record Outputs

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} --format="value(name)" --limit=1)

gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} --project=${PROJECT}

export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appsupabase" | head -1)

export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

echo "Supabase Kong URL: http://${EXTERNAL_IP}:8000"
```

---

## Phase 2 — Post-Deployment JWT Setup [MANUAL]

### Step 2.1 — Retrieve the Auto-Generated JWT Secret

```bash
export JWT_SECRET_NAME=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~jwt-secret" \
  --format="value(name)" \
  --limit=1)

gcloud secrets versions access latest \
  --secret="${JWT_SECRET_NAME}" \
  --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3A~supabase"
```

**Expected result:** A 32-character random string is returned. Save this as your JWT signing secret.

### Step 2.2 — Generate Valid JWTs

Use the Supabase JWT generator (https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys) or `jwt.io` to generate:
- **Anon key**: JWT signed with the secret, role `anon`
- **Service role key**: JWT signed with the secret, role `service_role`

### Step 2.3 — Update the Placeholder Secrets

```bash
export ANON_SECRET=$(gcloud secrets list \
  --project=${PROJECT} --filter="name~anon-key" --format="value(name)" --limit=1)

export SERVICE_SECRET=$(gcloud secrets list \
  --project=${PROJECT} --filter="name~service-role-key" --format="value(name)" --limit=1)

echo -n "your-anon-jwt-here" | gcloud secrets versions add ${ANON_SECRET} \
  --data-file=- --project=${PROJECT}

echo -n "your-service-role-jwt-here" | gcloud secrets versions add ${SERVICE_SECRET} \
  --data-file=- --project=${PROJECT}
```

**gcloud equivalent (verify new versions):**
```bash
gcloud secrets versions list ${ANON_SECRET} --project=${PROJECT}
```

**Expected result:** New secret versions are added. Restart the Kong pod to pick up the updated secrets.

---

## Phase 3 — Verify Kong Gateway [MANUAL]

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get svc -n ${NAMESPACE}
```

**Expected result:** Kong pod running, service showing external IP.

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}:8000/health
```

**Expected result:** HTTP `200`.

---

## Phase 4 — Deploy Supabase Microservices [MANUAL]

Add microservices to `additional_services` in your deployment configuration and redeploy. Refer to [Supabase self-hosting documentation](https://supabase.com/docs/guides/self-hosting) for required environment variables for each service.

---

## Phase 5 — Connect a Client Application [MANUAL]

Use the Supabase JavaScript client to connect:

```javascript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = `http://${EXTERNAL_IP}:8000`
const supabaseAnonKey = 'your-anon-jwt'

const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

Test a database query:
```javascript
const { data, error } = await supabase.from('your_table').select('*')
```

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

## Phase 7 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** Undeploying permanently deletes all resources including the PostgreSQL database.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE Kong gateway provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 + pgvector | 1 | Yes |
| JWT secret and placeholder keys | 1 | Yes |
| Retrieve JWT secret | 2 | No |
| Generate and upload valid JWTs | 2 | No |
| Verify Kong gateway health | 3 | No |
| Deploy Supabase microservices | 4 | No |
| Connect client application | 5 | No |
| Review logs | 6 | No |
| Undeploy infrastructure | 7 | Yes |
