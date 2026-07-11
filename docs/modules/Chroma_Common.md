---
title: "Chroma Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Chroma module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Chroma Common — Shared Application Configuration

`Chroma_Common` is the **shared application layer** for Chroma. It is not deployed on
its own; instead it supplies the Chroma-specific configuration that both
[Chroma_GKE](Chroma_GKE.md) and [Chroma_CloudRun](Chroma_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Chroma, see the platform
guides ([Chroma_GKE](Chroma_GKE.md), [Chroma_CloudRun](Chroma_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Chroma_Common | Where it surfaces |
|---|---|---|
| Auth token | Optionally generates a 32-character random token and stores it in **Secret Manager** as `CHROMA_SERVER_AUTHN_CREDENTIALS` | Retrieve via Secret Manager (see below) |
| Container image | Pins the official `chromadb/chroma` Docker Hub image and the build that mirrors it | `container_image` output of the platform deployment |
| No-database declaration | Fixes `database_type = "NONE"` — Chroma manages its own embedded storage with no SQL dependency | No Cloud SQL instance is created |
| Fixed environment variables | Always injects `ANONYMIZED_TELEMETRY=false` and `CHROMA_SERVER_HTTP_PORT=8000`; adds `CHROMA_SERVER_AUTHN_PROVIDER` when auth is enabled | Application behaviour in the platform guides |
| GCS data bucket | Declares the `<prefix>-data` Cloud Storage bucket mounted at `/data` via GCS FUSE | `storage_buckets` output |
| PVC/GCS conflict prevention | Passes `enable_gcs_storage_volume = false` to itself when Chroma_GKE uses a StatefulSet PVC, preventing a double-mount at `/data` | StatefulSet section in Chroma_GKE guide |
| Health checks | Supplies the default startup and liveness probe paths, both fixed to `/api/v2/heartbeat` | Observability section in the platform guides |
| Initialization jobs | Accepts optional user-supplied init jobs; injects no default job — Chroma needs no database bootstrap | `initialization_jobs` output |

---

## 2. Auth token in Secret Manager

When `enable_auth_token = true` in the platform module, Chroma_Common generates a
32-character alphanumeric token, stores it in Secret Manager, and waits 30 seconds
for propagation before dependent resources proceed. All API calls to Chroma must then
include `Authorization: Bearer <token>`. Retrieve the token after deployment:

```bash
# List secrets and identify the auth token:
gcloud secrets list --project "$PROJECT" --filter="name~auth-token"
# Retrieve the token value:
gcloud secrets versions access latest --secret=<prefix>-auth-token --project "$PROJECT"
```

The secret ID is reported via the `CHROMA_SERVER_AUTHN_CREDENTIALS` entry in the
platform deployment's secret outputs. See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. No database — Chroma's embedded storage

Chroma manages its own embedded storage engine: a SQLite metadata database, HNSW
index files, and collection data are all written to the `/data` directory inside the
container. There is no external SQL dependency. `database_type = "NONE"` is fixed and
cannot be overridden — no Cloud SQL instance is created and no `db-init` job is
injected.

Inspect the on-disk layout in Cloud Storage (Cloud Run) or on the PVC (GKE):

```bash
# Cloud Run — GCS FUSE-backed storage:
gcloud storage ls gs://<prefix>-data/chroma/

# GKE — access data directly from a pod:
kubectl exec -n "$NAMESPACE" <pod-name> -- ls /data
```

---

## 4. Fixed environment variables

The following environment variables are always injected into every Chroma container,
regardless of platform variant:

| Variable | Value | Purpose |
|---|---|---|
| `ANONYMIZED_TELEMETRY` | `false` | Disables Docker Hub telemetry for privacy and reproducibility |
| `CHROMA_SERVER_HTTP_PORT` | `8000` | Matches the `container_port = 8000` set by Chroma_Common |
| `CHROMA_SERVER_AUTHN_PROVIDER` | `chromadb.auth.token_authn.TokenAuthenticationServerProvider` | Injected only when `enable_auth_token = true`; activates token-auth on the API |
| `CHROMA_SERVER_AUTHN_CREDENTIALS` | Secret Manager secret | Injected as a Secret Manager-backed env var only when `enable_auth_token = true` |

Additional env vars passed via `environment_variables` from the platform module are
merged in alongside these fixed values.

---

## 5. GCS data bucket and PVC conflict prevention

A single Cloud Storage bucket is declared with name suffix `data` and mounted at
`/data` via GCS FUSE. This bucket is the primary persistence backend on Cloud Run.

On GKE, when `stateful_pvc_enabled = true`, Chroma_GKE passes
`enable_gcs_storage_volume = false` to Chroma_Common. This suppresses the GCS FUSE
volume definition so that the StatefulSet PVC at `/data` and the GCS FUSE volume do
not conflict. In that case the `storage_buckets` output is an empty list and no data
bucket is mounted (though the bucket may still be provisioned separately for backups).

Explore the bucket:

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-data/
```

---

## 6. Health probe behaviour

Both the startup and liveness probes in every Chroma deployment are hard-coded to
target `/api/v2/heartbeat` — the only health endpoint Chroma exposes. The probe path
is overridden by Chroma_Common regardless of what the platform module passes:

```
startup_probe  = merge(var.startup_probe,  { path = "/api/v2/heartbeat" })
liveness_probe = merge(var.liveness_probe, { path = "/api/v2/heartbeat" })
```

Only the timing parameters (`initial_delay_seconds`, `timeout_seconds`,
`period_seconds`, `failure_threshold`) can be adjusted from the platform module. The
default startup probe allows 15 seconds initial delay and 10 failure threshold to
accommodate GCS FUSE mount time and HNSW index loading on first start.

Both variants (GKE and Cloud Run) use an HTTP probe at `/api/v2/heartbeat`, which
returns HTTP 200 once Chroma is fully initialised and ready to serve requests.

---

## 7. Container image

Chroma_Common sets `container_image = "chromadb/chroma"` with `image_source = "custom"`,
directing Cloud Build to mirror the Docker Hub image into the deployment's Artifact
Registry repository before the workload is started. The exact version tag is
controlled by `application_version` in the platform module (`latest` by default).

Pin to a specific version tag in production:

```bash
# List available tags mirrored to Artifact Registry:
gcloud artifacts docker tags list <region>-docker.pkg.dev/<project>/<repo>/chroma \
  --project "$PROJECT"
```

---

For the Chroma-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Chroma_GKE](Chroma_GKE.md)** and **[Chroma_CloudRun](Chroma_CloudRun.md)**.
