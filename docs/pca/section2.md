# Managing and provisioning a cloud solution infrastructure
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section2.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section2.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pca_section2.pdf)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification. It focuses specifically on Section 2 of the exam guide (which covers ~17.5% of the exam) by walking you through how these concepts are practically implemented using the platform deployment portal. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 2.1 Configuring network topologies

### Security Protection
**Concept:** Implementing in-depth defense mechanisms to safeguard workloads from common web exploits and control internal traffic flow.
*   **Cloud Armor WAF Policies:** Review the configuration options in the deployment portal where Cloud Armor security policy resources are defined. This implements protection against OWASP Top 10 vulnerabilities (like SQL injection and cross-site scripting) and mitigates DDoS attacks.
*   **VPC Firewall Tags & Network Policies:** While reviewing the network configuration, notice how VPC tags (the deployment configuration in GKE) map to backend resources to enforce strict internal access control at the VM/node level. Additionally, review the deployment configuration in `App_GKE` which enforces zero-trust micro-segmentation inside the cluster at the pod level using Dataplane V2.
*   **Exploration:** In the GCP Console, navigate to **Network Security > Cloud Armor**. Inspect the applied policies. Go to **VPC network > Firewall** to examine the rules created using network tags.

### VPC Design and Load Balancing
**Concept:** Designing global and highly available network architectures capable of intelligently distributing traffic and managing encrypted sessions.
*   **Global External Application Load Balancer:** Explore the deployment configuration (and the deployment configuration in `App_GKE`) to see how the platform provisions a global load balancer to provide a single, global IP address for users. Cloud Run uses Serverless NEGs, while GKE uses the Gateway API (`Gateway` and `HTTPRoute` resources) to configure native Kubernetes load balancing.
*   **SSL Management:** Notice how Certificate Manager or Google-managed SSL certificates handle TLS termination securely at the edge before traffic is forwarded internally.
*   **Exploration:** Navigate to **Network Services > Load balancing** in the Console. Review the load balancer's frontend configurations (HTTPS, IPs, certificates) and backend services.

---

## 2.2 Configuring individual storage systems

### Data Retention and Lifecycle Management
**Concept:** Automating data governance to comply with retention policies while optimizing storage costs over time.
*   **Storage Buckets Configuration:** Look at the `storage_buckets` variable in the deployment configuration. This configuration defines Cloud Storage lifecycle rules, instructing GCP to automatically transition older objects to cheaper storage classes (like Nearline, Coldline, or Archive) or delete them entirely after a set period.
*   **Exploration:** In the GCP Console, navigate to **Cloud Storage > Buckets**. Select a provisioned bucket and click the **Lifecycle** tab to see the applied data transition rules.

### Data Protection
**Concept:** Ensuring data durability and securing sensitive configuration credentials against loss or compromise.
*   **Database Backup Jobs:** Review the `backup_uri` configurations in the deployment configuration (and the deployment configuration in GKE). Automated Cloud Run jobs or Kubernetes CronJobs stream database backups to securely managed storage, ensuring point-in-time recovery capabilities.
*   **Persistent Volumes (GKE):** In `App_GKE`, examine the deployment configuration which uses StatefulSets and PersistentVolumeClaims (PVCs) for stateful applications, ensuring persistent data is not lost during pod rescheduling. GCS FUSE CSI driver is also used to mount buckets natively as volumes.
*   **Secret Manager Rotation:** Review the configuration options in the deployment portal and the `enable_auto_password_rotation` configurations, which leverage automated pipelines to proactively rotate credentials.
*   **Exploration:** Visit **Cloud Scheduler** or **Kubernetes Engine > Workloads** in the Console to see the frequency of backup execution. Additionally, visit **Security > Secret Manager** and look at the "Rotation" settings on provisioned secrets.

---

## 2.3 Configuring compute systems

### Compute Resource Provisioning
**Concept:** Deploying infrastructure reliably and repeatedly using declarative models.
*   **Infrastructure as Code (IaC):** The entire deployment demonstrates IaC principles by provisioning everything (networks, load balancers, databases, storage, compute) via the platform. This approach reduces manual configuration errors and creates a reproducible infrastructure lifecycle.
*   **Exploration:** Look at the overarching the platform structure (the deployment configuration, the deployment configuration, etc.). Understanding the dependency mapping (e.g., using `depends_on`) is critical for PCA scenarios involving automated infrastructure orchestration.

### Serverless and Container Computing
**Concept:** Deploying managed compute platforms tailored to application needs, from fully serverless scaling to orchestrated container clusters.
*   **Cloud Run:** The deployment uses `google_cloud_run_v2_service` for serverless, event-driven HTTP workloads scaling from zero.
*   **Google Kubernetes Engine (GKE):** The application deployment leverages Kubernetes (the deployment configuration, the deployment configuration) running on GKE (typically Autopilot). This manages complex application lifecycles, background processing, and StatefulSets that require persistent storage and consistent network identities.
*   **Eventarc for Event-Driven Architectures:** Review how Secret Manager rotation triggers are handled via Eventarc.
*   **Exploration:** In the GCP Console, navigate to **Cloud Run** and **Kubernetes Engine > Clusters** to compare the deployment paradigms and scaling behaviors of both platforms.