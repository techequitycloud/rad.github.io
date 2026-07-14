---
title: "Stirling-PDF Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Stirling-PDF module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Stirling-PDF Common — Shared Application Configuration

`StirlingPDF_Common` is the **shared application layer** for Stirling-PDF. It is
not deployed on its own; instead it supplies the Stirling-PDF-specific configuration
that both [StirlingPDF_GKE](StirlingPDF_GKE.md) and
[StirlingPDF_CloudRun](StirlingPDF_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Stirling-PDF, see the
platform guides ([StirlingPDF_GKE](StirlingPDF_GKE.md),
[StirlingPDF_CloudRun](StirlingPDF_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by StirlingPDF_Common | Where it surfaces |
|---|---|---|
| Container image | Points the deployment at the official **`stirlingtools/stirling-pdf`** prebuilt image (`image_source = "prebuilt"`); no Cloud Build step | `container_image` output of the platform deployment |
| Database engine | Fixes **`database_type = "NONE"`** — Stirling-PDF is stateless and uses no database | §Database in the platform guides |
| Secrets | **None.** `secret_ids` and `secret_values` are empty maps — login is off by default, so no session secret is required | §Environment Variables & Secrets in the platform guides |
| Object storage | **None.** `storage_buckets` is always an empty list — Stirling-PDF persists nothing | `storage_buckets` output |
| Core settings | Sets the baseline Stirling-PDF environment: login toggle (`SECURITY_ENABLELOGIN`) and default UI locale (`SYSTEM_DEFAULTLOCALE`) | Application behaviour in the platform guides |
| Runtime shape | Port 8080, CPU/memory limits (2Gi floor), and per-platform min/max instance counts | §Runtime & Scaling in the platform guides |
| Health checks | Supplies the default startup / liveness / readiness probes targeting `/api/v1/info/status` | §Observability in the platform guides |

---

## 2. No secrets, no database, no storage

Stirling-PDF is a **stateless** PDF toolkit, and this is the single most important
thing to understand about the deployment. Unlike most application layers,
`StirlingPDF_Common` generates **no secrets** and provisions **no persistent
resources**:

- **`secret_ids` is an empty map.** With login disabled by default
  (`SECURITY_ENABLELOGIN=false`) the application requires no session key, JWT
  secret, or database password. `secret_values` is likewise empty. There is nothing
  in Secret Manager to rotate or leak.
- **`database_type = "NONE"`.** No Cloud SQL instance, database, or user is created.
  Every PDF operation — merge, split, convert, OCR, compress, watermark, sign,
  redact — runs entirely in a per-request working directory that is discarded when
  the request completes.
- **`storage_buckets` is always `[]`.** No Cloud Storage bucket, no NFS share, no
  GCS Fuse volume. Nothing a user uploads is retained after the response is returned
  — documents never leave the instance.

This statelessness is what makes Stirling-PDF a natural fit for **scale-to-zero on
Cloud Run** and for **horizontal scaling on GKE without any shared-state
coordination**. There is no init job, no migration, and no first-boot data setup.

---

## 3. Container image

The deployment uses the official upstream image directly — there is no custom build:

- **Image:** `stirlingtools/stirling-pdf:<version>` (default tag `latest`).
- **Image source:** `"prebuilt"` — the Application module forwards
  `container_image_source`, and `enable_image_mirroring = true` copies the image
  into Artifact Registry (digest-aware) before deployment to avoid Docker Hub rate
  limits.
- **No Cloud Build step.** `container_build_config.enabled = false`; no Dockerfile is
  compiled at apply time.

Because the image is unmodified upstream, an application-version bump is simply a new
image tag — no rebuild is required, and there is no schema migration to run.

---

## 4. Core application settings

`StirlingPDF_Common` establishes the baseline Stirling-PDF environment so the
application comes up correctly on first boot. The Application module assembles these
into `module_env_vars`:

- **`SECURITY_ENABLELOGIN`** — set from `enable_login` (default `false`). An open
  instance ships by default; set `enable_login = true` and front the service with
  IAP or Cloud Armor for a private deployment.
- **`SYSTEM_DEFAULTLOCALE`** — set from `default_locale` (default `en-US`) to keep
  the UI language predictable.

Additional Stirling-PDF settings (for example `SYSTEM_MAXFILESIZE` to cap upload
size) can be supplied through the Application module's `environment_variables` input;
they are merged into the container environment at runtime.

There is no platform-specific URL rewriting or database mapping in play —
Stirling-PDF is stateless and self-contained, so the same configuration works
identically on Cloud Run and GKE. The only per-platform difference is the minimum
instance count (see below).

---

## 5. Runtime shape and scaling

`StirlingPDF_Common` sets the runtime defaults consumed by the foundation:

- **Port** — `container_port = 8080`.
- **Resources** — the JVM plus LibreOffice conversion engine needs a **2Gi memory
  floor**; the Application modules default to `1000m` CPU / `2Gi` memory and raise it
  for heavy OCR / conversion workloads.
- **Instance counts** — `min_instance_count` is overridden per platform:
  **`0` on Cloud Run** (scale-to-zero, request-based billing — Stirling-PDF does no
  background work) and **`1` on GKE** (which does not support scale-to-zero).
  `max_instance_count` defaults to `3`; because there is no shared state, scaling out
  is safe on either platform without a coordinating cache.

---

## 6. Health probe behaviour

The default probes target **`/api/v1/info/status`** — a public, unauthenticated
Stirling-PDF endpoint that responds 200 once the JVM and LibreOffice have finished
initialising. It is safe as a probe target even when `enable_login = true`, because
the status endpoint does not require authentication.

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/api/v1/info/status` | 10s | 10s | 6 |
| Liveness | HTTP | `/api/v1/info/status` | 15s | 30s | 3 |
| Readiness | HTTP | `/api/v1/info/status` | 20s | 10s | 3 |

The startup probe allows up to roughly **70 seconds** (10s initial delay + 6 × 10s)
for the JVM and LibreOffice to warm up on first boot — a generous window that
accommodates the slow Spring Boot + LibreOffice startup without failing the revision
(Cloud Run) or pod (GKE). Pointing a probe at an authenticated page would 403 and
never pass; `/api/v1/info/status` is the correct public liveness endpoint.

---

## 7. Outputs

`StirlingPDF_Common` exposes the following outputs, which the Application module
merges into `application_config` before passing everything to the foundation:

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full application configuration (prebuilt image, port 8080, `database_type = "NONE"`, probes, env vars, resource limits). |
| `secret_ids` | `map(string)` | Always empty — Stirling-PDF requires no secrets. |
| `secret_values` | `map(string)` | Always empty (sensitive). |
| `storage_buckets` | `list` | Always empty — Stirling-PDF is stateless. |
| `path` | `string` | Absolute filesystem path to the module directory, used to resolve `scripts_dir`. |

---

For the Stirling-PDF-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[StirlingPDF_GKE](StirlingPDF_GKE.md)** and
**[StirlingPDF_CloudRun](StirlingPDF_CloudRun.md)**.
