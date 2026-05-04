# Enhanced Developer Productivity

RAD optimises for fast inner-loop feedback and self-service so developers
spend time on product, not platform mechanics. A new contributor can have
a running local stack from a single setup script and receive typecheck
and test feedback in seconds.

## One-command local setup

- [`scripts/01-setup-cli.sh`](../../scripts/01-setup-cli.sh) —
  bootstraps the `rad-launcher` CLI environment.
- [`scripts/02-setup-ui.sh`](../../scripts/02-setup-ui.sh) — bootstraps
  the webapp environment.
- [`rad-ui/webapp/setup_local_dev.sh`](../../rad-ui/webapp/setup_local_dev.sh)
  — configures Application Default Credentials against the shared
  development GCP project (`tec-rad-ui-2b65`), clears stale build
  artefacts, and starts `pnpm dev`.
- [`rad-ui/webapp/gen_local_config.sh`](../../rad-ui/webapp/gen_local_config.sh)
  — reads live Terraform outputs and Firebase SDK config to generate
  `.env.development.local` and `.env.production.local`, eliminating
  manual environment wiring. Requires `terraform`, `gcloud`, `firebase`,
  and `jq`.

> **Note:** local development connects to the shared GCP project via
> Application Default Credentials rather than local Firebase emulators.
> Firebase Emulator Suite (Firestore, Auth) is not currently configured;
> this is a known gap for offline or isolated development workflows.

## Fast inner loop — webapp

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

## Fast inner loop — Python CLI

For `rad-launcher/` work:

```bash
python3 -m pytest tests/           # full test suite
python3 -m pytest tests/ -k <name> # single test by name
```

[`rad-launcher/tofu_installer.py`](../../rad-launcher/tofu_installer.py)
can be exercised independently; see the launcher's own README for module
development iteration.

## UI velocity

Tailwind + DaisyUI keeps styling to utility classes (no custom CSS); see
[`tailwind.config.js`](../../rad-ui/webapp/tailwind.config.js).
[`src/templates/`](../../rad-ui/webapp/src/templates) provides three
page-layout shell templates (`Authenticated.tsx`, `Main.tsx`,
`Unauthenticated.tsx`) that new pages should extend.
i18next is wired in via
[`next-i18next.config.js`](../../rad-ui/webapp/next-i18next.config.js)
so all strings are translation keys.

## AI-assisted development

[`CLAUDE.md`](../../CLAUDE.md) is loaded automatically at the start of
every Claude Code session, giving AI contributors immediate knowledge of
the command set, architecture, auth flow, and conventions — no manual
briefing required. Domain-specific skill files for performance, security,
and UX work are loaded on top for focused tasks. The result: AI-generated
code matches repo conventions from the first commit, and AI-driven
changes flow through the same CI gates as human PRs. See
[AI](../capabilities/ai.md) for the full setup.

## Platform developer tooling

Contributors working on the platform itself have additional tools:

- [`tools/service-catalog.py`](../../tools/service-catalog.py) — manages
  the module catalogue; use this to register new deployment modules so
  they appear in the webapp and `rad-launcher`.
- [`tools/tfdoc.py`](../../tools/tfdoc.py) — generates and validates
  Terraform module documentation.
- [`tools/check_documentation.py`](../../tools/check_documentation.py)
  — validates that every Terraform module has an up-to-date README with
  described and alphabetically ordered variables and outputs.

## Test coverage expectations

The Jest suite under
[`rad-ui/webapp/__tests__/`](../../rad-ui/webapp/__tests__) covers health
endpoints, admin cache stats, cost analysis, and GitHub integration. New
API routes and utility modules should include unit tests; there is
currently no enforced coverage threshold. End-to-end testing uses
Playwright (`verify_restore.py`) for the restore flow — see
[Disaster Recovery](../capabilities/disaster_recovery.md).

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
