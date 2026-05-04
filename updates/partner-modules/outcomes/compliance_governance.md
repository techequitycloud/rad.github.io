# Compliance & Governance

> **Scope.** Auditor-evidence framing of the platform: how to assemble the control-evidence references for SOC 2 / ISO 27001 / HIPAA / GDPR programmes from the controls and observability surfaces defined elsewhere. This file is largely a curated index; the controls themselves are canonical in [practices/devsecops.md](../practices/devsecops.md) and [capabilities/observability.md](../capabilities/observability.md).

## What this repo uniquely brings to compliance & governance

### 1. Infrastructure as auditable code

- **Every change is a Git commit** — reviewed, attributable, reversible. Standard change-management evidence.
- **Every deployment is a Cloud Build run** — inputs, build steps, outputs, durations all recorded; auditable and exportable.
- **Reproducible builds** — `commit_hash.txt` + `repo_url.txt` per deployment make any prior production state reconstructible. IaC mechanics canonical in [practices/gitops_iac.md](../practices/gitops_iac.md).
- **No "click-ops"** — all controls expressed as Terraform resources.

`BUSINESS_CASE.md`: *"Infrastructure code can be scanned and audited. Changes are tracked via Git (Audit Trail), essential for SOC2/ISO27001 compliance."*

### 2. Audit trail and security findings (cross-ref)

The complete audit/observability surface — Cloud Audit Logs, Security Command Center, mesh telemetry, dashboards, alert policies — is canonical in [capabilities/observability.md](../capabilities/observability.md).

### 3. Control inventory (auditor evidence map)

Map of common audit-control families to their canonical home in this repo:

| Control family | Canonical home |
|---|---|
| Identity and access (least privilege, WIF, IAP) | [practices/devsecops.md](../practices/devsecops.md) §2 |
| Secret management | [practices/devsecops.md](../practices/devsecops.md) §3 |
| Data residency / network isolation (VPC-SC, private IP) | [practices/devsecops.md](../practices/devsecops.md) §4, [capabilities/networking.md](../capabilities/networking.md) |
| Supply chain integrity (Binary Authorization, AR, CMEK) | [practices/devsecops.md](../practices/devsecops.md) §5 |
| Network controls (Cloud Armor, NetworkPolicy, firewall) | [practices/devsecops.md](../practices/devsecops.md) §6 |
| Audit logging (Cloud Audit Logs, SCC) | [capabilities/observability.md](../capabilities/observability.md) §4–5 |
| Backup / DR | [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) |
| Tenant isolation | [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) |
| Change management | [practices/cicd.md](../practices/cicd.md), `AGENTS.md` `/maintain` |

### 4. Mandatory `/security` audit workflow

`AGENTS.md` `/security` defines a 30+ point recurring audit checklist designed as the control-evidence collection workflow for SOC 2 / ISO 27001 audits. Categories:

- IAM & service accounts
- VPC Service Controls
- Binary Authorization
- Secret management
- Network security
- Database security
- Container security
- Compliance & audit

### 5. Change-management discipline

`AGENTS.md` `/maintain` codifies the change process (canonical in [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) §8): pre-change state review and backup; post-change verification and metric monitoring; critical-change gates for VPC / NFS / DB.

### 6. Segregation-of-duties via persona docs

`docs/workflows/` provides explicitly-separated documentation for each operational persona:

- `admin.md` — platform administrators
- `partner.md` — partner / reseller operations
- `support.md` — tenant support
- `finance.md` — billing / chargeback
- `user.md` — end-user
- `agent.md` — AI-assisted operations
- `getting-started.md` — onboarding

This persona separation is the structural evidence auditors look for as proof of segregation of duties.

### 7. Per-tenant compliance (cross-ref)

Per-deployment VPC-SC perimeters, per-tenant Cloud Billing labels, per-app service accounts — multi-tenant isolation that satisfies tenant-scoped compliance requirements. Canonical in [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md).

## Cross-references

- [practices/devsecops.md](../practices/devsecops.md) — the controls themselves
- [capabilities/observability.md](../capabilities/observability.md) — audit-log and security-finding sources
- [practices/gitops_iac.md](../practices/gitops_iac.md) — IaC reproducibility / immutable change history
- [practices/cicd.md](../practices/cicd.md) — pipeline-level change management
- [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) — backup, rollback, change-management checklist
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — per-tenant isolation
- [outcomes/education_enablement.md](education_enablement.md) — `/security` workflow alongside other agent workflows
