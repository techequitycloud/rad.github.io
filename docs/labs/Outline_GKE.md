---
title: "Outline on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Outline on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Outline on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Outline_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Outline is a fast, collaborative, Notion-style team knowledge base and wiki with
real-time editing, rich markdown documents, and powerful full-text search. Unlike
most modules in this catalogue, Outline has no built-in username/password store —
it authenticates exclusively through an external identity provider (OIDC, Google,
Slack, etc.), which makes wiring up auth a required, not optional, part of this lab.
This lab takes you through the full operational lifecycle of the **Outline on GKE
Autopilot** module on Google Cloud: deploy it, connect to the cluster, configure the
required authentication provider, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Outline product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Outline_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Configure the **required** OIDC authentication provider so login actually works.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Filestore NFS, Artifact Registry, and shared service accounts
  this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Outline (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Outline_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (auto-generated `SECRET_KEY` and `UTILS_SECRET`, plus the database password), a
   Cloud Filestore (NFS) share mounted at `/var/lib/outline/data` for uploaded
   files, two Cloud Storage buckets (created but unused by default — Outline is
   configured for local/NFS storage, not object storage), builds the custom
   container image, and runs a one-shot database-initialisation job. Outline also
   requires Redis, which is **enabled by default** and points at the co-hosted
   Redis process on the shared NFS VM — no separate Memorystore instance is
   created unless you configure one. First deploys take roughly **20–35 minutes**
   (Cloud SQL and Filestore creation dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep outline | head -1 | cut -d/ -f2)
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

   Allow 60+ seconds after the pod goes `Running` for the entrypoint to connect to
   PostgreSQL, run the Sequelize migrations, and connect to Redis before the
   startup probe (`GET /`) passes.

2. Open `http://${EXTERNAL_IP}` in a browser. **Expect an empty login page** — this
   is the module's most important first-run fact, not a failure. The `OIDC_*`
   environment variables ship intentionally blank, so with no identity provider
   configured Outline registers **zero** auth methods. The service is healthy;
   sign-in requires the next step.

3. **Configure the required OIDC provider.** First check what `URL` the workload
   is already using — on GKE, `App_GKE` unconditionally injects the computed
   address as `GKE_SERVICE_URL`, and the entrypoint sets `URL` to it automatically
   whenever `URL` isn't already set, so a fresh deploy has a working `URL` with no
   manual override needed (unless you want to force a hostname ahead of DNS/cert
   provisioning):

   ```bash
   kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E '^(URL|GKE_SERVICE_URL)'
   ```

   Create an OAuth client at your IdP (e.g. Google: APIs & Services →
   Credentials) with `<URL>/auth/oidc.callback` as an authorized redirect URI —
   the callback **must be on the same host** as the injected `URL`. Then, on the
   deployment's configuration page in the RAD platform, set the plain endpoint
   values in `environment_variables` and click **Update**:

   ```
   OIDC_AUTH_URI      = https://accounts.google.com/o/oauth2/v2/auth
   OIDC_TOKEN_URI      = https://oauth2.googleapis.com/token
   OIDC_USERINFO_URI   = https://openidconnect.googleapis.com/v1/userinfo
   OIDC_USERNAME_CLAIM = email
   ```

   Bind the client credentials as secrets in `secret_environment_variables`
   (`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) pointing at Secret Manager secrets
   holding your OAuth client ID/secret, then **Update** again. Unlike the Cloud
   Run variant — where `gcloud run services update` refuses to convert a plain env
   var straight to a secret ref in one call ("already set with a different
   type"), forcing a `--remove-env-vars` pass before `--update-secrets` — GKE's
   path is declarative: on GKE, Secret-Manager-backed values are materialised
   into the cluster as native Kubernetes Secrets by the **SecretSync** controller
   (the `secretsyncs.secret-sync.gke.io` CRD), and a single `tofu apply` (the
   platform's **Update**) renders the whole desired pod `env` list in one pass —
   no two-step gcloud dance needed. The one thing to get right yourself: **remove
   `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` from `environment_variables` in the same
   apply** that adds them to `secret_environment_variables`. Leaving the same key
   in both maps puts two `env` entries of the same name in the Pod spec (one
   `value`, one `valueFrom.secretKeyRef`) — Kubernetes accepts this without
   erroring, but which value the running process actually observes is not
   something to rely on; keep exactly one source per key.

   Confirm the secret materialised and reload the login page — your provider
   button should appear; the first user to sign in creates the workspace.

   ```bash
   kubectl get secret -n "$NS"                       # look for the SecretSync-materialised secret object
   gcloud secrets list --project="$PROJECT" --filter="name~outline"
   ```

4. **Before you enable auth at all, make sure the LoadBalancer is behind HTTPS.**
   The default `service_type = LoadBalancer` is plain HTTP with no TLS terminator.
   Outline's OAuth flow sets the `state` cookie with `secure: true`; over plain
   HTTP, `/auth/<provider>` returns `500 — Cannot send secure cookie over
   unencrypted connection` even though the landing page loads fine. Enable
   `enable_custom_domain` with `application_domains` set to a real hostname (plus
   DNS pointed at the reserved static IP) before wiring up the IdP, or expect the
   500 above.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and persistent volumes:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl get pvc -n "$NS"          # the Filestore-backed NFS claim
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Outline defaults to a higher ceiling than most
   NFS-backed modules here (`min_instance_count = 1`, `max_instance_count = 3`)
   because Redis coordinates realtime/session state across replicas. Session
   affinity (`ClientIP`) is set by default to keep a client routed to the same
   pod. Because `enable_nfs = true`, rollouts use the `Recreate` strategy — **all**
   running replicas are stopped before the replacement set starts, so expect a
   brief full outage on every redeploy, not a rolling zero-downtime one.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and the `Recreate`
   rollout replaces the pods (the entrypoint runs any pending Sequelize
   migrations on start).

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~outline"    # DB password, SECRET_KEY, UTILS_SECRET
   kubectl get jobs -n "$NS"                                           # db-init and any scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~outline"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=outline --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   On startup, look for the entrypoint's `DATABASE_URL` assembly log, the
   Sequelize migration output, and the Redis connection confirmation.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. `uptime_check_config`
   is **disabled by default** for this module — leave it off until the app is
   reachable over HTTPS with auth configured (until then the app is expected to
   be effectively unusable), then enable it and review Monitoring → Uptime checks
   and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Outline releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe allows roughly 120 seconds (60s initial delay, 6 retries) for the
  entrypoint to reach PostgreSQL and run migrations before Kubernetes gives up.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Empty login page (the app-specific one):** this is *not* a deployment
  failure — the `OIDC_*` placeholders are blank until you configure an IdP
  (Task 2). If a provider is configured but login loops or errors, verify the
  redirect URI is `<URL>/auth/oidc.callback` on the exact host in the injected
  `URL`, and that the LoadBalancer is behind HTTPS (plain HTTP 500s on
  `/auth/<provider>` with a `secure` cookie error):
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E '^(URL|OIDC_)'
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance
  is `RUNNABLE`, the DB password secret materialised into the namespace via
  SecretSync, and the `db-init` job completed. The connection uses the Cloud SQL
  Auth Proxy sidecar (loopback `127.0.0.1:5432`) — `enable_cloudsql_volume` must
  stay `true`.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Redis errors / reconnect loop in logs:** Outline requires Redis even at a
  single replica — it is not an optional cache tier here. Verify `enable_redis =
  true` and that the shared NFS VM (which co-hosts Redis) is `RUNNING`, or that
  `redis_host` points at a reachable endpoint:
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E '^REDIS_'
  ```
- **Uploads not persisting / NFS mount issues:** verify `enable_nfs = true`,
  `nfs_mount_path` is `/var/lib/outline/data`, and the Filestore instance and PVC
  are healthy:
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  kubectl get pvc -n "$NS"
  ```
- **Rollout appears stuck on update:** because `enable_nfs = true` forces the
  `Recreate` strategy, an update briefly shows zero running pods (all replicas
  torn down together) before the replacement set starts — this is expected, not
  a hang, though with `max_instance_count = 3` it is a longer visible gap than a
  single-replica app.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it; this is a custom-build module, so also check
  Cloud Build history for a failed image build.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas — including the critical rules never to rotate
`SECRET_KEY` after first boot, never to disable `enable_redis`, and to put HTTPS
in front of the Service before enabling any auth provider.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets (database password,
`SECRET_KEY`, `UTILS_SECRET`), the Filestore NFS share, both Cloud Storage
buckets, and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, GKE cluster, shared Cloud SQL, the NFS/Redis VM, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), Filestore NFS, GCS buckets, secrets, builds the image, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; configure the required OIDC provider (endpoints + secret-backed client ID/secret via SecretSync) and complete first sign-in |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access; note the `Recreate` rollout outage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, OIDC, database, init-job, Redis, NFS, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
