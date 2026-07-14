---
title: "LangFlow on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy LangFlow on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LangFlow on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LangFlow_GKE)**

## Overview

**Estimated time:** 45–90 minutes

LangFlow is an open-source, low-code visual builder for AI agents and workflows,
built on LangChain — you assemble language-model chains, RAG pipelines, and agents by
dragging and wiring components on a canvas, then expose them as APIs. This lab takes
you through the full operational lifecycle of the **LangFlow on GKE Autopilot** module
on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on LangFlow product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LangFlow_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
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

1. Click **Deploy** in the RAD platform top navigation, open **LangFlow (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LangFlow_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (`LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD`, and the database password),
   a Cloud Storage `data` bucket, builds the container image, and runs a one-shot
   database-initialisation job that creates the application role, database, and
   grants. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates), and the first pod start also runs LangFlow's own Alembic migrations
   plus component loading before it becomes Ready.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep langflow | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. LangFlow exposes a public liveness endpoint that
   returns `200` once the server is fully up (after component loading and Alembic
   migrations):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Retrieve the auto-generated admin password from Secret Manager, then open
   `http://${EXTERNAL_IP}` in a browser and sign in as `admin` (or the value you set
   for `langflow_username`) with that password — LangFlow has authentication turned
   on by default (`LANGFLOW_AUTO_LOGIN = "false"`), so there is no open sign-up step:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~langflow AND name~superuser" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Keep `max_instance_count = 1`: LangFlow holds
   in-process session and flow-editor state, so running more than one replica splits
   that state and produces inconsistent behaviour. GKE does not scale to zero, so
   `min_instance_count = 1` is the default and floor. Session affinity (`ClientIP`)
   is set by default to keep the flow editor sticky to one pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pods. Pin `application_version` explicitly rather than leaving it at
   `latest` for anything beyond a lab.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~langflow"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   Never rotate `LANGFLOW_SECRET_KEY` after first boot — it encrypts every stored
   credential embedded in a flow, and rotating it makes them permanently
   undecryptable.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~langflow" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=langflowuser --project="$PROJECT"
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
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** (disabled by default); enable it for production use, review
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LangFlow releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness and
  startup probes target `/health`; allow time on first boot for component loading and
  Alembic migrations before the pod becomes Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the `db-init` job
  completed. LangFlow connects via the **Cloud SQL Auth Proxy sidecar** on
  `127.0.0.1`, composing `LANGFLOW_DATABASE_URL` with `sslmode=disable` (the proxy
  terminates TLS) — do not set the DSN manually.
- **`db-init` job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Can't sign in / lost the admin password:** re-fetch `LANGFLOW_SUPERUSER_PASSWORD`
  from Secret Manager (Task 2, step 3); it is not shown anywhere else.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `LANGFLOW_SECRET_KEY` after
first boot, and why `max_instance_count` must stay at `1`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, a `data` storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; sign in with the auto-generated admin password from Secret Manager |
| 3 — Operate | Manual | Inspect workload, scale (keep max=1), update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
