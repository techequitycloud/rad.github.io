# Professional Cloud Security Engineer (PSE) Certification Exploration Guide

This document maps the features and configurations of the deployed Cloud Run and GKE applications to the Professional Cloud Security Engineer (PSE) certification exam domains. It serves as an exploration guide for candidates to understand how security concepts are practically implemented in Google Cloud. You can experiment with these configurations directly through your web-based deployment portal.

---

## Section 1: Configuring access (~25% of the exam)

### 1.1 Managing Cloud Identity
*   **Concept:** Configuring single sign-on (SSO), automating lifecycle management, and configuring Workforce Identity Federation.
*   **Implementation Context:** While the deployment does not directly provision Cloud Identity users or groups, it relies heavily on pre-existing identity structures for access control. For example, specific Google Groups and support users are authorized for Identity-Aware Proxy (IAP) access and monitoring alert notifications via the portal configurations.
*   **Exploration:** Navigate to the GCP Console **IAM & Admin > IAM**. Observe how Google Groups and individual users are utilized to grant access to resources like monitoring dashboards and Identity-Aware Proxy (IAP). Check the 'Principals' tab to see inherited organization-level group accesses.
*   **Customization:** In your deployment portal, modify the `iap_authorized_groups` or `support_users` inputs to include a new test user or group. Re-deploy the application and observe how the IAM policies are updated in the GCP Console.

### 1.2 Managing service accounts
*   **Concept:** Securing service accounts, implementing the principle of least privilege, and configuring Workload Identity Federation.
*   **Implementation Context:** The deployment avoids default compute service accounts. Instead, it provisions dedicated service accounts for the application. The GKE deployment uses Workload Identity to bind Kubernetes Service Accounts (KSAs) to Google Service Accounts (GSAs), eliminating the need for long-lived service account keys.
*   **Exploration:**
    *   **GKE:** Go to **Kubernetes Engine > Workloads**, select the deployed application, and view its YAML. Note the `serviceAccountName`. Then, go to **IAM & Admin > Service Accounts**, find the corresponding GCP service account, and check its permissions to see the `roles/iam.workloadIdentityUser` binding.
    *   **Cloud Run:** Go to **Cloud Run**, select the service, and view the **Security** tab to see the dedicated service account assigned to the revision.
*   **Customization:** Temporarily assign a broader role (like `roles/editor`) to the application service account directly in the GCP Console. Note the change, but understand that re-running the deployment from your portal will revert this permission back to the least-privilege state, demonstrating Infrastructure as Code drift detection.

### 1.3 Managing authentication
*   **Concept:** Session management, SAML/OAuth, and enforcing 2-step verification.
*   **Implementation Context:** The deployment integrates with Identity-Aware Proxy (IAP) when the `enable_iap` setting is active. This acts as a centralized authentication mechanism verifying user identity and context before allowing access to the application, leveraging Google's OAuth infrastructure.
*   **Exploration:** Navigate to **Security > Identity-Aware Proxy**. Select the application resource and review the OAuth consent screen configuration, session lengths, and authorized principals. Try accessing the application URL from an incognito window to see the Google authentication flow in action.
*   **Customization:** If your deployment has IAP disabled, go to your deployment portal, toggle the `enable_iap` setting to true, and provide the necessary OAuth credentials. Deploy the changes and observe how public access is immediately revoked in favor of strict identity verification.

### 1.4 Managing and implementing authorization controls
*   **Concept:** Managing IAM roles, principle of least privilege, and access control at various resource levels.
*   **Implementation Context:** The deployment strictly adheres to least privilege. For instance, the application service account is granted `roles/secretmanager.secretAccessor` only on the specific secrets it requires, not project-wide. Storage buckets have `uniform_bucket_level_access` enabled to ensure IAM policies govern all access.
*   **Exploration:** Go to **Security > Secret Manager**, select a secret (like the database password), and view the **Permissions** panel. Notice that only the specific application service account has access to read the payload. Navigate to **Cloud Storage**, select the provisioned bucket, and confirm that Uniform Bucket-Level Access is enforced, overriding any legacy ACLs.
*   **Customization:** Create a new custom secret in Secret Manager via the console. Attempt to read this secret from inside the Cloud Run or GKE container. The request will be denied. Then, return to your deployment portal, update the `secret_environment_variables` setting to include this new secret, apply the changes, and verify that access is now granted, illustrating fine-grained authorization boundaries.

### 1.5 Defining the resource hierarchy
*   **Concept:** Managing folders, projects, organization policies, and permission inheritance.
*   **Implementation Context:** The deployment targets a specific project. This project inherits organization policies (e.g., restricting public IPs or enforcing trusted image registries) defined at higher levels of the resource hierarchy.
*   **Exploration:** Navigate to **IAM & Admin > Organization Policies**. Review the effective policies for the deployment project. Look for constraints like `constraints/compute.vmExternalIpAccess` or `constraints/iam.disableServiceAccountKeyCreation` to understand the boundaries within which the applications operate.
*   **Customization:** If you have Organization Admin rights, create a custom Organization Policy on a testing folder to restrict deployment locations (e.g., `constraints/gcp.resourceLocations`). Attempt to provision a new resource (like a storage bucket) via the deployment portal in a restricted region and observe the immediate failure, demonstrating how hierarchy policies override local configurations.

---

## Section 2: Securing communications and establishing boundary protection (~22% of the exam)

### 2.1 Designing and configuring perimeter security
*   **Concept:** Configuring network perimeter controls, Cloud NGFW, IAP, load balancers, and web application firewalls (WAF).
*   **Implementation Context:** By enabling `enable_cloud_armor` in the portal, the environment deploys a Global External Application Load Balancer integrated with Google Cloud Armor. This provides WAF capabilities (DDoS protection, OWASP Top 10 mitigation) and allows for custom domain SSL termination.
*   **Exploration:** Go to **Network Security > Cloud Armor**. Inspect the security policy attached to the load balancer. Review the default rules and check the 'Targets' tab to confirm it is protecting the backend service routing to your application.
*   **Customization:** In your deployment portal, add your current public IP address to the `admin_ip_ranges` setting. Apply the changes and view the Cloud Armor policy in the console to see the explicit 'allow' rule prioritized above the default WAF rules, demonstrating how exception handling and IP-based access controls work at the edge.

### 2.2 Configuring boundary segmentation
*   **Concept:** VPC properties, VPC peering, network isolation, and VPC Service Controls.
*   **Implementation Context:**
    *   **Network Isolation:** Cloud SQL instances and Redis caches are deployed with private IPs within the VPC, isolating them from the public internet.
    *   **VPC Service Controls:** If `enable_vpc_sc` is set in the portal, the environment enforces VPC Service Controls perimeters around the GCP APIs used, preventing data exfiltration.
    *   **GKE Network Policies:** The GKE deployment utilizes GKE Dataplane V2 to enforce micro-segmentation via Kubernetes NetworkPolicies (configurable via `enable_network_segmentation`).
*   **Exploration:**
    *   Navigate to **VPC network > VPC networks** and inspect the subnets. Go to **SQL** and verify the instance only has a Private IP address.
    *   For GKE, connect to the cluster and use `kubectl get networkpolicies -A` to view the intra-cluster segmentation rules that restrict pod-to-pod communication.
*   **Customization:** Try to connect to the Cloud SQL instance from a Cloud Shell environment (which is outside the VPC). The connection will timeout. Then, deploy a tiny test VM inside the same VPC network and attempt the connection again to prove network isolation boundaries.

### 2.3 Establishing private connectivity
*   **Concept:** Private connectivity between VPC networks, on-premises hosts, and Google APIs.
*   **Implementation Context:** The Cloud Run deployment uses Direct VPC Egress (configured via `vpc_egress_setting`) to securely route outbound traffic from the serverless environment into the VPC network, allowing it to reach internal resources like Cloud SQL without traversing the public internet. The GKE deployment uses VPC-native clusters.
*   **Exploration:** Go to **Cloud Run**, select the service, and check the **Networking** tab. Review the "VPC network egress" settings to confirm whether 'All Traffic' or 'Private Ranges Only' is being routed internally.
*   **Customization:** In your deployment portal, change the `vpc_egress_setting` from 'PRIVATE_RANGES_ONLY' to 'ALL_TRAFFIC'. Deploy the change and consider the impact: now, even requests from your container to external public APIs will be routed through your VPC, potentially allowing you to inspect them using Cloud NAT logging or Firewall Rules.

---

## Section 3: Ensuring data protection (~23% of the exam)

### 3.1 Protecting sensitive data and preventing data loss
*   **Concept:** Restricting access to datastores and securing secrets with Secret Manager.
*   **Implementation Context:** All sensitive configuration values (like database passwords or Redis auth tokens) are managed via Secret Manager and injected into the application at runtime (via `secret_environment_variables`). The plaintext values are never exposed in environment variables visible in the console.
*   **Exploration:** Navigate to **Security > Secret Manager**. Verify that the secrets are present. Check the 'Versions' tab to see how secret history is tracked, and verify the IAM permissions are restricted solely to the application service account.
*   **Customization:** In your deployment portal, toggle the `enable_auto_password_rotation` feature. Apply the deployment and review the Secret Manager interface to see the rotation schedule applied. Check Cloud Scheduler to see the newly created rotation job, demonstrating automated credential hygiene.

### 3.2 Managing encryption at rest, in transit, and in use
*   **Concept:** Managing encryption keys (CMEK), key rotation, and applying encryption methods.
*   **Implementation Context:**
    *   **In Transit:** SSL/TLS is terminated at the Load Balancer or managed natively by Cloud Run.
    *   **At Rest:** While Google default encryption is used heavily, the environment supports Customer-Managed Encryption Keys (CMEK) for securing Cloud Storage buckets, with IAM bindings automated via `manage_storage_kms_iam`.
*   **Exploration:** Go to **Security > Key Management**. If CMEK is utilized, inspect the KeyRings and Keys. Review the 'Rotation period' settings and the IAM permissions granting the Storage service agent access to encrypt/decrypt data.
*   **Customization:** If CMEK is not currently used, try creating a test GCS bucket manually and selecting 'Customer-managed encryption key'. Observe the manual IAM setup required (granting the Cloud Storage service account access to the KMS key) that the portal variable automates for you.

### 3.3 Securing AI workloads
*   **Concept:** Implementing security and privacy controls for AI/ML systems.
*   **Implementation Context:** While these core infrastructure deployments are general-purpose, they serve as the secure foundation for AI applications (e.g., deploying Vertex AI inference endpoints or secure internal ML tools). The strong perimeter security (Cloud Armor), identity (IAP), and secret management directly protect AI models and training data.
*   **Exploration:** If deploying an AI workload, ensure the container image is scanned for vulnerabilities in Artifact Registry. Navigate to **Artifact Registry**, click your image, and view the 'Vulnerabilities' tab to see the CVE scanning results.
*   **Customization:** In your deployment portal, intentionally reference an older, known-vulnerable base image (like an old version of nginx or python) in your `container_image` setting. Deploy, then review the Artifact Registry vulnerability report. Consider how you could set up a Binary Authorization rule to block deployments containing 'Critical' CVEs.

---

## Section 4: Managing operations (~19% of the exam)

### 4.1 Automating infrastructure and application security
*   **Concept:** Automating security scanning via CI/CD, and configuring Binary Authorization.
*   **Implementation Context:**
    *   **CI/CD:** Automated build and deployment pipelines can be configured via `enable_cicd_trigger` in the portal, connecting directly to source control.
    *   **Binary Authorization:** Setting `enable_binary_authorization` ensures that only trusted, signed container images are deployed to the clusters or Cloud Run services, securing the software supply chain against unauthorized code.
*   **Exploration:** Go to **Security > Binary Authorization**. Review the policy to ensure it mandates attestations for the target cluster or service. View the configured 'Attestors' and note the KMS keys used to verify the digital signatures.
*   **Customization:** In your deployment portal, enable `enable_binary_authorization` but do not configure the upstream CI/CD pipeline to sign the images. Attempt a deployment and observe the specific error message generated rejecting the unsigned image, proving the admission controller is functioning.

### 4.2 Configuring logging, monitoring, and detection
*   **Concept:** Analyzing logs, designing logging strategies, and configuring Security Command Center.
*   **Implementation Context:** The environment natively integrates with Cloud Logging and Monitoring. It configures default uptime checks and alert policies (configurable via `alert_policies` in the portal) to track application health and detect operational anomalies that could indicate a security incident.
*   **Exploration:**
    *   **Logs:** Navigate to **Logging > Logs Explorer**. Query logs for the application, filtering for `severity>=ERROR` or specific HTTP 4xx/5xx status codes.
    *   **Monitoring:** Go to **Monitoring > Alerting** to review the configured policies and notification channels.
*   **Customization:** In your deployment portal, add a new configuration to the `alert_policies` setting designed to detect potential abuse, such as high request latency. Apply the configuration and trigger the condition manually to test the alert notification flow.

---

## Section 5: Supporting compliance requirements (~11% of the exam)

### 5.1 Adhering to regulatory and industry standards requirements for the cloud
*   **Concept:** Evaluating the shared responsibility model, mapping compliance requirements to controls.
*   **Implementation Context:** The deployment simplifies compliance by leveraging managed services (Cloud Run, GKE Autopilot, Cloud SQL) that shift significant operational and security burdens to Google under the shared responsibility model. Regionalization ensures data residency requirements are met.
*   **Exploration:** Review the architecture. The combination of private networking, Secret Manager, IAP, and Cloud Armor provides the technical controls necessary to map to common compliance frameworks like PCI-DSS or HIPAA. Navigate to the **Security Command Center** (if enabled in your organization) to view compliance posture dashboards and see how the deployed resources score against standard frameworks.
*   **Customization:** Review your organization's data residency requirements. If your deployment portal supports it, modify the target region for your deployment (e.g., to `europe-west4`). After deploying, verify in the console that all resources (Compute, Storage, SQL, KMS) are strictly bound to that geographical boundary.
