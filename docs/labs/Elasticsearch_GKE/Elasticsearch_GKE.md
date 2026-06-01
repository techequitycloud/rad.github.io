---
title: "Elasticsearch on GKE — Lab Guide"
sidebar_label: "Elasticsearch GKE"
---

# Elasticsearch on GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Elasticsearch_GKE)**

## Overview

**Estimated time:** 1.5–2.5 hours

This lab deploys a single-node Elasticsearch cluster on GKE Autopilot using a StatefulSet with a persistent SSD-backed PersistentVolumeClaim. Elasticsearch provides full-text search, vector search, and document indexing — commonly used as a backend for RAGFlow and other AI-powered search applications.

### What the Module Automates

- Mirrors the official Elasticsearch container image from `docker.elastic.co` into Artifact Registry
- Creates a Kubernetes namespace for Elasticsearch
- Deploys a StatefulSet with one Elasticsearch pod, configured for single-node discovery
- Provisions a PersistentVolumeClaim (30 Gi, `standard-rwo` StorageClass) for durable data storage
- Creates a headless Kubernetes Service for stable pod DNS
- Creates a LoadBalancer Kubernetes Service exposing port 9200 for cross-namespace access
- Configures Workload Identity for the pod service account
- Sets JVM heap size, cluster name, and other Elasticsearch settings via environment variables
- Creates a PodDisruptionBudget to protect availability during voluntary disruptions

### What You Do Manually

- Note the deployment outputs (external IP, namespace, etc.) from the RAD UI deployment panel
- Obtain GKE cluster credentials with `gcloud`
- Verify the StatefulSet pod and PVC are healthy
- Check cluster health, node stats, and index state via the Elasticsearch REST API
- Index and search documents using `curl`
- Perform a k-NN vector search to explore semantic search capabilities
- Verify data persists across pod restarts
- Inspect X-Pack security settings (if enabled)
- Review Elasticsearch JVM and server logs in Cloud Logging
- Monitor pod resource usage and disk I/O in Cloud Monitoring

---

## CLI and REST API Overview

Elasticsearch is managed via its HTTP REST API. Use `kubectl` for cluster operations and `curl` for Elasticsearch operations.

```bash
# Kubernetes cluster access
gcloud container clusters get-credentials <cluster> --region <region> --project <project>
kubectl get statefulset -n <namespace>
kubectl get pvc -n <namespace>
kubectl get svc -n <namespace>

# Elasticsearch REST API (after port-forward or via LoadBalancer IP)
curl http://localhost:9200/_cluster/health | jq
curl http://localhost:9200/_cat/indices?v
curl http://localhost:9200/_nodes/stats | jq
```

---

## Prerequisites

- Services GCP deployed in the same GCP project (provides the VPC, GKE Autopilot cluster, and Artifact Registry)
- Access to the RAD UI with permission to deploy modules in the target GCP project
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- `kubectl` installed
- `curl` and `jq` installed locally
- GCP project ID

---

## Phase 1 — Deploy [AUTOMATED]

### Variables

Variables are configured in the RAD UI form before deploying. Use the table below to understand what each field controls.

| Variable | Required | Default | Description |
|---|---|---|---|
| `project_id` | Yes | — | GCP project ID |
| `deployment_id` | No | auto-generated | Suffix appended to resource names |
| `tenant_deployment_id` | No | `demo` | Unique identifier for this deployment environment |
| `region` | No | `us-central1` | GCP region for resource deployment |
| `application_name` | No | `elasticsearch` | Internal identifier used in resource naming |
| `application_version` | No | `8.13.4` | Elasticsearch image tag (e.g., `8.13.4`, `8.11.0`) |
| `deploy_application` | No | `true` | Deploy the Kubernetes StatefulSet |
| `min_instance_count` | No | `1` | Minimum pod replicas (keep at 1 for single-node) |
| `max_instance_count` | No | `1` | Maximum pod replicas (keep at 1 for single-node) |
| `cpu_limit` | No | `2000m` | CPU limit for the Elasticsearch container |
| `memory_limit` | No | `4Gi` | Memory limit (must be at least 2× `es_java_heap`) |
| `es_java_heap` | No | `512m` | JVM heap size (`-Xms`/`-Xmx`); max half of `memory_limit` |
| `cluster_name` | No | `ragflow` | Elasticsearch `cluster.name` property |
| `enable_xpack_security` | No | `false` | Enable X-Pack TLS and authentication |
| `stateful_pvc_size` | No | `30Gi` | PVC storage size for Elasticsearch data |
| `stateful_pvc_storage_class` | No | `standard-rwo` | Kubernetes StorageClass for the PVC |
| `service_type` | No | `LoadBalancer` | Kubernetes Service type (`ClusterIP` or `LoadBalancer`) |
| `gke_cluster_name` | No | `""` | GKE cluster name; leave empty to auto-discover |
| `namespace_name` | No | `""` | Kubernetes namespace; leave empty to auto-generate |
| `resource_labels` | No | `{}` | Labels applied to all resources |

### Initiate Deployment

Deployment is initiated from the RAD UI. Fill in the variable form and click **Deploy**.

### Estimated Deployment Duration

| Phase | Duration |
|---|---|
| Image mirroring to Artifact Registry | 3–5 min |
| Kubernetes namespace creation | < 1 min |
| StatefulSet and PVC provisioning | 3–7 min |
| Elasticsearch startup (JVM init, shard recovery) | 2–4 min |
| **Total** | **8–17 min** |

> GKE Autopilot must provision a new node and attach the PVC before the container starts. Allow extra time (up to 10 minutes) on first deployment.

### Record Outputs

After deployment completes, the following outputs are available in the RAD UI deployment panel.

| Output | Description |
|---|---|
| `elasticsearch_endpoint` | Full HTTP endpoint (e.g., `http://<ip>:9200`) — pass to RAGFlow as `elasticsearch_hosts` |
| `service_external_ip` | External IP of the LoadBalancer Service |
| `service_name` | Kubernetes Service name |
| `namespace` | Kubernetes namespace for the Elasticsearch pod |
| `deployment_id` | Generated deployment suffix used in all resource names |
| `container_image` | Full image URI used for the StatefulSet pod |

Set shell variables for use in later steps using discovery commands:

```bash
export PROJECT="your-gcp-project-id"   # set this first — your GCP project ID
export REGION="us-central1"             # the region you deployed into
export TOKEN=$(gcloud auth print-access-token)

# Discover the GKE cluster
export CLUSTER=$(gcloud container clusters list \
  --project=${PROJECT} \
  --format="value(name)" \
  --limit=1)

# Configure kubectl
gcloud container clusters get-credentials ${CLUSTER} \
  --region=${REGION} \
  --project=${PROJECT}

# Discover the namespace (pattern: app<appname><tenant><deploymentid>)
export NAMESPACE=$(kubectl get namespaces --no-headers \
  -o custom-columns=":metadata.name" | grep "^appelasticsearch" | head -1)

# Discover the external IP
export EXTERNAL_IP=$(kubectl get svc -n ${NAMESPACE} \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
```

---

## Phase 2 — Configure kubectl Access [MANUAL]

### Steps

1. Obtain GKE cluster credentials:

   ```bash
   gcloud container clusters get-credentials ${CLUSTER} \
     --region ${REGION} \
     --project ${PROJECT}
   ```

   **gcloud equivalent:**
   ```bash
   # List available clusters
   gcloud container clusters list --project ${PROJECT}
   ```

2. Verify the StatefulSet is running:

   ```bash
   kubectl get statefulset -n ${NAMESPACE}
   ```

   **Expected result:**
   ```
   NAME                      READY   AGE
   elasticsearch-<suffix>    1/1     8m
   ```

3. Verify the PVC is bound to a persistent disk:

   ```bash
   kubectl get pvc -n ${NAMESPACE}
   ```

   **Expected result:**
   ```
   NAME                          STATUS   VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS    AGE
   data-elasticsearch-<suffix>   Bound    pvc-xxx  30Gi       RWO            standard-rwo    8m
   ```

4. Verify the LoadBalancer Service has received an external IP:

   ```bash
   kubectl get svc -n ${NAMESPACE}
   ```

   **Expected result:** The LoadBalancer Service shows an `EXTERNAL-IP` (may take 1–2 minutes to provision).

---

## Phase 3 — Verify Cluster Health [MANUAL]

### Steps

1. Set the Elasticsearch endpoint. Either use the LoadBalancer IP or port-forward:

   **Option A — Use the LoadBalancer external IP (from the RAD UI deployment panel):**
   ```bash
   ES_URL="http://${EXTERNAL_IP}:9200"
   ```

   **Option B — Port-forward for local access:**
   ```bash
   kubectl port-forward svc/<service-name> 9200:9200 -n ${NAMESPACE}
   ES_URL="http://localhost:9200"
   ```

2. Check cluster health:

   ```bash
   curl "${ES_URL}/_cluster/health" | jq
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

   > A `yellow` status is normal for a single-node cluster with indices that have replicas configured (replicas cannot be assigned on a single node).

3. Verify node information:

   ```bash
   curl "${ES_URL}/_nodes/stats" | jq '.nodes | to_entries[0].value | {name: .name, version: .version, heap_used_percent: .jvm.mem.heap_used_percent}'
   ```

   **Expected result:** Node name, Elasticsearch version, and current JVM heap usage percentage.

4. Check the index catalogue:

   ```bash
   curl "${ES_URL}/_cat/indices?v"
   ```

   **Expected result:** A table of existing indices. Initially shows only system indices (`.kibana_*`, etc.) or is empty.

5. Check cluster settings:

   ```bash
   curl "${ES_URL}/_cluster/settings?pretty"
   ```

   **REST API equivalent (if X-Pack is enabled):**
   ```bash
   curl -u elastic:<password> "${ES_URL}/_cluster/health" | jq
   ```

---

## Phase 4 — Index and Search Documents [MANUAL]

### Steps

1. Create a test index:

   ```bash
   curl -X PUT "${ES_URL}/gcp-docs" \
     -H "Content-Type: application/json" \
     -d '{
       "settings": {
         "number_of_shards": 1,
         "number_of_replicas": 0
       }
     }' | jq
   ```

   **Expected result:** `{"acknowledged": true, "shards_acknowledged": true, "index": "gcp-docs"}`

2. Index a document:

   ```bash
   curl -X POST "${ES_URL}/gcp-docs/_doc" \
     -H "Content-Type: application/json" \
     -d '{
       "title": "Cloud Run",
       "content": "Cloud Run is a managed compute platform that lets you run containers directly on top of Googles scalable infrastructure.",
       "tags": ["serverless", "containers", "gcp"]
     }' | jq
   ```

3. Index a second document:

   ```bash
   curl -X POST "${ES_URL}/gcp-docs/_doc" \
     -H "Content-Type: application/json" \
     -d '{
       "title": "GKE Autopilot",
       "content": "GKE Autopilot is a mode of operation in GKE where Google manages cluster configuration, scaling, and node provisioning.",
       "tags": ["kubernetes", "containers", "gcp"]
     }' | jq
   ```

4. Search with a query string:

   ```bash
   curl "${ES_URL}/gcp-docs/_search?q=Cloud+Run" | jq '.hits.hits[] | {title: ._source.title, score: ._score}'
   ```

   **Expected result:** The Cloud Run document appears first with the highest relevance score.

5. Search with a full-text query DSL:

   ```bash
   curl -X GET "${ES_URL}/gcp-docs/_search" \
     -H "Content-Type: application/json" \
     -d '{
       "query": {
         "match": {
           "content": "containers managed"
         }
       }
     }' | jq '.hits.hits[] | ._source.title'
   ```

   **Expected result:** Both documents are returned (both mention containers), with the more relevant one ranked higher.

---

## Phase 5 — Vector Search [MANUAL]

Elasticsearch's `dense_vector` field type enables k-NN (nearest neighbour) similarity search. This is how RAGFlow uses Elasticsearch for semantic document retrieval.

### Steps

1. Create an index with a `dense_vector` field:

   ```bash
   curl -X PUT "${ES_URL}/embeddings" \
     -H "Content-Type: application/json" \
     -d '{
       "mappings": {
         "properties": {
           "text": { "type": "text" },
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

2. Index a document with a small example embedding:

   ```bash
   curl -X POST "${ES_URL}/embeddings/_doc" \
     -H "Content-Type: application/json" \
     -d '{
       "text": "Cloud Run deploys containers on Google infrastructure",
       "embedding": [0.8, 0.3, 0.1, 0.5]
     }' | jq
   ```

3. Index a second document:

   ```bash
   curl -X POST "${ES_URL}/embeddings/_doc" \
     -H "Content-Type: application/json" \
     -d '{
       "text": "Kubernetes manages containerised workloads",
       "embedding": [0.7, 0.4, 0.2, 0.6]
     }' | jq
   ```

4. Perform a k-NN search (find the most similar document to a query vector):

   ```bash
   curl -X GET "${ES_URL}/embeddings/_search" \
     -H "Content-Type: application/json" \
     -d '{
       "knn": {
         "field": "embedding",
         "query_vector": [0.75, 0.35, 0.15, 0.55],
         "k": 2,
         "num_candidates": 10
       }
     }' | jq '.hits.hits[] | {text: ._source.text, score: ._score}'
   ```

   **Expected result:** Both documents are returned, ranked by cosine similarity to the query vector. In production, the `embedding` field would store high-dimensional vectors (e.g., 768 or 1536 dimensions) produced by an embedding model.

5. In RAGFlow's architecture, document chunks are embedded using a language model and stored here. User queries are embedded at query time and a k-NN search retrieves semantically relevant chunks, which are then passed to an LLM for answer generation.

---

## Phase 6 — Explore Persistent Storage [MANUAL]

The StatefulSet uses a PVC to ensure Elasticsearch data survives pod restarts and node replacements.

### Steps

1. Describe the PVC to confirm the storage class and disk type:

   ```bash
   kubectl describe pvc -n ${NAMESPACE}
   ```

   **Expected result:** PVC details showing `StorageClass: standard-rwo`, volume mode `Filesystem`, capacity `30Gi`, and the provisioner `pd.csi.storage.gke.io` (Google Persistent Disk CSI driver).

2. Verify the mount path inside the running pod:

   ```bash
   kubectl exec -it <pod-name> -n ${NAMESPACE} -- df -h /usr/share/elasticsearch/data
   ```

   **Expected result:** A filesystem mounted at `/usr/share/elasticsearch/data` with the configured capacity.

3. Simulate a pod restart to verify data durability. First, verify the index you created in Phase 4 exists, then delete and recreate the pod:

   ```bash
   # Verify the index exists
   curl "${ES_URL}/gcp-docs/_count" | jq '.count'

   # Delete the pod (the StatefulSet controller recreates it immediately)
   kubectl delete pod <pod-name> -n ${NAMESPACE}

   # Wait for the pod to restart
   kubectl get pods -n ${NAMESPACE} -w
   ```

4. After the pod restarts (1–3 minutes for Elasticsearch to recover), verify the data is still present:

   ```bash
   curl "${ES_URL}/gcp-docs/_count" | jq '.count'
   ```

   **Expected result:** The document count matches what was there before the restart, confirming that the PVC persisted the data through the pod lifecycle.

5. Check the storage class details:

   ```bash
   kubectl get storageclass standard-rwo
   ```

   **Expected result:** StorageClass backed by `pd.csi.storage.gke.io` with `RECLAIM POLICY: Delete` and `VOLUME BINDING MODE: WaitForFirstConsumer`.

---

## Phase 7 — X-Pack Security (if enabled) [MANUAL]

This phase applies only when `enable_xpack_security = true` was set during deployment.

### Steps

1. Verify that unauthenticated requests are rejected:

   ```bash
   curl "${ES_URL}/_cluster/health"
   ```

   **Expected result:** HTTP 401 Unauthorized response.

2. Open a shell in the Elasticsearch pod to generate an enrollment token:

   ```bash
   kubectl exec -it <pod-name> -n ${NAMESPACE} -- bash
   ```

3. Inside the pod, generate an enrollment token for Kibana (or other clients):

   ```bash
   /usr/share/elasticsearch/bin/elasticsearch-create-enrollment-token --scope kibana
   ```

4. Reset the `elastic` superuser password:

   ```bash
   /usr/share/elasticsearch/bin/elasticsearch-reset-password -u elastic
   ```

   **Expected result:** A new password is printed. Store it securely.

5. Exit the pod and test authenticated access:

   ```bash
   curl -u elastic:<password> "${ES_URL}/_cluster/health" | jq
   ```

6. Explore security settings:

   ```bash
   curl -u elastic:<password> "${ES_URL}/_security/user" | jq 'keys'
   ```

   **Expected result:** A list of built-in users (`elastic`, `kibana`, `logstash_system`, etc.).

---

## Phase 8 — Explore Cloud Logging [MANUAL]

Elasticsearch writes JVM and server logs to stdout/stderr, which GKE captures and forwards to Cloud Logging.

### Steps

1. In the Google Cloud Console, navigate to **Logging > Log Explorer**.

2. Filter logs to the Elasticsearch namespace:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   ```

3. Look for Elasticsearch startup messages (JVM initialisation and shard recovery):

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   textPayload=~"started|recovered|shard"
   ```

4. Using the `gcloud` CLI:

   ```bash
   gcloud logging read \
     'resource.type="k8s_container" AND resource.labels.namespace_name="'${NAMESPACE}'"' \
     --project=${PROJECT} \
     --limit=50 \
     --freshness=1h
   ```

5. Filter for warnings or errors:

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="${NAMESPACE}"
   severity>=WARNING
   ```

   **Expected result:** Under normal operation you should see no errors. GC pause warnings may appear if the JVM heap is undersized.

---

## Phase 9 — Explore Cloud Monitoring [MANUAL]

### Steps

1. Check live pod resource usage:

   ```bash
   kubectl top pod -n ${NAMESPACE}
   ```

   **Expected result:** CPU and memory consumption for the Elasticsearch pod. Memory usage typically stays close to the JVM heap size setting.

2. In the Google Cloud Console, navigate to **Monitoring > Metrics Explorer**.

3. Plot **Memory used** for the Elasticsearch pod:
   - Metric: `kubernetes.io/container/memory/used_bytes`
   - Filter: `namespace_name = ${NAMESPACE}`

4. Plot **CPU utilisation** for the Elasticsearch pod:
   - Metric: `kubernetes.io/container/cpu/request_utilization`
   - Filter: `namespace_name = ${NAMESPACE}`

5. In Cloud Console, navigate to **Kubernetes Engine > Workloads**, select the Elasticsearch StatefulSet, and explore the built-in **Observability** tab showing CPU, memory, and restart count graphs.

6. To monitor disk I/O on the PVC:
   - Metric: `kubernetes.io/pod/volume/used_bytes`
   - Filter: `namespace_name = ${NAMESPACE}`, `volume_name = data-<pod-name>`

---

## Phase 10 — Undeploy [AUTOMATED]

When you are finished, return to the RAD UI, navigate to your deployment, and click **Undeploy** (or **Delete**) to remove all resources provisioned by this module.

This removes the StatefulSet, PVC (and underlying persistent disk), Services, Kubernetes namespace, and Artifact Registry mirrored image.

> **Warning:** Undeploying the module deletes the PVC and all indexed data permanently. Back up any data you want to keep before undeploying.

**Expected duration:** 3–6 minutes.

Resources provisioned by the `Services GCP` module (VPC, Cloud SQL instance, GKE cluster) are managed separately and must be undeployed via their own RAD UI deployment entry.

---

## Summary

| Phase | Type | Key Action |
|---|---|---|
| Phase 1 — Deploy | AUTOMATED | RAD UI provisions StatefulSet, PVC, and LoadBalancer Service |
| Phase 2 — kubectl Access | MANUAL | `gcloud container clusters get-credentials`, verify StatefulSet and PVC |
| Phase 3 — Cluster Health | MANUAL | `curl /_cluster/health`, verify node stats and index catalogue |
| Phase 4 — Index and Search | MANUAL | Create index, index documents, run full-text queries |
| Phase 5 — Vector Search | MANUAL | Create dense_vector index, perform k-NN similarity search |
| Phase 6 — Persistent Storage | MANUAL | Verify PVC binding, restart pod, confirm data durability |
| Phase 7 — X-Pack Security | MANUAL | Verify auth, generate enrollment tokens (if enabled) |
| Phase 8 — Cloud Logging | MANUAL | Filter GKE container logs for JVM and server events |
| Phase 9 — Cloud Monitoring | MANUAL | Review pod CPU, memory, and disk I/O metrics |
| Phase 10 — Undeploy | AUTOMATED | RAD UI removes all module resources and data |
