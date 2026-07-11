---
title: "Professional Cloud Database Engineer (PCDE) Certification Lab Map"
description: "Map every Professional Cloud Database Engineer (PCDE) exam domain to hands-on RAD deployment labs on Google Cloud — a practical, exam-aligned study path."
---

# Professional Cloud Database Engineer (PCDE) Certification Lab Map
> 📚 **Official exam guide:** [Professional Cloud Database Engineer certification](https://cloud.google.com/learn/certification/cloud-database-engineer) — always confirm section weightings against the current Google Cloud exam guide.


The Professional Cloud Database Engineer certification validates your ability to design, manage, migrate, and deploy scalable, highly available database solutions on Google Cloud. The RAD foundation modules — `Services_GCP`, `App_CloudRun`, `App_GKE`, and `App_Common` — serve as a live lab for the bulk of this exam: `Services_GCP` provisions Cloud SQL (PostgreSQL and MySQL), AlloyDB, Firestore Enterprise, and Memorystore Redis behind a private VPC, while `App_CloudRun` and `App_GKE` demonstrate how real applications connect, authenticate, back up, monitor, and rotate credentials against those databases — all driven by infrastructure-as-code, which is itself the exam's "automate database instance provisioning" objective made concrete.

> **Abbreviation note:** in this repository **PDE** refers to the Professional Cloud **DevOps** Engineer guides. This certification — Professional Cloud **Database** Engineer — uses the abbreviation **PCDE** throughout.

## How to use this guide

- Deploy one of the profiles below through your deployment portal, then work through the matching section guide while the infrastructure is live.
- Each section guide pairs a portal change with what to observe in the GCP console and a real `gcloud`/`psql`/`kubectl` command.
- Use the coverage legend to know which exam topics must be studied outside the platform — Spanner, Bigtable, BigQuery, and Database Migration Service are *not* implemented by these modules, and the section guides say so plainly.
- Destroy or scale down expensive profiles (REGIONAL Cloud SQL, AlloyDB) when you finish a study session.

**Coverage legend**

| Symbol | Meaning |
|---|---|
| ✅ | Fully demonstrated — deploy it, see it, modify it in the RAD platform |
| 🟡 | Partially demonstrated — the modules touch the concept; supplement with docs |
| 📘 | Concept-only — not implemented by the modules; study pointers provided |

## Deployment profiles

### Profile: relational-baseline
*Purpose:* The minimum-cost lab — a zonal private-IP PostgreSQL instance plus a Cloud Run application that connects to it through the Cloud SQL connector volume.
*Modules:* `Services_GCP` + `App_CloudRun`.

| Variable | Value |
|---|---|
| `create_postgres` | `true` (default) |
| `postgres_database_availability_type` | `ZONAL` (default) |
| `postgres_tier` | `db-custom-1-3840` (default) |
| `database_type` (App_CloudRun) | `POSTGRES` (default) |
| `enable_cloudsql_volume` (App_CloudRun) | `true` (default) |

*Estimated incremental cost:* low — one 1-vCPU Cloud SQL Enterprise instance with a 10 GB PD_SSD disk is the dominant cost.

### Profile: ha-production
*Purpose:* Section 1.2 and Section 4 — REGIONAL high availability, a cross-region read replica, CMEK, IAM database authentication, and database alerting.
*Modules:* `Services_GCP` (redeploy/update the baseline).

| Variable | Value |
|---|---|
| `availability_regions` | `["us-central1", "us-east1"]` |
| `subnet_cidr_range` | one CIDR per region, e.g. `["10.0.0.0/24", "10.0.1.0/24"]` |
| `postgres_database_availability_type` | `REGIONAL` |
| `create_postgres_read_replica` | `true` |
| `postgres_read_replica_count` | `1` |
| `enable_cloudsql_iam_auth` | `true` |
| `enable_cmek` | `true` |
| `configure_email_notification` | `true` |
| `notification_alert_emails` | `["you@example.com"]` |

*Estimated incremental cost:* moderate-to-high — REGIONAL roughly doubles the primary's instance cost, and each read replica bills like another primary-sized instance.

### Profile: multi-engine
*Purpose:* Section 1.4 and Section 2 — run PostgreSQL, MySQL, Memorystore Redis, and Firestore Enterprise (MongoDB-compatible) side by side to compare engines.
*Modules:* `Services_GCP`.

| Variable | Value |
|---|---|
| `create_postgres` | `true` (default) |
| `create_mysql` | `true` |
| `create_redis` | `true` |
| `redis_tier` | `STANDARD_HA` |
| `redis_persistence_mode` | `RDB` |
| `create_firestore` | `true` |

*Estimated incremental cost:* moderate — a second Cloud SQL instance plus a STANDARD_HA Redis instance (~2× BASIC); Firestore Enterprise bills per operation and is negligible at lab scale.

### Profile: alloydb-ai
*Purpose:* Sections 1.1, 1.4, and 2.4 — an AlloyDB cluster with a primary and a horizontally scalable read pool, for analytics/vector-workload study.
*Modules:* `Services_GCP`.

| Variable | Value |
|---|---|
| `enable_alloydb` | `true` |
| `alloydb_cpu_count` | `2` (default; allowed: 2, 4, 8, 16, 32, 64) |
| `enable_alloydb_read_pool` | `true` |
| `alloydb_read_pool_node_count` | `1` (default; 1–20) |

*Estimated incremental cost:* high — AlloyDB has no shared-core tier; the 2-vCPU primary plus each read-pool node is the dominant cost. Tear down after each session.

### Profile: app-dataops
*Purpose:* Sections 2.3, 2.5, and 3.1 — scheduled database exports, one-time backup imports, automated password rotation, and database users managed by initialization jobs.
*Modules:* `App_CloudRun` (or `App_GKE`) on top of relational-baseline.

| Variable | Value |
|---|---|
| `database_type` | `POSTGRES` (default) |
| `backup_schedule` | `"0 2 * * *"` (default) |
| `backup_retention_days` | `7` (default) |
| `enable_backup_import` | `true` (after staging a file; see Section 3 guide) |
| `backup_source` / `backup_file` / `backup_format` | `gcs` / `backup.sql` / `sql` |
| `enable_auto_password_rotation` | `true` |
| `secret_rotation_period` | `"2592000s"` (default, 30 days) |

*Estimated incremental cost:* low — Cloud Run jobs, Cloud Scheduler, and Secret Manager versions cost cents; the backup GCS bucket is lifecycle-pruned.

## Section 1: Design innovative, scalable, and highly available cloud database solutions (~32% of the exam)

The heaviest section. `Services_GCP` is the star: every design decision the exam tests — machine tier, zonal vs regional availability, private connectivity, encryption, engine selection — is a variable you can flip and observe.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 1.1 Database capacity and usage planning | ✅ | `postgres_tier`, `alloydb_cpu_count`, `redis_memory_size_gb`, disk autoresize | [Section 1 guide](PCDE_Section_1_Exploration_Guide.md#11-analyze-relevant-variables-to-perform-database-capacity-and-usage-planning) |
| 1.2 HA and DR options | ✅ | `postgres_database_availability_type`, `create_postgres_read_replica`, PITR/backup settings, `sql_maintenance_window_day`/`_hour` + `sql_maintenance_update_track` | [Section 1 guide](PCDE_Section_1_Exploration_Guide.md#12-evaluate-database-high-availability-and-disaster-recovery-options-given-the-requirements) |
| 1.3 Application connectivity, encryption, auditing | ✅ | private IP via PSA, `ssl_mode`, `enable_cmek`, `enable_cloudsql_volume`, Auth Proxy sidecar (App_GKE), `enable_audit_logging` (session poolers 📘) | [Section 1 guide](PCDE_Section_1_Exploration_Guide.md#13-determine-how-applications-will-connect-to-the-database) |
| 1.4 Evaluating database solutions (SQL/NoSQL/vector, managed vs unmanaged, gen-AI) | 🟡 | Cloud SQL vs AlloyDB vs Firestore Enterprise (MongoDB compat) vs Redis vs self-managed Redis VM; Spanner/Bigtable/BigQuery 📘 | [Section 1 guide](PCDE_Section_1_Exploration_Guide.md#14-evaluate-appropriate-database-solutions-on-google-cloud) |

## Section 2: Manage a solution that can span multiple database technologies (~25% of the exam)

Day-2 operations: users and IAM, monitoring, backup/recovery, scaling, and automation. The application modules (`App_CloudRun`/`App_GKE`) carry most of this section — db-init jobs, export schedulers, rotation pipelines, and alert policies.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 2.1 Connectivity and access management (IAM, database users) | ✅ | `enable_cloudsql_iam_auth`, `roles/cloudsql.instanceUser` grants, the db-init user-creation script, per-secret IAM | [Section 2 guide](PCDE_Section_2_Exploration_Guide.md#21-determine-database-connectivity-and-access-management-considerations) |
| 2.2 Monitoring and troubleshooting | ✅ | Cloud SQL CPU/memory/disk alert policies (Services_GCP), `alert_policies` + `uptime_check_config` in App modules, `enable_query_insights` (Services_GCP); slow-query analysis 📘 | [Section 2 guide](PCDE_Section_2_Exploration_Guide.md#22-configure-database-monitoring-and-troubleshooting-options) |
| 2.3 Backup and recovery (RTO/RPO/PITR, retention) | ✅ | managed backup configuration, PITR + 7-day log retention, export/import jobs, `backup_retention_days` | [Section 2 guide](PCDE_Section_2_Exploration_Guide.md#23-design-database-backup-and-recovery-solutions) |
| 2.4 Cost and performance optimization | ✅ | scale up (`postgres_tier`, `alloydb_cpu_count`) vs out (`postgres_read_replica_count`, `alloydb_read_pool_node_count`), `postgres_database_flags`; query optimization 📘 | [Section 2 guide](PCDE_Section_2_Exploration_Guide.md#24-optimize-database-cost-and-performance) |
| 2.5 Automating common database tasks | ✅ | Cloud Scheduler export job, `db-export` CronJob (GKE), the password-rotation pipeline, scheduled maintenance via `sql_maintenance_window_*`; managed upgrades 📘 | [Section 2 guide](PCDE_Section_2_Exploration_Guide.md#25-automate-common-database-tasks) |

## Section 3: Migrate data solutions (~23% of the exam)

The modules implement the export/import (extended-outage) migration path end to end, but Database Migration Service, Datastream, and continuous replication from external sources are concept-only — budget real study time here.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 3.1 Design and implement data migration and replication | 🟡 | `enable_backup_import` + `backup_source` (gcs/gdrive) import jobs, scheduled logical export jobs, `enable_custom_sql_scripts`; DMS / Datastream / zero-downtime migration / reverse replication 📘 | [Section 3 guide](PCDE_Section_3_Exploration_Guide.md#31-design-and-implement-data-migration-and-replication) |

## Section 4: Deploy scalable and highly available databases in Google Cloud (~20% of the exam)

This section is the repository's home turf: "automate database instance provisioning" is literally what these infrastructure-as-code modules do. Deploy the ha-production profile and practice failover, replica scaling, and HA monitoring against real instances.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 4.1 Implement scalable and highly available databases (provision HA, test HA/DR, read replicas, automated provisioning, monitoring) | ✅ | `postgres_database_availability_type = REGIONAL`, `postgres_read_replica_count`, `gcloud sql instances failover`, the infrastructure-as-code modules themselves, the Cloud SQL alert policies (cross-region promotion workflow 🟡) | [Section 4 guide](PCDE_Section_4_Exploration_Guide.md#41-apply-concepts-to-implement-scalable-and-highly-available-databases-in-google-cloud) |
