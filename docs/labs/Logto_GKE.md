---
title: "Logto on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Logto on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Logto on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Logto_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Logto is an open-source identity provider — an Auth0 alternative that speaks OIDC
and OAuth 2.0, with sign-in flows, social/enterprise connectors, multi-tenancy, and
an admin console. This lab takes you through the full operational lifecycle of the
**Logto on GKE Autopilot** module on Google Cloud: deploy it, access and verify it,
run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Logto product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Logto_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and reach the admin
  console for first-run setup.
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

1. Click **Deploy** in the RAD platform top navigation, open **Logto (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Logto_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secret (the database
   password — Logto has no external application secret; its OIDC signing keys are
   generated into the database on first boot), a Cloud Storage bucket, builds the
   container image, and runs a one-shot database-initialisation job that creates
   the application role (with `CREATEROLE`) and database. A LoadBalancer Service
   with a reserved static IP and nip.io custom domain is provisioned by default.
   First deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep logto | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Logto exposes an unauthenticated status
   endpoint that responds only once the core has booted and seeded its schema:

   ```bash
   curl -s "http://${EXTERNAL_IP}/api/status"   # expect HTTP 200
   ```

3. **The admin console is not reachable at the external IP.** The Service exposes
   only the core (port 3001, OIDC); the admin console — where you create the first
   administrator and register OIDC applications — runs on port 3002. Reach it via
   a port-forward directly to the pod:

   ```bash
   kubectl port-forward -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 3002:3002
   # then open http://localhost:3002
   ```

4. Create the first administrator account and register your first OIDC
   application. Note the registered redirect URI must use the same host as
   `ENDPOINT` (see Task 5) — a mismatch breaks every OAuth callback.

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
   reverted on the next apply). GKE requires `min_instance_count >= 1` (no
   scale-to-zero); session affinity (`ClientIP`) is set by default so a client
   consistently reaches the same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update replaces the pods. Pin `application_version` to a specific release
   (e.g. `1.33`) in production rather than tracking `latest`.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~logto"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=logto --database=logto --project="$PROJECT"
   ```

   Never wipe or reset this database outside of an intentional restore — Logto's
   OIDC signing keys live only in it, and wiping it invalidates every issued token
   and registered client.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The entrypoint prints a
   `[cloud-entrypoint]` line reporting the resolved DB connection mode and
   `ENDPOINT`, which is the first thing to check when diagnosing a connection or
   issuer-URL problem:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. An **uptime check** is
   disabled by default; the module can provision one against the LoadBalancer
   host when enabled — review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Logto releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness and
  startup probes target `/api/status`, with a wide first-boot window for the
  schema/OIDC-key seed step; a connection failure to PostgreSQL will keep the pod
  from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **OIDC / login callback errors:** confirm `ENDPOINT` matches the exact external
  LoadBalancer or custom-domain host the browser used to reach Logto — Logto
  builds its OIDC issuer and every absolute redirect URL from this value.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and
  the DB password secret materialised into the namespace via the Secret Store CSI
  driver. On GKE the Auth Proxy sidecar listens on `127.0.0.1`; the entrypoint
  connects over plain TCP loopback with SSL disabled (the proxy terminates TLS) —
  this differs from the private-IP path used on Cloud Run.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Admin console unreachable:** this is expected at the external IP — see Task 2.
  The admin console (3002) is never published on the LoadBalancer Service; use a
  port-forward instead.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to wipe the Cloud SQL database, since
Logto's only copy of its OIDC signing keys lives there).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database (and with it Logto's only copy of its OIDC
signing keys), Secret Manager secret, GCS bucket, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), a DB-password secret, a storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; reach the admin console via port-forward to create the first administrator |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, OIDC/callback, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
