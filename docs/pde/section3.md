# PDE Certification Preparation Guide: Section 3 — Applying site reliability engineering practices (~18% of the exam)
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section3.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section3.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pde_section3.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification explore Section 3 of the exam. It walks you through how SRE concepts are practically implemented in the provided Terraform codebases (`modules/App_CloudRun` and `modules/App_GKE`). By exploring the GCP Console and corresponding code, you will gain hands-on context for these critical SRE topics.

Three modules are relevant to this section: **App CloudRun**, which deploys serverless containerised applications on Cloud Run; **App GKE**, which deploys containerised workloads on GKE Autopilot; and **App GCP**, which provides the shared foundational infrastructure including monitoring and alerting.

---

## 3.1 Balancing change, velocity, and reliability of the service

**Concept:** Defining and measuring Service Level Indicators (SLIs), establishing Service Level Objectives (SLOs) and Service Level Agreements (SLAs), and using error budgets to govern the trade-off between deploying new features (velocity) and maintaining system reliability.

The relationship between these SRE concepts is foundational to the PDE exam:
- **SLI (Service Level Indicator):** A quantitative measure of service behaviour. Examples: request success rate, p99 latency, availability percentage.
- **SLO (Service Level Objective):** The target value or range for an SLI, agreed internally by the engineering team. Example: "99.9% of requests to `/checkout` return HTTP 2xx within 500ms, measured over a rolling 30-day window."
- **SLA (Service Level Agreement):** A contractual commitment to customers, typically less strict than the internal SLO to provide an operational buffer. Example: "We guarantee 99.5% availability." The SLA is typically 10–20% less strict than the SLO.
- **Error Budget:** The permitted amount of unreliability derived from the SLO. If the SLO is 99.9% availability, the error budget is 0.1% — approximately 43 minutes of downtime per month. The error budget is consumed by outages, risky deployments, and chaos experiments. When the error budget is exhausted (or burn rate is too high), the team should freeze feature releases and focus on reliability work.

**In the Terraform Codebase:**
Review `monitoring.tf` in the `App CloudRun` and `App GKE` modules. These modules configure monitoring via the shared `app_monitoring` module. The metrics tracked — `run.googleapis.com/container/cpu/utilizations` (Cloud Run) and `kubernetes.io/container/cpu/limit_utilization` (GKE) — form the raw telemetry that SLIs are derived from. The threshold-based alert policies (e.g., `cpu_threshold = 0.9`) operationalise SLOs: when the threshold is breached, the error budget is being consumed.

**Console Exploration:**
*   Navigate to **Monitoring > Dashboards** to view telemetry data for Cloud Run and GKE. Observe the request count, latency percentile (p50/p95/p99), and error rate charts — these are the raw signals from which SLIs are constructed.
*   Navigate to **Monitoring > SLOs**. If an SLO has been created for the Cloud Run service, the SLO page shows: the current compliance percentage (e.g., 99.94%), the remaining error budget as a percentage and absolute time, and the error budget burn rate over the past 1 hour, 6 hours, and 24 hours.
*   To create an SLO manually: select **Monitoring > SLOs > Create SLO**. Choose the Cloud Run service as the resource, select **Request-based** as the SLI type, and configure a good-request definition (HTTP 2xx responses) and a performance goal (e.g., 99.9% over 30 days).
*   Navigate to **Monitoring > Alerting** and review the multi-burn-rate alert policies. A well-configured SLO produces two alerts: a fast burn alert (consuming error budget at 14× the sustainable rate over 1 hour — page the on-call immediately) and a slow burn alert (consuming at 6× the sustainable rate over 6 hours — create a ticket for the next business day).

> **Real-World Example:** A streaming media company defines an SLO for their video playback API: 99.95% of requests must return HTTP 2xx within 200ms, measured over a rolling 28-day window. This gives them an error budget of 0.05% — about 20 minutes of allowed errors per month. The engineering team uses the error budget as a deployment gate: when the budget is above 50% consumed, feature deployments are allowed. When it drops below 50%, only bug fixes and reliability improvements are permitted. When the budget is fully consumed, all feature work stops until the 28-day window rolls forward and the budget resets. This policy aligns development velocity with operational risk — the team does not need management approval for each release; the error budget provides an objective, automated governance mechanism.

---

## 3.2 Managing service lifecycle

**Concept:** Planning capacity, managing autoscaling to match demand, and overseeing the complete service lifecycle from initial deployment through graceful retirement.

**In the Terraform Codebase:**

*   **Cloud Run capacity management:** Review `variables.tf` and `service.tf` in the `App CloudRun` module. The `min_instance_count` and `max_instance_count` variables control the scaling floor and ceiling. `min_instance_count = 0` enables scale-to-zero (lowest cost, tolerates cold start latency). `min_instance_count >= 1` keeps instances always warm (eliminates cold starts, higher baseline cost). `max_instance_count` prevents runaway scaling and cost surprises under unexpected load.

*   **GKE capacity management:** In the `App GKE` module, resource requests and limits are defined in `deployment.tf` or `statefulset.tf` via the `container_resources` variable. These values establish the capacity contract with GKE Autopilot — the cluster provisions underlying node capacity to satisfy the aggregate requests of all scheduled pods.

    Autoscaling in GKE has two distinct dimensions:
    - **Horizontal Pod Autoscaler (HPA):** Scales the *number of pod replicas* based on observed CPU or memory utilisation relative to the defined requests. Configured via `min_instance_count` and `max_instance_count`. If 10 pods are running at 80% CPU and the HPA target is 70%, HPA adds more pods to distribute the load.
    - **Vertical Pod Autoscaler (VPA):** Adjusts the *CPU and memory resource requests* of each pod based on observed historical usage. VPA does not change the number of replicas — it right-sizes what each pod is allocated. When the `enable_vertical_pod_autoscaling` variable is set, VPA analyses pod resource consumption and updates the requests over time, preventing over-provisioning (wasted cost) and under-provisioning (pod eviction under memory pressure). VPA and HPA address different scaling dimensions and can be used together.

*   **Backup Scheduling as RPO/RTO Planning (App GKE Group 11, App CloudRun Group 12):** The `backup_schedule` and `backup_retention_days` variables directly encode two SRE disaster recovery metrics. The **Recovery Point Objective (RPO)** — the maximum acceptable data loss — is determined by `backup_schedule`: a daily cron (`"0 2 * * *"`) means up to 24 hours of data could be lost; an hourly schedule reduces that to 1 hour. The **Recovery Time Objective (RTO)** is influenced by `backup_retention_days` — a longer retention window provides more restore points to choose from, reducing the time spent searching for a clean backup. Production workloads under compliance frameworks (PCI-DSS, HIPAA) should use `backup_retention_days` values of 30–90 days; development environments typically use 7 days. Set `backup_schedule` based on your RPO requirement before go-live, as changing it after a data loss event is too late.

**Console Exploration:**
*   Navigate to **Cloud Run**, select your service, and view the **Revisions** tab to inspect the configured `min_instance_count` and `max_instance_count` scaling limits. View the **Metrics** tab and observe the `Instance count` chart — watch how instances scale up under load and scale down (or to zero) when traffic drops.
*   Navigate to **Kubernetes Engine > Workloads**, select your deployment, and review the **Autoscaling** section under the **Details** tab to see the HPA configuration (min replicas, max replicas, current CPU target). Click into a pod and view its YAML to see `resources.requests` and `resources.limits` — the values that VPA may adjust over time if VPA is enabled.
*   Navigate to **Kubernetes Engine > Workloads > Observability** and view the CPU and memory usage charts for the deployment over time. Compare actual usage against the configured requests — significant headroom indicates the requests are over-provisioned and could be right-sized.

> **Real-World Example:** An e-commerce company's GKE-deployed order service starts with manually tuned resource requests of 500m CPU and 512Mi memory per pod, based on estimates. After one week in production, the VPA recommends 200m CPU and 384Mi memory based on observed P95 usage. The team applies the VPA recommendation — reducing per-pod cost by 30% and allowing the same GKE Autopilot cluster to schedule 40% more pods for the same cost. Simultaneously, the HPA is configured to maintain 60% average CPU utilisation — during Black Friday, it scales from 5 to 35 pods in under 2 minutes as traffic surges 7×, with zero manual intervention and no degradation in response time.

---

## 3.3 Mitigating incident impact on users

**Concept:** Reducing the blast radius and duration of incidents through traffic draining, traffic redirection, capacity injection, and rapid rollback to previous known-good states.

**In the Terraform Codebase:**
In `App_CloudRun/service.tf`, the `traffic` block supports traffic splitting and canary deployments, allowing operators to redirect traffic away from a problematic revision instantly. Cloud Deploy retains the prior release for fast rollback. Cloud Run keeps all previous revisions available — any named revision can receive traffic at any time without rebuilding.

The App GKE module provides two additional GKE-specific mechanisms for maintaining availability during disruptions:

*   **PodDisruptionBudget (App GKE Group 14 — `enable_pod_disruption_budget`, `pdb_min_available`):** A PDB is a Kubernetes policy that limits how many pods can be voluntarily taken offline simultaneously during cluster maintenance events — node drains, GKE version upgrades, or node pool migrations. Without a PDB, Kubernetes may evict all pods of a Deployment at once during a node drain, causing a complete outage. With `enable_pod_disruption_budget = true` and `pdb_min_available = "1"`, at least one pod is guaranteed to remain available throughout any maintenance window. For higher-traffic workloads, using a percentage (e.g., `"75%"`) maintains throughput during disruptions. This is one of the most commonly tested GKE reliability topics on the PDE exam.

*   **Topology Spread Constraints (App GKE Group 14 — `enable_topology_spread`, `topology_spread_strict`):** Topology spread constraints instruct the Kubernetes scheduler to distribute pod replicas evenly across nodes and availability zones. Without spreading, all replicas may land in the same zone — a single zone failure then takes down the entire service. With `enable_topology_spread = true`, replicas are spread across zones so that a zone failure takes down only a fraction of capacity. The `topology_spread_strict` flag controls enforcement: `false` (default — `ScheduleAnyway`) schedules pods even if the ideal spread cannot be achieved, keeping the application running; `true` (`DoNotSchedule`) holds pods in `Pending` until perfect distribution is possible, which can block scheduling in under-capacity clusters.

**Console Exploration:**
*   Navigate to **Cloud Run** in the GCP Console, select a service, and explore the **Revisions** tab. Observe the **Manage traffic** button — click it to see how traffic can be redistributed between any combination of existing revisions by adjusting percentage sliders. This can be done in under 30 seconds without a redeployment.
*   Navigate to **Cloud Deploy > Delivery pipelines**, select your pipeline, and inspect a specific rollout. Observe the **Rollback** button — clicking it immediately creates a new rollout targeting the prior release's image digest, without requiring a new Cloud Build execution.
*   For GKE, navigate to **Kubernetes Engine > Workloads** and select a deployment. From the **Actions** menu, select **Rolling update** — this triggers a Kubernetes rolling update that replaces pods incrementally, keeping a configurable percentage of pods available throughout the update. If the new version shows errors, `kubectl rollout undo deployment/<name>` immediately reverts to the previous ReplicaSet.
*   Navigate to **Kubernetes Engine > Config & Storage** in the GCP Console and look for `PodDisruptionBudget` objects in the application namespace. Use `kubectl describe pdb APPLICATION_NAME -n NAMESPACE` to see the current number of allowed disruptions. To verify topology spread, run `kubectl get pods -n NAMESPACE -o wide` and confirm pods are distributed across different nodes and zones in the `NODE` column.

> **Real-World Example:** At 14:37 on a Tuesday, a newly deployed Cloud Run revision of a payment service begins returning HTTP 500 errors for 3% of requests — an error budget burn rate of 60× the sustainable rate, triggering the fast-burn SLO alert. The on-call engineer receives a PagerDuty notification within 2 minutes of the error spike. They navigate to **Cloud Run > Revisions**, click **Manage traffic**, and shift 100% of traffic back to the previous revision in 20 seconds — the error rate drops immediately to zero. Total user impact: 7 minutes of elevated error rate. The engineer then investigates the failed revision's logs in **Logs Explorer** to identify the root cause (a missing database index on a new query) before re-deploying with the fix. The post-incident review documents the timeline, the detection method (SLO multi-burn-rate alert), and the remediation steps — feeding improvements back into the runbook.

### 💡 Additional SRE Practice Objectives & Learning Guidelines

*   **Toil Reduction:** SRE practice emphasises eliminating *toil* — repetitive, manual, automatable operational work that does not provide lasting value. For a DevOps engineer managing Cloud Run or GKE, common sources of toil include: manual deployment approvals for non-production environments, manually updating image tags in deployment manifests, and manually responding to predictable scaling events. For each toil item you identify, evaluate whether a Cloud Deploy automation rule, a Cloud Scheduler job, or an autoscaler can eliminate the manual step entirely.

*   **Chaos Engineering:** Controlled fault injection is a practice for proactively discovering reliability weaknesses before they cause production incidents. Google Cloud supports this through: (1) **Cloud Run traffic splitting** — deliberately sending a percentage of traffic to a slow or erroring revision to measure system behaviour; (2) **Fault injection with Cloud Service Mesh** — for GKE workloads that have `configure_service_mesh = true` set (App GKE Group 5), Cloud Service Mesh (Anthos Service Mesh / Istio) is automatically provisioned with sidecar injection enabled. This allows you to inject HTTP faults (artificial delays or abort codes such as HTTP 503) into specific traffic paths using Istio `VirtualService` fault injection rules — verifying that downstream services degrade gracefully without requiring any application code changes. Navigate to **Cloud Service Mesh > Traffic management** to explore fault injection policy configuration, and confirm mesh enablement by running `kubectl get pods -n NAMESPACE` and verifying each pod shows `2/2` containers (application + `istio-proxy` sidecar).

*   **Incident Post-Mortems (Blameless):** The SRE discipline of blameless post-mortems is a key exam topic. After every significant incident, document: (1) the timeline of events from symptom detection to resolution; (2) contributing factors (not root causes — complex systems have multiple contributing factors, not a single root cause); (3) action items with owners and deadlines. The goal is systemic improvement, not individual blame. Google's SRE Workbook provides a post-mortem template; navigate to **Cloud Logging > Log Analytics** to run SQL queries over historical log data as part of a post-mortem investigation.

*   **Release Velocity and Error Budget Policy:** Formalise the relationship between error budget consumption and deployment frequency. An error budget policy document (owned by the SRE and development teams jointly) should specify: what deployment gate applies at 0–50% budget consumption (normal velocity), 50–100% (slow down, only critical features), and 100%+ (freeze all feature deployments, prioritise reliability). This policy transforms reliability from a subjective judgment into an objective, data-driven team agreement.
