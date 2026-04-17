# PDE Certification Preparation Guide: Section 1 — Bootstrapping and maintaining a Google Cloud organization (~20% of the exam)

This guide helps candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification explore Section 1 of the exam. It walks you through how these concepts are practically implemented in the provided Terraform codebase (`modules/App_CloudRun` and `modules/App_GKE`). By exploring the GCP Console and corresponding code, you will gain hands-on context for these critical DevOps topics.

Three modules are relevant to this section: **App CloudRun**, which deploys serverless containerised applications on Cloud Run; **App GKE**, which deploys containerised workloads on GKE Autopilot; and **GCP Services**, which provides the shared foundational infrastructure consumed by both application modules.

---

## 1.1 Designing the overall resource hierarchy

**Concept:** Structuring a Google Cloud organization using the resource hierarchy (Organisation → Folders → Projects → Resources) to enforce governance, isolate environments, and enable scalable IAM and billing management.

**In the Terraform Codebase:**
The RAD platform provisions all resources within a defined project, but understanding the hierarchy above the project level is essential for the PDE exam. The `modules/App_GCP` module configures project-scoped resources. In a production landing zone, the project itself would sit within a folder structure (e.g., `corp/production/app-team`) enforced by the organization.

Examine `modules/App_GCP/main.tf` to understand which APIs are enabled and which IAM bindings are created at the project level. The separation between `GCP Services` (shared services), `App CloudRun` (application workload), and `App GKE` (application workload) mirrors the separation-of-concerns principle applied to real folder and project hierarchies.

**Console Exploration:**
*   Navigate to **IAM & Admin > Resource Manager** to view the project's position within the organization hierarchy.
*   Navigate to **IAM & Admin > Organization Policies** to view the constraint policies applied at the organization or folder level that flow down to this project. Relevant constraints include `constraints/compute.requireOsLogin`, `constraints/iam.disableServiceAccountKeyCreation`, and `constraints/compute.restrictCloudRunRegion`.
*   Navigate to **Billing > Budgets & alerts** to see how billing budgets (configured via the `create_billing_budget` variable) provide financial governance guardrails at the project level.

> **Real-World Example:** A financial services organization structures its Google Cloud hierarchy as: Organization → `Corp` folder → `Production` and `Non-Production` folders → individual project per application team per environment (e.g., `payments-prod`, `payments-staging`). An organization policy at the `Non-Production` folder level enforces `constraints/compute.restrictCloudRunRegion` to `us-central1` only — keeping developer experimentation costs low. A separate policy at the `Production` folder enforces `constraints/iam.disableServiceAccountKeyCreation` — preventing any JSON key files from being created in production projects. Both policies are defined in Terraform using `google_org_policy_policy` resources and applied to folders, flowing down automatically to all child projects without per-project configuration.

### 💡 Additional Resource Hierarchy Objectives & Learning Guidelines

*   **Cloud Foundation Toolkit and Fabric FAST:** Google provides two Google-supported reference architectures for bootstrapping an organization at scale. The [Cloud Foundation Toolkit](https://cloud.google.com/foundation-toolkit) is a library of Terraform modules that implement Google's recommended practices for resource hierarchy, networking, IAM, and logging. [Fabric FAST](https://github.com/GoogleCloudPlatform/cloud-foundation-fabric/tree/master/fast) is a more opinionated end-to-end bootstrap. Explore the Terraform blueprints console at **Solutions > Deploy** to understand the reference patterns.
*   **Labels and Tags for Governance:** Labels (key-value pairs on resources, e.g., `env=production`, `team=payments`) enable cost allocation and policy-driven resource management. Review how resources in `modules/App_GCP/main.tf` apply labels, then navigate to **Billing > Reports** and group by label to see per-team cost attribution.
*   **Billing Account Structure:** Understand that a Billing Account sits outside the resource hierarchy — it is linked to projects but belongs to the organization node. Multiple billing accounts (e.g., one per business unit) allow independent budget tracking and chargeback to separate cost centres.
*   **Multi-Project Monitoring with Scoping Projects:** A Google Cloud organization typically spans many projects — each team running their own project. Cloud Monitoring supports aggregating metrics, logs, and dashboards from multiple projects into a single *metrics scope* by adding them as monitored projects to a central scoping project. Navigate to **Monitoring > Settings > Add GCP projects** to configure a scoping project. This allows a platform team to view all services' SLIs on one dashboard without switching projects. For the PDE exam, understand that metrics from monitored projects are readable by the scoping project but not vice versa — IAM permissions on each monitored project still control access.
*   **Data Residency and Compliance Constraints:** Organization policies enforce where data can reside. The `constraints/gcp.resourceLocations` policy restricts which regions resources can be deployed in — critical for GDPR (EU data residency) and data sovereignty requirements. Navigate to **IAM & Admin > Organization Policies > Resource Location Restriction** to explore this constraint. Understand that Cloud Logging also supports configuring log bucket regions — use `_Default` log bucket region overrides to ensure logs for a project remain in a specified region rather than being stored in the default `global` bucket.
*   **Private Service Connect for Cross-Project Service Access:** When services in different projects (e.g., a shared database team's Cloud SQL in a services project, and an application team's Cloud Run in a separate app project) need to communicate securely without public IPs or VPC peering, Private Service Connect (PSC) provides a targeted endpoint. The database team publishes their Cloud SQL instance via a PSC service attachment; the application team creates a PSC endpoint IP in their own VPC pointing to that attachment. Traffic never traverses the public internet and no VPC peering is required. Navigate to **VPC Network > Private Service Connect** to explore published services and endpoints.

---

## 1.2 Managing infrastructure

**Concept:** Utilizing infrastructure-as-code (IaC) to manage environments efficiently, repeatedly, and with full auditability.

**In the Terraform Codebase:**
The repository uses Terraform extensively. The **App CloudRun** and **App GKE** modules define full-stack environments. By reviewing `main.tf`, `variables.tf`, and specific resource files (e.g., `service.tf`, `deployment.tf`), candidates see how Google-recommended IaC practices are applied. Terraform resources like `google_cloud_run_v2_service` or GKE workloads (`kubernetes_deployment_v1`) are defined declaratively, enabling automated creation, updating, and versioning of cloud infrastructure.

Key IaC practices demonstrated in the codebase:
*   **Remote state:** Terraform state is stored in Cloud Storage buckets (not locally), enabling team collaboration and preventing state file conflicts. Review the backend configuration in the root module.
*   **Module versioning:** The `GCP Services`, `App CloudRun`, and `App GKE` modules are versioned independently — a change to `GCP Services` does not force a redeploy of application modules. This mirrors the module registry versioning pattern recommended for enterprise IaC.
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
*   **Infrastructure Manager:** Infrastructure Manager is Google Cloud's managed Terraform service — it runs Terraform operations (`terraform plan` and `terraform apply`) inside Google Cloud without requiring local Terraform installation or managing state buckets manually. It integrates natively with Cloud Build, IAM, and Cloud Audit Logs. Navigate to **Infrastructure Manager > Deployments** to create a deployment from a Terraform configuration stored in Cloud Storage or a connected source repository. Infrastructure Manager handles state locking, remote state storage, and audit logging of every apply operation — providing a fully managed alternative to self-managed Terraform pipelines for teams without dedicated platform engineering capacity.
*   **Helm for Kubernetes Package Management:** Helm is the standard package manager for Kubernetes applications, bundling Kubernetes manifests (Deployments, Services, ConfigMaps, HPA) into versioned, parameterisable charts. In a GKE-based CI/CD pipeline, Cloud Build installs Helm and runs `helm upgrade --install <release> <chart> -f values-production.yaml` to deploy or update a release. Helm templating allows environment-specific values (replica counts, image tags, resource limits) to be injected at deploy time without duplicating YAML files. Navigate to **Artifact Registry** to store and version Helm charts (Artifact Registry supports OCI-format chart storage with `helm push`). Understand `helm rollback <release> <revision>` for instant rollbacks to a previous chart version.
*   **Infrastructure as Code with Cloud Foundation Blueprints:** Google Cloud provides pre-built Terraform blueprints for common infrastructure patterns (GKE clusters with security hardening, Cloud Run services with VPC egress, multi-region load balancing). Navigate to **Solutions > Jump Start Solutions** to deploy and inspect these blueprints. Use blueprints as learning references — examining their Terraform structure reveals Google-recommended practices for IAM binding patterns, network segmentation, and logging configuration that would otherwise require extensive documentation reading.

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
*   **Argo CD for GitOps Continuous Delivery:** Argo CD is a declarative GitOps continuous delivery tool for Kubernetes. Rather than having CI pipelines push deployments imperatively (`kubectl apply`, `helm upgrade`), Argo CD continuously monitors a Git repository as the source of truth for desired cluster state and reconciles the cluster to match. In a Cloud Build + Argo CD architecture, the CI pipeline updates the image tag in a Helm values file in the GitOps repo; Argo CD detects the change and applies the update to the GKE cluster. Navigate to the **Google Kubernetes Engine** marketplace to install Argo CD, then explore the Argo CD web UI to see application sync status, diff between desired and live state, and rollback capabilities. Argo CD is increasingly the preferred CD pattern for GKE-centric organisations due to its auditability (all changes in Git) and self-healing (drift is automatically corrected).
*   **kpt for Kubernetes Configuration Management:** kpt is a Google-developed, Git-native tool for managing Kubernetes configurations as packages. Unlike Helm (which uses templates), kpt stores plain Kubernetes YAML and uses a pipeline of KRM (Kubernetes Resource Model) functions to transform and validate configurations. In a CI/CD pipeline, `kpt fn render` applies a chain of configuration functions (e.g., set image tags, add labels, validate against policy constraints) to a package directory before deploying to GKE. Navigate to **Cloud Shell** and install kpt to explore its `pkg get`, `fn eval`, and `live apply` commands. kpt integrates with Config Sync for cluster configuration management and with Anthos Config Management policy enforcement.
*   **Packer for Golden VM Image Builds:** For Compute Engine-based workloads or GKE Standard node pools with custom node images, Packer automates the creation of "golden images" — pre-configured VM images with the OS, security hardening, monitoring agents, and application runtime pre-installed. Integrating Packer into a Cloud Build pipeline (`packer build config.pkr.hcl`) produces a new custom image in Compute Engine Image registry after each base OS update. Nodes launched from this image start faster (no bootstrapping delay) and with a known-good security baseline. Navigate to **Compute Engine > Images** to view custom images and their source disk information.

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
*   **GKE Fleets for Multi-Cluster Environment Management:** For organisations running multiple GKE clusters (e.g., one per environment per region), GKE Fleets provide a unified management plane. A Fleet is a logical grouping of GKE clusters registered to a common fleet host project. Fleet-level features include: cross-cluster Config Sync (applying Kubernetes configurations to all fleet member clusters simultaneously), cross-cluster Service Mesh (extending mTLS and traffic management across clusters), and Fleet Workload Identity (consistent service account mapping across clusters). Navigate to **Kubernetes Engine > Fleet management** to register clusters and configure fleet-scope features. Fleets are the recommended architecture for multi-region, multi-environment GKE deployments where consistent policy enforcement across all clusters is required.
*   **Ephemeral Environments for Pull Request Testing:** Ephemeral environments are short-lived, fully functional copies of an application stack spun up automatically for a specific pull request or feature branch and destroyed after merging. In a Cloud Build + Cloud Run architecture, a Cloud Build trigger fires on pull request creation, deploys a Cloud Run service with a PR-specific tag (e.g., `review-app-pr-42`), and posts the service URL as a PR comment. This allows reviewers to test the actual running application — not just review code — before merging. On PR close, a cleanup trigger deletes the Cloud Run service. This pattern requires no persistent environment resources and costs only for the duration of the PR lifecycle.
*   **Automated OS Patching with OS Config:** For Compute Engine VMs and GKE Standard node pools, OS Config provides automated patch management — applying OS security updates on a configurable schedule without manual SSH access. Navigate to **Compute Engine > VM Manager > Patch Management** to create a patch deployment targeting a set of VMs (filtered by labels) on a weekly schedule, with a maintenance window and rollout strategy (rolling or all-at-once). OS Config patch compliance reports show which VMs have applied recent patches versus which have outstanding security updates — critical for compliance audits. For GKE Autopilot, node OS patching is managed entirely by Google, eliminating this operational burden.

---

## 1.5 Using developer tooling and AI assistance

**Concept:** Using Google Cloud developer environments and AI coding assistants to accelerate infrastructure and application development workflows — writing IaC, debugging deployments, generating configuration, and navigating unfamiliar services faster.

### Cloud Workstations and Cloud Shell
**Concept:** Provisioning consistent, secure, cloud-hosted development environments that keep source code and credentials within Google Cloud — particularly important for organizations with data security or compliance requirements.

**Cloud Shell** is a browser-accessible terminal in the GCP Console with all developer tools pre-installed: `gcloud`, `kubectl`, Terraform, Helm, Docker, Python, Node.js, Go, and Java. Cloud Shell includes a persistent 5 GB home directory and **Cloud Shell Editor** (an in-browser VS Code instance) for editing files without any local setup. Cloud Shell is ideal for ad-hoc exploration, running one-off `terraform plan` executions, and debugging GKE clusters from any machine with a browser. Open Cloud Shell from any console page by clicking the `>_` icon in the top toolbar.

**Cloud Workstations** is a fully managed, cloud-hosted development environment service that provisions dedicated, persistent VMs with your chosen IDE (VS Code, JetBrains IDEs, or custom container images) and development tools. Unlike Cloud Shell (shared, ephemeral, limited compute), Cloud Workstations provides:
- Dedicated persistent VMs with configurable machine types (up to 32 vCPUs) and disk sizes — suitable for resource-intensive development (compiling large codebases, running local containers).
- Consistent, reproducible environments across a team — every developer uses an identical pre-configured workstation image defined in Terraform.
- Source code and credentials never leave Google Cloud — the workstation VM sits in your VPC, accessed via IAP tunnelling with no public IP.
- Access control via Cloud IAM (`roles/workstations.workstationUser`) and IAP — no VPN required.

Navigate to **Cloud Workstations > Workstation clusters** to explore cluster configuration, then **Cloud Workstations > Workstation configurations** to see how workstation images and machine types are defined. For the PDE exam, understand the security model: a workstation is accessed via a browser or SSH over IAP — the browser-based IDE does not expose any port directly to the public internet.

> **Real-World Example:** A financial services company requires that all source code for production systems must remain within their GCP organization at all times — it cannot be checked out onto developer laptops. The company deploys Cloud Workstations with a custom container image pre-installed with their internal SDKs, code linting tools, and VS Code extensions. Developers access their workstation from a browser tab, write and test code inside the GCP VPC, and push commits directly from the workstation to their Cloud Source Repository — no code ever touches a laptop filesystem. When a developer leaves, their workstation is deleted and their IAM access is revoked — all work remains in the company's GCP project.

### Gemini Code Assist and Gemini Cloud Assist
**Concept:** Using Google Cloud's AI assistants to accelerate development tasks (Gemini Code Assist) and infrastructure operations (Gemini Cloud Assist) through natural-language interaction.

**Gemini Code Assist** is the developer-facing AI assistant integrated into Cloud Shell Editor, VS Code (via the Cloud Code extension), and JetBrains IDEs. For DevOps and infrastructure engineers, key capabilities include:
- **IaC generation:** Prompt "Write a Terraform resource for a Cloud Run service with Secret Manager integration and VPC connector" to generate a complete, correct resource block.
- **Kubernetes manifest generation:** Prompt "Generate a Kubernetes Deployment manifest for a Python service with readiness and liveness probes, resource requests of 200m CPU and 256Mi memory, and 3 replicas" to generate ready-to-use YAML.
- **Debugging assistance:** Paste a Terraform error message or Cloud Build failure log and ask "Explain this error and how to fix it."
- **Unit test generation:** Select a function and invoke "Generate unit tests" to produce a test suite with positive cases, error cases, and edge cases.
- **Inline completions:** As you type Terraform, Kubernetes YAML, or Python, Gemini provides context-aware multi-line completions based on the surrounding code.

**Gemini Cloud Assist** is the operations-facing AI assistant integrated into the GCP Console. Access it from the Gemini icon (sparkle) in the top navigation bar or within specific console pages (Logs Explorer, Metrics Explorer, Trace). Key capabilities for DevOps engineers:
- Ask "Why did my Cloud Run service start returning 503 errors at 14:00?" — Gemini analyses recent metrics, logs, and deployment events to generate a diagnosis.
- Ask "Show me which Cloud Build trigger last modified this Cloud Run service" — Gemini navigates the audit log on your behalf.
- Generate MQL alert conditions from natural-language descriptions: "Create an alert that fires when the 99th percentile latency for Cloud Run service `checkout` exceeds 500ms for 5 consecutive minutes."
- Summarise long log queries: "Summarise the last hour of logs from the `payments` service" — Gemini groups related errors and surfaces the most frequent issues.

Navigate to **Gemini > Cloud Assist** in the GCP Console to open the assistant panel and explore these capabilities against your deployed RAD modules.

> **Real-World Example:** A new DevOps engineer joins a team and is asked to write a Terraform module for a Cloud Run service with a Workload Identity-bound service account, Secret Manager secret injection, VPC egress via Direct VPC connector, and Cloud Armor WAF protection. With no prior Cloud Run Terraform experience, they open Gemini Code Assist in VS Code and prompt each component in sequence. Gemini generates all four resource blocks with correct IAM bindings — the engineer reviews, adjusts variable names to match team conventions, and passes a code review in the same afternoon. On the operations side, they use Gemini Cloud Assist to investigate why the development deployment is showing elevated error rates after a configuration change — Gemini correlates a Secret Manager permission error in the audit log with the deployment timestamp, identifying the missing IAM binding within 90 seconds.

### Gemini CLI
**Concept:** Using the Gemini CLI for interactive AI-assisted infrastructure operations and debugging from the terminal.

**Gemini CLI** is a command-line interface for interacting with Gemini models directly from a terminal session. In a Cloud Shell or Cloud Workstations environment, DevOps engineers use Gemini CLI to:
- Analyse command output: pipe `terraform plan` output into Gemini CLI and ask "Is there anything concerning in this plan?"
- Generate `gcloud` commands: ask "What gcloud command deploys a Cloud Run service from a container image with a custom service account and ingress set to internal-only?"
- Debug `kubectl` output: pipe `kubectl describe pod` output and ask "Why is this pod in CrashLoopBackOff?"
- Understand unfamiliar GCP APIs: "Explain what `google_compute_forwarding_rule` does and what the `load_balancing_scheme = INTERNAL_MANAGED` setting means."

Install Gemini CLI with `npm install -g @google/gemini-cli` and authenticate with `gemini auth login`. In Cloud Shell, Gemini CLI is pre-installed and authenticated using your Cloud Shell identity — no separate login required.

### 💡 Additional Developer Tooling Objectives & Learning Guidelines
*   **Cloud Code IDE Integration:** Install the Cloud Code extension in VS Code or a JetBrains IDE to access Google Cloud developer tooling directly in your local development environment. Cloud Code provides: a Kubernetes cluster browser (view pods, services, logs without `kubectl`), Cloud Run local emulator (run your Cloud Run service locally with the same environment variables as production), and Secret Manager browser (view secret names and metadata without exposing values). Navigate to **Extensions > Cloud Code** in VS Code to install and connect to your GCP project.
*   **Context Engineering for AI Tools:** The accuracy and usefulness of AI-generated code and infrastructure suggestions depends heavily on the context provided in prompts. Best practices: (1) Always include the specific GCP service version or API (e.g., "using Cloud Run v2 API" or "`google_cloud_run_v2_service` Terraform resource"); (2) Include relevant error messages verbatim rather than paraphrasing them; (3) Specify constraints (e.g., "the service account must not have project-level roles — use resource-level IAM only"); (4) For Gemini Cloud Assist, enable the MCP server integration to allow Gemini to query live infrastructure state rather than relying on general knowledge. Live context (actual resource names, current configuration values) produces significantly more accurate suggestions than abstract descriptions.
