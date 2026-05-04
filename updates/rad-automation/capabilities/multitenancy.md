# Multi-tenancy

Each RAD customer gets a dedicated GCP project, IAM scope, and billing
attribution. Within the webapp, role-based experiences keep super admins,
partners, agents, finance, support, and end users on the right surfaces.

## Per-tenant GCP project

[`modules/project/`](../../rad-ui/automation/terraform/modules/project)
provisions a dedicated project per deployment with org policy, IAM, and
billing pre-wired. The lifecycle of those projects (create, update,
destroy, purge, restore) runs through the Cloud Functions and Cloud Build
pipelines described in [Serverless](./serverless.md) and [Platform
Engineering](../practices/platform_engineering.md).

## Role-based webapp surface

API routes are organised by role under
[`pages/api/`](../../rad-ui/webapp/src/pages/api):
[`admin/`](../../rad-ui/webapp/src/pages/api/admin),
[`partner/`](../../rad-ui/webapp/src/pages/api/partner),
[`account/`](../../rad-ui/webapp/src/pages/api/account),
[`support/`](../../rad-ui/webapp/src/pages/api/support),
[`users/`](../../rad-ui/webapp/src/pages/api/users). Per-role guides for
end users live in [`docs/guides/`](../guides) and feature docs in
[`docs/features/`](../features) (see
[Education](../outcomes/education.md)).

## Authorisation enforcement

- [`firestore.rules`](../../rad-ui/webapp/firestore.rules) gates reads
  and writes by authenticated identity and role; data shape and access path
  are described in [Data & Analytics](./data.md).
- The IAM separation of duties enforced at the platform level
  ([`iam_permissions.tf`](../../rad-ui/automation/terraform/infrastructure/iam_permissions.tf))
  is covered in [Compliance](../outcomes/compliance.md).
- Token verification for every sensitive route — see
  [DevSecOps](../practices/devsecops.md).

## Project-scoped data

Cost APIs, deployments, invoices, and revenue are scoped per tenant project
(see [FinOps](../practices/finops.md)). Cleanup of abandoned tenants flows
through the `project_delete` function — see [Disaster
Recovery](./disaster_recovery.md).

## See also

- [Platform Engineering](../practices/platform_engineering.md) —
  self-service tenant provisioning.
- [DevSecOps](../practices/devsecops.md) — auth and authorisation
  primitives.
- [Data & Analytics](./data.md) — Firestore rules and indexes.
- [Compliance](../outcomes/compliance.md) — IAM separation of duties.
