---
title: "Zitadel on GKE Autopilot"
description: "Configuration reference for deploying Zitadel on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Zitadel on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zitadel_GKE.png" alt="Zitadel on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zitadel is an open-source, cloud-native identity and access management (IAM) platform
providing OpenID Connect, OAuth 2.0, SAML, and user/organization management. This
module deploys Zitadel on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Zitadel uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating
them here.

---

## 1. Overview

Zitadel runs as a single Go web workload. The deployment wires together a focused set
of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Zitadel only supports PostgreSQL; MySQL is rejected at plan time |
| Object storage | Cloud Storage | One bucket provisioned automatically (operator use; core state lives in Postgres) |
| Cache & queue | None | Zitadel stores all state in PostgreSQL — no Redis, no queue |
| Secrets | Secret Manager | Auto-generated `ZITADEL_MASTERKEY` and initial admin password; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with `ClientIP` affinity; optional custom domain + managed cert |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is mandatory.** `database_type = POSTGRES_15` by default; a plan-time
  validation guard rejects MySQL and any non-Postgres engine. PostgreSQL 13/14 are also
  accepted.
- **`ZITADEL_MASTERKEY` is generated automatically and immutable.** It is exactly 32
  bytes and encrypts all sensitive data at rest. **Never rotate it after first boot** —
  doing so makes previously-encrypted data (client secrets, key material) unreadable.
- **Zitadel runs its own setup + migrations.** The container starts with
  `zitadel start-from-init`, which creates the schema and applies migrations
  idempotently on first boot — there is no separate migrate job.
- **A first-instance admin is created on first boot.** Organization `ZITADEL` and human
  admin `zitadel-admin` are seeded with a generated password from Secret Manager
  (`PASSWORDCHANGEREQUIRED = false`), so you can sign in immediately.
- **HTTP/2 with TLS terminated upstream.** `ZITADEL_EXTERNALSECURE = true`,
  `ZITADEL_EXTERNALPORT = 443`, `ZITADEL_TLS_ENABLED = false`. Zitadel serves cleartext
  HTTP/2 on 8080 and trusts the GKE LoadBalancer to terminate TLS on `:443`. Set
  `container_protocol = "h2c"` if you need end-to-end HTTP/2 for gRPC API clients.
- **`ZITADEL_EXTERNALDOMAIN` must be set for external access.** On GKE the entrypoint
  derives it from the injected service URL, which is the in-cluster address; behind an
  external IP or custom domain you must override `ZITADEL_EXTERNALDOMAIN` to the public
  host (see the Pitfalls table) or the OIDC issuer and Console redirects break.
- **Session affinity is `ClientIP`.** Requests from the same client stick to the same
  pod — helpful for the Console UI session flow.
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero) with
  `max_instance_count = 5`; a static external IP is reserved by default so the address
  survives redeploys.
- **NFS is enabled by default but unused by the app.** Zitadel keeps all state in
  PostgreSQL; you can set `enable_nfs = false` unless another reason requires it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Zitadel workload

Zitadel pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts. A Cloud SQL Auth Proxy sidecar runs alongside the container.

- **Console:** Kubernetes Engine → Workloads → select the Zitadel workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c zitadel --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c zitadel | grep cloud-entrypoint
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment
vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Zitadel stores all application data (organizations, users, projects, applications,
sessions, keys) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
privately through the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1`; no public IP is
exposed. On first deploy an initialization Job creates the application database and a
role with `CREATEDB`/`CREATEROLE`; Zitadel then creates its own schema via
`start-from-init`.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~zitadel"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

One **Cloud Storage** bucket is provisioned automatically (public access prevention
enforced), and the workload service account is granted access. Zitadel keeps its core
state in PostgreSQL, so the bucket is available for operator use. Additional buckets can
be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Two secrets are generated automatically and stored in Secret Manager: `ZITADEL_MASTERKEY`
(encrypts all data at rest) and the initial admin password (seeds the first-instance
human on boot). They are delivered to the pod via the Secret Store CSI driver. The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~zitadel"
  # Read the initial admin password to log in the first time:
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation, and
[Zitadel_Common](Zitadel_Common.md) for the criticality of the masterkey. Note the
GKE SecretSync CRD rejects `__` in synced keys — Zitadel's secret keys
(`ZITADEL_MASTERKEY`, `ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD`) use single
underscores and are unaffected.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP with a
reserved static address. A custom domain with a Google-managed certificate can be
enabled. Because Zitadel serves gRPC + REST over HTTP/2, set `container_protocol = "h2c"`
for end-to-end HTTP/2 when required.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available. The
`[cloud-entrypoint]` log lines show the resolved DB SSL mode and external domain.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Zitadel Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy sidecar and
  idempotently creates the application database and a role with `LOGIN CREATEDB
  CREATEROLE`, grants privileges on the database and `public` schema, then signals the
  proxy to shut down so the Job pod completes. The job is safe to re-run and does **not**
  create Zitadel's schema — Zitadel does that itself.
- **Setup + migrations on start.** The container runs `zitadel start-from-init`, which
  creates the schema and applies migrations idempotently on every start. Upgrading the
  application version applies schema changes without a separate migration step.
- **`ZITADEL_MASTERKEY` is immutable after first boot.** It is generated once (exactly
  32 bytes) and written to Secret Manager. Changing it makes all previously-encrypted
  data unreadable. Only touch it in a planned, understood migration.
- **First-run admin.** Log in with username `zitadel-admin` (default) and the password
  from Secret Manager:
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```
  Then create a real admin, disable or restrict the seeded account, and configure your
  organizations, projects, and OIDC/SAML applications in the Console.
- **External domain must match the browser host.** The OIDC issuer and Console redirect
  URIs are built from `ZITADEL_EXTERNALDOMAIN`. On GKE the entrypoint derives it from the
  injected (in-cluster) service URL, so for external access you **must** set
  `ZITADEL_EXTERNALDOMAIN` (via `environment_variables`) to the LoadBalancer IP's host or
  the custom domain — otherwise logins and token exchange fail. Patch a running
  deployment if the IP was assigned after deploy:
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" \
    ZITADEL_EXTERNALDOMAIN=zitadel.example.com
  ```
- **Health path.** Startup, liveness, and readiness probes target `/debug/healthz` — an
  unauthenticated `200` endpoint. Allow ~7–8 minutes on first boot for setup + migrations.
- **Inspect the running configuration / jobs:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -c zitadel -- env | grep ZITADEL_
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Zitadel are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `zitadel` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Zitadel` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Zitadel image tag; mapped to a pinned tag (`v2.71.0`) when `latest`. Pin explicitly in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Zitadel is a thin custom build FROM the ghcr image — leave as `custom`. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Per-pod CPU/memory. |
| `container_port` | `8080` | Zitadel serves gRPC + REST over HTTP/2 on 8080. |
| `container_protocol` | `http1` | Set `h2c` for end-to-end HTTP/2 to gRPC API clients. |
| `min_instance_count` | `1` | Minimum replicas; GKE keeps ≥ 1 (no scale-to-zero). |
| `max_instance_count` | `5` | Maximum replicas; safe to raise — all state is in PostgreSQL. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (keep `true` on GKE). |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |
| `timeout_seconds` | `300` | Maximum request duration. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `ZITADEL_*` settings — set `ZITADEL_EXTERNALDOMAIN` here for external access. Core DB/TLS/masterkey values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (avoid `__` in keys). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Rotation notification frequency. **Do not enable masterkey rotation.** |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External LoadBalancer for the Console and OIDC endpoints. |
| `workload_type` | `null` → Deployment | Stateless Deployment; Zitadel keeps all state in PostgreSQL. |
| `session_affinity` | `ClientIP` | Sticky routing for the Console UI session flow. |
| `namespace_name` | `""` (auto-generated) | Kubernetes namespace for the workload. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (off) | Not needed — Zitadel stores all state in PostgreSQL, not on disk. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/debug/healthz`, 60s delay | Startup probe. Allow ~7–8 minutes on first boot. |
| `liveness_probe` | HTTP `/debug/healthz`, 60s delay | Liveness probe. |
| `uptime_check_config` | _(set)_ | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Not used — Zitadel has no platform-scheduled recurring tasks. |
| `additional_services` | `[]` | Sidecar or helper services (none required for Zitadel). |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Enabled by default but **unused** — Zitadel keeps all state in PostgreSQL; safe to set `false`. |
| `nfs_mount_path` | `/opt/zitadel/storage` | Mount path inside the container (unused). |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the declared GCS bucket(s). |
| `storage_buckets` | `[{ name_suffix = "data" }]` | One `data` bucket is declared by default; extend the list for additional buckets. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis

Zitadel does not use Redis (all state is in PostgreSQL). `enable_redis` defaults to
`false` and should be left off; the `redis_*` inputs are inert for this module.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL only (13/14/15). MySQL is rejected at plan time. |
| `application_database_name` | `zitadel` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `zitadel` | Application database user (granted `CREATEDB`/`CREATEROLE`). Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated Cloud SQL backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate (a Gateway with a static IP is provisioned automatically). Remember to set `ZITADEL_EXTERNALDOMAIN` to match. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all** inbound
> requests, including OIDC/machine clients and token endpoints. Only enable IAP for a
> fully private console.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Zitadel. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_GKE behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Zitadel. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`) and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a non-Postgres `database_type`, `enable_cloudsql_volume` with `database_type = NONE`, IAP with no OAuth credentials, `min_instance_count > max_instance_count`, Redis enabled with no resolvable host, an out-of-range `redis_port`/`backup_retention_days`, and `quota_memory_*` without a binary unit suffix. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ZITADEL_MASTERKEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all previously-encrypted data (client secrets, key material) permanently unreadable. |
| `database_type` | `POSTGRES_15` | Critical | Zitadel only supports PostgreSQL; MySQL/other is rejected at plan time, and a wrong engine breaks startup. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all identity data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `ZITADEL_EXTERNALDOMAIN` | Set to the external host | Critical | On GKE it defaults to the in-cluster URL; for external access you must set it to the LoadBalancer IP host or custom domain, or the OIDC issuer and Console redirects break and every login fails. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it with a database configured is blocked by a plan-time guard. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. Keeping 1 keeps the IdP always reachable. |
| `enable_iap` | only for private consoles | High | IAP blocks all unauthenticated requests, including OIDC/machine clients and token endpoints. |
| `session_affinity` | `ClientIP` | High | Without stickiness, Console UI sessions can bounce between pods mid-flow. |
| `container_port` | `8080` | High | Zitadel listens on 8080; a mismatched port makes the workload never become Ready. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `application_version` | Pin a release | High | `latest` maps to a pinned tag today, but pinning explicitly avoids surprise migrations on redeploy. |
| `enable_nfs` | `false` (unused) | Low | Enabled by default but Zitadel stores no state on disk; leaving it on wastes an NFS mount. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of identity data. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Zitadel-specific
application configuration shared with the Cloud Run variant is described in
**[Zitadel_Common](Zitadel_Common.md)**.
