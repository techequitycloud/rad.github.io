---
title: "Appsmith on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Appsmith on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Appsmith on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Appsmith_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Appsmith is an open-source low-code platform for building internal tools, admin
panels, and dashboards — a self-hosted alternative to Retool. The Community
Edition ships as a single "fat" container that bundles an embedded MongoDB,
Redis, the Java backend, and the React client behind nginx, persisting all
application state on one PersistentVolumeClaim. This lab takes you through the
full operational lifecycle of the **Appsmith on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Appsmith product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Appsmith_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect the StatefulSet pod and its persisted
  data, update the version, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this
  module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Appsmith
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Appsmith_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a
   **StatefulSet** (auto-selected because `stateful_pvc_enabled = true`),
   provisions a 20Gi PersistentVolumeClaim mounted at `/appsmith-stacks`,
   generates the Secret Manager secrets (`APPSMITH_ENCRYPTION_PASSWORD`,
   `APPSMITH_ENCRYPTION_SALT`, `APPSMITH_SUPERVISOR_PASSWORD`), and mirrors the
   prebuilt `appsmith/appsmith-ce` image from Docker Hub into Artifact
   Registry. There is **no Cloud SQL instance and no database-init job** —
   Appsmith CE runs its own embedded MongoDB and Redis and self-initialises on
   first boot. Allow **10–20 minutes** for the first deploy; the fat container
   itself is slow to boot (embedded Mongo + Redis + Java backend all start
   inside one pod).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep appsmith | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address. Because
   Appsmith is a single-replica **StatefulSet**, expect exactly one pod (with a
   stable, ordinal-suffixed name):

   ```bash
   kubectl get statefulset,pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Appsmith exposes a health endpoint that
   responds once the embedded MongoDB, Redis, and Java backend have all come
   up — this can take several minutes on first boot, which is why the
   startup probe allows roughly a 10-minute window:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/v1/health"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On first visit Appsmith prompts
   you to create the instance admin account — fill in your name, email, and a
   password and sign up. No pre-seeded admin credential exists in Secret
   Manager: the three auto-generated secrets secure at-rest encryption
   (`APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT`) and the
   internal supervisor panel (`APPSMITH_SUPERVISOR_PASSWORD`), not application
   login. The first account you create becomes the workspace administrator.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count` and
   `max_instance_count` both default to `1` and must stay there — the
   embedded MongoDB is not clustered, and each additional StatefulSet pod
   would provision its own **empty** PVC and run a diverging, unsynchronised
   database with no shared state. `max_instance_count > 1` is not blocked at
   plan time, so raising it is a real footgun, not a supported scale-out path.

3. **Update the application version** by changing `application_version` in the
   RAD platform and applying it via **Update**. Because `container_image_source
   = "prebuilt"`, this simply pulls a different `appsmith/appsmith-ce` tag from
   Docker Hub (re-mirrored to Artifact Registry) — there is no custom build or
   Dockerfile involved, and a rolling update replaces the single pod.

4. **Manage secrets:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~appsmith"
   ```

   Never rotate `APPSMITH_ENCRYPTION_PASSWORD` or `APPSMITH_ENCRYPTION_SALT`
   independently of a full data reset — they encrypt datasource credentials
   and Git SSH keys at rest, and changing either makes previously-saved
   secrets permanently unreadable.

5. **Inspect the persisted data** on the PVC — the embedded MongoDB data
   files, Redis dump, uploaded/plugin assets, and Git-connected app config all
   live under `/appsmith-stacks`:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- du -sh /appsmith-stacks
   kubectl exec -n "$NS" "$POD" -- env | grep APPSMITH
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation (the fat container needs at least 2 vCPU / 2Gi),
   restart counts, and request metrics. The module can provision an **uptime
   check** (when enabled); review Monitoring → Uptime checks and Alerting →
   Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Appsmith releases.

- **Pod stuck in `Pending` / not Ready during startup:** this is expected for
  several minutes on a fresh boot — the fat container starts the embedded
  MongoDB, Redis, and Java backend sequentially. The startup probe allows
  roughly a 10-minute window (`initial_delay_seconds = 120`,
  `failure_threshold = 40`) before giving up; do not assume a crash until that
  window has elapsed.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from a crashed container, if any
  ```
- **CrashLoopBackOff after the startup window:** check for a corrupted or
  undersized PVC (`stateful_pvc_size`), or an `APPSMITH_ENCRYPTION_*` secret
  that no longer matches previously-persisted encrypted data.
- **PVC / storage issues:** confirm the PVC is `Bound`, not stuck
  `Pending` (commonly a regional SSD quota shortfall on the default
  `standard-rwo` StorageClass — override `stateful_pvc_storage_class` to
  `standard` (HDD) if so):
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
- **Accidental multi-replica scale-out:** if `max_instance_count` was raised
  above `1`, scale back down immediately and inspect which pod's PVC holds the
  data you want to keep — the other pod's PVC is a diverging, empty-started
  MongoDB and should be treated as disposable, not merged.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the mirrored image exists in Artifact
  Registry (`enable_image_mirroring = true` avoids Docker Hub rate limits) and
  the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to change
`APPSMITH_ENCRYPTION_PASSWORD` / `APPSMITH_ENCRYPTION_SALT` after first boot,
and never to raise `max_instance_count` above `1`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload,
namespace, and PersistentVolumeClaim (and with it all embedded MongoDB/Redis
data), Secret Manager secrets, and the mirrored Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, Artifact Registry
repository, shared service accounts) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet workload, 20Gi PVC, encryption/supervisor secrets, and mirrors the prebuilt image — no Cloud SQL, no DB-init job |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect the single StatefulSet pod, update version, manage secrets, inspect persisted PVC data — do not scale beyond 1 replica |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose slow-boot vs. real CrashLoop, PVC/quota, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
