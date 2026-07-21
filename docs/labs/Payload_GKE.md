---
title: "Payload CMS on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Payload CMS on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Payload CMS on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Payload_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Payload CMS is a TypeScript-native, code-first headless CMS and application framework built
directly on Next.js. Unlike most modules in this catalogue, there is **no official Payload Docker
image** — this module builds a real, locally-verified starter application from source (a blank
`create-payload-app` template using the PostgreSQL adapter). This lab takes you through the full
operational lifecycle of the **Payload on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on Payload's
own content-modeling features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Payload_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, including creating the first Payload admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot cluster, Cloud
  SQL, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Payload (GKE)**, set `project_id`, and review the inputs. Configure
   only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Payload_GKE) documents every
   input by group, with defaults. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the GKE workload (Deployment + Service), a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`PAYLOAD_SECRET` and the database password),
   **builds the Payload application from source via Cloud Build** (there is no prebuilt image to
   pull), and runs two sequential jobs: `db-init` (creates the database role and database)
   followed by `payload-migrate` (applies the Payload schema — this needs the full application
   source and dependency tree, not just the trimmed runtime that serves traffic). First deploys
   take roughly **20–35 minutes** (Cloud SQL creation and the from-source Cloud Build dominate).

3. When it completes, discover the resources with name-agnostic filters (so the commands keep
   working regardless of the deployment suffix):

   ```bash
   kubectl get deploy,svc,jobs -n "$NAMESPACE" | grep -i payload
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -i payload | head -1 | cut -d/ -f2)
   echo "Service: $SERVICE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy:

   ```bash
   kubectl get pods -n "$NAMESPACE" | grep -i payload   # expect N/N Running, 0 restarts
   ```

2. Determine how the Service is exposed and reach `/admin`. This deployment may be running with
   `service_type = "ClusterIP"` (typically because the project's static IP quota was exhausted at
   deploy time) rather than the module's default `LoadBalancer`:

   ```bash
   # If LoadBalancer with an external IP:
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   curl -s -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/admin"   # expect 200

   # If ClusterIP (no external IP) — port-forward instead:
   kubectl port-forward -n "$NAMESPACE" svc/"$SERVICE" 18080:3000
   curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/admin"   # expect 200
   ```

3. Open `/admin` in a browser (via the external IP, or `http://localhost:18080/admin` if
   port-forwarding). Payload has **no CLI command to create the first admin user
   non-interactively** — with an empty `users` collection, Payload automatically shows a signup
   form. Fill in your email and a password and submit to create the first administrator; you are
   then logged into the admin dashboard. This is a required, one-time manual step — there is no
   pre-seeded admin credential in Secret Manager.

4. If the Service is `ClusterIP` and you want public access, flip `service_type` to
   `LoadBalancer` (or reserve a static IP) in the platform once IP quota is available, and
   re-apply.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its pods:**

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   kubectl describe deploy "$SERVICE" -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment
   details page — the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version tag** by changing the version input in the RAD platform and
   applying it via **Update**; a new Cloud Build run rebuilds the bundled Payload starter app from
   source and rolls out a new pod generation (there is no upstream image tag to bump — this always
   rebuilds).

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~payload"
   kubectl get jobs -n "$NAMESPACE"   # db-init + payload-migrate + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=payload --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project "$PROJECT" --limit 50
   ```

2. **Monitoring** — open the GKE Workloads dashboard for the deployment and review pod restarts,
   CPU / memory utilisation, and (for Cloud SQL) query and connection metrics. The module can
   provision an **uptime check** (when `uptime_check_config.enabled = true` — it defaults to
   `false`, and requires a reachable external IP); if enabled, confirm it is green under
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level
diagnostics and do not change with Payload releases.

- **Pod unhealthy / won't become Ready:** inspect the pod and its logs for startup errors. The
  startup probe targets `/admin` and allows roughly 12 minutes on first boot for the
  `payload-migrate` job to complete.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=payload
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Database queries fail / "relation does not exist":** the schema was never applied. Confirm
  `payload-migrate` completed successfully (it depends on `db-init` finishing first):
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/payload-migrate
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB password
  secret exists, and the Cloud SQL Auth Proxy sidecar container is running in the pod
  (`kubectl get pod <pod> -n "$NAMESPACE" -o jsonpath='{.spec.containers[*].name}'`).
- **Image build failed:** review Cloud Build history for the failed build's log — remember this
  module always builds from source, so a broken Dockerfile or dependency change surfaces here,
  not as an image-pull error.
  ```bash
  gcloud builds list --project="$PROJECT" --limit=10
  ```
- **No external IP / can't reach the service:** confirm `service_type`. If it is `ClusterIP`
  (often a deliberate fallback when the project's static IP quota was exhausted), use `kubectl
  port-forward` as shown in Task 2 rather than assuming the deployment is broken.
- **First admin account missing / can't log in:** the first admin is created manually via the
  `/admin` signup form — there is no pre-seeded credential in Secret Manager to fall back to.
- **403 / permission errors:** verify the Workload Identity service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas
(including why `enable_gcs_storage` and the Redis variables have no effect on this module).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**).
Delete runs `terraform destroy` and is irreversible (the deployment record is retained for
history). If a deployment is stuck and the RAD platform can no longer manage it (for example
after manual changes that conflict with the Terraform state), use **Purge** instead — it removes
the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget
the project). This removes everything the module created — the GKE workload, Service, Cloud SQL
database, Secret Manager secrets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the Payload app from source via Cloud Build and provisions GKE workload, Cloud SQL (PostgreSQL 15), secrets, and runs `db-init` → `payload-migrate` |
| 2 — Access & verify | Manual | Pod is Ready; reach `/admin` (LoadBalancer IP or `kubectl port-forward`) and create the first admin account |
| 3 — Operate | Manual | Inspect pods, scale, update version (rebuilds from source), manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review GKE Workloads dashboard and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, migration-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
