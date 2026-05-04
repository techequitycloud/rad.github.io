# Compliance

RAD's compliance posture is built up from concrete primitives the rest of
the codebase already uses: license enforcement on every file, IAM separation
of duties, identity at the data edge, region-pinned secrets, and
audit-grade structured logging.

## License enforcement

[`tools/check-license.py`](../../tools/check-license.py) validates the
Apache 2.0 boilerplate header on every contributed file. Companion checks:
[`tools/check_boilerplate.py`](../../tools/check_boilerplate.py),
[`tools/check_documentation.py`](../../tools/check_documentation.py).

## IAM separation of duties

[`infrastructure/iam_permissions.tf`](../../rad-ui/automation/terraform/infrastructure/iam_permissions.tf)
defines distinct role bundles — `super_admin`, `developers_infrastructure`,
`developers_frontend`, `developers_backend_api` — so no single role both
authors and approves changes. Per-workload service accounts are in
[`service_accounts.tf`](../../rad-ui/automation/terraform/infrastructure/service_accounts.tf).
Tenant-level IAM is described in
[Multi-tenancy](../capabilities/multitenancy.md).

## Authorisation at the data edge

Firebase token verification on every sensitive route plus row-level
Firestore rules are covered as security primitives in
[DevSecOps](../practices/devsecops.md) and as a tenancy mechanism in
[Multi-tenancy](../capabilities/multitenancy.md).

## Secrets and data residency

Secret Manager replication policies (region-pinned for Cloud Build secrets,
automatic where appropriate) are documented in
[`.jules/sentinel.md`](../../.jules/sentinel.md). Storage default-deny
posture and webhook signature verification are in
[DevSecOps](../practices/devsecops.md).

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

## CI gates

Lint, typecheck, test, and `npm audit` block PRs with high/critical
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
