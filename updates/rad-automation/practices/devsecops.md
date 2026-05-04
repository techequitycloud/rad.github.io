# DevSecOps

Security is enforced at every layer: identity at the edge, signed webhooks,
least-privilege IAM, secrets in Secret Manager, deny-by-default storage
rules, and security checks in CI.

## Identity and authentication

- [`src/lib/firebase-admin.ts`](../../rad-ui/webapp/src/lib/firebase-admin.ts)
  initialises the Firebase Admin SDK; every sensitive API route calls
  `verifyIdToken` via
  [`src/middleware/auth.ts`](../../rad-ui/webapp/src/middleware/auth.ts)
  with revocation check and sanitised error responses.
- [`.github/scripts/setup-workload-identity.sh`](../../.github/scripts/setup-workload-identity.sh)
  configures keyless GitHub Actions → GCP authentication via Workload
  Identity Federation.

## Secrets

- [`src/utils/secrets.ts`](../../rad-ui/webapp/src/utils/secrets.ts) —
  Secret Manager retrieval with caching.
- Cloud Functions pull credentials via `@google-cloud/secret-manager`; see
  for example
  [`function/credit_low/`](../../rad-ui/automation/terraform/infrastructure/function/credit_low)
  and
  [`function/notification_admin/`](../../rad-ui/automation/terraform/infrastructure/function/notification_admin).

## Webhook signature verification

- [`pages/api/stripe/webhook.ts`](../../rad-ui/webapp/src/pages/api/stripe/webhook.ts)
  validates Stripe signatures before any processing.
- [`pages/api/flutterwave/webhook.ts`](../../rad-ui/webapp/src/pages/api/flutterwave/webhook.ts)
  does the same for Flutterwave; Paystack handlers under `pages/api/`
  follow the same pattern.
- The retry / circuit-breaker behaviour invoked by these handlers lives in
  [SRE](./sre.md).

## Input validation

`zod` (v4) and `yup` (v1) are listed in
[`rad-ui/webapp/package.json`](../../rad-ui/webapp/package.json) for
schema validation at API boundaries, with
[`src/middleware/cors.ts`](../../rad-ui/webapp/src/middleware/cors.ts)
setting an explicit CORS policy and
[`src/middleware.ts`](../../rad-ui/webapp/src/middleware.ts) normalising
trailing slashes for webhook URL stability.

## Authorisation surface

Firebase auth above protects API routes; Firestore enforces row-level
rules in [`firestore.rules`](../../rad-ui/webapp/firestore.rules) (see
[Data & Analytics](../capabilities/data.md) and
[Multi-tenancy](../capabilities/multitenancy.md) for the access-control
model). Cloud Storage is deny-by-default in
[`storage.rules`](../../rad-ui/webapp/storage.rules).

## Security guidance for contributors and AI agents

- [`.agents/skills/security/SKILL.md`](../../.agents/skills/security/SKILL.md)
  — Antigravity-compatible security skill.
- [`.jules/security.md`](../../.jules/security.md) and
  [`.jules/sentinel.md`](../../.jules/sentinel.md) — extended "Sentinel"
  persona standards. See [AI](../capabilities/ai.md) for how skills are
  loaded.

## CI security gates

[`webapp-pr-check.yml`](../../.github/workflows/webapp-pr-check.yml)
runs ESLint, TypeScript strict typecheck, Jest, and `npm audit`, blocking
PRs on high/critical findings. See [CI/CD](./cicd.md).

## See also

- [Compliance](../outcomes/compliance.md) — license, separation of duties,
  and audit posture that build on these controls.
- [Multi-tenancy](../capabilities/multitenancy.md) — per-tenant IAM and
  data isolation.
- [AI](../capabilities/ai.md) — agent-driven changes flow through these
  same gates.
