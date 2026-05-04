# Professional Cloud DevOps Engineer (PDE) Certification Exploration Guide

This document maps the features and configurations of the deployed Cloud Run and GKE applications to the Professional Cloud DevOps Engineer (PDE) certification exam domains. It serves as an exploration guide for candidates to understand how DevOps and SRE concepts are practically implemented in Google Cloud. You can experiment with these configurations directly through your web-based deployment portal.

---

## Section 1: Bootstrapping and maintaining a Google Cloud organization (~20% of the exam)

### 1.2 Managing infrastructure
*   **Concept:** Utilizing infrastructure-as-code (IaC) to manage environments efficiently and repeatedly.
*   **Implementation Context:**
    *   **Infrastructure as Code:** Modern environments are often fully defined using automated IaC tools (like Terraform). This enables operators to provision full-stack architectures repetitively and reliably, applying Google-recommended practices for modular deployments.

### 1.3 Designing a CI/CD architecture stack
*   **Concept:** Designing robust pipelines for continuous integration and delivery.
*   **Implementation Context:**
    *   **Continuous Integration (CI):** Pipelines react to source code changes, build container images, and push them securely to Artifact Registry.
    *   **Continuous Delivery (CD):** Managed services like Google Cloud Deploy integrate with tools like Skaffold to manage progressive rollouts and delivery pipelines across multiple environments (e.g., staging to production).

### 1.4 Managing multiple environments
*   **Concept:** Securely separating and managing different stages of the application lifecycle.
*   **Implementation Context:**
    *   **Environment Parity:** By parameterizing configurations (like regions, scaling limits, and application settings), operators can deploy identical infrastructure architectures across different environments while tuning the parameters specific to the stage (e.g., lower scaling limits in dev vs. prod).

---

## Section 2: Building and implementing CI/CD pipelines (~25% of the exam)

### 2.1 Designing pipelines
*   **Concept:** Establishing end-to-end artifact management and deployment flows.
*   **Implementation Context:** The Terraform modules, configurable via the deployment portal, provision CI pipelines that interface directly with **Artifact Registry**, storing immutable container images securely before deployment. Cloud Build triggers define a pipeline that automatically builds the container image and pushes it to Artifact Registry upon changes to a connected repository. The target application image is controlled by the `container_image` variable.
*   **Exploration:**
    *   Navigate to the **Cloud Build > Triggers** section in the GCP Console. If deployed, inspect the trigger configuration. See how the trigger links to the source repository.
    *   Navigate to the **Artifact Registry > Repositories** section. Locate the repository created for the application.
*   **Customization:** In the deployment portal, modify the `container_image` variable for your application module to point to a different image or tag. Apply the changes, and then click into the Artifact Registry repository in the GCP console to view the stored container images and their tags. Understand how image tags (like `latest` or specific commit SHAs) can be used to reference different versions of an application.

### 2.2 Implementing and managing pipelines
*   **Concept:** Applying safe deployment strategies.
*   **Implementation Context:** The deployment logic within the Terraform modules supports safe and progressive deployments. For Cloud Run, services can implement canary deployments by splitting traffic between multiple revisions safely. Delivery pipelines can also manage rollouts across environments (e.g., dev to staging to prod). Traffic distribution is controlled using the `traffic_split` variable exposed in the portal.
*   **Exploration:**
    *   Navigate to **Cloud Run > Services**. Select a deployed service and navigate to the **Revisions** tab.
*   **Customization:** In the deployment portal, configure the `traffic_split` variable for the module to allocate traffic between different revisions (e.g., 90% to the stable revision, 10% to the new revision) to simulate a canary deployment. Apply the changes and observe the updated traffic distribution on the **Revisions** tab in the GCP console.

### 2.3 Managing pipeline configuration and secrets
*   **Concept:** Securely injecting sensitive data into applications and pipelines.
*   **Implementation Context:** Environments provisioned by the Terraform modules integrate tightly with **Secret Manager**. Crucially, systems do not expose plaintext secrets; instead, they map Secret Manager references directly to environment variables, demonstrating secure runtime secret injection. This is configured via the `secret_environment_variables` variable. Automated secret rotation is also implemented via Cloud Run Jobs or Kubernetes CronJobs and can be toggled using `enable_auto_password_rotation`.
*   **Exploration:**
    *   Navigate to **Secret Manager**. Locate the secrets created for the application (e.g., database passwords, GitHub tokens).
    *   Navigate to **Cloud Run > Services**. Select the deployed service and view the **Variables & Secrets** tab. Observe that the secrets mapped via the portal are referenced, not exposed.
    *   Navigate to **Cloud Run > Jobs** (or Kubernetes CronJobs in GKE). Find the jobs responsible for automated secret rotation (e.g., database password rotation). Review their configuration and execution history to understand how automated rotation is maintained.
*   **Customization:** In the deployment portal, configure the `secret_environment_variables` variable to map existing Secret Manager secrets to environment variables in your application container. Also, verify that `enable_auto_password_rotation` is enabled.

---

## Section 3: Applying site reliability engineering practices (~18% of the exam)

### 3.2 Managing service lifecycle
*   **Concept:** Implementing automatic capacity management to handle varying load gracefully.
*   **Implementation Context:**
    *   **Autoscaling (Cloud Run):** Cloud Run manages concurrency and scaling limits. Setting a minimum instance count greater than zero prevents cold starts, while the maximum instance count provides a safety ceiling against unexpected spikes or runaway costs.
    *   **Autoscaling (GKE):** GKE environments configure resource requests and limits, laying the groundwork for the Horizontal Pod Autoscaler (HPA) to scale pods dynamically based on CPU or memory utilization.

---

## Section 4: Implementing observability practices and troubleshooting issues (~25% of the exam)

### 4.1 Instrumenting and collecting telemetry
*   **Concept:** Proactively probing systems to detect failures before users do.
*   **Implementation Context:**
    *   **Synthetic Monitors:** Monitoring systems automatically provision custom uptime checks that continuously probe application endpoints to verify availability and responsiveness from multiple global regions.

### 4.3 Managing metrics, dashboards, and alerts
*   **Concept:** Visualizing health and alerting operators when Service Level Indicators (SLIs) are at risk.
*   **Implementation Context:**
    *   **Managing Dashboards:** Operational dashboards aggregate metrics specific to Cloud Run or GKE, giving operators immediate visibility into system health.
    *   **Configuring Alerting Policies:** Threshold-based alerts are tailored to the compute platform. For Cloud Run, alerts can trigger on high latency (p95), CPU starvation, or elevated 5xx error rates. For GKE, alerts trigger on issues like pod restart loops (CrashLoopBackOff) or unschedulable pods.

---

## Section 5: Optimizing performance and cost (~12% of the exam)

### 5.2 Implementing FinOps practices for optimizing resource utilization and costs
*   **Concept:** Tuning infrastructure specifically to optimize operational expenditure without sacrificing reliability.
*   **Implementation Context:**
    *   **Optimizing Workload Costs (Cloud Run):** Setting the minimum instance count to zero enables scale-to-zero, ensuring that you only pay for compute resources when active traffic is being processed.
    *   **Optimizing Workload Costs (GKE):** By precisely defining container resource limits (CPU and memory requests/limits), workloads are tightly packed onto GKE nodes, maximizing resource efficiency and controlling overall cluster costs.
