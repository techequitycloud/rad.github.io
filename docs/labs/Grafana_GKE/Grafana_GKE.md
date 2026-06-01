---
title: "Grafana on GKE Autopilot — Overview"
sidebar_label: "Grafana GKE"
---

# Grafana on GKE Autopilot — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Grafana_GKE)**

## What is Grafana?

Grafana is the world's leading open-source observability and analytics platform, used by 10M+ users at organizations including NASA, CERN, Goldman Sachs, and thousands of engineering teams. It provides unified dashboards, alerting, and visualization for metrics, logs, and traces from over 100 data sources — including Prometheus, BigQuery, Cloud SQL, Elasticsearch, and more.

## Module Summary

`Grafana_GKE` deploys Grafana on Google Kubernetes Engine (GKE) Autopilot with:

- **Cloud SQL PostgreSQL 15** as the Grafana application database
- **GKE Autopilot** Deployment (or StatefulSet for local data persistence) with Horizontal Pod Autoscaling
- **StatefulSet support** with PVC mount at `/var/lib/grafana` and `fsGroup = 472` (Grafana's UID/GID)
- **GCS Fuse** and optional **NFS** for shared plugins and dashboards across pods
- **Workload Identity** for secure GCP API access
- **IAP** (with OAuth 2.0), **Cloud Armor**, and **Binary Authorization** support

## Key Characteristics

| Property | Value |
|---|---|
| Platform | GKE Autopilot |
| Container port | 3000 |
| Default version | 11.4.0 |
| Database | PostgreSQL 15 (required) |
| Default CPU | 1 vCPU |
| Default memory | 2 Gi |
| Min replicas | 1 (configurable) |
| Max replicas | 5 (configurable) |
| Health endpoint | `/api/health` |
| Session affinity | None (configurable) |
| Credit cost | 150 |
| Module dependency | Services_GCP |

## Architecture

```
Internet
    │
    ▼
[GKE LoadBalancer Service]
    │
    ▼
[Kubernetes Deployment: Grafana pods]
    │                   │
    ▼                   ▼
[Cloud SQL Auth Proxy]  [GCS Fuse / NFS Volume]
    │
    ▼
[Cloud SQL PostgreSQL 15]
    (dashboards, users, orgs, alerts)
```

## StatefulSet vs Deployment

Use `workload_type = 'StatefulSet'` with `stateful_pvc_enabled = true` when you want Grafana to persist plugins and data in Kubernetes-native PVCs instead of (or in addition to) an external GCS bucket or NFS mount. The module sets `stateful_fs_group = 472` (Grafana's UID/GID) automatically so the container can write to PVC-mounted directories.

Use `workload_type = 'Deployment'` (the default) when using Cloud SQL for all persistence and GCS Fuse or NFS for file storage.

## PostgreSQL Requirement

The GKE module, like the Cloud Run variant, automatically injects `GF_DATABASE_TYPE=postgres`. SQLite is not safe for multi-pod Kubernetes deployments.

## Getting Started

See the [Lab Guide](../Grafana_GKE_Lab/Grafana_GKE_Lab.md) for step-by-step deployment instructions.

See the [Configuration Guide](../../modules/Grafana_GKE/Grafana_GKE.md) for a complete variable reference.

## Common Configuration Examples

### Production deployment with StatefulSet

```hcl
project_id              = "my-project-123"
tenant_deployment_id    = "prod"
workload_type           = "StatefulSet"
stateful_pvc_enabled    = true
stateful_pvc_size       = "20Gi"
stateful_pvc_mount_path = "/var/lib/grafana"
stateful_fs_group       = 472
min_instance_count      = 2
enable_topology_spread  = true
```

### With IAP

```hcl
enable_iap              = true
iap_oauth_client_id     = "..."
iap_oauth_client_secret = "..."
iap_support_email       = "platform@example.com"
iap_authorized_groups   = ["group:platform-team@example.com"]
```

### With custom domain and Cloud Armor

```hcl
enable_custom_domain     = true
application_domains      = ["grafana.example.com"]
reserve_static_ip        = true
enable_cloud_armor       = true
cloud_armor_policy_name  = "default-waf-policy"
```
