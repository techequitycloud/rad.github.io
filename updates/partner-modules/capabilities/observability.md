# Observability

> **Scope.** Canonical home for metrics, logs, dashboards, alerts, and audit telemetry — Cloud Monitoring, Cloud Logging, Cloud Audit Logs, Security Command Center, and mesh telemetry. The SRE-specific framing of how to use these signals is in [practices/sre.md](../practices/sre.md); the auditor-evidence framing is in [outcomes/compliance_governance.md](../outcomes/compliance_governance.md).

## What this repo uniquely brings to observability

### 1. Per-application dashboards (canonical)

- **Cloud Run** — `modules/App_CloudRun/dashboard.tf` provisions a `google_monitoring_dashboard` per service.
- **GKE** — `modules/App_GKE/dashboard.tf` provisions per-deployment dashboards.
- **Shared logic** — `modules/App_Common/modules/app_dashboard/`.

Standard panels: request rate, latency p50/p95/p99, error rate, instance count, CPU/memory.

### 2. Alert policies (canonical)

- `modules/App_CloudRun/monitoring.tf` and `modules/App_GKE/monitoring.tf` define `google_monitoring_alert_policy` resources for error rate, latency SLO breaches, resource saturation, failed deployments.
- `modules/App_Common/modules/app_monitoring/` is the shared sub-module.
- Notification channels are configurable per app.

### 3. Cloud Logging (canonical)

- All Cloud Run revisions and GKE pods stream stdout/stderr to Cloud Logging by default.
- Init / migration job logs surface via `gcloud run jobs executions logs` and `kubectl logs job/<name>`.
- Cloud Build logs via `gcloud builds log <build-id>`.
- Standard query patterns in `AGENTS.md` `/troubleshoot`.

### 4. Cloud Audit Logs (canonical)

`modules/Services_GCP/audit.tf` enables project-wide:

- **Admin Activity** logs (always-on).
- **Data Access** logs (configurable per service).
- **System Event** logs.

Long-term retention via Cloud Logging plus optional BigQuery sink.

### 5. Security Command Center (canonical)

`modules/Services_GCP/scc.tf` aggregates vulnerabilities, misconfigurations, and threat findings across the project.

### 6. VPC-SC dry-run violation observation

`vpc_sc_dry_run = true` logs would-be denials without enforcement (`.agent/VPC_SC_TESTING_GUIDE.md` documents the 1–2 week observation window before enforcement). Canonical control detail in [practices/devsecops.md](../practices/devsecops.md) §4.

### 7. Service mesh telemetry

`modules/Services_GCP/gke-mesh.tf`, `modules/App_GKE/gke-mesh.tf` provide automatic L7 metrics (request rate, latency, error rate) and distributed tracing for mesh-enrolled workloads — without app instrumentation. Multi-cluster topology details in [capabilities/networking.md](networking.md) §4.

### 8. GKE-specific observability

- **GKE Fleet** — `modules/Services_GCP/gke-fleet.tf` (centralised view across clusters).
- **Config Sync** — `modules/Services_GCP/gke-config-sync.tf` (configuration drift visibility).
- Kubernetes events via `kubectl describe`.

### 9. CI/CD observability (cross-ref)

Cloud Build history, Skaffold-generated artifacts, trigger logs — see [practices/cicd.md](../practices/cicd.md).

### 10. Cost observability (cross-ref)

`modules/Services_GCP/gke_metering.tf` documents Billing-export-to-BigQuery + cost-allocation labels + Monitoring dashboards. Canonical in [practices/finops.md](../practices/finops.md).

## Cross-references

- [practices/sre.md](../practices/sre.md) — SLO usage, DORA metrics, incident response (signal-consumption lens)
- [outcomes/compliance_governance.md](../outcomes/compliance_governance.md) — audit-evidence framing
- [practices/devsecops.md](../practices/devsecops.md) — VPC-SC dry-run, security-finding sources
- [practices/cicd.md](../practices/cicd.md) — pipeline observability
- [practices/finops.md](../practices/finops.md) — cost observability
- [capabilities/networking.md](networking.md) — service-mesh telemetry context
