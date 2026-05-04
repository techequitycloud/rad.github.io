# Modernization Implementation Plan

This document outlines the assessment and implementation plan for modernizing the `App_GKE` and `App_CloudRun` modules based on enterprise requirements.

## 1. Feature Assessment & Prioritization Matrix

The following table categorizes the requested features by priority (based on business value/risk) and implementation complexity.

| Feature | Priority | Complexity | Module(s) Impacted | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Backup for GKE** | **High (Critical)** | High | `App_GKE`, `Services_GCP` | Implement immediately for DR compliance. Requires new `backup_plan` resources. |
| **CMEK (KMS Encryption)** | **High (Critical)** | Moderate | `App_GKE`, `App_CloudRun`, `Services_GCP` | Implement for data sovereignty/compliance. Requires Key Rings + IAM updates. |
| **Database Read Replicas** | **High (Scale)** | Low | `Services_GCP` | **Quick Win**. Enable via `google_sql_database_instance` replica block. |
| **Private Service Connect (PSC)** | **High (Network)** | Moderate | `App_GKE`, `App_CloudRun` | Implement to simplify cross-project networking. |
| **Audit Logging** | **High (Security)** | Low | `Services_GCP` | **Quick Win**. Enable `audit_config` in project/folder IAM. |
| **Cloud Armor for Cloud Run** | **Medium** | Moderate | `App_CloudRun` | Copy pattern from `App_GKE` to protect public endpoints. |
| **PDB + Topology Spread** | **Medium** | Low | `App_GKE` | **Quick Win**. Add to Deployment/StatefulSet manifests. |
| **Cloud Run Traffic Splitting** | **Medium** | Low | `App_CloudRun` | **Quick Win**. Expose traffic block in `google_cloud_run_v2_service`. |
| **Secret Rotation** | **Medium** | High | `App_GKE`, `App_CloudRun` | Implement using Cloud Functions for rotation. |
| **Container Scanning** | **Medium** | Low | `Services_GCP`, `App_GKE` | Enable Container Analysis API and vulnerability scanning on Artifact Registry. |
| **Workload Identity Federation** | **Low** | Moderate | `App_GKE`, `App_CloudRun` | Implement for GitHub/GitLab integration without keys. |
| **Multi-region Deployment** | **Low** | High | `App_GKE`, `App_CloudRun` | Complex state management. Defer until specific requirement arises. |
| **GKE Usage Metering** | **Low** | Low | `Services_GCP` | Enable `resource_usage_export_config` for BigQuery export if cost allocation is insufficient. |

---

## 2. Implementation Roadmap

### Phase 1: Quick Wins & Critical Security (Weeks 1-2)
*Focus: deliver immediate value with low effort and address critical compliance gaps.*

1.  **Database Read Replicas (`Services_GCP`)**
    *   **Action**: Update `modules/Services_GCP/mysql.tf` and `pgsql.tf` to accept a `replica_count` variable.
    *   **Benefit**: Immediate High Availability and read scaling.
    *   **Effort**: Low.

2.  **Pod Disruption Budgets & Topology Spread (`App_GKE`)**
    *   **Action**: Add `kubernetes_pod_disruption_budget` resource and `topologySpreadConstraints` to `deployment.tf`.
    *   **Benefit**: Prevents outages during node upgrades/drains.
    *   **Effort**: Low.

3.  **Cloud Run Traffic Splitting (`App_CloudRun`)**
    *   **Action**: Add `traffic` block to `google_cloud_run_v2_service` in `service.tf`, controlled by a variable map.
    *   **Benefit**: Enables canary deployments without Cloud Deploy complexity.
    *   **Effort**: Low.

4.  **Audit Logging (`Services_GCP`)**
    *   **Action**: Add `google_project_iam_audit_config` resource to enable Data Access logs for key services (KMS, SQL, etc.).
    *   **Benefit**: Compliance and security visibility.
    *   **Effort**: Low.

5.  **Enable Container Vulnerability Scanning (`Services_GCP`)**
    *   **Action**: Ensure `Container Analysis API` is enabled and Artifact Registry repositories have scanning configured.
    *   **Benefit**: Security visibility into supply chain.
    *   **Effort**: Low.

### Phase 2: Advanced Security & Networking (Weeks 3-4)
*Focus: Harden the environment with enterprise-grade security features.*

6.  **Cloud Armor WAF for Cloud Run (`App_CloudRun`)**
    *   **Action**: Port the Cloud Armor logic from `App_GKE` to `App_CloudRun`. Create `google_compute_security_policy` and attach via `ingress` or backend service.
    *   **Benefit**: DDoS protection and WAF rules.

7.  **Private Service Connect (PSC) (`App_GKE`, `App_CloudRun`)**
    *   **Action**: Add `google_compute_service_attachment` for exposing services and `google_compute_forwarding_rule` for consuming them.
    *   **Benefit**: Secure, private connectivity between VPCs without peering.

8.  **CMEK Implementation (`All Modules`)**
    *   **Action**: Add `encryption_key_name` variables to Storage, SQL, and Artifact Registry resources. Create Key Rings in `Services_GCP`.
    *   **Benefit**: Data sovereignty and regulatory compliance.

### Phase 3: Disaster Recovery & Operations (Weeks 5-6)
*Focus: Resilience and long-term maintainability.*

9.  **Backup for GKE (`App_GKE`)**
    *   **Action**: Implement `google_gke_backup_backup_plan` and `google_gke_backup_restore_plan`.
    *   **Benefit**: Disaster recovery for stateful workloads.

10. **Secret Rotation (`App_GKE`, `App_CloudRun`)**
    *   **Action**: Implement Secret Manager rotation schedules and rotation functions.
    *   **Benefit**: Reduced credential compromise risk.

---

## 3. Technical Implementation Details

### A. Database Read Replicas (Services_GCP)
Modify `modules/Services_GCP/mysql.tf` (and `pgsql.tf`) to include a replica block based on a new variable `read_replica_count`.

```hcl
resource "google_sql_database_instance" "read_replica" {
  count               = var.read_replica_count
  name                = "${local.name}-replica-${count.index}"
  master_instance_name = google_sql_database_instance.master.name
  # ... configuration ...
}
```

### B. Pod Disruption Budgets (App_GKE)
Add `kubernetes_pod_disruption_budget_v1` resource in `modules/App_GKE/deployment.tf`.

```hcl
resource "kubernetes_pod_disruption_budget_v1" "app_pdb" {
  metadata { name = local.service_name }
  spec {
    min_available = 1
    selector { match_labels = local.selector_labels }
  }
}
```

### C. Cloud Run Traffic Splitting (App_CloudRun)
Update `google_cloud_run_v2_service` in `modules/App_CloudRun/service.tf` to support traffic splitting.

```hcl
dynamic "traffic" {
  for_each = var.traffic_split
  content {
    type    = traffic.value.type
    percent = traffic.value.percent
    tag     = traffic.value.tag
  }
}
```

### D. Backup for GKE (App_GKE)
Enable `Backup for GKE` API and create a backup plan.

```hcl
resource "google_gke_backup_backup_plan" "basic" {
  name     = "${local.cluster_name}-daily-backup"
  cluster  = local.cluster_id
  location = local.region
  retention_policy {
    backup_delete_lock_days = 30
    backup_retain_days      = 90
  }
  backup_schedule {
    cron_schedule = "0 3 * * *"
  }
  backup_config {
    include_volume_data = true
    include_secrets     = true
    all_namespaces      = true
  }
}
```
