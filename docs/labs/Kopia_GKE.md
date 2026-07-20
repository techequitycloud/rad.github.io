---
title: "Kopia on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Kopia on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Kopia on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kopia_GKE)**

## Overview

**Estimated time:** 45–75 minutes

Kopia is a fast, secure, open-source backup tool with client-side encryption,
compression, and deduplication. This module runs Kopia in **repository-server
mode**: a single always-addressable server that remote `kopia` CLI clients
elsewhere connect to and push/pull snapshots into, backed natively by a Cloud
Storage bucket. This lab takes you through the full operational lifecycle of the
**Kopia on GKE Autopilot** module: deploy it, connect a remote client and run a
real snapshot round-trip, operate it day-to-day (including adding additional
named clients), observe it, diagnose common problems, and tear it down.

**There is no Cloud Run variant of this module and there never will be.** Kopia's
client-server snapshot protocol is exclusively gRPC, which only ever gets real
HTTP/2 through Kopia's own TLS+ALPN — Cloud Run's edge always terminates public
HTTPS itself and cannot pass a container-terminated TLS stream through. GKE's plain
L4 LoadBalancer has no such restriction, which is why this module is GKE-only.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Kopia's own CLI beyond what's needed to prove the deployment works. For the
complete list of provisioned services and every configuration input (organised by
group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kopia_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Retrieve both generated secrets and the TLS certificate fingerprint, and connect a
  real remote `kopia` CLI client through a full snapshot create/list round-trip.
- Perform day-2 operations — add additional named clients, inspect the workload,
  and run repository maintenance.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and connection issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **`kopia` CLI installed locally** (or on whatever machine will act as the remote
  backup client) — see [kopia.io/docs/installation](https://kopia.io/docs/installation/).
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Kopia (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. The defaults are production-sane — external `LoadBalancer`
   reachability, scale-to-zero, single-server scaling — so most deployments need no
   changes beyond `project_id`/`tenant_deployment_id`. Configure anything else you
   need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Kopia_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform builds a custom container image (the official `kopia/kopia` image
   plus a cloud entrypoint), generates two independent secrets
   (`ADMIN_PASSWORD`, `REPO_PASSWORD`) in Secret Manager, provisions the `storage`
   Cloud Storage bucket, and deploys the workload to the GKE Autopilot cluster.
   There is **no Cloud SQL instance** — Kopia's repository lives natively in Cloud
   Storage. First-deploy time is typically **10–15 minutes**, dominated by the
   image build.

3. Connect to the cluster and discover the namespace with a name-agnostic filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep kopia | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify with a real client [Manual]

1. Confirm the pod is running and check its first-boot logs for the TLS
   fingerprint (printed **once**, at certificate-generation time):

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pods -n "$NS"
   kubectl logs -n "$NS" "$POD" | grep -B2 -A2 -i fingerprint
   ```

   If the pod has been running a while and the fingerprint has scrolled out of the
   log buffer, recompute it directly — GKE gives real shell access, unlike Cloud
   Run:

   ```bash
   kubectl exec -n "$NS" "$POD" -- \
     openssl x509 -in /var/lib/kopia/tls/cert.pem -noout -fingerprint -sha256
   ```

2. Find the external IP and the **actual** external port. `Kopia_GKE` does not
   expose `App_GKE`'s `service_port` input, so the Service listens externally on
   the `App_GKE` default (`80`) and forwards to Kopia's real port (`51515`) as a
   bare TCP passthrough — always confirm the mapping rather than assuming a port:

   ```bash
   kubectl get svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   SERVICE_PORT=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].spec.ports[0].port}')
   echo "External IP: $EXTERNAL_IP   Service port: $SERVICE_PORT"
   ```

3. Retrieve both generated secrets:

   ```bash
   PREFIX=$(kubectl get ns "$NS" -o jsonpath='{.metadata.labels.tenant}' 2>/dev/null || true)
   gcloud secrets list --project="$PROJECT" --filter="name~admin-password OR name~repo-password"

   ADMIN_PASSWORD=$(gcloud secrets versions access latest --project="$PROJECT" \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" --format='value(name)')")
   REPO_PASSWORD=$(gcloud secrets versions access latest --project="$PROJECT" \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~repo-password" --format='value(name)')")
   ```

4. Connect a real `kopia` CLI client. **The password here is `REPO_PASSWORD`, not
   `ADMIN_PASSWORD`** — `kopia repository connect server` has no separate
   server-user-password flag; its one password input is the gRPC session
   credential, checked against the repository-stored user provisioned by the
   entrypoint (`admin@kopia`), which was itself given `REPO_PASSWORD`. Using
   `ADMIN_PASSWORD` here fails with `PermissionDenied: access denied` — confirmed
   live.

   ```bash
   FINGERPRINT="<sha256-fingerprint-from-step-1>"

   kopia repository connect server \
     --url="https://${EXTERNAL_IP}:${SERVICE_PORT}" \
     --server-cert-fingerprint="$FINGERPRINT" \
     --password="$REPO_PASSWORD" \
     --override-username=admin --override-hostname=kopia
   ```

5. Run a real snapshot round-trip to prove the gRPC session actually works end to
   end (not just the control-plane REST API):

   ```bash
   mkdir -p /tmp/kopia-lab-test && echo "hello from the Kopia GKE lab" > /tmp/kopia-lab-test/hello.txt

   kopia snapshot create /tmp/kopia-lab-test
   kopia snapshot list
   ```

   A successful `snapshot create`/`snapshot list` confirms the deployment is fully
   functional — this is the same round-trip that was live-verified during
   development.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Add an additional named client.** Each backup source should connect under its
   own identity rather than sharing `admin@kopia`. From a pod shell (or any machine
   with `kopia` CLI and direct repository access), provision a new repository user
   and grant it access:

   ```bash
   kubectl exec -it -n "$NS" "$POD" -- sh -c '
     kopia server users add "backup-host-1@kopia" --user-password="<a-strong-password-you-choose>"
   '
   ```

   ACLs are already enabled (the entrypoint runs `kopia server acl enable` on every
   boot) — Kopia's default policy grants any authenticated `user@host` full
   read/write on its own hostname's snapshots, so the new user needs no separate
   grant. The new client then connects with its own credential:

   ```bash
   kopia repository connect server \
     --url="https://${EXTERNAL_IP}:${SERVICE_PORT}" \
     --server-cert-fingerprint="$FINGERPRINT" \
     --password="<the-password-you-set-for-backup-host-1>" \
     --override-username=backup-host-1 --override-hostname=kopia
   ```

   List provisioned users at any time:

   ```bash
   kubectl exec -n "$NS" "$POD" -- kopia server users list
   ```

2. **Inspect the workload:**

   ```bash
   kubectl get deployment,pods,svc -n "$NS"
   kubectl describe deployment -n "$NS"
   ```

3. **Repository maintenance.** Kopia's own garbage collection/compaction assumes a
   single server owns the repository — run it from inside the pod (or schedule it
   via `cron_jobs`):

   ```bash
   kubectl exec -n "$NS" "$POD" -- kopia maintenance run
   kubectl exec -n "$NS" "$POD" -- kopia maintenance info
   ```

4. **Update the application version** by changing `application_version` in the RAD
   platform and applying it via **Update**. A new image builds, the pod is
   recreated, and the entrypoint's connect-or-create / user / ACL logic runs again
   — the persisted TLS certificate and repository are untouched, so existing
   clients keep working with no fingerprint change.

5. **Do not scale beyond one instance.** `max_instance_count` should stay `1` —
   Kopia's own repository maintenance assumes single-server ownership; a second
   concurrent server would race GC/compaction against the same repository.
   Scale-to-zero (`min_instance_count = 0`) is safe and is the module default — a
   cold start just reconnects to the existing repository.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — the Kopia server logs to stdout, including the one-time TLS
   fingerprint and the entrypoint's connect-or-create / user-provisioning output:

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation (snapshot uploads are CPU-bound — compression, encryption,
   hashing) and restart counts. `uptime_check_config` is **disabled by default** —
   if you enable it, be aware it issues an HTTP check against a path, and every
   Kopia endpoint requires authentication, so it will fail continuously; leave it
   disabled or point external monitoring at a raw TCP check instead.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Kopia releases.

- **Pod not Ready / CrashLoopBackOff:**
  ```bash
  kubectl describe pod -n "$NS" "$POD"    # Events: scheduling / probe / mount errors
  kubectl logs -n "$NS" "$POD" --previous # logs from the crashed container
  ```
  Startup/liveness probes are **TCP**, not HTTP — Kopia has no unauthenticated HTTP
  endpoint, so an HTTP probe would always fail even on a healthy server. If probes
  are failing, check that the repository connect-or-create step actually completed
  (grep the logs for `Connected to existing repository` / `Creating a new
  repository`) rather than assuming an HTTP health issue.
- **`PermissionDenied: access denied` on `kopia snapshot create`/`list`:** you
  almost certainly connected with `--password=<ADMIN_PASSWORD>` instead of
  `<REPO_PASSWORD>`. Disconnect (`kopia repository disconnect`) and reconnect with
  the repository password — see Task 2 step 4.
- **Client connection refused / times out:** confirm the URL's port matches the
  Service's actual external port (`kubectl get svc -n "$NS"`) — it defaults to
  `80`, not Kopia's internal `51515`, and this module does not expose a way to
  change it. A bare `https://<ip>` with no port implies 443, which is not open.
- **Certificate fingerprint mismatch on an existing client:** the TLS certificate
  should never change across restarts (it's persisted and reused). A mismatch means
  either the persisted certificate files were deleted out-of-band (check the
  `storage` bucket's `tls/` prefix) or you're pointing at a different deployment.
  Recompute the current fingerprint with the `openssl x509` command from Task 2
  step 1 and re-pin every affected client.
- **Repository connect fails on first boot ("repository probably doesn't exist
  yet"):** expected and self-healing — the entrypoint's fallback creates it
  automatically. Check the pod logs for the subsequent `create gcs` step actually
  succeeding (IAM: confirm the workload service account has write access to the
  `storage` bucket).
- **Image pull errors:** confirm the image exists in Artifact Registry
  (`enable_image_mirroring = true` mirrors `kopia/kopia` there to avoid Docker Hub
  rate limits) and the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the `REPO_PASSWORD` vs `ADMIN_PASSWORD` distinction, TCP probes,
and the `service_port` default).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Kubernetes workload and
namespace, the Cloud Storage bucket (**including every snapshot ever written — this
is your actual backup data**), both Secret Manager secrets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, GKE cluster, registry) are
managed separately and are not removed here.

> **Before tearing down a deployment holding real backup data**, export or verify
> you have an independent copy — deleting the `storage` bucket deletes the
> repository permanently, with no separate "soft delete" for the backup content
> itself.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image, generates two secrets, provisions the `storage` bucket, and deploys to GKE |
| 2 — Access & verify | Manual | Retrieve the TLS fingerprint and secrets; connect a real `kopia` CLI client and complete a snapshot create/list round-trip |
| 3 — Operate | Manual | Add additional named clients, inspect the workload, run repository maintenance, update the version |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose pod, authentication, connection-port, and repository-bootstrap issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the backup repository itself |
