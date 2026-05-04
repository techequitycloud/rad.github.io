# Cost Optimisation

> **Scope.** Canonical home for the cost-optimisation outcomes delivered by the platform: scale-to-zero compute, automated storage lifecycle, cost-allocation visibility, tier-configurable services, and the quantified business case. The FinOps practices and implementation mechanics are canonical in [practices/finops.md](../practices/finops.md).

## What this repo uniquely brings to cost optimisation

### 1. Scale-to-zero compute (cross-ref)

Setting `min_instance_count = 0` eliminates compute costs when no traffic is being served. Cloud Run bills per request, per second — idle applications cost nothing. GKE Autopilot bills per pod resource request rather than per provisioned node, with Vertical Pod Autoscaling continuously right-sizing requests to eliminate waste.

Runtime mechanics canonical in [capabilities/serverless.md](../capabilities/serverless.md) §1–3.

### 2. Automated storage lifecycle (canonical)

Storage cost creep is automated away by default:

- **Cloud Run revision pruning** — `modules/App_CloudRun/scripts/prune-old-revisions.sh` retains only `max_revisions_to_retain` revisions (default 7) after every deploy; traffic-serving revisions are always preserved.
- **Artifact Registry cleanup** — `max_images_to_retain`, `delete_untagged_images`, `image_retention_days` prevent unbounded image accumulation.
- **GCS bucket lifecycle** — per-bucket lifecycle rules automate transition to cheaper storage classes (Nearline, Coldline, Archive).

Full implementation in [practices/finops.md](../practices/finops.md) §1.

### 3. CDN cost offload (cross-ref)

`enable_cdn = true` routes cacheable responses to Google edge points of presence, offloading them from compute. `BUSINESS_CASE.md` projects 30–50% compute and egress savings on read-heavy applications. CDN implementation in [capabilities/networking.md](../capabilities/networking.md).

### 4. Cost-allocation visibility (canonical)

The `app<name><tenant><id>` resource-naming convention flows directly into Cloud Billing labels, enabling per-tenant chargeback reports via simple BigQuery views over the billing export — no manual tagging required. `modules/Services_GCP/gke_metering.tf` adds GKE pod-level cost visibility on Autopilot clusters.

Canonical in [practices/finops.md](../practices/finops.md) §2 and [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) §1.

### 5. Tier-configurable shared services

Every expensive shared resource exposes cost/performance trade-off variables:

| Service | Cost control variables |
|---|---|
| Cloud SQL | `db-custom-*` tiers; HA and PITR optional |
| Memorystore Redis | `BASIC` vs `STANDARD_HA` |
| Filestore NFS | `BASIC_HDD` / `BASIC_SSD` / `ZONAL`; `enable_nfs = false` to skip entirely |
| Cloud Run | `cpu_limit`, `memory_limit`, `min_instance_count`, `max_instance_count`, concurrency |

Full tier reference in [capabilities/data_and_databases.md](../capabilities/data_and_databases.md).

### 6. Cost vs performance profiles

`AGENTS.md` `/performance` documents three explicit deployment profiles:

| Profile | Key settings |
|---|---|
| Low Cost | `min_instance_count = 0`, scale-to-zero, smallest viable DB instance |
| Low Latency | `min_instance_count = 1`, larger resources, connection pooling, Redis caching |
| Balanced | `min_instance_count = 0`, right-sized resources, CDN and Redis enabled |

### 7. Quantified business case

Per `BUSINESS_CASE.md` §3.C and `IAC_AUTOMATION_BUSINESS_CASE.md`:

| Metric | Value |
|---|---|
| Provisioning time reduction | ~95% (3–5 days → <2 hours) |
| Cost per new application setup | $200 vs $3,200 manually |
| Maintenance effort reduction (10-app portfolio) | ~95% (40 h → 2 h per cycle) |
| Maintenance cost reduction (10-app portfolio) | $4,000 → $200 per cycle |
| Projected annual savings (mid-size portfolio) | >$100,000 |
| Compute/egress savings on read-heavy apps | 30–50% via CDN offload |

## Cross-references

- [practices/finops.md](../practices/finops.md) — implementation mechanics (scale-to-zero, lifecycle policies, cost-allocation labels, tier trade-offs)
- [capabilities/serverless.md](../capabilities/serverless.md) — Cloud Run / GKE Autopilot per-second billing mechanics (§1–3)
- [capabilities/data_and_databases.md](../capabilities/data_and_databases.md) — tier-configurable backing services
- [capabilities/networking.md](../capabilities/networking.md) — CDN configuration and cost offload
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — per-tenant chargeback via resource naming (§1)
- [outcomes/developer_productivity.md](developer_productivity.md) — quantified provisioning and maintenance savings (§4)
