---
id: idp
title: IDP
---

# Platform Engineering

This repository is a platform-engineering deliverable: a curated catalog of opinionated, self-service golden paths exposed through both a CLI and a web UI. It functions as an Internal Developer Platform (IDP) — providing the four-tier module pattern, standardised scaffolding, a self-service surface, and the operating model that lets application teams deploy and manage production workloads without deep infrastructure expertise. The IaC mechanics (state, OpenTofu, drift) are in [GitOps & IaC](./gitops-iac.md).

## The four-tier IDP architecture

The platform is structured as four tiers with clear contracts between them:

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

Each tier has a clear contract: Application Modules do not use symlinks — `variables.tf` mirrors the Foundation module's variables exactly. Each module also owns every resource it provisions and produces its own state.

## Module catalog and golden paths

The platform provides paved roads for the most common archetypes:

| Module | Golden path |
|---|---|
| `Istio_GKE` | Open-source Istio on GKE Standard with full observability |
| `Bank_GKE` | Cloud Service Mesh + Bank of Anthos on a single cluster |
| `MC_Bank_GKE` | Fleet-wide CSM + MCI/MCS across up to 4 GKE clusters |
| `AKS_GKE` | Azure AKS attached as a GKE Attached Cluster via Fleet |
| `EKS_GKE` | AWS EKS attached as a GKE Attached Cluster via Fleet |

Beyond the GKE-based reference modules, a pre-built application catalogue (Django, WordPress, Odoo, Directus, Ghost, N8N, Flowise, RAGFlow, and others) provides stateless Cloud Run and stateful GKE golden paths. AI/inference workloads (Ollama, Flowise, RAGFlow, N8N AI) have dedicated golden paths with GPU support.

## A single deployment lifecycle

The same four actions — **create / update / delete / list** — work for every module through two surfaces:

- The **RAD Lab Launcher CLI** (`rad-launcher/radlab.py`)
- The **RAD platform UI** invoking Cloud Build (`rad-ui/automation/`)

Both surfaces consume the same Terraform module source. See [CI/CD](./cicd.md) for the pipeline and [GitOps & IaC](./gitops-iac.md) for the developer experience.

## Convention enforcement

Consistency across 14+ supported applications is maintained through tooling and explicit conventions:

- **Naming** — `app<name><tenant><id>` for GCP resources; PascalCase module directories; snake_case files.
- **Variable mirroring** — Application Module `variables.tf` must mirror the Foundation Module's. Tooling (`update_uimeta.py`, `sync_gke_vars.py`, `update_cloudrun.py`, `update_gke.py`) keeps them in lock-step.
- **`UIMeta` tags** — `{{UIMeta group=N order=M}}` on every Application Module variable drives a generated configuration UI (groups 0–22 for Cloud Run, 0–21 for GKE). The UI is generated from each module's variables file via UIMeta — the same modules deploy through the RAD platform UI without opening a terminal.
- **Mandatory wiring** — `module_secret_env_vars = module.<app>.secret_ids`; `container_image = ""` for custom builds; `.secret_id` (not `.id`) in Common outputs.
- **Standard outputs** — every module must declare `deployment_id`, `project_id`, `cluster_credentials_cmd`, and `external_ip`.

## Centralised governance, decentralised consumption

Cross-cutting capabilities (Binary Authorization, VPC-SC, IAP, CMEK) are defined once in Platform/Foundation; application teams inherit them automatically. `BUSINESS_CASE.md` §3.B quantifies this as a 95% reduction in maintenance effort across a 10-app portfolio.

## Platform reliability and SLOs

- **`/platform` workflow** (`AGENTS.md`) — concerns specific to platform-tier work: dependency chain, non-destructive change discipline, output management, VPA, VPC-SC dry-run rollout.
- **Sample-driven testing** — `modules/Sample_CloudRun` and `modules/Sample_GKE` validate Foundation changes before they propagate.
- **Platform availability target** — the platform tier (`Services_GCP`) targets 99.9% monthly uptime for shared services (Cloud SQL, Redis, GKE control plane). Foundation-tier module changes must not break any currently-deploying Application Module; validate against Sample modules before merging.
- **Platform on-call** — the platform team maintains a rotation covering Foundation and Platform tier incidents. Application-tier incidents are owned by the respective application team with escalation to the platform team for infrastructure-layer root causes. See [SRE](./sre.md) for the on-call model.

## Platform observability

The platform team should observe the platform's own health separately from the workloads it deploys. Key signals:

- **Cloud Build pipeline success rate and duration** — a rising `tofu apply` duration trend signals provider API latency or growing module complexity before it becomes a user-visible failure.
- **Purge frequency** — a rising number of purge pipeline invocations is a leading indicator of destroy reliability degrading.
- **Provider cache hit rate** — cache misses on every build indicate the GCS cache key is being invalidated more often than expected, adding avoidable build time.

A Cloud Monitoring dashboard querying Cloud Build log-based metrics covers the first two; the third can be tracked by adding a log entry in the cache-restore step.

## Contribution and validation guardrails

The following checks are the definition-of-ready before a new module enters the catalog:

1. `tofu validate` and `tofu fmt -check` pass with no warnings.
2. All required outputs (`deployment_id`, `project_id`, `cluster_credentials_cmd`) are declared.
3. `variables.tf` carries `credit_cost`, `require_credit_purchases`, and `enable_purge` with correct `{{UIMeta}}` annotations.
4. A `README.md` and a long-form `<Module_Name>.md` exist.
5. `provider-auth.tf` uses the impersonation pattern; no service account key files are referenced.

## Deprecation and migration policy

With 14 supported applications and two Foundation variants (CloudRun, GKE), breaking changes require a structured migration path:

- **Deprecation notice** — deprecated variables or outputs are annotated with `# DEPRECATED: <reason>. Remove after <date>.` in `variables.tf` and listed in `CHANGELOG.md`. A minimum 60-day deprecation window applies.
- **Migration guide** — each MAJOR version bump includes a `docs/migrations/vN-to-vN+1.md` file with a step-by-step migration checklist for each affected Application Module.
- **Automated sync tooling** — `update_cloudrun.py`, `update_gke.py`, and `sync_gke_vars.py` propagate non-breaking variable additions across all Application Modules automatically. Breaking changes require manual PR review per module.
- **Freeze window** — during the 14-day period after a MAJOR Foundation release, no further breaking changes are merged to Foundation or Platform tiers; this gives application teams a stable migration window.

## Multi-region strategy

The default deployment is single-region (`var.region`). For applications requiring geo-redundancy or lower global latency:

- **Cloud Run multi-region** — deploy the same Application Module to two or more regions with `_DEPLOYMENT_ID` suffixed by region. A Global External Application Load Balancer with geo-routing is provisioned outside the module scope.
- **GKE multi-cluster** — GKE Autopilot clusters are regional; a second cluster in a different region uses the same Application Module with a different `region` variable. Multi-cluster service mesh (Fleet) and Gateway API multi-cluster routing patterns are documented in the disaster recovery capability documentation.
- **Shared services** — Cloud SQL and Filestore NFS in `Services_GCP` are single-region. For cross-region HA, use Cloud SQL with a read replica in the secondary region or Cloud Spanner for globally consistent data.
- **State isolation** — each regional deployment uses its own `_DEPLOYMENT_BUCKET_ID`; cross-region deployments are independent state machines with no shared lock contention.

## Developer portal and onboarding path

- **Service catalog** — `scripts/create_modules.sh` and the pre-built application catalogue form the core of the self-service surface. New teams should start here rather than authoring modules from scratch.
- **UIMeta-driven UI** — `update_uimeta.py` extracts all UIMeta-tagged variables into a structured JSON schema. This schema can be consumed by an internal portal (e.g. Backstage, Port, or a custom Cloud Run app) to render a deployment form without requiring Terraform knowledge.
- **Documentation hub** — the `docs/` tree (practices, capabilities, outcomes) is the canonical reference. A Backstage TechDocs integration or static site build from this directory provides searchable, versioned documentation for all platform consumers.
- **Onboarding checklist** — new application teams should: (1) run `scripts/create_modules.sh` to scaffold their module triple; (2) review `modules/Sample_CloudRun` as a reference implementation; (3) complete the `/application` workflow in `AGENTS.md`; (4) deploy to a non-production project using `modules/Sample_CloudRun` substitutions before cutting over.

## Workflow surface for AI assistants

`AGENTS.md` defines workflow modes (`/global`, `/istio`, `/bank`, `/multicluster`, `/attached`, `/troubleshoot`, `/maintain`, `/security`) that prime an AI agent or new engineer with module-specific context. This is platform engineering applied to the AI-pair-programming surface itself.

## A tiered path from learning to production

- **Lab** — `scripts/gcp-istio-traffic/`, `scripts/gcp-istio-security/`, `scripts/gcp-cr-mesh/`, `scripts/gcp-m2c-vm/` for hands-on bash exercises (preview / create / delete modes).
- **Demo** — `modules/Istio_GKE`, `modules/Bank_GKE` for opinionated single-cluster reference deployments.
- **Multi-cluster reference** — `modules/MC_Bank_GKE` for fleet-wide CSM + MCI/MCS.
- **Multi-cloud** — `modules/AKS_GKE`, `modules/EKS_GKE` for fleet management of non-GCP clusters.

## Cross-references

- [GitOps & IaC](./gitops-iac.md) — OpenTofu, four-tier state isolation, drift detection, module versioning, developer self-service
- [CI/CD](./cicd.md) — pipeline that delivers the platform
- [SRE](./sre.md) — platform SLOs, on-call model, post-mortems
- [FinOps](./finops.md) — `app<name><tenant><id>` naming and per-tenant chargeback
- [DevSecOps](./devsecops.md) — per-tenant perimeter strategy
