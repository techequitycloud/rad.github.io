---
title: "Engineering Practices"
description: "Engineering practices used across RAD Platform modules — infrastructure as code, CI/CD, testing, versioning, and release management."
---

# Engineering Practices

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Engineering_Practices.png" alt="Engineering Practices" style={{maxWidth: "100%", borderRadius: "8px"}} />

## Overview

The platform does more than deploy applications — it encodes the engineering
disciplines that the world's leading technology organisations rely on to run software
safely at scale. Every solution you deploy inherits these practices by default:
delivery is automated, security is built in, reliability is measured, and cost is
controlled — without you writing or maintaining any of the underlying machinery.

This document summarises six disciplines the platform applies on your behalf — Platform
Engineering, GitOps & Infrastructure as Code, CI/CD, DevSecOps, Site Reliability
Engineering, and FinOps — and the configuration variables through which you shape them.

---

## 1. Platform Engineering

A paved-road platform: the common, hard parts of running production workloads are
solved once and offered as self-service, so teams ship features instead of assembling
infrastructure.

- **A catalogue of ready-to-run solutions.** Every supported application is available
  as a turnkey deployment in two runtimes (serverless and Kubernetes), so launching a
  new workload is a configuration exercise, not an engineering project.
- **Golden paths.** Opinionated, pre-hardened templates cover the common archetypes —
  stateless web services, stateful workloads, and AI/inference services — each wired
  with production-grade defaults.
- **Centralised governance, decentralised consumption.** Cross-cutting controls
  (identity, encryption, perimeters, image policy) are defined once at the platform
  level and inherited automatically by every deployment — roughly a 95% reduction in
  per-application maintenance across a typical portfolio.
- **Consistency by construction.** Every deployment follows the same naming, structure,
  and configuration model, so any solution is legible to any operator and resources are
  self-identifying in the console, billing, and audit logs.
- **Multi-region ready.** The same solution can be deployed to additional regions for
  geo-redundancy or lower latency, fronted by global routing.
- **Guided onboarding.** New teams start from the catalogue and a reference
  implementation rather than a blank page, reaching a working deployment in minutes.

---

## 2. GitOps & Infrastructure as Code

Infrastructure is described declaratively and managed like application code — version
controlled, reviewed, and reproducible.

- **Declarative and version-controlled.** Every deployment is fully described by its
  configuration; the desired state lives in version control, not in an operator's
  memory.
- **Isolated state per deployment.** Each tenant and application has its own independent
  state, eliminating cross-deployment interference and lock contention.
- **Drift detection.** Changes made outside the platform are detected and reconciled
  back to the declared state, so reality and intent never silently diverge.
- **Reproducibility.** Every deployment is pinned to an exact source version, so any
  prior state can be reconstructed and re-provisioned in another project or region.
- **Push-button rollback.** Reverting a change converges infrastructure back to its
  previous state; application releases roll back independently in seconds.
- **Reviewed change, with blast-radius-aware approval.** Higher-impact changes — those
  affecting shared foundations — require additional review before they are applied.

---

## 3. Continuous Integration & Delivery (CI/CD)

From a single change to a running deployment, automatically and safely.

- **Managed build and delivery.** Container images are built, tested, and deployed
  through managed pipelines — no build servers to provision or maintain.
- **Flexible image sourcing.** Deploy a pre-built image, build from source, or mirror
  an upstream image into your private registry (`container_image_source`,
  `enable_image_mirroring`).
- **Progressive delivery.** Releases can move through environments — development →
  staging → production — with optional automatic promotion and human approval gates
  between stages (`enable_cloud_deploy`, `cloud_deploy_stages`).
- **Validation before provisioning.** Misconfigurations are rejected up front, before
  any resource is created, so broken changes never reach your environment.
- **Safety gates on destructive actions.** Teardown and other high-impact operations
  require explicit human approval — they are never triggered automatically.
- **Automated post-deployment steps.** Database initialisation, migrations, and
  plugin/extension installs run automatically with each deployment.
- **Failure visibility.** Pipeline failures surface immediately through configurable
  notification channels.

---

## 4. DevSecOps

Security is built into every deployment from the first apply — not bolted on later.

- **Security as configuration.** Every guardrail is a reviewed, version-controlled
  setting, applied consistently across all deployments.
- **Least-privilege identity.** Each application runs as its own identity with only the
  permissions it needs. External identity providers can be federated in without
  long-lived keys.
- **Zero-trust access.** Identity-aware access can front any application with a single
  switch (`enable_iap`), replacing VPNs with per-request identity checks.
- **Managed secrets.** Credentials are stored in a managed secret store, injected at
  runtime, never hard-coded, and can rotate automatically on a schedule
  (`enable_auto_password_rotation`).
- **Service perimeters.** Per-tenant perimeters (`enable_vpc_sc`, `vpc_sc_dry_run`)
  isolate data and services, with a safe dry-run-first rollout.
- **Supply-chain integrity.** Signed-image admission (`enable_binary_authorization`),
  continuous vulnerability scanning, and software bill-of-materials generation ensure
  only trusted images run. Integrity extends to the deployment tooling itself: provider
  and dependency versions are pinned with cryptographic hashes, so a changed binary is
  detected between runs rather than silently adopted.
- **Encryption everywhere.** Customer-managed encryption keys protect data at rest, and
  TLS terminates every ingress path with automatically managed, auto-rotating
  certificates.
- **Network protection.** A managed web application firewall with DDoS protection
  (`enable_cloud_armor`), deny-by-default micro-segmentation
  (`enable_network_segmentation`), and admin-path restrictions (`admin_ip_ranges`)
  defend every workload.
- **Policy-as-code across the fleet.** Organisation-wide guardrails are enforced from a
  single policy source applied to every cluster, with violations reported centrally —
  so the same admission and configuration rules hold everywhere, not per deployment.
- **Continuous audit.** A built-in security audit surfaces misconfiguration before it
  becomes an incident, and findings are aggregated in a single view.

---

## 5. Site Reliability Engineering (SRE)

Reliability is defined, measured, and engineered — not hoped for.

- **Service-level objectives.** Reliability targets are explicit, with recommended
  starting points by criticality:

| Tier | Availability | Latency (p99) | Error budget (30d) |
|---|---|---|---|
| Production (critical) | 99.9% | &lt; 2 s | 43 min |
| Production (standard) | 99.5% | &lt; 5 s | 3.6 hr |
| Non-production | 99.0% | &lt; 10 s | 7.2 hr |

- **Error-budget policy.** When a budget is materially consumed, non-critical feature
  delivery pauses in favour of reliability work — making the reliability-versus-velocity
  trade-off explicit and data-driven.
- **Burn-rate alerting.** Error budgets are protected by multi-window burn-rate alerts —
  a fast-burn alert (budget consumed at roughly 14× the sustainable rate over a short
  window) catches acute incidents, while a slow-burn alert (roughly 6× over a longer
  window) catches gradual erosion — minimising both false pages and missed incidents.
- **Reliability codified.** Disruption budgets (`enable_pod_disruption_budget`,
  `pdb_min_available`), health probes, and deterministic rollout deadlines
  (`deployment_timeout`) are applied by default, so reliability decisions live in
  configuration rather than operator memory.
- **Toil reduction.** Recurring operational chores — revision pruning, stale-resource
  cleanup, dependency readiness waits — are automated away.
- **Measured delivery (DORA).** The platform directly improves the four industry-standard
  delivery metrics:

| Metric | How the platform helps |
|---|---|
| Deployment frequency | One-trigger deploys make frequent releases routine |
| Lead time for changes | Thin, standardised deployments turn changes around in minutes |
| Change failure rate | Standardised foundations and up-front validation cut failures |
| Mean time to recovery | Instant rollback and scripted restore shorten recovery |

- **Incident response and learning.** A runbook of known issue patterns speeds
  diagnosis; significant incidents are followed by blameless post-mortems whose action
  items feed back into the platform's safeguards.
- **Resilience testing.** Failure is exercised deliberately — instance eviction, probe
  failure, dependency loss, and cold-start behaviour — to confirm the system degrades
  gracefully.

---

## 6. FinOps

Cost is a first-class engineering concern — controlled by default and visible per
tenant.

- **Scale-to-zero economics.** Serverless workloads cost nothing when idle and bill per
  request and per second (`min_instance_count`); Kubernetes workloads are billed for
  the resources actually requested and continuously right-sized.
- **Spot compute for interruptible work.** Interruption-tolerant or non-production
  workloads can run on Spot capacity, cutting node costs by roughly 60–90% in exchange
  for the possibility of short-notice preemption — a deliberate cost/durability
  trade-off.
- **Automated lifecycle policies.** Old revisions, untagged images, and aged objects are
  pruned automatically (`max_revisions_to_retain`, plus image-retention and
  bucket-lifecycle controls), preventing storage-cost creep.
- **Per-tenant cost allocation.** Self-identifying resource naming flows into billing,
  enabling per-tenant chargeback and per-customer spend caps for SaaS scenarios.
- **Tier-configurable services.** Every expensive backing service — databases, cache,
  file storage, compute — is sized through configuration, so you pay for the tier you
  need.
- **Explicit cost/performance profiles.** Documented Low-Cost, Low-Latency, and Balanced
  profiles make the trade-off a deliberate choice.
- **Edge offload.** Caching at the global edge (`enable_cdn`) shifts read-heavy traffic
  off compute, with projected savings of 30–50% on compute and egress.
- **Proactive spend control.** Budget alerts, anomaly detection, and committed-use and
  sustained-use discount guidance catch overspend early and capture savings on
  always-on components.
- **Cross-boundary egress awareness.** When workloads span clouds or regions,
  cross-boundary traffic travels public paths and incurs egress charges on both sides;
  private interconnect or VPN gives predictable latency and lower egress for production
  multi-location topologies.
- **Orphan detection.** Idle and abandoned resources are surfaced for cleanup so spend
  tracks actual usage.

**Quantified outcome.** For a representative ten-application portfolio, the model
projects roughly 95% reductions in both provisioning time and ongoing maintenance
effort, and six-figure annual operational savings. Adjust the inputs — portfolio size,
team cost, baseline effort — to your own situation before presenting to stakeholders.

---

## Practices at a glance

| Discipline | What the platform does for you |
|---|---|
| Platform Engineering | Self-service catalogue, golden paths, centralised governance, consistency by construction |
| GitOps & IaC | Declarative, version-controlled, reproducible deployments with drift detection and instant rollback |
| CI/CD | Managed build and progressive delivery, validation gates, approval on destructive actions |
| DevSecOps | Least-privilege identity, managed secrets, perimeters, supply-chain integrity, policy-as-code, encryption, WAF |
| SRE | SLOs and error budgets with burn-rate alerting, codified resilience, toil reduction, DORA gains, blameless learning |
| FinOps | Scale-to-zero, spot compute, lifecycle automation, per-tenant cost allocation, tiering, edge offload, spend alerts |

---

## In summary

These six disciplines are not optional add-ons or a maturity model you grow into — they
are the platform's default operating posture. Every solution you deploy is delivered
through automated pipelines, secured with defence-in-depth, measured against reliability
objectives, and cost-controlled from the first deployment. You inherit the engineering
practices of a mature platform team and shape them through configuration, rather than
building and maintaining them yourself.
