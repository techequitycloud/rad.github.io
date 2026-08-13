---
title: "Supabase Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Supabase module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
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
| Database engine | Fixes **PostgreSQL 15** as the only supported engine (`Supabase_GKE` runs it in-namespace, not on Cloud SQL) | §Database in the platform guide |
| Database bootstrap | Defines the first-deploy `db-init` job that sets the Supabase service-role passwords and creates the Supabase schemas/grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `storage` bucket (`name_suffix = "storage"`) | `storage_buckets` output |
| Kong configuration | Sets the baseline Kong environment (DB-less mode, declarative config path, routing ports, proxy buffer settings) | Application behaviour in the platform guide |
| Health checks | Declares `startup_probe`/`liveness_probe` variable defaults (HTTP `/health`) — not what is actually deployed; `Supabase_GKE` overrides both to TCP | §5 below and §Observability in the platform guide |

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
supported. The Common config declares `database_type = "POSTGRES_15"`, but
`Supabase_GKE` overrides it to `"NONE"` on the foundation and runs the
`supabase/postgres` image as an in-namespace service instead — so there is no Cloud
SQL instance and no Auth Proxy in a deployed Supabase.

On the first deployment a one-shot `db-init` job connects to that in-namespace
Postgres as `supabase_admin` and idempotently:

1. sets LOGIN passwords on the service roles the `supabase/postgres` image creates
   but leaves password-less (`authenticator`, `supabase_auth_admin`,
   `supabase_storage_admin`),
2. creates the `auth`, `storage`, `_realtime`, and `realtime` schemas and the
   `public`-schema grants/default privileges for `anon`, `authenticated`, and
   `service_role`,
3. sets the database-level `app.settings.jwt_secret` / `jwt_exp` GUCs used by RLS.

The job uses the `mirror.gcr.io/library/postgres:15-alpine` image (for `psql`) and
runs `scripts/db-init.sh`. It is safe to re-run. Inspect the database directly:

```bash
kubectl exec -n "<namespace>" deploy/<postgres-workload> -- psql -U supabase_admin -d postgres
```

The namespace and service names are in the platform deployment outputs.

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

The `startup_probe`/`liveness_probe` variables declared here default to HTTP `/health`:

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/health` | 30 s | 10 s | 18 |
| Liveness | HTTP | `/health` | 60 s | 30 s | 3 |

**These defaults are never actually deployed.** `kong.yml` is a DB-less declarative
config that only defines routes for `/rest/v1`, `/auth/v1`, `/realtime/v1`,
`/storage/v1`, `/pg`, and `/` (Studio) — there is no `/health` route, so an HTTP
probe against it would 404. `Supabase_GKE/main.tf` unconditionally overrides both
probes to **TCP** against the Kong container port in its `supabase_module` merge,
regardless of the value passed in for these variables. Treat this section as
documenting the variable's shape only, not the probe behaviour you will observe on a
deployed instance — see `docs/modules/Supabase_GKE.md` for what is actually applied.

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
