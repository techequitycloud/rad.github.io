# PCD Certification Preparation Guide: Section 4 — Integrating applications with Google Cloud services (~21% of the exam)

This guide helps candidates preparing for the Google Cloud Professional Cloud Developer (PCD) certification explore Section 4 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **Services GCP**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCD objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 4.1 Integrating applications with data and storage services

### Managing Connections to Datastores
**Concept:** Securely connecting applications to Google Cloud datastores (Cloud SQL, Cloud Storage) without exposing credentials or network endpoints.

**In the RAD UI:**
*   **Cloud SQL Auth Proxy:** The `enable_cloudsql_volume` variable (Group 3 for App CloudRun; §3.B Database for App GKE) automatically injects the Cloud SQL Auth Proxy as a sidecar container. The proxy establishes an encrypted tunnel to Cloud SQL using IAM-based authentication — no SSL certificate management, no public IP exposure, and no database password embedded in connection strings. Your application code connects to the database via a Unix socket (`/cloudsql/<instance-connection-name>`) mounted as a volume in the container.
*   **Cloud Storage Integration:** The `storage_buckets` variable (Group 9 for App CloudRun; §3.C Storage for App GKE) provisions Cloud Storage buckets and mounts them into running containers using the **Cloud Storage FUSE CSI driver**. The bucket appears as a local directory inside the container — your application can use standard filesystem operations (`open()`, `read()`, `write()`) rather than the Cloud Storage client library API. This is well-suited for reading large static assets, model files, or configuration data at startup.

**Console Exploration:**
Navigate to **Cloud Run** or **Kubernetes Engine**, select the deployment, and look at the **Volumes** configuration to see how Cloud SQL sockets and Cloud Storage buckets are mounted into the container runtime. For Cloud Run, inspect the **Edit & deploy new revision** panel and click the **Volumes** tab — you will see the Cloud SQL connection volume and the Cloud Storage FUSE volume listed alongside any Secret Manager secret volumes.

> **Real-World Example:** A Cloud Run service connects to a Cloud SQL PostgreSQL database using the Cloud SQL Auth Proxy sidecar. The database connection string is `postgresql://app_user:${DB_PASSWORD}@/appdb?host=/cloudsql/project:region:instance`. The `DB_PASSWORD` is injected from Secret Manager as an environment variable — not hard-coded. The proxy handles IAM authentication, TLS, and connection pooling. The service account running the Cloud Run service has `roles/cloudsql.client` on the instance — the only IAM role required. No VPC peering, no SSL certificate, and no publicly exposed Cloud SQL IP address are needed.

### Integrating with Additional Datastores

**Cloud Firestore:**
Firestore is Google Cloud's serverless, schemaless NoSQL document database. Applications connect to Firestore using the client library — no connection string, no proxy, and no persistent connection management. The client library uses Application Default Credentials (ADC) automatically:
```python
from google.cloud import firestore

db = firestore.Client()

# Write a document
doc_ref = db.collection("orders").document("order-123")
doc_ref.set({"status": "pending", "amount": 49.99, "user_id": "user-456"})

# Read a document
doc = doc_ref.get()
print(doc.to_dict())

# Query with filter
orders = db.collection("orders").where("status", "==", "pending").stream()
for order in orders:
    print(order.id, order.to_dict())
```
Firestore supports **real-time listeners** — clients can subscribe to document or collection changes and receive updates instantly without polling:
```python
def on_snapshot(doc_snapshot, changes, read_time):
    for doc in doc_snapshot:
        print("Updated:", doc.to_dict())

doc_ref.on_snapshot(on_snapshot)
```
Navigate to **Firestore > Data** to browse collections and documents. Navigate to **Firestore > Indexes** to manage composite indexes — Firestore requires explicit composite indexes for queries that filter on multiple fields.

**AlloyDB Auth Proxy:**
AlloyDB for PostgreSQL uses the **AlloyDB Auth Proxy** — conceptually identical to the Cloud SQL Auth Proxy. Deploy it as a sidecar container and connect your application via the Unix socket path `/var/run/alloydb/alloydb.sock`. The proxy handles IAM authentication and TLS. Your service account requires `roles/alloydb.client` on the AlloyDB cluster. Navigate to **AlloyDB > Clusters** to explore instance configuration, read pool replicas, and connection management.

### 💡 Additional Data Integration Objectives & Learning Guidelines

*   **Pub/Sub Messaging — Publish and Consume:** The PCD exam expects you to write application code that interacts with Pub/Sub. Practice the full publish/subscribe pattern:

    **Publisher:**
    ```python
    from google.cloud import pubsub_v1

    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path("my-project", "my-topic")

    message_data = json.dumps({"order_id": "123", "amount": 49.99}).encode("utf-8")
    future = publisher.publish(topic_path, message_data, origin="order-service")
    print(f"Published message ID: {future.result()}")
    ```

    **Subscriber (pull):**
    ```python
    from google.cloud import pubsub_v1

    subscriber = pubsub_v1.SubscriberClient()
    subscription_path = subscriber.subscription_path("my-project", "my-subscription")

    def callback(message):
        payload = json.loads(message.data.decode("utf-8"))
        print(f"Processing order: {payload['order_id']}")
        message.ack()  # Acknowledge to prevent redelivery

    streaming_pull_future = subscriber.subscribe(subscription_path, callback=callback)
    streaming_pull_future.result()  # Block until cancelled
    ```
    Message attributes (like `origin="order-service"` in the publish call above) are key-value strings attached to the message envelope — useful for routing, filtering, and dead-letter queue configuration. Navigate to **Pub/Sub > Topics** and **Pub/Sub > Subscriptions** to create topics, configure subscriptions (pull vs push), and set up dead-letter topics for messages that fail processing after a configurable number of delivery attempts.

    > **Real-World Example:** An e-commerce platform decouples its order service from the fulfilment service using Pub/Sub. When a customer places an order, the order service publishes a message to the `orders` topic. Three subscribers consume from the same topic via separate subscriptions: the fulfilment service schedules the shipment, the analytics service records the transaction, and the email service sends a confirmation. If the fulfilment service is temporarily unavailable, Pub/Sub retains the message and retries delivery — the order service is unaffected. A dead-letter topic captures any message that fails after 5 delivery attempts for manual investigation.

*   **Cloud Storage — Reading and Writing Objects:** For applications that need programmatic Cloud Storage access (rather than FUSE mounting), use the client library:
    ```python
    from google.cloud import storage

    client = storage.Client()
    bucket = client.bucket("my-bucket")

    # Upload
    blob = bucket.blob("reports/2025-01.pdf")
    blob.upload_from_filename("/tmp/report.pdf")

    # Download
    blob.download_to_filename("/tmp/downloaded-report.pdf")

    # Generate a Signed URL for temporary delegated access (no auth required by recipient)
    url = blob.generate_signed_url(expiration=datetime.timedelta(hours=1), method="GET")
    ```
    **Signed URLs** are time-limited, pre-authenticated URLs that allow anyone with the URL to access a specific object — useful for sharing files with users who do not have a Google account. The URL expires after the configured duration; after expiry, the URL returns HTTP 403.

---

## 4.2 Consuming Google Cloud APIs

### Enabling Services and Authentication
**Concept:** Enabling APIs and using service accounts to securely authenticate application requests to Google Cloud services.

**In the RAD UI:**
*   **API Enablement:** The RAD platform automatically enables all necessary GCP APIs (e.g., Secret Manager API, Cloud SQL Admin API, Kubernetes Engine API) during deployment. In a new project, APIs must be explicitly enabled before any client library call will succeed — a disabled API returns HTTP 403 `SERVICE_DISABLED`.
*   **Service Accounts and ADC:** The platform provisions dedicated custom service accounts (e.g., `cloud_run_sa` or `gke_sa`) with the minimum required IAM roles and uses Workload Identity to bind them to the compute environment. The **Application Default Credentials (ADC)** chain means that application code using the standard Google Cloud client libraries requires no explicit credential configuration — the library automatically discovers credentials from the environment in this order:
    1. `GOOGLE_APPLICATION_CREDENTIALS` environment variable (points to a service account key file — discouraged in production)
    2. Workload Identity (for GKE) or the Cloud Run metadata server (for Cloud Run) — the library calls the instance metadata endpoint to obtain short-lived tokens
    3. `gcloud auth application-default login` credentials (for local development)

**Console Exploration:**
Navigate to **APIs & Services > Enabled APIs & services** to view all activated APIs in the project and their current usage (requests per day). Navigate to **IAM & Admin > Service Accounts** to view the application service accounts and their assigned roles. Click a service account and select the **Keys** tab — in a well-configured production environment, this list should be empty (no JSON key files in use).

### Best Practices for Consuming Google Cloud APIs

**Google Cloud Client Libraries:**
Always use the official Google Cloud client libraries rather than making raw HTTP or gRPC calls directly. The client libraries handle:
- **ADC authentication** — automatic credential discovery and token refresh
- **Retry logic with exponential backoff** — built-in handling of transient errors (HTTP 429, 500, 503) without custom code
- **gRPC vs REST transport** — most libraries support both; gRPC is the default for services that support it (Pub/Sub, Bigtable, Spanner) because it provides lower latency via HTTP/2 multiplexing and binary Protocol Buffer serialisation vs text-based JSON

**gRPC vs REST:**
- **gRPC:** Binary Protocol Buffer encoding, multiplexed over HTTP/2, strongly typed contracts defined in `.proto` files. Lower latency and higher throughput for high-volume API calls (e.g., Bigtable reads, Pub/Sub publish). Requires gRPC support on the client and server.
- **REST/JSON:** Text-based, uses HTTP/1.1, universally supported. Appropriate for low-frequency API calls, browser clients, and situations where tooling support for gRPC is limited.
- Most Google Cloud client libraries abstract this choice — select gRPC or REST via a library configuration option if you need to override the default.

**API Explorer:**
Navigate to **APIs & Services > API Library** and select any enabled API, then click **Try this API** to open the API Explorer. The API Explorer allows you to make authenticated API calls directly from your browser — useful for understanding request/response formats, testing field masks, and exploring API methods before writing application code.

> **Real-World Example:** A developer is building a Cloud Run service that needs to list Compute Engine instances programmatically. They open the API Explorer for the Compute Engine API, select the `instances.list` method, enter their project ID and zone, and click Execute. The response shows the full JSON representation of each instance. They then add a `fields` parameter (field mask) to restrict the response to only `items/name,items/status` — the response is 80% smaller and the code they write models only the fields they need.

### 💡 Additional API Consumption Objectives & Learning Guidelines

*   **Batching requests:** Some Google Cloud REST APIs support combining multiple operations into a single HTTP call to reduce network round-trips. The Google API Client Library exposes batching via `new_batch_http_request()`:
    ```python
    from googleapiclient.discovery import build

    service = build('storage', 'v1')
    batch = service.new_batch_http_request()

    results = {}
    def callback(request_id, response, exception):
        if exception is None:
            results[request_id] = response

    batch.add(service.objects().get(bucket='my-bucket', object='file1.txt'),
              callback=callback, request_id='r1')
    batch.add(service.objects().get(bucket='my-bucket', object='file2.txt'),
              callback=callback, request_id='r2')

    batch.execute()  # Single HTTP call executes all queued operations
    ```
    Batching is most valuable when making many small API calls in a loop — fetching metadata for 50 Cloud Storage objects individually requires 50 round-trips; batching them into one call reduces this to a single round-trip. Not all APIs support batching — it applies to REST-based APIs (Cloud Storage JSON API, Compute Engine API) but not to gRPC-based APIs (Bigtable, Spanner, Pub/Sub), which use server-side streaming for equivalent high-throughput patterns.

*   **Exponential Backoff for Error Handling:** Google Cloud APIs are designed for retryable errors (HTTP 429 Too Many Requests, 500 Internal Server Error, 503 Service Unavailable). The correct response is to retry with exponential backoff — not to fail immediately. The pattern:
    ```python
    import time, random

    def call_with_retry(fn, max_retries=5):
        for attempt in range(max_retries):
            try:
                return fn()
            except google.api_core.exceptions.ServiceUnavailable:
                if attempt == max_retries - 1:
                    raise
                wait = (2 ** attempt) + random.uniform(0, 1)  # jitter
                time.sleep(wait)
    ```
    The Google Cloud client libraries apply this logic automatically for most retryable errors — the above pattern is only needed when making direct HTTP calls or implementing custom retry logic.

*   **Field Masks for Restricting Return Data:** Many GCP APIs support **field masks** (via the `fields` query parameter for REST, or `FieldMask` proto for gRPC) to restrict which fields are returned in a response. This reduces response size, network transfer costs, and client-side parsing work:
    ```python
    from google.cloud import compute_v1
    from google.protobuf import field_mask_pb2

    client = compute_v1.InstancesClient()
    request = compute_v1.ListInstancesRequest(
        project="my-project",
        zone="us-central1-a",
    )
    # Only return name and status fields
    for instance in client.list(request=request):
        print(instance.name, instance.status)
    ```

*   **Paginating Large Result Sets:** APIs that return lists of resources (e.g., Cloud Storage objects, BigQuery table rows, Pub/Sub subscriptions) paginate results — they return a fixed number of items per response plus a `nextPageToken`. Always implement pagination to handle large result sets correctly. Google Cloud client libraries handle pagination automatically via iterators — iterating over the response object automatically fetches subsequent pages.

*   **Caching API Responses:** For read-heavy workloads where data changes infrequently, cache API responses to reduce latency and cost. Use **Cloud Memorystore for Redis** as a distributed cache for Cloud Run and GKE workloads. Set a cache TTL appropriate to how frequently the underlying data changes. Always implement cache invalidation logic for data that changes on write.

---

## 4.3 Troubleshooting and observability

### Identifying and Resolving Issues
**Concept:** Instrumenting application code and using Google Cloud Observability tools to diagnose, troubleshoot, and resolve issues in production.

**In the RAD UI:**
*   **Logs and Metrics:** The platform automatically captures `stdout`/`stderr` logs from containers. Cloud Run and GKE route these to **Cloud Logging** automatically. The `support_users` variable (Group 1) configures notification channels for alert policies — when a metric threshold is breached (e.g., error rate > 1%), an email or PagerDuty notification is sent to the configured recipients.
*   **Custom Dashboards:** Operational dashboards are provisioned automatically for each deployment, tracking request latency (p50/p95/p99), request counts, error rates, and container CPU/memory usage over time.

**Console Exploration:**
Navigate to **Monitoring > Alerting** to review alert policies and their MQL-based conditions. Navigate to **Logging > Logs Explorer** to view and filter application log streams. In Logs Explorer, use the query builder to filter by:
- `resource.type="cloud_run_revision"` — Cloud Run logs
- `resource.type="k8s_container"` — GKE container logs
- `severity>=ERROR` — only error-level and above
- `jsonPayload.request_id="abc-123"` — filter by a specific request ID

Structured logging (emitting log lines as JSON objects rather than plain strings) enables these field-based filters. Cloud Run and GKE automatically parse JSON logs and make every field searchable in Logs Explorer.

**Structured logging example (Python):**
```python
import json, sys

def log(severity, message, **kwargs):
    entry = {"severity": severity, "message": message, **kwargs}
    print(json.dumps(entry), file=sys.stdout)

log("INFO", "Order processed", order_id="123", user_id="456", amount=49.99)
# Output: {"severity": "INFO", "message": "Order processed", "order_id": "123", ...}
```

> **Real-World Example:** A Cloud Run service begins returning HTTP 500 errors at 2 AM. The on-call engineer receives a Monitoring alert notification. In Logs Explorer, they filter by `severity=ERROR` and `resource.type="cloud_run_revision"` for the past hour. The structured logs reveal `"message": "Database connection timeout"` with `"db_host": "/cloudsql/..."`. Checking **Cloud SQL > Instances > Monitoring**, they see that the Cloud SQL instance hit its maximum connections limit — the Cloud Run service scaled to 50 instances, each maintaining a connection pool of 5, exceeding the 200-connection limit. The fix: reduce the connection pool size per instance and enable **PgBouncer** connection pooling on the Cloud SQL proxy.

### Distributed Tracing with Cloud Trace and OpenTelemetry

**Cloud Trace** captures latency data for individual requests as they flow through your application. Each request is assigned a unique **trace ID**; each operation within the request (e.g., a database query, an external API call, a queue publish) creates a **span** that records its start time, duration, and any errors.

**Instrumenting with OpenTelemetry:**
OpenTelemetry is the open-source standard for distributed tracing. Google Cloud's trace exporter sends spans to Cloud Trace:
```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(CloudTraceSpanExporter()))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer(__name__)

def process_order(order_id):
    with tracer.start_as_current_span("process_order") as span:
        span.set_attribute("order.id", order_id)
        with tracer.start_as_current_span("fetch_inventory"):
            # database call here
            pass
        with tracer.start_as_current_span("publish_event"):
            # pubsub publish here
            pass
```

**Trace propagation across services:** When a Cloud Run service calls another Cloud Run service or a GKE pod, the trace context must be propagated via HTTP headers (`traceparent` header in W3C Trace Context format). The OpenTelemetry SDK handles propagation automatically when using the provided HTTP client instrumentation libraries.

Navigate to **Trace > Trace list** to view recent traces. Select a trace to see the full **waterfall view** — each span shows its duration, parent-child relationships, and any recorded attributes. Traces with high latency appear in red; use the waterfall to identify which span is the bottleneck.

> **Real-World Example:** A user reports that checkout is slow — page load takes 4 seconds. In Cloud Trace, the engineer filters to the `/checkout` endpoint and finds a 4-second trace. Opening the trace waterfall reveals the breakdown: 50ms for authentication, 200ms for the cart query, **3,700ms for the `fetch_inventory` span**. Drilling into the `fetch_inventory` span attributes shows it is calling a Spanner database. Switching to **Spanner > Query Insights**, the engineer finds the inventory query is missing an index on `product_id` — adding the index reduces the query time to 15ms, and the checkout page drops to 300ms total.

### Error Reporting

**Cloud Error Reporting** automatically aggregates and deduplicates unhandled exceptions from your application logs. When a stack trace appears in Cloud Logging (for Cloud Run, GKE, or App Engine), Error Reporting groups it with identical stack traces, counts occurrences, tracks affected users, and surfaces it in the Error Reporting dashboard.

Navigate to **Error Reporting** to view a ranked list of errors by frequency and recency. Click an error group to see:
- The full stack trace
- The time series of occurrence counts
- Links to the specific log entries in Logs Explorer
- The option to configure an alert notification for new occurrences of this error group

Error Reporting works automatically for most runtimes (Python, Java, Node.js, Go, Ruby, PHP) — no code changes required if your application logs unhandled exceptions to stdout. For custom error reporting (e.g., handled exceptions you want to track), use the **Error Reporting API** or the `google-cloud-error-reporting` client library.

> **Real-World Example:** After deploying a new version of a Cloud Run service, the Error Reporting dashboard shows a new error group: `KeyError: 'user_preferences'` in `profile_handler.py:142`. The stack trace reveals that the new code assumes a `user_preferences` field exists in Firestore documents, but the field is absent in documents created before the migration script ran. Error Reporting shows 12,000 occurrences affecting 3,400 users in the past hour. The team rolls back the deployment within minutes and adds a `.get("user_preferences", {})` default to handle the missing field in the fix.

### 💡 Additional Observability Objectives & Learning Guidelines

*   **Gemini Cloud Assist for Observability:** In the GCP Console, click the Gemini (sparkle) icon in the top navigation bar to open Gemini Cloud Assist. Practice using natural-language queries for observability tasks:
    - "What is the error rate for my Cloud Run service `order-service` in the past 24 hours?"
    - "Write an MQL query to alert when p99 latency for my Cloud Run service exceeds 2 seconds"
    - "Summarise the most recent errors from my GKE namespace `production`"
    - "Explain this log entry: [paste a log line]"

    Gemini Cloud Assist can also write and explain Monitoring Query Language (MQL) expressions — useful for building custom alert policies and dashboard charts without needing to learn MQL syntax from scratch.

*   **Cloud Profiler:** Navigate to **Profiler** to continuously profile CPU and memory usage of running Cloud Run and GKE applications. Cloud Profiler uses statistical sampling — it adds negligible overhead (< 1% CPU) and can run in production. The flame graph view shows which function calls are consuming the most CPU time or allocating the most memory, enabling targeted performance optimisation without load testing. Enable profiling by adding the `google-cloud-profiler` client library and calling `googlecloudprofiler.start()` at application startup.

*   **Uptime Checks:** Navigate to **Monitoring > Uptime checks** to configure synthetic monitors that probe your Cloud Run service URL from multiple geographic regions at a configurable interval. If a check fails from more than one region simultaneously, an alert fires. This provides external availability monitoring — independent of your application logs and metrics — and is the fastest way to detect a complete service outage.
