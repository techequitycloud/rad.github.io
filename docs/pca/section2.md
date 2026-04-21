# PCA Certification Preparation Guide: Section 2 — Managing and provisioning a cloud solution infrastructure (~17.5% of the exam)
<YouTubeEmbed videoId="vzR87W5HX8Y" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section2.png" />

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pca_section2.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification explore Section 2 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCA objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 2.1 Configuring network topologies

### VPC Architecture and Subnetting
**Concept:** Establishing the core routing, private access, and segmentation of the network.

**In the RAD UI:**
*   **VPC Creation:** In **GCP Services**, `availability_regions` (Group 2) and `subnet_cidr_range` (Group 2) automatically provision a custom-mode VPC network. This ensures complete control over IP spaces, avoiding overlapping IPs.
*   **Security Protection:** Network policies and Cloud Armor provide access control and firewalling at the application edge.

**Console Exploration:**
Navigate to **VPC network > VPC networks** to view the subnets created. Navigate to **Network Security > Cloud Armor** to review WAF rules.

**Real-world example:** A financial institution segments its fraud detection microservices from its customer-facing web tier by placing each in a separate subnet with distinct CIDR ranges. Firewall rules permit only the specific east-west traffic required between tiers (e.g., the web tier can call the fraud API on port 8080 only), and all internet-bound traffic is inspected through Cloud Armor before reaching any application. This defence-in-depth approach ensures a compromised front-end cannot directly reach backend databases.

### 💡 Additional Network Topology Objectives & Learning Guidelines
*   **Service Mesh (GKE):** The `configure_service_mesh` variable (Group 5 for GKE) enables Istio sidecar injection, providing mutual TLS (mTLS) between services and fine-grained traffic management (retries, circuit breaking, fault injection) without application code changes. Requires Cloud Service Mesh to be installed on the cluster.
*   **Multi-Cluster Service (GKE):** The `enable_multi_cluster_service` variable (Group 5 for GKE) exports the Kubernetes Service to other clusters in the same GKE fleet using a stable DNS name (`SERVICE.NAMESPACE.svc.clusterset.local`), enabling cross-cluster service discovery without public load balancers.
*   **Hybrid Networking:** Study Cloud VPN (HA VPN) and Cloud Interconnect (Dedicated and Partner) for extending on-premises environments. Understand BGP routing.
*   **Multicloud Communication:** Research Network Connectivity Center (NCC) for hub-and-spoke multi-cloud routing, and Cross-Cloud Interconnect for dedicated physical connectivity between Google Cloud and other cloud providers. GKE Enterprise (formerly Anthos) enables management of Kubernetes clusters running on other clouds from a single Google Cloud control plane.
*   **Shared VPC:** Understand the architecture of a Host project and Service projects to centralize network administration.

---

## 2.2 Configuring individual storage systems

### Storage Lifecycle and Management
**Concept:** Optimizing object storage costs, securing access, and enforcing data retention compliance.

**In the RAD UI:**
*   **Data Storage Allocation:** Utilizing `storage_buckets` (Group 9 for Cloud Run, Group 9 for GKE) creates regional or multi-regional buckets for application data.
*   **Security and Access Management:** The platform automatically assigns minimum IAM roles (like `roles/storage.objectAdmin`) to the specific workload identities created for the applications.
*   **Data Protection:** The automated jobs configured via `backup_schedule` (Group 12 for Cloud Run, Group 11 for GKE) back up the relational databases to Cloud Storage securely.

**Console Exploration:**
Navigate to **Cloud Storage > Buckets** to verify the storage class and location type. Navigate to **IAM & Admin > Service Accounts** to view access configurations.

**Real-world example:** A media streaming company stores infrequently accessed archive footage in Coldline storage at a fraction of the cost of Standard storage. An Object Lifecycle rule automatically transitions objects from Standard to Nearline after 30 days and to Coldline after 90 days. Bucket Lock is applied to the archive bucket with a 7-year retention policy to satisfy financial record-keeping regulations, preventing any object from being deleted or overwritten until the retention period expires.

### 💡 Additional Storage System Objectives & Learning Guidelines
*   **Data Retention and Lifecycle Management:** Navigate to a GCS bucket and create an Object Lifecycle rule to transition objects to Coldline storage or delete them. Understand Bucket Lock for SEC/FINRA WORM compliance.
*   **Configuration for Data Transfer:** Differentiate when to use Storage Transfer Service (STS) versus the offline hardware Transfer Appliance for large-scale migrations.
*   **Data Growth Planning:** Research BigQuery for petabyte-scale data warehousing and partitioning/clustering strategies.

---

## 2.3 Configuring compute systems

### Provisioning Compute Resources
**Concept:** Standing up containerized infrastructure declaratively and orchestrating workloads.

**In the RAD UI:**
*   **Serverless Computing:** `container_image` (Group 3) and `container_port` (Group 3) define the core runtime execution environment for Cloud Run. `min_instance_count` (Group 3) dictates compute resource provisioning.
*   **Container Orchestration:** `deploy_application` (Group 3) triggers the rollout of the Autopilot cluster, abstracting the underlying node infrastructure while allowing the architect to focus on Pod resource requests via `container_resources` (Group 3).
*   **Workload Type (GKE):** The `workload_type` variable (Group 5 for GKE) controls whether the application is deployed as a `Deployment` (stateless, rolling updates) or a `StatefulSet` (stable pod identities, per-pod persistent storage) — a foundational architectural choice that determines failure behavior, update strategies, and storage topology.
*   **Resource Quotas (GKE):** The `enable_resource_quota` variable (Group 15 for GKE) enforces namespace-level CPU, memory, pod count, and PVC ceilings for multi-tenant clusters, preventing any single application from monopolising shared cluster resources.

**Console Exploration:**
Navigate to **Cloud Run** or **Kubernetes Engine** to review the instantiated compute services and cluster configurations.

**Real-world example:** An engineering team launching a new API product chooses Cloud Run because the service receives variable burst traffic with unpredictable idle periods between requests. They configure `min_instance_count: 0` for the development environment (cost savings) and `min_instance_count: 2` for production (eliminating cold-start latency for paying customers). The GKE Autopilot cluster is reserved for a stateful data-processing pipeline that requires persistent volumes and fine-grained CPU/GPU resource control that Cloud Run's serverless model cannot provide.

### 💡 Additional Compute System Objectives & Learning Guidelines
*   **Compute Volatility (Spot vs. Standard):** Practice provisioning a Spot VM in the console. Spot VMs offer up to 91% cost savings compared to standard VMs and can be preempted by Google at any time when capacity is needed — unlike the older Preemptible VMs which had a hard 24-hour maximum runtime, Spot VMs have no fixed maximum lifespan but may still be reclaimed at short notice. They are ideal for batch processing, rendering, and stateless fault-tolerant workloads that can tolerate interruption.
*   **Infrastructure Orchestration and Patch Management:** Research OS Patch Management in Compute Engine to automate patching across fleets of VMs.
*   **Google Cloud VMware Engine:** Understand how to lift-and-shift vSphere workloads natively into GCP without refactoring.

---

## 2.4 Leveraging Vertex AI for end-to-end ML workflows
### 💡 Additional Vertex AI Objectives & Learning Guidelines
The RAD modules deploy standard web applications, not ML pipelines. The PCA exam requires deep Vertex AI knowledge.
*   **Vertex AI Pipelines:** Research how to use Kubeflow Pipelines or TensorFlow Extended (TFX) — both supported as pipeline specification formats in Vertex AI Pipelines — to automate and orchestrate ML workflows from data ingestion through model training, evaluation, and deployment.
*   **Preparing for Vertex AI Data Integration:** Understand how to connect data sources to Vertex AI. BigQuery acts as the primary data warehouse for structured training datasets and supports batch predictions natively via BigQuery ML. Vertex AI Feature Store centralizes ML feature management to ensure consistency between training-time and serving-time feature values, preventing training-serving skew. Study the difference between online serving (Feature Store, low latency, per-entity lookups) and batch serving (BigQuery, high throughput, full dataset predictions) and when each is appropriate.
*   **AI Hypercomputer:** Understand how to integrate GPUs and TPUs within Vertex AI for large-scale AI model training, and how to optimize for different consumption models (on-demand vs. reserved capacity). Study how Cloud Run functions can serve as lightweight inference endpoints for pre-trained models, complementing fully managed Vertex AI endpoints for lower-volume use cases.

---

## 2.5 Configuring prebuilt solutions or APIs with Vertex AI
### 💡 Additional Prebuilt AI Solutions Objectives & Learning Guidelines
*   **Google AI APIs:** The PCA exam specifically tests your ability to select the right pre-trained API for a given use case. The six official categories to know are: **Vision** (Cloud Vision API — image classification, OCR, object detection, face detection), **Image** (Imagen API — image generation and editing from text prompts), **Video** (Video Intelligence API — shot detection, label detection, object tracking, transcript extraction from video), **Audio** (Speech-to-Text for transcription, Text-to-Speech for synthesis), **Conversation** (Dialogflow CX — enterprise-grade virtual agents and conversational AI flows), and **Search** (Vertex AI Search — enterprise search across structured and unstructured data sources). Understand when to use these pre-trained models versus fine-tuning or training custom models in Vertex AI.
*   **Gemini Enterprise Features:** Research AI Agents and NotebookLM for enhancing enterprise workflows.
*   **Model Garden:** Explore the Model Garden console to see how to discover and deploy foundation models directly to Vertex AI endpoints. Google-native models include Gemini (multimodal reasoning), Imagen (image generation), Codey (code generation), and MedLM (healthcare). Model Garden provides a unified interface to browse, evaluate, and deploy these models with a single click, either as managed endpoints or self-hosted on dedicated compute.
