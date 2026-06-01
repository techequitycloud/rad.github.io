---
title: "LiteLLM on GKE Autopilot — Overview"
sidebar_label: "LiteLLM GKE"
---

# LiteLLM on GKE Autopilot — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LiteLLM_GKE)**

## What is LiteLLM?

LiteLLM is an open-source LLM proxy and AI gateway providing a **unified OpenAI-compatible API** across 100+ providers. Use it to centralize AI spend tracking, manage virtual API keys, enforce rate limits, and route requests across providers — all through a single endpoint.

## Module Summary

`LiteLLM_GKE` deploys LiteLLM on **GKE Autopilot** with:

| Component | Technology |
|---|---|
| Compute | GKE Autopilot, Kubernetes Deployment, HPA |
| Database | Cloud SQL PostgreSQL 15 via Cloud SQL Auth Proxy |
| Container | Custom Cloud Build image with entrypoint script |
| Secrets | Secret Manager (`LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY`) via Workload Identity |
| Response Caching | Redis (optional) |
| Security | Cloud Armor WAF, Binary Authorization (optional) |
| Scaling | HPA (min 1, max 3 by default) |

## Key Differences from LiteLLM_CloudRun

| Aspect | Cloud Run | GKE |
|---|---|---|
| Compute model | Serverless | Kubernetes pods (GKE Autopilot) |
| Scaling | Cloud Run built-in | HPA |
| IAM | Direct Cloud Run SA | Workload Identity |
| StatefulSet/PVC | Not available | Supported |
| Credit cost | 50 | 150 |
| DB connection | Cloud SQL Auth Proxy sidecar | Cloud SQL Auth Proxy sidecar |

## When to Use GKE vs. Cloud Run for LiteLLM

**Use GKE when:**
- You want LiteLLM co-located with other GKE AI workloads (Ollama, inference servers)
- You need fine-grained pod scheduling or GPU node pools for local inference
- Your team operates a GKE-first platform

**Use Cloud Run when:**
- Simpler operations with less Kubernetes overhead
- Lower traffic with cost-optimized serverless scaling
- Faster setup time

## Lab Guide

For hands-on deployment steps, see the [LiteLLM GKE Lab Guide](./LiteLLM_GKE_Lab.md).
