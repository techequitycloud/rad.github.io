---
title: "Supabase Common \u2014 Shared Application Configuration"
---

# Supabase Common — Shared Application Configuration

`Supabase_Common` is the **shared application layer** for Supabase. It is not
deployed on its own; instead it supplies the Supabase-specific configuration that
[Supabase_GKE](Supabase_GKE.md) builds on, ensuring that the gateway, database
schema, and secrets are consistently wired together. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what
it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Supabase, see the platform
guide ([Supabase_GKE](Supabase_GKE.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Supabase_Common | Where it surfaces |
|---|---|---|
| JWT credentials | Generates and stores the JWT signing secret, anon key, service role key, publishable key, secret key, and secret_key_base in **Secret Manager** | Retrieve via Secret Manager; placeholders require post-deploy replacement |
| Container image | Pins the **Kong API gateway** image and the Cloud Build configuration that extends it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guide |
| Database bootstrap | Defines the first-deploy `db-init` job that installs extensions and sets up the Supabase schema | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `supabase-storage` bucket | `storage_buckets` output |
| Kong configuration | Sets the baseline Kong environment (DB-less mode, declarative config path, routing ports, proxy buffer settings) | Application behaviour in the platform guide |
| Health checks | Supplies the default HTTP startup and liveness probe targeting Kong's `/health` endpoint | §Observability in the platform guide |

---

## 2. JWT credentials in Secret Manager

Supabase authentication relies on JWTs signed by a shared secret. Six secrets are
stored in Secret Manager by this layer:

| Secret suffix | Content | Auto-generated? |
|---|---|---|
| `-jwt-secret` | 32-char JWT signing secret | Yes — random if `jwt_secret` is empty |
| `-anon-key` | Public anonymous JWT | No — placeholder; **must be replaced** |
| `-service-role-key` | Service role JWT | No — placeholder; **must be replaced** |
| `-publishable-key` | Publishable (anon) opaque API key | No — placeholder if empty |
| `-secret-key` | Server-side opaque API key | No — placeholder if empty |
| `-key-base` | 64-char `secret_key_base` for Realtime/Supavisor | Yes — random if `secret_key_base` is empty |

The anon key and service role key are placeholders on first deploy. Replace them with
valid JWTs signed by the `jwt_secret`:

```bash
# 1. Retrieve the auto-generated JWT signing secret:
gcloud secrets versions access latest --secret="<prefix>-jwt-secret" --project "$PROJECT"

# 2. Generate JWTs at https://jwt.io or https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
#    Anon payload:         { "role": "anon",         "iss": "supabase" }
#    Service role payload: { "role": "service_role", "iss": "supabase" }

# 3. Upload the anon JWT:
echo -n "<anon-jwt>" | gcloud secrets versions add "<prefix>-anon-key" \
  --data-file=- --project "$PROJECT"

# 4. Upload the service role JWT:
echo -n "<service-role-jwt>" | gcloud secrets versions add "<prefix>-service-role-key" \
  --data-file=- --project "$PROJECT"

# 5. Restart the Kong pod to pick up the updated secrets:
kubectl rollout restart deploy/<kong-workload> -n "<namespace>"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Supabase requires **PostgreSQL 15**; the engine is fixed and no other database is
supported. On the first deployment a one-shot `db-init` job connects to Cloud SQL
through the Auth Proxy and idempotently:

1. creates the Supabase database and user (if absent),
2. enables the `pgcrypto`, `uuid-ossp`, and `pgvector` extensions,
3. sets up the Supabase schema required by GoTrue, PostgREST, Realtime, and Storage.

The job uses the `postgres:15-alpine` image and runs `scripts/db-init.sh`. It is safe
to re-run. Inspect the database directly:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Kong API gateway configuration

`Supabase_Common` configures Kong to run in **declarative (DB-less) mode**. All
routing is defined in a `kong.yml` file baked into the Kong container image by the
`Dockerfile` in `scripts/`. No Kong database is provisioned or required.

Key Kong environment variables set by this layer:

| Variable | Value | Purpose |
|---|---|---|
| `KONG_DATABASE` | `off` | DB-less declarative mode |
| `KONG_DECLARATIVE_CONFIG` | `/home/kong/kong.yml` | Path to routing config |
| `KONG_PLUGINS` | `request-transformer,cors,key-auth,acl` | Active plugins |
| `KONG_PROXY_LISTEN` | `0.0.0.0:8000` | Public HTTP proxy port |
| `KONG_ADMIN_LISTEN` | `0.0.0.0:8001` | Admin API port |
| `SUPABASE_PORT` | `8000` | Kong listen port (referenced by Supabase services) |

Kong routes requests to microservices by path prefix as defined in `kong.yml`:

| Path prefix | Target service | Port |
|---|---|---|
| `/auth/v1/*` | GoTrue (authentication) | 9999 |
| `/rest/v1/*` | PostgREST (REST API) | 3000 |
| `/realtime/v1/*` | Realtime (WebSocket) | 4000 |
| `/storage/v1/*` | Storage API | 5000 |

URL configuration variables (`site_url`, `api_external_url`, `supabase_public_url`,
`jwt_expiry`, `pgrst_db_schemas`) are injected into the Kong container environment
so that GoTrue and PostgREST receive the correct external addresses. Update these to
real public URLs before production use — the localhost defaults prevent OAuth flows
from functioning outside the cluster.

---

## 5. Health probe behaviour

Both probes target Kong's `/health` endpoint, which returns HTTP 200 when the gateway
is running and declarative configuration has been loaded:

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/health` | 30 s | 10 s | 18 |
| Liveness | HTTP | `/health` | 60 s | 30 s | 3 |

The generous startup failure threshold (18 × 10 s = ~3 minutes) accommodates first-boot
database schema creation by the `db-init` job before Kong begins accepting traffic.

---

## 6. Object storage

A **Cloud Storage** bucket with the suffix `-storage` is declared here and provisioned
by the foundation, which also grants the workload service account access. Supabase
file uploads flow through the Storage API microservice to this bucket. Public-access
prevention is set to `inherited` so individual objects can be served publicly via
bucket-level ACLs when needed. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Supabase-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guide:
**[Supabase_GKE](Supabase_GKE.md)**. For the infrastructure layer that runs the
workload, see **[App_GKE](App_GKE.md)** and **[App_Common](App_Common.md)**.
