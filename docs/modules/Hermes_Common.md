---
title: "Hermes Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Hermes module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Hermes Common — Shared Application Configuration

`Hermes_Common` is the **shared application layer** for Hermes Agent — Nous
Research's open-source (MIT-licensed), self-hosted, self-improving personal AI
agent ([documentation](https://hermes-agent.nousresearch.com/docs/)). It is not
deployed on its own; instead it supplies the Hermes-specific configuration that
both [Hermes_GKE](Hermes_GKE.md) and [Hermes_CloudRun](Hermes_CloudRun.md) build
on, so the two platform variants behave identically where it matters. End users
never configure this layer directly — it has no deployment UI inputs of its own —
but understanding what it provides explains the defaults you see in the platform
docs.

For the infrastructure that actually provisions and runs Hermes, see the platform
guides ([Hermes_GKE](Hermes_GKE.md), [Hermes_CloudRun](Hermes_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Hermes_Common | Where it surfaces |
|---|---|---|
| Model-provider credentials | Stores `ANTHROPIC_API_KEY` (primary) and optional `OPENAI_API_KEY` in **Secret Manager**, with a plan-time warning when no provider key is supplied | Injected automatically; retrieve via Secret Manager (see below) |
| Gateway API auth | Auto-generates `API_SERVER_KEY` (64-char hex) — the bearer token for the gateway's OpenAI-compatible API server on port 8642 | Retrieve via Secret Manager |
| Dashboard auth | Auto-generates `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` for the port-9119 web dashboard | Retrieve via Secret Manager |
| Connector credentials | Optional `TELEGRAM_BOT_TOKEN` secret — Hermes long-polls outbound, so no webhook is needed | Injected when `enable_telegram = true` |
| Container image | References the official **prebuilt** `nousresearch/hermes-agent` image with args `["gateway", "run"]` — no custom build | `container_image` output of the platform deployment |
| No-database design | Fixes `database_type` to none and disables the Cloud SQL volume — all state is SQLite + flat files under `/opt/data` | §Database in the platform guides |
| Environment baseline | Binds the API server (`0.0.0.0:8642`) and dashboard (`0.0.0.0:9119`) so the platform front-ends and `kubectl port-forward` can reach them | Application behaviour in the platform guides |
| Health checks | Supplies default **TCP** port-listening startup/liveness probes | §Observability in the platform guides |
| Object storage / init jobs | Declares **none** — no module-managed buckets, no initialization jobs | `storage_buckets` / `initialization_jobs` outputs |

---

## 2. Secrets in Secret Manager

All Hermes credentials are stored as
`secret-<tenant-prefix>-<application-name>-<suffix>` and injected as environment
variables at runtime:

| Secret suffix | Env var | Source |
|---|---|---|
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | Operator-supplied (primary model provider) |
| `openai-api-key` | `OPENAI_API_KEY` | Operator-supplied; only when `enable_openai = true` |
| `api-server-key` | `API_SERVER_KEY` | **Auto-generated** 64-char hex when left blank |
| `dashboard-password` | `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` | **Auto-generated** when left blank; only when `enable_dashboard = true` |
| `telegram-bot-token` | `TELEGRAM_BOT_TOKEN` | Operator-supplied; only when `enable_telegram = true` |

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~hermes"

# Read the gateway API key (needed to call the OpenAI-compatible endpoint):
gcloud secrets versions access latest \
  --secret="$(gcloud secrets list --project "$PROJECT" \
    --filter='name~hermes AND name~api-server-key' \
    --format='value(name)' --limit=1)" --project "$PROJECT"

# Read the dashboard basic-auth password:
gcloud secrets versions access latest \
  --secret="$(gcloud secrets list --project "$PROJECT" \
    --filter='name~hermes AND name~dashboard-password' \
    --format='value(name)' --limit=1)" --project "$PROJECT"
```

Update semantics worth knowing:

- **A new secret version is created only when a non-empty value is supplied.**
  On update deployments where a credential variable is left blank, the existing
  `latest` version is preserved automatically — `anthropic_api_key` never needs
  re-entering after the first deploy. To rotate a key, supply the new value and
  redeploy.
- **A plan-time `check` warns when no model-provider key is supplied.** Hermes is
  model-agnostic, but without at least one provider key the agent cannot run a
  single turn; on Cloud Run an empty Anthropic secret additionally fails the
  deploy with a cryptic "Secret was not found" error, so the check surfaces the
  problem earlier.
- **On GKE, `API_SERVER_KEY` bypasses SecretSync** and is injected as an explicit
  Kubernetes Secret, because SecretSync can materialise an empty value on first
  deploy before Secret Manager replication completes. All other secrets remain
  Secret Manager-backed.

---

## 3. Prebuilt container image

Hermes deploys the official **`nousresearch/hermes-agent:<application_version>`**
image directly — `image_source = "prebuilt"`, the build config is disabled, and
there is no Dockerfile or entrypoint wrapper in this repository:

- **s6-overlay init.** The image's ENTRYPOINT is s6-overlay's `/init`, which runs
  as root so it can `chown` the data volume on first boot, then drops to the
  non-root `hermes` user before starting the application.
- **Explicit gateway args.** The image's default CMD is the interactive `hermes`
  CLI, so this layer sets `container_args = ["gateway", "run"]` to start the
  gateway process (messaging connectors + OpenAI-compatible API server) instead.
- **Port 8642.** The API server binds `0.0.0.0:8642` (`API_SERVER_ENABLED=1`,
  `API_SERVER_HOST=0.0.0.0`, `API_SERVER_PORT=8642`) so the Cloud Run front-end /
  GKE Service can reach it.
- **Mirrored into Artifact Registry** by default (`enable_image_mirroring = true`)
  to avoid Docker Hub rate limits; the mirror is digest-aware.

```bash
gcloud artifacts docker images list \
  "$REGION-docker.pkg.dev/$PROJECT/<repo>" --filter="package~hermes"
```

---

## 4. No-database, NFS-backed state design

Hermes requires **no Cloud SQL and no Redis** — a deliberate contrast with most
modules in this catalogue. The agent keeps everything (SQLite config database,
API keys, sessions, learned skills, memories) in flat files under the image's
**fixed `/opt/data` directory**, which is not overridable by env var. This layer
therefore:

1. Sets `database_type` to none, `enable_cloudsql_volume = false`, and declares
   no `db-init` job — there is nothing to bootstrap,
2. Declares no module-managed GCS buckets (`storage_buckets = []`),
3. Relies on the platform variants to mount the **shared platform NFS directly at
   `/opt/data`** (`enable_nfs = true`, `nfs_mount_path = "/opt/data"`, both
   enforced by variant-level plan-time validations).

Two hard rules follow from SQLite's semantics:

- **Never scale beyond one instance/replica** — SQLite is single-writer; both
  variants validate `max_instance_count = 1`.
- **Never substitute GCSFuse for the NFS mount** — SQLite requires POSIX locking
  and atomic renames that GCSFuse cannot provide. The `gcs_volumes` variable is
  for auxiliary mounts only.

Inspect the state directory on GKE:

```bash
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /opt/data
```

---

## 5. Environment baseline and dashboard

Module-managed environment variables (always set; operator
`environment_variables` merge underneath them):

- `API_SERVER_ENABLED = "1"`, `API_SERVER_HOST = "0.0.0.0"`,
  `API_SERVER_PORT = "8642"` — the OpenAI-compatible API server.
- `HERMES_DASHBOARD = "1"` / `"0"` (from `enable_dashboard`),
  `HERMES_DASHBOARD_HOST = "0.0.0.0"`, `HERMES_DASHBOARD_PORT = "9119"`,
  `HERMES_DASHBOARD_BASIC_AUTH_USERNAME = <dashboard_username>` — the in-process
  web dashboard for API-key management and profile configuration. It binds all
  interfaces so `kubectl port-forward` works on GKE; on Cloud Run it is not
  routed (single ingress port).

Use the operator `environment_variables` map for optional connector credentials
not covered by module variables (Discord, Slack, WhatsApp, Signal) or alternative
provider endpoints (e.g. OpenRouter).

---

## 6. Health probe behaviour

Both default probes at this layer are **TCP port-listening** on the container
port (8642) — deliberately not HTTP: the API server authenticates every request
with the `API_SERVER_KEY` bearer token, so an HTTP probe would receive 401/403
forever and wedge the rollout even though the gateway booted fine. The startup
window (20s delay + 24 × 5s on Cloud Run; 10s + 36 × 5s on GKE) covers the NFS
mount and first-boot data-directory initialisation.

The variants diverge on the **liveness probe**: [Hermes_GKE](Hermes_GKE.md)
keeps the TCP liveness probe enabled (Kubernetes supports TCP liveness), while
[Hermes_CloudRun](Hermes_CloudRun.md) **disables it by default** — Cloud Run
does not support TCP liveness probes (TCP is startup-only), and Hermes'
`/health` behaviour behind API-server auth is unverified; the TCP startup probe
plus Cloud Run's own instance management cover health there. Enable it with an
HTTP path only after verifying the endpoint is unauthenticated.

---

For the Hermes-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform
guides: **[Hermes_GKE](Hermes_GKE.md)** and
**[Hermes_CloudRun](Hermes_CloudRun.md)**.
