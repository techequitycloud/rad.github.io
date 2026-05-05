---
title: "Hybrid Cloud"
sidebar_label: "Hybrid Cloud"
---

# Hybrid Cloud, Fleet, and Anthos

> **Scope.** Canonical home for GKE Hub Fleet membership, fleet-level feature enablement (Cloud Service Mesh, Multi-Cluster Ingress, Anthos Config Management), the Connect Agent installer for non-GCP clusters, and Workload Identity Federation across cloud providers. Multi-cluster networking topology is in [networking](networking) §4; the full multicloud architecture is in [multicloud](multicloud).

Fleet management lets a single GCP control plane manage GKE, AKS, and EKS clusters as peers. This is the prerequisite for multi-cloud deployments: once a non-GCP cluster is a fleet member, it gains access to managed Istio, centralised policy, and Connect Gateway API access — all without exposing its API endpoint publicly.

## 1. GKE Hub membership

Every cluster the modules provision becomes a Fleet member:

- `modules/Bank_GKE/hub.tf` — `google_gke_hub_membership` for a single GKE cluster.
- `modules/MC_Bank_GKE/hub.tf` — one membership per cluster (`for_each`).
- `modules/AKS_GKE/main.tf` and `modules/EKS_GKE/main.tf` — attached cluster registration via `google_container_attached_cluster`.

## 2. Fleet features

| Feature | Resource | Module(s) |
|---|---|---|
| **Cloud Service Mesh** | `google_gke_hub_feature "service_mesh"` | `Bank_GKE/asm.tf`, `MC_Bank_GKE/asm.tf` |
| **Multi-Cluster Ingress** | `google_gke_hub_feature "multiclusteringress_feature"` | `MC_Bank_GKE/deploy.tf` |
| **Anthos Config Management** | `null_resource` (opt-in) | `Bank_GKE` |

See [service-mesh](service-mesh) for mesh configuration details.

## 3. Anthos Config Management and GitOps

ACM provides two capabilities when enabled:

1. **Config Sync** — continuously syncs Kubernetes manifests from a Git repository to fleet clusters. This is the GitOps on-ramp: a commit to the config repo becomes a cluster state change without a manual `kubectl apply`.
2. **Policy Controller** — enforces OPA Gatekeeper-based policies (Constraint Framework) across all fleet clusters from a single policy repository. Violations are reported centrally in Cloud Console.

ACM is opt-in for `Bank_GKE`. Enabling it for `MC_Bank_GKE` would allow fleet-wide policy enforcement across all regions from a single Git source of truth. See [modernization](modernization) for the post-migration GitOps path.

## 4. Workload Identity Federation across clouds

The Connect Agent provides the channel back to GCP for attached clusters, but workload identity operates differently per cloud:

| Cloud | Mechanism | Credential source |
|---|---|---|
| **GKE** | Native Workload Identity — binds Kubernetes SA to GCP SA via `workload_identity_config` | Automatic; no env vars needed |
| **AKS** | Azure AD Workload Identity (OIDC federation) or Connect Agent impersonation path | `ARM_*` environment variables at apply time |
| **EKS** | IAM Roles for Service Accounts (IRSA) for the AWS side; Connect Agent for GCP side | `AWS_*` environment variables at apply time |

The deep-dive walkthroughs in `modules/AKS_GKE/AKS_GKE.md` (~70 KB) and `modules/EKS_GKE/EKS_GKE.md` (~73 KB) document the cloud-specific steps for each path.

## 5. Connect Agent installer

Attached clusters need the GKE Connect agent installed inside the cluster to communicate back to GCP. `modules/AKS_GKE/modules/attached-install-manifest/` and the EKS equivalent handle this automatically:

1. Fetch the bootstrap manifest via `data "google_container_attached_install_manifest"`.
2. Write it as a Helm chart (`local_file`).
3. Apply it via `helm_release`.

Once this finishes, the cluster appears in the GCP Console under *Kubernetes Engine > Clusters* alongside native GKE clusters.

## 6. Connect Gateway

Cluster API access for attached clusters goes through Connect Gateway rather than exposing the AKS / EKS API endpoint publicly. The `gcloud container attached clusters get-credentials ...` command in the attached-cluster READMEs returns a kubeconfig that uses Connect Gateway as the API server proxy.

## What is not here — and what to add next

| Missing capability | Notes |
|---|---|
| ACM enabled on `MC_Bank_GKE` | Opt-in; would enable fleet-wide GitOps policy across all regions |
| Custom CA for ASM on attached clusters | The managed control plane handles certs; customer-managed PKI requires CAS integration |
| Anthos Config Management on EKS/AKS | The `attached-install-mesh` submodule exists; ACM on attached clusters is not yet wired |

## Cross-references

- [multicloud](multicloud) — full multicloud architecture, AKS/EKS module details, resilience and egress considerations
- [container-orchestration](container-orchestration) — GKE cluster configuration and node hardening
- [service-mesh](service-mesh) — Cloud Service Mesh fleet feature and multi-cluster mesh topology
- [networking](networking) — multi-cluster topology, Connect Gateway
- [modernization](modernization) — ACM/Config Sync as the post-migration GitOps on-ramp
- [practices/devsecops.md](../practices/devsecops.md) — Workload Identity Federation for multicloud CI/CD
