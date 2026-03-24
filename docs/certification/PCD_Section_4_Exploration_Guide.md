# PCD Certification Preparation Guide: Exploring Section 4 (Integrating applications with Google Cloud services)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud Developer (PCD) certification. It focuses specifically on Section 4 of the exam guide (which covers ~21% of the exam) by walking you through how these concepts are practically implemented using Terraform modules via the web-based deployment portal. By exploring the Google Cloud Platform (GCP) console and adjusting module configurations, you will gain hands-on context for these critical architectural topics.

---

## 4.1 Integrating applications with data and storage services

### Concept
Managing connections to datastores like Cloud SQL involves handling authentication, connection pooling, and securely passing connection strings.

### Implementation Context
The modules abstract the complexity of Cloud SQL connections by utilizing the Cloud SQL Auth Proxy (via `cloudsql_volume_mount_path` for GKE or native integration for Cloud Run).

### Exploration
*   **Variable:** `cloudsql_volume_mount_path` (App_GKE) / Cloud SQL connections (App_CloudRun)
*   **Description:** Configures the mounting of Unix sockets for secure, IAM-authenticated connections to Cloud SQL without exposing IPs.
*   **Configuration Experience:** The application seamlessly connects to the database via a local Unix socket, demonstrating secure internal integration without managing IP allowlists.
*   **GCP Console Exploration:** Navigate to **Cloud SQL > Connections**. Observe that public IP is disabled and connections are securely routed. For Cloud Run, view the **Connections** tab on the service.
    *   *Additional Customization:* Review the application logs to observe the startup sequence of the Cloud SQL Auth proxy sidecar container (if on GKE) establishing the secure tunnel before the main application starts.

---

## 4.2 Consuming Google Cloud APIs

### Concept
Making API calls requires enabling services and using service accounts (Workload Identity) with the least privileged access to authenticate securely.

### Implementation Context
Applications running on GKE or Cloud Run automatically inherit the permissions of their associated Google Service Account, mapped via Workload Identity, eliminating the need to manage JSON key files.

### Exploration
*   **Variable:** `existing_project_id` (implicitly manages service accounts)
*   **Description:** The modules automatically provision dedicated service accounts for the workload and bind necessary roles (like Cloud SQL Client or Secret Manager Secret Accessor).
*   **Configuration Experience:** The application authenticates to Google Cloud APIs seamlessly using Application Default Credentials (ADC) provided by the execution environment.
*   **GCP Console Exploration:** Navigate to **IAM & Admin > Service Accounts**. Locate the service account created for the application and review its assigned roles to verify the principle of least privilege.
    *   *Additional Customization:* Attempt to use the Cloud Client Libraries within the application to read a resource it doesn't have permissions for (like BigQuery) and observe the resulting HTTP 403 error, validating the IAM boundary.

---

## 4.3 Troubleshooting and observability

### Concept
Instrumenting code for troubleshooting involves producing metrics, logs, and traces, and using Google Cloud Observability to correlate trace IDs across services.

### Implementation Context
By deploying via these modules, Cloud Logging and Monitoring are natively integrated. Applications can be configured to emit traces by setting specific environment variables.

### Exploration
*   **Variable:** `alert_policies`, `environment_variables` (App_GKE / App_CloudRun)
*   **Description:** Injects custom alert policies and configures application runtimes to emit distributed traces (e.g., via OpenTelemetry).
*   **Configuration Experience:** Setting an environment variable like `GOOGLE_CLOUD_PROJECT` or `OTEL_EXPORTER_OTLP_ENDPOINT` via `environment_variables` instructs the application to begin tracing requests.
*   **GCP Console Exploration:** Navigate to **Trace > Trace list**. Analyze a request's waterfall diagram to identify latency bottlenecks between the application code and the Cloud SQL database.
    *   *Additional Customization:* Create a custom log-based metric in the Logs Explorer for a specific application error string, then reference that new metric in a custom `alert_policy` to alert the team when the error spikes.