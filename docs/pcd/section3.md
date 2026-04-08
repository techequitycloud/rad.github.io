# PCD Certification Preparation Guide: Section 3 — Deploying applications (~20% of the exam)
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section3.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section3.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section3.pdf)


This guide helps candidates preparing for the Google Cloud Professional Cloud Developer (PCD) certification explore Section 3 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **Services GCP**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PCD objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 3.1 Deploying applications to Cloud Run

### Deploying Applications from Source Code
**Concept:** Delivering containerised code to the serverless Cloud Run environment using managed CI/CD pipelines.

**In the RAD UI:**
*   **Application Deployment:** The platform orchestrates the deployment process using the `container_image` variable (Group 3), which specifies the Artifact Registry path including the image digest or tag that Cloud Run pulls at deploy time.
*   **Continuous Deployment:** Setting `cloud_deploy_stages` (Group 7) configures Google Cloud Deploy to take the built container image and roll it out progressively across defined environments (e.g., dev, staging, prod) directly to Cloud Run services. Each stage requires explicit promotion — a release must be manually promoted from dev to staging, or you can configure auto-promotion for non-production stages.

**Console Exploration:**
Navigate to **Cloud Deploy > Delivery pipelines** to visualise the progression of a release and understand how the application moves through its environments. Click into a pipeline to see the individual stages, their promotion status, and the rollout history. Select a specific rollout to view the deployment target, the container image deployed, and the rollout status (Succeeded, Failed, or In Progress).

Navigate to **Cloud Run** and select your service. Under the **Revisions** tab, observe that each deployment creates a new immutable revision. Cloud Run traffic splitting allows you to route a percentage of traffic to multiple revisions simultaneously — enabling canary and blue/green deployment patterns without Cloud Deploy.

> **Real-World Example:** A team uses Cloud Deploy to manage their dev→staging→prod pipeline for a Cloud Run service. The Cloud Build CI pipeline builds and tests the container, then creates a new Cloud Deploy release. The release automatically rolls out to the dev stage; the team reviews the deployment in dev, then clicks "Promote" in the Cloud Deploy console to advance to staging. Production requires a two-person approval — the Cloud Deploy delivery pipeline is configured with an approval gate that blocks promotion until two approvers have confirmed in the console.

### Configuring Cloud Run Services
**Concept:** Tuning Cloud Run service behaviour for performance, cost, and availability.

**In the RAD UI:**
*   **Concurrency and Scaling:** The `min_instance_count` and `max_instance_count` variables (Group 3) control the scaling floor and ceiling. Setting `min_instance_count` to 1 or greater eliminates cold starts for latency-sensitive services. Setting `max_instance_count` caps costs and prevents runaway scaling under unexpected load.
*   **Traffic Ingress:** The `enable_load_balancer` variable (Group 4) controls whether the service is exposed through a Google Cloud external Application Load Balancer (with a global anycast IP, Cloud Armor, and CDN) or directly via the Cloud Run service URL.

**Console Exploration:**
Navigate to **Cloud Run**, select your service, and click the **Edit & deploy new revision** button. Examine the available configuration options: container port, environment variables, secrets (mounted as environment variables or volumes from Secret Manager), concurrency per instance, request timeout, and CPU allocation (CPU always allocated vs CPU only allocated during request processing). Understand the cost implications: CPU always allocated is billed per second and eliminates cold starts; CPU allocated only during requests is billed per request and scales to zero.

> **Real-World Example:** A data processing Cloud Run service runs expensive initialisation on startup (loading a large ML model into memory). Setting `min_instance_count = 1` ensures the model is always loaded, eliminating 8-second cold starts for end users. Setting CPU allocation to "CPU always allocated" allows the service to perform background maintenance tasks between requests. The team sets `max_instance_count = 10` to cap monthly costs — load testing confirmed that 10 instances handle peak throughput.

### 💡 Additional Cloud Run Deployment Objectives & Learning Guidelines

*   **Eventarc Triggers and CloudEvents Format:** The RAD modules deploy HTTP-triggered Cloud Run services. For the PCD exam, you must also understand event-driven invocation. Practice creating a Cloud Run service triggered by Eventarc — for example, a service that processes files whenever a new object is uploaded to a Cloud Storage bucket.

    When Cloud Run receives an Eventarc trigger, the event payload arrives in the **CloudEvents** format — a standard envelope with a JSON body. Your application code must parse the CloudEvents headers and body. A Cloud Storage event body contains:
    ```json
    {
      "kind": "storage#object",
      "bucket": "my-bucket",
      "name": "uploads/photo.jpg",
      "contentType": "image/jpeg",
      "size": "102400"
    }
    ```
    In Python, read the event using `from_http(request)` from the `cloudevents` library:
    ```python
    from cloudevents.http import from_http

    def handle_event(request):
        event = from_http(request.headers, request.get_data())
        bucket = event.data["bucket"]
        object_name = event.data["name"]
        # process the uploaded file
    ```
    Navigate to **Eventarc > Triggers** to create a trigger, select the event source (e.g., Cloud Storage), the event type (e.g., `google.cloud.storage.object.v1.finalized`), and the Cloud Run service destination.

    > **Real-World Example:** A document processing service runs on Cloud Run. When a PDF is uploaded to a Cloud Storage bucket by a web application, Eventarc detects the `object.finalized` event and invokes the Cloud Run service with the CloudEvents payload. The service extracts the bucket name and object name from the payload, downloads the PDF using the Cloud Storage client library, runs OCR processing, and writes the extracted text to Firestore — all without a persistent server.

*   **Pub/Sub Push Subscriptions to Cloud Run:** An alternative to Eventarc for event-driven Cloud Run invocations is a Pub/Sub push subscription, where Pub/Sub delivers messages directly to a Cloud Run service URL via HTTPS POST. The message arrives as a base64-encoded JSON body:
    ```python
    import base64, json

    def handle_pubsub(request):
        envelope = request.get_json()
        message_data = base64.b64decode(envelope["message"]["data"]).decode("utf-8")
        payload = json.loads(message_data)
        # process payload
    ```
    Pub/Sub push subscriptions authenticate the delivery using an OIDC token bound to a service account — configure the subscription to use a service account that has `roles/run.invoker` on the target Cloud Run service. Navigate to **Pub/Sub > Subscriptions** and select "Push" as the delivery type to explore this configuration.

*   **Cloud Endpoints and API Management:** Cloud Endpoints is Google Cloud's API gateway built on Extensible Service Proxy (ESP). Deploy it as a sidecar container alongside your Cloud Run service to add authentication, rate limiting, API key validation, and request logging without modifying application code.

    Deploy a Cloud Endpoints API by creating an OpenAPI 2.0 specification and deploying it with:
    ```bash
    gcloud endpoints services deploy openapi.yaml
    ```
    For **backward compatibility**, use versioned API paths (`/v1/`, `/v2/`) and apply the "API evolution" principle: never remove or rename existing fields — only add new optional fields. For breaking changes, deploy a new version under a new path and maintain the old version for a deprecation window.

    For rate limiting, add `x-google-quota` extensions to your OpenAPI spec to define quota limits per API key or per consumer project.

    > **Real-World Example:** A fintech startup exposes a payment API through Cloud Endpoints. When they introduce a new `/v2/payments` endpoint with a restructured request format, they keep `/v1/payments` running in parallel and add a deprecation notice to the API documentation. Existing partner integrations continue working unchanged. Partners are notified and given 6 months to migrate. After the deprecation window, `/v1/payments` is removed from the OpenAPI spec and redeployed. API key quotas prevent any single partner from overwhelming the service.

*   **Apigee for Enterprise API Management:** For more advanced API management requirements — developer portals, monetisation, API analytics, or enterprise-scale traffic management — Apigee is Google Cloud's full-featured API management platform. Apigee proxies sit in front of your Cloud Run services and provide policies for transformation, caching, threat protection, and OAuth 2.0 token validation. Navigate to the **Apigee** section of the GCP Console to explore API proxy configuration. Apigee is the preferred choice for organisations managing APIs as products exposed to external developers.

---

## 3.2 Deploying containers to GKE

### Container Deployment and Resource Definition
**Concept:** Deploying containerised applications and defining compute requirements on GKE Autopilot.

**In the RAD UI:**
*   **Workload Provisioning:** The `deploy_application` variable (Group 3) triggers the deployment of the application to the GKE Autopilot cluster. The module creates a Kubernetes `Deployment` object that manages a ReplicaSet ensuring the desired number of pod replicas are running.
*   **Resource Requirements:** The `container_resources` variable (Group 3) requires you to define specific CPU and memory requests and limits for the container workloads. In GKE Autopilot, resource requests are mandatory — Autopilot provisions nodes based on the aggregate requests of scheduled pods and bills at the pod level. Setting requests too low causes pod eviction under memory pressure; setting them too high wastes money and may prevent scheduling if requests exceed available Autopilot node capacity.

**Console Exploration:**
Navigate to **Kubernetes Engine > Workloads**, select your deployment, and inspect the YAML definition of the pod to see the `resources.requests` and `resources.limits` fields under the container spec. In Autopilot clusters, note that the cluster manages node provisioning automatically — you never interact with individual nodes. Navigate to **Kubernetes Engine > Clusters** and observe that the Autopilot cluster shows no node pool configuration — this is managed by Google.

> **Real-World Example:** A team deploys a Java Spring Boot application to GKE Autopilot with `memory: "256Mi"` requests. Under load, the application's JVM heap grows beyond 256 MiB and the Linux OOM killer terminates the container — causing repeated CrashLoopBackOff restarts. Increasing `memory` requests to `"512Mi"` and setting `memory` limits to `"768Mi"` resolves the restarts. The team uses **Kubernetes Engine > Workloads > Observability** to monitor actual memory usage over 24 hours, then right-size the requests based on the observed P95 usage.

### Autoscaling and Health Checks
**Concept:** Implementing Kubernetes health checks to ensure application availability and configuring autoscaling for cost optimisation.

**In the RAD UI:**
*   **Autoscaling:** The `enable_vertical_pod_autoscaling` variable (Group 3) enables **Vertical Pod Autoscaler (VPA)**, which analyses historical CPU and memory usage and automatically adjusts the pod's resource requests over time — ensuring pods have sufficient resources without manual right-sizing. Separately, `min_instance_count` and `max_instance_count` configure the **Horizontal Pod Autoscaler (HPA)**, which scales the number of pod replicas up or down based on CPU/memory utilisation metrics. VPA and HPA address different scaling dimensions: VPA adjusts *what each pod gets*; HPA adjusts *how many pods run*.
*   **Health Checks:** The `health_check_config` variable (Group 7) automatically injects Kubernetes **Readiness** and **Liveness** probes into the Deployment manifest. Understanding the difference is critical for the PCD exam:
    - **Liveness probe:** If this probe fails, Kubernetes kills and restarts the container. Use it to detect when a container is deadlocked or in an unrecoverable state. Example: an HTTP GET to `/healthz` that returns 200 only if the application process is responsive.
    - **Readiness probe:** If this probe fails, Kubernetes removes the pod from the Service's load balancer endpoint list — it receives no traffic but is not restarted. Use it to signal when a container is not yet ready to serve requests (e.g., still loading data on startup) or is temporarily overloaded.
    - **Startup probe:** An optional third probe type that delays liveness/readiness checking until the application has successfully started. Use this for applications with slow initialisation (e.g., Java services) to prevent the liveness probe from killing the container before it has finished starting.

**Console Exploration:**
Navigate to **Kubernetes Engine > Workloads** and select your deployment. Under the **Details** tab, find the **Autoscaling** section to view the HPA configuration — minimum replicas, maximum replicas, and the current CPU/memory utilisation metric driving scaling decisions. Click into the pod YAML to view the `livenessProbe`, `readinessProbe`, and optional `startupProbe` definitions under the container spec.

To observe autoscaling in action, navigate to **Kubernetes Engine > Workloads > Observability** and view the CPU utilisation chart. If utilisation exceeds the HPA target threshold (typically 80%), additional pods are scheduled within seconds.

> **Real-World Example:** A Cloud Run-style stateless API is deployed on GKE Autopilot with HPA configured for min=2, max=20 pods at 70% CPU target. During a product launch, traffic spikes 10× in 3 minutes. HPA detects CPU utilisation exceeding 70%, scales from 2 to 14 pods over 2 minutes, and the service absorbs the traffic without degradation. After the spike, HPA gradually scales back down to 2 pods over 10 minutes (the default scale-down stabilisation window prevents thrashing). The readiness probe ensures that newly started pods only receive traffic once they have completed their warm-up sequence.

### 💡 Additional GKE Deployment Objectives & Learning Guidelines

*   **Kubernetes Deployment Strategies:** GKE supports multiple strategies for rolling out updates with zero downtime:
    - **Rolling update (default):** Kubernetes replaces pods incrementally, ensuring a configurable number of pods remain available at all times. Configure `maxUnavailable` and `maxSurge` in the Deployment spec.
    - **Blue/Green deployment:** Create a new Deployment with the new version (green), verify it, then update the Service selector to point all traffic to the new pods. The old (blue) Deployment remains available for instant rollback.
    - **Canary deployment:** Run both old and new Deployment objects simultaneously with different replica counts. For example, 9 old pods + 1 new pod = 10% of traffic to the canary. Gradually increase the new Deployment's replicas while decreasing the old ones. For fine-grained traffic splitting by percentage (rather than by replica count), use **Cloud Service Mesh** traffic management policies.

    Navigate to **Kubernetes Engine > Workloads** to inspect the `strategy` field in a Deployment YAML. Use `kubectl rollout history deployment/<name>` in Cloud Shell to view rollout history and `kubectl rollout undo deployment/<name>` to revert to the previous revision.

*   **ConfigMaps and Secrets in Kubernetes:** Application configuration that varies between environments (dev/staging/prod) should be externalised from container images using Kubernetes ConfigMaps (for non-sensitive data) and Secrets (for sensitive data). However, native Kubernetes Secrets are base64-encoded, not encrypted — for production workloads, use the **Secret Manager** integration (via the Secrets Store CSI Driver or the Secret Manager Kubernetes add-on) to sync secrets from Secret Manager into the pod environment at runtime. The RAD platform implements this pattern via the `enable_auto_password_rotation` variable.

*   **GKE Autopilot Constraints:** GKE Autopilot enforces security-hardened pod requirements. Pods that request `hostPath` volumes, `hostNetwork`, or privileged security contexts are rejected at admission. For the PCD exam, understand which workload types are suitable for Autopilot (stateless microservices, batch jobs, most web applications) versus Standard clusters (workloads requiring DaemonSets with host-level access, GPU node pools, or highly customised kernel configurations).
