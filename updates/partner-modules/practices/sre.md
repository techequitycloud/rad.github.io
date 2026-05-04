# Site Reliability Engineering (SRE)

> **Scope.** SRE-specific framing of the repository: how reliability is codified, how toil is removed, how incidents are responded to, and how the platform improves DORA metrics. The underlying observability surface and managed-runtime mechanics are covered in their own topics — this file links to them.

## What this repo uniquely brings to SRE

### 1. Reliability codified into the Foundation Modules

Reliability decisions live in code, not in operator memory:

- **Pod Disruption Budgets** — `modules/App_GKE/pdb.tf`. PDBs are auto-generated per app, with `enable_pod_disruption_budget` and `pdb_min_available` honoured per-app. PDB is intelligently skipped when `max_instance_count <= 1` to prevent voluntary-eviction deadlocks (`AGENTS.md` Foundation rule #18).
- **Progress deadlines** — `modules/App_GKE/deployment.tf` sets `progress_deadline_seconds = var.deployment_timeout` on both primary and CD variants, giving every rollout a deterministic failure boundary.
- **Health probes** — Cloud Run service definitions and GKE deployments include startup, liveness, and readiness probes with sensible defaults.

### 2. Toil reduction by automation

- **CSI secret materialisation wait** — `modules/App_GKE/secrets.tf` polls until the K8s Secret has all expected keys before downstream jobs run, eliminating a class of flaky-deploy failures.
- **Stale service cleanup** — `modules/App_CloudRun/scripts/cleanup-stale-service.sh` removes orphaned services from failed deploys.
- **Automatic revision pruning** — see [practices/finops.md](finops.md) for the lifecycle automation that doubles as a toil reducer.

### 3. Incident response runbook

`AGENTS.md` `/troubleshoot` ships a Known Issue Patterns table (symptom → root cause → resolution) covering the recurring failure modes: `CreateContainerConfigError`, `Deployment exceeded its progress deadline`, `dial tcp: i/o timeout`, `403 PERMISSION_DENIED` on plan, PDB validation failures, ImagePullBackOff, and more.

### 4. DORA metrics alignment

Per `BUSINESS_CASE.md`, the framework directly improves the four DORA metrics:

| DORA metric | Mechanism |
|---|---|
| Deployment frequency | Cloud Build pipelines make deploys a one-trigger operation — see [practices/cicd.md](cicd.md) |
| Lead time for changes | Tofu apply on a thin Application Module; minutes not days |
| Change failure rate | Standardised Foundation Modules eliminate per-app drift; plan-time validation catches misconfigurations early |
| Mean time to recovery | Revision rollback + scripted backup/restore — see [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) |

## Cross-references

- [capabilities/observability.md](../capabilities/observability.md) — dashboards, alerts, Cloud Logging, Audit Logs, SCC
- [capabilities/disaster_recovery.md](../capabilities/disaster_recovery.md) — rollback, backup/restore, multi-cluster HA
- [capabilities/serverless.md](../capabilities/serverless.md) — Cloud Run / GKE Autopilot / VPA mechanics
- [capabilities/networking.md](../capabilities/networking.md) — multi-cluster topology for HA
- [practices/finops.md](finops.md) — revision pruning and lifecycle automation (cost angle)
- [practices/cicd.md](cicd.md) — pipeline and validation gates
