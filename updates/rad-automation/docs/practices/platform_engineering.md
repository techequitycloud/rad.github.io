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

### Role-aware portal experiences

The portal renders different capabilities depending on the authenticated
user's role:

| Role | Primary capabilities |
| --- | --- |
| User | Deploy, update, and destroy RAD modules; view project costs and credits |
| Admin | User management; platform configuration; support queue |
| Partner | Partner credit management; revenue dashboards; referral tracking |
| Agent | Automated module lifecycle operations on behalf of users |
| Finance | Invoice management; payment provider configuration; revenue reporting |
| Support | Read-only access to user accounts and deployment status for triage |

Role assignments are managed through Firebase Auth custom claims and
enforced server-side on every API route.

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

## Self-service workflow dispatch

Both the application and infrastructure workflows support
`workflow_dispatch` with structured input controls, enabling operators to
perform targeted actions without writing code:

- **`deploy-webapp-manual.yml`** — inputs: deployment method (Cloud Build
  or direct Cloud Run), custom version tag, force-rebuild flag, and a
  skip-health-check escape hatch for emergency deploys.
- **`terraform-plan.yml` / `terraform-apply.yml`** — inputs: target
  resource (plan a specific module or function), auto-approve flag for
  low-risk changes, and stack selection.

These dispatch inputs serve as an operator self-service layer on top of the
automated PR-triggered pipelines.

## Per-customer GCP projects

The [`modules/project/`](../../rad-ui/automation/terraform/modules/project)
module provisions a dedicated GCP project per deployment, with org policy,
IAM, and billing pre-wired. The tenancy model this enables is described
in [Multi-tenancy](../capabilities/multitenancy.md).

## AI agents as first-class platform consumers

AI agents (Claude Code, Antigravity, Jules) interact with the platform
through the same portal and API surface as human developers. Specialist
skill guides define how agents should behave when working in each domain:

- [`.agents/skills/performance/SKILL.md`](../../.agents/skills/performance/SKILL.md)
  — performance optimisation patterns.
- [`.agents/skills/security/SKILL.md`](../../.agents/skills/security/SKILL.md)
  — security hardening rules (see also [DevSecOps](./devsecops.md)).
- [`.agents/skills/ux-accessibility/SKILL.md`](../../.agents/skills/ux-accessibility/SKILL.md)
  — UX and accessibility standards.

Agent-driven changes flow through the same CI gates and approval workflows
as human-authored changes. See [AI](../capabilities/ai.md) for how skills
are loaded and applied.

## See also

- [GitOps & IaC](./gitops_iac.md) — declarative Terraform foundations.
- [CI/CD](./cicd.md) — application deployment pipelines.
- [Serverless](../capabilities/serverless.md) — event-driven control plane.
- [Multi-tenancy](../capabilities/multitenancy.md) — per-tenant isolation.
- [Developer Productivity](../outcomes/developer_productivity.md) — the
  outcome the platform delivers for end users.
