---
title: "Firefly III on GKE Autopilot"
description: "Configuration reference for deploying Firefly III on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Firefly III on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FireflyIII_GKE.png" alt="Firefly III on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Firefly III is a free, open-source, AGPL-licensed self-hosted personal-finance
manager. It tracks accounts, transactions, budgets, bills, categories, and recurring
transactions, and exposes a full REST API. This module deploys Firefly III on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Firefly III uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Firefly III runs as a Laravel/PHP (Apache) web workload. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pods, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Fixed engine — `DB_CONNECTION = pgsql`; MySQL is not used |
| Object storage | Cloud Storage | A dedicated `fireflyiii-uploads` bucket provisioned automatically |
| Persistent files | Filestore (NFS, optional) | Attachments and runtime data mounted at `/var/lib/fireflyiii` |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY` and `STATIC_CRON_TOKEN`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The engine is fixed by the shared application layer.
  On GKE the pod reaches Cloud SQL through the **Cloud SQL Auth Proxy sidecar** on
  `127.0.0.1:5432` (`DB_HOST = 127.0.0.1`), which terminates TLS to Cloud SQL — so the
  loopback hop is plaintext and `PGSQL_SSL_MODE = prefer` (do not force `require`).
- **`APP_KEY` is generated automatically** and stored in Secret Manager, materialised
  into the namespace via the Secret Store CSI driver. This Laravel key encrypts
  sensitive fields and **must never be rotated after first boot**.
- **`STATIC_CRON_TOKEN` is generated automatically.** Firefly does no background
  scheduling on its own; hit `GET /api/v1/cron/<STATIC_CRON_TOKEN>` daily (a Kubernetes
  CronJob or Cloud Scheduler) to run recurring transactions, bills, and auto-budgets.
- **Exposed via an external LoadBalancer** with `session_affinity = ClientIP` so a
  user's session stays on one pod.
- **Set `APP_URL` to the external host.** The URL is not known at plan time; set
  `application_domains` (or `APP_URL` via `environment_variables`) once the
  LoadBalancer IP is assigned so Firefly builds correct absolute links.
- **First run is `/register`.** No admin is pre-seeded — the first account created
  becomes the owner/administrator. Disable open registration afterward.
- **NFS is enabled by default** to persist attachments and runtime data at
  `/var/lib/fireflyiii`.
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Firefly III workload

Firefly III pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request.

- **Console:** Kubernetes Engine → Workloads → select the Firefly III workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Firefly III stores all application data in a managed Cloud SQL for PostgreSQL 15
instance. Pods reach it privately through the **Cloud SQL Auth Proxy sidecar** over
`127.0.0.1:5432`; no public IP is exposed. On first deploy an initialization Job
creates the application role and database and grants privileges.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the password
are surfaced in the [Outputs](#5-outputs). For the connection model, backups, and
password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage & NFS

A dedicated **Cloud Storage** uploads bucket is provisioned automatically. When NFS is
enabled (the default), Firefly III's attachments and runtime directory is mounted from
a Filestore/NFS volume at `/var/lib/fireflyiii`.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Two cryptographic secrets are generated automatically: the Laravel `APP_KEY` and the
`STATIC_CRON_TOKEN`. They are materialised into the namespace via the Secret Store CSI
driver. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"
  POD=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -n "$NAMESPACE" "$POD" -- env | grep -E 'APP_KEY|STATIC_CRON_TOKEN'
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Cron (recurring transactions)

Firefly III runs recurring transactions, bill reminders, and auto-budgets only when a
caller hits its cron endpoint. There is no in-process scheduler.

- Schedule a daily **Kubernetes CronJob** (or Cloud Scheduler) that runs
  `curl -s https://<host>/api/v1/cron/<STATIC_CRON_TOKEN>` — define it via the
  `cron_jobs` input.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can be
reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Firefly III Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role and database and
  grants privileges on the database and `public` schema. The job is safe to re-run.
- **Schema created on container start.** There is **no separate migrate job**. The
  `fireflyiii/core` image runs `php artisan migrate --force` and
  `firefly-iii:upgrade-database` on every boot, so upgrading `application_version`
  applies schema changes automatically once `db-init` has provisioned the database.
- **`APP_KEY` is immutable after first boot.** Rotating it makes all previously
  encrypted fields unreadable.
- **Set `APP_URL` to the external host** after the LoadBalancer IP is assigned:
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"fireflyiii","env":[
      {"name":"APP_URL","value":"https://firefly.example.com"}
    ]}]}}}}'
  ```
  Or set `application_domains` / `environment_variables` before deploying.
- **First run is `/register`.** Create the owner account, then disable further
  registration in **Administration → Settings**.
- **Cron endpoint drives recurring items.** Schedule a daily
  `GET <host>/api/v1/cron/<STATIC_CRON_TOKEN>`.
- **Health path.** The startup probe is TCP on port 8080. The liveness probe is HTTP
  on Firefly III's unauthenticated `/status` JSON endpoint (HTTP 200, no login).

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Firefly III are listed; every other input is inherited from
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
| `application_name` | `fireflyiii` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `fireflyiii/core` image tag; pin to a release (e.g. `version-6.1.21`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official `fireflyiii/core` image directly. |
| `min_instance_count` | `1` | Minimum replicas (GKE requires ≥ 1). |
| `max_instance_count` | `1` | Maximum replicas. |
| `container_port` | `8080` | Firefly III (Apache) listens on port 8080. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar; required for loopback connectivity to Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry before deployment. |
| `timeout_seconds` | `300` | Max request duration. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core values (`DB_CONNECTION`, `PGSQL_SSL_MODE`, `TRUSTED_PROXIES`, `APP_ENV`, `DB_HOST=127.0.0.1`) are set automatically; add `APP_URL`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `APP_KEY` and `STATIC_CRON_TOKEN` are injected automatically. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Resolves to `Deployment` when unset; set `StatefulSet` explicitly if needed. |
| `session_affinity` | `ClientIP` | Sticky routing keeps a user's session on one pod. |
| `network_tags` | `["nfsserver"]` | `nfsserver` is required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Not required — Firefly III stores all state in PostgreSQL. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Per-pod PVC settings. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Off by default because `max_instance_count = 1` (a PDB equal to the replica count blocks node drains). |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP port 8080 | Startup probe. |
| `liveness_probe` | HTTP `/status`, 300 s delay | Firefly III's unauthenticated JSON health endpoint. |
| `health_check_config` / `startup_probe_config` | App_GKE-level probes | Infrastructure probes. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Define a daily CronJob hit to `/api/v1/cron/<STATIC_CRON_TOKEN>`. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Firefly III. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Persist attachments and runtime data at `/var/lib/fireflyiii`. |
| `nfs_mount_path` | `/var/lib/fireflyiii` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create additional GCS buckets beyond the uploads bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional cache/session backend; Firefly III uses the database by default. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis endpoint and auth. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` | Falls back to the Common module's fixed `POSTGRES_15` when unset. |
| `application_database_name` | `fireflyiii` | Database name, injected as `DB_DATABASE`. Immutable after first deploy. |
| `application_database_user` | `fireflyiii` | Application user, injected as `DB_USERNAME`. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve; also sets `APP_URL`. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Recommended for personal-finance data.** Firefly III holds sensitive financial
> data — putting IAP in front restricts access to authenticated, authorized Google
> identities.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Firefly III. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

### Group 8 / 22 — Resource Quota, VPC-SC & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Namespace ResourceQuota. Memory values need binary suffixes (`4Gi`). |
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Firefly III. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all previously encrypted fields unreadable — data is effectively lost. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `PGSQL_SSL_MODE` (auto `prefer`) | Leave as set | High | Forcing `require` against the plaintext Auth Proxy loopback fails ("SSL is not enabled on the server"). |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for loopback connectivity to Cloud SQL. |
| `APP_URL` | External LoadBalancer / domain URL | High | An unset or wrong URL breaks absolute links, redirects, and OAuth callbacks. |
| `STATIC_CRON_TOKEN` / cron job | Schedule a daily hit | High | Without a scheduled cron call, recurring transactions, bills, and auto-budgets never fire. |
| `enable_nfs` | `true` | High | Disabling it puts attachments on ephemeral pod storage — files vanish on pod restart. |
| `session_affinity` | `ClientIP` | High | Without stickiness, session state can route to different pods and disrupt the UI. |
| `enable_iap` | enable for private data | High | Firefly III holds financial data; leaving it publicly reachable exposes it. |
| First-run registration | Disable after first admin | High | Leaving registration open lets anyone with the URL create an account. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Firefly III-specific
application configuration shared with the Cloud Run variant is described in
**[FireflyIII_Common](FireflyIII_Common.md)**.
