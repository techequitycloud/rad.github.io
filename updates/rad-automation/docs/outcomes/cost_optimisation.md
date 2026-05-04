# Cost Optimisation

RAD gives operators and tenants full visibility into GCP spend, automates
credit attribution and reconciliation, and provides multi-currency billing
so customers pay with the provider that suits their region. The platform
itself is designed to minimise idle cost through serverless architecture.

## Per-tenant cost attribution

Every tenant operates in a dedicated GCP project (see
[Multi-tenancy](../capabilities/multitenancy.md)), which means GCP
Billing export data is naturally scoped per tenant. The
[`credit_project`](../../rad-ui/automation/terraform/infrastructure/function/credit_project)
Cloud Function debits user credits from per-project GCP cost on a daily
schedule, ensuring spend is attributed to the correct tenant without
manual allocation.

## Cost visibility APIs

API routes under
[`rad-ui/webapp/src/pages/api/`](../../rad-ui/webapp/src/pages/api)
expose cost data at multiple granularities:

| Route | Purpose |
| --- | --- |
| `project-costs/` | Per-project GCP spend from BigQuery billing export |
| `costs/` | Aggregated cost views |
| `billing/` | Billing account and subscription management |
| `invoices/` | Per-tenant invoice history |
| `revenue/` | Partner and agent revenue attribution |
| `roi/` | Return-on-investment views for tenants |

Implementation details are in
[`docs/implementation/PROJECT_COSTS_IMPLEMENTATION.md`](../implementation/PROJECT_COSTS_IMPLEMENTATION.md).
The underlying data path (BigQuery billing export → Firestore) is
described in [Data & Analytics](../capabilities/data.md).

## Automated credit lifecycle

Eight Cloud Functions handle the full credit lifecycle without manual
intervention — see [FinOps](../practices/finops.md) for the complete
table. Key cost-control functions:

- `credit_low` — notifies tenants before credits are exhausted, giving
  them time to top up before deployments are suspended.
- `credit_reconciliation` — HTTP-triggered cross-provider reconciliation
  catches discrepancies between payment provider records and Firestore
  balances.
- `project_delete` — reclaims abandoned tenant projects with insufficient
  credit, preventing idle GCP resource spend.

## Spend alerts

[`rad-ui/webapp/src/create-alert-policies.sh`](../../rad-ui/webapp/src/create-alert-policies.sh)
provisions Cloud Monitoring alert policies for budget anomalies and
spend spikes. The underlying alerting plumbing is described in
[Observability](../capabilities/observability.md).

## Multi-currency, multi-provider payments

Customers can pay via Stripe, Paystack, or Flutterwave — whichever fits
their region — using a normalised credit model so currency differences are
abstracted away from the platform logic. The
[`credit_currency`](../../rad-ui/automation/terraform/infrastructure/function/credit_currency)
Cloud Function syncs exchange rates from GCP Billing to keep multi-currency
invoicing accurate. Design details:
[`docs/implementation/MULTI_CURRENCY_PAYMENTS.md`](../implementation/MULTI_CURRENCY_PAYMENTS.md),
[`docs/implementation/FLUTTERWAVE_PAYMENT_OPTIONS.md`](../implementation/FLUTTERWAVE_PAYMENT_OPTIONS.md).

## Serverless cost model

The platform itself scales to zero between scheduled jobs — Cloud
Functions and Cloud Run incur no idle cost outside of active request
handling. The phased Cloud Scheduler jobs (00:00–02:00 UTC) batch credit
and cleanup work into a narrow window to minimise concurrent function
instances. See [Serverless](../capabilities/serverless.md) for the
runtime model.

## See also

- [FinOps](../practices/finops.md) — the credit lifecycle and payment
  provider integrations in detail.
- [Data & Analytics](../capabilities/data.md) — BigQuery cost data path.
- [Observability](../capabilities/observability.md) — spend alert
  policies.
- [Serverless](../capabilities/serverless.md) — scale-to-zero runtime
  model.
- [Multi-tenancy](../capabilities/multitenancy.md) — per-tenant project
  isolation that enables cost attribution.
