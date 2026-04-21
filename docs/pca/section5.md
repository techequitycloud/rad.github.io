# PCA Certification Preparation Guide: Section 5 — Managing implementation (~12.5% of the exam)
<YouTubeEmbed videoId="qx_H91r5Eo0" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section5.png" />

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pca_section5.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification explore Section 5 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCA objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 5.1 Advising development and operation teams

### Application and Infrastructure Deployment
**Concept:** Guiding teams on how to deploy and manage applications effectively using automated patterns.

**In the RAD UI:**
*   **Infrastructure Deployment:** The platform enforces an Infrastructure as Code (IaC) paradigm. By abstracting the orchestration, it provides a reference architecture for operations teams to shift from managing VMs to managing container lifecycles declaratively.
*   **Container Image Sources:** Variables like `container_image_source` (Group 3) guide teams to standardize on Artifact Registry for immutable image deployments.

**Console Exploration:**
Navigate to **Artifact Registry** to view the repository of container images deployed by the pipelines.

**Real-world example:** A platform engineering team standardizes all application images on Artifact Registry with automatic vulnerability scanning enabled. When a critical CVE is detected in a base image, Security Command Center raises a finding that links directly to the affected image digest in Artifact Registry. The team's Cloud Build trigger is configured to rebuild and redeploy the image automatically on a nightly schedule, ensuring all running services consume patched base images without manual intervention.

### 💡 Additional Advising Objectives & Learning Guidelines
*   **API Management Best Practices (Apigee):** Understand when to use Apigee (for monetization, complex rate limiting, developer portals, and legacy SOAP-to-REST translation) versus a simple API Gateway or Cloud Endpoints.
*   **Testing Frameworks:** Understand the difference between load testing (stressing the system), unit testing (testing individual functions), and integration testing (testing component interactions).
*   **Data and System Migration Tooling:** Research the Database Migration Service (DMS) for continuous replication of databases into Cloud SQL, and Migrate to Virtual Machines (m2vm).
*   **Gemini Cloud Assist:** Use Gemini in the console to advise on optimizing deployments or writing deployment scripts.

---

## 5.2 Interacting with Google Cloud programmatically

### Infrastructure as Code (IaC)
**Concept:** Utilizing declarative code to manage infrastructure predictably.

**In the RAD UI:**
*   **IaC and Terraform:** The RAD deployment portal completely abstracts the underlying Terraform codebase via the UI. When you configure variables, the platform compiles these inputs and executes Terraform on your behalf.
*   **Custom Implementations:** The generated infrastructure serves as a reference. Teams can configure remote state backends (e.g., in a GCS bucket) and orchestrate deployments via CI/CD pipelines natively.

**Console Exploration:**
Navigate to **Cloud Build > History** to see the automated pipelines executing the IaC deployments via Terraform.

**Real-world example:** A large enterprise stores all Terraform state in a versioned GCS bucket with Object Versioning enabled, and locks the state using a Cloud Storage backend. When a misconfigured firewall rule causes a production incident, the operations team uses `terraform state` commands from Cloud Shell to inspect drift and rolls back the firewall configuration by reverting the Terraform code in the repository and triggering a fresh Cloud Build pipeline — restoring the known-good state with a full audit trail in Cloud Build history.

### 💡 Additional Programmatic Interaction Objectives & Learning Guidelines
The PCA exam heavily tests raw Cloud SDK (`gcloud`), `gsutil`, `bq`, and programmatic environments.
*   **Cloud Shell Editor, Cloud Code, and Cloud Shell Terminal:** Open Cloud Shell in the console. Practice using the built-in Editor (Code OSS, the open-source foundation of VS Code) and explore the Cloud Code extension for Kubernetes and Cloud Run development with real-time resource visualization, log streaming, and deployment directly from the editor.
*   **Google Cloud SDKs:** Practice `gcloud` commands (e.g., `gcloud compute instances create`), `gcloud storage` for storage management (the modern replacement for the legacy `gsutil` CLI), and `bq` for BigQuery interactions.
*   **Cloud Emulators:** Research how to use local emulators for Bigtable, Spanner, Pub/Sub, and Firestore to develop applications without incurring cloud costs or requiring an internet connection.
*   **Accessing Google API Best Practices:** Understand the authentication hierarchy for API access: Application Default Credentials (ADC) is the recommended pattern, automatically resolving credentials from the environment (Workload Identity in GKE, attached service account in Cloud Run, user credentials in Cloud Shell). Service account keys should be avoided; use impersonation or Workload Identity Federation instead. For API quota management, every GCP API has per-project quotas — architects must proactively request quota increases for production workloads before launch. Implement exponential backoff with jitter when retrying API calls that return `429 RESOURCE_EXHAUSTED` or `5xx` errors to avoid thundering-herd effects during partial outages.
*   **Google API Client Libraries:** Understand how developers use client libraries (in Python, Node.js, Java) to interact with GCP APIs natively within their application code. Client libraries handle retry logic, authentication, and protocol-level details (gRPC vs. REST) automatically.
