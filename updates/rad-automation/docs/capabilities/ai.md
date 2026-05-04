# Artificial Intelligence

RAD treats AI assistants as first-class collaborators. Project context,
persona-style skills, and an in-product agent surface let humans and AI
agents work from the same playbook — and through the same review and
approval gates as human contributors.

## Project context for AI assistants

[`CLAUDE.md`](../../CLAUDE.md) is the primary onboarding document for
Claude Code agents: commands (`pnpm dev`, `pnpm test`, `pnpm build`),
architecture, data and auth flow, payment webhooks, Cloud Functions, IaC,
and house conventions. It is loaded at the start of every Claude Code
session so AI changes match human conventions automatically.

## Skill-based specialisation

Two parallel libraries cover focused work:

| Domain | Antigravity-compatible | Jules persona |
| --- | --- | --- |
| Performance | [`.agents/skills/performance/SKILL.md`](../../.agents/skills/performance/SKILL.md) | [`.jules/performance.md`](../../.jules/performance.md) (`bolt`) |
| Security | [`.agents/skills/security/SKILL.md`](../../.agents/skills/security/SKILL.md) | [`.jules/security.md`](../../.jules/security.md) (`sentinel`) |
| UX / Accessibility | [`.agents/skills/ux-accessibility/SKILL.md`](../../.agents/skills/ux-accessibility/SKILL.md) | [`.jules/design.md`](../../.jules/design.md) (`palette`) |

Persona journals
([`bolt.md`](../../.jules/bolt.md),
[`sentinel.md`](../../.jules/sentinel.md),
[`palette.md`](../../.jules/palette.md)) carry persistent role-scoped
context across sessions. The Sentinel security guidance is the same one
described in [DevSecOps](../practices/devsecops.md).

## In-product agent ("Jules")

[`pages/api/jules/`](../../rad-ui/webapp/src/pages/api/jules) exposes
the Jules agent inside the webapp:

- `session/` — manages an interactive AI session.
- `message/` — accepts user → agent messages.
- `activities/` — streams the agent's work log.
- `source/` — provides scoped read access to source.
- `approve/` — human-in-the-loop approval gate before an agent action
  lands.

The agent uses the same auth and authorisation controls as human users
(see [DevSecOps](../practices/devsecops.md) and
[Multi-tenancy](./multitenancy.md)).

## Why this matters

- **Consistency** — loading [`CLAUDE.md`](../../CLAUDE.md) plus the
  relevant skill file means an AI contributor produces code matching repo
  conventions.
- **Safety** — AI-driven changes flow through the [CI/CD](../practices/cicd.md)
  gates and [DevSecOps](../practices/devsecops.md) controls that human PRs do.
- **Specialisation** — performance, security, and UX work each load
  focused skills.

## See also

- [DevSecOps](../practices/devsecops.md) — security skill is the same
  guidance human reviewers use.
- [CI/CD](../practices/cicd.md) — automated gates that catch AI mistakes.
- [Developer Productivity](../outcomes/developer_productivity.md) — AI in
  the inner loop.
