---
title: "Plausible Analytics on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Plausible Analytics on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Plausible Analytics on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Plausible_GKE)**

## Overview

**Estimated time:** 60–120 minutes

Plausible Analytics Community Edition is a privacy-first, cookie-free, open-source
web analytics platform — the leading self-hosted alternative to Google Analytics.
This lab takes you through the full operational lifecycle of the **Plausible on GKE
Autopilot** module on Google Cloud, including its **mandatory dependency**: the
**ClickHouse_GKE** module, which provides the event store where every pageview and
custom event is written (Cloud SQL PostgreSQL holds only accounts and site
configuration). You will deploy ClickHouse, wire its outputs into Plausible, deploy
Plausible, verify it end to end, operate it, and tear both down in the correct order.

The lab focuses on operating the **GKE modules and the Google Cloud platform**, not
on Plausible product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Plausible_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy ClickHouse_GKE and verify it is healthy before anything depends on it.
- Capture ClickHouse's outputs and wire them into Plausible's configuration.
- Deploy the Plausible_GKE module and verify the two-datastore architecture.
- Register the first account, add a site, and retrieve the tracking snippet.
- Perform day-2 operations — close registration, inspect logs and secrets.
- Tear both deployments down cleanly, in the correct order.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts both modules
  depend on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI**, **kubectl**, and **OpenTofu** installed.
- **Project Owner** (or equivalent) IAM on the project.

## Task 1 — Prerequisites & authentication [Manual]

1. Authenticate and set the shell variables every task below reuses:

   ```bash
   gcloud auth login
   gcloud auth application-default login

   export PROJECT="<your-gcp-project-id>"
   export REGION="us-central1"           # the region you deploy into
   gcloud config set project "$PROJECT"
   ```

2. Confirm the shared platform is in place — a Services_GCP-managed VPC and GKE
   Autopilot cluster must exist before either module deploys:

   ```bash
   gcloud compute networks list --project="$PROJECT"
   gcloud container clusters list --project="$PROJECT"
   ```

3. Get cluster credentials — both modules deploy into the same cluster:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
   kubectl get nodes
   ```

---

## Task 2 — Deploy ClickHouse_GKE and wait for it to be healthy [Automated]

Plausible **cannot start without ClickHouse** — a plan-time validation in
Plausible_GKE blocks the apply when `clickhouse_url` is empty. Deploy ClickHouse
first and do not proceed until it is serving.

1. Deploy the **ClickHouse (GKE)** module — from the RAD platform (click **Deploy**,
   open **ClickHouse (GKE)**, set `project_id`, click **Deploy**), or directly:

   ```bash
   cd modules/ClickHouse_GKE
   tofu init
   tofu plan -var="project_id=$PROJECT" -out=plan.tfplan
   tofu apply plan.tfplan
   ```

   Keep the pinned `application_version` (`latest` maps to the known-good
   `24.12-alpine`) — Plausible version-pins ClickHouse because untested versions
   have broken it upstream (plausible/analytics#3855).

2. **Wait for the ClickHouse workload to be fully rolled out.** ClickHouse runs as
   a StatefulSet with a persistent volume; first-boot volume provisioning can take
   a few minutes:

   ```bash
   kubectl get pods -A | grep clickhouse
   CH_NS=$(kubectl get ns -o name | grep clickhouse | head -1 | cut -d/ -f2)
   kubectl rollout status statefulset -n "$CH_NS" --timeout=600s
   ```

3. **Prove ClickHouse is serving** with its `/ping` endpoint (expect `Ok.`):

   ```bash
   CH_SVC=$(kubectl get svc -n "$CH_NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl run ch-ping --rm -it --restart=Never --image=curlimages/curl -- \
     curl -s "http://${CH_SVC}.${CH_NS}.svc.cluster.local:8123/ping"
   ```

Do not start Task 3 until the rollout is complete and `/ping` answers — deploying
Plausible against a ClickHouse that is still provisioning wastes a deploy cycle on
crash-looping migrate attempts.

---

## Task 3 — Capture ClickHouse outputs and wire them into Plausible [Manual]

Plausible consumes four ClickHouse_GKE outputs. Capture them:

```bash
cd modules/ClickHouse_GKE
tofu output clickhouse_internal_endpoint     # -> clickhouse_url (same cluster, preferred)
tofu output clickhouse_endpoint              # -> clickhouse_url (external LB, if cross-cluster)
tofu output clickhouse_database              # -> clickhouse_db
tofu output clickhouse_username              # -> clickhouse_user
tofu output clickhouse_password_secret_id    # -> clickhouse_password_secret
```

Paste them into Plausible's deploy tfvars (`modules/Plausible_GKE/config/deploy.tfvars`
or your platform inputs):

```hcl
project_id                 = "<your-gcp-project-id>"
tenant_deployment_id       = "demo"

# From the ClickHouse_GKE outputs above:
clickhouse_url             = "http://<clickhouse-svc>.<namespace>.svc.cluster.local:8123"
clickhouse_db              = "plausible_events_db"
clickhouse_user            = "plausible"
clickhouse_password_secret = "<clickhouse_password_secret_id output>"
```

Notes on the wiring:

- Prefer `clickhouse_internal_endpoint` — both workloads run in the same cluster, so
  in-cluster Kubernetes DNS avoids the external LoadBalancer hop.
- `clickhouse_url` must be a bare `http(s)://host[:port]` base endpoint — no
  credentials, no database path (a format validation on the variable enforces this).
- The password never appears in tfvars: `clickhouse_password_secret` is a Secret
  Manager secret ID **owned by ClickHouse_GKE**. The foundation grants Plausible's
  workload service account `secretAccessor` on it and injects it as
  `CLICKHOUSE_PASSWORD`; Plausible's entrypoint embeds it (URL-encoded) into
  `CLICKHOUSE_DATABASE_URL` at runtime.

---

## Task 4 — Deploy the Plausible_GKE module [Automated]

1. Deploy — from the RAD platform (open **Plausible (GKE)**, paste the four
   ClickHouse values, click **Deploy**), or directly:

   ```bash
   cd modules/Plausible_GKE
   tofu init
   tofu plan -var-file=config/deploy.tfvars -out=plan.tfplan
   tofu apply plan.tfplan
   ```

   If `clickhouse_url` is empty the plan **fails immediately** with a clear error
   naming the fix — that is the validation guard doing its job; go back to Task 3.

2. The deployment provisions the GKE workload, a Cloud SQL PostgreSQL 15 database
   with its Secret Manager secrets (`SECRET_KEY_BASE`, `TOTP_VAULT_KEY`, and the
   database password), builds the thin custom image (`FROM
   ghcr.io/plausible/community-edition`, pinned to `v3.2.1` when
   `application_version = "latest"`), and runs the one-shot `db-init` job. First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. Locate the workload with name-agnostic filters:

   ```bash
   NS=$(kubectl get ns -o name | grep plausible | head -1 | cut -d/ -f2)
   echo "Namespace: $NS"
   kubectl get all -n "$NS"
   ```

4. Watch the entrypoint compose the two database URLs and run migrations:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=100
   # Look for: [plausible-entrypoint] DATABASE_URL host / CLICKHOUSE host / BASE_URL,
   # then "Running db createdb + db migrate..." before the server starts.
   ```

---

## Task 5 — Verify, register the first account, add a site [Manual]

1. Find the external address and confirm health. `/api/health` is unauthenticated
   by design (which is also why it is safe as a probe path):

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"

   # Status code AND body — a 200 alone is not proof (a 200 with an empty body
   # means the wrong process answered the port):
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}:8000/api/health"   # expect: 200
   curl -s "http://${EXTERNAL_IP}:8000/api/health"    # or the service_url output
   # Expect a non-empty JSON body like:
   #   {"sessions":"ok","postgres":"ok","clickhouse":"ok",...}
   curl -s "http://${EXTERNAL_IP}:8000/api/health" | wc -c    # must be non-zero
   ```

2. Open `http://${EXTERNAL_IP}:8000/register` in a browser and create the **first
   account** — there are no seeded credentials, and registration is open by default
   (you will close it in Task 6).

3. Add a site (your domain) in the UI. Plausible shows the **tracking snippet**:

   ```html
   <script defer data-domain="yourdomain.com" src="http://<EXTERNAL_IP>:8000/js/script.js"></script>
   ```

   The snippet's `src` host comes from `BASE_URL` — if you later serve Plausible on
   a custom domain, set `base_url` and redeploy so snippets and email links use it.

4. Prove the two-datastore split: send a test pageview (visit a page carrying the
   snippet, or use the site's "verify installation" flow) and confirm it appears on
   the dashboard. The event was written to **ClickHouse**; only your account and the
   site definition live in PostgreSQL:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=postgres --project="$PROJECT"
   # \c <database_name output>; \dt   -- users/sites tables, but NO events tables
   ```

---

## Task 6 — Operate & keep it running (Day-2) [Manual]

1. **Close registration** now that the first account exists. Add to
   `environment_variables` and re-apply (or click **Update** on the platform):

   ```hcl
   environment_variables = {
     DISABLE_REGISTRATION = "true"     # or "invite_only"
   }
   ```

   Verify: `curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}:8000/register"`
   should no longer offer open sign-up.

2. **Inspect secrets.** Two Plausible-owned secrets must never be rotated —
   `SECRET_KEY_BASE` (rotating logs every user out) and `TOTP_VAULT_KEY` (rotating
   breaks all enrolled 2FA devices):

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~plausible"
   kubectl get secrets -n "$NS"
   # Confirm the cross-module grant: Plausible's SA can read the ClickHouse password
   gcloud secrets get-iam-policy "$(cd modules/ClickHouse_GKE && tofu output -raw clickhouse_password_secret_id)" \
     --project="$PROJECT"
   ```

3. **Logs and monitoring:**

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NS"'"' \
     --project="$PROJECT" --limit=20
   ```

4. **Troubleshooting quick hits:**
   - Pod crash-looping with `[plausible-entrypoint] ERROR: PLATFORM_CLICKHOUSE_URL is
     empty` — the ClickHouse wiring did not reach the pod; re-check Task 3 values.
   - Pod not Ready but the app logs show it booted — check the probe path is still
     `/api/health` (an authenticated path returns 403 and the probe never passes).
   - ClickHouse connection refused — confirm the ClickHouse StatefulSet is still
     rolled out (`kubectl get pods -A | grep clickhouse`) and `/ping` answers.
   - Version upgrade — set `application_version` to an explicit CE tag (CE publishes
     no `latest` tag; the default pins `v3.2.1`), re-apply, and migrations run on the
     next container start.

---

## Task 7 — Tear down (Plausible first, then ClickHouse) [Automated]

Order matters: destroy **Plausible first**, then ClickHouse. Destroying ClickHouse
while Plausible still runs leaves Plausible pods crash-looping against a vanished
event store and dangles the cross-module secret grant.

```bash
# 1. Destroy Plausible
cd modules/Plausible_GKE
tofu destroy -var-file=config/deploy.tfvars

# 2. Then destroy ClickHouse (this deletes the event data on its PVC)
cd ../ClickHouse_GKE
tofu destroy -var="project_id=$PROJECT"
```

On the RAD platform, delete the **Plausible** deployment (Trash icon) and wait for
it to complete, then delete the **ClickHouse** deployment. This removes everything
the modules created — the Kubernetes workloads and namespaces, the Cloud SQL
database, Secret Manager secrets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL instance, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Prerequisites & auth | Manual | gcloud/kubectl/tofu authenticated; Services_GCP platform confirmed |
| 2 — Deploy ClickHouse_GKE | Automated | Event store rolled out; `/ping` answers `Ok.` before anything depends on it |
| 3 — Capture & wire outputs | Manual | Four `tofu output` values pasted into Plausible's deploy tfvars |
| 4 — Deploy Plausible_GKE | Automated | Workload, Cloud SQL PG15, secrets, custom image, `db-init` job; entrypoint composes both DB URLs and migrates |
| 5 — Verify & first account | Manual | `/api/health` returns 200 with a non-empty JSON status body; first account registered at `/register`; site added; tracking snippet retrieved |
| 6 — Operate (Day-2) | Manual | Registration closed; secrets and cross-module grant inspected; logs reviewed |
| 7 — Tear down | Automated | Plausible destroyed first, then ClickHouse |
