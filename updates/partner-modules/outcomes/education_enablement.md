# Education & Enablement

> **Scope.** Canonical home for the learning material in this repo — Google Cloud certification tracks, lab walkthroughs, deep-dive analyses, role-based workflow docs, and structured agent skill guides. The architecture they teach is canonical in [practices/platform_engineering.md](../practices/platform_engineering.md); the developer-facing self-service surface is in [outcomes/developer_productivity.md](developer_productivity.md).

## What this repo uniquely brings to education & enablement

### 1. Google Cloud certification coverage (canonical)

Five complete certification tracks ship in the repo, each with a Configuration Guide plus per-section Exploration Guides:

| Cert | Files |
|---|---|
| ACE — Associate Cloud Engineer | `ACE_Configuration_Guide.md`, `ACE_Section_1..4_Exploration_Guide.md` |
| PCA — Professional Cloud Architect | `PCA_Certification_Guide.md`, `PCA_Configuration_Guide.md`, `PCA_Section_1..6_Exploration_Guide.md` |
| PCD — Professional Cloud Developer | `PCD_Configuration_Guide.md`, `PCD_Section_1..4_Exploration_Guide.md` |
| PDE — Professional Data Engineer | `PDE_Certification_Guide.md`, `PDE_Section_1..5_Exploration_Guide.md` |
| PSE — Professional Security Engineer | `PSE_Certification_Guide.md`, `PSE_Section_1..5_Exploration_Guide.md` |

These tie certification curriculum directly to working code in this repo — learners explore concepts hands-on against real modules.

### 2. Hands-on lab guide (canonical)

`modules/VMware_Engine/LAB_GUIDE.md` — a 2–3 hour walkthrough that documents what Terraform automates vs what the learner does manually, with timing estimates and prerequisites. A model for IaC-paired hands-on labs. Modernisation context in [outcomes/modernisation.md](modernisation.md).

### 3. Deep-dive architecture analyses

For learners (or AI assistants) who need *why*, not just *what*:

- `App_CloudRun_Analysis.md` — Cloud Run Foundation deep-dive
- `App_GKE_Deep_Dive_Analysis.md` — GKE Foundation deep-dive
- `Services_GCP_Deep_Dive_Analysis.md` — Platform deep-dive
- `REFACTORING_ANALYSIS.md` — refactoring rationale
- `MULTI_CLUSTER_GUIDE.md` — multi-cluster topology
- `IAP_IMPLEMENTATION_PLAN.md` — IAP design
- `CUSTOM_DOMAIN_CDN_FEATURE.md` — domain + CDN design
- `VARIABLE_GROUPING_RECOMMENDATIONS.md` — variable taxonomy

### 4. Role-based workflow documentation (canonical)

`docs/workflows/` — `getting-started.md`, `admin.md`, `partner.md`, `support.md`, `finance.md`, `user.md`, `agent.md`. Multi-tenancy / segregation-of-duties context in [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) and [outcomes/compliance_governance.md](compliance_governance.md).

### 5. Agent-native enablement (canonical)

The repo is structured so AI coding assistants can self-onboard:

- **`CLAUDE.md`** — top-level Claude Code project guidance.
- **`AGENTS.md`** — eight slash-command agent workflows: `/global`, `/platform`, `/foundation`, `/application`, `/troubleshoot`, `/maintain`, `/performance`, `/security`.
- **`.agent/skills/`** — layered skill guides:
  - `repository-context/SKILL.md` — governance and naming conventions
  - `application-module-context/SKILL.md` — Application Module patterns
  - `foundation-module-context/SKILL.md` — App_CloudRun / App_GKE internals
  - `platform-module-context/SKILL.md` — Services_GCP internals
- **`SKILLS.md`** — skill index and meta-documentation.

These are equally useful for human developers onboarding the codebase.

### 6. Decision and design records

`.agent/` contains the implementation history that doubles as case-study material: `VPC_SC_PHASE1_COMPLETE.md` … `VPC_SC_PHASE4_COMPLETE.md`, `VPC_SERVICE_CONTROLS_PLAN.md`, `VPC_SC_QUICK_START.md`, `VPC_SC_TESTING_GUIDE.md`, `VPA_IMPLEMENTATION.md`, `CLOUDRUN_LOADBALANCER_REMOVAL.md`, `GKE_DEPLOYMENT_FIXES.md`, `VARIABLE_RENAME_deploy_application.md`, `SECTION_RENUMBERING_App_GKE.md`, `VARIABLE_GROUPING_UPDATE.md`.

### 7. Reference implementations (cross-ref)

`modules/Sample_CloudRun`, `modules/Sample_GKE`, `examples/bank-of-anthos-multi-cluster/` — see [outcomes/developer_productivity.md](developer_productivity.md) and [capabilities/networking.md](../capabilities/networking.md).

### 8. Business / partner enablement materials

- `BUSINESS_CASE.md`, `IAC_AUTOMATION_BUSINESS_CASE.md` — quantified ROI (cross-ref to [outcomes/developer_productivity.md](developer_productivity.md) §4 for the headline numbers).
- `ITEMIZED_PROPOSAL.md`, `PROPOSAL_DRAFT.md` — partner-facing proposal templates.
- `articles/cyclos-business-overview.md`, `cyclos-technical-deep-dive.md` — published case study.

### 9. Troubleshooting as enablement (cross-ref)

`AGENTS.md` `/troubleshoot` Known Issue Patterns table is itself a teaching resource — symptoms mapped to root causes builds diagnostic intuition. Canonical in [practices/sre.md](../practices/sre.md) §3.

## Cross-references

- [practices/platform_engineering.md](../practices/platform_engineering.md) — architecture being taught
- [outcomes/developer_productivity.md](developer_productivity.md) — self-service surface; quantified ROI
- [outcomes/modernisation.md](modernisation.md) — VMware Engine lab context
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — persona docs as segregation evidence
- [outcomes/compliance_governance.md](compliance_governance.md) — `/security` workflow and audit framing
- [practices/sre.md](../practices/sre.md) — `/troubleshoot` as enablement
