---
title: "Rallly on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Rallly on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Rallly on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Rallly_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Rallly is an open-source, self-hosted meeting-scheduling and group-poll application —
a privacy-friendly alternative to Doodle — built with Next.js and Prisma. This lab
takes you through the full operational lifecycle of the **Rallly on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe
it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Rallly product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Rallly_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and SMTP settings.
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

1. Click **Deploy** in the RAD platform top navigation, open **Rallly (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Rallly_GKE)
   documents every input by group, with defaults. Unlike the Cloud Run variant,
   `smtp_host` defaults to empty here — set `smtp_host`, `smtp_user`, and
   `smtp_password` now if you want email login working from the first boot. Review
   the estimated cost (if credits are enabled) and click **Deploy**, which opens the
   deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (`SECRET_PASSWORD`, `NEXTAUTH_SECRET`, an optional `SMTP_PWD`, and the database
   password), builds the container image, and runs a one-shot
   database-initialisation job that creates the empty database and role. First
   deploys take roughly **15–25 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep rallly | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the pod is fully ready. Rallly's own status endpoint (also the
   configured startup/liveness probe path on GKE) returns 200 once the app has
   finished the first-boot Prisma migration and confirmed its database connection:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/api/status"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Rallly's login is **passwordless and
   email-based** — there is no pre-seeded admin account. Enter your email on the
   sign-in page; Rallly emails a verification link/code through the configured SMTP
   relay. If nothing arrives, confirm SMTP is actually configured (Task 3, step 4)
   before assuming the deployment is broken.

4. Once you know the external IP (or a custom domain), set `base_url` to it and
   apply via **Update** so invite and login links resolve to the address users
   actually visit.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Rallly keeps all state in PostgreSQL (`Deployment`
   workload type, no PVC), so pods scale horizontally without any shared filesystem.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pods. Rallly's own `./docker-start.sh` runs `prisma migrate deploy`
   on every boot, so schema migrations apply automatically — no separate migration
   step is required.

4. **Manage secrets, SMTP, and jobs:**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~rallly"
   kubectl exec -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -E 'SMTP_|NEXT_PUBLIC_BASE_URL'
   kubectl get jobs -n "$NAMESPACE"          # db-init and any scheduled jobs
   ```

   Never rotate `SECRET_PASSWORD` or `NEXTAUTH_SECRET` outside of a planned
   maintenance window — see Task 5.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=rallly --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
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
platform-level diagnostics and do not change with Rallly releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Both the startup
  and liveness probes target `/api/status`; the startup probe allows a 30-period,
  10-failure window (roughly 5 minutes) to cover the first-boot Prisma migration
  before the liveness probe (60s initial delay) starts checking.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Users cannot sign in:** Rallly's login is passwordless and email-based. Confirm
  `smtp_host` / `smtp_user` / `smtp_password` are set — unlike the Cloud Run variant,
  `smtp_host` is empty by default here, so email is off until explicitly configured.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the init job completed.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Invite/login links point at the wrong host:** set `base_url` to the external
  LoadBalancer IP or custom domain — otherwise `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL`
  are left unset.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `SECRET_PASSWORD` or
`NEXTAUTH_SECRET` after first boot, and the `db_name`/`db_user` immutability rule).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; status endpoint returns 200; sign in via emailed verification link |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/SMTP, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, SMTP, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
