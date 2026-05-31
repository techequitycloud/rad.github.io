# LibreChat on GKE Autopilot — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_GKE)**

## What is LibreChat?

LibreChat is an open-source AI chat interface with 20,000+ GitHub stars. It provides a unified interface for 20+ AI providers including OpenAI, Anthropic, Google Gemini, Mistral, Groq, and Ollama — all in a single private, self-hosted deployment.

## Module Summary

`LibreChat_GKE` deploys LibreChat on **GKE Autopilot** with:

| Component | Technology |
|---|---|
| Compute | GKE Autopilot, Kubernetes Deployment, HPA |
| Database | MongoDB (Atlas, self-hosted, or GCP Firestore with MongoDB compatibility) |
| File Storage | GCS bucket via GCS Fuse CSI driver |
| Secrets | Secret Manager (JWT keys, credential encryption keys, MongoDB URI) via Workload Identity |
| Session Management | Redis (optional, strongly recommended for GKE) |
| Security | Cloud Armor WAF, IAP, Binary Authorization (optional) |
| Scaling | HPA (min 1, max 5 by default) |

## Key Differences from LibreChat_CloudRun

| Aspect | Cloud Run | GKE |
|---|---|---|
| Compute model | Serverless containers | Kubernetes pods (GKE Autopilot) |
| Scaling | Cloud Run built-in | HPA |
| Storage mounts | Cloud Run volumes | GCS Fuse CSI driver |
| IAM | Direct Cloud Run SA | Workload Identity |
| Session affinity | None (stateless) | `ClientIP` (for WebSocket) |
| StatefulSet/PVC | Not available | Supported |
| Credit cost | 50 | 150 |

## When to Use GKE vs. Cloud Run

**Use GKE when:**
- You need fine-grained Kubernetes control (pod topology, affinity, node pools)
- Your team already operates GKE workloads
- You need persistent volume support for LibreChat data
- You want co-deployment with other GKE services

**Use Cloud Run when:**
- Simpler operations with less Kubernetes overhead
- Faster cold starts and serverless economics
- Lower cost for low-traffic deployments

## Redis is Strongly Recommended for GKE

Pod restarts and rescheduling are more frequent on Kubernetes than Cloud Run. Without Redis, session loss occurs whenever LibreChat pods restart. Enable Redis with Cloud Memorystore:

```hcl
enable_redis = true
redis_host   = "10.0.0.5"  # Cloud Memorystore IP
redis_port   = 6379
```

## Lab Guide

For hands-on deployment steps, see the [LibreChat GKE Lab Guide](./LibreChat_GKE_Lab.md).
