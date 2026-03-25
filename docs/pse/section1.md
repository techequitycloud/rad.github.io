# Configuring access
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pse_section1.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pse_section1.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pse_section1.pdf)

This guide is designed to help candidates preparing for the Google Cloud Professional Security Engineer (PSE) certification. It focuses specifically on Section 1 of the exam guide (Configuring access, which covers ~25% of the exam) by walking you through how these concepts are practically implemented in Google Cloud. By exploring the Google Cloud Platform (GCP) console, you will gain hands-on context for these critical security topics. You can experiment with these configurations directly through your web-based deployment portal.

---

## 1.1 Managing Cloud Identity

### Concept
Managing Cloud Identity and Workspace environments for IAM bindings. While the environment does not directly configure identity providers, the underlying architecture relies on properly managed Cloud Identity and Workspace environments.

### Implementation Context
*   **Workforce Identity Federation:** Identity-Aware Proxy (IAP) relies on Cloud Identity groups and users to grant access to the applications.

### Exploration
*   Navigate to the GCP Console **IAM & Admin > IAM**. Observe how Google Groups and individual users are utilized to grant access to resources like monitoring dashboards and Identity-Aware Proxy (IAP). Check the 'Principals' tab to see inherited organization-level group accesses.

### Customization
*   In your deployment portal, modify the `iap_authorized_groups` or `support_users` inputs to include a new test user or group. Re-deploy the application and observe how the IAM policies are updated in the GCP Console.

---

## 1.2 Managing service accounts

### Concept
Securing service accounts, applying the principle of least privilege, and implementing Workload Identity Federation.

### Implementation Context
*   **Least Privilege:** Rather than relying on default compute service accounts, dedicated service accounts are used for the workloads.
*   **Workload Identity:** The GKE deployment extensively uses Workload Identity to securely map Kubernetes service accounts to Google Cloud service accounts. This binds a Kubernetes Service Account to a GCP Service Account via the `roles/iam.workloadIdentityUser` role. This eliminates the need to manage and store service account keys as secrets.

### Exploration
*   **GKE:** Go to **Kubernetes Engine > Workloads**, select the deployed application, and view its YAML. Note the `serviceAccountName`. Then, go to **IAM & Admin > Service Accounts**, find the corresponding GCP service account, and check its permissions to see the `roles/iam.workloadIdentityUser` binding.
*   **Cloud Run:** In the GCP Console, go to **Cloud Run**. Select the service and view the **Security** tab to see the dedicated service account assigned to the revision.

### Customization
*   Temporarily assign a broader role (like `roles/editor`) to the application service account directly in the GCP Console. Note the change, but understand that re-running the deployment from your portal will revert this permission back to the least-privilege state, demonstrating Infrastructure as Code drift detection.

---

## 1.3 Managing authentication

### Concept
OAuth and Session Management for applications.

### Implementation Context
*   **Identity-Aware Proxy (IAP):** The environment integrates with IAP (configurable via `enable_iap` in the portal) to handle OAuth-based user authentication and session management at the perimeter. This ensures only authenticated users access the applications before traffic ever reaches the Cloud Run service or GKE cluster.

### Exploration
*   Navigate to **Security > Identity-Aware Proxy** in the Console. Review how resources are protected, the OAuth consent screen configuration, and which principals (users/groups) are granted access. Try accessing the application URL from an incognito window to see the Google authentication flow in action.

### Customization
*   If your deployment has IAP disabled, go to your deployment portal, toggle the `enable_iap` setting to true, and provide the necessary OAuth credentials. Deploy the changes and observe how public access is immediately revoked in favor of strict identity verification.

---

## 1.4 Managing and implementing authorization controls

### Concept
Identity and Access Management (IAM), fine-grained authorization, and adhering to the principle of least privilege.

### Implementation Context
*   **Fine-grained IAM bindings:** The environment configures fine-grained IAM bindings restricting the workload service account to exactly what it needs to function.
*   **Secrets and Storage:** The workload service account is granted `roles/secretmanager.secretAccessor` only on the specific secrets it requires (like the database password), and `roles/storage.objectAdmin` only on the specific provisioned buckets.

### Exploration
*   In the Console, navigate to **Security > Secret Manager**. Select the database password secret and review the **Permissions** tab. Observe how only the designated workload service account has the Secret Accessor role, demonstrating micro-segmentation of secrets. Navigate to **Cloud Storage**, select the provisioned bucket, and confirm that Uniform Bucket-Level Access is enforced, overriding any legacy ACLs.

### Customization
*   Create a new custom secret in Secret Manager via the console. Attempt to read this secret from inside the Cloud Run or GKE container. The request will be denied. Then, return to your deployment portal, update the `secret_environment_variables` setting to include this new secret, apply the changes, and verify that access is now granted, illustrating fine-grained authorization boundaries.

---

## 1.5 Defining the resource hierarchy

### Concept
Aligning resources logically across Organizations, Folders, and Projects to inherit policies appropriately.

### Implementation Context
*   **Project-scoped Resources:** Resources are deployed within a specific project. This relies on the Google Cloud resource hierarchy where organization policies (Org Policies) applied at the parent folder or organization level are inherited by this project.

### Exploration
*   Navigate to **IAM & Admin > Organization Policies** to view the constraints inherited by the project that houses the deployed resources, enforcing security boundaries from the top down. Look for constraints like `constraints/compute.vmExternalIpAccess` or `constraints/iam.disableServiceAccountKeyCreation`.

### Customization
*   If you have Organization Admin rights, create a custom Organization Policy on a testing folder to restrict deployment locations (e.g., `constraints/gcp.resourceLocations`). Attempt to provision a new resource via the deployment portal in a restricted region and observe the immediate failure, demonstrating how hierarchy policies override local configurations.
