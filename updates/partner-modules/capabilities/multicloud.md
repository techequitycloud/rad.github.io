# Multicloud

> **Scope.** Architectural readiness for multicloud and hybrid extension — the property of being cloud-agnostic by design even though the current Platform tier targets only GCP. This file is largely a synthesis of cross-references; the underlying mechanics live in their canonical homes.

## What this repo uniquely brings to a multicloud journey

### 1. Cloud-agnostic IaC engine

OpenTofu is the engine — see [practices/gitops_iac.md](../practices/gitops_iac.md) for the canonical detail. The four-tier module pattern (canonical in [practices/platform_engineering.md](../practices/platform_engineering.md)) hard-binds only the Platform tier to GCP; sibling `Services_AWS` / `Services_Azure` modules would slot in without changing Common or Application contracts.

### 2. Container-portable workloads

- Application source lives in `modules/<App>_Common/scripts/` as standard `Dockerfile`s — no GCP-specific runtime assumptions.
- The application catalogue is the open-source ecosystem itself (see [outcomes/developer_productivity.md](../outcomes/developer_productivity.md)) — none of these apps are GCP-locked.
- OCI images are the unit of portability; Artifact Registry happens to be where they live today.

### 3. Kubernetes as the portability layer

`modules/App_GKE` deploys via standard Kubernetes primitives (Deployment, StatefulSet, CronJob, Job, NetworkPolicy, Gateway API). Most of the manifests would apply unmodified to AWS EKS, Azure AKS, on-prem Kubernetes (Anthos, OpenShift, Rancher), or KIND/k3s. GCP-specific concerns (Workload Identity, Cloud SQL Proxy, GCS Fuse) are isolated to a handful of files — natural integration seams for replacement strategies.

### 4. Multi-cluster topology as the multi-region / multi-cloud foundation

`MULTI_CLUSTER_GUIDE.md` and `examples/bank-of-anthos-multi-cluster/` document a 2–10 GKE cluster topology with multi-primary Istio and Fleet-based service discovery. This is canonical in [capabilities/networking.md](networking.md) §4 — the same mesh + Fleet pattern is specifically designed to extend to GKE on-prem, EKS, AKS, and bare-metal Kubernetes via Anthos / Cloud Service Mesh.

### 5. Hybrid surface

- **VMware Engine** — canonical in [outcomes/modernisation.md](../outcomes/modernisation.md). The standard hybrid landing zone for migrating on-prem VMware workloads into GCP without refactoring.
- **Workload Identity Federation** — canonical in [practices/devsecops.md](../practices/devsecops.md) §2. Federates AWS, Azure AD, Okta, GitHub Actions identities into GCP — the same federation pattern is the bridge for multicloud CI/CD.
- VPN/Interconnect-friendly VPC topology — see [capabilities/networking.md](networking.md).

### 6. Open standards, no vendor-lock primitives

- OpenTofu instead of proprietary Terraform Cloud / Terraform Enterprise.
- Standard Kubernetes APIs (Deployment, Gateway API, NetworkPolicy) instead of GCP-only constructs.
- Open-source applications instead of proprietary SaaS.
- OCI containers instead of cloud-specific package formats.

## Honest framing

This repository does not today ship sibling Platform modules for AWS or Azure — `modules/Services_GCP` is the only Platform tier. The "multicloud" claim is about **architectural readiness** (cloud-agnostic IaC, portable containers, Kubernetes runtime, open standards), not about a working AWS/Azure deployment path. Extending to a true multicloud posture would require new Platform modules and provider-specific Foundation variants.

## Cross-references

- [practices/gitops_iac.md](../practices/gitops_iac.md) — OpenTofu rationale (the cloud-agnostic engine)
- [practices/platform_engineering.md](../practices/platform_engineering.md) — four-tier pattern that scopes vendor binding to the Platform tier
- [capabilities/networking.md](networking.md) — multi-cluster mesh, hybrid VPC topology
- [outcomes/modernisation.md](../outcomes/modernisation.md) — VMware Engine hybrid landing zone
- [practices/devsecops.md](../practices/devsecops.md) — Workload Identity Federation for multicloud CI/CD
- [outcomes/developer_productivity.md](../outcomes/developer_productivity.md) — open-source application catalogue
