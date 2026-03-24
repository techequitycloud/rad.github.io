# ACE Certification Preparation Guide: Exploring Section 1 (Setting up a cloud solution environment)

This guide is designed to help candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification. It focuses specifically on Section 1 of the exam guide (which covers ~20% of the exam) by walking you through how these concepts are practically implemented in the provided Terraform codebase (`modules/App_CloudRun` and `modules/App_GKE`), which both rely on the shared `modules/App_GCP`. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 1.1 Setting up cloud projects and accounts

### Resource Hierarchy and Projects
**Concept:** Understanding how resources are organized and billed within a Google Cloud environment.
*   **Targeting an Existing Project:** The modules assume the existence of a Google Cloud Project, passed in via the `existing_project_id` variable. Every resource provisioned by these modules (Cloud Run services, GKE workloads, storage buckets, IAM bindings) is scoped to this specific project.
*   **Exploration:** In the GCP Console, click on the **Project Selector** dropdown at the top of the page. Review the structure of your organization, folders, and projects. Navigate to **IAM & Admin > Settings** to view the project ID, project number, and project name—three distinct identifiers tested on the exam.

### Identity and Access Management (IAM)
**Concept:** Applying the principle of least privilege using Google Cloud IAM to grant identities (like service accounts) only the permissions they need.
*   **Dedicated Service Accounts:** Review the `iam.tf` and `sa.tf` files in both modules. They create dedicated, custom service accounts (e.g., `cloud_run_sa`, `gke_sa`, and `cloud_build_sa`) rather than relying on the highly privileged default Compute Engine service account.
*   **Predefined Roles:** Notice how specific, predefined IAM roles (like `roles/cloudsql.client` or `roles/secretmanager.secretAccessor`) are granted to these service accounts using `google_project_iam_member` resources.
*   **Workload Identity (GKE):** In the `App_GKE` module, explore `sa.tf` and `iam.tf` to see how Workload Identity is configured. `google_service_account_iam_member` with the role `roles/iam.workloadIdentityUser` maps a Kubernetes Service Account (KSA) directly to a Google Service Account (GSA), eliminating the need to download and manage static JSON keys for pods.
*   **Exploration:** In the GCP Console, navigate to **IAM & Admin > Service Accounts**. Locate the service accounts created by the modules. Then, go to **IAM & Admin > IAM** and search for those service accounts to see exactly which roles have been granted. For GKE deployments, navigate to **Kubernetes Engine > Workloads**, select a pod, and review its "Security" details to see the mapped Google Service Account.

### APIs and Services
**Concept:** Enabling the specific Google Cloud APIs required for your workload to function.
*   **API Management:** While the foundational APIs are typically enabled by a prerequisite module, these modules rely on APIs like the Cloud Run API (`run.googleapis.com`), Kubernetes Engine API (`container.googleapis.com`), Secret Manager API (`secretmanager.googleapis.com`), and Cloud Build API (`cloudbuild.googleapis.com`).
*   **Exploration:** In the GCP Console, navigate to **APIs & Services > Enabled APIs & services**. Search for "Cloud Run API" or "Kubernetes Engine API" to verify they are enabled. Understanding how to enable and disable APIs is a fundamental ACE task.

### Cloud Operations Suite (Monitoring)
**Concept:** Setting up the foundational elements for observing your cloud environment.
*   **Dashboards and Alerts:** Review `dashboard.tf` and `monitoring.tf`. The modules programmatically create custom monitoring dashboards tailored to either Cloud Run metrics (request counts, concurrency) or GKE metrics (pod counts, restart loops, CPU/Memory per container) and set up alert policies.
*   **Exploration:** Navigate to **Monitoring > Dashboards** to view the custom dashboards created for the applications. Go to **Monitoring > Alerting** to review the configured alert policies and the conditions that trigger them.

---

## 1.2 Managing billing configuration

### Resource Labeling for Cost Allocation
**Concept:** Applying metadata to resources to track spending by environment, team, or application.
*   **Consistent Labels:** Review the `resource_labels` variable in `variables.tf`. The modules apply these labels consistently to all supported resources (Cloud Run, GKE Namespaces, Secret Manager, Cloud Storage). This is crucial for filtering billing reports.
*   **Exploration:** In the GCP Console, navigate to **Billing > Reports**. In the right-hand filter pane, expand the **Labels** section. You can filter the cost breakdown using the keys defined in the `resource_labels` variable (e.g., filtering by `environment: prod`).

### Managing Compute Costs
**Concept:** Controlling operational expenses (OpEx) by managing scaling parameters.
*   **Serverless Costs (Cloud Run):** Look at the `min_instance_count` and `max_instance_count` variables. Setting `min_instance_count = 0` enables scale-to-zero, meaning you pay nothing for compute when there is no traffic.
*   **Cluster Costs (GKE):** While node pools are usually managed outside this application module, GKE workloads control costs via Horizontal Pod Autoscaling (HPA) configured in `deployment.tf` and managing resource requests/limits (`container_resources`) to ensure efficient packing of pods onto billed nodes.
*   **Exploration:** In the Console, navigate to **Cloud Run** or **Kubernetes Engine** to inspect the scaling parameters and resource allocations of your services. Understanding the billing differences between serverless (per request/allocation) and GKE (per node/cluster) is a key ACE exam topic.
