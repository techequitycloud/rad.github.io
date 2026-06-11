---
title: "Temporal Common \u2014 Shared Application Configuration"
---

# Temporal Common — Shared Application Configuration

`Temporal_Common` is the **shared database-provisioning layer** for Temporal. It is
not deployed on its own; instead it supplies the Temporal-specific Cloud SQL
resources and database credentials that [Temporal_GKE](Temporal_GKE.md) builds on,
so the server deployment always gets correctly named databases and a consistent
password secret. End users never configure this layer directly — it has no
deployment UI inputs of its own — but understanding what it provides explains the
database and secret names you see in the platform outputs.

For the infrastructure that actually runs Temporal, see the platform guide
([Temporal_GKE](Temporal_GKE.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

> **GKE only.** There is no `Temporal_CloudRun` variant. Temporal's gRPC-based
> architecture and long-lived workflow execution model are not compatible with Cloud
> Run's stateless, request-scoped model.

---

## 1. What this layer provides

| Area | Provided by Temporal_Common | Where it surfaces |
|---|---|---|
| Database credential | Generates the Temporal PostgreSQL password and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Primary persistence database | Creates the Cloud SQL database that stores workflow state, task queues, namespace metadata, timers, and activity records | `temporal_db_name` output |
| Visibility database | Creates the Cloud SQL database used for workflow search and filtering | `temporal_visibility_db_name` output |
| PostgreSQL user | Creates the shared database user (both databases share one user) | `temporal_db_user` output |
| Secret injection | Exposes `secret_ids = { POSTGRES_PWD = <secret-id> }` consumed by the Temporal server pod | Injected at runtime via the Secret Store CSI driver |
| Storage buckets | Empty — Temporal requires no Cloud Storage buckets | `storage_buckets` output is always `[]` |

---

## 2. Database credential in Secret Manager

The Temporal database password is generated automatically (32 alphanumeric
characters) and stored as a Secret Manager secret. It is never set in plain text.
Retrieve it after deployment:

```bash
# The secret follows the deployment resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~temporal-db-password"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The secret name is reported in the platform deployment outputs as
`temporal_db_password_secret_id`. See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Temporal requires **PostgreSQL**; MySQL is not supported. `Temporal_Common` targets
the Services_GCP-managed Cloud SQL for PostgreSQL instance (discovered by instance
label or explicit name override). On every deployment it idempotently:

1. Creates the PostgreSQL user (shared by both databases).
2. Creates the primary persistence database.
3. Creates the visibility database (named `<prefix>_visibility`).

A 30-second wait ensures Secret Manager global replication completes before the
deployment outputs are resolved.

The `temporalio/auto-setup` image then runs all PostgreSQL schema migrations
automatically on first startup — no separate schema-init job is needed.

Inspect the databases directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
# List databases:
\l
# Inspect the Temporal schema:
\c <db-name>
\dt
```

The instance name, database names, and user are all in the platform deployment
outputs.

---

## 4. Core database settings

`Temporal_Common` establishes the database topology so the server connects correctly
on first boot:

- **Two databases.** The primary persistence database holds all workflow execution
  state. The visibility database stores running execution records for search and
  filtering. Both share a single PostgreSQL user for simplicity.
- **Auto-generated names.** When `temporal_database_name` and
  `temporal_visibility_database_name` are left empty in `Temporal_GKE`, names are
  derived from the deployment resource prefix using the `app<name><tenant><id>`
  naming convention with hyphens replaced by underscores (required for valid
  PostgreSQL identifiers). This avoids collisions when multiple Temporal deployments
  share a Cloud SQL instance.
- **Direct private IP connection.** Temporal connects to Cloud SQL via the private IP
  — no Auth Proxy sidecar. TLS is required by Cloud SQL and is enabled in the server
  configuration automatically.

---

## 5. Visibility store behaviour

The standard visibility store (PostgreSQL) supports basic workflow filtering by
workflow type, status, start/close time, and workflow ID. When
`enable_elasticsearch = true` is set in `Temporal_GKE`, Elasticsearch takes over as
the advanced visibility store, adding full-text search and custom search attributes.
The PostgreSQL visibility database continues to exist in Cloud SQL but is not used by
Temporal when Elasticsearch is active.

---

## 6. Scripts

`Temporal_Common` ships a `scripts/` directory with:

| File | Purpose |
|---|---|
| `schema-init.sh` | Uses `temporal-sql-tool` from `ghcr.io/temporalio/admin-tools` to initialise both schemas manually. Retained for use-cases where external schema management is preferred. Not used in the default deployment — `temporalio/auto-setup` handles schema init automatically. |
| `temporal-db-init.sh` | Grants `CREATEDB` privilege to the Temporal PostgreSQL role. Run by the `temporal-db-init` Kubernetes Job before the server pod starts. |

---

For the Temporal-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guide:
**[Temporal_GKE](Temporal_GKE.md)**.
