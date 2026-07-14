---
title: "Rallly on GKE Autopilot"
description: "Configuration reference for deploying Rallly on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Rallly on GKE Autopilot

Rallly is an open-source, self-hosted meeting-scheduling and group-poll application —
a privacy-friendly alternative to Doodle — built with Next.js and Prisma. This module
deploys Rallly on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Rallly uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating
them here.

---

## 1. Overview

Rallly runs as a single Next.js web workload. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js pods, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Rallly does not support MySQL or other engines |
| Email | SMTP relay (external) | Passwordless email login; provide your own SMTP host/credentials |
| Secrets | Secret Manager | Auto-generated `SECRET_PASSWORD` and `NEXTAUTH_SECRET`; optional `SMTP_PWD`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer Service, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup. All Rallly state
  (polls, votes, comments, users) lives in this database.
- **`SECRET_PASSWORD` and `NEXTAUTH_SECRET` are generated automatically** and stored
  in Secret Manager. These keys must not be rotated after first boot without a
  maintenance window — rotating `SECRET_PASSWORD` invalidates previously encrypted
  data, and rotating `NEXTAUTH_SECRET` invalidates all active sessions and in-flight
  login links.
- **Rallly login is passwordless and email-based.** Users register and sign in by
  receiving a verification link/code, so a working SMTP configuration is effectively
  required before anyone can log in. On this variant `smtp_host` is empty by default;
  set `smtp_host`, `smtp_user`, and `smtp_password` to enable email.
- **The public base URL must be set for external access.** `NEXT_PUBLIC_BASE_URL` /
  `NEXTAUTH_URL` come from `base_url`. Set it to the external LoadBalancer or custom
  domain URL once known, so invite and login links resolve to the address users visit.
- **`Deployment` workload, stateless on disk.** `workload_type = Deployment` with no
  PVC — Rallly keeps all state in PostgreSQL, so pods are freely replaceable.
- **NFS and Redis are disabled.** Rallly needs no shared filesystem or cache; both are
  off by default (Redis is hard-wired off).
- **Migrations run on start.** The container's own `./docker-start.sh` runs
  `prisma migrate deploy` on every boot, so version upgrades apply schema changes
  without a separate migration step. The `db-init` job only provisions the empty
  database and role.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Rallly workload

Rallly pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Rallly workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Rallly stores all application data (polls, options, participants, votes, comments, and
user accounts) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
privately through the **Cloud SQL Auth Proxy** sidecar over loopback
(`enable_cloudsql_volume = true`); no public IP is exposed. On first deploy the
`db-init` Job creates the application database and role; Rallly then applies its own
Prisma schema on start.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database (`rallly`), user (`rallly`), and the Secret Manager secret
holding the password are all surfaced in the [Outputs](#5-outputs). For the connection
model, automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Email (SMTP)

Rallly sends login/verification and invitation emails through an external SMTP relay.
When `smtp_host` is set, the pod receives `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_SECURE`, and the `SMTP_PWD` secret. There is no managed Google email service —
supply your own (SendGrid, Mailgun, Gmail SMTP, etc.).

- **CLI (verify the injected settings in the running pod):**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'SMTP_|NEXT_PUBLIC_BASE_URL'
  ```

### D. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`SECRET_PASSWORD` (Rallly's data-encryption / session secret) and `NEXTAUTH_SECRET`
(signs NextAuth session tokens and email login links). A third, `SMTP_PWD`, is created
only when SMTP is configured. The database password is managed separately by the
foundation. Secrets are projected into the pod through the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~rallly"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP reserved so the address survives redeploys. Set `base_url`
to the external URL so Rallly's invite and login links match the address users visit.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Rallly Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application database and role, grants privileges, and then signals the
  proxy to shut down. It is configured with `max_retries = 3` and is safe to re-run.
- **Schema migrations on start.** Rallly's own `./docker-start.sh` runs
  `prisma migrate deploy` on every startup, so the schema is created on the first boot
  after `db-init` and upgrading the application version applies schema changes without
  a separate migration step.
- **`SECRET_PASSWORD` and `NEXTAUTH_SECRET` are immutable after first boot.** They are
  generated once and written to Secret Manager. Changing `SECRET_PASSWORD` invalidates
  previously encrypted data; changing `NEXTAUTH_SECRET` invalidates all active sessions
  and in-flight login links. Only rotate during a planned maintenance window.
- **Passwordless email login.** Rallly authenticates users via emailed verification
  links/codes. Without a working SMTP relay, users cannot receive login emails and
  effectively cannot sign in. Confirm SMTP settings in the running pod after deploy.
- **Public base URL requires the external IP.** Set `base_url` (or `environment_variables`
  `NEXT_PUBLIC_BASE_URL`) to the external LoadBalancer or custom domain URL once the IP
  is assigned, so invite and login links resolve correctly:
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
- **Health path.** Startup and liveness probes target `/api/status` — Rallly's public,
  unauthenticated status endpoint. Allow time on first boot for the Prisma migration
  step (the default startup probe provides a 30-second initial delay plus a 20-retry,
  15-second-interval window).
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Rallly are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 2 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `rallly` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Rallly image tag (`lukevella/rallly`); pin to a specific release in production. |

### Group 3 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; Rallly API operations and asset transformation benefit from at least 1 vCPU. |
| `memory_limit` | `2Gi` | Memory per pod. |
| `min_instance_count` | `0` | Minimum replicas. |
| `max_instance_count` | `3` | Maximum replicas; Rallly is stateless in Postgres and can scale horizontally. |
| `container_port` | `3000` | Rallly listens on port 3000. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback) for PostgreSQL. |
| `base_url` | `""` | Public URL for `NEXT_PUBLIC_BASE_URL` / NextAuth links. Set to the external LoadBalancer or custom domain URL. |

### Group 5 — Access, Ingress & Email

| Variable | Default | Description |
|---|---|---|
| `smtp_host` | `""` | SMTP relay hostname. A non-empty value provisions `SMTP_PWD` and injects the `SMTP_*` env vars. Required for email login. |
| `smtp_port` | `587` | SMTP port (587 STARTTLS, 465 SSL). |
| `smtp_user` | `""` | SMTP username — set this (with `smtp_password`) to enable email login. |
| `smtp_password` | `""` (sensitive) | SMTP password. Empty → an auto-generated secret is stored. |
| `smtp_secure_enabled` | `false` | Enable implicit TLS/SSL (true for port 465). |
| `mail_from` | `""` | Sender address for `NOREPLY_EMAIL` / `SUPPORT_EMAIL`. Empty → `noreply@rallly.local`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `Deployment` | Deployment (stateless) — Rallly stores all state in PostgreSQL. |

### Group 11 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `rallly` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `rallly` | Application database user. Password auto-generated in Secret Manager. |
| `database_type` | `POSTGRES_15` | Fixed — Rallly requires PostgreSQL 15. |

### Group 13 — Filesystem & Observability

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off — Rallly needs no shared filesystem. |
| `startup_probe` | HTTP `/api/status`, 0s initial delay, 10 failures | Startup probe; allow for the first-boot Prisma migration. |
| `liveness_probe` | HTTP `/api/status` 60s delay | Liveness probe. |

### Group 20 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Rallly uses no Redis; leave disabled. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_url` | URL to reach Rallly. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (none by default for Rallly). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — `min_instance_count > max_instance_count`, IAP with no OAuth client id/secret, `enable_redis` without a `redis_host` or NFS, `enable_cloudsql_volume = true` with `database_type = NONE`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_PASSWORD` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates previously encrypted data and active sessions. |
| `NEXTAUTH_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active sessions and in-flight email login links. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Rallly supports only PostgreSQL 15; any other engine breaks startup. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `smtp_host` / `smtp_user` / `smtp_password` | Set to enable email | High | Without a working SMTP relay, login emails never send and users cannot sign in. |
| `base_url` | External LoadBalancer / custom domain URL | High | If left empty, invite and login links do not resolve to the address users visit. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; a plan-time guard blocks it with `database_type = NONE`. |
| `min_instance_count` / `max_instance_count` | `min ≤ max` | High | An inverted range creates a conflicting HPA configuration; the validation guard rejects it. |
| `enable_redis` | `false` | Medium | Rallly uses no Redis; enabling it without a `redis_host` or NFS is rejected by the validation guard. |
| `startup_probe` timing | Keep the generous default | Medium | Too tight a window can fail the probe during the first-boot Prisma migration. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Rallly-specific
application configuration shared with the Cloud Run variant is described in
**[Rallly_Common](Rallly_Common.md)**.
