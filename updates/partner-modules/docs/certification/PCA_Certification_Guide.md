# App_CloudRun Module & The Professional Cloud Architect (PCA) Certification

This document outlines how the `modules/App_CloudRun` module supports candidates preparing for the Google Cloud Professional Cloud Architect (PCA) certification. The module provides practical, hands-on exposure to deploying, designing, and managing enterprise solutions on Google Cloud, aligning with the core domains of the PCA exam guide.

The PCA exam tests a deep understanding of cloud architecture and Google Cloud technologies. This guide walks through each domain and maps specific module features, variables, and Terraform resources to the corresponding exam topics.

---

## Section 1: Designing and planning a cloud solution architecture (~25% of the exam)

### 1.1 Designing a cloud solution infrastructure that meets business requirements
*   **Security and compliance**: The module uses Identity-Aware Proxy (`enable_iap`) for secure remote access, Cloud Armor (`enable_cloud_armor`) for WAF, and Secret Manager (`secrets.tf`) for encryption and secret management.
*   **Cost optimization**: Configurable `min_instance_count` and `max_instance_count` variables allow tuning the autoscaling of Cloud Run, demonstrating serverless cost control and resource optimization.
*   **Observability**: Integrated monitoring (`monitoring.tf`) and dashboard creation (`dashboard.tf`) demonstrate how business requirements for observability are implemented using Cloud Monitoring and Logging.

### 1.2 Designing a cloud solution infrastructure that meets technical requirements
*   **High availability and fail-over design**: Deploying Cloud Run to multiple regions behind a Global External Application Load Balancer (`security.tf`) illustrates a high-availability design.
*   **Scalability to meet growth requirements**: The module configures Cloud Run autoscaling natively, handling growth requirements seamlessly without provisioning underlying VMs.
*   **Backup and recovery**: The module automates database backups using Cloud Scheduler and Cloud Run Jobs (`backup_schedule`), exporting them to Cloud Storage for reliable recovery strategies.

### 1.3 Designing network, storage, and compute resources
*   **Cloud-native networking**: The module implements Direct VPC Egress for secure internal connectivity without external IP addresses, mapping directly to container networking and VPC design.
*   **Choosing appropriate storage types**: It provisions Cloud SQL for relational databases, Cloud Storage for object storage, and Filestore for NFS/file storage (`enable_nfs`), covering multiple storage requirements.
*   **Mapping compute needs to platform products**: Focusing on Cloud Run demonstrates a deep understanding of serverless compute and its appropriate use cases vs. Compute Engine or GKE.

---

## Section 2: Managing and provisioning a cloud solution infrastructure (~17.5% of the exam)

### 2.1 Configuring network topologies
*   **Security protection**: Cloud Armor WAF policies (`security.tf`) protect against OWASP Top 10 vulnerabilities, while VPC firewall tags manage internal access control.
*   **VPC design and load balancing**: Setting up a Global External Application Load Balancer for global access and SSL management demonstrates advanced load balancing configurations.

### 2.2 Configuring individual storage systems
*   **Data retention and lifecycle management**: The `storage_buckets` variable manages Cloud Storage lifecycle rules, automating data transition to cheaper storage classes over time.
*   **Data protection**: Database backup jobs (`backup_uri`) and automatic Secret Manager rotation pipelines secure data and credentials against loss or compromise.

### 2.3 Configuring compute systems
*   **Compute resource provisioning**: Terraform provisions all compute resources, demonstrating Infrastructure as Code (IaC) principles.
*   **Serverless computing**: The module extensively uses Cloud Run, the premier serverless computing platform on Google Cloud, and Eventarc for event-driven serverless architectures.

---

## Section 3: Designing for security and compliance (~17.5% of the exam)

### 3.1 Designing for security
*   **Identity and Access Management (IAM)**: Fine-grained IAM bindings (`iam.tf`) restrict service accounts (`cloud_run_sa`, `cloud_build_sa`) to the principle of least privilege.
*   **Data security**: Integrating Secret Manager (`secrets.tf`) ensures that sensitive data like passwords and API keys are protected and rotated automatically.
*   **Secure remote access**: Identity-Aware Proxy (`iap.tf`) controls access to the deployed application based on user identity, avoiding open firewall ports.
*   **Securing software supply chain**: Binary Authorization (`enable_binary_authorization`) ensures only signed and verified container images are deployed to production.

---

## Section 4: Analyzing and optimizing technical and business processes (~15% of the exam)

### 4.1 Analyzing and defining technical processes
*   **Continuous integration/continuous deployment**: The module creates CI/CD pipelines using Cloud Build (`trigger.tf`) and Cloud Deploy (`skaffold.tf`), demonstrating modern SDLC automation.
*   **Disaster recovery**: Automated Cloud SQL backup schedules and GCS lifecycle rules implement critical disaster recovery processes.

### 4.2 Analyzing and defining business processes
*   **Cost optimization/resource optimization (CapEx/OpEx)**: Managing Cloud Run instance limits and storage classes directly translates to controlling operational expenses (OpEx).

---

## Section 5: Managing implementation (~12.5% of the exam)

### 5.1 Advising development and operation teams to ensure the successful deployment of the solution
*   **Application and infrastructure deployment**: The module's comprehensive use of Terraform and Cloud Deploy guides teams in standardized, automated deployment strategies.

### 5.2 Interacting with Google Cloud programmatically
*   **Infrastructure as Code (IaC)**: The entire deployment is managed via Terraform, demonstrating how to interact with Google Cloud programmatically to provision and manage resources at scale.

---

## Section 6: Ensuring solution and operations excellence (~12.5% of the exam)

### 6.1 Understanding the principles and recommendations of the operational excellence
*   The module embodies the Well-Architected Framework's operational excellence pillar through automated deployments, IaC, and integrated monitoring.

### 6.2 Familiarity with Google Cloud Observability solutions
*   **Monitoring and logging**: The module provisions dashboards (`dashboard.tf`) and alerting policies (`monitoring.tf`), ensuring deep visibility into the system's operational health.
*   **Alerting strategies**: Threshold-based alerts for HTTP 5xx errors, CPU, and memory utilization demonstrate robust operational monitoring.

### 6.3 Deployment and release management
*   **Release management**: Cloud Deploy (`skaffold.tf`) and traffic splitting in Cloud Run enable progressive rollouts and canary deployments, critical for reliable release management.
