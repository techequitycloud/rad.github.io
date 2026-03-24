# PCA Certification Preparation Guide: Exploring Section 3 (Designing for Security and Compliance)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification. It focuses specifically on Section 3 of the exam guide (which covers ~17.5% of the exam) by walking you through how these concepts are practically implemented in the provided Terraform codebases (`modules/App_CloudRun` and `modules/App_GKE`). By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 3.1 Designing for security

### Identity and Access Management (IAM)
**Concept:** Applying the principle of least privilege to ensure identities (users or machines) only have the exact permissions necessary to perform their roles.
*   **Fine-grained IAM Bindings:** Review the `iam.tf` file. Specific Google Cloud IAM roles are assigned to dedicated service accounts (e.g., `cloud_run_sa` for Cloud Run, and similar for GKE). Rather than using the default compute engine service account, distinct identities restrict lateral movement.
*   **Workload Identity (GKE):** In the `App_GKE` module, explore `sa.tf`. It leverages Workload Identity (`google_service_account_iam_member.workload_identity`) to map Kubernetes Service Accounts (`kubernetes_service_account_v1`) to Google Cloud IAM Service Accounts. This eliminates the need to download or mount static service account keys inside pods.
*   **Exploration:** In the GCP Console, navigate to **IAM & Admin > IAM** to inspect specific roles. For GKE, navigate to **Kubernetes Engine > Workloads**, select a pod, and review its security context and bound service account.

### Data Security
**Concept:** Protecting sensitive information, such as passwords, API keys, and certificates, at rest and in transit.
*   **Secret Manager Integration:** Review the `secrets.tf` file. This configuration demonstrates how sensitive data is securely stored in Google Secret Manager and dynamically injected into the application as environment variables or mounted volumes, rather than being hardcoded in plaintext. It also highlights automated rotation pipelines.
*   **Exploration:** In the GCP Console, navigate to **Security > Secret Manager**. View the provisioned secrets, examine their versions, and check the IAM permissions on the secret itself to see who (or what service account) is allowed to access the payload.

### Secure Remote Access & Network Security
**Concept:** Controlling application access securely based on user identity and context, eliminating the need for traditional VPNs or open firewall ports.
*   **Identity-Aware Proxy (IAP):** Explore the `iap.tf` configuration. IAP intercepts incoming requests via the Global Load Balancer, verifying the user's identity and authorization before allowing the request to reach Cloud Run or GKE backends.
*   **Kubernetes Network Policies:** In `App_GKE`, review `network_policy.tf`. It enforces internal network micro-segmentation, defining exactly which pods can communicate with one another.
*   **Exploration:** Navigate to **Security > Identity-Aware Proxy** in the Console. Inspect the protected resources and access lists.

### Securing Software Supply Chain
**Concept:** Ensuring that only trusted, verified, and explicitly approved artifacts (container images) are allowed to run in the production environment.
*   **Binary Authorization:** Look for the `enable_binary_authorization` variable and its implementation in `security.tf`. Binary Authorization enforces signature validation—images must be signed by trusted attestors via KMS keys before deployment is permitted in either Cloud Run or GKE.
*   **Exploration:** In the GCP Console, go to **Security > Binary Authorization**. Examine the configured policy to see how it restricts deployments to specific verified images across both Serverless and Kubernetes environments.