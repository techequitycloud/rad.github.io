# Multi-tenancy & SaaS Enablement

> **Scope.** Canonical home for the multi-tenant primitives — `app<name><tenant><id>` naming, per-deployment state isolation, per-tenant security perimeters, inline CIDR derivation, and the application catalogue as a marketplace surface. The underlying VPC-SC, IaC, and pipeline mechanics are referenced in their canonical homes.

## What this repo uniquely brings to multi-tenancy

### 1. Tenant identity in resource naming (canonical)

Per `CLAUDE.md`, every GCP resource follows the pattern `app<name><tenant><id>`:

- `<name>` — application (e.g., `django`, `wordpress`)
- `<tenant>` — tenant identifier
- `<id>` — deployment instance id

Consequences: self-identifying resources in Cloud Console / billing / audit logs; per-tenant chargeback via Cloud Billing labels (canonical in [practices/finops.md](../practices/finops.md)); trivial filter expressions; no cross-tenant resource conflicts.

### 2. Per-deployment Terraform state (cross-ref)

`_DEPLOYMENT_BUCKET_ID` substitution scopes Terraform state per tenant — no shared state file, no cross-tenant locking, independent upgrade cadence. Canonical in [practices/gitops_iac.md](../practices/gitops_iac.md) §2.

### 3. Per-deployment VPC-SC perimeters (canonical multi-tenant strategy)

`.agent/VPC_SC_PER_DEPLOYMENT_STRATEGY.md` documents the per-tenant perimeter pattern: each deployment gets its own VPC-SC service perimeter so Customer A cannot reach Customer B's Cloud SQL, GCS, or Secret Manager — even via a misconfigured service account.

**What is protected inside each perimeter:** Cloud SQL (private IP), GCS buckets (application data and backups), Secret Manager (database passwords, API keys), and Artifact Registry. The perimeter boundary means that even if a service account is compromised, it cannot exfiltrate data across tenant boundaries.

**Enforcement vs. dry-run:**
- `vpc_sc_dry_run = true` — enables observation mode. Would-be perimeter violations are logged to Cloud Logging as `DRYRUN_DENY` events without blocking traffic. `.agent/VPC_SC_TESTING_GUIDE.md` recommends a 1–2 week dry-run window before enforcement to identify legitimate cross-service API calls that need access policy exceptions.
- `vpc_sc_dry_run = false` — full enforcement. Violations are blocked and logged as `DENY` events in Cloud Audit Logs.

**Access policy configuration:** `admin_ip_ranges` allowlists operator CIDRs (e.g., corporate office IP, Cloud Build runner IP) that are permitted to call protected APIs from outside the perimeter.

The control mechanics (`enable_vpc_sc`, `admin_ip_ranges`, `vpc_sc_dry_run`) are canonical in [practices/devsecops.md](../practices/devsecops.md) §4.

### 4. Inline CIDR derivation (canonical)

`modules/App_GKE/prerequisites.tf` derives unique inline VPC CIDRs from `sha256(prereq_suffix)`:

- Multiple App_GKE inline deployments coexist in the same project without PSA peering route collisions.
- The sha256 of `prereq_suffix` is truncated and mapped into a valid RFC-1918 range, ensuring deterministic and collision-resistant CIDR assignment without a central IPAM.
- Override variables (`prereq_subnet_cidr_override`, `prereq_gke_pod_cidr_override`, `prereq_gke_service_cidr_override`) let existing deployments pin previous CIDRs through a migration window.
- Documented as `AGENTS.md` Foundation rule #13.

### 5. Per-tenant identity

- **Per-app Secret Manager namespace** — secrets created via Common modules with per-deployment naming.
- **Per-app service accounts** — `modules/App_CloudRun/sa.tf`, `modules/App_GKE/sa.tf` create dedicated workload identities scoped to the tenant's secrets/buckets/DB.
- **Per-app Workload Identity binding** — on GKE, each tenant deployment gets its own KSA→GSA binding.

Identity-tier control mechanics canonical in [practices/devsecops.md](../practices/devsecops.md) §2.

### 6. Tenant lifecycle

- **`deploy_application = false`** — platform exists without the application, useful for onboarding/offboarding.
- **`cloudbuild-destroy.yaml`** — clean per-tenant teardown.
- **`cloudbuild-purge.yaml`** — aggressive cleanup for orphans.
- **Backup/restore** — tenant data portability between deployments / projects / regions, canonical in [capabilities/disaster_recovery.md](disaster_recovery.md).

### 7. Multi-tenant pipeline architecture (cross-ref)

A single Cloud Build pipeline serves all tenants via substitutions. New tenants require zero pipeline changes. Pipeline canonical in [practices/cicd.md](../practices/cicd.md) §2.

### 8. Application catalogue as a marketplace surface

The pre-built application modules constitute a curated catalogue an operator can offer to tenants as turnkey deployments. Canonical list in [outcomes/developer_productivity.md](../outcomes/developer_productivity.md).

### 9. Partner-aware role documentation

`docs/workflows/partner.md`, `admin.md`, `support.md`, `finance.md`, `user.md`, `agent.md`, `getting-started.md` document the platform from each persona's perspective — the SaaS operating model.

## Cross-references

- [practices/devsecops.md](../practices/devsecops.md) — VPC-SC, IAM, WIF (control mechanics)
- [practices/gitops_iac.md](../practices/gitops_iac.md) — per-deployment state isolation
- [practices/cicd.md](../practices/cicd.md) — multi-tenant pipeline
- [practices/finops.md](../practices/finops.md) — per-tenant chargeback via Cloud Billing labels
- [capabilities/networking.md](networking.md) — VPC-SC and inline CIDR networking implications
- [capabilities/disaster_recovery.md](disaster_recovery.md) — tenant data portability
- [outcomes/developer_productivity.md](../outcomes/developer_productivity.md) — application catalogue
- [outcomes/compliance_governance.md](../outcomes/compliance_governance.md) — segregation of duties via persona docs
