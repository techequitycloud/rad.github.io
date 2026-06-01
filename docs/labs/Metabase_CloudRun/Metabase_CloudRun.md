---
title: "Metabase on Cloud Run — Overview"
sidebar_label: "Metabase CloudRun"
---

# Metabase on Cloud Run — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Metabase_CloudRun)**

## What is Metabase?

Metabase is an open-source business intelligence and analytics platform with 40,000+ GitHub stars, used by 50,000+ organizations to democratize data access — enabling non-technical users to explore and visualize data without writing SQL. It connects to 20+ database types including BigQuery, PostgreSQL, MySQL, Cloud SQL, Redshift, and Snowflake.

## Module Summary

`Metabase_CloudRun` deploys Metabase on Google Cloud Run (v2) with:

- **Cloud SQL PostgreSQL 15** as the Metabase application database (questions, dashboards, users, collections)
- **Cloud Run Gen2** with configurable auto-scaling (default: 0–3 instances)
- **Default `db-init` Cloud Run Job** that automatically initializes the PostgreSQL database before first boot
- **Secret Manager** for database credentials
- **Cloud Build** custom image pipeline
- **IAP**, **Cloud Armor**, and **Binary Authorization** support

## Key Characteristics

| Property | Value |
|---|---|
| Platform | Google Cloud Run v2 |
| Container port | 3000 |
| Default version | v0.51.3 |
| Database | PostgreSQL 15 (required) |
| Default CPU | 2 vCPU |
| Default memory | 4 Gi |
| Min instances | 0 (scale-to-zero) |
| Max instances | 3 |
| Health endpoint | `/api/health` |
| JVM cold start | 60–120 seconds |
| Credit cost | 50 |
| Module dependency | Services_GCP |

## JVM Cold Start Warning

Metabase runs on the JVM and takes 60–120 seconds to start from cold. With `min_instance_count = 0` (the default), all instances terminate when idle — the next request will experience a 60–120 second cold start. For production deployments, set `min_instance_count = 1` to keep at least one instance warm.

## Architecture

```
Internet
    │
    ▼
[Cloud Run Service: Metabase]
    │
    ▼
[Cloud SQL Auth Proxy sidecar]
    │
    ▼
[Cloud SQL PostgreSQL 15]
    (questions, dashboards, users, collections)

[db-init Cloud Run Job] ──► [PostgreSQL] (runs once on first deploy)
```

## PostgreSQL Requirement

Metabase requires PostgreSQL (or MySQL) as its application database. This is separate from the data sources that Metabase queries. The module automatically provisions a PostgreSQL 15 instance and runs a `db-init` job to create the database and user before Metabase starts.

## Getting Started

See the [Lab Guide](../Metabase_CloudRun_Lab/Metabase_CloudRun_Lab.md) for step-by-step deployment instructions.

See the [Configuration Guide](../../modules/Metabase_CloudRun/Metabase_CloudRun.md) for a complete variable reference.

## Common Configuration Examples

### Production deployment (no scale-to-zero)

```hcl
project_id           = "my-project-123"
tenant_deployment_id = "prod"
region               = "us-central1"
min_instance_count   = 1
cpu_limit            = "2000m"
memory_limit         = "4Gi"
```

### With IAP for internal BI tool

```hcl
enable_iap            = true
iap_authorized_groups = ["group:analytics-team@example.com"]
ingress_settings      = "internal-and-cloud-load-balancing"
```

### With SMTP for user notifications

```hcl
environment_variables = {
  MB_EMAIL_SMTP_HOST    = "smtp.sendgrid.net"
  MB_EMAIL_SMTP_PORT    = "587"
  MB_EMAIL_SMTP_USERNAME = "apikey"
  MB_EMAIL_FROM_ADDRESS  = "metabase@example.com"
}
secret_environment_variables = {
  MB_EMAIL_SMTP_PASSWORD = "metabase-smtp-password"
}
```
