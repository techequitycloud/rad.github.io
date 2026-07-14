---
title: "PhpMyAdmin on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy PhpMyAdmin on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PhpMyAdmin on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_GKE)**

## Overview

**Estimated time:** 45–90 minutes

phpMyAdmin is the most popular open-source web tool for administering MySQL and
MariaDB databases over the browser — browse and edit tables, run SQL, manage users,
and import/export data. This lab takes you through the full operational lifecycle of
the **phpMyAdmin on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

Unlike most modules in this repository, phpMyAdmin does not own or provision a
database — it is a *client* that connects to a MySQL/MariaDB server that already
exists elsewhere (the platform's shared Cloud SQL instance, another Cloud SQL
instance, or any reachable host). "Deploying" phpMyAdmin means standing up the web UI
and its connectivity path to that external server, not creating new data storage.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
phpMyAdmin product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running phpMyAdmin workload.
- Confirm which MySQL/MariaDB server phpMyAdmin is configured to target.
- Perform day-2 operations — inspect, scale, update the version, and pin or widen the
  MySQL target.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on — and, if you want phpMyAdmin to administer it, the platform's shared
  MySQL instance).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- Access to (or credentials for) a **MySQL/MariaDB server** you intend to administer —
  phpMyAdmin creates no database of its own.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **PhpMyAdmin (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PhpMyAdmin_GKE)
   documents every input by group, with defaults. Decide up front whether you want
   `pma_arbitrary = "1"` (default — users type any MySQL host at login) or a fixed
   `pma_host` with `pma_arbitrary = "0"` (single pinned server, e.g. the platform's
   Cloud SQL private IP). Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds the thin custom container image (`FROM phpmyadmin/phpmyadmin`),
   mirrors it into Artifact Registry, and deploys the workload into the GKE Autopilot
   cluster as a stateless `Deployment` (no StatefulSet — phpMyAdmin keeps no per-pod
   state) behind an external `LoadBalancer` Service. There is **no Cloud SQL instance,
   no Secret Manager secret, and no database-initialisation job** — phpMyAdmin
   provisions no data store of its own. First deploys typically take only
   **5–10 minutes** (image build plus scheduling and LoadBalancer provisioning — none
   of the Cloud SQL provisioning time other application modules incur).

3. Connect to the cluster and discover the namespace with a name-agnostic filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep phpmyadmin | head -1 | cut -d/ -f2)
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

2. Confirm the workload is up. phpMyAdmin serves its login page at `/` with a `200`
   as soon as Apache/PHP is ready — there is no database-connectivity dependency to
   wait on, since phpMyAdmin holds no database of its own:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Confirm which MySQL/MariaDB server phpMyAdmin is configured to target by
   inspecting the injected `PMA_*` env vars on the running pod:

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep PMA_
   ```

4. Open `http://${EXTERNAL_IP}` in a browser.
   - If `PMA_ARBITRARY = "1"` (default), the login page shows a server-input box —
     type the MySQL/MariaDB host, then your username and password for that server.
   - If a fixed `pma_host` is set (`PMA_ARBITRARY = "0"`), only username and password
     are shown, scoped to that one server.
   In both cases, **authenticate with the target MySQL server's own account** —
   phpMyAdmin has no admin account of its own to create, and stores nothing between
   requests beyond the session cookie.

5. To administer the platform's shared Cloud SQL MySQL instance, first find its
   private IP:

   ```bash
   gcloud sql instances list --project="$PROJECT" --filter="databaseVersion~MYSQL"
   gcloud sql instances describe <instance-name> --project="$PROJECT" \
     --format='value(ipAddresses[0].ipAddress)'
   ```

   Enter that IP as the server (arbitrary mode) or confirm it matches the configured
   `pma_host` (pinned mode). Pods reach a private-IP MySQL server directly over the
   cluster's VPC networking — no Auth Proxy sidecar is used
   (`enable_cloudsql_volume = false`, since phpMyAdmin doesn't use the platform's own
   Cloud SQL integration).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be reverted
   on the next apply). Unlike the Cloud Run variant, GKE has no scale-to-zero, so
   `min_instance_count` defaults to `1` — keep it at least 1 so the console stays
   reachable.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pods. Because phpMyAdmin holds no schema and no cryptographic keys,
   rolling updates and version bumps carry none of the migration/key-rotation risk
   other stateful modules have, and because the Deployment is stateless (no
   `stateful_pvc_enabled`), pods share no volume or lock to deadlock on.

4. **Re-point or widen the MySQL target** by changing `pma_host` / `pma_arbitrary` /
   `pma_port` in the RAD platform and applying **Update** — no data migration is
   involved since phpMyAdmin owns no data.

5. **Manage ingress and access control** — because phpMyAdmin grants full database
   administration to anyone who reaches it with valid MySQL credentials, review
   `service_type` (external `LoadBalancer` by default) and consider `ClusterIP` behind
   an IAP-gated Ingress before leaving it running:

   ```bash
   kubectl get svc,ingress -n "$NS"
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
   memory utilisation and restart counts. The module can provision an **uptime check**
   (when enabled); review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with phpMyAdmin releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  targets `/` with a short initial delay (10s) and up to ~6 retries at a 10s period —
  phpMyAdmin boots in a few seconds, so a probe failure almost always points at the
  container itself, not a slow dependency (it has none).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Login page loads but every login fails:** this is a MySQL-side credential or
  reachability problem, not a phpMyAdmin or GKE issue — phpMyAdmin stores no
  credentials of its own. Confirm the target host is correct, the account exists on
  that MySQL server, and the account's host-grants (`user@host`) allow a connection
  from the cluster's node/pod IP range.
- **"Cannot connect" / timeout at login:** confirm the target MySQL server's private
  IP is correct and reachable from the cluster's VPC, and that its firewall rules or
  authorized networks allow the cluster's range. Since `enable_cloudsql_volume =
  false`, there is no Auth Proxy sidecar in the pod to check — connectivity is direct.
- **Wrong or unexpected MySQL host offered at login:** re-check the injected `PMA_*`
  env vars on the running pod — a stale pod from a prior rollout may still be serving
  traffic:
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep PMA_
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section for
setting-specific gotchas (including why an unauthenticated external `LoadBalancer`
without IAP is a **Critical**-risk misconfiguration for a database-admin tool, why
`database_type` other than `NONE` is blocked by a plan-time validation guard, and why
`PMA_ARBITRARY = "1"` widens the blast radius of a compromised session).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources (it makes RAD forget the project). This
removes everything the module created — the Kubernetes workload and namespace, the
LoadBalancer Service, and the Artifact Registry image. Because phpMyAdmin provisions
no database, no Secret Manager secrets, and no storage bucket of its own, there is
nothing else for this module to clean up — the MySQL/MariaDB server it was pointed at
is **not** touched (it is owned elsewhere, typically by Services_GCP or another
application module). Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds/mirrors the image and deploys the GKE workload + LoadBalancer only — no database, secrets, or storage bucket are created |
| 2 — Access & verify | Manual | Connect to the cluster; login page returns 200; confirm the configured MySQL target; authenticate with that server's own credentials |
| 3 — Operate | Manual | Inspect workload, scale (min 1, no scale-to-zero on GKE), update version, re-point the MySQL target, review ingress/IAP |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, MySQL-connectivity, scheduling/LB, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes the workload, namespace, and image; the external MySQL server is unaffected |
