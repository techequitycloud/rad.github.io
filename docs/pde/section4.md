# Implementing observability practices and troubleshooting issues
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section4.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section4.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pde_section4.pdf)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification. It maps the official exam guide domains to practical implementations in deployments generated from the platform portal.

By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical DevOps and SRE topics.

---

## Section 4: Implementing observability practices and troubleshooting issues (~25% of the exam)

### 4.1 Instrumenting and collecting telemetry
**Concept:** Proactively probing systems to detect failures before users do.
**Implementation Context:**
*   **Synthetic Monitors:** Review the configuration options in the deployment portal. The platform automatically provision custom uptime checks (Uptime check configurations) that continuously probe application endpoints to verify availability and responsiveness.
**Exploration:**
*   Navigate to **Monitoring > Uptime checks** in the GCP Console to observe the deployed synthetic monitors probing your Cloud Run or GKE endpoints.
*   Examine the portal settings to understand how Uptime check configurations are deployed to these probes.

### 4.3 Managing metrics, dashboards, and alerts
**Concept:** Visualizing health and alerting operators when Service Level Indicators (SLIs) are at risk.
**Implementation Context:**
*   **Managing Dashboards:** Review the configuration options in the deployment portal. The deployments programmatically generate custom operational dashboards, aggregating metrics specific to Cloud Run or GKE, giving operators immediate visibility.
*   **Configuring Alerting Policies:** Review the configuration options in the deployment portal. The deployments configure threshold-based alerts (Alert policies) tailored to the compute platform. Default policies alert on CPU and Memory > 90%. For Cloud Run, custom alerts can be configured to trigger on high latency (p95), CPU starvation, or elevated 5xx error rates via the `alert_policies` list variable. For GKE, custom alerts can be configured to trigger on pod restart loops (CrashLoopBackOff) or unschedulable pods.
**Exploration:**
*   Navigate to **Monitoring > Dashboards** in the GCP Console. Explore the custom dashboard created by the platform and analyze the specific charts (e.g., CPU, Memory, Request Latency) for Cloud Run or GKE.
*   Navigate to **Monitoring > Alerting**. Review the alerting policies created by the platform, paying attention to the configured thresholds, aggregation periods, and notification channels.
*   Review the portal settings to see how baseline CPU and Memory alert policies are defined and applied for both Cloud Run and GKE deployments.
