# Networking

> **Scope.** Canonical home for the network surface — VPC, NAT, PSA peering, Direct VPC Egress, Gateway API, multi-cluster topology, custom domains + CDN, service mesh, and hybrid connectivity. Identity-tier controls (IAP, VPC-SC, WIF) are in [practices/devsecops.md](../practices/devsecops.md); the IaC mechanics around PSA state migration are in [practices/gitops_iac.md](../practices/gitops_iac.md).

## What this repo uniquely brings to networking

### 1. Custom VPC (canonical)

`modules/Services_GCP/network.tf`:

- Custom VPC (no default VPC reliance), regional subnets.
- **Cloud NAT** for egress from private resources.
- **PSA (Private Service Access) peering** for Cloud SQL, with custom-route export both ways so GKE pod CIDRs reach the Cloud SQL producer VPC.

### 2. Direct VPC Egress for Cloud Run (canonical)

Cloud Run reaches private Cloud SQL/Redis via Direct VPC Egress (not the legacy Serverless VPC Connector): lower latency, no per-instance connector fee, `PRIVATE_RANGES_ONLY` egress mode.

### 3. GKE networking (canonical)

- **Pod / service CIDRs** — `modules/Services_GCP/gke.tf` allocates `/14` pods and `/20` services per cluster.
- **Inline VPC CIDR derivation** — `modules/App_GKE/prerequisites.tf` derives unique CIDRs from `sha256(prereq_suffix)`. Override variables (`prereq_subnet_cidr_override`, `prereq_gke_pod_cidr_override`, `prereq_gke_service_cidr_override`) pin existing CIDRs. Multi-tenancy implications in [capabilities/multitenancy_saas.md](multitenancy_saas.md).
- **Gateway API** — `modules/App_GKE/gateway.tf`. Modern Kubernetes ingress for custom domains; uses `var.application_domains` directly to avoid apply-time circular dependencies.
- **Firewall** — `modules/App_GKE/firewall.tf` (deny-by-default; no `target_tags` for Autopilot compatibility).
- **NetworkPolicy** — `modules/App_GKE/network_policy.tf`.

### 4. Multi-cluster topology (canonical)

`MULTI_CLUSTER_GUIDE.md` and `examples/bank-of-anthos-multi-cluster/`:

- 2–10 GKE clusters in a shared VPC.
- Per-cluster `/14` pod CIDR, `/20` service CIDR.
- **Multi-primary Istio control plane** with east-west gateways for cross-cluster mTLS.
- **Fleet-based service discovery** for automatic cross-cluster endpoints.
- **Multi-Cluster Ingress** — optional unified ingress.

This pattern is the foundation for HA / DR (see [capabilities/disaster_recovery.md](disaster_recovery.md)) and multicloud extension (see [capabilities/multicloud.md](multicloud.md)).

### 5. Custom domains, SSL, CDN (canonical)

`CUSTOM_DOMAIN_CDN_FEATURE.md` plus the corresponding code:

- **Custom domains** — `application_domains` variable wires Cloud Run domain mappings or GKE Gateway routes.
- **Managed SSL certificates** — auto-provisioned for declared domains.
- **Cloud CDN** — `enable_cdn = true` (cost angle in [practices/finops.md](../practices/finops.md)).
- **Enablement script** — `enable-custom-domain-feature.sh`.

### 6. Service mesh (canonical)

- `modules/Services_GCP/gke-mesh.tf`, `modules/App_GKE/gke-mesh.tf` — Cloud Service Mesh / Anthos with mTLS, observability, traffic policy.
- Multi-primary mesh runs an Istio control plane per cluster for resilience.

### 7. Edge security (cross-ref)

Cloud Armor, IAP, ingress controls — the network-layer view of identity/edge controls. Canonical in [practices/devsecops.md](../practices/devsecops.md).

### 8. Hybrid connectivity

- **VMware Engine** — `modules/VMware_Engine/network_peering.tf` and `firewall.tf`. VPC peering between GCVE private cloud and your VPC. Full modernisation context in [outcomes/modernisation.md](../outcomes/modernisation.md).
- **VPN / Interconnect-friendly** — VPC topology supports attachment.

### 9. Network-related troubleshooting

`AGENTS.md` `/troubleshoot` documents PSA collisions, the `inline_psa` state migration after enabling VPC-SC (canonical in [practices/gitops_iac.md](../practices/gitops_iac.md)), and `CLUSTER_ALREADY_HAS_OPERATION` retry logic.

## Cross-references

- [practices/devsecops.md](../practices/devsecops.md) — IAP, VPC-SC, Cloud Armor, NetworkPolicy (identity / edge / segmentation controls)
- [capabilities/multitenancy_saas.md](multitenancy_saas.md) — inline CIDR derivation and per-tenant perimeter strategy
- [capabilities/disaster_recovery.md](disaster_recovery.md) — multi-cluster HA / DR
- [capabilities/multicloud.md](multicloud.md) — multi-cluster mesh as multicloud foundation
- [outcomes/modernisation.md](../outcomes/modernisation.md) — VMware Engine hybrid landing zone
- [practices/finops.md](../practices/finops.md) — CDN cost offload
