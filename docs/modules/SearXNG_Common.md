---
title: "SearXNG Common \u2014 Shared Application Configuration"
---

# SearXNG Common — Shared Application Configuration

`SearXNG_Common` is the **shared application layer** for SearXNG. It is not
deployed on its own; instead it supplies the SearXNG-specific configuration that
both [SearXNG_GKE](SearXNG_GKE.md) and [SearXNG_CloudRun](SearXNG_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs SearXNG, see the platform
guides ([SearXNG_GKE](SearXNG_GKE.md), [SearXNG_CloudRun](SearXNG_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by SearXNG_Common | Where it surfaces |
|---|---|---|
| Session secret | Generates `SEARXNG_SECRET` and stores it in **Secret Manager** | Injected at runtime; retrieve via Secret Manager (see below) |
| Container image | Pins `searxng/searxng` and the image mirroring flag | `container_image` output of the platform deployment |
| No database | Sets `database_type = "NONE"` and `enable_cloudsql_volume = false` | No Cloud SQL instance is provisioned |
| No storage | Outputs an empty `storage_buckets` list | No GCS bucket is provisioned by default |
| Container configuration | Pins container port to `8080`, sets probe paths to `/healthz`, sets `image_source = "custom"` for the Cloud Build pipeline | §Container and §Health probe in the platform guides |
| Health probes | Supplies HTTP `/healthz` startup and liveness probe defaults | §Observability in the platform guides |

---

## 2. SEARXNG_SECRET in Secret Manager

`SEARXNG_Common` generates a 32-character random secret and stores it as a Secret
Manager secret. This key is SearXNG's session cryptography key — it signs cookies
and HMAC query parameters. All running instances must share the same value.

Retrieve it after deployment:

```bash
# List secrets and find the session key:
gcloud secrets list --project "$PROJECT" --filter="name~searxng.*key"
gcloud secrets versions access latest --secret=<session-key-secret> --project "$PROJECT"
```

**Do not rotate this secret in production without coordinating with active
sessions.** Rotating the key immediately invalidates all existing user session
cookies, logging out every active user. The platform deployment manages the
secret's lifecycle automatically.

For GKE deployments, the explicit secret value is also output so the Kubernetes
Secret Store CSI driver can inject it on first apply without read-after-write
consistency delays.

---

## 3. No database, no storage

SearXNG is entirely stateless — it aggregates search results from external engines
at request time. There is no database, no file uploads, and no shared filesystem.

- `database_type = "NONE"` — no Cloud SQL instance is provisioned.
- `enable_cloudsql_volume = false` — no Cloud SQL Auth Proxy sidecar is injected.
- `storage_buckets = []` — no GCS bucket is created by default.

If you enable `create_cloud_storage` or `enable_nfs` in the platform module, those
resources are provisioned by the foundation but are not used by SearXNG itself.

---

## 4. Container image and build

`SearXNG_Common` sets `container_image = "searxng/searxng"` with
`image_source = "custom"` to route the image through the Cloud Build pipeline in
Artifact Registry. The `Dockerfile` in `scripts/` extends the official SearXNG
image, allowing custom build arguments (such as `APP_VERSION`) to be passed.

The `enable_image_mirroring` flag (default `true`) mirrors the upstream image into
Artifact Registry before deployment, avoiding Docker Hub rate limits.

Inspect the image in Artifact Registry:

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/<project-id>/<repo-name> --project "$PROJECT"
```

---

## 5. Core application settings

`SearXNG_Common` assembles the baseline SearXNG environment:

- **Container port** is fixed at `8080` — SearXNG's native HTTP port.
- **`SEARXNG_BIND_ADDRESS`** is injected as `0.0.0.0:8080` by the calling
  platform module so SearXNG listens on all interfaces.
- **`ENABLE_REDIS` and `REDIS_URL`** are injected by the platform module when
  `enable_redis = true`, pointing to the configured Redis endpoint.
- The `environment_variables` passed from the platform module (such as
  `INSTANCE_NAME` and `AUTOCOMPLETE`) are forwarded into the container
  configuration as-is.

---

## 6. Health probe behaviour

The default probes target SearXNG's `/healthz` endpoint, which responds with HTTP
200 when the application is fully initialised.

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/healthz` | 10s | 10s | 6 |
| Liveness | HTTP | `/healthz` | 15s | 30s | 3 |

SearXNG starts in under 5 seconds (no database migrations), so the short initial
delays are intentional. The `/healthz` path is served without authentication or
redirect, so both HTTP and TCP probe types work on either platform.

---

For the SearXNG-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[SearXNG_GKE](SearXNG_GKE.md)** and
**[SearXNG_CloudRun](SearXNG_CloudRun.md)**.
