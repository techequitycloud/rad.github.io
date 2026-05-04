# Associate Cloud Engineer (ACE) Certification Exploration Guide

This document maps the features and configurations of the deployed Cloud Run and GKE applications to the Associate Cloud Engineer (ACE) certification exam domains. It serves as an exploration guide for candidates to understand how Google Cloud concepts are practically implemented through these modules. You can experiment with these configurations directly through your web-based deployment portal.

---

## Section 1: Setting up a cloud solution environment

### 1.1 Setting up cloud projects and accounts
*   **Concept:** Setting up the foundational environment involves configuring projects, applying IAM roles, managing APIs, and organizing resources with labels.
*   **Implementation Context:** Both modules require an existing Google Cloud project where foundational APIs have been enabled. They use variables to target the deployment to a specific project and apply labels to all created resources for organizational and billing purposes.
*   **Exploration:**
    *   **Target Project:** Review the `existing_project_id` variable. Modifying this allows you to deploy resources into different isolated project environments. Navigate to **IAM & Admin > Labels** to see existing project-level labels.
    *   **Resource Labeling:** Use the `resource_labels` variable (e.g., `{ env = "dev", cost-center = "123" }`) to apply tags across all resources created by the modules. Navigate to **Compute Engine > VM instances** (or other resource pages) and check the "Labels" column or click into a resource to view its attached labels.
    *   **Support Users:** The `support_users` variable grants specific email addresses access to project-level monitoring alerts and dashboards. Navigate to **IAM & Admin > IAM** and search for the email addresses you provided in `support_users` to view the specific roles (like Monitoring Viewer) they were granted.
*   **Customization:** Try adding a new label like `{ team = "engineering", project-code = "alpha" }` and observe how it propagates to newly created Cloud Storage buckets or Cloud Run services. Explore **Billing > Budgets & alerts** and try creating a budget that triggers when costs associated with your specific `env = "dev"` label exceed a certain threshold.

### 1.2 Managing billing configuration
*   **Concept:** Managing billing configuration includes establishing budgets, linking projects to billing accounts, and monitoring costs through alerts and exports.
*   **Implementation Context:** While Terraform modules typically provision resources rather than manage billing accounts directly, the resource labels applied by the modules are critical for cost allocation and billing exports.
*   **Exploration:**
    *   **Cost Tracking:** Configure the `resource_labels` variable with key-value pairs representing cost centers or departments. Navigate to **Billing > Reports**. In the "Filters" pane on the right, look for the "Labels" section. Filter by the keys you defined (e.g., `cost-center: 123`) to see the specific costs associated with your deployment.
*   **Customization:** Explore **Billing > Budgets & alerts** and try creating a budget that triggers when costs associated with your specific `env = "dev"` label exceed a certain threshold.

---

## Section 2: Planning and implementing a cloud solution

### 2.1 Planning and implementing compute resources
*   **Concept:** Selecting and deploying compute resources, such as Compute Engine, GKE, or Cloud Run, and configuring them for autoscaling and specific workloads.
*   **Implementation Context:** These modules demonstrate two primary compute paradigms: serverless containers (Cloud Run) and managed Kubernetes (GKE Autopilot). They configure deployment images, resource limits, and autoscaling behaviors.
*   **Exploration:**
    *   **Compute Choices:** Compare the `App_CloudRun` and `App_GKE` modules to understand when to use serverless vs. managed Kubernetes.
    *   **Deploying Containers:** Use the `container_image` variable to specify the image URI to deploy. For Cloud Run, navigate to **Cloud Run** and click on your deployed service. View the "Revisions" tab to see the container image URL being used. For GKE, navigate to **Kubernetes Engine > Workloads** and inspect the Pod specifications.
    *   **Autoscaling Configurations:** In `App_CloudRun`, adjust `min_instance_count` and `max_instance_count`. Set `min_instance_count = 0` to explore scale-to-zero capabilities. In **Cloud Run**, view the "Metrics" tab and look at the "Instance count" chart over time. In **Kubernetes Engine > Workloads**, view the "Autoscaling" details for your Deployment.
    *   **Resource Allocation:** Modify the `container_resources` variable to set custom `cpu_limit` and `memory_limit`. In **Cloud Run**, click "Edit & Deploy New Revision" to see how your `cpu_limit` and `memory_limit` variables map directly to the "Capacity" settings in the console UI.
    *   **GKE Specifics:** In the `App_GKE` module, modify `workload_type` to switch between a `Deployment` and a `StatefulSet`. Adjust `service_type` to expose the workload via `LoadBalancer`, `ClusterIP`, or `NodePort`. Then, navigate to **Kubernetes Engine > Services & Ingress** to observe how the network endpoint is exposed differently based on your choice.
*   **Customization:** Change `container_image_source` to `custom` and configure `container_build_config` to build an image directly from a Dockerfile using Cloud Build.

### 2.2 Planning and implementing storage and data solutions
*   **Concept:** Choosing, deploying, and integrating storage products (Cloud Storage, Filestore) and data products (Cloud SQL, Memorystore/Redis) to meet application requirements.
*   **Implementation Context:** The modules dynamically provision Cloud Storage buckets, set up Cloud SQL databases (PostgreSQL or MySQL), establish NFS file shares, and configure Redis caching environments.
*   **Exploration:**
    *   **Cloud Storage:** Use the `create_cloud_storage` toggle and `storage_buckets` object list to provision customized buckets. Navigate to **Cloud Storage > Buckets**. Click on a bucket provisioned by the module. Check the "Lifecycle" tab to see any rules applied via your `lifecycle_rules` configuration.
    *   **File Storage (NFS):** Set `enable_nfs = true` to provision a Cloud Filestore instance. Navigate to **Filestore > Instances** to view the managed NFS server. Then, check the Cloud Run "Volumes" configuration (in the "Revisions" tab) to see how it mounts to the `nfs_mount_path`.
    *   **Cloud SQL Provisioning:** Use the `database_type` variable to select a database engine (e.g., `POSTGRES_15`, `MYSQL_8_0`). Navigate to **SQL**. Click your instance to view the overview. Under "Connections", note that public IP might be disabled, and the connection relies on the Cloud SQL Auth Proxy sidecar injected by `enable_cloudsql_volume`.
    *   **Redis Cache:** Toggle `enable_redis` and pass the `redis_host` and `redis_auth` sensitive variables. Navigate to **Memorystore for Redis**. View your instance's properties, noting its Internal IP and Port, which map to the `REDIS_HOST` and `REDIS_PORT` environment variables injected into your app.
*   **Customization:** Try changing `database_type` to a different version (e.g., from `POSTGRES_14` to `POSTGRES_15`) to understand how major version upgrades are handled. Change the `storage_class` in your configuration to `NEARLINE` or `COLDLINE` for a bucket and verify the updated class in the console.

### 2.3 Planning and implementing networking resources
*   **Concept:** Establishing network connectivity, creating VPCs, applying firewall rules, and deploying load balancers to secure and route traffic.
*   **Implementation Context:** The modules secure outbound traffic through VPC egress settings, control inbound traffic using load balancers and Cloud Armor, and configure DNS/CDN layers.
*   **Exploration:**
    *   **VPC Connectivity:** In `App_CloudRun`, configure `vpc_egress_setting`. In **Cloud Run**, edit a revision and view the "Networking" tab. Observe the "VPC Network" section to see whether traffic is routed via "All traffic" or "Private IPs only".
    *   **Load Balancing and Security:** Toggle `enable_cloud_armor = true` to deploy a Global External Application Load Balancer with a Cloud Armor WAF policy. Navigate to **Network Services > Load balancing**. Inspect the frontend IP, backend services, and the attached Cloud Armor security policy. Navigate to **Network Security > Cloud Armor** to view the specific WAF rules (like the `admin_ip_ranges` allowlist).
    *   **Content Delivery:** Enable `enable_cdn` to activate Cloud CDN on the load balancer. In the Load Balancer backend service details, look for the "Cloud CDN" checkmark. Navigate to **Network Services > Cloud CDN** to view cache hit ratios.
    *   **Traffic Ingress:** Modify the `ingress_settings` in `App_CloudRun`. In the Cloud Run console "Networking" tab, look at "Ingress". Observe how changing the variable shifts the setting from "Allow all traffic" to "Allow internal traffic and traffic from Cloud Load Balancing".
*   **Customization:** Use `application_domains` to define custom domains. Then, check the **Load balancing** console to see the Google-managed SSL certificates automatically provisioned for those domains.

### 2.4 Planning and implementing resources through infrastructure as code
*   **Concept:** Using tools like Terraform to plan, execute, version, and update infrastructure deployments.
*   **Implementation Context:** The entire repository is built on Terraform, demonstrating modular architecture, state management, and repeatable infrastructure delivery.
*   **Exploration:**
    *   **Variables:** Variables like `tenant_deployment_id` and `application_version` are exposed in the deployment portal to allow parameterizing configurations so identical environments (dev, staging, prod) can be deployed.
    *   **IaC Workflows:** By modifying any variable (like `min_instance_count`) via the web-based deployment portal and triggering an update, you can observe how the infrastructure calculates diffs and updates live resources safely without requiring direct access to the codebase. Navigate to **Cloud Storage** and locate your deployment's state bucket. Understand that this state file is the source of truth linking your portal configurations to the actual console resources.
*   **Customization:** Intentionally delete a managed resource via the console, then trigger a re-deployment from the portal to observe IaC drift detection and remediation in action.

---

## Section 3: Ensuring successful operation of a cloud solution

### 3.1 Managing compute resources
*   **Concept:** Monitoring running instances, managing Kubernetes resources, deploying new application versions, and managing traffic splits or canary deployments.
*   **Implementation Context:** The modules support sophisticated release strategies, including multi-stage deployment pipelines and traffic splitting mechanisms.
*   **Exploration:**
    *   **Traffic Management:** In `App_CloudRun`, explore the `traffic_split` list variable. After applying a split, navigate to the **Cloud Run** service and click the "Revisions" tab. You will visually see the traffic percentage slider distributing load between different revisions.
    *   **CI/CD Pipelines:** Set `enable_cicd_trigger = true` and configure `github_repository_url`. Navigate to **Cloud Build > Triggers**. You will see the trigger created by Terraform. Push code to your repo and navigate to **Cloud Build > History** to watch the build pipeline execute in real-time.
    *   **Cloud Deploy:** Toggle `enable_cloud_deploy = true` and define `cloud_deploy_stages`. Navigate to **Cloud Deploy > Delivery pipelines**. View the visual representation of your promotion stages (e.g., dev -> staging -> prod). Practice clicking "Promote" to manually approve a release to the next environment.
*   **Customization:** Deploy version 1.0, then deploy version 2.0. Modify `traffic_split` to allocate 90% to version 1.0 and 10% to version 2.0 to practice a canary release.

### 3.2 Managing storage and data solutions
*   **Concept:** Managing object lifecycle, backing up and restoring database instances, and securing data.
*   **Implementation Context:** The modules automate routine database maintenance tasks and facilitate automated database schema initializations.
*   **Exploration:**
    *   **Automated Backups:** Adjust the `backup_schedule` cron expression and `backup_retention_days`. Navigate to **Cloud Scheduler**. Find the job targeting your backup Cloud Run task. You can manually click "Force Run" to trigger an immediate backup. Then, navigate to the **Cloud Storage** backup bucket to verify the generated `.sql` file.
    *   **Data Restoration/Import:** Set `enable_backup_import = true`, define `backup_source`, and specify `backup_file`. Navigate to **Cloud Run > Jobs**. Find the import job and view its logs to watch the database restoration process step-by-step.
    *   **SQL Initialization:** Set `enable_custom_sql_scripts = true` in the portal and provide a GCS path. Upload a basic `.sql` script (e.g., `CREATE TABLE test (id INT);`) to the defined bucket. Trigger a deployment via the portal, then connect to your Cloud SQL instance via Cloud Shell (`gcloud sql connect...`) to verify the table was created.
*   **Customization:** Experiment with different `backup_schedule` cron expressions to understand how automated backup frequency affects your recovery point objective (RPO).

### 3.3 Managing networking resources
*   **Concept:** Modifying VPC subnets, reserving static IP addresses, and configuring DNS/NAT.
*   **Implementation Context:** While core VPC networks are typically provisioned by a foundational module, these app modules consume those networks and allocate specific IP resources.
*   **Exploration:**
    *   **Static IP Allocation:** In `App_GKE`, ensure `reserve_static_ip = true`. Navigate to **VPC network > IP addresses**. You will see the reserved external IP address listed here, explicitly attached to your Forwarding Rule (Load Balancer).
*   **Customization:** Try toggling `reserve_static_ip` to false and observe how the load balancer receives an ephemeral IP instead, demonstrating the operational risk of not reserving static IPs for production services.

### 3.4 Monitoring and logging
*   **Concept:** Viewing logs, creating custom metrics, deploying Ops Agents, and configuring alerting based on resource utilization.
*   **Implementation Context:** The modules automatically provision integrated Google Cloud Observability resources, including uptime checks and threshold alerts.
*   **Exploration:**
    *   **Uptime Checks:** Modify the `uptime_check_config` variable object. Navigate to **Monitoring > Uptime checks**. You will see the global health check running against your application URL. Click into it to view latency graphs from different geographic regions.
    *   **Probes:** Configure `health_check_config` and `startup_probe_config`. In **Cloud Run**, look at the "Health Checks" section under the "Revisions" tab. In **Kubernetes Engine > Workloads**, view the YAML or the UI representation of the Liveness and Readiness probes.
    *   **Alert Policies:** Use the `alert_policies` list variable to create custom Cloud Monitoring alerts. Navigate to **Monitoring > Alerting**. You will see the policies created by Terraform. Click one to view the conditions (e.g., CPU > 80%). You can also see the notification channels linked to your `support_users`.
*   **Customization:** Change the `path` on a health check to a non-existent endpoint (e.g., `/broken-health`). Apply the change and observe how the deployment fails to become ready in the console because the probe fails.

---

## Section 4: Configuring access and security

### 4.1 Managing Identity and Access Management (IAM)
*   **Concept:** Viewing and creating IAM policies, defining roles, and applying the principle of least privilege.
*   **Implementation Context:** The modules automatically generate and assign dedicated, least-privilege service accounts to the compute instances rather than relying on default compute service accounts.
*   **Exploration:**
    *   **Identity Provisioning:** Review how the `resource_creator_identity` variable delegates resource creation permissions securely. Navigate to **IAM & Admin > IAM**. Search for the custom service account created for your application (e.g., `crapp-run-sa@...`). Inspect its roles (like Secret Manager Secret Accessor or Cloud SQL Client) to verify it follows the principle of least privilege.
    *   **Security Perimeters:** Toggle `enable_vpc_sc = true` to enforce VPC Service Controls. Navigate to **Security > VPC Service Controls**. If your project is part of a perimeter, you can view the protected APIs and the ingress/egress rules that secure the data boundary.
*   **Customization:** Temporarily assign a broader role to the application service account directly in the GCP Console. Note the change, but understand that re-running the deployment from your portal will revert this permission back to the least-privilege state, demonstrating Infrastructure as Code drift detection.

### 4.2 Managing service accounts
*   **Concept:** Creating service accounts, managing IAM permissions, and utilizing them with GKE and Cloud Run applications.
*   **Implementation Context:** The modules securely inject configuration into these identities at runtime without exposing sensitive data.
*   **Exploration:**
    *   **Secret Management:** Use `secret_environment_variables` to map environment variable keys to Secret Manager secret names. Navigate to **Security > Secret Manager**. You will see the secrets provisioned by the module. In **Cloud Run**, view the "Variables & Secrets" tab to see how the secrets are mounted as environment variables, with the values securely hidden.
    *   **Secret Rotation:** Enable `enable_auto_password_rotation`. In **Secret Manager**, click your database password secret and view the "Rotation" tab to see the active schedule. You can also manually trigger a rotation from the console.
    *   **Identity-Aware Proxy (IAP):** Toggle `enable_iap = true` and configure `iap_authorized_users` and `iap_authorized_groups`. Navigate to **Security > Identity-Aware Proxy**. You will see your backend service listed with IAP turned on. The right-hand panel shows the users and groups granted the "IAP-secured Web App User" role.
*   **Customization:** Try accessing your application URL from an incognito window after enabling IAP. You will be redirected to a Google login page. Only accounts listed in your `iap_authorized_users` list will successfully access the app.
