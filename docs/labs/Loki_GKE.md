---
title: "Loki on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Loki on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Loki on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Loki_GKE)**

## Overview

**Estimated time:** 30–45 minutes

Grafana Loki is a horizontally-scalable log aggregation system ("Prometheus for
logs") that indexes only a small set of labels per log stream rather than full log
text, keeping storage costs low. This lab takes you through the full operational
lifecycle of the **Loki on GKE Autopilot** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

Loki has no database and no built-in web UI, so this lab is shorter and simpler than
most in this catalog — there is no first-run admin account to create, no schema
migration to wait on. The lab focuses on operating the **GKE module and the Google
Cloud platform**, not on Loki's own query language or Grafana integration. For the
complete list of provisioned services and every configuration input (organised by
group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Loki_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and issue a first LogQL
  query.
- Perform day-2 operations — inspect, understand the scaling constraint, update, and
  inspect GCS storage usage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- Optional but useful: **`logcli`** (Grafana's official Loki CLI) installed locally
  for Task 2.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Loki (GKE)** from the
   **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Loki_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster (as a
   `Deployment`, not a `StatefulSet` — Loki's durable state is GCS, not local disk),
   provisions a dedicated Cloud Storage bucket (`storage`) that Loki uses as its
   chunk/index backend, builds the custom container image (a distroless-based
   wrapper over `grafana/loki` — see the Configuration Guide's Pitfalls section),
   and grants the GKE Workload Identity SA `roles/storage.objectAdmin` on the
   bucket. There is **no database and no init job**, so this is one of the faster
   first deploys in the catalog — expect roughly **10–15 minutes**, dominated by
   the container build and LoadBalancer IP provisioning.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep loki | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Loki exposes an unauthenticated readiness
   endpoint that returns HTTP 200 once the server is listening — typically within
   seconds of boot, since there is no migration step:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}:3100/ready"   # expect 200
   ```

3. **Loki has no web UI of its own.** It is normally used as a datasource behind
   **Grafana**, or queried directly with **`logcli`** or plain HTTP against its
   query API. Issue a first query (an empty result is expected if nothing has
   pushed logs yet — the important thing is that the API responds rather than
   erroring):

   ```bash
   # Direct HTTP:
   curl -s "http://${EXTERNAL_IP}:3100/loki/api/v1/labels" | jq .

   # Or with logcli:
   export LOKI_ADDR="http://${EXTERNAL_IP}:3100"
   logcli labels
   ```

4. Push a small test log line to confirm end-to-end ingestion (adjust the
   timestamp to the current Unix epoch in nanoseconds):

   ```bash
   NOW_NS=$(date +%s%N)
   curl -s -X POST "http://${EXTERNAL_IP}:3100/loki/api/v1/push" \
     -H "Content-Type: application/json" \
     -d '{"streams":[{"stream":{"job":"lab-test"},"values":[["'"$NOW_NS"'","hello from the lab"]]}]}'
   # Then query it back (may take a few seconds to become queryable):
   curl -s "http://${EXTERNAL_IP}:3100/loki/api/v1/query?query=%7Bjob%3D%22lab-test%22%7D" | jq .
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scaling caveat — do not scale beyond 1 replica.** Unlike most modules in this
   catalog, `max_instance_count` is **overridden to `1`** by the module regardless
   of what is set on the deployment — Loki's baked config uses an in-memory ring
   (`replication_factor: 1`) and a singleton compactor that cannot coordinate
   retention/deletion across concurrent replicas. If you need more throughput, raise
   `container_resources.cpu_limit`/`memory_limit` on the single replica rather than
   expecting horizontal scale.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds (re-templating the
   same config) and a rolling update replaces the pod.

4. **Inspect GCS storage usage** — the primary thing to monitor day-2, since Loki's
   entire durable state lives here:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage du -s gs://<storage-bucket>/
   gcloud storage ls gs://<storage-bucket>/index_*/     # TSDB index shards
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — Loki's own process logs (not the logs it ingests, which are
   application data inside Loki, not Cloud Logging entries):

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts. The module can provision an **uptime
   check** (when enabled); review Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The readiness probe
  targets `/ready` — a failure here almost always means the config-templating step
  in the entrypoint failed (check that `LOKI_GCS_BUCKET` resolved to a real bucket
  name) rather than a slow first-boot migration (there isn't one).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **GCS permission errors** (`403` / write failures): confirm the GKE Workload
  Identity SA has `roles/storage.objectAdmin` on the `storage` bucket:
  ```bash
  gcloud storage buckets get-iam-policy gs://<storage-bucket>
  ```
- **Image build failed:** review Cloud Build history for the failed build's log. If
  you (or a future maintainer) modified the Dockerfile and hit `exec: /bin/sh: no
  such file or directory` or `exec /bin/busybox: no such file or directory`, this is
  the distroless-base-image issue documented in the Configuration Guide's Pitfalls
  section — the official `grafana/loki` image has no shell and no dynamic linker.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the `LoadBalancer` Service has an assigned external
  IP (`kubectl get svc -n "$NS"`).
- **Query returns empty but push succeeded:** confirm the query's label matcher
  matches what you pushed, and allow a few seconds for the write path to flush.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the full distroless-image story and why `max_instance_count` is
pinned).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Kubernetes workload and
namespace, the GCS `storage` bucket (and all ingested log data in it), Secret
Manager entries (if any were added), and Artifact Registry images. Resources owned
by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload (as a `Deployment`), GCS `storage` bucket, and builds the distroless-based custom image (no database, no init job) |
| 2 — Access & verify | Manual | Connect to the cluster; `/ready` returns 200; a test log line pushed and queried back successfully |
| 3 — Operate | Manual | Inspect workload, understand the single-replica scaling constraint, update version, monitor GCS usage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod health, GCS IAM, image-build, scheduling, and query issues |
| 6 — Tear down | Automated | Delete (Trash) removes the workload, storage bucket (and its log data), and images |
