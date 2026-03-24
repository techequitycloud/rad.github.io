# Professional Cloud DevOps Engineer Certification Preparation Guide: Exploring Section 3 (Applying site reliability engineering practices)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification. It focuses specifically on Section 3 of the exam guide (which covers ~18% of the exam) by walking you through how these concepts are practically implemented in the provided Terraform codebases (`modules/App_CloudRun` and `modules/App_GKE`). By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical DevOps and SRE topics.

---

## 3.1 Balancing change, velocity, and reliability of the service
**Concept:** Defining and measuring Service Level Indicators (SLIs), establishing Service Level Objectives (SLOs) and Service Level Agreements (SLAs), and utilizing error budgets to balance risk and velocity.
*   **Implementation Context:** Review `monitoring.tf` in the `App_CloudRun` and `App_GKE` modules. These modules configure monitoring via the shared `app_monitoring` module. By tracking specific metrics like `run.googleapis.com/container/cpu/utilizations` (for Cloud Run) or `kubernetes.io/container/cpu/limit_utilization` (for GKE), you capture the fundamental telemetry needed for SLIs. Custom alert policies are configured based on these thresholds (e.g., `cpu_threshold = 0.9`), which helps operationalize your SLOs and error budgets.
*   **Exploration:** Navigate to **Monitoring > Dashboards** in the GCP Console to view telemetry data. Explore **Monitoring > SLOs** to see how availability and latency SLIs are defined and how error budgets are tracked over a rolling window.

## 3.2 Managing service lifecycle
**Concept:** Planning capacity, managing autoscaling, and overseeing the lifecycle of services from deployment to retirement.
*   **Implementation Context (Cloud Run):** Review `variables.tf` and `service.tf`. The variables `min_instance_count` and `max_instance_count` explicitly control capacity. Setting `min_instance_count = 0` enables scale-to-zero (saving costs), while `max_instance_count` acts as a safeguard against runaway scaling and associated costs.
*   **Implementation Context (GKE):** In the `App_GKE` module, resource requests and limits are explicitly defined in `deployment.tf` or `statefulset.tf` via the `container_resources` variable. This establishes the baseline for capacity planning and allows the Horizontal Pod Autoscaler (HPA) to scale pods based on actual utilization.
*   **Exploration:** In the GCP Console, navigate to **Cloud Run**, select your service, and view the **Revisions** tab to inspect scaling limits. For GKE, go to **Kubernetes Engine > Workloads**, select your deployment, and review the **Autoscaling** and **Resource Requests** details.

## 3.3 Mitigating incident impact on users
**Concept:** Reducing the impact of incidents through strategies such as traffic draining/redirecting, adding capacity, and rolling back to previous known-good states.
*   **Implementation Context:** In `App_CloudRun/service.tf`, the `traffic` block supports traffic splitting and canary deployments, allowing operators to gradually shift traffic to new revisions or instantly redirect (drain) traffic away from a problematic revision. 
*   **Exploration:** Navigate to **Cloud Run** in the GCP console, select a service, and explore the **Revisions** tab to see how traffic is distributed or redirected between revisions. Navigate to **Cloud Deploy > Delivery pipelines**, select your pipeline, and inspect a specific rollout to observe the **Rollback** functionality in action.
