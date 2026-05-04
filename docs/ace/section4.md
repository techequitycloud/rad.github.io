# ACE Certification Preparation Guide: Section 4 — Configuring access and security (~20% of the exam)
<YouTubeEmbed videoId="uw32ChdWkTg" poster="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section4.png" />

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/ace_section4.pdf)



This guide helps candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification explore Section 4 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **Services GCP**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights ACE objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 4.1 Managing Identity and Access Management (IAM)

### Viewing and creating IAM policies
**Concept:** Understanding the IAM policy model and how bindings are composed to grant access.

**In the RAD UI:**
The RAD platform constructs IAM bindings automatically for every service account it creates. The IAM policy for the project is the sum of all bindings — each binding maps a role to one or more members (users, groups, service accounts, or domain identities).

**Console Exploration:**
Navigate to **IAM & Admin > IAM** to view all IAM bindings in the project. Observe:
- The **principal** (who), the **role** (what permissions), and optionally a **condition** (when/where).
- Use **Filter** to search for a specific principal or role name.
- Click **Grant access** to add a new binding — select a principal and one or more roles.
- Use **IAM conditions** to scope a role to specific resources (e.g. grant `roles/storage.objectViewer` only for objects with a specific prefix in a bucket).

Practice using the **Policy Troubleshooter** (**IAM & Admin > Policy Troubleshooter**) — enter a principal email, resource, and permission to get an instant explanation of whether access is granted and why.

### Understanding IAM role types
**Concept:** Selecting the appropriate role type for a given access requirement.

Google Cloud IAM has three role types:
- **Basic roles (primitive roles):** `roles/viewer`, `roles/editor`, `roles/owner`. These are very broad — `roles/editor` grants write access to most GCP services. Use basic roles only in development environments or for small projects where the additional management overhead of predefined roles is not justified. **Never assign `roles/owner` or `roles/editor` to service accounts in production.**
- **Predefined roles:** Curated sets of permissions scoped to a specific service and action (e.g. `roles/cloudsql.client` — only connect to Cloud SQL instances; `roles/run.invoker` — only invoke Cloud Run services). These are the recommended choice for both human users and service accounts. The RAD platform uses predefined roles exclusively.
- **Custom roles:** User-defined roles containing a specific set of permissions. Reserved for cases where no predefined role matches the required permission set. Custom roles require manual maintenance — when Google adds new API methods, custom roles do not automatically include them, potentially breaking applications.

Navigate to **IAM & Admin > Roles** to explore the predefined role catalogue. Filter by service (e.g. "Cloud Run") to see all available predefined roles for that service.

### 💡 Additional IAM Objectives & Learning Guidelines

*   **Predefined vs. Custom Roles:** The RAD platform uses predefined roles (e.g. `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`) because they are maintained by Google, kept up to date as services evolve, and represent the recommended approach for the vast majority of use cases. Navigate to **IAM & Admin > Roles** and explore the predefined role catalogue — each role lists its exact permissions. Custom roles exist for the exceptional case where a predefined role is either too permissive (grants access to more APIs than needed) and no narrower predefined role exists, or where a very specific combination of permissions across services is required that no predefined role covers. The additional operational overhead of custom roles (they must be manually updated as APIs change) means they should not be the default choice.

    > **Real-World Example:** A developer needs read-only access to Cloud Run services. The predefined `roles/run.viewer` role covers exactly this need — no custom role is required. A custom role would only be appropriate if, for example, the developer needed exactly `run.services.list` and `run.services.get` but not `run.services.getIamPolicy` (which `roles/run.viewer` includes) and there was a documented security reason to exclude that permission.

*   **Audit Logging:** Navigate to **Logging > Logs Explorer**. Query the `cloudaudit.googleapis.com` logs. Practice finding logs for Data Access (e.g., someone reading a Cloud Storage object) versus Admin Activity (e.g., someone creating a new Cloud SQL instance). Note that Data Access audit logs must be explicitly enabled per service — they are not on by default — while Admin Activity logs are always enabled and cannot be disabled.

    > **Real-World Example:** After a security incident, an administrator queries Admin Activity logs filtered by `protoPayload.methodName="SetIamPolicy"` to find every IAM policy change made in the past 30 days — revealing that an IAM binding was added to a production service account the day before the incident occurred.

*   **IAM Policy Troubleshooting:** Use the **IAM & Admin > Policy Analyzer** tool to determine exactly why a specific user does or does not have access to a specific resource (like a BigQuery dataset). Policy Analyzer traces the full IAM inheritance chain — direct bindings, group memberships, and organisation policy constraints — and returns a clear explanation of what is granting or blocking access.

---

## 4.2 Managing service accounts

### Using service accounts in IAM policies with minimum permissions
**Concept:** Ensuring that compute resources run under restricted identities rather than highly privileged default accounts.

**In the RAD UI:**
*   **Custom Service Accounts:** The RAD platform strictly uses dedicated custom service accounts (e.g., a Cloud Run SA or a GKE SA) rather than the default compute service account. The platform automatically assigns them the minimum required predefined roles (like `roles/cloudsql.client` or `roles/artifactregistry.reader`). Using the default compute service account is an anti-pattern because it is automatically granted broad Editor permissions — a violation of the principle of least privilege.

*   **Workload Identity (GKE):** In the `App GKE` module, Workload Identity securely maps a Kubernetes Service Account (KSA) to the underlying Google Service Account (GSA). This allows pods to natively authenticate to Google Cloud APIs without managing JSON keys. Workload Identity is the Google-recommended approach for GKE workloads — exporting service account JSON keys introduces key management risk (keys don't auto-rotate, can be exfiltrated, and are hard to audit).

    > **Real-World Example:** A GKE pod needs to read from a Cloud Storage bucket. Without Workload Identity, a developer might mount a service account JSON key as a Kubernetes Secret — that key could be read by anyone with access to the cluster namespace and, if leaked, grants access indefinitely until manually rotated. With Workload Identity, the pod's Kubernetes Service Account is bound to a GSA that has `roles/storage.objectViewer` on the bucket. No key is stored anywhere — credentials are ephemeral tokens exchanged automatically by the metadata server.

**Console Exploration:**
In the GCP Console, navigate to **IAM & Admin > Service Accounts**. Locate the service accounts provisioned by the RAD platform for your application. Click on the **Permissions** tab to verify exactly which roles it holds, confirming that it only has access to the resources required by the application. On the service account list, note that the default Compute Engine service account (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) exists — in the RAD platform's architecture, this account is never used for workload identity.

### Securing Secrets
**Concept:** Protecting sensitive configuration data from being exposed in source code, environment variables, or Terraform state.

**In the RAD UI:**
*   **Secret Manager Integration:** The application modules use Secret Manager to store sensitive configurations like database passwords. In the RAD UI, the `enable_auto_password_rotation` (Group 11 for Cloud Run, Group 17 for GKE) variable configures automated secret rotation. The secret values are fetched dynamically during deployment and mounted as environment variables or volumes, meaning the plaintext secret is never exposed.

**Console Exploration:**
Navigate to **Security > Secret Manager** in the GCP Console. View the list of secrets provisioned for the application. Notice that you cannot see the value without explicit permission — access to view secret material requires the `roles/secretmanager.secretAccessor` role, which is separate from the `roles/secretmanager.viewer` role that allows listing secrets without reading their values. Look at the **Versions** tab to see the history of secret rotations.

**Real-world example:** A Cloud Run service connects to Cloud SQL using a database password stored in Secret Manager. When the database password is rotated quarterly, the `enable_auto_password_rotation` feature updates the secret version in Secret Manager automatically. The Cloud Run service fetches the current version at startup — no redeployment is needed, and the old version remains accessible for a grace period in case any instances are still starting up with the previous password. The plaintext password is never written to a config file, environment variable in source code, or Terraform state file.

### Identity-Aware Proxy (IAP)
**Concept:** Controlling application access based on user identity and context, removing the need for traditional VPNs.

**In the RAD UI:**
*   **Zero-Trust Access:** Both modules support configuring IAP via the `enable_iap` variable (Group 4). You then provide specific users or groups via `iap_authorized_users` (Group 4) and `iap_authorized_groups` (Group 4). IAP evaluates policies at the edge before traffic ever reaches the backend Cloud Run service or GKE Gateway, restricting access to authenticated Google users. Because authentication happens at the Google Front End — before the request reaches your application — IAP protects against unauthenticated access even if the application itself has a vulnerability.

    > **Real-World Example:** An internal HR portal is deployed on Cloud Run. Rather than setting up and maintaining a VPN for all employees, the security team enables IAP and grants `IAP-secured Web App User` to `hr-employees@company.com`. Employees open the URL in any browser, are redirected to Google sign-in, and are granted access if their authenticated identity is in the group — no VPN client, no certificate management, and access is instantly revoked by removing someone from the group.

**Console Exploration:**
In the GCP Console, navigate to **Security > Identity-Aware Proxy**. Locate the backend service associated with your deployment. Notice the toggle switch indicating whether IAP is enabled. Look at the right-hand panel to view the access list, showing exactly which users, groups, or domains have been granted the `IAP-secured Web App User` role. Note that IAP context-aware access can be extended with Access Context Manager levels (part of BeyondCorp Enterprise) to enforce additional conditions such as device compliance or source IP range alongside identity.

### Defining Internal Access Controls (GKE)
**Concept:** Implementing defense-in-depth networking to restrict pod-to-pod communication.

**In the RAD UI:**
*   **Network Policies (GKE):** The `App GKE` module defines strict internal access controls using the `enable_network_segmentation` variable (Group 9). This ensures that even if a pod within the namespace is compromised, lateral movement is strictly restricted (e.g., denying ingress from all namespaces except the Gateway API or specific whitelisted pods).

**Console Exploration:**
In the GCP Console, navigate to **Kubernetes Engine > Workloads**, select your deployment, and view the "Networking" section to inspect assigned labels and selectors that drive these network policies. Alternatively, use `kubectl describe networkpolicies -n <namespace>` via Cloud Shell.

### Managing service account impersonation and short-lived credentials
**Concept:** Allowing one identity to temporarily act as a service account, and generating time-limited credentials rather than long-lived key files.

**In the RAD UI:**
The RAD platform uses its own deployment identity to provision resources. For the exam, you must understand how human users and automated pipelines can assume service account identities without downloading JSON keys.

**Service Account Impersonation:**
Service account impersonation allows a user (or another service account) to make API calls *as* a target service account, without downloading a key. The calling identity must have `roles/iam.serviceAccountTokenCreator` on the target service account.

- **Console:** Navigate to **IAM & Admin > Service Accounts**, select a service account, and view the **Permissions** tab. Grant `roles/iam.serviceAccountTokenCreator` to the identity that needs to impersonate it.
- **Command line:** `gcloud <command> --impersonate-service-account=<sa-email>`. For example, `gcloud storage ls --impersonate-service-account=deployer@project.iam.gserviceaccount.com` lists buckets as if you were the deployer service account.

Impersonation is audited — every API call made under the impersonated identity is logged with both the original caller and the service account being impersonated. This makes it far more traceable than shared credentials.

**Real-world example:** A CI/CD pipeline runs as a Cloud Build service account with broad `roles/run.admin` permissions. A developer needs to test the deployment script locally but should not receive those same permissions permanently. Rather than downloading a key or granting the developer `roles/run.admin`, the developer is granted `roles/iam.serviceAccountTokenCreator` on the Cloud Build SA — they can impersonate it for local testing, with every action logged under both identities.

**Short-lived service account credentials:**
Instead of static JSON keys (which never expire), short-lived credentials are generated on demand and expire automatically. Key types:
- **Access tokens:** OAuth 2.0 bearer tokens valid for 1 hour (default) up to 12 hours. Generated via `gcloud auth print-access-token --impersonate-service-account=<sa>` or the IAM Service Account Credentials API (`generateAccessToken`).
- **ID tokens:** JWT tokens for authenticating to Cloud Run, Cloud Functions, or IAP-protected endpoints. Generated via `gcloud auth print-identity-token` or `generateIdToken`.
- **Service account keys (discouraged):** Long-lived JSON private keys. The Google recommendation is to avoid service account keys wherever possible and use impersonation or Workload Identity instead. If a key must be created, navigate to **IAM & Admin > Service Accounts > Keys** to create and download it — and immediately configure a monitoring alert for key age in Active Assist.

### 💡 Additional Security Objectives & Learning Guidelines
The ACE exam tests knowledge of managing encryption keys and securing raw compute instances.

*   **Cloud KMS (Key Management Service):** Practice creating a Key Ring and a symmetric Key under **Security > Key Management**. Then, practice encrypting a Cloud Storage bucket or a Compute Engine disk using that Customer-Managed Encryption Key (CMEK) instead of the default Google-managed keys. CMEK gives you control over the key lifecycle — you can rotate, disable, or destroy the key, which effectively revokes GCP's ability to decrypt the protected data even for its own operations.

    > **Real-World Example:** A legal firm stores client documents in Cloud Storage. Regulatory requirements state that the firm must be able to immediately revoke all access to data if required by a court order. By encrypting the bucket with a CMEK in Cloud KMS, the firm can disable the KMS key — making all encrypted objects immediately inaccessible — without deleting a single object or modifying IAM policies. Re-enabling the key restores access.

*   **Compute Engine SSH Keys:** Navigate to **Compute Engine > Metadata**. Practice adding a project-wide public SSH key, then SSH into a Linux VM to understand how GCP propagates keys to the `~/.ssh/authorized_keys` file. Compare this to the recommended **OS Login** approach, which ties SSH access to IAM roles (`roles/compute.osLogin` or `roles/compute.osAdminLogin`) and eliminates the need to manage SSH key files entirely. OS Login is the Google-recommended method because access is controlled through IAM, revoked instantly when a user's IAM binding is removed, and produces audit log entries in Cloud Logging for every login.

    > **Real-World Example:** A company using project-wide SSH keys discovers that a former employee's key was added to the project metadata 18 months ago and never removed — granting silent SSH access to every VM in the project. Migrating to OS Login removes all metadata-based keys; access is then controlled purely through IAM and is automatically audited.
