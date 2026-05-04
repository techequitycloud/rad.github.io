---
title: "Observability"
sidebar_label: "Observability"
---

# Observability

> **Scope.** Canonical home for metrics, logs, dashboards, alerts, audit telemetry, and mesh telemetry — spanning Cloud Monitoring, Cloud Logging, Cloud Audit Logs, Security Command Center, and the open-source observability stack. The SRE-specific framing of how to use these signals is in [practices/sre.md](../practices/sre.md); the auditor-evidence framing is in [outcomes/compliance_governance.md](../outcomes/compliance_governance.md).

Every GKE module ships a working metrics, traces, and dashboards stack out of the box. There is no "later set up monitoring" step.

## Infrastructure and mesh observability

### Open-source observability stack

`modules/Istio_GKE/istiosidecar.tf` and `modules/Istio_GKE/istioambient.tf` install the canonical Istio observability add-ons as part of the mesh install:

- **Prometheus** — metrics scraping
- **Grafana** — dashboards
- **Jaeger** — distributed tracing
- **Kiali** — service-graph and mesh-config UI

These run inside the cluster alongside the mesh.

### Managed observability via ASM

For Cloud Service Mesh deployments, `modules/Bank_GKE/asm.tf` and `modules/MC_Bank_GKE/asm.tf` enable the GKE Hub `service_mesh` feature. The managed control plane routes telemetry into:

- **Cloud Monitoring** — metrics
- **Cloud Trace** — traces
- **Cloud Logging** — logs

No in-cluster Prometheus deployment is needed.

### Service mesh telemetry

`modules/Services_GCP/gke-mesh.tf`, `modules/App_GKE/gke-mesh.tf` provide automatic L7 metrics and distributed tracing for mesh-enrolled workloads — **without application instrumentation**:

- **Automatic L7 metrics** — request rate, latency, error rate surfaced as Cloud Monitoring metrics for every HTTP/gRPC call between services.
- **Distributed tracing** — request spans propagated automatically by the Envoy sidecar; traces visible in Cloud Trace.
- **mTLS visibility** — connection security posture (mTLS vs. plaintext) observable per workload-pair.

Multi-cluster topology details in [networking](networking) §7.

### Distributed tracing context propagation

Bank of Anthos services propagate trace context using the **W3C Trace Context** (`traceparent`) header, which both Jaeger (open-source Istio) and Cloud Trace (ASM) understand natively. The mesh sidecar / ztunnel does not automatically propagate headers across hops — each service must forward the incoming `traceparent` header on outbound calls. This is the most common reason traces appear broken at service boundaries when first deploying a new workload.

### SLOs

`modules/Bank_GKE/monitoring.tf` defines `google_monitoring_slo` resources for all nine Bank of Anthos services (`accounts-db`, `balancereader`, `contacts`, `frontend`, `ledger-db`, `ledgerwriter`, `loadgenerator`, `transactionhistory`, `userservice`). Each SLO measures CPU limit utilization over a 5-minute rolling window against a 95% goal on a daily calendar period. SLOs are versioned alongside the workload they measure and gated by `var.enable_monitoring`. The Bank_GKE workflow in `AGENTS.md` documents how to add a new SLO.

The [sre](../practices/sre.md) practice page is the consumer perspective.

## Application-tier observability

### Per-application dashboards (canonical)

- **Cloud Run** — `modules/App_CloudRun/dashboard.tf` provisions a `google_monitoring_dashboard` per service.
- **GKE** — `modules/App_GKE/dashboard.tf` provisions per-deployment dashboards.
- **Shared logic** — `modules/App_Common/modules/app_dashboard/`.

Standard panels: request rate, latency p50/p95/p99, error rate, instance count, CPU/memory.

### Alert policies (canonical)

- `modules/App_CloudRun/monitoring.tf` and `modules/App_GKE/monitoring.tf` define `google_monitoring_alert_policy` resources for error rate, latency SLO breaches, resource saturation, and failed deployments.
- `modules/App_Common/modules/app_monitoring/` is the shared sub-module.
- Notification channels are configurable per app.

`monitoring.tf` for Bank of Anthos defines `google_monitoring_service` and `google_monitoring_slo` resources but does not currently define alerting policies or notification channels. Adding burn-rate alerts on the existing SLOs would be a natural next step — a `google_monitoring_alert_policy` with a `condition_threshold` on the SLO burn rate, linked to a `google_monitoring_notification_channel`, following the same `for_each = toset(local.monitoring_services)` pattern already used.

### Cloud Logging (canonical)

- All Cloud Run revisions and GKE pods stream stdout/stderr to Cloud Logging by default.
- Init / migration job logs surface via `gcloud run jobs executions logs` and `kubectl logs job/<name>`.
- Cloud Build logs via `gcloud builds log <build-id>`.
- Standard query patterns in `AGENTS.md` `/troubleshoot`.

### Cloud Audit Logs (canonical)

`modules/Services_GCP/audit.tf` enables project-wide:

- **Admin Activity** logs (always-on).
- **Data Access** logs (configurable per service).
- **System Event** logs.

Long-term retention via Cloud Logging plus optional BigQuery sink.

### Security Command Center (canonical)

`modules/Services_GCP/scc.tf` aggregates vulnerabilities, misconfigurations, and threat findings across the project.

### VPC-SC dry-run violation observation

`vpc_sc_dry_run = true` logs would-be denials as `DRYRUN_DENY` events in Cloud Audit Logs without blocking traffic. This enables a structured observation window (`.agent/VPC_SC_TESTING_GUIDE.md` recommends 1–2 weeks) to identify legitimate API calls that require access policy exceptions before switching to full enforcement (`vpc_sc_dry_run = false`). Violation log entries include the calling service account, the target API, and the violated perimeter — sufficient to write precise access level rules. Canonical control detail in [practices/devsecops.md](../practices/devsecops.md) §4.

### GKE-specific observability

- **GKE Fleet** — `modules/Services_GCP/gke-fleet.tf` provides a centralised view across all enrolled clusters: workload status, policy compliance, and configuration consistency visible from a single Fleet Hub dashboard without switching between cluster contexts.
- **Config Sync** — `modules/Services_GCP/gke-config-sync.tf` continuously reconciles cluster configuration against a Git source. Drift is surfaced as a sync error in the Fleet Hub and in Cloud Logging, enabling detection of out-of-band changes to cluster resources.
- Kubernetes events via `kubectl describe`.

### Binary Authorization attestation observability

When `enable_binary_authorization = true`, Cloud Audit Logs record every image deployment decision:

- `cloudaudit.googleapis.com/activity` entries show whether a Cloud Run revision or GKE pod was admitted or denied by the Binary Authorization policy.
- In `REQUIRE_ATTESTATION` mode, denied deployments include the image digest and the missing attestor, providing a clear audit trail for supply-chain policy violations.
- In `ALWAYS_ALLOW` mode (default), admissions are still logged, enabling baseline visibility before moving to enforcement.

## Diagnostic commands

`AGENTS.md` `/troubleshoot` documents the standard operational queries:

```bash
gcloud container fleet mesh describe --project=<project>
istioctl verify-install
istioctl proxy-status
kubectl get mci -n bank-of-anthos
kubectl get pods --all-namespaces
```

## Logs from null_resource provisioners

`null_resource` `local-exec` output is the install log. Provisioners use `set -eo pipefail` on create to fail fast and `set +e` on destroy to finish cleanup despite errors. Provisioner stdout shows the path of any on-disk artefacts (e.g. the Bank of Anthos tarball at `.terraform/bank-of-anthos/`).

## Cross-references

- [practices/sre.md](../practices/sre.md) — SLO usage, DORA metrics, incident response (signal-consumption lens)
- [outcomes/compliance_governance.md](../outcomes/compliance_governance.md) — audit-evidence framing
- [practices/devsecops.md](../practices/devsecops.md) — VPC-SC dry-run, Binary Authorization, security-finding sources
- [practices/cicd.md](../practices/cicd.md) — CI/CD and pipeline observability
- [practices/finops.md](../practices/finops.md) — cost observability
- [networking](networking) — service-mesh telemetry context
