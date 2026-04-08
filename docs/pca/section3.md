# PCA Certification Preparation Guide: Section 3 — Designing for security and compliance (~17.5% of the exam)
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section3.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section3.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pca_section3.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification explore Section 3 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCA objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 3.1 Designing for security

### Identity and Access Management (IAM) and Separation of Duties
**Concept:** Applying the principle of least privilege using predefined IAM roles.

**In the RAD UI:**
*   **Least Privilege:** The platform natively implements separation of duties by provisioning dedicated custom Service Accounts (e.g., `cloud_run_sa` vs `gke_sa` vs `cloud_build_sa`) rather than using the default compute service account.
*   **Access Control:** The `support_users` variable (Group 1) allows mapping Workspace Groups to specific viewer/monitoring roles, automating lifecycle management through Cloud Identity.

**Console Exploration:**
Navigate to **IAM & Admin > IAM** to view the assigned roles. Navigate to **IAM & Admin > Service Accounts** and view the "Permissions" tab.

**Real-world example:** A professional services firm enforces separation of duties by provisioning a dedicated Cloud Run service account with only `roles/cloudsql.client` and `roles/secretmanager.secretAccessor` — the minimum permissions required to query the database and retrieve credentials. The default Compute Engine service account, which carries broad `Editor` permissions, is explicitly disabled on all new projects via an Organization Policy to prevent accidental over-permissioning.

### Data Security and Secure Remote Access
**Concept:** Protecting sensitive data from unauthorized access or exfiltration using encryption and zero-trust proxies.

**In the RAD UI:**
*   **Secret Management:** The `enable_auto_password_rotation` variable (Group 11/17) automates credential rotation, securely passing them to workloads via Secret Manager.
*   **Identity-Aware Proxy (IAP):** Review the `enable_iap` (Group 4) variable. IAP provides secure remote access, replacing traditional VPNs by verifying Google identities at the edge.
*   **VPC Service Controls:** In **GCP Services**, `enable_vpc_sc` (Group 10) creates a VPC Service Perimeter, preventing data exfiltration by blocking API access outside the defined trusted boundary.
*   **Securing Software Supply Chain:** In **GCP Services**, `enable_binary_authorization` (Group 11) ensures only verified, signed container images are deployed.

**Console Exploration:**
Navigate to **Security > Secret Manager** to view secret versions. Navigate to **Security > VPC Service Controls** to see the perimeter configuration. Navigate to **Security > Binary Authorization**.

**Real-world example:** A healthcare organization handles patient data subject to HIPAA requirements. They define a VPC Service Perimeter around the Cloud Healthcare API project so that even a compromised service account cannot exfiltrate data to an external Cloud Storage bucket outside the perimeter. Binary Authorization is enforced so that only container images that have passed a Cloud Build vulnerability scan and been attested by the security team can be deployed to production GKE clusters — preventing a supply-chain attack where a malicious dependency is introduced in a CI build.

### 💡 Additional Security Objectives & Learning Guidelines
*   **Customer-Managed Encryption Keys (CMEK):** Practice creating a Cloud KMS Key Ring and Key. Then, encrypt a Cloud Storage bucket or a Compute Engine persistent disk using that specific CMEK. Understand that CMEK gives you control over key rotation and revocation, and that revoking a CMEK immediately renders the encrypted data inaccessible — a critical capability for data destruction under GDPR right-to-erasure requirements.
*   **Resource Hierarchy and Organization Policy:** Understand how Organization Policies enforce constraints that flow down from Organization to Folders to Projects. Key constraints to know include `compute.requireShieldedVm`, `iam.disableServiceAccountKeyCreation`, `compute.restrictCloudRunRegions`, and `gcp.resourceLocations` for data residency. Projects inherit policies from parent folders automatically and cannot override a denied policy set at a higher level.
*   **Hierarchical Firewall Policy:** Unlike VPC firewall rules (which are per-network), Hierarchical Firewall Policies are attached at the Organization or Folder level and evaluated before VPC firewall rules. This allows a central security team to enforce baseline deny rules (e.g., block all RDP/SSH from the internet) across all projects in a folder, without relying on individual project teams to configure VPC rules correctly.
*   **Context Aware Access and Chrome Enterprise Premium:** Beyond IAP, study how Chrome Enterprise Premium (formerly BeyondCorp Enterprise) enables context-aware access policies based on device trust level, geographic location, and risk score — providing zero-trust access to web applications without a VPN. For example, a policy can require that only managed corporate devices with an up-to-date OS can access sensitive internal applications, while personal devices are denied even if the user's identity is valid.
*   **Service Account Impersonation:** Understand how to use service account impersonation (`iam.serviceAccounts.actAs`) to allow a user or workload to temporarily act as a target service account and call APIs with its permissions — without downloading a long-lived JSON key. This pattern is preferred for developer workflows (e.g., running Terraform locally as a service account) because the impersonation token expires automatically.
*   **Workload Identity Federation:** Research how to authenticate GitHub Actions CI pipelines or workloads running on AWS EC2 directly to GCP without downloading long-lived JSON service account keys, using short-lived federated tokens instead.
*   **Securing AI:** Study Model Armor and Sensitive Data Protection (DLP API) to secure model deployment and sanitize training data.

---

## 3.2 Designing for compliance

### Audits and Industry Certifications
**Concept:** Ensuring the architecture adheres to industry standards (PCI-DSS, HIPAA, SOC 2) and logging all activities.

**In the RAD UI:**
*   **Security Command Center:** In **GCP Services**, `enable_security_command_center` (Group 16) activates SCC, continuously scanning for misconfigurations against compliance standards like SOC 2 and PCI-DSS.

**Console Exploration:**
Navigate to **Security > Security Command Center** to view the compliance dashboard and vulnerabilities.

**Real-world example:** A payment processor undergoing PCI-DSS audit uses Security Command Center's compliance posture view to generate evidence that no public-facing Cloud Storage buckets exist, no service accounts have owner-level permissions, and all Compute Engine instances use encrypted disks. SCC automatically maps its findings to the relevant PCI-DSS control IDs, reducing the manual effort required to produce audit artefacts.

### 💡 Additional Compliance Objectives & Learning Guidelines
*   **Cloud Audit Logs:** Review the difference between Admin Activity logs (enabled by default) and Data Access logs (must be manually enabled, high volume). Practice exporting Data Access logs to BigQuery for forensic analysis.
*   **Legislation and Regulation:** Understand how data residency and sovereignty requirements impact region selection. Research Assured Workloads for government/regulated deployments.
*   **Sensitive Data Protection:** Explore how the DLP API handles PII (personally identifiable information) masking in real-time or via storage scans.
