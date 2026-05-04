---
id: sre
title: SRE
---

# Site Reliability Engineering

SRE without SLOs is just ops. This document covers how reliability is codified into the platform, how toil is removed, how incidents are responded to, how the platform improves DORA metrics, and how the on-call model is structured.

## SLO / SLI / error budget framework

The platform establishes the following reliability targets:

**Platform tier** (`Services_GCP`): 99.9% monthly availability (≤43 minutes downtime/month). SLIs measured on Cloud SQL availability, GKE control-plane reachability, and Artifact Registry pull success rate.

**Application tier** (Cloud Run / GKE): target SLOs vary by application criticality. Recommended starting points:

| Tier | Availability SLO | Latency SLO (p99) | Error budget (30d) |
|---|---|---|---|
| Production (critical) | 99.9% | < 2 s | 43 min |
| Production (standard) | 99.5% | < 5 s | 3.6 hr |
| Non-production | 99.0% | < 10 s | 7.2 hr |

For demo banking workloads (e.g. `Bank_GKE`), a reasonable starting point is 99.5% availability (HTTP 2xx) and 95% of requests completing in under 500ms over a 28-day rolling window — an error budget of ~3.6 hours/month. `MC_Bank_GKE` can justify tighter targets given its multi-region redundancy.

**SLI implementation** — Cloud Monitoring SLOs are defined as `google_monitoring_slo` resources in `modules/Bank_GKE/monitoring.tf`, `modules/App_CloudRun/slo.tf`, and `modules/App_GKE/slo.tf`, measuring request-based availability and latency distributions from Cloud Load Balancing metrics.

**Error budget policy** — when the 30-day error budget is more than 50% consumed, new non-critical feature deploys to that application are paused. When the budget is fully consumed, a reliability sprint is triggered: the next two-week cycle is dedicated to reliability work with no new features merged.

## Alerting policies

SLOs without alerting do not page anyone. Each SLO should be paired with a `google_monitoring_alert_policy` using a burn-rate condition:

- Alert when the error budget is being consumed at **14× the sustainable rate** over a 1-hour window (fast-burn).
- Alert when it is being consumed at **6× the sustainable rate** over a 6-hour window (slow-burn).

This two-window pattern minimises both false positives and missed incidents. Burn-rate alerts notify on-call before the budget is exhausted. If alerting resources are not yet present in `monitoring.tf`, adding them is the highest-priority SRE gap in the current codebase.

## Reliability codified into the Foundation Modules

Reliability decisions live in code, not in operator memory:

- **Pod Disruption Budgets** — `modules/App_GKE/pdb.tf` auto-generates PDBs per application, with `enable_pod_disruption_budget` and `pdb_min_available` honoured per-app. PDBs are intelligently skipped when `max_instance_count <= 1` to prevent voluntary-eviction deadlocks.
- **Progress deadlines** — `modules/App_GKE/deployment.tf` sets `progress_deadline_seconds = var.deployment_timeout` on both primary and CD variants, giving every rollout a deterministic failure boundary.
- **Health probes** — Cloud Run service definitions and GKE deployments include startup, liveness, and readiness probes with sensible defaults.

## Toil reduction by automation

- **CSI secret materialisation wait** — `modules/App_GKE/secrets.tf` polls until the Kubernetes Secret has all expected keys before downstream jobs run, eliminating a class of flaky-deploy failures.
- **Stale service cleanup** — `modules/App_CloudRun/scripts/cleanup-stale-service.sh` removes orphaned services from failed deploys.
- **Automatic revision pruning** — see [FinOps](./finops.md) for the lifecycle automation that doubles as a toil reducer.

## Safe rollouts and traffic management

Traffic-management primitives (canary splits, fault injection, timeouts, retries) are the SRE control surface for limiting blast radius on new deployments. These are implemented at the service mesh layer for GKE workloads and via Cloud Run traffic-split configuration for serverless workloads. Application-level rollback is via `gcloud run services update-traffic --to-revisions=...` and `kubectl rollout undo`.

## Multi-region availability

`modules/MC_Bank_GKE/` deploys Bank of Anthos across up to four GKE clusters behind a global HTTPS load balancer with Multi-Cluster Ingress and Multi-Cluster Services, enabling geo-redundancy and lower global latency. See the multi-cloud and service-mesh capability documentation for the cluster-fleet model and cross-cluster traffic story.

## Destroy as a first-class SRE operation

A failed `tofu destroy` is simultaneously an SRE problem (orphaned resources accruing risk) and a FinOps problem (uncontrolled spend). The platform's destroy-safety invariants (`set +e`, `--ignore-not-found`, `|| true`, dependency-ordered teardown) are applied in every `null_resource` create-time effect. The `enable_purge` kill-switch in [FinOps](./finops.md) is the last resort when these invariants are insufficient.

## Incident response runbook

`AGENTS.md` `/troubleshoot` ships a Known Issue Patterns table (symptom → root cause → resolution) covering the recurring failure modes: `CreateContainerConfigError`, `Deployment exceeded its progress deadline`, `dial tcp: i/o timeout`, `403 PERMISSION_DENIED` on plan, PDB validation failures, `ImagePullBackOff`, provisioner failures, mesh pods stuck `Pending`, MCI never receiving a VIP, attached clusters missing from the GCP Console, destroy hangs, and APIs disabled after destroy. Each entry pairs the symptom with a one-command diagnostic and a file:line reference.

## DORA metrics alignment

The framework directly improves the four DORA metrics:

| DORA metric | Mechanism | Measurement |
|---|---|---|
| Deployment frequency | Cloud Build pipelines make deploys a one-trigger operation — see [CI/CD](./cicd.md) | Cloud Build `builds` metric; target ≥1 deploy/day per active application |
| Lead time for changes | `tofu apply` on a thin Application Module; minutes not days | Time from PR merge to successful `cloudbuild-update.yaml` completion; target < 30 min |
| Change failure rate | Standardised Foundation Modules eliminate per-app drift; plan-time validation catches misconfigurations early | Ratio of builds requiring rollback or hotfix within 24 h of deploy; target < 5% |
| Mean time to recovery | Revision rollback + scripted backup/restore | Time from alert fire to SLO restoration; target < 1 h for P1 |

DORA metrics are tracked via the DORA metrics BigQuery + Looker Studio template using Cloud Build pub/sub events as the data source. The Four Keys project schema maps Cloud Build `build.status` events to deployment and incident records.

## Capacity planning

For multi-cluster workloads like `MC_Bank_GKE`:

- Enable **node autoscaling** on each cluster with a `min_node_count` that keeps the mesh control plane healthy and a `max_node_count` that caps spend.
- Size the initial node pool to the steady-state load, not the peak load — autoscaling handles spikes; over-provisioning static nodes wastes budget.
- `Bank_GKE`'s Autopilot option eliminates explicit node sizing entirely by billing per-Pod.

For the cost implications of node sizing choices, see [FinOps](./finops.md).

## Blameless post-mortem process

All P1 (SLO breach) and selected P2 (near-miss, significant toil) incidents result in a blameless post-mortem within 5 business days of resolution:

**Structure:**
1. **Timeline** — chronological sequence of events from first symptom to full resolution, sourced from Cloud Logging and Cloud Monitoring.
2. **Root cause** — the technical and organisational conditions that made the incident possible (use the "5 Whys" method).
3. **Contributing factors** — what made detection or response slower than it should have been.
4. **Action items** — specific, owned, time-bound tasks. Each maps to: (a) a new check in the `/security` or `/troubleshoot` workflow in `AGENTS.md`; (b) a new validation block in `validation.tf`; (c) a new Known Issue Pattern entry; or (d) a runbook update.
5. **What went well** — preserves effective practices and recognises good judgement under pressure.

Post-mortem documents live in `docs/postmortems/YYYY-MM-DD-<slug>.md`. A summary is added to the relevant application module's `README.md` when the root cause is module-specific. Blame and personal attribution are explicitly excluded.

## On-call model

| Rotation | Scope | Primary contact |
|---|---|---|
| Platform on-call | `Services_GCP`, `App_CloudRun`, `App_GKE` — infrastructure-layer failures | Platform team (weekly rotation) |
| Application on-call | App-specific failures (logic errors, data issues, app-layer 5xx) | App team (weekly rotation) |

**Escalation path:** Application on-call → Platform on-call → Engineering lead → Vendor support (GCP Premium Support).

**Alert routing:** Cloud Monitoring alert policies route P1 alerts (SLO burn rate > 1× over 1 hour) to PagerDuty with a 5-minute acknowledgement SLA. P2 alerts (burn rate warning thresholds) route to Slack with a 30-minute acknowledgement SLA.

**Handoff:** on-call handoffs include a written summary of any open incidents, elevated error rates, or pending platform changes that could affect reliability in the coming week. The handoff document is posted in the team's incident Slack channel.

**Runbook access:** the `/troubleshoot` workflow in `AGENTS.md` is the primary runbook. On-call engineers should be familiar with the Known Issue Patterns table before their rotation begins.

## Chaos engineering and fault injection

The reliability controls codified in the Foundation Modules (PDBs, health probes, progress deadlines) are only as good as the tests that validate them. Periodic fault injection confirms that the system behaves as expected under failure:

- **Pod eviction testing** — periodically evict a pod from a GKE application with `kubectl delete pod <name>` and verify that the PDB prevents over-eviction and that the readiness probe prevents premature traffic routing.
- **Health probe failure simulation** — temporarily misconfigure a liveness probe path and confirm that Kubernetes restarts the container without human intervention and that the Cloud Monitoring uptime check fires within the expected window.
- **Dependency failure injection** — use VPC firewall rules or Cloud SQL maintenance windows to simulate backing-service unavailability and confirm that application error handling degrades gracefully (returns 503 rather than 500) and that the SLO burn-rate alert fires before the error budget is materially consumed.
- **Cloud Run cold-start testing** — set `min_instance_count = 0` in a staging environment and drive load against the service immediately after a quiet period to measure cold-start latency against the p99 latency SLO.
- **Chaos schedule** — run the above tests in a non-production environment quarterly, and in production (with reduced blast radius) semi-annually. Results are reviewed in the post-mortem process even when no incident occurs.

## Cross-references

- [CI/CD](./cicd.md) — pipeline and validation gates, build failure notifications
- [FinOps](./finops.md) — revision pruning and lifecycle automation (cost angle)
- [IDP](./idp.md) — platform SLOs, on-call ownership model
- [DevSecOps](./devsecops.md) — security incident response and post-mortem integration
