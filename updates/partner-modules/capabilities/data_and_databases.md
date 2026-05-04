# Data & Databases

> **Scope.** Canonical home for the managed database, cache, and shared-storage backends, plus the lifecycle automation (user creation, extension installation, init scripts) that wires them to applications. Backup/restore tooling is in [capabilities/disaster_recovery.md](disaster_recovery.md); CMEK and private-IP enforcement are in [practices/devsecops.md](../practices/devsecops.md).

## What this repo uniquely brings to data

### 1. Managed relational databases (canonical)

- **Cloud SQL for MySQL 8.0** — `modules/Services_GCP/mysql.tf`. Private IP, configurable tier, optional HA + PITR.
- **Cloud SQL for PostgreSQL 15** — `modules/Services_GCP/pgsql.tf`. Supports `pgvector` and other extensions via initialization-job pattern.
- **AlloyDB** — `modules/Services_GCP/alloydb.tf`. PostgreSQL-compatible columnar/analytics DB; first-class `pgvector` support.
- **Connection options** — Cloud SQL Proxy sidecar, Unix socket, or direct private IP; controlled per app via `enable_cloudsql_volume`.

### 2. Caching (canonical)

- **Memorystore Redis** — `modules/Services_GCP/redis.tf`. Tiered (`BASIC` / `STANDARD_HA`). Consumed via `REDIS_HOST` env var.

### 3. Shared file storage (canonical)

- **Filestore NFS** — `modules/Services_GCP/filestore.tf`. Tiered (BASIC_HDD, BASIC_SSD, ZONAL).
- **Self-managed NFS** — `modules/Services_GCP/nfs.tf` (Compute Engine-backed alternative).
- **GCS Fuse** — object-storage mount from Cloud Run via `app_storage_wrapper`. UID 2000 convention for compatibility.
- **GCS buckets** — `modules/App_Common/storage.tf`, `app_storage_enhanced` sub-module. Per-app buckets with lifecycle policies and CMEK.

### 4. Search / vector store

- **Elasticsearch** — `modules/Elasticsearch_GKE`. GKE-deployed; used by RAGFlow.
- **`pgvector`** — installed on Cloud SQL / AlloyDB via the postgres-extensions init job.

### 5. Database lifecycle automation (canonical)

`modules/App_Common/scripts/`:

- `create-db-and-user.sh` — per-app DB + user with least-privilege grants.
- `install-mysql-plugins.sh` — MySQL plugins (Wikijs, Moodle, etc.).
- `install-postgres-extensions.sh` — `pgvector`, `pg_trgm`, `unaccent`, etc.
- `db-init.sh` — per-app init (Django migrations, WordPress install, Odoo init, …).
- `db-cleanup.sh` — teardown when `deploy_application = false`.

Orchestration: `modules/App_CloudRun/jobs.tf` and `modules/App_GKE/jobs.tf`.

### 6. Discovery patterns (canonical)

Sub-modules under `modules/App_Common/modules/` let Application Modules locate Platform-tier resources without hardcoding names:

- `app_sql_discovery` + `get-sqlserver-info.sh`
- `app_nfs_discovery` + `get-nfsserver-info.sh`, `get-filestore-info.sh`
- `discover_cmek_keyring.sh`

### 7. Data-tier reliability

- **Backups + PITR** — configurable per Cloud SQL deployment.
- **HA tiers** — available for Cloud SQL and Memorystore.
- **Tier-configurability** — see [practices/finops.md](../practices/finops.md) for the cost-tier matrix.

### 8. Database troubleshooting

`AGENTS.md` `/troubleshoot` documents the recurring DB failure modes (canonical in [practices/sre.md](../practices/sre.md)): `dial tcp <sql-ip>:XXXX: i/o timeout` (DB_IP override or PSA route collision), `ssl_mode unknown option` (CLI flag misplaced into `.my.cnf`), etc.

## Cross-references

- [capabilities/disaster_recovery.md](disaster_recovery.md) — backup/restore scripts (`export-backup.sh`, `import-gcs-backup.sh`, `import-gdrive-backup.sh`)
- [practices/devsecops.md](../practices/devsecops.md) — CMEK, private IP, password generation, SSL/TLS enforcement
- [practices/finops.md](../practices/finops.md) — tier configurability (cost lens)
- [capabilities/networking.md](networking.md) — PSA peering, private IP for Cloud SQL
- [capabilities/ai.md](ai.md) — `pgvector` and Elasticsearch as vector stores
- [practices/sre.md](../practices/sre.md) — `/troubleshoot` patterns for DB failures
