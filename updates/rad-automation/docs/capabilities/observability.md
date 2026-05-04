# Observability

Health endpoints, monitoring dashboards, alert policies, structured logging,
and notification fan-out — the signals SRE depends on.

## Health endpoints

- [`pages/api/health.ts`](../../rad-ui/webapp/src/pages/api/health.ts) —
  basic `200 OK` liveness for Cloud Run and uptime checks.
- [`pages/api/health/payment-providers.ts`](../../rad-ui/webapp/src/pages/api/health/payment-providers.ts)
  — deep readiness exposing circuit-breaker state, cache statistics, and
  per-provider availability with `healthy` / `degraded` / `unhealthy`
  classification (the breaker itself is in
  [SRE](../practices/sre.md)).

## Cloud Monitoring dashboards

- [`src/create-monitoring-dashboard.sh`](../../rad-ui/webapp/src/create-monitoring-dashboard.sh)
  — provisions a dashboard for the credit partner function: invocations,
  P95 execution time, error counts, active instances, memory.
- [`src/credit-partner-dashboard.json`](../../rad-ui/webapp/src/credit-partner-dashboard.json)
  — layout JSON managed alongside the code that emits the metrics.

## Alert policies

[`src/create-alert-policies.sh`](../../rad-ui/webapp/src/create-alert-policies.sh)
— policies for high error rate (>10%) and timeout detection (approaching
the 450s Cloud Function limit). Cost-side alerts also use this script — see
[FinOps](../practices/finops.md).

## Structured logging

Shared Cloud Function utilities in
[`function/utils.js`](../../rad-ui/automation/terraform/infrastructure/function/utils.js)
emit at Cloud Logging severity levels (`DEBUG` – `CRITICAL`) with
configurable filtering. Severity-aware logs underpin the audit posture
described in [Compliance](../outcomes/compliance.md).

## Notification fan-out

- [`tools/notifications.py`](../../tools/notifications.py) — GitHub
  Actions notification fan-out to Google Chat with deduplication.
- [`function/notification_admin/`](../../rad-ui/automation/terraform/infrastructure/function/notification_admin)
  and
  [`function/notification_status/`](../../rad-ui/automation/terraform/infrastructure/function/notification_status)
  — Pub/Sub-driven status and admin notifications. Runtime details in
  [Serverless](./serverless.md).

## See also

- [SRE](../practices/sre.md) — resilience patterns these signals protect.
- [Serverless](./serverless.md) — what's being measured.
- [Compliance](../outcomes/compliance.md) — audit-grade logging.
