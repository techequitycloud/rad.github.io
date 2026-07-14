---
title: "Firefly III on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Firefly III on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Firefly III on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/FireflyIII_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Firefly III is a free, open-source self-hosted personal-finance manager for tracking
accounts, transactions, budgets, bills, and recurring transactions. This lab takes you
through the full operational lifecycle of the **Firefly III on GKE Autopilot** module
on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Firefly III product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/FireflyIII_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, set `APP_URL`, and create the first admin account.
- Perform day-2 operations — inspect pods, scale, update, manage secrets and backups, and wire the cron endpoint.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** authenticated: `gcloud auth login`,
  `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<workload-namespace>"   # from the deployment Outputs
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Firefly III (GKE)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/FireflyIII_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the GKE Autopilot workload (Deployment + LoadBalancer
   Service), a Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets (the
   Laravel `APP_KEY`, the `STATIC_CRON_TOKEN`, and the database password), a Cloud
   Storage uploads bucket, an NFS/Filestore volume for attachments, and runs a one-shot
   `db-init` job. First deploys take roughly **20–35 minutes**. The schema is created on
   the container's first boot, not by a separate migrate job.

3. Get cluster credentials and discover the resources:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Once the LoadBalancer IP is assigned, **set `APP_URL`** to the external host so
   Firefly III builds correct absolute links. Do it via `application_domains` /
   `environment_variables` and **Update**, or patch the Deployment:

   ```bash
   SVC=$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
   kubectl patch deploy "$SVC" -n "$NAMESPACE" \
     -p '{"spec":{"template":{"spec":{"containers":[{"name":"fireflyiii","env":[
       {"name":"APP_URL","value":"http://'"$EXTERNAL_IP"'"}
     ]}]}}}}'
   ```

2. Confirm the workload is healthy via the unauthenticated `/health` endpoint:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://$EXTERNAL_IP/health"   # expect 200
   ```

3. Open the URL in a browser. Firefly III shows the **`/register`** page — the **first
   account created becomes the site owner/administrator**. After creating it, open
   **Administration → Settings** and disable further registration.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect pods and events:**

   ```bash
   kubectl get pods -n "$NAMESPACE"
   kubectl describe pod -n "$NAMESPACE" -l app="$SVC"
   kubectl logs -n "$NAMESPACE" deploy/"$SVC" --tail=100
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** — the
   module owns the Deployment spec. GKE requires at least 1 replica; there is no
   scale-to-zero. `session_affinity = ClientIP` keeps a user's session on one pod.

3. **Update the application version** in the RAD platform and apply via **Update**; a
   rolling update replaces the pod and the image self-migrates the schema on boot.

4. **Wire the cron endpoint** so recurring transactions, bill reminders, and
   auto-budgets fire. Read the token and trigger it manually, then create a daily
   Kubernetes CronJob (or use the `cron_jobs` input):

   ```bash
   CRON_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~cron-token" --format="value(name)" --limit=1)
   TOKEN=$(gcloud secrets versions access latest --secret="$CRON_SECRET" --project="$PROJECT")
   curl -s "http://$EXTERNAL_IP/api/v1/cron/$TOKEN"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=fireflyiii --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Monitoring** — open the GKE workload dashboard and review pod CPU/memory,
   restarts, and request latency. Review Cloud SQL metrics for connections and CPU. If
   you enabled an uptime check, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Firefly III releases.

- **Pod not Ready / CrashLoopBackOff:** inspect the pod and logs for startup errors and
  confirm secrets/env resolved. The startup probe is TCP on port 8080; the liveness
  probe targets `/health`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SVC"
  kubectl logs -n "$NAMESPACE" deploy/"$SVC" --previous --tail=100
  ```
- **Database connection errors:** on GKE the connection is loopback through the Cloud
  SQL Auth Proxy sidecar (`DB_HOST = 127.0.0.1`, `PGSQL_SSL_MODE = prefer`). Forcing
  `require` fails with "SSL is not enabled on the server". Confirm the sidecar is
  running and `db-init` completed.
- **Initialisation job failed:** `kubectl get jobs -n "$NAMESPACE"` then read the failed
  job's pod logs.
- **Absolute links / redirects wrong:** confirm `APP_URL` is set to the external host.
- **Recurring transactions not firing:** verify a daily CronJob hits
  `/api/v1/cron/<STATIC_CRON_TOKEN>`.
- **Uploaded attachments disappearing:** confirm `enable_nfs = true` and the NFS volume
  is mounted at `/var/lib/fireflyiii`.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `APP_KEY` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the GKE workload
and Service, Cloud SQL database, Secret Manager secrets, GCS buckets, NFS volume, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL 15), secrets, uploads bucket, NFS, and runs DB init |
| 2 — Access & verify | Manual | Set `APP_URL`; `/health` returns 200; create the owner account at `/register` |
| 3 — Operate | Manual | Inspect pods, scale, update version, wire cron, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, URL, cron, and NFS issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
