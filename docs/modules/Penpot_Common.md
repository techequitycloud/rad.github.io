---
title: "Penpot Common Shared Configuration Module"
description: "Shared configuration reference for the Penpot module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Penpot Common Shared Configuration Module

The `Penpot Common` module defines the Penpot design platform configuration for the RAD Modules ecosystem. It is an **almost-pure configuration module** — its only GCP resource is the auto-generated `PENPOT_SECRET_KEY` Secret Manager secret; everything else is a `config` output consumed by platform-specific wrapper modules (`Penpot CloudRun` and `Penpot GKE`).

## 1. Overview

**Purpose**: To centralise all Penpot-specific configuration (multi-service architecture, PostgreSQL 15 database setup, environment variable assembly, health probe configuration, GCS asset storage, and WebSocket pub/sub settings) in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── Penpot_CloudRun  ──┐
└── Penpot_GKE       ──┤── instantiate Penpot_Common
                       ↓
          Penpot_Common (this module)
          Creates: PENPOT_SECRET_KEY (Secret Manager)
          Produces: config, storage_buckets, secret_ids, secret_values, path
                       ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                       ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Key characteristics**:
- Uses **PostgreSQL 15** — unlike Ghost (MySQL 8.0), Penpot relies on PostgreSQL for all deployments. The database type is fixed and cannot be overridden.
- Creates **one Secret Manager secret** — an auto-generated `PENPOT_SECRET_KEY` (shared JWT signing key for the backend and exporter), exposed via the `secret_ids` / `secret_values` outputs. No other GCP resources are created.
- Defines the **backend service** (Clojure HTTP API + WebSocket server on port 6060). The frontend (nginx React SPA on port 8080) and exporter (headless Chromium for PDF/PNG/SVG export) are assembled by the wrapper modules — see §4.
- The wrappers default `container_protocol` to **`"http1"`** — WebSockets work over HTTP/1.1 Upgrade; `h2c` breaks Penpot's HTTP/1.1 nginx frontend (502 "protocol error").
- Penpot runs its **own schema migrations at startup**; `Penpot Common` provides a built-in `db-init` job that creates the PostgreSQL database and user before first boot.
- Assembles `PENPOT_FLAGS`, `PENPOT_STORAGE_BACKEND`, `PENPOT_STORAGE_GCS_BUCKET_NAME`, `PENPOT_REDIS_URI`, `JVM_OPTS`, and SMTP variables from the module's input variables, producing a consistent environment regardless of whether the wrapper targets Cloud Run or GKE.

---

## 2. Outputs

### `config`

The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `"penpot"` |
| `application_version` | Version tag (default: `"latest"`) |
| `container_image` | `"penpotapp/backend"` — official Penpot backend image from Docker Hub |
| `image_source` | `"prebuilt"` — the official Penpot images are used directly; no custom build step |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `true`) — mirrors all three images to Artifact Registry |
| `container_port` | `6060` — Penpot backend HTTP API and WebSocket port |
| `database_type` | `"POSTGRES_15"` — Penpot requires PostgreSQL 15 |
| `db_name` | Database name (default: `"penpot"`) |
| `db_user` | Database user (default: `"penpot"`) |
| `enable_cloudsql_volume` | Whether to mount the Cloud SQL Auth Proxy sidecar (default: `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_resources` | CPU: `2000m`, Memory: `2Gi` (default) — JVM requires more memory than typical interpreted-language applications |
| `environment_variables` | Assembled Penpot environment variables — see §7 |
| `additional_services` | `[]` — the frontend and exporter are assembled by the wrapper modules, not here (see §4) |
| `startup_probe` | `var.startup_probe` (module default: HTTP `/api/health`) — both wrappers override to TCP; see §5 |
| `liveness_probe` | `var.liveness_probe` (module default: HTTP `/api/health`) — overridden per platform (Cloud Run: disabled; GKE: TCP); see §5 |

### `storage_buckets`

A list of GCS bucket configurations for provisioning by the platform module:

| Field | Value |
|---|---|
| `name_suffix` | `"assets"` — the platform module derives the full bucket name (`gcs-<service-name>-assets`) |
| `location` | Deployment region |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` |

### `secret_ids` / `secret_values`

`secret_ids` maps `PENPOT_SECRET_KEY` to the Secret Manager secret ID
(`secret-<prefix>-penpot-key`) for injection as a secret environment variable; `secret_values`
(sensitive) exposes the generated value itself.

### `path`

The absolute path to the module directory, used by wrapper modules to locate the `scripts/` directory.

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"penpot"` | Application name |
| `application_version` | `string` | `"latest"` | Penpot Docker image tag applied to all three service images |
| `description` | `string` | `"Penpot is an open-source design and prototyping tool"` | Application description |
| `db_name` | `string` | `"penpot"` | PostgreSQL database name |
| `db_user` | `string` | `"penpot"` | PostgreSQL application user |
| `cpu_limit` | `string` | `"2000m"` | Backend container CPU limit |
| `memory_limit` | `string` | `"2Gi"` | Backend container memory limit |
| `min_instance_count` | `number` | `1` | Minimum number of backend instances. Set to 1 or higher — scale-to-zero breaks active WebSocket sessions. |
| `max_instance_count` | `number` | `3` | Maximum number of backend instances |
| `enable_image_mirroring` | `bool` | `true` | Mirror all Penpot images to Artifact Registry |
| `enable_cloudsql_volume` | `bool` | `true` | Mount Cloud SQL Auth Proxy sidecar socket |
| `environment_variables` | `map(string)` | `{}` | Additional environment variables merged into the backend container |
| `initialization_jobs` | `list(any)` | `[]` | Custom init jobs. Leave empty to use the built-in `db-init` job (creates the PostgreSQL database and user); Penpot runs its own schema migrations at startup. |

### Penpot Configuration

| Variable | Type | Default | Description |
|---|---|---|---|
| `penpot_flags` | `string` | `"enable-registration enable-login disable-demo-users"` | Space-separated Penpot feature flags passed as `PENPOT_FLAGS` |
| `public_uri` | `string` | `""` | Public URL where users access Penpot. Sets `PENPOT_PUBLIC_URI`. Auto-detected from the frontend service URL when empty. |
| `jvm_max_heap` | `string` | `"1g"` | JVM maximum heap size. Sets `-Xmx` in `JVM_OPTS`. |
| `jvm_min_heap` | `string` | `"512m"` | JVM initial heap size. Sets `-Xms` in `JVM_OPTS`. |

### Redis

| Variable | Type | Default | Description |
|---|---|---|---|
| `redis_host` | `string` | `null` | Redis hostname or IP for the WebSocket pub/sub bus. Defaults to NFS server IP when null. |
| `redis_port` | `string` | `"6379"` | Redis port |
| `redis_auth` | `string` | `""` | Redis AUTH password (sensitive) |
| `nfs_server_ip` | `string` | `null` | NFS server IP used as fallback when `redis_host` is null |

### SMTP

| Variable | Type | Default | Description |
|---|---|---|---|
| `smtp_enabled` | `bool` | `false` | Enable SMTP. Required for invitations and password resets. |
| `smtp_from` | `string` | `""` | Default sender email address |
| `smtp_reply_to` | `string` | `""` | Default reply-to address |
| `smtp_host` | `string` | `""` | SMTP server hostname |
| `smtp_port` | `number` | `587` | SMTP port |
| `smtp_username` | `string` | `""` | SMTP authentication username |
| `smtp_use_tls` | `bool` | `true` | Enable STARTTLS |
| `smtp_use_ssl` | `bool` | `false` | Enable SSL/TLS |

### Storage & Volumes

| Variable | Type | Default | Description |
|---|---|---|---|
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volume mounts (name, bucket_name, mount_path, readonly, mount_options) |
| `startup_probe` | `object` | See §5 | Startup probe configuration |
| `liveness_probe` | `object` | See §5 | Liveness probe configuration |

---

## 4. Multi-Service Architecture

Penpot is a three-tier application. `Penpot Common` defines only the backend; the wrapper
modules assemble the other two tiers. On Cloud Run all three run as **one multi-container
service** — the frontend is the ingress container and the backend and exporter are in-pod
sidecars reached over localhost. On GKE the frontend and exporter are deployed as separate
additional services alongside the backend.

### Backend (`penpotapp/backend`)

- **Image**: `penpotapp/backend:<version>`
- **Port**: `6060`
- **Protocol**: HTTP/1.1 (`http1`) — WebSockets use the HTTP/1.1 Upgrade mechanism
- **Role**: Clojure HTTP API server, WebSocket handler for real-time collaboration, database interface, asset management via GCS
- **Environment**: Receives all assembled Penpot env vars (see §7)
- **Auth Proxy**: Cloud SQL Auth Proxy sidecar for PostgreSQL connectivity
- **Migrations**: Runs automatically at startup — no separate init job required

### Frontend (`penpotapp/frontend`)

- **Image**: `penpotapp/frontend:<version>`
- **Port**: `8080` (Penpot's frontend nginx listens on 8080, not 80)
- **Role**: nginx server delivering the React SPA to designers' browsers. All design editing happens client-side in the browser; the backend handles persistence and real-time sync.
- **URL**: The `PENPOT_PUBLIC_URI` is set to this service's URL. Users access Penpot through the frontend, whose nginx proxies `/api` and `/ws` to the backend. On Cloud Run the frontend is the ingress container, so the frontend URL **is** the main service URL.

### Exporter (`penpotapp/exporter`)

- **Image**: `penpotapp/exporter:<version>`
- **Port**: `6061`
- **Role**: Headless Chromium instance that renders Penpot designs and exports them to PDF, PNG, or SVG. Called by the backend when a designer triggers an export operation. Shares the `PENPOT_SECRET_KEY` JWT secret with the backend.
- **Resources**: Headless Chromium is resource-intensive; the exporter service is sized independently of the backend.

---

## 5. Health Probes

Penpot 2.x does **not** expose an unauthenticated HTTP health endpoint — `/api/health` returns
404 on the backend (the real readiness path is `/readyz`). Both wrappers therefore default to
**TCP probes on the backend port (6060)**, which pass once the JVM is listening. The module's
own `startup_probe`/`liveness_probe` variable defaults still carry the HTTP `/api/health`
shape, but every wrapper overrides the probe type to TCP.

### Cloud Run Probes (from `Penpot_CloudRun` variables.tf)

Cloud Run does not support TCP liveness probes. The startup probe uses TCP to check that the JVM is listening before attempting HTTP health checks.

| Probe | Type | Port / Path | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|---|---|
| **Startup** | TCP | 6060 | 5s | 5s | 5s | 40 | Allows up to 200s total for JVM init + PostgreSQL migration. TCP confirms the port is open. |
| **Liveness** | — | (disabled) | — | — | — | — | Cloud Run TCP liveness unsupported. Use `health_check_config` instead. |
| **startup_probe_config** | TCP | — | 0s | 240s | 240s | 1 | Alternative probe for LB health checks. |
| **health_check_config** | HTTP | `/api/health` | 0s | 1s | 10s | 3 | HTTP liveness check once the backend is ready. |

### GKE Probes (from `Penpot_GKE` variables.tf)

On GKE both probes are **TCP on port 6060** — an HTTP probe against `/api/health` would 404 and
restart-loop a healthy backend.

| Probe | Type | Port | Initial Delay | Timeout | Period | Failure Threshold | Purpose |
|---|---|---|---|---|---|---|---|
| **Startup** | TCP | 6060 | 30s | 10s | 10s | 30 | Allows 30s initial delay + 30 × 10s = 330s total for JVM + migrations. |
| **Liveness** | TCP | 6060 | 60s | 10s | 30s | 3 | Restarts the pod if Penpot stops listening. |

The generous startup probe thresholds accommodate Penpot's migration process on a fresh database, which can be slow on first deployment.

---

## 6. Secrets Generated

Like Django Common (which generates a `SECRET_KEY`), **`Penpot Common` generates one
application-level secret**: `PENPOT_SECRET_KEY`, a 64-character random value stored in Secret
Manager as `secret-<prefix>-penpot-key`. It is the shared JWT signing key used by the backend
and the exporter, and is exposed to the wrappers via the `secret_ids` output (injected as a
secret environment variable) and the sensitive `secret_values` output.

The `DB_PASSWORD` secret is provisioned automatically by `App CloudRun` / `App GKE` and is injected into the backend container as `DB_PASSWORD`. The backend's entrypoint shell wrapper maps this to `PENPOT_DATABASE_PASSWORD` at container startup.

If SMTP authentication is required, the SMTP password must be provided via `secret_environment_variables` in the wrapper module — `Penpot Common` does not provision it.

---

## 7. Environment Variable Assembly

`Penpot Common` assembles the following environment variables and passes them through `config.environment_variables` to the platform module. These are injected into the Penpot backend container at runtime.

### Core Penpot Variables

| Environment Variable | Source | Description |
|---|---|---|
| `PENPOT_FLAGS` | `var.penpot_flags` | Space-separated feature flags controlling registration, login, and optional features |
| `PENPOT_PUBLIC_URI` | `var.public_uri` (or auto-detected) | The URL users use to access Penpot. Used in invitation emails and WebSocket routing. Must match the actual frontend URL. |
| `PENPOT_TELEMETRY_ENABLED` | `"false"` | Telemetry disabled by default for self-hosted deployments |
| `PENPOT_HTTP_SERVER_HOST` | `"0.0.0.0"` | Binds to all interfaces — required for Cloud Run and GKE container networking |
| `PENPOT_HTTP_SERVER_PORT` | `"6060"` | Must match `container_port` |

### Database Variables

| Environment Variable | Source | Description |
|---|---|---|
| `PENPOT_DATABASE_URI` | Built at container start from `DB_IP`, `DB_NAME` | The entrypoint shell wrapper exports `postgresql://$DB_IP:5432/$DB_NAME` (TCP to the instance private IP) |
| `PENPOT_DATABASE_USERNAME` | `DB_USER` | Exported by the entrypoint shell wrapper from the platform-injected `DB_USER` |
| `PENPOT_DATABASE_PASSWORD` | `DB_PASSWORD` (from Secret Manager) | Exported by the entrypoint shell wrapper from the platform-injected secret |

### Storage Variables

| Environment Variable | Source | Description |
|---|---|---|
| `PENPOT_STORAGE_BACKEND` | `"gcs"` | Instructs the backend to use Google Cloud Storage for asset persistence |
| `PENPOT_STORAGE_GCS_BUCKET_NAME` | Auto-set to `gcs-<service-name>-assets` | The assets bucket provisioned from `Penpot Common`'s `storage_buckets` output |

### Redis Variables

| Environment Variable | Source | Description |
|---|---|---|
| `PENPOT_REDIS_URI` | Assembled from `redis_host`:`redis_port` (Terraform-computed default), then re-exported by the entrypoint shell wrapper | WebSocket pub/sub event bus URI. Format: `redis://HOST:PORT/0`. The Terraform-side default falls back to `nfs_server_ip` (or the `$(NFS_SERVER_IP)` placeholder) when `redis_host` is empty, primarily so additional services can reference it. At container startup the entrypoint shell wrapper re-exports `PENPOT_REDIS_URI` from the live `NFS_SERVER_IP` (falling back to `REDIS_HOST`) and `REDIS_PORT` env vars, which takes precedence over the static Terraform value. |

### JVM Variables

| Environment Variable | Source | Description |
|---|---|---|
| `JVM_OPTS` | Assembled from `jvm_min_heap`, `jvm_max_heap` | Sets `-Xms` (initial heap) and `-Xmx` (maximum heap). Default: `"-Xmx1g -Xms512m"`. |

### SMTP Variables (when `smtp_enabled = true`)

| Environment Variable | Source | Description |
|---|---|---|
| `PENPOT_SMTP_ENABLED` | `"true"` when `smtp_enabled = true` | Enables outbound email |
| `PENPOT_SMTP_DEFAULT_FROM` | `var.smtp_from` | Default sender address |
| `PENPOT_SMTP_DEFAULT_REPLY_TO` | `var.smtp_reply_to` | Default reply-to address |
| `PENPOT_SMTP_HOST` | `var.smtp_host` | SMTP server hostname |
| `PENPOT_SMTP_PORT` | `var.smtp_port` | SMTP port (number, converted to string) |
| `PENPOT_SMTP_USERNAME` | `var.smtp_username` | SMTP authentication username |
| `PENPOT_SMTP_USE_TLS` | `var.smtp_use_tls` | STARTTLS flag |
| `PENPOT_SMTP_USE_SSL` | `var.smtp_use_ssl` | SSL/TLS flag |

When `smtp_enabled = false`, none of the `PENPOT_SMTP_*` variables are injected, and Penpot operates without outbound email.

---

## 8. Platform-Specific Differences

| Aspect | Penpot CloudRun | Penpot GKE |
|---|---|---|
| **Startup probe type** | TCP (port 6060) — Cloud Run does not support TCP liveness, only TCP startup | TCP (port 6060) — `/api/health` 404s on the backend, so HTTP probes are not used |
| **Liveness probe** | Disabled — Cloud Run does not support TCP liveness probes; `health_check_config` is used instead | TCP (port 6060) — 60s initial delay, 30s period |
| **`min_instance_count`** | `0` (default, user-configurable) — set to `1` or more to keep active WebSocket sessions warm | `1` (default, user-configurable) — no scale-to-zero in production |
| **`container_protocol`** | `"http1"` — WebSockets work over HTTP/1.1 Upgrade; `h2c` breaks the HTTP/1.1 nginx frontend (502 "protocol error") | `"http1"` (default) — standard HTTP/1.1 to the pods |
| **`session_affinity`** | Not applicable in Cloud Run (managed load balancing) | `"ClientIP"` default — important for Penpot WebSocket stability; routes repeat clients to the same pod |
| **`PENPOT_PUBLIC_URI`** | Set to the predicted frontend Cloud Run service URL (using the deployment ID and project naming convention) | Must be set explicitly via `environment_variables` for GKE — no equivalent auto-detection |
| **`DB_HOST`** | Cloud SQL Auth Proxy socket path (`/cloudsql/...`) | Cloud SQL private IP address |
| **`enable_nfs`** | `true` (default) — NFS server also serves as the fallback Redis host | `true` (default) — same NFS fallback Redis pattern |
| **Image source** | `"prebuilt"` — official Penpot Docker Hub images, mirrored to Artifact Registry | `"prebuilt"` — same |
| **Additional services** | None — single multi-container service: frontend is the ingress container, backend and exporter are in-pod sidecars on localhost | Frontend and exporter as GKE Deployment additional services |

---

## 9. Penpot Feature Flags Reference

The `penpot_flags` variable accepts a space-separated list of flags. These are passed directly to the backend as the `PENPOT_FLAGS` environment variable. The most commonly used flags:

| Flag | Effect |
|---|---|
| `enable-registration` | Allow new users to self-register. Appropriate for open or internal team deployments. |
| `disable-registration` | Block self-registration. Admins must invite users by email. Use for closed-team or client deployments. |
| `enable-login-with-password` | Allow login with email and password (default authentication method). |
| `enable-oidc-google` | Enable Google OAuth OIDC SSO login. Requires OIDC client credentials to be configured. |
| `enable-oidc-github` | Enable GitHub OAuth OIDC SSO login. |
| `disable-demo-users` | Prevent creation of demo/guest accounts. Recommended for production. |
| `enable-webhooks` | Enable webhook callbacks for design events. |
| `enable-email-verification` | Require new users to verify their email address before accessing the platform. |

Flags are additive and space-separated. The default value `"enable-registration enable-login disable-demo-users"` is appropriate for initial setup. For a closed-team deployment:

```
penpot_flags = "disable-registration enable-login-with-password disable-demo-users enable-email-verification"
```

For an SSO-only deployment (no password login):

```
penpot_flags = "disable-registration enable-oidc-google disable-demo-users"
```

---

## 10. Implementation Pattern

The following shows how `Penpot_CloudRun` instantiates `Penpot_Common` and passes its outputs to `App_CloudRun`:

```hcl
# Penpot_CloudRun calls Penpot_Common for application config
module "penpot_app" {
  source = "../Penpot_Common"

  application_version    = var.application_version
  db_name                = var.db_name
  db_user                = var.db_user
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  penpot_flags           = var.penpot_flags
  jvm_max_heap           = var.jvm_max_heap
  jvm_min_heap           = var.jvm_min_heap
  smtp_enabled           = var.smtp_enabled
  smtp_host              = var.smtp_host
  smtp_port              = var.smtp_port
  smtp_from              = var.smtp_from
  smtp_reply_to          = var.smtp_reply_to
  smtp_username          = var.smtp_username
  smtp_use_tls           = var.smtp_use_tls
  smtp_use_ssl           = var.smtp_use_ssl
  enable_cloudsql_volume = var.enable_cloudsql_volume
  enable_image_mirroring = var.enable_image_mirroring
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
}

# Assemble the four locals the Foundation Module consumes
locals {
  application_modules    = { penpot = module.penpot_app.config }
  module_env_vars        = { REDIS_HOST = var.redis_host }
  module_secret_env_vars = module.penpot_app.secret_ids  # PENPOT_SECRET_KEY
  module_storage_buckets = module.penpot_app.storage_buckets
  scripts_dir            = abspath("${module.penpot_app.path}/scripts")
}

# Pass assembled config to App_CloudRun
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_modules    = local.application_modules
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... all other variables passed through
}
```

---

## 11. Exploring with the GCP Console

`Penpot Common` creates only the `PENPOT_SECRET_KEY` secret directly. After deployment, the other resources it defines (the `gcs-<service-name>-assets` GCS bucket, the backend environment variables) are visible through the wrapper module's infrastructure.

**Verifying the assets bucket:**

Navigate to **Cloud Storage → Buckets** and search for `assets` (the bucket is named `gcs-<service-name>-assets`). Confirm:
- Bucket exists in the expected region.
- Access control is uniform bucket-level access (`public_access_prevention = "inherited"`).
- The Cloud Run SA or GKE Workload Identity SA has `roles/storage.objectAdmin` in the bucket's IAM policy.

**Verifying the backend environment:**

Navigate to **Cloud Run** (or **GKE → Workloads** for the GKE variant), select the Penpot backend service, and click **Edit & Deploy New Revision** (you do not need to save). In the **Container** tab, scroll to **Variables & Secrets** to confirm:

- `PENPOT_FLAGS` is set correctly.
- `PENPOT_STORAGE_BACKEND` is `gcs`.
- `PENPOT_STORAGE_GCS_BUCKET_NAME` points to the correct bucket.
- `PENPOT_REDIS_URI` points to the expected Redis host.
- `JVM_OPTS` contains the expected `-Xmx` and `-Xms` values.
- `PENPOT_SMTP_ENABLED` is `true` if SMTP was configured.

**Checking the health endpoint:**

Once the backend is deployed, its `/readyz` endpoint returns HTTP 200 when the application is
ready (note: `/api/health` returns 404 — Penpot 2.x has no such path). From Cloud Shell or a
machine with access to the service URL:

```bash
curl -o /dev/null -s -w "%{http_code}\n" https://BACKEND_SERVICE_URL/readyz
```

A response of `200` confirms the backend has completed PostgreSQL migrations and is ready to serve requests.

---

## 12. Exploring with gcloud

The following commands help verify what `Penpot Common` has assembled and confirm the assets bucket is correctly configured.

**Verify the assets bucket exists and has the correct region:**
```bash
gcloud storage buckets describe gs://gcs-SERVICE_NAME-assets \
  --format="table(name,location,storageClass,iamConfiguration.publicAccessPrevention)"
```

**Check the IAM policy on the assets bucket:**
```bash
gcloud storage buckets get-iam-policy gs://gcs-SERVICE_NAME-assets \
  --format="table(bindings.role,bindings.members)"
```

**Verify the backend Cloud Run service environment (check PENPOT_FLAGS, JVM_OPTS, PENPOT_STORAGE_BACKEND):**
```bash
gcloud run services describe SERVICE_NAME \
  --project=PROJECT_ID \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**Check that PENPOT_REDIS_URI is set correctly in the running revision:**
```bash
gcloud run revisions describe REVISION_NAME \
  --project=PROJECT_ID \
  --region=REGION \
  --format="json" | \
  python3 -c "import sys,json; [print(e['name'],'=',e.get('value','[secret]')) for e in json.load(sys.stdin)['spec']['containers'][0]['env'] if 'PENPOT' in e['name'] or 'JVM' in e['name']]"
```

**List all objects in the assets bucket (design thumbnails and uploaded files):**
```bash
gcloud storage ls gs://gcs-SERVICE_NAME-assets --recursive | head -50
```

**Check the size of the assets bucket (useful for estimating growth):**
```bash
gcloud storage du gs://gcs-SERVICE_NAME-assets --summarize
```

**Confirm the Cloud SQL PostgreSQL 15 instance is running:**
```bash
gcloud sql instances list \
  --project=PROJECT_ID \
  --filter="databaseVersion:POSTGRES_15" \
  --format="table(name,state,databaseVersion,region,settings.dataDiskSizeGb)"
```

**Verify the `penpot` database and user exist:**
```bash
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,charset,collation)"

gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,type)"
```

**Test the `/readyz` endpoint from Cloud Shell:**
```bash
# Replace with the actual backend Cloud Run service URL
curl -s -o /dev/null -w "%{http_code}\n" https://BACKEND_URL/readyz
```

**Check Cloud Logging for Penpot backend startup and migration output:**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="penpot-backend" AND textPayload:"migration"' \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```
