# PSE Certification Preparation Guide: Section 5 — Supporting compliance requirements (~11% of the exam)
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pse_section5.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pse_section5.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pse_section5.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud Security Engineer (PSE) certification explore Section 5 of the exam through the lens of the Tech Equity RAD platform at [https://techequity.cloud](https://techequity.cloud). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PSE objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 5.1 Adhering to regulatory and industry standards requirements for the cloud

### Security Command Center Compliance Posture
**Concept:** Using GCP-native security tooling to continuously evaluate, evidence, and maintain compliance with regulatory frameworks.

**In the RAD UI:**
*   **Security Command Center (SCC):** Enabling `enable_security_command_center` (Group 16 in GCP Services) activates SCC, which continuously scans all deployed resources for misconfigurations and maps findings to compliance control frameworks including PCI-DSS v3.2.1, HIPAA, NIST SP 800-53, CIS GCP Foundations Benchmark v1.3, and ISO 27001. Each finding includes the specific control ID it violates and remediation guidance.

**Console Exploration:**
Navigate to **Security > Security Command Center > Posture management** (or **Compliance** in your tier). Select a compliance standard from the dropdown and review the percentage of controls passing and failing. Click any failing control to see the specific GCP resources violating it and the recommended remediation steps. Navigate to **SCC > Findings** and filter by severity to triage critical misconfigurations such as open firewall rules, public Cloud Storage buckets, or disabled audit logging.

**Real-world example:** A payment processor undergoing their annual PCI-DSS QSA audit uses SCC's PCI-DSS compliance report to produce evidence artefacts for the auditor. SCC automatically identifies and maps each finding to its PCI-DSS requirement number (e.g., Requirement 6.3.3 for installed software vulnerabilities, Requirement 7.2 for least-privilege access controls). The security team exports the compliance report and attaches remediation evidence for each finding — reducing audit preparation from weeks of manual spreadsheet work to a structured, defensible report generated in hours.

### Evaluating the Shared Responsibility Model
**Concept:** Understanding precisely which security controls are Google's responsibility and which are the customer's, for each service abstraction level.

**In the RAD UI:**
*   **GKE Autopilot vs. GKE Standard:** By deploying workloads using the GKE Autopilot module, the customer shifts responsibility for node OS security, node pool configuration, system pod management, and node-level patching to Google. This reduces the customer's compliance scope for infrastructure hardening considerably compared to GKE Standard, where the customer owns the node OS.

**Console Exploration:**
Navigate to **Kubernetes Engine > Clusters**. Select an Autopilot cluster and review the **Security** tab — observe the default security controls applied automatically by Autopilot: no SSH access to nodes, read-only root filesystem for system pods, automatic OS security patching, and Shielded Nodes enabled by default. These represent Google-managed controls that the customer does not need to configure.

**Real-world example:** A healthcare startup chooses GKE Autopilot over GKE Standard specifically to narrow their HIPAA compliance scope. With GKE Standard, they would be responsible for OS-level CIS Benchmark hardening on each worker node — a significant operational burden for a 3-person security team. With Autopilot, Google manages the node OS and runtime, and the startup's HIPAA responsibility is scoped to application security, IAM policies, data encryption, and network controls. Their HIPAA Business Associate Agreement (BAA) with Google covers the Autopilot infrastructure, completing the compliance chain.

### 💡 Additional Compliance Objectives & Learning Guidelines
*   **Assured Workloads:** Research Assured Workloads for deploying pre-configured, regulatory-compliant GCP environments. Assured Workloads automatically enforces the Organization Policies required by a specific compliance framework — for example, FedRAMP High restricts resource locations to US regions and limits which Google staff can access support requests; EU Sovereign Controls restricts data processing to EU locations and prevents non-EU Google staff access. Navigate to **Compliance > Assured Workloads** in the console to explore the available compliance regimes and how to create a compliant folder.
*   **Access Transparency:** Research Access Transparency logs, which record actions taken by Google staff (e.g., Google support engineers, infrastructure operators) when they access your organization's content. Unlike Cloud Audit Logs — which capture *your* API calls — Access Transparency captures *Google's* administrative actions on your resources. Access Transparency logs show the justification for access (e.g., a support case number), the approximate data location accessed, and the Google employee's role. This is a critical control for enterprises and regulated industries that need auditability of cloud provider access. Navigate to **Logging > Logs Explorer** and filter by `logName="projects/[PROJECT_ID]/logs/cloudaudit.googleapis.com%2Faccess_transparency"` to view these logs.
*   **Access Approval:** Research Access Approval, which adds an explicit approval gate before Google staff can access your project's configuration or content. When a Google support engineer needs to view a Cloud SQL database to diagnose an issue, an Access Approval request is raised and sent to designated approvers in your organization. You can approve, deny, or dismiss the request — and Google staff cannot proceed without approval (with narrow exceptions for security emergencies). Navigate to **IAM & Admin > Access Approval** to configure approvers and explore the request workflow. Access Approval is distinct from Access Transparency: Transparency is passive logging; Approval is active control.
*   **Mapping Compliance Requirements to GCP Services and Controls:** A key PSE exam skill is constructing a control mapping from a regulatory requirement to the specific GCP service or configuration that satisfies it. Practice building these mappings — for example: PCI-DSS Requirement 8.4 (multi-factor authentication for all non-console administrative access) → Cloud Identity 2-step verification enforced via Admin Console + IAP for application access; PCI-DSS Requirement 10.5.1 (protect audit logs from deletion and modification) → Cloud Logging with Bucket Lock (WORM) and `roles/logging.admin` restricted to a security team; GDPR Article 17 (right to erasure) → CMEK key revocation rendering encrypted data irrecoverable + SDP de-identification of PII in analytics datasets; HIPAA Technical Safeguard 164.312(e)(1) (transmission security) → TLS 1.2+ enforced at the load balancer + Direct VPC Egress for internal service communication.
*   **Determining the GCP Environment in Scope for Regulatory Compliance:** Understand that compliance scope is not the entire GCP organization — it is the specific projects, services, and data flows that touch regulated data. Use resource tags and labels to demarcate in-scope resources, and apply more restrictive Organization Policies, IAM constraints, and VPC Service Controls perimeters specifically to in-scope folders and projects. Out-of-scope projects (e.g., development environments without production data) can have relaxed controls, reducing operational overhead without increasing compliance risk for the regulated environment.
*   **Configuring Security Controls Within Cloud Environments to Support Compliance:** Understand how to compose multiple GCP controls into a coherent compliance posture: Organization Policies enforce what can be created; VPC Service Controls restrict where data can flow; IAM with deny policies and conditions enforce who can access what and when; Cloud KMS with CMEK ensures data is encrypted with customer-controlled keys; Cloud Logging with locked sinks provides tamper-evident audit trails; SCC provides continuous compliance monitoring. No single control is sufficient — the PSE exam frequently presents scenarios requiring candidates to select the correct combination of controls for a given regulatory requirement.
