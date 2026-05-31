# Mautic on Cloud Run — Overview

📖 **[Full Configuration Reference](https://docs.radmodules.dev/docs/modules/Mautic_CloudRun)**

## What Is Mautic?

[Mautic](https://www.mautic.org/) is the world's leading open-source marketing automation platform with over 200,000 deployments globally. It provides a self-hosted alternative to HubSpot and Marketo — offering email marketing, multi-channel campaign automation, contact management, lead scoring, and CRM integration without per-contact subscription fees.

## What `Mautic_CloudRun` Deploys

`Mautic_CloudRun` is a fully managed Terraform module that deploys production-ready Mautic on Google Cloud Run v2. It provisions:

- **Cloud Run v2** (Gen2) service with Cloud SQL Auth Proxy sidecar
- **Cloud SQL MySQL 8.0** instance, database, and user (Mautic requires MySQL)
- **Cloud Filestore (NFS)** for shared media storage across Cloud Run instances
- **GCS `mautic-media` bucket** provisioned by `Mautic_Common`
- **Secret Manager** secrets: admin password, database password, and root password
- **Artifact Registry** repository and Cloud Build custom image pipeline
- **Serverless VPC Access** connector for private networking
- **Cloud Monitoring** uptime checks and alert policies
- **Automated backup** Cloud Run job (daily by default)
- **Redis** caching backend (uses NFS server IP by default)

## Architecture

```
Internet
    │
    ├─ (optional) Cloud Armor WAF
    │       │
    │  Global HTTPS LB (with Cloud CDN)
    │       │
    └─ Cloud Run v2 (Gen2)
            ├── Mautic/Apache container (port 80)
            │       MAUTIC_SITE_URL = https://<service>-<project>.run.app
            │       HTTPS=on (suppress redirect loops)
            │       DOCKER_MAUTIC_RUN_MIGRATIONS=true
            └── Cloud SQL Auth Proxy sidecar (/cloudsql socket)
                        │
                Cloud SQL MySQL 8.0
                        │
                NFS (shared media files)
                        │
                Redis (caching)
```

## Key Defaults

| Setting | Default | Notes |
|---|---|---|
| Database | MySQL 8.0 | Fixed — Mautic does not support PostgreSQL |
| Container port | 80 | Mautic/Apache |
| Min instances | 1 | Warm instance for campaign processing |
| Max instances | 3 | User-configurable cost ceiling |
| CPU | 2 vCPU | Minimum recommended for Mautic |
| Memory | 4 Gi | Recommended for production |
| NFS | enabled | Shared media storage |
| Redis | enabled | Caching backend |
| Startup probe | TCP (port 80) | Avoids Apache HTTP→HTTPS redirect failures |
| Liveness probe | HTTP `/healthz` | Static file served without redirect |

## Module Dependencies

`Mautic_CloudRun` requires `Services_GCP` to be deployed first. `Services_GCP` provisions:
- VPC network and subnets
- Cloud SQL MySQL instance (shared)
- Cloud Filestore NFS server (shared)
- Artifact Registry repository (shared)

## Related Resources

- [Full Lab Guide — step-by-step deployment and configuration](Mautic_CloudRun_Lab.md)
- [Configuration Reference](https://docs.radmodules.dev/docs/modules/Mautic_CloudRun)
- [Mautic_GKE Overview](Mautic_GKE.md)
- [Mautic Documentation](https://docs.mautic.org/)
