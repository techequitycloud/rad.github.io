---
title: "Shlink on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Shlink on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Shlink on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Shlink_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Shlink is a self-hosted, open-source URL shortener with a REST API, QR code
generation, and detailed visit-tracking analytics. This lab takes you through
the full operational lifecycle of the **Shlink on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Shlink product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Shlink_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Retrieve the auto-generated API key and create your first short URL.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the database.
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

1. Click **Deploy** in the RAD platform top navigation, open **Shlink (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Shlink_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets (the
   database password and the auto-generated `INITIAL_API_KEY`), builds the thin
   wrapper container image (`FROM shlinkio/shlink:stable`), and runs a one-shot
   `db-init` job that creates the application role and database. Shlink needs no
   GCS bucket or NFS share — all state lives in PostgreSQL. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep shlink | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address. Shlink is
   exposed through a `LoadBalancer` Service with a reserved static IP by
   default:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Shlink's health path is `/rest/health` — an
   unauthenticated, public endpoint returning HTTP 200 with
   `{"status":"pass",...}`. **Do not test `/`** — Shlink is API-first and has no
   web homepage, so the root path 404s by design:

   ```bash
   curl -s "http://${EXTERNAL_IP}/rest/health"
   # {"status":"pass","version":"...","links":{...}}
   ```

3. Retrieve the auto-generated API key from Secret Manager and create your
   first short URL through the REST API. Shlink has no admin username/password
   login — all access is API-key based:

   ```bash
   API_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~shlink AND name~initial-api-key" --format="value(name)" --limit=1)
   API_KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT")

   curl -s -X POST "http://${EXTERNAL_IP}/rest/v3/short-urls" \
     -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"longUrl": "https://cloud.google.com/kubernetes-engine"}'
   ```

   Follow the returned `shortUrl` in a browser (or `curl -I`) and confirm the
   redirect; then list recorded visits:

   ```bash
   curl -s "http://${EXTERNAL_IP}/rest/v3/short-urls" -H "X-Api-Key: $API_KEY"
   ```

4. **Post-deploy hardening/setup:** set `DEFAULT_DOMAIN` to the external IP or
   custom domain so generated short URLs carry the right host — it is not
   preset by the module:

   ```bash
   SERVICE=$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl set env deploy/"$SERVICE" -n "$NS" DEFAULT_DOMAIN="${EXTERNAL_IP}"
   ```

   Optionally add a `GEOLITE_LICENSE_KEY` via `environment_variables` and
   **Update** to enable visit geolocation. For a browser UI, point the hosted
   [shlink-web-client](https://app.shlink.io/) at `http://${EXTERNAL_IP}` with
   your API key.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods (Shlink deploys as a
   stateless `Deployment` with the default `RollingUpdate` strategy; there is
   no PVC or StatefulSet to check):

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).
   Shlink is stateless per-request against PostgreSQL (default
   `min_instance_count = 1`, `max_instance_count = 3`), so raising the ceiling
   is safe without further tuning. `session_affinity = ClientIP` is set by
   default for sticky routing.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**. Note that `application_version` is **not**
   wired into the image build for Shlink — the Dockerfile always builds `FROM
   shlinkio/shlink:stable`, so this triggers a rebuild/redeploy of the same
   upstream tag rather than pinning a specific release. Shlink runs its own
   schema migrations automatically on the new pods' first start.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~shlink"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=postgres --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** against `/rest/health` (disabled by default —
   `uptime_check_config.enabled = false`); when enabled, review Monitoring →
   Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Shlink releases.

- **`/` returns 404:** not a failure — Shlink has no web homepage. Verify
  health at `/rest/health` and interact via `/rest/v3/...` with the
  `X-Api-Key` header.
- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Both the
  startup and liveness probes target `/rest/health`; the startup probe allows
  `failure_threshold=30` at `period_seconds=10` (~300s) for first-boot
  migrations, so don't conclude failure too early:

  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```

- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace, and the
  `db-init` job completed. Never set `DB_USER`/`DB_NAME` manually in
  `environment_variables` — the foundation injects tenant-scoped values, and
  overriding them to the short `shlink`/`shlink` names causes `password
  authentication failed` against a role that was never created.
- **`db-init` job failed:** inspect the job and its pod logs:

  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```

- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP:

  ```bash
  kubectl get svc -n "$NS" -o wide
  ```

- **401 on API calls:** the `X-Api-Key` header must carry the value of the
  `INITIAL_API_KEY` secret (or a key you created with it). Re-fetch it from
  Secret Manager as in Task 2 — Shlink has no admin login to fall back on.
- **Wrong host in generated short URLs:** set `DEFAULT_DOMAIN` to the external
  IP or custom domain (see Task 2 step 4) — until then Shlink may build short
  URLs against the wrong host.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the immutability of
`application_database_name`/`application_database_user` after first deploy,
and why `DB_NAME`/`DB_USER` must never be set manually).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, and Secret Manager secrets (including the
initial API key). Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, and runs `db-init` |
| 2 — Access & verify | Manual | Connect to the cluster; `/rest/health` passes; first short URL created via the REST API with the bootstrap key |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, API-key, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
