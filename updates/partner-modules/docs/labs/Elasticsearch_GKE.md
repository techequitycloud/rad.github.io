# Elasticsearch on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Elasticsearch_GKE)**

This lab guide walks you through deploying, exploring, and operating **Elasticsearch** on
Google Kubernetes Engine Autopilot using the **Elasticsearch_GKE** module. You will explore
a distributed search and analytics engine deployed as a Kubernetes StatefulSet with persistent
SSD storage — commonly used as the search and vector database backend for RAGFlow and other
AI-powered applications.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Lab Setup](#4-lab-setup)
5. [Exercise 1 — Access Elasticsearch API](#exercise-1--access-elasticsearch-api)
6. [Exercise 2 — Index Management](#exercise-2--index-management)
7. [Exercise 3 — Index Documents](#exercise-3--index-documents)
8. [Exercise 4 — Search Queries](#exercise-4--search-queries)
9. [Exercise 5 — Aggregations and Analytics](#exercise-5--aggregations-and-analytics)
10. [Exercise 6 — Kibana Exploration](#exercise-6--kibana-exploration)
11. [Exercise 7 — Cluster Operations](#exercise-7--cluster-operations)
12. [Exercise 8 — Cloud Logging and Monitoring](#exercise-8--cloud-logging-and-monitoring)
13. [Cleanup](#cleanup)
14. [Reference](#reference)

---

## 1. Overview

### What Is Elasticsearch?

Elasticsearch is an open-source **distributed search and analytics engine** based on Apache
Lucene, used by 58,000+ companies with a 4.43% DBMS market share. Beyond traditional full-text
search, Elasticsearch has become central to enterprise AI architectures as a **vector database**
powering semantic search and RAG pipelines. The `Elasticsearch_GKE` module deploys version
**8.13.4** as a single-node StatefulSet on GKE Autopilot with a 30 Gi SSD-backed
PersistentVolumeClaim.

### Key Capabilities Demonstrated

| Capability | What It Demonstrates |
|---|---|
| **Full-Text Search** | Inverted index, relevance scoring, BM25 ranking |
| **Vector Search** | `dense_vector` k-NN similarity search for AI/RAG workloads |
| **Index Management** | Index creation, mapping, settings, lifecycle |
| **Document Operations** | Single and bulk indexing, update, delete |
| **Aggregations** | Bucket and metric aggregations for analytics |
| **Persistent Storage** | StatefulSet + PVC (30 Gi SSD) surviving pod restarts |
| **REST API** | Full Elasticsearch HTTP REST API |
| **Observability** | JVM and server logs in Cloud Logging, pod metrics in Monitoring |

---

## 2. Architecture

```
Client (curl / RAGFlow / application)
       │
       ▼ HTTP port 9200 (LoadBalancer)
┌──────────────────────────────────────────────────────────────────┐
│  GKE Autopilot Cluster                                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Namespace: appelasticsearch<tenant><deploymentid>         │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  StatefulSet Pod: elasticsearch-<suffix>-0            │  │ │
│  │  │  Container: docker.elastic.co/elasticsearch/...8.13.4 │  │ │
│  │  │  Port: 9200 (HTTP REST)  │  Port: 9300 (transport)    │  │ │
│  │  │  JVM heap: -Xms512m -Xmx512m                         │  │  │
│  │  │  cluster.name=ragflow                                  │  ││
│  │  │  discovery.type=single-node                            │  ││
│  │  │                                                        │  ││
│  │  │  PVC: data-elasticsearch-<suffix>-0                    │  ││
│  │  │  Mount: /usr/share/elasticsearch/data                  │  ││
│  │  │  Storage: 30 Gi  │  StorageClass: standard-rwo         │  ││
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  Services:                                                 │  │
│  │  ├── elasticsearch (LoadBalancer port 9200)               │   │
│  │  └── elasticsearch-headless (ClusterIP, DNS)              │   │
│  │                                                            │  │
│  │  PDB: minAvailable=1                                      │   │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

Deployment notes:
  - No Cloud SQL (Elasticsearch is self-contained)
  - No Redis, no NFS
  - Workload Identity: GSA with minimal permissions
  - X-Pack security: disabled by default (set enable_xpack_security=true for TLS+auth)
```

---

## 3. Prerequisites

### Required Tools

| Tool | Minimum Version | Install |
|---|---|---|
| `gcloud` CLI | 480.0.0 | [Install guide](https://cloud.google.com/sdk/docs/install) |
| `kubectl` | 1.29+ | `gcloud components install kubectl` |
| `curl` | Any | System package manager |
| `jq` | 1.6+ | System package manager |

### GCP Permissions

```
roles/owner                    # or the following fine-grained set:
roles/container.admin
roles/storage.admin
roles/iam.serviceAccountAdmin
roles/monitoring.admin
roles/logging.admin
```

### Environment Variables

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

gcloud config set project "${PROJECT}"
gcloud config set compute/region "${REGION}"
```

---

## 4. Lab Setup

### 4.1 Deploy via RAD UI

Deploy the `Elasticsearch_GKE` module via the RAD UI. In the variable form, set:

| Variable | Value | Notes |
|---|---|---|
| `project_id` | `your-gcp-project-id` | Required |
| `region` | `us-central1` | GCP region |
| `application_name` | `elasticsearch` | Base resource name |
| `application_version` | `8.13.4` | Elasticsearch version |
| `cpu_limit` | `2000m` | 2 vCPU |
| `memory_limit` | `4Gi` | Must be ≥ 2× `es_java_heap` |
| `es_java_heap` | `512m` | JVM `-Xms`/`-Xmx` |
| `stateful_pvc_size` | `30Gi` | SSD storage |
| `enable_xpack_security` | `false` | No TLS/auth (lab mode) |

Click **Deploy** and wait for provisioning to complete (approximately 8–17 minutes).

> **What this provisions:** GKE namespace, StatefulSet (Elasticsearch), PVC (30 Gi SSD),
> LoadBalancer Service (port 9200), headless Service (DNS), Workload Identity, Artifact
> Registry (image mirror), PodDisruptionBudget.

> **GKE Autopilot note:** GKE must provision a new node and attach the PVC before the
> container starts. Allow up to 10 minutes on first deployment.

### 4.2 Configure Shell Environment

```bash
export PROJECT="your-gcp-project-id"
export REGION="us-central1"
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project="${PROJECT}" \
  --format="value(name)" \
  --limit=1)
```

### 4.3 Configure kubectl

```bash
gcloud container clusters get-credentials "${CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT}"

kubectl cluster-info

# Discover the namespace (pattern: appelasticsearch<tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appelasticsearch" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')

# Set the Elasticsearch endpoint
export ES_URL="http://${EXTERNAL_IP}:9200"

echo "Namespace: ${NAMESPACE}"
echo "Elasticsearch URL: ${ES_URL}"
```

---

## Exercise 1 — Access Elasticsearch API

### Objective

Verify the StatefulSet and PVC are healthy, access the Elasticsearch REST API, and check
cluster health and node statistics.

### Step 1.1 — Verify StatefulSet and PVC

**kubectl:**
```bash
kubectl get statefulset -n "${NAMESPACE}"
kubectl get pvc -n "${NAMESPACE}"
```

Expected output:
```
NAME                      READY   AGE
elasticsearch-<suffix>    1/1     10m

NAME                          STATUS   CAPACITY   STORAGECLASS    AGE
data-elasticsearch-<suffix>   Bound    30Gi       standard-rwo    10m
```

### Step 1.2 — Check Cluster Health

```bash
curl -s "${ES_URL}/_cluster/health" | jq
```

**Expected result:**
```json
{
  "cluster_name": "ragflow",
  "status": "green",
  "number_of_nodes": 1,
  "number_of_data_nodes": 1,
  "active_primary_shards": 0,
  "active_shards": 0
}
```

> A `yellow` status is normal for a single-node cluster when indices have replicas configured
> (replicas cannot be assigned on a single node).

### Step 1.3 — View Node Statistics

```bash
curl -s "${ES_URL}/_nodes/stats" \
  | jq '.nodes | to_entries[0].value | {name: .name, version: .version, heap_used_percent: .jvm.mem.heap_used_percent, heap_max_mb: (.jvm.mem.heap_max_in_bytes / 1024 / 1024 | floor)}'
```

**Expected result:** Node name, Elasticsearch version (`8.13.4`), and current JVM heap usage
percentage.

### Step 1.4 — View Index Catalogue

```bash
curl -s "${ES_URL}/_cat/indices?v"
```

**Expected result:** Table of existing indices. Initially shows only system indices or empty.

### Step 1.5 — Check Cluster Settings

```bash
curl -s "${ES_URL}/_cluster/settings?pretty"
```

**gcloud (verify the LoadBalancer service):**
```bash
gcloud compute forwarding-rules list \
  --project="${PROJECT}" \
  --filter="region:${REGION}" \
  --format="table(name, IPAddress)"
```

---

## Exercise 2 — Index Management

### Objective

Create an index with custom settings and mappings, inspect the index metadata, and understand
Elasticsearch index configuration.

### Step 2.1 — Create an Index with Custom Settings

```bash
curl -s -X PUT "${ES_URL}/gcp-docs" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0,
      "analysis": {
        "analyzer": {
          "custom_analyzer": {
            "type": "standard",
            "stopwords": "_english_"
          }
        }
      }
    },
    "mappings": {
      "properties": {
        "title": {
          "type": "text",
          "analyzer": "standard"
        },
        "content": {
          "type": "text",
          "analyzer": "custom_analyzer"
        },
        "tags": {
          "type": "keyword"
        },
        "published_at": {
          "type": "date"
        }
      }
    }
  }' | jq
```

**Expected result:** `{"acknowledged": true, "shards_acknowledged": true, "index": "gcp-docs"}`

### Step 2.2 — View Index Metadata

```bash
curl -s "${ES_URL}/gcp-docs" | jq '.gcp-docs | {settings: .settings.index, mappings: .mappings}'
```

**Expected result:** Index settings showing 1 shard, 0 replicas, and the custom analyzer.
Mappings show field type definitions.

### Step 2.3 — Check Index Statistics

```bash
curl -s "${ES_URL}/gcp-docs/_stats" \
  | jq '.indices["gcp-docs"].total | {docs: .docs.count, size_bytes: .store.size_in_bytes}'
```

**Expected result:** Zero documents (empty index) with minimal storage footprint.

### Step 2.4 — List All Indices with Details

```bash
curl -s "${ES_URL}/_cat/indices?v&h=index,health,status,pri,rep,docs.count,store.size"
```

**Expected result:** Table showing the `gcp-docs` index with health, shards, replica count,
document count, and storage size.

### Step 2.5 — Create a Second Index for Vector Search

```bash
curl -s -X PUT "${ES_URL}/embeddings" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 0
    },
    "mappings": {
      "properties": {
        "text": {"type": "text"},
        "source": {"type": "keyword"},
        "embedding": {
          "type": "dense_vector",
          "dims": 4,
          "index": true,
          "similarity": "cosine"
        }
      }
    }
  }' | jq
```

**Expected result:** `{"acknowledged": true, "index": "embeddings"}`

---

## Exercise 3 — Index Documents

### Objective

Index single documents and use the bulk API to load multiple documents efficiently.

### Step 3.1 — Index a Single Document

```bash
curl -s -X POST "${ES_URL}/gcp-docs/_doc" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Cloud Run",
    "content": "Cloud Run is a managed compute platform that runs containers directly on Googles scalable infrastructure. It scales automatically from zero.",
    "tags": ["serverless", "containers", "gcp"],
    "published_at": "2024-01-15"
  }' | jq '{_id, result}'
```

**Expected result:** `{"_id": "<id>", "result": "created"}`

### Step 3.2 — Index a Second Document

```bash
curl -s -X POST "${ES_URL}/gcp-docs/_doc" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "GKE Autopilot",
    "content": "GKE Autopilot is a mode of operation where Google manages cluster configuration, scaling, and node provisioning automatically.",
    "tags": ["kubernetes", "containers", "gcp"],
    "published_at": "2024-02-20"
  }' | jq '{_id, result}'
```

### Step 3.3 — Bulk Index Documents

```bash
curl -s -X POST "${ES_URL}/gcp-docs/_bulk" \
  -H "Content-Type: application/json" \
  -d '
{"index": {}}
{"title": "Cloud SQL", "content": "Cloud SQL is a fully managed relational database service for PostgreSQL, MySQL, and SQL Server.", "tags": ["database", "managed", "gcp"], "published_at": "2024-03-10"}
{"index": {}}
{"title": "Secret Manager", "content": "Secret Manager securely stores API keys, passwords, certificates, and other sensitive data in Google Cloud.", "tags": ["security", "secrets", "gcp"], "published_at": "2024-03-15"}
{"index": {}}
{"title": "Artifact Registry", "content": "Artifact Registry is a fully managed service for storing and managing container images and language packages.", "tags": ["registry", "containers", "gcp"], "published_at": "2024-04-01"}
' | jq '.errors, (.items | length)'
```

**Expected result:** `false` (no errors) and `3` (three items indexed).

### Step 3.4 — Verify Document Count

```bash
curl -s "${ES_URL}/gcp-docs/_count" | jq '.count'
```

**Expected result:** `5` — all five documents are indexed.

### Step 3.5 — Index Documents with Embeddings

```bash
curl -s -X POST "${ES_URL}/embeddings/_bulk" \
  -H "Content-Type: application/json" \
  -d '
{"index": {}}
{"text": "Cloud Run deploys containers on Google infrastructure", "source": "cloud-run", "embedding": [0.8, 0.3, 0.1, 0.5]}
{"index": {}}
{"text": "Kubernetes manages containerised workloads", "source": "gke", "embedding": [0.7, 0.4, 0.2, 0.6]}
{"index": {}}
{"text": "PostgreSQL database service on Google Cloud", "source": "cloud-sql", "embedding": [0.2, 0.8, 0.6, 0.3]}
' | jq '.errors'
```

**Expected result:** `false` — all three embedding documents indexed.

---

## Exercise 4 — Search Queries

### Objective

Execute full-text match queries, term filters, range queries, and boolean compound queries
to explore Elasticsearch's search capabilities.

### Step 4.1 — Full-Text Match Query

```bash
curl -s -X GET "${ES_URL}/gcp-docs/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "match": {
        "content": "containers managed"
      }
    }
  }' | jq '.hits.hits[] | {title: ._source.title, score: ._score}'
```

**Expected result:** Documents mentioning containers and/or managed services, ranked by
BM25 relevance score.

### Step 4.2 — Term Filter Query

```bash
curl -s -X GET "${ES_URL}/gcp-docs/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "term": {
        "tags": "containers"
      }
    }
  }' | jq '.hits.hits[] | ._source.title'
```

**Expected result:** Documents tagged with `containers` (`Cloud Run`, `GKE Autopilot`,
`Artifact Registry`).

### Step 4.3 — Range Query on Date

```bash
curl -s -X GET "${ES_URL}/gcp-docs/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "range": {
        "published_at": {
          "gte": "2024-03-01",
          "lte": "2024-04-30"
        }
      }
    }
  }' | jq '.hits.hits[] | ._source.title'
```

**Expected result:** Documents published in March–April 2024 (`Cloud SQL`, `Secret Manager`,
`Artifact Registry`).

### Step 4.4 — Boolean Compound Query

```bash
curl -s -X GET "${ES_URL}/gcp-docs/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "bool": {
        "must": [
          {"match": {"content": "google"}}
        ],
        "filter": [
          {"term": {"tags": "gcp"}}
        ],
        "must_not": [
          {"term": {"tags": "kubernetes"}}
        ]
      }
    }
  }' | jq '.hits.hits[] | {title: ._source.title, tags: ._source.tags}'
```

**Expected result:** Documents mentioning "google" that are tagged `gcp` but NOT `kubernetes`.

### Step 4.5 — k-NN Vector Search

```bash
curl -s -X GET "${ES_URL}/embeddings/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "knn": {
      "field": "embedding",
      "query_vector": [0.75, 0.35, 0.15, 0.55],
      "k": 3,
      "num_candidates": 10
    }
  }' | jq '.hits.hits[] | {text: ._source.text, score: ._score}'
```

**Expected result:** All three embedding documents ranked by cosine similarity to the query
vector, demonstrating k-NN semantic search.

---

## Exercise 5 — Aggregations and Analytics

### Objective

Run bucket aggregations to group data and metric aggregations to compute statistics —
demonstrating Elasticsearch as an analytics engine.

### Step 5.1 — Terms Aggregation (Bucket)

```bash
curl -s -X GET "${ES_URL}/gcp-docs/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "aggs": {
      "tags_count": {
        "terms": {
          "field": "tags",
          "size": 10
        }
      }
    }
  }' | jq '.aggregations.tags_count.buckets[] | {tag: .key, count: .doc_count}'
```

**Expected result:** Each tag with its document count — `gcp` should appear most frequently.

### Step 5.2 — Date Histogram Aggregation

```bash
curl -s -X GET "${ES_URL}/gcp-docs/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "aggs": {
      "docs_per_month": {
        "date_histogram": {
          "field": "published_at",
          "calendar_interval": "month"
        }
      }
    }
  }' | jq '.aggregations.docs_per_month.buckets[] | {month: .key_as_string, count: .doc_count}'
```

**Expected result:** Document counts grouped by month, showing publication distribution.

### Step 5.3 — Metric Aggregation (Stats)

```bash
# First add numeric fields to demonstrate metric aggregations
curl -s -X POST "${ES_URL}/metrics/_doc" \
  -H "Content-Type: application/json" \
  -d '{"service": "cloud-run", "latency_ms": 45, "requests": 1500}' > /dev/null

curl -s -X POST "${ES_URL}/metrics/_doc" \
  -H "Content-Type: application/json" \
  -d '{"service": "gke", "latency_ms": 12, "requests": 3200}' > /dev/null

curl -s -X POST "${ES_URL}/metrics/_doc" \
  -H "Content-Type: application/json" \
  -d '{"service": "cloud-sql", "latency_ms": 8, "requests": 5100}' > /dev/null

# Stats aggregation
curl -s -X GET "${ES_URL}/metrics/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "aggs": {
      "latency_stats": {
        "stats": {"field": "latency_ms"}
      },
      "total_requests": {
        "sum": {"field": "requests"}
      }
    }
  }' | jq '.aggregations | {latency: .latency_stats, total_requests: .total_requests.value}'
```

**Expected result:** Min, max, avg, sum, and count of latency values, plus total request count.

### Step 5.4 — Nested Bucket + Metric (Sub-Aggregation)

```bash
curl -s -X GET "${ES_URL}/metrics/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "aggs": {
      "per_service": {
        "terms": {"field": "service"},
        "aggs": {
          "avg_latency": {
            "avg": {"field": "latency_ms"}
          }
        }
      }
    }
  }' | jq '.aggregations.per_service.buckets[] | {service: .key, avg_latency_ms: .avg_latency.value}'
```

**Expected result:** Average latency per service — demonstrating how Elasticsearch can serve
as a real-time analytics backend.

---

## Exercise 6 — Kibana Exploration

### Objective

If Kibana is not deployed in this lab, use the Elasticsearch Dev Tools console equivalent to
explore index patterns and visualisations via the REST API.

> **Note:** This module does not deploy Kibana. The exercise below demonstrates equivalent
> exploration via the REST API.

### Step 6.1 — Check Available Indices for Kibana Patterns

```bash
curl -s "${ES_URL}/_cat/indices?v&s=index" \
  | grep -v "^\." | head -20
```

**Expected result:** User-created indices (`gcp-docs`, `embeddings`, `metrics`) — these would
become index patterns in a Kibana deployment.

### Step 6.2 — Explore the Mapping (Schema Discovery)

```bash
curl -s "${ES_URL}/gcp-docs/_mapping" | jq '.["gcp-docs"].mappings.properties | keys'
```

**Expected result:** Array of field names — equivalent to Kibana's field discovery view.

### Step 6.3 — Perform a Discovery-Style Query

```bash
curl -s -X GET "${ES_URL}/gcp-docs/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 10,
    "sort": [{"published_at": {"order": "desc"}}],
    "query": {"match_all": {}}
  }' | jq '.hits.hits[] | {title: ._source.title, date: ._source.published_at}'
```

**Expected result:** All documents sorted by date descending — equivalent to Kibana's
Discover view.

### Step 6.4 — Simulate a Dashboard Aggregation

```bash
curl -s -X GET "${ES_URL}/gcp-docs/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "aggs": {
      "tag_breakdown": {
        "terms": {"field": "tags", "size": 20},
        "aggs": {
          "monthly_trend": {
            "date_histogram": {
              "field": "published_at",
              "calendar_interval": "month"
            }
          }
        }
      }
    }
  }' | jq '.aggregations.tag_breakdown.buckets[] | {tag: .key, monthly: [.monthly_trend.buckets[] | {month: .key_as_string, count: .doc_count}]}'
```

**Expected result:** Nested aggregation showing monthly document counts per tag — the data
a Kibana dashboard would visualise as a stacked bar chart.

---

## Exercise 7 — Cluster Operations

### Objective

Inspect node status, understand shard allocation, verify replication settings, and simulate
pod restart data durability testing.

### Step 7.1 — View Node Status

```bash
curl -s "${ES_URL}/_cat/nodes?v&h=name,version,heap.percent,disk.used_percent,cpu,load_1m"
```

**Expected result:** Single node with heap usage, disk usage, CPU, and load average.

### Step 7.2 — Check Shard Allocation

```bash
curl -s "${ES_URL}/_cat/shards?v&h=index,shard,prirep,state,docs,store,node"
```

**Expected result:** All primary shards in `STARTED` state. No replicas (configured as 0).

### Step 7.3 — View Cluster Allocation Settings

```bash
curl -s "${ES_URL}/_cluster/settings?include_defaults=true&flat_settings=true" \
  | jq 'to_entries | map(select(.key | test("allocation"))) | from_entries'
```

**Expected result:** Shard allocation settings, including `cluster.routing.allocation.enable: all`.

### Step 7.4 — Test Data Durability (Pod Restart)

```bash
# Record current document count
echo "Before restart: $(curl -s "${ES_URL}/gcp-docs/_count" | jq '.count') documents"

# Delete the pod (StatefulSet controller recreates it)
POD=$(kubectl get pods -n "${NAMESPACE}" \
  -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod "${POD}" -n "${NAMESPACE}"

# Watch the pod restart
kubectl get pods -n "${NAMESPACE}" -w
```

Wait for the pod to restart and Elasticsearch to recover (1–3 minutes), then:

```bash
curl -s "${ES_URL}/_cluster/health?wait_for_status=green&timeout=120s" | jq '.status'

# Verify data survived the restart
echo "After restart: $(curl -s "${ES_URL}/gcp-docs/_count" | jq '.count') documents"
```

**Expected result:** Document count matches before and after restart, confirming the PVC
persisted all data through the pod restart.

### Step 7.5 — Inspect the PVC and StorageClass

```bash
kubectl describe pvc -n "${NAMESPACE}"
kubectl get storageclass standard-rwo
```

**Expected result:** PVC shows `StorageClass: standard-rwo`, `RECLAIM POLICY: Delete`,
provisioner `pd.csi.storage.gke.io` (Google Persistent Disk CSI). The PVC is bound to a
persistent disk that survives pod deletion.

---

## Exercise 8 — Cloud Logging and Monitoring

### Objective

Explore Elasticsearch JVM and server logs via Cloud Logging, and review pod resource metrics
in Cloud Monitoring.

### Step 8.1 — View Elasticsearch Logs

**gcloud:**
```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\"" \
  --project="${PROJECT}" \
  --limit=50 \
  --freshness=1h
```

**REST API:**
```bash
curl -s -X POST \
  "https://logging.googleapis.com/v2/entries:list" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"resourceNames\": [\"projects/${PROJECT}\"],
    \"filter\": \"resource.type=\\\"k8s_container\\\" AND resource.labels.namespace_name=\\\"${NAMESPACE}\\\"\",
    \"orderBy\": \"timestamp desc\",
    \"pageSize\": 20
  }" | jq '.entries[] | {timestamp, textPayload}'
```

### Step 8.2 — Filter for Startup and Recovery Messages

In the Cloud Console Log Explorer:
```
resource.type="k8s_container"
resource.labels.namespace_name="${NAMESPACE}"
textPayload=~"started|recovered|shard|cluster"
```

**Expected result:** JVM initialisation messages, shard recovery completion, and cluster state
changes.

### Step 8.3 — Filter for Warnings or Errors

```bash
gcloud logging read \
  "resource.type=\"k8s_container\" \
   AND resource.labels.namespace_name=\"${NAMESPACE}\" \
   AND severity>=WARNING" \
  --project="${PROJECT}" \
  --limit=10
```

**Expected result:** Under normal operation, no errors. GC pause warnings (`[gc]`) may appear
if JVM heap is undersized.

### Step 8.4 — Check Live Pod Resource Usage

```bash
kubectl top pod -n "${NAMESPACE}"
```

**Expected result:** CPU and memory consumption. Memory usage typically stays close to the
JVM heap size setting (`es_java_heap = 512m`), so expect ~700–900 MiB total pod memory.

### Step 8.5 — View Pod Metrics in Cloud Monitoring

**REST API (MQL — memory):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_container | metric 'kubernetes.io/container/memory/used_bytes' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, memory_mb: (.pointData[-1].values[0].int64Value / 1024 / 1024 | floor)}'
```

**REST API (MQL — disk I/O):**
```bash
curl -s -X POST \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries:query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"fetch k8s_pod | metric 'kubernetes.io/pod/volume/used_bytes' | filter resource.namespace_name = '${NAMESPACE}' | within 30m | group_by [resource.pod_name, metric.volume_name], mean(val())\"
  }" | jq '.timeSeriesData[] | {pod: .labelValues[0].stringValue, volume: .labelValues[1].stringValue, used_gb: (.pointData[-1].values[0].int64Value / 1024 / 1024 / 1024)}'
```

**Expected result:** Disk usage for the PVC mounted at `/usr/share/elasticsearch/data`.

---

## Cleanup

Return to the RAD UI and click **Undeploy** on the `Elasticsearch_GKE` deployment. This
removes the StatefulSet, PVC and underlying persistent disk, Services, Kubernetes namespace,
and Artifact Registry mirrored image.

> **Warning:** Undeploy deletes the PVC and all indexed data permanently. Back up any data
> you need before undeploying.

### Manual Cleanup (if needed)

**kubectl:**
```bash
# Delete the namespace (removes StatefulSet, Services, PDB)
kubectl delete namespace "${NAMESPACE}"

# PVC deletion: happens automatically when StatefulSet is deleted in GKE
# (RECLAIM POLICY: Delete)
```

**gcloud:**
```bash
# Verify PVC and disk are deleted
kubectl get pvc --all-namespaces | grep elasticsearch

# Delete service account
GSA=$(gcloud iam service-accounts list \
  --project="${PROJECT}" \
  --filter="email~elasticsearch" \
  --format="value(email)" --limit=1)
gcloud iam service-accounts delete "${GSA}" \
  --project="${PROJECT}" --quiet
```

---

## Reference

### Key Module Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | string | — | GCP project ID (required) |
| `region` | string | `us-central1` | GCP region for all resources |
| `application_name` | string | `elasticsearch` | Base name for Kubernetes and GCP resources |
| `application_version` | string | `8.13.4` | Elasticsearch image tag |
| `cpu_limit` | string | `2000m` | CPU limit per pod |
| `memory_limit` | string | `4Gi` | Memory limit (must be ≥ 2× `es_java_heap`) |
| `es_java_heap` | string | `512m` | JVM `-Xms`/`-Xmx` heap size |
| `cluster_name` | string | `ragflow` | Elasticsearch `cluster.name` |
| `enable_xpack_security` | bool | `false` | Enable X-Pack TLS and authentication |
| `stateful_pvc_size` | string | `30Gi` | PVC storage size |
| `stateful_pvc_storage_class` | string | `standard-rwo` | Kubernetes StorageClass |
| `service_type` | string | `LoadBalancer` | `ClusterIP` or `LoadBalancer` |
| `min_instance_count` | number | `1` | Keep at 1 for single-node mode |
| `max_instance_count` | number | `1` | Keep at 1 for single-node mode |
| `gke_cluster_name` | string | `""` | Target GKE cluster (auto-discovered when empty) |
| `tenant_deployment_id` | string | `demo` | Tenant identifier in resource names |
| `deploy_application` | bool | `true` | Deploy the Elasticsearch StatefulSet |

### Useful Commands

```bash
# Set ES URL
ES_URL="http://${EXTERNAL_IP}:9200"

# Cluster health
curl "${ES_URL}/_cluster/health" | jq

# List indices
curl "${ES_URL}/_cat/indices?v"

# List nodes
curl "${ES_URL}/_cat/nodes?v"

# Create index
curl -X PUT "${ES_URL}/my-index" -H "Content-Type: application/json" -d '{"settings":{"number_of_replicas":0}}'

# Index a document
curl -X POST "${ES_URL}/my-index/_doc" -H "Content-Type: application/json" -d '{"field":"value"}'

# Search
curl "${ES_URL}/my-index/_search?q=field:value" | jq '.hits.hits[]._source'

# Delete index
curl -X DELETE "${ES_URL}/my-index"

# Pod logs
kubectl logs -l app=elasticsearch -n ${NAMESPACE} --tail=100

# Resource usage
kubectl top pod -n ${NAMESPACE}
```

### Further Reading

- [Elasticsearch documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/)
- [Elasticsearch k-NN search](https://www.elastic.co/guide/en/elasticsearch/reference/current/knn-search.html)
- [Elasticsearch aggregations](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations.html)
- [RAGFlow documentation](https://ragflow.io/docs/)
- [GKE StatefulSets](https://cloud.google.com/kubernetes-engine/docs/concepts/statefulset)
- [GKE Persistent Volumes](https://cloud.google.com/kubernetes-engine/docs/concepts/persistent-volumes)
- [Cloud Logging for GKE](https://cloud.google.com/stackdriver/docs/solutions/gke/installing)
