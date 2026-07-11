---
title: "Qdrant Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Qdrant module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Qdrant Common — Shared Application Configuration

`Qdrant_Common` is the **shared application layer** for Qdrant. It is not
deployed on its own; instead it supplies the Qdrant-specific configuration that
both [Qdrant_GKE](Qdrant_GKE.md) and [Qdrant_CloudRun](Qdrant_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of
its own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Qdrant, see the platform
guides ([Qdrant_GKE](Qdrant_GKE.md), [Qdrant_CloudRun](Qdrant_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Qdrant_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official `qdrant/qdrant` image and the build that extends it | `container_image` output of the platform deployment |
| No SQL database | Fixes `database_type = "NONE"` — Qdrant is a self-contained store | No Cloud SQL instance or database credentials are created |
| No Redis | No cache dependency — Qdrant manages its own in-memory structures | `enable_redis` is hard-coded to `false` in wrapper modules |
| Storage path | Sets `QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage` aligned with the GCS FUSE or PVC mount | Container environment; GCS bucket / PVC mount in platform guides |
| HTTP port | Sets `QDRANT__SERVICE__HTTP_PORT=6333` explicitly | Container environment |
| API key (optional) | Generates a 32-character API key, stores it in **Secret Manager**, and injects it as `QDRANT__SERVICE__API_KEY` | Retrieve via Secret Manager (see below) |
| Object storage | Declares the **Cloud Storage** storage bucket (`<prefix>-storage`) at `/qdrant/storage` | `storage_buckets` output |
| Health probes | Supplies the default startup (`/readyz`) and liveness (`/livez`) probe configuration with distinct endpoints | §Observability in the platform guides |

---

## 2. API key in Secret Manager

When `enable_api_key = true`, a 32-character alphanumeric API key is generated
and stored as a Secret Manager secret. It is never set in plain text. Retrieve
it after deployment:

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~api-key"
gcloud secrets versions access latest --secret=<api-key-secret> --project "$PROJECT"
```

Once retrieved, pass it in all REST and gRPC calls:

```bash
# REST example:
curl -H "api-key: <key>" https://<qdrant-url>/collections

# Python client:
# qdrant_client.QdrantClient(host="...", api_key="<key>")
```

The API key secret ID is reported as `qdrant_api_key_secret_id` in the GKE
platform deployment outputs. See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Storage — no SQL database, GCS FUSE or PVC

Qdrant manages its own embedded storage engine. There is **no Cloud SQL
database** and no database bootstrap job. On first start, Qdrant initialises its
storage directory at `/qdrant/storage` automatically.

Two persistent storage backends are available:

**Cloud Storage via GCS FUSE (default):** `Qdrant_Common` always declares a
`<prefix>-storage` bucket. When `enable_gcs_storage_volume = true` (the
default), the bucket is mounted at `/qdrant/storage` via the GCS FUSE CSI
driver. This is the default for `Qdrant_CloudRun` and for `Qdrant_GKE` without
a StatefulSet PVC.

**StatefulSet PVC (GKE only, recommended for production):** When
`Qdrant_GKE` is deployed with `stateful_pvc_enabled = true`, it passes
`enable_gcs_storage_volume = false` to `Qdrant_Common`. This prevents a
double-mount conflict at `/qdrant/storage` between the PVC and the GCS FUSE
volume. The bucket is still provisioned (for backup use), but not mounted as a
live data path.

Explore storage resources:

```bash
# GCS FUSE storage bucket
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-storage/collections/

# PVC status (GKE only)
kubectl get pvc -n "$NAMESPACE"
```

---

## 4. Core application settings

`Qdrant_Common` establishes the Qdrant baseline environment so the application
comes up correctly on first boot:

- **Storage path** — `QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage` is always
  injected and aligned with the GCS FUSE mount point or the StatefulSet PVC
  mount path.
- **HTTP port** — `QDRANT__SERVICE__HTTP_PORT=6333` is always injected
  explicitly.
- **gRPC disabled by default** — `QDRANT__SERVICE__GRPC_PORT` is intentionally
  not set. Neither the default GKE ClusterIP/LoadBalancer Service nor Cloud Run
  exposes port 6334. Enable via `environment_variables =
  &#123; QDRANT__SERVICE__GRPC_PORT = "6334" &#125;` in the GKE wrapper and configure a
  second Service port manually if gRPC is needed.
- **No initialization job** — Qdrant requires no database bootstrap. If
  `initialization_jobs` is non-empty in the wrapper, those jobs are passed
  through; otherwise no job is created.
- **Image source** — `Qdrant_Common` uses `image_source = "custom"` so the
  foundation runs a Cloud Build pipeline to mirror the `qdrant/qdrant` image
  into Artifact Registry before deployment.

---

## 5. Health probe behaviour

Qdrant exposes two dedicated health endpoints with distinct purposes:

| Endpoint | Purpose | Used by |
|---|---|---|
| `/readyz` | Readiness — returns 200 only when all collections are fully loaded and Qdrant is ready to serve traffic | Startup probe |
| `/livez` | Liveness — always returns 200 as long as the Qdrant process is alive, regardless of collection load state | Liveness probe |

**Critical distinction:** Qdrant temporarily marks itself not-ready while
loading large collections from storage. If `/readyz` were the liveness target,
Kubernetes and Cloud Run would interpret the temporary 503 as a container
failure and restart the pod or instance — which in turn triggers another full
collection reload, creating a restart loop. Always use `/livez` for liveness.

Both `Qdrant_GKE` and `Qdrant_CloudRun` use HTTP probes (not TCP), because
Qdrant does not issue HTTP→HTTPS redirects and the probe traffic is unaffected
by TLS settings.

---

## 6. Object storage

A dedicated **Cloud Storage** storage bucket (`<prefix>-storage`) is declared
here and provisioned by the foundation. The bucket uses `STANDARD` storage class
with `public_access_prevention = "enforced"`. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-storage/
```

The workload service account is granted read/write access via Workload Identity
by the foundation module. For GCS FUSE operation, additional IAM roles are
handled automatically.

---

For the Qdrant-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform
guides: **[Qdrant_GKE](Qdrant_GKE.md)** and
**[Qdrant_CloudRun](Qdrant_CloudRun.md)**.
