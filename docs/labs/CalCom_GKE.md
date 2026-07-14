---
title: "Cal.com on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Cal.com on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Cal.com on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/CalCom_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Cal.com is an open-source scheduling platform — the self-hosted Calendly alternative — built with Next.js and Prisma on PostgreSQL. This lab takes you through the full operational lifecycle of the **Cal.com on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on Cal.com product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/CalCom_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Access and verify the running workload and complete Cal.com's onboarding.
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

1. Click **Deploy** in the RAD platform top navigation, open **Cal.com (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/CalCom_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (auto-generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`, plus the
   database password), builds/mirrors the Cal.com image, and runs a one-shot
   `db-init` job that creates the empty database and role. **No GCS bucket is
   created** — Cal.com keeps all state in PostgreSQL. The job does not create the
   application schema; Cal.com runs `prisma migrate deploy` on every start, so the
   schema is created on the pod's first boot. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep calcom | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Cal.com's health path is `/`, which returns
   HTTP 200 once the app has finished running its Prisma migrations on first
   boot — the schema is created **on boot**, not by the init job, so allow
   several minutes on a fresh deploy (the startup probe window is generous —
   up to ~15 minutes — for exactly this reason):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

3. Open `http://${EXTERNAL_IP}` in a browser and complete Cal.com's onboarding
   to create the initial administrator/owner account, then connect at least
   one calendar. **Immediate hardening note:** self-hosted Cal.com allows
   self-service sign-up by default — restrict it (or front the service with
   IAP) if the instance should not be public.

4. **URL discipline:** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL` default to the
   runtime cluster URL. Before sharing booking links (or once a custom domain
   is assigned), set `webapp_url` to the LoadBalancer IP or custom-domain
   address and apply it via **Update** — this URL is baked into every booking
   and OAuth link, so a wrong or unset value breaks them.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit would be reverted on the next apply). Cal.com is stateless
   (`workload_type = Deployment`); session affinity (`ClientIP`) is set by
   default to keep a client's requests on the same pod. Enabling `enable_redis`
   requires either `redis_host` or `enable_nfs = true` for the co-located NFS
   Redis endpoint.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds/mirrors and a
   rolling update replaces the pods, applying any pending Prisma migrations on
   their first boot.

4. **Manage secrets and jobs** — and know which secrets are immutable:

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~calcom"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   `CALENDSO_ENCRYPTION_KEY` encrypts stored calendar/OAuth credentials and
   `NEXTAUTH_SECRET` signs sessions — **never rotate either after first boot**
   outside a planned maintenance window (rotation orphans every connected
   calendar integration or logs out every user, respectively).

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=calcom --project="$PROJECT"
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
   provision an **uptime check** against `/` (when enabled); review Monitoring
   → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Cal.com releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs first — the
  startup probe targets `/` and allows a generous window for first-boot
  Prisma migrations:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **OOM crash at startup:** `memory_limit` must be **≥ 2 GiB** — Next.js 16
  OOM-crashes below it and the pod never becomes Ready.
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15)
  instance is `RUNNABLE`, the DB password secret materialised into the
  namespace, and `enable_cloudsql_volume = true` (the Auth Proxy sidecar gives
  Cal.com its `127.0.0.1` PostgreSQL endpoint — disabling it with a real
  database is blocked by a plan-time guard).
- **Initialisation job failed:** inspect the job and its pod logs (it only
  creates the empty database/role — it does not build the schema):
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.
- **Wrong or broken booking/OAuth links:** verify `webapp_url` (or the
  injected runtime default) resolves to the actual external address — the
  image's `localhost:3000` default produces broken links.
- **403 / permission errors:** verify the workload service account's IAM
  roles; if IAP is enabled, remember it blocks *all* unauthenticated
  requests — including public booking pages and embeds.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`CALENDSO_ENCRYPTION_KEY` or `NEXTAUTH_SECRET` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database (all users, event types, and bookings),
Secret Manager secrets (including `NEXTAUTH_SECRET` and
`CALENDSO_ENCRYPTION_KEY`), and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, mirrors the image, and runs DB init (no GCS bucket) |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; complete onboarding, restrict open sign-up, set `webapp_url` |
| 3 — Operate | Manual | Inspect workload, scale, update version, respect immutable secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, OOM, database, init-job, scheduling, URL, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
