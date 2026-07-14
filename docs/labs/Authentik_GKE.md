---
title: "Authentik on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Authentik on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Authentik on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Authentik_GKE)**

## Overview

**Estimated time:** 60–90 minutes

authentik is an open-source identity provider — single sign-on via OIDC and SAML,
LDAP, SCIM, MFA, and proxy authentication; a self-hosted alternative to Okta,
Auth0, and Keycloak. This lab takes you through the full operational lifecycle of
the **Authentik on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on authentik product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Authentik_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, verify the workload, and log in as the bootstrapped
  `akadmin`.
- Create a first OIDC application and provider in the authentik UI.
- Perform day-2 operations — inspect pods, update the version, watch the
  co-located worker, and open a database session.
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
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Authentik (GKE)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Authentik_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Kubernetes namespace and Deployment, a Cloud SQL
   (PostgreSQL 15) database with its Secret Manager secrets
   (`AUTHENTIK_SECRET_KEY`, the `akadmin` bootstrap password, and the database
   password), a Cloud Storage media bucket mounted at `/media` via GCS Fuse,
   builds the thin custom image (`FROM ghcr.io/goauthentik/server`), and runs a
   one-shot database-initialisation Job. No Redis is provisioned — authentik
   ≥ 2025.10 keeps cache, sessions, and its task queue in PostgreSQL. First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates);
   authentik then runs its full migration suite on first boot, so allow a few
   extra minutes before the pod turns Ready.

3. When it completes, connect to the cluster and discover the resources with
   name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" \
     --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" \
     --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep authentik | cut -d/ -f2)
   kubectl get pods,svc -n "$NAMESPACE"

   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   SERVICE_URL="https://${SERVICE_IP}.nip.io"
   echo "Namespace: $NAMESPACE"
   echo "URL:       $SERVICE_URL"
   ```

   (The deployment outputs also report `namespace`, `service_external_ip`, and
   `service_url` directly.)

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is healthy. authentik exposes an **unauthenticated**
   readiness endpoint that returns 200 only once migrations have completed and the
   database is reachable:

   ```bash
   curl -sk "$SERVICE_URL/-/health/ready/" -o /dev/null -w '%{http_code}\n'   # expect 200
   curl -sk "$SERVICE_URL/-/health/live/"  -o /dev/null -w '%{http_code}\n'   # expect 200
   ```

   A 200 status alone is not proof the *server* answered — also confirm the
   response body is non-empty (a 200 with a zero-byte body means the wrong
   process answered `:9000`; see Task 5):

   ```bash
   curl -sk "$SERVICE_URL/" | wc -c   # expect non-zero — the login page HTML
   ```

2. Retrieve the bootstrapped admin credential from Secret Manager. The module
   creates the built-in **`akadmin`** user on first boot with the configured
   `bootstrap_email` (default `admin@techequity.cloud`) and this password:

   ```bash
   BP_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~authentik AND name~bootstrap-password" \
     --format="value(name.basename())" --limit=1)
   gcloud secrets versions access latest --secret="$BP_SECRET" --project="$PROJECT"; echo
   ```

3. Open `$SERVICE_URL` in a browser and sign in with username **`akadmin`** and
   the password from step 2. (If the bootstrap variables were absent on the very
   first boot, authentik instead offers the initial-setup flow at
   `$SERVICE_URL/if/flow/initial-setup/` — set the admin password there.)

4. **Create a first OIDC application and provider** in the UI:
   1. Open the **Admin interface** (top-right avatar → *Admin interface*, or
      `$SERVICE_URL/if/admin/`).
   2. Go to **Applications → Applications** and click **Create with Provider**
      (the wizard creates the application and its provider together).
   3. Name it (e.g. `demo-app`), choose **OAuth2/OIDC Provider**, accept the
      default authorization flow, and set the client's **Redirect URI** to your
      test application's callback URL.
   4. Finish the wizard, then open the provider to copy the **Client ID**,
      **Client Secret**, and the OIDC endpoints (also discoverable at
      `$SERVICE_URL/application/o/<slug>/.well-known/openid-configuration`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,pods,svc,hpa -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE" | head -40
   ```

2. **Update the application version** by changing the `application_version` input
   in the RAD platform and applying it via **Update**; a new image builds and the
   Deployment rolls out. authentik migrates its own schema on startup — guarded by
   a PostgreSQL advisory lock so concurrent pods don't collide — and the startup
   probe holds the rollout until migrations finish. Note that
   `application_version = "latest"` is pinned to a known-good release at build
   time (authentik publishes no `latest` tag).

3. **Inspect the co-located worker.** `ak worker` runs in the same container as
   the server (started in the background by the cloud entrypoint), so its output
   is interleaved in the pod logs:

   ```bash
   POD=$(kubectl get pods -n "$NAMESPACE" -l app -o name | grep authentik | head -1)
   kubectl logs -n "$NAMESPACE" "$POD" --tail=200 | grep -iE 'worker|task'
   ```

   You should see worker startup and periodic task execution lines. Keep
   `min_instance_count ≥ 1` so the worker is always processing.

4. **Manage secrets** (never rotate the secret key — it invalidates all sessions
   and breaks encrypted fields):

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~authentik"
   ```

5. **Open a database session** for inspection or maintenance. The database and
   user names are tenant-prefixed — take them from the deployment outputs
   (`database_name`, `database_user`):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=<database_user> --database=<database_name> --project="$PROJECT"
   # e.g. inspect authentik's tables:  \dt authentik_*
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

   Server and worker lines share the same stream; authentik logs structured JSON
   with an `event` field.

2. **Monitoring** — open Kubernetes Engine → Workloads → the authentik workload
   for CPU/memory utilisation and restart counts, and the Cloud SQL instance
   dashboard for connections and query load. Review Alerting → Policies, and if
   you enabled the uptime check, confirm it is green under Monitoring → Uptime
   checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with authentik releases.

- **Pod stays unready on first boot — usually just migrations.** The first boot
  runs authentik's full Django migration suite; `/-/health/ready/` returns 503
  until it finishes. The startup probe budget is ~11 minutes (60 s delay +
  40 × 15 s). Watch progress rather than assuming failure:
  ```bash
  kubectl get pods -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" "$POD" --tail=100
  # look for "Applying migration ..." lines, then the server/worker start banner
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and the `db-init` Job completed. The entrypoint
  logs the resolved connection settings at startup
  (`AUTHENTIK_POSTGRESQL__HOST/NAME/USER/SSLMODE`):
  ```bash
  gcloud sql instances list --project="$PROJECT"
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  ```
- **Blank page but the health endpoints return 200 — check which process owns
  `:9000`.** The co-located `ak worker` also starts an HTTP listener; if it binds
  `0.0.0.0:9000` before the server, it answers **every** route — health endpoints
  included — with *empty* 200s (blank UI, phantom-healthy probes). The entrypoint
  now pins the worker to loopback ports (`127.0.0.1:9001`/`9444`/`9301`) so the
  server owns `:9000`. Verify with a body check:
  ```bash
  curl -sk "$SERVICE_URL/" | wc -c   # non-zero = server answered; 0 = the worker won the bind
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
  A `MANIFEST_UNKNOWN` / 404 pulling `ghcr.io/goauthentik/server:<tag>` means the
  requested `application_version` tag does not exist upstream — use a real
  release tag (or `latest`, which the module pins to a known-good release).
- **Pod events and scheduling issues:**
  ```bash
  kubectl describe pod -n "$NAMESPACE" "$POD" | tail -30
  kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp | tail -20
  ```
- **403 / permission errors:** verify the workload service account's IAM roles
  and Workload Identity binding.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`AUTHENTIK_SECRET_KEY`, and the SecretSync rule that synced-secret keys must not
contain `__`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes namespace
and workload, Cloud SQL database, Secret Manager secrets, the media bucket, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL 15), secrets, the GCS media bucket, builds the image, and runs DB init |
| 2 — Access & verify | Manual | `/-/health/ready/` returns 200 and the UI body is non-empty; log in as `akadmin` with the bootstrap password; create a first OIDC application + provider |
| 3 — Operate | Manual | Inspect pods, update version (self-migrating), watch the co-located worker, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review workload and Cloud SQL metrics |
| 5 — Troubleshoot | Manual | Diagnose first-boot migration waits, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
