# FinOps Adoption

> **Scope.** The cost lens on the platform: scale-to-zero defaults, lifecycle policies that prevent runaway storage costs, cost-allocation labels, tier-configurable services, and the documented cost-vs-performance trade-offs. The serverless runtime characteristics that make scale-to-zero possible are canonical in [capabilities/serverless.md](../capabilities/serverless.md).

## What this repo uniquely brings to FinOps

### 1. Lifecycle policies (canonical)

Storage-cost creep is automated away:

- **Cloud Run revision pruning** — `modules/App_CloudRun/scripts/prune-old-revisions.sh` runs as a `null_resource` after every apply. Retains only `max_revisions_to_retain` revisions (default 7); always preserves traffic-serving revisions; set to 0 to disable.
- **Artifact Registry cleanup** — `modules/App_CloudRun/registry.tf`. `max_images_to_retain`, `delete_untagged_images`, `image_retention_days` apply only to inline-created repos and are scoped to the application name prefix.
- **GCS bucket lifecycle** — `app_storage_wrapper` sub-module in `App_Common` configures bucket-level lifecycle rules.

### 2. Cost-allocation labels (canonical)

The `app<name><tenant><id>` naming convention (canonical in [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md)) flows into Cloud Billing, enabling per-tenant chargeback via simple BigQuery views over the billing export.

`modules/Services_GCP/gke_metering.tf` documents the recommended Autopilot cost-visibility path: Cloud Billing export to BigQuery + GKE cost-allocation labels + Monitoring dashboards (the legacy resource-usage export API is not available on Autopilot).

### 3. Tier-configurable shared services

Every expensive shared resource is tier-configurable via Platform-module variables:

- Cloud SQL (`db-custom-*` tiers), HA / PITR optional
- Memorystore Redis (`BASIC` vs `STANDARD_HA`)
- Filestore NFS (`BASIC_HDD` / `BASIC_SSD` / `ZONAL`); `enable_nfs = false` to skip entirely
- Cloud Run resources (`cpu_limit`, `memory_limit`)

Full tier list and module locations: [capabilities/data_and_databases.md](../capabilities/data_and_databases.md).

### 4. Cost vs performance trade-offs (canonical)

`AGENTS.md` `/performance` workflow documents three explicit cost/performance profiles:

| Profile | Settings |
|---|---|
| Low Cost | `min_instance_count = 0`, scale-to-zero, smaller DB instance |
| Low Latency | `min_instance_count = 1`, larger resources, connection pooling |
| Balanced | `min_instance_count = 0`, right-sized resources, caching enabled |

### 5. CDN cost offload

`enable_cdn = true` (see [capabilities/networking.md](../capabilities/networking.md) for the implementation) offloads cacheable traffic from compute to edge. `BUSINESS_CASE.md` projects 30–50% compute/egress savings on read-heavy apps.

### 6. Quantified business case

Per `BUSINESS_CASE.md` §3.C and `IAC_AUTOMATION_BUSINESS_CASE.md`:

- 95% provisioning-time reduction.
- 95% maintenance-effort reduction across a 10-app portfolio.
- >$100k/year operational savings projected for a mid-size portfolio.

## Cross-references

- [capabilities/serverless.md](../capabilities/serverless.md) — scale-to-zero, VPA, per-second billing (the runtime mechanics enabling these savings)
- [capabilities/data_and_databases.md](../capabilities/data_and_databases.md) — tier-configurable backing services
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — `app<name><tenant><id>` naming and per-tenant chargeback
- [capabilities/networking.md](../capabilities/networking.md) — CDN configuration
- [practices/sre.md](sre.md) — revision pruning as toil reduction (operational lens)
