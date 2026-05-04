# Skills Development

The platform ships its own learning material so that a new team member — regardless of role — can go from account creation to first productive action using only resources in this repository. Role-based guides, workflow walkthroughs, Google Cloud certification tracks, deep-dive analyses, and AI-assistant onboarding all version with the code they describe.

## Google Cloud certification coverage

Five complete certification tracks ship with the platform, each with a Certification Guide plus per-section Exploration Guides that tie curriculum directly to working code:

| Certification | Materials |
|---|---|
| ACE — Associate Cloud Engineer | `ACE_Certification_Guide.md`, `ACE_Section_1..4_Exploration_Guide.md` |
| PCA — Professional Cloud Architect | `PCA_Certification_Guide.md`, `PCA_Configuration_Guide.md`, `PCA_Section_1..6_Exploration_Guide.md` |
| PCD — Professional Cloud Developer | `PCD_Configuration_Guide.md`, `PCD_Section_1..4_Exploration_Guide.md` |
| PDE — Professional Cloud DevOps Engineer | `PDE_Certification_Guide.md`, `PDE_Section_1..5_Exploration_Guide.md` |
| PSE — Professional Security Engineer | `PSE_Certification_Guide.md`, `PSE_Section_1..5_Exploration_Guide.md` |

Learners explore certification concepts hands-on against real deployed modules, rather than studying abstract documentation.

## Role-based guides and workflow walkthroughs

Six role-based guides under `docs/guides/` — one per role (`admin`, `agent`, `finance`, `partner`, `support`, `user`) — cover everything a new team member needs to be productive in their role. The agent guide ships with a companion video and audio.

`docs/workflows/` provides task-oriented flow documentation: `getting-started.md`, `using-rad.md`, and per-role workflow guides (`admin.md`, `agent.md`, `finance.md`, `partner.md`, `support.md`, `user.md`). This persona separation is also the structural evidence auditors look for as proof of segregation of duties — see the Compliance & Governance outcome.

## Feature documentation

`docs/features/` contains role-scoped feature documentation (`admins.md`, `agents.md`, `finance.md`, `partners.md`, `support.md`, `users.md`). A matching set is surfaced in-product and intentionally kept separate from the repo docs, so the in-product copy can be scoped to what end users need rather than what contributors need.

## Hands-on lab guide

`modules/VMware_Engine/LAB_GUIDE.md` is a 2–3 hour walkthrough that documents what Terraform automates versus what the learner does manually, with timing estimates and prerequisites. It serves as a model for IaC-paired hands-on lab design — see the Modernization outcome for context.

## Deep-dive architecture analyses

For learners — or AI assistants — who need the *why*, not just the *what*:

- `App_CloudRun_Analysis.md` — Cloud Run Foundation deep-dive
- `App_GKE_Deep_Dive_Analysis.md` — GKE Foundation deep-dive
- `Services_GCP_Deep_Dive_Analysis.md` — Platform deep-dive
- `REFACTORING_ANALYSIS.md` — refactoring rationale
- `MULTI_CLUSTER_GUIDE.md` — multi-cluster topology
- `IAP_IMPLEMENTATION_PLAN.md` — IAP design
- `CUSTOM_DOMAIN_CDN_FEATURE.md` — domain and CDN design
- `VARIABLE_GROUPING_RECOMMENDATIONS.md` — variable taxonomy

## Agent-native enablement

The repository is structured so AI coding assistants can self-onboard alongside human contributors:

- **`CLAUDE.md`** — top-level Claude Code project guidance, loaded automatically at the start of every session.
- **`AGENTS.md`** — eight slash-command agent workflows: `/global`, `/platform`, `/foundation`, `/application`, `/troubleshoot`, `/maintain`, `/performance`, `/security`.
- **`.agent/skills/`** — layered skill guides covering repository governance, Application Module patterns, and Foundation Module internals.
- **`SKILLS.md`** — skill index and meta-documentation.

The same skill files that guide AI contributors serve equally well for human developers onboarding the codebase.

## Implementation references

`docs/implementation/` carries deeper technical notes for contributors and reviewers:

| File | Topic |
|---|---|
| `PROJECT_COSTS_IMPLEMENTATION.md` | BigQuery cost API design |
| `MULTI_CURRENCY_PAYMENTS.md` | Normalised currency handling |
| `PAYMENT_CONFIG.md` | Provider routing and selection |
| `FLUTTERWAVE_PAYMENT_OPTIONS.md` | Flutterwave-specific options |
| `PAYMENT_PROVIDER_REVIEW.md` | Provider capability comparison |
| `TEST_PLAN.md` | Test strategy and coverage plan |

## Documentation quality enforcement

`tools/check_documentation.py` validates that every Terraform module directory has an up-to-date `README.md` with described and alphabetically ordered variables and outputs. This CI gate catches documentation drift before it reaches `main`, keeping infrastructure documentation in sync with the code it describes.

## Decision and design records

`.agent/` contains the implementation history that doubles as case-study material: `VPC_SC_PHASE1_COMPLETE.md` through `VPC_SC_PHASE4_COMPLETE.md`, `VPC_SERVICE_CONTROLS_PLAN.md`, `VPA_IMPLEMENTATION.md`, `CLOUDRUN_LOADBALANCER_REMOVAL.md`, `GKE_DEPLOYMENT_FIXES.md`, and more — each recording why a decision was made and what it resolved.

## Business and partner enablement materials

- `BUSINESS_CASE.md`, `IAC_AUTOMATION_BUSINESS_CASE.md` — quantified ROI.
- `ITEMIZED_PROPOSAL.md`, `PROPOSAL_DRAFT.md` — partner-facing proposal templates.
- `articles/cyclos-business-overview.md`, `cyclos-technical-deep-dive.md` — published case study.

## Troubleshooting as enablement

`AGENTS.md` `/troubleshoot` maps symptoms to root causes across all known failure modes. This Known Issue Patterns table is itself a teaching resource — diagnostic intuition is built by studying patterns, not just individual incidents. The full SRE runbook is in the SRE practices.

## Quantified enablement value

| Area | Without this platform | With this platform |
|---|---|---|
| Certification preparation | Separate training purchase; abstract study against documentation | Five certification tracks tied directly to running infrastructure; hands-on exploration in the RAD UI |
| Developer onboarding | Days reading unstructured docs and tribal knowledge | Layered agent skill guides, worked examples, and reference modules; new contributor productive within hours |
| Application setup time | 3–5 days manual provisioning | &lt;2 hours via self-service scaffold |
| Security knowledge transfer | Ad-hoc; depends on individual expertise | `/security` audit workflow encodes 30+ control checkpoints as executable documentation |

## See also

- Platform Engineering practices — the architecture being taught
- Developer Productivity outcome — self-service surface and quantified ROI
- Modernization outcome — VMware Engine lab context
- Compliance & Governance outcome — `/security` workflow and audit framing
- AI capability — assistant configuration and skill files
- SRE practices — `/troubleshoot` as enablement
