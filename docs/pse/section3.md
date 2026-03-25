# Ensuring data protection
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pse_section3.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pse_section3.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pse_section3.pdf)

## Section 3: Ensuring data protection (~23% of the exam)

### 3.1 Protecting sensitive data and preventing data loss
*   **Securing secrets with Secret Manager**: The platform heavily rely on Secret Manager to store and manage sensitive data like database passwords, Redis authentication strings, and application keys.
    *   **Exploration:** Within your deployment portal, locate the variables related to secrets (e.g., `secret_environment_variables`, `enable_auto_password_rotation`). After deploying, navigate to the Secret Manager page in the Google Cloud Console. Observe the generated secrets and how they are securely managed and rotated according to the deployment configuration.
*   **Restricting access to data services**: Cloud SQL databases are provisioned with private IPs, restricting access only to authorized compute resources within the VPC.
    *   **Exploration:** In the deployment portal, ensure your database configuration is set to deploy. Then, go to the Cloud SQL instances list in the Google Cloud Console. Select the deployed instance, go to "Connections" > "Networking", and observe that the instance only has a Private IP assigned, ensuring that only resources within the VPC can connect and public access is restricted.

### 3.2 Managing encryption at rest, in transit, and in use
*   **Encryption at rest**: All underlying storage services (Cloud SQL, Cloud Storage, Secret Manager) utilize Google default encryption at rest. CMEK (Customer-Managed Encryption Keys) integration can also be enabled within the deployment deployments, allowing customers to fully control the encryption keys using Cloud KMS.
    *   **Exploration:** In your deployment portal, look for CMEK configuration variables (e.g., `enable_cmek`). If enabled, deploy the application and go to the Cloud KMS page in the Google Cloud Console. Review the created Key Rings and Crypto Keys, and observe the IAM permissions that grant services (like the Cloud SQL service account or GCS service account) permission to use the keys.
*   **Encryption in transit**: The Load Balancer terminates SSL/TLS traffic, ensuring encryption in transit from the client to the Google Cloud edge.
    *   **Exploration:** Review your deployment's load balancing settings. Once deployed, navigate to Network Services > Load balancing in the Google Cloud Console. Click on the frontend configuration of the deployed load balancer and note the enforced HTTPS protocol and the attached managed SSL certificates.

### 3.3 Planning for data privacy
*   **Cloud Storage retention and lifecycle**: Storage deployments allow configuring backup buckets with retention periods and automatic cleanup, enforcing data privacy through lifecycle management.
    *   **Exploration:** Find the backup and storage variables in your deployment portal (e.g., `backup_retention_days`). Deploy the configuration, then open Cloud Storage in the Google Cloud Console. Find the application's backup bucket. Navigate to the "Lifecycle" tab to observe the active retention policies that ensure sensitive backup data is not kept indefinitely.
