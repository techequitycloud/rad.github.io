# Grafana on Cloud Run — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Grafana_CloudRun)**

## What is Grafana?

Grafana is the world's leading open-source observability and analytics platform, used by 10M+ users at organizations including NASA, CERN, Goldman Sachs, and thousands of engineering teams. It provides unified dashboards, alerting, and visualization for metrics, logs, and traces from over 100 data sources — including Prometheus, BigQuery, Cloud SQL, Elasticsearch, and more.

## Module Summary

`Grafana_CloudRun` deploys Grafana on Google Cloud Run (v2) with:

- **Cloud SQL PostgreSQL 15** as the Grafana application database (dashboards, users, organizations, alerts)
- **Cloud Run Gen2** with configurable auto-scaling (default: 1–5 instances)
- **GCS Fuse** and optional **NFS** storage for shared plugins and dashboards
- **Secret Manager** for database credentials
- **Cloud Build** custom image pipeline
- **IAP**, **Cloud Armor**, and **Binary Authorization** support

## Key Characteristics

| Property | Value |
|---|---|
| Platform | Google Cloud Run v2 |
| Container port | 3000 |
| Default version | 11.4.0 |
| Database | PostgreSQL 15 (required) |
| Default CPU | 1 vCPU |
| Default memory | 2 Gi |
| Min instances | 1 (configurable) |
| Max instances | 5 (configurable) |
| Health endpoint | `/api/health` |
| Credit cost | 50 |
| Module dependency | Services_GCP |

## Architecture

```
Internet
    │
    ▼
[Cloud Run Service: Grafana]
    │                   │
    ▼                   ▼
[Cloud SQL Auth Proxy]  [GCS Fuse Volume]
    │
    ▼
[Cloud SQL PostgreSQL 15]
    (dashboards, users, orgs, alerts)
```

## PostgreSQL Requirement

Grafana requires PostgreSQL (or MySQL) for multi-instance deployments. The module automatically sets `GF_DATABASE_TYPE=postgres` — without this environment variable, Grafana falls back to SQLite even when all other `GF_DATABASE_*` variables are present. SQLite is not safe for multi-instance Cloud Run deployments due to file locking conflicts.

## Getting Started

See the [Lab Guide](./Grafana_CloudRun_Lab.md) for step-by-step deployment instructions.

See the [Configuration Guide](../modules/Grafana_CloudRun.md) for a complete variable reference.

## Common Configuration Examples

### Minimal deployment

```hcl
project_id           = "my-project-123"
tenant_deployment_id = "prod"
region               = "us-central1"
```

### With custom domain and Cloud Armor

```hcl
project_id           = "my-project-123"
tenant_deployment_id = "prod"
enable_cloud_armor   = true
application_domains  = ["grafana.example.com"]
enable_cdn           = false
```

### With IAP for internal access

```hcl
enable_iap              = true
iap_authorized_groups   = ["group:platform-team@example.com"]
ingress_settings        = "internal-and-cloud-load-balancing"
```

### With Prometheus data source credentials

```hcl
environment_variables = {
  GF_SERVER_ROOT_URL            = "https://grafana.example.com"
  GF_AUTH_ANONYMOUS_ENABLED     = "false"
  GF_SECURITY_ALLOW_EMBEDDING   = "true"
}
```
