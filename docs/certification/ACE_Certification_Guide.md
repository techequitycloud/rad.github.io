---
title: "Associate Cloud Engineer (ACE) Certification Lab Map"
description: "Map every Associate Cloud Engineer (ACE) exam domain to hands-on RAD deployment labs on Google Cloud — a practical, exam-aligned study path."
---

# Associate Cloud Engineer (ACE) Certification Lab Map

The Associate Cloud Engineer certification validates that you can deploy and secure applications, services, and infrastructure, monitor the operations of multiple projects, and maintain enterprise solutions on Google Cloud — performing common platform tasks, supported by AI tooling, from both the console and the command line. The RAD platform's four foundation modules — `Services_GCP` (shared VPC networking, Cloud SQL, Redis, Filestore, GKE Autopilot, service accounts), `App_CloudRun` (Cloud Run v2 deployment engine), `App_GKE` (GKE deployment engine), and the `App_Common` shared library (secrets, IAM, storage, CMEK, CI/CD plumbing) — give you a live, inspectable lab: every toggle in your deployment portal maps to real GCP resources you can then explore with `gcloud`, `kubectl`, and the console. Application wrapper modules (Django, WordPress, etc.) exist on top of these but are not needed for exam preparation.

## How to use this guide

- Deploy one of the profiles below from your deployment portal, then work through the matching section guide.
- **Profile settings are applied as an Update.** The deploy form asks only for the first page of a module's inputs on create (in a project RAD creates for you, little more than the tenant name and region). Deploy the module first, then set the profile's variables with **Update** on the deployment's page after ticking **Enable advanced mode**, which needs a credit balance that covers the update's estimated build cost.
- Every section-guide subsection has a **Try it** block — do the CLI steps, not just the console clicks. The ACE exam assumes `gcloud`/`kubectl` fluency.
- Use the coverage legend to know which exam topics you must study outside the platform; the section guides flag these in **Beyond the modules** blocks.
- ACE is entry-level: focus on creating, inspecting, and modifying resources, not on architecture trade-offs.

**Coverage legend**

| Symbol | Meaning |
|---|---|
| ✅ | Fully demonstrated — deploy it, see it, modify it in the RAD platform |
| 🟡 | Partially demonstrated — the modules touch the concept; supplement with docs |
| 📘 | Concept-only — not implemented by the modules; study pointers provided |

**Exam scope** — The section tables below follow Google's current ACE exam guide: Section 1 (~20%), Section 2 (~30%), Section 3 (~30%), Section 4 (~20%). The **ACE renewal exam** uses the same objective numbering but assesses only Section 2 (~40%), Section 3 (~40%), and objective 4.2 Managing service accounts (~20%); Section 1 and objective 4.1 are not assessed on renewal.

## Deployment profiles

### Profile: Baseline platform
*Purpose:* the shared infrastructure layer every other profile builds on — VPC, Cloud NAT, private Cloud SQL, NFS/Redis VM, service accounts.
*Modules:* `Services_GCP` only.
| Variable | Value |
|---|---|
| `project_id` | your project ID |
| `tenant_id` | `demo` (default) |
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
| `enable_cloud_armor` (App_CloudRun) | `true`; add `application_domains` only if you want your own hostname |
| `enable_iap` + `iap_authorized_users` (App_CloudRun) | `true` + `["user:you@example.com"]` |

*Estimated incremental cost:* moderate — the global external load balancer (forwarding rule + Cloud Armor policy) is the dominant driver; audit logging adds Cloud Logging volume.

## Section 1: Setting up a cloud solution environment (~20% of the exam)

The modules deploy into an existing project, enable ~45 APIs automatically, create dedicated service accounts, build the project's VPC, wire up monitoring, and can create a real billing budget — but project creation, resource hierarchy, organization policies, Cloud Identity, and billing-account administration remain console/`gcloud` exercises.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 1.1 Enabling APIs within projects | ✅ | `enable_services` (default `true`), `additional_apis` | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Granting members IAM roles within a project | ✅ | dedicated SAs + role bindings | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Setting up cloud networking | ✅ | `Services_GCP` custom-mode VPC, subnets, Cloud NAT (detail in 2.3) | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 1.1 Provisioning and setting up products in Google Cloud Observability | 🟡 | `support_users`, `notification_alert_emails`, dashboards, uptime checks; no Trace/Profiler setup | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 1.1 Assessing quotas and requesting increases | 🟡 | `max_instance_count` and friends consume quotas; no quota management | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Resource hierarchy, organization policies, standalone organizations | 📘 | modules deploy into an existing `project_id` only | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Cloud Identity users/groups, Workforce Identity Federation | 📘 | not implemented | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.1 Product availability by region/zone; Cloud Asset Inventory and Gemini Cloud Assist | 📘 | not implemented | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#11-setting-up-cloud-projects-and-accounts) |
| 1.2 Establishing billing budgets and alerts | ✅ | `create_billing_budget`, `budget_amount` (default `100`), `budget_alert_thresholds` | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#12-managing-billing-configuration) |
| 1.2 Creating billing accounts / linking projects / billing exports | 📘 | billing account is auto-discovered, never managed | [Section 1 guide](ACE_Section_1_Exploration_Guide.md#12-managing-billing-configuration) |

## Section 2: Planning and implementing a cloud solution (~30% of the exam)

The strongest section for the lab: Cloud Run and GKE deployments are fully demonstrated, along with Cloud SQL, GCS, Filestore, Memorystore, a custom-mode VPC, Cloud NAT, VPC firewall rules, and a global external load balancer with Cloud Armor. Compute Engine appears only as the self-managed NFS VM; Cloud Run functions, Agent Runtime, GPUs/TPUs, and the AI-assisted tooling are not implemented.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 2.1 Cloud Run deployment and autoscaling | ✅ | `min_instance_count` (default `0`), `max_instance_count` (default `1`), `container_resources` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 GKE cluster configurations (Autopilot/Standard, regional, private nodes) | ✅ | `gke_cluster_mode` (default `AUTOPILOT`), `create_google_kubernetes_engine` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Deploying a containerized application to GKE | ✅ | `workload_type`, `stateful_pvc_enabled`, `container_resources` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Compute Engine: instance template, MIG, OS Login, disk choice | 🟡 | the NFS VM MIG only | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Serverless processing of Google Cloud events (Pub/Sub, Eventarc) | 🟡 | Eventarc trigger behind `enable_auto_password_rotation` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.1 Cloud Run functions, Agent Runtime, VM Manager, Spot VMs, custom machine types, Hyperdisk, GPUs vs TPUs | 📘 | not implemented | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#21-planning-and-implementing-compute-resources) |
| 2.2 Cloud SQL, GCS, Filestore, Memorystore | ✅ | `create_postgres` (default `true`), `storage_buckets`, `create_filestore_nfs`, `create_redis` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 AlloyDB, Firestore | ✅ | `enable_alloydb`, `create_firestore` (both default `false`) | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 Loading data | 🟡 | `enable_backup_import` loads a database dump from GCS | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 Multi-region redundancy | 🟡 | `storage_buckets[].location` (defaults to the deployment region; accepts a multi-region such as `US`); Cloud SQL `REGIONAL` HA spans zones, not regions | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.2 BigQuery, Spanner, Bigtable, Dataflow, Pub/Sub, Managed Service for Apache Kafka, NetApp Volumes, Managed Lustre, Storage Transfer Service | 📘 | not implemented | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#22-planning-and-implementing-storage-and-data-solutions) |
| 2.3 VPC, subnets, VPC firewall rules, Cloud NAT, PSA | ✅ | `availability_regions`, `subnet_cidr_range` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.3 Choosing and deploying load balancers (with Cloud Armor, CDN) | ✅ | `enable_cloud_armor`, `application_domains`, `enable_cdn` | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.3 Cloud NGFW policies and secure Tags, Shared VPC, VPN/Interconnect, Network Service Tiers | 📘 | not implemented | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#23-planning-and-implementing-networking-resources) |
| 2.4 Infrastructure as Code tooling | 🟡 | Terraform (run as OpenTofu) modules, `deploy_application`, Cloud Build pipelines; no Fabric FAST, Config Connector, or Helm | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#24-planning-and-implementing-resources-using-tooling) |
| 2.4 AI-assisted planning (Gemini CLI, Google Antigravity, Gemini Cloud Assist, Application Design Center) | 📘 | not implemented | [Section 2 guide](ACE_Section_2_Exploration_Guide.md#24-planning-and-implementing-resources-using-tooling) |

## Section 3: Ensuring the successful operation of a cloud solution (~30% of the exam)

Revision management, traffic splitting, CI/CD with Cloud Build and Cloud Deploy, scheduled database backups, CMEK, GCS lifecycle rules, static IPs, Cloud NAT, a full set of preconfigured alert policies, the Ops Agent, Managed Service for Prometheus, and synthetic uptime checks on publicly reachable endpoints are all live. Log routing, the AI and ML workbenches, and the fleet-level consoles are study-outside topics.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 3.1 New Cloud Run versions, traffic splitting, Cloud Run autoscaling | ✅ | `traffic_split`, `max_revisions_to_retain` (default `7`), `min_instance_count`/`max_instance_count` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 Deploying new versions through CI/CD (Cloud Build, Cloud Deploy) | ✅ | `enable_cicd_trigger`, `cloud_deploy_stages` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 GKE inventory, Kubernetes resources, HPA/VPA, Autopilot Pod requests | ✅ | `enable_vertical_pod_autoscaling`, `enable_resource_quota`, `enable_pod_disruption_budget`, `container_resources` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 GKE access to Artifact Registry | ✅ | `roles/artifactregistry.reader` on the GKE SA, `enable_image_mirroring` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 VM access and inventory, snapshots, node pools | 🟡 | NFS VM MIG with daily snapshots; Standard-mode node pool | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.1 GPUs/TPUs, Agent Runtime, Workbench notebooks, Cloud Workstations | 📘 | not implemented | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#31-managing-compute-resources) |
| 3.2 Backing up and restoring Cloud SQL, running SQL | ✅ | `backup_schedule` (default `0 2 * * *`), `enable_backup_import`, `enable_custom_sql_scripts` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-data-solutions) |
| 3.2 Managing and securing GCS objects, lifecycle policies | ✅ | `storage_buckets[].lifecycle_rules`, `public_access_prevention`, `backup_retention_days` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-data-solutions) |
| 3.2 Customer-managed encryption keys (CMEK) | ✅ | `enable_cmek` (Services_GCP, default `false` — set at first deploy only) | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-data-solutions) |
| 3.2 Storage cost estimates, Dataflow/BigQuery job status, Database Center, non-Cloud-SQL backups | 📘 | not implemented | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#32-managing-storage-and-data-solutions) |
| 3.3 Static IPs, Cloud NAT, managing VPC firewall rules | 🟡 | `reserve_static_ip` (default `true`), `availability_regions` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#33-managing-networking-resources) |
| 3.3 Resizing subnets, custom static routes, Cloud DNS, Cloud NGFW policies | 📘 | not implemented | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#33-managing-networking-resources) |
| 3.4 Alerts on resource metrics, uptime checks | ✅ | `support_users`, `alert_policies`, `alert_cpu_threshold` (default `80`), `uptime_check_config` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Audit logs; viewing and filtering logs | ✅ | `enable_audit_logging` | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Ops Agent, Managed Service for Prometheus | ✅ | the NFS VM's startup script installs the Ops Agent; GKE enables Managed Prometheus | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Diagnostic tools | 🟡 | `enable_query_insights` (Services_GCP, default `false`); no Trace/Profiler instrumentation | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |
| 3.4 Custom metrics, log sinks/buckets/Log Analytics, VPC Flow Logs, firewall logs, Personalized Service Health, Gemini Cloud Assist, Active Assist, Cloud Hub | 📘 | not implemented | [Section 3 guide](ACE_Section_3_Exploration_Guide.md#34-monitoring-and-logging) |

## Section 4: Configuring access and security (~20% of the exam)

Strong coverage for service accounts: every module creates dedicated service accounts, App_GKE uses Workload Identity, Services_GCP can create a Workload Identity Federation pool, and resource-level grants (Secret Manager, IAP, buckets) sit alongside broader project-level grants — a realistic policy to audit for minimum permissions. Custom roles and hierarchy-level IAM are study-outside topics.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 4.1 Viewing and creating IAM policies | ✅ | project- and resource-level bindings | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#41-managing-iam) |
| 4.1 Role types (basic, predefined) | 🟡 | predefined roles throughout, plus one basic role (`roles/viewer` on the Cloud Build SA) | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#41-managing-iam) |
| 4.1 Custom roles, policy inheritance in the Organization hierarchy | 📘 | not implemented | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#41-managing-iam) |
| 4.2 Creating SAs and assigning them to resources | ✅ | `cloudrun-sa-*`/`gke-sa-*` runtime identities | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Google-managed service accounts (service agents) | 🟡 | `enable_cmek` grants KMS roles to the Cloud SQL, AlloyDB, Artifact Registry and Cloud Storage service agents | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Minimum-permission and resource-level grants; IAM permissions on an SA | 🟡 | per-secret/per-bucket bindings, `serviceAccountUser` on the workload SA, IAP grants (`enable_iap`) | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 SA with a GKE application; Workload Identity Federation | ✅ | KSA→GSA binding, `enable_workload_identity_federation` | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Service account impersonation | 🟡 | `impersonation_service_account` (App modules) | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
| 4.2 Short-lived credentials, SA key management | 📘 | deliberately keyless — study `gcloud iam service-accounts keys` and token minting separately | [Section 4 guide](ACE_Section_4_Exploration_Guide.md#42-managing-service-accounts) |
