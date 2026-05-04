# GitOps & Infrastructure as Code (IaC)

> **Scope.** Canonical home for the IaC engine and GitOps mechanics: OpenTofu, per-deployment state, drift detection, idempotent re-apply, and rollback via Git. The pipeline that runs `tofu apply` is in [practices/cicd.md](cicd.md); the four-tier module pattern is in [practices/platform_engineering.md](platform_engineering.md).

## What this repo uniquely brings to GitOps & IaC

### 1. OpenTofu as the IaC engine (canonical)

Per `README.md`, the repo standardises on **OpenTofu** — the OSS, community-governed Terraform fork:

- Open governance, MPL-2.0 licensed, no vendor lock to a commercial IaC product.
- Standard `tofu init / validate / plan / apply` workflow runs anywhere.
- Full Terraform provider ecosystem.

### 2. State management (canonical)

- **Per-deployment GCS state buckets** — `_DEPLOYMENT_BUCKET_ID` substitution gives each tenant/app its own state bucket, preventing cross-tenant blast radius and lock contention.
- **Versioning enforced** — `AGENTS.md` `/security` mandates "GCS with versioning, not local". A bad apply rolls back to a prior generation.
- **No local state** — eliminates laptop-as-single-point-of-failure.

### 3. Drift detection and re-assertion

- **Idempotent re-apply** — every module produces a no-op plan when state matches reality.
- **GCS KMS binding re-assertion** — `app_storage_wrapper` uses `data "external"` (not `null_resource`) so KMS binding drift is detected at plan time, not apply time (`AGENTS.md` Foundation rule #11).
- **GitHub App auto-approval** — `modules/App_Common/scripts/auto-approve-github-app.sh` keeps the GitHub installation in sync.

### 4. Reproducibility

- **Commit-pinned deploys** — Cloud Build persists `commit_hash.txt` and `repo_url.txt` per deployment so any prior production state is reconstructible.
- **Per-module repository support** — `_MODULE_GIT_REPO_URL` substitution lets applications live in their own repos while sharing the same pipeline.

### 5. Secret hygiene in IaC (cross-ref)

GitHub PAT and similar high-value secrets must never be serialised into `terraform.tfstate`. The mechanics are canonical in [practices/devsecops.md](devsecops.md) §3.

### 6. Push-button rollback

- **Git revert + pipeline run** — infrastructure converges back to the prior state.
- **Application-level rollback** — `gcloud run services update-traffic --to-revisions=...` and `kubectl rollout undo`. See [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md).

## Cross-references

- [practices/platform_engineering.md](platform_engineering.md) — four-tier module pattern (the structural side of "infrastructure as code")
- [practices/cicd.md](cicd.md) — the pipeline that runs `tofu apply`, validation gates, integration tests
- [practices/devsecops.md](devsecops.md) — secret-out-of-state mechanics
- [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) — IaC reproducibility as a DR property
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — per-deployment state isolation as a multi-tenancy primitive
