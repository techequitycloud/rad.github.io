---
id: finops
title: FinOps
---

# FinOps Adoption

Cost-awareness is encoded into the platform at every layer: platform credits gate deployments before they start, scale-to-zero defaults eliminate idle spend, lifecycle policies automate storage cleanup, and destroy automation ensures demo workloads do not silently run forever. This document covers cost controls, lifecycle policies, cost allocation, tier-configurable services, and ongoing spend management.

## Credit-based cost gating

Every module's `variables.tf` declares the cost of a deployment in platform credits and can require the user to hold a balance before provisioning begins:

```hcl
variable "credit_cost" {
  description = "... defaults to 100. {{UIMeta group=0 order=103 }}"
  type        = number
  default     = 100
}

variable "require_credit_purchases" {
  description = "... {{UIMeta group=0 order=104 }}"
  type        = bool
}
```

Setting `require_credit_purchases = true` prevents a deployment from starting without pre-purchased budget — a hard FinOps control at the platform layer.

## Destroy-first hygiene and purge automation

The "I'll clean it up later" failure mode is the largest source of unexpected lab spend. The platform provides two escalating mechanisms to recover resources:

- **Reliable destroy** — destroy provisioners use `set +e`, `--ignore-not-found`, `|| true`, and dependency-ordered teardown to make destroy reliable even when the underlying cluster is partly broken.
- **`enable_purge` kill-switch** — `enable_purge` (`{{UIMeta group=0 order=106 }}`) wires into the purge pipeline (600s timeout) for the case where ordinary `tofu destroy` cannot finish. Without it, a failed destroy on a multi-cluster deployment leaves GKE clusters running until someone notices the bill. See [CI/CD](./cicd.md) for the purge pipeline details.
- **API-disable safety** — every module sets `disable_on_destroy = false` on `google_project_service`, so a destroy on one module never disables APIs that another deployment in the same project still depends on — preventing cascading apply failures that would otherwise force costly re-creates.

## Lifecycle policies

Storage-cost creep is automated away:

- **Cloud Run revision pruning** — `modules/App_CloudRun/scripts/prune-old-revisions.sh` runs as a `null_resource` after every apply. Retains only `max_revisions_to_retain` revisions (default 7); always preserves traffic-serving revisions; set to 0 to disable.
- **Artifact Registry cleanup** — `modules/App_CloudRun/registry.tf` provides `max_images_to_retain`, `delete_untagged_images`, and `image_retention_days`, applied only to inline-created repos scoped to the application name prefix.
- **GCS bucket lifecycle** — the `app_storage_wrapper` sub-module in `App_Common` configures bucket-level lifecycle rules.

## Cost allocation and chargeback

- **`app<name><tenant><id>` naming** — the naming convention flows into Cloud Billing, enabling per-tenant chargeback via BigQuery views over the billing export. `modules/Services_GCP/gke_metering.tf` documents the recommended Autopilot cost-visibility path: Cloud Billing export to BigQuery + GKE cost-allocation labels + Monitoring dashboards.
- **`deployment_id` as billing label** — the `deployment_id` output is a natural billing label key. Adding it as a resource label on GKE clusters and node pools ties every cloud cost line item to the specific deployment that incurred it, enabling per-deployment chargeback without additional tooling.
- **Per-tenant budgets** — because all resources carry the `app<name><tenant><id>` label, budget filters can be scoped to a single tenant, enabling per-customer spend caps for SaaS scenarios.
- **State as inventory** — remote state in GCS plus the `deployment_id` output give an inventory key that ties Terraform state to platform credit consumption. The `radlab.py list` action enumerates active deployments.

## Tier-configurable shared services

Every expensive shared resource is tier-configurable via Platform-module variables:

- Cloud SQL (`db-custom-*` tiers), HA / PITR optional
- Memorystore Redis (`BASIC` vs `STANDARD_HA`)
- Filestore NFS (`BASIC_HDD` / `BASIC_SSD` / `ZONAL`); `enable_nfs = false` to skip entirely
- Cloud Run resources (`cpu_limit`, `memory_limit`)

## Cost-shape choices for compute

The platform provides documented trade-offs across three cost/performance profiles:

| Profile | Settings |
|---|---|
| Low Cost | `min_instance_count = 0`, scale-to-zero, smaller DB instance |
| Low Latency | `min_instance_count = 1`, larger resources, connection pooling |
| Balanced | `min_instance_count = 0`, right-sized resources, caching enabled |

**Spot VMs** in lab scripts (`scripts/gcp-istio-security/`, `scripts/gcp-istio-traffic/`) cut node costs by up to 60–90% versus on-demand pricing, in exchange for the possibility of preemption with a 30-second eviction notice. This trade-off is acceptable for short-lived lab exercises but not for persistent module deployments — none of the `modules/` use Spot nodes by default.

**GKE Autopilot** is the recommended cost-efficient path for demo modules: billing is per-Pod rather than per-node, idle capacity is not charged, and node management overhead is eliminated. Enable **node autoscaling** for multi-cluster workloads, sizing the initial node pool to steady-state load rather than peak load.

## CDN cost offload

`enable_cdn = true` offloads cacheable traffic from compute to edge. `BUSINESS_CASE.md` projects 30–50% compute/egress savings on read-heavy applications.

## Budget alerts and cost anomaly detection

Lifecycle policies prevent long-term drift, but real-time spend monitoring catches spikes before they compound:

- **Cloud Billing budget alerts** — configure a `google_billing_budget` resource per project (or per tenant label filter) with threshold alerts at 50%, 90%, and 100% of the monthly budget. Alert notifications route to the same Pub/Sub topic used for pipeline notifications, so operators receive spend alerts in the same Slack channel as build failures.
- **Cloud Billing anomaly detection** — enable the built-in anomaly detection feature in the Billing console. Anomalies (spend spikes ≥2× the rolling 30-day average) generate automatic alerts without requiring threshold configuration.
- **BigQuery cost dashboards** — the billing export to BigQuery powers Looker Studio dashboards breaking down spend by service, label, and SKU. A reference dashboard template is available in `docs/finops/billing-dashboard.json`.

## Committed Use Discounts and sustained-use savings

The platform's always-on components qualify for significant discount programmes:

- **Cloud SQL CUDs** — Cloud SQL instances running ≥730 hours/month qualify for 1-year (~25%) or 3-year (~52%) Committed Use Discounts. Evaluate after 30 days of stable usage using the Recommender API.
- **GKE Autopilot SUDs** — Autopilot pods running on the same node family for ≥25% of the month receive Sustained Use Discounts automatically; no reservation is required.
- **Memorystore** — Redis instances qualify for 1-year CUDs (~16% savings); evaluate for `STANDARD_HA` instances used as session stores.
- **Recommendation workflow** — the `/performance` workflow in `AGENTS.md` should include a CUD/SUD review step as part of quarterly right-sizing reviews.

## Idle and orphaned resource detection

Lifecycle scripts handle known cleanup paths; broader orphan detection catches what they miss:

- **Recommender API** — `gcloud recommender recommendations list --recommender=google.compute.instance.IdleResourceRecommender` and the Cloud SQL idle instance recommender surface resources with no meaningful traffic. Run these as part of the monthly FinOps review.
- **Orphaned deployments** — `modules/App_CloudRun/scripts/cleanup-stale-service.sh` removes services from failed deploys, but orphaned GCS buckets, Cloud SQL databases, and Secret Manager secrets from manually-abandoned deployments must be hunted with label queries: `gcloud asset search-all-resources --query='labels.deployment_id:<id>'`.
- **Unattached persistent disks** — for GKE workloads, Persistent Volume Claims not bound to a running pod should be reviewed monthly.
- **Stale Artifact Registry images** — validate that no registry exists outside the IaC-managed set by comparing `gcloud artifacts repositories list` output against the Terraform state.

## Rightsizing (planned)

Native Recommender-based rightsizing and Cloud Asset Inventory exports are natural next steps for a FinOps-mature deployment:

- **Rightsizing** — Vertical Pod Autoscaler (VPA) in recommendation mode surfaces over-provisioned resource requests without changing anything; pairing VPA recommendations with GKE node autoscaling reduces wasted capacity.
- **Namespace quotas** — `ResourceQuota` objects per namespace prevent a single workload from consuming disproportionate cluster resources, providing a soft chargeback boundary within a shared cluster.
- **CAI exports** — exporting Cloud Asset Inventory to BigQuery enables cross-project inventory queries that correlate deployed resources with their credit consumption and deployment lifecycle state.

## Quantified business case

Per `BUSINESS_CASE.md` and `IAC_AUTOMATION_BUSINESS_CASE.md`:

- 95% provisioning-time reduction.
- 95% maintenance-effort reduction across a 10-app portfolio.
- >$100k/year operational savings projected for a mid-size portfolio.

**Assumptions:** 10-application portfolio; 2 FTE platform engineers at a blended $150k/year fully-loaded cost; baseline of 4 hours/app/week in manual maintenance; 30-minute provisioning with IaC vs. 10 hours manual. Adjust the `IAC_AUTOMATION_BUSINESS_CASE.md` inputs for your team size and hourly rates before presenting to stakeholders.

## Cross-references

- [SRE](./sre.md) — revision pruning as toil reduction, destroy as an SRE concern
- [CI/CD](./cicd.md) — pipeline notifications (shared Pub/Sub channel for budget alerts)
- [IDP](./idp.md) — `app<name><tenant><id>` naming and per-tenant chargeback
