# Zero Trust Security

The platform delivers a zero-trust security posture by default. Rather than relying on network-perimeter assumptions, every access decision is identity-verified, every credential is stored and rotated automatically, every container image is cryptographically attested, and every deployment is surrounded by a data-exfiltration perimeter. These controls are single-flag defaults — not optional extras — so modernised deployments arrive with a strong security posture without a separate security remediation project.

## Zero-trust access replacing VPN

`enable_iap = true` deploys Identity-Aware Proxy, requiring Google identity authentication for every request before it reaches the application — no VPN client, no open firewall ports, no network-layer perimeter to provision or maintain.

- Remote access to internal applications is gated on Google Workspace or Cloud Identity credentials.
- Every access attempt is logged with user identity, timestamp, and context.
- Access is revoked instantly by removing an IAM binding; no firewall rule changes required.
- Authorised users and groups are declared in IaC (`iap_authorized_users`, `iap_authorized_groups`), version-controlled and auditable.

## WAF and DDoS protection at the edge

`enable_cloud_armor = true` deploys a Global External Application Load Balancer with Cloud Armor WAF policies:

- OWASP Top 10 mitigations (SQL injection, XSS, path traversal) applied at the Google edge before traffic reaches the application.
- Adaptive rate limiting throttles credential-stuffing bots and burst abuse during peak periods.
- IP allowlist / denylist rules via `admin_ip_ranges` lock down administrative paths.
- All traffic passes through Google's global DDoS mitigation infrastructure at no additional configuration cost.

## Secrets never in plaintext

The platform eliminates credential-in-environment-variable exposure by design:

- All sensitive values (database passwords, API keys, tokens) are stored in Secret Manager — never in environment variables visible in the console, Terraform state, or container images.
- GKE workloads mount secrets via the CSI driver at runtime; Cloud Run resolves them at revision startup.
- Automated rotation (`enable_auto_password_rotation`) shortens credential validity windows without operator intervention.
- Pre-commit scanners (`check_secrets.py`, `check_secrets_cr.py`) block accidental commits containing plaintext credentials.

## Software supply chain integrity

`enable_binary_authorization = true` enforces signed-image attestation at deployment time:

- Only container images with a valid cryptographic attestation (signed by an authorised key in Cloud KMS) are admitted to Cloud Run or GKE.
- Unsigned, unscanned, or tampered images are rejected at the admission controller before they can run.
- Artifact Registry vulnerability scanning surfaces CVEs in base images before deployment.

Combined with CMEK (`modules/Services_GCP/cmek.tf`), data at rest is protected with customer-controlled keys across Cloud SQL, Filestore, GCS, and Secret Manager.

`pnpm audit` in CI blocks PRs with high or critical findings in third-party npm packages. Webhook payloads from payment providers are rejected unless the provider's HMAC or signature validates.

## Data exfiltration prevention via VPC Service Controls

`enable_vpc_sc = true` wraps GCP service APIs in a service perimeter:

- Prevents data from being copied out of the project via the GCP API plane, even by a compromised service account with valid credentials.
- Per-tenant perimeters ensure Customer A cannot reach Customer B's Cloud SQL, GCS, or Secret Manager resources.
- `vpc_sc_dry_run = true` enables a safe observation window before enforcement; violation logs surface in Cloud Audit Logs for review.

## Principle of least privilege by default

Every deployment provisions dedicated, narrowly-scoped service accounts rather than relying on the default compute service account:

- Application service accounts hold only the roles required for their function (`secretmanager.secretAccessor`, `cloudsql.client`, `storage.objectAdmin`).
- GKE workloads use Workload Identity Federation — no long-lived key files to rotate, store, or accidentally expose.
- Plan-time validation (`modules/App_CloudRun/validation.tf`, `modules/App_GKE/validation.tf`) rejects misconfigurations before any resource is created.

Distinct role bundles across the platform — `super_admin`, `developers_infrastructure`, `developers_frontend`, `developers_backend_api` — ensure no single role both authors and approves changes.

## Continuous security posture visibility

`modules/Services_GCP/scc.tf` enables Security Command Center (SCC) to aggregate misconfigurations, vulnerabilities, and threat findings across the project in a single pane. `modules/Services_GCP/audit.tf` enables project-wide Admin Activity, Data Access, and System Event audit logs with an optional BigQuery sink for long-term retention.

The `AGENTS.md` `/security` workflow provides a 30+ point recurring audit checklist covering IAM and service accounts, VPC Service Controls, Binary Authorization, secret management, network security, database security, container security, and compliance logging. This can be executed against any deployment at any time and serves as both an operational control and an auditor-facing evidence artefact.

## See also

- DevSecOps practices — control implementation mechanics
- Compliance & Governance outcome — auditor-evidence framing of these controls
- Observability capability — Security Command Center, Cloud Audit Logs, and security-finding surfaces
- Multitenancy & SaaS capability — per-tenant VPC-SC perimeters
- Networking capability — network security layer (Cloud Armor, Kubernetes NetworkPolicy, firewall rules)
