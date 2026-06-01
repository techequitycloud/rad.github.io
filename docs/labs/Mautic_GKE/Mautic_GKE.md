---
title: "Mautic on GKE Autopilot — Overview"
sidebar_label: "Mautic GKE"
---

# Mautic on GKE Autopilot — Overview

📖 **[Full Configuration Reference](https://docs.radmodules.dev/docs/modules/Mautic_GKE)**

## What Is Mautic?

[Mautic](https://www.mautic.org/) is the world's leading open-source marketing automation platform with over 200,000 deployments globally. It provides a self-hosted alternative to HubSpot and Marketo — offering email marketing, multi-channel campaign automation, contact management, lead scoring, and CRM integration without per-contact subscription fees.

## What `Mautic_GKE` Deploys

`Mautic_GKE` is a fully managed Terraform module that deploys production-ready Mautic on Google Kubernetes Engine (GKE) Autopilot. It provisions:

- **GKE Autopilot** Deployment/StatefulSet with Cloud SQL Auth Proxy sidecar
- **Cloud SQL MySQL 8.0** instance, database, and user (Mautic requires MySQL)
- **Cloud Filestore (NFS)** for shared media storage across pod replicas
- **GCS `mautic-media` bucket** provisioned by `Mautic_Common`
- **Secret Manager** secrets: admin password, database password, and root password
- **Artifact Registry** repository and Cloud Build custom image pipeline
- **Kubernetes Service** (LoadBalancer) with optional static IP and Ingress for custom domains
- **HPA** (Horizontal Pod Autoscaler) with configurable min/max replicas
- **PodDisruptionBudget** for zero-downtime updates
- **Cloud Monitoring** uptime checks and alert policies
- **Automated backup** Kubernetes CronJob (daily by default)
- **Redis** caching backend (uses NFS server IP by default)

## Architecture

```
Internet
    │
    ├─ (optional) Cloud Armor WAF
    │       │
    │  GKE Ingress / LoadBalancer Service
    │       │
    └─ GKE Autopilot Pods (HPA-managed)
            ├── Mautic/Apache container (port 80)
            │       DOCKER_MAUTIC_RUN_MIGRATIONS=true
            │       Session affinity: ClientIP
            └── Cloud SQL Auth Proxy sidecar (/cloudsql socket)
                        │
                Cloud SQL MySQL 8.0
                        │
                NFS (shared media files)
                        │
                Redis (caching)
```

## Key Differences from Mautic_CloudRun

| Feature | Mautic_CloudRun | Mautic_GKE |
|---|---|---|
| Compute | Cloud Run v2 | GKE Autopilot |
| Scaling | Cloud Run autoscaling | HPA (Kubernetes) |
| IAP | Native Cloud Run | Requires OAuth credentials |
| Health probes | TCP startup (avoids redirect) | HTTP `/index.php/s/login` |
| Session affinity | N/A (stateless) | `ClientIP` (sticky sessions) |
| Persistent storage | NFS + GCS Fuse | NFS + GCS Fuse + StatefulSet PVC option |
| Cron jobs | Cloud Scheduler + Cloud Run Jobs | Kubernetes CronJobs |
| Cost | Per request (serverless) | Per pod (always-on) |

## Key Defaults

| Setting | Default | Notes |
|---|---|---|
| Database | MySQL 8.0 | Fixed — Mautic does not support PostgreSQL |
| Container port | 80 | Mautic/Apache |
| Min replicas | 1 | Always-on for campaign processing |
| Max replicas | 5 | HPA ceiling |
| CPU | 2 vCPU | Minimum recommended for Mautic |
| Memory | 4 Gi | Recommended for production |
| Session affinity | ClientIP | Sticky sessions for PHP sessions |
| NFS | enabled | Shared media storage |
| Redis | enabled | Caching backend |

## Validation Guards

`Mautic_GKE` enforces the following at plan time:
- `min_instance_count` must not exceed `max_instance_count`
- When `enable_redis = true` and `redis_host = ""`, `enable_nfs` must be `true`
- When `enable_iap = true`, both OAuth credentials must be provided
- When `enable_cloudsql_volume = true`, `database_type` must not be `"NONE"`

## Module Dependencies

`Mautic_GKE` requires `Services_GCP` to be deployed first. `Services_GCP` provisions:
- VPC network and subnets
- GKE Autopilot cluster
- Cloud SQL MySQL instance (shared)
- Cloud Filestore NFS server (shared)
- Artifact Registry repository (shared)

## Related Resources

- [Full Lab Guide — step-by-step deployment and configuration](Mautic_GKE_Lab.md)
- [Configuration Reference](https://docs.radmodules.dev/docs/modules/Mautic_GKE)
- [Mautic_CloudRun Overview](Mautic_CloudRun.md)
- [Mautic Documentation](https://docs.mautic.org/)
