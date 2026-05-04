# PDE Certification Preparation Guide: Section 2 — Building and implementing CI/CD pipelines (~25% of the exam)

This guide helps candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification explore Section 2 of the exam. It maps the official exam guide domains to practical implementations in the provided Terraform codebase (`modules/App_CloudRun` and `modules/App_GKE`), which rely on the shared `modules/App_Common` module.

Three modules are relevant to this section: **App CloudRun**, which deploys serverless containerised applications on Cloud Run; **App GKE**, which deploys containerised workloads on GKE Autopilot; and **App GCP**, which provides the shared foundational infrastructure consumed by both application modules.

By exploring the GCP Console and the corresponding Terraform code, you will gain hands-on context for these critical DevOps topics.

---

## 2.1 Designing pipelines

**Concept:** Establishing end-to-end artifact management and deployment flows — from source code commit to a verified, immutable artifact stored in a registry and ready for promotion across environments.

**In the RAD UI:**
The CI pipelines defined in `trigger.tf` interface directly with **Artifact Registry**, storing immutable container images securely before deployment. The `google_cloudbuild_trigger` resource defines a pipeline that automatically builds the container image and pushes it to Artifact Registry upon changes to the connected repository.

Key design decisions visible in the codebase:

*   **Immutable image tagging:** Images are tagged with `$COMMIT_SHA` — a content-addressed, immutable identifier tied to the exact source commit. This ensures full traceability: given any running container, you can identify the exact commit that produced it.
*   **Kaniko for secure builds:** The build step uses Kaniko (`gcr.io/kaniko-project/executor`), which builds container images inside a standard container without requiring privileged mode or a Docker daemon socket. This is the recommended pattern for Cloud Build because it is more secure than Docker-in-Docker approaches.
*   **Artifact Registry over Container Registry:** Images are stored in Artifact Registry (the successor to Container Registry), which provides regional storage, fine-grained IAM, format support beyond Docker (Maven, npm, Python), and integrated vulnerability scanning via Artifact Analysis.
*   **Vulnerability scanning:** Artifact Analysis automatically scans images pushed to Artifact Registry for known CVEs. Build pipelines can be configured to query scan results and fail the build if vulnerabilities above a severity threshold are found.

**Console Exploration:**
1. Open `modules/App_CloudRun/trigger.tf`. Review the `google_cloudbuild_trigger.cicd_trigger` resource block. Note how the build step configures Kaniko to build and push the image to Artifact Registry using the destination pattern `$${_IMAGE_REGION}-docker.pkg.dev/$${_PROJECT_ID}/$${_REPO_NAME}/$${_IMAGE_NAME}:$${COMMIT_SHA}`.
2. Navigate to **Cloud Build > Triggers** in the GCP Console. Inspect the trigger configuration — observe the connected repository, the branch filter, and the build configuration file path.
3. Navigate to **Artifact Registry > Repositories**. Locate the repository created for the application and view the stored images. Click an image digest to view its vulnerability scan results and, if enabled, its SLSA provenance attestation.
4. Navigate to **Cloud Build > History**. Click a recent build to view the step-by-step execution log. Observe the `BUILD` step (Kaniko image build) and the `PUSH` step (image upload to Artifact Registry).

**Real-world example:** An online gaming platform's build pipeline runs on every push to the `main` branch. The Cloud Build trigger kicks off a four-step pipeline: (1) unit tests run in a containerised test runner; (2) Kaniko builds the production image tagged with the commit SHA; (3) `gcloud artifacts docker images scan` is called to check the image for CVEs — the build fails with a non-zero exit code if any CRITICAL CVEs are found; (4) the image is pushed to Artifact Registry. The team configured a Cloud Monitoring alert that fires whenever a new CRITICAL vulnerability is discovered in a previously clean image — catching zero-day vulnerabilities in already-deployed versions without waiting for the next build.

---

## 2.2 Implementing and managing pipelines

**Concept:** Applying safe deployment strategies that minimize risk when rolling out new versions — including canary deployments, blue/green releases, staged rollouts, and controlled rollbacks.

**In the RAD UI:**
The deployment logic within `trigger.tf` and `service.tf` supports safe and progressive deployments:

*   **Cloud Run traffic splitting (canary):** In `service.tf`, the `traffic` blocks on the `google_cloud_run_v2_service` resource enable traffic splitting between named revisions. An operator can route 5% of traffic to the new revision and 95% to the previous revision — monitoring error rates and latency before committing to a full rollout.
*   **Cloud Deploy staged rollouts:** When Cloud Deploy is enabled, `trigger.tf` uses `gcloud deploy releases create` to trigger a delivery pipeline. The release moves through defined stages (dev → staging → production) with configurable automatic or manual promotion gates between stages. Production stages can require human approval via the Cloud Deploy console before any deployment proceeds.
*   **Rollback:** Cloud Deploy retains the previous release and can instantly redeploy it. For Cloud Run, the previous revision remains available — traffic can be redirected back in seconds without rebuilding or redeploying.

**Console Exploration:**
1. Open `modules/App_CloudRun/service.tf`. Find the `google_cloud_run_v2_service` resource. Observe the `traffic` block configuration and how the `traffic_split` variable enables canary routing.
2. Open `modules/App_CloudRun/trigger.tf`. Locate the deploy step in the `google_cloudbuild_trigger` and examine the conditional logic that either creates a Cloud Deploy release or updates the Cloud Run service directly.
3. Navigate to **Cloud Run > Services**. Select a deployed service and navigate to the **Revisions** tab. Observe the listed revisions and their traffic allocation percentages. Note that the UI allows manually adjusting traffic splits without a redeploy.
4. Navigate to **Cloud Deploy > Delivery pipelines**. Inspect the pipeline and its stages. Click into a release to see its rollout history, the promotion status for each stage, and the **Rollback** button that redeploys the immediately preceding release.

**Real-world example:** A logistics company deploys a new route optimisation algorithm to Cloud Run. Rather than directing 100% of traffic immediately, the team updates the Cloud Run service to send 10% of production traffic to the new revision (canary) and 90% to the stable revision (control). They configure a Cloud Monitoring alert on the `5xx` error rate for the new revision. After 30 minutes with no errors and sub-50ms p95 latency on the canary, they promote to 50%, then 100%, via the Cloud Run console traffic management UI — all without a new build or a Cloud Deploy release. If the canary had shown elevated error rates, they would have redirected 100% traffic back to the stable revision in under 10 seconds.

---

## 2.3 Managing pipeline configuration and secrets

**Concept:** Securely injecting sensitive data into applications and pipelines at runtime — ensuring that credentials, API keys, and database passwords are never stored in plaintext in code, configuration files, environment variables, or container images.

**In the RAD UI:**
Both modules integrate tightly with **Secret Manager**. The modules do not expose plaintext secrets — instead, they map Secret Manager secret versions directly to container environment variables using Cloud Run's native secret reference mechanism. Automated secret rotation is also implemented via Cloud Run Jobs (`jobs.tf`), which periodically rotate the database password and write the new value as a new Secret Manager version without redeploying the application.

*   **Secret Manager references in Cloud Run:** The `secret_environment_variables` configuration in `service.tf` injects secret values as environment variables at container startup, pulling the latest version directly from Secret Manager. The container image never contains the secret value; it is resolved at runtime.
*   **Cloud Build service account permissions:** The Cloud Build service account (`cloud_build_sa`) is granted only the specific IAM roles it needs — `roles/secretmanager.secretAccessor` on specific secrets, `roles/artifactregistry.writer` on the image repository, and `roles/clouddeploy.releaser` for triggering releases. It does not have broad project-level permissions.
*   **Source repository credentials:** Cloud Build connects to source repositories via Cloud Build's native repository connections (configured under **Cloud Build > Repositories**). These connections use OAuth tokens managed by Google — you do not need to store raw repository access tokens in Secret Manager. The connection grants Cloud Build read access to the repository without requiring you to manage credential rotation.

**Console Exploration:**
1. Open `modules/App_CloudRun/secrets.tf`. Review the `app_secrets` module and how secret resources are created with `google_secret_manager_secret`. Note that the Terraform code creates the secret *container* but not the secret *value* — the value is populated by the rotation job or during initial setup via `gcloud secrets versions add`.
2. Open `modules/App_CloudRun/service.tf`. Look at the `env` blocks within the `containers` section. See how `value_source { secret_key_ref { ... } }` injects the secret value directly from Secret Manager at runtime — the container receives the value as an environment variable but it is never written to the deployment manifest.
3. Navigate to **Secret Manager**. Locate the secrets created for the application (e.g., database passwords, API credentials). Click a secret and view its **Versions** tab — observe that secret rotation creates new numbered versions while old versions remain accessible for rollback. Note that the actual secret value is never shown in the console by default.
4. Navigate to **Cloud Run > Services**. Select the deployed service and view the **Variables & Secrets** tab. Observe that secrets are shown as references (e.g., `projects/*/secrets/db-password/versions/latest`) — not as plaintext values.
5. Navigate to **Cloud Build > Settings**. Review the service account assigned to Cloud Build and verify it has only the minimum required roles — not `roles/editor` or `roles/owner`.

**Real-world example:** A healthcare company's Cloud Build pipeline deploys a Cloud Run service that connects to Cloud SQL. The database password is stored in Secret Manager as `db-password-production`. The Cloud Run service references this secret via `value_source { secret_key_ref }` — the password is injected as the `DB_PASSWORD` environment variable at container startup. When the security team requires quarterly password rotation, the Cloud Run Job (configured via `jobs.tf`) generates a new password, updates it in Cloud SQL, and writes a new version to Secret Manager. Cloud Run automatically picks up the new version on the next revision deployment without requiring any code change or manual credential update. A Cloud Monitoring alert fires if the rotation job fails — ensuring the team is notified immediately if rotation does not complete successfully.

---

## 2.4 Auditing and logging of code and configurations

**Concept:** Maintaining a complete, tamper-resistant audit trail of all pipeline activities — who triggered a build, what was deployed, which image version reached production, and what IAM changes were made to pipeline infrastructure.

**In the RAD UI:**
Audit logging is largely automatic in Google Cloud — Cloud Audit Logs capture `Admin Activity` events (IAM changes, resource creation/deletion) by default for all services. However, the pipeline codebase reinforces auditability through several deliberate choices:

*   **Immutable image digests:** Because all images are tagged with their commit SHA and stored in Artifact Registry with a content-addressed digest, there is an unambiguous record of exactly what code was deployed to each environment. The Cloud Deploy release history records which image digest was deployed to which target at what time.
*   **Cloud Build provenance:** Cloud Build generates SLSA provenance for each build — a cryptographically signed record of the build inputs (source repository, commit, build steps) and output (image digest). This provenance is stored in Artifact Registry alongside the image.
*   **Terraform state as an audit trail:** Each Terraform state file version in Cloud Storage represents a point-in-time snapshot of all infrastructure. Combined with the GCS object versioning, this provides a chronological history of every infrastructure change.

**Console Exploration:**
1. Navigate to **Cloud Audit Logs** via **Logging > Logs Explorer**. Filter by `resource.type="audited_resource"` and `protoPayload.serviceName="cloudbuild.googleapis.com"` to view all Cloud Build API calls — who triggered builds, when, and from which IP address.
2. Navigate to **Cloud Deploy > Delivery pipelines**. Select a pipeline and click **Release history** to view every release, when it was promoted to each stage, and which user approved the production deployment.
3. Navigate to **Artifact Registry > Repositories**. Select an image and click its digest to view the **Build provenance** tab — the SLSA provenance record showing the source repository URL, commit SHA, build trigger ID, and the cryptographic signature verifying the record has not been tampered with.
4. Navigate to **Cloud Storage** and find the Terraform state bucket. Enable **Object versioning** if not already enabled, then browse the versioned state objects to see a chronological history of infrastructure changes.
5. Navigate to **IAM & Admin > Audit Logs**. Review which services have Data Access audit logging enabled. For compliance-sensitive environments, enable `DATA_READ` and `DATA_WRITE` audit logging for Cloud Build, Artifact Registry, and Cloud Deploy — these generate logs for every API call, not just administrative changes.

**Real-world example:** A software company receives a security incident notification that an unexpected container image was deployed to their production Cloud Run service. Using Cloud Audit Logs, the security team queries for all `google.cloud.run.v1.Services.ReplaceService` events in the past 7 days. The logs reveal that a deployment was made directly via `gcloud run deploy` by a developer's personal account — bypassing the Cloud Deploy pipeline entirely. The team immediately: (1) rolls back to the last known-good Cloud Deploy release; (2) removes `roles/run.developer` from individual user accounts, requiring all deployments to go through the Cloud Build + Cloud Deploy pipeline using dedicated service accounts; (3) enables Binary Authorization on the Cloud Run service to prevent deployments of images without a valid Cloud Build attestation. The Cloud Audit Log entry provided the exact timestamp, principal email, and request parameters needed to scope the incident.

### 💡 Additional CI/CD Pipeline Objectives & Learning Guidelines

*   **Testing Gates in CI Pipelines:** A well-designed CI pipeline includes multiple testing gates before an artifact is promoted. In Cloud Build, implement: (1) unit tests as an early step — fast, no infrastructure required; (2) integration tests against a real Cloud SQL or Pub/Sub instance provisioned for the test run; (3) container structure tests (using `container-structure-test`) to verify that the built image contains expected files and environment variables. Configure the pipeline so that any failing test step returns a non-zero exit code, causing the entire Cloud Build execution to fail and block promotion.
*   **Cloud Deploy Automation Strategies:** Explore Cloud Deploy's `deployParameters` and `automationRules`. An automation rule can automatically promote a release from dev to staging after a successful deployment — reducing manual steps without compromising the production approval gate. Navigate to **Cloud Deploy > Automation** to see configured rules.
