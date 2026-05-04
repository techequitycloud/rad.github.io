# Professional Cloud Architect (PCA) Certification Exploration Guide

This document maps the features and configurations of the deployed Cloud Run and GKE applications to the Professional Cloud Architect (PCA) certification exam domains. It serves as an exploration guide for candidates to understand how cloud architecture concepts are practically implemented in Google Cloud. You can experiment with these configurations directly through your web-based deployment portal.

---

## Section 1: Designing and planning a cloud solution architecture (~25% of the exam)

### 1.1 Designing a cloud solution infrastructure that meets business requirements

**Security and compliance**
*   **Concept:** Applying zero-trust remote access, edge security, and secure credential handling.
*   **Implementation Context:**
    *   Set `enable_iap = true` (Group 10) to deploy Identity-Aware Proxy.
    *   Set `enable_cloud_armor = true` (Group 11) for OWASP Top 10 protection.
    *   Configure `enable_auto_password_rotation` (Group 13).
*   **Exploration:**
    *   In the GCP Console, navigate to **Security > Identity-Aware Proxy** and verify access policies instead of checking open firewalls.
    *   Go to **Network Security > Cloud Armor** and review the WAF rules applied to the backend service.
    *   Navigate to **Security > Secret Manager** to check the rotation schedules of the provisioned database credentials.
*   **Customization:** Try modifying the Cloud Armor rules in `security.tf` to block a specific IP address block and attempt to access the application to see the 403 response.

**Cost optimization**
*   **Concept:** Minimizing operational expenses (OpEx) during idle times while scaling to demand.
*   **Implementation Context:** In `App_CloudRun`, adjust `min_instance_count = 0` and `max_instance_count` (Group 2).
*   **Exploration:** Go to **Cloud Run**, select the deployed service, and monitor the **Metrics** tab during idle periods and load spikes to see instances drop to zero.
*   **Customization:** Deploy two instances of the application: one with `min_instance_count = 1` and another with `0`. Use the GCP Pricing Calculator to compare estimated monthly costs.

**Observability**
*   **Concept:** Establishing automated alerting and dashboarding for operational health.
*   **Implementation Context:** Populate `support_users` (Group 1) with email addresses.
*   **Exploration:** Navigate to **Monitoring > Dashboards** to explore custom metrics (Request Count, Latency). Check **Monitoring > Alerting** for automatically configured HTTP 5xx error policies.
*   **Customization:** Introduce an artificial error in the application (if possible) and observe the alert triggering in the Console and arriving via email.

### 1.2 Designing a cloud solution infrastructure that meets technical requirements

**High availability and fail-over design**
*   **Concept:** Building resilient frontend architectures using global load balancing.
*   **Implementation Context:** Set `custom_domains` (Group 11) to provision a Global External Application Load Balancer.
*   **Exploration:** Navigate to **Network Services > Load balancing**. Inspect the Frontend and Backend service configurations (Serverless NEGs for Cloud Run or Gateways for GKE).
*   **Customization:** Add multiple regions to a Cloud Run deployment and attach them to the same backend service to observe global traffic routing.

**Scalability to meet growth requirements**
*   **Concept:** Handling demand seamlessly through autoscaling mechanisms.
*   **Implementation Context:** For `App_GKE`, configure `container_resources` (Group 2) with proper resource limits/requests.
*   **Exploration:** In GKE, navigate to **Kubernetes Engine > Workloads** and review the Horizontal Pod Autoscaler (HPA) metrics. For Cloud Run, review concurrency settings.
*   **Customization:** Use a load testing tool (like Apache Bench or hey) to generate traffic and watch the GKE pods or Cloud Run instances scale out in real-time on the monitoring dashboards.

**Backup and recovery**
*   **Concept:** Meeting Recovery Point Objective (RPO) and Recovery Time Objective (RTO) targets.
*   **Implementation Context:** Configure `backup_uri` (Group 14) to trigger automated database exports.
*   **Exploration:** Navigate to **Cloud Scheduler** to see the cron job configuration and **Cloud Run > Jobs** (or GKE CronJobs) to view the execution history.
*   **Customization:** Manually trigger a backup job from the Console and verify the resulting `.sql` or `.dump` file appears in the designated Cloud Storage bucket.

### 1.3 Designing network, storage, and compute resources

**Cloud-native networking**
*   **Concept:** Secure internal connectivity and micro-segmentation.
*   **Implementation Context:**
    *   In `App_CloudRun`, set `vpc_egress_setting = "ALL_TRAFFIC"` (Group 2).
    *   In `App_GKE`, deploy multiple namespaces relying on Dataplane V2.
*   **Exploration:**
    *   Check **Cloud Run > Networking** for egress settings.
    *   In GKE, use `kubectl describe networkpolicy` to review the isolated namespaces.
*   **Customization:** Attempt to ping a database from an unauthorized GKE namespace to verify the Dataplane V2 network policies drop the traffic.

**Choosing appropriate storage types**
*   **Concept:** Selecting relational, block, or file storage based on workload requirements.
*   **Implementation Context:** Set `database_type` (Group 5), `storage_buckets` (Group 6), and `enable_nfs = true` (Group 7).
*   **Exploration:** Visit **SQL**, **Cloud Storage**, and **Filestore** in the Console to compare how each service is managed and monitored natively.
*   **Customization:** Mount the NFS Filestore instance to multiple pods in GKE and write a file from one pod to verify it is immediately readable by the other.

**Mapping compute needs to platform products**
*   **Concept:** Choosing between serverless (Cloud Run) and orchestrated containers (GKE).
*   **Implementation Context:** Deploy the same container image to both `App_CloudRun` and `App_GKE`.
*   **Exploration:** Compare the deployment speed, operational overhead, and Console interfaces for both platforms.
*   **Customization:** Try deploying a stateful application requiring persistent volume claims (PVCs) and evaluate why GKE is a better fit than Cloud Run.

---

## Section 2: Managing and provisioning a cloud solution infrastructure (~17.5% of the exam)

### 2.1 Configuring network topologies

**Security protection and VPC design**
*   **Concept:** Controlling external exposure and managing internal traffic flow.
*   **Implementation Context:** Set `public_access = false` (Group 0) alongside IAP, or review the Global External Load Balancer setup.
*   **Exploration:** Navigate to **VPC network > Firewall** and inspect the network tags generated for GKE node pools or Cloud SQL instances.
*   **Customization:** Enable Cloud CDN on the load balancer backend and observe cache hit ratios in **Network Services > Cloud CDN** during a load test.

### 2.2 Configuring individual storage systems

**Data retention, lifecycle management, and protection**
*   **Concept:** Automating data governance and ensuring durability.
*   **Implementation Context:** Define lifecycle rules in `storage_buckets` (Group 6) and backup schedules in `backup_uri` (Group 14).
*   **Exploration:**
    *   Navigate to **Cloud Storage > Buckets > Lifecycle** to see object transition rules.
    *   Review **Cloud Scheduler** for backup execution frequency.
*   **Customization:** Set a lifecycle rule to transition objects to `COLDLINE` storage after 30 days. Upload a test object and verify the metadata reflects the upcoming transition.

### 2.3 Configuring compute systems

**Compute resource provisioning and orchestration**
*   **Concept:** Using declarative Infrastructure as Code (IaC) vs manual provisioning.
*   **Implementation Context:** Review the entire `terraform apply` process for both modules.
*   **Exploration:** Read the `terraform plan` output to understand the state dependency graph. Compare how Cloud Run handles automatic provisioning vs GKE's ReplicaSets and Pod Disruption Budgets.
*   **Customization:** Intentionally delete a managed resource (like a Cloud Scheduler job) via the Console, then run `terraform apply` again to see IaC drift detection and remediation in action.

### 2.4 Leveraging Vertex AI for end-to-end ML workflows

**Using AI Hypercomputer and ML workloads**
*   **Concept:** Orchestrating ML pipelines from application compute resources.
*   **Implementation Context:** Use `environment_variables` (Group 3) to inject Vertex AI endpoints into the application container.
*   **Exploration:** If applicable, navigate to **Vertex AI > Pipelines** to monitor jobs triggered by the application.
*   **Customization:** Provision a GKE node pool with GPUs and deploy an application that leverages those accelerators for inference tasks.

### 2.5 Configuring prebuilt solutions or APIs with Vertex AI

**Differentiating between Google AI APIs**
*   **Concept:** Securely integrating generative AI models.
*   **Implementation Context:** Inject Vertex AI or Gemini API keys securely via `secret_environment_variables` (Group 3).
*   **Exploration:** Check **Security > Secret Manager** to confirm the API keys are stored securely and not exposed in the Cloud Run or GKE pod environment plain text logs.
*   **Customization:** Update the secret payload in Secret Manager and restart the Cloud Run revision or GKE pod to verify it picks up the new credentials without changing the application code.

---

## Section 3: Designing for security and compliance (~17.5% of the exam)

### 3.1 Designing for security

**Identity and Access Management (IAM) & Supply Chain**
*   **Concept:** Principle of least privilege and container image verification.
*   **Implementation Context:** Review the generated `iam.tf` service accounts and set `enable_binary_authorization`.
*   **Exploration:**
    *   Navigate to **IAM & Admin > IAM** and search for the provisioned service accounts to review their strict role bindings.
    *   Navigate to **Security > Binary Authorization** to view the deployed policies.
*   **Customization:** Attempt to deploy an unsigned container image when Binary Authorization is enabled to observe the deployment blockage in the Console logs.

---

## Section 4: Analyzing and optimizing technical and business processes (~15% of the exam)

### 4.1 Analyzing and defining technical processes

**Continuous integration/continuous deployment (CI/CD)**
*   **Concept:** Modern SDLC automation and progressive rollouts.
*   **Implementation Context:** Review the generated CI/CD pipelines relying on Artifact Registry and Cloud Deploy.
*   **Exploration:** Navigate to **Cloud Build > Triggers** to see the pipeline definitions, and **Cloud Deploy > Delivery pipelines** to observe the release stages.
*   **Customization:** Commit a small code change to trigger the pipeline and monitor its progress across staging and production environments through the Cloud Deploy console.

---

## Section 5: Managing implementation (~12.5% of the exam)

### 5.2 Interacting with Google Cloud programmatically

**Infrastructure as Code (IaC)**
*   **Concept:** Managing Google Cloud infrastructure declaratively.
*   **Implementation Context:** The entire architecture is managed via Terraform modules.
*   **Exploration:** Use `gcloud` CLI commands to query the resources provisioned by Terraform (e.g., `gcloud run services list` or `gcloud container clusters list`) to correlate IaC definitions with live API state.
*   **Customization:** Export the current Terraform state and analyze the JSON structure to understand how Terraform maps high-level variable configurations to low-level GCP API properties.

---

## Section 6: Ensuring solution and operations excellence (~12.5% of the exam)

### 6.2 Familiarity with Google Cloud Observability solutions

**Monitoring, logging, and alerting strategies**
*   **Concept:** Deep visibility into system operational health.
*   **Implementation Context:** Populate `support_users` (Group 1).
*   **Exploration:** Use **Logging > Logs Explorer** to run a query (e.g., `resource.type="cloud_run_revision" severity>=ERROR`) to find application anomalies.
*   **Customization:** Create a custom Log-based Metric for a specific application log payload, and then build a custom alert policy on top of that new metric in the Console.
