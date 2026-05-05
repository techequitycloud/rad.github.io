---
title: "Security"
sidebar_label: "Security"
---

# Security

> **Scope.** Consolidated view of the security controls the repo implements, what is intentionally omitted for lab simplicity, and the production hardening path. Identity controls (IAP, Workload Identity Federation, Secret Manager) are detailed in [practices/devsecops.md](../practices/devsecops.md); network controls (VPC-SC, NetworkPolicy, Cloud Armor) are in [networking](networking) and [zero-trust](zero-trust); workload signing and mesh mTLS are in [service-mesh](service-mesh).

> **To run a security review:** execute the `/security` workflow in `AGENTS.md`. It covers all six domains below and provides the exact CLI commands to verify each gate.

This page answers two questions: what security controls are already active (and where to find them), and what gaps exist that a production deployment should close.

## Controls in place

### Identity and access

| Control | Implementation | Detail |
|---|---|---|
| **SA impersonation** | `provider-auth.tf` — short-lived token (1800–3600 s) for `var.resource_creator_identity` | No long-lived credentials in provider config |
| **Workload Identity** | `workload_identity_config` block in `Bank_GKE/gke.tf`, `MC_Bank_GKE/gke.tf` | Pods reach Cloud APIs without mounted key files |
| **Least-privilege node SAs** | Dedicated SA with 5 roles only (logging, monitoring, AR reader) in all GKE modules | See [container-orchestration](container-orchestration) |
| **No secrets in defaults** | `client_secret` (AKS_GKE) and `aws_secret_key` (EKS_GKE) have no default values | Sourced from environment variables at apply time |
| **Secret Manager for DB credentials** | `secretmanager.googleapis.com` enabled; Workload Identity binding gives pods access | Replaces Kubernetes Secrets in plaintext |

### Network

| Control | Implementation |
|---|---|
| **VPC-native networking** | Private cluster nodes; pod/service CIDRs are IP alias ranges |
| **Cloud NAT for egress** | No public node IPs; outbound internet traffic via Cloud NAT only |
| **Additive firewall rules** | No `0.0.0.0/0` sources on any custom rule |
| **Single public ingress** | Istio Ingress Gateway or global HTTPS LB with Google-managed certificate per module |
| **Connect Gateway** | Attached cluster (AKS/EKS) API access via Connect Gateway, not exposed endpoints |

See [zero-trust](zero-trust) for the full network posture.

### Workload identity and mTLS

| Control | Implementation |
|---|---|
| **mTLS** | Mesh-enforced between all workloads via SPIFFE-based SVID certificates |
| **PeerAuthentication** | Open-source Istio: explicit `STRICT` mode; Cloud Service Mesh: enforced by default |
| **AuthorizationPolicy** | Identity-based east-west access control at the mesh layer |
| **RequestAuthentication** | JWT-based request-level identity enforcement at mesh ingress |

See [service-mesh](service-mesh) for configuration details.

### State and audit

- Terraform state in GCS with versioning and object-level encryption; bucket not publicly readable.
- Deployed commit SHA recorded in `commit_hash.txt` per deployment for audit traceability.
- Cloud Audit Logs (Admin Activity, Data Access, System Event) enabled project-wide via `modules/Services_GCP/audit.tf`. See [observability](observability).

## Controls not yet in place (production hardening path)

The following controls are absent by design for lab usability. Each is a well-defined addition:

| Control | Where to add | What it prevents |
|---|---|---|
| **Shielded Nodes** (Secure Boot, vTPM, integrity monitoring) | `shielded_instance_config` block in `gke.tf` | Node-level boot attacks |
| **Binary Authorization** | `google_binary_authorization_policy` resource + `binary_authorization` block in `gke.tf` | Unsigned or unattested images running in the cluster |
| **Pod Security Admission** | `PodSecurity` namespace labels via `kubernetes_manifest` | Privilege escalation, host-path mounts, root containers |
| **VPC Service Controls** | Project-level `google_access_context_manager_service_perimeter` | Data exfiltration via GCP API calls from a compromised workload |
| **Cloud Armor WAF** | `security_policy` on `google_compute_backend_service` in `glb.tf` | OWASP Top 10, DDoS at the global HTTPS LB |
| **Alerting on security events** | `google_monitoring_alert_policy` with log-based metrics | Undetected `PeerAuthentication` violations or IAM policy changes |
| **Certificate Authority Service** | ASM `meshConfig.certificateAuthority` pointing to CAS | Customer-managed PKI root for compliance-sensitive environments |

## Security review workflow

Running `AGENTS.md` `/security` is the project's definition-of-done for a security review of any module change. It covers six domains — IAM, secrets, network, GKE hardening, mesh, and state — with the exact `gcloud` and `kubectl` commands to verify each gate.

## Cross-references

- [practices/devsecops.md](../practices/devsecops.md) — IAP, Workload Identity Federation, Secret Manager, CMEK, VPC-SC mechanics
- [zero-trust](zero-trust) — network-layer zero trust posture (private nodes, mTLS, single ingress)
- [service-mesh](service-mesh) — mTLS, PeerAuthentication, AuthorizationPolicy configuration
- [container-orchestration](container-orchestration) — node SA roles, Workload Identity, hardening gaps
- [observability](observability) — Cloud Audit Logs, Binary Authorization attestation visibility
- [networking](networking) — Cloud Armor WAF, NetworkPolicy, VPC-SC
