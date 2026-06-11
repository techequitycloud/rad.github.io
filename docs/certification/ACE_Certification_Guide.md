---
title: "Associate Cloud Engineer (ACE) Certification Lab Map"
---

# Associate Cloud Engineer (ACE) Certification Lab Map

The Associate Cloud Engineer certification validates that you can deploy applications, monitor operations, and manage enterprise solutions on Google Cloud using both the console and the command line. The RAD platform's four foundation modules — `Services_GCP` (shared VPC networking, Cloud SQL, Redis, Filestore, GKE Autopilot, service accounts), `App_CloudRun` (Cloud Run v2 deployment engine), `App_GKE` (GKE deployment engine), and the `App_Common` shared library (secrets, IAM, storage, CMEK, CI/CD plumbing) — give you a live, inspectable lab: every toggle in your deployment portal maps to real GCP resources you can then explore with `gcloud`, `kubectl`, and the console. Application wrapper modules (Django, WordPress, etc.) exist on top of these but are not needed for exam preparation.

## How to use this guide

- Deploy one of the profiles below from your deployment portal, then work through the matching section guide.
- Every section-guide subsection has a **Try it** block — do the CLI steps, not just the console clicks. The ACE exam assumes `gcloud`/`kubectl` fluency.
- Use the coverage legend to know which exam topics you must study outside the platform; the section guides flag these in **Beyond the modules** blocks.
- ACE is entry-level: focus on creating, inspecting, and modifying resources, not on architecture trade-offs.

**Coverage legend**

| Symbol | Meaning |
|---|---|
| ✅ | Fully demonstrated — deploy it, see it, modify it in the RAD platform |
| 🟡 | Partially demonstrated — the modules touch the concept; supplement with docs |
| 📘 | Concept-only — not implemented by the modules; study pointers provided |

## Deployment profiles

### Profile: Baseline platform
*Purpose:* the shared infrastructure layer every other profile builds on — VPC, Cloud NAT, private Cloud SQL, NFS/Redis VM, service accounts.
*Modules:* `Services_GCP` only.
| Variable | Value |
|---|---|
| `project_id` | your project ID |
| `tenant_deployment_id` | `demo` (default) |
| `create_postgres` | `true` (default) |
| `create_network_filesystem` | `true` (default) |
| `support_users` | your email address |
| `resource_labels` | `{ environment = "dev", cost-center = "lab" }` |

*Estimated incremental cost:* low–moderate — the dominant drivers are the `db-custom-1-3840` Cloud SQL instance and the `e2-small` NFS VM running 24/7.

### Profile: Serverless application
*Purpose:* Cloud Run service with database, storage buckets, NFS mount, revisions, and scheduled backups — covers most of Sections 2 and 3.
*Modules:* Baseline platform + `App_CloudRun`.
| Variable | Value |
|---|---|
| `container_image_source` | `prebuilt` |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` |
| `min_instance_count` | `0` (default — scale to zero) |
| `max_instance_count` | `3` |
| `database_type` | `POSTGRES` (default) |
| `storage_buckets` | one entry, e.g. `[{ name_suffix = "media" }]` |
| `support_users` | your email address |

*Estimated incremental cost:* low — Cloud Run scales to zero; cost is dominated by what the baseline platform already runs.

### Profile: Kubernetes application
*Purpose:* GKE Autopilot cluster plus a namespaced workload with HPA, ResourceQuota, PodDisruptionBudget, and NetworkPolicy — the `kubectl` half of the exam.
*Modules:* `Services_GCP` (re-applied with GKE enabled) + `App_GKE`.
| Variable | Value |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `gke_cluster_mode` (Services_GCP) | `AUTOPILOT` (default) |
| `container_image_source` (App_GKE) | `prebuilt` |
| `container_image` (App_GKE) | `us-docker.pkg.dev/cloudrun/container/hello` |
| `enable_resource_quota` (App_GKE) | `true` |
| `enable_network_segmentation` (App_GKE) | `true` |

*Estimated incremental cost:* moderate — Autopilot bills per pod resource request plus the cluster management fee.

### Profile: Operations & security add-ons
*Purpose:* billing budget, alerting, audit logs, edge security, and IAP for Sections 1, 3.4, and 4. Apply on top of either application profile.
*Modules:* `Services_GCP` + one application module.
| Variable | Value |
|---|---|
| `create_billing_budget` (Services_GCP) | `true` |
| `budget_amount` (Services_GCP) | `100` (default) |
| `configure_email_notification` (Services_GCP) | `true` |
| `notification_alert_emails` (Services_GCP) | your email address |
| `enable_audit_logging` (Services_GCP or app module) | `true` |
| `enable_cloud_armor` + `application_domains` (App_CloudRun) | `true` + a domain you control |
| `enable_iap` + `iap_authorized_users` (App_CloudRun) | `true` + `["user:you@example.com"]` |

*Estimated incremental cost:* moderate — the global external load balancer (forwarding rule + Cloud Armor policy) is the dominant driver; audit logging adds Cloud Logging volume.

## Section 1: Setting up a cloud solution environment (~23% of the exam)

The modules deploy into an existing project, enable ~45 APIs automatically, create least-privilege service accounts, and can create a real billing budget — but project creation, resource hierarchy, and Cloud Identity remain console/`gcloud` exercises.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 1.1 Enabling APIs within projects | ✅ | `enable_services` (default `true`), `additional_apis` | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Granting IAM roles within a project | ✅ | dedicated SAs + predefined-role bindings | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Creating projects / resource hierarchy / Cloud Identity | 📘 | modules deploy into an existing `project_id` only | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Assessing quotas | 🟡 | `max_instance_count` and friends consume quotas; no quota management | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.2 Budgets and alerts | ✅ | `create_billing_budget`, `budget_amount` (default `100`), `budget_alert_thresholds` | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#12-managing-billing-configuration) |
| 1.2 Linking billing accounts / billing exports | 📘 | billing account is auto-discovered, never managed | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#12-managing-billing-configuration) |

## Section 2: Planning and implementing a cloud solution (~30% of the exam)

The strongest section for the lab: Cloud Run and GKE deployments are fully demonstrated, along with Cloud SQL, GCS, Filestore, Memorystore, a custom-mode VPC, Cloud NAT, firewall rules, and a global external load balancer with Cloud Armor. Compute Engine appears only as the self-managed NFS VM; App Engine and Cloud Functions are not implemented.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 2.1 Cloud Run deployment and autoscaling | ✅ | `min_instance_count` (default `0`), `max_instance_count` (default `1`), `container_resources` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 GKE workloads (Deployment/StatefulSet, HPA) | ✅ | `workload_type`, `stateful_pvc_enabled`, `container_resources` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Compute Engine VMs / MIGs | 🟡 | the NFS VM MIG only | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 App Engine, Cloud Functions, Spot VMs | 📘 | not implemented | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.2 Cloud SQL, GCS, Filestore, Memorystore | ✅ | `create_postgres` (default `true`), `storage_buckets`, `create_filestore_nfs`, `create_redis` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 AlloyDB, Firestore | ✅ | `enable_alloydb`, `create_firestore` (both default `false`) | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 BigQuery, Spanner, Bigtable, Pub/Sub messaging | 📘 | not implemented | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.3 VPC, subnets, firewall rules, Cloud NAT, PSA | ✅ | `availability_regions`, `subnet_cidr_range` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.3 Load balancing, Cloud Armor, CDN | ✅ | `enable_cloud_armor`, `application_domains`, `enable_cdn` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.3 Shared VPC, Cloud DNS, VPN/Interconnect | 📘 | not implemented | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.4 Infrastructure as code workflow | 🟡 | the entire repository (OpenTofu modules), `deploy_application`, Cloud Build pipelines; portal abstracts state | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#24-planning-and-implementing-resources-through-infrastructure-as-code) |

## Section 3: Ensuring successful operation of a cloud solution (~27% of the exam)

Revision management, traffic splitting, CI/CD with Cloud Build and Cloud Deploy, scheduled database backups, GCS lifecycle rules, static IPs, a full set of preconfigured alert policies, and synthetic uptime checks on publicly reachable endpoints are all live. Log routing/sinks are study-outside topics.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 3.1 Revisions, traffic splitting, canary releases | ✅ | `traffic_split`, `max_revisions_to_retain` (default `7`) | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 CI/CD with Cloud Build and Cloud Deploy | ✅ | `enable_cicd_trigger`, `cloud_deploy_stages` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 Kubernetes operations (kubectl, HPA, PDB, quota) | ✅ | `enable_resource_quota`, `enable_pod_disruption_budget` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 VM lifecycle, SSH, snapshots, node pools | 🟡 | NFS VM MIG with daily snapshots | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.2 Database backups, restore, custom SQL | ✅ | `backup_schedule` (default `0 2 * * *`), `enable_backup_import`, `enable_custom_sql_scripts` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-database-solutions) |
| 3.2 GCS object lifecycle and versioning | ✅ | `storage_buckets[].lifecycle_rules`, `backup_retention_days` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-database-solutions) |
| 3.3 Static IPs, multi-region subnets | 🟡 | `reserve_static_ip` (default `true`), `availability_regions` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#33-managing-networking-resources) |
| 3.3 Routes, peering, DNS operations | 📘 | not implemented | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#33-managing-networking-resources) |
| 3.4 Alert policies, channels, dashboards | ✅ | `support_users`, `alert_policies`, `alert_cpu_threshold` (default `80`) | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Audit logs | ✅ | `enable_audit_logging` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Uptime checks | ✅ | `uptime_check_config` (default `{ enabled = true, path = "/" }`) | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Log sinks, log-based metrics | 📘 | not implemented | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |

## Section 4: Configuring access and security (~20% of the exam)

Strong coverage: every module creates dedicated least-privilege service accounts, App_GKE uses Workload Identity, Services_GCP can create a Workload Identity Federation pool, secrets live in Secret Manager with optional automatic rotation, and IAP can gate both platforms.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 4.1 Viewing and creating IAM policies, role types | ✅ | predefined-role-only bindings, per-resource grants | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#41-managing-identity-and-access-management-iam) |
| 4.1 Audit logs for access review | ✅ | `enable_audit_logging` | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#41-managing-identity-and-access-management-iam) |
| 4.1 Custom roles, IAM Conditions, Policy Troubleshooter | 📘 | not implemented | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#41-managing-identity-and-access-management-iam) |
| 4.2 Dedicated service accounts on compute | ✅ | `cloudrun-sa-*`/`gke-sa-*` runtime identities | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Workload Identity (GKE) and WIF (keyless CI) | ✅ | KSA→GSA binding, `enable_workload_identity_federation` | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Secret Manager and rotation | ✅ | `secret_environment_variables`, `enable_auto_password_rotation` | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 IAP identity-gated access | ✅ | `enable_iap`, `iap_authorized_users`/`iap_authorized_groups` | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 SA key management, short-lived tokens | 📘 | deliberately keyless — study `gcloud iam service-accounts keys` separately | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
