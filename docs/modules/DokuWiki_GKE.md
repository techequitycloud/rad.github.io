---
title: "DokuWiki on GKE Autopilot"
description: "Configuration reference for deploying DokuWiki on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# DokuWiki on GKE Autopilot

DokuWiki is a lightweight, standards-compliant, **flat-file wiki** (no database) that
stores all of its content — pages, media, plugins, users, and configuration — as
files on disk. This module deploys DokuWiki on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services DokuWiki uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating
them here.

---

## 1. Overview

DokuWiki runs as a PHP/Apache workload on GKE Autopilot. Because it is a stateful
flat-file wiki, this variant deploys it as a **StatefulSet** with a durable block
PersistentVolumeClaim, not as a stateless Deployment. The deployment wires together a
deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pod on port 8080, 500m vCPU / 512 MiB by default; **StatefulSet** |
| Database | **None** | DokuWiki is a flat-file wiki — `database_type = "NONE"`, no Cloud SQL provisioned |
| Persistent storage | Persistent Disk (block PVC) | A block PVC mounted at `/storage` holds *all* wiki state |
| Cache & queue | **None** | No Redis; DokuWiki has no queue/worker model |
| Secrets | **None** | No runtime secrets — the admin account is created via `/install.php` |
| Ingress | Cloud Load Balancing | External LoadBalancer Service by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database.** DokuWiki stores everything in the `/storage` flat-file directory.
  `database_type` is fixed to `"NONE"`; a plan-time validation guard rejects any other
  value. `enable_cloudsql_volume` is also `false`.
- **StatefulSet with a block PVC.** `stateful_pvc_enabled = true` and
  `stateful_pvc_mount_path = "/storage"`, so `workload_type` auto-selects
  `StatefulSet` (leave `workload_type = null`). A block PVC handles DokuWiki's
  flat-file locking far better than gcsfuse — this is the recommended variant for
  concurrent editing.
- **All state lives on the PVC.** The GKE variant strips the Common module's default
  GCS volume/bucket (`gcs_volumes = []`, `module_storage_buckets = []`); persistence
  is the `/storage` block PVC alone (`stateful_pvc_size = 10Gi` by default).
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero;
  `min_instance_count = 1`). Keep replicas low — a StatefulSet's per-pod PVCs are not
  shared, so multiple replicas do **not** share wiki content.
- **No runtime secrets.** The administrator account is created interactively on first
  visit via `/install.php` and stored on the PVC.
- **External LoadBalancer by default** (`service_type = LoadBalancer`) so the wiki is
  reachable at an external IP. Enable IAP or a custom domain as needed.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the DokuWiki workload

DokuWiki pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because DokuWiki is stateful, it runs as a **StatefulSet** with a
per-pod block PVC.

- **Console:** Kubernetes Engine → Workloads → select the DokuWiki workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # PVC bound to the /storage disk
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Database — not used

DokuWiki does **not** use a database. `database_type = "NONE"`, no Cloud SQL instance
is created, no `db-init` job runs, and `enable_cloudsql_volume = false` (no Auth Proxy
sidecar). The plan-time guard in the module rejects any non-`NONE` `database_type`.

### C. Persistent storage — the `/storage` block PVC

DokuWiki's entire state lives on a **block PersistentVolumeClaim** (a Compute Engine
Persistent Disk) mounted at `/storage`. This is provisioned by the StatefulSet's
`volumeClaimTemplate`; there is **no** Cloud Storage bucket on this variant.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims; Compute Engine →
  Disks for the backing disk.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Browse the wiki data on the running pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /storage/data/pages
  ```

Increase `stateful_pvc_size` before deploying if you expect large media libraries;
resizing a bound PVC afterwards depends on the StorageClass's expansion support.

### D. Redis — not used

DokuWiki has no queue or worker model and does not use Redis. `enable_redis` is off by
default and there is no reason to enable it.

### E. Secret Manager — no application secrets

DokuWiki injects **no** runtime secrets. The administrator account is created via the
first-run installer (`/install.php`) and persisted on the PVC, so there is no
generated key to retrieve. `secret_environment_variables` remains empty by design.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dokuwiki"
  ```

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr (Apache logs) flow to Cloud Logging; GKE metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. DokuWiki Application Behaviour

- **No database, no init job.** There is no schema to create and no `db-init` job.
  `initialization_jobs` is empty. First boot seeds the `/storage` PVC with the default
  wiki (handled by the upstream image entrypoint) if it is empty.
- **First-run setup via `/install.php`.** On the first visit, open
  `http://<external-ip>/install.php` to create the administrator account, set the wiki
  title, and choose the ACL policy. This is written to the PVC. **Remove or block
  `install.php` afterwards** — anyone reaching it before you finish setup can claim
  the admin account.
- **All state is on the PVC.** Deleting the PVC (or the StatefulSet with its PVC)
  destroys the wiki. Back up the disk before teardown if you need to keep content.
- **StatefulSet, not Deployment.** DokuWiki is stateful; `stateful_pvc_enabled = true`
  auto-selects `workload_type = "StatefulSet"`. Do **not** set `workload_type =
  "Deployment"` alongside it — that combination fails at plan time.
- **Replicas do not share content.** Each StatefulSet pod gets its own PVC, so scaling
  past 1 replica gives each pod a *separate, empty* wiki. Keep `min`/`max` at 1 unless
  you have an external shared-storage plan; DokuWiki has no built-in clustering.
- **No auto-migrations.** Upgrading `application_version` ships a newer DokuWiki engine
  that reads the same `/storage` data; there is no migration step.
- **Health path.** Startup, liveness, and readiness probes all target `/` — DokuWiki
  serves its start page there without authentication, so the probe passes as soon as
  Apache is up. First boot completes in seconds (no DB migrations).
- **Inspect the pod's mounts and env:**
  ```bash
  kubectl get statefulset <service-name> -n "$NAMESPACE" -o \
    jsonpath='{.spec.template.spec.containers[0].volumeMounts}' ; echo
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for DokuWiki are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `dokuwiki` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | DokuWiki image tag; `latest` resolves to a pinned dated release (`2024-02-06b`) at build time. Pin a specific release for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1. Keep at 1 — StatefulSet PVCs are not shared. |
| `max_instance_count` | `3` | Cost ceiling. Do not scale past 1 for a shared wiki — each pod gets its own empty PVC. |
| `container_port` | `8080` | Apache listens on 8080. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | DokuWiki is lightweight. |
| `enable_cloudsql_volume` | `false` | No database — no Auth Proxy sidecar. |
| `enable_image_mirroring` | `true` | Mirror the DokuWiki image into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Exposes DokuWiki at an external IP. |
| `workload_type` | `null` | Leave null — `stateful_pvc_enabled = true` auto-selects `StatefulSet`. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Backs `/storage` with a durable block PVC. Auto-selects `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC size for wiki content/media. Size up front for large media. |
| `stateful_pvc_mount_path` | `/storage` | Must be DokuWiki's data dir so content persists. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass for the PVC. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | **Must remain `NONE`.** A plan-time guard rejects any other value. |

_All other inputs follow standard [App_GKE](App_GKE.md) behaviour._

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach DokuWiki. |
| `storage_buckets` | Created Cloud Storage buckets (empty on GKE — persistence is the block PVC). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Setup job names (empty — DokuWiki has none). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, `min_instance_count` above `max`, a `Deployment` workload_type alongside `stateful_pvc_enabled = true`, bare-integer `quota_memory_*` values — plus module-specific guards for a non-`NONE` `database_type`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `/storage` block PVC | Never delete after first deploy | Critical | The PVC *is* the wiki — deleting it (or the StatefulSet with its PVC) loses all pages, media, and users. Back up the disk before teardown. |
| `database_type` | `NONE` | Critical | Any other value fails the plan-time guard; if bypassed it provisions an unused Cloud SQL instance and cost. |
| `install.php` after setup | Remove / block once admin exists | High | Anyone who reaches `/install.php` before you finish setup can claim the admin account. |
| `workload_type` | `null` (auto → StatefulSet) | High | Setting `Deployment` alongside `stateful_pvc_enabled = true` fails at plan time; a plain Deployment would lose data on reschedule. |
| `min_instance_count` / `max_instance_count` | `1` for a shared wiki | High | Each StatefulSet pod gets its own empty PVC — scaling past 1 splits users across separate, unsynchronised wikis. |
| `stateful_pvc_mount_path` | `/storage` | High | A different path leaves DokuWiki's data dir on the pod's ephemeral rootfs — content is lost on every reschedule. |
| `stateful_pvc_size` | Size up front (`10Gi`+) | Medium | Under-sized PVCs fill up with media; online expansion depends on the StorageClass. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `service_type` | `LoadBalancer` (or IAP/domain) | Medium | `ClusterIP` makes the wiki unreachable from outside the cluster without extra ingress. |
| `memory_limit` (`container_resources`) | `512Mi` | Medium | Below 256 MiB the PHP/Apache process can OOM under load. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. DokuWiki-specific
application configuration shared with the Cloud Run variant is described in
**[DokuWiki_Common](DokuWiki_Common.md)**.
