# PSE Certification Preparation Guide: Section 1 — Configuring access (~25% of the exam)

This guide helps candidates preparing for the Google Cloud Professional Cloud Security Engineer (PSE) certification explore Section 1 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PSE objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 1.1 Managing Cloud Identity

### 💡 Additional Cloud Identity Objectives & Learning Guidelines
The modules rely on an existing Cloud Identity or Google Workspace environment but do not configure identity providers directly. Candidates should self-study these topics hands-on using the GCP Admin Console and documentation.

*   **Google Cloud Directory Sync (GCDS):** Research how GCDS synchronizes users and groups from an on-premises Active Directory or LDAP directory to Cloud Identity in a one-way sync (on-premises → Google). Understand that GCDS must be deployed on a server with network access to the on-premises directory, and that it never writes back to the directory. Navigate to **Admin Console > Directory > Users** to observe the resulting user objects and group memberships that IAM bindings depend on.
*   **Single Sign-On (SSO) with a Third-Party IdP:** Understand how to configure SAML 2.0-based SSO between Cloud Identity and an external Identity Provider (IdP). When SSO is active, Google acts as the Service Provider and redirects all authentication to the IdP for credential verification — users never enter a password on Google's sign-in page. Navigate to **Admin Console > Security > Authentication > SSO with third-party IdP** to explore the SAML endpoint and certificate configuration fields.
*   **Super Administrator Account Management:** Super admin accounts carry unrestricted organization-wide permissions and are high-value targets. Best practices include: enforcing phishing-resistant hardware security keys (FIDO2/Titan Security Key) as the sole 2-step verification method for super admins; never using super admin accounts for day-to-day work; maintaining at minimum two super admin accounts for break-glass access; and ensuring super admin accounts have no associated OAuth tokens or application-specific passwords. Navigate to **Admin Console > Account > Admin roles** to review current super admin assignments.
*   **Automating the User Lifecycle:** Research the Google Admin SDK Directory API to programmatically provision, update, suspend, and delete user accounts. Automated lifecycle pipelines (e.g., a Cloud Run service or Cloud Functions triggered by an HR system webhook) can provision accounts on day-one onboarding and suspend them immediately on departure — closing the orphaned-credential window that is a common source of unauthorized access.
*   **Administering Groups Programmatically:** The Google Admin SDK `Directory.groups` resource and the Cloud Identity Groups API enable programmatic management of Google Groups — creating groups, adding/removing members, querying group memberships, and managing nested group hierarchies. In a security automation context, a Cloud Run service can call the Groups API to add a new hire to the correct security groups on day one (granting all required GCP IAM permissions via group membership) and remove them from all groups on departure (atomically revoking all associated GCP access). Use a service account with `roles/admin.directory.groups` delegated via domain-wide delegation to the Admin SDK. Navigate to **Admin Console > Groups > Group settings** to understand group types (security groups vs. general discussion groups) and visibility settings that affect which identities can discover and join groups programmatically.
*   **Workforce Identity Federation:** Workforce Identity Federation (distinct from Workload Identity Federation, which is for non-human service workloads) allows an external human workforce authenticated by a corporate IdP (OIDC or SAML) to access Google Cloud resources using short-lived federated credentials — without synchronizing or creating users in Cloud Identity. Navigate to **IAM & Admin > Workforce Identity Federation** to explore pool and provider configuration.

**Real-world example:** A multinational firm with 10,000 employees in Active Directory uses GCDS to synchronize users and distribution lists to Cloud Identity nightly, then configures SAML 2.0 SSO so that employees use their existing corporate password to sign in to GCP. When an employee leaves, their AD account is disabled — GCDS propagates the suspension to Cloud Identity within 24 hours, automatically revoking all GCP access without any manual intervention from the cloud team.

---

## 1.2 Managing service accounts

### Dedicated Service Accounts and Workload Identity
**Concept:** Securing workloads by assigning dedicated, minimum-privilege service accounts and eliminating key-based authentication through Workload Identity.

**In the RAD UI:**
*   **Dedicated Service Accounts:** Rather than using the default Compute Engine service account (which carries broad `Editor` permissions), the platform provisions dedicated custom service accounts per workload (e.g., `cloud_run_sa`, `gke_sa`, `cloud_build_sa`), each granted only the specific roles required for its function.
*   **Workload Identity for GKE:** The App GKE module configures Workload Identity, binding each Kubernetes Service Account to a GCP Service Account via `roles/iam.workloadIdentityUser`. Pods receive short-lived, automatically rotated credentials from the GKE metadata server — eliminating the need to mount, store, or rotate JSON key files inside containers.

**Console Exploration:**
Navigate to **IAM & Admin > Service Accounts** to view each dedicated service account and its granted roles. For GKE, go to **Kubernetes Engine > Workloads**, select a deployment, view its YAML, and note the `serviceAccountName`. Find the corresponding GCP Service Account and verify the `roles/iam.workloadIdentityUser` binding on its **Permissions** tab. For Cloud Run, go to **Cloud Run > [service] > Security** to see the attached service account.

**Real-world example:** A financial services firm eliminates 40 long-lived JSON service account keys previously stored on developer laptops by migrating all GKE pods to Workload Identity. Each pod now automatically receives a short-lived OAuth token from the GKE metadata server that expires within an hour — reducing the credential compromise blast radius from a standing key providing persistent access to a transient token that is useless within 60 minutes.

### 💡 Additional Service Account Objectives & Learning Guidelines
*   **Protecting Default Service Accounts:** The default Compute Engine service account (`[PROJECT_NUMBER]-compute@developer.gserviceaccount.com`) is automatically granted `roles/editor` at the project level. Apply the Organization Policy `constraints/iam.automaticIamGrantsForDefaultServiceAccounts` to prevent this grant on all new projects. Navigate to **IAM & Admin > Service Accounts** to audit which workloads still use the default service account and plan migration to dedicated accounts.
*   **Securing and Auditing Service Account Keys:** Navigate to **IAM & Admin > Service Accounts** and inspect existing keys. Keys older than 90 days or with no recent usage (visible in the **Last used** column) should be rotated or deleted immediately. The Organization Policy `constraints/iam.disableServiceAccountKeyCreation` prevents new keys from being created entirely — use this on all projects where Workload Identity or impersonation can serve the same purpose.
*   **Managing Short-Lived Credentials:** Research how to use the IAM Service Account Credentials API (`generateAccessToken`) to obtain short-lived OAuth tokens (default 1-hour expiry) on behalf of a service account, without holding a key. Grant `roles/iam.serviceAccountTokenCreator` to the principal performing the impersonation. These tokens can be used directly in API calls as Bearer tokens and expire automatically, dramatically reducing the risk of persistent credential exposure.
*   **Configuring Workload Identity Federation (for external workloads):** Research how to configure a Workload Identity Pool and Provider so that external workloads — such as GitHub Actions pipelines, GitLab CI runners, or AWS Lambda functions — can authenticate to GCP using short-lived OIDC or SAML tokens issued by their own platform, without any JSON key exchange. Navigate to **IAM & Admin > Workload Identity Federation** to explore pool and provider setup.
*   **Service Account Impersonation:** Understand the `iam.serviceAccounts.actAs` permission and `roles/iam.serviceAccountTokenCreator`. Use `gcloud auth print-access-token --impersonate-service-account=SA_EMAIL` for local developer workflows that need to act as a service account without downloading a key. Audit all impersonation grants regularly via **IAM & Admin > IAM** by filtering for `roles/iam.serviceAccountTokenCreator` bindings.

---

## 1.3 Managing authentication

### OAuth-Based Authentication with IAP
**Concept:** Enforcing identity verification at the application perimeter before requests reach any workload.

**In the RAD UI:**
*   **Identity-Aware Proxy (IAP):** Enabling `enable_iap` (Group 15 for App CloudRun; §4.B Identity-Aware Proxy for App GKE) configures IAP on the Global External Application Load Balancer. IAP intercepts every request, verifies the user's Google identity via OAuth 2.0, and only forwards the request to the Cloud Run service or GKE backend if the caller holds `roles/iap.httpsResourceAccessor` on the resource. In App GKE, IAP is enforced via a `GCPBackendPolicy` CRD on the Gateway backend and requires a pre-created OAuth 2.0 client (`iap_oauth_client_id` / `iap_oauth_client_secret`). Unauthenticated and unauthorized requests are rejected at the Google edge.

**Console Exploration:**
Navigate to **Security > Identity-Aware Proxy**. Review which backends are protected (green shield icon) and the list of principals with access. Click the **OAuth consent screen** link to review the application name and scopes presented to users during sign-in. Open the application URL in an incognito browser window to observe the Google authentication redirect flow in action.

**Real-world example:** A consulting firm protects its internal project management tool with IAP, removing the need for a VPN entirely. Remote contractors authenticate with their corporate Google Workspace accounts. When a contractor's engagement ends, removing them from the authorized IAP group in the GCP Console immediately revokes access — no VPN certificate revocation or firewall rule change is needed, and the change takes effect within seconds.

### 💡 Additional Authentication Objectives & Learning Guidelines
*   **Password and Session Management Policies:** Navigate to **Admin Console > Security > Password management** to configure minimum password length, strength enforcement, and reuse prevention across the organization. Understand how IAP session length controls (`--session-length` flag or Console setting) determine how frequently users must re-authenticate — a typical compliance requirement is 8 hours for standard users and 1 hour for privileged users accessing sensitive systems.
*   **Configuring SAML:** Study how to configure SAML 2.0 for applications that implement their own authentication rather than delegating to Google OAuth. In this model, Google Cloud Identity acts as the Identity Provider and asserts user attributes (email, groups, roles) to the application (Service Provider) via a signed SAML assertion. Contrast this with the federated SSO scenario where Google is the Service Provider and an external IdP is the authenticator.
*   **Configuring and Enforcing 2-Step Verification (2SV):** Navigate to **Admin Console > Security > 2-step verification** to enforce 2SV at the organizational unit level with an enforcement date. Study the spectrum of 2SV methods: SMS/voice call (weakest — susceptible to SIM-swapping and SS7 attacks), authenticator apps with TOTP (better), and hardware security keys with FIDO2 (strongest — phishing-resistant, the only method that defeats real-time phishing). For all privileged and super admin accounts, hardware keys must be the only allowed method.

---

## 1.4 Managing and implementing authorization controls

### Fine-Grained IAM and Least Privilege
**Concept:** Granting only the permissions required, scoped to the specific resources that need them, rather than broad project-level roles.

**In the RAD UI:**
*   **Resource-Level Secret IAM:** The workload service account is granted `roles/secretmanager.secretAccessor` only on the specific secrets it requires — not on all secrets in the project. This is enforced via resource-level IAM bindings on individual secret resources.
*   **Resource-Level Storage IAM:** The service account is granted `roles/storage.objectAdmin` only on its designated buckets, with Uniform Bucket-Level Access enabled to prevent legacy per-object ACLs from overriding the bucket policy.

**Console Exploration:**
Navigate to **Security > Secret Manager**, select a specific secret, and open its **Permissions** tab — observe that only the designated workload service account holds `roles/secretmanager.secretAccessor`, not the broader project-level IAM. Navigate to **Cloud Storage > Buckets**, select a bucket, open **Permissions**, and verify **Access Control: Uniform** is enforced.

**Real-world example:** A healthcare provider's ETL pipeline needs to read patient records from Cloud SQL and write output to a specific Cloud Storage bucket. Rather than granting `roles/editor` at the project level, the security team grants `roles/cloudsql.client` on the specific Cloud SQL instance and `roles/storage.objectCreator` on the one destination bucket. If the pipeline service account is compromised, the attacker can only access those two specific resources — not the entire project, other databases, or other buckets.

### 💡 Additional Authorization Objectives & Learning Guidelines
*   **IAM Conditions:** Research how IAM Conditions add attribute-based access control (ABAC) to IAM bindings. A condition can restrict a binding so it only applies during business hours (`request.time`), for resources matching a tag or name pattern (`resource.name`), or from a specific IP range. Navigate to **IAM & Admin > IAM**, click "Edit" on any principal, and explore the **Add condition** option. IAM Conditions are frequently tested in PSE exam scenarios involving time-limited access and environment-based restrictions.
*   **IAM Deny Policies:** IAM Deny is an explicit block that prevents specified principals from using specified permissions regardless of any allow bindings they hold. Deny policies are evaluated before allow policies in the IAM authorization model. A common use case is creating a deny policy that prevents any principal from disabling audit logging — enforced even against project Owners. Navigate to **IAM & Admin > Deny policies** to explore creation and scope.
*   **Access Context Manager:** Research how Access Context Manager (ACM) defines access levels based on request context: IP address range, device trust (verified via Endpoint Verification), user identity, and geographic location. Access levels are consumed by VPC Service Controls perimeters (to define trusted access paths) and by IAP for context-aware access policies. Navigate to **Security > Access Context Manager** to explore access level definitions and their components.
*   **Policy Intelligence Tools:** Explore three key tools under **IAM & Admin**: (1) **IAM Recommender** — analyses 90 days of actual permission usage and suggests removing roles that were granted but never exercised; (2) **Policy Analyzer** — answers "who has access to this resource?" across the entire organization; (3) **Policy Troubleshooter** — explains exactly why a specific principal does or does not have a specific permission on a specific resource, tracing through organization policies, IAM deny, and allow bindings.
*   **Privileged Access Manager (PAM):** Research PAM for just-in-time (JIT) privilege elevation. PAM allows a user to request a temporary elevation to a privileged role (e.g., `roles/bigquery.admin`) for a defined time window with a business justification, subject to an approval workflow. At expiry, the elevated binding is automatically removed. This eliminates standing privileged access and creates an immutable audit trail. Navigate to **IAM & Admin > Privileged Access Manager** to explore grant configuration.
*   **Managing Permissions Through Groups:** Research the organizational benefit of managing IAM bindings through Google Groups rather than individual user accounts. When a new team member joins, adding them to a group immediately grants all associated GCP permissions — no IAM policy changes are needed. When they leave, removing them from the group revokes access atomically. Navigate to **Admin Console > Groups** to explore group management alongside **IAM & Admin > IAM** to see group-based bindings.

---

## 1.5 Defining the resource hierarchy

### Organization Policy Inheritance
**Concept:** Enforcing security constraints automatically across the entire organization through the resource hierarchy.

**In the RAD UI:**
*   **Project-Scoped Deployment with Inherited Policies:** Resources are deployed within a specific project that inherits Organization and Folder-level policies automatically. The modules demonstrate how security posture set at the org or folder level is enforced before any resource creation — a developer cannot bypass a constraint by modifying project-level settings.

**Console Exploration:**
Navigate to **IAM & Admin > Organization Policies**. Review the constraints that apply to the project housing your deployed resources. Look specifically for: `constraints/compute.vmExternalIpAccess` (prevents external IP assignment to VMs), `constraints/iam.disableServiceAccountKeyCreation` (blocks SA key creation), and `constraints/gcp.resourceLocations` (restricts resource deployment to specific regions). Note whether each constraint was set at the org, folder, or project level.

**Real-world example:** A multinational bank creates a Google Cloud organization structure: `org > EMEA > Production` and `org > EMEA > Development`. They apply an Organization Policy at the `EMEA` folder restricting all resource locations to EU regions (`constraints/gcp.resourceLocations: in:europe-locations`). Every project created under EMEA — now and in the future — automatically inherits this constraint. A developer attempting to provision a Cloud SQL instance in `us-central1` from a project in this folder receives an immediate policy violation error, preventing accidental cross-border data residency violations without per-project configuration.

### 💡 Additional Resource Hierarchy Objectives & Learning Guidelines
*   **Managing Folders and Projects at Scale:** Understand how to design a folder hierarchy that reflects the organization's governance structure (e.g., by business unit, by environment type, by compliance tier). Use the Cloud Resource Manager API to automate project creation with pre-approved billing accounts, IAM bindings, and Organization Policy constraints baked in — ensuring every new project starts in a known-good security state rather than relying on manual post-creation hardening.
*   **Custom Organization Policies:** Beyond the library of pre-built constraints, research how to author custom Organization Policy constraints using Common Expression Language (CEL). Custom constraints can enforce organization-specific rules not covered by built-in constraints — for example, requiring all Cloud Run services to use a specific ingress setting, or blocking creation of Cloud SQL instances without private IP. Navigate to **IAM & Admin > Organization Policies > Custom constraints** to explore authoring.
*   **Permissions Inheritance and Effective Policy:** Understand that IAM roles granted at the Organization level propagate down to every folder and project in the hierarchy (inheritance), but that IAM Deny policies applied at any level override Allow bindings at lower levels (deny wins). Use **Policy Analyzer** in the console to trace the effective permissions for any principal at any resource in the hierarchy — particularly important when auditing why a user unexpectedly has or lacks access.
