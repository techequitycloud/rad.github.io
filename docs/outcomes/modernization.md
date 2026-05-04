# Application Modernization

The platform supports a structured modernisation programme from lift-and-shift through replatform to fully managed, scale-to-zero deployments — without requiring application rewrites at any stage.

## Lift-and-shift via VMware Engine

`modules/VMware_Engine/` provides a turnkey landing zone for migrating an existing VMware estate into Google Cloud:

- Enables required GCP APIs.
- Creates the VMware Engine Network and Private Cloud.
- Configures VPC Network Peering (GCVE ↔ your VPC).
- Provisions default firewall rules.
- Deploys a Windows Server 2022 jump host.
- Resets vCenter solution user credentials.

`modules/VMware_Engine/LAB_GUIDE.md` (*"Migrate to Virtual Machines v5 — Lab Guide"*) is a 2–3 hour hands-on walkthrough that documents what Terraform automates versus what the operator does manually, with timing estimates and prerequisites. This is Phase 1 — getting the existing VMware estate into Google Cloud without refactoring.

## Replatform via the application catalogue

Once on GCP, the application catalogue replaces hand-rolled VM stacks with managed, scale-to-zero or auto-scaled containers — without rewriting the application:

| Legacy stack | Modernised module |
|---|---|
| WordPress on a VM with MySQL | `Wordpress_CloudRun` / `Wordpress_GKE` + Cloud SQL |
| Wiki / knowledge base | `Wikijs_CloudRun` / `Wikijs_GKE` + Cloud SQL |
| Odoo ERP | `Odoo_CloudRun` / `Odoo_GKE` + Cloud SQL |
| Moodle LMS | `Moodle_CloudRun` / `Moodle_GKE` + Cloud SQL + Filestore |
| OpenEMR healthcare | `OpenEMR_*` + Cloud SQL |
| Cyclos banking | `Cyclos_*` |
| Ghost blogging | `Ghost_*` |
| Strapi headless CMS | `Strapi_*` |

## Managed-service substitution

Modernisation replaces self-hosted dependencies with managed equivalents:

| Self-hosted | Managed replacement | Canonical home |
|---|---|---|
| MySQL/PostgreSQL on a VM | Cloud SQL (private IP, PITR, HA, CMEK) | Data & Databases capability |
| Redis on a VM | Memorystore | Data & Databases capability |
| NFS server on a VM | Filestore | Data & Databases capability |
| Self-hosted Docker registry | Artifact Registry | CI/CD practices |
| Self-hosted CI/CD (Jenkins) | Cloud Build | CI/CD practices |
| Self-hosted secrets vault | Secret Manager | DevSecOps practices |
| Self-hosted observability stack | Cloud Monitoring + Logging | Observability capability |
| VPN for admin access | Identity-Aware Proxy | DevSecOps practices |

## Refactor to serverless

Cloud Run + GKE Autopilot remove the last vestiges of pre-provisioned compute, providing per-request billing and automatic scaling to zero. This is the final modernisation step — eliminating idle infrastructure cost alongside the operational overhead of managing nodes.

## Data migration tooling

`export-backup.sh`, `import-gcs-backup.sh`, and `import-gdrive-backup.sh`, together with per-app `db-init.sh` and `install-{mysql-plugins,postgres-extensions}.sh` scripts, handle the data-migration cutover from legacy storage to Cloud SQL and GCS.

## Hybrid-during-migration support

Migration is rarely a single cutover. The platform supports a hybrid phase:

- **VMware Engine** keeps the legacy estate reachable from GCP-native services throughout the migration.
- **Workload Identity Federation** federates external identities, eliminating the need to redistribute service account keys during cutover.
- VPN/Interconnect-friendly VPC topology keeps on-premises connectivity operational until the migration is complete.

## Security uplift as part of modernisation

Modernisation is also a chance to fix security. Private DB IP, IAP, Binary Authorization, VPC-SC, Cloud Armor, and CMEK appear automatically in every modernised deployment — not as optional extras, but as single-flag defaults. Teams arrive at a stronger security posture without a separate security remediation project.

## Programme-level documentation

- `MODERNIZATION_IMPLEMENTATION_PLAN.md` — the broader programme view.
- `MODERNIZATION_REVIEW.md` — review checklist.
- `REFACTORING_ANALYSIS.md` — architectural refactoring rationale.
- `ITEMIZED_PROPOSAL.md`, `PROPOSAL_DRAFT.md` — partner-facing proposal templates.
- `articles/cyclos-business-overview.md`, `cyclos-technical-deep-dive.md` — published case study.

## Quantified outcomes

95% faster provisioning, 95% maintenance reduction, and 30–50% compute/egress savings via CDN — see the Developer Productivity outcome for the full breakdown.

## See also

- Developer Productivity outcome — application catalogue (the modernisation targets)
- Serverless capability — Cloud Run / Autopilot as the replatform endpoint
- Data & Databases capability — managed-data substitutions
- Disaster Recovery capability — data-migration tooling
- Networking capability — hybrid VPC and VMware Engine peering
- DevSecOps practices — security uplift controls
