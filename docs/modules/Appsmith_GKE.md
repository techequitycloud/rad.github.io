---
title: "Appsmith on GKE Autopilot"
description: "Configuration reference for deploying Appsmith on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Appsmith on GKE Autopilot

Appsmith is an open-source low-code platform for building internal tools, admin
panels, and dashboards — a self-hosted alternative to Retool. The Community
Edition ships as a single "fat" container that bundles an embedded MongoDB,
Redis, the Java backend, and the React client behind nginx, persisting all
application state under `/appsmith-stacks`. This module deploys Appsmith on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Appsmith uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Appsmith runs as a single "fat" container workload with all state — the
embedded MongoDB, Redis, uploaded assets, and configuration — on one
persistent volume. The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single-container StatefulSet pod on port 80, 2 vCPU / 2Gi by default |
| Persistent state | PersistentVolumeClaim (`stateful_pvc_enabled`) | 20Gi PVC mounted at `/appsmith-stacks`, backing the embedded MongoDB, Redis, uploads, and config |
| Container image | Docker Hub (prebuilt) | `appsmith/appsmith-ce`, mirrored into Artifact Registry by default |
| Secrets | Secret Manager | Auto-generated `APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT`, `APPSMITH_SUPERVISOR_PASSWORD` |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; custom domain with Google-managed certificate enabled by default |

**Sensible defaults worth knowing up front:**

- **No external database.** Appsmith CE runs its own embedded MongoDB inside
  the fat container; `database_type` is fixed at `NONE` and `enable_cloudsql_volume`
  defaults to `false`. There is no Cloud SQL Auth Proxy sidecar for this module
  — everything persists on the pod's own PVC instead.
- **Persistence is a per-pod PVC, not NFS.** `stateful_pvc_enabled = true` by
  default, which auto-resolves `workload_type` to `StatefulSet` and mounts a
  20Gi PVC at `/appsmith-stacks`. `enable_nfs` defaults to `false` — NFS is
  offered only for callers who prefer a shared Filestore volume instead of the
  block PVC, but the embedded MongoDB does its own file locking, so the PVC is
  the natural fit (and NFS is more prone to write-locking issues for embedded
  databases; see the repository's general NFS/SQLite guidance).
- **Single replica, hard constraint.** `min_instance_count = 1`,
  `max_instance_count = 1`. Multiple replicas would each get an **empty** PVC
  (StatefulSet PVCs are per-pod, not shared) and run independent, diverging
  embedded MongoDB instances — there is no clustering. `max_instance_count` is
  not blocked above 1 at plan time (only `min ≤ max` is enforced), so raising
  it is a real footgun.
- **The fat image is pulled prebuilt from Docker Hub.** `container_image_source`
  defaults to `"prebuilt"` (`appsmith/appsmith-ce`), correctly forwarded to the
  App_GKE foundation — there is no Dockerfile or custom build for this module.
  `enable_image_mirroring = true` copies the image into Artifact Registry to
  avoid Docker Hub rate limits.
- **Three secrets are auto-generated and required for data continuity.**
  `APPSMITH_ENCRYPTION_PASSWORD` / `APPSMITH_ENCRYPTION_SALT` secure the
  AES-256 encryption of datasource credentials and Git SSH keys at rest —
  changing either after first boot makes previously-encrypted data
  unreadable. `APPSMITH_SUPERVISOR_PASSWORD` gates the container's internal
  `/supervisor` process-control panel.
- **`enable_redis` and `database_type` are decoys for this app.** Appsmith CE
  bundles its own Redis and Mongo internally; it does not read the generic
  `REDIS_HOST`/`REDIS_URL` env vars the App_GKE foundation would inject if
  `enable_redis` were turned on, and `database_type` is fixed to `NONE`. Leave
  both at their defaults.
- **Custom domain routing is enabled by default.** Unlike most modules,
  `enable_custom_domain = true` out of the box (though `application_domains`
  is empty until you add a hostname).
- **First-boot install is self-contained.** The fat image initialises its own
  embedded MongoDB and Redis on first start; there is no separate `db-init` or
  migration job for this module (`initialization_jobs` defaults to `[]`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Appsmith workload

Appsmith runs as a `StatefulSet` (auto-selected because `stateful_pvc_enabled
= true`), giving the single pod a stable identity and its own PVC across
reschedules. The fat container is slow to boot (embedded Mongo + Redis + Java
backend), so allow several minutes before it reports Ready.

- **Console:** Kubernetes Engine → Workloads → select the Appsmith workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name~appsmith" 2>/dev/null || \
    kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the StatefulSet vs
Deployment workload type are managed.

### B. Persistent storage — PersistentVolumeClaim

All Appsmith state — the embedded MongoDB data files, Redis dump, uploaded
assets, plugin data, and Git-connected application config — lives on a single
20Gi block PVC mounted at `/appsmith-stacks`. Because it is a per-pod
StatefulSet PVC (not a shared NFS mount), it survives pod restarts/reschedules
but is **not** shared across replicas.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims /
  PersistentVolumes.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- du -sh /appsmith-stacks
  ```

See [App_GKE](App_GKE.md) Group 7 for StorageClass selection (SSD `standard-rwo`
by default; override to HDD `standard` if regional SSD quota is tight).

### C. Container image & Artifact Registry

The deployed image is the official `appsmith/appsmith-ce` fat image from
Docker Hub — no Dockerfile or Cloud Build step builds it. With
`enable_image_mirroring = true` (default) it is copied into Artifact Registry
first so the cluster pulls from Google's network rather than Docker Hub
directly.

- **Console:** Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --filter="name~appsmith"
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo-name>" --project "$PROJECT"
  ```

### D. Secret Manager

Three Appsmith secrets are generated automatically and stored in Secret
Manager: `APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT` (both
secure at-rest encryption of datasource credentials and Git SSH keys), and
`APPSMITH_SUPERVISOR_PASSWORD` (gates the container's internal supervisor
panel). On GKE, secrets are projected into the pod via the Secret Store CSI
driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~appsmith"
  gcloud secrets versions access latest --secret=<encryption-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys). `enable_custom_domain = true` by default — add a
hostname to `application_domains` to provision a Google-managed certificate.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available
(`uptime_check_config`, `alert_policies`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Appsmith Application Behaviour

- **Self-contained first boot — no init job.** The fat image initialises its
  embedded MongoDB and Redis, and creates the initial application data on
  first start. `initialization_jobs` defaults to `[]`; only caller-supplied
  jobs are honoured.
- **Persistent state lives entirely on the PVC.** `/appsmith-stacks` holds the
  Mongo data directory, Redis dump, uploaded/plugin assets, and Git-connected
  app data. Losing the PVC loses everything — there is no separate database to
  fall back on.
- **Encryption keys must not change after first boot.** `APPSMITH_ENCRYPTION_PASSWORD`
  and `APPSMITH_ENCRYPTION_SALT` are generated once and stored in Secret
  Manager; rotating them independently of a full data reset makes previously
  saved datasource credentials and Git SSH keys undecryptable.
  `APPSMITH_DISABLE_TELEMETRY = "true"` is set by default to disable anonymous
  usage telemetry.
- **Do not set `APPSMITH_DB_URL` / `APPSMITH_REDIS_URL`.** The Common module's
  own configuration deliberately avoids injecting these — the fat container's
  internal Mongo/Redis default to `localhost`, and pointing them at an
  external datastore breaks boot.
- **Health path.** Startup probe is **HTTP** `GET /api/v1/health` on port 80,
  with a generous window (~10 minutes: `initial_delay_seconds = 120`,
  `period_seconds = 15`, `failure_threshold = 40`) to accommodate the slow
  boot of the bundled MongoDB + Redis + Java backend. Liveness probe is the
  same path with tighter thresholds (`initial_delay_seconds = 60`,
  `period_seconds = 30`, `failure_threshold = 3`) once the app is up.
- **Single-replica StatefulSet, `RollingUpdate` strategy.** With
  `max_instance_count = 1` there is only ever one pod, so the default
  `stateful_update_strategy = "RollingUpdate"` simply recreates that one pod
  on template changes — there is no surge/deadlock risk at replica count 1,
  but raising `max_instance_count` above 1 is unsupported (see Overview).
- **Inspect the running pod and its persisted data:**
  ```bash
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep APPSMITH
  ```

---

## 4. Configuration Variables

Variables are grouped by their `{{UIMeta group=N}}` tag as declared in this
module's `variables.tf` (this drives the deployment platform's UI form
layout). Only settings specific to or notable for Appsmith are listed; every
other input is inherited from [App_GKE](App_GKE.md) with its standard
behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `appsmith` | Base name for the Kubernetes workload, Artifact Registry repository, and Secret Manager secrets. |
| `application_version` | `latest` | Tag applied to the pulled `appsmith/appsmith-ce` image; since the image is prebuilt (not a custom Dockerfile build), `latest` resolves directly to Docker Hub's `latest` tag — no version-pin ARG trap applies here. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Pulls the official `appsmith/appsmith-ce` fat image from Docker Hub. Correctly forwarded to the App_GKE foundation. |
| `container_port` | `80` | Appsmith CE serves on port 80 via its internal nginx. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=2Gi` | The fat image bundles MongoDB, Redis, and a Java backend in one container, so 2Gi+ is recommended. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Keep both at 1.** The embedded MongoDB and per-pod PVC are not multi-replica safe; `max_instance_count` is not blocked above 1 at plan time. |
| `enable_cloudsql_volume` | `false` | Always false — Appsmith CE has no external Cloud SQL database. |
| `enable_image_mirroring` | `true` | Mirrors the Docker Hub image into Artifact Registry before deployment. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Appsmith UI. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolved to StatefulSet because `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Round-robin routing; moot at a single replica, but leave unchanged since `max_instance_count` must stay at 1. |

### Group 13 — Filesystem (NFS) & Scheduled Jobs

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off by default — persistence uses the StatefulSet PVC instead. Enable only if a shared Filestore volume is preferred over the per-pod PVC. |
| `nfs_mount_path` | `/appsmith-stacks` | Mount path used if NFS is enabled instead of the PVC. |
| `initialization_jobs` / `cron_jobs` | `[]` | No default jobs — Appsmith CE self-initialises. |

### Group 15 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Appsmith CE uses an embedded MongoDB; no Cloud SQL instance is provisioned. |
| `application_database_name` / `application_database_user` | `appsmith` | Not used by Appsmith CE; retained only for wrapper compatibility. |

### Group 16 — Stateful Workload (PVC)

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisions the per-pod PVC that backs `/appsmith-stacks` (embedded Mongo, Redis, uploads, config). Auto-selects `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Size of the PVC. Raise for larger datasource/app libraries. |
| `stateful_pvc_mount_path` | `/appsmith-stacks` | Where all Appsmith state is persisted. |
| `stateful_pvc_storage_class` | `""` → cluster default (SSD `standard-rwo`) | Override to `standard` (HDD) if regional SSD quota is constrained. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Enabled by default (unlike most modules) — add a hostname to `application_domains` to route it. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 21 — Cloud Armor & Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Leave off — Appsmith CE bundles its own Redis internally and does not read the generic `REDIS_HOST`/`REDIS_URL` env vars this would inject. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Appsmith. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Empty/not applicable — Appsmith CE has no external Cloud SQL database (`database_type = NONE`). |
| `storage_buckets` | Created Cloud Storage buckets (empty unless `storage_buckets` is populated by the caller). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of any caller-supplied setup/import jobs (empty by default). |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates values
> *and combinations* at plan time — an invalid `container_port`, a
> `StatefulSet`/`Deployment` conflict, IAP enabled with no OAuth credentials,
> `quota_memory_*` given as bare integers. This module also declares its own
> guard (`validation.tf`): `min_instance_count ≤ max_instance_count`, IAP
> requiring both OAuth credentials, `enable_cloudsql_volume` rejected when
> `database_type = "NONE"`, and `enable_redis` requiring a non-empty
> `redis_host`. Invalid configuration fails the **plan** with a clear, named
> error before any resource is created — but note `max_instance_count > 1` is
> **not** one of the guarded combinations (see below).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Not blocked at plan time above 1, but each StatefulSet pod gets its own **empty** PVC — a second replica runs a diverging, unsynchronised embedded MongoDB with no clustering, corrupting the assumption of a single source of truth. |
| `stateful_pvc_enabled` | `true` | Critical | Disabling it removes the PVC — all state (embedded Mongo, Redis, uploads, Git-connected app config) becomes ephemeral and is lost on pod restart/reschedule. |
| `APPSMITH_ENCRYPTION_PASSWORD` / `APPSMITH_ENCRYPTION_SALT` (auto-generated) | Never change after first boot | Critical | Rotating either independently of a full data reset makes previously-encrypted datasource credentials and Git SSH keys permanently unreadable. |
| `database_type` | `NONE` | Critical | Appsmith CE has no external database integration; setting a Cloud SQL engine provisions an unused instance and does nothing for the app. |
| `enable_cloudsql_volume` | `false` | High | Blocked at plan time when `database_type = "NONE"` — there is no Cloud SQL instance to proxy to. |
| `enable_redis` | `false` | Medium | Appsmith CE bundles Redis internally and does not read the generic `REDIS_HOST`/`REDIS_URL` env vars this injects — turning it on adds inert environment variables and, if misread as a real dependency, false confidence in an external cache that isn't used. |
| `stateful_pvc_size` | `20Gi` (raise as needed) | Medium | Undersizing forces manual PVC expansion later; the embedded Mongo and uploaded assets share this one volume. |
| `startup_probe_config` timing | `initial_delay_seconds=120`, `failure_threshold=40` | Medium | The fat container (Mongo + Redis + Java) boots slowly; a shorter window can flag a healthy-but-still-booting pod as failed and trigger a restart loop. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any configured custom domain. |
| `stateful_pvc_storage_class` | `""` (SSD) or `standard` (HDD) | Low–Medium | SSD (`standard-rwo`) draws the tighter regional `SSD_TOTAL_GB` quota; override to HDD `standard` on quota-constrained projects — a single-pod app has no IOPS requirement that demands SSD. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Appsmith-specific application configuration
(secrets, environment defaults, probe wiring) shared with the Cloud Run
variant lives in the `Appsmith_Common` module.
