# Zammad on GKE Autopilot — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Zammad_GKE)**

## What is Zammad?

Zammad is an open-source helpdesk and customer support ticketing platform. It provides multi-channel ticket management (email, phone, web, chat, Slack, Twitter/X), SLA tracking, agent groups, a knowledge base, and detailed reporting. It is a GDPR-compliant alternative to Zendesk and Freshdesk.

## Module Summary

`Zammad_GKE` deploys Zammad on **GKE Autopilot** with the following infrastructure:

| Component | Detail |
|---|---|
| **Compute** | GKE Autopilot, 2 vCPU / 4 Gi (configurable), `min_instance_count = 1` |
| **Database** | Cloud SQL PostgreSQL 15 (required — MySQL not supported) |
| **Attachment storage** | Cloud Filestore NFS mounted at `/opt/zammad/storage` |
| **Caching / job queue** | Redis (required for ActionCable WebSockets and Sidekiq) |
| **Secrets** | Secret Manager via Workload Identity |
| **Images** | Artifact Registry; Docker Hub `zammad/zammad` mirrored and rebuilt with GCP entrypoint |
| **Networking** | LoadBalancer Service with `ClientIP` session affinity |
| **Reliability** | PodDisruptionBudget, configurable topology spread |
| **Observability** | Cloud Logging, Cloud Monitoring |

## Prerequisites

- `Services_GCP` module deployed in the same GCP project (including GKE Autopilot cluster)
- Redis available (NFS server IP used by default; Memorystore for production)
- GCP APIs: GKE, Cloud SQL, Secret Manager, Artifact Registry, Cloud Build, Filestore

## Key Defaults

| Variable | Default | Notes |
|---|---|---|
| `application_version` | `'6.4.1'` | Zammad release |
| `container_port` | `3000` | Zammad railsserver port |
| `container_resources.cpu_limit` | `'2000m'` | Minimum 2 vCPU for Rails |
| `container_resources.memory_limit` | `'4Gi'` | Minimum 2 Gi; 4 Gi recommended |
| `min_instance_count` | `1` | Avoids cold starts |
| `service_type` | `'LoadBalancer'` | External access via GCP load balancer |
| `session_affinity` | `'ClientIP'` | Consistent routing for WebSocket connections |
| `enable_redis` | `true` | Required for ActionCable and Sidekiq |
| `enable_nfs` | `true` | Shared attachment storage |
| `nfs_mount_path` | `'/opt/zammad/storage'` | Matches Zammad's storage path |
| `database_type` | `'POSTGRES_15'` | PostgreSQL only |
| `enable_pod_disruption_budget` | `true` | Availability during node maintenance |

## Lab Guide

For the full step-by-step deployment guide, see **[Zammad_GKE_Lab.md](./Zammad_GKE_Lab.md)**.
