# Deployment Deletion Feature Analysis

This document outlines the end-to-end process for deleting a deployment, including the technologies involved, the data affected, and the automated cleanup procedures.

### 1. User-Initiated Deletion

When a user initiates the deletion of a deployment from the web application, the following steps occur:

*   **API Request:** The frontend sends a `DELETE` request to the API endpoint at `rad-ui/webapp/src/pages/api/deployments/[id]/index.ts`.
*   **Queuing the Deletion:** The `deleteDeployment` function in this API route does not immediately delete the deployment. Instead, it queues the deletion by:
    1.  Fetching the deployment document from the `deployments` collection in Firestore to verify its existence.
    2.  Creating a Pub/Sub message containing the deployment details, including the `deploymentId` and the `DELETE` action.
    3.  Publishing this message to the Pub/Sub topic `rad-topic-destroy` (or `NEXT_PUBLIC_PUBSUB_DEPLOYMENTS_DESTROY_TOPIC`).
    4.  Updating the deployment's `status` in Firestore to `QUEUED`.

This asynchronous approach ensures that the user interface remains responsive while the potentially long-running deletion process is handled in the background.

### 2. The Asynchronous Deletion Process

The actual deletion is handled by a Cloud Function and a Cloud Build pipeline:

*   **Cloud Function Trigger:** The Pub/Sub message is received by the Cloud Function defined in `rad-ui/automation/terraform/infrastructure/function/deployment_destroy/index.js`.
*   **Cloud Build Execution:** This Cloud Function is responsible for triggering a Cloud Build pipeline. It:
    1.  Verifies the deployment exists in Firestore.
    2.  Initiates a Cloud Build run using the configured Trigger ID.
    3.  Passes necessary information, such as the `_DEPLOYMENT_ID` and `_MODULE_NAME`, to the Cloud Build pipeline as substitutions.
    4.  Updates the deployment's `builds` array in Firestore with the new build ID and sets the status to `QUEUED`.

### 3. What is Deleted?

The Cloud Build pipeline triggered by the process deletes the following:

*   **Terraform Resources:** The pipeline uses Terraform to destroy the infrastructure associated with the deployment. The `terraform destroy` command is executed, which removes all the Google Cloud resources that were created when the deployment was provisioned.
*   **What is NOT Deleted (Initially):**
    *   **Firestore Document:** The Cloud Build pipeline **does not** delete the deployment document from the `deployments` collection in Firestore. This document is retained for historical purposes and to track the status of the deletion.
    *   **Cloud Storage Assets:** The pipeline **does not** delete the deployment artifacts (such as the Terraform configuration and logs) from the Google Cloud Storage bucket.

### 4. How Failures are Handled

If the Cloud Build pipeline fails, the deployment's status is updated to reflect the failure (e.g., `FAILURE`, `INTERNAL_ERROR`, `TIMEOUT`). The Firestore document and Cloud Storage assets are not deleted, which allows for debugging and potential retries. The `updateDeploymentStatus` function in `rad-ui/webapp/src/utils/api.ts` is responsible for mapping the Cloud Build status to the deployment status in Firestore.

### 5. Data Retention and Automated Cleanup

While user-initiated deletions don't remove the Firestore document or GCS assets, there is an automated cleanup process:

*   **Cleanup API Endpoint:** The API endpoint at `rad-ui/webapp/src/pages/api/deployments/cleanup.ts` provides a mechanism for administrators to manually trigger a cleanup of old deployments.
*   **Scheduled Cleanup:** This cleanup functionality is also designed to be triggered by a scheduled job (likely a Cloud Scheduler job that calls the cleanup endpoint).
*   **Retention Period:** The cleanup process is governed by a `retentionPeriod` setting, which is configured in the application's admin settings.
*   **What is Deleted During Cleanup:** The `doDeploymentsCleanup` function in `rad-ui/webapp/src/utils/deployment.ts` performs the following actions for deployments older than the retention period:
    1.  **Deletes the Firestore document:** It removes the entire deployment document from the `deployments` collection.
    2.  **Deletes the Cloud Storage folder:** It deletes the corresponding folder in the Google Cloud Storage bucket, which contains all the artifacts for that deployment.

This automated cleanup ensures that data is not retained forever and helps manage storage costs.
