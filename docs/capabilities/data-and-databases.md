---
title: "Data & Databases"
sidebar_label: "Data & Databases"
---

# Data & Databases

> **Scope.** Canonical home for the managed database, cache, and shared-storage backends, plus the lifecycle automation (user creation, extension installation, init scripts) that wires them to applications. Backup/restore tooling is in [disaster-recovery](disaster-recovery); CMEK and private-IP enforcement are in [practices/devsecops.md](../practices/devsecops.md).

## What this repo uniquely brings to data

### 1. Managed relational databases (canonical)

- **Cloud SQL for MySQL 8.0** — `modules/Services_GCP/mysql.tf`. Private IP, configurable tier, optional HA + PITR.
- **Cloud SQL for PostgreSQL** — `modules/Services_GCP/pgsql.tf`. Default version **PostgreSQL 16** (`POSTGRES_16`); `POSTGRES_15` and `POSTGRES_14` also supported via `postgres_database_version`. Supports `pgvector` and other extensions via initialization-job pattern.
- **AlloyDB** — `modules/Services_GCP/alloydb.tf`. PostgreSQL-compatible columnar/analytics DB; first-class `pgvector` support. Optional read pool (`enable_alloydb_read_pool = true`, `alloydb_read_pool_node_count` controls replica count) for horizontal read scaling without touching the primary.
- **Connection options** — Cloud SQL Proxy sidecar, Unix socket, or direct private IP; controlled per app via `enable_cloudsql_volume`.
- **Cloud SQL IAM Auth** — `enable_cloudsql_iam_auth = true` allows applications to authenticate to Cloud SQL using IAM service account credentials instead of passwords, eliminating a class of credential-management risk.

### 2. Caching (canonical)

- **Memorystore Redis** — `modules/Services_GCP/redis.tf`. Tiered (`BASIC` / `STANDARD_HA`). Consumed via `REDIS_HOST` env var.

### 3. Shared file storage (canonical)

- **Filestore NFS** — `modules/Services_GCP/filestore.tf`. Tiered (BASIC_HDD, BASIC_SSD, ZONAL). Suited to high-throughput shared storage across multiple replicas (uploads, model weights, media).
- **Self-managed NFS** — `modules/Services_GCP/nfs.tf` (Compute Engine-backed alternative; lower cost, reduced SLA).
- **GCS Fuse** — object-storage mount from Cloud Run via `app_storage_wrapper`. UID 2000 convention for compatibility with standard app containers. Best suited for read-heavy, large-object workloads (model weights, large media); Filestore NFS is preferred for write-intensive or latency-sensitive shared storage.
- **GCS buckets** — `modules/App_Common/storage.tf`, `app_storage_enhanced` sub-module. Per-app buckets with lifecycle policies and CMEK. Backup buckets are auto-created by the storage module and discovered at job runtime via the `app_sql_discovery` sub-module pattern.

### 4. Search / vector store

- **Elasticsearch** — `modules/Elasticsearch_GKE`. GKE-deployed; used by RAGFlow.
- **`pgvector`** — installed on Cloud SQL / AlloyDB via the postgres-extensions init job.

### 5. Database lifecycle automation (canonical)

`modules/App_Common/scripts/`:

- `create-db-and-user.sh` — per-app DB + user with least-privilege grants.
- `install-mysql-plugins.sh` — MySQL plugins (validates and installs engine-specific plugins for Wikijs, Moodle, etc.).
- `install-postgres-extensions.sh` — `pgvector`, `pg_trgm`, `unaccent`, and other extensions; extension list is configurable per app via `postgres_extensions` variable.
- `custom-sql-scripts.sh` — `enable_custom_sql_scripts = true` runs app-provided SQL files against the provisioned database at init time, useful for seed data, stored procedures, or schema patches outside migration frameworks.
- `db-init.sh` — per-app init (Django migrations, WordPress install, Odoo init, …).
- `db-cleanup.sh` — teardown when `deploy_application = false`.

Orchestration: `modules/App_CloudRun/jobs.tf` and `modules/App_GKE/jobs.tf`.

### 6. Auto password rotation (canonical)

`enable_auto_password_rotation = true` enables automated database password rotation:

- A new password is generated and written to Secret Manager.
- The Foundation Module waits (`password_rotation_restart_delay_seconds`) for Secret Manager global replication to complete before restarting the Cloud Run service, ensuring all instances receive the new secret before the old one is invalidated.
- Works with the per-app service account / Secret Manager binding pattern; no manual credential update required.

### 7. Discovery patterns (canonical)

Sub-modules under `modules/App_Common/modules/` let Application Modules locate Platform-tier resources without hardcoding names:

- `app_sql_discovery` + `get-sqlserver-info.sh`
- `app_nfs_discovery` + `get-nfsserver-info.sh`, `get-filestore-info.sh`
- `discover_cmek_keyring.sh`

### 8. Data-tier reliability

- **Backups + PITR** — configurable per Cloud SQL deployment.
- **HA tiers** — available for Cloud SQL and Memorystore.
- **AlloyDB read pool** — horizontal read scaling with `enable_alloydb_read_pool`.
- **Tier-configurability** — see [practices/finops.md](../practices/finops.md) for the cost-tier matrix.

### 9. Database troubleshooting

`AGENTS.md` `/troubleshoot` documents the recurring DB failure modes (canonical in [practices/sre.md](../practices/sre.md)): `dial tcp <sql-ip>:XXXX: i/o timeout` (DB_IP override or PSA route collision), `ssl_mode unknown option` (CLI flag misplaced into `.my.cnf`), etc.

## Cross-references

- [disaster-recovery](disaster-recovery) — backup/restore scripts (`export-backup.sh`, `import-gcs-backup.sh`, `import-gdrive-backup.sh`)
- [practices/devsecops.md](../practices/devsecops.md) — CMEK, private IP, password generation, SSL/TLS enforcement
- [practices/finops.md](../practices/finops.md) — tier configurability (cost lens)
- [networking](networking) — PSA peering, private IP for Cloud SQL
- [ai](ai) — `pgvector` and Elasticsearch as vector stores
- [practices/sre.md](../practices/sre.md) — `/troubleshoot` patterns for DB failures
