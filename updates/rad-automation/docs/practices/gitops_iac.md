# GitOps & Infrastructure as Code

All RAD infrastructure — Cloud Run, Cloud Functions, Pub/Sub topics,
schedulers, IAM, service accounts, secrets — is defined declaratively under
[`rad-ui/automation/terraform/`](../../rad-ui/automation/terraform).
Changes flow through PR-gated `plan` and approval-gated `apply` workflows,
mirroring the application CI/CD pipeline.

## Declarative infrastructure

- [`infrastructure/main.tf`](../../rad-ui/automation/terraform/infrastructure/main.tf),
  [`webapp.tf`](../../rad-ui/automation/terraform/infrastructure/webapp.tf),
  [`functions.tf`](../../rad-ui/automation/terraform/infrastructure/functions.tf),
  [`topics.tf`](../../rad-ui/automation/terraform/infrastructure/topics.tf),
  [`scheduler.tf`](../../rad-ui/automation/terraform/infrastructure/scheduler.tf),
  [`iam_permissions.tf`](../../rad-ui/automation/terraform/infrastructure/iam_permissions.tf),
  [`service_accounts.tf`](../../rad-ui/automation/terraform/infrastructure/service_accounts.tf)
  — every runtime resource referenced elsewhere in this guide is declared
  here.
- [`modules/project/`](../../rad-ui/automation/terraform/modules/project)
  — reusable per-tenant project module. Beyond project creation it handles
  org policy enforcement, activation of required GCP service APIs, and
  billing lien attachment to prevent accidental project deletion. See
  [Multi-tenancy](../capabilities/multitenancy.md).
- [`modules/of-builder/`](../../rad-ui/automation/terraform/modules/of-builder)
  — custom OpenTofu builder image used by Cloud Build steps.

## PR-gated plan

[`.github/workflows/terraform-plan.yml`](../../.github/workflows/terraform-plan.yml)
detects affected stacks, runs `tofu fmt/init/validate/plan`, posts the plan
as a PR comment, and uploads the plan artifact for review. Reviewers see the
exact resources a merge will create, change, or destroy before approving.

## Approval-gated apply

[`.github/workflows/terraform-apply.yml`](../../.github/workflows/terraform-apply.yml)
applies on merge with manual approval (`production-infrastructure`
environment), retries on transient errors, and uploads outputs to GCS. The
Cloud Run application deploy in [CI/CD](./cicd.md) follows the same
approval-gate pattern.

## Plan guardrails

[`tools/check-tf-plan.py`](../../tools/check-tf-plan.py) inspects plan
output for forbidden changes before apply.

## State management

Terraform state lives in GCS so it is versioned, durable, and shared across
the team — and counts as part of the disaster-recovery story (see [Disaster
Recovery](../capabilities/disaster_recovery.md)).

## Environment model

There is currently a **single production environment**. No separate
staging or development Terraform workspace exists. The manual approval
gate on the `production-infrastructure` GitHub Environment is the primary
guard against unreviewed changes reaching production. Teams that need
pre-production validation should use the `workflow_dispatch` inputs on
`terraform-plan.yml` to target a specific resource and review the plan
output before merging.

## Local mirror

[`.github/scripts/terraform-helper.sh`](../../.github/scripts/terraform-helper.sh)
exposes `detect-changes`, `validate`, `plan`, `plan-function`,
`function-status`, `state-list`, and `outputs` so engineers can run the same
commands locally that CI runs.

## OpenTofu, not (only) Terraform

Choosing OpenTofu (the open-source IaC engine) keeps the door open to other
provider ecosystems — see [Multicloud](../capabilities/multicloud.md).
Workflows pin OpenTofu at **1.10.6**; upgrades should be tested against the
full plan/apply cycle before bumping the pinned version. The Google and
Google-beta providers are constrained to `~7.0` (any `7.x` release),
allowing minor-version upgrades without a workflow change.

## See also

- [CI/CD](./cicd.md) — application-side counterpart.
- [Platform Engineering](./platform_engineering.md) — modules consumed by
  end users.
- [Multicloud](../capabilities/multicloud.md) — cloud-neutral foundations.
