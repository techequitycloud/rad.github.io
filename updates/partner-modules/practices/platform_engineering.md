# Platform Engineering

> **Scope.** Canonical home for the architectural intent of the repo as an Internal Developer Platform (IDP): the four-tier module pattern, golden paths, the self-service surface, and the operating model. The IaC mechanics underneath (state, OpenTofu, drift) are in [practices/gitops_iac.md](gitops_iac.md); the developer-facing experience is in [outcomes/developer_productivity.md](../outcomes/developer_productivity.md).

## What this repo uniquely brings to Platform Engineering

### 1. The four-tier IDP architecture (canonical)

Per `CLAUDE.md`:

```
Platform (Services_GCP)
  └── Foundation (App_CloudRun / App_GKE)
        └── Application (<App>_CloudRun / <App>_GKE)
              └── Common (<App>_Common)
```

| Tier | Module(s) | Owner | Purpose |
|---|---|---|---|
| Platform | `modules/Services_GCP` | Platform team | Shared VPC, Cloud SQL, Redis, Filestore, GKE Autopilot, Artifact Registry, Binary Authorization, CMEK, VPC-SC, WIF |
| Foundation | `modules/App_CloudRun`, `modules/App_GKE` | Platform team | Deployment engine; encapsulates all cross-cutting concerns |
| Common | `modules/<App>_Common` | Joint | App-specific config invariant across runtimes |
| Application | `modules/<App>_CloudRun`, `modules/<App>_GKE` | App team | Thin (5–6 file) wrappers wiring Common → Foundation |

Each tier has a clear contract; Application Modules don't use symlinks — `variables.tf` mirrors the Foundation module's variables exactly.

### 2. Golden paths

The repo ships paved roads for the most common archetypes:

- Stateless web service (Cloud Run) with one-flag IAP and CDN
- Stateful / long-running workload (GKE Autopilot) with PDBs, Gateway API, NetworkPolicy
- AI/inference workloads (Ollama, Flowise, RAGFlow, N8N AI) — see [capabilities/ai.md](../capabilities/ai.md)
- A pre-built application catalogue (canonical in [outcomes/developer_productivity.md](../outcomes/developer_productivity.md))

### 3. Convention enforcement (canonical)

- **Naming** — `app<name><tenant><id>` for GCP resources; PascalCase module dirs; snake_case files.
- **Variable mirroring** — Application Module `variables.tf` must mirror the Foundation Module's. Tooling (`update_uimeta.py`, `sync_gke_vars.py`, `update_cloudrun.py`, `update_gke.py`) keeps them in lock-step.
- **`UIMeta` tags** — `{{UIMeta group=N order=M}}` on every Application Module variable drives a generated configuration UI (groups 0–22 for Cloud Run, 0–21 for GKE).
- **Mandatory wiring** — `module_secret_env_vars = module.<app>_app.secret_ids`; `container_image = ""` for custom builds; `.secret_id` (not `.id`) in Common outputs.

### 4. Centralised governance, decentralised consumption

Cross-cutting capabilities (Binary Auth, VPC-SC, IAP, CMEK) are defined once in Platform/Foundation; app teams inherit them automatically. `BUSINESS_CASE.md` §3.B quantifies this as a 95% reduction in maintenance effort across a 10-app portfolio.

### 5. Platform reliability and operability

- **`/platform` workflow** (`AGENTS.md`) — concerns specific to platform-tier work: dependency chain, non-destructive change discipline, output management, VPA, VPC-SC dry-run rollout.
- **Skill guides** — `.agent/skills/platform-module-context/SKILL.md`, `foundation-module-context/SKILL.md`, `application-module-context/SKILL.md`, `repository-context/SKILL.md`.
- **Sample-driven testing** — `modules/Sample_CloudRun`, `modules/Sample_GKE` validate Foundation changes before they propagate.

## Cross-references

- [practices/gitops_iac.md](gitops_iac.md) — OpenTofu, four-tier state isolation, drift detection
- [outcomes/developer_productivity.md](../outcomes/developer_productivity.md) — application catalogue, scaffolding, self-service onboarding (developer-facing view of the IDP)
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — operating model for multi-tenant deployments
- [practices/cicd.md](cicd.md) — pipeline that delivers the platform
- [outcomes/education_enablement.md](../outcomes/education_enablement.md) — agent workflows and skill guides
