# Serverless

RAD has no long-running VMs to manage: Cloud Run hosts the Next.js app,
Cloud Functions handle background processing, Cloud Scheduler + Pub/Sub
provide the event backbone, and Next.js API routes are themselves
serverless handlers.

## Cloud Run — the web tier

[`webapp.tf`](../../rad-ui/automation/terraform/infrastructure/webapp.tf)
declares the Cloud Run service with autoscaling, IAM, and Secret Manager
bindings.
[`rad-ui/webapp/Dockerfile`](../../rad-ui/webapp/Dockerfile) is built
and deployed by the pipeline in [CI/CD](../practices/cicd.md).

## Next.js API routes

Every file under
[`pages/api/`](../../rad-ui/webapp/src/pages/api) is a serverless
function in the same Next.js process — request-scoped, no shared
in-process state.

## Cloud Functions

All under
[`rad-ui/automation/terraform/infrastructure/function/`](../../rad-ui/automation/terraform/infrastructure/function),
declared in
[`functions.tf`](../../rad-ui/automation/terraform/infrastructure/functions.tf):

| Group | Functions | Owning topic |
| --- | --- | --- |
| Deployment lifecycle | `deployment_create`, `deployment_destroy`, `deployment_purge`, `deployment_cleanup`, `deployment_restore` | [Platform Engineering](../practices/platform_engineering.md), [Disaster Recovery](./disaster_recovery.md) |
| Credit lifecycle | `credit_project`, `credit_monthly`, `credit_partner`, `credit_low`, `credit_reconciliation`, `credit_currency`, `credit_processor` | [FinOps](../practices/finops.md) |
| Notifications | `notification_status`, `notification_admin` | [Observability](./observability.md) |
| Admin / cleanup | `project_delete` | [FinOps](../practices/finops.md), [Multi-tenancy](./multitenancy.md) |

## Event-driven backbone

- [`topics.tf`](../../rad-ui/automation/terraform/infrastructure/topics.tf)
  — Pub/Sub topics decouple producers from consumers
  (`rad-topic-deployments`, `rad-topic-destroy`, `rad-topic-purge`,
  `cloud-builds`, `deployment-cleanup`, `project-delete`).
- [`scheduler.tf`](../../rad-ui/automation/terraform/infrastructure/scheduler.tf)
  — Cloud Scheduler cron jobs publish to Pub/Sub on a phased schedule
  (00:00 – 02:00 UTC).
- [`cloudbuild.tf`](../../rad-ui/automation/terraform/infrastructure/cloudbuild.tf)
  — Cloud Build triggers wire each module-lifecycle pipeline to the
  appropriate function/topic.

## Why serverless here

- Scales to zero between scheduled jobs — no idle cost (see
  [FinOps](../practices/finops.md)).
- Per-function memory/instance limits cap blast radius (see
  [SRE](../practices/sre.md)).
- Pub/Sub decoupling lets each function be redeployed or re-implemented
  without touching producers.

## See also

- [Observability](./observability.md) — how function metrics flow to
  dashboards and alerts.
- [GitOps & IaC](../practices/gitops_iac.md) — every resource above is
  declared in Terraform.
