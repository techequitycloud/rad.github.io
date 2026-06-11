---
title: "Ollama Common \u2014 Shared Application Configuration"
---

# Ollama Common — Shared Application Configuration

`Ollama_Common` is the **shared application layer** for Ollama. It is not deployed on its
own; instead it supplies the Ollama-specific configuration that both
[Ollama_GKE](Ollama_GKE.md) and [Ollama_CloudRun](Ollama_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Ollama, see the platform guides
([Ollama_GKE](Ollama_GKE.md), [Ollama_CloudRun](Ollama_CloudRun.md)) and the foundation
guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Ollama_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the prebuilt `ollama/ollama` image and enables image mirroring | `container_image` output of the platform deployment |
| No credentials | Produces empty `secret_ids` and `secret_values` maps — Ollama requires no database credentials or passwords | No Secret Manager entries are created |
| Model storage | Declares the `<prefix>-models` **Cloud Storage** bucket and appends the `ollama-models` GCS Fuse volume mount | `models_bucket` and `storage_buckets` outputs |
| Core settings | Fixes `container_port = 11434`, `database_type = "NONE"`, `enable_cloudsql_volume = false`, and injects the three mandatory Ollama environment variables | Application behaviour in the platform guides |
| Model pull job | Auto-generates a `model-pull` initialization job when `default_model` is set and no custom jobs are provided | `initialization_jobs` output |
| Health checks | Supplies the default startup (30 s delay, 20 attempts) and liveness (60 s delay, 3 attempts) probe configuration targeting `/` | §Observability in the platform guides |

---

## 2. No credentials — no Secret Manager entries

Unlike most application modules, Ollama requires **no application-managed secrets**. There
is no admin password and no database password. The `secret_ids` and `secret_values` outputs
are always empty maps.

If you need to inject an API key or other sensitive value (e.g., to protect a
`LoadBalancer`-exposed endpoint), use `secret_environment_variables` in the platform module
to reference a secret you create independently:

```bash
gcloud secrets list --project "$PROJECT"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Model storage in Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `-models`) is declared here and provisioned by
the foundation. The workload service account is granted read/write access automatically via
Workload Identity. The bucket is mounted into every container via the **GCS Fuse** driver
(Cloud Run gen2) or the **GCS Fuse CSI driver** (GKE Autopilot) at `/mnt/gcs`.

The environment variable `OLLAMA_MODELS` is set to `/mnt/gcs/ollama/models` so Ollama
discovers and stores model weights in a persistent, shared location that survives container
restarts and new revisions.

GCS bucket layout:

```
<resource_prefix>-models/          ← GCS bucket root
└── ollama/
    └── models/                    ← /mnt/gcs/ollama/models (OLLAMA_MODELS)
        ├── llama3.2:3b/
        ├── mistral/
        └── ...
```

Explore the bucket:

```bash
gcloud storage ls gs://<models-bucket>/ollama/models/
gcloud storage buckets describe gs://<models-bucket> --project "$PROJECT"
```

---

## 4. Core application settings

`Ollama_Common` establishes the baseline Ollama configuration so the service comes up
correctly on first boot:

- **Container port fixed at 11434** — Ollama's native REST API port.
- **No database, no Redis** — `database_type = "NONE"` and `enable_cloudsql_volume = false`
  are hard-coded. No Cloud SQL instance is provisioned.
- **Automatically injected environment variables** — these are always set and must not be
  overridden (except `OLLAMA_KEEP_ALIVE`):

  | Variable | Value | Purpose |
  |---|---|---|
  | `OLLAMA_MODELS` | `/mnt/gcs/ollama/models` | Points Ollama at the GCS Fuse subdirectory for model persistence. |
  | `OLLAMA_HOST` | `0.0.0.0:11434` | Binds to all interfaces so Cloud Run ingress or the Kubernetes service proxy can forward traffic. |
  | `OLLAMA_KEEP_ALIVE` | `24h` | Keeps loaded model resident in memory between requests, eliminating per-request model-load latency. Override by setting `OLLAMA_KEEP_ALIVE` in `environment_variables`. |

- **Prebuilt image** — `ollama/ollama` is used directly (`image_source = "prebuilt"`).
  Image mirroring to Artifact Registry is enabled by default to avoid Docker Hub rate
  limits.
- **No companion services** — Ollama has no companion containers (no sidecar proxy, no
  worker process). The `additional_services` list is always empty from this layer.

---

## 5. Model pull initialization job

When `default_model` is set in the platform module and no custom `initialization_jobs` are
provided, `Ollama_Common` auto-generates a one-shot job named `model-pull` that:

1. Starts a local Ollama server in the background.
2. Polls `http://localhost:11434/` up to 30 times (3-second interval) until the server is
   ready.
3. Runs `ollama pull $OLLAMA_MODEL` using the GCS-mounted models directory.
4. Shuts down the background server and exits cleanly.

The job runs at deployment time (`execute_on_apply = true`), mounts the `ollama-models` GCS
volume, and inherits the CPU and memory limits from the platform module. Its timeout is
controlled by `model_pull_timeout_seconds` (default 3600 seconds; large models can take
20–30 minutes). Providing any entry in `initialization_jobs` disables the auto-generated
job entirely.

Inspect the job:

```bash
# GKE:
kubectl get jobs -n "$NAMESPACE"
kubectl logs -n "$NAMESPACE" job/model-pull

# Cloud Run:
gcloud run jobs list --project "$PROJECT" --region "$REGION"
gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
```

---

## 6. Health probe behaviour

Both startup and liveness probes target Ollama's root path (`/`), which responds with
`"Ollama is running"` once the server is fully initialised and the model is loaded.

- **Startup probe** — 30 s initial delay with 20 failure attempts (roughly 5 minutes total).
  This accommodates GCS Fuse mount time and model loading from GCS on cold start.
- **Liveness probe** — 60 s initial delay with 3 failure attempts. The longer initial delay
  avoids false restarts during the model-loading phase.

Both variants (GKE and Cloud Run) use HTTP probes targeting `/` — Ollama does not redirect
this path, so no TCP-probe adjustment is needed (unlike PHP/Apache applications).

---

For the Ollama-specific, user-facing configuration (variables by group, outputs, and how to
explore each service from the Console and CLI), see the platform guides:
**[Ollama_GKE](Ollama_GKE.md)** and **[Ollama_CloudRun](Ollama_CloudRun.md)**.
