---
title: "Container Orchestration"
sidebar_label: "Container Orchestration"
---

# Kubernetes / Container Orchestration

> **Scope.** Canonical home for GKE cluster configuration (Standard and Autopilot), node pool service accounts, Workload Identity, multi-cluster topology, and attached non-GCP clusters. Service mesh configuration is in [service-mesh](service-mesh); network-layer controls (VPC-native, NetworkPolicy) are in [networking](networking); cost and Spot-node patterns are in [practices/finops.md](../practices/finops.md).

GKE is the primary Kubernetes runtime for this platform. Five modules provision or register Kubernetes clusters: three deploy GKE directly, and two register non-GCP clusters (AKS, EKS) as first-class GCP fleet members. Understanding how clusters are configured — and what is deliberately omitted for lab simplicity — guides production hardening decisions.

## Cluster modes

The platform supports four cluster modes across its modules:

| Mode | Module(s) | Billing model | Typical use case |
|---|---|---|---|
| **GKE Standard** | `Istio_GKE`, `Bank_GKE`, `MC_Bank_GKE` | Per node | Full node-pool control; custom node configuration |
| **GKE Autopilot** | `Bank_GKE` (toggle via variable) | Per pod, per-second | Cost-optimised workloads; no node-pool sizing required |
| **AKS** | `AKS_GKE` | Azure billing | Azure Kubernetes Service registered as a GCP fleet member |
| **EKS** | `EKS_GKE` | AWS billing | AWS EKS registered as a GCP fleet member |

`var.create_cluster = false` (Bank_GKE) reads `data "google_container_cluster.existing_cluster"` and skips cluster creation, so the module can install onto an existing cluster.

## Release channels

GKE clusters set `release_channel`, allowing Google to deliver continuous control-plane upgrades. The `/maintain` workflow in `AGENTS.md` covers promoting between channels (`REGULAR` → `STABLE`). Pinning to `STABLE` reduces upgrade frequency at the cost of receiving fixes later; `REGULAR` is the recommended balance for production.

## Node pool service accounts

Node pools in `modules/Istio_GKE/gke.tf`, `modules/Bank_GKE/gke.tf`, and `modules/MC_Bank_GKE/gke.tf` use a dedicated service account with only the minimum required roles:

- `roles/logging.logWriter`
- `roles/monitoring.metricWriter`
- `roles/monitoring.viewer`
- `roles/stackdriver.resourceMetadata.writer`
- `roles/artifactregistry.reader`

These are not the Compute Engine default SA, and explicitly exclude `roles/owner` or `roles/editor`. The [devsecops](../practices/devsecops.md) practice page audits exactly this list.

## Node hardening

> **Production gap:** The modules do not currently enable Shielded Nodes (Secure Boot, vTPM, integrity monitoring) or Binary Authorization. These are deliberate omissions for lab simplicity.

To harden a production cluster, add:

- `shielded_instance_config` blocks to `gke.tf` for Shielded Nodes
- A `google_binary_authorization_policy` resource for image attestation enforcement

Pod Security Admission (the PSP replacement in Kubernetes 1.25+) is also not configured. The namespace-level `PodSecurity` labels would be applied via a `kubernetes_manifest` resource following the existing workload-deploy pattern. See [security](security) for the full hardening checklist and the production gap table.

## VPC-native networking

GKE clusters use IP alias ranges via `ip_allocation_policy` in `gke.tf`, with secondary ranges defined in `network.tf` for pods and services. This makes pod traffic native VPC traffic — no overlay network — which simplifies firewall rules and improves performance. See [networking](networking) and [zero-trust](zero-trust).

## Workload Identity

Bank_GKE and MC_Bank_GKE enable Workload Identity via a `dynamic "workload_identity_config"` block in `gke.tf`. This allows Bank of Anthos pods to reach Cloud Spanner / Cloud SQL without mounting service-account key files — the pod's Kubernetes SA is mapped to a GCP SA at the IAM level. The `/security` workflow in `AGENTS.md` flags this as a verification step.

## Multi-cluster

`modules/MC_Bank_GKE/gke.tf` declares `google_container_cluster.gke_cluster` with `for_each = local.cluster_configs` (up to 4 clusters). The four `kubernetes` provider aliases (`cluster1`–`cluster4`) are statically defined.

> **Note:** Adding a fifth cluster requires adding a new provider alias because OpenTofu does not support `for_each`-generated provider configurations. The practical workaround is to pre-define a maximum number of aliases (e.g., 6) with conditional activation, accepting that unused aliases are no-ops.

## Spot VMs in lab clusters

`scripts/gcp-istio-security/` and `scripts/gcp-istio-traffic/` default to Spot-backed node pools — roughly 70% cheaper and interruption-tolerant, appropriate for ephemeral training environments. See [practices/finops.md](../practices/finops.md).

## Cluster credentials

Every GKE module emits a copy-pastable `cluster_credentials_cmd` output (`SKILLS.md` §3.5). Attached clusters document the equivalent `gcloud container attached clusters get-credentials ...` in their module READMEs.

## What is not here — and what to add next

The following controls are absent by design for lab usability and are the natural next steps for production hardening:

| Missing control | Where to add | Reference |
|---|---|---|
| Shielded Nodes (Secure Boot, vTPM, integrity monitoring) | `shielded_instance_config` block in `gke.tf` | [security](security) |
| Binary Authorization | `google_binary_authorization_policy` resource | [security](security) |
| Pod Security Admission | `PodSecurity` namespace labels via `kubernetes_manifest` | [security](security) |
| Node auto-provisioning limits | `cluster_autoscaling` resource limits in `gke.tf` | [practices/finops.md](../practices/finops.md) |

## Cross-references

- [service-mesh](service-mesh) — mesh install on GKE clusters (Istio, Cloud Service Mesh)
- [networking](networking) — VPC-native pod/service CIDRs, NetworkPolicy, firewall rules
- [zero-trust](zero-trust) — private nodes, single ingress, additive firewalls
- [hybrid-cloud](hybrid-cloud) — fleet membership, attached AKS/EKS clusters
- [security](security) — full hardening checklist and production gap table
- [practices/devsecops.md](../practices/devsecops.md) — node SA role audit, Workload Identity
- [practices/finops.md](../practices/finops.md) — Spot VMs, Autopilot cost model
