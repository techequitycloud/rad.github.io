# Professional Cloud Developer (PCD) Certification Exploration Guide

This document maps the features and configurations of the deployed Cloud Run and GKE applications to the Professional Cloud Developer (PCD) certification exam domains. It serves as an exploration guide for candidates to understand how cloud-native development concepts are practically implemented in Google Cloud. You can experiment with these configurations directly through your web-based deployment portal.

---

## Section 1: Designing highly scalable, available, and reliable cloud-native applications (~36% of the exam)

### 1.1 Designing high-performing applications and APIs
*   **Concept:** Choosing the appropriate platform (Cloud Run vs. GKE), implementing caching solutions (like Memorystore for Redis) for performance, and utilizing traffic splitting strategies for safe rollouts are fundamental to high-performing cloud-native architectures.
*   **Implementation Context:** The modules support deploying directly to both Cloud Run and GKE via `deploy_application`. Caching is integrated using the `enable_redis` and `redis_auth` variables. Progressive delivery is managed via the `traffic_split` variable. Setting `enable_redis = true` provisions a Memorystore instance to offset database read loads. Configuring `traffic_split = [{ revision_name = "v2", percent = 10 }]` demonstrates canary deployments.
*   **Exploration:**
    *   Navigate to **Memorystore** to view the Redis instance topology.
    *   For traffic splitting, navigate to **Cloud Run > Revisions** to observe the traffic routing chart.
*   **Customization:** Update the `traffic_split` variable to a 50/50 split and perform a small load test to observe metrics distributing across the two revisions equally.

### 1.2 Designing secure applications
*   **Concept:** Securing applications involves rotating secrets, utilizing Identity-Aware Proxy (IAP) to identify vulnerabilities via Zero Trust, and securing application artifacts using Binary Authorization.
*   **Implementation Context:** Secrets are injected into containers dynamically using `secret_environment_variables`. Pre-production endpoints are secured with `enable_iap`, and artifact integrity is enforced via `enable_binary_authorization`. Using `secret_environment_variables` ensures application credentials (like database passwords) are read from Secret Manager at runtime rather than baked into the container.
*   **Exploration:**
    *   Navigate to **Secret Manager** to view secret rotation policies.
    *   Visit **Security > Identity-Aware Proxy** to view the authorized principals allowed to access the application.
*   **Customization:** Create a new version of a secret in Secret Manager, update the variable reference, and redeploy to observe how the application receives the new credentials without a codebase change.

### 1.3 Storing and accessing data
*   **Concept:** Selecting the appropriate storage system and understanding data replication is critical. Cloud SQL is often used for structured data, and Cloud Storage for unstructured blobs, requiring secure access methods like signed URLs.
*   **Implementation Context:** The foundational `Services_GCP` module provisions a highly available Cloud SQL instance. The application modules connect to it seamlessly, and can optionally provision Google Cloud Storage buckets via `storage_buckets`. Defining `storage_buckets = ["user-uploads"]` provisions the necessary storage infrastructure for the application to generate and serve signed URLs for direct client uploads.
*   **Exploration:**
    *   Navigate to **Cloud Storage > Buckets** to verify the created bucket, its regional placement, and lifecycle policies.
*   **Customization:** Modify the Terraform configuration to add a lifecycle rule to the GCS bucket (e.g., transition objects to Coldline after 30 days) and verify the policy in the console.

---

## Section 2: Building and testing applications (~23% of the exam)

### 2.1 Setting up your development environment
*   **Concept:** Emulating Google Cloud services locally and utilizing Cloud Workstations or Cloud Shell ensures a consistent, secure development environment before deploying to the cloud.
*   **Implementation Context:** While local emulation (like the Cloud SQL Auth Proxy) happens on the developer's machine, the variables `existing_project_id` and `tenant_deployment_id` allow developers to provision personal, ephemeral sandbox environments in GCP that perfectly mirror production. Setting `tenant_deployment_id = "dev-alice"` allows a developer to spin up a complete, isolated instance of the application and database for integration testing.
*   **Exploration:**
    *   Open **Cloud Shell**. Use the `gcloud` CLI to inspect the resources tagged with your specific `tenant_deployment_id`.
*   **Customization:** Use Cloud Shell to run the Cloud SQL Auth proxy locally, connecting a local development script directly to the development database instance provisioned by the module.

### 2.2 Building
*   **Concept:** Building containers from source code using Cloud Build and storing them securely in Artifact Registry is the foundation of cloud-native CI/CD.
*   **Implementation Context:** The modules automate the creation of this pipeline by setting `enable_cicd_trigger` and specifying the target image location via `container_image`. Enabling the CI/CD trigger ensures that every commit is automatically built using the defined `Dockerfile` and stored immutably.
*   **Exploration:**
    *   Navigate to **Cloud Build > History** to view the logs of the container build process, then click through to **Artifact Registry** to view the pushed image digest.
*   **Customization:** Modify the `container_build_config` (if exposed) or the underlying `cloudbuild.yaml` to include an additional step, such as running a linter or vulnerability scanner before the image is pushed.

### 2.3 Testing
*   **Concept:** Executing automated integration tests within Cloud Build ensures that code changes do not break existing functionality before deployment.
*   **Implementation Context:** The build pipelines created by `enable_cicd_trigger` rely on a dynamic `cloudbuild.yaml` where automated unit and integration testing steps can be injected before the deployment stage. Setting `cicd_trigger_config = { branch_pattern = "^feature/.*" }` ensures that tests are run on all feature branches before they are merged into the main deployment pipeline.
*   **Exploration:**
    *   Navigate to **Cloud Build > Triggers**. Inspect the configuration to see how push events map to the build execution.
*   **Customization:** Update the application repository's source code to include a failing test, push the commit, and observe the Cloud Build pipeline fail and halt the deployment process.

---

## Section 3: Deploying applications (~20% of the exam)

### 3.1 Deploying applications to Cloud Run
*   **Concept:** Deploying applications to serverless platforms like Cloud Run involves defining concurrency, environment variables, and invocation triggers.
*   **Implementation Context:** The `App_CloudRun` module manages the complete lifecycle of the service using `deploy_application` and injects runtime configuration via `environment_variables`. Setting `deploy_application = true` and defining `environment_variables = { LOG_LEVEL = "info" }` deploys the container and configures its runtime behavior.
*   **Exploration:**
    *   Navigate to **Cloud Run > Services**. Click on the service, then the **Variables & Secrets** tab to verify the injected configuration.
*   **Customization:** Change an environment variable value in the Terraform configuration, apply the changes, and observe Cloud Run automatically creating a new immutable revision and migrating traffic.

### 3.2 Deploying containers to GKE
*   **Concept:** Deploying to Kubernetes (GKE) requires defining resource requirements, configuring health checks, and setting up the Horizontal Pod Autoscaler for cost optimization.
*   **Implementation Context:** The `App_GKE` module configures deployment manifests natively. `container_resources` defines CPU/Memory, `health_check_config` manages probes, and `min_instance_count`/`max_instance_count` control the HPA. Allocating strict `container_resources` and configuring the `health_check_config` ensures Kubernetes can restart unresponsive applications and scale them efficiently.
*   **Exploration:**
    *   Navigate to **Kubernetes Engine > Workloads**. Click the workload to view its YAML configuration, verifying the resource limits and probe endpoints.
*   **Customization:** Artificially lower the `container_resources` memory limit to induce an OOMKilled state, then observe the 'Events' tab in the GKE console to diagnose the failure.

---

## Section 4: Integrating applications with Google Cloud services (~21% of the exam)

### 4.1 Integrating applications with data and storage services
*   **Concept:** Managing connections to datastores like Cloud SQL involves handling authentication, connection pooling, and securely passing connection strings.
*   **Implementation Context:** The modules abstract the complexity of Cloud SQL connections by utilizing the Cloud SQL Auth Proxy (via `cloudsql_volume_mount_path` for GKE or native integration for Cloud Run). The application seamlessly connects to the database via a local Unix socket, demonstrating secure internal integration without managing IP allowlists.
*   **Exploration:**
    *   Navigate to **Cloud SQL > Connections**. Observe that public IP is disabled and connections are securely routed. For Cloud Run, view the **Connections** tab on the service.
*   **Customization:** Review the application logs to observe the startup sequence of the Cloud SQL Auth proxy sidecar container (if on GKE) establishing the secure tunnel before the main application starts.

### 4.2 Consuming Google Cloud APIs
*   **Concept:** Making API calls requires enabling services and using service accounts (Workload Identity) with the least privileged access to authenticate securely.
*   **Implementation Context:** Applications running on GKE or Cloud Run automatically inherit the permissions of their associated Google Service Account, mapped via Workload Identity, eliminating the need to manage JSON key files. The application authenticates to Google Cloud APIs seamlessly using Application Default Credentials (ADC) provided by the execution environment.
*   **Exploration:**
    *   Navigate to **IAM & Admin > Service Accounts**. Locate the service account created for the application and review its assigned roles to verify the principle of least privilege.
*   **Customization:** Attempt to use the Cloud Client Libraries within the application to read a resource it doesn't have permissions for (like BigQuery) and observe the resulting HTTP 403 error, validating the IAM boundary.

### 4.3 Troubleshooting and observability
*   **Concept:** Instrumenting code for troubleshooting involves producing metrics, logs, and traces, and using Google Cloud Observability to correlate trace IDs across services.
*   **Implementation Context:** By deploying via these modules, Cloud Logging and Monitoring are natively integrated. Applications can be configured to emit traces by setting specific environment variables. Setting an environment variable like `GOOGLE_CLOUD_PROJECT` or `OTEL_EXPORTER_OTLP_ENDPOINT` via `environment_variables` instructs the application to begin tracing requests.
*   **Exploration:**
    *   Navigate to **Trace > Trace list**. Analyze a request's waterfall diagram to identify latency bottlenecks between the application code and the Cloud SQL database.
*   **Customization:** Create a custom log-based metric in the Logs Explorer for a specific application error string, then reference that new metric in a custom `alert_policy` to alert the team when the error spikes.
