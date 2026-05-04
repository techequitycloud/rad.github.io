# Platform Engineering

> **Scope.** Canonical home for the architectural intent of the repo as an Internal Developer Platform (IDP): the four-tier module pattern, golden paths, the self-service surface, and the operating model. The IaC mechanics underneath (state, OpenTofu, drift) are in [practices/gitops_iac.md](gitops_iac.md); the developer-facing experience is in [outcomes/developer_productivity.md](../outcomes/developer_productivity.md).

> **Last reviewed:** 2026-05-04

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

### 5. Platform reliability, operability, and SLOs

- **`/platform` workflow** (`AGENTS.md`) — concerns specific to platform-tier work: dependency chain, non-destructive change discipline, output management, VPA, VPC-SC dry-run rollout.
- **Skill guides** — `.agent/skills/platform-module-context/SKILL.md`, `foundation-module-context/SKILL.md`, `application-module-context/SKILL.md`, `repository-context/SKILL.md`.
- **Sample-driven testing** — `modules/Sample_CloudRun`, `modules/Sample_GKE` validate Foundation changes before they propagate.
- **Platform availability target** — the platform tier (Services_GCP) targets 99.9% monthly uptime for shared services (Cloud SQL, Redis, GKE control plane). Foundation-tier module changes must not break any currently-deploying Application Module; validate against Sample modules before merging. Breaches of the availability target trigger a post-mortem per [practices/sre.md](sre.md) §6.
- **Platform on-call** — the platform team maintains a rotation covering Foundation and Platform tier incidents. Application-tier incidents are owned by the respective app team with escalation to the platform team for infrastructure-layer root causes. See [practices/sre.md](sre.md) §7.

### 6. Deprecation and migration policy

With 14 supported applications and two Foundation variants (CloudRun, GKE), breaking changes require a structured migration path:

- **Deprecation notice** — deprecated variables or outputs are annotated with `# DEPRECATED: <reason>. Remove after <date>.` in `variables.tf` and listed in `CHANGELOG.md`. A minimum 60-day deprecation window applies.
- **Migration guide** — each MAJOR version bump (see [practices/gitops_iac.md](gitops_iac.md) §7) includes a `docs/migrations/vN-to-vN+1.md` file with a step-by-step migration checklist for each affected Application Module.
- **Automated sync tooling** — `update_cloudrun.py`, `update_gke.py`, `sync_gke_vars.py` propagate non-breaking variable additions across all Application Modules automatically. Breaking changes (variable renames, type changes, removed outputs) require manual PR review per module.
- **Freeze window** — during the 14-day period after a MAJOR Foundation release, no further breaking changes are merged to Foundation or Platform tiers; this gives app teams a stable migration window.

### 7. Multi-region strategy

The default deployment is single-region (GCP region set via `var.region`). For applications requiring geo-redundancy or lower global latency:

- **Cloud Run multi-region** — deploy the same Application Module to two or more regions with `_DEPLOYMENT_ID` suffixed by region (e.g. `myapp-us-central1`, `myapp-europe-west1`). A Global External Application Load Balancer with geo-routing is provisioned outside the module scope (see [capabilities/networking.md](../capabilities/networking.md)).
- **GKE multi-cluster** — GKE Autopilot clusters are regional; a second cluster in a different region uses the same Application Module with a different `region` variable. Multi-cluster service mesh (Fleet) and Gateway API multi-cluster routing patterns are documented in [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md).
- **Shared services** — Cloud SQL and Filestore NFS in `Services_GCP` are single-region. For cross-region HA, use Cloud SQL with a read replica in the secondary region or Cloud Spanner for globally consistent data; Filestore HA (`ENTERPRISE` tier) supports zonal failover within a region.
- **State isolation** — each regional deployment uses its own `_DEPLOYMENT_BUCKET_ID`; cross-region deployments are independent state machines with no shared lock contention.

### 8. Developer portal and onboarding path

The UIMeta tag system (`{{UIMeta group=N order=M}}`) is designed to drive an auto-generated configuration UI, but the path from raw variables to a working developer portal involves several layers:

- **Service catalog** — the `scripts/create_modules.sh` scaffolder and the pre-built application catalogue (Django, Wordpress, Odoo, etc.) form the core of the self-service surface. New teams should start here rather than authoring modules from scratch.
- **UIMeta-driven UI** — `update_uimeta.py` extracts all UIMeta-tagged variables into a structured JSON schema. This schema can be consumed by an internal portal (e.g. Backstage, Port, or a custom Cloud Run app) to render a deployment form without requiring Terraform knowledge.
- **Documentation hub** — the `docs/` tree (practices, capabilities, outcomes) is the canonical reference. A Backstage TechDocs integration or MkDocs site build from this directory provides searchable, versioned documentation for all platform consumers.
- **Onboarding checklist** — new application teams should: (1) run `scripts/create_modules.sh` to scaffold their module triple; (2) review `modules/Sample_CloudRun` as a reference implementation; (3) complete the `/application` workflow in `AGENTS.md`; (4) deploy to a non-production project using `modules/Sample_CloudRun` substitutions before cutting over.

## Cross-references

- [practices/gitops_iac.md](gitops_iac.md) — OpenTofu, four-tier state isolation, drift detection, module versioning
- [outcomes/developer_productivity.md](../outcomes/developer_productivity.md) — application catalogue, scaffolding, self-service onboarding (developer-facing view of the IDP)
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — operating model for multi-tenant deployments
- [practices/cicd.md](cicd.md) — pipeline that delivers the platform
- [practices/sre.md](sre.md) — platform SLOs, on-call model, post-mortems
- [outcomes/education_enablement.md](../outcomes/education_enablement.md) — agent workflows and skill guides
- [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) — multi-cluster HA and cross-region DR patterns
