# FinOps Adoption

RAD's billing model is credit-based: cost data is ingested, attributed,
reconciled, and topped up through user-visible flows. This page covers the
financial logic; the runtime that hosts it (Cloud Functions, Cloud
Scheduler, Pub/Sub) is covered in [Serverless](../capabilities/serverless.md).

## Credit lifecycle

Eight Cloud Functions under
[`rad-ui/automation/terraform/infrastructure/function/`](../../rad-ui/automation/terraform/infrastructure/function)
move credits through their states:

| Function | Role |
| --- | --- |
| `credit_project/` | Debits user credits from per-project GCP cost |
| `credit_monthly/` | Monthly credit reset for active users |
| `credit_partner/` | Awards monthly partner credits |
| `credit_low/` | Sends low-credit notifications |
| `credit_reconciliation/` | HTTP-triggered cross-provider reconciliation |
| `credit_currency/` | Syncs currency rates from GCP Billing |
| `credit_processor/` | Background credit jobs and webhook retries |
| `project_delete/` | Cleans up abandoned projects with insufficient credit |

[`CREDIT_PROCESSOR_COST_ANALYSIS.md`](../../CREDIT_PROCESSOR_COST_ANALYSIS.md)
documents the per-invocation economics and right-sizing of these
functions. The phased daily schedule that drives them lives in
[`scheduler.tf`](../../rad-ui/automation/terraform/infrastructure/scheduler.tf).

## Cost APIs and dashboards

API routes under
[`rad-ui/webapp/src/pages/api/`](../../rad-ui/webapp/src/pages/api):
`project-costs/`, `costs/`, `billing/`, `invoices/`, `revenue/`, `roi/`.
Implementation notes:
[`docs/implementation/PROJECT_COSTS_IMPLEMENTATION.md`](../implementation/PROJECT_COSTS_IMPLEMENTATION.md).
The underlying BigQuery / Firestore data path is described in [Data &
Analytics](../capabilities/data.md).

## Multi-currency, multi-provider payments

- [`docs/implementation/MULTI_CURRENCY_PAYMENTS.md`](../implementation/MULTI_CURRENCY_PAYMENTS.md)
  — design for normalised currency handling.
- Stripe ([`pages/api/stripe/`](../../rad-ui/webapp/src/pages/api/stripe)),
  Paystack, and Flutterwave
  ([`pages/api/flutterwave/`](../../rad-ui/webapp/src/pages/api/flutterwave))
  handle checkout and subscriptions; webhook signature verification for
  each is covered in [DevSecOps](./devsecops.md).
- [`docs/implementation/FLUTTERWAVE_PAYMENT_OPTIONS.md`](../implementation/FLUTTERWAVE_PAYMENT_OPTIONS.md)
  and [`PAYMENT_CONFIG.md`](../implementation/PAYMENT_CONFIG.md) cover
  routing logic and provider selection.

## Cost alerts

[`rad-ui/webapp/src/create-alert-policies.sh`](../../rad-ui/webapp/src/create-alert-policies.sh)
provisions Cloud Monitoring policies for budget and spend anomalies; the
underlying alerting plumbing is in
[Observability](../capabilities/observability.md).

## See also

- [Serverless](../capabilities/serverless.md) — runtime model behind the
  credit lifecycle.
- [Data & Analytics](../capabilities/data.md) — where cost data lives.
- [DevSecOps](./devsecops.md) — webhook signature verification.
- [Observability](../capabilities/observability.md) — alerting and
  dashboards.
