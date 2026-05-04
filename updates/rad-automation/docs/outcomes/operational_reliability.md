# Operational Reliability

RAD is designed so that transient failures — in payment providers, Cloud
Functions, or the webapp itself — are contained, retried, and surfaced
without cascading into data loss or prolonged outages. This page
describes the reliability outcomes operators can expect; the practices
that produce them are in [SRE](../practices/sre.md) and
[Observability](../capabilities/observability.md).

## Payment provider resilience

The webapp's circuit breaker
([`src/utils/circuit-breaker.ts`](../../rad-ui/webapp/src/utils/circuit-breaker.ts))
prevents a degraded payment provider from blocking the entire request
path. It moves through `CLOSED` → `OPEN` → `HALF_OPEN` states using
rolling-window failure counting, so a flapping provider trips the breaker
quickly and recovers gradually. The
[`pages/api/health/payment-providers.ts`](../../rad-ui/webapp/src/pages/api/health/payment-providers.ts)
endpoint exposes the current circuit state and per-provider availability
as `healthy` / `degraded` / `unhealthy` — readable by monitoring systems
and operators alike.

## Webhook reliability

Failed webhook deliveries are placed in a retry queue
([`src/utils/webhook-retry-queue.ts`](../../rad-ui/webapp/src/utils/webhook-retry-queue.ts))
with exponential backoff (1 min → 16 min, capped at 1 hour) and a
maximum of five attempts before dead-letter handling. This means a
short-lived provider outage does not result in lost payment events.

## Cloud Function error handling

Shared utilities in
[`function/utils.js`](../../rad-ui/automation/terraform/infrastructure/function/utils.js)
expose a `MAX_RETRIES` constant and a TTL'd notification cache so
transient Cloud Function errors trigger retries without fanning out into
duplicate alert noise.

## Autoscaling and blast-radius containment

Cloud Run autoscaling is declared in
[`webapp.tf`](../../rad-ui/automation/terraform/infrastructure/webapp.tf)
— the service scales to handle traffic spikes and back to zero when idle.
Per-function memory and instance limits on Cloud Functions cap the
blast radius of a misbehaving function without affecting the rest of
the platform.

## Liveness and readiness

[`pages/api/health.ts`](../../rad-ui/webapp/src/pages/api/health.ts)
provides a basic `200 OK` liveness endpoint for Cloud Run health checks
and external uptime monitors. The payment-provider readiness endpoint
provides a deeper signal for operators monitoring third-party
dependencies.

## Restore and recovery

Pre-release snapshots, a Pub/Sub-triggered cleanup function, and an
HTTP-triggered restore function give operators a tested recovery path.
The smoke test `verify_restore.py` exercises the `/restore` page via
Playwright after every deployment to confirm the path is reachable.
Full details in [Disaster Recovery](../capabilities/disaster_recovery.md).

## Testing as a reliability gate

The Jest suite
([`rad-ui/webapp/__tests__/`](../../rad-ui/webapp/__tests__)) covers
health endpoints, cache behaviour, and cost analysis. CI blocks PRs whose
tests fail before they reach production — see [CI/CD](../practices/cicd.md).

## See also

- [SRE](../practices/sre.md) — resilience patterns and runtime hosting.
- [Observability](../capabilities/observability.md) — the signals that
  make reliability visible.
- [Disaster Recovery](../capabilities/disaster_recovery.md) — snapshot,
  restore, and cleanup machinery.
- [Serverless](../capabilities/serverless.md) — scale-to-zero runtime
  model that underlies autoscaling.
