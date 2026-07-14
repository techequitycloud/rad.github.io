---
title: "Gotify on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Gotify on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Gotify on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gotify_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Gotify is an open-source, self-hosted server for real-time push notifications:
applications send messages over a simple REST API and clients receive them instantly
over WebSocket. This lab takes you through the full operational lifecycle of the
**Gotify on GKE Autopilot** module on Google Cloud: deploy it, access and verify it,
send and receive a live notification, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Gotify product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gotify_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload and retrieve the generated admin password.
- Send a message via the REST API and receive it over the WebSocket stream.
- Perform day-2 operations — inspect pods, update, and manage secrets and backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** authenticated: `gcloud auth login`,
  `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- A WebSocket client for the worked example — `websocat` (recommended) or `curl` 8.x.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Gotify (GKE)**, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Gotify_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits
   are enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform provisions the Kubernetes Deployment and LoadBalancer Service, a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets (the admin
   password and the database password), builds the custom container image (wrapping
   `ghcr.io/gotify/server`), and runs a one-shot database-initialisation Job. First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, get cluster credentials and discover the resources with
   name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep -i gotify | head -1 | cut -d/ -f2)
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   SERVICE_URL="http://$EXTERNAL_IP"
   echo "Namespace: $NAMESPACE"
   echo "URL:       $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is healthy and connected to its database:

   ```bash
   curl -s "$SERVICE_URL/health"    # expect {"health":"green","database":"green"}
   ```

2. Retrieve the generated admin password from Secret Manager:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~gotify-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and log in as **`admin`** with that password.
   Change the password immediately under **Users** — the bootstrap password is applied
   only on the first database initialisation.

---

## Task 3 — Send and receive a notification [Manual]

The core Gotify workflow: an *application token* sends messages; a *client token*
subscribes to them.

1. **Create an application** (UI: **Apps → Create Application**), or via the REST API
   as the admin user. Capture the returned app token:

   ```bash
   ADMIN_PASS='<paste-the-admin-password>'
   APP_TOKEN=$(curl -s -u "admin:$ADMIN_PASS" \
     -H "Content-Type: application/json" \
     -d '{"name":"lab-app","description":"lab notifications"}' \
     "$SERVICE_URL/application" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   echo "App token: $APP_TOKEN"
   ```

2. **Create a client** to receive messages, and capture its token:

   ```bash
   CLIENT_TOKEN=$(curl -s -u "admin:$ADMIN_PASS" \
     -H "Content-Type: application/json" \
     -d '{"name":"lab-client"}' \
     "$SERVICE_URL/client" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
   echo "Client token: $CLIENT_TOKEN"
   ```

3. **Subscribe to the stream** in one terminal (leave it running):

   ```bash
   websocat "ws://$EXTERNAL_IP/stream?token=$CLIENT_TOKEN"
   # or: curl --include -N "$SERVICE_URL/stream?token=$CLIENT_TOKEN"
   ```

4. **Send a message** from another terminal using the app token; it appears in the
   stream terminal within a second:

   ```bash
   curl -s "$SERVICE_URL/message?token=$APP_TOKEN" \
     -F "title=Deploy complete" -F "message=Gotify is live on GKE" -F "priority=5"
   ```

   Because the module runs a single replica, the send and the stream always land on
   the same pod — which is exactly why `max_instance_count` stays at 1.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,pods,svc -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   ```

2. **Do not scale beyond one replica.** Gotify's message bus is in-process, so a
   client only receives messages delivered to the pod it is connected to. The module
   fixes `min = max = 1`; scaling out without an external fan-out layer drops messages
   for some subscribers.

3. **Update the application version** via **Update** in the RAD platform; a new image
   builds and the Deployment rolls out. Gotify runs its GORM auto-migration on startup.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gotify"
   kubectl get jobs -n "$NAMESPACE"
   ```

5. **Open a database session:**

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=gotify --project="$PROJECT"
   ```

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Monitoring** — review the GKE workload dashboard for CPU/memory, restart counts,
   and pod health. The module provisions an **uptime check** against `/health`; confirm
   it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit.

- **Pod not Ready / CrashLoopBackOff:** describe the pod and read its logs. The startup
  probe targets `/health` and allows ~5 minutes on first boot for GORM auto-migration.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app
  kubectl logs -n "$NAMESPACE" -l app --tail=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  cloud-sql-proxy sidecar is running (`127.0.0.1:5432`), and the init Job completed.
- **Initialisation Job failed:** inspect it:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<init-job-name>
  ```
- **No external IP:** LoadBalancer provisioning can lag; re-check
  `kubectl get svc -n "$NAMESPACE"`. `kubernetes_ready = false` on a fresh inline
  cluster means re-run apply.
- **`403 invalid API token`:** app tokens send (`/message`), client tokens subscribe
  (`/stream`); they are not interchangeable.
- **Image build failed:** review Cloud Build history.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `max_instance_count` must stay at 1 and why quota memory values
need binary suffixes).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it, use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources. This removes everything the module created
— the Kubernetes workload and Service, Cloud SQL database, Secret Manager secrets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; log in as `admin` with the generated password |
| 3 — Send & receive | Manual | Create app + client tokens, POST a message, receive it over WebSocket |
| 4 — Operate | Manual | Inspect pods, update version, manage secrets/backups, DB access |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose pod, database, init-job, LoadBalancer, and token issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources |
