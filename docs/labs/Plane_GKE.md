---
title: "Plane on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Plane on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Plane on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Plane_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Plane is an open-source project-management and issue-tracking tool — a Jira / Linear / Asana alternative covering issues, sprints, cycles, modules, and roadmaps. This lab takes you through the full operational lifecycle of the **Plane on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on Plane product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Plane_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running Plane workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including the RabbitMQ dependency and the in-image migrator step.
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

1. Click **Deploy** in the RAD platform top navigation, open **Plane (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Plane_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys Plane's **all-in-one community image**
   (`makeplane/plane-aio-community`, custom-built by this module) into the GKE
   Autopilot cluster as a single Deployment (2 vCPU / 4 GiB by default), fronted
   internally by Caddy on port 80. Alongside it, the platform provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (auto-generated `SECRET_KEY` and `LIVE_SERVER_SECRET_KEY`, plus the database
   password), a **RabbitMQ** broker as a second in-cluster Deployment (internal-only,
   required — Plane's `start.sh` refuses to boot without an `AMQP_URL`), Redis on
   the shared NFS VM, a `storage` GCS bucket (file-upload wiring is a documented
   TODO — see Task 5), builds the custom container image, and runs a one-shot
   `db-init` job. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep plane | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

   You should see one Deployment for the Plane all-in-one workload and a second
   for RabbitMQ (Service suffix `-mq`), plus the `db-init` Job.

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Both the startup and liveness probes target
   `GET /health` on the internal Caddy proxy; on a fresh deploy allow several
   minutes for the bundled `migrator` step (Plane's own Django schema migrations,
   run under supervisord before api/worker/beat/web start) to finish — the
   startup probe permits up to ~5 minutes (30 failures at a 10s period):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"
   ```

3. Verify the wrapper entrypoint composed the three connection URLs Plane
   requires from the discrete values the platform injects:

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -E 'DATABASE_URL|REDIS_URL|AMQP_URL'
   ```

4. Open `http://${EXTERNAL_IP}/god-mode/` in a browser — Plane's instance-admin
   panel (note the trailing slash; the entrypoint patches Caddy with a redirect
   from the slash-less path) — and create the instance admin account. Then open
   `http://${EXTERNAL_IP}/` to sign up and create your first workspace, project,
   and issue. There is no pre-seeded admin credential in Secret Manager — the
   first account is created interactively.

5. **Immediate hardening note:** file uploads (attachments, avatars, cover
   images) require real S3-compatible credentials. The module provisions a GCS
   bucket and points `AWS_S3_ENDPOINT_URL` at `storage.googleapis.com`, but GCS's
   S3-interop layer needs HMAC keys this module does not provision — uploads
   silently fail until you supply `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_REGION`, `AWS_S3_BUCKET_NAME`, and `AWS_S3_ENDPOINT_URL` via the
   `environment_variables` input and apply via **Update**. Everything else
   (issues, projects, cycles) works without it.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, RabbitMQ, and the horizontal
   autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- supervisorctl status
   ```

   The `supervisorctl status` output lists every bundled sub-process (api,
   worker, beat, web, space, admin, live, migrator) inside the single pod.

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).
   Default is `min=1`/`max=3`. Because Celery's `beat` scheduler runs in-process
   inside every pod (not as a separate singleton), scaling beyond one replica may
   duplicate scheduled task ticks — verify this is acceptable before raising
   `max_instance_count`.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds (the wrapper Dockerfile pins
   `makeplane/plane-aio-community:<version>` — there is no upstream `latest` tag,
   so the module defaults to `stable` and remaps a supplied `latest` to `stable`
   automatically) and a rolling update replaces the pods. The migrator re-applies
   any schema changes on the new pod's start.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~plane"
   kubectl get jobs -n "$NS"                       # db-init and any additional jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   ```

5. **Check RabbitMQ** — it is mandatory and its storage is ephemeral (no
   PVC/NFS attached), so a pod restart or node preemption drops queued Celery
   jobs:

   ```bash
   kubectl get deploy,svc -n "$NS" | grep -- '-mq'
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')-mq" \
     -- rabbitmqctl list_queues
   ```

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=plane_user --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — supervisord multiplexes every bundled sub-process (migrator, api,
   worker, beat, frontends, Caddy) into the pod's stdout/stderr, plus the
   separate RabbitMQ pod's own logs:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')-mq" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** against `/health` (when enabled); review
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Plane releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs first.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```

- **KNOWN, UNRESOLVED ISSUE — migrator subprocess crashloops with no visible
  error, leaving `/api/instances/` returning 502:** in some deployments the
  api/worker/beat/live sub-processes all boot fine and pass the `/health`
  liveness check, but Plane's bundled `migrator` step under supervisord exits
  non-zero and supervisord respawns it forever — leaving the Django schema
  migrations incomplete. The symptom is a workload that looks Ready (`/health`
  is served by Caddy independently of the migrator) while API calls that touch
  unmigrated tables 502. **This does not surface in Cloud Logging** — supervisord
  does not forward child-process stderr for the `migrator` program to the
  container's own stdout/stderr, so `kubectl logs` shows nothing informative.
  Diagnosing it currently requires an interactive exec into the running pod:
  ```bash
  POD=$(kubectl get pods -n "$NS" -l app!=mq -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -n "$NS" "$POD" -- supervisorctl status         # confirm migrator shows FATAL/BACKOFF
  kubectl exec -n "$NS" "$POD" -- supervisorctl tail -1000 migrator stderr
  kubectl exec -n "$NS" "$POD" -- supervisorctl tail -1000 migrator stdout
  ```
  If the migrator's own log tail is still uninformative, try running its
  underlying management command directly inside the pod to surface the raw
  traceback (path and command name vary by image version — inspect
  `/app/supervisor/*.conf` or equivalent inside the container to confirm the
  exact invocation before running it manually). Treat this as an open platform
  issue, not a configuration mistake on your part — do not assume a clean
  first-boot migration just because the pod reports Ready.

- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret materialised into the namespace, and the `db-init` job
  completed (it creates the role/database and grants privileges before the
  migrator ever runs):
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```

- **Celery / broker errors (worker or beat cannot connect):** Plane's
  `start.sh` validates `AMQP_URL` and refuses to start at all if it is empty —
  the whole pod crash-loops, not just the worker. Confirm the `mq` Deployment
  is Running and that `RABBITMQ_HOST` resolved to the in-cluster DNS name
  (`<service-name>-mq.<namespace>.svc.cluster.local`):
  ```bash
  kubectl get deploy,svc -n "$NS" | grep -- '-mq'
  kubectl exec -n "$NS" "$POD" -- env | grep -E 'RABBITMQ_HOST|AMQP_URL'
  ```
  Because RabbitMQ storage is ephemeral, a pod restart drops any queued jobs —
  this is an accepted default, not a bug to fix locally.

- **File uploads fail (app otherwise healthy):** expected until S3-compatible
  storage is wired — see Task 2, step 5. This is Plane-specific and documented
  in the Configuration Guide's Pitfalls section.

- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```

- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.

- **Image pull / build errors:** review Cloud Build history. A common cause is
  an invalid `application_version` — the upstream `plane-aio-community` image
  has no `latest` tag (the module maps `latest`→`stable`, but a typo'd explicit
  tag 404s with `MANIFEST_UNKNOWN`).

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas, including the RabbitMQ-is-mandatory rule and the
file-upload TODO.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace (including the RabbitMQ Deployment), Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry, NFS/Redis host) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload (all-in-one image + RabbitMQ Deployment), Cloud SQL (PostgreSQL 15), Redis, storage bucket, secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; `/health` passes; connection URLs composed; instance admin created via `/god-mode/` |
| 3 — Operate | Manual | Inspect workload/RabbitMQ, scale, update version, manage secrets/storage/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, broker, upload, init-job, and image-build issues — including the unresolved migrator crashloop (exec-based diagnosis required) |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
