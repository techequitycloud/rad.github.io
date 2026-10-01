---
title: "Outils d'IA sur GCP — modules et labs pour une pile LLM"
description: "Déployez une pile LLM auto-hébergée complète sur Google Cloud : Ollama, Open WebUI, Flowise, Dify, LiteLLM, RAGFlow, bases de données vectorielles et automatisation par l'IA — avec des labs pratiques."
---
<!-- translated-from: docs/guides/ai-tooling-gcp.md @ 6b90c32 -->

# Outils d'IA {#ai-tooling}

<img src="https://storage.googleapis.com/rad-public-2b65/guides/AI_Tooling.png" alt="Outils d'IA" style={{maxWidth: "100%", borderRadius: "8px"}} />

La plateforme RAD comprend une pile d'IA générative auto-hébergée complète que
vous pouvez déployer dans votre propre projet Google Cloud, ou dans un projet que RAD crée pour vous — service de modèles, interfaces de chat, outils de
création d'agents, pipelines RAG, bases de données vectorielles, passerelles et automatisation. Cette
page regroupe ces modules afin que vous puissiez assembler une pile LLM fonctionnelle
couche par couche.

Chaque application ci-dessous suit le même schéma que le reste de la plateforme : un
**lab** (déploiement guidé → vérification → exploitation → suppression) et une **référence
de module** (guide de configuration), sur Cloud Run, GKE Autopilot, ou les deux.

## Service de modèles {#model-serving}

| Application | Ce qu'elle fait | Lab | Module |
|---|---|---|---|
| Ollama | Exécute des LLM à poids ouverts (Llama, Mistral, Gemma) derrière une API | [Lab](/docs/labs/Ollama_GKE) | [Module](/docs/modules/Ollama_GKE) |
| LiteLLM | Une passerelle unique compatible OpenAI devant de nombreux fournisseurs de modèles | [Lab](/docs/labs/LiteLLM_GKE) | [Module](/docs/modules/LiteLLM_GKE) |

## Interfaces de chat et d'assistant {#chat-and-assistant-uis}

| Application | Ce qu'elle fait | Lab | Module |
|---|---|---|---|
| Open WebUI | Interface de chat auto-hébergée pour modèles locaux et distants | [Lab](/docs/labs/OpenWebUI_GKE) | [Module](/docs/modules/OpenWebUI_GKE) |
| LibreChat | Chat multi-fournisseurs avec agents et recherche | [Lab](/docs/labs/LibreChat_GKE) | [Module](/docs/modules/LibreChat_GKE) |
| AnythingLLM | Espaces de travail de chat documentaire sur vos propres données | [Lab](/docs/labs/AnythingLLM_GKE) | [Module](/docs/modules/AnythingLLM_GKE) |

## Outils de création d'agents et de workflows {#agent-and-workflow-builders}

| Application | Ce qu'elle fait | Lab | Module |
|---|---|---|---|
| Flowise | Outil visuel de création de flux LLM et d'agents | [Lab](/docs/labs/Flowise_GKE) | [Module](/docs/modules/Flowise_GKE) |
| Dify | Plateforme d'applications LLM : assistants, workflows, bases de connaissances | [Lab](/docs/labs/Dify_GKE) | [Module](/docs/modules/Dify_GKE) |
| OpenClaw | Passerelle multi-tenant pour des assistants IA isolés et persistants | [Lab](/docs/labs/OpenClaw_GKE) | [Module](/docs/modules/OpenClaw_GKE) |
| n8n AI | Workflows d'automatisation augmentés par l'IA | [Lab](/docs/labs/N8N_AI_GKE) | [Module](/docs/modules/N8N_AI_GKE) |

## Pipelines RAG et données {#rag-pipelines-and-data}

| Application | Ce qu'elle fait | Lab | Module |
|---|---|---|---|
| RAGFlow | Génération augmentée par récupération (RAG) de bout en bout sur des documents | [Lab](/docs/labs/RAGFlow_GKE) | [Module](/docs/modules/RAGFlow_GKE) |
| Qdrant | Base de données vectorielle pour les embeddings | [Lab](/docs/labs/Qdrant_GKE) | [Module](/docs/modules/Qdrant_GKE) |
| Chroma | Stockage d'embeddings léger pour les prototypes RAG | [Lab](/docs/labs/Chroma_GKE) | [Module](/docs/modules/Chroma_GKE) |
| Crawl4AI | Exploration du web adaptée aux LLM pour les pipelines d'ingestion | [Lab](/docs/labs/Crawl4AI_GKE) | [Module](/docs/modules/Crawl4AI_GKE) |
| SearXNG | Métamoteur de recherche privé, backend de recherche courant pour le RAG et les agents | [Lab](/docs/labs/SearXNG_GKE) | [Module](/docs/modules/SearXNG_GKE) |

## Ordre de construction suggéré {#suggested-stack-order}

1. **Servir un modèle** — déployez [Ollama](/docs/labs/Ollama_GKE), vérifiez l'API.
2. **Y ajouter une interface** — connectez [Open WebUI](/docs/labs/OpenWebUI_GKE).
3. **Ajouter la récupération** — mettez en place [Qdrant](/docs/labs/Qdrant_GKE) et ingérez avec
   [Crawl4AI](/docs/labs/Crawl4AI_GKE) ou [RAGFlow](/docs/labs/RAGFlow_GKE).
4. **Créer un agent** — assemblez le tout dans [Flowise](/docs/labs/Flowise_GKE)
   ou [Dify](/docs/labs/Dify_GKE), avec [LiteLLM](/docs/labs/LiteLLM_GKE) en frontal.

Déployer et exploiter ces services met en pratique les mêmes compétences que celles couvertes dans
les [parcours de préparation aux certifications](/docs/certification/ACE_Certification_Guide) —
exploitation de GKE Autopilot et de Cloud Run, réseau, IAM et observabilité —
sur une infrastructure que vous avez assemblée vous-même.
