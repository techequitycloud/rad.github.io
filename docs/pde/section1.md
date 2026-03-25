# Bootstrapping and maintaining a Google Cloud organization
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section1.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pde_section1.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pde_section1.pdf)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud DevOps Engineer (PDE) certification. It focuses specifically on Section 1 of the exam guide (which covers ~20% of the exam) by walking you through how these concepts are practically implemented using the platform deployment portal. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical DevOps and SRE topics.

---

## 1.2 Managing infrastructure
### Concept
Utilizing infrastructure-as-code (IaC) to manage environments efficiently and repeatedly.

### Implementation Context
The repository leverages **the platform** extensively. The `App_CloudRun` and `App_GKE` deployments define full-stack environments. By reviewing the deployment configuration, the deployment configuration, and specific resource files (e.g., the deployment configuration, the deployment configuration), candidates see how Google-recommended practices for modular IaC are applied. the platform resources like `google_cloud_run_v2_service` or GKE workloads (Kubernetes Deployments) are defined declaratively, allowing automated creation, updating, and versioning of the cloud infrastructure.

### Exploration
*   Navigate to the specific the platform deployment directories (`deployments/App_CloudRun` and `deployments/App_GKE`).
*   Review the configuration options in the deployment portal, the deployment configuration, and specific resource files like the deployment configuration or the deployment configuration.
*   Observe the declarative syntax and the way resources are linked together to provide a full stack application platform.

## 1.3 Designing a CI/CD architecture stack
### Concept
Designing robust pipelines for continuous integration and delivery.

### Implementation Context
The platform configures a complete CI/CD lifecycle using Cloud Build for continuous integration to build images and Cloud Deploy for continuous delivery to automate release deployments. It configures a Cloud Build trigger (Cloud Build trigger) that reacts to source code changes, builds container images using Kaniko, and pushes them to Artifact Registry. It sets up Google Cloud Deploy, integrating with Skaffold to manage progressive rollouts across environments (e.g., staging to production).

### Exploration
*   Open the GCP console and navigate to **Cloud Build > Triggers** to inspect how the repository triggers builds.
*   Navigate to **Cloud Deploy > Delivery pipelines** to observe the progressive delivery configuration.
*   Review the CI/CD configuration options in the deployment portal.

## 1.4 Managing multiple environments
### Concept
Securely separating and managing different stages of the application lifecycle.

### Implementation Context
The the platform deployments use variables (like `deployment_region`, `min_instance_count`, and `application_config`) to allow operators to deploy identical infrastructure across different environments while tuning parameters specific to the stage (e.g., lower scaling limits in dev vs. prod). Reusing identical deployments (`App_CloudRun` or `App_GKE`) with different variable values allows maintaining environment parity, which ensures that pre-production tests accurately reflect production environments.

### Exploration
*   Check out the the deployment configuration files in the the platform deployments to see how inputs parameterize configurations like instance counts, scaling limits, and environment-specific settings.
*   Observe how these parameters are passed down to resources (e.g. the deployment configuration, the deployment configuration, etc.) to control behavior at different stages.
