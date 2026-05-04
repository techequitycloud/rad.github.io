# DevSecOps

> **Scope.** Canonical home for the security controls that the Foundation and Platform modules implement: identity, secrets, encryption, perimeters, supply chain, and the `/security` audit workflow. Other topics (compliance, networking, observability) reference the controls defined here.

> **Last reviewed:** 2026-05-04

## What this repo uniquely brings to DevSecOps

### 1. Security shifted left into IaC

- **Policy as code** — Every guardrail (IAP, Cloud Armor, Binary Authorization, VPC-SC, CMEK) is a Terraform resource, code-reviewed and version-controlled.
- **Plan-time validation** — `modules/App_CloudRun/validation.tf` and `modules/App_GKE/validation.tf` reject misconfigurations before any resource is created (see [practices/cicd.md](cicd.md) for the pipeline gates).
- **Mandatory `/security` workflow** — `AGENTS.md` defines a 30+ point audit checklist covering IAM, VPC-SC, Binary Authorization, Secret Manager, network, database, container, and audit controls.

### 2. Identity and access (canonical)

- **Per-app service accounts** — `modules/App_CloudRun/sa.tf`, `modules/App_GKE/sa.tf`. Roles restricted to `secretmanager.secretAccessor`, `cloudsql.client`, `storage.objectAdmin`.
- **Workload Identity Federation** — `modules/Services_GCP/wif.tf`. Federates external IdPs (Okta, AWS, Azure AD, GitHub Actions) without long-lived service-account keys.
- **Identity-Aware Proxy** — `modules/App_CloudRun/iap.tf`, `modules/App_GKE/iap.tf`. Native IAP (no load balancer required for Cloud Run); auto-normalises email prefixes (`user:`, `serviceAccount:`, `group:`). Replaces VPNs with Google's Zero-Trust model in one boolean (`enable_iap = true`). See `IAP_IMPLEMENTATION_PLAN.md` and `enable-iap-feature.sh`.

### 3. Secret management (canonical)

- **No hardcoded secrets** — `AGENTS.md` and `CLAUDE.md` make this absolute.
- **CSI driver mounting** — `modules/App_GKE/secrets.tf` mounts secrets via the GKE Secrets Store CSI driver (`secrets-store-gke.csi.k8s.io`).
- **GitHub PAT hardening** — Tokens passed only via the `environment` block of `local-exec`, never in `command` strings, `triggers`, or module outputs (`AGENTS.md` Foundation rule #7). Prevents serialisation into `terraform.tfstate`.
- **Credential-store cloning** — `git clone` uses the credential-store helper instead of `https://TOKEN@github.com/...` URLs.
- **Secret-path correctness** — Common modules output `.secret_id` (short form), not `.id` (full path); using `.id` doubles the path in CSI mounts.
- **Pre-commit secret scanners** — `check_secrets.py`, `check_secrets_cr.py`.

### 4. VPC Service Controls (canonical)

- `modules/Services_GCP/vpc_sc.tf` + `modules/App_CloudRun/vpc_sc.tf` + `modules/App_GKE/vpc_sc.tf`.
- Three user-facing variables: `enable_vpc_sc`, `admin_ip_ranges`, `vpc_sc_dry_run`.
- Phased rollout documented in `.agent/VPC_SC_QUICK_START.md`, `VPC_SC_TESTING_GUIDE.md`, `VPC_SC_PER_DEPLOYMENT_STRATEGY.md`. Always enable dry-run first, monitor for 1–2 weeks, then enforce.
- Per-tenant perimeter strategy — see [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md).

### 5. Supply chain and container security (canonical)

- **Binary Authorization** — `modules/Services_GCP/binauthz.tf` enforces signed images at admission. The `enable_binary_authorization` flag wires apps in.
- **CMEK** — `modules/Services_GCP/cmek.tf`. Customer-managed encryption keys for Cloud SQL, Filestore, GCS, Secret Manager.
- **Non-root containers** — UID 2000 for GCS Fuse compatibility and least-privilege execution.
- **Artifact Registry vulnerability scanning** — enable `google_artifact_registry_repository` with `docker_config.immutable_tags = true` and activate Artifact Analysis scanning. Critical and High severity CVEs should block promotion via a Binary Authorization attestation rule; scanner results are surfaced in Security Command Center.
- **SBOM generation** — Software Bill of Materials artifacts can be generated during the Cloud Build image-build step using `docker buildx` with SBOM attestation (`--sbom=true`) and stored alongside the image in Artifact Registry. This enables downstream tooling to audit transitive dependency provenance.
- Image lifecycle policies (Artifact Registry cleanup) — see [practices/finops.md](finops.md).

### 6. Network security primitives

- **Cloud Armor WAF** — `modules/App_CloudRun/security.tf`, `modules/App_GKE/security.tf`.
- **Kubernetes NetworkPolicy** — `modules/App_GKE/network_policy.tf`.
- **Firewall rules** — `modules/App_GKE/firewall.tf` (deny-by-default; no `target_tags` for Autopilot compatibility).

The full network-layer view (VPC, NAT, PSA, mesh, ingress controls) is in [capabilities/networking.md](../capabilities/networking.md).

### 7. TLS and certificate management

All ingress paths terminate TLS; certificate lifecycle is managed automatically:

- **Cloud Run** — Google-managed TLS certificates are provisioned automatically for custom domains mapped to Cloud Run services. No manual rotation is required.
- **GKE Autopilot** — Google-managed certificates via `ManagedCertificate` resources (or GKE Gateway API `certificateMap` annotations). The `modules/App_GKE/gateway.tf` wires these to the Gateway resource.
- **Certificate rotation** — Google-managed certs rotate 30 days before expiry without operator intervention. For bring-your-own-certificate scenarios, Secret Manager stores the PEM bundle and `modules/App_GKE/secrets.tf` mounts it as a CSI volume.
- **Internal services** — Service mesh (where enabled) handles mTLS between pods using Workload Identity-backed certificates; see [capabilities/networking.md](../capabilities/networking.md).

### 8. Secrets rotation policy

Secret creation is handled by the Common modules, but rotation must be operationalised:

- **Rotation cadence** — Database passwords and API keys should be rotated at least every 90 days. Secret Manager supports automatic rotation via Cloud Scheduler → Cloud Functions → `AddSecretVersion` + `DisableSecretVersion`.
- **Rotation notification** — Configure a `google_secret_manager_secret_rotation` resource (via `topics` on the secret) so that a Pub/Sub message is emitted when rotation is due; a Cloud Function or manual process then generates the new credential, adds the new version, and updates the consuming service.
- **Zero-downtime rotation** — The two-version overlap pattern: add the new version, deploy the updated app (which reads the latest active version), then disable the old version. Cloud Run and GKE read secret values at startup; a rolling restart completes the cutover.
- **GitHub PAT rotation** — PATs used by `GIT_TOKEN` should be scoped to the minimum required permission (read-only repository access) and rotated on the same 90-day cadence via the Workload Identity Federation path where possible.

### 9. Security incident response

The `/security` audit workflow catches configuration drift before it becomes an incident. When a finding does require response:

- **Triage** — Security Command Center findings are the canonical source of truth. Severity HIGH/CRITICAL findings trigger a PagerDuty alert (configured in `modules/Services_GCP`); MEDIUM findings create a GitHub issue via the SCC notification → Pub/Sub → Cloud Function pipeline.
- **Containment** — For IAM over-permission findings: revoke the binding immediately via `gcloud` (emergency break-glass), then reconcile back to the IaC-defined state on the next `tofu apply`. Never add emergency IAM bindings to `.tf` files without a PR.
- **Remediation SLA** — Critical: 4 hours to containment, 24 hours to root cause. High: 24 hours to containment, 72 hours to root cause. Medium: next sprint.
- **Post-mortem** — All Critical and High incidents result in a blameless post-mortem (see [practices/sre.md](sre.md) §6). Findings feed back into the `/security` audit checklist in `AGENTS.md`.

## Cross-references

- [capabilities/networking.md](../capabilities/networking.md) — VPC, mesh, edge, ingress controls (network-layer view)
- [capabilities/observability.md](../capabilities/observability.md) — Cloud Audit Logs, Security Command Center, dry-run violation observation
- [outcomes/compliance_governance.md](../outcomes/compliance_governance.md) — auditor-evidence framing of these controls
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — per-tenant perimeter strategy
- [practices/gitops_iac.md](gitops_iac.md) — secret-out-of-state mechanics
- [practices/sre.md](sre.md) — post-mortem process, on-call model
