---
id: devsecops
title: DevSecOps
---

# DevSecOps

Security is shifted left across the platform: encoded in module defaults, gated by IAM impersonation, enforced at the mesh layer, and audited by a dedicated review workflow. Every guardrail — IAP, Cloud Armor, Binary Authorization, VPC-SC, CMEK — is a Terraform resource, code-reviewed and version-controlled. This document covers identity, secrets, encryption, perimeters, supply chain, and the `/security` audit workflow.

## Security shifted left into IaC

- **Policy as code** — every guardrail is a Terraform resource, code-reviewed and version-controlled alongside the infrastructure it protects.
- **Plan-time validation** — `modules/App_CloudRun/validation.tf` and `modules/App_GKE/validation.tf` reject misconfigurations before any resource is created. See [CI/CD](./cicd.md) for the pipeline gates.
- **Mandatory `/security` workflow** — `AGENTS.md` defines a 30+ point audit checklist covering IAM, VPC-SC, Binary Authorization, Secret Manager, network, database, container, and audit controls. Running this checklist is the definition-of-done for a security review of any module.

## Identity and access

**Service-account impersonation** is the foundational access pattern. The caller never holds long-lived credentials; the provider mints a short-lived access token for each `apply`, scoped to the platform service account `var.resource_creator_identity`. This pattern is implemented in `provider-auth.tf` across all GKE-based modules.

- **Per-app service accounts** — `modules/App_CloudRun/sa.tf` and `modules/App_GKE/sa.tf` provision dedicated service accounts per application. Roles are restricted to `secretmanager.secretAccessor`, `cloudsql.client`, and `storage.objectAdmin`.
- **Workload Identity Federation** — `modules/Services_GCP/wif.tf` federates external IdPs (Okta, AWS, Azure AD, GitHub Actions) without long-lived service-account keys.
- **Identity-Aware Proxy** — `modules/App_CloudRun/iap.tf` and `modules/App_GKE/iap.tf` implement native IAP (no load balancer required for Cloud Run), auto-normalising email prefixes (`user:`, `serviceAccount:`, `group:`). Replaces VPNs with Google's Zero-Trust model via a single boolean (`enable_iap = true`).
- **Least-privilege node pools** — GKE node pools use a dedicated cluster service account with only the four roles needed for logging and monitoring — never the Compute Engine default SA, never `roles/owner` or `roles/editor`.

## Secret management

No secrets enter the IaC state or the repository. This is an absolute invariant enforced by `AGENTS.md` and `CLAUDE.md`.

- **No secret defaults** — `SKILLS.md` §6 invariant: no secrets in variable defaults. `client_secret`, `aws_secret_key`, and equivalent inputs are sourced from environment variables (`ARM_CLIENT_SECRET`, `AWS_SECRET_ACCESS_KEY`) at apply time.
- **CSI driver mounting** — `modules/App_GKE/secrets.tf` mounts secrets via the GKE Secrets Store CSI driver (`secrets-store-gke.csi.k8s.io`).
- **GitHub PAT hardening** — tokens are passed only via the `environment` block of `local-exec`, never in `command` strings, `triggers`, or module outputs. This prevents serialisation into `terraform.tfstate`. `git clone` uses the credential-store helper rather than `https://TOKEN@github.com/...` URLs.
- **Secret-path correctness** — Common modules output `.secret_id` (short form), not `.id` (full path); using `.id` doubles the path in CSI mounts.
- **Pre-commit secret scanners** — `check_secrets.py` and `check_secrets_cr.py` run as pre-commit hooks.

## Secrets rotation policy

Secret creation is handled by the Common modules, but rotation must be operationalised:

- **Rotation cadence** — database passwords and API keys should be rotated at least every 90 days. Secret Manager supports automatic rotation via Cloud Scheduler → Cloud Functions → `AddSecretVersion` + `DisableSecretVersion`.
- **Rotation notification** — configure a `google_secret_manager_secret_rotation` resource so that a Pub/Sub message is emitted when rotation is due; a Cloud Function then generates the new credential and updates the consuming service.
- **Zero-downtime rotation** — the two-version overlap pattern: add the new version, deploy the updated application (which reads the latest active version), then disable the old version. Cloud Run and GKE read secret values at startup; a rolling restart completes the cutover.
- **GitHub PAT rotation** — PATs used by `GIT_TOKEN` should be scoped to minimum required permissions (read-only repository access) and rotated on the same 90-day cadence via the Workload Identity Federation path where possible.

## VPC Service Controls

VPC-SC provides a data-exfiltration perimeter around the project:

- `modules/Services_GCP/vpc_sc.tf`, `modules/App_CloudRun/vpc_sc.tf`, and `modules/App_GKE/vpc_sc.tf` implement the perimeter.
- Three user-facing variables: `enable_vpc_sc`, `admin_ip_ranges`, `vpc_sc_dry_run`.
- Always enable dry-run first, monitor for 1–2 weeks, then enforce. Phased rollout is documented in `.agent/VPC_SC_QUICK_START.md`, `VPC_SC_TESTING_GUIDE.md`, and `VPC_SC_PER_DEPLOYMENT_STRATEGY.md`.

## Supply chain and container security

- **Binary Authorization** — `modules/Services_GCP/binauthz.tf` enforces signed images at admission. The `enable_binary_authorization` flag wires applications in.
- **CMEK** — `modules/Services_GCP/cmek.tf` provides customer-managed encryption keys for Cloud SQL, Filestore, GCS, and Secret Manager.
- **Non-root containers** — UID 2000 is used for GCS Fuse compatibility and least-privilege execution.
- **Provider supply-chain security** — all modules pin provider versions in `versions.tf` with `~>` constraints. Running `tofu providers lock -platform=linux_amd64` generates a `.terraform.lock.hcl` file with cryptographic hashes for each provider binary; committing this file enables CI to detect if a provider binary changes between runs.
- **Artifact Registry vulnerability scanning** — enable `google_artifact_registry_repository` with `docker_config.immutable_tags = true` and activate Artifact Analysis scanning. Critical and High severity CVEs should block promotion via a Binary Authorization attestation rule; scanner results are surfaced in Security Command Center.
- **SBOM generation** — Software Bill of Materials artifacts can be generated during the Cloud Build image-build step using `docker buildx` with SBOM attestation (`--sbom=true`) and stored alongside the image in Artifact Registry. Image lifecycle policies are covered in [FinOps](./finops.md).

## Network security

- **mTLS by default** — workload-to-workload identity and encryption are mesh-enforced via `PeerAuthentication STRICT` mode and the ASM-managed control plane.
- **Cloud Armor WAF** — `modules/App_CloudRun/security.tf` and `modules/App_GKE/security.tf` provision Cloud Armor policies.
- **Kubernetes NetworkPolicy** — `modules/App_GKE/network_policy.tf` defines default-deny ingress/egress policies.
- **Firewall rules** — `modules/App_GKE/firewall.tf` applies deny-by-default rules without `target_tags` (for Autopilot compatibility).
- **Network hardening** — VPC-native ranges, private nodes with Cloud NAT, additive firewall rules, single ingress per module, Google-managed certificates on the public LB.

The full network-layer view (VPC, NAT, PSA, mesh, ingress controls) is in the networking capability documentation.

## TLS and certificate management

All ingress paths terminate TLS; certificate lifecycle is managed automatically:

- **Cloud Run** — Google-managed TLS certificates are provisioned automatically for custom domains. No manual rotation is required.
- **GKE Autopilot** — Google-managed certificates via `ManagedCertificate` resources or GKE Gateway API `certificateMap` annotations. `modules/App_GKE/gateway.tf` wires these to the Gateway resource.
- **Certificate rotation** — Google-managed certificates rotate 30 days before expiry without operator intervention. For bring-your-own-certificate scenarios, Secret Manager stores the PEM bundle and `modules/App_GKE/secrets.tf` mounts it as a CSI volume.
- **Internal services** — the service mesh handles mTLS between pods using Workload Identity-backed certificates.

## State integrity

Terraform state lives in GCS with versioning and object-level encryption — never locally for shared environments. Bucket IAM is not publicly readable. `.terraform/` is in `.gitignore` so cached provider data and credentials never reach the repository. See [GitOps & IaC](./gitops-iac.md) for the full state-management model.

## Audit logging

Cloud Audit Logs (Admin Activity and Data Access) should be enabled for the APIs used by each module — Container, Compute, IAM, GCS, and GKE Hub. Admin Activity logs are on by default; Data Access logs for GCS and IAM require explicit project-level configuration. Exporting these logs to a long-term sink (a dedicated Cloud Logging bucket or BigQuery dataset in the management project) provides the forensic trail needed for compliance reviews. The `/security` checklist in `AGENTS.md` includes a `gcloud logging` command to verify audit log sinks are configured.

## Security incident response

The `/security` audit workflow catches configuration drift before it becomes an incident. When a finding does require a response:

- **Triage** — Security Command Center findings are the canonical source of truth. Severity HIGH/CRITICAL findings trigger a PagerDuty alert (configured in `modules/Services_GCP`); MEDIUM findings create a GitHub issue via the SCC notification → Pub/Sub → Cloud Function pipeline.
- **Containment** — for IAM over-permission findings: revoke the binding immediately via `gcloud` (emergency break-glass), then reconcile back to the IaC-defined state on the next `tofu apply`. Never add emergency IAM bindings to `.tf` files without a PR.
- **Remediation SLA** — Critical: 4 hours to containment, 24 hours to root cause. High: 24 hours to containment, 72 hours to root cause. Medium: next sprint.
- **Post-mortem** — all Critical and High incidents result in a blameless post-mortem. See [SRE](./sre.md) §6 for the process.

## What is not yet implemented

Policy-as-code admission control (OPA/Gatekeeper, Policy Controller) and runtime Binary Authorization for container image verification are not currently included in any module. These provide a workload-level enforcement layer above what mTLS and IAM supply and are natural next steps for a production-hardened cluster posture.

## Cross-references

- [GitOps & IaC](./gitops-iac.md) — secret-out-of-state mechanics, state integrity
- [SRE](./sre.md) — post-mortem process, on-call model
- [CI/CD](./cicd.md) — pipeline gates, secret-handling in substitution variables
- [IDP](./idp.md) — per-tenant perimeter strategy
