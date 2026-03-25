# Configuring access and security
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section4.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section4.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/ace_section4.pdf)

This guide is designed to help candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification. It focuses specifically on Section 4 of the exam guide by walking you through how these concepts are practically implemented using the platform deployment portal. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 4.2 Managing service accounts

### Using service accounts in IAM policies with minimum permissions
**Concept:** Ensuring that compute resources run under restricted identities rather than highly privileged default accounts.
*   **Custom Service Accounts:** As mentioned, the deployments strictly use dedicated custom service accounts (`cloud_run_sa`, `gke_sa`, and `cloud_build_sa`) rather than the default compute service account. Review the configuration options in the deployment portal where these accounts are created, and the deployment configuration where specific roles (like `roles/cloudsql.client` or `roles/artifactregistry.writer`) are applied to them. This adheres to security best practices and the principle of least privilege.
*   **Workload Identity (GKE):** In the `App_GKE` deployment, explore the deployment configuration and the deployment configuration to see how Workload Identity securely maps a Kubernetes Service Account (KSA) defined in the deployment configuration (e.g., `kubernetes_service_account_v1`) to the Google Service Account (GSA) using the `roles/iam.workloadIdentityUser` binding. This allows pods to natively authenticate to Google Cloud APIs without managing JSON keys.
*   **Exploration:** In the GCP Console, navigate to **IAM & Admin > Service Accounts**. Locate the `cloud_run_sa` or `gke_sa` service account. Click on the "Permissions" tab to verify exactly which roles it holds, confirming that it only has access to the resources required by the application (e.g., Secret Manager, Cloud SQL).

### Securing Secrets
**Concept:** Protecting sensitive configuration data from being exposed in source code, environment variables, or the platform state files.
*   **Secret Manager Integration (Cloud Run):** Review the configuration options in the deployment portal in `App_CloudRun`. The deployment uses Secret Manager to store sensitive configurations. Crucially, notice how the deployment configuration maps these secrets to environment variables (`secret_environment_variables`) at runtime, meaning the plaintext secret is never exposed.
*   **Secret Manager Integration (GKE):** Review the configuration options in the deployment portal in `App_GKE`. The deployment utilizes Kubernetes secrets alongside Google Secret Manager data sources. The actual secret values are fetched dynamically during deployment, keeping them out of source control. Alternatively, GKE clusters often use the Secret Manager CSI provider to mount secrets as volumes directly. Review the configuration options in the deployment portal to see how automated secret rotation is implemented via Cloud Run Jobs / Kubernetes CronJobs and Eventarc/PubSub triggers to regularly cycle database credentials.
*   **Exploration:** Navigate to **Security > Secret Manager** in the GCP Console. View the list of secrets provisioned for the application. Click on a specific secret (e.g., the database password). Notice that you cannot see the value without explicit permission. Look at the "Versions" tab to see the history of secret rotations, and the "Permissions" tab to confirm that only the `cloud_run_sa` or `gke_sa` service account is granted the `Secret Accessor` role.

### Identity-Aware Proxy (IAP)
**Concept:** Controlling application access based on user identity and context, removing the need for traditional VPNs.
*   **Zero-Trust Access (Cloud Run):** Review the configuration options in the deployment portal and the `enable_iap` variable in the deployment configuration. The application deployment supports configuring IAP to restrict application access to authenticated Google users or Workspace groups, evaluating policies at the edge before traffic ever reaches the backend Cloud Run service.
*   **Zero-Trust Access (GKE):** Similarly, the `App_GKE` deployment in the deployment configuration configures `google_iap_web_backend_service_iam_binding` to secure the Gateway API Backend Service, providing identical Zero-Trust access to Kubernetes workloads based on Google identities, completely shielding the cluster from unauthenticated external internet traffic.
*   **Exploration:** In the GCP Console, navigate to **Security > Identity-Aware Proxy**. Locate the backend service associated with your Cloud Run deployment or GKE Gateway API. Notice the toggle switch indicating whether IAP is enabled. Look at the right-hand panel to view the access list, showing exactly which users, groups, or domains have been granted the `IAP-secured Web App User` role to access the application.

### Defining Internal Access Controls (GKE)
**Concept:** Implementing defense-in-depth networking to restrict pod-to-pod communication.
*   **Network Policies (GKE):** The application deployment goes a step further in the deployment configuration by defining Kubernetes network policies. This ensures that even if a pod within the namespace is compromised, lateral movement is strictly restricted (e.g., denying ingress from all namespaces except the Gateway API or specific whitelisted pods).
*   **Exploration:** In the GCP Console, navigate to **Kubernetes Engine > Workloads**, select your deployment, and view the "Networking" section to inspect assigned labels and selectors that drive these network policies. Alternatively, use `kubectl describe networkpolicies -n <namespace>` via Cloud Shell.
