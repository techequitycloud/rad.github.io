# Cost Optimization

The platform is architected to minimise idle compute cost, automate storage lifecycle management, provide full cost visibility at every granularity, and give operators explicit control over the cost/performance trade-off for every shared resource.

## Scale-to-zero compute

Setting `min_instance_count = 0` eliminates compute costs when no traffic is being served. Cloud Run bills per request, per second — idle applications cost nothing. GKE Autopilot bills per pod resource request rather than per provisioned node, with Vertical Pod Autoscaling continuously right-sizing requests to eliminate waste. The platform itself scales to zero between scheduled jobs; Cloud Functions and Cloud Run incur no idle cost outside of active request handling. Phased Cloud Scheduler jobs (00:00–02:00 UTC) batch credit and cleanup work into a narrow window to minimise concurrent function instances.

## Automated storage lifecycle

Storage cost creep is automated away by default:

- **Cloud Run revision pruning** — `modules/App_CloudRun/scripts/prune-old-revisions.sh` retains only `max_revisions_to_retain` revisions (default 7) after every deploy; traffic-serving revisions are always preserved.
- **Artifact Registry cleanup** — `max_images_to_retain`, `delete_untagged_images`, and `image_retention_days` prevent unbounded image accumulation.
- **GCS bucket lifecycle** — per-bucket lifecycle rules automate transition to cheaper storage classes (Nearline, Coldline, Archive).

## CDN cost offload

`enable_cdn = true` routes cacheable responses to Google edge points of presence, offloading them from compute. The platform business case projects 30–50% compute and egress savings on read-heavy applications.

## Per-tenant cost attribution and visibility

Every tenant operates in a dedicated GCP project, which means GCP Billing export data is naturally scoped per tenant. The `credit_project` Cloud Function debits user credits from per-project GCP cost on a daily schedule, ensuring spend is attributed to the correct tenant without manual allocation. The `app<name><tenant><id>` resource-naming convention flows directly into Cloud Billing labels, enabling per-tenant chargeback reports via simple BigQuery views — no manual tagging required. `modules/Services_GCP/gke_metering.tf` adds GKE pod-level cost visibility on Autopilot clusters.

Cost data is surfaced through API routes at multiple granularities:

| Route | Purpose |
|---|---|
| `project-costs/` | Per-project GCP spend from BigQuery billing export |
| `costs/` | Aggregated cost views |
| `billing/` | Billing account and subscription management |
| `invoices/` | Per-tenant invoice history |
| `revenue/` | Partner and agent revenue attribution |
| `roi/` | Return-on-investment views for tenants |

## Automated credit lifecycle

Eight Cloud Functions handle the full credit lifecycle without manual intervention. Key cost-control functions:

- `credit_low` — notifies tenants before credits are exhausted, giving them time to top up before deployments are suspended.
- `credit_reconciliation` — HTTP-triggered cross-provider reconciliation catches discrepancies between payment provider records and Firestore balances.
- `project_delete` — reclaims abandoned tenant projects with insufficient credit, preventing idle GCP resource spend.

Spend alert policies are provisioned via `rad-ui/webapp/src/create-alert-policies.sh` to notify on budget anomalies and spend spikes.

## Multi-currency payments

Customers can pay via Stripe, Paystack, or Flutterwave — whichever fits their region — using a normalised credit model that abstracts currency differences from platform logic. The `credit_currency` Cloud Function syncs exchange rates from GCP Billing to keep multi-currency invoicing accurate.

## Tier-configurable shared services

Every expensive shared resource exposes cost/performance trade-off variables:

| Service | Cost control variables |
|---|---|
| Cloud SQL | `db-custom-*` tiers; HA and PITR optional |
| Memorystore Redis | `BASIC` vs `STANDARD_HA` |
| Filestore NFS | `BASIC_HDD` / `BASIC_SSD` / `ZONAL`; `enable_nfs = false` to skip entirely |
| Cloud Run | `cpu_limit`, `memory_limit`, `min_instance_count`, `max_instance_count`, concurrency |

## Cost vs performance profiles

`AGENTS.md` `/performance` documents three explicit deployment profiles:

| Profile | Key settings |
|---|---|
| Low Cost | `min_instance_count = 0`, scale-to-zero, smallest viable DB instance |
| Low Latency | `min_instance_count = 1`, larger resources, connection pooling, Redis caching |
| Balanced | `min_instance_count = 0`, right-sized resources, CDN and Redis enabled |

## Quantified business case

| Metric | Value |
|---|---|
| Provisioning time reduction | ~95% (3–5 days → &lt;2 hours) |
| Cost per new application setup | $200 vs $3,200 manually |
| Maintenance effort reduction (10-app portfolio) | ~95% (40 h → 2 h per cycle) |
| Maintenance cost reduction (10-app portfolio) | $4,000 → $200 per cycle |
| Projected annual savings (mid-size portfolio) | >$100,000 |
| Compute/egress savings on read-heavy apps | 30–50% via CDN offload |

## See also

- FinOps practices — credit lifecycle, payment provider integrations, scale-to-zero, and lifecycle policies
- Serverless capability — Cloud Run / GKE Autopilot per-second billing mechanics
- Data & Databases capability — tier-configurable backing services
- Networking capability — CDN configuration and cost offload
- Multitenancy & SaaS capability — per-tenant chargeback via resource naming
- Observability capability — spend alert policies
- Developer Productivity outcome — quantified provisioning and maintenance savings
