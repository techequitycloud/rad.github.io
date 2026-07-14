---
title: "Documenso on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Documenso on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Documenso on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Documenso_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Documenso is an open-source DocuSign alternative — a Next.js + Prisma
application for sending, signing, and managing e-signature documents. This lab
takes you through the full operational lifecycle of the **Documenso on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Documenso product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Documenso_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and complete
  Documenso's first-run account setup.
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

1. Click **Deploy** in the RAD platform top navigation, open **Documenso (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Documenso_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (`NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`,
   `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, an HMAC key pair for optional S3
   upload transport, and the database password), a Cloud Storage `uploads`
   bucket, a Cloud Filestore (NFS) instance, a Gateway with a reserved static
   IP, builds the custom container image, and runs a one-shot
   database-initialisation job. First deploys take roughly **20–35 minutes**
   (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep documenso | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address. Documenso
   defaults `enable_custom_domain = true`, so a Gateway with a reserved static
   IP is provisioned automatically; if `application_domains` is left empty, a
   `nip.io` hostname based on that IP is used:

   ```bash
   kubectl get pods,svc,gateway -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service responds. Documenso has no dedicated health endpoint —
   the startup probe is an HTTP `GET /` with a generous ~10-minute budget to
   absorb cold start plus first-boot Prisma migrations:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}"   # expect 200 (or a redirect to /signin)
   ```

3. Open `http://${EXTERNAL_IP}` (or the assigned `nip.io`/custom-domain URL) in
   a browser. Documenso provisions **no bootstrap admin account** — the first
   person to complete sign-up through the app's own web UI becomes the account
   owner. Create that account now.

4. Set `webapp_url` to the stable domain/IP via **Update**. Until it is set
   explicitly, the entrypoint re-derives `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL`
   from the platform-injected `GKE_SERVICE_URL` on every boot.

5. **Signing certificate.** With no certificate supplied, the app self-signs a
   throwaway `.p12` at boot so document signing works end-to-end for testing —
   but the signature is not trusted by PDF readers. For anything beyond this
   lab, supply a real certificate (see Task 3, step 5).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and storage:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).
   Documenso defaults to `min_instance_count = 0` (scale-to-zero) and
   `max_instance_count = 3`. Session affinity (`ClientIP`) is set by default to
   keep a client routed to the same pod.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds (from
   `docker.io/documenso/documenso:${DOCUMENSO_VERSION}`) and a rolling update
   replaces the pods. Prisma migrations run automatically on container start —
   there is no separate migrate job to run.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~documenso"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Wire a production signing certificate** (recommended before real use): set
   `secret_environment_variables` to map `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`
   (a base64-encoded `.p12`) and `NEXT_PRIVATE_SIGNING_PASSPHRASE` to secrets in
   Secret Manager, then apply via **Update**. Never regenerate
   `NEXT_PRIVATE_ENCRYPTION_KEY` in place afterward — it decrypts data already
   stored in Postgres; rotate only through the secondary-key slot.

6. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~documenso" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=documenso --project="$PROJECT"
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
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Documenso releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe is HTTP `GET /` with a ~10-minute budget (cold start plus first-boot
  Prisma migrations count against it); the liveness probe is HTTP `GET /` with
  a 60s initial delay, so a healthy-but-slow first boot can still look like a
  restart if the budget is exceeded.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace via the Secret Store CSI
  driver, and the `db-init` job completed. `enable_cloudsql_volume` defaults
  `true` on this module (the cloud-sql-proxy sidecar), which the entrypoint's
  connection logic expects — leave it enabled.
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E 'DATABASE_URL|WEBAPP_URL|SIGNING'
  ```
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the Gateway/LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including `db_name`/`db_user` immutability
after first deploy, and never rotating `NEXT_PRIVATE_ENCRYPTION_KEY` in place).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, Filestore instance, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, uploads bucket, Filestore, static IP/Gateway, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; service responds; create the initial owner account in the UI; note the self-signed cert caveat |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, wire a production signing cert, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
