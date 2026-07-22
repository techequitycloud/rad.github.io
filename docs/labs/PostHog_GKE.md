---
title: "PostHog on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy PostHog on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PostHog on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PostHog_GKE)**

## Overview

**Estimated time:** 60–90 minutes

PostHog is an open-source product-analytics platform — event analytics, session replay,
feature flags, A/B testing, and funnels. Unlike most database-backed apps in this
catalogue, PostHog's core data pipeline runs across **four** independent stateful
services (PostgreSQL, ClickHouse, Kafka, and Redis), which makes this lab a good
opportunity to practice diagnosing multi-dependency readiness failures, not just a single
database connection. This lab takes you through the full operational lifecycle of the
**PostHog on GKE Autopilot** module: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
PostHog product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/PostHog_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Distinguish PostHog's four mandatory dependencies (Postgres, ClickHouse, Kafka, Redis)
  and confirm each is reachable.
- Perform day-2 operations — inspect, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including
  dependency-readiness failures specific to this module.
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
- Optional but recommended: `ClickHouse_GKE` already deployed if you want to exercise
  the production (external ClickHouse) path rather than the dev/test inline fallback.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **PostHog (GKE)** from the
   **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PostHog_GKE) documents
   every input by group, with defaults. If you have a `ClickHouse_GKE` instance already
   deployed, set `clickhouse_host` to its internal Service DNS/IP for a production-grade
   event store; otherwise leave `enable_inline_clickhouse = true` for the bundled
   dev/test fallback. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a Cloud
   SQL (PostgreSQL 15) database for Django's own app metadata, its Secret Manager
   secrets (`SECRET_KEY`, the S3-interop HMAC key pair, and the database password), a
   Cloud Storage bucket for session-replay/export data, builds the custom container
   image, and runs two one-shot jobs: `db-init` (creates the Postgres role and database)
   and `clickhouse-migrate` (applies PostHog's ClickHouse schema to completion before the
   app boots). Unless you supplied an external `clickhouse_host`, a single-node
   ClickHouse instance and a single-node Redpanda (Kafka) broker are also deployed as
   companion services. First deploys take roughly **25–40 minutes** — Cloud SQL creation
   and the ClickHouse schema migration both take real time.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep posthog | head -1 | cut -d/ -f2)
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

2. Confirm the service is genuinely healthy. `/_readyz` performs deep dependency checks
   across all four data stores — it will not return 200 until Postgres migrations,
   ClickHouse, Kafka, the Celery broker, and the cache are all reachable:

   ```bash
   curl -s "http://${EXTERNAL_IP}/_readyz"    # expect: {"clickhouse": true, "postgres": true, ...}
   curl -s "http://${EXTERNAL_IP}/_livez"     # expect: {"http": true}
   ```

   The startup probe allows a generous window (~25 minutes) for this to pass on first
   boot — Django's full migration history plus the co-located Celery worker+beat import
   sequence take real time. If `/_readyz` returns a partial `false` for one dependency,
   see Task 5.

3. Open `http://${EXTERNAL_IP}` in a browser. On first visit PostHog prompts you to
   create the initial administrator account and organisation — no pre-seeded admin
   credential exists in Secret Manager. Complete the sign-up form to reach the dashboard.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and companion services (ClickHouse/Kafka,
   if using the inline fallback):

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl get pods -n "$NS" -l app --show-labels | grep -E 'clickhouse|kafka'
   ```

2. **Scale** is intentionally limited: `max_instance_count` is hard-capped at `1` — the
   main container co-locates the Celery worker with its beat scheduler, so running
   multiple replicas would fire every periodic task multiple times. There is no scaling
   configuration change to make here; capacity is managed via `cpu_limit`/`memory_limit`
   instead.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a rolling update replaces the
   pod. `posthog/posthog` publishes a genuinely fresh `latest` tag, so leaving the
   version at `latest` and re-triggering a build picks up the newest upstream release.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~posthog"
   kubectl get jobs -n "$NS"          # db-init and clickhouse-migrate
   ```

5. **Open a database session** to inspect Django's own app metadata (not analytics data
   — that's in ClickHouse):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=posthog --project="$PROJECT"
   ```

6. **Query ClickHouse directly** to inspect the actual event store:

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" -- \
     sh -c 'echo "SELECT count() FROM events" | curl -s "http://$CLICKHOUSE_HOST:8123/?database=$CLICKHOUSE_DATABASE" --data-binary @-'
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The first lines of a healthy boot show
   the cloud entrypoint's resolved configuration (DSNs redacted):

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100 | grep -A6 cloud-entrypoint
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation (PostHog's first boot is genuinely CPU/memory-heavy — see the
   Configuration Guide's pitfalls table for the sizing floors this module defaults to),
   restart counts, and request metrics. The module can provision an **uptime check**
   (when enabled); review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level and module-specific diagnostics that do not change with PostHog releases.

- **Pod not Ready, `/_readyz` stuck on one dependency:** the response body names which
  check is failing (`clickhouse`, `postgres`, `celery_broker`, `cache`) — go straight to
  that dependency instead of guessing:
  ```bash
  curl -s "http://${EXTERNAL_IP}/_readyz" | python3 -m json.tool
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from a crashed container
  ```
- **Pod Ready but CPU pinned near 100% with no obvious crash:** this is very likely the
  known missing-Node-plugin-server condition (see the Configuration Guide) if you are
  running a module version that predates the `docker-boot.sh` fix, or a genuinely
  under-provisioned `cpu_limit` during first boot otherwise — `kubectl top pod` will show
  sustained saturation either way.
  ```bash
  kubectl top pod -n "$NS"
  ```
- **`clickhouse-migrate` init job failed or crash-looped:** inspect it directly — this is
  the job that must complete before the main app can pass `/_readyz`'s ClickHouse check:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/clickhouse-migrate
  ```
- **Database connection errors (Postgres):** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace, and `db-init`
  completed.
- **ClickHouse unreachable:** if using an external `clickhouse_host`, confirm network
  connectivity and that `clickhouse_password_secret` (if set) matches the target
  instance's actual password. If using the inline fallback, confirm the
  `<service>-clickhouse` pod is running and check its own logs for config-merge errors.
- **Kafka unreachable:** confirm the `<service>-kafka` pod (inline fallback) is running;
  `kubectl top pod` a sustained near-limit memory usage on it may indicate the broker is
  under-provisioned for the ingestion volume.
- **Redis connection errors:** confirm `enable_redis = true` and either `redis_host` is
  set or `enable_nfs = true` — the plan-time validation guard should have already caught
  a missing combination, but a manually-supplied `redis_host` that's unreachable will
  fail silently at connection time instead.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the custom-built image exists in Artifact Registry and
  the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas, including the critical rules around `max_instance_count`, `SECRET_KEY`
rotation, and the ClickHouse image-tag pin.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record
is retained for history). If a deployment is stuck and the RAD platform can no longer
manage it (for example after manual changes that conflict with the Terraform state), use
**Purge** instead — it removes the deployment from RAD's records **without** destroying
the cloud resources (it makes RAD forget the project). This removes everything the module
created — the Kubernetes workload and namespace (including the inline ClickHouse/Kafka
companion services, if used), Cloud SQL database, Secret Manager secrets, GCS bucket, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) — and a separately deployed `ClickHouse_GKE`, if you used the
external path — are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, storage bucket, and runs `db-init` + `clickhouse-migrate` |
| 2 — Access & verify | Manual | Connect to the cluster; `/_readyz` confirms all four dependencies (Postgres, ClickHouse, Kafka, Redis) are reachable; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect workload, update version, manage secrets/storage, query Postgres and ClickHouse directly |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose per-dependency readiness failures, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
