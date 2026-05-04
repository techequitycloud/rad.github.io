---
title: "Multicloud"
sidebar_label: "Multicloud"
---

# Multicloud

This repo approaches multicloud from two complementary angles: concrete infrastructure modules that register non-GCP Kubernetes clusters as first-class GCP fleet members, and an architectural design that makes workloads inherently portable across cloud providers.

## Architectural readiness: cloud-agnostic by design

### Cloud-agnostic IaC engine

OpenTofu is the engine — see [practices/gitops_iac.md](../practices/gitops_iac.md) for the canonical detail. The four-tier module pattern (canonical in [practices/platform_engineering.md](../practices/platform_engineering.md)) hard-binds only the Platform tier to GCP; sibling `Services_AWS` / `Services_Azure` modules would slot in without changing Common or Application contracts.

### Container-portable workloads

- Application source lives in `modules/<App>_Common/scripts/` as standard `Dockerfile`s — no GCP-specific runtime assumptions baked into application images.
- The application catalogue is the open-source ecosystem itself — none of these apps are GCP-locked.
- OCI images are the unit of portability; Artifact Registry happens to be where they live today. The image source is parameterised (`container_image_source`, `container_image`) — swapping to another registry requires only a variable change.
- GCP-specific concerns in `App_CloudRun` (Workload Identity, Cloud SQL Auth Proxy, GCS Fuse, Binary Authorization) are isolated to a handful of files, making them natural seams for replacement strategies when targeting non-GCP runtimes.

### Kubernetes as the portability layer

`modules/App_GKE` deploys via standard Kubernetes primitives (Deployment, StatefulSet, CronJob, Job, NetworkPolicy, Gateway API). Most of the manifests would apply unmodified to AWS EKS, Azure AKS, on-prem Kubernetes (Anthos, OpenShift, Rancher), or KIND/k3s. GCP-specific concerns (Workload Identity, Cloud SQL Proxy, GCS Fuse) are isolated to a handful of files — natural integration seams for replacement strategies.

### Open standards, no vendor-lock primitives

- OpenTofu instead of proprietary Terraform Cloud / Terraform Enterprise.
- Standard Kubernetes APIs (Deployment, Gateway API, NetworkPolicy) instead of GCP-only constructs.
- Open-source applications instead of proprietary SaaS.
- OCI containers instead of cloud-specific package formats.
- Standard SQL (MySQL 8.0, PostgreSQL 14/15/16) and Redis protocols — these workloads migrate to any compatible managed service (RDS, Azure Database, ElastiCache, etc.) without application code changes.

## Concrete implementation: GKE Attached Clusters

The `AKS_GKE` and `EKS_GKE` modules implement the canonical "register a non-GCP cluster as a first-class GCP fleet member" pattern:

| Module | Cloud | What it provisions |
|---|---|---|
| `modules/AKS_GKE/` | Microsoft Azure | AKS cluster + Azure VNet (inline in `main.tf`) + GCP Fleet membership + GKE Connect agent via Helm |
| `modules/EKS_GKE/` | AWS | EKS cluster + AWS VPC (`vpc.tf`) + AWS IAM roles for EKS (`iam.tf`) + GCP Fleet membership + GKE Connect agent via Helm |

Both modules enable the same set of GCP APIs covering `gkemulticloud`, `gkeconnect`, `connectgateway`, `cloudresourcemanager`, `anthos`, `monitoring`, `logging`, `gkehub`, `opsconfigmonitoring`, and `kubernetesmetadata`.

The Fleet mechanics (Connect Agent installer submodule, Connect Gateway, ACM) are documented in [hybrid-cloud](hybrid-cloud).

### Optional Anthos Service Mesh

`modules/AKS_GKE/modules/attached-install-mesh/` and the EKS equivalent install ASM on the attached cluster. Not invoked automatically — callers opt in. See [service-mesh](service-mesh).

### Multi-cluster within GCP

`modules/MC_Bank_GKE/` is the GCP-only equivalent of the same pattern: multiple GKE clusters across regions, joined by fleet-wide Cloud Service Mesh, fronted by Multi-Cluster Ingress and Multi-Cluster Services behind a single global HTTPS LB. It is the reference for extending the same model to a true multi-cloud topology when combined with attached clusters.

The multi-cluster topology also serves as the multi-region / multi-cloud foundation, detailed in [networking](networking) §4.

### Hybrid surface

- **VMware Engine** — the standard hybrid landing zone for migrating on-prem VMware workloads into GCP without refactoring. See [outcomes/modernisation.md](../outcomes/modernisation.md).
- **Workload Identity Federation** — federates AWS, Azure AD, Okta, GitHub Actions identities into GCP — the same federation pattern is the bridge for multicloud CI/CD. Canonical in [practices/devsecops.md](../practices/devsecops.md) §2.
- VPN/Interconnect-friendly VPC topology — see [networking](networking).

## Operational considerations

### Resilience boundary

Attached clusters are independent Kubernetes clusters — if GCP control-plane connectivity is lost, the AKS or EKS workloads continue running. GCP-dependent features (Multi-Cluster Ingress health checks, Connect Gateway API access, ASM managed control-plane updates) will be degraded or unavailable until connectivity is restored, but in-cluster traffic and the local Kubernetes control plane are unaffected.

### Egress costs and latency

Cross-cloud traffic (e.g., a pod on EKS calling a service on GKE via MCS) traverses public internet paths and incurs egress charges from both AWS and GCP. For production multi-cloud topologies this cost can be significant. Use VPN or Direct Connect / Cloud Interconnect for predictable latency and to reduce egress fees. See [practices/finops.md](../practices/finops.md).

### Credentials hygiene across clouds

`AGENTS.md` `/attached` rule: never put non-GCP credentials in Terraform defaults.

- Azure: `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID`
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`

Sourced from the environment at apply time. See [practices/devsecops.md](../practices/devsecops.md).

## VM-to-Container migration

`scripts/gcp-m2c-vm/gcp-m2c-vm.sh` walks through Migrate-to-Containers for a Linux VM workload. See [modernization](modernization).

## Honest framing

This repository does not today ship sibling Platform modules for AWS or Azure — `modules/Services_GCP` is the only Platform tier. The "multicloud" claim is about **architectural readiness** (cloud-agnostic IaC, portable containers, Kubernetes runtime, open standards) combined with **concrete attached-cluster integration** for AKS and EKS. Extending to a fully symmetric multicloud posture would require new Platform modules and provider-specific Foundation variants.

## Documentation depth

Each attached module ships its own deep-dive walkthrough:

- `modules/AKS_GKE/AKS_GKE.md` (~70KB)
- `modules/EKS_GKE/EKS_GKE.md` (~73KB)

These cover the Azure / AWS networking and IAM model required to attach the cluster, the Connect Gateway flow, and the operational equivalents to `gcloud container clusters get-credentials`.

## Cross-references

- [hybrid-cloud](hybrid-cloud) — Fleet mechanics, Connect Agent, Connect Gateway, ACM
- [service-mesh](service-mesh) — ASM on attached clusters
- [networking](networking) — multi-cluster mesh, hybrid VPC topology
- [modernization](modernization) — VM-to-container migration
- [practices/gitops_iac.md](../practices/gitops_iac.md) — OpenTofu rationale (the cloud-agnostic engine)
- [practices/devsecops.md](../practices/devsecops.md) — Workload Identity Federation for multicloud CI/CD
- [practices/finops.md](../practices/finops.md) — egress cost considerations
