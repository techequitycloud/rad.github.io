# Education

RAD ships its own learning material so that a new team member — regardless
of role — can go from account creation to first productive action using
only resources in this repository. Role-based guides, workflow
walkthroughs, feature docs, and AI-assistant onboarding are all checked
into the repo so they version with the code they describe.

## Role-based guides

Six guides under [`docs/guides/`](../guides) — one per role —
([`admin-guide.md`](../guides/admin-guide.md),
[`agent-guide.md`](../guides/agent-guide.md),
[`finance-guide.md`](../guides/finance-guide.md),
[`partner-guide.md`](../guides/partner-guide.md),
[`support-guide.md`](../guides/support-guide.md),
[`user-guide.md`](../guides/user-guide.md)). The agent guide ships with
a companion video and audio; the source files for these assets should be
referenced in the guide itself or in the agent role's feature doc. The
role surface is described in [Multi-tenancy](../capabilities/multitenancy.md).

## Workflow walkthroughs

[`docs/workflows/`](../workflows) covers task-oriented flows:
[`getting-started.md`](../workflows/getting-started.md),
[`using-rad.md`](../workflows/using-rad.md), and per-role flows
([`admin.md`](../workflows/admin.md),
[`agent.md`](../workflows/agent.md),
[`finance.md`](../workflows/finance.md),
[`partner.md`](../workflows/partner.md),
[`support.md`](../workflows/support.md),
[`user.md`](../workflows/user.md)).

## Feature documentation

[`docs/features/`](../features) contains repo-side feature docs
(`admins.md`, `agents.md`, `finance.md`, `partners.md`, `support.md`,
`users.md`). A matching set is shipped statically with the webapp under
`rad-ui/webapp/public/docs/` and surfaced in-product — these are
intentionally kept separate from the repo docs so the in-product copy
can be scoped to what end users need rather than what contributors need.

## Implementation references

[`docs/implementation/`](../implementation) carries deeper technical
notes for contributors and reviewers:

| File | Topic |
| --- | --- |
| [`PROJECT_COSTS_IMPLEMENTATION.md`](../implementation/PROJECT_COSTS_IMPLEMENTATION.md) | BigQuery cost API design |
| [`MULTI_CURRENCY_PAYMENTS.md`](../implementation/MULTI_CURRENCY_PAYMENTS.md) | Normalised currency handling |
| [`PAYMENT_CONFIG.md`](../implementation/PAYMENT_CONFIG.md) | Provider routing and selection |
| [`FLUTTERWAVE_PAYMENT_OPTIONS.md`](../implementation/FLUTTERWAVE_PAYMENT_OPTIONS.md) | Flutterwave-specific options |
| [`PAYMENT_PROVIDER_REVIEW.md`](../implementation/PAYMENT_PROVIDER_REVIEW.md) | Provider capability comparison |
| [`PAYMENT_IMPROVEMENTS_SUMMARY.md`](../implementation/PAYMENT_IMPROVEMENTS_SUMMARY.md) | Summary of payment improvements |
| [`CREDIT_PROCESSOR_COST_ANALYSIS.md`](../implementation/CREDIT_PROCESSOR_COST_ANALYSIS.md) | Credit function economics |
| [`TEST_PLAN.md`](../implementation/TEST_PLAN.md) | Test strategy and coverage plan |
| [`PR_DESCRIPTION.md`](../implementation/PR_DESCRIPTION.md) | PR description template |
| [`PULL_REQUEST_TEMPLATE.md`](../implementation/PULL_REQUEST_TEMPLATE.md) | Pull request template |

The FinOps-related notes are also referenced from
[FinOps](../practices/finops.md).

## Documentation quality enforcement

[`tools/check_documentation.py`](../../tools/check_documentation.py)
validates that every Terraform module directory has an up-to-date
`README.md` with described and alphabetically ordered variables and
outputs. This is the mechanism that keeps infrastructure docs in sync
with the code — the CI gate in [CI/CD](../practices/cicd.md) catches
drift before it reaches `main`.

## Onboarding

The setup scripts ([`scripts/01-setup-cli.sh`](../../scripts/01-setup-cli.sh),
[`scripts/02-setup-ui.sh`](../../scripts/02-setup-ui.sh)) and the
inner-loop story belong to [Developer
Productivity](./developer_productivity.md).

## AI onboarding

[`CLAUDE.md`](../../CLAUDE.md) is the project guide loaded automatically
into every Claude Code session, plus skill files for performance, security,
and UX work — see [AI](../capabilities/ai.md).

## Feedback and contributions

Documentation errors and gaps can be reported via the repository's issue
tracker. Contributors should follow the same PR process as code changes —
[`tools/check_documentation.py`](../../tools/check_documentation.py)
and the license-header checks run on documentation PRs as well.

## See also

- [Developer Productivity](./developer_productivity.md) — onboarding scripts
  and inner loop.
- [AI](../capabilities/ai.md) — assistant context and skills.
- [Platform Engineering](../practices/platform_engineering.md) — what
  end users learn to use.
