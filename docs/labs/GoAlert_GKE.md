---
title: "GoAlert on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy GoAlert on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# GoAlert on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/GoAlert_GKE)**

## Overview

**Estimated time:** 45–75 minutes

GoAlert is an open-source on-call scheduling and incident alert-escalation
platform, originally built by Target, with escalation policies, on-call
rotations/schedules, and outbound notification dispatch (email, webhook, and
optionally Twilio SMS/voice). This lab takes you through the full operational
lifecycle of the **GoAlert on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on GoAlert product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/GoAlert_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and retrieve the
  bootstrapped admin credentials.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including
  the load-bearing initialization-job ordering.
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

1. Click **Deploy** in the RAD platform top navigation, open **GoAlert (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/GoAlert_GKE)
   documents every input by group, with defaults. If deploying alongside a
   `GoAlert_CloudRun` instance in the same project, set
   `tenant_deployment_id = "gke"` (and `"cr"` on the Cloud Run deployment) so the
   two variants don't collide on shared resource names. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 17) database with its Secret Manager secrets (admin
   password, data-encryption key, and the database password), builds the custom
   container image, and runs the 3-stage database initialization job chain
   (`db-init` → `db-migrate` → `admin-bootstrap`). First deploys typically take
   roughly **15–25 minutes** — Cloud SQL instance creation dominates. Unlike Cloud
   Run's `execute_on_apply` semantics, on GKE the Jobs' pods are scheduled
   immediately regardless of that setting; correctness of the ordering comes from
   each job's `depends_on_jobs`, not from Terraform waiting.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep goalert | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. GoAlert exposes a public, unauthenticated
   `/health` endpoint:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Retrieve the bootstrapped admin credentials. GoAlert has **no first-visit setup
   wizard** — the only account that exists is the one created by the
   `admin-bootstrap` initialization job at deploy time:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~goalert AND name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

4. Open `http://${EXTERNAL_IP}` in a browser and log in with the username
   (`admin` by default) and the password retrieved above.

5. **Set `public_url`** to the external IP or custom domain, then apply the change
   via **Update**. Unlike the Cloud Run variant, this module does not
   auto-compute a service URL — leaving it unset means `GOALERT_PUBLIC_URL` falls
   back to GoAlert's own `http://localhost:8081`, which breaks OIDC callbacks and
   links in outgoing notification emails. Reserving a static IP
   (`reserve_static_ip = true`, the default) keeps this address stable across
   redeploys.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Keep `min_instance_count >= 1`: GoAlert runs a
   continuous in-process escalation engine that must keep running to evaluate
   schedules and fire real alerts.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update replaces the pod, and the 3-stage init job chain re-runs (all three jobs
   are idempotent and safe to re-run).

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~goalert"
   kubectl get jobs -n "$NS"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=admin --project="$PROJECT"
   ```

   Note the default database user on this variant is `admin`, not `goalert` — see
   the Configuration Guide for the naming inconsistency between the CloudRun and
   GKE variants.

6. **Manage on-call schedules and escalation policies** — GoAlert-specific
   day-2 operations performed in the web UI (Escalation Policies, Schedules,
   Rotations, Services) rather than via Terraform; these are GoAlert application
   data, not infrastructure.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Look for a real "listening and serving HTTP" line confirming the server bound
   its port successfully. Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts. The module can provision an **uptime
   check** (when enabled); review Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with GoAlert releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  is TCP against the container port with a 30-second initial delay and up to 30
  retries (accommodating first-boot migration time).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and
  the cloud-sql-proxy sidecar is healthy. On GKE the entrypoint connects over
  loopback TCP (`127.0.0.1`), not a Unix socket — check the pod's injected
  `DB_HOST`/`DB_IP` values if connections fail.
- **Migration failures — the load-bearing step.** If `admin-bootstrap` fails with
  `relation "auth_basic_users" does not exist`, `db-migrate` did not complete
  successfully first. Check its pod logs specifically:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-migrate-job-name>
  ```
  Remember that on GKE, `execute_on_apply = false` (if set on a custom job)
  would NOT have delayed pod scheduling — only Terraform's wait for the result.
  If ordering looks wrong, verify each job's `depends_on_jobs` chain rather than
  assuming apply-time sequencing protected you.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `public_url` must be set manually on this variant, and why
`min_instance_count` must stay at its default for GoAlert's escalation engine to
function correctly).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Kubernetes workload and
namespace, Cloud SQL database, Secret Manager secrets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud
SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 17), secrets, and runs the `db-init` → `db-migrate` → `admin-bootstrap` chain |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes on `/health`; retrieve bootstrapped admin credentials and log in; set `public_url` |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets, DB access, manage schedules/escalation policies |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, migration-ordering, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
