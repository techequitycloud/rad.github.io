---
title: "Professional Cloud DevOps Engineer (PDE) Certification Lab Map"
description: "Map every Professional Cloud DevOps Engineer (PDE) exam domain to hands-on RAD deployment labs on Google Cloud — a practical, exam-aligned study path."
---

# Professional Cloud DevOps Engineer (PDE) Certification Lab Map
> 📚 **Official exam guide:** [Professional Cloud DevOps Engineer certification](https://cloud.google.com/learn/certification/cloud-devops-engineer) — always confirm section weightings against the current Google Cloud exam guide.


The Professional Cloud DevOps Engineer certification validates your ability to build and manage CI/CD pipelines, apply SRE practices (SLOs, error budgets, incident response), implement observability, and optimize service performance and cost on Google Cloud. The RAD platform's four foundation modules — `Services_GCP` (shared platform infrastructure), `App_CloudRun` (Cloud Run v2 deployment engine), `App_GKE` (GKE Autopilot deployment engine), and `App_Common` (shared building blocks for Cloud Deploy, monitoring, and dashboards) — give you a live, inspectable lab: every Cloud Build trigger, Cloud Deploy stage, alert policy, and traffic split discussed in this guide is real infrastructure you can deploy, break, and fix.

## How to use this guide

- Pick a deployment profile below and deploy it through your deployment portal.
- Work through the matching section guide (`PDE_Section_N_Exploration_Guide.md`) — each subsection has hands-on steps with real `gcloud`, `kubectl`, and `tofu` commands.
- Use the coverage legend honestly: 📘 topics (most pure SRE theory and incident management process) must be studied outside the platform; the section guides give pointers.
- The platform itself is part of the lab — Section 1 treats the deployment modules as the IaC artifact the exam expects you to reason about.

**Coverage legend**

| Symbol | Meaning |
|---|---|
| ✅ | Fully demonstrated — deploy it, see it, modify it in the RAD platform |
| 🟡 | Partially demonstrated — the modules touch the concept; supplement with docs |
| 📘 | Concept-only — not implemented by the modules; study pointers provided |

## Deployment profiles

### Profile: Pipeline engineer
*Purpose:* end-to-end CI/CD — GitHub push → Kaniko build → Artifact Registry → Binary Authorization attestation → Cloud Deploy promotion with a prod approval gate.
*Modules:* `App_CloudRun` (optionally on top of `Services_GCP`).

| Variable | Value |
|---|---|
| `enable_cicd_trigger` | `true` |
| `github_repository_url` | `https://github.com/<you>/<repo>` |
| `github_token` | a PAT with `repo` + `admin:repo_hook` (first apply only) |
| `enable_cloud_deploy` | `true` |
| `cicd_enable_cloud_deploy` | `true` |
| `enable_binary_authorization` | `true` |
| `binauthz_evaluation_mode` | `REQUIRE_ATTESTATION` |
| `support_users` | `["you@example.com"]` |

*Estimated incremental cost:* low–moderate — Cloud Build minutes and Artifact Registry storage dominate; Cloud Deploy itself adds no direct charge for Cloud Run targets, you pay for the per-stage Cloud Run services.

### Profile: GKE release engineer
*Purpose:* rolling updates, HPA/VPA, PodDisruptionBudgets, and Cloud Deploy to GKE namespaces.
*Modules:* `Services_GCP` + `App_GKE`.

| Variable | Value |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `gke_cluster_mode` (Services_GCP) | `AUTOPILOT` (default) |
| `min_instance_count` (App_GKE) | `2` |
| `max_instance_count` (App_GKE) | `4` |
| `enable_pod_disruption_budget` (App_GKE) | `true` (default) |
| `enable_topology_spread` (App_GKE) | `true` |
| `enable_cicd_trigger` + `enable_cloud_deploy` (App_GKE) | `true` (optional, for the GKE CD path) |

*Estimated incremental cost:* moderate–high — GKE Autopilot bills per pod resource request plus a cluster management fee; multiple replicas multiply the cost.

### Profile: Observability baseline
*Purpose:* notification channels, threshold alert policies, auto-generated dashboards, and full audit logging to explore in Logs Explorer.
*Modules:* `Services_GCP` + either application engine.

| Variable | Value |
|---|---|
| `support_users` (app module) | `["you@example.com"]` |
| `alert_policies` (app module) | one entry, e.g. on `run.googleapis.com/request_count` |
| `configure_email_notification` (Services_GCP) | `true` |
| `notification_alert_emails` (Services_GCP) | `["ops@example.com"]` |
| `alert_cpu_threshold` / `alert_memory_threshold` / `alert_disk_threshold` (Services_GCP) | `80` (defaults) |
| `enable_audit_logging` | `true` |

*Estimated incremental cost:* low — audit logging (`DATA_READ`/`DATA_WRITE` on `allServices`) is the dominant driver via Cloud Logging ingestion volume.

### Profile: Cost-lean serverless
*Purpose:* scale-to-zero economics, CPU throttling, revision pruning, and Artifact Registry cleanup policies for Section 5.
*Modules:* `App_CloudRun` only.

| Variable | Value |
|---|---|
| `min_instance_count` | `0` (default) |
| `max_instance_count` | `3` |
| `cpu_always_allocated` | `false` |
| `max_revisions_to_retain` | `7` (default) |
| `delete_untagged_images` | `true` (default) |
| `image_retention_days` | `30` (default) |

*Estimated incremental cost:* minimal — the service scales to zero between requests; only storage and per-request compute accrue.

## Section 1: Bootstrapping and maintaining a Google Cloud organization (~20% of the exam)

The exam opens with organization-level design: resource hierarchy, IaC discipline, CI/CD architecture choices, and multi-environment management. The RAD modules are themselves the IaC artifact, and the Cloud Deploy stage model is the multi-environment lab.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 1.1 Designing the overall resource hierarchy | 📘 | project-scoped only; `resource_labels` for governance labels | [Section 1 guide](PDE_Section_1_Exploration_Guide.md#11-designing-the-overall-resource-hierarchy) |
| 1.2 Managing infrastructure | ✅ | the deployment modules themselves; `tofu plan` drift detection; Cloud Deploy owns the container image while IaC owns the rest; IaC CI checks | [Section 1 guide](PDE_Section_1_Exploration_Guide.md#12-managing-infrastructure) |
| 1.3 Designing a CI/CD architecture stack | ✅ | inline Cloud Build trigger, Cloud Deploy delivery pipeline, Binary Authorization | [Section 1 guide](PDE_Section_1_Exploration_Guide.md#13-designing-a-cicd-architecture-stack) |
| 1.4 Managing multiple environments | ✅ | `cloud_deploy_stages` (dev/staging/prod), per-stage services and namespaces | [Section 1 guide](PDE_Section_1_Exploration_Guide.md#14-managing-multiple-environments) |

## Section 2: Building and implementing CI/CD pipelines (~25% of the exam)

The heaviest exam section and the strongest area of the RAD lab: an inline Cloud Build pipeline (Kaniko → attestation → deploy), Artifact Registry with cleanup policies, Binary Authorization, and a real Cloud Deploy pipeline with approvals, automation rules, and rollback.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 2.1 Designing pipelines | ✅ | `enable_cicd_trigger`, Kaniko v1.23.2 build step, Artifact Registry cleanup policies | [Section 2 guide](PDE_Section_2_Exploration_Guide.md#21-designing-pipelines) |
| 2.2 Implementing and managing pipelines | ✅ | `cloud_deploy_stages`, `traffic_split`, `kubectl set image` direct path, revision pruning | [Section 2 guide](PDE_Section_2_Exploration_Guide.md#22-implementing-and-managing-pipelines) |
| 2.3 Managing pipeline configuration and secrets | ✅ | `github_token` (never in state), `secret_environment_variables`, `enable_auto_password_rotation` | [Section 2 guide](PDE_Section_2_Exploration_Guide.md#23-managing-pipeline-configuration-and-secrets) |
| 2.4 Auditing and logging of code and configurations | ✅ | Data Access audit logging, Binary Authorization attestations, Cloud Deploy release history | [Section 2 guide](PDE_Section_2_Exploration_Guide.md#24-auditing-and-logging-of-code-and-configurations) |

## Section 3: Applying site reliability engineering practices (~18% of the exam)

SLO/error-budget theory is mostly 📘 — the modules emit the metrics SLIs are built from but do not create SLO objects. Capacity management and incident mitigation, however, are fully hands-on: autoscaling, PDBs, traffic splitting, and instant rollback.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 3.1 Balancing change, velocity, and reliability of the service | 📘 | threshold alerts as proto-SLIs; no SLO/error-budget objects | [Section 3 guide](PDE_Section_3_Exploration_Guide.md#31-balancing-change-velocity-and-reliability-of-the-service) |
| 3.2 Managing service lifecycle | ✅ | `min_instance_count`/`max_instance_count`, GKE HPA (CPU 70% / memory 80%), `enable_vertical_pod_autoscaling` | [Section 3 guide](PDE_Section_3_Exploration_Guide.md#32-managing-service-lifecycle) |
| 3.3 Mitigating incident impact on users | ✅ | `traffic_split` rollback, Cloud Deploy rollback, `enable_pod_disruption_budget`, probes, Cloud Armor rate limiting | [Section 3 guide](PDE_Section_3_Exploration_Guide.md#33-mitigating-incident-impact-on-users) |

## Section 4: Implementing observability practices and troubleshooting issues (~25% of the exam)

The second-heaviest section. The modules provision notification channels, fixed and custom alert policies, per-platform dashboards, GKE workload logging, managed Prometheus, synthetic uptime checks (`uptime_check_config` — created for publicly reachable endpoints, with a `check_passed` alert policy), and (optionally) full data-access audit logs.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 4.1 Instrumenting and collecting telemetry | 🟡 | GKE workload logging/monitoring + managed Prometheus on the Services_GCP cluster; `enable_audit_logging`; `uptime_check_config` synthetic checks | [Section 4 guide](PDE_Section_4_Exploration_Guide.md#41-instrumenting-and-collecting-telemetry) |
| 4.2 Troubleshooting and analyzing issues | 🟡 | Logs Explorer over module-deployed workloads; revision/Pod diagnostics; Cloud Logging build logs | [Section 4 guide](PDE_Section_4_Exploration_Guide.md#42-troubleshooting-and-analyzing-issues) |
| 4.3 Managing metrics, dashboards, and alerts | ✅ | the monitoring layer (90% CPU/memory alerts, renotify 1800s), `alert_policies`, auto-generated dashboards, Services_GCP threshold alerts | [Section 4 guide](PDE_Section_4_Exploration_Guide.md#43-managing-metrics-dashboards-and-alerts) |

## Section 5: Optimizing performance and cost (~12% of the exam)

Performance tuning (execution environment, CPU allocation, resource requests) is fully demonstrated; FinOps tooling (billing export, Recommender, CUDs) is 📘, with the modules providing the levers those tools would recommend pulling.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 5.1 Collecting performance information in Google Cloud | 🟡 | `execution_environment`, `cpu_always_allocated`, `container_resources`, managed Prometheus; Trace/Profiler 📘 | [Section 5 guide](PDE_Section_5_Exploration_Guide.md#51-collecting-performance-information-in-google-cloud) |
| 5.2 Implementing FinOps practices for optimizing resource utilization and costs | 🟡 | scale-to-zero, request-only CPU, VPA, AR cleanup policies, GKE cost allocation; billing export/Recommender 📘 | [Section 5 guide](PDE_Section_5_Exploration_Guide.md#52-implementing-finops-practices-for-optimizing-resource-utilization-and-costs) |
