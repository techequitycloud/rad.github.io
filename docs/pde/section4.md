# PDE Certification Preparation Guide: Section 4 — Implementing observability practices and troubleshooting issues (~25% of the exam)
<YouTubeEmbed videoId="_lc9jAQk_jA" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section4.png" />

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pde_section4.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification explore Section 4 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PDE objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 4.1 Instrumenting and collecting telemetry

### Synthetic Monitors and Uptime Checks
**Concept:** Proactively probing systems from external vantage points to detect availability and performance degradation before users report it.

**In the RAD UI:**
*   **Synthetic Uptime Monitors:** The modules automatically provision Cloud Monitoring uptime checks that continuously probe application endpoints from multiple global regions. These checks verify that the Cloud Run or GKE service is reachable and returns a healthy HTTP status code within the configured timeout. Failures trigger alerts via the configured notification channels.

**Console Exploration:**
Navigate to **Monitoring > Uptime checks**. Review the deployed uptime check targeting your Cloud Run or GKE application endpoint. Observe the check interval, timeout, and the set of global regions used as probe origins. Click a check to see its current status across regions and the historical availability graph. Navigate to **Monitoring > Alerting** to see the alert policy linked to the uptime check, which fires when the configured number of regions report a failure simultaneously.

**Real-world example:** An e-commerce platform deploys Cloud Run services across three regions. Their Cloud Monitoring uptime checks probe all three endpoints every 60 seconds from 6 global regions. When a misconfigured deployment causes the Frankfurt endpoint to return HTTP 503, the uptime check detects the failure within 60 seconds from 3 of 6 probe regions, triggers a P1 alert to the on-call engineer via PagerDuty (configured as a notification channel), and the team rolls back before a single customer in EMEA reports an error.

### Startup and Liveness Probes — Internal Container Health Signals
**Concept:** Configuring container-level health checks that prevent unhealthy instances from serving traffic and trigger automatic restarts when an application becomes unresponsive — forming the innermost layer of an observability stack alongside external uptime checks.

**In the RAD UI:**
*   **Startup Probes (`startup_probe_config` — App CloudRun Group 5, App GKE Group 13):** The startup probe determines when a newly started container is ready to receive traffic. Neither Cloud Run nor Kubernetes routes any requests to a container until its startup probe succeeds. Configurable fields include: `path` (the HTTP endpoint to check, e.g. `/healthz`), `initial_delay_seconds` (wait before first probe — useful for slow-starting applications that run DB migrations), `failure_threshold` (consecutive failures before the container is considered failed and restarted), and `type` (`HTTP` or `TCP`). For applications with slow initialisation, increase `failure_threshold` or `period_seconds` rather than relying solely on `initial_delay_seconds`.
*   **Liveness Probes (`health_check_config` — App CloudRun Group 5, App GKE Group 13):** The liveness probe runs continuously after the startup probe succeeds, periodically checking whether the container is still healthy. If it fails `failure_threshold` consecutive times, the container is restarted automatically. The liveness endpoint must respond quickly and must not perform expensive operations (database queries, external API calls) — a slow or overloaded health endpoint can trigger false-positive restarts under high load.

**Understanding the Three-Layer Health Model:** The probes and uptime checks form distinct, complementary layers:
- **Startup probe** — inner layer: gates traffic routing during container initialisation.
- **Liveness probe** — inner layer: detects deadlocks or hung processes and triggers container restarts.
- **Uptime check** — outer layer: validates end-to-end reachability from the public internet, covering DNS, load balancers, firewall rules, and Cloud Armor. A passing liveness probe but failing uptime check typically indicates an infrastructure problem (misconfigured load balancer, certificate expiry, Cloud Armor rule blocking probes) rather than an application problem.

**Console Exploration:**
For Cloud Run, navigate to **Cloud Run > [service] > Revisions** and click the active revision. Select **Container(s)** and view the **Health checks** section to see startup and liveness probe configuration. For GKE, navigate to **Kubernetes Engine > Workloads > [deployment]** and click **YAML** to view `startupProbe` and `livenessProbe` fields in the pod spec. Navigate to the **Events** tab to see probe failure events if health checks are failing — the event reason `Unhealthy` with message `Liveness probe failed` indicates a container being restarted by the probe.

**Real-world example:** A team deploys a Node.js API on Cloud Run with `startup_probe_config = { path = "/healthz", initial_delay_seconds = 10, failure_threshold = 10 }`. The application runs a database migration at startup that takes up to 60 seconds. Without an appropriate `failure_threshold`, the default 3 failures × 10-second period = 30 seconds would kill the container before migrations complete. Setting `failure_threshold = 10` gives 100 seconds of grace — the startup probe passes once migrations complete, and only then does Cloud Run begin routing traffic to the instance. The external uptime check simultaneously confirms the load balancer endpoint is reachable — if the startup probe passes but the uptime check fails, the team knows to investigate network configuration rather than application startup.

### Cloud Monitoring Notification Channels
**Concept:** Routing alert notifications to designated operators through structured, auditable channels.

**In the RAD UI:**
*   **Notification Channels:** `support_users` (Group 1) and `notification_alert_emails` (Group 17 in GCP Services) are provisioned as Cloud Monitoring Notification Channels. These channels receive alert notifications when any alert policy threshold is breached — covering uptime failures, resource utilization thresholds, and custom metric alerts.

**Console Exploration:**
Navigate to **Monitoring > Alerting > Notification channels**. Review the provisioned email channels and confirm which alert policies are routed to each. Navigate to **Monitoring > Alerting** and inspect a specific alert policy to trace the full path from condition trigger → notification channel → recipient.

**Real-world example:** A DevOps team configures `notification_alert_emails` to route to their team's shared ops mailbox and a dedicated PagerDuty webhook (added as a webhook notification channel). When GKE pod CPU exceeds 90% for 5 minutes, Cloud Monitoring triggers the alert, sends email to the ops mailbox for logging, and simultaneously pages the on-call engineer via PagerDuty — ensuring the right person is notified without relying on anyone monitoring dashboards manually at 02:00.

### 💡 Additional Telemetry Objectives & Learning Guidelines
*   **Ops Agent for Compute Engine:** Research the Ops Agent, which collects logs and metrics from Compute Engine VMs at higher fidelity than the legacy Monitoring and Logging agents it replaces. The Ops Agent uses OpenTelemetry under the hood and supports third-party application metrics (e.g., MySQL, Nginx, Redis) via built-in receivers. Navigate to **Compute Engine > VM instances > [instance] > Observability** to install the Ops Agent and immediately see rich memory, disk I/O, and process-level metrics that are not available from the hypervisor alone.
*   **Cloud Trace — Distributed Tracing:** Research Cloud Trace for end-to-end latency analysis across microservices. Trace context propagates automatically for Cloud Run services instrumented with the Cloud Trace API or OpenTelemetry SDK, capturing per-span latency for every hop in a request path (load balancer → Cloud Run → Cloud SQL → Secret Manager). Navigate to **Trace > Trace list** to explore waterfall diagrams showing where latency is accumulated. Trace is essential for identifying whether a p99 latency regression is in the application code, the database query, or the network.
*   **Cloud Profiler — Continuous Production Profiling:** Research Cloud Profiler for sampling CPU time, heap allocation, and goroutine/thread contention in production workloads with low overhead (\<1% CPU impact). Profiler agents are integrated directly into application code (Go, Java, Node.js, Python) and continuously upload flame graph data to Cloud Profiler. Navigate to **Profiler** in the console to compare flame graphs between two time periods (e.g., before and after a deployment) to identify regressions introduced by new code paths.
*   **Log-Based Metrics:** Research how to create user-defined metrics derived from log data. A log-based metric counts log entries matching a filter (e.g., all log entries containing `"status": 500`) or extracts a distribution of values from a structured log field (e.g., the `latency_ms` field from request logs). Navigate to **Logging > Log-based metrics > Create metric** to define a counter or distribution metric. Log-based metrics appear in Cloud Monitoring and can be used in dashboards and alert policies exactly like native metrics — enabling alerting on any structured log field without application code changes.
*   **OpenTelemetry Integration:** Research how to instrument Cloud Run and GKE workloads with the OpenTelemetry SDK to emit traces, metrics, and logs in a vendor-neutral format. Google Cloud supports the OpenTelemetry Protocol (OTLP) natively: the Cloud Monitoring exporter and Cloud Trace exporter for OpenTelemetry SDKs are available for all major languages. For GKE, deploy the OpenTelemetry Collector as a DaemonSet to centrally receive telemetry from all pods and forward it to Cloud Monitoring and Cloud Trace — avoiding per-pod API credentials and providing a single point of telemetry configuration.

---

## 4.2 Troubleshooting and analyzing issues

### Cloud Logging and Error Reporting
**Concept:** Capturing structured application and infrastructure logs centrally, and surfacing automatically detected errors for rapid triage and root cause analysis.

**In the RAD UI:**
*   **Structured Application Logs:** Cloud Run and GKE Autopilot workloads emit logs automatically to Cloud Logging. Applications that write structured JSON to stdout (with fields like `severity`, `message`, `httpRequest.status`, and `labels`) have their logs automatically parsed by Cloud Logging, enabling precise filtering, alerting, and metric extraction without additional configuration.
*   **Infrastructure and Audit Logs:** All Terraform operations executed via Cloud Build generate Admin Activity audit logs, providing an immutable, chronological record of every infrastructure change made during module deployments. These logs are essential for troubleshooting deployment failures and auditing configuration drift.
*   **Error Reporting:** Cloud Logging automatically forwards unhandled exception stack traces from Cloud Run and GKE workloads to Error Reporting, which groups related errors, tracks their frequency over time, and highlights newly introduced errors (first-seen timestamp).

**Console Exploration:**
Navigate to **Logging > Logs Explorer**. In the query editor, filter logs by resource type (`cloud_run_revision` or `k8s_container`) to see application logs. Use the structured log viewer to expand a JSON log entry and observe how individual fields (severity, labels, httpRequest) are parsed and indexed for filtering. Add a filter on `severity=ERROR` to isolate error logs. Navigate to **Error Reporting** to see automatically grouped error clusters. Click any error group to view the stack trace, the first-seen and last-seen timestamps, the affected service version, and a link back to the specific log entries in Logs Explorer.

**Real-world example:** A team deploys a new Cloud Run revision that introduces a bug causing `NullPointerException` in the payment processing path. The application writes structured JSON logs to stdout. Within 2 minutes of deployment, Error Reporting surfaces a new error group with the full stack trace, labels it as "First seen 4 minutes ago," and notes the error is occurring 200 times per minute — correlated with the traffic split to the new revision. The on-call engineer identifies the problem, triggers a rollback to the previous revision via Cloud Run traffic splitting, and the error rate drops to zero within 90 seconds — without requiring any log query expertise.

### 💡 Additional Troubleshooting Objectives & Learning Guidelines
*   **Logs Explorer — Advanced Filtering and Analysis:** Research the Logs Explorer query language for complex log investigation. Key operators include: `severity>=WARNING` (threshold filtering), `jsonPayload.user_id="12345"` (structured field extraction), `timestamp>="2024-01-01T00:00:00Z"` (time bounding), and `resource.labels.service_name="checkout"` (resource scoping). Practice creating log queries that pinpoint the exact request causing a failure — combining resource labels, severity, and structured payload fields. Use the **Histogram** view to visualize log volume spikes correlated with deployment events.
*   **Cloud Trace for Latency Troubleshooting:** Beyond instrumentation, use Cloud Trace's analysis tools to troubleshoot latency issues. Navigate to **Trace > Analysis reports** to see latency distribution percentiles (p50, p95, p99) and automatically identified latency outliers. Use the **Trace comparison** feature to compare latency profiles between two time windows — for example, the 30 minutes before and after a deployment — to isolate whether a latency regression is specific to a new code path, a downstream dependency, or infrastructure contention.
*   **Cloud Monitoring — Metrics Explorer for Troubleshooting:** Navigate to **Monitoring > Metrics Explorer** and build ad-hoc metric queries to troubleshoot performance regressions. Key metrics to know: `run.googleapis.com/request_latencies` (Cloud Run request latency percentiles), `run.googleapis.com/container/instance_count` (active instance count for scaling analysis), `kubernetes.io/container/restart_count` (pod restart count for CrashLoopBackOff diagnosis), and `cloudsql.googleapis.com/database/cpu/utilization` (database CPU for slow query correlation). Combine multiple metrics on one chart with different Y-axes to visually correlate a latency spike with a database CPU spike.
*   **Identifying Misconfigurations with GKE Events:** For GKE workloads, Kubernetes events capture infrastructure-level failures that do not appear in application logs — including scheduling failures (`Insufficient memory`, `Unschedulable`), image pull errors (`ErrImagePull`), and liveness probe failures. Navigate to **Kubernetes Engine > Workloads > [deployment]** and check the **Events** tab. Alternatively, filter Cloud Logging for `resource.type="k8s_node"` or use `kubectl get events --sort-by=.lastTimestamp -n [namespace]` from Cloud Shell to see the chronological event stream.
*   **Cloud Run Troubleshooting — Revision Diagnostics:** Cloud Run provides deployment-time validation and runtime diagnostics. Navigate to **Cloud Run > [service] > Revisions** and click a failed revision to see its status condition details (e.g., `ContainerFailed: The user-provided container failed to start`). Check the **Logs** tab on the revision directly to see startup logs. Common issues to diagnose: container fails health check (misconfigured `containerPort`), container exits immediately (missing required environment variable), or container exceeds memory limit (under-provisioned `memory` setting).

---

## 4.3 Managing metrics, dashboards, and alerts

### Custom Dashboards and MQL-Based Alert Policies
**Concept:** Visualizing the health of deployed workloads in real time and generating actionable alerts when Service Level Indicators (SLIs) approach their Service Level Objectives (SLOs).

**In the RAD UI:**
*   **Custom Operational Dashboards:** The modules automatically provision custom Cloud Monitoring dashboards aggregating the key metrics for Cloud Run or GKE — CPU utilization, memory utilization, request latency, error rate, and instance/pod count. These dashboards give operators immediate, contextual visibility into the deployed workload without requiring manual dashboard construction.
*   **Resource Utilization Alert Policies:** `alert_cpu_threshold`, `alert_memory_threshold`, and `alert_disk_threshold` (Group 17 in GCP Services) configure MQL-based alert policies that fire when the configured resource utilization thresholds are exceeded for a sustained duration. These serve as baseline health guards for both Cloud Run and GKE workloads.
*   **Alert Routing:** Alert notifications are routed to the notification channels provisioned from `support_users` (Group 1) and `notification_alert_emails` (Group 17), ensuring alerts reach the correct operators.

**Console Exploration:**
Navigate to **Monitoring > Dashboards** to find the custom operational dashboard created by the module. Explore each chart — hover over data points to inspect precise metric values, change the time range to compare current behavior against historical baselines, and use the **Compare** feature to overlay metrics from different time windows. Navigate to **Monitoring > Alerting** to review active alert policies. Click into an alert policy to inspect its MQL condition, the evaluation window (e.g., 5 minutes), the threshold value, and the notification channels it targets. Review the **Incidents** tab to see a history of triggered alerts and their resolution status.

**Real-world example:** A platform engineering team sets `alert_cpu_threshold = 80` and `alert_memory_threshold = 85` for their GKE-based order processing service. During a flash sale, order volume triples. Cloud Monitoring's alert policy detects that average pod CPU has exceeded 80% for 5 consecutive minutes and fires an alert to the team's Slack channel (configured as a notification channel). The on-call engineer pulls up the custom dashboard, observes the correlated memory and CPU spike across all pods, and scales up the node pool — resolving the pressure before any user-facing latency degradation occurs.

### 💡 Additional Metrics and Alerting Objectives & Learning Guidelines
*   **SLO-Based Alerting and Error Budget Burn Rate:** Research Cloud Monitoring's native SLO monitoring, which defines availability and latency SLOs directly in Cloud Monitoring and automatically calculates error budget consumption. Navigate to **Monitoring > Services > Create SLO** to define a request-based SLO (e.g., 99.9% of requests respond within 500ms). Configure burn rate alerts that fire when the error budget is being consumed faster than sustainable — for example, a 14x burn rate alert that fires when 2% of the monthly error budget has been spent in the last 60 minutes (the Google SRE "multiwindow, multi-burn-rate" alerting pattern).
*   **PromQL for GKE Metric Queries:** For GKE workloads, Cloud Monitoring supports PromQL in addition to MQL, enabling teams already familiar with Prometheus query syntax to write alert conditions and dashboard queries without relearning a new language. Navigate to **Monitoring > Metrics Explorer**, select **PromQL** as the query language, and write Kubernetes-native queries (e.g., `rate(container_cpu_usage_seconds_total[5m])` or `kube_pod_container_resource_requests{resource="memory"}`). GKE Autopilot automatically exports Kubernetes system metrics to Cloud Monitoring in a Prometheus-compatible format.
*   **Alerting Policy Best Practices — Reducing Noise:** Study alert policy design patterns to minimise false positives: use alignment periods long enough to smooth transient spikes (5 minutes for CPU, not 1 minute); use `ALIGN_PERCENTILE_99` for latency metrics rather than `ALIGN_MEAN` to alert on tail latency; configure a "renotification interval" to suppress repeated notifications for long-duration incidents; and use alert policy labels and user labels to route different alert types to different notification channels (infrastructure alerts to ops, application error alerts to developers). Navigate to **Monitoring > Alerting > [policy] > Edit** to explore all available condition options.
*   **Multi-Condition Alert Policies:** Research how to combine multiple conditions in a single alert policy to reduce alert fatigue. A composite alert policy can fire only when both CPU > 80% AND memory > 80% are simultaneously true — preventing false positives from transient single-resource spikes. Use the `AND` condition combiner in the alert policy editor. Alternatively, use the `OR` combiner to create a single "service health degraded" alert that aggregates multiple error signals (high 5xx rate OR high latency OR low availability) into one actionable notification.
*   **Alerting on Logs — Log-Based Alert Policies:** Research how to create alert policies that trigger directly on log entries matching a filter — without requiring a separate log-based metric. Navigate to **Monitoring > Alerting > Create policy > Log match condition** and define a log filter (e.g., `severity=CRITICAL AND resource.type="cloud_run_revision"`). This provides the fastest alerting path for conditions that are naturally expressed as log patterns (security events, specific error messages, audit log entries) without the latency of first converting them to a metric.

---

## 4.4 Managing and exporting logs

### Log Routing and Log Sinks
**Concept:** Controlling where log entries are sent — retaining them in Cloud Logging for interactive analysis, routing copies to long-term storage in GCS, exporting to BigQuery for SQL-based analysis, or forwarding to Pub/Sub for real-time stream processing.

**In the RAD UI:**
Cloud Run and GKE Autopilot workloads write logs automatically to Cloud Logging. The modules do not configure custom log sinks — all logs flow to the default `_Default` log bucket retained for 30 days. Understanding how to route logs beyond this default is an important PDE exam topic.

**Key Log Routing Concepts:**
*   **Log sinks** are the routing mechanism in Cloud Logging. Each sink has a filter (which log entries to route) and a destination (where to send them). Three sink scopes exist: **project-level** (routes logs from a single project), **folder-level** (aggregates logs from all projects in a folder — a key pattern for centralised compliance logging), and **organisation-level** (aggregates logs from the entire organisation).
*   **Aggregated sinks** at the folder or organisation level are the standard pattern for centralised security and compliance logging. A single aggregated sink with an `_Required` or `_Default` filter routing to a shared GCS bucket or BigQuery dataset gives the security team a single place to query all audit logs across every project — without needing access to individual project consoles.
*   **Exclusion filters** allow specific log types to be dropped before storage, reducing log ingestion costs. For example, Cloud Run request logs for health check paths (`/healthz`) generate high volume with no diagnostic value — an exclusion filter on `httpRequest.requestUrl="/healthz"` eliminates them before they are stored.

**Console Exploration:**
Navigate to **Logging > Log Router**. Review the default `_Default` and `_Required` log buckets and their retention periods. Click **Create sink** to see the available destination types: Cloud Logging bucket, Cloud Storage, BigQuery, and Pub/Sub. Navigate to **Logging > Logs Explorer** and switch the query mode to **Log Analytics** (the BigQuery-backed mode) — this unlocks SQL queries over log data, enabling aggregation, joins, and time-series analysis that are not possible in the standard filter interface. Run a query such as:
```sql
SELECT
  timestamp,
  resource.labels.service_name,
  http_request.status,
  http_request.latency
FROM
  `PROJECT_ID.global._Default._AllLogs`
WHERE
  resource.type = 'cloud_run_revision'
  AND http_request.status >= 500
ORDER BY timestamp DESC
LIMIT 100
```

**Real-world example:** A company operating across 12 GCP projects configures an organisation-level aggregated log sink routing all `protoPayload.@type="type.googleapis.com/google.cloud.audit.AuditLog"` entries to a shared BigQuery dataset in a dedicated security project. Their security team runs weekly SQL queries against this dataset to identify anomalous API call patterns — for example, any `google.cloud.run.v1.Services.ReplaceService` call made outside the CI/CD service account (indicating a manual deployment bypassing the pipeline). The BigQuery export retains 365 days of audit history, satisfying their compliance requirement, while Cloud Logging's interactive interface retains only 30 days for operational troubleshooting.

### 💡 Additional Log Management Objectives & Learning Guidelines
*   **Log Buckets and Retention Policies:** Research how to create custom Cloud Logging log buckets with non-default retention periods. Navigate to **Logging > Log buckets > Create bucket** and configure a retention period of up to 3650 days (10 years). Applying a retention lock prevents the retention period from being reduced — a key compliance control for regulated industries. Understand that the `_Required` bucket (holding Admin Activity and System Event audit logs) has a fixed 400-day retention that cannot be shortened.
*   **Structured Logging Best Practices:** For Cloud Run and GKE workloads to emit logs that are automatically parsed by Cloud Logging, applications must write JSON to stdout with a `severity` field matching Cloud Logging's severity levels (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`). Additionally, including `logging.googleapis.com/trace` and `logging.googleapis.com/spanId` fields in log entries automatically correlates them with Cloud Trace spans — enabling trace-to-log navigation in the console without additional configuration.
*   **VPC Flow Logs for Network Troubleshooting:** Research VPC Flow Logs, which capture metadata about network flows through GKE node network interfaces — source/destination IP, port, bytes transferred, and latency. Enable flow logs on the GKE cluster's subnet (navigate to **VPC Network > Subnets > [subnet] > Edit** and enable flow logs). Flow logs are essential for diagnosing connectivity issues between pods and Cloud SQL, Memorystore, or NFS instances — confirming whether traffic is reaching its destination and at what volume.

---
