---
title: "PDE Section 4 Prep: Observability & Troubleshooting"
description: "Prepare for the PDE exam Section 4 — implementing observability practices and troubleshooting issues — with hands-on RAD deployment labs on Google Cloud."
---

# PDE Certification Preparation Guide: Section 4 — Implementing observability practices and troubleshooting issues (~25% of the exam)

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pde_section4.png" alt="PDE Certification Preparation Guide: Section 4 — Implementing observability practices and troubleshooting issues (~25% of the exam)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Official exam guide:** [Professional Cloud DevOps Engineer certification](https://cloud.google.com/learn/certification/cloud-devops-engineer) — always confirm section weightings against the current Google Cloud exam guide.

This guide covers exam Section 4 — tied with Section 2 as the heaviest domain — using the RAD foundation modules. The observability surface is built from the monitoring layer (notification channels + alert policies), auto-generated per-platform dashboards, Data Access audit logging in every module, and the GKE cluster's logging/monitoring configuration. Deploy the **Observability baseline** profile from the [Lab Map](PDE_Certification_Guide.md); the GKE parts also need the **GKE release engineer** profile.

One scoping note up front: the application engines create a real synthetic uptime check from `uptime_check_config` (default `{ enabled = false, path = "/" }` — you must opt in) — and then **only when the endpoint is publicly reachable**. Cloud Run probes the first `application_domains` entry, else the nip.io LB host, else the run.app URL when `ingress_settings = "all"`; GKE probes the custom domain via the Gateway (HTTPS:443) or the LoadBalancer Service ingress IP over HTTP on `service_port`. Internal-only deployments get no check, and the `uptime_check_names` output returns the created check's name (empty when skipped).

---

## 4.1 Instrumenting and collecting telemetry

> ⏱ ~60 min · 💰 low–moderate (log ingestion if audit logging is on) · ⚙️ Requires: Observability baseline profile; GKE release engineer profile for cluster telemetry

**Why the exam cares** — Telemetry questions test what is collected automatically vs. what needs opt-in: Cloud Run and GKE emit logs and platform metrics natively; workload metrics, data-access audit logs, Prometheus metrics, traces, and synthetic probes all require deliberate enablement. You should know which agent/config produces which signal.

**How RAD implements it**

| Signal | How it's produced |
|---|---|
| Application logs | automatic — Cloud Run revisions and GKE containers write stdout/stderr to Cloud Logging; the GKE cluster explicitly enables system-component and workload logging |
| Platform metrics | automatic (`run.googleapis.com/*`, `kubernetes.io/*`); the cluster enables system-component monitoring |
| Prometheus metrics | Managed Service for Prometheus is enabled on every Services_GCP cluster — it scrapes workload metrics, queryable with PromQL in Metrics Explorer |
| Notification channels | `support_users` (app modules) → one email channel each (created with force-delete enabled); `notification_alert_emails` + `configure_email_notification = true` in Services_GCP for platform alerts |
| Audit telemetry | `enable_audit_logging` (default `false`) → `ADMIN_READ`/`DATA_READ`/`DATA_WRITE` on `allServices` + explicit Secret Manager and KMS configs |
| VM-level metrics | the Services_GCP self-managed NFS VM's memory alert uses the Ops Agent metric `agent.googleapis.com/memory/percent_used` — memory is invisible to the hypervisor without the agent |
| Build/deploy telemetry | Cloud Build logs forced to `CLOUD_LOGGING_ONLY` |
| Uptime checks | `<service>-uptime-check` (HTTP GET, period from `check_interval` default `"60s"`, timeout default `"10s"`) plus `<service>-uptime-check-alert` on `monitoring.googleapis.com/uptime_check/check_passed`, created only for publicly reachable endpoints (see note above) |

Note the activation logic in `App_CloudRun`: monitoring is configured when `support_users` is non-empty, or `alert_policies` is non-empty, or `uptime_check_config.enabled` is true — but the email channels and the built-in CPU/memory alerts are only created when `support_users` has at least one entry.

**Try it**
1. Apply the Observability baseline profile, then confirm the channels exist:

```bash
gcloud beta monitoring channels list \
  --format="table(displayName,type,labels.email_address)"
```

2. Query workload telemetry with PromQL: **Console > Monitoring > Metrics Explorer > PromQL** and run `rate(container_cpu_usage_seconds_total[5m])` against the GKE namespace (works because managed Prometheus is enabled cluster-wide).
3. Verify the audit pipeline: read a secret, then find your own `AccessSecretVersion` entry:

```bash
gcloud logging read \
  'protoPayload.serviceName="secretmanager.googleapis.com"' --limit=3 \
  --format="table(timestamp,protoPayload.methodName,protoPayload.authenticationInfo.principalEmail)"
```

4. Inspect the module-created synthetic check (publicly reachable deployments only): `gcloud monitoring uptime list-configs` shows `<service>-uptime-check`; open it in **Console > Monitoring > Uptime checks** and trace the attached `<service>-uptime-check-alert` policy back to your email channel.
5. You know it worked when channels list your email, PromQL returns series for your namespace, the audit entry names you, and the uptime check turns green from multiple regions.

**Check yourself**
<details>
<summary>Q1: Your GKE pod's memory metrics appear in Cloud Monitoring, but your custom application metric (`orders_processed_total`) does not. The app exposes it on `/metrics`. What's missing?</summary>

A: Platform metrics are automatic, but Prometheus-format application metrics need scraping. With managed Prometheus enabled (as Services_GCP does), you still must add a `PodMonitoring` custom resource targeting the pod's metrics port — collection infrastructure being enabled doesn't mean your endpoint is being scraped.
</details>

<details>
<summary>Q2: Why does the NFS VM memory alert require the Ops Agent while the CPU alert does not?</summary>

A: CPU utilization (`compute.googleapis.com/instance/cpu/utilization`) is measured by the hypervisor; guest memory usage is not visible from outside the OS, so it requires the in-guest Ops Agent reporting `agent.googleapis.com/memory/percent_used`. A standard exam distinction between hypervisor and agent metrics.
</details>

**Beyond the modules** — Scripted synthetic monitors (Cloud Functions-based synthetics that probe a multi-step workflow, beyond plain uptime checks), private uptime checks against internal endpoints, log-based metrics and other custom metrics, VPC Flow Logs, the OpenTelemetry Collector and Ops Agent as collection paths (including for hybrid and multi-cloud workloads), Cloud Service Mesh telemetry, and Cloud Profiler (continuous CPU/heap profiling) are all untouched by the modules. The same is true of log *optimization*: no exclusion filters, sampling or cost controls are configured (see 4.2). In a scratch project: `gcloud monitoring uptime create` against a private endpoint and `gcloud logging metrics create` are quick to try and frequently examined. Tracing is covered in 4.4.

**⚠️ Exam trap** — "Monitoring is enabled" has many layers: a variable that *accepts* monitoring config is not by itself evidence the signal is collected (earlier platform releases accepted `uptime_check_config` without creating any check; verify in the console — today it provisions one, but only for public endpoints). On the exam, match each signal to its producer: agent, platform, scrape config, or audit config.

---

## 4.2 Managing and analyzing logs

> ⏱ ~45 min · 💰 low (log ingestion; sinks bill at the destination) · ⚙️ Requires: any deployed application; `enable_audit_logging = true` for the audit queries

**Why the exam cares** — Logs are only useful if you can find the right entries, keep them as long as you need, and keep sensitive data out of them. The exam tests the Logging query language in the Logs Explorer, routing with sinks (to BigQuery for analysis, Pub/Sub for streaming, Cloud Storage for cheap retention), log bucket retention, redacting PII and PHI before or as logs are stored, and using Gemini Cloud Assist to summarise and explain log entries.

**How RAD implements it** — Partially. The modules produce logs that are easy to query, but configure no routing, retention or redaction:

- **Queryable structure**: every resource carries `application`, `deployment`, `tenant` and `managed-by` labels, Cloud Run services and GKE namespaces have deterministic names, and Cloud Build logs go to Cloud Logging only (`CLOUD_LOGGING_ONLY`), so build and runtime entries can be read side by side.
- **Audit logs**: `enable_audit_logging` (default `false`) adds Data Access logs for all services, with explicit Secret Manager and Cloud KMS entries.
- **Not configured**: no log sinks, exclusion filters, custom log buckets or retention settings are created, so everything lands in the project's `_Default` bucket with its default retention. PII and PHI redaction is left to the application.

**Try it**
1. In **Console > Logging > Logs Explorer**, run a query that combines resource, severity and a time bound:

```
resource.type="cloud_run_revision"
resource.labels.service_name="<service>"
severity>=WARNING
timestamp>="2026-01-01T00:00:00Z"
```

2. Pin a field from a log entry (**Show matching entries** / **Add to summary line**) and switch on the histogram to see when the entries clustered.
3. In a scratch project, route the same filter to BigQuery and confirm the dataset fills:

```bash
gcloud logging sinks create run-errors-to-bq \
  bigquery.googleapis.com/projects/$GOOGLE_PROJECT_ID/datasets/run_errors \
  --log-filter='resource.type="cloud_run_revision" AND severity>=ERROR'
```

   Then grant the sink's writer identity (printed by the command) `roles/bigquery.dataEditor` on the dataset.
4. You know it worked when your query returns only the service's warnings in the window you set, and new error entries appear in the BigQuery dataset.

**Check yourself**
<details>
<summary>Q1: Compliance requires application logs to be kept for seven years at minimal cost, while engineers need 30 days of fast search. What do you configure?</summary>

A: Keep the `_Default` bucket (or a custom log bucket) at 30 days for search, and add a sink routing the same logs to Cloud Storage with a lifecycle policy that moves objects to Archive storage and a retention policy (optionally locked) for seven years. BigQuery is the choice when the long-term data must be queried with SQL, not when the goal is the cheapest retention.
</details>

<details>
<summary>Q2: An application occasionally logs customer email addresses. What is the recommended way to stop them being stored in Cloud Logging?</summary>

A: Remove them before ingestion: fix the application's logging, or pass logs through a processor that redacts them (for example Sensitive Data Protection de-identification in a pipeline, or a processor in the OpenTelemetry Collector or Ops Agent). Exclusion filters drop whole entries, which also loses the useful part of the log.
</details>

**Beyond the modules** — Log sinks (project, folder and aggregated organization sinks), log buckets with custom retention and Log Analytics (SQL over logs), exclusion filters, Sensitive Data Protection for PII and PHI, and Gemini Cloud Assist's log explanation and summarisation in the Logs Explorer. None are configured by the RAD modules.

**⚠️ Exam trap** — Exclusion filters stop logs being *stored* in a bucket, which saves ingestion cost; they do not stop the logs being routed by other sinks, and excluded entries cannot be recovered later. Check that no sink or audit requirement depends on the logs before excluding them.

---

## 4.3 Managing metrics, dashboards, and alerts

> ⏱ ~60 min · 💰 low · ⚙️ Requires: Observability baseline profile

**Why the exam cares** — The exam tests alert policy mechanics — filters, aligners, reducers, duration windows, notification routing, renotification — and dashboard design that surfaces the four golden signals (latency, traffic, errors, saturation). You should be able to read an alert policy definition and predict exactly when it fires.

**How RAD implements it**

- **Fixed alerts** (the monitoring layer, created when `support_users` is non-empty): CPU and memory utilization, threshold `0.9`, greater-than comparison, duration `60s`, renotify every `1800s`. Aggregation differs by platform deliberately — Cloud Run aligns by delta and reduces with the 99th percentile over `run.googleapis.com/container/cpu/utilizations`; GKE aligns and reduces by mean grouped by pod name over `kubernetes.io/container/cpu/limit_utilization`.
- **Custom alerts**: the `alert_policies` variable (list of `{name, metric_type, comparison, threshold_value, duration_seconds, aggregation_period}`) becomes one policy per entry, auto-filtered to this service/namespace, aligned by mean, and routed to the same email channels.
- **Dashboards**: Cloud Run gets Request Count, Request Latency (p95), Container Instance Count, and Container CPU Utilization, pre-filtered to the service; GKE gets CPU Usage (Cores), Memory Usage (Bytes), Pod Restart Count, and Network Egress (Bytes), pre-filtered to the namespace.
- **Platform-layer alerts** (Services_GCP, gated on `configure_email_notification`, default `false`): Cloud SQL CPU/memory/disk policies driven by `alert_cpu_threshold`/`alert_memory_threshold`/`alert_disk_threshold` (all default `80`, divided by 100 into ratios), plus NFS-server CPU, memory (Ops Agent metric), and an instance-down policy built on *metric absence* of CPU utilization.

**Try it**
1. Add a latency alert via the portal:

```hcl
alert_policies = [{
  name             = "p99-latency-high"
  metric_type      = "run.googleapis.com/request_latencies"
  comparison       = "COMPARISON_GT"
  threshold_value  = 1000
  duration_seconds = 300
}]
```

2. Apply, then read back exactly what was created:

```bash
gcloud alpha monitoring policies list \
  --format="table(displayName,conditions[0].conditionThreshold.thresholdValue,conditions[0].conditionThreshold.duration)"
```

3. Open **Console > Monitoring > Dashboards**, find the module dashboard (named `<display name> - Cloud Run Dashboard (<deployment-id>)` or the GKE variant), and walk each widget; note the `dashboardFilters` pinning it to your service/namespace.
4. Force a notification: temporarily set a custom alert with `threshold_value = 1` on `run.googleapis.com/request_count`, generate traffic, and confirm the email arrives; check **Monitoring > Alerting > Incidents** for the open incident, then remove the test policy.
5. You know it worked when the policy appears with your threshold and duration, the incident opens and closes as traffic starts/stops, and email lands at the `support_users` address.

**Check yourself**
<details>
<summary>Q1: The Cloud Run CPU alert reduces with the 99th percentile across series while GKE reduces by mean grouped by pod. Why might the same "CPU > 90%" intent be aggregated differently?</summary>

A: Cloud Run instances are interchangeable and short-lived — alerting on the p99 across instances catches the worst instances without paging on a single outlier mean shift. GKE pods are longer-lived, fewer, and individually meaningful, so a per-pod mean (grouped by pod name) identifies *which* pod is hot. Aggregation strategy should match the failure unit you'd act on.
</details>

<details>
<summary>Q2: An alert has duration 300s. CPU spikes to 95% for 90 seconds, four times an hour. Does it fire?</summary>

A: No — the condition must hold continuously for the full duration window. 90-second spikes reset the clock each time. That's the false-positive defense duration provides, and also why genuinely bursty problems may need a shorter duration or a percentile aligner instead.
</details>

<details>
<summary>Q3: How does the Services_GCP "NFS instance down" alert detect an outage when a dead VM emits no metrics at all?</summary>

A: It's a metric-*absence* condition on `compute.googleapis.com/instance/cpu/utilization`: no data for the window means the instance stopped reporting, which is the failure signal. Threshold conditions can't catch "no data" — absence conditions exist precisely for dead-emitter detection.
</details>

**Cost-control alerting** — `Services_GCP`'s `create_billing_budget` (default `false`) creates a Cloud Billing budget of `budget_amount` (default `100`, in the billing account's currency) that emails `budget_alert_emails` and `support_users` at the `budget_alert_thresholds` fractions (default `[0.5, 0.9, 1.0]`). It is skipped when the deploying identity cannot read the project's billing account. A budget alert notifies; it does not stop spending.

**Beyond the modules** — SLO-based (burn-rate) alerting, log-match alert conditions, multi-condition policies with AND/OR combiners, webhook, PagerDuty and Slack notification channels, and incident tools such as Rootly that receive alerts through them (only `email` is created here), MQL/PromQL alert queries, PromQL dashboard widgets, dashboard sharing and linked playbooks (alert documentation), and dashboard `Compare to past` workflows. Each is a 10-minute console exercise on top of the deployed lab. Also try Gemini Cloud Assist on a module dashboard chart to have it interpret a metric's behaviour.

**⚠️ Exam trap** — Renotification (every 1800s here) controls reminders for a *still-open* incident; it does not re-evaluate or re-fire the condition. Confusing renotification with re-alerting leads to wrong answers about alert noise tuning.

---

## 4.4 Capturing and analyzing distributed traces

> ⏱ ~45 min (study plus a scratch-project exercise) · 💰 low · ⚙️ Requires: a scratch project for the tracing exercise

**Why the exam cares** — When a request crosses several services, logs and metrics show *that* it was slow but not *where*. The exam tests instrumenting with OpenTelemetry, reading a trace waterfall (a trace is a tree of spans, each with a start, a duration and attributes), finding the span that holds the latency, correlating a trace with its log entries through the trace ID, and asking Gemini Cloud Assist to analyse a trace.

**How RAD implements it** — Not implemented: no module instruments an application for tracing or configures Cloud Trace. Two adjacent facts are useful. Cloud Run adds trace context to incoming requests (the `traceparent` header, and the older `X-Cloud-Trace-Context`) and writes request logs that carry the trace ID, so an instrumented application deployed through RAD needs no infrastructure change to send traces. And `Services_GCP`'s optional Cloud Service Mesh (`configure_cloud_service_mesh`, available only in a project you bring yourself) is the platform option that adds service-to-service telemetry without application code.

**Try it**
1. In a scratch project, deploy a small service instrumented with the OpenTelemetry SDK and the Google Cloud trace exporter (or the OpenTelemetry Collector), and send it a few requests.
2. Open **Console > Trace > Trace explorer**, select a slow request, and read the waterfall: identify the root span and the child span that accounts for most of its duration.
3. From the trace, open the associated logs. For this to work, the application must write structured logs that include `logging.googleapis.com/trace` (and `logging.googleapis.com/spanId`) with the current trace ID.
4. You know it worked when you can name the slowest span in a request and jump from it to the log entries written during that span.

**Check yourself**
<details>
<summary>Q1: Traces appear in Cloud Trace, but the "View logs" link from a span finds nothing, although the application logs every request. Why?</summary>

A: The log entries are not correlated with the trace. The application must write the trace ID (and ideally span ID) into its structured log entries, in the `logging.googleapis.com/trace` field in the form `projects/PROJECT_ID/traces/TRACE_ID`. Without it, logs and traces are two unconnected data sets.
</details>

<details>
<summary>Q2: A checkout request takes 3 seconds. The trace shows a 2.8-second span for a database call that runs after a 50 ms span for the pricing service. Where do you start?</summary>

A: The database span: it holds most of the latency on the critical path. Check whether it is one slow query or many sequential calls (many short spans side by side suggest an N+1 pattern), then use the database's own query insights to explain it.
</details>

**Beyond the modules** — OpenTelemetry concepts (traces, spans, context propagation, sampling), the Cloud Trace explorer and its latency heatmap, trace sampling rates and their cost, and Gemini Cloud Assist's trace analysis. All are study and scratch-project items.

**⚠️ Exam trap** — Trace context must be *propagated* on every outgoing call. If one service in the chain drops the `traceparent` header, the trace breaks into separate, shorter traces, and the waterfall looks as though the downstream work never happened.

---

## 4.5 Troubleshooting issues

> ⏱ ~75 min · 💰 no additional cost · ⚙️ Requires: any deployed application; GKE profile for the Kubernetes paths

**Why the exam cares** — Troubleshooting questions are scenario-driven and span five kinds of issue: infrastructure (quota, IAM, networking), CI/CD pipeline (a failed build or rollout), application (a revision won't start, pods crash-loop), observability (an expected metric or log is missing), and performance and latency. The skill tested is choosing the right diagnostic surface — Logs Explorer filters, Kubernetes events, revision status conditions, build logs, Cloud Deploy rollout details, traces — and reading them in the right order.

**How RAD implements it** — The modules don't add troubleshooting tools per se; they produce richly labeled, predictable workloads to troubleshoot. Useful structure the modules guarantee: every resource carries `application`, `deployment`, `tenant`, and `managed-by` labels; Cloud Run revisions gate on a startup probe (`/healthz` by default) so misconfigured apps fail *visibly* at deploy time; GKE workloads run in a dedicated namespace with a deterministic name; init jobs (database setup, NFS setup) run as Cloud Run jobs / Kubernetes Jobs whose logs explain most first-deploy failures; and Cloud Build logs are in Cloud Logging (`CLOUD_LOGGING_ONLY`).

**Try it**
1. Stage a failure: in the portal, point `container_image` at a tag that doesn't exist (or set `startup_probe_config.path` to a bogus path) and apply.
2. Cloud Run diagnosis path — revision conditions first, logs second:

```bash
gcloud run revisions list --service=<service> --region=us-central1
gcloud run revisions describe <bad-revision> --region=us-central1 \
  --format="yaml(status.conditions)"
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="<service>"
   AND severity>=ERROR' --limit=10
```

3. GKE diagnosis path — events first, then pod state, then logs:

```bash
kubectl get events -n <namespace> --sort-by=.lastTimestamp | tail -20
kubectl get pods -n <namespace>          # look for ImagePullBackOff / CrashLoopBackOff
kubectl describe pod <pod> -n <namespace>
kubectl logs <pod> -n <namespace> --previous   # logs from the crashed container
```

4. In **Console > Logging > Logs Explorer**, reproduce step 2's query with the UI filters, switch on the **Histogram**, and correlate the error spike with the deploy timestamp.
5. Fix the variable, re-apply, and confirm recovery: the new revision reports `Ready: True` / pods reach `Running`.
6. You know it worked when you can state the failure cause from `status.conditions` or the event stream *before* opening application logs.

**Check yourself**
<details>
<summary>Q1: A new Cloud Run revision deploys but receives 0% traffic and the previous revision still serves. The deploy command reported failure. What happened and why is this good?</summary>

A: The startup probe (or container start) failed, so Cloud Run never marked the revision Ready and never shifted traffic — the previous revision keeps serving. This is fail-safe deployment: a broken image can't take an outage. Diagnosis: `status.conditions` on the revision, then its startup logs.
</details>

<details>
<summary>Q2: `kubectl logs` returns nothing for a pod stuck in `CrashLoopBackOff` with restarts climbing. What two commands get you the evidence?</summary>

A: `kubectl logs <pod> --previous` (the *crashed* container's output — the current one may not have logged yet) and `kubectl describe pod <pod>` (exit code, OOMKilled status, probe failures, events). Events and last-state often answer it without any application log at all.
</details>

<details>
<summary>Q3: A scheduled job worked for months, then silently stopped producing output. Logs show nothing at the expected time. Where do you look on this platform?</summary>

A: Absence of logs at the expected time means the job never ran — check the trigger layer, not the application: CronJob status/`suspend` flag and events on GKE (`kubectl get cronjob -n <ns>`), or the Cloud Run job execution history. Then check audit logs for who changed it.
</details>

**Beyond the modules** — Error Reporting (automatic exception grouping), Log Analytics (SQL over logs), trace-correlated log views (see 4.4), and `gcloud builds log <id> --stream` for live build debugging. For the other issue types: failed Cloud Deploy rollouts (`gcloud deploy rollouts describe`), quota errors in the Quotas page, IAM denials in audit logs and Policy Troubleshooter, network reachability with Connectivity Tests, missing telemetry (check the agent, the scrape configuration or the exclusion filter before the application), and latency with traces and Cloud Profiler. The exam guide also names Gemini Cloud Assist for AI-assisted investigation of logs, metrics and traces. Practice the Logs Explorer query language seriously — `resource.type`, `severity>=`, `jsonPayload.field=`, and timestamp bounds appear in exam answers verbatim.

**⚠️ Exam trap** — `kubectl logs` without `--previous` shows the *current* container instance. In a crash loop, the current instance is often seconds old and empty; the evidence is in the previous instance's logs.
