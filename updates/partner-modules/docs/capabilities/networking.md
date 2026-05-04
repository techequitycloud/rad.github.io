# Networking

> **Scope.** Canonical home for the network surface — VPC, NAT, PSA peering, Direct VPC Egress, Cloud Armor WAF, Gateway API, multi-cluster topology, custom domains + CDN, service mesh, and hybrid connectivity. Identity-tier controls (IAP, VPC-SC, WIF) are in [practices/devsecops.md](../practices/devsecops.md); the IaC mechanics around PSA state migration are in [practices/gitops_iac.md](../practices/gitops_iac.md).

## What this repo uniquely brings to networking

### 1. Custom VPC (canonical)

`modules/Services_GCP/network.tf`:

- Custom VPC (no default VPC reliance), regional subnets.
- **Cloud NAT** for egress from private resources.
- **PSA (Private Service Access) peering** for Cloud SQL, with custom-route export both ways so GKE pod CIDRs reach the Cloud SQL producer VPC.

### 2. Direct VPC Egress for Cloud Run (canonical)

Cloud Run reaches private Cloud SQL/Redis via Direct VPC Egress (not the legacy Serverless VPC Connector): lower latency, no per-instance connector fee, `PRIVATE_RANGES_ONLY` egress mode.

**Prerequisites:** Direct VPC Egress assumes the `Services_GCP` Platform module has provisioned the VPC and PSA peering. The Cloud Run service is attached to the VPC subnet; PSA custom-route export ensures Cloud SQL's private IP is reachable from the Cloud Run pod network.

### 3. GKE networking (canonical)

- **Pod / service CIDRs** — `modules/Services_GCP/gke.tf` allocates `/14` pods and `/20` services per cluster.
- **Inline VPC CIDR derivation** — `modules/App_GKE/prerequisites.tf` derives unique CIDRs from `sha256(prereq_suffix)`. Override variables (`prereq_subnet_cidr_override`, `prereq_gke_pod_cidr_override`, `prereq_gke_service_cidr_override`) pin existing CIDRs. Multi-tenancy implications in [capabilities/multitenancy_saas.md](multitenancy_saas.md).
- **Gateway API** — `modules/App_GKE/gateway.tf`. Modern Kubernetes ingress for custom domains; uses `var.application_domains` directly to avoid apply-time circular dependencies.
- **NetworkPolicy (micro-segmentation)** — `modules/App_GKE/network_policy.tf`. Enabled via `enable_network_segmentation = true`; requires GKE Dataplane V2 (`ADVANCED_DATAPATH`). Default policy: deny all ingress/egress except intra-namespace traffic, GFE health-check CIDRs (`35.191.0.0/16`, `130.211.0.0/22`), and DNS. Egress allows cluster-internal DNS and HTTPS to GCP APIs.
- **Firewall** — `modules/App_GKE/firewall.tf` (deny-by-default; no `target_tags` for Autopilot compatibility).

### 4. Multi-cluster topology (canonical)

`MULTI_CLUSTER_GUIDE.md` and `examples/bank-of-anthos-multi-cluster/`:

- 2–10 GKE clusters in a shared VPC.
- Per-cluster `/14` pod CIDR, `/20` service CIDR.
- **Multi-primary Istio control plane** with east-west gateways for cross-cluster mTLS.
- **Fleet-based service discovery** — `modules/Services_GCP/gke-fleet.tf` enrolls clusters into a GKE Fleet. The Fleet Hub provides a single-pane view across clusters and enables multi-cluster service discovery: services registered with `ServiceExport` are automatically reachable by name from other clusters in the same Fleet.
- **Multi-Cluster Ingress** — optional unified ingress.

This pattern is the foundation for HA / DR (see [capabilities/disaster_recovery.md](disaster_recovery.md)) and multicloud extension (see [capabilities/multicloud.md](multicloud.md)).

### 5. Custom domains, SSL, CDN (canonical)

`CUSTOM_DOMAIN_CDN_FEATURE.md` plus the corresponding code:

- **Custom domains** — `application_domains` variable wires Cloud Run domain mappings or GKE Gateway routes.
- **Managed SSL certificates** — auto-provisioned via Certificate Manager for declared domains. When `enable_cloud_armor = true` and custom domains are provided, Certificate Manager managed certs are attached to the HTTPS proxy and provisioned automatically (DNS validation). When no custom domain is declared, a zero-config nip.io domain derived from the load balancer's static IP is used instead (e.g. `https://34-56-78-90.nip.io`).
- **Cloud CDN** — `enable_cdn = true` (cost angle in [practices/finops.md](../practices/finops.md)).
- **Enablement script** — `enable-custom-domain-feature.sh`.

### 6. Cloud Armor WAF (canonical)

`modules/App_CloudRun/security.tf` provisions a full WAF stack in front of Cloud Run when `enable_cloud_armor = true`:

**Load balancer architecture:**
```
Internet → Global Forwarding Rule → HTTPS Target Proxy
        → URL Map → Backend Service (Cloud Armor policy)
        → Serverless NEG → Cloud Run service
```
Cloud Run ingress is automatically set to `INTERNAL_AND_CLOUD_LOAD_BALANCING`, blocking direct `*.run.app` access and routing all traffic through the WAF.

**WAF policy:**
- OWASP Top 10 pre-configured rules (SQL injection, XSS, LFI, RFI, RCE, scanner detection, protocol attacks).
- Adaptive DDoS protection.
- Configurable rate limiting per IP.
- HTTP → HTTPS permanent redirect.

**Domain handling:**
- Custom domains: Certificate Manager managed certs, provisioned automatically.
- No custom domain: nip.io wildcard DNS derived from the static IP — zero configuration for development and staging.

### 7. Service mesh (canonical)

`modules/Services_GCP/gke-mesh.tf`, `modules/App_GKE/gke-mesh.tf` — Cloud Service Mesh (Istio-compatible):

- **mTLS** — automatic mutual TLS between all mesh-enrolled workloads; no application code changes required.
- **Traffic policy** — load balancing, retries, timeouts, circuit breakers configurable via Istio `DestinationRule` and `VirtualService`.
- **East-west gateways** — dedicated Istio gateways handle cross-cluster traffic in multi-primary topology.
- **Observability integration** — automatic L7 metrics (request rate, latency, error rate) and distributed tracing for enrolled workloads without application instrumentation. Detailed in [capabilities/observability.md](observability.md) §7.
- Multi-primary mesh runs an Istio control plane per cluster for resilience.

### 8. Edge security (cross-ref)

IAP, VPC-SC, Workload Identity — the identity-layer view of edge controls. Canonical in [practices/devsecops.md](../practices/devsecops.md). Binary Authorization (image attestation enforcement at deploy time) is also documented there and cross-referenced from [capabilities/serverless.md](serverless.md) §5.

### 9. Hybrid connectivity

- **VMware Engine** — `modules/VMware_Engine/network_peering.tf` and `firewall.tf`. VPC peering between GCVE private cloud and your VPC. Full modernisation context in [outcomes/modernisation.md](../outcomes/modernisation.md).
- **VPN / Interconnect-friendly** — VPC topology supports attachment.

### 10. Network-related troubleshooting

`AGENTS.md` `/troubleshoot` documents PSA collisions, the `inline_psa` state migration after enabling VPC-SC (canonical in [practices/gitops_iac.md](../practices/gitops_iac.md)), and `CLUSTER_ALREADY_HAS_OPERATION` retry logic.

## Cross-references

- [practices/devsecops.md](../practices/devsecops.md) — IAP, VPC-SC, Binary Authorization, NetworkPolicy (identity / edge / segmentation controls)
- [capabilities/multitenancy_saas.md](multitenancy_saas.md) — inline CIDR derivation and per-tenant perimeter strategy
- [capabilities/disaster_recovery.md](disaster_recovery.md) — multi-cluster HA / DR
- [capabilities/multicloud.md](multicloud.md) — multi-cluster mesh as multicloud foundation
- [capabilities/observability.md](observability.md) — service mesh telemetry, VPC-SC dry-run observation
- [outcomes/modernisation.md](../outcomes/modernisation.md) — VMware Engine hybrid landing zone
- [practices/finops.md](../practices/finops.md) — CDN cost offload
