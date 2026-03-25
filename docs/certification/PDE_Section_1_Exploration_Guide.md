# PDE Certification Preparation Guide: Exploring Section 1 (Bootstrapping and maintaining a Google Cloud organization)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification. It focuses specifically on Section 1 of the exam guide (which covers ~20% of the exam) by walking you through how these concepts are practically implemented in the provided Terraform codebase (`modules/App_CloudRun` and `modules/App_GKE`). By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical DevOps and SRE topics.

---

## 1.2 Managing infrastructure
### Concept
Utilizing infrastructure-as-code (IaC) to manage environments efficiently and repeatedly.

### Implementation Context
The repository leverages **Terraform** extensively. The `App_CloudRun` and `App_GKE` modules define full-stack environments. By reviewing `main.tf`, `variables.tf`, and specific resource files (e.g., `service.tf`, `deployment.tf`), candidates see how Google-recommended practices for modular IaC are applied. Terraform resources like `google_cloud_run_v2_service` or GKE workloads (`kubernetes_deployment_v1`) are defined declaratively, allowing automated creation, updating, and versioning of the cloud infrastructure.

### Exploration
*   Navigate to the specific terraform module directories (`modules/App_CloudRun` and `modules/App_GKE`).
*   Examine `main.tf`, `variables.tf`, and specific resource files like `service.tf` or `deployment.tf`.
*   Observe the declarative syntax and the way resources are linked together to provide a full stack application platform.

## 1.3 Designing a CI/CD architecture stack
### Concept
Designing robust pipelines for continuous integration and delivery.

### Implementation Context
The platform configures a complete CI/CD lifecycle using Cloud Build for continuous integration to build images and Cloud Deploy for continuous delivery to automate release deployments. Review `trigger.tf` in either module. It configures a Cloud Build trigger (`google_cloudbuild_trigger`) that reacts to source code changes, builds container images using Kaniko, and pushes them to Artifact Registry. Review `skaffold.tf`. It sets up Google Cloud Deploy (`google_clouddeploy_delivery_pipeline` and `google_clouddeploy_target`), integrating with Skaffold to manage progressive rollouts across environments (e.g., staging to production).

### Exploration
*   Open the GCP console and navigate to **Cloud Build > Triggers** to inspect how the repository triggers builds.
*   Navigate to **Cloud Deploy > Delivery pipelines** to observe the progressive delivery configuration. 
*   Review `trigger.tf` and `skaffold.tf` within the module codebase to see the Terraform definitions.

## 1.4 Managing multiple environments
### Concept
Securely separating and managing different stages of the application lifecycle.

### Implementation Context
The Terraform modules use variables (like `deployment_region`, `min_instance_count`, and `application_config`) to allow operators to deploy identical infrastructure across different environments while tuning parameters specific to the stage (e.g., lower scaling limits in dev vs. prod). Reusing identical modules (`App_CloudRun` or `App_GKE`) with different variable values allows maintaining environment parity, which ensures that pre-production tests accurately reflect production environments.

### Exploration
*   Check out the `variables.tf` files in the Terraform modules to see how inputs parameterize configurations like instance counts, scaling limits, and environment-specific settings.
*   Observe how these parameters are passed down to resources (e.g. `service.tf`, `skaffold.tf`, etc.) to control behavior at different stages.
