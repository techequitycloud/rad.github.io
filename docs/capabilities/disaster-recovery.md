---
title: "Disaster Recovery"
sidebar_label: "Disaster Recovery"
---

# Disaster Recovery & Business Continuity

> **Scope.** Canonical home for backup/restore tooling, GKE Backup, PodDisruptionBudgets, application-level rollback, and DR-aware change management. The IaC reproducibility property that underlies "re-provision in a new region" is canonical in [practices/gitops_iac.md](../practices/gitops_iac.md); the multi-cluster HA topology is canonical in [networking](networking) §4.

## What this repo uniquely brings to DR & BC

### 1. Backup automation (canonical)

`modules/App_Common/scripts/`:

- `export-backup.sh` — exports DB + filesystem state to GCS (mysqldump / pg_dump + tar of NFS / GCS contents).
- `import-gcs-backup.sh` — restores from a GCS-stored backup bundle into a fresh deployment.
- `import-gdrive-backup.sh` — imports from Google Drive. Used in partner onboarding workflows where the source backup was produced outside GCP (e.g., an existing self-hosted deployment). The script authenticates via the workload service account, locates the Drive file by ID, downloads it to the Cloud Run Job's ephemeral storage, and then feeds it into the same restore pipeline as a GCS import.

Design docs: `BACKUP_FEATURE_ANALYSIS.md`, `BACKUP_IMPORT_DEEP_DIVE.md`.

**Backup bucket:** a per-deployment GCS bucket is auto-created by `modules/App_Common/storage.tf` using the standard `app<name><tenant><id>` naming. The `app_sql_discovery` sub-module locates the bucket at job runtime, so backup/restore scripts require no hardcoded bucket names.

**Cloud Deploy stage awareness:** when `enable_cloud_deploy = true`, stage-specific databases are created with a stage suffix (e.g. `app-django-acme-dev`, `app-django-acme-staging`). Backup and restore scripts operate on the stage-scoped database, so a restore into `dev` does not affect `staging` or `prod`.

Run as Cloud Run Jobs / Kubernetes Jobs orchestrated by the Foundation Modules' job machinery.

### 2. Managed-service backups

- **Cloud SQL** PITR + automated daily backups (configured per `mysql.tf` / `pgsql.tf` deployment).
- **Filestore** snapshots on supported tiers.
- **GCS** object versioning on critical buckets.
- **Secret Manager** versioned by design.

Detailed module references in [data-and-databases](data-and-databases).

### 3. GKE Backup for Apps (canonical)

`modules/Services_GCP/gke_backup.tf` orchestrates Kubernetes-workload backup, implemented via idempotent `gcloud` `null_resource` (instead of `google_gke_backup_backup_plan`) for Autopilot lifecycle compatibility.

### 4. PodDisruptionBudgets (canonical)

`modules/App_GKE/pdb.tf` provisions Kubernetes `PodDisruptionBudget` resources to prevent Kubernetes from evicting too many pods simultaneously during voluntary disruptions (node upgrades, cluster autoscaler activity, `kubectl drain`):

- Controlled by `enable_pod_disruption_budget` (default: `true`) and `pdb_min_available` (default: `"1"`; accepts absolute integers or percentages such as `"50%"`).
- A PDB is created for standard (non-Cloud Deploy) deployments and for each Cloud Deploy stage namespace.
- PDB is skipped automatically when `max_instance_count = 1` — a 1-of-1 PDB would block drains indefinitely and provides no benefit for single-replica workloads.
- For production multi-replica workloads, `pdb_min_available = "50%"` maintains half the fleet available during rolling node maintenance.

### 5. Application-level rollback (canonical)

Per `AGENTS.md` `/maintain`:

```bash
# Cloud Run
gcloud run services update-traffic <service> --to-revisions=<previous-revision>=100

# GKE
kubectl rollout undo deployment/<name> -n <namespace>
```

Combined with revision retention (canonical in [practices/finops.md](../practices/finops.md)), this gives sub-minute application-layer recovery.

### 6. Tear-down and re-deploy

- `cloudbuild-destroy.yaml` — clean teardown.
- `cloudbuild-purge.yaml` — aggressive purge of orphans.
- `cloudbuild-create.yaml` — re-provision from scratch.

Together they support the "destroy in region A, recreate in region B with the same module + tfvars + restored backup" pattern.

### 7. Reproducibility through IaC (cross-ref)

Per `BUSINESS_CASE.md`: *"the entire infrastructure can be re-provisioned in a new region in minutes."* The mechanics — commit-pinned deploys, per-deployment GCS state, idempotent re-apply — are canonical in [practices/gitops_iac.md](../practices/gitops_iac.md).

### 8. Multi-cluster HA (cross-ref)

The 2–10 cluster topology with multi-primary Istio is the foundation for active/active or cross-region DR. Canonical in [networking](networking) §4.

### 9. Change-management discipline

`AGENTS.md` `/maintain` enforces a DR-aware checklist:

- **Pre-change**: state review, backup, plan generation, destructive-change identification, rollback plan.
- **Post-change**: health verification, log review, functional testing, metric monitoring.
- **Critical-change gates**: VPC, NFS, and database changes require backup + migration plan.

## Cross-references

- [practices/gitops_iac.md](../practices/gitops_iac.md) — IaC reproducibility, state versioning (the "re-provision anywhere" property)
- [networking](networking) — multi-cluster topology for HA/DR
- [data-and-databases](data-and-databases) — DB-level backup/PITR configuration
- [practices/finops.md](../practices/finops.md) — revision retention as rollback enabler
- [practices/sre.md](../practices/sre.md) — MTTR framing
- [practices/cicd.md](../practices/cicd.md) — destroy / purge pipelines
