# PCA Certification Preparation Guide: Section 1 — Designing and planning a cloud solution architecture (~25% of the exam)
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section1.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section1.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pca_section1.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification explore Section 1 of the exam through the lens of the Tech Equity RAD platform at [https://techequity.cloud](https://techequity.cloud). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCA objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

Familiarity with the Google Cloud Well-Architected Framework is a key requirement for this section, and its six pillars (operational excellence, security, reliability, performance optimization, cost optimization, and sustainability) are woven throughout these modules.

**Exam case studies:** The PCA exam uses four official case studies as context for scenario-based questions. You should review all four before the exam:
- **Altostrat Media** — a media company adopting cloud-native architecture for content delivery and streaming at global scale
- **Cymbal Retail** — a global retailer modernizing its data, analytics, and inventory management platform on Google Cloud
- **EHR Healthcare** — a healthcare organization managing electronic health records under strict HIPAA and data sovereignty requirements
- **KnightMotives Automotive** — an automotive company leveraging generative AI to transform customer and dealer experiences

As you explore these modules, practice mapping the infrastructure patterns deployed by GCP Services, App CloudRun, and App GKE to the business and technical requirements described in each case study scenario.

---

## 1.1 Designing a cloud solution infrastructure that meets business requirements

### Security, Compliance, and Data Movement
**Concept:** Ensuring the architecture meets strict organizational security policies, handles data securely during transit, and protects secrets.

**In the RAD UI:**
*   **Identity-Aware Proxy (IAP):** Review the `enable_iap` (Group 4) variable. IAP protects applications by verifying user identity and context before allowing requests to reach the service.
*   **Cloud Armor (WAF):** Activating `enable_cloud_armor` (Group 9 for Cloud Run, Group 13 for GKE) deploys a Global External Application Load Balancer with a Serverless Network Endpoint Group (NEG) or Gateway backend, attaching Web Application Firewall (WAF) policies.
*   **Secret Manager Integration:** The `enable_auto_password_rotation` (Group 11 for Cloud Run, Group 17 for GKE) variable configures automated secret rotation, preventing plaintext secrets in environments.

**Console Exploration:**
Navigate to **Security > Identity-Aware Proxy** to view access policies. Navigate to **Network Security > Cloud Armor** to inspect the edge WAF rules. Navigate to **Security > Secret Manager** to see how environment variables resolve securely.

**Real-world example:** A financial services firm uses IAP to allow remote employees to access an internal risk dashboard without a corporate VPN — only users whose Google Workspace identity belongs to an authorized group can reach the application, with every other request rejected at the Google edge before touching the workload. Cloud Armor adds a second layer of protection by blocking OWASP Top 10 attacks such as SQL injection and applying adaptive rate-limiting to throttle credential-stuffing bots during peak periods.

### Cost Optimization and Success Measurements
**Concept:** Mapping capacity to demand automatically to avoid paying for idle resources, optimizing CapEx/OpEx, and proving ROI via KPIs.

**In the RAD UI:**
*   **Serverless Autoscaling (Cloud Run):** Setting `min_instance_count` (Group 3) to 0 enables scale-to-zero, drastically reducing costs during idle periods. `max_instance_count` (Group 3) caps expenditure.
*   **Billing Budgets:** In **GCP Services**, `create_billing_budget` (Group 18) allows you to define hard budget alerts (`budget_alert_thresholds`) to measure financial success and prevent runaway OpEx.

**Console Exploration:**
Navigate to **Cloud Run**, select the service, and review the **Revisions** tab. Navigate to **Billing > Budgets & alerts** to review the financial guardrails.

**Real-world example:** A retail analytics service that generates nightly batch reports sets `min_instance_count` to `0`, eliminating all compute costs during the 22 hours per day when the service is idle. A billing budget with threshold alerts at 50% and 90% of the monthly cap ensures that an unexpected traffic spike does not silently overshoot the agreed OpEx target.

### Observability
**Concept:** Meeting business requirements for monitoring health, performance, and uptime to ensure service level objectives (SLOs) are maintained.

**In the RAD UI:**
*   **Integrated Monitoring & Logging:** The platform automatically creates synthetic uptime checks and custom dashboarding based on deployment metadata and the `support_users` (Group 1) list.

**Console Exploration:**
Navigate to **Monitoring > Dashboards** and view the custom Cloud Run or GKE dashboards to see visualized metrics like Request Count and Latency (p95).

### 💡 Additional Business Design Objectives & Learning Guidelines
*   **Functional and Non-Functional Requirements:** Practice decomposing a business problem into functional requirements (what the system must do) and non-functional requirements (how the system must perform — availability, latency, throughput, scalability, and compliance). For example, a payments API might have a functional requirement to process card transactions and a non-functional requirement of 99.99% availability with sub-200ms response time at 10,000 requests per second.
*   **Movement of Data:** Understand data movement patterns for each scenario: batch transfers (Storage Transfer Service, Transfer Appliance for offline petabyte-scale migrations), real-time streaming (Pub/Sub, Dataflow), and event-driven pipelines (Eventarc). Factor in egress costs, data residency regulations, and encryption-in-transit requirements when designing cross-region data flows.
*   **Design Decision Trade-offs:** Architects must evaluate competing objectives. Study the trade-offs between strong consistency (Cloud Spanner) and eventual consistency (Firestore), managed simplicity (Cloud Run) and orchestration flexibility (GKE), higher availability (REGIONAL Cloud SQL) and lower cost (ZONAL), and synchronous REST APIs and asynchronous Pub/Sub messaging. Understanding CAP theorem and the cost-reliability-performance triangle is essential for answering PCA scenario questions.
*   **Business Continuity vs. Disaster Recovery (DR):** Understand the difference between keeping the business running during an outage (Continuity) versus restoring IT systems post-outage (DR).
*   **Workload Disposition Strategies:** Practice evaluating whether to Build, Buy, Modify, or Deprecate a legacy application based on ROI and technical debt.
*   **Integration Patterns with External Systems:** Study API Gateways, Pub/Sub event-driven architectures, and hybrid cloud message queues.

---

## 1.2 Designing a cloud solution infrastructure that meets technical requirements

### High Availability and Fail-over Design
**Concept:** Designing resilient systems that withstand regional or zonal failures in accordance with the Well-Architected Framework.

**In the RAD UI:**
*   **Global Load Balancing:** When `enable_cloud_armor` is active, it provisions a global L7 load balancer capable of routing across regions.
*   **Pod Disruption Budgets (GKE):** The `pdb_min_available` variable (Group 27) ensures a minimum number of replicas are always available during voluntary disruptions.
*   **Database HA:** `postgres_database_availability_type` (Group 3 in GCP Services) allows switching between ZONAL and REGIONAL (multi-zone high availability) configurations. A REGIONAL instance provisions a synchronous hot standby in a separate zone and automatically promotes it within approximately 60 seconds if the primary zone fails.

**Console Exploration:**
Navigate to **SQL** to verify the high availability configuration of the database. Navigate to **Network Services > Load balancing** to view the global frontend.

**Real-world example:** A healthcare provider's patient appointment portal requires a 99.99% monthly uptime SLA. Using a REGIONAL Cloud SQL instance, the database automatically promotes its hot standby to primary within approximately 60 seconds if the primary zone fails — meeting the recovery time objective without any manual intervention from the operations team.

### Scalability to Meet Growth Requirements
**Concept:** Architecting for seamless traffic spikes without manual intervention.

**In the RAD UI:**
*   **Cloud Run Architecture:** Because the application is deployed on Cloud Run, it scales instances horizontally natively. Review the concurrency limits and `container_resources` (Group 3).
*   **GKE Architecture:** The `enable_vertical_pod_autoscaling` variable (Group 3) enables the Vertical Pod Autoscaler (VPA), which automatically right-sizes the CPU and memory *resource requests* of individual pods based on observed utilization. Unlike the Horizontal Pod Autoscaler (HPA), which scales the *number* of pods in response to traffic, VPA optimizes the resource allocation of each individual pod, reducing waste and improving node bin-packing efficiency on Autopilot.

**Console Exploration:**
Review the **Revisions** tab in Cloud Run for concurrency limits, and the **Autoscaling** tab in GKE Workloads.

### Backup and Recovery
**Concept:** Guaranteeing Recovery Point Objectives (RPO) and Recovery Time Objectives (RTO).

**In the RAD UI:**
*   **Automated Jobs & Cloud Scheduler:** The `backup_schedule` (Group 6) and `backup_retention_days` (Group 6) variables configure automated Cloud Scheduler jobs that trigger containerized Cloud Run Jobs or Kubernetes CronJobs to stream database backups securely to Cloud Storage.

**Console Exploration:**
Go to **Cloud Scheduler** to see the cron configuration, and **Cloud Run > Jobs** to see the containerized execution history.

**Real-world example:** A SaaS company configures a daily 02:00 UTC backup with a 30-day retention window. When a developer accidentally drops a production table, the on-call engineer restores the closest backup from Cloud Storage to a new Cloud SQL instance and updates the application's connection string — recovering all but the most recent hours of data and meeting the agreed RTO without manual backup scripts.

### 💡 Additional Technical Design Objectives & Learning Guidelines
*   **Flexibility of Cloud Resources:** Understand how Managed Instance Groups (MIGs) on Compute Engine provide autoscaling and rolling update capabilities for VM-based workloads, allowing the fleet to grow and shrink in response to demand without manual provisioning. Multi-region deployments behind a global load balancer add geographic flexibility. Regional Managed Instance Groups can spread VMs across zones automatically for fault tolerance.
*   **Performance and Latency Optimization:** Study how Cloud CDN reduces latency for globally distributed users by caching static content at Google edge points of presence, cutting round-trip time for cacheable responses from hundreds of milliseconds to single-digit milliseconds. Memorystore (managed Redis/Valkey or Memcached) eliminates repetitive database reads for hot data such as session tokens, rate-limit counters, and product catalogue entries. For GKE workloads, co-locating pods in the same zone as their Cloud SQL instance and using connection pooling (e.g., via Cloud SQL Auth Proxy) reduces inter-zone latency costs and improves sustained throughput.
*   **Gemini Cloud Assist:** In the GCP Console, look for the Gemini (sparkle) icon. Practice using Gemini to ask architectural questions, summarize logs, or optimize configurations based on the Well-Architected Framework.

---

## 1.3 Designing network, storage, and compute resources

### Cloud-Native Networking
**Concept:** Connecting managed compute to internal resources securely.

**In the RAD UI:**
*   **Direct VPC Egress:** Review `vpc_egress_setting` (Group 4) for Cloud Run Direct VPC Egress.
*   **Private Service Connect:** The platform establishes peered VPC connections for managed services implicitly, securing database traffic.

**Console Exploration:**
Check the Cloud Run service's **Networking** tab in the Console. Go to **Network Connectivity > Private Service Connect**.

**Real-world example:** A Cloud Run service that queries a Cloud SQL database uses Direct VPC Egress to route all traffic through the private VPC rather than the public internet. This eliminates exposure of database credentials over a public network path and avoids the latency overhead of routing through the Cloud SQL Auth Proxy, while still benefiting from Google's managed Private Service Connect endpoint for the database.

### Choosing Appropriate Storage Types
**Concept:** Selecting purpose-built storage based on structured/unstructured data and latency needs.

**In the RAD UI:**
*   **Cloud SQL (Relational):** Check `create_postgres` / `create_mysql` (Group 3 in GCP Services).
*   **Cloud Storage (Object Storage):** Look at the `storage_buckets` variable (Group 10 for Cloud Run, Group 17 for GKE).
*   **Filestore (File/NFS Storage):** Review `create_filestore_nfs` (Group 6 in GCP Services).

**Console Exploration:**
Visit **Filestore** and **SQL** in the GCP Console to see how different storage tiers match differing technical constraints.

**Real-world example:** A media company uses three storage tiers in tandem: Cloud SQL stores structured user subscription records (relational, transactional), Cloud Storage hosts uploaded video files and rendered thumbnails (object, durable, high throughput), and Filestore provides a shared NFS mount for a legacy transcoding fleet that requires POSIX filesystem semantics. Selecting the wrong tier — for example, using Cloud Storage for a high-frequency transactional workload — would result in unacceptable latency and consistency trade-offs.

### Mapping Compute Needs to Platform Products
**Concept:** Justifying the selection of Serverless over Kubernetes, or vice versa.

**In the RAD UI:**
The choice between **App CloudRun** and **App GKE** modules forces the architect to map compute needs. Cloud Run favors low operational overhead and rapid scaling from zero. GKE favors complex orchestrations and persistent state.

**Console Exploration:**
Navigate between **Cloud Run** and **Kubernetes Engine** in the console to observe the operational differences.

### 💡 Additional Network/Storage/Compute Objectives & Learning Guidelines
*   **Google Cloud AI and Machine Learning:** Research Vertex AI, Gemini LLMs, Agent Builder, and Model Garden. Understand when to use pre-trained APIs versus custom model training on AI Hypercomputers.
*   **Data Processing Solutions:** Differentiate between Cloud Dataflow (Apache Beam, streaming/batch), Dataproc (managed Hadoop/Spark), and Pub/Sub (event ingestion).
*   **Compute Volatility:** Understand Spot VMs (preemptible, cheap, fault-tolerant workloads) vs. Custom Machine Types vs. Sole-Tenant nodes.
*   **Cloud Run Functions:** Understand when to use single-purpose, event-driven functions over full containerized apps on Cloud Run.

---

## 1.4 Creating a migration plan
### 💡 Additional Migration Objectives & Learning Guidelines
The RAD modules deploy greenfield applications, but the PCA exam focuses heavily on migrating existing workloads.
*   **Google Cloud Migration Center:** Explore the Migration Center in the console. Understand how it performs discovery, assesses dependencies, and recommends target architectures (e.g., fit for GKE or Compute Engine).
*   **Migration Methodologies:** Study Lift and Shift (Rehosting), Improve and Move (Replatforming), and Rip and Replace (Refactoring). Understand workload testing (running the migrated system in parallel before cutover), network planning (provisioning HA VPN or Cloud Interconnect before migration), and dependency mapping (ensuring dependent services are migrated in the correct order).
*   **Integrating Solutions with Existing Systems:** Legacy environments rarely disappear overnight. Design integration points using Apigee or Cloud Endpoints to expose on-premises functionality as APIs consumable by cloud services. Use Pub/Sub to decouple on-premises event producers from cloud consumers asynchronously. Cloud Interconnect or HA VPN provides secure hybrid network connectivity during the transition period, allowing cloud and on-premises workloads to communicate as if on the same private network.
*   **Software Licensing:** Understand how BYOL (Bring Your Own License) impacts architecture, particularly the use of Sole-Tenant nodes for strict core-based licensing (e.g., Windows Server, SQL Server).

---

## 1.5 Envisioning future solution improvements
### 💡 Additional Future Solutions Objectives & Learning Guidelines
*   **Cloud and Technology Improvements:** Google Cloud continuously releases new managed services, regional expansions, and AI capabilities. Design systems with clear abstraction layers — for example, routing events through Pub/Sub rather than hardcoding service-to-service HTTP calls — so that the underlying technology can be upgraded or replaced without application refactoring. Track the Google Cloud release notes and "What's New" page as part of an architect's ongoing practice.
*   **Evolution of Business Needs:** Anticipate that product strategies, compliance requirements, and scale targets will change. Design solutions with loose coupling (Pub/Sub, Eventarc, Cloud Tasks), modular IaC using versioned Terraform modules, and well-defined API contracts so that new business requirements can be addressed without wholesale architectural rework. For example, a monolithic application can be incrementally strangled by extracting individual capabilities as Cloud Run services behind an API Gateway, migrating traffic gradually using weighted routing.
*   **Cloud-First Design:** Research how to evolve a hybrid "lift-and-shift" architecture into a cloud-native architecture over time by strangling the monolith, adopting managed services (like Cloud Spanner), and utilizing serverless event-driven patterns.
