---
title: "LibreChat Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the LibreChat module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# LibreChat Common — Shared Application Configuration

`LibreChat_Common` is the **shared application layer** for LibreChat. It is not deployed on
its own; instead it supplies the LibreChat-specific configuration that both
[LibreChat_GKE](LibreChat_GKE.md) and [LibreChat_CloudRun](LibreChat_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what it provides
explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs LibreChat, see the platform guides
([LibreChat_GKE](LibreChat_GKE.md), [LibreChat_CloudRun](LibreChat_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by LibreChat_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `MONGO_URI` and stores them in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Pins the official LibreChat image (`ghcr.io/danny-avila/librechat`) and mirrors it to Artifact Registry | `container_image` output of the platform deployment |
| Database connectivity | Manages the MongoDB URI — three modes: explicit URI, manual Firestore config, or Firestore ENTERPRISE auto-provisioning | `MONGO_URI` secret; §Database below |
| Object storage | Declares a **Cloud Storage** bucket (suffix `uploads`) for user file uploads | `storage_buckets` output |
| Port binding | Sets `container_port = 3080` — LibreChat's Express server port | Service/revision configuration |
| Core settings | Sets the baseline LibreChat environment (`HOST`, `NODE_ENV`, `APP_TITLE`, `TRUST_PROXY`, `ALLOW_REGISTRATION`, `DOMAIN_CLIENT`, `DOMAIN_SERVER`) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup and liveness probe configuration, targeting LibreChat's root path (`/`) with a generous startup delay | Observability in the platform guides |

---

## 2. Auto-generated secrets in Secret Manager

Five core LibreChat secrets are generated automatically on first deploy and stored in
Secret Manager. Two more (`scram-password`, `firestore-host`) are added only when the Firestore
MongoDB-compatible auto-provisioning path is active (§3) — which is the **default** whenever
`mongodb_uri` and `firestore_mongodb_host` are both left empty. All are injected into the
workload at runtime; plaintext is never written to state files or logs.

| Secret suffix | Environment variable | Content |
|---|---|---|
| `creds-key` | `CREDS_KEY` | 32-byte random hex string — AES-GCM encryption key for saved AI provider credentials |
| `creds-iv` | `CREDS_IV` | 16-byte random hex string — AES-GCM initialisation vector paired with `CREDS_KEY` |
| `jwt-secret` | `JWT_SECRET` | 64-character random string — signs user access tokens |
| `jwt-refresh-secret` | `JWT_REFRESH_SECRET` | 64-character random string — signs long-lived refresh tokens |
| `mongo-uri` | `MONGO_URI` | MongoDB connection string (explicit or Firestore-constructed) |
| `scram-password` | `SCRAM_PASSWORD` | Auto-generated SCRAM-SHA-256 password for the Firestore UserCreds principal (Firestore mode only) |
| `firestore-host` | `FIRESTORE_HOST` | MongoDB-compatible Firestore connection host, stored as a secret because it is unknown at plan time on first create (Firestore mode only) |

Retrieve a secret after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~librechat"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

> **Treat `CREDS_KEY` and `CREDS_IV` as immutable after users begin saving AI provider
> credentials.** Rotating either key makes all stored credentials undecryptable — every user
> must re-enter their API keys.

> **Rotating `JWT_SECRET` invalidates all active sessions immediately.** Plan rotations during
> a maintenance window.

---

## 3. MongoDB connectivity modes

LibreChat requires MongoDB. `LibreChat_Common` supports three mutually exclusive connection
paths:

1. **Explicit URI.** Provide `mongodb_uri` with a full MongoDB connection string
   (`mongodb+srv://...` for Atlas, `mongodb://...` for self-hosted). The URI is stored directly
   as the `MONGO_URI` secret and the Firestore provisioning path is skipped entirely.

2. **Manual Firestore configuration.** Set `firestore_mongodb_host` to the Firestore
   MongoDB-compatible endpoint and provide `firestore_mongodb_username` and
   `firestore_mongodb_password`. The module constructs the SCRAM-authenticated URI automatically
   and stores it in Secret Manager.

3. **Firestore ENTERPRISE auto-provisioning (default).** Leave all three variables empty. The
   module:
   - Discovers any externally-managed (Services_GCP-labelled) ENTERPRISE Firestore database.
   - Creates a new ENTERPRISE Firestore database if none is found (idempotent — safe on retry).
   - Enables MongoDB-compatible data access via the Firestore Admin API.
   - Provisions a SCRAM user via the Firestore UserCreds API and stores the SCRAM URI in the
     `mongo-uri` secret.

   > **The Firestore database is never deleted on destroy.** It is retained to prevent data
   > loss. Delete it manually via the Console or `gcloud firestore databases delete` if no
   > longer needed.

Inspect the Firestore database and connection:

```bash
gcloud firestore databases list --project "$PROJECT"
gcloud firestore databases describe librechat --project "$PROJECT"
```

---

## 4. Container image

`LibreChat_Common` pins `ghcr.io/danny-avila/librechat` as the base image and enables image
mirroring to Artifact Registry by default. Mirroring avoids GitHub Container Registry rate
limits and improves pull reliability in production environments.

Set `application_version` to a specific release tag (e.g. `v0.7.7`) in production to prevent
unplanned upgrades that may include breaking MongoDB schema changes.

---

## 5. Core application settings

`LibreChat_Common` injects the following environment variables so LibreChat comes up correctly
on first boot:

| Variable | Value | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind on all interfaces inside the container |
| `NODE_ENV` | `production` | Enables production optimisations in Express.js |
| `TRUST_PROXY` | `1` | Allows Express to read `X-Forwarded-For` and set Secure cookies through Cloud Run / GKE ingress |
| `APP_TITLE` | `var.app_title` | Title in the LibreChat UI header and browser tab |
| `DOMAIN_CLIENT` / `DOMAIN_SERVER` | service URL | Required for OAuth redirect URIs and email verification links |
| `ALLOW_REGISTRATION` | `var.allow_registration` | Controls self-registration |
| `ALLOW_SOCIAL_LOGIN` | `var.allow_social_login` | Controls social OAuth login |
| `ALLOW_SOCIAL_REGISTRATION` | derived | Defaults to `allow_social_login` when not explicitly set |

Additional `environment_variables` from the calling module are merged in.

---

## 6. Health probe behaviour

Both probes target LibreChat's root path (`/`), which returns HTTP 200 once the application is
fully initialised and connected to MongoDB.

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup (GKE) | HTTP | `/` | 30 s | 15 s | 12 |
| Liveness (GKE) | HTTP | `/` | 60 s | 30 s | 3 |
| Startup (Cloud Run) | HTTP | `/` | 30 s | 15 s | 10 |
| Liveness (Cloud Run) | HTTP | `/` | 60 s | 30 s | 3 |

The generous startup failure thresholds allow time for MongoDB connection establishment and
asset loading on first boot. Unlike some PHP applications, LibreChat does not issue HTTP
redirects on the root path, so a plain HTTP probe works for both platforms.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (suffix `uploads`) is declared here and provisioned by
the foundation, which also grants the workload service account access. The bucket stores user
file uploads (images, documents) shared in chat conversations. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~uploads"
```

---

For the LibreChat-specific, user-facing configuration (variables by group, outputs, and how to
explore each service from the Console and CLI), see the platform guides:
**[LibreChat_GKE](LibreChat_GKE.md)** and **[LibreChat_CloudRun](LibreChat_CloudRun.md)**.
