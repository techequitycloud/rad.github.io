# PCA Certification Preparation Guide: Section 6 — Ensuring solution and operations excellence (~12.5% of the exam)
<YouTubeEmbed videoId="yt7BCx-K5Y4" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section6.png" />

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pca_section6.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification explore Section 6 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCA objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 6.1 Operational Excellence Pillar (Well-Architected Framework)
### 💡 Additional Operational Excellence Objectives & Learning Guidelines
*   **Principles and Recommendations:** Study the Google Cloud Well-Architected Framework's Operational Excellence pillar. Understand its focus on automating deployments, responding to events, monitoring systems, and continually refining processes to improve service reliability and velocity.

---

## 6.2 Familiarity with Google Cloud Observability solutions

### Monitoring, Logging, and Alerting Strategies
**Concept:** Implementing systems to detect, troubleshoot, and resolve incidents rapidly.

**In the RAD UI:**
*   **Alert Policies:** The platform automatically configures custom alerting. In **GCP Services**, `alert_cpu_threshold` (Group 17), `alert_memory_threshold` (Group 17), and `alert_disk_threshold` (Group 17) monitor base infrastructure.
*   **Application-Level Alert Policies:** The `alert_policies` variable (Group 5 for Cloud Run, Group 13 for GKE) configures Cloud Monitoring alert policies for application-specific metrics — request latency, error rate, CPU utilisation, and memory utilisation — with customisable thresholds, durations, and notification channels per metric.
*   **Synthetic Monitoring:** The `uptime_check_config` variable (Group 5 for Cloud Run, Group 13 for GKE) configures Cloud Monitoring uptime checks that probe the application from multiple global locations, validating end-to-end reachability including DNS, load balancers, and Cloud Armor. Uptime checks are automatically configured to hit the external Load Balancer IP, verifying that the entire stack is operational.
*   **Notification Channels:** `support_users` (Group 1) and `notification_alert_emails` (Group 17 in GCP Services) map to Cloud Monitoring Notification Channels to page operators during degradation.

**Console Exploration:**
Navigate to **Monitoring > Alerting** to review MQL-based alert policies. Navigate to **Monitoring > Uptime checks** to review global synthetic monitors. Navigate to **Logging > Logs Explorer** to view aggregated container stdout/stderr streams.

**Real-world example:** A SaaS provider configures an MQL-based alert policy that fires when the 95th-percentile request latency for the Cloud Run service exceeds 2 seconds over a 5-minute rolling window. The notification channel routes the alert to a Google Chat webhook in the on-call team's incident channel, and a second alert fires when the Cloud SQL CPU utilization exceeds 80% for 10 consecutive minutes — giving the team both application-layer and database-layer visibility in a single pane of glass through a custom Cloud Monitoring dashboard.

### 💡 Additional Profiling and Benchmarking Objectives & Learning Guidelines
*   **Profiling and Benchmarking:** Research Cloud Profiler to understand continuous CPU and memory profiling across your fleet to optimize code performance. Study Cloud Trace to visualize latency across distributed microservices.

---

## 6.3 Deployment and release management
### 💡 Additional Deployment Objectives & Learning Guidelines
*   While Cloud Deploy handles the infrastructure rollout, study how to manage database schema migrations concurrently with application rollouts without causing downtime. A common Google Cloud–native pattern is to add a pre-deploy step in the Cloud Build pipeline that runs a containerized migration script as a Cloud Run Job against Cloud SQL before the new application revision is promoted — ensuring the schema is updated in a backwards-compatible way before any traffic is cut over. For Cloud Spanner, use the Spanner Schema Update API which applies DDL changes without locking the table, enabling zero-downtime migrations on globally distributed databases.

---

## 6.4 Assisting with the support of deployed solutions
### 💡 Additional Support Objectives & Learning Guidelines
*   Understand Google Cloud Support plans (Standard, Enhanced, Premium) and how to interact with Google Cloud Customer Care or Technical Account Managers (TAMs) during Sev-1 incidents. Premium support provides a TAM for proactive guidance and a 15-minute initial response SLA for P1 cases, which is a key architectural consideration for mission-critical production workloads.

---

## 6.5 Evaluating quality control measures
### 💡 Additional Quality Control Objectives & Learning Guidelines
*   Study how to implement code reviews and integrate static application security testing (SAST) into Cloud Build pipelines. Google Cloud–native options include Artifact Registry's built-in container vulnerability scanning (powered by Container Analysis), Security Command Center's Web Security Scanner for detecting XSS and mixed-content issues in deployed web applications, and Cloud Build steps that invoke the gcloud CLI to audit IAM policies or validate Terraform plans before applying them. Cloud Source Repositories also integrates with Cloud Build triggers for automated policy-as-code gate checks on every push.

---

## 6.6 Ensuring the reliability of solutions in production
### 💡 Additional Reliability Objectives & Learning Guidelines
*   **Chaos Engineering:** Understand the concept of intentionally injecting faults (e.g., terminating random pods or blocking network ports) to verify that the high-availability architecture functions as designed.
*   **Penetration Testing:** Review Google Cloud's acceptable use policy regarding penetration testing.
*   **Load Testing:** Practice generating synthetic load to validate autoscaling boundaries configured in Cloud Run and GKE. Google Cloud's Distributed Load Testing reference architecture deploys load-generation agents as Cloud Run Jobs or GKE pods that scale horizontally, enabling thousands of concurrent simulated users without managing load-generator infrastructure. Use Cloud Monitoring dashboards to observe how Cloud Run instance count and GKE HPA scale in response, and confirm that alerting policies trigger appropriately when latency thresholds are breached.
