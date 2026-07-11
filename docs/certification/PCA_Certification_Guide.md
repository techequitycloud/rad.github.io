---
title: "Professional Cloud Architect (PCA) Certification Lab Map"
description: "Map every Professional Cloud Architect (PCA) exam domain to hands-on RAD deployment labs on Google Cloud — a practical, exam-aligned study path."
---

# Professional Cloud Architect (PCA) Certification Lab Map
> 📚 **Official exam guide:** [Professional Cloud Architect certification](https://cloud.google.com/learn/certification/cloud-architect) — always confirm section weightings against the current Google Cloud exam guide.


The Professional Cloud Architect certification validates your ability to design, plan, and manage secure, scalable, highly available cloud solutions — and to justify the trade-offs behind every design choice. The RAD platform's four foundation modules give you a live laboratory for exactly those trade-offs: `Services_GCP` (the shared platform layer — VPC, Cloud SQL, Redis, Filestore, GKE, CMEK, VPC-SC), `App_CloudRun` and `App_GKE` (two deployment engines for the *same* containerized workload, embodying the serverless-vs-orchestrated decision the PCA exam returns to again and again), and `App_Common` (shared layers implementing discovery, secrets, IAM, storage, and CI/CD patterns). Every toggle in your deployment portal is a design decision you can deploy, inspect in the GCP console, and reverse.

## How to use this guide

- Deploy one of the profiles below through your deployment portal, then work through the matching section guide(s).
- Each section guide pairs "why the exam cares" decision criteria with the exact variables that implement the concept, hands-on steps, and self-check questions.
- Use the coverage legend honestly: 📘 topics (hybrid connectivity, migration planning, Vertex AI, org hierarchy) must be studied outside the platform — the "Beyond the modules" blocks tell you what and where.
- **Case studies (📘):** the PCA exam includes scenario questions built on official case studies such as EHR Healthcare, Helicopter Racing League, Mountkirk Games, and TerramEarth. The modules are an excellent rehearsal ground: read a case study's requirements, then write down which portal variables would satisfy each one (e.g. EHR Healthcare's encryption and audit demands map to `enable_cmek`, `enable_audit_logging`, and `enable_vpc_sc`; Mountkirk Games' global, autoscaled, container-based platform maps to GKE Autopilot with a global Gateway and Cloud Armor). Where a requirement has *no* matching variable — hybrid Interconnect for TerramEarth, multi-region Spanner for Mountkirk — you have found a study gap.

**Coverage legend**

| Symbol | Meaning |
|---|---|
| ✅ | Fully demonstrated — deploy it, see it, modify it in the RAD platform |
| 🟡 | Partially demonstrated — the modules touch the concept; supplement with docs |
| 📘 | Concept-only — not implemented by the modules; study pointers provided |

## Deployment profiles

### Profile: Lean baseline
*Purpose:* the lowest-cost architecture — zonal database, scale-to-zero serverless, self-managed NFS VM — your reference point for every cost/availability trade-off.
*Modules:* Services_GCP, then App_CloudRun.
| Variable | Value |
|---|---|
| `create_postgres` | `true` (default) |
| `postgres_database_availability_type` | `ZONAL` (default) |
| `create_network_filesystem` | `true` (default — e2-small NFS/Redis VM) |
| `min_instance_count` | `0` (default, App_CloudRun) |
| `max_instance_count` | `1` (default, App_CloudRun) |

*Estimated incremental cost:* low — the zonal `db-custom-1-3840` Cloud SQL instance and the e2-small NFS VM dominate; Cloud Run scales to zero.

### Profile: Resilient data tier
*Purpose:* upgrade the baseline to high availability so you can compare ZONAL vs REGIONAL Cloud SQL, BASIC vs STANDARD_HA Redis, and VM-based NFS vs managed Filestore side by side.
*Modules:* Services_GCP (update in place), App_CloudRun unchanged.
| Variable | Value |
|---|---|
| `postgres_database_availability_type` | `REGIONAL` |
| `create_postgres_read_replica` | `true` |
| `create_redis` | `true` |
| `redis_tier` | `STANDARD_HA` |
| `redis_persistence_mode` | `RDB` |
| `create_filestore_nfs` | `true` |
| `filestore_tier` | `BASIC_HDD` (default) |

*Estimated incremental cost:* high — REGIONAL Cloud SQL roughly doubles instance cost, the read replica adds another instance, STANDARD_HA Redis doubles Redis cost, and Filestore bills a minimum 1024 GB.

### Profile: GKE architecture
*Purpose:* deploy the same workload on GKE Autopilot to exercise the Cloud Run vs GKE decision, Kubernetes governance (quotas, PDBs, NetworkPolicy), and Gateway API exposure.
*Modules:* Services_GCP (update), then App_GKE.
| Variable | Value |
|---|---|
| `create_google_kubernetes_engine` | `true` (Services_GCP) |
| `gke_cluster_mode` | `AUTOPILOT` (default) |
| `enable_resource_quota` | `true` (App_GKE) |
| `enable_network_segmentation` | `true` (App_GKE) |
| `enable_pod_disruption_budget` | `true` (default, App_GKE) |
| `stateful_pvc_enabled` | `true`, with `stateful_pvc_size = "10Gi"` and a mount path |

*Estimated incremental cost:* moderate — Autopilot bills per pod resource request plus a cluster management fee; the stateful PVC adds a small persistent disk.

### Profile: Security and delivery
*Purpose:* layer in defense-in-depth (CMEK, Binary Authorization, VPC-SC dry run, audit logs) and a full CI/CD pipeline with progressive delivery — the backbone for Sections 3, 4, and 6.
*Modules:* Services_GCP (update), App_CloudRun (update).
| Variable | Value |
|---|---|
| `enable_cmek` | `true` (Services_GCP) |
| `enable_binary_authorization` | `true`, `binauthz_evaluation_mode = "REQUIRE_ATTESTATION"` (Services_GCP) |
| `enable_vpc_sc` | `true`, `vpc_sc_dry_run = true` (Services_GCP; needs org + `admin_ip_ranges`) |
| `enable_audit_logging` | `true` (Services_GCP) |
| `enable_cloud_armor` | `true`, plus `application_domains` (App_CloudRun) |
| `enable_iap` | `true`, plus `iap_authorized_users` (App_CloudRun) |
| `enable_cicd_trigger` | `true`, plus `github_repository_url` (App_CloudRun) |
| `enable_cloud_deploy` | `true` (App_CloudRun) |
| `enable_auto_password_rotation` | `true` (App_CloudRun) |

*Estimated incremental cost:* moderate — KMS keys, the global load balancer forwarding rule, and audit-log storage are the main drivers; VPC-SC and Binary Authorization are free.

## Section 1: Designing and planning a cloud solution architecture (~25% of the exam)

The heart of the PCA exam: choosing architectures that satisfy business and technical requirements. The modules embody the canonical trade-offs — serverless vs orchestrated compute, zonal vs regional databases, managed vs self-managed file storage — but business analysis, migration planning, and futures thinking live outside any Terraform module.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 1.1 Business requirements (cost, security, success measures) | 🟡 | `min_instance_count`, `create_billing_budget`, `enable_iap`, `support_users` | [Section 1 guide](PCA_Section_1_Exploration_Guide.md#11-designing-a-cloud-solution-infrastructure-that-meets-business-requirements) |
| 1.2 Technical requirements (HA, scalability, reliability) | ✅ | `postgres_database_availability_type`, `redis_tier`, `create_postgres_read_replica`, HPA/PDB in App_GKE | [Section 1 guide](PCA_Section_1_Exploration_Guide.md#12-designing-a-cloud-solution-infrastructure-that-meets-technical-requirements) |
| 1.3 Network, storage, and compute design | ✅ | VPC + Cloud NAT + private services access, Filestore vs self-managed NFS, App_CloudRun vs App_GKE | [Section 1 guide](PCA_Section_1_Exploration_Guide.md#13-designing-network-storage-and-compute-resources) |
| 1.4 Creating a migration plan | 📘 | nearest: `enable_backup_import` data import jobs | [Section 1 guide](PCA_Section_1_Exploration_Guide.md#14-creating-a-migration-plan) |
| 1.5 Envisioning future solution improvements | 📘 | nearest: layered module architecture, discovery-vs-inline pattern | [Section 1 guide](PCA_Section_1_Exploration_Guide.md#15-envisioning-future-solution-improvements) |

## Section 2: Managing and provisioning a cloud solution infrastructure (~17.5% of the exam)

Provisioning is what the modules do for a living: a custom-mode VPC with Cloud NAT and private services access, four database engines, three flavors of file/object storage, and two container platforms — all declaratively. Hybrid topologies and the two Vertex AI subsections are study-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 2.1 Configuring network topologies | 🟡 | `availability_regions`, `subnet_cidr_range`, Cloud NAT + private services access; no hybrid/Shared VPC | [Section 2 guide](PCA_Section_2_Exploration_Guide.md#21-configuring-network-topologies) |
| 2.2 Configuring individual storage systems | ✅ | `storage_buckets`, `backup_schedule`, `create_filestore_nfs`, Cloud SQL PITR | [Section 2 guide](PCA_Section_2_Exploration_Guide.md#22-configuring-individual-storage-systems) |
| 2.3 Configuring compute systems | ✅ | `gke_cluster_mode`, `gke_autoscaling_profile`, `container_resources`, `execution_environment` | [Section 2 guide](PCA_Section_2_Exploration_Guide.md#23-configuring-compute-systems) |
| 2.4 Leveraging Vertex AI for end-to-end ML workflows | 📘 | not implemented | [Section 2 guide](PCA_Section_2_Exploration_Guide.md#24-leveraging-vertex-ai-for-end-to-end-ml-workflows) |
| 2.5 Configuring prebuilt solutions or APIs with Vertex AI | 📘 | nearest: `secret_environment_variables` for API keys | [Section 2 guide](PCA_Section_2_Exploration_Guide.md#25-configuring-prebuilt-solutions-or-apis-with-vertex-ai) |

## Section 3: Designing for security and compliance (~17.5% of the exam)

The Security and delivery profile turns on most of what this section tests: dedicated least-privilege service accounts, CMEK with automatic rotation, Binary Authorization attestation, VPC Service Controls in dry-run mode, IAP zero-trust access, and comprehensive audit logging. Organization hierarchy and regulatory frameworks remain study topics.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 3.1 Security — IAM, secrets, encryption, supply chain, perimeters | ✅ | `enable_cmek`, `enable_binary_authorization`, `enable_vpc_sc`, `enable_iap`, the platform's secrets and IAM layers | [Section 3 guide](PCA_Section_3_Exploration_Guide.md#31-designing-for-security) |
| 3.1 Security — resource hierarchy, org policies | 📘 | not implemented | [Section 3 guide](PCA_Section_3_Exploration_Guide.md#31-designing-for-security) |
| 3.1 Security — Workload Identity Federation (keyless CI) | ✅ | `enable_workload_identity_federation`, `wif_provider_type` (Services_GCP) | [Section 3 guide](PCA_Section_3_Exploration_Guide.md#31-designing-for-security) |
| 3.2 Compliance — auditability, ITAR/HIPAA-style controls | 🟡 | `enable_audit_logging`, `enable_security_command_center`, `vpc_sc_dry_run` | [Section 3 guide](PCA_Section_3_Exploration_Guide.md#32-designing-for-compliance) |

## Section 4: Analyzing and optimizing technical and business processes (~15% of the exam)

CI/CD and release governance are fully demonstrable: a GitHub-triggered Cloud Build pipeline, Kaniko image builds into Artifact Registry, optional Binary Authorization attestation, and a Cloud Deploy pipeline whose default `prod` stage requires manual approval. SRE culture, post-mortems, and stakeholder management are people topics — study them separately.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 4.1 Technical processes — SDLC, CI/CD, testing | 🟡 | `enable_cicd_trigger`, `cloud_deploy_stages`, `traffic_split` | [Section 4 guide](PCA_Section_4_Exploration_Guide.md#41-analyzing-and-defining-technical-processes) |
| 4.2 Business processes — change management, decision-making | 🟡 | `require_approval` gates in `cloud_deploy_stages`; cost guardrails via `create_billing_budget` | [Section 4 guide](PCA_Section_4_Exploration_Guide.md#42-analyzing-and-defining-business-processes) |

## Section 5: Managing implementation (~12.5% of the exam)

The platform *is* an implementation-management exhibit: a four-tier IaC architecture that development teams consume through a portal, with Artifact Registry hygiene policies and guardrail validations baked in. Raw SDK fluency (`gcloud`, client libraries, emulators) requires hands-on practice beyond the portal.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 5.1 Advising development and operation teams | 🟡 | layered module architecture, `max_images_to_retain`, plan-time validations | [Section 5 guide](PCA_Section_5_Exploration_Guide.md#51-advising-development-and-operation-teams) |
| 5.2 Interacting with Google Cloud programmatically | 🟡 | OpenTofu workflow, `gcloud`-based provisioners and discovery scripts | [Section 5 guide](PCA_Section_5_Exploration_Guide.md#52-interacting-with-google-cloud-programmatically) |

## Section 6: Ensuring solution and operations excellence (~12.5% of the exam)

Day-2 operations: every deployment ships a monitoring dashboard and email alert channels; Cloud SQL and the NFS VM get CPU/memory/disk alerts; releases can be canaried with `traffic_split` and promoted through Cloud Deploy. Publicly reachable deployments also get a synthetic uptime check and alert policy via `uptime_check_config` (provisioned by the platform's monitoring layer); support processes and chaos engineering are concept-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 6.1 Operational excellence pillar (Well-Architected Framework) | 🟡 | automation throughout; auto-healing NFS MIG, plan-time CMEK key recovery | [Section 6 guide](PCA_Section_6_Exploration_Guide.md#61-operational-excellence-pillar-well-architected-framework) |
| 6.2 Familiarity with Google Cloud Observability solutions | ✅ | `support_users`, `alert_policies`, `uptime_check_config`, the platform monitoring layer | [Section 6 guide](PCA_Section_6_Exploration_Guide.md#62-familiarity-with-google-cloud-observability-solutions) |
| 6.3 Deployment and release management | ✅ | `traffic_split`, `cloud_deploy_stages`, `max_revisions_to_retain` | [Section 6 guide](PCA_Section_6_Exploration_Guide.md#63-deployment-and-release-management) |
| 6.4 Assisting with the support of deployed solutions | 📘 | nearest: `support_users` notification channels | [Section 6 guide](PCA_Section_6_Exploration_Guide.md#64-assisting-with-the-support-of-deployed-solutions) |
| 6.5 Evaluating quality control measures | 🟡 | `enable_vulnerability_scanning`, Binary Authorization attestation step, the App_GKE plan-time validation suite | [Section 6 guide](PCA_Section_6_Exploration_Guide.md#65-evaluating-quality-control-measures) |
| 6.6 Ensuring the reliability of solutions in production | 🟡 | PDBs, topology spread, auto-healing NFS MIG, Redis production-tier guardrail | [Section 6 guide](PCA_Section_6_Exploration_Guide.md#66-ensuring-the-reliability-of-solutions-in-production) |

---

*Application wrapper modules (Django, WordPress, and others) exist on the platform but are out of scope for these guides — everything here is demonstrated with the four foundation modules alone.*
