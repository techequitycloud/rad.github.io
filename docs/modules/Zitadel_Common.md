---
title: "Zitadel Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Zitadel module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Zitadel Common — Shared Application Configuration

`Zitadel_Common` is the **shared application layer** for Zitadel. It is not deployed
on its own; instead it supplies the Zitadel-specific configuration that both
[Zitadel_GKE](Zitadel_GKE.md) and [Zitadel_CloudRun](Zitadel_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Zitadel, see the platform
guides ([Zitadel_GKE](Zitadel_GKE.md), [Zitadel_CloudRun](Zitadel_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Zitadel_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `ZITADEL_MASTERKEY` (exactly 32 bytes) and the initial admin password, and stores them in **Secret Manager** | Injected automatically onto the service container; retrieve via Secret Manager (see below) |
| Container image | Builds a thin wrapper **FROM `ghcr.io/zitadel/zitadel`** with a cloud entrypoint, via Cloud Build; mirrored into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine (`database_type = POSTGRES_15`) | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database and role with `CREATEDB`/`CREATEROLE` and grants schema privileges | `initialization_jobs` output |
| Object storage | Declares one **Cloud Storage** bucket (`storage` suffix) | `storage_buckets` output |
| Core settings | Sets the baseline Zitadel environment: external-domain/TLS mode, port, first-instance org + human admin bootstrap | Application behaviour in the platform guides |
| Health checks | Supplies the default startup / liveness / readiness probes targeting `/debug/healthz` | §Observability in the platform guides |

Zitadel stores **all** of its state — organizations, users, projects, applications,
sessions, keys — in PostgreSQL. There is no Redis, no queue, and no file-backed
persistence for application data, so this layer wires no cache and no NFS mount.

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager. They are named
`secret-<resource_prefix>-zitadel-masterkey` and
`secret-<resource_prefix>-zitadel-admin-password`.

- **`ZITADEL_MASTERKEY`** — a 32-character (exactly 32-byte) random alphanumeric
  string. Zitadel uses it to encrypt sensitive data **at rest** in PostgreSQL
  (client secrets, key material, one-time codes). It is passed to the binary with
  `--masterkeyFromEnv` and **must be exactly 32 bytes and stable across restarts**.
  Rotating it after first boot makes all previously-encrypted data unreadable —
  treat it as immutable.
- **`ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD`** — a 20-character random password
  (upper + lower + digit + symbol, using the URL/CLI-safe set `!@#%^*-_=+`). Zitadel
  seeds the first organization's human admin with this password on first boot, so the
  instance has a known owner. `PASSWORDCHANGEREQUIRED` is set to `false`, so you can
  sign in directly with the generated credential.

Retrieve the secrets after deployment:

```bash
# List this deployment's Zitadel secrets (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~zitadel-masterkey OR name~zitadel-admin-password"

# Read the initial admin password to log in the first time:
gcloud secrets versions access latest \
  --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Zitadel requires **PostgreSQL** (v13, v14, or v15); the default and recommended
engine is **PostgreSQL 15**, and MySQL is not supported (a plan-time validation guard
rejects any non-Postgres `database_type`). On the first deployment a one-shot job
(`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Resolves the Cloud SQL host — a Unix-socket directory (Cloud Run), `127.0.0.1`
   (GKE Auth Proxy sidecar), or a private IP — and waits for PostgreSQL to accept
   connections,
2. Creates (or reconciles via `ALTER ROLE`) the application role with **`LOGIN`,
   `CREATEDB`, and `CREATEROLE`** — these elevated rights are required because Zitadel
   runs its own setup phase as the Postgres "admin" user and creates/manages its own
   schema objects and roles,
3. Creates the application database if it does not exist,
4. Grants all privileges on the database and grants/chowns the `public` schema to the
   application role (PostgreSQL 15 no longer grants `CREATE` on `public` by default),
5. Signals the Cloud SQL Auth Proxy sidecar to shut down (`/quitquitquit`) so the GKE
   Job pod can complete.

The job is safe to re-run. **Zitadel itself runs the actual schema creation and
migrations** — `db-init` only prepares the empty database and a sufficiently-privileged
role; see §5. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and cloud entrypoint

The upstream `ghcr.io/zitadel/zitadel` image is **scratch-based** — just the static Go
binary and CA certificates, with no `/bin/sh`, `/etc/passwd`, or `/etc/group`. The
module builds a thin wrapper that grafts a static `busybox` into the image so a shell
entrypoint can run (per the repo's scratch/distroless convention):

- The base tag comes from an **app-specific build ARG `ZITADEL_VERSION`** (not the
  generic `APP_VERSION`, which the foundation injects and clobbers to `latest` — a tag
  Zitadel does not always publish). `Zitadel_Common` maps `application_version = "latest"`
  to a pinned known-good tag (`v2.71.0`).
- The entrypoint is installed with `COPY --chmod` (no `RUN`, which would need
  `/etc/group`) and invoked through the grafted busybox `sh`.
- `CMD` is `zitadel start-from-init --masterkeyFromEnv --tlsMode external` — TLS is
  terminated upstream by Cloud Run or the GKE LoadBalancer.

The cloud entrypoint (`entrypoint.sh`) runs before the binary and, using pure POSIX
parameter expansion (no `sed` — busybox has no `sed` symlink on PATH):

- **Maps `DB_*` onto Zitadel's discrete `ZITADEL_DATABASE_POSTGRES_*` env** — Zitadel
  reads separate Postgres variables, not a single `DATABASE_URL`. The SSL mode is
  branched by host: a `/…` **socket directory** → `disable`; `127.0.0.1`/`localhost`
  **loopback proxy** → `disable`; otherwise a **private IP** → `require` (Cloud SQL
  rejects unencrypted private-IP TCP). The same role is used as both Zitadel's `USER`
  and `ADMIN` connection (db-init granted it `CREATEDB`/`CREATEROLE`).
- **Derives `ZITADEL_EXTERNALDOMAIN`** — strips the scheme and path from the injected
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` to get the bare host. Operators can
  override `ZITADEL_EXTERNALDOMAIN` for a custom domain.
- **Sets `ZITADEL_PORT` from `$PORT`** — Cloud Run reserves and injects `PORT`
  (= `container_port`); the entrypoint reads it (falling back to `8080` on GKE where
  `PORT` is unset) so the binary listens on the right port.
- **Execs `zitadel start-from-init`** as PID 1.

---

## 5. Core application settings and first-run behaviour

`Zitadel_Common` establishes the baseline Zitadel environment so the platform comes up
correctly and has a known owner on first boot:

- **`start-from-init`** — Zitadel runs its **own setup + schema migrations
  (idempotent)** before it begins serving. There is no separate migrate job; the empty
  database from `db-init` is populated by Zitadel itself on first start.
- **External access** — `ZITADEL_EXTERNALSECURE = "true"`, `ZITADEL_EXTERNALPORT = "443"`,
  `ZITADEL_TLS_ENABLED = "false"`: Zitadel serves cleartext HTTP/2 internally and trusts
  the upstream Cloud Run / GKE LoadBalancer to terminate TLS on `:443`.
- **Port** — the container listens on **8080** and serves both the gRPC and REST APIs
  plus the Console UI over HTTP/2.
- **First-instance bootstrap** — on first boot Zitadel creates the initial organization
  (`ZITADEL_FIRSTINSTANCE_ORG_NAME`, default `ZITADEL`) and a human admin
  (`ZITADEL_FIRSTINSTANCE_ORG_HUMAN_USERNAME`, default `zitadel-admin`) whose password
  is the generated Secret Manager value. `PASSWORDCHANGEREQUIRED = "false"` lets you log
  in immediately with the generated credential.

Both `ZITADEL_MASTERKEY` and the admin password are surfaced via the `secret_ids`
output so the variant wires them onto the **service** container (start-from-init
consumes them there, not in a separate job).

---

## 6. Health probe behaviour

The default startup, liveness, and readiness probes target **`/debug/healthz`** — an
unauthenticated endpoint that returns `200` once the Zitadel HTTP server is up. A
generous startup window accommodates the setup + migrations that Zitadel runs on first
boot:

- **Startup probe** — HTTP `/debug/healthz`, 60-second initial delay, 15-second period,
  30 failures allowed (~7.5 minutes after the delay) — enough time for first-boot setup
  on a fresh Cloud SQL instance.
- **Liveness probe** — HTTP `/debug/healthz`, 60-second initial delay, 30-second period.
- **Readiness probe** — HTTP `/debug/healthz`, 30-second initial delay, 10-second period.

Because the probes hit a public, unauthenticated path, they succeed as soon as the
server binds its port — they do not require Console authentication.

---

## 7. Object storage

A single **Cloud Storage** bucket (declared with the `storage` name suffix,
`STANDARD` class, public access prevention enforced) is provisioned by the foundation,
which also grants the workload service account access. Zitadel keeps its core state in
PostgreSQL; the bucket is available for operator use (for example, exports or asset
storage). List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Zitadel-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Zitadel_GKE](Zitadel_GKE.md)** and **[Zitadel_CloudRun](Zitadel_CloudRun.md)**.
