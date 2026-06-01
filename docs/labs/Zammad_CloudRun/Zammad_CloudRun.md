---
title: "Zammad on Cloud Run — Overview"
sidebar_label: "Zammad CloudRun"
---

# Zammad on Cloud Run — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Zammad_CloudRun)**

## What is Zammad?

Zammad is an open-source helpdesk and customer support ticketing platform. It provides multi-channel ticket management (email, phone, web, Slack, Twitter/X), SLA tracking, agent groups, knowledge base, and detailed reporting. It is a GDPR-compliant alternative to Zendesk and Freshdesk that you run on your own infrastructure.

## Module Summary

`Zammad_CloudRun` deploys Zammad on **Google Cloud Run v2** with the following infrastructure:

| Component | Detail |
|---|---|
| **Compute** | Cloud Run v2 Gen2, 2 vCPU / 4 Gi (configurable), `min_instance_count = 1` |
| **Database** | Cloud SQL PostgreSQL 15 (required — MySQL not supported) |
| **Attachment storage** | Cloud Filestore NFS mounted at `/opt/zammad/storage` |
| **Caching / job queue** | Redis (required for ActionCable WebSockets and Sidekiq) |
| **Secrets** | Secret Manager (DB password, root password) |
| **Images** | Artifact Registry; Docker Hub `zammad/zammad` mirrored and rebuilt with GCP entrypoint |
| **Networking** | VPC Direct Egress, Cloud SQL Auth Proxy sidecar |
| **Observability** | Cloud Monitoring uptime check at `/api/v1/ping`, Cloud Logging |

## Prerequisites

- `Services_GCP` module deployed in the same GCP project
- Redis available (NFS server IP is used by default; Memorystore for production)
- GCP APIs: Cloud Run, Cloud SQL, Secret Manager, Artifact Registry, Cloud Build, VPC Access, Filestore

## Key Defaults

| Variable | Default | Notes |
|---|---|---|
| `application_version` | `'6.4.1'` | Zammad release |
| `container_port` | `3000` | Zammad railsserver port |
| `cpu_limit` | `'2000m'` | Minimum 2 vCPU for Rails |
| `memory_limit` | `'4Gi'` | Minimum 2 Gi; 4 Gi recommended |
| `min_instance_count` | `1` | Avoids 60–90 s cold starts |
| `enable_redis` | `true` | Required for ActionCable and Sidekiq |
| `enable_nfs` | `true` | Shared attachment storage |
| `nfs_mount_path` | `'/opt/zammad/storage'` | Matches Zammad's storage path |
| `database_type` | `'POSTGRES_15'` | PostgreSQL only |

## Lab Guide

For the full step-by-step deployment guide, see **[Zammad_CloudRun_Lab.md](./Zammad_CloudRun_Lab.md)**.
