---
title: "GlitchTip on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy GlitchTip on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# GlitchTip on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/GlitchTip_GKE)**

## Overview

**Estimated time:** 45–90 minutes

GlitchTip is an open-source, Sentry-compatible error-tracking and performance-monitoring
platform. Your applications send exceptions and traces to its ingest endpoint, and
GlitchTip stores, groups, and alerts on them. This lab takes you through the full
operational lifecycle of the **GlitchTip on GKE Autopilot** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
GlitchTip product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/GlitchTip_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload and sign in as the seeded administrator.
- Perform day-2 operations — inspect pods, scale, update, and manage secrets and backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot cluster,
  Cloud SQL, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **kubectl** installed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **GlitchTip (GKE)**, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/GlitchTip_GKE) documents
   every input by group, with defaults. Review the estimated cost (if credits are enabled)
   and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the GKE Autopilot workload (an external LoadBalancer Service
   with a reserved static IP), a Cloud SQL (PostgreSQL 15) database with its Secret Manager
   secrets (`SECRET_KEY`, the initial superuser password, and the database password), a
   Cloud Storage data bucket and NFS attachment storage, builds the thin custom container
   image (`FROM glitchtip/glitchtip:6.2.0`), and runs two one-shot jobs — `db-init`
   (database/user) then `glitchtip-migrate` (Django migrations + superuser creation).
   First deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, connect to the cluster and discover the resources:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region "$REGION" --project "$PROJECT"
   NAMESPACE=$(kubectl get ns -o name | grep glitchtip | head -1 | cut -d/ -f2)
   echo "Namespace: $NAMESPACE"
   kubectl get pods,svc,hpa,pdb -n "$NAMESPACE"
   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $SERVICE_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is healthy. GlitchTip exposes an unauthenticated health endpoint
   that returns 200 once the server is up and PostgreSQL is reachable:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://$SERVICE_IP/_health/"   # expect 200
   ```

2. Retrieve the seeded administrator password (the `glitchtip-migrate` job created
   `admin@techequity.cloud` from this secret):

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~superuser-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

3. Open the service URL (or custom domain, if configured) in a browser and log in as
   `admin@techequity.cloud`. Create your first organization and project, and copy the
   project's DSN to point an application's Sentry SDK at GlitchTip.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect pods, the HPA, and the PodDisruptionBudget:**

   ```bash
   kubectl get pods,hpa,pdb -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/"$NAMESPACE" --tail=100 2>/dev/null || \
     kubectl logs -n "$NAMESPACE" -l app --tail=100
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** — the module
   owns the workload spec, so scaling is a configuration change, not a manual `kubectl`
   edit (a manual edit would be reverted on the next apply). Keep `min_instance_count ≥ 1`:
   GKE does not support scale-to-zero, and the in-process Celery worker/beat must keep
   running.

3. **Update the application version** by changing the version input and applying it via
   **Update**; a new image builds, migrations run on start, and the Deployment rolls out.
   Because NFS is enabled, the rollout uses the `Recreate` strategy (one pod at a time on
   the shared volume).

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~glitchtip"
   kubectl get jobs,cronjobs -n "$NAMESPACE"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=glitchtip --database=glitchtip --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project "$PROJECT" --limit 50
   ```

2. **Monitoring** — open the GKE workload dashboard and review pod count, CPU / memory
   utilisation vs requests, and restart counts. Review any provisioned uptime check under
   Monitoring → Uptime checks, and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with GlitchTip releases.

- **Pods not Ready / CrashLoopBackOff:** describe the pod and read its logs. The startup
  probe targets `/_health/` and allows several minutes on first boot while migrations run.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>
  kubectl logs -n "$NAMESPACE" <pod> --previous
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and the
  Cloud SQL Auth Proxy sidecar is running. On GKE the entrypoint sees `DB_HOST = 127.0.0.1`
  (the proxy loopback) and connects over TCP without SSL.
- **Migration / superuser job failed:** inspect the Job:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<glitchtip-migrate-job>
  ```
- **Pods stuck mounting NFS:** confirm the `nfsserver` network tag is present (default) and
  the shared NFS server VM is `RUNNING`.
- **Rollout wedged on update:** with NFS enabled the strategy is `Recreate`; the old pod
  must terminate before the new one starts. Check `kubectl rollout status`.
- **Image build failed:** review Cloud Build history for the failed build's log.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including binary-unit ResourceQuota values and never renaming the DB name/user).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is
retained for history). If a deployment is stuck and the RAD platform can no longer manage
it, use **Purge** instead — it removes the deployment from RAD's records **without**
destroying the cloud resources. Delete removes everything the module created — the GKE
workload and Service, Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud
SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL 15), secrets, storage/NFS, and runs `db-init` + `glitchtip-migrate` |
| 2 — Access & verify | Manual | `/_health/` returns 200; log in as the seeded `admin@techequity.cloud` |
| 3 — Operate | Manual | Inspect pods/HPA/PDB, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, migrate-job, NFS, rollout, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
