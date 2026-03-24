# PSE Certification Preparation Guide: Exploring Section 4 (Managing operations)

This guide explores how the deployment portal's Terraform modules implement infrastructure and application security, as well as operations management on Google Cloud, corresponding to Section 4 of the PSE certification (~19% of the exam).

## 4.1 Automating infrastructure and application security

### Securing CI/CD pipelines
The application modules utilize Google Cloud Build to automate deployments to services like Cloud Run and GKE.
*   **Implementation:** Build triggers are automatically configured to automate the build process securely, managing source code via connections to repositories like GitHub. During the build and deployment lifecycle, secrets are injected securely from Secret Manager, preventing sensitive data from being exposed in plaintext.

### Binary Authorization
Binary Authorization is a service that provides software supply-chain security for applications that run in the cloud. It ensures that only trusted container images are deployed.
*   **Implementation:**
    *   By deploying platform services modules, organizations can enforce platform-wide Binary Authorization policies and attestors.
    *   Within the application modules (like App_CloudRun or App_GKE), you can toggle the `enable_binary_authorization` variable in the deployment portal. When enabled, this enforces signature validation policies, requiring cryptographic attestations (signatures) from trusted authorities before images can be deployed. This strictly prevents the deployment of unauthorized or tampered images into production environments.

## 4.2 Configuring logging, monitoring, and detection

### Logging and Monitoring
Google Cloud's operations suite (formerly Stackdriver) provides comprehensive monitoring and alerting capabilities to track application health and security metrics.
*   **Implementation:**
    *   **Dashboards:** The application modules automatically provision custom Cloud Monitoring dashboards, providing immediate visual insights into application performance, error rates, and resource utilization directly in the GCP Console.
    *   **Alerting Policies:** Within the application modules, you can define alerting thresholds using the `alert_policies` list variable in the deployment portal. When metrics exceed these defined thresholds (such as high error rates or unusual latency), the system triggers notifications. These notifications are sent to the email addresses configured in the `support_users` variable, proactively alerting operators to potential security or reliability issues.

### Audit Logs
Cloud Audit Logs maintain a record of all administrative activities and data accesses across Google Cloud resources, which is crucial for forensic analysis and compliance.
*   **Implementation:** Standard Google Cloud operations executed by the Terraform modules implicitly generate Data Access and Admin Activity audit logs. These logs provide a continuous, verifiable trail of infrastructure changes and API calls that can be exported to sinks (like BigQuery or Cloud Storage) for long-term retention and deeper security analysis.
