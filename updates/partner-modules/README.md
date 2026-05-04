# Topics Index

This directory maps the repository's modules and features to the industry topics it supports. Each file drills into the relevant code, modules, scripts, and documentation that demonstrate the topic, with file-level references back into the codebase.

The topics are grouped by the audience they serve:

- **Practices** — engineering disciplines and ways of working (the *how*).
- **Capabilities** — technical surfaces the platform exposes (the *what*).
- **Outcomes** — business and operational results the platform produces (the *why*).

---

## Practices

Engineering disciplines and ways of working that this repo encodes.

| Topic | File | Summary |
|---|---|---|
| Site Reliability Engineering | [practices/sre.md](practices/sre.md) | Reliability codified as IaC; per-app dashboards, alerts, PDBs, VPA, multi-cluster HA; toil reduction via revision pruning and cleanup automation; DORA-metric alignment. |
| DevSecOps | [practices/devsecops.md](practices/devsecops.md) | Defence-in-depth defaults: IAP, VPC-SC, Binary Authorization, CMEK, Secret Manager hygiene, plan-time validation, mandatory `/security` audit workflow. |
| CI/CD | [practices/cicd.md](practices/cicd.md) | Cloud Build pipelines, Skaffold + Cloud Deploy scaffolding, validation gates, integration test suite, parameterised multi-tenant deploy pattern. |
| FinOps | [practices/finops.md](practices/finops.md) | Serverless-first defaults, scale-to-zero, VPA, Artifact Registry / revision lifecycle policies, cost-allocation labels, tier-configurable shared services. |
| Platform Engineering | [practices/platform_engineering.md](practices/platform_engineering.md) | Four-tier IDP architecture, golden paths, self-service surface, opinionated defaults, agent-driven workflows, multi-tenant governance. |
| GitOps & IaC | [practices/gitops_iac.md](practices/gitops_iac.md) | OpenTofu, four-tier modules, Cloud Build triggers, per-deployment GCS state, drift detection, plan-time guarantees, push-button rollback. |

## Capabilities

Technical surfaces the platform exposes to applications.

| Topic | File | Summary |
|---|---|---|
| Serverless | [capabilities/serverless.md](capabilities/serverless.md) | Cloud Run v2 as primary runtime, GKE Autopilot as serverless-Kubernetes fallback, fully managed dependencies, serverless CI/CD. |
| Multicloud | [capabilities/multicloud.md](capabilities/multicloud.md) | OpenTofu, container-portable workloads, Kubernetes runtime, multi-cluster mesh, VMware Engine hybrid, federated identity — with honest framing of current GCP focus. |
| Artificial Intelligence | [capabilities/ai.md](capabilities/ai.md) | Pre-built modules for Ollama, Flowise, RAGFlow, N8N AI, Activepieces; vector-store backing services; AI-native developer experience. |
| Data & Databases | [capabilities/data_and_databases.md](capabilities/data_and_databases.md) | Cloud SQL (MySQL/PG), AlloyDB, Redis, Filestore, GCS Fuse, Elasticsearch; init-job lifecycle automation; backup/restore tooling. |
| Networking | [capabilities/networking.md](capabilities/networking.md) | VPC, Cloud NAT, PSA peering, Direct VPC Egress, Gateway API, Cloud Armor, IAP, multi-cluster mesh, custom domains + CDN, hybrid connectivity. |
| Observability | [capabilities/observability.md](capabilities/observability.md) | Per-app dashboards, alert policies, Cloud Logging, Cloud Audit Logs, SCC, mesh telemetry, CI/CD observability. |
| Disaster Recovery | [capabilities/disaster_recovery.md](capabilities/disaster_recovery.md) | IaC reproducibility, scripted backup/restore, multi-cluster HA, GKE Backup, application-level rollback, DR-aware change management. |
| Multi-tenancy / SaaS | [capabilities/multitenancy_saas.md](capabilities/multitenancy_saas.md) | Tenant identity in resource naming, per-deployment state isolation, per-tenant VPC-SC perimeters, inline CIDR derivation, application catalogue as marketplace. |

## Outcomes

Business and operational results the platform produces.

| Topic | File | Summary |
|---|---|---|
| Enhanced Developer Productivity | [outcomes/developer_productivity.md](outcomes/developer_productivity.md) | Self-service deployment surface, opinionated defaults, reusable application catalogue, agent-driven UX, UI-driven configuration. |
| Application Modernisation | [outcomes/modernisation.md](outcomes/modernisation.md) | VMware Engine lift-and-shift, container replatforming, managed-service substitution, refactor to serverless, hybrid-during-migration support. |
| Compliance & Governance | [outcomes/compliance_governance.md](outcomes/compliance_governance.md) | Auditable IaC, Cloud Audit Logs, SCC, Binary Authorization, CMEK, per-tenant perimeters, segregation of duties, mandatory `/security` audit workflow. |
| Education & Enablement | [outcomes/education_enablement.md](outcomes/education_enablement.md) | Five GCP certification tracks (ACE / PCA / PCD / PDE / PSE), hands-on lab guides, deep-dive analyses, role-based workflow docs, agent skill guides. |

---

## How to use these documents

- **Sales / partner conversations** — Each topic file is structured to be readable standalone, with concrete file references that prove the claims.
- **Developer onboarding** — Read the outcomes (`developer_productivity.md`, `education_enablement.md`) first, then the capabilities relevant to your workload, then the practices that govern how to work in the repo.
- **Auditor evidence** — `compliance_governance.md`, `devsecops.md`, and `observability.md` together collect the control-evidence references for a SOC 2 / ISO 27001 audit pass.
- **Architecture review** — Start with `platform_engineering.md` and `gitops_iac.md` for the architectural intent, then drill into the specific capabilities.

## Editorial convention: canonical homes

Each fact lives in **one** file (its canonical home) and is cross-referenced from the others. A topic file contains only:

1. A **Scope** statement — what this topic uniquely covers.
2. The **canonical content** for that topic (sections marked *(canonical)* in the file).
3. **Cross-references** to where overlapping content lives.

Canonical-home assignments at a glance:

| Subject | Canonical home |
|---|---|
| Cloud Run v2, GKE Autopilot, VPA, managed dependencies | [capabilities/serverless.md](capabilities/serverless.md) |
| Cloud SQL, AlloyDB, Redis, Filestore, DB lifecycle scripts | [capabilities/data_and_databases.md](capabilities/data_and_databases.md) |
| VPC, NAT, PSA, multi-cluster mesh, Gateway API, custom domains, CDN | [capabilities/networking.md](capabilities/networking.md) |
| Dashboards, alerts, Cloud Logging, Audit Logs, SCC, mesh telemetry | [capabilities/observability.md](capabilities/observability.md) |
| Backup/restore, GKE Backup, rollback, DR-aware change management | [capabilities/disaster_recovery.md](capabilities/disaster_recovery.md) |
| Tenant naming, per-deployment perimeters, inline CIDR derivation | [capabilities/multitenancy_saas.md](capabilities/multitenancy_saas.md) |
| AI/LLM modules, vector stores, AI runtime characteristics | [capabilities/ai.md](capabilities/ai.md) |
| IAP, VPC-SC, Binary Auth, CMEK, WIF, secret hygiene, `/security` checklist | [practices/devsecops.md](practices/devsecops.md) |
| Cloud Build pipelines, triggers, Skaffold, validation, integration tests | [practices/cicd.md](practices/cicd.md) |
| OpenTofu, per-deployment state, drift detection, idempotent re-apply | [practices/gitops_iac.md](practices/gitops_iac.md) |
| Four-tier IDP architecture, golden paths, conventions, UIMeta | [practices/platform_engineering.md](practices/platform_engineering.md) |
| Revision pruning, AR cleanup, cost labels, cost-vs-perf trade-offs | [practices/finops.md](practices/finops.md) |
| PDB, progress deadlines, DORA metrics, `/troubleshoot` patterns | [practices/sre.md](practices/sre.md) |
| Application catalogue, scaffolding, UIMeta UI, quantified ROI | [outcomes/developer_productivity.md](outcomes/developer_productivity.md) |
| VMware Engine, replatform, managed-service substitution | [outcomes/modernisation.md](outcomes/modernisation.md) |
| Cert tracks, lab guide, deep dives, CLAUDE.md/AGENTS.md/.agent skills | [outcomes/education_enablement.md](outcomes/education_enablement.md) |
| Auditor-evidence map across all of the above | [outcomes/compliance_governance.md](outcomes/compliance_governance.md) |
