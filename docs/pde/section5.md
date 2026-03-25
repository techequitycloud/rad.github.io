# Optimizing performance and cost
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section5.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section5.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pde_section5.pdf)

## Section 5: Optimizing performance and cost (~12% of the exam)

### 5.1 Collecting performance information in Google Cloud
**Concept:** Understanding application performance capabilities and collecting execution metrics to identify bottlenecks.

**Implementation Context:**
*   **Cloud Run Execution Environment:** The `execution_environment` variable in the deployment configuration allows operators to select Gen2 for full Linux compatibility, faster network performance, and improved CPU execution, or Gen1 for cost-optimized, legacy scenarios.
*   **CPU Allocation and Throttling:** In the deployment configuration, `cpu_idle` is explicitly set to `false`. This prevents CPU throttling between requests, guaranteeing performance for background threads (e.g., PHP cache generation) and preventing latency spikes from cold-started threads.

**Exploration:**
*   **GCP Console:** Navigate to Cloud Run, select a service, and review the 'Metrics' tab to analyze CPU and Memory utilization. Check the 'Revisions' tab to view the configured Execution Environment (Gen1 vs Gen2) and CPU allocation settings.
*   **Deployment Configuration:** Review the deployment configuration to observe how `cpu_idle = false` and `execution_environment` are parameterized to guarantee workload performance.

### 5.2 Implementing FinOps practices for optimizing resource utilization and costs
**Concept:** Tuning infrastructure specifically to optimize operational expenditure without sacrificing reliability.

**Implementation Context:**
*   **Optimizing Workload Costs (Cloud Run):** Setting `min_instance_count = 0` enables scale-to-zero, ensuring that you only pay for compute resources when active traffic is being processed.
*   **Optimizing Workload Costs (GKE):** By precisely defining container resource limits (CPU and memory requests/limits) in the `App_GKE` deployment, workloads are tightly packed onto GKE nodes, maximizing resource efficiency and controlling cluster costs.

**Exploration:**
*   **GCP Console:** In Cloud Run, inspect the 'Revisions' tab to verify the `min_instance_count` autoscaling parameter, confirming scale-to-zero capability. In GKE, inspect a deployed workload and review the Pod specification to see the explicitly defined CPU and memory requests and limits.
*   **Deployment Configuration:** Review the deployment configuration  to understand how `min_instance_count` and container resource limits are codified as reusable FinOps constraints.
