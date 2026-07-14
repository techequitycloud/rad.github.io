---
title: "Tolgee on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Tolgee on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Tolgee on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Tolgee_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Tolgee is an open-source, developer-friendly localization (i18n) and translation
management platform built on Spring Boot. This lab takes you through the full
operational lifecycle of the **Tolgee on GKE Autopilot** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Tolgee product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Tolgee_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
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

1. Click **Deploy** in the RAD platform top navigation, open **Tolgee (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Tolgee_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets (the
   auto-generated initial admin password, the JWT signing secret, and the
   database password), and a Cloud Storage bucket for optional file storage.
   There is no separate migration job to wait on — the foundation's
   `create-db-and-user.sh` step creates the role/database, and Tolgee creates and
   migrates its entire schema with Liquibase on first boot. First deploys take
   roughly **15–30 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep tolgee | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Tolgee's Spring Boot Actuator health endpoint
   responds only once the application has fully started and PostgreSQL (via the
   Cloud SQL Auth Proxy sidecar) is reachable:

   ```bash
   curl -s "http://${EXTERNAL_IP}/actuator/health"   # expect {"status":"UP",...}
   ```

   Allow several minutes on first boot — Spring Boot plus first-run Liquibase
   migrations start more slowly than a typical Node app.

3. Retrieve the generated initial admin password and sign in:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~tolgee AND name~admin-password"
   gcloud secrets versions access latest \
     --secret="<admin-password-secret-name>" --project="$PROJECT"
   ```

   Open `http://${EXTERNAL_IP}` in a browser and sign in as the initial owner —
   `admin@techequity.cloud` by default (`TOLGEE_AUTHENTICATION_INITIAL_USERNAME`)
   — with the password retrieved above. Change the password immediately and
   configure any additional auth providers (Google/OAuth2/SSO) from the Tolgee UI
   before going live.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling is
   a configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). GKE requires `min_instance_count >= 1` (no
   scale-to-zero). Tolgee has no queue/coordination layer, so keep
   `max_instance_count = 1` unless you have validated concurrent-writer safety —
   multiple pods would run as concurrent writers against the same database and
   NFS attachment volume. Session affinity (`ClientIP`) is set by default to keep
   UI sessions on the same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**. Because `enable_nfs = true` by
   default, the Deployment uses the `Recreate` strategy rather than a rolling
   update — the running pod is terminated before the replacement starts, to
   avoid two pods racing the same NFS volume — so expect a short gap in
   availability during an update, not a zero-downtime rollout. Tolgee applies its
   Liquibase changesets on every startup, so pin `application_version` to a
   known-good release in production rather than tracking `latest`.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~tolgee"
   kubectl get jobs -n "$NS"          # the DB role/database setup job
   ```

   The JWT signing secret (`TOLGEE_AUTHENTICATION_JWT_SECRET`) is immutable in
   practice — only rotate it during a planned maintenance window, since rotating
   it immediately invalidates every active user session.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=tolgee --database=tolgee --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts. The module can provision an **uptime
   check** against `/actuator/health` (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Tolgee releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness
  probe targets `/actuator/health` with a wide first-boot window (Liquibase
  migrations run on a fresh database on first boot). A connection failure from
  the Spring Boot container to the Cloud SQL Auth Proxy sidecar will keep the
  pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  kubectl logs -n "$NS" <pod> -c cloud-sql-proxy   # sidecar logs, if present
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`
  and the Cloud SQL Auth Proxy sidecar container is running in the pod. Tolgee's
  JDBC driver cannot use a Unix socket, so it connects to the proxy on
  `127.0.0.1` over plain TCP — verify `enable_cloudsql_volume` is still `true`
  (the module default here); disabling it removes the sidecar and the
  `127.0.0.1` endpoint the app expects.
- **Database role/schema not created:** there is no dedicated migration job to
  re-run — the foundation's `create-db-and-user.sh` step creates the role and
  database, then Tolgee's own Liquibase migrations build the schema on boot.
  Inspect the setup job and its pod logs if the database looks empty:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Users unexpectedly logged out / bounced between sessions:** confirm
  `session_affinity = ClientIP` is still set, and check whether
  `TOLGEE_AUTHENTICATION_JWT_SECRET` was rotated — rotating it after first boot
  invalidates every active session.
- **Update rollout appears to hang:** remember the Deployment uses `Recreate`
  (NFS-backed default) — expect the old pod to fully terminate before the new
  one starts; this is a brief outage window, not a stuck rollout, unless the new
  pod also fails its startup probe.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the memory floor for Liquibase migrations and why
`enable_cloudsql_volume` must stay `true` on GKE).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, and the Cloud Storage
bucket. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud
SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, and a storage bucket; Tolgee self-migrates via Liquibase |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; sign in with the generated initial admin credential and change the password |
| 3 — Operate | Manual | Inspect workload, scale, update version (Recreate strategy), manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database connectivity, setup-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
