# FinOps Adoption

> **Scope.** The cost lens on the platform: scale-to-zero defaults, lifecycle policies that prevent runaway storage costs, cost-allocation labels, tier-configurable services, and the documented cost-vs-performance trade-offs. The serverless runtime characteristics that make scale-to-zero possible are canonical in [capabilities/serverless.md](../capabilities/serverless.md).

> **Last reviewed:** 2026-05-04

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

**Assumptions underlying these figures:** 10-application portfolio; 2 FTE platform engineers at a blended $150k/year fully-loaded cost; baseline of 4 hours/app/week in manual maintenance; 30-minute provisioning with IaC vs. 10 hours manual. Adjust the `IAC_AUTOMATION_BUSINESS_CASE.md` inputs for your team size and hourly rates before presenting to stakeholders.

### 7. Budget alerts and cost anomaly detection

Lifecycle policies prevent long-term drift, but real-time spend monitoring catches spikes before they compound:

- **Cloud Billing budget alerts** — configure a `google_billing_budget` resource per project (or per tenant label filter) with threshold alerts at 50%, 90%, and 100% of the monthly budget. Alert notifications route to the same Pub/Sub topic used for pipeline notifications, so operators receive spend alerts in the same Slack channel as build failures.
- **Per-tenant budgets** — because all resources carry the `app<name><tenant><id>` label, budget filters can be scoped to a single tenant, enabling per-customer spend caps for SaaS scenarios.
- **Cloud Billing anomaly detection** — enable the built-in anomaly detection feature in the Billing console. Anomalies (spend spikes ≥2× the rolling 30-day average) generate automatic alerts without requiring threshold configuration.
- **BigQuery cost dashboards** — the billing export to BigQuery (required for GKE cost allocation, §2) also powers Looker Studio dashboards breaking down spend by service, label, and SKU. A reference dashboard template is in `docs/finops/billing-dashboard.json`.

### 8. Committed Use Discounts and sustained-use savings

The platform's always-on components qualify for significant discount programmes:

- **Cloud SQL CUDs** — Cloud SQL instances running ≥730 hours/month qualify for 1-year (~25%) or 3-year (~52%) Committed Use Discounts. Evaluate after 30 days of stable usage using the Recommender API (`gcloud recommender recommendations list --recommender=google.billing.CostInsightRecommender`).
- **GKE Autopilot SUDs** — Autopilot pods running on the same node family for ≥25% of the month receive Sustained Use Discounts automatically; no reservation is required.
- **Memorystore** — Redis instances qualify for 1-year CUDs (~16% savings); evaluate for `STANDARD_HA` instances used as session stores.
- **Recommendation workflow** — the `/performance` workflow in `AGENTS.md` should include a CUD/SUD review step as part of quarterly right-sizing reviews.

### 9. Idle and orphaned resource detection

Lifecycle scripts handle known cleanup paths; broader orphan detection catches what they miss:

- **Recommender API — idle resources** — `gcloud recommender recommendations list --recommender=google.compute.instance.IdleResourceRecommender` and the Cloud SQL idle instance recommender surface resources with no meaningful traffic. Run these as part of the monthly FinOps review.
- **Orphaned deployments** — `modules/App_CloudRun/scripts/cleanup-stale-service.sh` removes services from failed deploys, but orphaned GCS buckets, Cloud SQL databases, and Secret Manager secrets from manually-abandoned deployments must be hunted with label queries: `gcloud asset search-all-resources --query='labels.deployment_id:<id>'` for any deployment ID with no corresponding active module state.
- **Unattached persistent disks** — for GKE workloads, Persistent Volume Claims not bound to a running pod should be reviewed monthly; the GKE cost-allocation export (§2) surfaces PVC-level costs.
- **Stale Artifact Registry images** — the cleanup policies in §1 handle active repos; validate that no registry exists outside the IaC-managed set by comparing `gcloud artifacts repositories list` output against the Terraform state.

## Cross-references

- [capabilities/serverless.md](../capabilities/serverless.md) — scale-to-zero, VPA, per-second billing (the runtime mechanics enabling these savings)
- [capabilities/data_and_databases.md](../capabilities/data_and_databases.md) — tier-configurable backing services
- [capabilities/multitenancy_saas.md](../capabilities/multitenancy_saas.md) — `app<name><tenant><id>` naming and per-tenant chargeback
- [capabilities/networking.md](../capabilities/networking.md) — CDN configuration
- [practices/sre.md](sre.md) — revision pruning as toil reduction (operational lens)
- [practices/cicd.md](cicd.md) — pipeline notifications (shared Pub/Sub channel for budget alerts)
