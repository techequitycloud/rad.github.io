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
- Retrieve the auto-generated JWT secret from Secret Manager
- Generate valid anon key and service role key JWTs
- Replace the placeholder secrets with valid signed JWTs
- Deploy Supabase microservices (Auth, PostgREST, Storage, Realtime) via `additional_services`
- Connect client applications using the Supabase JS client
- Test authentication, database queries, and file storage
- Review logs in Cloud Logging

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

**gcloud equivalent — list GKE clusters:**
```bash
gcloud container clusters list --project=${PROJECT}
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://container.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/clusters"
```

---

## Phase 2 — Configure kubectl [MANUAL]

### Step 2.1 — Verify Kong Pod is Running

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get svc -n ${NAMESPACE}
```

**Expected result:** Kong pod shows `Running`, `1/1` ready. Service shows `EXTERNAL-IP`.

Wait for the external IP if it shows `<pending>`:
```bash
kubectl get svc -n ${NAMESPACE} --watch
```

### Step 2.2 — Confirm Kong is Reachable

```bash
curl -s -o /dev/null -w "%{http_code}" http://${EXTERNAL_IP}:8000/health
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'" AND resource.labels.container_name="kong"' \
  --project=${PROJECT} --limit=20
```

**REST API equivalent:**
```bash
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://logging.googleapis.com/v2/entries:list" \
  -d '{
    "projectIds": ["'"${PROJECT}"'"],
    "filter": "resource.type=\"k8s_container\" AND resource.labels.namespace_name=\"'"${NAMESPACE}"'\" AND resource.labels.container_name=\"kong\"",
    "pageSize": 20
  }'
```

**Expected result:** HTTP `200`. Kong gateway is accepting requests.

---

## Phase 3 — JWT Setup [MANUAL]

### Step 3.1 — Retrieve the Auto-Generated JWT Secret

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

**gcloud — list all Supabase secrets:**
```bash
gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~supabase"
```

**REST API equivalent:**
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?filter=name%3A~supabase"
```

**Expected result:** A 32-character random string is returned. Save this as `JWT_SECRET`.

```bash
export JWT_SECRET="<paste-value-here>"
```

### Step 3.2 — Generate Valid JWTs

Use the Supabase JWT generator at https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys or `jwt.io` to create two JWTs signed with `JWT_SECRET`:

**Anon key payload:**
```json
{
  "role": "anon",
  "iss": "supabase",
  "iat": <current-unix-ts>,
  "exp": <unix-ts-10-years-from-now>
}
```

**Service role key payload:**
```json
{
  "role": "service_role",
  "iss": "supabase",
  "iat": <current-unix-ts>,
  "exp": <unix-ts-10-years-from-now>
}
```

### Step 3.3 — Update the Placeholder Secrets

```bash
export ANON_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~anon-key" \
  --format="value(name)" \
  --limit=1)

export SERVICE_SECRET=$(gcloud secrets list \
  --project=${PROJECT} \
  --filter="name~service-role-key" \
  --format="value(name)" \
  --limit=1)

echo -n "your-anon-jwt-here" | gcloud secrets versions add ${ANON_SECRET} \
  --data-file=- --project=${PROJECT}

echo -n "your-service-role-jwt-here" | gcloud secrets versions add ${SERVICE_SECRET} \
  --data-file=- --project=${PROJECT}
```

**REST API — add new secret version:**
```bash
# Encode value as base64
export ANON_JWT_B64=$(echo -n "your-anon-jwt-here" | base64 -w0)

curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/${ANON_SECRET}/versions:add" \
  -d "{\"payload\": {\"data\": \"${ANON_JWT_B64}\"}}"
```

**Verify new versions:**
```bash
gcloud secrets versions list ${ANON_SECRET} --project=${PROJECT}
gcloud secrets versions list ${SERVICE_SECRET} --project=${PROJECT}
```

**Expected result:** New secret versions (version 2) are created. Restart the Kong pod to mount updated secrets:

```bash
kubectl rollout restart deployment -n ${NAMESPACE}
kubectl rollout status deployment -n ${NAMESPACE}
```

---

## Phase 4 — Verify db-init Job [MANUAL]

### Step 4.1 — Inspect the db-init Job

```bash
kubectl get jobs -n ${NAMESPACE}
```

**Expected result:** `db-init` job shows `1/1` completions.

```bash
export INIT_POD=$(kubectl get pods -n ${NAMESPACE} \
  --selector="batch.kubernetes.io/job-name=db-init" \
  --output=jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
  kubectl get pods -n ${NAMESPACE} -o name | grep "db-init" | head -1)

kubectl logs ${INIT_POD} -n ${NAMESPACE}
```

**gcloud equivalent:**
```bash
gcloud logging read \
  'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'" AND labels."k8s-pod/batch.kubernetes.io/job-name"~"db-init"' \
  --project=${PROJECT} --limit=50
```

**Expected result:** Logs confirm database initialisation completed.

---

## Phase 5 — Deploy Supabase Microservices [MANUAL]

The Kong gateway acts as the ingress router for all Supabase services. Add microservices to the `additional_services` variable in your deployment configuration and redeploy.

### Step 5.1 — Example: Add Auth Service

```hcl
additional_services = [
  {
    name             = "auth"
    container_image  = "supabase/gotrue:latest"
    container_port   = 9999
    environment_variables = {
      GOTRUE_API_HOST                = "0.0.0.0"
      GOTRUE_API_PORT                = "9999"
      GOTRUE_DB_DRIVER               = "postgres"
      GOTRUE_SITE_URL                = "http://${EXTERNAL_IP}:8000"
      GOTRUE_JWT_SECRET              = "" # injected via secret
    }
  }
]
```

Refer to the [Supabase self-hosting documentation](https://supabase.com/docs/guides/self-hosting) for required environment variables for each service (Auth, PostgREST, Storage, Realtime).

### Step 5.2 — Verify Additional Services

After redeploying with `additional_services`:

```bash
kubectl get pods -n ${NAMESPACE}
kubectl get svc -n ${NAMESPACE}
```

**Expected result:** Additional pods (auth, rest, storage, realtime) appear in the namespace.

---

## Phase 6 — Connect a Client Application [MANUAL]

### Step 6.1 — Install the Supabase JS Client

```bash
npm install @supabase/supabase-js
```

### Step 6.2 — Initialise the Client

```javascript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = `http://${EXTERNAL_IP}:8000`
const supabaseAnonKey = 'your-anon-jwt'

const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

### Step 6.3 — Test a Database Query

```javascript
const { data, error } = await supabase
  .from('your_table')
  .select('*')

if (error) {
  console.error('Query error:', error.message)
} else {
  console.log('Query result:', data)
}
```

**Expected result:** Data returned from the `postgres` database via the PostgREST API.

### Step 6.4 — Test Authentication

```javascript
const { data, error } = await supabase.auth.signUp({
  email: 'testuser@example.com',
  password: 'securepassword'
})

console.log('Sign-up result:', data)
```

**Expected result:** User created in the `auth.users` table.

---

## Phase 7 — Explore Logs [MANUAL]

### Step 7.1 — View Kong Gateway Logs

In **Logging > Logs Explorer**:

```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
resource.labels.container_name="kong"
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

**Expected result:** Kong access logs and upstream routing entries appear.

---

## Phase 8 — Cloud Monitoring [MANUAL]

Navigate to **Monitoring > Uptime checks**.

**Expected result:** A preconfigured uptime check polling `http://${EXTERNAL_IP}:8000/health` shows **Passing**.

View container metrics in **Monitoring > Metrics Explorer**:

| Metric | Description |
|---|---|
| `kubernetes.io/container/cpu/usage_time` | Kong CPU usage |
| `kubernetes.io/container/memory/used_bytes` | Kong memory usage |
| `kubernetes.io/pod/restart_count` | Pod restarts |

---

## Phase 9 — Undeploy [AUTOMATED]

Return to the RAD UI and click **Undeploy**.

**Approximate undeploy duration:** 15–20 minutes.

> **Warning:** Undeploying permanently deletes all resources including the PostgreSQL database and all Secret Manager secrets.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| GKE Kong gateway provisioning | 1 | Yes |
| Cloud SQL PostgreSQL 15 + pgvector | 1 | Yes |
| JWT secret and placeholder keys | 1 | Yes |
| Configure kubectl | 2 | No |
| Verify Kong gateway health | 2 | No |
| Retrieve JWT secret | 3 | No |
| Generate and upload valid JWTs | 3 | No |
| Restart Kong pod | 3 | No |
| Verify db-init job | 4 | No |
| Deploy Supabase microservices | 5 | No |
| Connect client application | 6 | No |
| Test authentication | 6 | No |
| Review logs | 7 | No |
| Review uptime check | 8 | No |
| Undeploy infrastructure | 9 | Yes |
