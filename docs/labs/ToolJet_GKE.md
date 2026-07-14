---
title: "ToolJet on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy ToolJet on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# ToolJet on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/ToolJet_GKE)**

## Overview

**Estimated time:** 45–90 minutes

ToolJet is an open-source, low-code platform for building and deploying internal
tools — dashboards, admin panels, and CRUD apps — with a drag-and-drop builder over
your own databases and APIs. This lab takes you through the full operational
lifecycle of the **ToolJet on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
ToolJet product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/ToolJet_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Complete the first-run setup wizard and perform day-2 operations.
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

1. Click **Deploy** in the RAD platform top navigation, open **ToolJet (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/ToolJet_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) instance with **two databases** (the metadata DB and the
   ToolJet Database) and their Secret Manager secrets (`SECRET_KEY_BASE`,
   `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET`, and the database password), builds the
   container image, and runs a one-shot database-initialisation job (creating both
   databases and the `CREATEROLE` app role). First deploys take roughly **20–35
   minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep tooljet | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. ToolJet exposes a public health endpoint that
   returns 200 once the server has finished its on-boot migrations and is listening:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/api/health"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` (or the provisioned `nip.io` HTTPS host) in a
   browser. On first visit ToolJet presents a **setup wizard** — because
   `DISABLE_SIGNUPS = "true"` ships on, this is the only way to create the first
   account. Fill in your name, email, and a password to create the initial **admin
   user and workspace**; you then land in the ToolJet app builder. There is no
   pre-seeded admin credential in Secret Manager.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Session
   affinity (`ClientIP`) is set by default to keep the multiplayer editor's WebSocket
   connections pinned to one pod.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a rolling update replaces the pods.
   The entrypoint re-runs `db:migrate:prod`, so schema changes are applied on boot.

4. **Manage secrets, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~tooljet"
   kubectl get jobs -n "$NS"          # DB-init and any scheduled jobs
   ```

5. **Open a database session** for inspection or maintenance (note the two databases):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=tooljet --database=tooljet --project="$PROJECT"
   gcloud sql connect "$INSTANCE" --user=tooljet --database=tooljet_db --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   Look for the `[cloud-entrypoint]` lines confirming the config and the
   `db:migrate:prod` run.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with ToolJet releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness probe
  targets `/api/health`; a connection failure to PostgreSQL or a failed migration
  keeps the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`permission denied for schema postgrest`:** the `postgrest` schema is not
  app-owned — re-run the `db-init` job, which drops and recreates it `AUTHORIZATION`
  the app user.
- **`permission denied to create role` when creating a workspace:** the app role is
  missing the `CREATEROLE` attribute — re-run the `db-init` job.
- **Pod binds the wrong port / probe never passes:** confirm `PORT` resolves to 80
  (the entrypoint defaults it); ToolJet's built-in default is 3000, which the
  Service/probes do not target.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the init job completed.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `LOCKBOX_MASTER_KEY` after first
boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, both Cloud SQL databases, Secret Manager secrets, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared
Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (two PostgreSQL 15 databases), secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; complete the setup wizard to create the admin + workspace |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PostgREST/role, migration, database, init-job, and scheduling issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
