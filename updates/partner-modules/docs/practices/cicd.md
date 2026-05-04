# Continuous Integration and Continuous Delivery (CI/CD)

> **Scope.** Canonical home for the deployment pipeline: Cloud Build configurations, build triggers, image build, progressive delivery, validation gates, and integration tests. The IaC mechanics underneath (state, drift, OpenTofu) are in [practices/gitops_iac.md](gitops_iac.md).

> **Last reviewed:** 2026-05-04

## What this repo uniquely brings to CI/CD

### 1. End-to-end Cloud Build pipelines (canonical)

Three top-level pipelines cover the deployment lifecycle:

- **`cloudbuild-create.yaml`** — initial deployment.
- **`cloudbuild-update.yaml`** — in-place updates.
- **`cloudbuild-destroy.yaml`** / **`cloudbuild-purge.yaml`** — teardown with safety gates.

All pipelines run `tofu init / plan / apply` in a custom Terraform-aware container (`${_TERRAFORM_IMAGE_NAME}:latest`) with Secret Manager substitutions for `GIT_TOKEN`. Pipelines persist `commit_hash.txt` and `repo_url.txt` into the workspace for reproducible destroy.

### 2. Parameterised, multi-tenant pipelines

A single pipeline serves every tenant and module via substitutions: `_MODULE_NAME`, `_DEPLOYMENT_ID`, `_DEPLOYMENT_BUCKET_ID`, `_MODULE_GIT_REPO_URL`. New apps and tenants require zero pipeline changes. See [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) for the multi-tenant model.

### 3. Image build and progressive delivery (canonical)

- **Inline container builds** — `modules/App_Common/buildappcontainer.tf` plus the `app_build` sub-module wire Cloud Build → Artifact Registry → deploy in one apply. App-specific build context lives in `modules/<App>_Common/scripts/`.
- **Skaffold + Cloud Deploy** — `modules/App_CloudRun/skaffold.tf`, `modules/App_GKE/skaffold.tf`, plus `trigger.tf` files generate `skaffold.yaml` and Cloud Deploy delivery pipelines.
- **Build triggers** — `modules/App_CloudRun/trigger.tf`, `modules/App_GKE/trigger.tf` create push/PR-driven Cloud Build triggers wired to the application source repo.

### 4. Plan-time safety gates (canonical)

- **Validation blocks** — `modules/App_CloudRun/validation.tf`, `modules/App_GKE/validation.tf` reject misconfigurations at `tofu plan` time.
- **Prerequisite resources** — `prerequisites.tf` provisions API enablement, PSA service agents, and IAM bindings before dependents, with retry logic for GCP's async IAM propagation.
- **Lint** — `tofu fmt -check -recursive` per `CLAUDE.md`.

### 5. Post-apply automation

- **Initialization jobs** — DB migrations, plugin installs, custom SQL declared in `*_Common/main.tf` and run as Cloud Run Jobs / Kubernetes Jobs after each deploy.
- **Cleanup automation** — revision pruning, AR cleanup, and stale-service cleanup live in [practices/finops.md](finops.md) (cost lens) and [practices/sre.md](sre.md) (toil lens).

### 6. Integration testing (canonical)

- **Go integration suite** — `tests/` (Terratest-style) drives `tofu apply` against a live GCP project.
- **Reference modules** — `modules/Sample_CloudRun`, `modules/Sample_GKE` validate Foundation changes before they propagate.
- **`TESTING_STRATEGY.md`** — layered testing approach.

### 7. Local developer loop

- **`scripts/create_modules.sh`** — scaffolds a new CloudRun + GKE + Common triple in one command (see [outcomes/developer_productivity.md](../outcomes/developer_productivity.md) for the full self-service surface).
- Standard `tofu init / validate / plan / apply` works in any module directory.

### 8. Branch strategy

The repo follows a trunk-based model with short-lived feature branches:

- **`main`** — the stable trunk; direct commits to `main` are restricted to the platform team.
- **`feature/<name>`** — short-lived branches; merged via PR with at least one reviewer approval and a passing `tofu validate` + `tofu fmt -check` run.
- **`release/<version>`** — cut from `main` for coordinated multi-module releases; used when Foundation or Platform changes must propagate to all Application Modules atomically.

Cloud Build triggers in `trigger.tf` are wired to `main` (deploy) and PR branches (plan-only preview). Destroy pipelines are never triggered automatically — they require manual invocation to prevent accidental teardown.

### 9. Production approval gates

Destructive and high-impact pipeline runs require a human approval step before `tofu apply` executes:

- **Destroy / purge pipelines** — Cloud Build `approval` step is mandatory; no auto-approval path exists.
- **Foundation or Platform changes** — changes to `modules/App_CloudRun`, `modules/App_GKE`, or `modules/Services_GCP` require a second reviewer approval on the PR before the trigger fires, enforced via GitHub branch-protection rules.
- **Drift remediation applies** — when a scheduled drift-detection run (`tofu plan`) surfaces unexpected changes, an approval gate is inserted before the remediation apply.

This prevents the `cloudbuild-destroy.yaml` and `cloudbuild-purge.yaml` pipelines from being triggered by a stray push or misconfigured substitution.

### 10. Pipeline failure notifications

Build failures must surface to operators immediately:

- **Cloud Monitoring alert policy** — a metric filter on `cloudbuild.googleapis.com/finished_build_step_count` with `status = FAILURE` triggers a notification channel (email, PagerDuty, or Slack webhook) within two minutes of failure.
- **Pub/Sub → Cloud Functions** — for richer Slack messages (tenant name, module, failed step, log link), `cloudbuild-notifications.yaml` can route build status events through a Pub/Sub topic to a lightweight Cloud Function.
- **Cloud Build history** — all build logs are retained in GCS and surfaced in the Cloud Build console for post-mortem inspection; see [practices/sre.md](sre.md) for the incident response process.

Notification channels are configured in `modules/Services_GCP` and inherited by all pipelines via shared substitutions.

### 11. Build caching

Pipeline speed is a developer-experience lever and a direct cost driver (Cloud Build charges per build-minute):

- **Docker layer caching** — the custom Terraform image (`${_TERRAFORM_IMAGE_NAME}`) is built once and re-pulled by all pipelines rather than rebuilt on each run. Tag with the provider/tofu version so layer cache hits are stable across tenants.
- **`tofu init` provider caching** — the GCS workspace bucket (`_DEPLOYMENT_BUCKET_ID`) stores `.terraform/` provider plugins between runs, eliminating repeated registry downloads. Implement via a `cache` step that copies `.terraform/` to/from a known GCS path before/after `tofu init`.
- **Go test caching** — `tests/` integration tests use Go's module cache; pre-warm the cache in the test image layer to reduce `go mod download` time.

Cache invalidation: bump the cache key (image tag or GCS path prefix) whenever the provider lock file (`terraform.lock.hcl`) changes.

## Cross-references

- [practices/gitops_iac.md](gitops_iac.md) — OpenTofu, state, drift detection, idempotent re-apply
- [practices/finops.md](finops.md) — revision pruning, AR cleanup policies (lifecycle automation)
- [practices/sre.md](sre.md) — DORA-metric impact of fast deploys, incident response
- [practices/devsecops.md](devsecops.md) — secret-handling rules in pipelines
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — multi-tenant pipeline parameterisation
- [capabilities/observability.md](../capabilities/observability.md) — Cloud Monitoring alert policies for build failures
