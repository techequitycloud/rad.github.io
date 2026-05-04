# GitOps & Infrastructure as Code (IaC)

> **Scope.** Canonical home for the IaC engine and GitOps mechanics: OpenTofu, per-deployment state, drift detection, idempotent re-apply, and rollback via Git. The pipeline that runs `tofu apply` is in [practices/cicd.md](cicd.md); the four-tier module pattern is in [practices/platform_engineering.md](platform_engineering.md).

> **Last reviewed:** 2026-05-04

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

### 7. Module versioning strategy

All modules use local relative paths (`source = "../App_CloudRun"`) within a single repository, giving atomic cross-module changes and eliminating version-skew between Foundation and Application modules. As the platform matures, module consumers should be aware of the following conventions:

- **Git tags as version markers** — stable releases are tagged `vMAJOR.MINOR.PATCH` on `main`. Application teams consuming modules from a separate repository can pin to a tag: `source = "git::https://github.com/org/partner-modules.git//modules/App_CloudRun?ref=v1.2.0"`.
- **CHANGELOG.md** — maintained at the repo root; every tag entry notes breaking changes, new variables, and deprecated variables with migration instructions.
- **Semver contract** — PATCH: bug fixes, no variable changes. MINOR: new optional variables (backward-compatible). MAJOR: removed or renamed variables, output schema changes. Foundation-tier MAJOR bumps require propagation to all Application Modules (see [practices/platform_engineering.md](platform_engineering.md) §6 for the deprecation policy).

### 8. Provider version pinning

Provider upgrades are a common source of unexpected plan-time diffs. The following policy prevents uncontrolled upgrades:

- **`required_providers` block** — every module's `versions.tf` (or equivalent) must pin the `google` and `google-beta` providers to a `~>` constraint (e.g. `~> 6.0`) locking the major version while allowing patch updates.
- **Lock file committed** — `terraform.lock.hcl` is committed to the repository. Dependabot or a monthly manual review updates the lock file; the update is a dedicated PR so provider diffs are isolated from feature changes.
- **OpenTofu version** — the custom Terraform image (`${_TERRAFORM_IMAGE_NAME}`) pins the OpenTofu binary version. Bump the image tag (not `latest`) when upgrading OpenTofu, and validate with `modules/Sample_CloudRun` + `modules/Sample_GKE` before rolling to production.

### 9. State lock contention and recovery

GCS-backed state uses native object locking. When a lock is unexpectedly held (e.g. a pipeline crashed mid-apply):

1. **Identify the lock** — `tofu force-unlock` requires the lock ID, which appears in the error message. Alternatively: `gsutil cat gs://<DEPLOYMENT_BUCKET_ID>/<MODULE_NAME>/default.tflock`.
2. **Verify the holding process is dead** — check Cloud Build history for the build that acquired the lock. If the build has `FAILED` or `CANCELLED` status, the lock is stale.
3. **Release the lock** — `tofu force-unlock <LOCK_ID>` from within the module directory, with the same backend configuration as the pipeline. Only the deployment owner or platform engineer should do this.
4. **Inspect state before re-applying** — run `tofu plan` and review the diff carefully before re-running `apply`. A crashed mid-apply may have partially created resources; the plan output confirms what was and wasn't completed.

Documenting this process prevents engineers from deleting the lock file directly (which corrupts the state metadata) or force-pushing to `main` to trigger a re-run without verifying state integrity.

### 10. IaC change approval workflow

The four-tier architecture means a change to Platform or Foundation modules has blast radius proportional to the number of Application Modules that consume it. The following approval gates apply:

| Tier changed | PR reviewers required | Additional gate |
|---|---|---|
| Application (`<App>_CloudRun` / `<App>_GKE`) | 1 (app team) | None |
| Common (`<App>_Common`) | 1 (app team) | Confirm secrets and init-job outputs are unchanged |
| Foundation (`App_CloudRun` / `App_GKE`) | 2 (1 app team + 1 platform team) | Validate against `Sample_CloudRun` / `Sample_GKE` before merge |
| Platform (`Services_GCP`) | 2 (platform team) | Dry-run apply in non-production project; VPC-SC dry-run enabled |

Changes that add or remove variables in Foundation or Platform tiers trigger the propagation checklist documented in `CLAUDE.md` (variable mirroring, UIMeta tags, sync tooling).

## Cross-references

- [practices/platform_engineering.md](platform_engineering.md) — four-tier module pattern (the structural side of "infrastructure as code")
- [practices/cicd.md](cicd.md) — the pipeline that runs `tofu apply`, validation gates, integration tests
- [practices/devsecops.md](devsecops.md) — secret-out-of-state mechanics
- [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) — IaC reproducibility as a DR property
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — per-deployment state isolation as a multi-tenancy primitive
