# Compliance & Governance

The platform delivers a concrete, auditable compliance posture across SOC 2 Type II, ISO 27001, HIPAA, and GDPR programmes. Controls are expressed as code, changes are tracked as Git commits, and evidence is pre-assembled rather than manually collected at audit time.

## Infrastructure as auditable code

Every change to the platform is a Git commit — reviewed, attributable, and reversible. Every deployment is a Cloud Build run with inputs, build steps, outputs, and durations all recorded and exportable as standard change-management evidence. Reproducible builds (`commit_hash.txt` + `repo_url.txt` per deployment) make any prior production state reconstructible. There is no "click-ops" — all controls are expressed as Terraform resources, and `tools/check-tf-plan.py` enforces guardrails at plan time to block misconfigurations before `apply`.

## IAM and separation of duties

Distinct role bundles — `super_admin`, `developers_infrastructure`, `developers_frontend`, `developers_backend_api` — ensure no single role both authors and approves changes. Per-workload service accounts are narrowly scoped to only the roles required for their function. Application service accounts hold only `secretmanager.secretAccessor`, `cloudsql.client`, or `storage.objectAdmin` as appropriate, and GKE workloads use Workload Identity Federation to eliminate long-lived key files entirely.

Role assignments should be reviewed periodically to maintain least-privilege as team membership changes. The structural separation of operational personas (`admin`, `partner`, `support`, `finance`, `user`, `agent`) in `docs/workflows/` provides the segregation-of-duties evidence auditors require.

## Data classification and residency

The platform handles three categories of data with differentiated protection:

| Category | Data | Protection |
|---|---|---|
| PII / identity | Firebase auth tokens, user profile data | `verifyIdToken` on every sensitive API route; row-level Firestore rules |
| Financial | Credit balances, invoices, BigQuery billing export, payment payloads | Webhook signature verification across all providers; role-scoped API routes |
| Operational | Deployment state, Cloud Function logs, Terraform state | GCS bucket IAM; Cloud Logging access controls |

Secrets are stored in Secret Manager and never placed in environment variables visible in the console, Terraform state, or container images. Secrets bound to Cloud Build pipelines use region-pinned replication (`us-central1`) to satisfy data-residency requirements.

## Control inventory

Map of common audit-control families to their canonical implementation in the platform:

| Control family | Implementation |
|---|---|
| Identity and access (least privilege, WIF, IAP) | `infrastructure/iam_permissions.tf`; DevSecOps §2 |
| Secret management and rotation | `enable_auto_password_rotation`; `src/utils/secrets.ts`; DevSecOps §3 |
| Data residency / network isolation (VPC-SC, private IP) | DevSecOps §4; Networking capability |
| Supply chain integrity (Binary Authorization, AR, CMEK) | `enable_binary_authorization = true`; DevSecOps §5 |
| Network controls (Cloud Armor, NetworkPolicy, firewall) | `enable_cloud_armor = true`; DevSecOps §6 |
| Audit logging (Cloud Audit Logs, SCC) | `modules/Services_GCP/audit.tf`; `scc.tf`; Observability capability §4–5 |
| Backup / DR | Disaster Recovery capability |
| Tenant isolation | Multitenancy & SaaS capability |
| Change management | CI/CD practices; `AGENTS.md` `/maintain` |
| License and documentation compliance | `tools/check-license.py`; `tools/check_documentation.py` |

## Third-party and supply chain risk

Three payment providers (Stripe, Paystack, Flutterwave) and GCP managed services are the primary third-party dependencies. Webhook payloads are rejected unless the provider's HMAC or signature validates. `pnpm audit` in CI blocks PRs with high or critical findings in third-party npm packages. Container images are built from a pinned Node 20 Alpine base, enabling vulnerability scanning via Google Artifact Analysis.

## Audit workflows

`AGENTS.md` `/security` defines a 30+ point recurring audit checklist designed as the control-evidence collection workflow for SOC 2 / ISO 27001 audits, covering IAM and service accounts, VPC Service Controls, Binary Authorization, secret management, network security, database security, container security, and compliance logging. `AGENTS.md` `/maintain` codifies the change process: pre-change state review and backup, post-change verification and metric monitoring, and critical-change gates for VPC, NFS, and database operations.

## Quantified compliance value

| Area | Manual approach | With this platform |
|---|---|---|
| SOC 2 / ISO 27001 audit prep | 6–12 weeks of dedicated evidence collection | Pre-assembled evidence map; controls are code, not screenshots |
| Audit trail | Manually assembled from disparate logs | Every change is a Git commit + Cloud Build run — attributable, reversible, exportable |
| Secret rotation | Manual or bespoke scripting | Automated via Cloud Scheduler + Cloud Run Jobs (`enable_auto_password_rotation`) |
| Control drift detection | Periodic manual review | IaC re-apply reverts drift; plan-time validation blocks misconfigurations before apply |

## Per-tenant compliance

Per-deployment VPC-SC perimeters, per-tenant Cloud Billing labels, and per-app service accounts provide multi-tenant isolation that satisfies tenant-scoped compliance requirements. See the Multitenancy & SaaS capability for the full isolation model.

## Incident response

Security and operational incidents should be escalated through the notification fan-out described in the Observability capability. A formal incident response runbook covering classification, containment, and post-mortem steps should be maintained alongside these controls.

## See also

- DevSecOps practices — the controls compliance builds on
- Observability capability — audit logging and security findings
- GitOps & IaC practices — IaC reproducibility and immutable change history
- CI/CD practices — pipeline-level change management
- Disaster Recovery capability — backup, rollback, and change-management checklist
- Multitenancy & SaaS capability — per-tenant isolation
- Security & Zero Trust outcome — security-posture framing of the same controls
