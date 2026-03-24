# Professional Cloud Developer Study Guide: Exploring Section 2 (Building and testing applications)

This guide aligns with **Section 2: Building and testing applications (~23% of the exam)** of the Professional Cloud Developer certification. It provides a practical walkthrough of the deployed Google Cloud features, demonstrating how development, building, and testing workflows are automated and secured. By configuring variables in your web-based deployment portal, you can explore these concepts hands-on.

---

### 2.1 Setting up your development environment

**Concept:**
Emulating Google Cloud services locally and utilizing Cloud Workstations or Cloud Shell ensures a consistent, secure development environment before deploying to the cloud.

**Implementation Context:**
While local emulation (like the Cloud SQL Auth Proxy) happens on the developer's machine, the variables `existing_project_id` and `tenant_deployment_id` allow developers to provision personal, ephemeral sandbox environments in GCP that perfectly mirror production.

**Exploration:**
*   **Variable:** `tenant_deployment_id` (App_GKE / App_CloudRun modules)
*   **Description:** Short identifier appended to resources, enabling multiple isolated environments within the same project.
*   **Configuration Experience:** Setting `tenant_deployment_id = "dev-alice"` in your deployment portal allows a developer to spin up a complete, isolated instance of the application and database for integration testing.
*   **GCP Console Exploration:** Open **Cloud Shell**. Use the `gcloud` CLI to inspect the resources tagged with your specific `tenant_deployment_id`.
*   **Suggestions for Customization:** Use Cloud Shell to run the Cloud SQL Auth proxy locally, connecting a local development script directly to the development database instance provisioned by the module.

---

### 2.2 Building

**Concept:**
Building containers from source code using Cloud Build and storing them securely in Artifact Registry is the foundation of cloud-native CI/CD.

**Implementation Context:**
The modules automate the creation of this pipeline by setting `enable_cicd_trigger` and specifying the target image location via `container_image` directly in the deployment portal.

**Exploration:**
*   **Variable:** `enable_cicd_trigger`, `container_image` (App_GKE / App_CloudRun modules)
*   **Description:** Automates the creation of a Cloud Build trigger linked to a source repository, pushing built images to Artifact Registry.
*   **Configuration Experience:** Enabling the CI/CD trigger ensures that every commit is automatically built using the defined `Dockerfile` and stored immutably.
*   **GCP Console Exploration:** Navigate to **Cloud Build > History** to view the logs of the container build process, then click through to **Artifact Registry** to view the pushed image digest.
*   **Suggestions for Customization:** If your deployment portal exposes build variables (like `container_build_config`), explore adding an additional argument to the build step (e.g., configuring caching) and observing the changed build times in the Cloud Build logs.

---

### 2.3 Testing

**Concept:**
Executing automated integration tests within Cloud Build ensures that code changes do not break existing functionality before deployment.

**Implementation Context:**
The build pipelines created by `enable_cicd_trigger` dynamically generate the sequence of events where automated unit and integration testing steps can be injected before the deployment stage based on portal configuration.

**Exploration:**
*   **Variable:** `cicd_trigger_config` (App_GKE / App_CloudRun modules)
*   **Description:** Advanced configuration for the Cloud Build trigger, determining which branches trigger the build and test pipeline.
*   **Configuration Experience:** Setting `cicd_trigger_config = { branch_pattern = "^feature/.*" }` in the deployment portal ensures that tests are run on all feature branches before they are merged into the main deployment pipeline.
*   **GCP Console Exploration:** Navigate to **Cloud Build > Triggers**. Inspect the configuration to see how push events map to the build execution.
*   **Suggestions for Customization:** Update the application repository's source code to include a failing test (e.g., adding `exit 1` to a test script). Push the commit to a feature branch matching your pattern, and observe the Cloud Build pipeline fail and halt the deployment process.