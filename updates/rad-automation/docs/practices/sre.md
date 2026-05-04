# Site Reliability Engineering

RAD treats the deployment platform as a production system. This page covers
the resilience patterns that keep it serving traffic; for the metrics and
alerts that detect when it isn't, see
[Observability](../capabilities/observability.md).

## Service level objectives

Formal SLO definitions have not yet been established. The targets below are
the recommended starting point; they should be ratified by the team and
encoded as Cloud Monitoring SLO resources before being used for
alerting or on-call escalation.

| Indicator | Target | Measurement window |
| --- | --- | --- |
| Portal availability | 99.5% successful requests | 30-day rolling |
| Module deployment success rate | 95% of create/update operations complete without error | 7-day rolling |
| Credit reconciliation latency | 90% of daily runs complete within 30 minutes of scheduled start | 30-day rolling |
| Payment webhook processing | 99% of valid webhooks acknowledged within 60 seconds | 7-day rolling |

Establishing these SLOs is a tracked gap. Once defined, the health
endpoints below become the primary SLI data source.

## Resilience patterns

- [`rad-ui/webapp/src/utils/circuit-breaker.ts`](../../rad-ui/webapp/src/utils/circuit-breaker.ts)
  — `CLOSED` / `OPEN` / `HALF_OPEN` circuit breaker for payment providers
  with rolling-window failure counting.
- [`rad-ui/webapp/src/utils/webhook-retry-queue.ts`](../../rad-ui/webapp/src/utils/webhook-retry-queue.ts)
  — webhook retry queue with exponential backoff (1m → 16m, capped at 1h),
  max 5 attempts, dead-letter handling.
- Shared Cloud Function utilities in
  [`function/utils.js`](../../rad-ui/automation/terraform/infrastructure/function/utils.js)
  expose `MAX_RETRIES` and a TTL'd notification cache so transient errors
  don't fan out into duplicate alerts.

## Runtime hosting

- [`rad-ui/automation/terraform/infrastructure/webapp.tf`](../../rad-ui/automation/terraform/infrastructure/webapp.tf)
  — Cloud Run service configured with **min 0 / max 10 instances**. The
  min-0 setting enables scale-to-zero cost savings during idle periods but
  introduces cold-start latency on the first request after a quiet window;
  the max-10 cap is the current concurrency ceiling and should be reviewed
  if sustained traffic approaches it.
- [`rad-ui/webapp/firestore.rules`](../../rad-ui/webapp/firestore.rules)
  enforces data integrity at the database edge (see also
  [Multi-tenancy](../capabilities/multitenancy.md) and [Data &
  Analytics](../capabilities/data.md)).

## Health checks

Two health endpoints are available:

- **`/api/health`** — liveness probe; returns `200 OK` if the process is
  running. Used by Cloud Run to determine whether to route traffic to an
  instance.
- **`/api/health/payment-providers`** — readiness probe; returns per-provider
  status (`healthy` / `degraded` / `unhealthy`), circuit-breaker state, and
  admin cache stats. Used by the deploy workflow and on-call engineers to
  assess the payment stack before and after deployments.

Post-deployment health checks in
[`.github/workflows/deploy-webapp.yml`](../../.github/workflows/deploy-webapp.yml)
hit `/api/health` with **3 retry attempts at 10-second intervals** before
declaring the deployment successful. If all three attempts fail, the
workflow surfaces rollback guidance. See the
[Deployment Rollback runbook](../runbooks/deployment-rollback.md).

## Monitoring

A Cloud Monitoring dashboard exists for the `credit_partner` function,
covering invocations, P95 execution latency, error rate, instance count,
and memory utilisation. Equivalent dashboards for the remaining seven
credit functions are not yet provisioned.

**Known gap:** a `google_monitoring_alert_policy` for Cloud Function
failures and timeouts is marked as a TODO in
[`scheduler.tf`](../../rad-ui/automation/terraform/infrastructure/scheduler.tf).
Until this is implemented, function failures are only visible by inspecting
Cloud Logging or the existing dashboard manually. Adding alert policies
for all eight credit functions is the highest-priority SRE infrastructure
item.

## Testing as reliability

[`rad-ui/webapp/jest.config.js`](../../rad-ui/webapp/jest.config.js) and
[`rad-ui/webapp/__tests__/`](../../rad-ui/webapp/__tests__) — Jest suite
covering health endpoints, admin cache stats, cost analysis, and GitHub
integration. The CI gates in [CI/CD](./cicd.md) block PRs whose tests fail.

## See also

- [Observability](../capabilities/observability.md) — health endpoints,
  dashboards, alert policies, structured logging. The current observability
  implementation includes structured Cloud Logging across all Cloud
  Functions (DEBUG through CRITICAL severity levels) and the
  `credit_partner` monitoring dashboard described above.
- [Serverless](../capabilities/serverless.md) — why Cloud Run + Functions
  give us scale-to-zero with isolated blast radius.
- [Disaster Recovery](../capabilities/disaster_recovery.md) — snapshot,
  restore, and cleanup machinery.
