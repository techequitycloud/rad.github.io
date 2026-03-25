# Ensuring successful operation of a cloud solution
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section3.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section3.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/ace_section3.pdf)

This guide is designed to help candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification. It focuses specifically on Section 3 of the exam guide by walking you through how these concepts are practically implemented using the platform deployment portal. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 3.1 Managing compute resources

### Deploying new versions of an application
**Concept:** Automating the delivery pipeline to reliably push new container images to production.
*   **CI/CD Pipelines:** Both deployments (`App_CloudRun` and `App_GKE`) include built-in CI/CD pipelines. Review the configuration options in the deployment portal to see how Cloud Build is configured to react to GitHub commits, building the container using Kaniko and pushing it to Artifact Registry. Review the configuration options in the deployment portal to see how Google Cloud Deploy (Cloud Deploy pipelines and `google_clouddeploy_target`) is configured to take that image and roll it out progressively across defined environments (e.g., dev, staging, prod).
*   **Exploration:** In the GCP Console, navigate to **Cloud Build > Triggers** to see the configured integration with source control. Then, navigate to **Cloud Deploy > Delivery pipelines** to visualize the progression of a release and understand how approvals or automated promotions move the application through its environments to either Cloud Run services or GKE clusters.

### Adjusting application traffic splitting parameters
**Concept:** Safely routing user traffic between different versions of an application to minimize deployment risk.
*   **Traffic Allocation (Cloud Run):** The application deployment exposes `traffic_split` variables and implements them within the Cloud Run service configuration in the deployment configuration. This allows practitioners to implement canary deployments (e.g., routing 5% of traffic to a new revision for testing).
*   **Canary Deployments (GKE):** While Cloud Run manages traffic natively at the revision level, GKE manages progressive rollouts using tools like Google Cloud Deploy or the Gateway API natively to perform canary analysis across replica sets.
*   **Exploration:** Navigate to **Cloud Run** in the GCP Console, select the deployed service, and click on the **Revisions** tab. Observe the "Traffic" column to see traffic weighting. For GKE, navigate to **Cloud Deploy > Delivery pipelines** and review the "Rollout" details to observe multi-stage deployments.

### Configuring autoscaling for an application
**Concept:** Tuning concurrency and instance counts to handle load efficiently while controlling costs.
*   **Scaling Limits (Cloud Run):** Review the configuration options in the deployment portal to see how `min_instance_count` and `max_instance_count` are applied to the Cloud Run service. Setting `min_instance_count` > 0 eliminates cold starts, while `max_instance_count` caps costs.
*   **Horizontal Pod Autoscaler (HPA in GKE):** Review the `App_GKE` deployment's the deployment configuration or the deployment configuration configurations to see how resource requests and limits are defined. The deployment also configures Pod Disruption Budgets in the deployment configuration to ensure a minimum number of pods remain available during voluntary disruptions (like node upgrades) to maintain high availability while autoscaling.
*   **Exploration:** Still in the **Revisions** tab of your Cloud Run service in the Console, inspect the autoscaling and concurrency settings. For GKE, navigate to **Kubernetes Engine > Workloads**, select the deployment, and view the **Autoscaling** tab to see current CPU/Memory targets driving the HPA.

---

## 3.4 Monitoring and logging

### Creating Cloud Monitoring alerts based on resource metrics
**Concept:** Proactively identifying and reacting to system degradation before users report issues.
*   **Threshold-Based Alerts:** Review the configuration options in the deployment portal. The platform automatically provision custom uptime checks (Uptime check configurations) to verify the application is responsive. They create threshold-based alert policies (Alert policies) tailored to the platform. Cloud Run alerts on high latency (p95), CPU starvation, and 5xx errors. GKE alerts on pod restart loops (CrashLoopBackOff), unschedulable pods, CPU/memory usage per container, and high latency from the Gateway.
*   **Exploration:** Navigate to **Monitoring > Alerting** in the GCP Console. Review the generated alert policies. Click into a policy to view the specific Monitoring Query Language (MQL) or metric thresholds driving the condition. Next, go to **Monitoring > Uptime checks** to see the synthetic monitoring. Finally, check **Monitoring > Dashboards** to view the custom operational dashboards provisioned by the deployment configuration for holistic visibility of either serverless or cluster metrics.
