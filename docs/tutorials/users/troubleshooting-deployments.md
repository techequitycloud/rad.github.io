---
title: "Troubleshooting Failed Deployments"
sidebar_position: 3
description: "Learn how to diagnose and fix failed deployments on the RAD Platform by analyzing logs and identifying common errors."
keywords: ["tutorial", "troubleshooting", "deployment failure", "error logs", "debugging"]
---

# Troubleshooting Failed Deployments

This tutorial teaches you how to troubleshoot and resolve deployment failures on the RAD Platform. Learning how to read deployment logs and identify common errors is a crucial skill for successfully managing your infrastructure.

## What You'll Learn

- How to identify a failed deployment.
- How to access and analyze deployment logs.
- How to recognize common error patterns.
- How to resolve common deployment issues.

### Prerequisites

- A RAD Platform account.
- At least one attempted deployment (successful or failed).

### Estimated Time

- **20 minutes**

---

## Step 1: Identify a Failed Deployment

When a deployment fails, the RAD Platform makes it easy to spot.

1.  Navigate to the **Deployments** page from the main menu.
2.  In the list of your deployments, look at the **Status** column. A failed deployment will have a red **`FAILURE`** status.

    ![Deployments list with a deployment showing a "FAILURE" status](/img/site/3.1.4-user-deployments-deployment-builds-failure.png)

## Step 2: Access and Analyze Deployment Logs

The deployment logs are the most important tool for understanding why a deployment failed.

1.  Click on the failed deployment.
2.  This will take you to the deployment details page, which features a comprehensive log viewer.

    ![Deployment details page with the log viewer visible](/img/site/3.1.5-user-deployments-deployment-build-status-failure.png)

3.  Scroll through the logs to find error messages. Errors are often highlighted in red or accompanied by terms like `Error`, `Failed`, or `FATAL`.

## Step 3: Common Error Patterns and Solutions

Here are some of the most common errors you might encounter and how to fix them.

### Error 1: Insufficient Permissions

-   **Log Message:** `Error: 403, Forbidden` or `Permission denied`.
-   **Meaning:** The Google Cloud account used for the deployment does not have the necessary IAM permissions to create or modify resources in the specified project.
-   **Solution:**
    1.  Ensure the service account or user account has the required roles (e.g., `Editor`, `Compute Admin`) in the target Google Cloud project.
    2.  Consult the module's documentation for a list of required permissions.

### Error 2: Resource Quota Exceeded

-   **Log Message:** `Error: 413, Quota exceeded for metric 'CPUs' and limit 'CPUs per region'`.
-   **Meaning:** Your Google Cloud project has reached its resource limit for the specified region (e.g., you are trying to create more CPUs than your quota allows).
-   **Solution:**
    1.  Request a quota increase from the Google Cloud Console.
    2.  Deploy the resource in a different region where you have available quota.
    3.  Delete unused resources in the current region to free up quota.

### Error 3: Invalid Configuration

-   **Log Message:** `Error: Invalid value for field 'resource.name'` or `Invalid format`.
-   **Meaning:** You provided an invalid value in the deployment configuration form (e.g., a name with special characters, an incorrect project ID format).
-   **Solution:**
    1.  Review the configuration parameters you provided for the deployment.
    2.  Check the module's documentation for the expected format of each variable.
    3.  Re-launch the deployment with the corrected configuration.

### Error 4: Resource Naming Conflict

-   **Log Message:** `Error: The resource 'projects/your-project/global/networks/your-network' already exists`.
-   **Meaning:** A resource with the same name already exists in the target project.
-   **Solution:**
    1.  Choose a different, unique name for your resource in the deployment configuration.
    2.  If the existing resource is no longer needed, delete it from the Google Cloud Console and re-run the deployment.

## Step 4: Retry or Reconfigure

Once you have identified and addressed the root cause of the failure, you can try deploying again.

-   If the issue was temporary (e.g., a network timeout), you might be able to simply **retry** the deployment.
-   If the issue was related to configuration, you will need to **reconfigure** the deployment by launching a new one with the corrected parameters.

## Verification

After applying the fix and re-launching the deployment, monitor it on the **Deployments** page. If the status changes to **`SUCCESS`**, you have successfully resolved the issue.

![Deployment with "SUCCESS" status](/img/site/3.1.6-user-deployments-deployment-build-status-success.png)

## Next Steps

-   [Understanding the RAD Platform Architecture](../advanced/platform-architecture.md)
-   Explore more complex modules that may have more intricate dependencies and configuration requirements.
