# Site Reliability Engineering (SRE)

> **Scope.** SRE-specific framing of the repository: how reliability is codified, how toil is removed, how incidents are responded to, and how the platform improves DORA metrics. The underlying observability surface and managed-runtime mechanics are covered in their own topics — this file links to them.

> **Last reviewed:** 2026-05-04

## What this repo uniquely brings to SRE

### 1. SLO / SLI / error budget framework

SRE without SLOs is just ops. The platform establishes the following reliability targets:

**Platform tier** (`Services_GCP`): 99.9% monthly availability (≤43 minutes downtime/month). SLIs measured on Cloud SQL availability, GKE control-plane reachability, and Artifact Registry pull success rate.

**Application tier** (Cloud Run / GKE): target SLOs vary by application criticality. Recommended starting points:

| Tier | Availability SLO | Latency SLO (p99) | Error budget (30d) |
|---|---|---|---|
| Production (critical) | 99.9% | < 2 s | 43 min |
| Production (standard) | 99.5% | < 5 s | 3.6 hr |
| Non-production | 99.0% | < 10 s | 7.2 hr |

**SLI implementation:** Cloud Monitoring SLOs are defined as `google_monitoring_slo` resources in `modules/App_CloudRun/slo.tf` and `modules/App_GKE/slo.tf`, measuring request-based availability (good requests / total requests) and latency distributions from Cloud Load Balancing metrics.

**Error budget policy:** when the 30-day error budget is more than 50% consumed, new non-critical feature deploys to that application are paused until the budget recovers. When the budget is fully consumed, a reliability sprint is triggered: the next two-week cycle is dedicated to reliability work for that application, with no new features merged.

**Measurement:** Cloud Monitoring SLO dashboards are the authoritative view. Burn-rate alerts (1-hour and 6-hour windows) notify on-call before the budget is exhausted; see §7 for the on-call model.

### 2. Reliability codified into the Foundation Modules

Reliability decisions live in code, not in operator memory:

- **Pod Disruption Budgets** — `modules/App_GKE/pdb.tf`. PDBs are auto-generated per app, with `enable_pod_disruption_budget` and `pdb_min_available` honoured per-app. PDB is intelligently skipped when `max_instance_count <= 1` to prevent voluntary-eviction deadlocks (`AGENTS.md` Foundation rule #18).
- **Progress deadlines** — `modules/App_GKE/deployment.tf` sets `progress_deadline_seconds = var.deployment_timeout` on both primary and CD variants, giving every rollout a deterministic failure boundary.
- **Health probes** — Cloud Run service definitions and GKE deployments include startup, liveness, and readiness probes with sensible defaults.

### 3. Toil reduction by automation

- **CSI secret materialisation wait** — `modules/App_GKE/secrets.tf` polls until the K8s Secret has all expected keys before downstream jobs run, eliminating a class of flaky-deploy failures.
- **Stale service cleanup** — `modules/App_CloudRun/scripts/cleanup-stale-service.sh` removes orphaned services from failed deploys.
- **Automatic revision pruning** — see [practices/finops.md](finops.md) for the lifecycle automation that doubles as a toil reducer.

### 4. Incident response runbook

`AGENTS.md` `/troubleshoot` ships a Known Issue Patterns table (symptom → root cause → resolution) covering the recurring failure modes: `CreateContainerConfigError`, `Deployment exceeded its progress deadline`, `dial tcp: i/o timeout`, `403 PERMISSION_DENIED` on plan, PDB validation failures, ImagePullBackOff, and more.

### 5. DORA metrics alignment

Per `BUSINESS_CASE.md`, the framework directly improves the four DORA metrics:

| DORA metric | Mechanism | Measurement |
|---|---|---|
| Deployment frequency | Cloud Build pipelines make deploys a one-trigger operation — see [practices/cicd.md](cicd.md) | Cloud Build `builds` metric; target ≥1 deploy/day per active application |
| Lead time for changes | Tofu apply on a thin Application Module; minutes not days | Time from PR merge to successful `cloudbuild-update.yaml` completion; target < 30 min |
| Change failure rate | Standardised Foundation Modules eliminate per-app drift; plan-time validation catches misconfigurations early | Ratio of builds requiring rollback or hotfix within 24 h of deploy; target < 5% |
| Mean time to recovery | Revision rollback + scripted backup/restore — see [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) | Time from alert fire to SLO restoration; target < 1 h for P1 |

DORA metrics are tracked via the [DORA metrics BigQuery + Looker Studio template](https://cloud.google.com/architecture/devops/measuring-devops) using Cloud Build pub/sub events as the data source. The Four Keys project schema maps Cloud Build `build.status` events to deployment and incident records.

### 6. Blameless post-mortem process

All P1 (SLO breach) and selected P2 (near-miss, significant toil) incidents result in a blameless post-mortem within 5 business days of resolution:

**Structure:**
1. **Timeline** — chronological sequence of events from first symptom to full resolution, sourced from Cloud Logging and Cloud Monitoring.
2. **Root cause** — the technical and organisational conditions that made the incident possible (use the "5 Whys" method).
3. **Contributing factors** — what made detection or response slower than it should have been.
4. **Action items** — specific, owned, time-bound tasks. Each action item maps to either: (a) a new check in the `/security` or `/troubleshoot` workflow in `AGENTS.md`; (b) a new validation block in `validation.tf`; (c) a new Known Issue Pattern entry; or (d) a runbook update.
5. **What went well** — preserves effective practices and recognises good judgement under pressure.

Post-mortem documents live in `docs/postmortems/YYYY-MM-DD-<slug>.md`. A summary is added to the relevant application module's `README.md` when the root cause is module-specific.

Blame and personal attribution are explicitly excluded. The goal is systemic improvement, not accountability assignment.

### 7. On-call model

| Rotation | Scope | Primary contact |
|---|---|---|
| Platform on-call | `Services_GCP`, `App_CloudRun`, `App_GKE` — infrastructure-layer failures | Platform team (weekly rotation) |
| Application on-call | App-specific failures (logic errors, data issues, app-layer 5xx) | App team (weekly rotation) |

**Escalation path:** Application on-call → Platform on-call → Engineering lead → Vendor support (GCP Premium Support).

**Alert routing:** Cloud Monitoring alert policies route P1 alerts (SLO burn rate > 1× over 1 hour) to PagerDuty with a 5-minute acknowledgement SLA. P2 alerts (burn rate warning thresholds) route to Slack with a 30-minute acknowledgement SLA.

**Handoff:** on-call handoffs include a written summary of any open incidents, elevated error rates, or pending platform changes that could affect reliability in the coming week. The handoff document is posted in the team's incident Slack channel.

**Runbook access:** the `/troubleshoot` workflow in `AGENTS.md` is the primary runbook. On-call engineers should be familiar with the Known Issue Patterns table before their rotation begins.

### 8. Chaos engineering and fault injection

The reliability controls codified in the Foundation Modules (PDBs, health probes, progress deadlines) are only as good as the tests that validate them. Periodic fault injection confirms that the system behaves as expected under failure:

- **Pod eviction testing** — periodically evict a pod from a GKE application with `kubectl delete pod <name>` and verify that the PDB prevents over-eviction and that the readiness probe prevents premature traffic routing. Validate that `pdb_min_available` is set appropriately for the replica count.
- **Health probe failure simulation** — temporarily misconfigure a liveness probe path and confirm that Kubernetes restarts the container without human intervention and that the Cloud Monitoring uptime check fires within the expected window.
- **Dependency failure injection** — use VPC firewall rules or Cloud SQL maintenance windows to simulate backing-service unavailability and confirm that application error handling degrades gracefully (returns 503 rather than 500, surfaces a user-friendly message) and that the SLO burn-rate alert fires before the error budget is materially consumed.
- **Cloud Run cold-start testing** — set `min_instance_count = 0` in a staging environment and drive load against the service immediately after a quiet period to measure cold-start latency against the p99 latency SLO.
- **Chaos schedule** — run the above tests in a non-production environment quarterly, and in production (with reduced blast radius) semi-annually. Results are reviewed in the post-mortem process even when no incident occurs.

## Cross-references

- [capabilities/observability.md](../capabilities/observability.md) — dashboards, alerts, Cloud Logging, Audit Logs, SCC
- [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) — rollback, backup/restore, multi-cluster HA
- [capabilities/serverless.md](../capabilities/serverless.md) — Cloud Run / GKE Autopilot / VPA mechanics
- [capabilities/networking.md](../capabilities/networking.md) — multi-cluster topology for HA
- [practices/finops.md](finops.md) — revision pruning and lifecycle automation (cost angle)
- [practices/cicd.md](cicd.md) — pipeline and validation gates, build failure notifications
- [practices/platform_engineering.md](platform_engineering.md) — platform SLOs, on-call ownership model
- [practices/devsecops.md](devsecops.md) — security incident response and post-mortem integration
