---
title: "OpenClaw Common \u2014 Shared Application Configuration"
---

# OpenClaw Common — Shared Application Configuration

`OpenClaw_Common` is the **shared application layer** for OpenClaw. It is not deployed on
its own; instead it supplies the OpenClaw-specific configuration that both
[OpenClaw_GKE](OpenClaw_GKE.md) and [OpenClaw_CloudRun](OpenClaw_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs OpenClaw, see the platform guides
([OpenClaw_GKE](OpenClaw_GKE.md), [OpenClaw_CloudRun](OpenClaw_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by OpenClaw_Common | Where it surfaces |
|---|---|---|
| AI credentials | Stores the Anthropic API key and gateway token in **Secret Manager**; optional Telegram and Slack secrets | Injected at runtime — retrieve from Secret Manager (see below) |
| Container image | Pins `ghcr.io/openclaw/openclaw` as the base and builds a custom image with `entrypoint.sh` layered on top | `container_image` output of the platform deployment |
| No database | Sets `database_type = null` — Cloud SQL and Redis are never provisioned | No Cloud SQL instance or init job appears in the deployment |
| GCS workspace | Declares the `<prefix>-storage` bucket and the `openclaw-data` GCS Fuse volume always mounted at `/data` | `storage_buckets` output; confirmed via `gcloud storage ls` |
| Core settings | Sets baseline env vars (`OPENCLAW_STATE_DIR`, `NODE_ENV`, `NODE_OPTIONS`, `NPM_CONFIG_CACHE`, `SKILLS_REPO_URL`, `SKILLS_REPO_REF`) | Application behaviour in the platform guides |
| Startup behaviour | Drives `entrypoint.sh` — writes `openclaw.json` from env vars, optionally syncs the skills repo, then starts the gateway | §Application Behaviour in the platform guides |
| Health checks | Supplies HTTP probes targeting `GET /health` on port 8080 with enough initial delay for GCS Fuse mount and Node.js startup | §Observability in the platform guides |

---

## 2. Credentials in Secret Manager

The following secrets are managed by `OpenClaw_Common`. They are created in Secret Manager
during deployment and never appear in configuration files or Terraform state in plaintext.

| Secret ID suffix | Injected as | When created |
|---|---|---|
| `<prefix>-anthropic-api-key` | `ANTHROPIC_API_KEY` | Always (the secret container is always created; the version is only written when `anthropic_api_key` is non-empty) |
| `<prefix>-gateway-token` | `OPENCLAW_GATEWAY_TOKEN` | Always; auto-generated as a 64-character hex token when `gateway_token` is left blank |
| `<prefix>-telegram-bot-token` | `TELEGRAM_BOT_TOKEN` | When `enable_telegram = true` |
| `<prefix>-telegram-webhook-secret` | Not injected into agent — router use only | When `enable_telegram = true` |
| `<prefix>-slack-bot-token` | `SLACK_BOT_TOKEN` | When `enable_slack = true` |
| `<prefix>-slack-signing-secret` | Not injected into agent — router use only | When `enable_slack = true` |

Retrieve any credential after deployment:

```bash
# List all secrets for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~<prefix>"

# Read the Anthropic API key (use only on initial setup; manage via Secret Manager thereafter):
gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"

# Read the gateway token (required to register API clients):
gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
```

A 30-second propagation delay is applied after secret versions are written before the
`secret_ids` output is resolved, ensuring Secret Manager replication completes before the
container starts.

---

## 3. Container image and build

`OpenClaw_Common` always triggers a custom image build. The Dockerfile in `scripts/` adds
`git` (for skills repo cloning) and `entrypoint.sh` on top of the upstream gateway image:

```
ARG BASE_IMAGE=ghcr.io/openclaw/openclaw:<application_version>
FROM ${BASE_IMAGE}
# adds git, ca-certificates, and entrypoint.sh
```

The `BASE_IMAGE` build arg is set at Cloud Build time to
`ghcr.io/openclaw/openclaw:<application_version>`, pinning the upstream version. Use a
specific release tag in `application_version` for reproducible builds.

---

## 4. GCS workspace — no database

OpenClaw requires no Cloud SQL instance and no database initialisation job. All durable
agent state is stored in a GCS bucket mounted by GCS Fuse:

```
<prefix>-storage/               ← GCS bucket (mounted at /data)
├── workspace/                  ← agent workspace (/data/workspace)
│   └── skill-library/          ← shared skills repo (when SKILLS_REPO_URL is set)
├── agents/main/agent/          ← agent state directory
└── ...
```

The mount is always appended to `gcs_volumes` with `uid=1000,gid=1000` options, matching
the container user of the upstream OpenClaw image. Inspect the bucket:

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-storage/
```

---

## 5. Core application settings

`OpenClaw_Common` establishes the baseline environment so the gateway comes up correctly:

- **`OPENCLAW_STATE_DIR = /tmp/openclaw`** — npm plugin staging and the XDG config home are
  redirected to local disk. GCS Fuse does not support hard links or high-concurrency renames,
  which cause npm staging failures when those operations land on the `/data` volume. Persistent
  agent workspace and agent state are still written to `/data` paths.
- **`NODE_ENV = production`** — enables Node.js production mode. Do not override to
  `development` in a production deployment.
- **`NODE_OPTIONS = --max-old-space-size=1536`** — prevents Node.js OOM on 2 GiB containers.
  Tune upward when using a larger `memory_limit`.
- **`NPM_CONFIG_CACHE = /tmp/.npm`** — redirects the npm cache to ephemeral local storage.
- **`SKILLS_REPO_URL` / `SKILLS_REPO_REF`** — passed through from the platform module and
  consumed by `entrypoint.sh` to clone or update the skills repository on every startup.

---

## 6. `entrypoint.sh` startup sequence

Every container startup runs the following sequence before handing off to the gateway
process:

1. **Directory setup.** Creates `/data/workspace`, `/data/agents/main/agent`, and
   `$OPENCLAW_STATE_DIR` if absent.
2. **Config regeneration.** Writes a fresh `openclaw.json` to `$OPENCLAW_STATE_DIR`. This
   ensures Terraform-managed environment variables always win over stale values previously
   persisted on the GCS volume.
3. **Skills repository sync (optional).** When `SKILLS_REPO_URL` is set, performs a shallow
   clone or update into `/data/workspace/skill-library`. Sync failures are non-fatal — the
   gateway starts even if the clone fails.
4. **Gateway startup.** Runs `node dist/index.js gateway --bind lan --port $&#123;PORT:-8080&#125;
   --allow-unconfigured`. The `--bind lan` flag is required for Cloud Run — the runtime maps
   the external port to the container's LAN interface.

---

## 7. Health probe behaviour

The default probes target `GET /health` on port 8080, which responds only once the gateway
is fully initialised.

- **GKE** startup probe: HTTP `/health`, 36-attempt × 5 s + 10 s initial delay ≈ 3 minutes —
  gives enough headroom for npm to stage the 35+ bundled plugin packages before the gateway
  starts.
- **Cloud Run** startup probe: HTTP `/health`, 24-attempt × 5 s + 20 s initial delay ≈ 2
  minutes — slightly shorter because Cloud Run container startup is faster than Kubernetes
  pod init.

Both platforms use the same liveness probe: HTTP `/health`, 3-failure threshold with a 30 s
period.

---

## 8. Object storage

The `<prefix>-storage` GCS bucket is declared here and provisioned by the foundation, which
also grants the workload service account `roles/storage.objectAdmin`. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the OpenClaw-specific, user-facing configuration (variables by group, outputs, and how
to explore each service from the Console and CLI), see the platform guides:
**[OpenClaw_GKE](OpenClaw_GKE.md)** and **[OpenClaw_CloudRun](OpenClaw_CloudRun.md)**.
