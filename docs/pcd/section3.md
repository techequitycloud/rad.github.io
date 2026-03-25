# Configuring cloud-native applications for deployment
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section3.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section3.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section3.pdf)

## Section 3: Deploying applications (~20% of the exam)

### 3.1 Deploying applications to Cloud Run
**Concept**
Deploying applications to serverless platforms like Cloud Run involves defining concurrency, environment variables, and invocation triggers.

**Implementation Context**
The application deployment manages the complete lifecycle of the service using `deploy_application` and injects runtime configuration via `environment_variables`.

**Exploration**
, `environment_variables` (App_CloudRun)
*   **Description:** Toggles the deployment of the Cloud Run service and maps key-value pairs to the container runtime.
*   **Configuration Experience:** Setting `deploy_application = true` and defining `environment_variables = { LOG_LEVEL = "info" }` deploys the container and configures its runtime behavior.
*   **GCP Console Exploration:** Navigate to **Cloud Run > Services**. Click on the service, then the **Variables & Secrets** tab to verify the injected configuration.
*   **Additional Customization:** Change an environment variable value in the deployment portal, apply the changes, and observe Cloud Run automatically creating a new immutable revision and migrating traffic.

### 3.2 Deploying containers to GKE
**Concept**
Deploying to Kubernetes (GKE) requires defining resource requirements, configuring health checks, and setting up the Horizontal Pod Autoscaler for cost optimization.

**Implementation Context**
The application deployment configures deployment manifests natively. container resource limits defines CPU/Memory, `health_check_config` manages probes, and `min_instance_count`/`max_instance_count` control the HPA.

**Exploration**
*   **Variable:** container resource limits, `health_check_config`, `min_instance_count` (App_GKE)
*   **Description:** Defines resource requests/limits, liveness/readiness probe parameters, and autoscaling boundaries.
*   **Configuration Experience:** Allocating strict container resource limits and configuring the `health_check_config` ensures Kubernetes can restart unresponsive applications and scale them efficiently.
*   **GCP Console Exploration:** Navigate to **Kubernetes Engine > Workloads**. Click the workload to view its YAML configuration, verifying the resource limits and probe endpoints.
*   **Additional Customization:** Artificially lower the container resource limits memory limit via the deployment portal to induce an OOMKilled state, then observe the 'Events' tab in the GKE console to diagnose the failure.
