# Continuous Integration and Continuous Delivery

Every PR runs lint, typecheck, tests, and a full build; merges to `main`
build a container, push to GCR, and deploy to Cloud Run with a manual
approval gate. Infrastructure CI/CD is covered separately in [GitOps &
IaC](./gitops_iac.md).

## Pull request quality gates

[`.github/workflows/webapp-pr-check.yml`](../../.github/workflows/webapp-pr-check.yml)
runs ESLint → TypeScript strict typecheck (`build-types`) → Jest →
production `next build` and blocks PRs on critical/high `npm audit`
findings. The same `npm audit` gate is described in
[DevSecOps](./devsecops.md).

## Application deployment

- [`.github/workflows/deploy-webapp.yml`](../../.github/workflows/deploy-webapp.yml)
  — on merge to `main`: Docker build → push to GCR → deploy to Cloud Run
  with manual approval gate, post-deploy health check, and rollback
  guidance.
- [`.github/workflows/deploy-webapp-manual.yml`](../../.github/workflows/deploy-webapp-manual.yml)
  — manual emergency deployment with custom version tags and a
  skip-health-check escape hatch.
- [`rad-ui/webapp/cloudbuild.yaml`](../../rad-ui/webapp/cloudbuild.yaml)
  — three-step Cloud Build pipeline targeting Cloud Run service
  `cs-rl-web-portal` in project `tec-rad-ui-2b65` (`us-central1`).
- [`rad-ui/webapp/Dockerfile`](../../rad-ui/webapp/Dockerfile) —
  multi-stage Node 20 Alpine container.

## Module deployment lifecycle

The four Cloud Build pipelines that the webapp / launcher trigger when end
users deploy a RAD module — `cloudbuild_deployment_create.yaml`,
`update.yaml`, `destroy.yaml`, `purge.yaml` under
[`rad-ui/automation/`](../../rad-ui/automation) — are covered in
[Platform Engineering](./platform_engineering.md).

## Identity and operational tooling

- Keyless GCP auth: see [DevSecOps](./devsecops.md).
- Pre-release snapshots and post-deploy restore verification: see
  [Disaster Recovery](../capabilities/disaster_recovery.md).
- Local mirror of the Terraform CI commands:
  [`.github/scripts/terraform-helper.sh`](../../.github/scripts/terraform-helper.sh)
  (covered in [GitOps & IaC](./gitops_iac.md)).

## Onboarding documentation

[`.github/README.md`](../../.github/README.md),
[`QUICK_START.md`](../../.github/QUICK_START.md),
[`PHASE3_README.md`](../../.github/PHASE3_README.md), and
[`PHASE3_QUICK_START.md`](../../.github/PHASE3_QUICK_START.md) walk
through WIF setup, secrets, and environments end-to-end.

## See also

- [GitOps & IaC](./gitops_iac.md) — Terraform plan/apply pipelines.
- [DevSecOps](./devsecops.md) — Workload Identity Federation and `npm
  audit`.
- [Disaster Recovery](../capabilities/disaster_recovery.md) — snapshot
  tooling integrated with releases.
- [Platform Engineering](./platform_engineering.md) —
  module-deployment pipelines.
