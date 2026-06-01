# PCA Certification Preparation Guide: Section 6 — Ensuring solution and operations excellence (~12.5% of the exam)

This guide helps candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification explore Section 6 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. Variables are organised into numbered groups in the RAD UI deployment form — for example, "(Group 3)" refers to the third collapsible section of settings for that module. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCA objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

📌 **Case study connection — all four case studies:** Section 6 spans the full Well-Architected Framework (operational excellence, reliability, security, cost, performance, sustainability) — themes present in every PCA case study. For any given Well-Architected pillar, identify which case study most stresses it: **EHR Healthcare** drives security and compliance requirements; **Cymbal Retail** drives reliability and cost optimisation for unpredictable retail traffic; **Altostrat Media** drives performance and scalability for high-throughput streaming; **KnightMotives Automotive** drives operational excellence for iterative AI/ML model deployment. Use these mappings as a revision framework.

---

## 6.1 Operational Excellence Pillar (Well-Architected Framework)

**Concept:** Applying the Google Cloud Well-Architected Framework's Operational Excellence pillar — automating deployments, instrumenting systems for observability, eliminating toil, and building a culture of continuous improvement so that production changes are safe, repeatable, and auditable.

**In the RAD UI:**
The RAD platform embeds operational excellence practices at every layer:
*   **Automated provisioning:** All infrastructure — VPC networks, databases, GKE clusters, Cloud Run services, monitoring, alerting — is provisioned via Terraform. There are no manual click-through steps; every resource is reproducible and version-controlled.
*   **CI/CD automation:** Cloud Build triggers (configured via `enable_cicd`, Group 5 in App CloudRun and App GKE) automatically build, test, and deploy application changes on every code commit. Cloud Deploy manages staged progression through dev → staging → production with configurable approval gates.
*   **Automated toil elimination:** `enable_auto_password_rotation` (Group 11 in App CloudRun, Group 17 in App GKE) runs a Cloud Run Job on a schedule to rotate database credentials automatically — removing a recurring manual operational task.
*   **Runbook-driven alerting:** Alert policies configured by `alert_cpu_threshold`, `alert_memory_threshold`, and `notification_alert_emails` (Group 17 in GCP Services) fire notifications with enough context (which resource, what threshold, what time) for on-call engineers to follow a documented runbook rather than investigate from scratch.

**Console Exploration:**
*   Navigate to **Cloud Build > History** to review the audit trail of every automated build and deploy. Each entry records the trigger source, the commit SHA, the build steps executed, and the overall pass/fail result — evidence that deployments are automated and traceable.
*   Navigate to **Cloud Deploy > Delivery pipelines** and review the release history for a pipeline. Observe that each release records who promoted it, when, and to which target — providing a tamper-resistant deployment audit log.
*   Navigate to **Cloud Scheduler** to view scheduled jobs — including the secret rotation job. Confirm the schedule, last run time, and last run status.

**Real-world example:** A platform team manages 8 microservices. Before adopting Cloud Build and Cloud Deploy, deployments required a developer to manually run `gcloud run deploy` and notify the on-call team via a Slack message. After automation, every commit to `main` triggers a Cloud Build pipeline that runs tests, builds the image, and creates a Cloud Deploy release. The dev stage deploys automatically; staging requires a single click in the Cloud Deploy console; production requires two approvers. The team's change failure rate dropped from 12% to 2% because the automated pipeline enforces test gates that manual deployments bypassed.

---

### 💡 Additional Operational Excellence Objectives & Learning Guidelines
*   **Principles and Recommendations:** Study the Google Cloud Well-Architected Framework's Operational Excellence pillar. Understand its focus on automating deployments, responding to events, monitoring systems, and continually refining processes to improve service reliability and velocity.

---

## 6.2 Familiarity with Google Cloud Observability solutions

### Monitoring, Logging, and Alerting Strategies
**Concept:** Implementing systems to detect, troubleshoot, and resolve incidents rapidly.

**In the RAD UI:**
*   **Alert Policies:** The platform automatically configures custom alerting. In **GCP Services**, `alert_cpu_threshold` (Group 17), `alert_memory_threshold` (Group 17), and `alert_disk_threshold` (Group 17) monitor base infrastructure.
*   **Synthetic Monitoring:** Uptime checks are automatically configured to hit the external Load Balancer IP, verifying that the entire stack is operational.
*   **Notification Channels:** `support_users` (Group 1) and `notification_alert_emails` (Group 17 in GCP Services) map to Cloud Monitoring Notification Channels to page operators during degradation.

**Console Exploration:**
Navigate to **Monitoring > Alerting** to review MQL-based alert policies. Navigate to **Monitoring > Uptime checks** to review global synthetic monitors. Navigate to **Logging > Logs Explorer** to view aggregated container stdout/stderr streams.

**Real-world example:** A SaaS provider configures an MQL-based alert policy that fires when the 95th-percentile request latency for the Cloud Run service exceeds 2 seconds over a 5-minute rolling window. The notification channel routes the alert to a Google Chat webhook in the on-call team's incident channel, and a second alert fires when the Cloud SQL CPU utilization exceeds 80% for 10 consecutive minutes — giving the team both application-layer and database-layer visibility in a single pane of glass through a custom Cloud Monitoring dashboard.

---

### 💡 Additional Profiling and Benchmarking Objectives & Learning Guidelines
*   **Profiling and Benchmarking:** Research Cloud Profiler to understand continuous CPU and memory profiling across your fleet to optimize code performance. Study Cloud Trace to visualize latency across distributed microservices.

---

## 6.3 Deployment and release management

**Concept:** Selecting and implementing deployment strategies that minimise user impact, enable rapid rollback, and enforce quality gates between environments — covering canary deployments, blue/green releases, staged rollouts, and GitOps-driven promotion workflows.

**In the RAD UI:**
*   **Cloud Deploy staged rollouts:** When `enable_cicd` is enabled, `trigger.tf` configures a `google_clouddeploy_delivery_pipeline` with a dev → staging → production progression. Each stage maps to a separate Cloud Run service or GKE namespace. Staging and production stages require manual promotion via the Cloud Deploy console, creating a human approval gate between environments.
*   **Cloud Run traffic splitting (canary):** The `traffic` block in `service.tf` supports traffic splitting between named revisions. An operator can route 5% of production traffic to the new revision, monitor error rates and latency, and then gradually increase traffic — all without a new build or deployment.
*   **Rollback:** Cloud Deploy retains the previous release. A single click on **Rollback** in the Cloud Deploy console creates a new rollout targeting the prior release's image digest — reverting to the last known-good state without rebuilding.

**Console Exploration:**
*   Navigate to **Cloud Deploy > Delivery pipelines** and select a pipeline. Observe the stage progression, the **Promote** button between stages, and the **Rollback** option within a completed rollout.
*   Navigate to **Cloud Run > Services**, select a service, and click the **Revisions** tab. Click **Manage traffic** to see how percentage-based traffic splitting is configured in the UI. Observe that traffic can be redistributed across any combination of existing revisions without a redeployment.
*   Navigate to **Cloud Build > History** and click a completed build. Review the step that calls `gcloud deploy releases create` — this is the handoff point between CI (Cloud Build) and CD (Cloud Deploy).

**Real-world example:** A retail company releases a new checkout flow. Rather than deploying to 100% of production traffic immediately, they configure a 5% canary in the Cloud Run traffic UI. A Cloud Monitoring SLO alert watches the canary revision's `5xx` error rate. After 30 minutes with zero errors and acceptable p95 latency, the team promotes to 25%, then 100%, using the Cloud Run traffic management UI — no new build required. When a different release causes a 4× spike in p99 latency, the team rolls back via Cloud Deploy in 15 seconds, and the affected revision's logs in Logs Explorer reveal a misconfigured database connection pool size.

---

### 💡 Additional Deployment Objectives & Learning Guidelines
*   While Cloud Deploy handles the infrastructure rollout, study how to manage database schema migrations concurrently with application rollouts without causing downtime. A common Google Cloud–native pattern is to add a pre-deploy step in the Cloud Build pipeline that runs a containerized migration script as a Cloud Run Job against Cloud SQL before the new application revision is promoted — ensuring the schema is updated in a backwards-compatible way before any traffic is cut over. For Cloud Spanner, use the Spanner Schema Update API which applies DDL changes without locking the table, enabling zero-downtime migrations on globally distributed databases.

---

## 6.4 Assisting with the support of deployed solutions

**Concept:** Using GCP observability tooling to triage and resolve incidents efficiently — correlating logs, metrics, and traces to identify root causes, querying structured log data for incident post-mortems, and escalating to Google Cloud Support when needed.

**In the RAD UI:**
The RAD platform configures a full observability stack that supports incident investigation:
*   **Structured logging:** App CloudRun and App GKE emit application logs to Cloud Logging automatically. Container stdout/stderr is captured and indexed without any agent configuration.
*   **Error Reporting:** Application errors (stack traces, unhandled exceptions) are automatically surfaced in **Error Reporting** for Cloud Run and GKE workloads, grouped by error signature, and linked to the relevant log entries.
*   **Cloud SQL Insights:** When Cloud SQL is provisioned by GCP Services, Query Insights is available to identify slow queries and high-CPU query patterns — a critical support tool when database performance degrades under load.
*   **Alert notification channels:** `notification_alert_emails` (Group 17 in GCP Services) and `support_users` (Group 1, all modules) configure the notification channels that fire when alert policies breach their thresholds — ensuring the correct on-call contacts receive incident notifications.

**Console Exploration:**
*   Navigate to **Logging > Logs Explorer** and query for `severity=ERROR` in the Cloud Run or GKE resource. Practice adding filters for `resource.labels.service_name` or `resource.labels.namespace_name` to scope results to a specific service. Use the **Summary fields** pane to group errors by log field values.
*   Navigate to **Error Reporting** and review error groups for the deployed application. Click an error group to see the stack trace, the impacted version, the first-seen and last-seen timestamps, and a link to the associated log entries.
*   Navigate to **Cloud SQL > Instances**, select your instance, and click **Query Insights**. Review the top queries by execution time and CPU load — this surface is the first place to investigate when a support ticket describes slow application response times linked to database latency.

**Real-world example:** At 03:12 UTC, a PagerDuty alert fires: Cloud Run `5xx` error rate has exceeded 1% for 5 minutes. The on-call engineer opens **Error Reporting** and immediately sees a new error group: `connection pool exhausted — max 100 connections reached`. They open **Logs Explorer**, filter by `resource.labels.revision_name` to the current revision, and find log lines confirming database connections are being refused. They navigate to **Cloud SQL > Query Insights** and see that a newly deployed background job is holding long-running transactions open, exhausting the connection pool. The fix — reducing the job's connection pool size — is deployed via Cloud Build in 12 minutes. Total incident duration: 17 minutes.

---

### 💡 Additional Support Objectives & Learning Guidelines
*   Understand Google Cloud Support plans (Standard, Enhanced, Premium) and how to interact with Google Cloud Customer Care or Technical Account Managers (TAMs) during Sev-1 incidents. Premium support provides a TAM for proactive guidance and a 15-minute initial response SLA for P1 cases, which is a key architectural consideration for mission-critical production workloads.

---

## 6.5 Evaluating quality control measures

**Concept:** Implementing automated quality gates in CI/CD pipelines that enforce code correctness, security posture, and compliance requirements — ensuring that only verified, policy-compliant artifacts can be promoted to production.

**In the RAD UI:**
*   **Vulnerability scanning gate:** When `enable_cicd` is active, the Cloud Build pipeline uses Kaniko to build images and push them to Artifact Registry. Artifact Analysis automatically scans every pushed image for CVEs. The pipeline can be configured to call `gcloud artifacts docker images scan` and fail the build (`exit 1`) if any CRITICAL vulnerabilities are detected — blocking promotion before a vulnerable image reaches any environment.
*   **Binary Authorization:** When `enable_binary_authorization` is configured, Cloud Build generates a cryptographic attestation for each image after it passes the vulnerability gate. Binary Authorization enforces at deploy time that only attested images can be deployed to Cloud Run or GKE — images pushed manually or from unauthorised pipelines are rejected.
*   **Policy Controller (GKE):** When `configure_policy_controller` is enabled (Group 7 in GCP Services), GKE Autopilot enforces OPA Gatekeeper admission policies. Quality control rules such as "all containers must have resource limits set" or "no container may use the `latest` image tag" are enforced at admission — non-compliant workloads are rejected before scheduling.

**Console Exploration:**
*   Navigate to **Artifact Registry > Repositories**, select an image, and click the **Vulnerabilities** tab. Review the CVE list, severity distribution, and the fix-available indicator for each finding. Note the digest and tag of the image — this is the artifact that a quality gate would evaluate.
*   Navigate to **Security > Binary Authorization**. View the attestation policy and the required attestors. Confirm that the Cloud Build attestor is listed — this enforces that only pipeline-built images reach production.
*   Navigate to **Security > Security Command Center > Findings** and filter by source **Security Health Analytics**. Review findings such as `PUBLIC_BUCKET_ACL`, `OVER_PRIVILEGED_SERVICE_ACCOUNT_USER`, or `CLUSTER_MASTER_AUTHORIZED_NETWORKS_DISABLED` — these are the automated quality control checks that SCC runs continuously against your deployed infrastructure.

**Real-world example:** A SaaS company's Cloud Build pipeline runs in four steps: (1) unit tests; (2) Kaniko image build; (3) vulnerability scan — the build fails if any CRITICAL CVE is found; (4) binary attestation — signing the image only if step 3 passed. Binary Authorization is configured on the production Cloud Run service to require this attestation. When a developer attempts to deploy an unscanned image directly via `gcloud run deploy`, the deployment is rejected at the Binary Authorization policy check — even though the developer has `roles/run.developer` IAM permission. The quality gate is enforced by the platform, not by developer discipline.

---

### 💡 Additional Quality Control Objectives & Learning Guidelines
*   Study how to implement code reviews and integrate static application security testing (SAST) into Cloud Build pipelines. Google Cloud–native options include Artifact Registry's built-in container vulnerability scanning (powered by Container Analysis), Security Command Center's Web Security Scanner for detecting XSS and mixed-content issues in deployed web applications, and Cloud Build steps that invoke the gcloud CLI to audit IAM policies or validate Terraform plans before applying them. Cloud Source Repositories also integrates with Cloud Build triggers for automated policy-as-code gate checks on every push.

---

## 6.6 Ensuring the reliability of solutions in production
### 💡 Additional Reliability Objectives & Learning Guidelines
*   **Chaos Engineering:** Understand the concept of intentionally injecting faults (e.g., terminating random pods or blocking network ports) to verify that the high-availability architecture functions as designed.
*   **Penetration Testing:** Review Google Cloud's acceptable use policy regarding penetration testing.
*   **Load Testing:** Practice generating synthetic load to validate autoscaling boundaries configured in Cloud Run and GKE. Google Cloud's Distributed Load Testing reference architecture deploys load-generation agents as Cloud Run Jobs or GKE pods that scale horizontally, enabling thousands of concurrent simulated users without managing load-generator infrastructure. Use Cloud Monitoring dashboards to observe how Cloud Run instance count and GKE HPA scale in response, and confirm that alerting policies trigger appropriately when latency thresholds are breached.
