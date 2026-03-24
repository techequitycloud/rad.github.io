# ACE Certification Preparation Guide: Exploring Section 3 (Ensuring successful operation of a cloud solution)

This guide is designed to help candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification. It focuses specifically on Section 3 of the exam guide by walking you through how these concepts are practically implemented in the provided Terraform codebase (`modules/App_CloudRun` and `modules/App_GKE`), which rely on the shared `modules/App_GCP` module. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 3.1 Managing compute resources

### Deploying new versions of an application
**Concept:** Automating the delivery pipeline to reliably push new container images to production.
*   **CI/CD Pipelines:** Both modules (`App_CloudRun` and `App_GKE`) include built-in CI/CD pipelines. Review `trigger.tf` to see how Cloud Build is configured to react to GitHub commits, building the container using Kaniko and pushing it to Artifact Registry. Review `skaffold.tf` to see how Google Cloud Deploy (`google_clouddeploy_delivery_pipeline` and `google_clouddeploy_target`) is configured to take that image and roll it out progressively across defined environments (e.g., dev, staging, prod).
*   **Exploration:** In the GCP Console, navigate to **Cloud Build > Triggers** to see the configured integration with source control. Then, navigate to **Cloud Deploy > Delivery pipelines** to visualize the progression of a release and understand how approvals or automated promotions move the application through its environments to either Cloud Run services or GKE clusters.

### Adjusting application traffic splitting parameters
**Concept:** Safely routing user traffic between different versions of an application to minimize deployment risk.
*   **Traffic Allocation (Cloud Run):** The `App_CloudRun` module exposes `traffic_split` variables and implements them within the `google_cloud_run_v2_service` resource in `service.tf`. This allows practitioners to implement canary deployments (e.g., routing 5% of traffic to a new revision for testing).
*   **Canary Deployments (GKE):** While Cloud Run manages traffic natively at the revision level, GKE manages progressive rollouts using tools like Google Cloud Deploy or the Gateway API natively to perform canary analysis across replica sets.
*   **Exploration:** Navigate to **Cloud Run** in the GCP Console, select the deployed service, and click on the **Revisions** tab. Observe the "Traffic" column to see traffic weighting. For GKE, navigate to **Cloud Deploy > Delivery pipelines** and review the "Rollout" details to observe multi-stage deployments.

### Configuring autoscaling for an application
**Concept:** Tuning concurrency and instance counts to handle load efficiently while controlling costs.
*   **Scaling Limits (Cloud Run):** Review `variables.tf` and `service.tf` to see how `min_instance_count` and `max_instance_count` are applied to the Cloud Run service. Setting `min_instance_count` > 0 eliminates cold starts, while `max_instance_count` caps costs.
*   **Horizontal Pod Autoscaler (HPA in GKE):** Review the `App_GKE` module's `deployment.tf` or `statefulset.tf` configurations to see how resource requests and limits are defined. The module also configures `kubernetes_pod_disruption_budget_v1` in `pdb.tf` to ensure a minimum number of pods remain available during voluntary disruptions (like node upgrades) to maintain high availability while autoscaling.
*   **Exploration:** Still in the **Revisions** tab of your Cloud Run service in the Console, inspect the autoscaling and concurrency settings. For GKE, navigate to **Kubernetes Engine > Workloads**, select the deployment, and view the **Autoscaling** tab to see current CPU/Memory targets driving the HPA.

---

## 3.4 Monitoring and logging

### Creating Cloud Monitoring alerts based on resource metrics
**Concept:** Proactively identifying and reacting to system degradation before users report issues.
*   **Threshold-Based Alerts:** Review `monitoring.tf` in both modules. The modules automatically provision custom uptime checks (`google_monitoring_uptime_check_config`) to verify the application is responsive. They create threshold-based alert policies (`google_monitoring_alert_policy`) tailored to the platform. Cloud Run alerts on high latency (p95), CPU starvation, and 5xx errors. GKE alerts on pod restart loops (CrashLoopBackOff), unschedulable pods, CPU/memory usage per container, and high latency from the Gateway.
*   **Exploration:** Navigate to **Monitoring > Alerting** in the GCP Console. Review the generated alert policies. Click into a policy to view the specific Monitoring Query Language (MQL) or metric thresholds driving the condition. Next, go to **Monitoring > Uptime checks** to see the synthetic monitoring. Finally, check **Monitoring > Dashboards** to view the custom operational dashboards provisioned by `dashboard.tf` for holistic visibility of either serverless or cluster metrics.
