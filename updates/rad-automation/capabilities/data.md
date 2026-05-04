# Data & Analytics

RAD's data plane combines Firestore as the operational system of record with
BigQuery for cost analytics and Cloud Asset for resource inventory. All
access goes through identity-aware code paths.

## Firestore — system of record

- [`firestore.rules`](../../rad-ui/webapp/firestore.rules) — row-level
  authorisation rules, row-level access control. The auth model behind the
  rules is described in [DevSecOps](../practices/devsecops.md); the per-tenant
  scoping is described in [Multi-tenancy](./multitenancy.md).
- [`firestore.indexes.json`](../../rad-ui/webapp/firestore.indexes.json)
  — composite indexes versioned with the code that needs them.
- [`rad-ui/firestore-schema.json`](../../rad-ui/firestore-schema.json) —
  schema-style documentation for the collections.
- Server-side access goes through
  [`src/lib/firebase-admin.ts`](../../rad-ui/webapp/src/lib/firebase-admin.ts);
  `CLAUDE.md` enforces `Promise.all` batching to avoid N+1 reads.

## BigQuery — cost analytics

The cost APIs under
[`pages/api/project-costs/`](../../rad-ui/webapp/src/pages/api/project-costs)
and [`pages/api/costs/`](../../rad-ui/webapp/src/pages/api/costs) query
GCP Billing export tables in BigQuery. The credit-attribution logic that
consumes these queries is in [FinOps](../practices/finops.md).

## Cloud Asset

Used for cross-resource discovery within a deployment (referenced by the
deployment lifecycle Cloud Functions in [Serverless](./serverless.md)).

## Exchange rates

[`pages/api/exchange-rates/`](../../rad-ui/webapp/src/pages/api/exchange-rates)
plus the
[`credit_currency`](../../rad-ui/automation/terraform/infrastructure/function/credit_currency)
Cloud Function keep multi-currency invoicing accurate; covered as a billing
flow in [FinOps](../practices/finops.md).

## Storage

Cloud Storage is deny-by-default per
[`storage.rules`](../../rad-ui/webapp/storage.rules) — see
[DevSecOps](../practices/devsecops.md). Terraform state buckets are part of
[GitOps & IaC](../practices/gitops_iac.md) and [Disaster
Recovery](./disaster_recovery.md).

## See also

- [DevSecOps](../practices/devsecops.md) — auth at the data edge.
- [Multi-tenancy](./multitenancy.md) — per-tenant data scoping.
- [FinOps](../practices/finops.md) — what we do with the cost data.
