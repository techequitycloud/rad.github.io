# Disaster Recovery & Business Continuity

> **Scope.** Canonical home for backup/restore tooling, GKE Backup, application-level rollback, and DR-aware change management. The IaC reproducibility property that underlies "re-provision in a new region" is canonical in [practices/gitops_iac.md](../practices/gitops_iac.md); the multi-cluster HA topology is canonical in [capabilities/networking.md](networking.md) §4.

## What this repo uniquely brings to DR & BC

### 1. Backup automation (canonical)

`modules/App_Common/scripts/`:

- `export-backup.sh` — exports DB + filesystem state to GCS (mysqldump / pg_dump + tar of NFS / GCS contents).
- `import-gcs-backup.sh` — restores from a GCS-stored backup bundle into a fresh deployment.
- `import-gdrive-backup.sh` — imports from Google Drive (used in partner workflows).
- Design docs: `BACKUP_FEATURE_ANALYSIS.md`, `BACKUP_IMPORT_DEEP_DIVE.md`.

Run as Cloud Run Jobs / Kubernetes Jobs orchestrated by the Foundation Modules' job machinery.

### 2. Managed-service backups

- **Cloud SQL** PITR + automated daily backups (configured per `mysql.tf` / `pgsql.tf` deployment).
- **Filestore** snapshots on supported tiers.
- **GCS** object versioning on critical buckets.
- **Secret Manager** versioned by design.

Detailed module references in [capabilities/data_and_databases.md](data_and_databases.md).

### 3. GKE Backup for Apps (canonical)

`modules/Services_GCP/gke_backup.tf` orchestrates Kubernetes-workload backup, implemented via idempotent `gcloud` `null_resource` (instead of `google_gke_backup_backup_plan`) for Autopilot lifecycle compatibility.

### 4. Application-level rollback (canonical)

Per `AGENTS.md` `/maintain`:

```bash
# Cloud Run
gcloud run services update-traffic <service> --to-revisions=<previous-revision>=100

# GKE
kubectl rollout undo deployment/<name> -n <namespace>
```

Combined with revision retention (canonical in [practices/finops.md](../practices/finops.md)), this gives sub-minute application-layer recovery.

### 5. Tear-down and re-deploy

- `cloudbuild-destroy.yaml` — clean teardown.
- `cloudbuild-purge.yaml` — aggressive purge of orphans.
- `cloudbuild-create.yaml` — re-provision from scratch.

Together they support the "destroy in region A, recreate in region B with the same module + tfvars + restored backup" pattern.

### 6. Reproducibility through IaC (cross-ref)

Per `BUSINESS_CASE.md`: *"the entire infrastructure can be re-provisioned in a new region in minutes."* The mechanics — commit-pinned deploys, per-deployment GCS state, idempotent re-apply — are canonical in [practices/gitops_iac.md](../practices/gitops_iac.md).

### 7. Multi-cluster HA (cross-ref)

The 2–10 cluster topology with multi-primary Istio is the foundation for active/active or cross-region DR. Canonical in [capabilities/networking.md](networking.md) §4.

### 8. Change-management discipline

`AGENTS.md` `/maintain` enforces a DR-aware checklist:

- **Pre-change**: state review, backup, plan generation, destructive-change identification, rollback plan.
- **Post-change**: health verification, log review, functional testing, metric monitoring.
- **Critical-change gates**: VPC, NFS, and database changes require backup + migration plan.

## Cross-references

- [practices/gitops_iac.md](../practices/gitops_iac.md) — IaC reproducibility, state versioning (the "re-provision anywhere" property)
- [capabilities/networking.md](networking.md) — multi-cluster topology for HA/DR
- [capabilities/data_and_databases.md](data_and_databases.md) — DB-level backup/PITR configuration
- [practices/finops.md](../practices/finops.md) — revision retention as rollback enabler
- [practices/sre.md](../practices/sre.md) — MTTR framing
- [practices/cicd.md](../practices/cicd.md) — destroy / purge pipelines
