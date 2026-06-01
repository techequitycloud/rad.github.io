---
title: "LibreChat on Cloud Run — Overview"
sidebar_label: "LibreChat CloudRun"
---

# LibreChat on Cloud Run — Overview

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_CloudRun)**

## What is LibreChat?

LibreChat is an open-source AI chat interface with 20,000+ GitHub stars that replicates and extends the ChatGPT experience. It supports **20+ AI providers** including OpenAI, Anthropic (Claude), Google Gemini, Mistral, Groq, Ollama, and many more — all from a single unified interface.

Key features:
- Multi-provider AI conversations with model switching
- Conversation history and search
- File uploads and document analysis
- Plugin and tool support
- Multi-user with admin management
- Customizable branding

## Module Summary

`LibreChat_CloudRun` deploys LibreChat on **Google Cloud Run v2** with:

| Component | Technology |
|---|---|
| Compute | Cloud Run v2 Gen2, Node.js |
| Database | MongoDB (Atlas, self-hosted, or GCP Firestore with MongoDB compatibility) |
| File Storage | GCS bucket (`librechat-uploads`) via GCS Fuse |
| Secrets | Secret Manager (JWT keys, credential encryption keys, MongoDB URI) |
| Session Management | Redis (optional, recommended for multi-instance) |
| Security | Cloud Armor WAF, IAP, Binary Authorization (optional) |
| Scaling | Cloud Run auto-scaling (min 1, max 5 by default) |

## Key Configuration Points

### MongoDB (Required)

LibreChat requires MongoDB. Choose one approach:

1. **MongoDB Atlas** (recommended) — free M0 tier for development, M10+ for production:
   ```hcl
   mongodb_uri = "mongodb+srv://user:pass@cluster.mongodb.net/LibreChat?retryWrites=true"
   ```

2. **Firestore auto-provisioning** (default when no URI supplied) — the module automatically creates a Firestore ENTERPRISE database with MongoDB compatibility.

3. **Manual Firestore** — provide `firestore_mongodb_host` + SCRAM credentials.

### AI Provider API Keys

Inject API keys via `secret_environment_variables` (pre-create secrets in Secret Manager):

```hcl
secret_environment_variables = {
  OPENAI_API_KEY    = "openai-api-key"
  ANTHROPIC_API_KEY = "anthropic-api-key"
}
```

### Redis (Recommended for Production)

Enable Redis for session management when running multiple instances:

```hcl
enable_redis = true
redis_host   = "10.0.0.5"  # Cloud Memorystore IP
redis_port   = 6379
```

### Security

Set `allow_registration = false` after creating the initial admin account:

```hcl
allow_registration = false
```

## Auto-Generated Secrets

The module automatically creates and stores in Secret Manager:
- `CREDS_KEY` — AES-GCM encryption key for saved AI provider credentials
- `CREDS_IV` — AES-GCM initialization vector
- `JWT_SECRET` — User access token signing key
- `JWT_REFRESH_SECRET` — Refresh token signing key
- `MONGO_URI` — MongoDB connection string

These are injected natively by Cloud Run — never stored in plaintext.

## Deployment Timeline

| Phase | Duration |
|---|---|
| Secret Manager provisioning | 1–2 min |
| Firestore database (if auto-provisioning) | 2–5 min |
| Artifact Registry image mirror | 3–5 min |
| Cloud Run service deployment | 2–3 min |
| **Total** | **8–15 min** |

## Prerequisites

1. `Services_GCP` deployed in the same GCP project
2. MongoDB connection (Atlas account, self-hosted, or Firestore auto-provisioning)
3. Optional: Redis instance (Cloud Memorystore recommended)
4. Optional: Secret Manager secrets for AI provider API keys

## Lab Guide

For hands-on deployment steps, see the [LibreChat Cloud Run Lab Guide](./LibreChat_CloudRun_Lab.md).
