# OpenClaw_Common Shared Configuration Module

The `OpenClaw_Common` module defines the OpenClaw AI gateway configuration for the RAD Modules ecosystem. It **creates GCP resources** (Secret Manager secrets for API credentials and optional messaging platform tokens) and produces a `config` output consumed by platform-specific wrapper modules (`OpenClaw_CloudRun` and `OpenClaw_GKE`).

## 1. Overview

**Purpose**: To centralize all OpenClaw-specific container configuration — including the custom container image build, GCS Fuse workspace volume, automatically injected environment variables, messaging platform credential secrets, and skills repository sync — in a single module shared by both Cloud Run and GKE deployments.

**Architecture**:

```
Layer 3: Application Wrappers
├── OpenClaw_CloudRun  ──┐
└── OpenClaw_GKE       ──┤── instantiate OpenClaw_Common
                          ↓
            OpenClaw_Common (this module)
            Creates: 1–5 Secret Manager secrets
            Produces: config, storage_buckets, secret_ids,
                      secret_values, path,
                      telegram_webhook_secret_id,
                      slack_signing_secret_id
                          ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                          ↓
Layer 1: App_Common (networking, storage, secrets, IAM)
```

**Key characteristics**:
- Builds a **custom container image** that layers `entrypoint.sh` onto the upstream `ghcr.io/openclaw/openclaw` gateway image. The build arg `BASE_IMAGE` is set to `ghcr.io/openclaw/openclaw:<application_version>`.
- **No database, no Redis** — OpenClaw is a stateful Node.js gateway backed entirely by GCS Fuse (`/data`). `database_type = null` is set in the config (wrappers override this to `"NONE"` for platform compatibility).
- The `openclaw-data` GCS Fuse volume (`/data`) is always appended to `gcs_volumes` with `uid=1000,gid=1000` mount options.
- `OPENCLAW_STATE_DIR` and `XDG_CONFIG_HOME` are set to `/tmp/openclaw` to avoid running npm staging operations on the GCS Fuse mount (which does not support hard links or high-concurrency renames).
- Supports optional Telegram and Slack channel integrations via Secret Manager — each platform requires two secrets (bot/access token + webhook/signing secret).
- A 30-second `time_sleep` propagation delay is applied after secret versions are written before the `secret_ids` output is resolved.

---

## 2. GCP Resources Created

### Secret Manager Secrets

| Secret ID suffix | Enabled when | Injected into container | Purpose |
|---|---|---|---|
| `-anthropic-api-key` | Always (required) | Yes — `ANTHROPIC_API_KEY` | Anthropic API key for the OpenClaw agent |
| `-telegram-bot-token` | `enable_telegram = true` | Yes — `TELEGRAM_BOT_TOKEN` | Telegram bot token for sending messages |
| `-telegram-webhook-secret` | `enable_telegram = true` | No — router use only | Validates incoming Telegram webhook payloads |
| `-slack-bot-token` | `enable_slack = true` | Yes — `SLACK_BOT_TOKEN` | Slack bot token for posting messages |
| `-slack-signing-secret` | `enable_slack = true` | No — router use only | Verifies Slack request signatures |

All secrets use automatic global replication. A 30-second `time_sleep` is applied after all configured secret versions are written. Secret versions are only written when the corresponding variable is non-empty — on update deployments where credentials are omitted, the existing Secret Manager version is preserved.

Webhook/signing secrets (Telegram and Slack) are stored in Secret Manager for use by a companion router service and are exposed via their own dedicated outputs. They are not injected into the OpenClaw agent container.

---

## 3. Outputs

### `config`
The application configuration object passed to the platform module via `application_config`.

| Field | Value / Description |
|-------|---------------------|
| `app_name` | From `application_name` (default: `"openclaw"`) |
| `display_name` | From `application_display_name` (default: `"OpenClaw Gateway"`) |
| `description` | From `description` |
| `container_image` | `"ghcr.io/openclaw/openclaw"` (base image for custom build) |
| `application_version` | From `application_version` (default: `"latest"`) |
| `image_source` | `"custom"` — a custom wrapper image is built |
| `enable_image_mirroring` | From `var.enable_image_mirroring` (default: `true`) |
| `container_build_config` | `enabled=true`, `dockerfile_path="Dockerfile"`, `context_path="."`, `build_args={ BASE_IMAGE = "ghcr.io/openclaw/openclaw:<version>" }` |
| `container_port` | `8080` |
| `database_type` | `null` (wrappers override to `"NONE"`) |
| `db_name` | `null` |
| `db_user` | `null` |
| `enable_cloudsql_volume` | `false` |
| `cloudsql_volume_mount_path` | `"/cloudsql"` (interface placeholder) |
| `gcs_volumes` | Caller's `gcs_volumes` + fixed `openclaw-data` volume at `/data` |
| `container_resources` | From `var.container_resources` if set, else `cpu_limit`/`memory_limit` |
| `min_instance_count` | From `var.min_instance_count` (default: `0`) |
| `max_instance_count` | From `var.max_instance_count` (default: `1`) |
| `environment_variables` | Fixed set merged with `var.environment_variables` — see §4 |
| `enable_postgres_extensions` | `false` |
| `postgres_extensions` | `[]` |
| `initialization_jobs` | `[]` — no default init job |
| `startup_probe` | From `var.startup_probe` |
| `liveness_probe` | From `var.liveness_probe` |
| `additional_services` | `[]` |

### `storage_buckets`
One GCS bucket for the OpenClaw workspace:

| Field | Value |
|-------|-------|
| `name_suffix` | `"openclaw-data"` |
| `name` | `<wrapper_prefix>-storage` (explicit name) |
| `location` | `var.deployment_region` |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` |

### `secret_ids`
A map of environment variable names to Secret Manager secret IDs for secrets injected into the agent container. Includes a `depends_on` on the 30-second propagation wait.

```hcl
{
  ANTHROPIC_API_KEY  = "<prefix>-anthropic-api-key"          # always present
  TELEGRAM_BOT_TOKEN = "<prefix>-telegram-bot-token"         # when enable_telegram = true
  SLACK_BOT_TOKEN    = "<prefix>-slack-bot-token"            # when enable_slack = true
}
```

### `telegram_webhook_secret_id`
Secret Manager secret ID for the Telegram webhook validation secret. Empty string when `enable_telegram = false`. Used by a companion router service.

### `slack_signing_secret_id`
Secret Manager secret ID for the Slack signing secret. Empty string when `enable_slack = false`. Used by a companion router service.

### `secret_values`
A **sensitive** map of raw credential values for GKE deployments that bypass Secret Manager read-after-write consistency. Only keys with non-empty input values are included — omitting a key causes the GKE Foundation to fall back to the `secret_ids` Secret Manager reference.

```hcl
{
  ANTHROPIC_API_KEY  = "<api-key>"       # when var.anthropic_api_key is non-empty
  TELEGRAM_BOT_TOKEN = "<token>"         # when enable_telegram + var.telegram_bot_token non-empty
  SLACK_BOT_TOKEN    = "<token>"         # when enable_slack + var.slack_bot_token non-empty
}
```

### `path`
Absolute path to the `OpenClaw_Common` module directory. Wrapper modules set `scripts_dir = abspath("${module.openclaw_app.path}/scripts")`.

---

## 4. Environment Variables

The module merges caller-provided `environment_variables` with a fixed set injected after the caller values (caller values are overridden by module-managed ones):

### Fixed Variables (always set by the module)

| Variable | Value | Purpose |
|----------|-------|---------|
| `OPENCLAW_STATE_DIR` | `"/tmp/openclaw"` | Points the gateway at a local (non-GCS) state directory. Avoids hard-link and rename failures on the GCS Fuse mount during npm staging |
| `XDG_CONFIG_HOME` | `"/tmp/openclaw"` | Same reason — prevents XDG config resolution from targeting GCS |
| `NODE_ENV` | `"production"` | Enables Node.js production mode |
| `NODE_OPTIONS` | `"--max-old-space-size=1536"` | Prevents Node.js OOM on 2 Gi containers; tune upward for larger memory limits |
| `SKILLS_REPO_URL` | From `var.skills_repo_url` (default: `""`) | URL of the shared skills repository to clone on startup |
| `SKILLS_REPO_REF` | From `var.skills_repo_ref` (default: `"main"`) | Git ref (branch, tag, or SHA) for the skills repository |
| `NPM_CONFIG_CACHE` | `"/tmp/.npm"` | Redirects npm cache to ephemeral local storage |

Agent workspace and `agentDir` are set to `/data` paths in the `openclaw.json` config written by `entrypoint.sh`, so persistent agent state is stored on the GCS Fuse volume while build-time operations use local disk.

---

## 5. Scripts and Container Image

All supporting files are in `scripts/`. The `scripts/` directory is used as both the Docker build context and the `scripts_dir` for wrapper modules.

### `Dockerfile`

Layers `entrypoint.sh` and `git` onto the upstream OpenClaw gateway image:

```dockerfile
ARG BASE_IMAGE=ghcr.io/openclaw/openclaw:latest
FROM ${BASE_IMAGE}

USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER 1000
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
```

The `BASE_IMAGE` build arg is set by the module to `ghcr.io/openclaw/openclaw:<application_version>`, pinning the version at build time.

`git` is required by `entrypoint.sh` to clone or update the optional shared skills repository from GitHub on every container startup.

### `entrypoint.sh`

The container entrypoint runs before the OpenClaw gateway process. It performs three tasks:

**1. Directory setup**
Creates `/data/workspace`, `/data/agents/main/agent`, and the state directory (`OPENCLAW_STATE_DIR`, default `/tmp/openclaw`) if absent.

**2. Gateway config generation (`openclaw.json`)**
Writes a fresh `openclaw.json` to `$OPENCLAW_STATE_DIR/openclaw.json` on every startup, ensuring Terraform-managed environment variables always win over stale values persisted on GCS. The config sets:
- `agents.list[0]`: A single agent named `"main"` with `workspace=/data/workspace` and `agentDir=/data/agents/main/agent`.
- `approvals.exec.enabled = true` — execution approvals are always required.
- `session.dmScope = "per-channel-peer"` — separate session state per messaging user.
- `channels` block: includes `telegram` configuration only when `TELEGRAM_BOT_TOKEN` is set; otherwise uses an empty channels map (an empty `allowFrom` with `dmPolicy=allowlist` would prevent gateway startup).
- `gateway.mode = "local"`, trusted proxies set to `0.0.0.0/0`, control UI with `dangerouslyDisableDeviceAuth=true` and `allowedOrigins=["*"]`.

**3. Skills repository sync (optional)**
When `SKILLS_REPO_URL` is set, clones or updates the repository at `$SKILLS_REPO_URL` (ref: `$SKILLS_REPO_REF`) into `/data/workspace/skill-library`. Uses shallow clones (`--depth 1`) for efficiency. Sync failures are non-fatal — the gateway starts even if the clone fails.

**4. Gateway startup**
Runs: `exec node dist/index.js gateway --bind lan --port ${PORT:-8080} --allow-unconfigured`

The `--bind lan` flag is required for Cloud Run — the runtime maps the external port to the container's LAN interface, not loopback.

---

## 6. Input Variables

### Project & Identity

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_id` | `string` | **required** | GCP project ID |
| `wrapper_prefix` | `string` | **required** | Prefix for resource naming (GCS bucket, secret IDs) |
| `deployment_id` | `string` | `""` | Unique deployment identifier |
| `common_labels` | `map(string)` | `{}` | Labels applied to all resources |
| `deployment_region` | `string` | `"us-central1"` | Region for the GCS workspace bucket |

### Application Details

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `application_name` | `string` | `"openclaw"` | Application name used in resource naming |
| `application_display_name` | `string` | `"OpenClaw Gateway"` | Human-readable name |
| `description` | `string` | `"OpenClaw AI Gateway - Serverless multi-tenant AI agent gateway on Cloud Run"` | Application description |
| `application_version` | `string` | `"latest"` | OpenClaw image tag used as `BASE_IMAGE` build arg |

### Skills Repository

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `skills_repo_url` | `string` | `""` | GitHub URL of a shared OpenClaw skills repository. Cloned into `/data/workspace/skill-library` on startup. Leave empty to skip |
| `skills_repo_ref` | `string` | `"main"` | Git ref (branch, tag, or SHA) for the skills repository |

### Resources

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `container_resources` | `any` | `null` | Full container resources override. When `null`, `cpu_limit` and `memory_limit` are used |
| `cpu_limit` | `string` | `"2000m"` | CPU limit per container instance |
| `memory_limit` | `string` | `"2Gi"` | Memory limit per container instance |
| `min_instance_count` | `number` | `0` | Minimum instances (0 = scale-to-zero) |
| `max_instance_count` | `number` | `1` | Maximum instances. OpenClaw is stateful — keep at `1` per tenant to avoid split-state |

### Storage

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `gcs_volumes` | `list(any)` | `[]` | Additional GCS Fuse volume mounts beyond the auto-appended `/data` workspace volume |

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `environment_variables` | `map(string)` | `{}` | Additional environment variables merged into the container. Module-managed vars always take precedence |

### Health Probes

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `startup_probe` | `object` | `{ enabled=true, type="HTTP", path="/health", initial_delay_seconds=20, timeout_seconds=5, period_seconds=5, failure_threshold=24 }` | Startup probe. The 20s initial delay and 24-attempt threshold give ~2 minutes for GCS Fuse mount and Node.js startup |
| `liveness_probe` | `object` | `{ enabled=true, type="HTTP", path="/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe targeting `/health` |

### Image

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `enable_image_mirroring` | `bool` | `true` | Mirror the built image to Artifact Registry |

### Credentials

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `anthropic_api_key` | `string` (sensitive) | `""` | Anthropic API key. Stored in Secret Manager and injected as `ANTHROPIC_API_KEY`. Required on initial deployment; omit on updates to retain the stored value |
| `enable_telegram` | `bool` | `false` | Provision Telegram secrets and inject `TELEGRAM_BOT_TOKEN` |
| `telegram_bot_token` | `string` (sensitive) | `""` | Telegram bot token from @BotFather. Required when `enable_telegram = true` |
| `telegram_webhook_secret` | `string` (sensitive) | `""` | Webhook validation secret for the router. Required when `enable_telegram = true`. Generate with: `openssl rand -hex 32` |
| `enable_slack` | `bool` | `false` | Provision Slack secrets and inject `SLACK_BOT_TOKEN` |
| `slack_bot_token` | `string` (sensitive) | `""` | Slack bot token (`xoxb-...`). Required when `enable_slack = true` |
| `slack_signing_secret` | `string` (sensitive) | `""` | Slack signing secret for the router. Required when `enable_slack = true` |

---

## 7. GCS Volume Layout

The `<wrapper_prefix>-storage` GCS bucket is mounted at `/data` in the container:

```
<wrapper_prefix>-storage/          ← GCS bucket root (mounted at /data)
├── workspace/                     ← Agent workspace (/data/workspace)
│   └── skill-library/             ← Shared skills repo (if SKILLS_REPO_URL is set)
├── agents/
│   └── main/
│       └── agent/                 ← Agent state directory (/data/agents/main/agent)
└── ...
```

The `openclaw-data` GCS Fuse volume entry appended by this module:

```hcl
{
  name          = "openclaw-data"
  bucket_name   = "<wrapper_prefix>-storage"
  mount_path    = "/data"
  readonly      = false
  mount_options = ["implicit-dirs", "metadata-cache-ttl-secs=60", "uid=1000", "gid=1000"]
}
```

The `uid=1000,gid=1000` mount options match the container user (UID 1000) set in the upstream OpenClaw image, ensuring the mounted volume is immediately writable without `chmod` operations.

---

## 8. Platform-Specific Differences

| Aspect | OpenClaw_CloudRun | OpenClaw_GKE |
|--------|-------------------|--------------|
| `service_url` | Cloud Run service URL | Internal ClusterIP URL or custom domain |
| `database_type` in config | `null` (overridden to `"NONE"` in wrapper) | `"NONE"` (set explicitly in wrapper locals) |
| GCS Fuse driver | Cloud Run GCS Fuse extension | GKE GCS Fuse CSI driver |
| Secret injection | `secret_ids` map → `module_secret_env_vars` | `secret_values` raw map → `explicit_secret_values` |
| `min_instance_count` wrapper default | `0` (scale-to-zero) | `1` |
| `max_instance_count` wrapper default | `1` | `3` |
| `cpu_always_allocated` | `true` (required for WebSocket/async) | Not applicable |
| Scaling | Serverless instances | Kubernetes pods with HPA |

---

## 9. Implementation Pattern

```hcl
# Example: how OpenClaw_CloudRun instantiates OpenClaw_Common

module "openclaw_app" {
  source = "../OpenClaw_Common"

  project_id        = var.project_id
  deployment_id     = local.random_id
  wrapper_prefix    = local.wrapper_prefix
  common_labels     = local.common_labels
  deployment_region = local.deployment_region

  application_name         = var.application_name
  application_display_name = var.application_display_name
  description              = var.description
  application_version      = var.application_version

  skills_repo_url = var.skills_repo_url
  skills_repo_ref = var.skills_repo_ref

  anthropic_api_key       = var.anthropic_api_key
  enable_telegram         = var.enable_telegram
  telegram_bot_token      = var.telegram_bot_token
  telegram_webhook_secret = var.telegram_webhook_secret
  enable_slack            = var.enable_slack
  slack_bot_token         = var.slack_bot_token
  slack_signing_secret    = var.slack_signing_secret

  cpu_limit          = var.cpu_limit
  memory_limit       = var.memory_limit
  min_instance_count = var.min_instance_count
  max_instance_count = var.max_instance_count

  gcs_volumes            = var.gcs_volumes
  environment_variables  = var.environment_variables
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_image_mirroring = var.enable_image_mirroring
}

locals {
  application_modules = {
    openclaw = merge(
      module.openclaw_app.config,
      { container_port = var.container_port }
    )
  }
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config            = local.application_modules
  module_secret_env_vars        = module.openclaw_app.secret_ids
  module_explicit_secret_values = module.openclaw_app.secret_values
  module_storage_buckets        = module.openclaw_app.storage_buckets
  scripts_dir                   = abspath("${module.openclaw_app.path}/scripts")
  # ... other inputs
}
```
