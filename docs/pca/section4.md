# Analyzing and optimizing technical and business processes
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section4.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pca_section4.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pca_section4.pdf)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification. It focuses specifically on Section 4 of the exam guide (which covers ~15% of the exam) by walking you through how these concepts are practically implemented using the platform deployment portal. By exploring the Google Cloud Platform (GCP) console and corresponding code, you will gain hands-on context for these critical architectural topics.

---

## 4.1 Analyzing and defining technical processes

### Continuous Integration / Continuous Deployment (CI/CD)
**Concept:** Automating the Software Development Life Cycle (SDLC) to enable frequent, reliable, and secure deployments.
*   **Cloud Build & Cloud Deploy:** Review the configuration options in the deployment portal to see how a Cloud Build GitHub trigger is created to automatically build container images. Review the configuration options in the deployment portal to understand how Google Cloud Deploy pipelines manage progressive rollouts across environment stages. This is consistent across both Cloud Run and GKE targets.
*   **Exploration:** In the GCP Console, navigate to **Cloud Build > Triggers** to inspect the configuration. Then, navigate to **Cloud Deploy > Delivery pipelines** to visualize the progression of a release through target environments (Serverless or Kubernetes).

### Disaster Recovery
**Concept:** Designing technical processes to restore business operations swiftly following critical failures or data loss events.
*   **Automated Backups and Data Archival:** Review the configuration options in the deployment portal (and the deployment configuration in GKE) to examine how automated Cloud SQL backup schedules are orchestrated. In GKE, Kubernetes `CronJob` resources handle these recurring tasks natively. Additionally, analyze the deployment configuration to see how GCS lifecycle rules automate data retention.
*   **Exploration:** Navigate to **Cloud Scheduler** or **Kubernetes Engine > Workloads** (for CronJobs) in the Console to view scheduled database exports. Check **Cloud Storage > Buckets** to view lifecycle rules applied to the backup bucket.

---

## 4.2 Analyzing and defining business processes

### Cost Optimization / Resource Optimization (CapEx vs. OpEx)
**Concept:** Shifting from capital expenditure (CapEx) to operational expenditure (OpEx) while strictly controlling ongoing cloud run rates and avoiding resource waste.
*   **Managing Instance Limits & Storage Classes:** Review the minimum and maximum instance count settings in the deployment portal. In Cloud Run, this prevents runaway scaling costs. In GKE, HPA and VPA (the deployment configuration) ensure pods consume only necessary resources, which in turn optimizes underlying Node Auto-provisioning costs.
*   **Exploration:** In the GCP Console, navigate to **Cloud Run** to verify scaling limits. For GKE, review **Kubernetes Engine > Clusters > Nodes** to observe cluster autoscaling. Visit **Billing > Reports** to see how these limits translate directly into predictable OpEx.