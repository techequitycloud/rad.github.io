---
title: "ClickHouse on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy ClickHouse on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# ClickHouse on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/ClickHouse_GKE)**

## Overview

**Estimated time:** 30–60 minutes

ClickHouse is an open-source (Apache-2.0) column-oriented OLAP database for real-time
analytics. This module deploys it as a **single-node StatefulSet on GKE Autopilot** —
it is the mandatory event store for the Plausible Analytics module (`Plausible_GKE`):
Plausible's PostgreSQL holds only accounts and configuration, while every analytics
event lives in this ClickHouse instance.

This lab takes you through deploying the module, connecting and querying it with
`clickhouse-client` and `curl` using the Secret Manager password, the day-2 operations
that matter for a stateful database (logs, restart, persistence verification, version
pinning), and teardown. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/ClickHouse_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Retrieve the auto-generated ClickHouse password from Secret Manager and query the
  server over HTTP (`curl`) and with the native `clickhouse-client`.
- Perform day-2 operations — read logs, restart the pod, prove PVC persistence, and
  understand the version pin.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **ClickHouse (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. The defaults are production-sensible: a StatefulSet with a 30 GiB PVC at
   `/var/lib/clickhouse` (`stateful_pvc_enabled = true` by default — no need to set it),
   a pinned `24.12-alpine` image (`"latest"` is rejected at plan time), a bootstrapped
   `plausible_events_db` database and `plausible` user, and single-node mode
   (`max_instance_count = 1`, enforced at plan time). On projects capped on external
   global static IP quota, when the only consumer is in-cluster (Plausible in the same
   cluster), set `service_type = "ClusterIP"`, `reserve_static_ip = false`, and
   `enable_custom_domain = false` so the database consumes no global static external IP.
   Review the estimated cost (if credits are enabled) and click **Deploy**, which opens
   the deployment status page with real-time logs.

2. The platform mirrors the `clickhouse/clickhouse-server` image into Artifact
   Registry, generates the ClickHouse user password into Secret Manager, and rolls out
   the StatefulSet. There is no database-init job — the image bootstraps the database
   and user itself on the first start of the empty data dir. On a fresh Autopilot
   cluster allow up to **~10 minutes** before the pod is Ready (node provisioning +
   PVC attach + image pull; the startup probe is sized for exactly this).

3. Connect to the cluster and discover the resources with name-agnostic filters:

   ```bash
   gcloud container clusters list --project "$PROJECT"
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   kubectl get statefulset,pvc,svc -A | grep clickhouse
   NS=$(kubectl get ns -o name | grep clickhouse | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

   Confirm the StatefulSet shows `1/1`, the PVC is `Bound`, and the LoadBalancer
   Service has an external IP on port **8123**.

---

## Task 2 — Connect & query [Manual]

1. Retrieve the connection pieces — the LoadBalancer IP and the auto-generated
   password from Secret Manager:

   ```bash
   CH_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')

   gcloud secrets list --project "$PROJECT" --filter="name~clickhouse-password"
   CH_SECRET=$(gcloud secrets list --project "$PROJECT" \
     --filter="name~clickhouse-password" --format="value(name)" --limit=1)
   CH_PASS=$(gcloud secrets versions access latest --secret="$CH_SECRET" --project "$PROJECT")
   echo "Endpoint: http://$CH_IP:8123"
   ```

2. Verify liveness and authentication over HTTP:

   ```bash
   curl -s "http://$CH_IP:8123/ping"            # expect: Ok.
   curl -s "http://$CH_IP:8123/ping" | wc -c    # expect: non-zero (a 200 with an empty body is a failure)
   echo "SELECT version()" | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   echo "SHOW DATABASES" | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   ```

   Check the response **body**, not just the status code — `/ping` must return the
   literal `Ok.`, and the `wc -c` count must be non-zero (a 200 with `content-length: 0`
   is a real failure mode). `SHOW DATABASES` must list `plausible_events_db` — the database the image
   bootstrapped on first start. A wrong password returns an authentication error
   (code 516): the endpoint is never open, because the module always generates and
   injects `CLICKHOUSE_PASSWORD`.

3. Query with the native client (bundled in the image — no local install needed):

   ```bash
   POD=$(kubectl get pods -n "$NS" -o name | grep clickhouse | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" -it "$POD" -- \
     clickhouse-client --user plausible --password "$CH_PASS" \
     --query "SELECT currentUser(), version()"
   ```

4. Create a table and insert a row — this doubles as the persistence marker for
   Task 3 (the bootstrapped user can manage databases and tables because the module
   sets `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`):

   ```bash
   cat <<'SQL' | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   CREATE TABLE IF NOT EXISTS plausible_events_db.lab_check
     (id UInt32, note String, ts DateTime DEFAULT now())
     ENGINE = MergeTree ORDER BY id
   SQL

   echo "INSERT INTO plausible_events_db.lab_check (id, note) VALUES (1, 'survives-restart')" \
     | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-

   echo "SELECT * FROM plausible_events_db.lab_check" \
     | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Logs** — the ClickHouse server log flows to stdout and Cloud Logging:

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NS"'"' \
     --project "$PROJECT" --limit 20
   ```

2. **Restart & PVC persistence check** — delete the pod; the StatefulSet recreates it
   against the **same** PVC, so the row from Task 2 must survive:

   ```bash
   kubectl delete pod -n "$NS" "$POD"
   kubectl get pods -n "$NS" -w        # wait for 1/1 Running (Ctrl-C to stop)

   echo "SELECT * FROM plausible_events_db.lab_check" \
     | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   # expect: 1  survives-restart  <timestamp>
   ```

   This is the property the whole module exists for: analytics events survive
   restarts, updates, and node evictions. Losing the PVC — not the pod — is what loses
   data. Also check disk headroom while you are here (background merges temporarily
   need extra space):

   ```bash
   kubectl exec -n "$NS" "$POD" -- df -h /var/lib/clickhouse
   ```

3. **Version pin** — check what is actually running versus what was configured:

   ```bash
   echo "SELECT version()" | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].spec.template.spec.containers[0].image}'; echo
   ```

   The image tag matches `application_version`, which defaults to the Plausible-pinned
   known-good tag `24.12-alpine` — and `"latest"` is rejected at plan time, because
   Plausible CE version-pins ClickHouse and untested versions have broken it upstream
   (plausible/analytics#3855). To change versions, set an explicit tag in the RAD
   platform and click **Update** — and treat it as a change to validate against your
   Plausible release, not a routine bump. Do not `kubectl edit` the image; the module
   owns the workload spec and would revert it on the next apply.

4. **Hand-off to Plausible** — the deployment outputs are exactly what
   `Plausible_GKE` consumes: `clickhouse_internal_endpoint` (preferred, same cluster)
   or `clickhouse_endpoint` as `clickhouse_url`, and `clickhouse_password_secret_id`
   as `clickhouse_password_secret`. Deploy ClickHouse first, Plausible second —
   Plausible's migrations create the events schema in `plausible_events_db`.

5. **Optional cleanup of the lab table:**

   ```bash
   echo "DROP TABLE plausible_events_db.lab_check" \
     | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
   ```

---

## Task 4 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources. Teardown removes everything the module
created — the StatefulSet, namespace, **the PVC and all event data**, the Secret
Manager password secret, and the mirrored Artifact Registry images. If a Plausible
deployment is consuming this instance, destroy or repoint Plausible first — its event
history lives here. Resources owned by **Services_GCP** (the VPC, GKE cluster,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Single-node ClickHouse StatefulSet with a 30 GiB PVC, LoadBalancer on 8123, and a Secret Manager-managed password |
| 2 — Connect & query | Manual | Ping, authenticate, and query via `curl` and `clickhouse-client` using the Secret Manager password; create a marker row |
| 3 — Operate | Manual | Read logs, restart the pod, prove the marker row survives (PVC persistence), verify the 24.12-alpine version pin |
| 4 — Tear down | Automated | Delete (Trash) removes all module resources including the PVC and its data |
