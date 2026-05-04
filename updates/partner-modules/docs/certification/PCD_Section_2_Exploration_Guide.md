# PCD Certification Preparation Guide: Section 2 — Building and testing applications (~23% of the exam)

This guide helps candidates preparing for the Google Cloud Professional Cloud Developer (PCD) certification explore Section 2 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **Services GCP**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCD objectives that are not currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 2.1 Setting up your development environment

The RAD platform abstracts the local development environment behind the deployment portal. For the PCD exam, you must also be familiar with the full Google Cloud developer toolchain used to build, test, and debug applications locally and in the cloud.

### Google Cloud CLI and Service Emulators
**Concept:** Using the gcloud CLI for local authentication and deployment, and running local emulators to test against GCP services without incurring cloud costs.

**Google Cloud CLI (`gcloud`):**
Install the Cloud SDK locally and authenticate with `gcloud auth login`. Configure your default project with `gcloud config set project <project-id>`. Key commands for developers:
- `gcloud run deploy <service> --source .` — builds and deploys a Cloud Run service directly from source code in the current directory, without a separate `docker build` step.
- `gcloud container clusters get-credentials <cluster>` — writes kubectl credentials for a GKE cluster to your local kubeconfig.
- `gcloud auth application-default login` — sets up Application Default Credentials for local development, so your application code authenticates as your user identity rather than requiring a service account key file.

**Service Emulators** let you run local versions of GCP services so your application code can be tested without connecting to live cloud resources:
- `gcloud beta emulators pubsub start` — starts a local Pub/Sub emulator. Set the `PUBSUB_EMULATOR_HOST` environment variable in your app to point at it.
- `gcloud beta emulators datastore start` — starts a local Firestore/Datastore emulator (Firestore in Datastore mode).
- `gcloud beta emulators spanner start` — starts a local Cloud Spanner emulator for unit testing Spanner interactions.
- `gcloud beta emulators bigtable start` — starts a local Bigtable emulator.

Emulators are critical for fast local development cycles and CI unit tests — they avoid network latency, authentication setup, and per-operation costs.

**Real-world example:** A development team writes unit tests for a service that publishes to Pub/Sub and reads from Firestore. In their CI pipeline, the test setup script starts both the Pub/Sub and Datastore emulators, sets the corresponding environment variables, and runs `pytest`. The tests run in under 10 seconds — 15× faster than tests that hit live GCP services — and work in any environment with no credentials configured.

### Cloud Code, Cloud Shell, and Cloud Workstations
**Concept:** Using Google-provided developer tooling to write, debug, and deploy cloud-native applications from any environment.

**Cloud Code** is an IDE extension available for VS Code and JetBrains IDEs (IntelliJ, PyCharm, GoLand, etc.). It integrates Google Cloud development into your local IDE:
- **Kubernetes/GKE:** Browse cluster resources (pods, services, deployments) directly in the IDE, view pod logs, and stream logs in real time without leaving your editor.
- **Cloud Run:** Deploy to Cloud Run directly from the IDE, run Cloud Run services locally using the Cloud Run emulator, and debug running containers with breakpoints.
- **Secret Manager:** Browse and access secrets from the IDE Secret Manager explorer.
- **Gemini Code Assist integration:** Cloud Code bundles Gemini Code Assist for inline code suggestions and generation.

Install Cloud Code from your IDE's extension marketplace and sign in with your Google account. Navigate to the Cloud Code panel and connect to your GCP project.

**Cloud Shell** is a browser-based terminal in the GCP Console with all developer tools pre-installed (gcloud, kubectl, Docker, Terraform, Python, Node.js, Java, Go). It comes with a persistent 5GB home directory. Use **Cloud Shell Editor** (an in-browser VS Code instance) for editing files without local setup. Open Cloud Shell from any console page by clicking the `>_` icon in the top toolbar.

**Real-world example:** A developer on a restricted corporate laptop cannot install the gcloud SDK due to IT policies. They use Cloud Shell to run all `gcloud` commands, edit configuration files in Cloud Shell Editor, and execute `kubectl` commands against their GKE cluster — all from a browser tab with zero local software installation.

**Cloud Workstations** is a fully managed, cloud-hosted development environment service. Unlike Cloud Shell (which is a shared, ephemeral terminal), Cloud Workstations provisions dedicated, persistent VMs configured with your chosen IDE (VS Code, JetBrains, or custom images) and development tools. Key benefits:
- Consistent, reproducible environments across a team — every developer uses an identical pre-configured workstation image.
- Data and code stay in Google Cloud — no source code is stored on developer laptops.
- Access is controlled via IAP — the workstation is never exposed to the public internet.

Navigate to **Cloud Workstations > Workstation clusters** to explore configuration. Workstations are particularly valuable for teams with strict data security requirements (financial services, healthcare) where code must not leave the corporate cloud environment.

### Gemini Cloud Assist and Gemini Code Assist
**Concept:** Using AI assistance for development tasks and infrastructure operations.

**Gemini Code Assist** is the developer-facing AI assistant integrated into IDEs via the Cloud Code extension and available at `idx.google.com`. It provides:
- **Inline code completion:** Context-aware multi-line code suggestions as you type.
- **Code generation:** Generate function implementations, boilerplate classes, test cases, and data models from natural language prompts.
- **Code explanation:** Select any code block and ask "Explain this" to get a plain-language description.
- **Unit test generation:** Select a function and invoke "Generate unit tests" to produce a test suite covering positive cases and edge cases.
- **Chat:** Ask coding questions, request refactors, or get debugging help in a chat panel within the IDE.

**Gemini Cloud Assist** is the operations-facing AI assistant integrated into the GCP Console. It helps with infrastructure tasks rather than application code:
- Ask natural-language questions about your deployed resources ("Which Cloud Run services have the highest latency this week?").
- Get explanations of GCP console features and configuration options.
- Write MQL (Monitoring Query Language) expressions for alert policies and dashboards.
- Analyse logs and suggest fixes for identified issues.
- Access Gemini Cloud Assist from the Gemini icon (sparkle) in the top navigation bar of the GCP Console.

**Real-world example:** A developer is writing a Cloud Run service that reads from Bigtable. They have no prior Bigtable experience. In their IDE, they open Gemini Code Assist chat and ask "Write a Python function that reads the 10 most recent rows for a given device ID from a Bigtable table named `telemetry`, where the row key format is `<device-id>#<reverse-timestamp>`." Gemini generates a complete function using the `google-cloud-bigtable` client library with correct row key prefix scanning. The developer reviews, tests against the Bigtable emulator, and ships the feature in one afternoon instead of spending two days reading documentation.

---

## 2.2 Building

### Cloud Build and Artifact Registry
**Concept:** Using managed CI/CD services to build container images from source code, store them securely, and establish software supply chain provenance.

**In the RAD UI:**
*   **Continuous Integration (CI):** The `enable_cicd_trigger` variable (Group 7) integrates the source repository (`github_repository_url`) with Cloud Build. When a commit is pushed to the configured branch, Cloud Build automatically runs the pipeline defined in `cloudbuild.yaml`.
*   **Container Image Storage:** Cloud Build uses Kaniko to compile the container image and pushes it to Artifact Registry. The image is referenced by the `container_image` variable (Group 3), which specifies the Artifact Registry path including the image digest or tag.
*   **Binary Authorization Provenance:** The `enable_binary_authorization` variable (Group 11 in Services GCP) configures Cloud Build to create a cryptographic attestation after successfully building and testing an image. Only images with a valid attestation from the trusted Cloud Build attestor can be deployed to the GKE cluster or Cloud Run service.

**Console Exploration:**
Navigate to **Cloud Build > Triggers** to see the repository integration and trigger configuration. Navigate to **Cloud Build > History** to view build logs — each step in `cloudbuild.yaml` is a separate log entry. Navigate to **Artifact Registry > Repositories** to view stored container images, their tags, and the **Vulnerabilities** column showing Artifact Analysis scan results.

**Source-based deployment to Cloud Run:**
Cloud Run supports deploying directly from source code without pre-building a container image:
```bash
gcloud run deploy my-service --source . --region us-central1
```
This command uses Google Cloud Buildpacks to automatically detect the language runtime, build a container image, push it to Artifact Registry, and deploy it to Cloud Run — all in a single command. Useful for rapid prototyping and simple applications where a custom `Dockerfile` is not required.

**Cloud Build provenance and SLSA:**
Cloud Build generates **SLSA (Supply chain Levels for Software Artifacts) provenance** — a signed attestation recording exactly what source commit was built, which build steps ran, and what artifact was produced. This provenance can be verified by Binary Authorization at deploy time to enforce that only images built by your trusted Cloud Build pipeline are permitted to run. Navigate to **Cloud Build > Build history**, select a build, and click the **Security Insights** tab to view the generated provenance attestation.

**Real-world example:** A team's security policy requires that no container image can be deployed to production unless it was built by the official Cloud Build pipeline (not built locally by a developer and pushed directly). Binary Authorization enforces this: the cluster admission policy requires a valid attestation from the Cloud Build attestor. A developer who builds an image locally and pushes it to Artifact Registry will find that GKE rejects the pod at admission — the image lacks the required Binary Authorization attestation.

---

## 2.3 Testing

### Automated Integration Tests in Cloud Build
**Concept:** Executing tests automatically within the CI pipeline to catch regressions before deployment.

**In the RAD UI:**
*   **Cloud Build Execution:** The pipeline triggered by `enable_cicd_trigger` (Group 7) runs automated build steps defined in the repository's `cloudbuild.yaml`. Integration tests execute as a dedicated step after the build and before the image is pushed to Artifact Registry — a test failure prevents the image from being promoted.

**Console Exploration:**
Navigate to **Cloud Build > History**, select a recent build, and expand the individual steps to view test output. A failed test step shows the error output and causes the overall build to fail with a non-zero exit code. Navigate to **Cloud Deploy > Delivery pipelines** to confirm that failed builds do not create new releases — the pipeline is gated on a successful Cloud Build.

**Real-world example:** A Cloud Run service's `cloudbuild.yaml` defines three steps: (1) `docker build` to build the container, (2) `pytest integration_tests/` to run integration tests against a Cloud SQL test instance, (3) `docker push` to push the image to Artifact Registry. If step 2 fails, step 3 never executes — the broken image never reaches Artifact Registry and cannot be deployed. The build failure notification is sent to the team's chat channel via a Cloud Build Pub/Sub notification topic.

### 💡 Additional Testing Objectives & Learning Guidelines

*   **Unit Tests with Gemini Code Assist:** Practice writing a Python or Node.js function, then use Gemini Code Assist in your IDE to automatically generate a suite of unit tests. In the IDE chat panel, select the function and prompt: "Generate pytest unit tests for this function covering all code paths, including error cases and boundary conditions." Review the generated tests, add any missing cases, and run them against the Pub/Sub or Datastore emulator where applicable.

    > **Real-World Example:** A developer writes a function that parses a CloudEvents payload from an Eventarc trigger and extracts the Cloud Storage object name and bucket. They use Gemini Code Assist to generate unit tests with a variety of valid and malformed payloads. The generated tests catch an edge case where the function raises an unhandled `KeyError` when the `data` field is absent — a real scenario when testing with manually crafted test events.

*   **Testing Cloud Run services locally:** Use the Cloud Run emulator in Cloud Code to run your Cloud Run container locally with the same environment variables and service account bindings as the deployed service. This allows end-to-end local testing including Secret Manager access and Cloud SQL Auth Proxy connections, without deploying to GCP.

*   **Test isolation with emulators:** Structure integration tests to start emulators in `setUp` and stop them in `tearDown`. Use unique topic, subscription, and collection names per test run (e.g. append a UUID) to prevent state leakage between tests when emulators are shared across test runs.
