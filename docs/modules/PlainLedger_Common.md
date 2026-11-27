---
title: "PlainLedger_Common"
description: "The application configuration shared by Plain Ledger's deployment variants: its secrets, buckets, container build and the db-init job."
---

# PlainLedger_Common

Application configuration for Plain Ledger, shared by its deployment variants. It is called by
[PlainLedger_CloudRun](/docs/modules/PlainLedger_CloudRun) and is never applied on its own.

## What it creates

- **`random_password.runtime_db_password`** and the Secret Manager secret
  `secret-<prefix>-<application_name>-runtime-db-password`, pinned to the deployment region:
  the password of the runtime login role `<DB_USER>_rt`.
- With `enable_demo`, the same for the demo login `<DB_USER>_demo`.

## Outputs

| Output | Contents |
|---|---|
| `config` | The application config the Foundation consumes: a custom build from `scripts/`, port 8080, `POSTGRES_17`, the Cloud SQL socket, probes on `/`, and the default `db-init` job |
| `secret_ids` | `{ PLAINLEDGER_APP_DB_PASSWORD = <secret id> }` (and `PLAINLEDGER_DEMO_DB_PASSWORD` with the demo), injected into the service |
| `storage_buckets` | Versioned `documents` and `anchors` buckets, `force_destroy = false`, soft delete 7 days |
| `path` | The module path; the wrapper builds `scripts_dir` from it |

## scripts/

| File | Purpose |
|---|---|
| `Dockerfile` | `python:3.12-slim`. Installs `app/requirements.txt` with `--require-hashes`, copies `app/plainledger` and `app/migrations`, runs as UID 2000 (user `plainledger`) and serves `uvicorn --factory plainledger.http.app:app` on `$PORT` |
| `db-init.sh` | The `db-init` job: `python -m plainledger.db.cloudsql_init` |
| `app/` | Plain Ledger's API, vendored into the module at each release; **do not edit it here**. `app/SOURCE` names the commit it was taken from |

## The db-init job

It runs in the Plain Ledger image after the Foundation's `db-create`, on every apply, and is
idempotent:

1. As `ROOT_USER` (`postgres`): create `<DB_USER>_app` and `<DB_USER>_auditor` (NOLOGIN), create
   or update `<DB_USER>_rt` (LOGIN) with `PLAINLEDGER_APP_DB_PASSWORD`, and grant
   `<DB_USER>_app` to it.
2. As the owner (`DB_USER`): revoke `CONNECT` and `TEMPORARY` from `PUBLIC`, grant `CONNECT` to
   this deployment's roles, and apply Plain Ledger's SQL migrations with those role names.
3. As the owner, after the migrations (`plainledger/db/deploy.py`): each address of
   `operator_emails` made a platform operator (`PLAINLEDGER_OPERATOR_EMAILS`, comma-separated,
   trimmed and lower-cased; never removing one), and with `enable_demo` and `demo_open` the
   site setting `demo.try` turned on (`PLAINLEDGER_DEMO_OPEN=true`; never off). Set only when
   given, in the environment rather than args (a job's args are split on commas).

`PLAINLEDGER_RELEASE` (the `application_version`) is in the job's environment, so every release
changes the job's configuration and runs its migrations before traffic depends on them.
A change to `operator_emails` or `demo_open` changes it too, so db-init runs on that apply.
