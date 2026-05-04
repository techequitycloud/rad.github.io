# Enhanced Developer Productivity

RAD optimises for fast inner-loop feedback and self-service so developers
spend time on product, not platform mechanics.

## One-command local setup

- [`scripts/01-setup-cli.sh`](../../scripts/01-setup-cli.sh) —
  bootstraps the `rad-launcher` CLI environment.
- [`scripts/02-setup-ui.sh`](../../scripts/02-setup-ui.sh) — bootstraps
  the webapp environment.
- [`rad-ui/webapp/setup_local_dev.sh`](../../rad-ui/webapp/setup_local_dev.sh)
  and [`gen_local_config.sh`](../../rad-ui/webapp/gen_local_config.sh)
  — generate local config and start the dev stack.

## Fast inner loop

The pnpm scripts in
[`rad-ui/webapp/package.json`](../../rad-ui/webapp/package.json) cover
the full feedback cycle:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Next.js dev server with hot reload (`localhost:3000`) |
| `pnpm test` | Jest suite |
| `pnpm test-interactive` | Jest watch mode |
| `pnpm build-types` | `tsc --noEmit` strict typecheck |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm build` | Production build with full type check |

Pre-commit gates use `lint-staged` (config:
[`lint-staged.config.js`](../../rad-ui/webapp/lint-staged.config.js))
so formatting and linting run only on changed files. The same checks run
in CI — see [CI/CD](../practices/cicd.md).

## UI velocity

Tailwind + DaisyUI keeps styling to utility classes (no custom CSS); see
[`tailwind.config.js`](../../rad-ui/webapp/tailwind.config.js).
Reusable component templates live in
[`src/templates/`](../../rad-ui/webapp/src/templates).
i18next is wired in via
[`next-i18next.config.js`](../../rad-ui/webapp/next-i18next.config.js)
so all strings are translation keys.

## AI-assisted development

[`CLAUDE.md`](../../CLAUDE.md) plus the skill files under
[`.agents/skills/`](../../.agents/skills) and
[`.jules/`](../../.jules) load project context automatically — see
[AI](../capabilities/ai.md).

## Self-service deployment

The [`rad-launcher`](../../rad-launcher) CLI and the webapp portal both
expose the same module deployment lifecycle — see [Platform
Engineering](../practices/platform_engineering.md).

## Documentation as a product

The role-based guides, workflows, and feature docs that ship with the
repo are the subject of [Education](./education.md).

## See also

- [AI](../capabilities/ai.md) — assistant configuration.
- [Platform Engineering](../practices/platform_engineering.md) —
  self-service surface.
- [Education](./education.md) — onboarding and learning materials.
