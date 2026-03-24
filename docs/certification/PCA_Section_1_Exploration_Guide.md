# PCA Certification Preparation Guide: Exploring Section 1 (Designing & Planning a Cloud Solution Architecture)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification. It focuses specifically on Section 1 of the exam guide (which covers ~25% of the exam) by walking you through how these concepts are practically implemented in the provided Terraform codebases (`modules/App_CloudRun` and `modules/App_GKE`). Both modules rely on a common base (`App_GCP`) while showcasing differing compute strategies. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 1.1 Designing a cloud solution infrastructure that meets business requirements

### Security and Compliance
**Concept:** Ensuring the architecture meets strict organizational security policies, zero-trust remote access, and secrets protection.
*   **Identity-Aware Proxy (IAP):** Review the `enable_iap` variable and the `iap.tf` configuration. In the GCP Console, navigate to **Security > Identity-Aware Proxy**. Notice how IAP protects both Cloud Run and GKE applications by verifying user identity and context before allowing requests to reach the service, avoiding open firewall ports.
*   **Cloud Armor (WAF):** Review the `security.tf` file where a `google_compute_security_policy` (OWASP Top 10 + DDoS protection) is attached to the backend service (via Backend Service for Cloud Run, or via a Gateway/Ingress for GKE). In the GCP Console, go to **Network Security > Cloud Armor** to inspect the rules evaluated at the edge.
*   **Secret Manager:** Examine `secrets.tf`. It automates database password rotation and securely maps references to Cloud Run instances and Kubernetes secrets (`kubernetes_secret_v1`) instead of plaintext values. In the Console, view **Security > Secret Manager** to see how environment variables resolve at runtime.
*   **Micro-segmentation (GKE):** In the `App_GKE` module, review `network_policy.tf` which uses `kubernetes_network_policy_v1` to isolate namespace traffic, satisfying zero-trust internal network requirements.

### Cost Optimization
**Concept:** Mapping capacity to demand automatically to avoid paying for idle resources (OpEx optimization).
*   **Serverless Autoscaling (Cloud Run):** Look at the variables `min_instance_count` and `max_instance_count` in `variables.tf`. Setting `min_instance_count = 0` enables scale-to-zero, drastically reducing costs during idle periods.
*   **Pod Autoscaling (GKE):** In the `App_GKE` module, review `gkeapp.tf` for Horizontal Pod Autoscaling (HPA) and Vertical Pod Autoscaling (VPA) (`kubernetes_horizontal_pod_autoscaler_v2`, `kubernetes_manifest`), which dynamically scale pods based on CPU/memory utilization to optimize resource consumption.
*   **Exploration:** In the GCP Console, navigate to **Cloud Run**, select the service, and review the **Revisions** tab. For GKE, navigate to **Kubernetes Engine > Workloads** to see HPA and VPA scaling behaviors.

### Observability
**Concept:** Meeting business requirements for monitoring health, performance, and uptime to ensure service level objectives (SLOs) are maintained.
*   **Integrated Monitoring & Logging:** Check out `monitoring.tf` and `dashboard.tf`. The module automatically creates Custom Alert Policies for CPU, memory, and HTTP 5xx errors.
*   **Exploration:** In the Console, navigate to **Monitoring > Dashboards** and view the custom Cloud Run dashboard to see visualized metrics like Request Count and Latency (p95).

---

## 1.2 Designing a cloud solution infrastructure that meets technical requirements

### High Availability and Fail-over Design
**Concept:** Designing resilient systems that withstand regional or zonal failures.
*   **Global Load Balancing:** Explore `security.tf` to see how a Global External Application Load Balancer is deployed. For Cloud Run, this uses a Serverless NEG. For GKE, `gateway.tf` provisions a GKE Gateway API resource (`Gateway` and `HTTPRoute`) to route external traffic to the cluster.
*   **Pod Disruption Budgets (GKE):** Review `pdb.tf` in the `App_GKE` module. It uses `kubernetes_pod_disruption_budget_v1` to ensure a minimum number of replicas are always available during voluntary disruptions (like node upgrades), guaranteeing high availability.
*   **Exploration:** Navigate to **Network Services > Load balancing** in the Console. Inspect the Frontend and Backend service configurations. For GKE, check **Kubernetes Engine > Gateways, Services & Ingress**.

### Scalability to Meet Growth Requirements
**Concept:** Architecting for seamless traffic spikes without manual intervention.
*   **Cloud Run Architecture:** Because the application is deployed on Cloud Run (a fully managed serverless platform), it scales instances horizontally without needing underlying VM node pools configured. Review the concurrency limits in `variables.tf`.
*   **GKE Architecture:** GKE handles scalability via Node Auto-provisioning (in Autopilot) or Cluster Autoscaler, combined with HPA at the pod level.

### Backup and Recovery
**Concept:** Guaranteeing Recovery Point Objectives (RPO) and Recovery Time Objectives (RTO).
*   **Automated Jobs & Cloud Scheduler:** Examine `jobs.tf` to see how `google_cloud_run_v2_job.backup_export_job` and `google_cloud_scheduler_job.backup_schedule` are configured.
*   **Exploration:** In the Console, go to **Cloud Scheduler** to see the cron configuration (e.g., `0 2 * * *`), and **Cloud Run > Jobs** to see the containerized execution that streams database backups securely to Cloud Storage.

---

## 1.3 Designing network, storage, and compute resources

### Cloud-Native Networking
**Concept:** Connecting managed compute to internal resources securely.
*   **Serverless VPC Access & GKE Networking:** Review `vpc_egress_setting` in `variables.tf` for Cloud Run Direct VPC Egress. In `App_GKE`, review `network.tf` to understand how GKE clusters utilize Alias IPs (VPC-native routing) to natively route pod traffic within the VPC without NAT.
*   **Exploration:** Check the Cloud Run service's **Networking** tab in the Console. For GKE, check **Kubernetes Engine > Clusters** and view the "Networking" settings to see VPC-native configuration.

### Choosing Appropriate Storage Types
**Concept:** Selecting purpose-built storage based on structured/unstructured data and latency needs.
*   **Cloud SQL (Relational):** Check `database_type` in `variables.tf` for structured relational data.
*   **Cloud Storage (Object Storage):** Look at the `storage_buckets` variable, configured with lifecycle rules.
*   **Filestore (File/NFS Storage):** Review `enable_nfs` and `nfs_mount_path`.
*   **Exploration:** Visit **Filestore** and **SQL** in the GCP Console to see how different storage tiers and options match differing technical constraints (e.g., shared file caches vs ACID transactions).

### Mapping Compute Needs to Platform Products
**Concept:** Justifying the selection of Serverless over Kubernetes, or vice versa.
*   **Cloud Run vs. GKE:** Review `cloudrunapp.tf` alongside `App_GKE`'s `gkeapp.tf` and `deployment.tf`. Cloud Run favors low operational overhead and rapid scaling from zero for HTTP/event-driven workloads. GKE favors complex orchestrations, background processing without request timeouts, granular network policies, and persistent long-running state (using StatefulSets in `statefulset.tf`). Understanding when to use which is central to PCA exam scenarios.