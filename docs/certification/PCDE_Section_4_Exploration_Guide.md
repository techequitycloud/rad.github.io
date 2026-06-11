---
title: "PCDE Certification Preparation Guide: Section 4 \u2014 Deploy scalable and highly available databases in Google Cloud (~20% of the exam)"
---

# PCDE Certification Preparation Guide: Section 4 — Deploy scalable and highly available databases in Google Cloud (~20% of the exam)

This guide covers Section 4 of the Professional Cloud Database Engineer (PCDE) exam — and it is the section where this repository *is* the answer key. "Automate database instance provisioning" is literally what `Services_GCP` does: every Cloud SQL, AlloyDB, Redis, and Firestore deployment in the platform is declarative infrastructure-as-code applied through your deployment portal or Cloud Build. The HA, replica, and monitoring machinery comes from `Services_GCP`; application failover behavior is observed through `App_CloudRun`/`App_GKE`. Deploy the **ha-production** profile from the [PCDE Lab Map](PCDE_Certification_Guide.md) before starting.

---

## 4.1 Apply concepts to implement scalable and highly available databases in Google Cloud

> ⏱ ~90 min · 💰 moderate-to-high while ha-production is applied (REGIONAL ≈ 2× instance cost; each replica ≈ +1 instance) — revert to ZONAL/no-replica afterwards · ⚙️ Requires: ha-production profile

**Why the exam cares** — Section 1 asked you to *choose* an HA design; Section 4 asks you to *implement and prove* it: provision the HA topology, deploy and scale read replicas, replicate across regions, verify failover actually works (an untested DR plan is the exam's favorite anti-pattern), automate provisioning so environments are reproducible, and monitor the HA signals (replication lag, failover events, instance health) rather than just CPU.

**How RAD implements it** —

*Provisioning HA, declaratively.* The entire topology is variables on `Services_GCP`:

| Capability | Variable (default) | Resulting resource |
|---|---|---|
| HA primary | `postgres_database_availability_type` (`ZONAL`) → `REGIONAL` | A Cloud SQL primary instance with synchronous standby + automatic failover (same for `mysql_database_availability_type`) |
| Read replicas | `create_postgres_read_replica` (`false`), `postgres_read_replica_count` (`1`) | A Cloud SQL read replica instance (type `READ_REPLICA_INSTANCE`), always ZONAL |
| Cross-region placement | `availability_regions` (`["us-central1"]`) | With ≥2 regions, replicas land in the second region; otherwise they stay in the primary region |
| Read-pool scale-out | `enable_alloydb_read_pool` (`false`), `alloydb_read_pool_node_count` (`1`, 1–20) | An AlloyDB read-pool instance (type `READ_POOL`) |
| Cache HA | `redis_tier` (`BASIC`) → `STANDARD_HA` | Memorystore with automatic failover replica; the platform *blocks* BASIC at plan time when `resource_labels.environment = "production"` |

*Automated provisioning.* This is infrastructure-as-code end to end: `tofu init → plan → apply` (run by the platform's create/update pipeline in CI), idempotent re-application, dependency sequencing (instances are gated on the Service Networking connection; a 120 s delay separates the two Cloud SQL instances), and discovery-not-duplication in the app layer (App_Common finds the platform instance by its `managed-by = services-gcp` label; `App_CloudRun` provisions an equivalent inline ZONAL PostgreSQL 17 instance only when none exists). Replica lifecycle is also codified: replicas are rebuilt if the primary is replaced.

*Monitoring for HA databases.* The platform ships CPU/memory/disk alert policies on `resource.type = "cloudsql_database"` wired to email channels (`configure_email_notification`, `notification_alert_emails`); each replica additionally publishes its endpoint as a `<replica-name>-host` secret so consumers fail over reads deliberately. Application-side, `uptime_check_config` (default `{ enabled = true, path = "/" }`) creates a `<service>-uptime-check` synthetic probe plus failure alert whenever the application endpoint is publicly reachable — ready-made detection of user-visible impact during failover tests (internal-only deployments get none).

**Try it**
1. Apply ha-production and map the fleet:

   ```bash
   gcloud sql instances list \
     --format="table(name, region, gceZone, settings.availabilityType, instanceType, state)"
   ```
   Expect the primary as `REGIONAL` in us-central1 and the replica as `READ_REPLICA_INSTANCE` in us-east1.
2. **Test HA** — note the current zone, force a failover, and time it:

   ```bash
   gcloud sql instances describe cloudsql-<prefix>-postgres --format="value(gceZone)"
   gcloud sql instances failover cloudsql-<prefix>-postgres
   gcloud sql operations list --instance=cloudsql-<prefix>-postgres --limit=3
   ```
   While it runs, hit the application URL (or watch the module-created `<service>-uptime-check` in **Console > Monitoring > Uptime checks**) to observe the brief connection blip — the Cloud SQL connector reconnects to the same connection name without any configuration change.
3. **Scale reads** — raise `postgres_read_replica_count` to `2` in the portal, apply, and confirm the new replica appears in the secondary region; then check replication health from the primary via psql: `SELECT client_addr, state, replay_lag FROM pg_stat_replication;`.
4. **Test DR promotion** (destructive to the replica's replica-status — do it on the second, disposable replica):

   ```bash
   gcloud sql instances promote-replica cloudsql-<prefix>-postgres-replica-1
   gcloud sql instances describe cloudsql-<prefix>-postgres-replica-1 \
     --format="value(instanceType, settings.availabilityType)"
   ```
   Note what Terraform now thinks: the promoted instance has drifted from the declared state, and the next `tofu plan` will want to reconcile it — promotion is a break-glass action, not a managed workflow in these modules.
5. **Prove reproducibility** — the automation claim of this section: re-run a plan over the unchanged deployment from your deployment portal (the platform runs `tofu plan` for you) and review the proposed changes.

   You know it worked when the failover operation completes with the primary in a new zone, the promoted instance reports `CLOUD_SQL_INSTANCE` (no longer a replica), and a fresh `tofu plan` over the *unmodified* configuration shows no unexpected changes (idempotence) — while the post-promotion plan visibly flags the drift.

**Check yourself**
<details>
<summary>Q1: During a failover test of the REGIONAL instance, the application reconnected automatically without any configuration change. Why — and which connection pattern from this platform made that possible?</summary>

A: Cloud SQL HA failover keeps the instance's identity: the connection name and private IP move to the promoted standby. Because the app connects through the Cloud SQL connector volume (Cloud Run) or Auth Proxy sidecar (GKE) addressed by *connection name*, and reads credentials from Secret Manager, nothing client-side referenced the failed zone. Hardcoded zonal IPs are the anti-pattern this design avoids.
</details>

<details>
<summary>Q2: A scenario requires read traffic served in two regions and a documented region-loss runbook. Which variables build the topology, and which two steps remain manual?</summary>

A: `availability_regions = ["us-central1", "us-east1"]`, `postgres_database_availability_type = "REGIONAL"`, `create_postgres_read_replica = true`, `postgres_read_replica_count ≥ 1` — replicas are placed in the secondary region and their endpoints published as secrets. Manual in a disaster: promoting the replica (`gcloud sql instances promote-replica`) and repointing applications to the promoted endpoint (e.g. updating the host secret). Cross-region failover is never automatic for Cloud SQL — a recurring exam point.
</details>

<details>
<summary>Q3: Why is Terraform-based provisioning itself an HA control, not just a convenience?</summary>

A: Reproducibility is recoverability: the entire database estate (instances, flags, networks, secrets, alerting) can be re-created in another project or region from code with `tofu apply`, and configuration drift is detected by `tofu plan`. Manual console-built instances cannot be rebuilt reliably under incident pressure. The exam frames this as "automate instance provisioning" — IaC plus idempotent re-application is the expected answer.
</details>

**Beyond the modules** — Three gaps to study: (1) **managed cross-region promotion workflows** — the modules build the replica but have no promotion/runbook automation; read "Promoting replicas" and "Cross-region replicas for disaster recovery" in the Cloud SQL docs, including how to re-establish replication after promotion; (2) **multi-region write systems** — Spanner multi-region instance configurations and AlloyDB secondary clusters (`gcloud alloydb clusters create-secondary`) with switchover/failover semantics; (3) **replication-lag alerting** — the module alerts on CPU/memory/disk but not on `cloudsql.googleapis.com/database/replication/replica_lag`; practice adding that alert in **Console > Monitoring > Alerting** or via `gcloud alpha monitoring policies create` in a scratch project, since lag is *the* HA health signal for read-replica topologies.

**⚠️ Exam trap** — `gcloud sql instances failover` works only on REGIONAL (HA) instances — running it against a ZONAL instance fails because there is no standby. And promotion is one-way: a promoted replica is a standalone primary; to get a replica back you create a new one and reseed. Distractors that "fail back by demoting" the promoted instance are wrong for Cloud SQL.
