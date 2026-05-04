# Education

RAD ships its own learning material: role-based guides, workflow
walkthroughs, feature docs, and AI-assistant onboarding — all checked into
the repo so they version with the code they describe.

## Role-based guides

Six guides under [`docs/guides/`](../guides) — one per role —
([`admin-guide.md`](../guides/admin-guide.md),
[`agent-guide.md`](../guides/agent-guide.md),
[`finance-guide.md`](../guides/finance-guide.md),
[`partner-guide.md`](../guides/partner-guide.md),
[`support-guide.md`](../guides/support-guide.md),
[`user-guide.md`](../guides/user-guide.md)). The agent guide ships with
companion video and audio. The role surface itself is described in
[Multi-tenancy](../capabilities/multitenancy.md).

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

- [`docs/features/`](../features) — repo-side feature docs
  (`admins.md`, `agents.md`, `finance.md`, `partners.md`, `support.md`,
  `users.md`).
- [`rad-ui/webapp/public/docs/features/`](../../rad-ui/webapp/public/docs)
  — the same content shipped statically with the webapp so it can be
  surfaced in-product.

## Implementation references

[`docs/implementation/`](../implementation) carries deeper technical
notes:
[`PROJECT_COSTS_IMPLEMENTATION.md`](../implementation/PROJECT_COSTS_IMPLEMENTATION.md),
[`MULTI_CURRENCY_PAYMENTS.md`](../implementation/MULTI_CURRENCY_PAYMENTS.md),
[`PAYMENT_CONFIG.md`](../implementation/PAYMENT_CONFIG.md), and others
referenced from [FinOps](../practices/finops.md).

## Onboarding

The setup scripts ([`scripts/01-setup-cli.sh`](../../scripts/01-setup-cli.sh),
[`scripts/02-setup-ui.sh`](../../scripts/02-setup-ui.sh)) and the
inner-loop story belong to [Developer
Productivity](./developer_productivity.md).

## AI onboarding

[`CLAUDE.md`](../../CLAUDE.md) is the project guide loaded automatically
into every Claude Code session, plus skill files for performance, security,
and UX work — see [AI](../capabilities/ai.md).

## See also

- [Developer Productivity](./developer_productivity.md) — onboarding scripts
  and inner loop.
- [AI](../capabilities/ai.md) — assistant context and skills.
- [Platform Engineering](../practices/platform_engineering.md) — what
  end users learn to use.
