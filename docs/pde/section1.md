# PDE Certification Preparation Guide: Section 1 — Bootstrapping and maintaining a Google Cloud organization (~20% of the exam)
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section1.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section1.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pde_section1.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification explore Section 1 of the exam. It walks you through how these concepts are practically implemented in the provided Terraform codebase (`modules/App_CloudRun` and `modules/App_GKE`). By exploring the GCP Console and corresponding code, you will gain hands-on context for these critical DevOps topics.

Three modules are relevant to this section: **App CloudRun**, which deploys serverless containerised applications on Cloud Run; **App GKE**, which deploys containerised workloads on GKE Autopilot; and **App GCP**, which provides the shared foundational infrastructure consumed by both application modules.

---

## 1.1 Designing the overall resource hierarchy

**Concept:** Structuring a Google Cloud organization using the resource hierarchy (Organisation → Folders → Projects → Resources) to enforce governance, isolate environments, and enable scalable IAM and billing management.

**In the Terraform Codebase:**
The RAD platform provisions all resources within a defined project, but understanding the hierarchy above the project level is essential for the PDE exam. The `modules/App_GCP` module configures project-scoped resources. In a production landing zone, the project itself would sit within a folder structure (e.g., `corp/production/app-team`) enforced by the organization.

Examine `modules/App_GCP/main.tf` to understand which APIs are enabled and which IAM bindings are created at the project level. The separation between `App GCP` (shared services), `App CloudRun` (application workload), and `App GKE` (application workload) mirrors the separation-of-concerns principle applied to real folder and project hierarchies.

**Console Exploration:**
*   Navigate to **IAM & Admin > Resource Manager** to view the project's position within the organization hierarchy.
*   Navigate to **IAM & Admin > Organization Policies** to view the constraint policies applied at the organization or folder level that flow down to this project. Relevant constraints include `constraints/compute.requireOsLogin`, `constraints/iam.disableServiceAccountKeyCreation`, and `constraints/compute.restrictCloudRunRegion`.
*   Navigate to **Billing > Budgets & alerts** to see how billing budgets (configured via the `create_billing_budget` variable) provide financial governance guardrails at the project level.

> **Real-World Example:** A financial services organization structures its Google Cloud hierarchy as: Organization → `Corp` folder → `Production` and `Non-Production` folders → individual project per application team per environment (e.g., `payments-prod`, `payments-staging`). An organization policy at the `Non-Production` folder level enforces `constraints/compute.restrictCloudRunRegion` to `us-central1` only — keeping developer experimentation costs low. A separate policy at the `Production` folder enforces `constraints/iam.disableServiceAccountKeyCreation` — preventing any JSON key files from being created in production projects. Both policies are defined in Terraform using `google_org_policy_policy` resources and applied to folders, flowing down automatically to all child projects without per-project configuration.

### 💡 Additional Resource Hierarchy Objectives & Learning Guidelines

*   **Cloud Foundation Toolkit and Fabric FAST:** Google provides two Google-supported reference architectures for bootstrapping an organization at scale. The [Cloud Foundation Toolkit](https://cloud.google.com/foundation-toolkit) is a library of Terraform modules that implement Google's recommended practices for resource hierarchy, networking, IAM, and logging. [Fabric FAST](https://github.com/GoogleCloudPlatform/cloud-foundation-fabric/tree/master/fast) is a more opinionated end-to-end bootstrap. Explore the Terraform blueprints console at **Solutions > Deploy** to understand the reference patterns.
*   **Labels and Tags for Governance:** Labels (key-value pairs on resources, e.g., `env=production`, `team=payments`) enable cost allocation and policy-driven resource management. Review how resources in `modules/App_GCP/main.tf` apply labels, then navigate to **Billing > Reports** and group by label to see per-team cost attribution.
*   **Billing Account Structure:** Understand that a Billing Account sits outside the resource hierarchy — it is linked to projects but belongs to the organization node. Multiple billing accounts (e.g., one per business unit) allow independent budget tracking and chargeback to separate cost centres.

---

## 1.2 Managing infrastructure

**Concept:** Utilizing infrastructure-as-code (IaC) to manage environments efficiently, repeatedly, and with full auditability.

**In the Terraform Codebase:**
The repository uses Terraform extensively. The **App CloudRun** and **App GKE** modules define full-stack environments. By reviewing `main.tf`, `variables.tf`, and specific resource files (e.g., `service.tf`, `deployment.tf`), candidates see how Google-recommended IaC practices are applied. Terraform resources like `google_cloud_run_v2_service` or GKE workloads (`kubernetes_deployment_v1`) are defined declaratively, enabling automated creation, updating, and versioning of cloud infrastructure.

Key IaC practices demonstrated in the codebase:
*   **Remote state:** Terraform state is stored in Cloud Storage buckets (not locally), enabling team collaboration and preventing state file conflicts. Review the backend configuration in the root module.
*   **Module versioning:** The `App GCP`, `App CloudRun`, and `App GKE` modules are versioned independently — a change to `App GCP` does not force a redeploy of application modules. This mirrors the module registry versioning pattern recommended for enterprise IaC.
*   **Variable parameterisation:** All environment-specific values (instance counts, regions, image tags) are passed as variables — no hardcoded values in resource definitions. This enforces the principle that module code is environment-agnostic.

**Console Exploration:**
*   Navigate to the specific terraform module directories (`modules/App_CloudRun` and `modules/App_GKE`).
*   Examine `main.tf`, `variables.tf`, and specific resource files like `service.tf` or `deployment.tf`.
*   Observe the declarative resource definitions and how they are linked to form a complete application platform.
*   Navigate to **Cloud Storage** and find the Terraform state bucket. Observe that state is stored remotely and that state lock objects prevent concurrent modifications.

> **Real-World Example:** A platform engineering team manages 12 microservices using shared Terraform modules. Each service team configures their service via a `terraform.tfvars` file — specifying container image, min/max instances, and database size — without touching the underlying module code. When the platform team releases a new module version that adds mandatory security labels to all Cloud Run services, each service team runs `terraform apply` against the new module version. The change is tracked in the module's changelog; the Terraform plan shows exactly which resource attributes will change before any infrastructure is modified. Remote state in Cloud Storage ensures that two engineers cannot simultaneously modify the same service's infrastructure.

### 💡 Additional Infrastructure Management Objectives & Learning Guidelines

*   **Config Connector:** For teams already using Kubernetes, Config Connector allows managing GCP resources (Cloud SQL, Pub/Sub topics, IAM bindings) using Kubernetes-style YAML manifests applied via `kubectl`. Explore Config Connector documentation to understand when it complements or replaces Terraform in a GKE-centric workflow.
*   **Infrastructure Drift Detection:** Understand how `terraform plan` detects drift between the declared configuration and the actual resource state. Practice running `terraform plan` after manually changing a Cloud Run service's concurrency setting via the Console — the plan will show the drift and propose correcting it.
*   **Project-Level Bootstrap Prerequisites — IAP OAuth Consent Screen:** Enabling Identity-Aware Proxy (`enable_iap = true` in App_CloudRun Group 15 or App_GKE Group 17) requires a one-time project-level setup step that cannot be automated by Terraform: the GCP project must have an **OAuth consent screen** configured before an IAP backend service can be created. Navigate to **APIs & Services → OAuth consent screen** to configure this — choose "Internal" for corporate Google Workspace users or "External" for public-facing applications. This is an example of a project bootstrapping prerequisite that must be in place before IaC can provision application-layer access controls. The App_CloudRun Deployment Prerequisites section documents this as a Tier 3 soft prerequisite. When bootstrapping a new GCP project for an application that will use IAP, include the OAuth consent screen setup in your project provisioning runbook alongside enabling billing, APIs, and initial IAM bindings.
*   **Naming Conventions Enforced by IaC (`deployment_id` and `tenant_deployment_id`):** The module documentation (Group 0 in both App_CloudRun and App_GKE) contains an important governance principle: the `deployment_id` and `tenant_deployment_id` variables are embedded in the names of every resource created — Cloud Run services, GKE namespaces, Cloud SQL instances, GCS buckets, and secrets. Once set, these values must not change, because a change would cause Terraform to destroy and recreate all named resources under a new name, leaving the originals orphaned and running. This demonstrates a key IaC governance practice: **naming conventions should be decided and encoded before first deployment**, not retrofitted after resources exist. Use `tenant_deployment_id` values that reflect environment and team (e.g., `prod`, `staging`, `dev`, or `team-payments-prod`) — consistent naming enables cost attribution by label, access control by resource name pattern, and operational clarity across multi-team projects.

---

## 1.3 Designing a CI/CD architecture stack

**Concept:** Designing robust, automated pipelines for continuous integration (building and validating code) and continuous delivery (releasing to environments progressively and safely).

**In the Terraform Codebase:**
The codebase shows a complete CI/CD lifecycle:

*   **Cloud Build (CI):** Review `trigger.tf` in either module. It configures a `google_cloudbuild_trigger` that reacts to source code changes, builds container images using Kaniko (a daemonless, rootless container image builder that runs securely inside Cloud Build without requiring Docker daemon privileges), and pushes them to Artifact Registry.
*   **Artifact Registry (Image Store):** Images are pushed to Artifact Registry with an immutable tag derived from the Git commit SHA (`$COMMIT_SHA`). Using commit SHAs rather than mutable tags like `latest` ensures that the exact image deployed to production can always be traced back to a specific code commit.
*   **Cloud Deploy (CD):** Review `skaffold.tf`. It configures `google_clouddeploy_delivery_pipeline` and `google_clouddeploy_target` resources, defining the promotion path from dev → staging → production. Skaffold manages the rendering and deployment of Kubernetes manifests or Cloud Run services at each stage.
*   **Binary Authorization:** When `enable_binary_authorization` is configured, Cloud Build generates a cryptographic attestation (SLSA provenance) for the built image and stores it in Artifact Registry. Binary Authorization enforces at deploy time that only attested, policy-compliant images can be deployed — preventing unverified or manually pushed images from reaching production.

**Console Exploration:**
*   Navigate to **Cloud Build > Triggers** to inspect how source repository changes trigger builds. Review the build steps — note the `kaniko` executor for the image build step and the `gcloud deploy releases create` step for initiating CD.
*   Navigate to **Cloud Build > History** to view recent build executions. Click a build to see the step-by-step log output, duration, and pass/fail status.
*   Navigate to **Artifact Registry > Repositories** to see the stored images. Click an image to view its tags (commit SHA), digest (content hash), and vulnerability scan results.
*   Navigate to **Cloud Deploy > Delivery pipelines** to observe the progressive delivery configuration. Select a pipeline and inspect how releases are promoted across stages.
*   Navigate to **Security > Binary Authorization** to view the attestation policy and which attestors are required before a deployment can proceed.

> **Real-World Example:** A retail company's Cloud Build pipeline runs on every push to the `main` branch. The pipeline: (1) builds the container image with Kaniko and tags it with the commit SHA; (2) runs `gcloud artifacts docker images scan` to check for known CVEs — the build fails if any CRITICAL vulnerabilities are found; (3) creates a Cloud Build attestation confirming the image passed the vulnerability gate; (4) creates a Cloud Deploy release targeting the `dev` stage. The dev deployment is automatic; staging requires a manual promotion in the Cloud Deploy console; production requires two approvers to confirm in the Cloud Deploy approval UI. Binary Authorization enforces that only images with a valid Cloud Build attestation can reach the production Cloud Run service — a developer cannot push an arbitrary image directly to production even with sufficient IAM permissions.

### 💡 Additional CI/CD Architecture Objectives & Learning Guidelines

*   **SLSA Supply Chain Security:** SLSA (Supply-chain Levels for Software Artifacts) is a framework for describing the integrity of a software supply chain. Cloud Build can generate SLSA Level 3 provenance — a signed statement of what was built, from what source, by what build system, with what steps. Navigate to **Artifact Registry**, select an image, and look for the SLSA provenance attestation. Understand how this provenance is used by Binary Authorization to enforce supply chain policies.
*   **Artifact Analysis:** Navigate to **Artifact Registry > Repositories**, select an image, and view the **Vulnerabilities** tab. Artifact Analysis (formerly Container Analysis) automatically scans images for CVEs from the National Vulnerability Database. Understand how to configure alerts when new vulnerabilities are discovered in already-deployed images.

---

## 1.4 Managing multiple environments

**Concept:** Securely separating and managing different stages of the application lifecycle (development, staging, production) while maintaining environment parity to ensure pre-production tests accurately reflect production behaviour.

**In the Terraform Codebase:**
The Terraform modules use variables (`deployment_region`, `min_instance_count`, `application_config`, `cloud_deploy_stages`) to deploy identical infrastructure across different environments while tuning parameters specific to each stage:

*   **Environment parity:** The same module code (`modules/App_CloudRun` or `modules/App_GKE`) is used for all environments — only the `terraform.tfvars` values differ. This guarantees that if a configuration works in staging, it will work identically in production.
*   **Scaling differentiation:** Lower `min_instance_count` and `max_instance_count` values in development reduce costs. Production values are set to handle peak load.
*   **Feature flags per environment:** `application_config` variables can pass environment-specific feature flags (as environment variables) to the container, enabling feature toggles without code changes.
*   **Cloud Deploy stages:** The `cloud_deploy_stages` variable defines the promotion path. Dev may auto-promote; production requires approval. Each stage maps to a separate Cloud Deploy target, which may be a different Cloud Run service or GKE namespace.

**Console Exploration:**
*   Examine `variables.tf` in `modules/App_CloudRun` and `modules/App_GKE` to see how inputs parameterise configurations like instance counts, scaling limits, and environment-specific settings.
*   Navigate to **Cloud Deploy > Delivery pipelines** and select a pipeline. Observe that each stage (dev, staging, prod) maps to a distinct Cloud Run service or GKE target. Click **Promote** on a release to understand the manual promotion workflow.
*   Navigate to **Cloud Run** and compare the revision configuration (min/max instances, environment variables, concurrency) between a development service and a production service to see how the same module produces differently-tuned deployments.

> **Real-World Example:** A SaaS company runs dev, staging, and production as three separate GCP projects (enforcing network and IAM isolation between environments). All three environments use the identical `App CloudRun` Terraform module. The dev project uses `min_instance_count = 0` (scale to zero, no cost when idle) and `max_instance_count = 2`. Production uses `min_instance_count = 3` (always-warm, no cold starts) and `max_instance_count = 50`. A new payment feature is gated behind a feature flag passed as an environment variable (`ENABLE_NEW_PAYMENT_FLOW=true`). The flag is enabled in dev and staging for testing, but left as `false` in production until the A/B test confirms the rollout is safe — all without a code change or redeployment.

### 💡 Additional Environment Management Objectives & Learning Guidelines

*   **Environment-Specific IAM:** Each environment project should have distinct service accounts and IAM bindings. Developers may have `roles/editor` in dev but only `roles/viewer` in production. Understand how Cloud Deploy service accounts are scoped — the Cloud Deploy runner needs `roles/run.developer` on the target Cloud Run service, scoped per project so that the staging deployer cannot accidentally deploy to production.
*   **Promoting Configuration with Code:** A common pitfall is allowing environment-specific configuration (database connection strings, API keys) to diverge between staging and production over time, breaking environment parity. The recommended pattern is to store all configuration in Secret Manager per environment, with secret names following a convention (e.g., `db-password-staging`, `db-password-production`) — the application code references the secret name, not the value, and the module populates the correct secret per environment.
