---
title: "Professional Cloud Security Engineer (PSE) Certification Lab Map"
description: "Map every Professional Cloud Security Engineer (PSE) exam domain to hands-on RAD deployment labs on Google Cloud — a practical, exam-aligned study path."
---

# Professional Cloud Security Engineer (PSE) Certification Lab Map
> 📚 **Official exam guide:** [Professional Cloud Security Engineer certification](https://cloud.google.com/learn/certification/cloud-security-engineer) — always confirm section weightings against the current Google Cloud exam guide.


The PSE certification validates your ability to design and implement secure workloads and infrastructure on Google Cloud — identity and access management, perimeter and boundary protection, data protection, security operations, and regulatory compliance. The RAD platform's four foundation modules (`Services_GCP`, `App_CloudRun`, `App_GKE`, `App_Common`) form a live security lab: they implement least-privilege service accounts, Workload Identity, IAP, Secret Manager with automated zero-downtime rotation, CMEK with plan-time key recovery, Binary Authorization with a KMS signer and attestor, VPC Service Controls with access levels and dry-run mode, Cloud Armor WAF, Kubernetes NetworkPolicy micro-segmentation, audit log configuration, and Security Command Center enrollment — all driven by portal variables you can toggle and observe.

## How to use this guide

- Deploy one of the profiles below from your deployment portal.
- Work through the matching section guide (`PSE_Section_<N>_Exploration_Guide.md`) topic by topic.
- Use the coverage legend to know which exam topics you must study outside the platform — the section guides give concrete study pointers for every 🟡 and 📘 topic.

**Coverage legend**

| Symbol | Meaning |
|---|---|
| ✅ | Fully demonstrated — deploy it, see it, modify it in the RAD platform |
| 🟡 | Partially demonstrated — the modules touch the concept; supplement with docs |
| 📘 | Concept-only — not implemented by the modules; study pointers provided |

## Deployment profiles

### Profile: secure-platform
*Purpose:* a hardened shared platform exercising CMEK, audit logging, SCC, vulnerability scanning, and Binary Authorization.
*Modules:* `Services_GCP`.
| Variable | Value |
|---|---|
| `create_postgres` | `true` (default) |
| `enable_cmek` | `true` |
| `cmek_key_rotation_period` | `7776000s` (default, 90 days) |
| `enable_audit_logging` | `true` |
| `enable_security_command_center` | `true` |
| `enable_scc_notifications` | `true` |
| `enable_vulnerability_scanning` | `true` |
| `enable_binary_authorization` | `true` |
| `binauthz_evaluation_mode` | `REQUIRE_ATTESTATION` |
*Estimated incremental cost:* low–moderate — KMS keys cost cents per month; the dominant drivers are the Cloud SQL instance baseline and increased Cloud Logging volume from DATA_READ/DATA_WRITE audit logs.

### Profile: guarded-edge
*Purpose:* a Cloud Run service protected by IAP, a Cloud Armor WAF behind a global HTTPS load balancer, and automated secret rotation.
*Modules:* `App_CloudRun` (optionally on top of secure-platform).
| Variable | Value |
|---|---|
| `enable_iap` | `true` |
| `iap_authorized_users` | `["user:you@example.com"]` |
| `enable_cloud_armor` | `true` |
| `application_domains` | `["app.example.com"]` (required when Cloud Armor is on) |
| `enable_auto_password_rotation` | `true` |
| `secret_rotation_period` | `2592000s` (default, 30 days) |
| `enable_audit_logging` | `true` |
*Estimated incremental cost:* moderate — the global external Application Load Balancer forwarding rules and the Cloud Armor policy are the dominant drivers; IAP and Secret Manager rotation are negligible.

### Profile: zero-trust-gke
*Purpose:* a GKE Autopilot workload with Workload Identity, NetworkPolicy micro-segmentation, namespace quotas, and IAP at the Gateway.
*Modules:* `Services_GCP` + `App_GKE`.
| Variable | Value |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `enable_network_segmentation` | `true` |
| `enable_resource_quota` | `true` |
| `enable_custom_domain` | `true` + `application_domains` |
| `enable_cloud_armor` | `true` |
| `enable_iap` | `true` + `iap_oauth_client_id`, `iap_oauth_client_secret`, `iap_support_email` |
*Estimated incremental cost:* high — the GKE Autopilot cluster is the dominant cost driver; the Gateway load balancer and Cloud Armor add a moderate increment.

### Profile: perimeter-lab
*Purpose:* a VPC Service Controls perimeter in dry-run mode around the project's APIs. Requires a project in a GCP organization and org-level Access Context Manager permission.
*Modules:* any of `Services_GCP`, `App_CloudRun`, `App_GKE` (each can create its own perimeter).
| Variable | Value |
|---|---|
| `enable_vpc_sc` | `true` |
| `admin_ip_ranges` | `["<your-public-ip>/32"]` (required — perimeter is skipped without it) |
| `vpc_sc_dry_run` | `true` (default — audit before enforcing) |
| `organization_id` (App_CloudRun / App_GKE only) | set only if the project is nested under a folder |
*Estimated incremental cost:* none — VPC-SC, access levels, and Access Context Manager are free.

## Section 1: Configuring access (~25% of the exam)

Identity and authorization is where the modules are strongest on the "workload identity" side (dedicated service accounts, Workload Identity, per-resource IAM) and weakest on the "human identity" side (Cloud Identity, SSO, org policy), which you must study separately.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 1.1 Managing Cloud Identity | 📘 | identities consumed via `iap_authorized_users/groups`, `support_users` | [Section 1 guide](PSE_Section_1_Exploration_Guide.md#11-managing-cloud-identity) |
| 1.2 Managing service accounts | ✅ | purpose-built service accounts with Workload Identity; WIF via `enable_workload_identity_federation` + `wif_provider_type` | [Section 1 guide](PSE_Section_1_Exploration_Guide.md#12-managing-service-accounts) |
| 1.3 Managing authentication | 🟡 | `enable_iap` on Cloud Run and GKE | [Section 1 guide](PSE_Section_1_Exploration_Guide.md#13-managing-authentication) |
| 1.4 Managing and implementing authorization controls | ✅ | the platform's resource-level IAM layer, per-secret/per-bucket IAM | [Section 1 guide](PSE_Section_1_Exploration_Guide.md#14-managing-and-implementing-authorization-controls) |
| 1.5 Defining the resource hierarchy | 📘 | org/folder/standalone detection in the VPC Service Controls layer is the nearest adjacency | [Section 1 guide](PSE_Section_1_Exploration_Guide.md#15-defining-the-resource-hierarchy) |

## Section 2: Securing communications and establishing boundary protection (~22% of the exam)

The modules implement three distinct boundary layers you can deploy and break on purpose: an edge WAF (Cloud Armor + global HTTPS LB), an API-level data-exfiltration perimeter (VPC Service Controls), and pod-level micro-segmentation (Kubernetes NetworkPolicy on Dataplane V2).

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 2.1 Designing and configuring perimeter security | ✅ | `enable_cloud_armor` on Cloud Run and GKE | [Section 2 guide](PSE_Section_2_Exploration_Guide.md#21-designing-and-configuring-perimeter-security) |
| 2.2 Configuring boundary segmentation | ✅ | `enable_vpc_sc`, `enable_network_segmentation` (Kubernetes NetworkPolicy), private-IP Cloud SQL | [Section 2 guide](PSE_Section_2_Exploration_Guide.md#22-configuring-boundary-segmentation) |
| 2.3 Establishing private connectivity | 🟡 | Direct VPC egress, Private Services Access, Cloud NAT | [Section 2 guide](PSE_Section_2_Exploration_Guide.md#23-establishing-private-connectivity) |

## Section 3: Ensuring data protection (~23% of the exam)

Secret Manager with automated dual-version rotation and CMEK with plan-time key recovery are the standout hands-on labs here. Sensitive Data Protection (DLP) and AI workload security are concept-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 3.1 Protecting sensitive data and preventing data loss | 🟡 | Secret Manager rotation pipeline, `enable_auto_password_rotation`; DLP is 📘 | [Section 3 guide](PSE_Section_3_Exploration_Guide.md#31-protecting-sensitive-data-and-preventing-data-loss) |
| 3.2 Managing encryption at rest, in transit, and in use | ✅ | `enable_cmek`, TLS at the LB; EKM/HSM/Confidential Computing are 📘 | [Section 3 guide](PSE_Section_3_Exploration_Guide.md#32-managing-encryption-at-rest-in-transit-and-in-use) |
| 3.3 Securing AI workloads | 📘 | not implemented by the foundation modules | [Section 3 guide](PSE_Section_3_Exploration_Guide.md#33-securing-ai-workloads) |

## Section 4: Managing operations (~19% of the exam)

The supply-chain story is fully wired: Cloud Build → Artifact Registry scanning → KMS-signed attestation → Binary Authorization admission enforcement. Detection is covered through audit log configuration and SCC findings routed to Pub/Sub.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 4.1 Automating infrastructure and application security | ✅ | `enable_binary_authorization`, `enable_vulnerability_scanning`, CI/CD attestation | [Section 4 guide](PSE_Section_4_Exploration_Guide.md#41-automating-infrastructure-and-application-security) |
| 4.2 Configuring logging, monitoring, and detection | 🟡 | `enable_audit_logging`, `enable_security_command_center` + `enable_scc_notifications`; flow logs / sinks / IDS are 📘 | [Section 4 guide](PSE_Section_4_Exploration_Guide.md#42-configuring-logging-monitoring-and-detection) |

## Section 5: Supporting compliance requirements (~11% of the exam)

The modules demonstrate the technical controls that compliance frameworks demand (CMEK, audit trails, least privilege, perimeters) and the shared-responsibility narrowing of GKE Autopilot — but framework mapping, Assured Workloads, and Access Transparency are study-only topics.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 5.1 Adhering to regulatory and industry standards requirements for the cloud | 🟡 | composed controls across all four modules; Assured Workloads / Access Transparency are 📘 | [Section 5 guide](PSE_Section_5_Exploration_Guide.md#51-adhering-to-regulatory-and-industry-standards-requirements-for-the-cloud) |
