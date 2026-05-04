# Continuous Integration and Continuous Delivery (CI/CD)

> **Scope.** Canonical home for the deployment pipeline: Cloud Build configurations, build triggers, image build, progressive delivery, validation gates, and integration tests. The IaC mechanics underneath (state, drift, OpenTofu) are in [practices/gitops_iac.md](gitops_iac.md).

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

## Cross-references

- [practices/gitops_iac.md](gitops_iac.md) — OpenTofu, state, drift detection, idempotent re-apply
- [practices/finops.md](finops.md) — revision pruning, AR cleanup policies (lifecycle automation)
- [practices/sre.md](sre.md) — DORA-metric impact of fast deploys
- [practices/devsecops.md](devsecops.md) — secret-handling rules in pipelines
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — multi-tenant pipeline parameterisation
