---
title: "Healthchecks on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Healthchecks on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Healthchecks on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Healthchecks_GKE)**

## Overview

**Estimated time:** 45–60 minutes

Healthchecks is an open-source, self-hosted cron job and heartbeat monitoring
service: scheduled tasks "ping" it on success, and it alerts you when a ping is
late or missing. This lab takes you through the full operational lifecycle of
the **Healthchecks on GKE Autopilot** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Healthchecks product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Healthchecks_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, and log in with the seeded admin account.
- Perform day-2 operations — inspect, update, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL networking, Artifact Registry, and shared
  service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<namespace-from-outputs>"
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Healthchecks (GKE)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Healthchecks_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the GKE workload (a single-replica Deployment), a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (`SECRET_KEY`, `ADMIN_PASSWORD`, and the database password), a
   LoadBalancer Service with a reserved static IP, and runs two one-shot
   Kubernetes Jobs: `db-init` (creates the database and role) and
   `admin-bootstrap` (runs migrations and seeds the initial superuser
   account). First deploys take roughly **20–30 minutes** (Cloud SQL creation
   dominates).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   kubectl get pods,svc -n "$NAMESPACE" -l app~healthchecks 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "Service IP: $SERVICE_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is `1/1 Running` with 0 restarts, and the workload is
   serving the login page (Healthchecks has no dedicated health endpoint — the
   root page is the public, unauthenticated signal):

   ```bash
   kubectl get pods -n "$NAMESPACE"
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "http://$SERVICE_IP/"
   # expect 200 (or a redirect in the 300 range) and a non-zero body size
   ```

2. Retrieve the seeded admin credential and log in:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~healthchecks-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Open `http://$SERVICE_IP` in a browser, sign in with `admin_email` (default
   `admin@techequity.cloud`) and the password above. You should land on the
   empty checks dashboard.

3. Create a test check from the UI and confirm it appears in the dashboard —
   this proves the database write path is working end-to-end.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl describe deploy -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
   ```

2. **No scale-to-zero concern on GKE.** Unlike the Cloud Run variant, a GKE
   Deployment simply runs its replica count continuously, so the co-located
   `sendalerts`/`sendreports` alert loop is always live with no special
   configuration needed.

3. **Update the application version tag** by changing the version input in
   the RAD platform and applying it via **Update**; a new rollout uses the
   same official `healthchecks/healthchecks` image at the new tag.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~healthchecks"
   kubectl get jobs -n "$NAMESPACE"   # db-init + admin-bootstrap
   ```

5. **Configure real outbound email** (required for alerts to actually be
   delivered): set `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER` via
   `environment_variables` and `EMAIL_HOST_PASSWORD` via
   `secret_environment_variables`, then apply.

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=healthchecks_user --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — the same log stream carries both the web server AND the
   `sendalerts`/`sendreports` background workers (they run in the same
   container):

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project "$PROJECT" --limit 50
   ```

2. **Monitoring** — open the GKE Workloads dashboard and review CPU/memory
   utilisation and restart count. The module can provision an **uptime
   check** (disabled by default); if enabled, confirm it is green under
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Healthchecks releases.

- **Pod not Ready / CrashLoopBackOff:** inspect pod events and logs for
  startup errors, and confirm env vars and secrets resolved.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  kubectl logs -n "$NAMESPACE" <pod-name> --previous
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` Job completed
  successfully (`kubectl get jobs -n "$NAMESPACE"`).
- **Login page loads but data resets on restart:** confirm the `DB` env var
  actually resolved to `"postgres"` on the running pod, not the image's
  SQLite fallback:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep '^DB='
  ```
- **Can't log in with the seeded credential:** confirm the `admin-bootstrap`
  Job actually completed (it depends on `db-init` finishing first — GKE's
  init-job ordering only gates Terraform's wait, not Kubernetes scheduling, so
  a race is possible on a very first deploy):
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<admin-bootstrap-job-name>
  ```
- **Alerts never arrive:** very likely a missing/placeholder SMTP
  configuration, not a platform bug — check the pod logs for SMTP connection
  errors from `sendalerts`.
- **Image build failed:** this module deploys the official prebuilt image
  with `container_image_source = "prebuilt"` — there should be no Kaniko
  build step at all. If you see a Cloud Build failure, check whether
  `container_image_source` was accidentally overridden to `"custom"`.
- **403 / permission errors:** verify the Workload Identity binding and the
  runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it, use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources. This
removes everything the module created — the Kubernetes workload, Cloud SQL
database, Secret Manager secrets, and the reserved static IP. Resources owned
by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL 15), secrets, LoadBalancer, and runs `db-init` + `admin-bootstrap` |
| 2 — Access & verify | Manual | Pod Ready; login page loads; sign in with the seeded admin credential; create a test check |
| 3 — Operate | Manual | Inspect workload, update version, manage secrets, configure SMTP, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review GKE/Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database engine, admin-bootstrap, and SMTP issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
