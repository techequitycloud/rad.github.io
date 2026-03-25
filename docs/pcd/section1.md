# Designing highly scalable, secure, and reliable cloud-native applications
<video controls width="100%" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section1.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section1.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pcd_section1.pdf)

This guide is designed to help candidates preparing for the Google Cloud Professional Cloud Developer (PCD) certification. It focuses specifically on Section 1 of the exam guide (~36% of the exam) by walking you through how these concepts are practically implemented and deployed. By exploring the Google Cloud Platform (GCP) console and adjusting deployment variables via your web-based deployment portal, you will gain hands-on context for these critical architectural topics.

---

## 1.1 Designing high-performing applications and APIs

**Concept:**
Choosing the appropriate platform (Cloud Run vs. GKE), implementing caching solutions (like Memorystore for Redis) for performance, and utilizing traffic splitting strategies for safe rollouts are fundamental to high-performing cloud-native architectures.

**Implementation Context:**
The deployments you access via the deployment portal support deploying directly to both Cloud Run and GKE. Caching is integrated using the `enable_redis` and `redis_auth` variables. Progressive delivery is managed via the `traffic_split` variable.

**Exploration:**
, `redis_auth`, `traffic_split` (App_CloudRun / App_GKE / Services_GCP deployments)
*   **Description:** Provisions a managed Redis instance for caching. `traffic_split` enables gradual rollouts or A/B testing on Cloud Run.
*   **Configuration Experience:** Setting `enable_redis = true` in the portal provisions a Memorystore instance to offset database read loads. Configuring `traffic_split = [{ revision_name = "v2", percent = 10 }]` demonstrates canary deployments.
*   **GCP Console Exploration:** Navigate to **Memorystore** to view the Redis instance topology. For traffic splitting, navigate to **Cloud Run > Revisions** to observe the traffic routing chart.
*   **Suggestions for Customization:** Update the `traffic_split` variable in your deployment portal to a 50/50 split. Trigger a deployment and perform a small load test to observe metrics distributing across the two revisions equally in the GCP console.

---

## 1.2 Designing secure applications

**Concept:**
Securing applications involves rotating secrets, utilizing Identity-Aware Proxy (IAP) to identify vulnerabilities via Zero Trust, and securing application artifacts using Binary Authorization.

**Implementation Context:**
Secrets are injected into containers dynamically using `secret_environment_variables`. Pre-production endpoints are secured with `enable_iap`, and artifact integrity is enforced via `enable_binary_authorization`.

**Exploration:**
, `enable_iap`, `enable_binary_authorization` (App_GKE / App_CloudRun deployments)
*   **Description:** Manages secure runtime configuration, zero-trust endpoint access, and container image attestation.
*   **Configuration Experience:** Mapping values to `secret_environment_variables` in the portal ensures application credentials (like database passwords) are read from Secret Manager at runtime rather than baked into the container.
*   **GCP Console Exploration:** Navigate to **Secret Manager** to view secret rotation policies. Visit **Security > Identity-Aware Proxy** to view the authorized principals allowed to access the application.
*   **Suggestions for Customization:** Create a new version of a secret in Secret Manager, update the variable reference in the deployment portal, and trigger a redeployment to observe how the application receives the new credentials.

---

## 1.3 Storing and accessing data

**Concept:**
Selecting the appropriate storage system and understanding data replication is critical. Cloud SQL is often used for structured data, and Cloud Storage for unstructured blobs, requiring secure access methods like signed URLs.

**Implementation Context:**
The foundational platform deployment provisions a highly available Cloud SQL instance. The application deployments connect to it seamlessly, and can optionally provision Google Cloud Storage buckets via the storage settings in the deployment portal.

**Exploration:**
 (App_GKE / App_CloudRun deployments)
*   **Description:** Provisions GCS buckets for unstructured data storage, which the application can interact with via Cloud Client Libraries.
*   **Configuration Experience:** Defining `storage_buckets = ["user-uploads"]` in the deployment portal provisions the necessary storage infrastructure for the application to generate and serve signed URLs for direct client uploads.
*   **GCP Console Exploration:** Navigate to **Cloud Storage > Buckets** to verify the created bucket, its regional placement, and lifecycle policies.
*   **Suggestions for Customization:** If your deployment portal exposes storage lifecycle rules, configure one (e.g., transition objects to Coldline after 30 days) and verify the applied policy in the GCP Console. Otherwise, explore adding a new bucket string to the array and observing its creation in the Storage browser.