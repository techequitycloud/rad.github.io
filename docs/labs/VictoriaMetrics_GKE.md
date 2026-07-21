---
title: "VictoriaMetrics on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy VictoriaMetrics on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# VictoriaMetrics on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/VictoriaMetrics_GKE)**

## Overview

**Estimated time:** 20–30 minutes

VictoriaMetrics is a fast, cost-efficient, Prometheus-compatible time-series
database — the standard self-hosted metrics-storage backend for pairing with
this catalog's Grafana module. This lab takes you through the full
operational lifecycle of the **VictoriaMetrics on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

This is one of the simplest labs in this catalog's application-module set —
VictoriaMetrics has no external database dependency (it is itself a
database), no initialization jobs, and no secrets to manage, so most of the
usual first-deploy troubleshooting steps for those don't apply here.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on VictoriaMetrics product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/VictoriaMetrics_GKE)
— this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and reach the internal-only (`ClusterIP`) service via `kubectl port-forward`.
- Verify ingestion and query the PromQL-compatible API.
- Perform day-2 operations — inspect, update the version, and connect a scraper or Grafana datasource.
- Observe VictoriaMetrics's own resource usage and ingestion behaviour with Cloud Logging and Cloud Monitoring.
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
- **kubectl access to the cluster.** Because VictoriaMetrics defaults to
  `service_type = "ClusterIP"` (internal-only, by design — it is meant to be
  scraped and queried from inside the cluster, not exposed publicly), this
  lab reaches it via `kubectl port-forward` rather than a public URL. There is
  no way to verify this module purely from a browser with the default
  configuration.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **VictoriaMetrics (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/VictoriaMetrics_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a
   StatefulSet, provisions a block PersistentVolumeClaim (`standard`/HDD
   storage class, `20Gi` by default) mounted at `/victoria-metrics-data`, and
   builds the custom container image. There is no SQL database, no Redis, no
   Secret Manager secret, and no initialization job to wait on — VictoriaMetrics
   is a self-contained binary with no schema or migration concept. This makes
   it one of the fastest modules in this catalog to reach a healthy state;
   first deploys typically take **8–15 minutes** (image build and Autopilot
   node provisioning dominate — there's no database bootstrap phase adding to it).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep victoriametrics | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

VictoriaMetrics defaults to `service_type = "ClusterIP"` — there is no public
endpoint by design. Reach it via `kubectl port-forward` or `kubectl exec`.

1. Confirm the pod is running and the StatefulSet PVC is bound:

   ```bash
   kubectl get pods,svc,pvc -n "$NS"
   kubectl describe pvc -n "$NS"
   ```

2. Check health directly inside the pod (no networking required — the
   quickest sanity check):

   ```bash
   POD=$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- wget -qO- http://127.0.0.1:8428/health
   # expect: OK
   ```

3. Port-forward the service to reach it from your shell, and confirm the
   query API responds:

   ```bash
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward "svc/$SVC" 8428:8428 -n "$NS" &
   sleep 3
   curl -s http://localhost:8428/health              # expect: OK
   curl -s 'http://localhost:8428/api/v1/query?query=up' | head -c 300
   ```

4. Push a sample metric via the Prometheus `remote_write`-compatible import
   endpoint and query it back, to confirm the ingest → storage → query path
   end to end:

   ```bash
   # Simple ingestion via the InfluxDB line-protocol-style import endpoint
   curl -s -X POST 'http://localhost:8428/api/v1/import/prometheus' \
     --data-binary 'lab_smoke_test{source="lab-guide"} 1'

   sleep 2
   curl -s 'http://localhost:8428/api/v1/query?query=lab_smoke_test' | head -c 400
   ```

   If the service type is `LoadBalancer` (a deliberate override — see the
   Configuration Guide's pitfalls table before doing this), use the external
   IP directly instead of port-forwarding:

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:8428/health"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — pod and StatefulSet state:

   ```bash
   kubectl get statefulset,pods -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scaling — there isn't any.** Unlike most stateful modules in this
   catalog, do **not** change `min_instance_count`/`max_instance_count` above
   `1`. VictoriaMetrics single-node mode has no built-in clustering or
   replication — a second pod writing the same PVC corrupts the data files.
   If you need more capacity, resize the pod's `cpu_limit`/`memory_limit` and
   `stateful_pvc_size` (vertical scaling) via the RAD platform's **Update**
   flow instead.

3. **Update the application version** by changing the `application_version`
   input in the RAD UI and applying it via **Update**; a new image builds and
   the StatefulSet rolls the single pod. `latest` maps to a version pinned in
   the Dockerfile build arg (currently `v1.148.0`), not a floating tag, so
   version changes are always explicit and reproducible.

4. **Connect a real scraper or Grafana.** From inside the cluster (e.g. from
   a Grafana pod or a Prometheus-format scraper such as `vmagent`), reach
   VictoriaMetrics at its in-cluster DNS name reported as `service_url` in
   the deployment outputs:

   ```bash
   kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}{"\n"}'
   # In Grafana: add a Prometheus-type datasource pointed at
   # http://<service-name>.<namespace>.svc.cluster.local:8428
   ```

   For a Prometheus `remote_write` sender or Grafana Alloy, point the
   `remote_write` URL at `http://<service>.<namespace>.svc.cluster.local:8428/api/v1/write`.

5. **Inspect the PVC and on-disk data files:**

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- ls -la /victoria-metrics-data
   ```

---

## Task 4 — Observe [Manual]

VictoriaMetrics *is* the observability backend, so "observing" it means two
different things: the platform's own view of the pod (standard Cloud
Logging/Monitoring, same as any workload), and VictoriaMetrics's own
self-reported ingestion/resource metrics.

1. **Platform-level logs and metrics** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

   Open the GKE / Kubernetes dashboards in Cloud Monitoring and review pod
   CPU, memory, and disk usage against the `cpu_limit`/`memory_limit` and
   `stateful_pvc_size` you configured.

2. **VictoriaMetrics's own metrics about itself.** VictoriaMetrics exposes a
   standard Prometheus-format `/metrics` endpoint describing its own
   ingestion rate, active time series count, disk usage, and query latency —
   useful for right-sizing `stateful_pvc_size` and `memory_limit` before
   connecting a real workload:

   ```bash
   curl -s http://localhost:8428/metrics | grep -E '^vm_(rows|data_size_bytes|free_disk_space_bytes)' | head -20
   ```

   In a real deployment, scrape this endpoint with Grafana/vmagent/Prometheus
   the same way you would scrape any other target — VictoriaMetrics can
   monitor itself using its own ingestion path.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with VictoriaMetrics
releases. See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC not bound / storage errors:** confirm the PVC provisioned
  successfully and the fsGroup is set correctly for write access:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
  Remember there is no GCS FUSE fallback for this module — if the PVC can't
  bind (e.g. `SSD_TOTAL_GB`/`DISKS_TOTAL_GB` quota exhausted), the pod cannot
  start at all.
- **`/health` unreachable via port-forward but the pod is Running:** confirm
  you're forwarding the right service/port (`8428`) and that no other
  `kubectl port-forward` process is holding the local port already; fall back
  to `kubectl exec ... -- wget -qO- http://127.0.0.1:8428/health` to rule out
  a networking-layer issue versus an application-layer one.
- **Ingested data not showing up in queries:** confirm the timestamp of your
  test write is within the retention window (12 months by default — unlikely
  to be the cause for a fresh write, but worth ruling out if backfilling old
  data) and that you queried the correct metric name/labels.
- **Trying to scale horizontally and hitting corruption or write errors:**
  this module deploys VictoriaMetrics single-node mode by design;
  `max_instance_count` must stay `1`. There is no supported way to add
  replicas against the same PVC.
- **Image pull errors:** confirm the image exists in Artifact Registry and
  the node service account can pull it.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes
workload and namespace, the PersistentVolumeClaim and underlying Persistent
Disk, and Artifact Registry images. There is no GCS bucket, Cloud SQL
instance, or Secret Manager secret to clean up for this module — VictoriaMetrics
creates none of those.

Resources owned by **Services_GCP** (the VPC, GKE cluster, shared registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom image and deploys the GKE StatefulSet + PVC; no database, secret, or init-job phase to wait on |
| 2 — Access & verify | Manual | Reach the internal-only service via `kubectl port-forward` or `exec`; confirm `/health` and a real ingest→query round-trip |
| 3 — Operate | Manual | Inspect the StatefulSet, update the version, connect a real scraper/Grafana — no horizontal scaling |
| 4 — Observe | Manual | Platform logs/metrics for the pod, plus VictoriaMetrics's own self-reported ingestion/storage metrics |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, connectivity, and retention-window issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources — no external DB/secrets to clean up separately |
