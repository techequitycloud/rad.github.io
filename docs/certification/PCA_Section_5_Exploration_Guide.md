# PCA Certification Preparation Guide: Exploring Section 5 (Managing Implementation)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification. It focuses specifically on Section 5 of the exam guide (which covers ~12.5% of the exam) by walking you through how these concepts are practically implemented in the provided Terraform codebases (`modules/App_CloudRun` and `modules/App_GKE`). By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 5.1 Advising development and operation teams to ensure the successful deployment of the solution

### Application and Infrastructure Deployment
**Concept:** Establishing standardized, repeatable, and automated deployment strategies that bridge the gap between development output and operational stability.
*   **Comprehensive Deployment Tooling:** The provided architecture extensively uses Terraform (for foundational infrastructure like VPCs, load balancers, and IAM) coupled with Google Cloud Deploy (orchestrated via `skaffold.tf` and `trigger.tf`). This separation ensures operations teams manage infrastructure state, while developers rely on a paved path for continuous delivery.
*   **Exploration:** Review the `variables.tf` file to understand how variables like `enable_cloud_deploy` are defined. In the GCP Console, navigate to **Cloud Deploy > Delivery pipelines** to observe how deployment targets reflect a standardized promotion path for both Cloud Run and GKE targets.

---

## 5.2 Interacting with Google Cloud programmatically

### Infrastructure as Code (IaC)
**Concept:** Managing and provisioning computing infrastructure through machine-readable definition files, rather than physical hardware configuration or interactive configuration tools.
*   **Terraform & Kubernetes Manifests:** The entire deployment lifecycle is managed programmatically. In `App_CloudRun`, this uses the `google` provider directly. In `App_GKE`, Terraform interacts with the Kubernetes API programmatically (using the `kubernetes` provider) to provision `kubernetes_deployment_v1`, `kubernetes_service_v1`, and `kubernetes_network_policy_v1`.
*   **Exploration:** Review `main.tf` and `provider-auth.tf` to see how the Terraform Google provider and Kubernetes provider authenticate to GCP. While in the GCP Console, view **Cloud Build > History** to see how IaC changes trigger programmatic deployments without human intervention.