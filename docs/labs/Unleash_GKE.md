---
title: "Unleash on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Unleash on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Unleash on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Unleash_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Unleash is an open-source feature-flag and toggle-management platform for progressive
delivery, A/B testing, and gradual rollouts, driven by a REST API and admin UI. This
lab takes you through the full operational lifecycle of the **Unleash on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, create and
evaluate a feature flag, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Unleash product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Unleash_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Create a feature flag and evaluate it via the Unleash API with a token.
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

1. Click **Deploy** in the RAD platform top navigation, open **Unleash (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Unleash_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets (the bootstrap
   admin API token and the database password), builds the container image, and runs a
   one-shot database-initialisation job that creates the `unleash` database and user.
   First deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep unleash | head -1 | cut -d/ -f2)
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
   export SERVICE_URL="http://${EXTERNAL_IP}:4242"
   echo "URL: $SERVICE_URL"
   ```

   > Unleash listens on port **4242**; the LoadBalancer Service exposes it. Adjust the
   > port if you fronted the workload with a custom domain / Ingress.

2. Confirm the service is healthy. Unleash exposes a public health endpoint that
   returns 200 only when the server is fully initialised and PostgreSQL is reachable:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

3. Open `$SERVICE_URL` in a browser. Log in to the admin UI with the well-known
   first-run credentials **`admin` / `unleash4all`** and **change the password
   immediately** under **Admin → Users**.

---

## Task 3 — Worked example: create and evaluate a feature flag [Manual]

Unleash stores every flag in PostgreSQL and evaluates it through its API. This task
creates a flag and evaluates it with an API token — the same flow an application SDK
uses.

1. **Retrieve the bootstrap admin API token** the module seeded into Secret Manager.
   It has all-access (`*:*`) admin rights:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~admin-token" --format="value(name)" --limit=1)
   ADMIN_TOKEN=$(gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT")
   echo "Admin token: $ADMIN_TOKEN"
   ```

2. **Create a feature flag** in the `default` project via the Admin API (or do this in
   the UI under **Projects → default → New feature flag**):

   ```bash
   curl -s -X POST "$SERVICE_URL/api/admin/projects/default/features" \
     -H "Authorization: $ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"welcome-banner","type":"release"}'
   ```

3. **Enable the flag** in the `development` environment:

   ```bash
   curl -s -X POST \
     "$SERVICE_URL/api/admin/projects/default/features/welcome-banner/environments/development/on" \
     -H "Authorization: $ADMIN_TOKEN"
   ```

4. **Create a client API token** scoped to the `development` environment — this is the
   credential an SDK would use (never ship the admin token to clients):

   ```bash
   curl -s -X POST "$SERVICE_URL/api/admin/api-tokens" \
     -H "Authorization: $ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"tokenName":"lab-client","type":"client","environment":"development","projects":["default"]}'
   # copy the "secret" field from the response into CLIENT_TOKEN:
   export CLIENT_TOKEN="<secret-from-response>"
   ```

5. **Evaluate the flag via the API** using the client token — the Client API returns
   the flag definitions an SDK evaluates against its context:

   ```bash
   curl -s "$SERVICE_URL/api/client/features" -H "Authorization: $CLIENT_TOKEN" \
     | python3 -c "import sys,json; [print(f['name'], f['enabled']) for f in json.load(sys.stdin)['features']]"
   # expect: welcome-banner True
   ```

   You have now created a flag and evaluated it through the same API path your
   applications will use.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Unleash
   is stateless (`session_affinity = None`), so any pod can serve any request — scaling
   out needs no Redis or session stickiness.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a rolling update replaces the
   pods. Unleash applies any schema migrations on startup.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~unleash"
   kubectl get jobs -n "$NS"          # DB-init and any scheduled jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=unleash --project="$PROJECT"
   ```

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** against `/health` (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Unleash releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness probe
  targets `/health`; a connection failure to PostgreSQL will keep the pod from
  becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the init job completed.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including keeping probe paths on `/health` and never enabling IAP when SDK
clients must reach the API directly).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; log in as `admin` / `unleash4all` |
| 3 — Worked example | Manual | Create a feature flag and evaluate it via the Unleash API with a token |
| 4 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, and image-pull issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources |
