# Disaster Recovery

Backups, snapshots, restore tooling, and routine cleanup. RAD keeps state in
durable, versioned stores and ships a restore path that's exercised in CI.

## Snapshots

[`tools/create_snapshot.py`](../../tools/create_snapshot.py) captures
cluster/state into a `snapshot-<timestamp>.tar.gz` bundle for pre-release
backups and audits.

## Restore

- [`function/deployment_restore/`](../../rad-ui/automation/terraform/infrastructure/function/deployment_restore)
  — HTTP-triggered Cloud Function (512Mi) that drives a deployment
  restore. Runtime details in [Serverless](./serverless.md).
- The webapp surfaces a `/restore` page; the smoke test
  [`verify_restore.py`](../../verify_restore.py) drives it via Playwright
  to confirm the page is reachable after every deploy.

## Routine cleanup

- [`function/deployment_cleanup/`](../../rad-ui/automation/terraform/infrastructure/function/deployment_cleanup)
  — Pub/Sub-triggered cleanup of stale deployment state.
- [`function/project_delete/`](../../rad-ui/automation/terraform/infrastructure/function/project_delete)
  — reclaims abandoned tenant projects (financial trigger covered in
  [FinOps](../practices/finops.md); tenancy model in
  [Multi-tenancy](./multitenancy.md)).

## State backup

Terraform state lives in GCS buckets — versioned and durable by default.
Outputs from
[`.github/workflows/terraform-apply.yml`](../../.github/workflows/terraform-apply.yml)
are uploaded for traceability. Full IaC story in [GitOps &
IaC](../practices/gitops_iac.md).

## Data durability

Firestore retention and Cloud Storage policies are described in [Data &
Analytics](./data.md).

## See also

- [CI/CD](../practices/cicd.md) — snapshot tooling is integrated with
  releases.
- [Serverless](./serverless.md) — runtime model for the restore function.
- [GitOps & IaC](../practices/gitops_iac.md) — state versioning and
  recovery.
