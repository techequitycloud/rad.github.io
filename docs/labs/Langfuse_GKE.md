---
title: "Langfuse on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Langfuse on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Langfuse on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Langfuse_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Langfuse is an open-source LLM engineering and observability platform — tracing, prompt
management, evaluations, and metrics for applications built on large language models. This lab
takes you through the full operational lifecycle of the **Langfuse on GKE Autopilot** module on
Google Cloud: deploy it, sign up the first user, generate an API key, send a trace, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on Langfuse
product features. For the complete list of provisioned services and every configuration input
(organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Langfuse_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, and complete the first-user signup.
- Create an organization/project, generate an API key, and send your first trace.
- Perform day-2 operations — inspect pods, scale, update, and manage secrets and backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot cluster,
  Cloud SQL, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **kubectl** installed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Langfuse (GKE)**, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Langfuse_GKE) documents every
   input by group, with defaults. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the GKE workload (Deployment + Service + HPA + PodDisruptionBudget),
   a Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets (`NEXTAUTH_SECRET`,
   `SALT`, and the database password), a Cloud Storage bucket, builds the container image (a thin
   wrapper on `langfuse/langfuse:2`), and runs a one-shot database-initialisation job that creates
   the role and database. Langfuse then applies its schema via `prisma migrate deploy` on first
   boot. First deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, fetch cluster credentials and discover the resources with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep -i langfuse | head -1 | cut -d/ -f2)
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -i langfuse | head -1 | cut -d/ -f2)
   echo "Namespace: $NAMESPACE"
   echo "Service:   $SERVICE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Get the external LoadBalancer IP (the default `service_type` is `LoadBalancer`):

   ```bash
   EXT_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "http://$EXT_IP"
   ```

2. Confirm the workload is healthy. Langfuse exposes an unauthenticated health endpoint that
   returns 200 only when the server is fully initialised and PostgreSQL is reachable:

   ```bash
   curl -s "http://$EXT_IP/api/public/health"   # expect an HTTP 200 with a small JSON body
   ```

3. Open `http://$EXT_IP` (or your custom domain, if configured) in a browser. On first visit
   Langfuse shows a **Sign up** page — there is no pre-seeded admin credential. Enter your name,
   email, and a password and submit; **the first user to sign up becomes the instance owner.**
   Log in.

4. After the owner account is created, consider disabling open sign-up by setting
   `AUTH_DISABLE_SIGNUP = "true"` in `environment_variables` and applying it via **Update**.

---

## Task 3 — Create a project & send a trace [Manual]

1. In the Langfuse UI, create an **Organization**, then a **Project** inside it. Langfuse scopes
   traces, prompts, and API keys to a project.

2. Open **Project → Settings → API Keys** and click **Create new API key**. Copy the **Public
   Key** (`pk-lf-...`) and **Secret Key** (`sk-lf-...`) — the secret is shown only once.

3. Send your first trace directly to the public ingestion API with `curl` (Basic auth =
   `public:secret`). This is the same endpoint the Langfuse SDKs use:

   ```bash
   PUBLIC_KEY="pk-lf-..."
   SECRET_KEY="sk-lf-..."
   TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

   curl -s -u "$PUBLIC_KEY:$SECRET_KEY" \
     -X POST "http://$EXT_IP/api/public/ingestion" \
     -H "Content-Type: application/json" \
     -d '{
       "batch": [{
         "id": "'"$(uuidgen)"'",
         "type": "trace-create",
         "timestamp": "'"$TS"'",
         "body": { "id": "'"$(uuidgen)"'", "name": "lab-hello-trace", "input": "ping" }
       }]
     }'
   ```

   A `207`/`200` response with a `successes` array confirms ingestion. Refresh **Tracing** in the
   UI — the `lab-hello-trace` entry should appear within a few seconds.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,pods,svc,hpa,pdb -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   kubectl describe hpa -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment
   details page — the module owns the Deployment/HPA spec, so scaling is a configuration change,
   not a manual `kubectl scale` (a manual edit would be reverted on the next apply). GKE has no
   scale-to-zero; keep `min_instance_count = 1`.

3. **Update the application version** by changing the version input in the RAD platform and
   applying it via **Update**; a new image builds and a rolling update runs. Langfuse applies
   `prisma migrate deploy` on boot, so a version bump applies schema changes automatically — allow
   extra startup time on the first boot after an upgrade. (When NFS is enabled, the update strategy
   is `Recreate`, so a single pod restarts rather than surging.)

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~langfuse"
   kubectl get jobs -n "$NAMESPACE"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=langfuse --database=langfuse --project="$PROJECT"
   ```

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Monitoring** — open the GKE workload dashboard and review request rate, pod count (HPA
   behaviour), and CPU / memory utilisation vs requests. If you enabled an **uptime check**, confirm
   it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level
diagnostics and do not change with Langfuse releases.

- **Pod not Ready / `Invalid environment variables`:** Langfuse's zod validation refuses to boot
  if `NEXTAUTH_SECRET` or `SALT` is missing. Confirm both are materialised and injected:
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
  ```
  The startup probe targets `/api/public/health` and allows a generous window on first boot for
  Prisma migrations.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the Auth Proxy
  sidecar is running in the pod, the DB password secret exists, and the `db-init` job completed.
- **Initialisation job failed:** inspect the Kubernetes Job:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job> 
  ```
- **Migrations didn't run:** Langfuse runs `prisma migrate deploy` on start (not in a separate
  job). If the schema looks empty, check the pod logs for the migration output on boot.
- **Image build failed:** review Cloud Build history. The image is pinned to the **v2** line via
  the `LANGFUSE_VERSION` build ARG — a v3 tag would break.
- **Rollout wedged:** on an NFS-backed deployment the strategy is `Recreate`; a stuck rollout
  usually means the new pod can't become Ready — check its logs and events.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas
(including the critical rule never to rotate `NEXTAUTH_SECRET` or `SALT` after first boot).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**).
Delete runs `terraform destroy` and is irreversible (the deployment record is retained for
history). If a deployment is stuck and the RAD platform can no longer manage it (for example after
manual changes that conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources. Delete removes
everything the module created — the GKE workload, Cloud SQL database, Secret Manager secrets, GCS
bucket, and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions GKE workload, Cloud SQL (PostgreSQL 15), secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; sign up the first user (becomes owner) and log in |
| 3 — Project & trace | Manual | Create an org/project, generate an API key, send a trace via curl |
| 4 — Operate | Manual | Inspect pods, scale, update version, manage secrets/backups, DB access |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose secret/env, database, init-job, migration, build, and rollout issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources |
