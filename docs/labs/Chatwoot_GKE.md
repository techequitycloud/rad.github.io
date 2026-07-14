---
title: "Chatwoot on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Chatwoot on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Chatwoot on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chatwoot_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Chatwoot is an open-source, multi-channel helpdesk and customer-engagement
platform (email, live chat, social, and messaging inboxes, SLA tracking, and
reporting) — a GDPR-compliant alternative to Zendesk or Intercom. This lab
takes you through the full operational lifecycle of the **Chatwoot on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Chatwoot product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chatwoot_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload (and its co-located Sidekiq worker) with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, NFS/Redis, Artifact Registry, and shared service accounts
  this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Chatwoot (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Chatwoot_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds a custom Chatwoot container image (`chatwoot/chatwoot`
   wrapped with a cloud entrypoint), deploys the workload into the GKE
   Autopilot cluster behind an external LoadBalancer, provisions a Cloud SQL
   (PostgreSQL 15, with `pgvector`) database with its Secret Manager secrets
   (`SECRET_KEY_BASE` and the database password), a Cloud Storage bucket, a
   Filestore NFS mount for attachments, and Redis. It then runs two
   **chained** initialization jobs — `db-init` (creates the database, role,
   and grants, including `cloudsqlsuperuser`) followed by `chatwoot-prepare`
   (`rails db:chatwoot_prepare`, using the built app image, to create the
   schema). First deploys take roughly **20–35 minutes** (Cloud SQL creation
   and the custom image build dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep chatwoot | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the chained initialization jobs both completed successfully before
   trusting the schema is ready:

   ```bash
   kubectl get jobs -n "$NS"
   kubectl logs -n "$NS" job/<db-init-job-name>
   kubectl logs -n "$NS" job/<chatwoot-prepare-job-name>
   ```

3. Confirm the service is healthy. Chatwoot's login/onboarding page responds
   with HTTP 200 and needs no authentication:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

4. Open `http://${EXTERNAL_IP}` in a browser. On first visit Chatwoot's
   onboarding UI prompts you to create the initial administrator account
   interactively — no pre-seeded admin credential exists in Secret Manager.
   Fill in your name, email, and a password to finish onboarding.
   `ENABLE_ACCOUNT_SIGNUP` defaults to `"false"`, so afterwards only invited
   users can join; flip it temporarily via `environment_variables` if you
   need public self-service signup.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and disruption budget:

   ```bash
   kubectl get deploy,pods,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling
   is a configuration change, not a manual `kubectl scale` (a manual edit would
   be reverted on the next apply). Chatwoot's Sidekiq worker (background job
   delivery, notifications, reports) and ActionCable (real-time UI updates)
   run co-located in the same pod, so **keep `min_instance_count >= 1`** — the
   workload should not be scaled to zero in production. Session affinity
   (`ClientIP`) is set by default to keep a client's requests on the same pod.

3. **Update the application version** by changing the `application_version`
   input (the `chatwoot/chatwoot` image tag) in the RAD platform and applying
   it via **Update**; a new image builds and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~chatwoot"
   kubectl get jobs -n "$NS"          # db-init + chatwoot-prepare
   kubectl get pvc -n "$NS"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=chatwoot --project="$PROJECT"
   ```

6. **Check attachment persistence** — uploaded files live on Filestore NFS at
   `/opt/chatwoot/storage`, not the auto-provisioned `storage`-suffixed GCS
   bucket:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. Both the Rails web process
   and the co-located Sidekiq worker write to the same pod stdout/stderr:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Chatwoot releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness
  probe targets `GET /`; it allows an initial 60-second delay and up to 30
  retries at a 15-second period, sized to absorb `chatwoot-prepare` finishing
  ahead of the app container.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Initialization job failed:** `chatwoot-prepare` depends on `db-init`
  completing first; if schema prep fails with `must be superuser` on `CREATE
  EXTENSION`, the `cloudsqlsuperuser` grant in `db-init` did not land. Inspect
  the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace, and the
  init jobs completed. On GKE, pods reach Postgres via a `cloud-sql-proxy`
  sidecar on `127.0.0.1:5432` — a different mechanism from the CloudRun
  variant's Unix socket.
- **Background jobs/notifications not delivering but the UI loads fine:**
  Sidekiq only runs while the pod is alive. Confirm `min_instance_count >= 1`
  — scaling the workload to zero stops background delivery entirely.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP (`reserve_static_ip = true` keeps it stable across redeploys).
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it. A nonexistent `application_version` tag
  (e.g. an inherited default from another app) fails the build with
  `MANIFEST_UNKNOWN` — confirm the tag exists on Docker Hub for
  `chatwoot/chatwoot`.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`SECRET_KEY_BASE` after first boot, and never to disable `enable_redis`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, NFS-hosted
attachments, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, GKE cluster, shared Cloud SQL, NFS/Redis, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom Chatwoot image, deploys the GKE workload, Cloud SQL (PostgreSQL 15 + pgvector), secrets, storage, NFS, Redis, and runs the chained `db-init` → `chatwoot-prepare` jobs |
| 2 — Access & verify | Manual | Connect to the cluster; init jobs confirmed successful; health check (`GET /`) passes; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect workload, scale (keep `min >= 1`), update version, manage secrets/storage, DB access, verify attachment persistence |
| 4 — Observe | Manual | Query Cloud Logging (web + Sidekiq); review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, init-job, database, background-delivery, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
