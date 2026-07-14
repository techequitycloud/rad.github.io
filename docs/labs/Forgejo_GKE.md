---
title: "Forgejo on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Forgejo on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Forgejo on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Forgejo_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Forgejo is a lightweight, community-managed, self-hosted Git service — a fork of
Gitea — providing repository hosting, issue tracking, pull requests, a built-in
CI/CD (Actions) runner, code review, and a package registry from a single Go
binary. This lab takes you through the full operational lifecycle of the
**Forgejo on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Forgejo product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Forgejo_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Bootstrap the first Forgejo administrator account (no admin is auto-created).
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Cloud Filestore (NFS), Artifact Registry, and
  shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Forgejo (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Forgejo_GKE)
   documents every input by group, with defaults. Leave `database_type` at its
   default `POSTGRES_15` — it is the only engine the module's database-init
   script supports, even though MySQL/`NONE` appear as dropdown options.
   Review the estimated cost (if credits are enabled) and click **Deploy**,
   which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster,
   provisions a Cloud SQL (PostgreSQL 15) database reached through a Cloud SQL
   Auth Proxy sidecar, mounts Cloud Filestore (NFS) for repository/LFS/attachment
   storage, generates the `SECRET_KEY` and `INTERNAL_TOKEN` secrets in Secret
   Manager, builds the container image, and runs a one-shot database-initialisation
   job. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep forgejo | head -1 | cut -d/ -f2)
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

   The Service is fronted by a Gateway with a reserved static IP; if no custom
   domain was supplied, an auto-provisioned `nip.io` HTTPS hostname is also
   reachable (see the `service_url` output).

2. Confirm the service is healthy. Forgejo serves an unauthenticated health
   endpoint that only responds correctly once its first-boot schema migrations
   finish:

   ```bash
   curl -s "http://${EXTERNAL_IP}/api/healthz"   # a healthy instance returns {"status":"pass"}
   ```

3. **Bootstrap the first administrator.** Unlike the Cloud Run variant, this
   module skips Forgejo's web installer entirely (`GITEA__security__INSTALL_LOCK
   = "true"`) and **no init job creates an admin account** — nothing pre-seeds
   a privileged user. Self-registration is open by default
   (`GITEA__service__DISABLE_REGISTRATION = "false"`), so the practical path is:
   register a normal account through the UI at `http://${EXTERNAL_IP}/`, then
   promote it to admin from inside the running pod using Forgejo's own CLI:

   ```bash
   kubectl exec -n "$NS" deploy/<service-name> -- forgejo admin user create --help
   # then, once the exact flags are confirmed against your deployed version:
   kubectl exec -n "$NS" deploy/<service-name> -- forgejo admin user create \
     --username <admin-user> --email <admin-email> --password '<strong-password>' --admin
   ```

   > The exact CLI invocation and whether the `forgejo` binary is on `PATH`
   > inside the container were not re-verified against a live pod for this
   > guide — run the `--help` variant first to confirm before scripting it.

4. Set `public_domain` (and optionally `public_url`) to the real external
   hostname and apply via **Update** — both default to `localhost`, which
   produces wrong Git clone URLs and broken links until overridden. After the
   admin account exists, consider setting
   `GITEA__service__DISABLE_REGISTRATION = "true"` (via `environment_variables`)
   if the instance should not be open to public sign-up.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and PVC/NFS mounts:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling
   is a configuration change, not a manual `kubectl scale` (a manual edit would
   be reverted on the next apply). `max_instance_count` defaults to `3`, but
   every replica shares the same NFS-backed repository data and the same
   Postgres database — concurrent-write correctness across replicas isn't
   documented for this module, so treat scaling beyond a single steady-state
   replica with the same caution as any shared-filesystem workload. Session
   affinity (`ClientIP`) is set by default to keep a client routed to the same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**. Because Forgejo is NFS-backed by
   default, the Deployment uses the **`Recreate`** rollout strategy rather than
   a rolling update: the old pod is fully terminated before the new one starts.
   Expect a brief service interruption during an update — this is expected,
   safe behaviour (it prevents two pods writing to the same repository data and
   database simultaneously), not a stuck rollout.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~forgejo"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=forgejo --project="$PROJECT"
   ```

6. **Redis caution.** `enable_redis = true` by default and `REDIS_HOST`/
   `REDIS_PORT` are injected into the container, but Forgejo is not configured
   to consume them (`GITEA__cache__*`/`GITEA__session__*` are not set) — it
   falls back to its built-in in-memory cache/session defaults regardless. If
   you don't intend to add that wiring yourself via `environment_variables`,
   there's no functional benefit to leaving Redis provisioned.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Forgejo releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Both the
  startup probe (`GET /api/healthz`, `initial_delay_seconds=0`,
  `period_seconds=30`, `failure_threshold=10` — roughly 5 minutes of
  tolerance) and the liveness probe (`initial_delay_seconds=60`,
  `period_seconds=30`, `failure_threshold=3`) target the same unauthenticated
  health endpoint; a connection failure to PostgreSQL will keep the pod from
  becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`. Forgejo reaches it through a Cloud SQL Auth Proxy sidecar on
  `127.0.0.1:5432` (`SSL_MODE=disable` for that hop); the platform entrypoint
  logs the resolved wiring (`Forgejo DB wired: host=... sslmode=... name=...
  user=...`) — check it with:
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep GITEA__
  ```
- **Initialisation job failed:** inspect the `db-init` job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Update rollout appears stuck:** because the Deployment uses `Recreate`
  (NFS-backed), you will briefly see zero Ready pods between the old pod
  terminating and the new one starting — this is expected and resolves once
  the new pod passes its startup probe, not a genuine hang. If it persists
  well past the ~5-minute startup-probe tolerance, treat it as a real failure
  and inspect the new pod's events/logs as above.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP (`reserve_static_ip = true` by default keeps the address stable
  across redeploys).
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.
- **No admin user / anyone can sign up:** expected out of the box — see
  Task 2, step 3, and consider disabling `GITEA__service__DISABLE_REGISTRATION`
  once an admin account exists.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rules never to rotate
`SECRET_KEY`/`INTERNAL_TOKEN` after first boot, never to change `db_name`/
`db_user` after first deploy, and to keep `database_type` at `POSTGRES_15`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes workload and namespace, the Cloud SQL database, Secret Manager
secrets (`SECRET_KEY`, `INTERNAL_TOKEN`, and the database password), the
unused Cloud Storage bucket, and Artifact Registry images. A destroy-time NFS
app-volume cleanup Job also removes Forgejo's repository data from the shared
Filestore volume on a best-effort basis (it skips if the namespace is already
gone). Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud
SQL instance, the Filestore NFS server itself, and the registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), NFS storage, secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; register and promote the first admin account via CLI |
| 3 — Operate | Manual | Inspect workload, scale, update version (Recreate rollout), manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, rollout, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including NFS app data (best-effort) |
