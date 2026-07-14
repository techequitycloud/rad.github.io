---
title: "Evolution API on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Evolution API on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Evolution API on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/EvolutionAPI_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Evolution API is an open-source Node.js WhatsApp Business API gateway (built on the
Baileys library) that provisions WhatsApp instances, sends and receives messages, and
exposes a REST API plus a manager UI for wiring WhatsApp into other systems. This lab
takes you through the full operational lifecycle of the **Evolution API on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Evolution API / WhatsApp product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/EvolutionAPI_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and complete first-run
  WhatsApp setup.
- Perform day-2 operations — inspect, update, and manage secrets, cache, and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Filestore NFS, Artifact Registry, and shared service accounts
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

1. Click **Deploy** in the RAD platform top navigation, open **Evolution API (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/EvolutionAPI_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a single
   replica (Deployment), provisions a Cloud SQL (PostgreSQL 15) database with its
   Secret Manager secrets (the auto-generated `AUTHENTICATION_API_KEY` admin key and
   the database password), a Cloud Storage data bucket, a Filestore NFS instance
   (which also hosts the default Redis endpoint), an external `LoadBalancer` Service,
   builds the container image, and runs a one-shot database initialisation job. First
   deploys take roughly **20–35 minutes** (Cloud SQL and NFS creation dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep evolutionapi | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Startup and liveness probes target the root `/` —
   an unauthenticated status endpoint that responds once the server is up (allow
   several minutes on first boot while Prisma migrations run):

   ```bash
   curl -s "http://${EXTERNAL_IP}/"   # expect a JSON status payload, not a connection error
   ```

3. Retrieve the auto-generated global admin key from Secret Manager:

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~api-key" --format="value(name)" --limit=1)
   API_KEY=$(gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT")
   echo "$API_KEY"
   ```

4. Open `http://${EXTERNAL_IP}/manager` in a browser (or call the REST API directly)
   using `$API_KEY` as the `apikey` header, and create your first WhatsApp instance:

   ```bash
   curl -s -X POST "http://${EXTERNAL_IP}/instance/create" \
     -H "apikey: $API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"lab-instance","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'
   ```

5. Fetch the connection QR code and scan it from WhatsApp on your phone (**Linked
   Devices → Link a Device**) to connect the number:

   ```bash
   curl -s "http://${EXTERNAL_IP}/instance/connect/lab-instance" -H "apikey: $API_KEY"
   ```

   Once the external IP is confirmed stable, set `SERVER_URL` (via
   `environment_variables`) to `http://${EXTERNAL_IP}` and apply via **Update**, so
   QR-code and webhook callback URLs use the reachable external address instead of
   the entrypoint's internal default.

   **Never rotate `AUTHENTICATION_API_KEY` after this point** — rotating it makes
   every already-provisioned WhatsApp instance unreachable and returns `401` to every
   client still holding the old key.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Do not scale beyond one replica.** WhatsApp (Baileys) socket sessions are held
   in the pod's memory and are not shared across replicas — `min_instance_count` and
   `max_instance_count` are pinned to `1` by design, and `ClientIP` session affinity
   keeps each client pinned to that one pod. Raising `max_instance_count` fragments
   live connections and duplicates webhook deliveries; leave it alone.

3. **Update the application version** by changing the version input (default
   `v2.1.1`) in the RAD platform and applying it via **Update**; a new image builds
   and a rolling update replaces the pod, re-running Prisma migrations on boot.

4. **Manage secrets, cache, and jobs:**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~evolutionapi"
   kubectl get jobs -n "$NAMESPACE"          # DB-init and any scheduled jobs
   # Confirm the Redis cache URI is injected into the running pod:
   kubectl exec -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -i CACHE_REDIS
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=evolution --database=evolution --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The entrypoint emits
   `[cloud-entrypoint]` markers that confirm the resolved DB/Redis/URL config on boot:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Evolution API releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness probe
  targets `/`; a connection failure to PostgreSQL will keep the pod from becoming
  Ready.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the init job completed. On
  GKE the cloud-sql-proxy sidecar is a TCP loopback (`127.0.0.1`), so the entrypoint
  connects with `sslmode=disable` — this is expected, not a misconfiguration.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Redis cache silently disabled:** if `enable_redis=true` but the cache URI env var
  is blank, check that either `enable_nfs=true` (so the NFS server IP is used) or an
  explicit `redis_host` is set.
- **401 on every WhatsApp API call:** the `apikey` header is missing/wrong, or
  `AUTHENTICATION_API_KEY` was rotated after instances were already provisioned — the
  fix is to re-provision the affected WhatsApp instances, not to rotate back.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section for
setting-specific gotchas (including the critical rule never to rotate
`AUTHENTICATION_API_KEY` or raise `max_instance_count` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, NFS, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload (single-replica Deployment), Cloud SQL (PostgreSQL 15), NFS/Redis, secrets, storage bucket, LoadBalancer Service, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; retrieve the admin API key; create and connect a WhatsApp instance via QR code |
| 3 — Operate | Manual | Inspect the workload, update version, manage secrets/cache/jobs, DB access — do not scale beyond one replica |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, Redis, auth-key, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
