---
title: "DocuSeal on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy DocuSeal on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# DocuSeal on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Docuseal_GKE)**

## Overview

**Estimated time:** 45–90 minutes

DocuSeal is an open-source document e-signature platform — a self-hosted DocuSign
alternative built on Ruby on Rails with a visual form builder, reusable templates, and
audit trails, backed by PostgreSQL. This lab takes you through the full operational
lifecycle of the **DocuSeal on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
DocuSeal product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Docuseal_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

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

1. Click **Deploy** in the RAD platform top navigation, open **DocuSeal (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Docuseal_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (`SECRET_KEY_BASE` and the database password), a Cloud Storage bucket, mounts the
   shared NFS volume at `/data/docuseal` for persistent documents (the default
   persistence model), builds the container image, and runs a one-shot
   database-initialisation job (creates the `docuseal` role and database). First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep docuseal | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. DocuSeal exposes Rails' built-in `/up` health
   endpoint, which returns an unauthenticated `200` once Puma has started and
   PostgreSQL is reachable through the Cloud SQL Auth Proxy sidecar:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/up"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. DocuSeal ships with no default
   credentials — complete the setup screen to create the initial administrator
   account (email + password) before inviting users or creating templates.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment (or statefulset, if a block PVC is
   enabled), pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). GKE
   requires at least 1 replica (no scale-to-zero). `session_affinity` (`ClientIP`)
   is set by default to keep multi-step signing sessions routed to the same pod.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a rolling update replaces the
   pods. DocuSeal runs its own ActiveRecord migrations automatically on every boot, so
   a version bump applies schema changes without a separate migration step — pin
   `application_version` in production so an unreviewed `latest` pull does not apply
   unexpected migrations.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~docuseal"
   kubectl get jobs -n "$NS"          # db-init job
   kubectl get pvc -n "$NS"          # only present if stateful_pvc_enabled = true
   ```

5. **Inspect persistent documents** — DocuSeal writes uploads to `/data/docuseal` on
   the NFS volume (or block PVC):

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" -- df -h /data/docuseal
   ```

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=docuseal --database=docuseal --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer (Rails logs to stdout):

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation (PDF rendering/signing is memory-hungry), restart counts, and
   request metrics. The module can provision an **uptime check** (disabled by
   default); when enabled, review Monitoring → Uptime checks and Alerting →
   Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with DocuSeal releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes target `/up` on port 3000 — if `container_port` or the probe ports
  were ever changed away from 3000, they hit a dead port (GKE does not inject `PORT`
  the way Cloud Run does) and the pod never becomes Ready even though the app is
  healthy.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, that
  `enable_cloudsql_volume` is `true` (the Auth Proxy sidecar gives the entrypoint its
  expected `127.0.0.1` loopback path), and that the init job completed.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Documents missing after a pod restart:** confirm exactly one of `enable_nfs` or
  `stateful_pvc_enabled` is set — with neither, uploads land on the pod's ephemeral
  disk and are lost on restart or rescheduling.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `SECRET_KEY_BASE` after first
boot, and keeping `nfs_mount_path`/`stateful_pvc_mount_path` set to `/data/docuseal`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS bucket, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, storage bucket, NFS mount, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; `/up` health check passes; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage/documents, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, storage, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
