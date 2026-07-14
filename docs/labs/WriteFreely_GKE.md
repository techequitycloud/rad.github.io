---
title: "WriteFreely on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy WriteFreely on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# WriteFreely on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/WriteFreely_GKE)**

## Overview

**Estimated time:** 45–90 minutes

WriteFreely is an open-source, minimalist, federated blogging platform written in
Go — a lightweight Medium alternative for publishing clean, distraction-free
writing. This lab takes you through the full operational lifecycle of the
**WriteFreely on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on WriteFreely product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/WriteFreely_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running blog.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the database.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service accounts
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

1. Click **Deploy** in the RAD platform top navigation, open **WriteFreely
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/WriteFreely_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster,
   provisions a Cloud SQL (MySQL 8.0) database with its Secret Manager secrets
   (three AES-256 keys — `cookies-auth`, `cookies-enc`, `email-key` — plus the
   database password), a dedicated `writefreely-uploads` Cloud Storage bucket,
   builds the custom config-gen container image, an NFS filesystem (enabled by
   default), and runs a one-shot database-initialisation job. First deploys
   take roughly **15–25 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep writefreely | head -1 | cut -d/ -f2)
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

2. Confirm the service is up. WriteFreely has no dedicated `/health` endpoint —
   the liveness probe is an HTTP `GET /` that expects a `200` from the home page:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser to confirm the blog's home page
   renders. Registration is **closed by default** (`open_registration = false`)
   and no admin account is seeded, so create the first account now, either:

   - Temporarily set `WF_OPEN_REGISTRATION = "true"` in `environment_variables`
     and apply via **Update**, register through the UI, then set it back to
     `"false"` and apply again; **or**
   - `exec` WriteFreely's built-in admin creation command inside a running pod:

     ```bash
     SERVICE=$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')
     kubectl exec -n "$NS" deploy/"$SERVICE" -- \
       /usr/local/bin/writefreely --create-admin <user>:<password>
     ```

4. **Do not rotate the AES-256 keys** (`cookies-auth`, `cookies-enc`,
   `email-key`) after this first boot — doing so logs out every user and makes
   previously encrypted email addresses undecryptable.

5. After the LoadBalancer IP is assigned, set `WF_PUBLIC_URL` (via
   `environment_variables`) to `http://<external-ip>` or a custom domain, so
   generated links and federation use the reachable host.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling
   is a configuration change, not a manual `kubectl scale` (a manual edit would
   be reverted on the next apply). WriteFreely defaults to `min_instance_count
   = 1` and `max_instance_count = 1` (GKE does not support scale-to-zero).
   Session affinity (`ClientIP`) is set by default to keep requests from the
   same client sticking to the same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update replaces the pods. Pin a specific release rather than leaving
   `application_version = "latest"` in production, so rebuilds stay
   reproducible.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" \
     --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=writefreely --database=writefreely --project="$PROJECT"
   ```

6. **Confirm the injected DB host in the running pod** (should be
   `127.0.0.1` — the Cloud SQL Auth Proxy sidecar — not the private IP):

   ```bash
   kubectl exec -n "$NS" deploy/"$SERVICE" -- env | grep -E 'DB_HOST|WF_'
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. On first boot look for the
   entrypoint's progress lines (`WriteFreely: rendered config.ini …`, `… seeded
   stable encryption keys …`, `… starting server …`):

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with WriteFreely releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe is TCP (Ready as soon as port 8080 is bound); the liveness probe is
  HTTP `GET /`. A connection failure to MySQL via the Auth Proxy sidecar will
  keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace, and the
  init job completed. WriteFreely on GKE reaches MySQL through the **Cloud SQL
  Auth Proxy sidecar on `127.0.0.1:3306`** (`enable_cloudsql_volume = true`) —
  do not confuse this with the Cloud Run variant's private-IP TCP path.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it — `container_image_source` must stay
  `custom` since the config-gen entrypoint is not present in any prebuilt
  upstream image.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate the
AES-256 keys after first boot, and why `application_database_name`/
`application_database_user` are immutable after first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the RAD
platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created — the
Kubernetes workload and namespace, Cloud SQL database, Secret Manager secrets,
GCS buckets, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), 3 AES-256 key secrets, storage bucket, NFS, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; home page returns 200; create the initial account |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
