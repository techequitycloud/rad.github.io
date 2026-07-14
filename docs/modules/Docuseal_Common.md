---
title: "Docuseal Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Docuseal module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Docuseal Common — Shared Application Configuration

`Docuseal_Common` is the **shared application layer** for DocuSeal. It is not
deployed on its own; instead it supplies the DocuSeal-specific configuration that
both [Docuseal_GKE](Docuseal_GKE.md) and [Docuseal_CloudRun](Docuseal_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

DocuSeal is an open-source document-signing platform (a self-hosted DocuSign
alternative) built on **Ruby on Rails** and served by **Puma**. The upstream
`docuseal/docuseal` image serves the whole application on **port 3000** and runs its
ActiveRecord migrations on boot, so a single container is sufficient — there is no
separate worker, queue, or migrate service.

For the infrastructure that actually provisions and runs DocuSeal, see the platform
guides ([Docuseal_GKE](Docuseal_GKE.md), [Docuseal_CloudRun](Docuseal_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Docuseal_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates a stable Rails `SECRET_KEY_BASE` (64-char) and stores it in **Secret Manager** | Injected automatically as a secret env var; retrieve via Secret Manager (see below) |
| Container image | Builds a **thin custom wrapper** `FROM docuseal/docuseal:<version>` with a cloud entrypoint; mirrored into Artifact Registry via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the role, database, and grants | `initialization_jobs` output |
| Persistent documents | Declares `WORKDIR = /data/docuseal` for uploaded documents/attachments, backed by NFS (Cloud Run) or a block PVC (GKE) | §Persistence in the platform guides |
| Object storage | Declares one **Cloud Storage** bucket (suffix `storage`) | `storage_buckets` output |
| Core settings | Sets the baseline DocuSeal environment: port 3000, stdout logging, persistent work directory | Application behaviour in the platform guides |
| Health checks | Supplies the default startup / liveness / readiness probes targeting `/up` | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set
in plain text and must never be changed after the first deployment:

- **`SECRET_KEY_BASE`** — a 64-character random string generated once and stored as
  `secret-<resource_prefix>-<app>-secret-key-base`. Rails uses it to sign and verify
  all session cookies and other signed/encrypted values. If it is left unset DocuSeal
  generates an ephemeral key on every boot, which invalidates every active session on
  each restart; pinning a durable value in Secret Manager keeps signed sessions and
  cookies valid across restarts and revisions. Rotating it after first boot logs every
  user out and invalidates any outstanding signed tokens.

Retrieve the secret after deployment:

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

DocuSeal requires **PostgreSQL 15** (`database_type = "POSTGRES_15"`); the engine is
fixed and MySQL or other engines are not supported. DocuSeal reads a single
`DATABASE_URL`, which the cloud entrypoint composes at runtime from the
Foundation-injected `DB_*` variables (see §4).

On the first deployment a one-shot job (`db-init`) runs using `postgres:15-alpine`
and idempotently:

1. Waits for PostgreSQL to be reachable,
2. Creates (or reconfigures) the application role `docuseal` with `LOGIN CREATEDB`
   and the generated password,
3. Creates the `docuseal` database if it does not already exist (owned by `postgres`,
   because Cloud SQL's `postgres` login cannot `SET ROLE` to application roles),
4. Grants the application role full privileges on the database and — because
   PostgreSQL 15 no longer grants `CREATE` on `public` by default — `GRANT ALL ON
   SCHEMA public` and reassigns ownership of `public` to the app role so its
   migrations can create tables,
5. Signals the Cloud SQL Auth Proxy sidecar to shut down so the GKE Job pod completes.

There is **no separate migration job** — DocuSeal runs its own ActiveRecord
migrations automatically on boot as the application role. The `db-init` job is safe to
re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=docuseal --database=docuseal --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a **thin wrapper** `FROM docuseal/docuseal:<version>` (built via
Cloud Build and mirrored into Artifact Registry). It drops in a POSIX-`sh` cloud
entrypoint that runs before Puma starts and then `exec`s the image's own Puma command
verbatim (`/app/bin/bundle exec puma -C /app/config/puma.rb`):

- **Composes `DATABASE_URL`** from the Foundation-injected `DB_*` variables. Ruby's
  URI parser **cannot** parse the Cloud SQL Unix-socket DSN (the socket path's colons
  break URL parsing), so the module deploys with `enable_cloudsql_volume = false` and
  the entrypoint branches on `DB_HOST`:
  - `127.0.0.1` / `localhost` (GKE Auth Proxy sidecar loopback) → plain TCP, no SSL
    (the proxy terminates TLS to Cloud SQL),
  - otherwise a private IP (Cloud Run) → TCP with `?sslmode=require` (Cloud SQL
    rejects unencrypted private-IP TCP).
  Credential components are URL-encoded with Ruby before being placed in the URL.
- **Builds via an app-specific build ARG.** The Dockerfile uses `ARG DOCUSEAL_VERSION`
  (not the generic `APP_VERSION`, which the Foundation injects and would otherwise
  clobber to `latest`). `docuseal/docuseal:latest` is a valid published tag, so
  `latest` maps to itself and any explicit version passes through.
- **Prepares the persistent work directory** — `WORKDIR = /data/docuseal` for uploaded
  documents/attachments, created at boot and backed by NFS (Cloud Run) or a PVC (GKE).

---

## 5. Core application settings

`Docuseal_Common` establishes the baseline DocuSeal environment so the application
comes up correctly on first boot:

- **Port** — `container_port = 3000`. DocuSeal serves via Puma on 3000. `PORT` is
  **not** set here: Cloud Run reserves and auto-injects `PORT` (and rejects a
  user-provided one), and on GKE Puma falls back to its config default of 3000 — which
  matches `container_port`, so leaving `PORT` unset works on both platforms.
- **Logging** — `RAILS_LOG_TO_STDOUT = "true"` so Cloud Logging captures the Rails log.
- **Work directory** — `WORKDIR = "/data/docuseal"`, the persistent volume where
  uploaded documents and attachments are written.
- **No Redis** — DocuSeal uses a PostgreSQL-backed queue/cache (`VALKEY_URL` empty), so
  no Redis endpoint is injected and `enable_redis` defaults to `false`.
- **Secret env** — `SECRET_KEY_BASE` is injected from Secret Manager (see §2).

---

## 6. Health probe behaviour

The default startup, liveness, and readiness probes all target **`/up`** — Rails'
built-in health endpoint, which returns an unauthenticated `200` once the Rails
process is up. A generous startup window (60-second initial delay, 30 failures at a
15-second period) accommodates the ActiveRecord migrations that run on first boot.

Because the probes run unauthenticated (the Cloud Run front-end / the GKE kubelet),
they must hit `/up` rather than any authenticated DocuSeal page, or the revision/pod
would never become Ready.

---

## 7. Persistence and object storage

DocuSeal stores uploaded documents and attachments on the **local filesystem** under
`/data/docuseal`, so it needs a persistent volume rather than object storage:

- **Cloud Run** backs `/data/docuseal` with the shared **NFS** volume
  (`enable_nfs = true`, `nfs_mount_path = /data/docuseal`).
- **GKE** backs it with **NFS** by default, or with a per-pod **block PVC** when
  `stateful_pvc_enabled = true` (which auto-selects a StatefulSet) mounted at
  `/data/docuseal`.

`Docuseal_Common` additionally declares one **Cloud Storage** bucket (name suffix
`storage`, STANDARD class, `public_access_prevention = enforced`) that the foundation
provisions and grants the workload access to; DocuSeal's document store defaults to
the persistent volume above rather than this bucket. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the DocuSeal-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Docuseal_GKE](Docuseal_GKE.md)** and **[Docuseal_CloudRun](Docuseal_CloudRun.md)**.
