---
title: "Service Mesh"
sidebar_label: "Service Mesh"
---

# Service Mesh

> **Scope.** Canonical home for mesh installation (open-source Istio and Cloud Service Mesh), sidecar vs ambient mode selection, fleet-wide mesh topology, Cloud Run mesh integration, mesh CA and certificate lifecycle, mTLS enforcement, traffic management, and security primitives. Observability add-ons (Prometheus, Grafana, Jaeger, Kiali) are in [observability](observability); network-layer zero trust is in [zero-trust](zero-trust).

A service mesh handles encrypted service-to-service communication, traffic routing, and L7 observability at the infrastructure layer — without requiring application code changes. Four of five platform modules deploy a mesh; a fifth lab connects Cloud Run to one. Both open-source Istio and Google's managed Cloud Service Mesh (CSM) are represented.

> **Naming note:** "Cloud Service Mesh" (CSM) is Google's managed Istio product, formerly called Anthos Service Mesh (ASM). "Open-source Istio" refers to the upstream install from `istio.io`. These docs use CSM and open-source Istio consistently; legacy references to ASM mean the same product as CSM.

## Open-source Istio on GKE

`modules/Istio_GKE/` installs upstream Istio on a GKE Standard cluster. The user picks **sidecar mode** (`istiosidecar.tf`) or **ambient mode** (`istioambient.tf`) via `var.install_ambient_mesh`. The two files are mutually exclusive — one runs `count = var.install_ambient_mesh ? 0 : 1`, the other its inverse — so a mesh is only ever installed once.

The sidecar installer pipes a custom `IstioOperator` YAML into `istioctl install -y -f -` to fix HPA naming (`hpaSpec.scaleTargetRef.name = istio-ingressgateway`). Removing this block reintroduces a known install error.

### Sidecar vs ambient: when to pick which

| Dimension | Sidecar | Ambient |
|---|---|---|
| L7 traffic policy | Per-pod Envoy proxy | ztunnel (L4) + optional waypoint proxy (L7) |
| Resource overhead | Each pod gets a proxy container | Shared per-node ztunnel; waypoints are opt-in |
| Pod restarts on install | Required (proxy injection) | Not required |
| Feature completeness | Full Istio API surface | Subset; maturing rapidly |
| Lab suitability | Mature, well-documented | Lower overhead for demo clusters |

For production clusters where per-pod overhead matters, ambient mode is worth evaluating. For teams learning the full Istio API surface (traffic management, security primitives), sidecar mode exposes more knobs.

The observability add-ons (Prometheus, Grafana, Jaeger, Kiali) are installed in the same `null_resource`. See [observability](observability).

## Cloud Service Mesh on a single cluster

`modules/Bank_GKE/asm.tf` enables the GKE Hub `service_mesh` feature and binds it to the cluster's Fleet membership, then runs `gcloud container fleet mesh update` to install CSM (managed Istio). The managed control plane runs in GCP, not inside the cluster — no Istiod pods to manage.

## Fleet-wide Cloud Service Mesh

`modules/MC_Bank_GKE/asm.tf` enables the same Hub feature once and creates a `google_gke_hub_feature_membership` for each cluster, so all clusters in the fleet share a single mesh. Cross-cluster traffic flows over Multi-Cluster Services.

`modules/MC_Bank_GKE/mcs.tf` contains the destroy `null_resource` that deletes MCI/MCS objects across all clusters before Terraform removes the fleet feature — a step Terraform's dependency graph cannot do on its own and which would otherwise leave orphaned resources.

## Cloud Run on the mesh

`scripts/gcp-cr-mesh/gcp-cr-mesh.sh` is an interactive lab that puts a Cloud Run service behind CSM via a serverless NEG, a global `INTERNAL_SELF_MANAGED` backend service, and an `HTTPRoute` (imported via `gcloud network-services http-routes import`). This uses the **Traffic Director / Network Services API** routing model, not the Kubernetes Gateway API CRDs. See [serverless](serverless).

## Mesh on attached clusters

`modules/AKS_GKE/modules/attached-install-mesh/` and the EKS equivalent install CSM on a non-GCP cluster. This submodule is not invoked automatically by the parent module — callers opt in. See [multicloud](multicloud).

## mTLS

mTLS (mutual TLS) encrypts and authenticates every connection between mesh-enrolled workloads. No application code changes are required — the sidecar proxy or ztunnel handles encryption transparently.

- **Open-source Istio:** `PeerAuthentication` resources control enforcement mode per namespace.
  - `STRICT` — only mTLS connections are accepted; plaintext is rejected. Use this for production namespaces.
  - `PERMISSIVE` (default) — both mTLS and plaintext are accepted. Useful during rollout to avoid breaking un-enrolled clients.
- **Cloud Service Mesh:** the managed control plane enforces mTLS by default. Verify the current state with `gcloud container fleet mesh describe`.

## Mesh CA / certificate authority

| Implementation | CA | Certificate validity | Rotation |
|---|---|---|---|
| Open-source Istio | Istiod built-in CA | 24 hours (SPIFFE-compliant SVID) | Automatic |
| Cloud Service Mesh | GCP managed control plane | Managed by GCP | Transparent; `gcloud container fleet mesh describe` reports status |

Neither deployment currently integrates Google Certificate Authority Service (CAS) for a custom root CA. CAS integration is the production path for compliance-sensitive environments that require a customer-managed PKI.

## Traffic management

`scripts/gcp-istio-traffic/` is a hands-on lab covering the traffic management primitives: weighted splits, header-based routing, fault injection, sidecar egress, port-level load balancing, timeouts, and retries. These use the classic Istio API (`VirtualService`, `DestinationRule`, `Gateway`).

The Cloud Run mesh lab (`gcp-cr-mesh`) uses the Network Services `HTTPRoute` resource instead — a separate API surface for Traffic Director-managed routing that does not use Kubernetes Gateway API CRDs.

## Security primitives

`scripts/gcp-istio-security/` walks through `PeerAuthentication`, `RequestAuthentication` (JWT), and `AuthorizationPolicy`. See [practices/devsecops.md](../practices/devsecops.md) for the security-audit angle, and [security](security) for the consolidated control inventory.

## Multi-cluster traffic

`modules/MC_Bank_GKE/glb.tf` reserves a global static IP; `modules/MC_Bank_GKE/deploy.tf` enables `google_gke_hub_feature.multiclusteringress_feature` and applies the MultiClusterIngress / MultiClusterService manifests to a config cluster. The result is a single global HTTPS load balancer routing traffic to Bank of Anthos pods on whichever cluster is healthy.

## What is not here — and what to add next

| Gap | Notes |
|---|---|
| Custom root CA (CAS) | Neither open-source Istio nor CSM is integrated with CAS today; required for customer-managed PKI |
| Burn-rate alerting on mesh SLOs | The SLO resources exist in `Bank_GKE/monitoring.tf`; `google_monitoring_alert_policy` on SLO burn rate is not yet wired |
| Policy Controller mesh policies | `OPA Gatekeeper` constraints for mesh configuration (e.g. require `STRICT` PeerAuthentication) are not pre-configured |
| `AuthorizationPolicy` deny-by-default | Default policy allows all east-west traffic; a deny-all base policy with explicit allow rules is the production security posture |

## Cross-references

- [observability](observability) — Prometheus, Grafana, Jaeger, Kiali; automatic L7 metrics and distributed tracing from the mesh
- [zero-trust](zero-trust) — network-layer zero trust; mesh identity as the workload trust boundary
- [security](security) — consolidated security control inventory; mTLS and AuthorizationPolicy in context
- [networking](networking) — east-west gateways, multi-cluster topology, service mesh telemetry
- [serverless](serverless) — Cloud Run on CSM via serverless NEG
- [hybrid-cloud](hybrid-cloud) — fleet-wide CSM feature enablement
- [multicloud](multicloud) — CSM on attached AKS/EKS clusters
- [practices/devsecops.md](../practices/devsecops.md) — security audit workflow referencing mesh primitives
