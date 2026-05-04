# Compliance

RAD operators can demonstrate a concrete compliance posture to auditors
using artefacts that are checked into the repository and enforced
automatically. The controls described here — license headers, IAM
separation of duties, identity at the data edge, region-pinned secrets,
and audit-grade structured logging — align with the security requirements
commonly assessed under SOC 2 Type II, ISO 27001, and GDPR
data-residency obligations.

## License enforcement

[`tools/check-license.py`](../../tools/check-license.py) validates the
Apache 2.0 boilerplate header on every contributed file. Companion checks:
[`tools/check_boilerplate.py`](../../tools/check_boilerplate.py),
[`tools/check_documentation.py`](../../tools/check_documentation.py) —
the documentation check validates that every Terraform module directory
contains a `README.md`, that all variables and outputs carry descriptions,
and that they are listed in alphabetical order, keeping infrastructure
documentation in sync with the code it describes.

## IAM separation of duties

[`infrastructure/iam_permissions.tf`](../../rad-ui/automation/terraform/infrastructure/iam_permissions.tf)
defines distinct role bundles — `super_admin`, `developers_infrastructure`,
`developers_frontend`, `developers_backend_api` — so no single role both
authors and approves changes. Per-workload service accounts are in
[`service_accounts.tf`](../../rad-ui/automation/terraform/infrastructure/service_accounts.tf).
Tenant-level IAM is described in
[Multi-tenancy](../capabilities/multitenancy.md).

Role assignments should be reviewed periodically to ensure least-privilege
is maintained as team membership changes. No automated attestation tooling
is currently wired to this repository; periodic manual reviews are
required.

## Authorisation at the data edge

Firebase token verification on every sensitive route plus row-level
Firestore rules are covered as security primitives in
[DevSecOps](../practices/devsecops.md) and as a tenancy mechanism in
[Multi-tenancy](../capabilities/multitenancy.md).

## Data classification

RAD handles three categories of data with different sensitivity levels:

- **PII / identity** — Firebase auth tokens and user profile data in
  Firestore. Protected by `verifyIdToken` on every sensitive API route
  and row-level Firestore rules.
- **Financial** — credit balances, invoices, BigQuery billing export
  data, and payment provider payloads. Protected by webhook signature
  verification across all three providers and role-scoped API routes.
- **Operational** — deployment state, Cloud Function logs, and Terraform
  state. Protected by GCS bucket IAM and Cloud Logging access controls.

## Secrets and data residency

Secret Manager is used for all credentials —
[`src/utils/secrets.ts`](../../rad-ui/webapp/src/utils/secrets.ts)
retrieves and caches secrets for the webapp; Cloud Functions pull
credentials via `@google-cloud/secret-manager`. Replication policy:

- Secrets bound to Cloud Build pipelines use **region-pinned**
  replication (`us-central1`) to satisfy data-residency requirements.
- Other secrets use **automatic** replication where portability is
  preferred over residency pinning.

Cloud Storage is deny-by-default per
[`storage.rules`](../../rad-ui/webapp/storage.rules); webhook signature
verification is in [DevSecOps](../practices/devsecops.md).

## Third-party and supply chain risk

Three payment providers (Stripe, Paystack, Flutterwave) and GCP managed
services are the primary third-party dependencies. Compensating controls:
webhook payloads are rejected unless the provider's HMAC or signature
validates; `pnpm audit` in CI blocks PRs with high/critical findings in
third-party npm packages. Container images are built from a pinned
Node 20 Alpine base — enabling vulnerability scanning via Google Artifact
Analysis on the GCR registry is a recommended additional control not yet
enabled.

## Audit-grade logging

Structured logging in
[`function/utils.js`](../../rad-ui/automation/terraform/infrastructure/function/utils.js)
emits at Cloud Logging severity levels suitable for retention and audit;
the full observability story is in
[Observability](../capabilities/observability.md).

## Security review skill

The "Sentinel" persona ([`.jules/sentinel.md`](../../.jules/sentinel.md))
is the same standard used by AI reviewers as by humans — see
[AI](../capabilities/ai.md). Its journal records security findings with
prevention steps so the same vulnerability doesn't recur.

## Incident response

Security and operational incidents should be escalated through the
notification fan-out described in
[Observability](../capabilities/observability.md). A formal incident
response runbook covering classification, containment, and post-mortem
steps should be maintained alongside these controls; none is currently
checked into the repository.

## CI gates

Lint, typecheck, test, and `pnpm audit` block PRs with high/critical
findings; full pipeline in [CI/CD](../practices/cicd.md). Terraform plan
guardrails:
[`tools/check-tf-plan.py`](../../tools/check-tf-plan.py) — see [GitOps &
IaC](../practices/gitops_iac.md).

## See also

- [DevSecOps](../practices/devsecops.md) — the controls compliance builds
  on.
- [Observability](../capabilities/observability.md) — audit logging.
- [Multi-tenancy](../capabilities/multitenancy.md) — IAM and data
  isolation.
