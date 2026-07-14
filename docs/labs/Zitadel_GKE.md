---
title: "Zitadel on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Zitadel on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Zitadel on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Zitadel_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Zitadel is an open-source, cloud-native identity and access management (IAM) platform
providing OpenID Connect, OAuth 2.0, SAML, and user/organization management. This lab
takes you through the full operational lifecycle of the **Zitadel on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Zitadel's own IAM configuration (organizations, projects, OIDC/SAML applications). For
the complete list of provisioned services and every configuration input (organised by
group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Zitadel_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and sign in with the seeded
  admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
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

1. Click **Deploy** in the RAD platform top navigation, open **Zitadel (GKE)** from the
   **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Zitadel_GKE) documents
   every input by group, with defaults. Review the estimated cost (if credits are
   enabled) and click **Deploy**, which opens the deployment status page with real-time
   logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a Cloud
   SQL for PostgreSQL 15 database with its Secret Manager secrets (`ZITADEL_MASTERKEY`
   and the initial admin password, plus the database password), a Cloud Storage bucket,
   builds the container image, and runs a one-shot database-initialisation job
   (`db-init`) that creates the application database and role via a Cloud SQL Auth Proxy
   sidecar — Zitadel then creates its own schema on first boot via
   `zitadel start-from-init`. First deploys take roughly **20–35 minutes** (Cloud SQL
   creation dominates), and the first boot itself can take an additional **7–8 minutes**
   for schema setup and migrations before the health probe passes.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep zitadel | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address (a static IP is
   reserved by default so the address survives redeploys):

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Zitadel exposes an unauthenticated health endpoint:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/debug/healthz"   # expect 200
   ```

3. Retrieve the seeded initial admin password from Secret Manager:

   ```bash
   gcloud secrets versions access latest \
     --secret="secret-<resource_prefix>-zitadel-admin-password" --project="$PROJECT"
   ```

   (Find the exact secret name with `gcloud secrets list --project="$PROJECT"
   --filter="name~zitadel"` if you don't already know the resource prefix.)

4. Open `http://${EXTERNAL_IP}` in a browser and sign in to the Console with username
   `zitadel-admin` and the password from the previous step. Zitadel seeds this account
   with `PASSWORDCHANGEREQUIRED = false`, so you can sign in immediately. Once signed in,
   create a real administrator, then disable or restrict the seeded `zitadel-admin`
   account and configure your organizations, projects, and OIDC/SAML applications.

5. **This step is mandatory on GKE, not optional.** On GKE the entrypoint derives
   `ZITADEL_EXTERNALDOMAIN` from the in-cluster service URL, not the external address —
   so external access **always** needs it set explicitly. Patch the running deployment
   to the LoadBalancer IP's host (or your custom domain):

   ```bash
   kubectl set env deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -n "$NS" ZITADEL_EXTERNALDOMAIN="${EXTERNAL_IP}.nip.io"
   ```

   Without this, the OIDC issuer and Console redirect URIs point at the wrong host and
   logins/token exchange fail.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and disruption budget:

   ```bash
   kubectl get deploy,pods,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be reverted on
   the next apply). GKE keeps a minimum of 1 replica (no scale-to-zero); it is safe to
   raise `max_instance_count` since all state lives in PostgreSQL. Session affinity
   (`ClientIP`) is set by default so Console UI sessions stick to a single pod.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a rolling update replaces the
   pods. Zitadel applies its own schema migrations idempotently on start — there is no
   separate migrate step to run.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~zitadel"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   Do not rotate `ZITADEL_MASTERKEY` after first boot — it encrypts all data at rest, and
   rotating it makes previously-encrypted data (client secrets, key material)
   permanently unreadable. Secrets are delivered to the pod via the Secret Store CSI
   driver.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=zitadel --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The `[cloud-entrypoint]` log lines
   show the resolved DB SSL mode and external domain — useful when diagnosing login
   failures:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -c zitadel --tail=50
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -c zitadel | grep cloud-entrypoint
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. The module can provision an
   **uptime check** (when enabled); review Monitoring → Uptime checks and Alerting →
   Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Zitadel releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes target `/debug/healthz` and allow roughly **7–8 minutes** on first
  boot for schema setup and migrations.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> -c zitadel --previous       # logs from the crashed container
  ```
- **Login / token exchange fails after deploy:** the OIDC issuer and Console redirects
  are built from `ZITADEL_EXTERNALDOMAIN`. On GKE this **always** needs to be set to the
  external LoadBalancer IP host or custom domain — the entrypoint's default derives from
  the in-cluster URL, which is unreachable from a browser. Patch it with
  `kubectl set env` (see Task 2) and confirm with `grep cloud-entrypoint` in the logs.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret materialised into the namespace, and the init job completed.
- **Initialisation job failed:** inspect the job and its pod logs. Note this job only
  creates the database/role — it does not create Zitadel's own schema (that happens
  in-container on start):
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section for
setting-specific gotchas (including the critical rule never to rotate
`ZITADEL_MASTERKEY` after first boot, and the mandatory PostgreSQL requirement).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; sign in with the seeded `zitadel-admin` account; set `ZITADEL_EXTERNALDOMAIN` for external access |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging (including `[cloud-entrypoint]` lines); review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, external-domain, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
