# Enhanced Developer Productivity

The platform optimises for fast inner-loop feedback and self-service infrastructure so developers spend time on product rather than platform mechanics. A growing application catalogue, scaffolding tools, UI-driven configuration, and one-command local setup all reduce the time from idea to running deployment.

## Application catalogue

A growing library of pre-built application modules ships with the platform, each available in Cloud Run and GKE flavours with a shared Common module:

| Category | Modules |
|---|---|
| CMS / web | `Wordpress_*`, `Ghost_*`, `Wikijs_*`, `Strapi_*`, `Directus_*` |
| ERP / business | `Odoo_*`, `Cyclos_*` |
| Education | `Moodle_*` |
| Healthcare | `OpenEMR_*` |
| Legal | `OpenClaw_*` |
| Workflow / automation | `N8N_*`, `Activepieces_*`, `Kestra_*`, `NodeRED_*` |
| AI / LLM | `Ollama_*`, `Flowise_*`, `RAGFlow_*`, `N8N_AI_*` |
| Search | `Elasticsearch_GKE` |
| Frameworks | `Django_*` |
| Reference | `Sample_*` |

A developer who needs Django on GCP doesn't write Terraform — they apply `modules/Django_CloudRun` (or `_GKE`) and supply tfvars.

## Self-service scaffolding

`scripts/create_modules.sh` generates a new Cloud Run + GKE + Common triple in one command, with all wiring, file structure, and variable mirroring already correct. `modules/Sample_CloudRun` and `modules/Sample_GKE` are deployable starting points for new modules.

## UI-driven configuration

`UIMeta` tags on every Application Module variable (`{{UIMeta group=N order=M}}`) drive a generated configuration UI. Variables auto-organise into groups with deterministic ordering, keeping the self-service portal in sync with the Terraform variables without manual maintenance.

## Convention-over-configuration

Every Application Module follows the same shape (5–6 files, mirrored variables, standard wiring) so a developer who learns one learns them all. Single-flag opinionated defaults pre-integrate everything an app needs — `enable_iap = true`, `enable_cdn = true`, `enable_binary_authorization = true`, `enable_vpc_sc = true`, `enable_pod_disruption_budget = true` — each wiring in a substantial cross-cutting capability without additional configuration.

## One-command local setup

New contributors can have a running local stack from a single setup script:

- `scripts/01-setup-cli.sh` — bootstraps the `rad-launcher` CLI environment.
- `scripts/02-setup-ui.sh` — bootstraps the webapp environment.
- `rad-ui/webapp/setup_local_dev.sh` — configures Application Default Credentials and starts `pnpm dev`.
- `rad-ui/webapp/gen_local_config.sh` — reads live Terraform outputs and Firebase SDK config to generate `.env.development.local` and `.env.production.local`, eliminating manual environment wiring.

## Fast inner loop

The `pnpm` scripts cover the full feedback cycle for webapp development:

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server with hot reload (`localhost:3000`) |
| `pnpm test` | Jest suite |
| `pnpm test-interactive` | Jest watch mode |
| `pnpm build-types` | `tsc --noEmit` strict typecheck |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm build` | Production build with full type check |

Pre-commit gates use `lint-staged` so formatting and linting run only on changed files. For `rad-launcher/` work, `python3 -m pytest tests/` runs the full suite. Tailwind + DaisyUI keeps styling to utility classes; three page-layout shell templates (`Authenticated.tsx`, `Main.tsx`, `Unauthenticated.tsx`) provide consistent starting points for new pages.

## AI-assisted development

`CLAUDE.md` is loaded automatically at the start of every Claude Code session, giving AI contributors immediate knowledge of the command set, architecture, auth flow, and conventions. Domain-specific skill files for performance, security, and UX work are loaded on top for focused tasks. The result is that AI-generated code matches repo conventions from the first commit and flows through the same CI gates as human PRs.

## Platform developer tooling

Contributors working on the platform have additional tools:

- `tools/service-catalog.py` — manages the module catalogue; registers new deployment modules so they appear in the webapp and `rad-launcher`.
- `tools/tfdoc.py` — generates and validates Terraform module documentation.
- `tools/check_documentation.py` — validates that every Terraform module has an up-to-date README with described and alphabetically ordered variables and outputs.
- `tools/check-license.py` — validates Apache 2.0 boilerplate headers on every contributed file.

## Test coverage

The Jest suite under `rad-ui/webapp/__tests__/` covers health endpoints, admin cache stats, cost analysis, and GitHub integration. New API routes and utility modules should include unit tests. End-to-end testing uses Playwright (`verify_restore.py`) for the restore flow.

## Quantified productivity gains

| Metric | Manual | This platform | Improvement |
|---|---|---|---|
| Setup time per app | 3–5 days | <2 hours | ~95% faster |
| Cost per setup | $3,200 | $200 | $3,000 saved |
| Maintenance for 10-app fleet | 40 h, $4,000 | 2 h, $200 | 95% reduction |

## See also

- Platform Engineering practices — IDP architecture, conventions, and golden paths
- CI/CD practices — the pipeline that delivers the developer experience
- Skills Development outcome — agent workflows, certification material, and onboarding guides
- AI capability — AI assistant configuration and skill files
- Multitenancy & SaaS capability — catalogue as marketplace surface
- Modernization outcome — catalogue as modernisation target
- Cost Optimization outcome — cost-tier specifics and provisioning savings
