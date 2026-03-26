# PCD Certification Preparation Guide: Section 1 — Designing highly scalable, available, and reliable cloud-native applications (~36% of the exam)
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section1.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section1.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section1.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud Developer (PCD) certification explore Section 1 of the exam through the lens of the Tech Equity RAD platform at [https://techequity.cloud](https://techequity.cloud). Three modules are relevant to this section: **Services GCP**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCD objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 1.1 Designing high-performing applications and APIs

### Platform Selection and Traffic Management
**Concept:** Choosing the appropriate platform based on use case and implementing traffic splitting strategies (gradual rollouts, rollbacks, A/B testing).

**In the RAD UI:**
*   **Platform Choice:** The RAD platform provides templates for **App CloudRun** (serverless, event-driven HTTP workloads that scale to zero) and **App GKE** (container orchestration for workloads that need persistent connections, StatefulSets, or fine-grained networking). For workloads requiring direct OS access, custom hardware, or persistent long-running background processes, Compute Engine VMs are the appropriate choice — these are provisioned via the Services GCP module infrastructure layer.
*   **Traffic Splitting:** In Cloud Run, the `traffic_split` variable (Group 5) dictates how traffic is divided across container revisions for A/B testing and canary rollouts.

**Console Exploration:**
Navigate to **Cloud Run**, select the service, and review the **Revisions** tab to see how traffic is allocated across revisions. Observe that each revision is immutable — configuration changes always produce a new revision, which can then receive a percentage of traffic. For GKE, review **Cloud Deploy > Delivery pipelines** for progressive rollout stages.

> **Real-World Example:** A team wants to validate a new recommendation algorithm on 10% of live traffic before a full rollout. They deploy the new algorithm as a new Cloud Run revision and set `traffic_split` to route 10% there and 90% to the stable revision. Cloud Monitoring dashboards compare click-through rates between the two revisions over 24 hours. If the new revision performs better, traffic is shifted to 100% with a single configuration change. If it underperforms, the rollback is instant — simply route 100% back to the previous revision.

### Geographic Distribution and High Availability
**Concept:** Understanding how Google Cloud services are distributed across regions and zones, and designing applications that survive zonal and regional failures.

**In the RAD UI:**
*   **Multi-Region Deployment:** The `availability_regions` variable (Group 2 in Services GCP) controls which regions receive subnets, Cloud NAT, and Cloud Router. Adding a second region deploys the full networking stack there, enabling application deployments in multiple regions behind a single global load balancer.
*   **Database Replication:** The `postgres_database_availability_type` variable (Group 3 in Services GCP) switches between `ZONAL` (single zone, primary only) and `REGIONAL` (synchronous standby in a second zone — automatic failover within ~60 seconds on zone failure). For production workloads, `REGIONAL` is always recommended.

**Console Exploration:**
Navigate to **Cloud Run** and observe that a Cloud Run service is regional — it runs across multiple zones within the selected region automatically. Navigate to **SQL** and inspect the instance details: a REGIONAL instance shows a primary zone and a failover zone. Navigate to **Network Services > Load balancing** to see how a global anycast IP routes users to the nearest region.

> **Real-World Example:** A SaaS platform deploys Cloud Run services in `us-central1` and `europe-west1`. A Global External Application Load Balancer with two backend service regions routes users to the nearest region based on network latency. When the `us-central1` region experiences degraded connectivity, the load balancer health checks detect the failure within seconds and route all US traffic to `europe-west1` — users experience a brief latency increase but no application downtime.

**Key geographic concepts for the PCD exam:**
- **Zonal services:** Compute Engine VMs, Persistent Disks, GKE nodes — tied to a single zone. A zone failure takes down all zonal resources in that zone.
- **Regional services:** Cloud SQL REGIONAL, GKE Autopilot, Cloud Run — redundant across multiple zones within a region. Survive individual zone failures.
- **Global services:** Cloud Storage (multi-region), Cloud Spanner (multi-region), Global Load Balancing — distributed across regions. Highest availability, highest cost.

### Caching Solutions
**Concept:** Implementing in-memory caching to reduce database load and improve application response times.

**In the RAD UI:**
*   **Memorystore (Redis):** In **Services GCP**, `create_redis` (Group 5) and `redis_tier` (Group 5) configure managed in-memory caching. Set `enable_redis` (Group 14 for App CloudRun, Group 20 for App GKE) to dynamically pass the Redis host and port into the container as environment variables.

**Console Exploration:**
Navigate to **Memorystore > Redis** to view the Redis instance. Observe the instance tier (`BASIC` for single-node, `STANDARD_HA` for primary-replica with automatic failover), the memory size, and the private IP address accessible only from within the VPC. In your application code, use this private IP with the Redis client library — all traffic stays within Google's private network.

> **Real-World Example:** A Cloud Run service queries the same product catalogue data for 80% of its requests. Without caching, every request hits Cloud SQL, consuming database connection pool slots and adding 20–50ms of query latency. After connecting to Memorystore, the application checks Redis first: a cache hit returns data in under 1ms and skips the database entirely. Cache miss rate drops to under 5% after warm-up, reducing Cloud SQL CPU utilisation by 60% and cutting p99 latency in half.

### Session Affinity and Content Delivery
**Concept:** Configuring load balancers to route a user's requests consistently to the same backend, and using Cloud CDN to cache responses at the edge for lower latency.

**In the RAD UI:**
Both App CloudRun and App GKE provision a Global External Application Load Balancer when `enable_cloud_armor` (Group 9 for Cloud Run, Group 13 for GKE) is enabled. The load balancer is the integration point for both session affinity and Cloud CDN.

**Console Exploration and Learning Guidelines:**

**Session affinity** instructs the load balancer to consistently route a client's requests to the same backend instance. Navigate to **Network Services > Load balancing**, select your load balancer, click **Edit**, and select the backend service. Under **Session affinity**, choose from:
- `CLIENT_IP` — routes all requests from the same source IP to the same backend. Simple but breaks with NAT or proxies.
- `GENERATED_COOKIE` — the load balancer sets a cookie on the first response; subsequent requests carrying that cookie are routed to the same backend. The recommended option for browser-based applications.
- `HEADER_FIELD` — routes based on a specific HTTP header value.

> **Real-World Example:** A legacy e-commerce application stores user shopping cart state in local memory on each application server instance rather than in a shared cache or database. Enabling `GENERATED_COOKIE` session affinity on the load balancer ensures that once a user's session is established on a particular instance, all their requests in that session reach the same instance — preventing cart data loss. The team treats this as a migration step while they refactor cart storage to use Memorystore for proper stateless scaling.

**Cloud CDN** caches responses from your backends at Google's globally distributed Points of Presence (PoPs), serving subsequent identical requests from cache without reaching your backend at all. Enable it on the load balancer's backend service and configure cache modes:
- `CACHE_ALL_STATIC` — automatically caches all static content (images, CSS, JS) based on content type.
- `USE_ORIGIN_HEADERS` — respects `Cache-Control` and `Expires` headers from your application.
- `FORCE_CACHE_ALL` — caches all responses regardless of origin headers (use with caution for dynamic content).

Navigate to **Network Services > Cloud CDN** to view cache hit rates and invalidate specific URL patterns when deploying new static assets.

### Creating and Deploying APIs (HTTP REST and gRPC)
**Concept:** Designing and exposing well-structured APIs for both browser clients (REST) and service-to-service communication (gRPC).

**In the RAD UI:**
App CloudRun deploys HTTP-based services that expose REST endpoints. The `container_port` variable (Group 3) defines which port the container listens on for incoming HTTP requests from the load balancer.

**Console Exploration:**
Navigate to **Cloud Run**, select your service, and click the service URL to send a test HTTP request. Review the **Logs** tab to see individual request logs including HTTP method, path, and status code.

**HTTP REST APIs:**
REST APIs use standard HTTP methods (`GET`, `POST`, `PUT`, `DELETE`) and JSON payloads. Cloud Run services are naturally HTTP REST backends. For API management (rate limiting, authentication, analytics), place **Apigee** or **Cloud API Gateway** in front of the Cloud Run service:
- **Cloud API Gateway:** Lightweight, low-latency managed gateway. Define your API surface using an OpenAPI 2.0 specification and point it at your Cloud Run backend URL. Navigate to **API Gateway > APIs** to create an API config and deploy a gateway. Enforces quotas, API keys, and JWT authentication with minimal setup.
- **Apigee:** Google's full-featured API management platform for enterprise scenarios. Provides advanced features including developer portals, monetisation, OAuth 2.0 flows, traffic analytics, and complex transformation policies. Use Apigee when you need fine-grained control over API lifecycle management and have multiple API consumers with different access tiers.

> **Real-World Example:** A company exposes a Cloud Run microservice as a public API for third-party developers. They deploy Cloud API Gateway in front of it and define API key authentication in the OpenAPI spec. The gateway enforces a rate limit of 100 requests/minute per key, returning HTTP 429 when the quota is exceeded. The backend Cloud Run service only sees authenticated, rate-limited traffic — no rate-limiting logic needs to be written in application code.

**gRPC APIs:**
gRPC is a high-performance RPC framework using Protocol Buffers (protobuf) for serialisation and HTTP/2 for transport. It is significantly more efficient than REST/JSON for service-to-service communication:
- Define your service contract in a `.proto` file specifying service methods and message types.
- Generate client and server stubs using `protoc` for your chosen language.
- Cloud Run natively supports gRPC — set the container port to `8080` (or your gRPC server port) and ensure the load balancer uses HTTP/2.

Navigate to **Cloud Run**, select your service, and under **Networking > HTTP/2** confirm that HTTP/2 end-to-end is enabled for gRPC workloads. For internal gRPC between GKE services, the Kubernetes Gateway API and Cloud Service Mesh handle HTTP/2 routing natively.

### API Rate Limiting, Authentication, and Observability
**Concept:** Protecting APIs from abuse, enforcing authentication, and gaining visibility into API usage patterns.

**Console Exploration:**
Navigate to **API Gateway > APIs** to explore a deployed API. The **Monitoring** tab shows request rates, error rates, and latency by method and consumer. Navigate to **API Gateway > Gateways** and view the gateway logs in Cloud Logging — each request log entry includes the API key, method, latency, and response code, providing full observability without instrumenting the backend.

For **Apigee**, navigate to **Apigee > Analytics > API Metrics** to view traffic dashboards, top consumers, and error breakdowns per API proxy. Apigee's built-in analytics are far richer than Cloud API Gateway for enterprise scenarios.

> **Real-World Example:** An API team notices a spike in 4xx errors on their Cloud Run API. In Cloud API Gateway's monitoring tab, they filter by response code and see that one specific API key is generating 95% of the errors — the key belongs to a partner integration that recently deployed a bug causing malformed requests. The team revokes that key temporarily, notifies the partner, and the error rate drops to baseline within seconds.

### Asynchronous and Event-Driven Integration
**Concept:** Decoupling services using message queues and event triggers to build resilient, scalable architectures.

**In the RAD UI:**
Services GCP enables `pubsub.googleapis.com` automatically. The `enable_scc_notifications` variable (Group 11) demonstrates the Pub/Sub pattern in practice — Security Command Center findings are published to a Pub/Sub topic, which downstream systems subscribe to.

**Console Exploration:**
Navigate to **Pub/Sub > Topics** to see topics provisioned by the platform. Navigate to **Eventarc > Triggers** to explore how events from GCP services are routed to Cloud Run or other targets.

**Key patterns for the PCD exam:**

**Pub/Sub** decouples message producers from consumers. A publisher sends messages to a topic; one or more subscriptions deliver those messages to consumers (pull or push). Messages are durably stored and replayed if a consumer fails — producers never need to know if consumers are healthy.

**Eventarc** routes *events* from Google Cloud sources (Cloud Storage, Cloud SQL, Audit Logs, Pub/Sub, custom sources) to Cloud Run, GKE, or Workflows targets using the CloudEvents standard. Key trigger types:
- **Direct triggers:** Cloud Storage `google.cloud.storage.object.v1.finalized` fires when a file upload completes.
- **Audit Log triggers:** Any GCP API call can trigger a Cloud Run service — e.g. trigger on `cloudsql.instances.create` to automatically configure a new database.
- **Pub/Sub triggers:** Route Pub/Sub messages directly to a Cloud Run service as HTTP POST requests in CloudEvents format.

> **Real-World Example:** A document processing platform receives PDF uploads to a Cloud Storage bucket. An Eventarc trigger fires a Cloud Run service on every `objectFinalized` event. The service extracts text using Document AI, stores structured results in Firestore, and publishes a `document.processed` message to a Pub/Sub topic. Three downstream services subscribe independently: one sends an email notification, one updates a search index, and one triggers a compliance review workflow. No service is coupled to any other — each can be deployed, scaled, and updated independently.

### Orchestrating Application Services
**Concept:** Coordinating multi-step workflows across services using managed orchestration tools.

**Key tools and when to use each:**

**Cloud Workflows** is a fully managed, serverless orchestration service for coordinating sequences of HTTP-based service calls. Define workflow steps in YAML or JSON, with branching logic, error handling, retries, and parallel execution. Use Workflows when you need:
- Multi-step processes with conditional logic (e.g. `if order.value > 1000, trigger fraud check`).
- Reliable execution with automatic retry and state persistence.
- Visibility into each step's execution status and output.

Navigate to **Workflows > Workflows** to explore the visual workflow editor and execution history.

**Cloud Tasks** manages a queue of individual asynchronous task executions. Each task is a single HTTP request to a target (Cloud Run, App Engine, a URL). Use Cloud Tasks when you need:
- Rate-controlled dispatch of work items (e.g. send at most 100 emails/minute).
- Deduplication of tasks (Cloud Tasks can deduplicate by task name).
- Scheduled future execution of a single task (a task can have an `scheduleTime` in the future).

**Cloud Scheduler** is a fully managed cron job service. Use it to invoke HTTP endpoints, Pub/Sub topics, or Cloud Workflows on a time-based schedule (e.g. every day at 2am, every 15 minutes). Navigate to **Cloud Scheduler > Jobs** to create and test scheduled jobs.

**Eventarc** is the event-routing layer rather than an orchestration tool — it delivers individual events to targets but does not manage multi-step workflows or state.

> **Real-World Example:** An e-commerce order fulfilment system uses all three tools together. Cloud Scheduler triggers a Workflow every night at midnight to process all pending orders. The Workflow calls an inventory check service, a payment service, and a shipping service in sequence, handling errors at each step. For each order, the Workflow enqueues a Cloud Task to send a confirmation email — Cloud Tasks rate-limits email dispatch to 50/minute to respect the email provider's API limits. Eventarc separately triggers a real-time inventory update whenever a Cloud Storage import file lands.

### Cost and Resource Optimisation
**Concept:** Designing applications and infrastructure configurations that minimise cost while meeting performance requirements.

**In the RAD UI:**
*   **Scale to zero:** Setting `min_instance_count = 0` (Group 3, App CloudRun) means the service incurs zero compute cost when idle. Cloud Run bills per request, per vCPU-second and GB-second of memory allocation — a service with no traffic costs nothing.
*   **Instance bounds:** `max_instance_count` (Group 3, both modules) caps the maximum concurrent instances, preventing unbounded cost growth during traffic spikes.
*   **Resource right-sizing:** The `container_resources` variable (Group 3, both modules) sets CPU and memory requests. Over-provisioning CPU/memory wastes money; under-provisioning causes throttling. Use Cloud Profiler and container metrics to right-size over time.
*   **Shared infrastructure:** In Services GCP, `create_network_filesystem = true` runs both Redis and an NFS server on a single shared `e2-small` VM instead of separate managed services — reducing cost significantly for development and test environments.

> **Real-World Example:** A development team deploys all non-production environments with `min_instance_count = 0` and `max_instance_count = 2`. Production uses `min_instance_count = 1` (to avoid cold start latency) and `max_instance_count = 50`. This configuration means dev and staging environments cost nothing when not in use, while production maintains a warm instance at all times. The team uses Active Assist recommendations to identify that their `container_resources` setting is 40% over-provisioned based on actual usage — reducing memory from 512Mi to 256Mi cuts per-request billing in half.

---

## 1.2 Designing secure applications

### IAM, Least Privilege, and Authentication
**Concept:** Securing cloud resources using IAM roles for service accounts and authenticating to GCP services.

**In the RAD UI:**
*   **Least Privilege:** The platform strictly uses dedicated custom service accounts with minimum required predefined roles (like `roles/cloudsql.client`) rather than the default compute service account. Using the default compute service account is an anti-pattern — it is automatically granted broad `roles/editor` permissions across the project.
*   **Identity-Aware Proxy (IAP):** The `enable_iap` variable (Group 4) configures IAP, which authenticates end-users at the Google Front End before requests reach the backend — acting as a zero-trust access layer that replaces traditional VPN-based perimeter security.

**Console Exploration:**
Navigate to **IAM & Admin > Service Accounts** and view the **Permissions** tab for each application service account to confirm minimum required roles. Navigate to **Security > Identity-Aware Proxy** to view which users and groups have been granted the `IAP-secured Web App User` role.

**Authentication methods for the PCD exam:**

**Application Default Credentials (ADC)** is the recommended pattern for code running on Google Cloud. The ADC library searches for credentials in this order: (1) `GOOGLE_APPLICATION_CREDENTIALS` environment variable pointing to a service account key file, (2) credentials attached to the compute environment (Workload Identity for GKE, or the metadata server for Cloud Run/Compute Engine). On Google Cloud, ADC automatically uses the service account bound to the workload — no credential file is needed.

```python
# ADC pattern — works identically locally and on Cloud Run/GKE
from google.cloud import storage
client = storage.Client()  # automatically uses ADC
```

**JWT (JSON Web Token) and OAuth 2.0** are used to authenticate service-to-service calls where ADC is not available (e.g. calling a Cloud Run service from an external system):
- A **service account key** (or Workload Identity) generates a signed JWT asserting the service account's identity.
- The JWT is exchanged for a short-lived **OAuth 2.0 access token** via Google's token endpoint.
- The access token is included as a `Bearer` token in the `Authorization` header of API calls.
- For calling IAP-protected or Cloud Run private services, use an **ID token** (issued by `generateIdToken`) rather than an access token.

Navigate to **IAM & Admin > Service Accounts**, select a service account, and explore the **Keys** tab — understand why creating long-lived JSON key files is discouraged (keys don't auto-rotate, can be exfiltrated, and are hard to audit).

**Cloud SQL Auth Proxy** (already deployed by the RAD platform via `enable_cloudsql_volume`) and **AlloyDB Auth Proxy** both work on the same principle: a sidecar process authenticates to the Cloud SQL/AlloyDB API using ADC, then creates an encrypted tunnel to the database. Your application connects to `localhost` on a Unix socket or TCP port — SSL certificate management and IP allowlisting are handled automatically by the proxy.

> **Real-World Example:** A Cloud Run service needs to connect to both a Cloud SQL PostgreSQL database and call the Vision API. With Workload Identity, the Cloud Run service identity is bound to a Google Service Account that has `roles/cloudsql.client` and `roles/vision.imageAnnotator`. The application code uses ADC for both connections — no credentials are stored in the container image, environment variables, or Secret Manager. When the service account's roles are updated, the change takes effect on the next request without redeployment.

**Workload Identity Federation** extends ADC to workloads running *outside* Google Cloud (e.g. CI/CD pipelines on other cloud providers, on-premises servers). Instead of downloading a service account key, you configure a trust relationship between Google Cloud and an external identity provider (AWS IAM, GitHub Actions OIDC, Azure AD). The external workload exchanges its native identity token for a short-lived Google access token — no long-lived credentials are stored anywhere. Navigate to **IAM & Admin > Workload Identity Federation** to explore pool and provider configuration.

### Secrets Management and Software Supply Chain
**Concept:** Storing, accessing, and rotating secrets and encryption keys, and securing the container build pipeline.

**In the RAD UI:**
*   **Secret Manager Integration:** The `enable_auto_password_rotation` (Group 11 for Cloud Run, Group 17 for GKE) variable automates credential rotation. Secret values are fetched by the Cloud Run/GKE workload at startup via the Secret Manager API — the plaintext value is never written to a config file, container image layer, or Terraform state file.
*   **Binary Authorization:** In **Services GCP**, `enable_binary_authorization` (Group 11) configures a cluster admission policy requiring all container images to be signed by a trusted Cloud Build attestor. Unsigned images are rejected at deploy time.
*   **Micro-segmentation:** In **App GKE**, `enable_network_segmentation` (Group 9) enforces Kubernetes Network Policies that restrict pod-to-pod traffic — only pods with matching label selectors can communicate within the namespace.

**Console Exploration:**
Navigate to **Security > Secret Manager**. View a secret and note that you cannot read the value without `roles/secretmanager.secretAccessor` — `roles/secretmanager.viewer` allows listing secrets but not reading their material. Click **Versions** to see the rotation history. Navigate to **Security > Binary Authorization** to view the active policy and attestors.

**Cloud Key Management Service (Cloud KMS)** manages encryption keys for Customer-Managed Encryption Keys (CMEK). Navigate to **Security > Key Management** to explore key rings and keys. CMEKs are used when regulatory requirements demand that you control the encryption key lifecycle — you can disable a key to immediately render all data encrypted with it inaccessible. Integrate CMEK with Cloud Storage buckets, Cloud SQL, BigQuery, Pub/Sub, and Secret Manager.

> **Real-World Example:** A fintech application stores sensitive customer data in Cloud Storage. Compliance requirements mandate that the company can provably delete all customer data within 24 hours of a deletion request. Rather than locating and deleting individual objects (impractical at scale), the team encrypts each customer's data with a unique CMEK key in Cloud KMS. When a deletion request arrives, they destroy the customer's KMS key — all objects encrypted with that key become permanently inaccessible within minutes, across every storage location.

### Security Mechanisms, Vulnerability Detection, and Service-to-Service Security
**Concept:** Proactively identifying vulnerabilities in running services and container images, and securing communication between microservices.

**In the RAD UI:**
The `enable_security_command_center` variable (Group 11, Services GCP) activates Security Command Center (SCC), which continuously scans all deployed resources for security misconfigurations and active threats.

**Console Exploration:**

**Web Security Scanner** identifies vulnerabilities (XSS, mixed content, outdated libraries, insecure forms) in publicly accessible web applications by crawling and probing them. Navigate to **Security > Web Security Scanner > Scan configs** to create a scan. Provide the starting URL of your Cloud Run or GKE-hosted application, configure authentication if required, and run the scan. Review findings in the **Findings** tab and filter by severity. Web Security Scanner integrates with Security Command Center — high-severity findings appear in the SCC dashboard automatically.

**Artifact Analysis** (formerly Container Analysis) automatically scans container images pushed to Artifact Registry for OS-level CVEs and language-specific vulnerabilities. Navigate to **Artifact Registry**, select a container image version, and click the **Vulnerabilities** tab to see a breakdown of CVEs by severity (Critical, High, Medium, Low). Artifact Analysis continuously rescans images as new CVEs are published — an image that was clean yesterday may show new findings today as the vulnerability database is updated.

> **Real-World Example:** A Cloud Run service image is scanned by Artifact Analysis after being pushed to Artifact Registry by Cloud Build. A new Critical CVE in the base OS image is published three weeks later. Artifact Analysis detects it and creates a finding in Security Command Center. The team's SCC notification (via the `enable_scc_notifications` variable) sends an alert to their Pub/Sub topic, which triggers a Cloud Run function that opens a ticket in their issue tracker automatically — without any manual monitoring of the Artifact Registry console.

**Cloud Service Mesh** (formerly Anthos Service Mesh, based on Istio) provides mTLS encryption, traffic management, and observability for service-to-service communication in GKE clusters. With Service Mesh enabled:
- All inter-pod traffic is automatically encrypted with mutual TLS — no application code changes needed.
- Traffic policies (retries, timeouts, circuit breakers, traffic shifting) are defined at the mesh level, not in application code.
- Service-level metrics (request rate, error rate, latency) are collected automatically for every service without manual instrumentation.

Navigate to **Kubernetes Engine > Service Mesh** to explore the mesh topology and traffic health dashboard. For simpler pod-to-pod security without a full service mesh, Kubernetes Network Policies (enabled via `enable_network_segmentation`) provide L3/L4 firewall rules based on pod label selectors.

### Data Retention, Compliance, and Identity Platform
**Concept:** Enforcing data retention policies for compliance, and managing end-user authentication at scale.

**Console Exploration:**

**Cloud Storage data retention:**
- **Object Lifecycle Management:** Navigate to **Cloud Storage > Buckets**, select a bucket, and click the **Lifecycle** tab. Create rules to automatically transition objects to cheaper storage classes (Nearline, Coldline, Archive) or delete them after a specified number of days. This is the primary mechanism for automated cost management and data expiry enforcement.
- **Retention policies (Bucket Lock):** Under **Bucket details > Protection**, set a **Retention period** — objects in the bucket cannot be deleted or overwritten until the retention period expires, even by project owners. Enable **Bucket Lock** to make the retention policy permanent (irrevocable). This creates WORM (Write Once Read Many) storage for regulatory compliance (SEC 17a-4, FINRA, HIPAA).

> **Real-World Example:** A healthcare provider must retain patient records for a minimum of 7 years under HIPAA. They create a Cloud Storage bucket with a 7-year retention policy and lock it. The Lock prevents any administrator — including Google support — from reducing the retention period or deleting records prematurely. Automated lifecycle rules delete records exactly on day 2557, without manual intervention.

**Identity Platform** is Google Cloud's Customer Identity and Access Management (CIAM) service, providing authentication infrastructure for end-user-facing applications (B2C) and business customer portals (B2B). It supports email/password, phone SMS, social providers (Google, Facebook, GitHub), SAML 2.0, and OIDC federation. Navigate to **Identity Platform > Providers** to configure authentication providers. Key differences from Cloud Identity (which manages internal GCP users): Identity Platform manages your application's end-users — the people who sign in to your app, not your GCP administrators.

---

## 1.3 Storing and accessing data

### Selecting Appropriate Storage Systems
**Concept:** Selecting purpose-built storage based on data structure, access patterns, volume, and consistency requirements.

**In the RAD UI:**
*   **Cloud SQL (Relational):** The `create_postgres` / `create_mysql` variables (Group 3 in Services GCP) provision fully managed PostgreSQL or MySQL. Cloud SQL provides strong consistency — a committed write is immediately visible to all readers.
*   **Cloud Storage (Object Storage):** The `storage_buckets` variable (Group 10 for Cloud Run, Group 17 for GKE) provisions GCS buckets for unstructured data (files, images, backups, exported data). Multi-region Cloud Storage buckets provide eventual consistency for metadata operations (bucket listing) but strong read-after-write consistency for object operations since November 2020.
*   **Memorystore (Redis):** Covered in section 1.1 — used for ephemeral caching, not durable storage.

**Console Exploration:**
Navigate to **Cloud Storage** and **SQL** in the GCP Console to review storage tiers and regional configurations.

### Database Selection and Schema Design
**Concept:** Choosing the right database engine for structured and unstructured workloads, and designing schemas that align with each engine's data model and scalability characteristics.

**Structured (relational) databases:**

**Cloud SQL** is the right choice for standard OLTP workloads (web apps, APIs, ERP) that fit within a single region and a single primary node. Max storage is 64TB, max connections are bounded by instance size. Use PostgreSQL for its rich ecosystem; MySQL for legacy compatibility.

**AlloyDB for PostgreSQL** is the choice when Cloud SQL's performance ceiling is reached or when you need HTAP (hybrid transactional/analytical processing) — AlloyDB delivers 4× the throughput of standard PostgreSQL for transactional workloads and 100× for analytical queries, using a disaggregated storage architecture. The **AlloyDB Auth Proxy** works identically to the Cloud SQL Auth Proxy — replace the Cloud SQL Proxy sidecar with the AlloyDB Proxy for AlloyDB instances. Schema design follows standard PostgreSQL — normalise for OLTP, use columnar storage patterns for analytics.

**Cloud Spanner** is the choice when you need:
- Horizontal scaling beyond a single machine (petabytes of data, millions of QPS).
- Globally distributed reads and writes with external consistency (stronger than serialisable isolation).
- Zero-downtime schema changes.

**Spanner schema design principles:**
- Avoid hotspotting: do not use auto-incrementing integer primary keys (UUIDs or hash-prefixed keys distribute writes across shards).
- Use **interleaving** to co-locate parent and child rows physically — `INTERLEAVE IN PARENT Orders ON DELETE CASCADE` places each order's line items on the same Spanner server as the order, dramatically reducing cross-server joins.
- Spanner supports standard SQL (ANSI 2011) and a GoogleSQL dialect — existing SQL queries generally work with minor modifications.

Navigate to **Spanner > \<instance\> > Spanner Studio** to explore schema views and run queries.

**Unstructured (NoSQL) databases:**

**Firestore** (Native mode) is a serverless, document-oriented NoSQL database. Data is organised as collections of documents, where each document is a map of key-value fields. Design considerations:
- Structure data to avoid deeply nested subcollections — prefer flat document structures with denormalised data for read-heavy patterns.
- Firestore has strong consistency for single-document reads and queries within a single collection. Cross-collection queries are not supported natively — use data denormalisation or composite indices.
- Ideal for: user profiles, application settings, real-time collaboration (mobile/web apps using Firestore's real-time listeners).

**Cloud Bigtable** is a wide-column NoSQL database designed for massive scale (petabytes) and extremely low latency (single-digit milliseconds). Schema design is fundamentally different from relational databases:
- The **row key is the only index** — all queries must be by row key or row key range. Design your row key to support your access pattern.
- A common row key pattern for time-series data: `<device-id>#<reverse-timestamp>` — this groups all data for a device together and naturally sorts newest-first within each device's rows.
- Avoid **hotspotting**: if all writes go to rows with similar key prefixes (e.g. all start with today's date), all writes land on the same Bigtable tablet server. Use a hash prefix or field reordering to distribute writes.
- Ideal for: IoT telemetry, financial time-series, ad-tech event streams, ML feature stores.

Navigate to **Bigtable > \<instance\> > Bigtable Studio** to query tables and inspect row structure.

### Consistency Implications Across Data Services
**Concept:** Understanding the consistency guarantee each service provides and designing applications accordingly.

| Service | Consistency Model | Notes |
|---|---|---|
| Cloud SQL | **Strong** (serialisable) | Single-region. Committed writes immediately visible. REGIONAL HA uses synchronous replication — no data loss on zone failure. |
| AlloyDB | **Strong** (serialisable) | Committed writes immediately visible. Read pool instances may lag slightly behind the primary for read scaling. |
| Cloud Spanner | **External consistency** (stronger than serialisable) | True globally consistent reads across regions. TrueTime-based timestamps guarantee globally ordered transactions. |
| Firestore | **Strong** for single-document reads | Eventual consistency possible for queries against recently written data in some edge cases. |
| Bigtable | **Strong** within a single cluster | Multi-cluster replication is **eventually consistent** — reads from a replication target may not reflect the most recent writes to the primary cluster. |
| Cloud Storage | **Strong** for object reads (since Nov 2020) | Read-after-write consistency for all object operations. Bucket listing (metadata) may still have eventual consistency behaviour under high mutation rates. |

> **Real-World Example:** An IoT platform writes sensor readings to Bigtable using a multi-cluster replication setup for regional availability. Application code that reads from the replica cluster must account for potential replication lag — a sensor's latest reading may not yet be present in the replica. The team adds a `X-Read-Consistency: strong` routing policy for user-facing reads (which routes to the primary cluster) while allowing background analytics to read from the replica, accepting stale data in exchange for lower latency.

### Signed URLs and BigQuery
**Concept:** Granting temporary, delegated access to Cloud Storage objects, and writing data to BigQuery for analytics.

**Signed URLs** grant time-limited, unauthenticated access to a specific Cloud Storage object. The URL embeds a cryptographic signature — anyone with the URL can perform the allowed operation (GET, PUT, DELETE) until the URL expires, without needing a Google account. Use cases:
- Allow a user to download a private file directly from Cloud Storage without routing the binary data through your application server.
- Allow a client to upload a file directly to Cloud Storage (PUT signed URL) without granting the client write access to the bucket.

Generate signed URLs using the `google-cloud-storage` client library:
```python
from google.cloud import storage
from datetime import timedelta

client = storage.Client()
bucket = client.bucket("my-private-bucket")
blob = bucket.blob("reports/monthly-report.pdf")

url = blob.generate_signed_url(
    version="v4",
    expiration=timedelta(minutes=15),
    method="GET",
)
# Share this URL — it expires in 15 minutes
```

Navigate to **Cloud Storage > Buckets**, select a private object, and click **Create a signed URL** in the console to generate one without writing code. Understand that signing requires either a service account key or impersonation of a service account with `roles/iam.serviceAccountTokenCreator`.

**Writing data to BigQuery:**
BigQuery supports two loading patterns for application developers:
- **Streaming inserts** (`insertAll` API / `client.insert_rows()` in the Python library): Write rows in real time with sub-second latency. Data is immediately queryable. Best for application event tracking, audit logs, and operational dashboards. Note: streaming inserts have a cost per GB and do not support DML (UPDATE/DELETE) on streamed rows for 30 minutes.
- **BigQuery Storage Write API** (recommended for new code): A unified, high-throughput streaming API that supports exactly-once delivery semantics. More efficient than the legacy streaming insert API for high-volume workloads.
- **Batch loads** (`bq load` command or Cloud Build job): Load CSV, JSON, Parquet, or Avro files from Cloud Storage into BigQuery tables. No per-row streaming cost. Use for nightly ETL loads or large data migrations.

Navigate to **BigQuery > Explorer** to explore the schema of a dataset. Practice running a query and observing the bytes-processed estimate before execution — this is the billing basis for on-demand query pricing.

> **Real-World Example:** A mobile analytics platform streams user click events from Cloud Run to BigQuery using the Storage Write API — approximately 50,000 events/second at peak. The product team queries BigQuery directly via the console for ad-hoc analysis, and a Looker Studio dashboard reads from BigQuery to display daily active users and funnel conversion rates. The same raw event data is also used to train an ML model in Vertex AI — BigQuery's direct Vertex AI integration allows training data to be exported without copying files to Cloud Storage first.
