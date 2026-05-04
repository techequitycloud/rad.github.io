# Cloud Engineering Practices

This directory documents the engineering practices implemented by the modules in this repository. Each document is the **canonical home** for its topic — other documents in `docs/` reference these rather than re-stating the content.

> **Last reviewed:** 2026-05-04

## Documents

| Document | What it covers |
|---|---|
| [cicd.md](cicd.md) | Cloud Build pipelines, build triggers, image build, progressive delivery, branch strategy, approval gates, build notifications, and build caching |
| [devsecops.md](devsecops.md) | IAM, Workload Identity Federation, IAP, secret management, VPC Service Controls, supply chain security (Binary Auth, SBOM, vulnerability scanning), TLS, secrets rotation, and security incident response |
| [finops.md](finops.md) | Lifecycle policies, cost-allocation labels, tier-configurable services, cost/performance profiles, CDN offload, budget alerts, anomaly detection, Committed Use Discounts, and orphaned resource detection |
| [gitops_iac.md](gitops_iac.md) | OpenTofu engine, per-deployment GCS state, drift detection, reproducibility, module versioning strategy, provider version pinning, state lock recovery, and IaC change approval workflow |
| [platform_engineering.md](platform_engineering.md) | Four-tier IDP architecture, golden paths, convention enforcement, centralised governance, platform SLOs, deprecation and migration policy, multi-region strategy, and developer onboarding |
| [sre.md](sre.md) | SLO/SLI/error budget framework, reliability codification, toil reduction, incident response runbook, DORA metrics, blameless post-mortems, on-call model, and chaos engineering |

## How these documents relate

```
Platform Engineering  ←── defines the module architecture consumed by all other practices
       │
       ├── GitOps & IaC       ←── the engine that applies platform changes
       │       │
       │       └── CI/CD      ←── the pipeline that runs the engine
       │
       ├── DevSecOps          ←── security controls embedded in the platform
       │
       ├── SRE                ←── reliability targets and operations for the platform
       │
       └── FinOps             ←── cost controls and visibility for the platform
```

The `docs/capabilities/` directory covers the GCP capabilities the platform exposes (networking, observability, serverless, AI, data, multitenancy, disaster recovery). The `docs/outcomes/` directory frames the platform in terms of business outcomes (developer productivity, compliance, education).

## Canonical vs. referenced content

Documents in this directory mark specific sections as **(canonical)** when they are the definitive source for a topic. Other documents cross-reference these sections rather than duplicating content. If you find the same content described in two places, the version in the document that owns the **(canonical)** marker takes precedence.
