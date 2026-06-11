---
title: "Supabase on GKE Autopilot \u2014 Lab Guide"
---

# Supabase on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Supabase_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Supabase is an open-source Firebase alternative that provides PostgreSQL 15, a Kong
API gateway, GoTrue authentication, PostgREST REST APIs, real-time subscriptions,
and an S3-compatible storage service — all deployed as Kubernetes workloads behind a
single external LoadBalancer IP. This lab takes you through the full operational
lifecycle of the **Supabase on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Supabase product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Supabase_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

> **GKE only.** Supabase is available in the GKE variant only. Its multi-service
> architecture requires persistent connections and Kubernetes primitives that Cloud
> Run does not support.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Retrieve the JWT signing secret and replace the placeholder API keys.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Supabase (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Supabase_GKE)
   documents every input by group, with defaults. Note that `supabase_db_password`
   is required; there is no default. Click **Deploy**.

2. The platform deploys the Kong gateway workload into the GKE Autopilot cluster,
   provisions a Cloud SQL (PostgreSQL 15) database with pgvector support, creates
   six Secret Manager secrets (JWT secret, anon key, service role key, and others),
   provisions a Cloud Storage bucket for file uploads, builds the container image,
   and runs a one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep supabase | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the Kong gateway is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   If the IP shows `<pending>`, wait until the LoadBalancer is provisioned:

   ```bash
   kubectl get svc -n "$NS" --watch
   ```

2. Confirm the Kong gateway is healthy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}:8000/health"
   # expect 200
   ```

3. Retrieve the JWT signing secret from Secret Manager. The anon key and service role
   key are stored as placeholders on first deploy — they **must be replaced** with
   valid JWTs signed by this secret before Supabase clients can authenticate:

   ```bash
   JWT_SECRET_NAME=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~supabase.*jwt-secret" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$JWT_SECRET_NAME" --project="$PROJECT"
   ```

   Use the returned value with [jwt.io](https://jwt.io) or the
   [Supabase JWT generator](https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys)
   to generate a signed anon JWT and a signed service role JWT, then upload them:

   ```bash
   ANON_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~supabase.*anon-key" --format="value(name)" --limit=1)
   SERVICE_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~supabase.*service-role-key" --format="value(name)" --limit=1)

   echo -n "<signed-anon-jwt>" | gcloud secrets versions add "$ANON_SECRET" \
     --data-file=- --project="$PROJECT"
   echo -n "<signed-service-role-jwt>" | gcloud secrets versions add "$SERVICE_SECRET" \
     --data-file=- --project="$PROJECT"
   ```

   Restart the Kong pod to pick up the updated secrets:

   ```bash
   kubectl rollout restart deployment -n "$NS"
   kubectl rollout status deployment -n "$NS"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployments, pods, and (if enabled) the horizontal
   autoscaler and persistent volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new Kong image builds and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~supabase"
   kubectl get jobs -n "$NS"          # db-init and any additional jobs
   gcloud storage buckets list --project="$PROJECT"   # supabase-storage bucket
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=supabase_admin --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. The module also provisions an
   **uptime check** targeting the Kong `/health` endpoint (when enabled); review
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Supabase releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Kong startup failure (401 on all requests):** the anon key or service role key
  secrets still contain placeholder values. Replace them with valid signed JWTs
  (see Task 2, step 3) and restart the deployment.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the `db-init` job completed
  successfully.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/db-init
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the Kong image exists in Artifact Registry (image
  mirroring is always enabled) and the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas, including the mandatory `supabase_db_password`, the immutability of the JWT
secret set, and the binary-unit requirement for memory quota values.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, Cloud Storage bucket, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys Kong gateway, Cloud SQL (PostgreSQL 15 + pgvector), secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; JWT placeholders replaced with signed keys |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, JWT/auth, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
