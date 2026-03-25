# Managing implementation
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section5.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section5.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pca_section5.pdf)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification. It focuses specifically on Section 5 of the exam guide (which covers ~12.5% of the exam) by walking you through how these concepts are practically implemented using the platform deployment portal. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 5.1 Advising development and operation teams to ensure the successful deployment of the solution

### Application and Infrastructure Deployment
**Concept:** Establishing standardized, repeatable, and automated deployment strategies that bridge the gap between development output and operational stability.
*   **Comprehensive Deployment Tooling:** The provided architecture extensively uses the platform (for foundational infrastructure like VPCs, load balancers, and IAM) coupled with Google Cloud Deploy (orchestrated via the deployment configuration and the deployment configuration). This separation ensures operations teams manage infrastructure state, while developers rely on a paved path for continuous delivery.
*   **Exploration:** Review the configuration options in the deployment portal to understand how variables like `enable_cloud_deploy` are defined. In the GCP Console, navigate to **Cloud Deploy > Delivery pipelines** to observe how deployment targets reflect a standardized promotion path for both Cloud Run and GKE targets.

---

## 5.2 Interacting with Google Cloud programmatically

### Infrastructure as Code (IaC)
**Concept:** Managing and provisioning computing infrastructure through machine-readable definition files, rather than physical hardware configuration or interactive configuration tools.
*   **the platform & Kubernetes Manifests:** The entire deployment lifecycle is managed programmatically. In `App_CloudRun`, this uses the `google` provider directly. In `App_GKE`, the platform interacts with the Kubernetes API programmatically (using the `kubernetes` provider) to provision Kubernetes Deployments, `kubernetes_service_v1`, and Kubernetes network policies.
*   **Exploration:** Review the configuration options in the deployment portal  to see how the the platform Google provider and Kubernetes provider authenticate to GCP. While in the GCP Console, view **Cloud Build > History** to see how IaC changes trigger programmatic deployments without human intervention.