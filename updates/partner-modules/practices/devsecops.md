# DevSecOps

> **Scope.** Canonical home for the security controls that the Foundation and Platform modules implement: identity, secrets, encryption, perimeters, supply chain, and the `/security` audit workflow. Other topics (compliance, networking, observability) reference the controls defined here.

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
- Image lifecycle policies (Artifact Registry cleanup) — see [practices/finops.md](finops.md).

### 6. Network security primitives

- **Cloud Armor WAF** — `modules/App_CloudRun/security.tf`, `modules/App_GKE/security.tf`.
- **Kubernetes NetworkPolicy** — `modules/App_GKE/network_policy.tf`.
- **Firewall rules** — `modules/App_GKE/firewall.tf` (deny-by-default; no `target_tags` for Autopilot compatibility).

The full network-layer view (VPC, NAT, PSA, mesh, ingress controls) is in [capabilities/networking.md](../capabilities/networking.md).

## Cross-references

- [capabilities/networking.md](../capabilities/networking.md) — VPC, mesh, edge, ingress controls (network-layer view)
- [capabilities/observability.md](../capabilities/observability.md) — Cloud Audit Logs, Security Command Center, dry-run violation observation
- [outcomes/compliance_governance.md](../outcomes/compliance_governance.md) — auditor-evidence framing of these controls
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — per-tenant perimeter strategy
- [practices/gitops_iac.md](gitops_iac.md) — secret-out-of-state mechanics
