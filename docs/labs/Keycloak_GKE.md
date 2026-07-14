---
title: "Keycloak on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Keycloak on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Keycloak on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Keycloak_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Keycloak is an open-source identity and access management platform providing single sign-on (SSO), OIDC, and SAML for your applications. This lab takes you through the full operational lifecycle of the **Keycloak on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on Keycloak product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Keycloak_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Access the Keycloak admin console with the Secret Manager bootstrap credential and verify the service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the database.
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

1. Click **Deploy** in the RAD platform top navigation, open **Keycloak (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Keycloak_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets (database
   password + bootstrap admin password), builds the production-optimized Keycloak
   container image with Cloud Build (`kc.sh build` → `start --optimized`), and runs
   a one-shot `db-init` Job that creates the Keycloak database and role. On GKE,
   Keycloak reaches Postgres through a **Cloud SQL Auth Proxy sidecar** listening on
   `127.0.0.1:5432` — a real TCP loopback listener, not the Unix-socket mount Cloud
   Run uses, so the JDBC driver (`KC_DB_URL=jdbc:postgresql://127.0.0.1:5432/<db>`)
   connects with no socket workaround needed. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep keycloak | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. The OIDC discovery document of the built-in
   `master` realm is public and proves Keycloak is up **and** talking to its
   database:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     "http://${EXTERNAL_IP}/realms/master/.well-known/openid-configuration"   # expect 200
   curl -s "http://${EXTERNAL_IP}/realms/master/.well-known/openid-configuration" | head -c 300
   ```

   Note: Keycloak's `/health` endpoint lives on the separate management port 9000,
   which is not exposed by the Kubernetes Service — the readiness/liveness probes
   the platform actually uses are plain **TCP checks against port 8080**, and the
   OIDC discovery document above is the correct external check for you to run.

3. Open `http://${EXTERNAL_IP}/admin` in a browser to reach the admin console. Log
   in with the **bootstrap admin** — username `admin`, password from Secret
   Manager:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~keycloak-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

4. **Immediate hardening:** the bootstrap admin is temporary by design. In the
   admin console create a permanent administrator (Users → Add user, assign the
   `admin` role), sign in as that user, then delete or disable the bootstrap
   `admin` user.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and events:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Note that `Keycloak_GKE`'s `main.tf` hardcodes the
   effective replica bounds to `min_instance_count = 1` / `max_instance_count = 5`
   for this workload regardless of the values you set on the two top-level inputs
   — see the Configuration Guide's Pitfalls section before relying on those
   variables for cost control. Also verify session/cache replication before
   relying on `max_instance_count > 1` for session continuity — the deployed
   image's Infinispan cache stack has not been confirmed to replicate session
   state across pods (documented as an open TODO in the Configuration Guide).
   `session_affinity` is `ClientIP` by default to keep a client on the same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update replaces the pods. **Never downgrade** — Keycloak schema migrations are
   one-way.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~keycloak"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance (Keycloak keeps all
   realms, clients, and users in PostgreSQL):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~keycloak" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The entrypoint prints a
   configuration summary (`KC_DB_URL`, `KC_HOSTNAME`, proxy settings) at every
   start:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation (watch memory closely — Keycloak is a JVM, 4Gi by default),
   restart counts, and request metrics. The module can provision an **uptime
   check** (disabled by default) targeting Keycloak's public landing page at `/`;
   enable `uptime_check_config` via **Update** and confirm it is green under
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Keycloak releases.

- **Pod not Ready / CrashLoopBackOff:** the startup probe is **TCP on port 8080**
  with a generous budget (30s initial delay, 30 failures ≈ up to ~330s) for JVM
  start plus first-boot schema migration; the liveness probe is also TCP (60s
  initial delay, 3 failures). Inspect events and logs before concluding the
  workload has failed:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance
  is `RUNNABLE`, the `db-init` Job completed, and the pod logs show a `KC_DB_URL`
  pointing at `127.0.0.1:5432`. On GKE, `enable_cloudsql_volume` must stay
  `true` — it provisions the Cloud SQL Auth Proxy sidecar that gives the JDBC
  driver a real TCP loopback listener; without it there is no path to the
  database at all.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it. `imagePullPolicy=Always` is set for
  custom-built images, so a rebuild-redeploy always fetches the latest layers.
- **App-specific — OIDC redirects go to the wrong host:** `entrypoint.sh`
  auto-detects the public URL as `KC_HOSTNAME` via the GCP metadata server,
  falling back to the `SERVICE_URL` the foundation injects. If you front Keycloak
  with a custom domain, set `KC_HOSTNAME` explicitly in `environment_variables`
  so issuer URLs and login redirects match the hostname users actually visit. (A
  404 on `/health` at port 8080 is **not** a failure — health/metrics live on the
  separate, unexposed management port 9000.)

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas — in particular the hardcoded `1`/`5` replica bounds,
the `db_name`/`db_user` vs. `application_database_name`/`application_database_user`
shadowing, and the `cpu_limit`/`memory_limit` vs. `container_resources`
shadowing, all of which can silently make a changed input a no-op.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets (bootstrap admin +
database password), and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, builds the optimized image, and runs `db-init` |
| 2 — Access & verify | Manual | Connect to the cluster; OIDC discovery returns 200; bootstrap admin login; permanent admin created |
| 3 — Operate | Manual | Inspect workload, scale (aware of the hardcoded 1/5 replica bounds), update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, image-pull, and hostname issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
