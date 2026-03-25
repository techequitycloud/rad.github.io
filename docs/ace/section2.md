# Planning and implementing a cloud solution
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section2.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/ace_section2.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/ace_section2.pdf)

This guide is designed to help candidates preparing for the Google Cloud Associate Cloud Engineer (ACE) certification. It focuses specifically on Section 2 of the exam guide (which covers ~17.5% of the exam) by walking you through how these concepts are practically implemented using the platform deployment portal. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 2.1 Planning and implementing compute resources

### Deploying to compute platforms
**Concept:** Utilizing managed, scalable environments for containerized applications based on the workload profile.
*   **Cloud Run (Serverless):** The specific deployment option\'s primary function is deploying to Cloud Run. Review the configuration options in the deployment portal, specifically the Cloud Run service configuration. Notice configurations for the Gen2 execution environment (better Linux compatibility), container resource limits for managing CPU/memory, `enable_startup_cpu_boost` to reduce cold starts, and `use_http2` for faster multiplexed connections.
*   **Google Kubernetes Engine (GKE):** The application deployment deploys to an existing Kubernetes cluster. Review the configuration options in the deployment portal. Notice how Kubernetes Deployments is used for stateless applications (like web frontends), while Kubernetes StatefulSets is used for applications requiring stable network identities or persistent storage (often tied to Persistent Volume Claims).
*   **Exploration:** In the GCP Console, navigate to **Cloud Run** or **Kubernetes Engine > Workloads**. Select your deployed service/deployment and review the configuration details. For Cloud Run, inspect the "Revisions" tab to see execution environment, memory/CPU, and concurrency limits. For GKE, inspect the "YAML" definition of the pod to see requested resources, limits, and mapped volumes.

### Selecting appropriate compute choices
**Concept:** Understanding when to use serverless solutions versus Kubernetes clusters.
*   **Serverless vs. Containers:** The dual implementation contrasts Cloud Run with GKE. Cloud Run is ideal for stateless HTTP workloads, background jobs, and event-driven processing where scaling to zero is desirable and operational overhead needs to be zero. GKE is selected when you need fine-grained control over networking (Network Policies), specialized hardware (GPUs), daemonsets, stateful workloads (StatefulSets), or multi-container orchestrations running concurrently on the same nodes.
*   **Exploration:** Consider the application deployed. In Cloud Run, there are no underlying node pools to manage. In GKE, navigate to **Kubernetes Engine > Clusters > Nodes** to see the managed node pools the workloads schedule onto.

---

## 2.2 Planning and implementing storage and data solutions

### Choosing and deploying storage products
**Concept:** Integrating distinct storage classes for different application needs (objects vs. files).
*   **Cloud Storage (GCS):** The platform dynamically provision GCS buckets for application use via the storage settings in the deployment portal. Review the volume mount configurations (the deployment configuration in Cloud Run, the deployment configuration in GKE) to see how GCS buckets can be mounted directly into containers using GCS Fuse CSI drivers.
*   **Cloud Filestore (NFS) / Persistent Volumes (GKE):** If persistent, shared file storage is required, Cloud Run mounts Cloud Filestore via the NFS settings in the deployment portal. In GKE, Persistent Volume Claims (PVCs) are natively utilized in the deployment configuration or the deployment configuration relying on the cluster's default storage classes (like `standard-rwo` or `premium-rwo`).
*   **Exploration:** Navigate to **Cloud Storage > Buckets** to see the provisioned buckets. If NFS is enabled, navigate to **Filestore** to view the managed NFS instance. For GKE, go to **Kubernetes Engine > Storage** to view the PVCs and the dynamically provisioned Persistent Disks bound to them.

### Choosing and deploying data products
**Concept:** Selecting managed database and caching services for stateful application requirements.
*   **Cloud SQL:** The platform integrates natively with Cloud SQL (MySQL, PostgreSQL, SQL Server). Review the configuration options in the deployment portal (Cloud Run) or the deployment configuration (GKE) to see how the Cloud SQL Auth Proxy sidecar (`enable_cloudsql_volume`) is configured to provide secure Unix socket connections to the database without exposing it publicly.
*   **Memorystore (Redis):** The `enable_redis` variable configures a connection to Memorystore for low-latency application caching, injecting the host and port dynamically via environment variables.
*   **Exploration:** Navigate to **SQL** and **Memorystore** in the GCP Console to review the managed instances.

---

## 2.3 Planning and implementing networking resources

### Establishing network connectivity
**Concept:** Securely connecting applications to resources within a private Virtual Private Cloud (VPC) and securing pod-to-pod communication.
*   **Direct VPC Egress (Cloud Run):** The application deployment uses Direct VPC Egress (`vpc_egress_setting` in the deployment configuration) to communicate securely with internal resources like Cloud SQL and Memorystore using internal IPs.
*   **Network Policies (GKE):** The application deployment defines a Kubernetes network policies in the deployment configuration to restrict internal cluster traffic (e.g., denying ingress from all namespaces except the Gateway API or specific whitelisted pods), demonstrating defense-in-depth networking inside the cluster.
*   **Exploration:** In the Cloud Run console, navigate to the **Networking** tab to verify VPC network egress. For GKE, check the application's YAML or navigate to the command line to describe the applied NetworkPolicies.

### Choosing and deploying load balancers
**Concept:** Distributing global traffic, terminating SSL, and providing edge security.
*   **Global Load Balancing (Cloud Run):** When `enable_cloud_armor` is active, the `App_CloudRun` deployment provisions a Global External Application Load Balancer (the deployment configuration) using Serverless Network Endpoint Groups (NEGs).
*   **Gateway API & Ingress (GKE):** The application deployment configures routing using Kubernetes manifests for the Kubernetes Gateway API (the deployment configuration) or standard Ingress (the deployment configuration), mapping external traffic (often an external L7 Load Balancer) to internal Services, and applying Cloud Armor security policies directly to the BackendConfigs.
*   **Exploration:** Navigate to **Network Services > Load balancing**. Inspect the Frontend and Backend configurations. Notice how the load balancer handles incoming HTTPS requests and routes them to the Serverless NEG (Cloud Run) or the GKE Node Ports / Zonal NEGs (GKE).

---

## 2.4 Planning and implementing resources through infrastructure as code

### Infrastructure as code tooling
**Concept:** Managing cloud infrastructure declaratively using standard tools.
*   **the platform Expertise:** The entire solution is built in the platform, providing a comprehensive, real-world example of managing complex GCP infrastructure as code. This covers writing configuration, managing state, using deployments, and understanding provider authentication—a core skill heavily tested on the ACE exam.
*   **Exploration:** Review the structure of the deployment files (the deployment configuration, the deployment configuration, the deployment configuration). Notice how inputs (variables) drive the dynamic creation of resources across both Cloud Run and GKE, and how outputs expose critical information (like the Load Balancer IP) for downstream consumption.
