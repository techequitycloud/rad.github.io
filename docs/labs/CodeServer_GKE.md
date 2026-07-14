---
title: "code-server on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy code-server on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# code-server on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/CodeServer_GKE)**

## Overview

**Estimated time:** 45–90 minutes

code-server is Coder's open-source build of Visual Studio Code that runs on a remote server and is accessed entirely through the browser — a full IDE with the extension marketplace, integrated terminal, and a persistent workspace. This lab takes you through the full operational lifecycle of the **code-server on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on code-server product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/CodeServer_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, discover the namespace, and confirm the pod is running.
- Access the editor, retrieve the generated password from Secret Manager, and verify the service.
- Perform day-2 operations — inspect the workload, choose between GCS FUSE and block-PVC workspace storage, and update the version.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including the probe-path/password interaction.
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

1. Click **Deploy** in the RAD platform top navigation, open **code-server (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/CodeServer_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds a thin wrapper image over `codercom/code-server` (mirrored
   into Artifact Registry via Cloud Build) and schedules a single pod onto the GKE
   Autopilot cluster (port 8080, 1 vCPU / 1 GiB by default). By default the workspace
   is a **GCS FUSE** volume mounted at `/home/coder`; setting `stateful_pvc_enabled =
   true` switches to a **StatefulSet with a block PVC** instead. A random editor
   `PASSWORD` is generated and stored in Secret Manager. There is **no Cloud SQL
   instance and no Redis** — code-server has no database. First deploys typically
   take **10–20 minutes** (the image build and pod scheduling dominate; there is no
   database to wait for).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep codeserver | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is Ready and check the Service type — **the module defaults to
   `ClusterIP`**, so the editor is reachable only from inside the cluster/VPC out of
   the box:

   ```bash
   kubectl get pods,svc -n "$NS"
   kubectl get svc -n "$NS" -o jsonpath='{.items[0].spec.type}'; echo
   ```

   For external browser access set `service_type = LoadBalancer` (or rely on the
   default `enable_custom_domain = true` Gateway path) via **Update** on the
   deployment details page, and **keep `enable_password = true`** whenever you do — a
   public, unauthenticated IDE includes a public terminal.

2. **Check the health-probe path against the password setting before assuming a
   restart loop is something else.** The GKE variant's startup/liveness probes
   default to `/health`, but with `enable_password = true` (the module default)
   `/health` returns **401** and the probe never passes — the pod restart-loops even
   though the app boots fine. Inspect readiness and, if you see this pattern,
   override `startup_probe`/`liveness_probe` `path` to the unauthenticated `/healthz`
   via **Update**:

   ```bash
   kubectl get pods -n "$NS" -o wide
   kubectl describe pod -n "$NS" <pod>       # look for probe-failure events (401/Unauthorized)
   ```

3. For a quick check without waiting on external ingress, port-forward directly to
   the pod:

   ```bash
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 8080:8080
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthz   # expect 200
   ```

4. Retrieve the generated editor password from Secret Manager (surfaced as the
   `codeserver_password_secret_id` output), then open the editor in a browser (via
   the port-forward tunnel, the LoadBalancer external IP, or the custom domain) and
   log in:

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~codeserver AND name~password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

5. Verify persistence: create a file or install an extension in the editor, then
   confirm it lands in the workspace storage — everything under `/home/coder`
   (settings, keybindings, extensions, open projects) persists on the GCS FUSE bucket
   or the block PVC, whichever mode is active:

   ```bash
   # GCS FUSE mode (default):
   gcloud storage buckets list --project="$PROJECT" --filter="name~codeserver"
   # Block PVC mode (stateful_pvc_enabled = true):
   kubectl get pvc -n "$NS"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — a Deployment by default, or a StatefulSet when
   `stateful_pvc_enabled = true`:

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"          # or: kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale out.** The module deliberately pins
   `min_instance_count = max_instance_count = 1`: editor sessions are held in memory
   and the workspace volume has a single writer — a second replica would split
   sessions and risk concurrent writes to `/home/coder`. Resource changes
   (`cpu_limit`, `memory_limit` for heavy language servers) go through **Update** on
   the deployment details page, not manual `kubectl edit` (a manual edit would be
   reverted on the next apply).

3. **Choose your workspace storage mode deliberately.** GCS FUSE (default) is
   simplest and needs no PVC quota; `stateful_pvc_enabled = true` mounts a per-pod
   block PVC (`standard-rwo`, `20Gi` by default) for lower-latency I/O on large
   workspaces, auto-selects `StatefulSet`, and sets `stateful_fs_group = 3000` so the
   volume is group-writable by the code-server process (UID 1000 / GID 2000).
   Switching modes is a one-way infrastructure change — plan a data copy if you need
   to migrate an existing workspace between the two.

4. **Update the application version** by changing the version input via **Update**
   on the deployment details page; a new image builds and a rolling update replaces
   the pod. There are no migrations — code-server has no schema. `latest` pins to
   `4.99.1` at build time; pin a specific release in production.

5. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~codeserver"
   kubectl get jobs -n "$NS"          # none by default — no init/migration job is needed
   ```

6. **There is no database session to open.** `database_type = "NONE"` — no Cloud SQL
   instance, no db-init job, no database password. The only durable state is the
   workspace bucket or PVC.

7. **Back up the workspace:**

   ```bash
   # GCS FUSE mode:
   WORKSPACE_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~codeserver" --format="value(name)" --limit=1)
   gcloud storage cp -r "gs://$WORKSPACE_BUCKET" "gs://<your-backup-bucket>/codeserver-$(date +%F)"

   # Block PVC mode — copy out of the running pod:
   kubectl cp "$NS"/"$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')":/home/coder ./codeserver-backup-$(date +%F)
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   (Use `statefulset/<name>` instead of `deploy/<name>` when `stateful_pvc_enabled =
   true`.) Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation (language servers and extensions are the usual memory
   drivers) and restart counts. The module's **uptime check** is disabled by default
   (`uptime_check_config.enabled = false`) and needs a publicly reachable endpoint —
   with the default `ClusterIP` Service, Monitoring → Uptime checks legitimately
   stays empty until you expose the editor externally.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with code-server releases.

- **Pod not Ready / CrashLoopBackOff with a probe failure:** check whether
  `enable_password = true` while the probe path is still the default `/health` —
  `/health` returns 401 under a password and the pod never becomes Ready even though
  the app started fine. Override the probe `path` to `/healthz` (Task 2, step 2).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe/scheduling/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Editor unreachable from your machine:** almost always the default `ClusterIP`
  Service, not an outage — confirm the Service type and switch to `LoadBalancer` (or
  a custom domain) if external access is required (Task 2, step 1).
- **PVC stuck Pending (block PVC mode):** check for `SSD_TOTAL_GB` quota exhaustion —
  the default `standard-rwo` StorageClass is SSD-backed. If the quota is tight,
  consider `stateful_pvc_storage_class = "standard"` (HDD) as an override.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS" <pvc-name>     # Events show the quota/provisioning error
  ```
- **Workspace permission errors under a block PVC:** confirm `stateful_fs_group` is
  non-zero (default `3000`) — a `0` value leaves `fsGroup` unset and the PVC may be
  root-owned, blocking writes from code-server's UID 1000.
- **Login rejected:** re-read the `PASSWORD` secret (Task 2, step 4) — the value is
  injected via SecretSync as the container's `PASSWORD` env var; a new secret
  version only takes effect on the next pod restart.
- **Workspace state missing / extensions gone:** confirm the GCS FUSE bucket mount
  or the PVC is actually bound, and that you are checking the storage mode that is
  actually active (`stateful_pvc_enabled` true or false).
- **Image build failed:** review Cloud Build history for the failed build's log; the
  image is a thin wrapper over `codercom/code-server` mirrored into Artifact
  Registry.
- **Image pull errors on the node:** confirm the image exists in Artifact Registry
  and the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to keep `enable_password = true` for any
externally exposed deployment, and never delete the workspace bucket/PVC).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, the Secret Manager `PASSWORD` secret, the workspace storage (the GCS
bucket, or the block PVC and its underlying Persistent Disk), and Artifact Registry
images. Copy the workspace out first if you want to keep your work. Resources owned
by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image and provisions the GKE pod, the workspace storage (GCS FUSE or block PVC), and the `PASSWORD` secret (no DB, no Redis) |
| 2 — Access & verify | Manual | Understand the default `ClusterIP` Service and the probe-path/password interaction; retrieve the password and log in; verify workspace persistence |
| 3 — Operate | Manual | Inspect the workload, keep single-instance scaling, choose GCS FUSE vs block PVC, update version, back up the workspace |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; understand when the uptime check exists |
| 5 — Troubleshoot | Manual | Diagnose probe-path, ingress, PVC-quota, permission, password, workspace, and build/pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including the workspace storage |
