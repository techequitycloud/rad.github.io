# PDE Certification Preparation Guide: Exploring the Professional DevOps Engineer Domains

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification. It maps the official exam guide domains to practical implementations in the provided Terraform codebase (`modules/App_CloudRun` and `modules/App_GKE`), which rely on the shared `modules/App_GCP` module.

By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical DevOps and SRE topics.

---

## Section 4: Implementing observability practices and troubleshooting issues (~25% of the exam)

### 4.1 Instrumenting and collecting telemetry
**Concept:** Proactively probing systems to detect failures before users do.
**Implementation Context:**
*   **Synthetic Monitors:** Review `monitoring.tf`. The modules automatically provision custom uptime checks (`google_monitoring_uptime_check_config`) that continuously probe application endpoints to verify availability and responsiveness.
**Exploration:**
*   Navigate to **Monitoring > Uptime checks** in the GCP Console to observe the deployed synthetic monitors probing your Cloud Run or GKE endpoints.
*   Examine the generated `monitoring.tf` files to understand how `google_monitoring_uptime_check_config` variables configure these probes.

### 4.3 Managing metrics, dashboards, and alerts
**Concept:** Visualizing health and alerting operators when Service Level Indicators (SLIs) are at risk.
**Implementation Context:**
*   **Managing Dashboards:** Review `dashboard.tf`. The modules programmatically generate custom operational dashboards, aggregating metrics specific to Cloud Run or GKE, giving operators immediate visibility.
*   **Configuring Alerting Policies:** Review `monitoring.tf`. The modules configure threshold-based alerts (`google_monitoring_alert_policy`) tailored to the compute platform. Default policies alert on CPU and Memory > 90%. For Cloud Run, custom alerts can be configured to trigger on high latency (p95), CPU starvation, or elevated 5xx error rates via the `alert_policies` list variable. For GKE, custom alerts can be configured to trigger on pod restart loops (CrashLoopBackOff) or unschedulable pods.
**Exploration:**
*   Navigate to **Monitoring > Dashboards** in the GCP Console. Explore the custom dashboard created by `dashboard.tf` and analyze the specific charts (e.g., CPU, Memory, Request Latency) for Cloud Run or GKE.
*   Navigate to **Monitoring > Alerting**. Review the alerting policies created by `monitoring.tf`, paying attention to the configured thresholds, aggregation periods, and notification channels.
*   Review `modules/App_GCP/modules/app_monitoring/main.tf` to see how baseline CPU and Memory alert policies are defined and applied for both Cloud Run and GKE deployments.
