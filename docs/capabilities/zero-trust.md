---
title: "Zero Trust"
sidebar_label: "Zero Trust"
---

# Zero Trust

> **Scope.** Canonical home for the platform's zero-trust posture across two layers: network (private nodes, VPC-native routing, single ingress, additive firewalls) and workload (mTLS, SPIFFE identity, AuthorizationPolicy). VPC Service Controls and Cloud Armor, which extend this posture, are in [networking](networking) and [security](security). Service mesh configuration details are in [service-mesh](service-mesh).

Zero trust means no implicit trust based on network location. Every connection — whether from the internet, between services inside the cluster, or from a CI/CD pipeline — must be authenticated and authorised explicitly. This platform applies zero-trust defaults at two layers:

| Layer | Principle | How it is enforced |
|---|---|---|
| **Network** | No public node IPs; minimal inbound surface; deny-by-default egress | VPC-native pod networking, Cloud NAT, single ingress per module, additive firewall rules |
| **Workload** | Identity-based trust; encrypted connections; no ambient credential access | mTLS via service mesh (SPIFFE SVIDs), `AuthorizationPolicy`, `PeerAuthentication`, Workload Identity |

## Network layer

### VPC-native networking

Every GKE module (`modules/Istio_GKE/network.tf`, `modules/Bank_GKE/network.tf`, `modules/MC_Bank_GKE/network.tf`) creates a VPC with a subnet that has secondary IP ranges for pods and services. The GKE cluster uses these via `ip_allocation_policy`, so pod traffic is native VPC traffic — not an overlay network — which makes it routable and inspectable at the VPC level.

### Private nodes with Cloud NAT

Cluster nodes have no public IP addresses. Outbound internet traffic (image pulls, package installs in `null_resource` provisioners) goes through a Cloud Router + Cloud NAT created in `network.tf`. Inbound traffic enters only via the cluster's load balancer — no direct path to nodes exists.

### Single ingress per module

Each module exposes exactly one public entry point:

| Module | Public entry point |
|---|---|
| `Istio_GKE` | Istio Ingress Gateway |
| `Bank_GKE`, `MC_Bank_GKE` | Global HTTPS LB with Google-managed certificate (`glb.tf`) |

The `/security` workflow in `AGENTS.md` checks that no other service exposes a public IP.

### Additive firewall rules

GKE manages its own firewall rules. The modules add no `0.0.0.0/0` sources on any custom rule. The `/security` workflow in `AGENTS.md` audits firewall rule sources and ports. See [networking](networking) for the full firewall configuration.

### Connect Gateway for attached clusters

`modules/AKS_GKE/` and `modules/EKS_GKE/` register clusters with GCP Fleet, so Kubernetes API access goes through Connect Gateway rather than exposing the AKS / EKS API endpoint publicly. See [hybrid-cloud](hybrid-cloud).

## Workload identity layer

### Mesh identity as the workload trust boundary

mTLS between workloads, identity-based authorisation (`AuthorizationPolicy`), and JWT-based request authentication are enforced at the mesh layer. Trust is based on SPIFFE-compliant workload identity certificates — not network location. A compromised pod's traffic is still subject to mTLS and `AuthorizationPolicy` checks.

See [service-mesh](service-mesh) for `PeerAuthentication` enforcement modes (`STRICT` vs `PERMISSIVE`), `AuthorizationPolicy` configuration, and the mesh CA details.

### Certificate lifecycle

| Implementation | CA | Validity | Rotation |
|---|---|---|---|
| Open-source Istio | Istiod built-in CA | 24 hours | Automatic |
| Cloud Service Mesh | GCP managed | Managed by GCP | Transparent |

Neither deployment currently integrates Google Certificate Authority Service (CAS) for custom root CAs — that is the production path for compliance-sensitive environments requiring customer-managed PKI.

### Multi-cluster routing with mesh identity

`modules/MC_Bank_GKE/` uses Multi-Cluster Ingress and Multi-Cluster Services behind a single global LB. Clients hit the nearest healthy region; mesh identity and mTLS follow the request across clusters without re-authentication.

## What is not here — and what to add next

| Control | Why it is missing | How to add it |
|---|---|---|
| **VPC Service Controls** | Project-level data perimeter; outside the per-module `network.tf` pattern | Add `google_access_context_manager_service_perimeter` at project level; see [multitenancy-saas](multitenancy-saas) for the per-deployment strategy |
| **Cloud Armor WAF/DDoS** | Not attached to any module's HTTPS LB | Attach `security_policy` to `google_compute_backend_service` in `glb.tf`; see [networking](networking) §6 |
| **`AuthorizationPolicy` deny-by-default** | Default allows all east-west mesh traffic | Add a namespace-level deny-all base policy with explicit allow rules per service pair |
| **Shielded Nodes** | Omitted for lab simplicity | `shielded_instance_config` block in `gke.tf`; see [security](security) |

## Cross-references

- [service-mesh](service-mesh) — mTLS enforcement, PeerAuthentication modes, certificate CA details
- [security](security) — consolidated security control inventory, production hardening table
- [networking](networking) — Cloud Armor WAF, VPC-SC, NetworkPolicy, full firewall model
- [multitenancy-saas](multitenancy-saas) — per-deployment VPC-SC perimeter strategy
- [hybrid-cloud](hybrid-cloud) — Connect Gateway for attached cluster API access
- [container-orchestration](container-orchestration) — VPC-native pod networking, Workload Identity
- [practices/devsecops.md](../practices/devsecops.md) — IAP, Workload Identity Federation, CMEK
