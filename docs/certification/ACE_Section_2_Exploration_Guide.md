# ACE Certification Preparation Guide: Section 2 — Planning and implementing a cloud solution (~30% of the exam)

This guide helps candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification explore Section 2 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **Services GCP**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights ACE objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 2.1 Planning and implementing compute resources

### Deploying to containerized and serverless platforms
**Concept:** Utilizing managed, scalable environments for containerized applications based on the workload profile.

**In the RAD UI:**
*   **App CloudRun:** Uses `container_resources` (Group 3) to configure memory and CPU. Configurations dictate performance and resource consumption. The `min_instance_count` (Group 3) and `max_instance_count` (Group 3) control auto-scaling bounds.
*   **App GKE:** Deploys to a Kubernetes Engine. The `container_resources` (Group 3) dictate pod CPU and memory requests/limits. The `min_instance_count` (Group 3) and `max_instance_count` (Group 3) handle autoscaling via Horizontal Pod Autoscaler (HPA) without managing underlying infrastructure logic directly, as the workloads run on Autopilot.

**Console Exploration:**
Navigate to **Cloud Run** and select your deployed service. Inspect the **Revisions** tab to see the memory/CPU allocations and concurrency limits. For GKE, navigate to **Kubernetes Engine > Workloads**, find your deployment, and inspect the YAML definition of the pod to see requested resources and limits.

### Selecting appropriate compute choices
**Concept:** Understanding when to use serverless solutions versus Kubernetes clusters versus raw virtual machines.

**In the RAD UI:**
The choice between the **App CloudRun** and **App GKE** modules reflects the compute selection process. App CloudRun is selected for stateless web applications needing to scale to zero. App GKE is chosen when stateful sets, fine-grained control via network policies, or specific pod topologies are required.
*   **App CloudRun:** The module abstracts all infrastructure, providing rapid deployment via variables like `container_image` (Group 3).
*   **App GKE:** Utilizing GKE Autopilot still abstracts node pools, but exposes variables like `enable_vertical_pod_autoscaling` (Group 3) for finer workload resource control.

**Console Exploration:**
Navigate to **Cloud Run** to see the managed serverless service. Then, navigate to **Kubernetes Engine > Clusters** to see the GKE Autopilot cluster and recognize that node provisioning is fully managed by GCP.

### 💡 Additional Compute Objectives & Learning Guidelines
The ACE exam also heavily covers standard Compute Engine VMs, App Engine, and Cloud Functions. These are not the primary application targets in these modules, but they are important exam topics that complement your hands-on experience with Cloud Run and GKE.

*   **Compute Engine VMs:** To practice this for the exam, provision a standalone VM via the GCP Console (**Compute Engine > VM instances**). When launching an instance, pay close attention to the **availability policy** (standard vs. Spot, on-host maintenance behaviour, automatic restart) and how you configure SSH access — either via project-wide SSH keys in metadata or the recommended OS Login approach. Understand the difference between preemptible/Spot VMs and standard instances.

    > **Real-World Example:** A video transcoding pipeline uses Spot VMs for batch processing — they are up to 91% cheaper than standard instances and the workload can be restarted if a VM is preempted. A web server handling live user traffic, by contrast, uses a standard VM in a Managed Instance Group to ensure availability.

*   **Compute Engine Storage — Persistent Disks and Hyperdisk:** The exam tests your ability to select the right disk type for a given workload. Key options are:
    - **Zonal Persistent Disk (PD):** Replicated within a single zone. Available as Standard HDD (`pd-standard`), Balanced SSD (`pd-balanced`), and SSD (`pd-ssd`).
    - **Regional Persistent Disk:** Synchronously replicated across two zones in the same region — suitable for HA workloads that can tolerate a zone failure (e.g. a failover database replica).
    - **Google Cloud Hyperdisk:** The next generation block storage family offering higher IOPS and throughput than Persistent Disk, with independently configurable capacity and performance. Hyperdisk Extreme and Hyperdisk Throughput are designed for database and data analytics workloads. Practice by navigating to **Compute Engine > Disks** and creating a disk, noting the difference between disk types and their per-GB costs.

    > **Real-World Example:** A high-traffic PostgreSQL database on Compute Engine requires consistent low-latency reads. The team selects Hyperdisk Balanced rather than `pd-ssd` to gain higher provisioned IOPS per GB and the ability to adjust IOPS without reprovisioning the disk. A secondary read replica uses a Regional Persistent Disk so that if the primary zone fails, the replica can be promoted in the secondary zone without data loss.

*   **Managed Instance Groups (MIGs) with instance templates:** A MIG manages a group of identical VMs created from an instance template. Practice by creating an instance template (**Compute Engine > Instance templates**), then creating a MIG from that template (**Compute Engine > Instance groups**) with autoscaling configured on CPU utilisation. MIGs support rolling updates — when you update the instance template, you can control the maximum number of unavailable instances and the maximum surge count during the rollout.

*   **OS Login:** Configure OS Login at the project level by setting the `enable-oslogin=true` metadata key under **Compute Engine > Metadata > Project metadata**. With OS Login enabled, SSH access is controlled by IAM roles (`roles/compute.osLogin` for standard access, `roles/compute.osAdminLogin` for sudo access) rather than SSH key files stored in metadata. This is the Google-recommended approach for VM access management.

*   **VM Manager:** VM Manager is a suite of tools for managing software policies on large Compute Engine VM fleets. It includes:
    - **OS Patch Management:** Schedule automated patch jobs across VM fleets with specific patch windows and rollout strategies.
    - **OS Configuration Management:** Apply configuration policies (OS policies) declaratively to enforce desired state across VMs.
    - **OS Inventory:** Collect and view installed package information from all VMs in a project.
    Navigate to **Compute Engine > VM Manager** to explore the OS Patch and OS Inventory dashboards.

*   **GKE cluster configurations — regional clusters and private clusters:** The App GKE module deploys a GKE Autopilot cluster. For the exam, you must also understand:
    - **Regional GKE clusters:** Distribute the control plane and nodes across multiple zones in a region, providing higher availability than zonal clusters. The control plane is replicated and traffic is never lost if a single zone fails.
    - **Private GKE clusters:** Nodes have no public IP addresses. The control plane communicates with nodes via a private endpoint only. External access to the API server requires authorised networks or a bastion host. Private clusters are the recommended configuration for production workloads to reduce attack surface. In the GCP Console, navigate to **Kubernetes Engine > Clusters** and click **Create** to explore the Networking configuration options for private clusters.

*   **Eventarc for event-driven serverless deployments:** Eventarc is the Google Cloud eventing platform that routes events from GCP services to Cloud Run targets. Practice triggering a Cloud Run service from:
    - A **Pub/Sub** topic message published by another service.
    - A **Cloud Storage object change notification** (object finalized, deleted, etc.) via Eventarc's Audit Log-based triggers.
    Navigate to **Eventarc > Triggers** to create a trigger and map event sources to a Cloud Run target. Understanding Eventarc is increasingly important as the exam moves toward event-driven architectures on serverless platforms.

    > **Real-World Example:** A document processing pipeline uses Eventarc to trigger a Cloud Run function whenever a PDF is uploaded to a Cloud Storage bucket. Eventarc detects the `google.cloud.storage.object.v1.finalized` event and invokes the Cloud Run service with the event payload — the service extracts text, calls the Document AI API, and stores results in Firestore. No polling loop is needed, and the architecture scales to zero when no documents are being processed.

*   **App Engine:** The exam tests your ability to choose between App Engine Standard (language-specific sandboxes) and Flexible (custom containers). You can deploy a simple "Hello World" application using the `gcloud app deploy` command in Cloud Shell to understand its `app.yaml` configuration structure.

*   **Cloud Functions (2nd gen):** Used for event-driven, single-purpose functions. Practice creating a Cloud Function triggered by a Cloud Storage bucket upload or a Pub/Sub message via the **Cloud Functions** console. Note that Cloud Functions 2nd gen is built on Cloud Run, giving functions the same concurrency and networking features you explored in the App CloudRun module.

---

## 2.2 Planning and implementing storage and data solutions

### Choosing and deploying storage products
**Concept:** Integrating distinct storage classes for different application needs (objects vs. files).

**In the RAD UI:**
*   **Cloud Storage (GCS):** The `storage_buckets` variable (Group 9 for both App CloudRun and App GKE) dynamically provisions GCS buckets. The modules integrate GCS Fuse CSI drivers to mount these buckets directly into the running containers as if they were local directories.
*   **Cloud Filestore (NFS):** If persistent, shared file storage is required, configure `create_filestore_nfs` (Group 6) and `filestore_tier` (Group 6) in **Services GCP**. Subsequently, enable `enable_nfs` (Group 8 for both App CloudRun and App GKE) to mount the network filesystem to the container.

**Console Exploration:**
Navigate to **Cloud Storage > Buckets** to see the provisioned object storage buckets. Navigate to **Filestore > Instances** to view the managed NFS instances and observe their regional availability. For GKE, navigate to **Kubernetes Engine > Storage** to view any dynamically provisioned Persistent Volume Claims (PVCs).

**Cloud Storage storage classes** are a key exam topic. When creating a bucket or object, you select a storage class that determines availability, durability, and cost:
- **Standard:** For frequently accessed data. Highest availability, no retrieval fee. Best for serving web assets, active datasets.
- **Nearline:** For data accessed at most once per month. 30-day minimum storage duration. Lower storage cost but adds a per-GB retrieval fee.
- **Coldline:** For data accessed at most once per quarter. 90-day minimum storage duration. Even lower storage cost, higher retrieval fee.
- **Archive:** For long-term archival data accessed less than once a year. 365-day minimum storage duration. Lowest storage cost, highest retrieval fee.

The exam tests your ability to select the appropriate class based on access frequency and cost requirements. Object lifecycle rules (covered in Section 3) automate transitions between these classes.

**Google Cloud NetApp Volumes** is a managed enterprise file storage service that provides NFS (v3/v4.1) and SMB protocol access with workload profiles optimised for SAP, Oracle databases, and high-performance computing. Navigate to **NetApp Volumes > Volumes** in the console to explore available service levels (Standard, Premium, Extreme) and their IOPS characteristics. While the RAD platform uses Filestore for NFS, NetApp Volumes is an important alternative for enterprise workloads that require mature data management features such as snapshots, cloning, and replication.

### Choosing and deploying relational data products
**Concept:** Selecting managed database and caching services for stateful application requirements.

**In the RAD UI:**
*   **Cloud SQL:** In **Services GCP**, utilize variables like `create_postgres` (Group 3) and `postgres_tier` (Group 3) or `create_mysql` (Group 3) and `mysql_tier` (Group 3) to provision managed relational databases. In the application modules, toggle `enable_cloudsql_volume` (Group 3) to inject the Cloud SQL Auth Proxy sidecar, enabling secure Unix socket connections without public IP exposure.
*   **Memorystore (Redis):** In **Services GCP**, `create_redis` (Group 5) and `redis_tier` (Group 5) configure managed in-memory caching. Set `enable_redis` (Group 10 for App CloudRun; configure via `environment_variables` Group 4 for App GKE) to dynamically pass the Redis host and port into the container's environment variables.

**Console Exploration:**
Navigate to **SQL** to review the managed PostgreSQL or MySQL instances, noting their high-availability configuration. Navigate to **Memorystore** to see the Redis cluster and its network endpoints.

### 💡 Additional Storage & Data Objectives & Learning Guidelines
The ACE exam requires understanding the full breadth of Google Cloud data products — from NoSQL and global relational databases to streaming and batch analytics. These services complement the Cloud SQL and Memorystore you've already deployed.

*   **AlloyDB for PostgreSQL:** A fully managed, PostgreSQL-compatible database optimised for high-performance analytical and transactional (HTAP) workloads. AlloyDB delivers up to 4× the throughput of standard PostgreSQL and supports in-database ML inference. Navigate to **AlloyDB > Clusters** to explore the cluster/instance model. Choose AlloyDB over Cloud SQL when workloads require higher query performance on standard PostgreSQL without switching database engines.

*   **Cloud Spanner:** The globally scalable, strongly consistent relational database. Practice by creating a small Spanner instance in the console, noting the node/processing unit configuration and regional/multi-regional setup.

    > **Real-World Example:** A global retail platform processing financial transactions chooses Cloud Spanner over Cloud SQL because it provides external consistency (serialisable isolation) across multiple regions simultaneously — critical when inventory updates and order confirmations must be atomically consistent across a US and EU data centre with no replication lag.

*   **Firestore / Datastore:** The serverless document database. In the console, initialize Firestore in Native mode and practice adding a few documents and collections to understand the NoSQL structure. Firestore is ideal for user profile data, real-time collaboration features, and mobile app backends where schema flexibility and low-latency reads are more important than complex joins.

*   **Cloud Bigtable:** Designed for massive scale, low-latency time-series data. Create a development Bigtable instance and use the `cbt` command-line tool in Cloud Shell to interact with it. Bigtable is the storage engine behind services like Google Maps and Google Analytics — use it when you need single-digit millisecond reads across billions of rows.

*   **BigQuery:** The serverless data warehouse. Practice loading a CSV file from Cloud Storage into a BigQuery table and running a simple SQL query. BigQuery integrates natively with Cloud Logging exports and Cloud Billing exports (as explored in Section 1), making it the central analytics hub for operational data across your GCP environment.

*   **Pub/Sub:** The fully managed, asynchronous messaging service that decouples producers from consumers. A publisher sends messages to a **topic**; one or more **subscriptions** deliver those messages to consumers (push to an endpoint, or pull from the service). Navigate to **Pub/Sub > Topics** and practice creating a topic, a subscription, and publishing a test message via the console. Pub/Sub is the backbone of event-driven architectures and integrates directly with Eventarc, Dataflow, Cloud Functions, and BigQuery subscriptions.

    > **Real-World Example:** An order management system publishes an event to a Pub/Sub topic every time an order is placed. Three downstream subscribers process the event independently: a fulfilment service, a billing service, and an analytics pipeline. Because Pub/Sub is asynchronous, the order service does not wait for any downstream system — if the billing service is briefly unavailable, its subscription simply accumulates messages and processes them when service resumes.

*   **Dataflow:** The fully managed Apache Beam-based service for both streaming and batch data processing pipelines. Common use cases include ETL, real-time data enrichment, and analytics aggregation. Navigate to **Dataflow > Jobs** and explore the available templates (e.g. *Pub/Sub to BigQuery*) to understand how Dataflow reads from a source, transforms data, and writes to a sink — all without managing infrastructure.

    > **Real-World Example:** A streaming analytics pipeline reads click events from Pub/Sub, applies windowed aggregations (e.g. count of page views per 5-minute window per user), and writes results to BigQuery for dashboarding. The same Dataflow pipeline can be used for daily batch reprocessing of historical data by pointing it at a Cloud Storage source instead of Pub/Sub.

*   **Google Cloud Managed Service for Apache Kafka:** A fully managed, cloud-native Kafka service that eliminates the operational overhead of running Kafka clusters. It is fully compatible with the Apache Kafka API, making it a drop-in replacement for self-managed Kafka. Navigate to **Managed Service for Apache Kafka > Clusters** to explore the cluster configuration options. Use it when migrating an existing Kafka-based architecture to Google Cloud without changing application code, or when your team has strong Kafka expertise and needs high-throughput, low-latency message streaming with Kafka semantics.

*   **Data loading options:** The exam tests three data loading patterns:
    - **Command-line upload:** Use `gcloud storage cp` to upload files directly to Cloud Storage, or use the `bq load` command to load files from Cloud Storage into BigQuery.
    - **Loading data from Cloud Storage:** BigQuery, Bigtable, Spanner, and Dataflow all support reading from Cloud Storage as a source. In BigQuery, use the **Load data** wizard (**BigQuery > Explore** or via `bq load`) to load CSV, JSON, Parquet, or Avro files from a GCS bucket.
    - **Storage Transfer Service:** Navigate to **Storage Transfer > Transfer jobs** to configure large-scale, scheduled data transfers between GCS buckets (e.g. cross-project replication) or from on-premises sources using the Transfer service agent.

---

## 2.3 Planning and implementing networking resources

### Creating a VPC with subnets
**Concept:** Establishing a custom Virtual Private Cloud network that all resources share, with subnets partitioned by region and purpose.

**In the RAD UI (Services GCP):**
The `network_name` (Group 2) and `availability_regions` variables create a **custom-mode VPC** — one where subnets are explicitly defined rather than automatically created in every region. Custom-mode VPCs are the recommended configuration for production environments because they give you full control over IP ranges and prevent accidental overlap.

The modules deploy all resources into a single VPC. In larger organisations, a **Shared VPC** architecture is used instead: one **host project** owns the VPC network and subnets, and multiple **service projects** attach to it. This allows central network governance (firewall rules, routing, subnet allocation) by a network team while application teams deploy into their own service projects with their own IAM boundaries. Navigate to **VPC network > Shared VPC** to understand the host/service project relationship.

**Console Exploration:**
Navigate to **VPC network > VPC networks** to see the custom-mode VPC and its subnets. Go to **VPC network > VPC network peering** to review the Private Service Access peering connection to Google's managed services network (note: this is distinct from Private Service Connect, which provides private endpoints for Google APIs). In Cloud Run, check the **Networking** tab of your service to verify the VPC egress configuration.

### Creating and applying Cloud NGFW policies
**Concept:** Enforcing network security at scale with hierarchical, tag-based firewall policies rather than per-VPC firewall rules.

**In the RAD UI:**
The RAD platform secures network traffic primarily at the application layer (Cloud Armor for edge WAF, GKE network policies for pod-level segmentation). For the ACE exam, you must also understand **Cloud Next Generation Firewall (Cloud NGFW)** policies.

Cloud NGFW introduces two key improvements over classic VPC firewall rules:
- **Firewall Policies** (Network, Folder, and Organisation-scoped) replace the flat list of rules with a hierarchical structure. Organisation and folder-level policies are enforced before VPC-level rules, allowing a central security team to define baseline rules that individual projects cannot override.
- **Tags (including Secure Tags):** Classic firewall rules use **network tags** (arbitrary strings attached to VMs). Cloud NGFW supports **Secure Tags** — IAM-governed resource tags from the Resource Manager Tag API. Unlike network tags, Secure Tags require IAM permission to attach (`tagUser` role), preventing unauthorised VMs from self-assigning a tag to gain firewall access.

**Console Exploration:**
Navigate to **VPC network > Firewall policies** to explore Network Firewall Policies. Create a policy and add an ingress rule, noting the rule attributes: **action** (allow/deny/apply_security_profile), **priority**, **source** (CIDR, service account, tag), **destination**, **protocols/ports**, and **targets** (which VMs the rule applies to). Navigate to **IAM & Admin > Tags** to explore Secure Tags and understand the difference from classic network tags.

> **Real-World Example:** A security team creates an Organisation Firewall Policy that denies all ingress on port 22 (SSH) from `0.0.0.0/0`, preventing any project team from accidentally exposing SSH to the internet. They then add a higher-priority rule that permits SSH from the corporate IP range using a Secure Tag — only VMs that have been granted the `allow-ssh` Secure Tag by a network administrator can receive SSH traffic from that range. Individual project teams cannot override this policy or self-assign the Secure Tag.

### Establishing network connectivity
**Concept:** Securely connecting applications to resources within a private VPC and to external networks.

**In the RAD UI:**
*   **Services GCP:** `availability_regions` (Group 2) and `subnet_cidr_range` (Group 2) define the core VPC. Private Service Access automatically peers managed services like Cloud SQL and Memorystore to this private network.
*   **App CloudRun:** `vpc_egress_setting` (Group 14) configures Direct VPC Egress, allowing the serverless container to securely access internal resources like the database via internal IP addresses.
*   **App GKE:** Uses native Kubernetes networking, but `enable_network_segmentation` (Group 5) can enforce network policies to restrict internal pod-to-pod communication.

### Choosing and deploying load balancers
**Concept:** Distributing global traffic, terminating SSL, and providing edge security.

**In the RAD UI:**
*   **App CloudRun:** Activating `enable_cloud_armor` (Group 16) provisions a Global External Application Load Balancer with a Serverless Network Endpoint Group (NEG) backend, attaching Web Application Firewall (WAF) policies.
*   **App GKE:** `enable_cloud_armor` (Group 18) configures routing using the Kubernetes Gateway API, mapping external traffic to internal services and applying security policies directly to the backend configurations.

**Console Exploration:**
Navigate to **Network Services > Load balancing**. Inspect the Frontend to see the global anycast IP and SSL certificate, and the Backend to see how traffic is routed to the Serverless NEG (Cloud Run) or GKE Services (GKE). Navigate to **Network Security > Cloud Armor** to view the applied WAF policies restricting inbound traffic.

> **Real-World Example:** A global e-commerce application uses a Global External Application Load Balancer. A customer in Tokyo hits the same IP address as a customer in London — the global anycast routing directs each to the nearest Google Point of Presence, reducing latency. A Cloud Armor preconfigured WAF rule blocks SQL injection attempts before they reach the Cloud Run backend. During a DDoS incident, the operations team uses Cloud Armor's adaptive protection feature to automatically generate a rate-limiting rule in response to detected attack patterns.

### Differentiating Network Service Tiers
**Concept:** Understanding how Google Cloud routes traffic and how Premium vs Standard Tier affects latency, cost, and SLA.

Google Cloud offers two **Network Service Tiers** for egress traffic:
- **Premium Tier (default):** Traffic enters and exits Google's private global backbone network as close to the user as possible. The longest possible path uses Google's own fibre, minimising latency and maximising reliability. This is the tier used by global load balancers and is required for global Anycast IP addresses.
- **Standard Tier:** Traffic enters Google's network at the destination region and uses the public internet for the first/last mile. Lower cost, but higher latency and no SLA equivalent to Premium. Suitable for non-latency-sensitive workloads where cost reduction is a priority.

Navigate to **VPC network > Network Service Tiers** to view the project-level default tier and understand how to configure per-resource overrides. Note that Cloud Armor, the Global External Application Load Balancer (used by App CloudRun and App GKE), and global Anycast IPs always use Premium Tier.

### 💡 Additional Networking Objectives & Learning Guidelines
The ACE exam tests hybrid connectivity and advanced VPC routing.

*   **Cloud VPN & Cloud Interconnect:** These connect on-premises networks to GCP. While hard to simulate without an on-prem environment, review the console for **Hybrid Connectivity > VPN**. Understand the difference between Classic VPN and HA VPN (which requires BGP dynamic routing). HA VPN requires Cloud Router for BGP session management and provides 99.99% availability SLA.

    > **Real-World Example:** A company migrating to GCP keeps its Active Directory and legacy ERP system on-premises during a multi-year migration. HA VPN (two tunnel pairs for 99.99% SLA) provides a persistent encrypted connection between the on-premises data centre and the GCP VPC, allowing cloud-hosted workloads to query the legacy database until the migration is complete. Dedicated Interconnect is chosen once traffic exceeds 1 Gbps to reduce egress costs.

*   **Cloud DNS & Cloud NAT:** Cloud NAT is provisioned in Services GCP to give private instances outbound internet access without exposing them on a public IP. Explicitly review it under **Network services > Cloud NAT**. Practice creating a Private DNS zone under **Network services > Cloud DNS** — private zones resolve hostnames only within your VPC, allowing internal services to be addressed by name (e.g. `db.internal.example.com`) rather than by IP address.

---

## 2.4 Planning and implementing resources through infrastructure as code

### Infrastructure as code tooling
**Concept:** Managing cloud infrastructure declaratively using standard tools, a fundamental ACE exam requirement.

**In the RAD UI:**
The RAD platform deployment portal completely abstracts the underlying Infrastructure as Code (IaC) tooling via the UI. When you configure variables (e.g., `min_instance_count`), the platform compiles these inputs and executes the modules on your behalf.
While you don't write the declarative configuration directly, the principles of IaC—idempotent deployments, state management, and declarative resource definitions—power every action.

*   **Custom Implementations:** If your organization needs to build upon this foundation outside the portal, these modules serve as robust reference architectures. Teams can configure remote state backends (e.g., in a GCS bucket) and orchestrate deployments via Cloud Build triggers or Cloud Deploy pipelines by passing the exact same variable configurations you see in the UI into the deployment environment.

    > **Real-World Example:** A platform team manages 20 microservices across three environments (dev, staging, prod). They store Terraform state in a GCS bucket with versioning enabled, and use a Cloud Build trigger connected to their source repository to automatically run `terraform plan` on every pull request and `terraform apply` on merge to main. This gives them a fully auditable, repeatable infrastructure deployment process without any manual console interaction.

**Console Exploration:**
Navigate to **Cloud Build > History** to see the automated pipelines executing the IaC deployments. Observe the logs to see how variables from the UI are applied to construct the resulting GCP resources predictably and consistently.

### 💡 Additional IaC Objectives & Learning Guidelines
The ACE exam tests knowledge of the full Google Cloud IaC toolchain, including tools beyond Terraform.

*   **Fabric FAST:** The GCP Fast Automated Security Templates (Fabric FAST) is an opinionated, production-grade Terraform-based framework developed by Google Cloud Professional Services. It provides a hierarchical set of bootstrapping stages (bootstrap, resource management, networking, security) that implement GCP Landing Zone best practices out of the box. While the RAD platform is a purpose-built deployment framework for its application modules, Fabric FAST is the reference architecture for building enterprise-grade GCP foundations. Explore the public repository for `cloud-foundation-fabric` on Cloud Source Repositories or via the Google Cloud documentation to understand its stage-based structure.

*   **Config Connector:** A Kubernetes-native IaC tool that allows GCP resources (Cloud SQL, GCS buckets, Pub/Sub topics, IAM bindings, etc.) to be declared as Kubernetes Custom Resources (CRDs) and managed through the Kubernetes API. When Config Connector is installed in a GKE cluster, you can apply a YAML file that describes a Cloud SQL instance — just like a Kubernetes Deployment — and the controller will reconcile the actual GCP resource to match. Navigate to **Kubernetes Engine > Applications** or explore Config Connector's CRD documentation to understand which GCP resources it supports. Config Connector is particularly powerful for teams that want to manage GCP infrastructure using GitOps workflows with the same `kubectl apply` tooling they use for application workloads.

*   **Helm:** The package manager for Kubernetes. A Helm chart packages all Kubernetes manifests for an application (Deployments, Services, ConfigMaps, HPA configs, etc.) into a versioned, distributable archive. `helm install` and `helm upgrade` deploy or update the packaged workload, and Helm's templating engine allows environment-specific values to be injected at deploy time. The App GKE module's outputs (Kubernetes manifests for the deployed workload) represent the kind of resources a Helm chart would manage. Practice using Cloud Shell to install the Helm CLI (`curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash`) and explore public charts from Artifact Registry or the open-source Helm Hub.

*   **IaC versioning, state management, and updates:** For Terraform specifically:
    - **State:** Terraform state (`terraform.tfstate`) tracks which real resources correspond to which configuration. For team environments, state must be stored remotely — a GCS bucket with versioning enabled is the standard Google Cloud backend, preventing concurrent state corruption.
    - **Versioning:** Lock provider versions in `required_providers` blocks to prevent unexpected breaking changes when upstream providers update.
    - **Updates:** Use `terraform plan` to preview changes before `terraform apply`. For destructive operations (e.g. replacing a database), Terraform outputs the impact clearly — the exam tests your ability to interpret `plan` output.

*   **Cloud SDK (`gcloud`):** Since the RAD UI abstracts the deployment, you must manually practice `gcloud` commands to prepare for the exam. Use Google Cloud Shell to run commands like `gcloud compute instances create`, `gcloud container clusters get-credentials`, and `gcloud run deploy`. Pay special attention to the flags used for configurations. The `--format` flag (e.g. `--format=json` or `--format="value(name)"`) is particularly useful for scripting and appears in exam scenarios.

*   **`kubectl`:** For GKE, practice interacting directly with the cluster. Use `kubectl get pods`, `kubectl describe deployment`, and `kubectl logs` to understand how to troubleshoot workloads directly from the terminal. The `kubectl exec -it <pod> -- /bin/sh` command lets you open a shell inside a running container for live debugging.

*   **`gcloud storage` & `bq`:** The `gcloud storage` command is the modern replacement for `gsutil` and is the recommended tool for Cloud Storage operations. Practice creating buckets (`gcloud storage buckets create gs://my-bucket`) and copying files (`gcloud storage cp ./file.txt gs://my-bucket/`). The legacy `gsutil` commands still work but `gcloud storage` offers faster parallel transfers and is actively maintained. Use `bq query --use_legacy_sql=false 'SELECT ...'` to run standard SQL commands against BigQuery directly from Cloud Shell.
