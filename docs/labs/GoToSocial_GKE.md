---
title: "GoToSocial on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy GoToSocial on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# GoToSocial on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/GoToSocial_GKE)**

## Overview

**Estimated time:** 45–90 minutes

GoToSocial is a lightweight, self-hosted ActivityPub/Fediverse server — a
small alternative to Mastodon, written as a single static Go binary. This lab
takes you through the full operational lifecycle of the **GoToSocial on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it (including
confirming — or, if needed, manually finishing — creation of its first admin
account), run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on GoToSocial product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/GoToSocial_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and confirm (or
  manually complete) creation of GoToSocial's first admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including
  a stuck or partially-failed admin-account creation.
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

1. Click **Deploy** in the RAD platform top navigation, open **GoToSocial
   (GKE)** from the **Platform Modules** list, set `project_id`, and set
   **`host`** to your real domain if you have one (this value is baked into
   every ActivityPub URI at creation time and is **immutable** once real
   accounts/posts exist — the placeholder `gotosocial.local` is fine for this
   lab). Review the other inputs — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/GoToSocial_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster,
   provisions a Cloud SQL (PostgreSQL 15, created with the mandatory `C`
   collation) database with its Secret Manager secrets (`SUPERUSER_PASSWORD`,
   an HMAC key pair for S3-compatible object storage, and the database
   password), a Cloud Storage `storage` bucket, a reserved static IP with a
   LoadBalancer Service, and runs the `db-init` initialization job (plus a
   best-effort `admin-create` attempt — see Task 2). First deploys take
   roughly **15–25 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep gotosocial | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Find the external address (a static IP is reserved by default):

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. **Confirm the service is up — but you must send a `User-Agent` header, or
   GoToSocial will reject the request.** GoToSocial's health endpoints
   (`/readyz`, `/livez`) are real and unauthenticated, but they deliberately
   reject any request lacking a `User-Agent` with a `418 I'm a teapot`
   response — this is an anti-scraper measure, not a bug:

   ```bash
   curl -s "http://${EXTERNAL_IP}/readyz"                        # 418 — no User-Agent sent
   curl -A "gotosocial-lab-check/1.0" -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/readyz"   # expect 200
   ```

3. **Check whether the admin account was already created automatically.**
   Unlike Cloud Run, GKE's looser initialization-job ordering gives the
   `admin-create` job's internal retry loop (20 attempts, 15s apart) a real
   chance to win its race against the main pod's boot — so it may have
   already succeeded during the deploy:

   ```bash
   kubectl get jobs -n "$NS"
   kubectl logs -n "$NS" job/$(kubectl get jobs -n "$NS" -o name | grep admin-create | head -1 | cut -d/ -f2)
   ```

   Look for `[admin-create] Done.` in the output. If instead you see it still
   retrying or failed, trigger a fresh run:

   ```bash
   JOB=$(kubectl get jobs -n "$NS" -o name | grep admin-create | head -1 | cut -d/ -f2)
   kubectl create job --from=job/"$JOB" "${JOB}-retry" -n "$NS"
   kubectl wait --for=condition=complete --timeout=300s job/"${JOB}-retry" -n "$NS"
   ```

4. **Retrieve the generated `SUPERUSER_PASSWORD` from Secret Manager:**

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

5. Log in with the default `admin` username (or whatever `superuser_username`
   was set to) and the retrieved password, using any
   ActivityPub/GoToSocial-compatible client, or verify the client API
   directly:

   ```bash
   curl -A "gotosocial-lab-check/1.0" -s "http://${EXTERNAL_IP}/api/v1/instance" | head -c 500
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and jobs:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit would be reverted on the next apply). GoToSocial defaults to
   `min_instance_count = 0` (scale-to-zero) and `max_instance_count = 1` —
   **do not raise `max_instance_count`**: GoToSocial's in-process cache has
   no cross-instance synchronization, and upstream does not support multiple
   instances against the same database/storage.

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**; a new image pull and rolling
   update replaces the pod. Schema migrations run automatically on boot —
   there is no separate migrate job to run.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~gotosocial"
   kubectl get jobs -n "$NS"          # db-init, admin-create jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=gotosocial --project="$PROJECT"
   ```

6. **Verify object storage is being used** (media/avatars/attachments go
   straight to GCS via GoToSocial's native S3 client, not a filesystem mount):

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation, restart counts, and request metrics. The module
   can provision an **uptime check** (when enabled); review Monitoring →
   Uptime checks and Alerting → Policies. Note that if you enable it, a
   plain `/` uptime check (not `/readyz`/`/livez`) avoids the
   User-Agent-gate false-positive-failure risk unless the checker sends a
   `User-Agent`.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with GoToSocial releases.

- **Health checks/curl return `418 I'm a teapot`:** this is expected —
  GoToSocial rejects any request without a `User-Agent` header as an
  anti-scraper measure, even against its "unauthenticated" `/readyz`/`/livez`
  endpoints. Always pass `curl -A "<some-agent>" ...`. This is *not* a sign
  the pod is unhealthy.
- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Both the
  startup and liveness probes are **TCP** on port 8080 (not HTTP), so a
  "Ready" pod can still error on requests if Postgres or GCS isn't reachable
  — check application logs, not just pod status.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`error opening storage backend: ... Access Denied`:** on a *fresh first
  deploy*, this can be a one-time IAM propagation race (the storage service
  account's `roles/storage.objectAdmin` grant can take 1–2 minutes to
  propagate) — the pod's restart-and-retry cycle self-resolves within a few
  minutes. If it persists, verify the grant:
  ```bash
  BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~gotosocial" --format="value(name)" --limit=1)
  gcloud storage buckets get-iam-policy "gs://$BUCKET"
  ```
- **`admin-create` job never completed (no `[admin-create] Done.` in its
  logs):** the job's own 20-attempt/15-second retry loop lost the race
  against the main pod's first boot. Confirm the main pod is `Ready`, then
  re-trigger the job (Task 2, step 3).
- **`admin-create` retry fails with `sql: no rows in result set` /
  `IsUsernameAvailable` reports the username is already taken, but you never
  successfully created it:** this means an earlier attempt left an orphaned
  `accounts` row with no matching `users` row (GoToSocial inserts the account
  first, then panics on the user-row step if the instance application wasn't
  ready). This is a real, recurring failure mode on any deploy where the
  first attempt races the pod's boot and loses — not a one-off. Recover by
  connecting directly to the database (a one-off debug pod is simplest on
  GKE) and cleaning up the orphaned row before retrying:
  ```bash
  kubectl run pg-debug --rm -it --restart=Never --image=postgres:15-alpine -n "$NS" -- sh
  # inside the debug pod:
  #   psql "postgresql://<db-user>:<db-password>@<db-host>:5432/<db-name>"
  ```
  ```sql
  SELECT id, username, domain FROM accounts WHERE username='admin';  -- or your superuser_username
  DELETE FROM account_settings WHERE account_id='<the id above>';
  DELETE FROM account_stats WHERE account_id='<id>';
  DELETE FROM accounts WHERE id='<id>';
  ```
  Then re-run `admin-create` (Task 2, step 3) cleanly. (DB credentials are in
  Secret Manager — `gcloud secrets list --project="$PROJECT" --filter="name~gotosocial-db"`.)
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace via the
  Secret Store CSI driver, and the `db-init` job completed with the database
  showing `C` collation:
  ```sql
  SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'gotosocial';
  ```
  `enable_cloudsql_volume` defaults `true` on this module (the
  cloud-sql-proxy sidecar) — leave it enabled; GoToSocial connects over its
  `127.0.0.1` loopback (`GTS_DB_TLS_MODE = "disable"` is correct here, unlike
  Cloud Run).
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP (`reserve_static_ip = true` is the default and recommended
  setting — see the Configuration Guide for the internal-DNS race it avoids).
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including `max_instance_count` being a
hard architectural ceiling, the `host` immutability, and the orphaned-account
recovery procedure).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes workload and namespace, Cloud SQL database, Secret Manager
secrets, the GCS `storage` bucket, the reserved static IP, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15, `C` collation), secrets, `storage` bucket, static IP, and runs `db-init` (+ best-effort `admin-create`) |
| 2 — Access & verify | Manual | Confirm health with a `User-Agent` header; verify or manually complete `admin-create`; retrieve `SUPERUSER_PASSWORD` |
| 3 — Operate | Manual | Inspect workload, scale (never above `max_instance_count = 1`), update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose the 418/User-Agent quirk, storage IAM propagation, admin-create races, orphaned account rows, DB, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
