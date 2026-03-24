# PDE Section 2 Exploration Guide: Building and implementing CI/CD pipelines

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification. It maps the official exam guide domains for Section 2 to practical implementations in the provided Terraform codebase (`modules/App_CloudRun` and `modules/App_GKE`), which rely on the shared `modules/App_GCP` module.

By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical DevOps and SRE topics.

---

## Section 2: Building and implementing CI/CD pipelines (~25% of the exam)

### 2.1 Designing pipelines

**Concept:** Establishing end-to-end artifact management and deployment flows.

**Implementation Context:** The CI pipelines defined in `trigger.tf` interface directly with **Artifact Registry**, storing immutable container images securely before deployment. The `google_cloudbuild_trigger` resource defines a pipeline that automatically builds the container image and pushes it to Artifact Registry upon changes to the connected repository.

**Exploration:**
1. **Explore the Code:** Open `modules/App_CloudRun/trigger.tf`. Review the `google_cloudbuild_trigger.cicd_trigger` resource block. Note how it configures the build steps using `kaniko` to build and push the image to Artifact Registry (`--destination=$${_IMAGE_REGION}-docker.pkg.dev/$${_PROJECT_ID}/$${_REPO_NAME}/$${_IMAGE_NAME}:$${COMMIT_SHA}`).
2. **Explore the Console:** Navigate to the **Cloud Build > Triggers** section in the GCP Console. If deployed, inspect the trigger configuration.
3. **Explore the Console:** Navigate to the **Artifact Registry > Repositories** section. Locate the repository created for the application (e.g., matching `_REPO_NAME`) and view the stored images and their tags.

### 2.2 Implementing and managing pipelines

**Concept:** Applying safe deployment strategies.

**Implementation Context:** The deployment logic within `trigger.tf` and `service.tf` supports safe and progressive deployments. For Cloud Run, `service.tf` exposes `traffic` blocks, allowing operators to implement canary deployments by splitting traffic between multiple revisions safely. Furthermore, if Cloud Deploy is enabled, `trigger.tf` uses `gcloud deploy releases create` to trigger a delivery pipeline, moving the artifact through defined stages (e.g., dev, staging, prod).

**Exploration:**
1. **Explore the Code:** Open `modules/App_CloudRun/service.tf`. Find the `google_cloud_run_v2_service.app_service` or `google_cloud_run_v2_service.app_service_cd` resources. Observe the `traffic` block configuration and how it can be used for canary deployments using the `traffic_split` variable.
2. **Explore the Code:** Open `modules/App_CloudRun/trigger.tf`. Locate the deploy step in the `google_cloudbuild_trigger` and examine the conditional logic that either creates a Cloud Deploy release or updates the Cloud Run service directly.
3. **Explore the Console:** Navigate to **Cloud Run > Services**. Select a deployed service and navigate to the **Revisions** tab. Observe how traffic can be routed between different revisions.
4. **Explore the Console:** If Cloud Deploy is provisioned, navigate to **Cloud Deploy > Delivery pipelines**. Inspect the pipeline and its stages (e.g., dev, staging, prod) and how releases are promoted.

### 2.3 Managing pipeline configuration and secrets

**Concept:** Securely injecting sensitive data into applications and pipelines.

**Implementation Context:** Both modules integrate tightly with **Secret Manager**. Crucially, the modules do not expose plaintext secrets; instead, they map Secret Manager references directly to environment variables (e.g., `secret_environment_variables` in Cloud Run), demonstrating secure runtime secret injection. Automated secret rotation is also implemented via Cloud Run Jobs or Kubernetes CronJobs (`jobs.tf`). The database password rotation uses the `app_secrets` module.

**Exploration:**
1. **Explore the Code:** Open `modules/App_CloudRun/secrets.tf`. Review the `app_secrets` module and the stage-specific database password configuration. Notice how secrets are created in `google_secret_manager_secret`.
2. **Explore the Code:** Open `modules/App_CloudRun/service.tf`. Look at the `env` blocks within the `containers` section. See how `value_source { secret_key_ref { ... } }` is used to securely inject the secret value directly from Secret Manager at runtime without exposing it in the deployment manifest or environment variables in plaintext.
3. **Explore the Console:** Navigate to **Secret Manager**. Locate the secrets created for the application (e.g., database passwords, GitHub tokens). Verify that the secret values are not accessible without specific permissions.
4. **Explore the Console:** Navigate to **Cloud Run > Services**. Select the deployed service and view the **Variables & Secrets** tab. Observe that the secrets are referenced, not exposed.
