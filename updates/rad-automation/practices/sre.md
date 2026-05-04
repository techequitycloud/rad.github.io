# Site Reliability Engineering

RAD treats the deployment platform as a production system. This page covers
the resilience patterns that keep it serving traffic; for the metrics and
alerts that detect when it isn't, see
[Observability](../capabilities/observability.md).

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
  — Cloud Run service with autoscaling and Secret Manager bindings.
- [`rad-ui/webapp/firestore.rules`](../../rad-ui/webapp/firestore.rules)
  enforces data integrity at the database edge (see also
  [Multi-tenancy](../capabilities/multitenancy.md) and [Data &
  Analytics](../capabilities/data.md)).

## Testing as reliability

[`rad-ui/webapp/jest.config.js`](../../rad-ui/webapp/jest.config.js) and
[`rad-ui/webapp/__tests__/`](../../rad-ui/webapp/__tests__) — Jest suite
covering health endpoints, admin cache stats, cost analysis, and GitHub
integration. The CI gates in [CI/CD](./cicd.md) block PRs whose tests fail.

## See also

- [Observability](../capabilities/observability.md) — health endpoints,
  dashboards, alert policies, structured logging.
- [Serverless](../capabilities/serverless.md) — why Cloud Run + Functions
  give us scale-to-zero with isolated blast radius.
- [Disaster Recovery](../capabilities/disaster_recovery.md) — snapshot,
  restore, and cleanup machinery.
