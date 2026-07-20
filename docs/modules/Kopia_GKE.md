---
title: "Kopia on GKE Autopilot"
description: "Configuration reference for deploying Kopia on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Kopia on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kopia_GKE.png" alt="Kopia on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kopia is a fast, secure, open-source backup tool with client-side encryption,
compression, and deduplication. This module runs Kopia in **repository-server
mode** on **GKE Autopilot**: a single always-addressable server that remote `kopia`
CLI clients elsewhere connect to and push/pull encrypted snapshots into, backed
natively by a Cloud Storage bucket — on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Kopia uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common
to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

**There is no `Kopia_CloudRun`.** Kopia's client-server snapshot protocol is
exclusively gRPC, which only ever gets real HTTP/2 through Kopia's own TLS+ALPN —
Cloud Run's GFE always terminates public HTTPS at its own edge and can never pass a
container-terminated TLS stream through, so a Cloud Run variant (built, deployed,
and live-tested) failed every actual snapshot session. See
[Kopia_Common](Kopia_Common.md) for the full source-confirmed writeup.

---

## 1. Overview

Kopia runs as a single-pod GKE Autopilot workload with its repository living
natively in Cloud Storage — no database, no filesystem-mounted data volume for the
backups themselves:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go server pod, 1 vCPU / 1 GiB by default; a single Deployment replica |
| Repository storage | Cloud Storage (native GCS API, not a mount) | Every snapshot ever written, under a `repository/` object prefix |
| TLS certificate persistence | Cloud Storage (GCS FUSE mount at `/var/lib/kopia`) | Same bucket, `tls/` prefix — self-signed cert/key, generated once |
| Secrets | Secret Manager | Two independent secrets: `ADMIN_PASSWORD` (login) and `REPO_PASSWORD` (repository encryption key) |
| Ingress | LoadBalancer / Cloud Load Balancing | External by default (remote clients need to reach it); bare L4 TCP passthrough — Kopia terminates its own TLS |

**Sensible defaults worth knowing up front:**

- **No database, no data-plane filesystem mount.** Kopia's repository is written
  directly through Kopia's own native GCS API client (ADC-authenticated) — the
  bucket is not mounted as a filesystem for backup data. `database_type = "NONE"`.
- **One bucket, two roles.** The same `storage` bucket is also FUSE-mounted at
  `/var/lib/kopia` purely to persist the self-signed TLS certificate across
  restarts (`tls/` prefix — never collides with `repository/`).
- **Kopia terminates its own TLS.** Required because GKE's plain L4
  `LoadBalancer` Service has no HTTP-terminating edge of its own (unlike Cloud
  Run's GFE). Generated once, on first boot; every later boot reuses the same
  persisted certificate (Kopia refuses to regenerate against an existing cert
  file). The SHA256 fingerprint every client needs prints once, to logs, at
  generation time.
- **Two independent secrets, not interchangeable.** `ADMIN_PASSWORD` gates the Web
  UI/control API and is safe to rotate. `REPO_PASSWORD` is the repository's own
  content-encryption key, set once at first deploy — rotating it independently of
  the actual repository content permanently orphans every existing snapshot.
- **A real client session needs more than HTTP Basic Auth.** The entrypoint
  provisions a repository-stored user (`<ADMIN_USERNAME>@kopia`) with ACLs enabled
  on every boot — required for an actual gRPC snapshot session, which the
  `ADMIN_PASSWORD` layer alone does not authorize.
- **Port `51515`, LoadBalancer by default.** Kopia's native server port is fixed by
  `Kopia_Common`; `service_type` defaults to `LoadBalancer` since external
  reachability from remote clients is the entire point of this module.
- **Single server, scale-to-zero-safe.** `max_instance_count` should stay `1`
  (repository maintenance assumes single-server ownership); `min_instance_count = 0`
  is safe because the repository lives in Cloud Storage, not an instance-local
  volume.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Kopia workload

Kopia runs as a single pod (Deployment by default; StatefulSet is available but not
needed — see §4).

- **Console:** Kubernetes Engine → Workloads → select the Kopia workload to see the
  pod and events.
- **CLI:**
  ```bash
  kubectl get deployment,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot scheduling and Workload Identity work.

### B. Cloud Storage — the repository (no Cloud SQL)

There is **no Cloud SQL instance** — `database_type = "NONE"`. Kopia's repository
data is written directly to the `storage` bucket through Kopia's own native GCS API
client, under the `repository/` object prefix:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls -r gs://<storage-bucket>/repository/ | head
```

The same bucket is also FUSE-mounted at `/var/lib/kopia` purely to persist the
self-signed TLS certificate under a separate `tls/` prefix (see §D) — the two never
collide.

### C. Secret Manager — two independent secrets

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~repo-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

`ADMIN_PASSWORD` gates the Web UI/control API; `REPO_PASSWORD` is the repository's
own content-encryption key and the credential a real client connects with. See
[Kopia_Common §2](Kopia_Common.md#2-two-independent-secrets-in-secret-manager) for
the full detail on why they are not interchangeable.

### D. TLS certificate — self-signed, persisted

```bash
# From the pod's first-boot logs (fingerprint prints once, at generation time):
kubectl logs <pod> -n "$NAMESPACE" -c kopia | grep -A2 -i fingerprint

# Recompute at any time (GKE gives real shell access, unlike Cloud Run):
kubectl exec <pod> -n "$NAMESPACE" -c kopia -- \
  openssl x509 -in /var/lib/kopia/tls/cert.pem -noout -fingerprint -sha256
```

### E. Networking & ingress

By default the workload is a **LoadBalancer** Service, external and reachable from
remote `kopia` CLI clients out of the box. It is a **bare L4 TCP passthrough** — no
HTTP-terminating edge — so Kopia's own TLS reaches the client end-to-end.

```bash
kubectl get svc -n "$NAMESPACE"    # confirm the external port -> 51515 mapping
gcloud compute addresses list --project "$PROJECT"
```

> **The external Service port defaults to `80`, not `51515`.** `Kopia_GKE` does not
> expose `App_GKE`'s `service_port` variable, so it is always the `App_GKE` default
> (`80`); the Service's `target_port` is Kopia's real port (`51515`). Since it's a
> bare TCP passthrough, Kopia's TLS still terminates correctly end-to-end — but a
> client must connect to `https://<external-ip>:80` explicitly (`https://` alone
> implies port 443, which is not open). Always confirm the actual mapping with
> `kubectl get svc` before connecting a client.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flows to Cloud Logging; GKE metrics flow to Cloud Monitoring.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

An `uptime_check_config` is available but **disabled by default** — if enabled, be
aware it issues an HTTP check, and Kopia has no unauthenticated HTTP endpoint to
target, so it will fail continuously.

---

## 3. Kopia Application Behaviour

- **Repository connect-or-create on every boot.** The entrypoint runs
  `kopia repository connect gcs --bucket=... --prefix=repository/`, falling back to
  `kopia repository create gcs ...` if the repository doesn't exist yet. This
  idempotent logic fully replaces what a database-app's init job would otherwise do
  — there is no separate migration/init job for Kopia.
- **Repository-stored user + ACLs, provisioned every boot.** `kopia server users
  add/set "${ADMIN_USERNAME}@kopia" --user-password="${REPO_PASSWORD}"` followed by
  `kopia server acl enable`, both idempotent (add-or-set / enable-or-skip). This is
  what actually authorizes a client's gRPC snapshot session — HTTP Basic Auth
  (`ADMIN_PASSWORD`) alone does not.
- **TLS generated once, reused forever.** First boot: no persisted cert files →
  `--tls-generate-cert`, fingerprint printed once to logs. Every later boot: cert
  files found at `/var/lib/kopia/tls/` → reused as-is, no regeneration (Kopia
  refuses to regenerate against an existing cert file).
- **Client connect command** — the exact, live-verified flow:
  ```bash
  kopia repository connect server \
    --url=https://<external-ip>:<service-port> \
    --server-cert-fingerprint=<sha256-fingerprint> \
    --password=<REPO_PASSWORD> \
    --override-username=admin --override-hostname=kopia
  ```
  plus `KOPIA_SERVER_USERNAME=admin` / `KOPIA_SERVER_PASSWORD=<ADMIN_PASSWORD>` env
  vars for the outer HTTP Basic Auth layer the Web UI/control API use. Note the
  password used for the *repository connection* is `REPO_PASSWORD`, not
  `ADMIN_PASSWORD` — see [Kopia_Common §4](Kopia_Common.md#4-the-third-mechanism--a-repository-stored-user--acls).
- **Single-writer repository maintenance.** Kopia's own GC/compaction assumes one
  server owns the repository at a time — keep `max_instance_count = 1`.
- **Scale-to-zero is data-safe.** The repository lives in Cloud Storage, not an
  instance-local volume, so a cold start just reconnects (and, on the very first
  boot ever, regenerates the TLS cert).
- **Updates recreate the pod.** A version bump rebuilds the custom image and
  recreates the single pod; the entrypoint's connect-or-create/user/ACL logic runs
  again on the new pod with no special handling needed.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Kopia are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults. See
the `modules/Kopia_GKE/README.md` for the exhaustive,
group-by-group input reference.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. Use `gke` to run alongside a Cloud Run variant of a different app on the same tenant. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `kopia` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Kopia image tag; `latest` pins the build to `0.23.1` (Docker Hub, not GHCR — no `v` prefix ambiguity here). |
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Snapshot uploads/restores are CPU-bound (compression, encryption, hashing) — raise for large/frequent backup jobs. |
| `memory_limit` | `1Gi` | Kopia's own footprint is modest; extra headroom benefits the content cache on repositories with many/large snapshots. |
| `min_instance_count` | `0` | Scale-to-zero is safe — the repository lives in Cloud Storage. |
| `max_instance_count` | `1` | Keep at `1` — Kopia's repository maintenance assumes single-server ownership. |
| `enable_cloudsql_volume` | `false` | Kopia has no Cloud SQL — keep `false`. |
| `enable_image_mirroring` | `true` | Mirror the built Kopia image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain-text settings, merged with the module default `ADMIN_USERNAME=admin`. |
| `secret_environment_variables` | `{}` | Additional Secret Manager references injected as env vars. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External reachability by default — remote clients need to reach this server. Use `ClusterIP` only when every client already runs inside the same cluster/VPC. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` only if `stateful_pvc_enabled = true` (not recommended — see Group 7). |
| `termination_grace_period_seconds` | `60` | Seconds after SIGTERM before SIGKILL — lets Kopia flush in-flight writes. |

> **`service_port` is not exposed by this module** — see §2E above. The external
> LoadBalancer port is always `80` (the `App_GKE` default); `target_port` is
> Kopia's real `51515`.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Available but not recommended.** The only thing that would live on a PVC is the tiny persisted TLS certificate — no meaningful IOPS/locking need a block device improves on. GCS FUSE (the default) is fine. |
| `stateful_pvc_mount_path` | `/var/lib/kopia` | Must match the default GCS FUSE mount path if you do enable a PVC. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` by default — the persisted cert is a tiny file with no high-IOPS need. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 15s delay, 10-retry threshold | **TCP, not HTTP** — every Kopia endpoint requires authentication, so an HTTP-path probe would always 401. |
| `liveness_probe` | TCP, 30s delay, 3-retry threshold | Same reasoning as `startup_probe`. |
| `uptime_check_config` | disabled | If enabled, it's an HTTP check and will fail continuously against Kopia's auth-gated endpoints. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default init job — the entrypoint's own connect-or-create logic replaces it. |
| `cron_jobs` | `[]` | Kubernetes CronJobs (e.g., a periodic `kopia maintenance run` for repository GC). |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the `storage` bucket (repository data + TLS-cert persistence). |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts — the Kopia TLS-cert mount is added automatically. |

### Group 15 / 16 — Redis / Database (not applicable)

Kopia uses neither. `enable_redis` is hardcoded `false` in `main.tf` (overriding the
`App_GKE` default of `true`); `database_type` is fixed to `NONE`.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Gateway for a custom hostname. Note Kopia's client protocol is raw gRPC, not browser HTTP — a custom domain mainly benefits a stable `--url` for clients, not a browsable UI. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys, so remote clients don't need to re-pin `--url`. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | IAP is designed for browser/HTTP auth, not the raw gRPC snapshot protocol — only appropriate for gating the Web UI on a custom domain, not the client connect endpoint. |

### Groups 12, 8, 9, 13, 17, 18, 21, 22

Standard `App_GKE` behaviour — CI/CD & Binary Authorization, Resource Quota,
Reliability Policies, NFS, Backup & Maintenance (Foundation-generic, not Kopia's own
repository), Custom SQL (not applicable), Cloud Armor, and VPC Service Controls. See
[App_GKE](App_GKE.md).

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External IP (when `reserve_static_ip = true`) — the host half of the `kopia repository connect server --url=` value. |
| `service_url` | Foundation-computed URL. **Do not trust the scheme/port for Kopia** — defaults to bare `http://<ip>` with no port; confirm the real port with `kubectl get svc`. |
| `storage_buckets` | Created Cloud Storage buckets (the `storage` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Empty by default — Kopia has no init job. |
| `statefulset_name` | Name of the StatefulSet (only when `workload_type = "StatefulSet"`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through
> the [App_GKE](App_GKE.md) foundation engine, which validates values *and
> combinations* at plan time — `workload_type = "Deployment"` with
> `stateful_pvc_enabled = true`, IAP with no authorized identities, non-binary quota
> units. Invalid configuration fails the **plan** with a clear, named error before
> any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `REPO_PASSWORD` (Secret Manager) | Never hand-rotate after first deploy | **Critical** | There is no supported re-encrypt path for a live repository — rotating this secret independently of the actual GCS repository content permanently orphans every existing snapshot. |
| Repository-user password | Connect clients with `--password=<REPO_PASSWORD>`, never `<ADMIN_PASSWORD>` | **Critical** | `kopia repository connect server` has no separate server-user-password flag — its one password input IS the gRPC session credential, checked against the repository-stored user's password. Using `ADMIN_PASSWORD` fails every session with `PermissionDenied`. |
| `max_instance_count` | `1` | **Critical** | Kopia's own repository maintenance (GC/compaction) assumes single-server ownership; a second concurrent server races maintenance runs against the same repository. |
| Health probes | Leave as TCP (module default) | **High** | Every Kopia endpoint requires authentication — an HTTP-path probe always 401s, and the pod never becomes Ready even though the server booted fine. |
| Client connect URL/port | Explicit port, confirmed via `kubectl get svc` | **High** | `service_port` is not exposed by this module and defaults to `80`, not Kopia's real `51515`. A bare `https://<ip>` implies port 443 (not open) and silently fails to connect. |
| `uptime_check_config` | Leave `enabled = false` (module default) | **Medium** | If enabled it issues an HTTP check against an auth-gated endpoint and will fail continuously, generating false alerts. |
| `stateful_pvc_enabled` | Leave `false`/unset (module default) | **Low** | Available, but the only thing that would live on it is the tiny persisted TLS cert — no IOPS/locking benefit over the default GCS FUSE mount. |
| `enable_iap` | Only for the Web UI/control API, not the client connect endpoint | **Medium** | IAP is browser/HTTP-auth oriented; it does not (and cannot usefully) gate the raw gRPC snapshot session. |
| TLS certificate | Never delete `/var/lib/kopia/tls/*` out-of-band | **High** | Every already-connected remote client has pinned the old fingerprint via `--server-cert-fingerprint=`; a regenerated cert breaks every existing client until they re-pin. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see **[App_GKE](App_GKE.md)**.
Kopia-specific application configuration is described in
**[Kopia_Common](Kopia_Common.md)**.
