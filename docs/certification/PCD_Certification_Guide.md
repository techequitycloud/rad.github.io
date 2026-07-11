---
title: "Professional Cloud Developer (PCD) Certification Lab Map"
description: "Map every Professional Cloud Developer (PCD) exam domain to hands-on RAD deployment labs on Google Cloud — a practical, exam-aligned study path."
---

# Professional Cloud Developer (PCD) Certification Lab Map

The Professional Cloud Developer certification validates your ability to design, build, test, deploy, and integrate scalable applications on Google Cloud — with a strong emphasis on Cloud Run, GKE, Cloud Build, Artifact Registry, Cloud Deploy, runtime secrets, service authentication, and observability. The RAD platform's four foundation modules (`Services_GCP`, `App_CloudRun`, `App_GKE`, `App_Common`) give you a live lab for exactly these skills: `Services_GCP` provisions the shared platform (VPC, Cloud SQL, Redis, GKE Autopilot, Artifact Registry, Binary Authorization, Workload Identity Federation), `App_CloudRun` and `App_GKE` are full-featured deployment engines for Cloud Run v2 services and Kubernetes workloads, and `App_Common` supplies the shared submodules they both use (secrets and rotation, Cloud Build container builds, Cloud Deploy pipelines, IAM, storage, monitoring). Application wrapper modules (Django, Wordpress, etc.) exist on the platform but everything in these guides uses the foundation modules directly.

## How to use this guide

- Deploy one of the profiles below through your deployment portal, then work through the matching section exploration guide.
- Every section guide pairs portal variables with the GCP console views and `gcloud`/`kubectl` commands the exam expects you to know.
- Use the coverage legend to plan study time: 🟡 and 📘 topics include a "Beyond the modules" block telling you what to practice outside the platform.
- PCD is a *developer* exam: when working through the labs, always ask "what would my application code see?" — the env vars, the secret refs, the socket paths, the tokens.

**Coverage legend**

| Symbol | Meaning |
|---|---|
| ✅ | Fully demonstrated — deploy it, see it, modify it in the RAD platform |
| 🟡 | Partially demonstrated — the modules touch the concept; supplement with docs |
| 📘 | Concept-only — not implemented by the modules; study pointers provided |

## Deployment profiles

### Profile: Serverless baseline
*Purpose:* a default Cloud Run v2 service with database, probes, and runtime secrets — the workhorse for Sections 1, 3.1, and 4.
*Modules:* `Services_GCP` (defaults), then `App_CloudRun`.

| Variable | Value |
|---|---|
| `create_postgres` (Services_GCP) | `true` (default) |
| `deploy_application` | `true` (default) |
| `min_instance_count` | `0` (default — scale to zero) |
| `max_instance_count` | `3` (raise from default `1` to observe scale-out) |
| `database_type` | `"POSTGRES"` (default) |
| `startup_probe_config` / `health_check_config` | defaults (HTTP `/healthz`) |

*Estimated incremental cost:* low — Cloud Run scales to zero; the dominant costs are the `db-custom-1-3840` Cloud SQL instance and the `e2-small` NFS VM that `Services_GCP` creates by default.

### Profile: Delivery pipeline
*Purpose:* GitHub-triggered Cloud Build (Kaniko) → Artifact Registry → Cloud Deploy progressive delivery with Binary Authorization attestation. Sections 2 and 3.1.
*Modules:* `Services_GCP` + `App_CloudRun`.

| Variable | Value |
|---|---|
| `enable_cicd_trigger` | `true` |
| `github_repository_url` | your repo URL |
| `enable_cloud_deploy` | `true` |
| `cicd_enable_cloud_deploy` | `true` |
| `cloud_deploy_stages` | default (`dev`, `staging`, `prod` with `require_approval = true` on prod) |
| `enable_binary_authorization` (both modules) | `true` |
| `binauthz_evaluation_mode` | `"REQUIRE_ATTESTATION"` |
| `enable_vulnerability_scanning` (Services_GCP) | `true` |
| `enable_workload_identity_federation` (Services_GCP) | `true` |

*Estimated incremental cost:* low/moderate — three per-stage Cloud Run services (all can scale to zero) plus Cloud Build minutes per push.

### Profile: Kubernetes lab
*Purpose:* GKE Autopilot deployment with Workload Identity, HPA, namespace governance, and the Secret Manager CSI add-on. Sections 1.1, 3.2, and 4.2.
*Modules:* `Services_GCP` with GKE enabled, then `App_GKE`.

| Variable | Value |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `gke_cluster_mode` (Services_GCP) | `"AUTOPILOT"` (default) |
| `min_instance_count` / `max_instance_count` (App_GKE) | `1` / `3` (defaults) |
| `enable_resource_quota` (App_GKE) | `true` |
| `enable_network_segmentation` (App_GKE) | `true` |
| `enable_pod_disruption_budget` (App_GKE) | `true` (default) |

*Estimated incremental cost:* moderate — Autopilot bills per pod resource request plus the cluster management fee; the default 1000m/512Mi pod is the dominant driver.

### Profile: Hardened edge
*Purpose:* IAP authentication, Cloud Armor WAF + global HTTPS load balancer, automatic secret rotation, and Memorystore caching. Sections 1.1, 1.2, and 4.1.
*Modules:* `Services_GCP` with Redis, then `App_CloudRun`.

| Variable | Value |
|---|---|
| `create_redis` (Services_GCP) | `true` |
| `redis_tier` (Services_GCP) | `"BASIC"` (default) |
| `enable_iap` | `true` (plus `iap_authorized_users`) |
| `enable_cloud_armor` | `true` (requires `application_domains` — see Section 1 guide) |
| `application_domains` | a domain you control |
| `enable_auto_password_rotation` | `true` |
| `secret_rotation_period` | `"2592000s"` (default, 30 days) |

*Estimated incremental cost:* moderate — the global external Application Load Balancer forwarding rule and the 1 GB Memorystore instance bill continuously even when the Cloud Run service is idle. IAP alone (without Cloud Armor) adds no LB cost.

## Section 1: Designing highly scalable, available, and reliable cloud-native applications (~36% of the exam)

The largest section. The modules demonstrate platform selection (Cloud Run vs GKE), scaling behavior, revision-based traffic splitting, runtime secrets, IAP, Binary Authorization, and storage selection. API management products and application messaging are study-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 1.1 Platform choice, scaling, cold starts | ✅ | `min_instance_count`, `max_instance_count`, `cpu_always_allocated`, `execution_environment` | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.1 Traffic splitting, canary, rollback | ✅ | `traffic_split`, `max_revisions_to_retain` (App_CloudRun) | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.1 Caching, CDN, session affinity | 🟡 | `create_redis`, `enable_redis`, `enable_cdn`; session affinity hardcoded on | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.1 REST/gRPC APIs, API management, async messaging | 🟡 | `container_protocol = "h2c"` enables end-to-end HTTP/2 (gRPC-ready) on Cloud Run and `appProtocol kubernetes.io/h2c` on the GKE Service; API management and messaging are study-only | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#11-designing-high-performing-applications-and-apis) |
| 1.2 Secrets at runtime + rotation | ✅ | `secret_environment_variables`, `enable_auto_password_rotation`, `secret_rotation_period` | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.2 End-user auth (IAP), supply-chain security | ✅ | `enable_iap`, `enable_binary_authorization`, `enable_vulnerability_scanning` | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.2 CMEK, audit logs, network segmentation | 🟡 | `enable_cmek`, `enable_audit_logging`, `enable_network_segmentation` | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#12-designing-secure-applications) |
| 1.3 Relational/object/cache storage selection | ✅ | `create_postgres`, `create_mysql`, `storage_buckets`, `create_redis`, `enable_alloydb` | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#13-storing-and-accessing-data) |
| 1.3 Firestore, Spanner, Bigtable, BigQuery, signed URLs | 📘 | `create_firestore` provisions the DB only — SDK usage is study-only | [Section 1 guide](PCD_Section_1_Exploration_Guide.md#13-storing-and-accessing-data) |

## Section 2: Building and testing applications (~23% of the exam)

The build pipeline is the strongest coverage in the repo: every deployment runs real Cloud Build jobs (Kaniko or Docker), pushes to Artifact Registry with cleanup policies, and can sign images for Binary Authorization. Local tooling and emulators are study-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 2.1 Local dev environment, emulators, Cloud Code/Shell/Workstations | 📘 | nearest: per-tenant isolated deployments via `tenant_deployment_id` | [Section 2 guide](PCD_Section_2_Exploration_Guide.md#21-setting-up-your-development-environment) |
| 2.2 Cloud Build container builds | ✅ | `container_image_source = "custom"`, `container_build_config` | [Section 2 guide](PCD_Section_2_Exploration_Guide.md#22-building) |
| 2.2 Artifact Registry, image lifecycle, mirroring | ✅ | `max_images_to_retain`, `image_retention_days`, `delete_untagged_images`, Crane digest-aware mirroring | [Section 2 guide](PCD_Section_2_Exploration_Guide.md#22-building) |
| 2.2 CI triggers, Kaniko, attestation | ✅ | `enable_cicd_trigger`, `cicd_trigger_config`, Kaniko v1.23.2, pipeline image signing | [Section 2 guide](PCD_Section_2_Exploration_Guide.md#22-building) |
| 2.3 Unit/integration testing in CI | 🟡 | generated build pipeline is extensible; no test step ships by default | [Section 2 guide](PCD_Section_2_Exploration_Guide.md#23-testing) |

## Section 3: Deploying applications (~20% of the exam)

Both deployment targets are fully implemented. `App_CloudRun` covers revisions, scaling, probes, volumes, jobs, and Cloud Deploy promotion; `App_GKE` covers Deployments/StatefulSets, HPA/VPA, probes, quotas, PDBs, and the Gateway API.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 3.1 Cloud Run service configuration (scaling, CPU, gen2, timeout) | ✅ | `min/max_instance_count`, `cpu_always_allocated`, `execution_environment`, `timeout_seconds` | [Section 3 guide](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| 3.1 Revisions, traffic management, rollback | ✅ | `traffic_split`, `max_revisions_to_retain` | [Section 3 guide](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| 3.1 Cloud Deploy progressive delivery | ✅ | `enable_cloud_deploy`, `cloud_deploy_stages`, `cicd_enable_cloud_deploy` | [Section 3 guide](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| 3.1 Cloud Run jobs (migrations, init) | ✅ | `initialization_jobs`, `cron_jobs` | [Section 3 guide](PCD_Section_3_Exploration_Guide.md#31-deploying-applications-to-cloud-run) |
| 3.2 GKE workloads, resources, probes | ✅ | `workload_type`, `container_resources`, `startup_probe_config`, `health_check_config` | [Section 3 guide](PCD_Section_3_Exploration_Guide.md#32-deploying-containers-to-gke) |
| 3.2 HPA/VPA, quotas, PDBs, exposure | ✅ | `min/max_instance_count`, `enable_vertical_pod_autoscaling`, `enable_resource_quota`, `enable_custom_domain` | [Section 3 guide](PCD_Section_3_Exploration_Guide.md#32-deploying-containers-to-gke) |

## Section 4: Integrating applications with Google Cloud services (~21% of the exam)

Database connectivity (Cloud SQL Auth Proxy on both platforms), runtime configuration injection, Workload Identity, and alerting are demonstrated live. Client-library coding, tracing, and profiling are study-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 4.1 Cloud SQL connectivity (sockets, sidecar proxy) | ✅ | `enable_cloudsql_volume`, `cloudsql_volume_mount_path`, GKE proxy sidecar | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#41-integrating-applications-with-data-and-storage-services) |
| 4.1 Storage integration (GCS Fuse, NFS, Redis) | ✅ | `gcs_volumes`, `enable_nfs`, `enable_redis` | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#41-integrating-applications-with-data-and-storage-services) |
| 4.1 Pub/Sub & Firestore application code | 📘 | only rotation/SCC topics exist — no app messaging | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#41-integrating-applications-with-data-and-storage-services) |
| 4.2 Service accounts, ADC, Workload Identity | ✅ | per-app SAs, KSA annotation `iam.gke.io/gcp-service-account`, `additional_cloudrun_sa_roles` | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#42-consuming-google-cloud-apis) |
| 4.2 Workload Identity Federation (keyless CI) | ✅ | `enable_workload_identity_federation`, `wif_provider_type` | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#42-consuming-google-cloud-apis) |
| 4.2 Service-to-service auth (ID tokens) | 🟡 | `roles/run.invoker` bindings (IAP agent, allUsers); calling code is study-only | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#42-consuming-google-cloud-apis) |
| 4.3 Logging, metrics, alerting, dashboards | ✅ | `support_users`, `alert_policies` (the platform's monitoring and dashboard layers) | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#43-troubleshooting-and-observability) |
| 4.3 Uptime checks | ✅ | `uptime_check_config` creates a `<service>-uptime-check` + alert policy on publicly reachable endpoints | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#43-troubleshooting-and-observability) |
| 4.3 Trace, Profiler, Error Reporting | 📘 | not implemented — study-only | [Section 4 guide](PCD_Section_4_Exploration_Guide.md#43-troubleshooting-and-observability) |
