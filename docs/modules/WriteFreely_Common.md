---
title: "WriteFreely Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the WriteFreely module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# WriteFreely Common — Shared Application Configuration

`WriteFreely_Common` is the **shared application layer** for WriteFreely. It is not
deployed on its own; instead it supplies the WriteFreely-specific configuration that
both [WriteFreely_GKE](WriteFreely_GKE.md) and
[WriteFreely_CloudRun](WriteFreely_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs WriteFreely, see the
platform guides ([WriteFreely_GKE](WriteFreely_GKE.md),
[WriteFreely_CloudRun](WriteFreely_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by WriteFreely_Common | Where it surfaces |
|---|---|---|
| Cryptographic keys | Generates three **AES-256 (32-byte)** key files — `cookies_auth`, `cookies_enc`, `email` — and stores them in **Secret Manager** as base64 | Injected as `WF_KEY_COOKIES_AUTH` / `WF_KEY_COOKIES_ENC` / `WF_KEY_EMAIL`; retrieve via Secret Manager (see below) |
| Container image | Builds a **thin custom wrapper** on top of the official `writeas/writefreely` image, adding a config-gen entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`database_type = MYSQL_8_0`) as the engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Schema initialization | The entrypoint runs `writefreely db init` on every start to create the tables | §Application behaviour in the platform guides |
| Object storage | Declares a **Cloud Storage** data bucket (`writefreely-uploads`) | `storage_buckets` output |
| Core settings | Renders `config.ini` from injected `DB_*` vars; sets bind address, port, public host, registration state | Application behaviour in the platform guides |
| Health checks | Supplies the default TCP startup probe and HTTP `/` liveness probe | §Observability in the platform guides |

---

## 2. Cryptographic keys in Secret Manager

WriteFreely refuses to start without its three AES-256 key files (raw 32 bytes each,
written to `keys/cookies_auth.aes256`, `keys/cookies_enc.aes256`, and
`keys/email.aes256`). If the app were left to `writefreely keys generate`, it would
mint *fresh random keys on every container start* — which invalidates all sessions on
restart and, worse, breaks any multi-instance deployment (each instance would sign
cookies with a different key, so a cookie issued by instance A is rejected by instance
B, producing a login loop).

`WriteFreely_Common` therefore generates the three keys **once** at plan time (as
`random_id` resources with `byte_length = 32`, base64-encoded), stores them in Secret
Manager, and injects them as secret env vars. The entrypoint base64-decodes each one
into the `keys/` directory before starting the server:

- **`WF_KEY_COOKIES_AUTH`** → `keys/cookies_auth.aes256` — authenticates (signs)
  session cookies.
- **`WF_KEY_COOKIES_ENC`** → `keys/cookies_enc.aes256` — encrypts session cookie
  payloads.
- **`WF_KEY_EMAIL`** → `keys/email.aes256` — encrypts stored email addresses.

The three Secret Manager secrets are named:

```
secret-<resource-prefix>-writefreely-cookies-auth
secret-<resource-prefix>-writefreely-cookies-enc
secret-<resource-prefix>-writefreely-email-key
```

These keys must **never** be rotated after the first deployment — rotating them logs
out every user and makes previously encrypted email data undecryptable. A
`cleanup_orphaned_secrets` submodule clears any stale same-named secrets before
(re)creation, and a 30-second `time_sleep` guards against read-after-write
consistency races when the values are consumed.

Retrieve the keys after deployment:

```bash
# List the WriteFreely key secrets (names include the resource prefix):
gcloud secrets list --project "$PROJECT" \
  --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"

# Read a secret version (base64 of the raw 32-byte key):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared secret
and Workload Identity model.

---

## 3. Container image and entrypoint

The stock `writeas/writefreely` image expects a `config.ini` file and pre-generated
key files, and has **no mechanism to take its database coordinates from the
environment**. Because Cloud Run and GKE cannot mount a host-supplied config file,
`WriteFreely_Common` bakes a thin wrapper (`Dockerfile` + `entrypoint.sh`) on top of
the official image and builds it with Cloud Build (`image_source = "custom"`).

The Dockerfile derives its base tag from an **app-specific** build ARG,
`WRITEFREELY_VERSION` (default `0.12.0`) — *not* the generic `APP_VERSION`, which the
foundation injects into `build_args` and would otherwise clobber to `latest`.
`WriteFreely_Common` maps an `application_version` of `latest` to the pinned known-good
tag before setting the ARG, keeping base-image resolution deterministic.

The config-gen entrypoint (`entrypoint.sh`, an Alpine `/bin/sh` script) runs before
the WriteFreely binary and:

1. **Locates the binary and asset root** — resolves the `writefreely` binary and the
   working directory that actually contains `templates/` (WriteFreely resolves
   `templates/`, `static/`, `pages/`, `keys/`, and `config.ini` relative to CWD).
2. **Renders `config.ini`** — writes the `[server]`, `[database]`, and `[app]`
   sections from the Foundation-injected `DB_HOST` / `DB_PORT` / `DB_NAME` /
   `DB_USER` / `DB_PASSWORD` and the `WF_*` settings (`WF_BIND`, `WF_PORT`,
   `WF_PUBLIC_URL`, `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_OPEN_REGISTRATION`).
   `[database] type = mysql` is fixed.
3. **Seeds the stable encryption keys** — base64-decodes the `WF_KEY_*` secret env
   vars into `keys/*.aes256`; falls back to generating ephemeral keys only if they
   are absent.
4. **Initialises the schema** — runs `writefreely db init` (tolerant of "tables
   already exist" so restarts do not fail).
5. **Serves** — `exec writefreely serve` as PID 1, binding `0.0.0.0:8080`.

The public host used for generated links comes from `WF_PUBLIC_URL`, falling back to
`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` injected by the foundation.

---

## 4. Database engine and bootstrap

WriteFreely is provisioned against **Cloud SQL for MySQL 8.0** (`database_type =
MYSQL_8_0`); the default database and user names are both `writefreely`. On the first
deployment a one-shot job (`db-init`) runs using `mysql:8.0-debian` and idempotently:

1. Resolves the connection — prefers the Cloud SQL Auth Proxy Unix socket under
   `/cloudsql` when mounted, otherwise falls back to TCP via `DB_IP` (private IP),
2. Waits for MySQL port 3306 to be reachable,
3. Creates (or updates) the application user with the generated password,
4. Creates the application database if it does not exist,
5. Grants `ALL PRIVILEGES` on the database to the application user (which lets the
   app's own `writefreely db init` create the tables on start),
6. Verifies the app user can authenticate (populating the MySQL 8
   `caching_sha2_password` server cache), then gracefully shuts down the Cloud SQL
   Proxy sidecar via `quitquitquit`.

The job is safe to re-run (`CREATE ... IF NOT EXISTS`, `max_retries = 3`). The
*table* schema itself is created by the application entrypoint (`writefreely db init`),
not by this job. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 5. Core application settings

`WriteFreely_Common` establishes the baseline WriteFreely environment so the
application comes up correctly on first boot:

- **Bind & port** — `WF_BIND = "0.0.0.0"`, `WF_PORT = "8080"`; `DB_PORT = "3306"`.
- **Public host** — `WF_PUBLIC_URL` is set to the predicted service URL when known,
  and the entrypoint falls back to the foundation-injected `CLOUDRUN_SERVICE_URL` /
  `GKE_SERVICE_URL` at runtime — so federation links and redirects use the real host.
- **Registration** — `open_registration = false` by default (override with
  `WF_OPEN_REGISTRATION`), `single_user = false`, `max_blogs = 1`, `federation =
  false`, `public_stats = true`. No administrator account is created automatically —
  see the first-run steps in the platform guides.
- **Site metadata** — `WF_SITE_NAME` (default `WriteFreely`) and
  `WF_SITE_DESCRIPTION` (empty) can be supplied via `environment_variables`.

Platform-specific adjustments handled by the variant wrappers:

- **Cloud Run** connects to MySQL over **private-IP TCP** (`enable_cloudsql_volume =
  false`); Cloud SQL MySQL accepts unencrypted private-IP TCP, so `DB_HOST` is the
  instance private IP.
- **GKE** connects through the **Cloud SQL Auth Proxy sidecar** and overrides
  `DB_HOST = 127.0.0.1` (`enable_cloudsql_volume = true`).

> **Note — WordPress-scaffold leftovers.** WriteFreely is a **Go** application and
> does **not** use PHP or Redis. The `php_memory_limit`, `upload_max_filesize`,
> `post_max_size`, `enable_redis`, `redis_host`, and `redis_port` variables are
> inherited from the module scaffold and are **not consumed** by WriteFreely; their
> defaults are inert for this application.

---

## 6. Health probe behaviour

WriteFreely serves its home page at `/` and returns a `200` there once the server is
up and connected to MySQL — there is no dedicated `/health` endpoint. The defaults
reflect this:

- **Startup probe** — **TCP** on the container port (`type = "TCP"`, 30-second initial
  delay, 15-second period, 20-failure threshold ≈ 5 minutes) — the workload becomes
  Ready as soon as it binds port 8080, independent of DB latency on first boot.
- **Liveness probe** — **HTTP** `GET /` (300-second initial delay, 60-second period,
  3-failure threshold) — restarts the container if the home page stops responding.

---

## 7. Object storage

A dedicated **Cloud Storage** data bucket (name suffix `writefreely-uploads`) is
declared here and provisioned by the foundation, which also grants the workload
service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the WriteFreely-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[WriteFreely_GKE](WriteFreely_GKE.md)** and
**[WriteFreely_CloudRun](WriteFreely_CloudRun.md)**.
