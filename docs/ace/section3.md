# ACE Certification Preparation Guide: Section 3 — Ensuring successful operation of a cloud solution (~27% of the exam)
<YouTubeEmbed videoId="B6juHA1kYEQ" poster="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section3.png" />

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/ace_section3.pdf)



This guide helps candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification explore Section 3 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **Services GCP**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights ACE objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 3.1 Managing compute resources

### Deploying new versions of an application
**Concept:** Automating the delivery pipeline to reliably push new container images to production.

**In the RAD UI:**
*   **CI/CD Pipelines:** Both `App CloudRun` and `App GKE` include built-in CI/CD pipelines. The `enable_cicd_trigger` (Group 7) variable activates Cloud Build integration. When active, variables like `github_repository_url` (Group 7) and `cicd_trigger_config` (Group 7 for Cloud Run, Group 8 for GKE) define how the system reacts to code commits.
*   **Continuous Deployment:** Setting `cloud_deploy_stages` (Group 7 for Cloud Run, Group 18 for GKE) configures Google Cloud Deploy to take the built container and roll it out progressively across defined environments (e.g., dev, staging, prod).

**Console Exploration:**
In the GCP Console, navigate to **Cloud Build > Triggers** to see the configured integration with source control. Then, navigate to **Cloud Deploy > Delivery pipelines** to visualise the progression of a release and understand how approvals or automated promotions move the application through its environments.

**Real-world example:** A development team merges a feature branch into `main`. The Cloud Build trigger fires, builds the container image, pushes it to Artifact Registry, and creates a new Cloud Deploy release targeting the `dev` stage. Automated integration tests pass, and the release is automatically promoted to `staging`. A manual approval gate in Cloud Deploy requires the engineering manager to review test results before the release is promoted to `prod` — providing a human checkpoint before production traffic is affected.

### Adjusting application traffic splitting parameters
**Concept:** Safely routing user traffic between different versions of an application to minimize deployment risk.

**In the RAD UI:**
*   **Traffic Allocation (Cloud Run):** The `App CloudRun` module exposes the `traffic_split` variable (Group 5). This allows practitioners to implement canary deployments declaratively (e.g., routing 5% of traffic to a new revision for testing).
*   **Canary Deployments (GKE):** While Cloud Run manages traffic natively at the revision level, GKE manages progressive rollouts via Cloud Deploy target configurations.

**Console Exploration:**
Navigate to **Cloud Run** in the GCP Console, select the deployed service, and click on the **Revisions** tab. Observe the "Traffic" column to see traffic weighting. For GKE, navigate to **Cloud Deploy > Delivery pipelines** and review the "Rollout" details to observe multi-stage deployments.

**Real-world example:** A team releases a new checkout page redesign. They deploy it as a new Cloud Run revision but route only 5% of traffic to it using `traffic_split`. Cloud Monitoring dashboards show the new revision's error rate is identical to the stable version. After 30 minutes, traffic is shifted to 50%, then 100% — all with zero downtime. If the error rate had spiked on the new revision, the team would have instantly redirected 100% of traffic back to the previous revision with a single variable change.

### Configuring autoscaling for an application
**Concept:** Tuning concurrency and instance counts to handle load efficiently while controlling costs.

**In the RAD UI:**
*   **Scaling Limits (Cloud Run):** Variables `min_instance_count` (Group 3) and `max_instance_count` (Group 3) are applied directly to the Cloud Run service. Setting `min_instance_count` > 0 eliminates cold starts, while `max_instance_count` caps costs.
*   **Horizontal Pod Autoscaler (HPA in GKE):** The `App GKE` module similarly uses `min_instance_count` (Group 3) and `max_instance_count` (Group 3) alongside `container_resources` (Group 3) limits. The module also automatically provisions Pod Disruption Budgets (configured via `pdb_min_available`, Group 27) to ensure a minimum number of pods remain available during voluntary disruptions.

**Console Exploration:**
Still in the **Revisions** tab of your Cloud Run service in the Console, inspect the autoscaling and concurrency settings. For GKE, navigate to **Kubernetes Engine > Workloads**, select the deployment, and view the **Autoscaling** tab to see current CPU/Memory targets driving the HPA.

### 💡 Additional Compute Management Objectives & Learning Guidelines
The ACE exam extensively tests manual VM management, GKE operations, snapshots, and manual Kubernetes scaling.

*   **Remotely connecting to Compute Engine instances:** The exam covers three approaches:
    - **OS Login with IAP TCP Forwarding:** `gcloud compute ssh <instance> --tunnel-through-iap` — the recommended method; no public IP required, access controlled by IAM.
    - **SSH via External IP:** Requires a public IP on the VM and an SSH key in project metadata or OS Login.
    - **Cloud Shell/Console SSH:** The GCP Console provides a browser-based SSH terminal — click the **SSH** button on any VM in **Compute Engine > VM instances**.

*   **Viewing current running Compute Engine instances:** Navigate to **Compute Engine > VM instances**. Practice filtering by zone, status, and labels. Use `gcloud compute instances list --filter="status=RUNNING"` to list all running instances from the command line. Viewing running instances is the first step in diagnosing unexpected resource consumption or billing anomalies.

*   **Working with snapshots and images:** Snapshots capture the state of a Persistent Disk at a point in time and can be used for backup or to create new disks. Images are more portable — they include the boot disk contents and OS configuration and can be used to create new VM instances.
    - Create a snapshot: **Compute Engine > Snapshots > Create snapshot**, or `gcloud compute disks snapshot <disk-name> --snapshot-names=<name>`.
    - Schedule automated snapshots: **Compute Engine > Snapshots > Snapshot schedules** — configure hourly, daily, or weekly snapshots with a retention policy.
    - Create a custom image from a snapshot or existing disk: **Compute Engine > Images > Create image**.

    > **Real-World Example:** Before patching a production VM, an operations team creates an on-demand snapshot. The patch is applied and tested. If the patch causes instability, the team creates a new disk from the snapshot and attaches it to a replacement VM — restoring the system to its pre-patch state within minutes, without relying on a full OS reinstallation.

*   **Compute Engine VMs & MIGs:** Practice creating a Managed Instance Group via the **Compute Engine > Instance groups** console. Configure an autoscaling policy based on CPU utilization. Practice connecting to a VM using OS Login or Identity-Aware Proxy (IAP) TCP forwarding.

    > **Real-World Example:** A web application uses a MIG with autoscaling set to maintain 60% average CPU utilisation. During a flash sale, traffic spikes 10× and the MIG automatically scales from 2 to 18 instances within minutes, then scales back down as traffic subsides — all without manual intervention and with costs proportional to actual demand.

*   **Viewing current running GKE cluster inventory:** Use `kubectl get nodes`, `kubectl get pods -A` (all namespaces), and `kubectl get services -A` to list the full cluster inventory. In the GCP Console, navigate to **Kubernetes Engine > Clusters** and click into your cluster to see Nodes, Workloads, and Services tabs.

*   **Configuring GKE to access Artifact Registry:** For GKE Autopilot, the node service account must have `roles/artifactregistry.reader` to pull images from private Artifact Registry repositories. The App GKE module's Cloud Build service account is granted `roles/artifactregistry.writer` to push built images. Navigate to **Artifact Registry > Repositories**, select your repository, and view the **Permissions** panel to confirm which service accounts have pull access. For Standard clusters, you can also configure imagePullSecrets as a Kubernetes Secret alternative.

*   **Working with Kubernetes resources (Pods, Services, StatefulSets):**
    - `kubectl get pods -n <namespace>` — list pods and their status.
    - `kubectl describe pod <name>` — inspect pod events, resource requests, and container status.
    - `kubectl get services` — view ClusterIP, NodePort, and LoadBalancer services.
    - `kubectl get statefulsets` — StatefulSets provide stable network identities and persistent storage for stateful workloads (e.g. databases). Each pod in a StatefulSet gets a predictable hostname (`<name>-0`, `<name>-1`...) and its own PVC, unlike Deployments where pods are interchangeable.

*   **Managing GKE Autopilot Pod resource requests:** GKE Autopilot requires explicit CPU and memory requests on every container — it rejects pods without resource requests. The `container_resources` variable in App GKE sets these values. Navigate to **Kubernetes Engine > Workloads**, select the deployment, and view the YAML to inspect `resources.requests` and `resources.limits`. Autopilot bills per pod resource request, so right-sizing these values directly controls cost.

*   **Manual Scaling (`kubectl`):** Practice manually scaling a Kubernetes deployment using `kubectl scale deployment <name> --replicas=3`. Understand the difference between Horizontal Pod Autoscaler (HPA), which adds more pod replicas based on CPU/memory or custom metrics, and Vertical Pod Autoscaler (VPA), which adjusts the CPU and memory *requests* of individual pods based on observed usage — they address different dimensions of the scaling problem.

*   **GKE Node Pools:** Because the RAD UI deploys GKE Autopilot, node management is hidden. You must practice creating a GKE Standard cluster via the console to understand how to add, resize, and upgrade Node Pools manually. Note that GKE Autopilot (as used by App GKE) is often the preferred choice for production workloads because Google manages node security, scaling, and upgrades automatically — understanding Standard clusters is important for the exam, but Autopilot represents the operational best practice.

---

## 3.2 Managing storage and database solutions

### Managing and securing objects in Cloud Storage buckets
**In the RAD UI:**
The App CloudRun and App GKE modules provision GCS buckets via the `storage_buckets` variable. For the exam, you must also understand the operational and security controls available on those buckets.

**Console Exploration:**
Navigate to **Cloud Storage > Buckets**. Click into a bucket and explore:
- **Permissions tab:** View IAM bindings on the bucket. Practice granting `roles/storage.objectViewer` to a service account. Understand the difference between **uniform bucket-level access** (IAM-only, recommended) and **fine-grained access** (legacy ACLs per object).
- **Protection tab:** Enable **Versioning** (keeps previous versions of overwritten or deleted objects) and **Retention policies** (prevents objects from being deleted before the retention period expires — useful for compliance).
- **Lifecycle tab:** Configure transitions between storage classes and deletion rules (see below).

### 💡 Additional Storage & Database Management Objectives & Learning Guidelines
The ACE exam focuses heavily on object lifecycle management, data backup, querying, and cost management across the full range of Google Cloud database services.

*   **Cloud Storage Object Lifecycle Management:** Navigate to **Cloud Storage > Buckets**. Practice creating a Lifecycle rule on a bucket to transition objects to Nearline storage after 30 days, and Coldline after 90 days.

    > **Real-World Example:** A media company stores video uploads in a Standard storage bucket for immediate access. After 30 days, objects are automatically transitioned to Nearline (for occasional access at reduced cost), then to Coldline at 90 days, and finally deleted at 365 days. This lifecycle policy cuts long-term storage costs by over 80% compared to leaving all objects in Standard storage indefinitely.

*   **Database Backups and Restore:** The exam covers backup and restore for multiple database services:
    - **Cloud SQL:** Navigate to **SQL > Backups**. Practice creating an on-demand backup and restoring an instance from a backup. Understand point-in-time recovery (PITR) — restore to any second within the backup retention window (up to 35 days), critical for recovering from accidental data deletion.
    - **AlloyDB:** Navigate to **AlloyDB > Clusters > Backups**. AlloyDB provides continuous backup with a 14-day PITR window. Restore creates a new cluster.
    - **Spanner:** Navigate to **Spanner > &lt;instance&gt; > Backups**. Spanner backups are taken while the database remains online and fully operational.
    - **Firestore:** Navigate to **Firestore > Import/Export**. Practice scheduling exports to a GCS bucket using `gcloud firestore export gs://bucket-name`. Imports restore from a previously exported snapshot.
    - **Bigtable:** Navigate to **Bigtable > &lt;instance&gt; > Backups**. Bigtable backups are copies of table data at a point in time, stored within the Bigtable service.

*   **Executing queries to retrieve data from data instances:** The exam tests basic query execution across multiple database products:
    - **Cloud SQL:** Use Cloud Shell — `gcloud sql connect <instance-name> --user=postgres` — then run standard SQL queries.
    - **BigQuery:** Navigate to **BigQuery > Explorer**, select a table, click **Query**, and run standard SQL. BigQuery estimates the bytes scanned before execution — this is how you **estimate query cost** before running.
    - **Bigtable:** Use the `cbt` CLI tool in Cloud Shell — `cbt read <table-name>` — or the Bigtable Studio in the console.
    - **Spanner:** Navigate to **Spanner > &lt;instance&gt; > &lt;database&gt; > Spanner Studio** to run SQL queries directly in the console.
    - **Firestore:** Navigate to **Firestore > Data** to browse collections and documents.
    - **AlloyDB:** Use Cloud Shell with a PostgreSQL client — `gcloud alloydb instances connect <name>` — then run standard SQL.

*   **Estimating costs of data storage resources:** Navigate to the **Google Cloud Pricing Calculator** (search "Pricing Calculator" in the console or `cloud.google.com/products/calculator`) to estimate costs before provisioning. Key levers:
    - **Cloud Storage:** Cost depends on storage class, bytes stored, and retrieval/operation fees.
    - **Cloud SQL:** Cost depends on vCPUs, memory, storage, HA configuration, and network egress.
    - **BigQuery:** Storage cost is per TB/month. Query cost is per TB of data scanned (with on-demand pricing) — use the query dry-run feature (`bq query --dry_run`) to estimate query cost before execution.
    - **GKE Autopilot:** Billed per pod vCPU and memory request per second.

*   **Reviewing job status (Dataflow, BigQuery):**
    - **Dataflow:** Navigate to **Dataflow > Jobs**. Each job shows its current state (Running, Succeeded, Failed), a real-time graph of pipeline stages, throughput metrics, and error logs. Failed jobs display the specific step and error message.
    - **BigQuery:** Navigate to **BigQuery > Job history** (personal or project-level) to see all queries run in the project, their duration, bytes processed, and status. Failed jobs include the error message. Use `bq ls -j` in Cloud Shell to list jobs.

*   **Using Database Center to manage the Google Cloud database fleet:** Database Center is a unified dashboard for managing and monitoring all Google Cloud databases (Cloud SQL, AlloyDB, Spanner, Bigtable, Firestore, Memorystore) within a project or fleet. Navigate to **Database Center** in the console to see a consolidated view of database health, security posture, and recommended actions (such as enabling backups or applying security patches). Database Center surfaces insights from Security Command Center and Recommender to flag databases that are not following best practices.

    > **Real-World Example:** A platform team manages 12 Cloud SQL instances and 3 Spanner databases across multiple projects. Rather than navigating to each service individually, they open Database Center to see a unified health dashboard showing which instances have backups disabled, which are approaching storage capacity, and which have recently failed over — all in a single view.

*   **Storage Transfer Service:** Review the **Storage Transfer > Storage Transfer Service** console. Practice configuring a transfer job to move data between two GCS buckets (for example, from a source project to a backup project in a different region), or to schedule recurring transfers that keep a disaster recovery bucket in sync with your primary bucket. Storage Transfer Service handles large-scale data movement with checksums and retry logic that would be impractical with manual `gcloud storage cp` commands.

---

## 3.3 Managing networking resources

### Adding a subnet to an existing VPC and expanding IP ranges
**Concept:** Extending the network capacity of a VPC to accommodate new workloads or additional regions without disrupting existing resources.

**In the RAD UI (Services GCP):**
The `availability_regions` variable provisions subnets in each listed region. Adding a new region re-runs the module and creates the additional subnet without disturbing existing subnets. For the exam, you must also understand how to perform these operations manually.

**Console Exploration and Practice:**
- **Adding a subnet:** Navigate to **VPC network > VPC networks**, select your VPC, and click **Add subnet**. Specify the region, name, and primary CIDR range. The subnet is available immediately.
- **Expanding a subnet's IP range:** Select an existing subnet and click **Edit**. Expand the primary IPv4 range to a larger CIDR that is a superset of the current range (e.g. `/24` → `/23`). Note that you cannot shrink a CIDR range — expansions are permanent. Secondary IP ranges (used for GKE pods and services) can also be expanded here.
- **Command line:** `gcloud compute networks subnets expand-ip-range <subnet-name> --region=<region> --prefix-length=<new-prefix>`

**Real-world example:** A rapidly growing application team exhausts their `/24` subnet (256 addresses) as new VMs and pods are added. The network administrator expands the subnet's primary range to `/22` (1024 addresses) with a single console edit — existing resources retain their IPs, new resources can be assigned from the expanded range, and no downtime is required.

### Reserving static external and internal IP addresses
**Concept:** Holding a specific IP address for a resource so it persists if the resource is deleted or recreated.

**In the RAD UI:**
The App CloudRun and App GKE modules provision a global static IP address for the load balancer (used for DNS configuration). For the exam, understand the general pattern.

**Console Exploration:**
Navigate to **VPC network > IP addresses**. Practice:
- **Reserving a static external IP:** Click **Reserve external static address**, select regional or global scope, and note that global IPs are required for Global External Application Load Balancers (Premium Tier). Use `gcloud compute addresses create <name> --region=<region>` or `--global`.
- **Reserving a static internal IP:** Select **Internal** type, choose the VPC and subnet, and optionally specify the exact IP within the subnet range. Static internal IPs are useful for resources that other services reference by IP (e.g. a database that must always be reachable at the same address).

### Adding custom static routes in a VPC
**Concept:** Directing traffic to specific destinations via custom next hops — for example, routing all traffic to an on-premises network through a VPN gateway.

**Console Exploration:**
Navigate to **VPC network > Routes**. Review the system-generated default routes (internet gateway, internal subnet routes). Practice adding a custom static route:
- Specify a **destination IP range** (e.g. `10.100.0.0/24` for an on-premises subnet).
- Specify a **next hop** (a VPN gateway, a VM instance acting as a router, or a VPC peering connection).
- Set a **priority** — lower number wins if multiple routes match the same destination.

**Real-world example:** A company connects its GCP VPC to an on-premises network via HA VPN. After the VPN tunnels are established, a custom static route is added with destination `192.168.0.0/16` (on-premises CIDR) and next hop set to the VPN gateway. GCP VMs automatically route traffic destined for on-premises addresses through the VPN tunnel rather than attempting to reach them via the internet.

### 💡 Additional Networking Management Objectives & Learning Guidelines

*   **VPC Firewall Rules and Cloud NGFW Policies:** In the RAD UI, network security is handled at the application layer (Cloud Armor, GKE Network Policies). For the exam, practice creating standard VPC firewall rules under **VPC network > Firewall rules**. Understand priority (lower number = higher priority), source/destination filters, and network tags. Cloud NGFW Firewall Policies (covered in Section 2.3) extend this with hierarchical enforcement.

    > **Real-World Example:** A web application runs on Compute Engine VMs tagged `web-server`. A firewall rule allows TCP port 443 from `0.0.0.0/0` (all internet) to targets with the `web-server` tag, while a separate rule allows TCP 5432 (PostgreSQL) from the subnet CIDR to targets tagged `db-server`. This tag-based approach means adding a new VM to either tier is as simple as assigning the right tag — no IP-based rule updates are needed.

*   **Cloud DNS:** Practice creating Public and Private managed zones under **Network services > Cloud DNS**. Add A, CNAME, and TXT records. Private zones are particularly important — they resolve internal hostnames only within your VPC, enabling services to reference each other by name (e.g. `api.internal.example.com`) rather than by potentially-changing IP addresses.

*   **VPC Peering:** Practice connecting two separate custom-mode VPCs using VPC Network Peering under **VPC network > VPC network peering**. Understand that VPC peering is non-transitive — if VPC A peers with VPC B and VPC B peers with VPC C, VPC A cannot reach VPC C through that chain. This is a common exam scenario.

---

## 3.4 Monitoring and logging

### Creating Cloud Monitoring alerts based on resource metrics
**Concept:** Proactively identifying and reacting to system degradation before users report issues.

**In the RAD UI:**
*   **Threshold-Based Alerts:** Both modules automatically provision synthetic uptime checks. They create threshold-based alert policies tailored to the platform using the `support_users` (Group 1) variable for notification channels. Cloud Run alerts on high latency (p95), CPU starvation, and 5xx errors. GKE alerts on pod restart loops (CrashLoopBackOff), unschedulable pods, CPU/memory usage per container, and high latency.
*   **Infrastructure Alerts:** In `Services GCP`, `alert_cpu_threshold` (Group 17), `alert_memory_threshold` (Group 17), and `alert_disk_threshold` (Group 17) configure host-level alerts for managed databases and file systems.

**Console Exploration:**
Navigate to **Monitoring > Alerting** in the GCP Console. Review the generated alert policies. Click into a policy to view the specific condition. Next, go to **Monitoring > Uptime checks** to see the synthetic monitoring. Finally, check **Monitoring > Dashboards** to view the custom operational dashboards provisioned for holistic visibility.

### Configuring Cloud Monitoring custom metrics and log-based metrics
**Concept:** Creating metrics beyond the built-in GCP metrics to surface application-specific signals.

**In the RAD UI:**
The RAD platform provisions alert policies based on built-in metrics (Cloud Run latency, GKE CPU, etc.). For the exam, you must also understand how to create custom metrics.

**Console Exploration:**
- **Log-Based Metrics:** In **Logging > Logs Explorer**, construct a filter that matches specific log entries (e.g. `resource.type="cloud_run_revision" AND textPayload:"payment_declined"`). Click **Create metric** to define a counter metric that increments each time a matching log line appears. This metric is then available in Cloud Monitoring to create alert policies.
- **Custom Metrics via API/OpenTelemetry:** Applications can write custom metrics to Cloud Monitoring using the Monitoring API or OpenTelemetry. Navigate to **Monitoring > Metrics explorer** and filter by `custom.googleapis.com/` to see any custom metrics your application emits.

### Configuring log buckets, log analytics, and log routers

**Concept:** Controlling where logs are stored, how long they are retained, and what analyses can be performed on them.

Cloud Logging routes log entries through the **Log Router**, which evaluates each log entry against **sinks**. Each sink has an inclusion filter and writes matching entries to a destination. Destinations include:
- **Cloud Logging log buckets** (within Cloud Logging, with configurable retention)
- **Cloud Storage buckets** (for low-cost archival)
- **BigQuery datasets** (for SQL-based log analytics)
- **Pub/Sub topics** (for streaming to external systems)

Navigate to **Logging > Log router** to view the default `_Default` and `_Required` sinks. The `_Required` sink captures Admin Activity and System Event audit logs and cannot be disabled. The `_Default` sink captures everything else with a 30-day retention.

**Log Buckets with Log Analytics:** Navigate to **Logging > Logs storage** to view log buckets. Create a custom log bucket with a longer retention period (up to 3650 days). Enable **Log Analytics** on the bucket to allow SQL queries against the log data using the **Log Analytics** view in the console — this provides BigQuery-compatible querying without exporting the data.

**Real-world example:** A compliance requirement mandates that all Admin Activity audit logs be retained for 7 years. The team creates a custom log bucket with a 2557-day (7-year) retention policy and a locked retention period (prevents early deletion). A log sink routes `cloudaudit.googleapis.com/activity` logs to this bucket. The `_Required` sink continues to exist for the 400-day default — the custom sink provides the extended retention without disrupting normal log access.

### 💡 Additional Observability Objectives & Learning Guidelines
The ACE exam requires hands-on familiarity with the full observability stack — logging, metrics, tracing, profiling, and diagnostics tools.

*   **Cloud Logging — Viewing and filtering logs:** Navigate to **Logging > Logs Explorer**. Practice using the query syntax to filter logs:
    - By resource: `resource.type="cloud_run_revision"`
    - By severity: `severity>=ERROR`
    - By time range: Use the time picker to scope the search.
    - By log name: `logName="projects/<project>/logs/cloudaudit.googleapis.com%2Factivity"`
    Click **View fields** to browse available log fields for a resource type. Use **Refine scope** to search across multiple projects. View a specific log entry by clicking on it to expand the full JSON payload.

*   **Exporting logs to external systems:** Logs can be exported from the Log Router to on-premises SIEM tools by routing to a Pub/Sub topic, then consuming the topic via Pub/Sub pull subscriptions from an on-premises connector. Navigate to **Logging > Log router > Create sink**, set the destination to a Pub/Sub topic, and configure an inclusion filter to scope which logs are exported. For BigQuery export specifically, enabling **Log Analytics** on a log bucket (see above) is the simpler approach.

*   **Configuring audit logs:** Data Access audit logs (who read what data) are not enabled by default. Navigate to **IAM & Admin > Audit logs** and enable Data Access logging for specific services (e.g. `Cloud SQL Admin API`, `BigQuery`) by selecting the log types (Admin Read, Data Read, Data Write). Admin Activity logs are always on. Configure audit logs to be exported to a long-retention sink for compliance.

*   **Using Gemini Cloud Assist for Cloud Monitoring:** In **Cloud Monitoring**, click the Gemini icon in the top navigation to open Cloud Assist. Ask natural-language questions about your monitoring data — for example, "Which Cloud Run services have the highest p95 latency this week?" or "Show me all alert policies that fired in the last 24 hours." Gemini can also help write MQL (Monitoring Query Language) expressions for alert conditions.

*   **Cloud Trace:** Navigate to **Trace > Trace explorer** to visualise end-to-end request latency across microservices. Cloud Trace automatically collects traces from Cloud Run and GKE workloads when the application emits OpenTelemetry-compatible spans. The trace list shows request duration, service name, and number of spans — click on a trace to see the waterfall view of each individual span's latency contribution.

*   **Cloud Profiler:** Navigate to **Profiler** to analyse CPU and memory consumption at the function level inside running applications. Profiler uses statistical sampling — it adds minimal overhead (under 1%) while collecting flame graphs showing which functions consume the most CPU or memory. It supports Go, Java, Node.js, Python, and Ruby runtimes. Profiler is particularly useful for identifying performance bottlenecks in long-running Cloud Run services or GKE workloads.

    > **Real-World Example:** A Cloud Run service that processes API requests is exhibiting consistently high CPU usage, causing frequent autoscaling. An engineer enables Cloud Profiler by adding the Profiler library to the application. After an hour, the flame graph reveals that 40% of CPU time is spent in a JSON serialisation function that is called on every request — the team replaces it with a faster library, reducing CPU usage by 35% and halving the instance count.

*   **Query Insights (Cloud SQL):** Navigate to **SQL > &lt;instance&gt; > Query insights** to identify slow queries, high-load queries, and query plans for PostgreSQL instances. Query Insights shows:
    - Top queries ranked by total execution time.
    - The query plan (EXPLAIN ANALYZE output) for any selected query.
    - The application tags and database user associated with each query pattern.
    This is the first tool to reach for when a Cloud SQL database is exhibiting high CPU or slow response times.

    > **Real-World Example:** A Cloud SQL PostgreSQL instance's CPU utilisation has risen from 20% to 80% after a recent deployment. Query Insights reveals that a new query performing a full table scan on the `orders` table is now running 5000 times per minute. The index advisor (available within Query Insights) recommends adding a composite index on `(customer_id, created_at)` — after the index is applied, the query execution time drops from 2.3 seconds to 8 milliseconds, and CPU returns to 22%.

*   **Personalized Service Health dashboard:** Navigate to **Home > Service Health** (or search for "Service Health") to view the operational status of all Google Cloud services. The Personalized Service Health dashboard filters the global GCP status page to show only the services and regions used in your project — so instead of scanning 100+ service status entries, you see only the 8–12 services relevant to your deployment. Configure email notifications for service disruptions in regions you depend on.

*   **Configuring and deploying Ops Agent:** The **Ops Agent** is the recommended unified agent for collecting logs and metrics from Compute Engine VMs. It replaces the older Stackdriver Logging and Monitoring agents. Install it on a VM by running the agent install script (available in **Monitoring > Settings > Agent installation instructions** or via the VM's Observability tab), or automate installation fleet-wide using **VM Manager OS Configuration policies**. The Ops Agent collects system metrics (CPU, disk, memory, network), application logs from standard log paths, and can be configured to scrape Prometheus-format metrics endpoints.

*   **Google Cloud Managed Service for Prometheus:** Navigate to **Monitoring > Managed Prometheus** to explore the fully managed Prometheus-compatible metrics service. GKE Autopilot (as used by App GKE) supports Managed Service for Prometheus out of the box — enable it by setting `enableManagedPrometheus: true` in the GKE cluster configuration. Once enabled, applications that expose Prometheus-format metrics endpoints are automatically scraped and their metrics are queryable via PromQL in the Monitoring console. This avoids the need to operate a self-managed Prometheus deployment.

    > **Real-World Example:** A GKE application exposes a `/metrics` endpoint in Prometheus format (tracking queue depth, request rates, and database pool usage). After enabling Managed Service for Prometheus on the cluster, these custom metrics appear in Cloud Monitoring within minutes — the team creates Cloud Monitoring alert policies using PromQL conditions, and the metrics feed into Grafana dashboards via the Managed Prometheus query API.

*   **Active Assist — resource utilisation optimisation:** Navigate to **Recommender** (search "Recommender" in the console) or view recommendations inline in the relevant service pages. Active Assist continuously analyses your GCP usage and surfaces actionable recommendations including:
    - **Idle VM recommendations:** VMs with low CPU/memory usage that may be candidates for deletion or resizing.
    - **Overprovisioned VM recommendations:** VMs where the machine type could be downsized based on actual usage.
    - **Unused IP address recommendations:** Reserved static IPs not attached to any resource.
    - **IAM role recommendations (policy insights):** IAM bindings where the granted role includes permissions not used in the past 90 days.
    Recommendations are classified by type and include estimated monthly cost savings.
