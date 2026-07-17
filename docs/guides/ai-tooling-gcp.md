---
title: "AI Tooling on GCP — LLM Stack Modules and Labs"
description: "Deploy a complete self-hosted LLM stack on Google Cloud: Ollama, Open WebUI, Flowise, Dify, LiteLLM, RAGFlow, vector databases, and AI automation — with hands-on labs."
---

# AI Tooling

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AI_Tooling.png" alt="AI Tooling" style={{maxWidth: "100%", borderRadius: "8px"}} />

RAD Platform includes a complete self-hosted generative-AI stack you can
deploy into your own Google Cloud project — model serving, chat UIs, agent
builders, RAG pipelines, vector databases, gateways, and automation. This
page groups those modules so you can assemble a working LLM stack
layer by layer.

Every app below follows the same pattern as the rest of the platform: a
**lab** (guided deploy → verify → operate → tear down) and a **module
reference** (configuration guide), on Cloud Run, GKE Autopilot, or both.

## Model serving

| App | What it does | Lab | Module |
|---|---|---|---|
| Ollama | Run open-weight LLMs (Llama, Mistral, Gemma) behind an API | [Lab](/docs/labs/Ollama_GKE) | [Module](/docs/modules/Ollama_GKE) |
| LiteLLM | One OpenAI-compatible gateway in front of many model providers | [Lab](/docs/labs/LiteLLM_GKE) | [Module](/docs/modules/LiteLLM_GKE) |

## Chat and assistant UIs

| App | What it does | Lab | Module |
|---|---|---|---|
| Open WebUI | Self-hosted chat UI for local and remote models | [Lab](/docs/labs/OpenWebUI_GKE) | [Module](/docs/modules/OpenWebUI_GKE) |
| LibreChat | Multi-provider chat with agents and search | [Lab](/docs/labs/LibreChat_GKE) | [Module](/docs/modules/LibreChat_GKE) |
| AnythingLLM | Document chat workspaces over your own data | [Lab](/docs/labs/AnythingLLM_GKE) | [Module](/docs/modules/AnythingLLM_GKE) |

## Agent and workflow builders

| App | What it does | Lab | Module |
|---|---|---|---|
| Flowise | Visual builder for LLM flows and agents | [Lab](/docs/labs/Flowise_GKE) | [Module](/docs/modules/Flowise_GKE) |
| Dify | LLM app platform: assistants, workflows, knowledge bases | [Lab](/docs/labs/Dify_GKE) | [Module](/docs/modules/Dify_GKE) |
| OpenClaw | Multi-tenant gateway for isolated, persistent AI assistants | [Lab](/docs/labs/OpenClaw_GKE) | [Module](/docs/modules/OpenClaw_GKE) |
| n8n AI | AI-augmented automation workflows | [Lab](/docs/labs/N8N_AI_GKE) | [Module](/docs/modules/N8N_AI_GKE) |

## RAG pipelines and data

| App | What it does | Lab | Module |
|---|---|---|---|
| RAGFlow | End-to-end retrieval-augmented generation over documents | [Lab](/docs/labs/RAGFlow_GKE) | [Module](/docs/modules/RAGFlow_GKE) |
| Qdrant | Vector database for embeddings | [Lab](/docs/labs/Qdrant_GKE) | [Module](/docs/modules/Qdrant_GKE) |
| Chroma | Lightweight embedding store for RAG prototypes | [Lab](/docs/labs/Chroma_GKE) | [Module](/docs/modules/Chroma_GKE) |
| Crawl4AI | LLM-friendly web crawling for ingestion pipelines | [Lab](/docs/labs/Crawl4AI_GKE) | [Module](/docs/modules/Crawl4AI_GKE) |
| SearXNG | Private metasearch, a common RAG/agent search backend | [Lab](/docs/labs/SearXNG_GKE) | [Module](/docs/modules/SearXNG_GKE) |

## Suggested stack order

1. **Serve a model** — deploy [Ollama](/docs/labs/Ollama_GKE), verify the API.
2. **Put a UI on it** — connect [Open WebUI](/docs/labs/OpenWebUI_GKE).
3. **Add retrieval** — stand up [Qdrant](/docs/labs/Qdrant_GKE) and ingest with
   [Crawl4AI](/docs/labs/Crawl4AI_GKE) or [RAGFlow](/docs/labs/RAGFlow_GKE).
4. **Build an agent** — wire it together in [Flowise](/docs/labs/Flowise_GKE)
   or [Dify](/docs/labs/Dify_GKE), fronted by [LiteLLM](/docs/labs/LiteLLM_GKE).

Deploying and operating these services exercises the same skills covered in
the [certification study paths](/docs/certification/ACE_Certification_Guide) —
GKE Autopilot and Cloud Run operations, networking, IAM, and observability —
on infrastructure you assembled yourself.
