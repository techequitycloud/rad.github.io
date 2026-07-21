---
title: "Headscale on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Headscale on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Headscale on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Headscale_CloudRun)**

## Overview

**Estimated time:** 30–45 minutes

Headscale is an open-source, self-hosted implementation of the Tailscale
coordination server — the control plane for a private WireGuard mesh VPN,
compatible with the official Tailscale clients. This lab takes you through
the full operational lifecycle of the **Headscale on Cloud Run** module on
Google Cloud: deploy it, access and verify it, register your first client,
run it day-to-day, observe it, diagnose common problems, and tear it down.
Unlike most modules in this catalog, there is **no external database setup**
to wait on — Headscale is entirely self-contained around an embedded SQLite
file, so first deploys are comparatively quick.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Tailscale/WireGuard networking concepts. For the complete
list of provisioned services and every configuration input (organised by
group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Headscale_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including its real `/health` endpoint.
- Create the first Headscale user and a pre-auth key, and register a real Tailscale client against the server.
- Perform day-2 operations — inspect revisions, understand why horizontal scaling doesn't apply, and update the version.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including the SQLite/gcsfuse trade-off specific to this platform.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact
  Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and
  `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- *(Optional, for Task 2)* the [Tailscale client](https://tailscale.com/download)
  installed on a device you can use to test a real registration.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Headscale (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Headscale_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform builds the custom Headscale image (a `ko`-built upstream base
   with a baked config layered in), provisions the Cloud Run service and its
   `storage` GCS bucket (mounted at `/var/lib/headscale` for the SQLite
   file), and starts the service. There is **no Cloud SQL instance and no
   database-initialization job** to wait on — SQLite creates itself on first
   boot — so first deploys typically complete in roughly **5–10 minutes**,
   dominated by the image build.

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~headscale" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Headscale exposes a real, unauthenticated
   health endpoint:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Check the boot logs for the confirmation sequence a healthy first boot
   produces — private-key generation, a successful database open, and the
   server announcing it is listening:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   # Look for lines resembling:
   #   ...generating new private key...
   #   ...database opened successfully...
   #   ...listening and serving HTTP...
   ```

3. **Create the first user and a pre-auth key.** Headscale has no web-based
   signup flow — the CLI is the only way to create a user and register
   clients. Run a one-off execution of the same binary the service uses
   (adjust to how the platform names its job/execute resource for this
   deployment — check `gcloud run jobs list` if the exact job name below
   doesn't match):

   ```bash
   JOB=$(gcloud run jobs list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~headscale" --format="value(metadata.name)" --limit=1)

   gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" \
     --command="/ko-app/headscale" --args="users,create,myuser" --wait

   gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" \
     --command="/ko-app/headscale" --args="preauthkeys,create,--user,myuser,--reusable,--expiration,1h" --wait
   ```

   Read the pre-auth key from the job execution's logs.

4. **Register a real Tailscale client** (optional, requires the Tailscale
   client installed):

   ```bash
   tailscale up --login-server="$SERVICE_URL" --authkey=<preauthkey-from-step-3>
   ```

   The device should connect and appear in Headscale's node registry.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scaling does not apply the way it does for other modules.**
   `max_instance_count` is hard-pinned to `1` inside `Headscale_Common` —
   changing the `max_instance_count` input in the RAD platform has **no
   effect**; Headscale has no active-active support and two writers against
   the same SQLite file would corrupt it. `min_instance_count = 0` (the
   default) enables scale-to-zero with fast cold starts, since there's no
   database or index to warm.

3. **Update the application version** by changing the `application_version`
   input in the RAD platform and applying via **Update**; a new image builds
   from the pinned upstream `headscale/headscale:<version>-debug` base and a
   new revision rolls out.

4. **List registered nodes:**

   ```bash
   gcloud run jobs execute "$JOB" --project="$PROJECT" --region="$REGION" \
     --command="/ko-app/headscale" --args="nodes,list" --wait
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   **Watch specifically for gcsfuse write errors** (`BufferedWriteHandler.OutOfOrderError`)
   referencing `db.sqlite`/`db.sqlite-wal`/`db.sqlite-shm` — see Task 5 for
   what these mean and why they're an accepted, documented risk on this
   platform.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count (should read 0 or 1 only —
   scaling above 1 never happens on this module), and CPU/memory
   utilisation. The module can provision an **uptime check** on `/health`
   (when `uptime_check_config.enabled = true` — it defaults to `false`); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with Headscale releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors — most commonly a config validation
  failure. Headscale 0.26.1 fails hard on a missing `noise.private_key_path`
  or an incomplete `dns:` block; both are already handled correctly in the
  shipped `config.yaml`, so seeing either error suggests the image was built
  from a modified config.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **SQLite/storage errors — a known, accepted platform trade-off, not
  necessarily a bug.** Repeated `BufferedWriteHandler.OutOfOrderError` log
  entries referencing `db.sqlite`/`db.sqlite-wal`/`db.sqlite-shm` mean
  gcsfuse's write semantics are colliding with SQLite's WAL-mode file
  locking requirements. This is documented and expected on Cloud Run — see
  the Configuration Guide's Pitfalls section. It is only safe because
  `max_instance_count` is hard-pinned to `1`. If you need stronger data
  integrity guarantees than gcsfuse can provide, deploy
  [Headscale_GKE](https://docs.radmodules.dev/docs/modules/Headscale_GKE)
  instead — it uses a real block-storage PVC by default.
- **Tailscale client can't register / `tailscale up` fails:** confirm
  `ingress_settings = "all"` (public ingress is required for real client
  devices to reach the server) and `enable_iap = false` (IAP requires a
  Google identity, which the `tailscale` CLI cannot present). Confirm the
  `--login-server` value matches `server_url`/the deployed service URL
  exactly.
- **Image build failed:** review Cloud Build history for the failed build's
  log — most commonly a transient upstream pull issue from Docker Hub
  (mitigated by `enable_image_mirroring = true`, the default).
- **403 / permission errors:** verify the runtime service account's IAM
  roles.

See the Configuration Guide's *Pitfalls* section for setting-specific
gotchas, including the critical rule that `server_url` should not change
after clients have registered.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, the `storage` GCS bucket (and with it, the entire node
registry and Noise private key — every previously-registered client would
need to re-register against a fresh deployment), and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom image and provisions the Cloud Run service and `storage` bucket; no Cloud SQL, no init job |
| 2 — Access & verify | Manual | `/health` returns 200; create the first user + pre-auth key; register a real Tailscale client |
| 3 — Operate | Manual | Inspect revisions; understand why `max_instance_count` has no effect; update version; list nodes |
| 4 — Observe | Manual | Query Cloud Logging (watch for gcsfuse write errors); review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose config validation, SQLite/gcsfuse, client-registration, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the node registry |
