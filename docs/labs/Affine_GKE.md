---
title: "AFFiNE on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy AFFiNE on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# AFFiNE on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Affine_GKE)**

## Overview

**Estimated time:** 45–90 minutes

AFFiNE is an open-source, privacy-first knowledge base that unifies docs, whiteboards, and databases in one workspace — a self-hostable alternative to Notion and Miro. This lab takes you through the full operational lifecycle of the **AFFiNE on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on AFFiNE product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Affine_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

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
  cluster, Cloud SQL, the shared NFS/Redis VM, Artifact Registry, and shared service
  accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **AFFiNE (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Affine_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager password secret, a
   Filestore NFS mount for blob persistence (the same shared NFS VM also serves as
   the default Redis endpoint AFFiNE requires), a dedicated `storage` GCS bucket,
   builds the custom container image (a thin wrapper over
   `ghcr.io/toeverything/affine`), and runs two one-shot init Jobs: `db-init`
   (database + user) and `affine-migrate` (AFFiNE's own `self-host-predeploy`
   schema migration and signing-key generation). First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep affine | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. AFFiNE's startup, liveness, and readiness probes
   all target a plain HTTP `GET /`, which returns 200 once the server is ready — no
   authentication required (the startup probe allows up to ~510 seconds, but a
   healthy pod typically becomes Ready well before that since schema migration
   already ran in the `affine-migrate` job, not at boot):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"
   ```

3. Open `http://${EXTERNAL_IP}` in a browser (or `http://<EXTERNAL_IP>.nip.io` if
   you prefer a hostname) and **create the first account** — on a fresh AFFiNE
   self-host instance the first registered user becomes the server administrator
   (the admin panel is at `/admin`). Do this immediately after deploying: until an
   admin account exists, anyone who reaches the URL can register it. AFFiNE has no
   pre-seeded admin credential in Secret Manager — the only secret stored there is
   the database password, retrievable if needed:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~affine" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and persistent volumes:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). AFFiNE's real-time collaboration and job queue run
   through Redis, so multiple replicas depend on `enable_redis = true` (the
   default) and the shared NFS VM. Session affinity (`ClientIP`) is set by default
   to keep WebSocket-based collaboration sessions stable on the same pod.

3. **Update the application version** by changing the `application_version` input
   (e.g. `stable` → a pinned release tag) in the RAD platform and applying it via
   **Update**; a new image builds and a rolling update replaces the pods. The
   `affine-migrate` job re-runs idempotently on the new version.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~affine"
   kubectl get jobs -n "$NS"          # db-init and affine-migrate
   gcloud storage buckets list --project="$PROJECT" --filter="name~affine"
   kubectl get pvc -n "$NS"           # NFS-backed blob storage claims
   ```

5. **Open a database session** for inspection or maintenance (PostgreSQL 15,
   reached from the workload through the Cloud SQL Auth Proxy sidecar; from your
   own shell, `gcloud sql connect` opens its own tunnel):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=affine --project="$PROJECT"
   ```

6. **Check Redis connectivity** — AFFiNE requires Redis for Yjs real-time
   document sync and its background job queue; by default it resolves to the
   shared NFS/Redis VM's IP:

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -i REDIS
   gcloud compute instances list --project="$PROJECT" --filter="name~nfs"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. Startup log lines show which
   database host and Redis endpoint the cloud entrypoint resolved:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The `affine-migrate`
   init job alone requests 2Gi, so watch for OOM events on the server container
   too, especially under real-time collaboration load. The module can provision an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with AFFiNE releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness
  probe targets `/`; a connection failure to PostgreSQL (via the Cloud SQL Auth
  Proxy sidecar on `127.0.0.1:5432`) or to Redis will keep the pod from becoming
  Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance
  is `RUNNABLE`, the DB password secret materialised into the namespace via the
  Secret Store CSI driver, and the `db-init` job completed.
- **Schema / signing-key not present:** the `affine-migrate` job (not the server
  container) creates the schema and generates AFFiNE's signing key in PostgreSQL.
  If it failed or is still retrying (`max_retries = 3`), the server will never
  reach a healthy state:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<affine-migrate-job-name>
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Real-time collaboration not syncing:** Redis is mandatory, not optional.
  Verify the shared NFS/Redis VM is `RUNNING` and that the pod's environment shows
  a non-empty `REDIS_SERVER_HOST`. Disabling `enable_nfs` without supplying an
  external `redis_host` silently removes Redis connectivity as well as blob
  persistence.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it. `container_image_source` must be `custom` —
  the upstream image lacks the entrypoint that assembles `DATABASE_URL` and the
  `REDIS_SERVER_*` variables.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule that `application_database_name` and
`application_database_user` are immutable after first deploy, and that disabling
NFS without an external Redis host breaks collaboration silently).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, the shared NFS/Redis VM, registry) are managed separately
and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), NFS blob storage, GCS bucket, secrets, and runs db-init + affine-migrate |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; first registered account becomes the server admin |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage/jobs, DB and Redis checks |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, Redis, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
