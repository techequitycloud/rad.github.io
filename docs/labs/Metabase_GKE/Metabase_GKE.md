---
title: "Metabase on GKE Autopilot — Overview"
sidebar_label: "Metabase GKE"
---

# Metabase on GKE Autopilot — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Metabase_GKE)**

## What is Metabase?

Metabase is an open-source business intelligence and analytics platform with 40,000+ GitHub stars, used by 50,000+ organizations to democratize data access — enabling non-technical users to explore and visualize data without writing SQL. It connects to 20+ database types including BigQuery, PostgreSQL, MySQL, Cloud SQL, Redshift, and Snowflake.

## Module Summary

`Metabase_GKE` deploys Metabase on Google Kubernetes Engine (GKE) Autopilot with:

- **Cloud SQL PostgreSQL 15** as the Metabase application database (questions, dashboards, users, collections)
- **GKE Autopilot** Deployment with Horizontal Pod Autoscaling (default: 1–5 replicas)
- **Default `db-init` Kubernetes Job** that automatically initializes the PostgreSQL database before first boot
- **Secret Manager** for database credentials
- **Cloud Build** custom image pipeline
- **IAP**, **Cloud Armor**, and **Binary Authorization** support
- **Session affinity (`ClientIP`)** to prevent session interruption when HPA scales pods

## Key Characteristics

| Property | Value |
|---|---|
| Platform | GKE Autopilot |
| Container port | 3000 |
| Default version | v0.51.3 |
| Database | PostgreSQL 15 (required) |
| Default CPU | 2 vCPU |
| Default memory | 4 Gi |
| Min replicas | 1 (recommended — eliminates JVM cold starts) |
| Max replicas | 5 (configurable) |
| Health endpoint | `/api/health` |
| Session affinity | ClientIP (sticky sessions) |
| JVM cold start | 60–120 seconds |
| Credit cost | 150 |
| Module dependency | Services_GCP |

## JVM Cold Start Warning

Metabase runs on the JVM and takes 60–120 seconds to start from cold. The GKE variant defaults to `min_instance_count = 1` — at least one pod is always running so users do not experience cold starts. If all pods are terminated (e.g., cluster maintenance), the next request must wait for the JVM to fully initialize.

## Session Affinity

Unlike stateless applications, Metabase uses server-side session state. The GKE module defaults to `session_affinity = "ClientIP"` to ensure that a user's requests are consistently routed to the same pod. Without sticky sessions, HPA scale-out events can cause users to be sent to a new pod and lose their session.

## Architecture

```
Internet
    │
    ▼
[GKE LoadBalancer Service]
  (session_affinity = ClientIP)
    │
    ▼
[Kubernetes Deployment: Metabase pods]
    │
    ▼
[Cloud SQL Auth Proxy sidecar]
    │
    ▼
[Cloud SQL PostgreSQL 15]
    (questions, dashboards, users, collections)

[db-init Kubernetes Job] ──► [PostgreSQL] (runs once on first deploy)
```

## PostgreSQL Requirement

Metabase requires PostgreSQL (or MySQL) as its application database. This is separate from the data sources that Metabase queries. The module automatically provisions a PostgreSQL 15 instance and runs a `db-init` job to create the database and user before Metabase starts. Metabase does not auto-migrate a fresh PostgreSQL instance — the `db-init` job is required.

## StatefulSet vs Deployment

Metabase is stateless — all application state is stored in PostgreSQL. Use the default `workload_type = null` (resolves to `"Deployment"`) for standard deployments. A `StatefulSet` is not required for Metabase.

## Getting Started

See the [Lab Guide](./Metabase_GKE_Lab.md) for step-by-step deployment instructions.

See the [Configuration Guide](../modules/Metabase_GKE.md) for a complete variable reference.

## Common Configuration Examples

### Production deployment

```hcl
project_id           = "my-project-123"
tenant_deployment_id = "prod"
region               = "us-central1"
min_instance_count   = 2
max_instance_count   = 10
container_resources = {
  cpu_limit    = "2000m"
  memory_limit = "4Gi"
}
```

### With IAP for internal BI tool

```hcl
enable_iap              = true
iap_oauth_client_id     = "..."
iap_oauth_client_secret = "..."
iap_support_email       = "platform@example.com"
iap_authorized_groups   = ["group:analytics-team@example.com"]
```

### With SMTP for user notifications

```hcl
environment_variables = {
  MB_EMAIL_SMTP_HOST    = "smtp.sendgrid.net"
  MB_EMAIL_SMTP_PORT    = "587"
  MB_EMAIL_FROM_ADDRESS = "metabase@example.com"
}
secret_environment_variables = {
  MB_EMAIL_SMTP_PASSWORD = "metabase-smtp-password"
}
```
