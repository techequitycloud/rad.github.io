# Setting up a cloud solution environment
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section1.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section1.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/ace_section1.pdf)

This guide is designed to help candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification. It focuses specifically on Section 1 of the exam guide (which covers ~20% of the exam) by walking you through how these concepts are practically implemented using the platform deployment portal. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 1.1 Setting up cloud projects and accounts

### Resource Hierarchy and Projects
**Concept:** Understanding how resources are organized and billed within a Google Cloud environment.
*   **Targeting an Existing Project:** The deployments assume the existence of a Google Cloud Project, provided in the deployment portal. Every resource provisioned by these deployments (Cloud Run services, GKE workloads, storage buckets, IAM bindings) is scoped to this specific project.
*   **Exploration:** In the GCP Console, click on the **Project Selector** dropdown at the top of the page. Review the structure of your organization, folders, and projects. Navigate to **IAM & Admin > Settings** to view the project ID, project number, and project name—three distinct identifiers tested on the exam.

### Identity and Access Management (IAM)
**Concept:** Applying the principle of least privilege using Google Cloud IAM to grant identities (like service accounts) only the permissions they need.
*   **Dedicated Service Accounts:** Review the configuration options in the deployment portal. They create dedicated, custom service accounts (e.g., `cloud_run_sa`, `gke_sa`, and `cloud_build_sa`) rather than relying on the highly privileged default Compute Engine service account.
*   **Predefined Roles:** Notice how specific, predefined IAM roles (like `roles/cloudsql.client` or `roles/secretmanager.secretAccessor`) are granted to these service accounts using automated IAM bindings.
*   **Workload Identity (GKE):** In the `App_GKE` deployment, explore the deployment configuration and the deployment configuration to see how Workload Identity is configured. `google_service_account_iam_member` with the role `roles/iam.workloadIdentityUser` maps a Kubernetes Service Account (KSA) directly to a Google Service Account (GSA), eliminating the need to download and manage static JSON keys for pods.
*   **Exploration:** In the GCP Console, navigate to **IAM & Admin > Service Accounts**. Locate the service accounts created by the deployments. Then, go to **IAM & Admin > IAM** and search for those service accounts to see exactly which roles have been granted. For GKE deployments, navigate to **Kubernetes Engine > Workloads**, select a pod, and review its "Security" details to see the mapped Google Service Account.

### APIs and Services
**Concept:** Enabling the specific Google Cloud APIs required for your workload to function.
*   **API Management:** While the foundational APIs are typically enabled by a prerequisite deployment, these deployments rely on APIs like the Cloud Run API (`run.googleapis.com`), Kubernetes Engine API (`container.googleapis.com`), Secret Manager API (`secretmanager.googleapis.com`), and Cloud Build API (`cloudbuild.googleapis.com`).
*   **Exploration:** In the GCP Console, navigate to **APIs & Services > Enabled APIs & services**. Search for "Cloud Run API" or "Kubernetes Engine API" to verify they are enabled. Understanding how to enable and disable APIs is a fundamental ACE task.

### Cloud Operations Suite (Monitoring)
**Concept:** Setting up the foundational elements for observing your cloud environment.
*   **Dashboards and Alerts:** Review the configuration options in the deployment portal. The deployments programmatically create custom monitoring dashboards tailored to either Cloud Run metrics (request counts, concurrency) or GKE metrics (pod counts, restart loops, CPU/Memory per container) and set up alert policies.
*   **Exploration:** Navigate to **Monitoring > Dashboards** to view the custom dashboards created for the applications. Go to **Monitoring > Alerting** to review the configured alert policies and the conditions that trigger them.

---

## 1.2 Managing billing configuration

### Resource Labeling for Cost Allocation
**Concept:** Applying metadata to resources to track spending by environment, team, or application.
*   **Consistent Labels:** Review the resource labeling options in the deployment configuration. The deployment process applies these labels consistently to all supported resources (Cloud Run, GKE Namespaces, Secret Manager, Cloud Storage). This is crucial for filtering billing reports.
*   **Exploration:** In the GCP Console, navigate to **Billing > Reports**. In the right-hand filter pane, expand the **Labels** section. You can filter the cost breakdown using the keys defined in the `resource_labels` variable (e.g., filtering by `environment: prod`).

### Managing Compute Costs
**Concept:** Controlling operational expenses (OpEx) by managing scaling parameters.
*   **Serverless Costs (Cloud Run):** Review the minimum and maximum instance count settings in the deployment portal. Setting `min_instance_count = 0` enables scale-to-zero, meaning you pay nothing for compute when there is no traffic.
*   **Cluster Costs (GKE):** While node pools are usually managed outside this application deployment, GKE workloads control costs via Horizontal Pod Autoscaling (HPA) configured in the deployment configuration and managing resource requests/limits (container resource limits) to ensure efficient packing of pods onto billed nodes.
*   **Exploration:** In the Console, navigate to **Cloud Run** or **Kubernetes Engine** to inspect the scaling parameters and resource allocations of your services. Understanding the billing differences between serverless (per request/allocation) and GKE (per node/cluster) is a key ACE exam topic.
