# Enhanced Developer Productivity

> **Scope.** Canonical home for the developer-facing surface — the application catalogue, scaffolding, the UIMeta-driven configuration UI, and the quantified business case for self-service infrastructure. The architectural intent of the IDP is in [practices/platform_engineering.md](../practices/platform_engineering.md); the agent-driven enablement is in [outcomes/education_enablement.md](education_enablement.md).

## What this repo uniquely brings to developer productivity

### 1. Application catalogue (canonical)

A growing library of pre-built application modules ships with the repo. Each exists in CloudRun and GKE flavours with a shared Common module:

| Category | Modules |
|---|---|
| CMS / web | `Wordpress_*`, `Ghost_*`, `Wikijs_*`, `Strapi_*`, `Directus_*` |
| ERP / business | `Odoo_*`, `Cyclos_*` |
| Education | `Moodle_*` |
| Healthcare | `OpenEMR_*` |
| Legal | `OpenClaw_*` |
| Workflow / automation | `N8N_*`, `Activepieces_*`, `Kestra_*`, `NodeRED_*` |
| AI / LLM | `Ollama_*`, `Flowise_*`, `RAGFlow_*`, `N8N_AI_*` (see [capabilities/ai.md](../capabilities/ai.md)) |
| Search | `Elasticsearch_GKE` |
| Frameworks | `Django_*` |
| Reference | `Sample_*` |

A developer who needs Django on GCP doesn't write Terraform — they apply `modules/Django_CloudRun` (or `_GKE`) and supply tfvars.

### 2. Self-service scaffolding (canonical)

- **`scripts/create_modules.sh`** — generates a new CloudRun + GKE + Common triple in one command, with all wiring, file structure, and variable mirroring already correct.
- **Reference modules** — `modules/Sample_CloudRun`, `modules/Sample_GKE` are deployable starting points.

### 3. UI-driven configuration (canonical)

`UIMeta` tags on every Application Module variable (`{{UIMeta group=N order=M}}`) drive a generated configuration UI. Variables auto-organise into groups (0–22 for Cloud Run, 0–21 for GKE) with deterministic ordering. Tooling: `update_uimeta.py`, `VARIABLE_GROUPING_RECOMMENDATIONS.md`, `.agent/VARIABLE_GROUPING_UPDATE.md`. Convention details canonical in [practices/platform_engineering.md](../practices/platform_engineering.md) §3.

### 4. Quantified productivity gains (canonical)

Per `BUSINESS_CASE.md`:

| Metric | Manual | This repo | Improvement |
|---|---|---|---|
| Setup time per app | 3–5 days | <2 hours | ~95% faster |
| Cost per setup | $3,200 | $200 | $3,000 saved |
| Maintenance for 10-app fleet | 40 h, $4,000 | 2 h, $200 | 95% reduction |

Full quantification: `BUSINESS_CASE.md`, `IAC_AUTOMATION_BUSINESS_CASE.md`. Cost-tier specifics in [practices/finops.md](../practices/finops.md).

### 5. Convention-over-configuration

Every Application Module follows the same shape (5–6 files, mirrored variables, standard wiring) so a developer who learns one learns them all. Convention details in [practices/platform_engineering.md](../practices/platform_engineering.md) §3.

### 6. Single-flag opinionated defaults

The Foundation Modules pre-integrate everything an app needs — `enable_iap = true`, `enable_cdn = true`, `enable_binary_authorization = true`, `enable_vpc_sc = true`, `enable_pod_disruption_budget = true`. Each flag wires in a substantial cross-cutting capability covered in its canonical topic ([practices/devsecops.md](../practices/devsecops.md), [capabilities/networking.md](../capabilities/networking.md), etc.).

### 7. Fast feedback loop

- `tofu fmt` / `tofu validate` for static checks.
- Cloud Build pipelines for one-trigger deploys (canonical in [practices/cicd.md](../practices/cicd.md)).
- Integration tests in `tests/` for regression coverage.

## Cross-references

- [practices/platform_engineering.md](../practices/platform_engineering.md) — IDP architecture, conventions, golden paths (the engineering view of self-service)
- [outcomes/education_enablement.md](education_enablement.md) — agent workflows, skill guides, certification material (the learning view)
- [practices/cicd.md](../practices/cicd.md) — pipeline that delivers the developer experience
- [capabilities/ai.md](../capabilities/ai.md) — AI subset of the catalogue
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — catalogue as marketplace surface
- [outcomes/modernisation.md](modernisation.md) — catalogue as modernisation target
