# Application Modernisation

> **Scope.** Canonical home for the modernisation programme angle — VMware Engine as lift-and-shift landing zone, replatform via the application catalogue, managed-service substitution, and migration tooling. Underlying capabilities live in their canonical homes (data, networking, devsecops, serverless).

## What this repo uniquely brings to modernisation

### 1. Lift-and-shift via VMware Engine (canonical)

`modules/VMware_Engine/` plus `modules/VMware_Engine/LAB_GUIDE.md` (*"Migrate to Virtual Machines v5 — Lab Guide"*) provides a turnkey landing zone:

- Enables required GCP APIs.
- Creates the VMware Engine Network and Private Cloud.
- Configures VPC Network Peering (GCVE ↔ your VPC).
- Provisions default firewall rules.
- Deploys a Windows Server 2022 jump host.
- Resets vCenter solution user credentials.

The canonical "Phase 1" — get the existing VMware estate into Google Cloud without refactoring.

### 2. Replatform via the application catalogue (cross-ref)

Once on GCP, the catalogue (canonical in [outcomes/developer_productivity.md](developer_productivity.md)) replaces hand-rolled VM stacks with managed, scale-to-zero or auto-scaled containers — without rewriting the application:

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

### 3. Managed-service substitution

Modernisation replaces self-hosted dependencies with managed equivalents:

| Self-hosted | Managed replacement | Canonical home |
|---|---|---|
| MySQL/PostgreSQL on a VM | Cloud SQL (private IP, PITR, HA, CMEK) | [capabilities/data_and_databases.md](../capabilities/data_and_databases.md) |
| Redis on a VM | Memorystore | [capabilities/data_and_databases.md](../capabilities/data_and_databases.md) |
| NFS server on a VM | Filestore | [capabilities/data_and_databases.md](../capabilities/data_and_databases.md) |
| Self-hosted Docker registry | Artifact Registry | [practices/cicd.md](../practices/cicd.md) |
| Self-hosted CI/CD (Jenkins) | Cloud Build | [practices/cicd.md](../practices/cicd.md) |
| Self-hosted secrets vault | Secret Manager | [practices/devsecops.md](../practices/devsecops.md) |
| Self-hosted observability stack | Cloud Monitoring + Logging | [capabilities/observability.md](../capabilities/observability.md) |
| VPN for admin access | Identity-Aware Proxy | [practices/devsecops.md](../practices/devsecops.md) |

### 4. Refactor to serverless (cross-ref)

Cloud Run + GKE Autopilot remove the last vestiges of pre-provisioned compute. Runtime mechanics canonical in [capabilities/serverless.md](../capabilities/serverless.md).

### 5. Data migration tooling (cross-ref)

`export-backup.sh`, `import-gcs-backup.sh`, `import-gdrive-backup.sh` plus the per-app `db-init.sh` and `install-{mysql-plugins,postgres-extensions}.sh` scripts handle the data-migration cutover. Canonical in [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) and [capabilities/data_and_databases.md](../capabilities/data_and_databases.md).

### 6. Hybrid-during-migration support

- **VMware Engine** keeps the legacy estate reachable from GCP-native services.
- **Workload Identity Federation** federates external identities (canonical in [practices/devsecops.md](../practices/devsecops.md)).
- VPN/Interconnect-friendly VPC topology — canonical in [capabilities/networking.md](../capabilities/networking.md).

### 7. Security uplift as part of modernisation (cross-ref)

Modernisation is also a chance to fix security: private DB IP, IAP, Binary Authorization, VPC-SC, Cloud Armor, CMEK appear automatically in modernised deployments. Canonical in [practices/devsecops.md](../practices/devsecops.md).

### 8. Programme-level documentation

- `MODERNIZATION_IMPLEMENTATION_PLAN.md` — the broader programme view.
- `MODERNIZATION_REVIEW.md` — review checklist.
- `REFACTORING_ANALYSIS.md` — architectural refactoring rationale (e.g., extracting App_Common sub-modules).
- `ITEMIZED_PROPOSAL.md`, `PROPOSAL_DRAFT.md` — partner-facing proposal templates.
- `articles/cyclos-business-overview.md`, `cyclos-technical-deep-dive.md` — published case study.

### 9. Quantified outcomes (cross-ref)

95% faster provisioning, 95% maintenance reduction, 30–50% compute/egress savings via CDN — canonical in [outcomes/developer_productivity.md](developer_productivity.md) §4.

## Cross-references

- [outcomes/developer_productivity.md](developer_productivity.md) — application catalogue (the modernisation targets)
- [capabilities/serverless.md](../capabilities/serverless.md) — Cloud Run / Autopilot as the replatform endpoint (§1–3)
- [capabilities/data_and_databases.md](../capabilities/data_and_databases.md) — managed-data substitutions
- [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) — data-migration tooling (§1)
- [capabilities/networking.md](../capabilities/networking.md) — hybrid VPC and VMware Engine peering
- [practices/devsecops.md](../practices/devsecops.md) — security uplift controls (§2 identity, §3 secrets, §5 supply chain, §6 network)
