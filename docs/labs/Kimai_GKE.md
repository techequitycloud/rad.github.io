---
title: "Kimai on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Kimai on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Kimai on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kimai_GKE)**

## Overview

**Estimated time:** 45–60 minutes

Kimai is a free, open-source time-tracking application used by freelancers
and agencies for billable-hours tracking, timesheets, and reporting that
feeds into invoicing. This lab takes you through the full operational
lifecycle of the **Kimai on GKE Autopilot** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Kimai product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Kimai_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions.
- Connect to the GKE cluster and access the running workload, and log in
  with the bootstrapped administrator account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and
  storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service
  accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the
  project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Kimai (GKE)**
   from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Kimai_GKE)
   documents every input by group, with defaults. If your target project has
   no reserved static IP or custom domain available, leave
   `enable_custom_domain` and `reserve_static_ip` at their defaults or set
   them `false` explicitly — this module's own live-verified deployment did
   exactly that. Review the estimated cost (if credits are enabled) and
   click **Deploy**, which opens the deployment status page with real-time
   logs.

2. The platform deploys the workload into the GKE Autopilot cluster,
   provisions a Cloud SQL (MySQL 8.0) database with its Secret Manager
   secrets (`APP_SECRET`, `ADMINPASS`, and the database password), the
   `storage` Cloud Storage bucket, builds the custom `DATABASE_URL`-composing
   wrapper image, and runs the `db-init` initialization job (creates the
   database, user, and grants). First deploys take roughly **15–25 minutes**
   (Cloud SQL creation and the image build dominate).

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep kimai | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy — Kimai's login page returns **HTTP 200**:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/en/login"   # expect 200
   ```

3. Retrieve the bootstrapped administrator credentials from Secret Manager —
   the username is always `admin` (hardcoded by the vendor image), and the
   password is the auto-generated `ADMINPASS` secret:

   ```bash
   ADMINPASS_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMINPASS_SECRET" --project="$PROJECT"
   ```

4. Open `http://${EXTERNAL_IP}` in a browser (or your custom domain, if
   configured) and log in with `admin` and the password retrieved above.

5. Create a test project, activity, and timesheet entry to confirm
   end-to-end write/read against the real database: **Administration →
   Projects** (create one), **Administration → Activities** (create one),
   then log a timesheet entry against them. This is the surest sign the pod
   is actually writing to Cloud SQL through the Auth Proxy sidecar.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — Deployment, pods, and events:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit would be reverted on the next apply). Keep `max_instance_count = 1`
   unless you have verified Kimai's session behaviour under multiple pods.

3. **Update the application version** by changing `application_version` in
   the RAD platform and applying it via **Update**; a new image builds
   `FROM kimai/kimai2:<version>-apache` and the pod is recreated.
   `kimai:install` re-runs safely against the existing schema on the new
   container's first boot — no manual migration step is needed.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~kimai"
   gcloud storage buckets list --project="$PROJECT" --filter="name~kimai"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=kimai --project="$PROJECT"
   ```

6. **Set up an API token or additional users.** With the admin account
   logged in, go to **Profile → API access** to generate an API token for
   time-tracking integrations, or **Administration → Users** to invite
   teammates (self-service registration is off by default).

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation, restart counts, and request metrics, plus the
   Cloud SQL instance dashboard. The module can provision an **uptime
   check**; if enabled, review Monitoring → Uptime checks and Alerting →
   Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with Kimai releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe targets `GET /en/login` with a generous 20-retry threshold to cover
  the first-boot `kimai:install` run — a connection failure to Cloud SQL via
  the Auth Proxy sidecar (`127.0.0.1`) is what actually keeps the pod from
  becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous -c <service-name>
  kubectl exec -n "$NS" deploy/<service-name> -c <service-name> -- env | grep -E 'DB_IP|DATABASE_URL'
  ```
- **`enable_cloudsql_volume` was disabled by mistake.** This module's
  wrapper entrypoint relies on the Cloud SQL Auth Proxy sidecar being
  present (`DB_IP` resolves to its `127.0.0.1` loopback). If
  `enable_cloudsql_volume` is set `false` on GKE, the pod has no path to
  Cloud SQL at all. Confirm the sidecar container exists:
  ```bash
  kubectl get pod -n "$NS" <pod> -o jsonpath='{.spec.containers[*].name}'
  ```
- **Wrong port assumption.** If you're comparing this deployment against
  documentation or another Kimai install that assumes port 80, note this
  module's `:apache` image variant serves on **8001** — confirmed via local
  testing and live deployment.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Rollout stuck on update:** check for a stuck DB connection or Auth Proxy
  sidecar handoff from the old pod if the new pod doesn't reach Ready
  promptly.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and
  the node service account can pull it.
- **Forgot the admin password:** it's not lost — `ADMINPASS` is a
  persistent Secret Manager secret, re-injected and re-applied to the
  `admin` account on every pod boot (idempotent):
  ```bash
  gcloud secrets versions access latest --secret="$ADMINPASS_SECRET" --project="$PROJECT"
  ```

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash**
icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes workload and namespace, Cloud SQL database, Secret Manager
secrets, GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), secrets, storage bucket, and runs the `db-init` job |
| 2 — Access & verify | Manual | Connect to the cluster; health check returns 200 at `/en/login`; log in as `admin` with the generated `ADMINPASS` secret; create a test timesheet entry |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access, API/user setup |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, sidecar, port, and database issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
