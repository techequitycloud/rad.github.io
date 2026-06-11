---
title: "Crawl4AI Common \u2014 Shared Application Configuration"
---

# Crawl4AI Common — Shared Application Configuration

`Crawl4AI_Common` is the **shared application layer** for Crawl4AI. It is not
deployed on its own; instead it supplies the Crawl4AI-specific configuration
that both [Crawl4AI_GKE](Crawl4AI_GKE.md) and
[Crawl4AI_CloudRun](Crawl4AI_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Crawl4AI, see the
platform guides ([Crawl4AI_GKE](Crawl4AI_GKE.md),
[Crawl4AI_CloudRun](Crawl4AI_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Crawl4AI_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official `unclecode/crawl4ai` prebuilt image and enables image mirroring to Artifact Registry | `container_image` output of the platform deployment |
| No database | Fixes `database_type = "NONE"` — Cloud SQL is not provisioned; no Auth Proxy sidecar | No `database_*` outputs — Crawl4AI is fully stateless |
| Embedded Redis | Declares `REDIS_TASK_TTL` to control in-container task result TTL | §Embedded Redis in the platform guides |
| No secrets | Returns an empty `secret_ids` map — no Secret Manager secrets are auto-generated | Inject `SECRET_KEY` and LLM keys via `secret_environment_variables` |
| No storage buckets | Returns an empty `storage_buckets` list — no GCS buckets are auto-provisioned | Add optional result buckets via `storage_buckets` in the platform module |
| Core env vars | Sets `PYTHONUNBUFFERED=1` and `REDIS_TASK_TTL` | Application behaviour in the platform guides |
| Health probes | Supplies the default HTTP startup/liveness probe against `/health` with a 40 s initial delay | §Observability in the platform guides |

---

## 2. Container image and mirroring

`Crawl4AI_Common` sets `image_source = "prebuilt"` and
`container_image = "unclecode/crawl4ai"`. No Cloud Build step is used by
default. Image mirroring is enabled (`enable_image_mirroring = true`) to copy
the upstream Docker Hub image into Artifact Registry before deployment,
preventing Docker Hub rate-limit failures on large images (~3–4 GiB
compressed).

To view the mirrored image in Artifact Registry:

```bash
gcloud artifacts docker images list <region>-docker.pkg.dev/<project>/<repo> --project "$PROJECT"
```

The Artifact Registry repository name is reported in the `container_registry`
output of the platform deployment.

---

## 3. Stateless architecture — no database, no persistent storage

Crawl4AI has no external database dependency. `Crawl4AI_Common` fixes the
following to prevent accidental Cloud SQL provisioning:

- `database_type = "NONE"` — no Cloud SQL instance is created.
- `enable_cloudsql_volume = false` — no Cloud SQL Auth Proxy sidecar is
  injected into the container.
- `storage_buckets = []` — no GCS bucket is auto-provisioned.

Task state is held entirely in the embedded Redis instance running inside the
container. Results are ephemeral — they are lost when the container or pod
restarts. This is the expected behaviour for a stateless crawl API.

---

## 4. Embedded Redis and process architecture

The `unclecode/crawl4ai` image runs two processes managed by supervisord
(PID 1):

| Priority | Process | Port | Role |
|---|---|---|---|
| 10 | Redis server | localhost:6379 | Task queue and result store |
| 20 | Gunicorn (1 worker × 4 threads) | 0.0.0.0:11235 | FastAPI ASGI server |

**Do not override `REDIS_HOST` or `REDIS_PORT`** as environment variables —
the embedded Redis is only reachable on `localhost:6379` and must not be
redirected to an external endpoint.

The default `config.yml` bundled in the image sets
`crawler.pool.max_pages = 40` (maximum concurrent browser pages per container
instance) and includes `--disable-dev-shm-usage` in Chromium's extra launch
args. On Cloud Run, this redirects Chromium's shared-memory work to `/tmp`; on
GKE, the `App_GKE` foundation mounts a proper emptyDir volume at `/dev/shm`
so the workaround is not needed.

---

## 5. Core environment variables

`Crawl4AI_Common` injects two environment variables automatically into every
deployment:

| Variable | Value | Purpose |
|---|---|---|
| `PYTHONUNBUFFERED` | `1` | Ensures Python log output streams immediately to Cloud Logging without buffering |
| `REDIS_TASK_TTL` | `<redis_task_ttl_seconds>` | Controls how long completed task results are held in embedded Redis before expiry |

Additional environment variables from `environment_variables` in the calling
platform module are merged after these. Recognised by Crawl4AI at runtime:

| Variable | How to inject | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `environment_variables` | Override the LLM backend (e.g., `"anthropic/claude-3-haiku"`, `"openai/gpt-4o-mini"`) |
| `LLM_BASE_URL` | `environment_variables` | Override the LLM API base URL (for Ollama or custom proxies) |
| `LLM_TEMPERATURE` | `environment_variables` | Override LLM sampling temperature |
| `CRAWL4AI_HOOKS_ENABLED` | `environment_variables` | Enable webhook hooks — **RCE risk; only use in trusted environments** |
| `SECRET_KEY` | `secret_environment_variables` | JWT signing secret; override `"mysecret"` for production |
| `OPENAI_API_KEY` | `secret_environment_variables` | OpenAI API key for LLM-based extraction |
| `ANTHROPIC_API_KEY` | `secret_environment_variables` | Anthropic API key for LLM-based extraction |
| `DEEPSEEK_API_KEY` | `secret_environment_variables` | DeepSeek API key |
| `GROQ_API_KEY` | `secret_environment_variables` | Groq API key |
| `GEMINI_API_KEY` | `secret_environment_variables` | Google Gemini API key |
| `LLM_API_KEY` | `secret_environment_variables` | Generic LLM API key for the configured provider |

Access an existing secret's value after deployment:

```bash
gcloud secrets list --project "$PROJECT"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

---

## 6. Health probe behaviour

`Crawl4AI_Common` supplies the default probes for both platform variants.
The default startup probe uses HTTP GET `/health` with a **40-second initial
delay** — this allows supervisord time to start Redis (priority 10) and then
Gunicorn (priority 20) before the endpoint becomes reachable. This matches the
`start_period: 40s` in the upstream `docker-compose.yml`.

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/health` | 40 s | 10 s | 12 |
| Liveness | HTTP | `/health` | 60 s | 30 s | 3 |

Both platform variants use the same HTTP probe configuration. Cloud Run does
not need the TCP-probe workaround used by some other apps (such as Mautic)
because Crawl4AI's Gunicorn serves plain HTTP on port 11235 with no
HTTPS-redirect interference.

---

For the Crawl4AI-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Crawl4AI_GKE](Crawl4AI_GKE.md)** and
**[Crawl4AI_CloudRun](Crawl4AI_CloudRun.md)**.
