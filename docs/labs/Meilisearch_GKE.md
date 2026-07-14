---
title: "Meilisearch on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Meilisearch on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Meilisearch on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Meilisearch is a fast, open-source search engine — a single Rust binary that
delivers instant, typo-tolerant, faceted search behind a simple REST API, widely
used as a self-hostable alternative to Algolia. This lab takes you through the full
operational lifecycle of the **Meilisearch on GKE Autopilot** module on Google
Cloud: deploy it with a StatefulSet PVC, access and verify it, build a real search
index and query it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on every Meilisearch feature. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module (StatefulSet PVC) from the RAD platform and locate the resources it provisions.
- Access and verify the running workload and retrieve the master key.
- Create an index, add documents, and run a typo-tolerant search via the REST API.
- Perform day-2 operations — inspect pods/PVC, update, mint scoped keys, and manage backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **kubectl** installed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Meilisearch (GKE)**, set `project_id`, and set
   `stateful_pvc_enabled = true` for production-grade Persistent Disk storage. Review
   the remaining inputs — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Meilisearch_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform generates the `MEILI_MASTER_KEY` and stores it in Secret Manager
   (injecting it as a native Kubernetes Secret), builds and mirrors the
   `getmeili/meilisearch:v1.11` image, creates a StatefulSet with a PVC mounted at
   `/meili_data`, and exposes a ClusterIP Service. There is **no** Cloud SQL database
   and **no** init job — Meilisearch manages its own storage. First deploys take
   roughly **8–15 minutes** (image build + Autopilot pod scheduling).

3. When it completes, get cluster credentials and discover the resources with
   name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep -i meilisearch | head -1 | cut -d/ -f2)
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -iv headless | head -1 | cut -d/ -f2)
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~api-key" --format="value(name)" --limit=1)
   MEILI_MASTER_KEY=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Namespace: $NAMESPACE"
   echo "Service:   $SERVICE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running and the PVC is bound:

   ```bash
   kubectl get pods,pvc -n "$NAMESPACE"
   ```

2. Port-forward the Service and check the unauthenticated `/health` endpoint, which
   returns `{"status":"available"}` once the engine is ready:

   ```bash
   kubectl port-forward -n "$NAMESPACE" "svc/$SERVICE" 7700:7700 &
   curl -s "http://localhost:7700/health"          # expect {"status":"available"}
   ```

3. Confirm the master key works and lists the (initially empty) set of indexes:

   ```bash
   curl -s "http://localhost:7700/indexes" -H "Authorization: Bearer $MEILI_MASTER_KEY"
   # expect {"results":[],"offset":0,"limit":20,"total":0}
   ```

---

## Task 3 — Build an index and search it (worked example) [Manual]

With the port-forward from Task 2 still open, create an index, add documents, and run
a typo-tolerant search — all through the REST API with the master key as a Bearer
token.

1. **Add documents.** Meilisearch creates the index automatically on the first write;
   the `id` field is the primary key:

   ```bash
   curl -s -X POST "http://localhost:7700/indexes/movies/documents" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '[
       {"id":1,"title":"Interstellar","genre":"Sci-Fi","year":2014},
       {"id":2,"title":"Inception","genre":"Sci-Fi","year":2010},
       {"id":3,"title":"The Grand Budapest Hotel","genre":"Comedy","year":2014}
     ]'
   # returns a task: {"taskUid":0,"status":"enqueued",...}
   ```

2. **Wait for indexing** (writes are processed asynchronously as tasks):

   ```bash
   curl -s "http://localhost:7700/indexes/movies/tasks" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" | head
   # look for "status":"succeeded"
   ```

3. **Search — with a deliberate typo** to demonstrate built-in typo tolerance
   (`interstellr` still finds *Interstellar*):

   ```bash
   curl -s "http://localhost:7700/indexes/movies/search" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"q":"interstellr"}'
   # returns the Interstellar hit in a few milliseconds
   ```

4. **Filter and facet.** Make `genre` and `year` filterable, then query them:

   ```bash
   curl -s -X PATCH "http://localhost:7700/indexes/movies/settings/filterable-attributes" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '["genre","year"]'

   curl -s "http://localhost:7700/indexes/movies/search" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"q":"","filter":"year = 2014 AND genre = Sci-Fi"}'
   # returns only Interstellar
   ```

5. **Persistence check.** All of this lives on the PVC at `/meili_data`. Delete the
   pod and watch the StatefulSet recreate it with the same data attached:

   ```bash
   kubectl delete pod -n "$NAMESPACE" -l app=meilisearch      # StatefulSet recreates it
   kubectl get pods -n "$NAMESPACE" -w                         # wait for Running/Ready
   # re-run the search from step 3 — the index is still there
   ```

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload, PVC, and events:**

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NAMESPACE"
   kubectl describe pvc -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" "statefulset/$SERVICE" --tail=100
   ```

2. **Do not scale horizontally.** Meilisearch is single-writer; the module pins
   `max_instance_count = 1`. To handle more load, raise `cpu_limit`/`memory_limit`
   via **Update**, not the replica count — the module owns the workload spec, so a
   manual `kubectl scale` would be reverted on the next apply.

3. **Mint a scoped, search-only API key** for your application instead of sharing the
   master key:

   ```bash
   curl -s -X POST "http://localhost:7700/keys" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"description":"web search-only","actions":["search"],"indexes":["movies"],"expiresAt":null}'
   # returns a scoped "key" — distribute THIS, never the master key
   ```

4. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and the StatefulSet rolls the
   pod.

5. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~meilisearch"
   kubectl get cronjob -n "$NAMESPACE"          # scheduled backup jobs, if enabled
   ```

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Monitoring** — open the GKE workload dashboard and review pod CPU / memory
   utilisation (watch memory as your index grows), restart counts, and PVC usage. If
   you enabled the **uptime check** against `/health`, confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Meilisearch releases.

- **Pod CrashLoopBackOff / won't start:** a common cause is a **missing master key** —
  in production mode Meilisearch exits immediately if `MEILI_MASTER_KEY` is unset or
  shorter than 16 bytes. Confirm `enable_api_key = true` and that the K8s Secret is
  present:
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=meilisearch
  kubectl get secret -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" "statefulset/$SERVICE" --previous --tail=100
  ```
- **`401`/`403` on API calls:** the key you sent does not match the deployed
  `MEILI_MASTER_KEY`. Re-read it from Secret Manager and retry.
- **Pod Pending:** Autopilot is scheduling capacity or the PVC has not bound — check
  `kubectl describe pod` and `kubectl get pvc`.
- **Index looks empty after a pod restart:** confirm the PVC mount path is
  `/meili_data` (it must match `MEILI_DB_PATH`) and that the PVC re-attached.
- **`Image not found` / build failed:** review Cloud Build history for the failed
  build's log.
- **403 / permission errors:** verify the workload's Google service account (Workload
  Identity) has Secret Manager accessor and storage roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including keeping the PVC path matched to `MEILI_DB_PATH` and never running
more than one replica against the same volume).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the StatefulSet, the
Kubernetes Service, the PVC (and all indexed data), the `MEILI_MASTER_KEY` secret,
and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions a StatefulSet + PVC, the master-key secret, and builds the image (no DB) |
| 2 — Access & verify | Manual | Pod Running, PVC bound; `/health` returns available; master key lists indexes |
| 3 — Index & search | Manual | Create an index, add documents, run a typo-tolerant + filtered search; survives a pod delete |
| 4 — Operate | Manual | Inspect pods/PVC, right-size vertically, mint scoped keys, update version, manage backups |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose master-key, auth, scheduling, PVC, build, and IAM issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources including the PVC and indexed data |
