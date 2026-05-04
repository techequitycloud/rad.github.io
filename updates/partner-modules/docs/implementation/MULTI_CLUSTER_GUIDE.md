# Multi-Cluster GKE Deployment Guide

## Overview

The Services_GCP module now supports deploying multiple GKE Autopilot clusters with Istio service mesh for high availability, disaster recovery, and geographic distribution of workloads.

### Key Features

- **2-10 GKE Clusters**: Deploy multiple clusters in a single region
- **Dual Control Plane**: Each cluster runs its own Istiod for resilience
- **Fleet Mesh**: Automatic cross-cluster service discovery via GKE Fleet
- **Multi-Cluster Ingress**: Unified ingress across all clusters
- **Automatic CIDR Allocation**: No manual subnet planning required
- **100% Backward Compatible**: Single-cluster mode remains the default

---

## Architecture

### Network Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                     Shared VPC Network                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐│
│  │   Cluster-1      │  │   Cluster-2      │  │   Cluster-N   ││
│  │ 10.128.0.0/20    │  │ 10.144.0.0/20    │  │ 10.X.0.0/20   ││
│  │                  │  │                  │  │               ││
│  │ Pods: /14        │  │ Pods: /14        │  │ Pods: /14     ││
│  │ Svcs: /20        │  │ Svcs: /20        │  │ Svcs: /20     ││
│  │                  │  │                  │  │               ││
│  │ Istiod Instance  │  │ Istiod Instance  │  │ Istiod       ││
│  │ East-West GW     │  │ East-West GW     │  │ East-West GW ││
│  └─────────┬────────┘  └────────┬─────────┘  └───────┬───────┘│
│            │                    │                    │         │
│            └────────────────────┼────────────────────┘         │
│                    Fleet-based Service Discovery               │
│                         (Automatic mTLS)                        │
└─────────────────────────────────────────────────────────────────┘
```

### Service Mesh Architecture

- **Multi-Primary Model**: Each cluster has its own control plane (Istiod)
- **Cross-Cluster Discovery**: Services automatically discover endpoints in all clusters
- **East-West Gateways**: Automatic mTLS between clusters via Istio gateways
- **Certificate Management**: Centralized CA via GCP Certificate Authority Service

---

## Requirements

### Multi-Cluster Prerequisites

**⚠️ IMPORTANT:** Multi-cluster deployments require the following:

1. **Cloud Service Mesh** must be enabled (`configure_cloud_service_mesh = true`)
   - Required for Fleet Hub membership registration
   - Required for Multi-Cluster Ingress (MCI) functionality
   - Enables cross-cluster service discovery and mTLS

2. **Cluster Count**: 2-10 clusters (`gke_cluster_count >= 2`)

3. **GKE APIs**: The following APIs will be automatically enabled:
   - `container.googleapis.com` (GKE)
   - `gkehub.googleapis.com` (Fleet Hub)
   - `mesh.googleapis.com` (Cloud Service Mesh)
   - `multiclusteringress.googleapis.com` (MCI)

### Single-Cluster Deployments

For single-cluster deployments (`gke_cluster_count = 1`), Cloud Service Mesh is optional but recommended for service mesh features.

---

## Configuration

### Basic Multi-Cluster Setup (2 Clusters)

```hcl
module "services_gcp" {
  source = "./modules/Services_GCP"

  existing_project_id             = "my-project-id"
  create_google_kubernetes_engine = true

  # Multi-cluster configuration (mode is auto-detected from count)
  gke_cluster_count               = 2        # Number of clusters (>1 = multi-cluster mode)
  gke_cluster_name_prefix         = "prod"   # Cluster naming: prod-1, prod-2

  # Enable service mesh
  configure_cloud_service_mesh    = true

  # Optional: specify config cluster for MCI (default: 1)
  gke_multi_cluster_ingress_config_cluster = 1
}
```

**Output:**
- Cluster names: `prod-1`, `prod-2`
- Subnets: `10.128.0.0/20`, `10.144.0.0/20`
- Pod ranges: `10.64.0.0/14`, `10.68.0.0/14`
- Service ranges: `10.8.0.0/20`, `10.8.16.0/20`

### Advanced Multi-Cluster Setup (5 Clusters)

```hcl
module "services_gcp" {
  source = "./modules/Services_GCP"

  existing_project_id             = "my-project-id"
  create_google_kubernetes_engine = true

  gke_cluster_mode                = "multi"
  gke_cluster_count               = 5
  gke_cluster_name_prefix         = "mesh"

  # Custom CIDR bases (optional)
  gke_subnet_base_cidr            = "10.128.0.0/12"
  gke_pod_base_cidr               = "10.64.0.0/10"
  gke_service_base_cidr           = "10.8.0.0/16"

  configure_cloud_service_mesh    = true
  configure_config_management     = true
  configure_policy_controller     = true
}
```

### Single Cluster Mode

```hcl
module "services_gcp" {
  source = "./modules/Services_GCP"

  existing_project_id             = "my-project-id"
  create_google_kubernetes_engine = true

  # Single cluster mode (count = 1, automatically detected)
  gke_cluster_count               = 1
  gke_cluster_name_prefix         = "gke-cluster"

  # Uses base CIDR calculation (cluster-1 gets first range)
  # Defaults:
  # - Nodes:    10.128.0.0/20 (from gke_subnet_base_cidr)
  # - Pods:     10.64.0.0/14  (from gke_pod_base_cidr)
  # - Services: 10.8.0.0/20   (from gke_service_base_cidr)
}
```

---

## Deploying Applications

### App_GKE Module Integration

#### Explicit Cluster Selection

Deploy to a specific cluster:

```hcl
module "frontend_app" {
  source = "./modules/App_GKE"

  existing_project_id         = "my-project-id"
  gke_cluster_name            = "prod-1"  # Deploy to cluster 1
  gke_cluster_selection_mode  = "explicit"

  application_name            = "frontend"
  enable_multi_cluster_service = true  # Enable MCS for cross-cluster discovery
}

module "backend_app" {
  source = "./modules/App_GKE"

  existing_project_id         = "my-project-id"
  gke_cluster_name            = "prod-2"  # Deploy to cluster 2
  gke_cluster_selection_mode  = "explicit"

  application_name            = "backend"
  enable_multi_cluster_service = true
}
```

#### Primary Cluster Deployment

Always deploy to the first cluster:

```hcl
module "admin_app" {
  source = "./modules/App_GKE"

  existing_project_id         = "my-project-id"
  gke_cluster_selection_mode  = "primary"  # Always use first cluster

  application_name            = "admin-panel"
}
```

#### Round-Robin Distribution

Automatically distribute across clusters:

```hcl
module "worker_app" {
  source = "./modules/App_GKE"

  existing_project_id         = "my-project-id"
  gke_cluster_selection_mode  = "round-robin"  # Distribute automatically

  application_name            = "worker"
  enable_multi_cluster_service = true
}
```

---

## Migration from Single to Multi-Cluster

### Pre-Migration Checklist

- [ ] Backup all application data and configurations
- [ ] Document current cluster name and namespace mappings
- [ ] Verify sufficient project quotas (clusters, subnets, IPs)
- [ ] Plan downtime window (30-60 minutes recommended)
- [ ] Review CIDR allocations to avoid conflicts

### Migration Steps

#### Step 1: Update Services_GCP Configuration

```hcl
# Before (single cluster)
module "services_gcp" {
  gke_cluster_count               = 1  # Single cluster (default)
  google_kubernetes_engine_server = "my-cluster"
}

# After (multi-cluster)
module "services_gcp" {
  gke_cluster_count               = 3  # Multi-cluster mode (>1 clusters)
  gke_cluster_name_prefix         = "my-cluster"
  configure_cloud_service_mesh    = true  # Required for multi-cluster
}
```

#### Step 2: Apply Infrastructure Changes

```bash
cd /path/to/terraform/services_gcp

# Review planned changes
terraform plan -out=migration.tfplan

# Expected changes:
# - Create N-1 new clusters (e.g., 2 more for total of 3)
# - Create new subnets for additional clusters
# - Configure Fleet mesh
# - Add firewall rules for Istio
# - Maintain existing cluster (becomes cluster-1)

# Apply changes
terraform apply migration.tfplan
```

#### Step 3: Validate Multi-Cluster Setup

```bash
# Run validation script
./modules/Services_GCP/scripts/validate-multi-cluster.sh \
  my-project-id \
  us-central1 \
  3  # Expected number of clusters

# Verify Fleet membership
gcloud container fleet memberships list --project=my-project-id

# Verify Service Mesh
gcloud container fleet mesh describe --project=my-project-id
```

#### Step 4: Update Application Deployments

```hcl
# Update App_GKE modules to target specific clusters
module "app" {
  gke_cluster_name            = "my-cluster-1"  # Updated name
  gke_cluster_selection_mode  = "explicit"
  enable_multi_cluster_service = true
}
```

#### Step 5: Verify Cross-Cluster Communication

```bash
# Get credentials for cluster-1
gcloud container clusters get-credentials my-cluster-1 \
  --region=us-central1 \
  --project=my-project-id

# Test cross-cluster service discovery
kubectl exec -it <pod-name> -- \
  curl http://<service-name>.<namespace>.svc.cluster.local

# Service should resolve to endpoints in ALL clusters
kubectl get endpointslices -A | grep <service-name>
```

### Rollback Procedure

If issues occur during migration:

```hcl
# Revert to single cluster mode
module "services_gcp" {
  gke_cluster_count = 1  # Back to single cluster
}

# Apply rollback
terraform apply

# This will:
# - Destroy additional clusters (cluster-2, cluster-3, etc.)
# - Remove multi-cluster firewall rules
# - Disable Fleet mesh
# - Revert to original single cluster
```

---

## CIDR Allocation

### Automatic Allocation (Multi-Cluster Mode)

Clusters automatically receive non-overlapping CIDR ranges:

| Cluster | Subnet CIDR    | Pod CIDR       | Service CIDR |
|---------|----------------|----------------|--------------|
| 1       | 10.128.0.0/20  | 10.64.0.0/14   | 10.8.0.0/20  |
| 2       | 10.144.0.0/20  | 10.68.0.0/14   | 10.8.16.0/20 |
| 3       | 10.160.0.0/20  | 10.72.0.0/14   | 10.8.32.0/20 |
| 4       | 10.176.0.0/20  | 10.76.0.0/14   | 10.8.48.0/20 |
| 5       | 10.192.0.0/20  | 10.80.0.0/14   | 10.8.64.0/20 |

### Custom Base CIDRs

Override default bases if needed:

```hcl
gke_subnet_base_cidr    = "10.200.0.0/12"  # Subnets: 10.200+N*16.0.0/20
gke_pod_base_cidr       = "10.64.0.0/10"   # Pods: cidrsubnet with /4 increments
gke_service_base_cidr   = "10.128.0.0/16"  # Services: cidrsubnet with /4 increments
```

---

## Troubleshooting

### Cluster Not Joining Fleet

**Symptom:** Cluster created but not appearing in Fleet memberships

**Solution:**
```bash
# Check Fleet membership status
gcloud container fleet memberships describe <cluster-name> \
  --project=<project-id>

# Manually register if needed
gcloud container fleet memberships register <cluster-name> \
  --gke-cluster=<region>/<cluster-name> \
  --project=<project-id>
```

### Service Mesh Not Installing

**Symptom:** Fleet mesh shows "PROVISIONING" indefinitely

**Solution:**
```bash
# Check mesh status
gcloud container fleet mesh describe --project=<project-id>

# View detailed status per cluster
gcloud container fleet mesh describe \
  --project=<project-id> \
  --format="value(membershipStates)"

# Common issues:
# - Insufficient IAM permissions: Grant gkehub.serviceAgent role
# - API not enabled: Enable mesh.googleapis.com
```

### Cross-Cluster Communication Failing

**Symptom:** Services in cluster-1 cannot reach services in cluster-2

**Solution:**
```bash
# Verify firewall rules
gcloud compute firewall-rules list \
  --project=<project-id> \
  --filter="name~istio"

# Check east-west gateway
kubectl get service istio-eastwestgateway -n istio-system

# Verify service export
kubectl get serviceexport <service-name> -n <namespace>
```

### CIDR Conflicts

**Symptom:** Terraform error about overlapping CIDR ranges

**Solution:**
```hcl
# Adjust base CIDRs to avoid conflicts
gke_subnet_base_cidr = "10.200.0.0/12"  # Use different range

# Or reduce cluster count
gke_cluster_count = 3  # Reduce from 5 to 3
```

---

## Best Practices

### Cluster Count

- **2-3 Clusters**: Optimal for high availability in single region
- **4-5 Clusters**: Advanced geo-distribution scenarios
- **6+ Clusters**: Consider regional/multi-region architecture instead

### Application Distribution

- **Stateless Apps**: Deploy across all clusters for HA
- **Stateful Apps**: Deploy to specific cluster(s) with persistent storage
- **Critical Services**: Use primary cluster for centralized management

### Resource Management

- **Quotas**: Request increased quotas before deploying 5+ clusters
  - Clusters: Default 40 per region
  - Subnets: Default 100 per network
  - Firewall Rules: Default 100 per network

### Security

- **Binary Authorization**: Enable for all clusters in production
- **Workload Identity**: Required for secure pod-to-service authentication
- **VPC Service Controls**: Consider for sensitive workloads

---

## Outputs Reference

### Legacy Outputs (Backward Compatible)

| Output | Description |
|--------|-------------|
| `gke_cluster_name` | Name of primary cluster (cluster-1 in multi mode) |
| `gke_cluster_endpoint` | Endpoint of primary cluster |
| `gke_cluster_ca_certificate` | CA cert of primary cluster (sensitive) |
| `gke_cluster_location` | Region of clusters |
| `gke_service_account_email` | GKE service account email |

### Multi-Cluster Outputs

| Output | Description |
|--------|-------------|
| `gke_cluster_mode` | Current mode: "single" or "multi" |
| `gke_clusters` | Map of all cluster details (sensitive) |
| `gke_mci_config_cluster` | Name of Multi-Cluster Ingress config cluster |
| `gke_fleet_membership_ids` | List of Fleet membership IDs |

### Example Output Access

```hcl
# Access primary cluster (backward compatible)
output "primary_endpoint" {
  value = module.services_gcp.gke_cluster_endpoint
}

# Access all clusters (multi mode)
output "all_clusters" {
  value = module.services_gcp.gke_clusters
  # Returns:
  # {
  #   "cluster-1" = {
  #     name = "cluster-1"
  #     endpoint = "https://..."
  #     ca_cert = "..."
  #     location = "us-central1"
  #     subnet_cidr = "10.128.0.0/20"
  #     pod_cidr = "10.64.0.0/14"
  #     service_cidr = "10.8.0.0/20"
  #     cluster_index = 1
  #   }
  #   "cluster-2" = { ... }
  # }
}

# Get MCI config cluster
output "ingress_cluster" {
  value = module.services_gcp.gke_mci_config_cluster
}
```

---

## Support

For issues or questions:

1. **Validation Failures**: Run `validate-multi-cluster.sh` script first
2. **GitHub Issues**: https://github.com/techequitycloud/partner-modules/issues
3. **Documentation**: Review GKEAPP.md and GCP_SERVICES.md

---

## Changelog

### Version 1.0.0 (2025-02-15)

- Initial multi-cluster support (2-10 clusters)
- Dual control plane Istio mesh
- Fleet-based service discovery
- Multi-Cluster Ingress support
- Automatic CIDR allocation
- Backward compatible with single-cluster mode
