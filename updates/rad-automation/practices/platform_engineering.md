# Platform Engineering

RAD is a platform: application teams consume a paved road to GCP through a
self-service web portal, a CLI, and a curated module catalogue. This page
covers the developer-facing surface; the underlying IaC, pipelines, and
runtime are linked out.

## The platform surface

- **Developer portal** —
  [`rad-ui/webapp/`](../../rad-ui/webapp) is a Next.js application with
  role-aware experiences for users, admins, partners, agents, finance,
  and support. Per-role experiences are described in
  [`docs/features/`](../features) and [`docs/guides/`](../guides)
  (see [Education](../outcomes/education.md)).
- **CLI** — [`rad-launcher/rad.py`](../../rad-launcher/rad.py) provides
  a guided terminal experience for the same module workflows.

Both surfaces share one backend lifecycle, so developers can switch
between them without surprises.

## Golden-path module catalogue

- [`tools/service-catalog.py`](../../tools/service-catalog.py) —
  generates the catalogue from the Terraform sources.
- [`tools/build_readme.py`](../../tools/build_readme.py) and
  [`tools/tfdoc.py`](../../tools/tfdoc.py) keep module READMEs in sync.
- [`rad-ui/webapp/src/templates/`](../../rad-ui/webapp/src/templates) —
  templates feeding the guided UI for module configuration.

## Module deployment lifecycle

Cloud Build pipelines for create / update / destroy / purge live under
[`rad-ui/automation/`](../../rad-ui/automation); the application-deploy
machinery they share is in [CI/CD](./cicd.md). The Terraform modules they
execute are covered in [GitOps & IaC](./gitops_iac.md). The Pub/Sub +
Scheduler control plane is in [Serverless](../capabilities/serverless.md).

## Per-customer GCP projects

The [`modules/project/`](../../rad-ui/automation/terraform/modules/project)
module provisions a dedicated GCP project per deployment, with org policy,
IAM, and billing pre-wired. The tenancy model this enables is described
in [Multi-tenancy](../capabilities/multitenancy.md).

## See also

- [GitOps & IaC](./gitops_iac.md) — declarative Terraform foundations.
- [CI/CD](./cicd.md) — application deployment pipelines.
- [Serverless](../capabilities/serverless.md) — event-driven control plane.
- [Multi-tenancy](../capabilities/multitenancy.md) — per-tenant isolation.
- [Developer Productivity](../outcomes/developer_productivity.md) — the
  outcome the platform delivers for end users.
