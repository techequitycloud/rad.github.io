# ACE Certification Preparation Guide: Section 1 — Setting up a Cloud Solution Environment (~23% of the exam)

This guide helps candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification explore Section 1 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **Services GCP**, which establishes the foundational shared infrastructure (VPC networking, databases, GKE clusters, IAM service accounts, and APIs); **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot. Both application modules depend on Services GCP and share the App GCP library for discovery and integration logic.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes.

---

## 1.1 Setting up cloud projects and accounts

### Creating a resource hierarchy
**Concept:** GCP organises resources into a hierarchy — Organisation → Folders → Projects → Resources. Understanding this structure is foundational to the ACE exam.

**In the RAD UI:**
Every module requires the `project_id` variable (Group 1 in each module). This is the GCP project into which all resources are deployed. Every resource created — VPC networks, Cloud SQL instances, GKE clusters, Cloud Run services, IAM bindings, Secret Manager secrets, and Cloud Storage buckets — is scoped to this single project. Deploying Services GCP first establishes the shared infrastructure layer; App CloudRun and App GKE deployments then build application environments on top of it within the same project.

**Console Exploration:**
Open the [GCP Console](https://console.cloud.google.com) and click the **Project Selector** dropdown at the top of the page. Review the organisation, folder, and project hierarchy. Navigate to **IAM & Admin > Settings** to view the project ID, project number, and project name — three distinct identifiers that the ACE exam tests on. Note that the project ID is set permanently at creation time and cannot be changed.

---

### Applying organisational policies to the resource hierarchy
**Concept:** Organisation policies enforce governance guardrails across all resources in an organisation or folder, regardless of individual IAM permissions.

**In the RAD UI (Services GCP):**
The `enable_vpc_sc` variable (Group 10) creates a VPC Service Perimeter around the project's GCP APIs. Once enabled, access to protected APIs is restricted to traffic from within the perimeter — even if credentials are compromised, data cannot leave the defined boundary. This is the project-level implementation of an organisational boundary control. When Services GCP is deployed into a project that belongs to a GCP organisation, the perimeter is registered at the organisation level.

The `configure_policy_controller` variable (Group 7) enables Policy Controller (part of GKE Enterprise) on GKE clusters, enforcing OPA Gatekeeper admission control policies across all workloads. This is the Kubernetes equivalent of organisation policy enforcement — for example, you can enforce constraints such as "all pods must have resource limits set" or "no container may run as root" across every workload in the cluster.

> **Real-World Example:** A financial services company deploys GKE workloads and must comply with internal security standards that prohibit privileged containers. By enabling Policy Controller and deploying a constraint from the Policy Controller constraint library, every new pod is automatically evaluated at admission — non-compliant workloads are rejected before they ever start.

**Console Exploration:**
Navigate to **Security > VPC Service Controls** to view any active service perimeters. Navigate to **IAM & Admin > Organisation Policies** to review the built-in constraint catalogue and see which policies are applied to your project.

---

### Granting members IAM roles within a project
**Concept:** Applying the principle of least privilege using predefined IAM roles granted to specific identities.

**In the RAD UI:**
*   **`support_users`** (Group 1, all modules): Accepts a list of Google account or Google Workspace group email addresses. The RAD platform grants these identities access to Cloud Monitoring dashboards, uptime checks, and alert notification channels within the project. Using a group email (e.g. `ops-team@example.com`) rather than individual addresses is the recommended practice — changes to group membership in Cloud Identity automatically propagate to GCP IAM.

Behind each deployment, the RAD platform uses an underlying resource creator identity to provision dedicated, least-privilege service accounts:
*   **Services GCP** creates a Cloud Run workload SA (granted `roles/cloudsql.client`, `roles/storage.objectAdmin`, `roles/secretmanager.secretAccessor`), a Cloud Build SA (granted `roles/run.admin`, `roles/container.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`), and an NFS server SA (granted `roles/logging.logWriter`).
*   **App CloudRun** creates a dedicated Cloud Run service SA (granted `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`, `roles/storage.objectAdmin`) and a Cloud Build SA for CI/CD.
*   **App GKE** creates a GKE workload SA (bound to a Kubernetes Service Account via Workload Identity, granted `roles/secretmanager.secretAccessor`, `roles/storage.objectAdmin`) and a Cloud Build SA.

**Console Exploration:**
Navigate to **IAM & Admin > Service Accounts** to locate the service accounts provisioned by each module. Click into any service account and select the **Permissions** tab to see exactly which roles it holds. Navigate to **IAM & Admin > IAM** to view all principals in the project and their assigned roles.

---

### Managing users and groups in Cloud Identity (manually and automated)
**Concept:** Managing human identities centrally in Cloud Identity or Google Workspace, then granting GCP IAM access to those identities or groups.

**In the RAD UI:**
The `support_users` variable (Group 1, all modules) is the key integration point. By entering a Google Workspace group email (e.g. `platform-team@example.com`) rather than individual user emails, you configure a single IAM binding that automatically tracks group membership. Adding or removing a user from the group in Google Workspace Admin Console or Cloud Identity immediately changes their effective GCP access — without any change to IAM bindings. This is the automated user management pattern tested on the ACE exam.

> **Real-World Example:** An operations team of 12 engineers all need read access to Cloud Monitoring dashboards. Rather than creating 12 individual IAM bindings, the administrator creates a single binding for `ops-team@company.com`. When an engineer joins or leaves the team, only the Google Workspace group membership changes — GCP access is updated automatically across every project where that group is bound.

**Console Exploration:**
Navigate to **IAM & Admin > IAM** and find the email you configured in `support_users`. Click it to see its effective roles. If you configured a group, navigate to **admin.google.com** (Google Workspace Admin Console) to add or remove users from that group, then verify the access change propagates back to GCP.

---

### Enabling APIs within projects
**Concept:** Activating Google Cloud service APIs in a project before any resources using those APIs can be provisioned.

**In the RAD UI (Services GCP):**
The RAD platform automatically enables all required APIs in the target project upon deployment. This background process activates more than 35 APIs, including: Cloud Monitoring, Cloud Logging, IAM, Compute Engine, Cloud Run, Kubernetes Engine, Cloud SQL Admin, Secret Manager, Cloud Build, Artifact Registry, Cloud Filestore, Cloud KMS, Cloud Deploy, Binary Authorization, Access Context Manager (for VPC-SC), Cloud DNS, Memorystore for Redis, Pub/Sub, and Cloud Billing Budgets. Both App CloudRun and App GKE rely on these APIs being active before they can deploy successfully.

**Console Exploration:**
Navigate to **APIs & Services > Enabled APIs & services**. Search for `Kubernetes Engine API` and `Cloud Run Admin API` to confirm they are active. Click on any API to see its usage metrics and quota consumption. Practice using **APIs & Services > Library** to find and manually enable an API — understanding this workflow is a direct ACE exam requirement.

---

### Provisioning and setting up products in Google Cloud Observability
**Concept:** Setting up the foundational observability stack — monitoring, alerting, dashboards, uptime checks — for your cloud environment.

**In the RAD UI:**
*   **Services GCP** (`notification_alert_emails`, `alert_cpu_threshold`, `alert_memory_threshold`, `alert_disk_threshold` variables, Group 11): Provisions Cloud Monitoring alert policies for the shared infrastructure layer — Cloud SQL CPU, memory and disk utilisation alerts; NFS server health, CPU, and memory alerts. Email notification channels are created for each address in `notification_alert_emails`.
*   **App CloudRun** (`support_users`, `uptime_check_config`, `alert_policies` variables): Provisions application-level alert policies for high Cloud Run latency (p95), CPU starvation, and HTTP 5xx error rates, plus a custom Cloud Monitoring dashboard showing request counts, instance counts, and latency. Uptime checks run globally against the application endpoint.
*   **App GKE** (`support_users`, `uptime_check_config`, `alert_policies` variables): Provisions GKE-specific alert policies for pod CrashLoopBackOff restart loops, unschedulable pods, container CPU and memory saturation, and Gateway latency, plus a custom dashboard for pod counts and replica status.

**Console Exploration:**
Navigate to **Monitoring > Dashboards** to see the custom dashboards created for both the shared infrastructure (Services GCP) and the application layers (App CloudRun or App GKE). Navigate to **Monitoring > Alerting** to review the alert policies — click into any policy to view its MQL-based conditions and notification channels. Navigate to **Monitoring > Uptime checks** to see the synthetic monitors created for each application endpoint.

---

### Assessing quotas and requesting increases
**Concept:** Understanding per-project quota limits on GCP services, identifying constraints before they affect workloads, and knowing how to request increases.

**In the RAD UI:**
Deploying these modules surfaces quota-constrained resources in practice:
*   Services GCP consumes quota for Compute Engine IP addresses (Cloud NAT, static IPs), Cloud SQL vCPUs per region, and Artifact Registry storage.
*   App CloudRun consumes quota for Cloud Run instance count per region and global external IP addresses (for the load balancer).
*   App GKE consumes quota for GKE Autopilot pod vCPUs and memory per region.

Configuring `max_instance_count` (App CloudRun) or `min_instance_count`/`max_instance_count` (App GKE) directly affects which quotas your deployment will stress.

**Console Exploration:**
Navigate to **IAM & Admin > Quotas**. Filter by **Service** (e.g. `Cloud Run Admin API`) and **Region** to see current usage against your limit. Find a quota that your deployment is consuming and locate the **Edit Quotas** button — practice submitting an increase request (you can cancel without submitting). Understanding this workflow is a direct ACE exam topic.

---

### Setting up standalone organisations
**Concept:** Understanding GCP Organisations — the root resource that owns all projects — and the privileges required to manage organisation-level resources.

**In the RAD UI (Services GCP):**
When Services GCP is deployed into a project that belongs to a GCP organisation, the module discovers the organisation ID automatically from the project metadata. This organisation ID is required to create VPC Service Perimeters (`enable_vpc_sc`) and to configure Security Command Center notification configs (`enable_security_command_center`, `enable_scc_notifications`). Both of these features require organisation-level IAM permissions (beyond project-level Owner), illustrating the privilege separation between project and organisation administration.

**Console Exploration:**
Navigate to **IAM & Admin > Settings** and look for the **Organisation** field. Navigate to **Security > VPC Service Controls** — note that perimeters are scoped to the organisation, not the project. Navigate to **IAM & Admin > Organisation Policies** to see policies enforced at the organisation level.

---

### Setting up cloud networking
**Concept:** Creating the foundational VPC network, subnets, and network services that all other cloud resources depend on.

**In the RAD UI (Services GCP):**
The following variables (Group 2) control the foundational network provisioned by Services GCP:
*   `availability_regions`: The list of GCP regions in which to create subnets, Cloud Routers, and Cloud NAT gateways. Supports multi-region deployments.
*   `network_name`: Name of the custom-mode VPC network created for the project (default: `vpc-network`).
*   `subnet_cidr_range`: CIDR ranges for application subnets in each region (default: `10.0.0.0/24` per region).
*   `gke_subnet_base_cidr`, `gke_pod_base_cidr`, `gke_service_base_cidr` (Group 7): Dedicated CIDR ranges for GKE cluster subnets, pod IP ranges, and service IP ranges — required for VPC-native GKE Autopilot clusters.

Services GCP also establishes **Private Service Access** (a peered `/16` address range) automatically, which is required for Cloud SQL, Memorystore for Redis, and Cloud Filestore to use private IP addresses only — a security best practice for all managed services. Private Service Access (PSA) is distinct from Private Service Connect (PSC): PSA uses VPC peering to connect your VPC to Google's managed services network, while PSC provides private endpoints for accessing Google APIs or published services without traversing the public internet.

> **Real-World Example:** A healthcare company stores patient data in Cloud SQL. By enabling Private Service Access, the database is only reachable from inside the VPC via a private IP — it has no public endpoint exposed to the internet. Even if a network misconfiguration occurred, an external attacker would find no open port to target.

**Console Exploration:**
Navigate to **VPC network > VPC networks** and select the VPC created by Services GCP. Review its subnets (one per region), secondary IP ranges for GKE pods and services, and the routing table. Navigate to **VPC network > Cloud NAT** to see the NAT gateway allowing private instances to reach the internet for updates. Navigate to **VPC network > VPC network peering** to view the Private Service Access peering connection to Google's managed services network.

---

### Confirming availability of products in geographical locations
**Concept:** Verifying which GCP products and feature tiers (regional, zonal, global) are available in your target geography before committing to an architecture.

**In the RAD UI (Services GCP):**
*   `availability_regions` (Group 2): All subnets, Cloud NAT, Cloud Router, and optionally GKE clusters are deployed into each region listed here. Adding a second region to this variable deploys the full networking stack there as well, enabling multi-region application deployments.
*   `postgres_database_availability_type` (Group 3): Switching between `ZONAL` (single-zone, lower cost, development) and `REGIONAL` (multi-zone HA, production) illustrates the regional redundancy options for Cloud SQL — a key exam topic. REGIONAL availability deploys a synchronous standby in a second zone within the same region.
*   `filestore_tier` (Group 6): Options `BASIC_HDD`, `BASIC_SSD`, and `ENTERPRISE` map to different Filestore tiers available in different regions, with ENTERPRISE providing regional (multi-zone) availability.

**Console Exploration:**
Navigate to **Cloud SQL** and observe the region and zone of your instance. Note the difference between zonal and regional availability in the instance details. Navigate to **Filestore > Instances** and compare the zone placement for BASIC vs ENTERPRISE tiers. Use the [GCP Products by Region](https://cloud.google.com/about/locations) page to verify which services are available in any specific region before configuring `availability_regions`.

> **Real-World Example:** A SaaS company is expanding to serve customers in Australia. Before committing to `australia-southeast1` as an `availability_regions` entry, they check the GCP Products by Region page to confirm that Cloud SQL, Memorystore for Redis, and GKE Autopilot are all available there — avoiding a deployment failure caused by an unsupported service in the target region.

---

### Configuring Cloud Asset Inventory and using Gemini Cloud Assist to analyse resources
**Concept:** Using Cloud Asset Inventory to query and track all resources across a project, and using Gemini Cloud Assist in Cloud Monitoring for AI-assisted analysis of your environment.

**In the RAD UI (Services GCP):**
*   **Asset API Activation:** The RAD platform automatically enables the Cloud Asset API (`cloudasset.googleapis.com`) in the background. Once active, Cloud Asset Inventory continuously indexes every resource provisioned by Services GCP, App CloudRun, and App GKE — VPC networks, subnets, Cloud SQL instances, GKE clusters, Cloud Run services, IAM bindings, GCS buckets, Secret Manager secrets, and more — making them queryable via the Asset Inventory console or API.
*   `enable_security_command_center` (Group 11, Services GCP): Activates Security Command Center (SCC), which integrates directly with Cloud Asset Inventory. SCC continuously analyses resource configurations using Security Health Analytics, detecting misconfigurations across all resources deployed by the modules.
*   `enable_scc_notifications` (Group 11, Services GCP): Routes SCC findings to a Pub/Sub topic, enabling integration with alerting pipelines, SIEM tools, or custom dashboards.

**Console Exploration:**
Navigate to **IAM & Admin > Asset Inventory**. Use the query interface to search for specific resource types, e.g. filter by type `sqladmin.googleapis.com/Instance` to find all Cloud SQL instances in the project. In **Cloud Monitoring**, look for the **Gemini** (sparkle/star) icon in the top navigation — click it to use Gemini Cloud Assist to ask natural-language questions about your monitoring data, alert policies, or resource utilisation.

---

## 1.2 Managing billing configuration

### Creating billing accounts and linking projects to a billing account
**Concept:** Linking a GCP project to a billing account so that paid services can be enabled and costs tracked.

**In the RAD UI (Services GCP):**
The `billing_account_id` variable (Group 2) optionally links the target project to a billing account. This is a prerequisite for enabling quota-consuming paid APIs. Without a linked billing account, GCP will not activate services such as Cloud SQL, GKE, or Cloud Run.

**Console Exploration:**
Navigate to **Billing** and select your billing account. Under **Account management**, confirm which projects are linked. Under **Billing > Overview**, review the current month's spend by service.

---

### Establishing billing budgets and alerts
**Concept:** Setting spending thresholds with automated notifications to prevent unexpected cost overruns.

**In the RAD UI:**
*   **Services GCP** enables `billingbudgets.googleapis.com` automatically, making programmatic budget creation available. The `support_users` variable provides the email addresses for budget alert recipients.
*   **App CloudRun**: `min_instance_count` set to `0` enables scale-to-zero — the service incurs zero compute cost when there is no traffic. `max_instance_count` caps the maximum number of active instances, directly capping maximum compute spend. Cloud Run billing is per vCPU-second and GB-second of memory allocation, so these parameters have a direct cost impact.
*   **App GKE**: GKE Autopilot billing is per pod resource request (vCPU + memory). The `container_resources` variable (setting CPU and memory requests/limits) and HPA/VPA scaling configurations directly control per-pod billing. `min_instance_count` and `max_instance_count` bound the replica count.
*   **Services GCP cost levers**: `create_redis = false` avoids the ongoing cost of Memorystore. `create_network_filesystem = true` runs Redis and NFS on a single shared `e2-small` Compute Engine VM instead of two separate managed services — a substantial cost reduction for development and test environments.

**Console Exploration:**
Navigate to **Billing > Budgets & alerts** and create a budget scoped to your project. Set a monthly amount and configure email alerts at 50%, 90%, and 100% of budget. Navigate to **Billing > Cost table** to see a daily breakdown of spend by service and SKU.

> **Real-World Example:** A startup sets a $500 monthly budget for their development project. They configure alerts at 50% ($250) so the engineering lead receives an early warning, at 90% ($450) to trigger a team review of running resources, and at 100% to alert the VP of Engineering. This tiered alert strategy prevents surprise invoices while giving the team time to act before the budget is exhausted.

---

### Setting up billing exports
**Concept:** Exporting billing data to BigQuery for detailed cost analysis, chargebacks, and per-workload attribution.

**In the RAD UI:**
The `resource_labels` variable (Group 1, all modules) applies key-value labels to every resource created by Services GCP, App CloudRun, and App GKE (e.g. `{ environment = "prod", team = "platform", cost-center = "eng-123" }`). These labels appear in Cloud Billing exports and BigQuery billing datasets, enabling precise cost attribution per deployment, environment, team, or application. This is the foundational mechanism for billing-based showback and chargeback models.

**Console Exploration:**
Navigate to **Billing > Billing export** and enable BigQuery export to a dataset in your project. Once data appears (within 24 hours), navigate to **BigQuery** and query the export table, grouping or filtering by the label keys you configured in `resource_labels`. In **Billing > Reports**, expand the **Labels** section in the right-hand filter pane to filter spend by your label key-value pairs.

> **Real-World Example:** A platform engineering team manages infrastructure for three business units: Marketing, Finance, and Engineering. They apply `{ cost-center = "mkt-001" }`, `{ cost-center = "fin-002" }`, and `{ cost-center = "eng-003" }` labels to each set of resources. At month end, the Finance team queries the BigQuery billing export — `SELECT SUM(cost), labels.value FROM billing_export GROUP BY labels.value WHERE labels.key = "cost-center"` — to generate an accurate chargeback report for each business unit without needing separate GCP projects.
