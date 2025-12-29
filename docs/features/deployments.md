# Deployments

The **Deployments** page is your command center for managing running infrastructure. It lists all your active and historical deployments and provides tools to monitor and manage them.

## Features

### 1. Deployment List
*   **My Deployments:** Shows deployments created by you.
*   **All Deployments:** (Admin/Support only) Shows deployments created by all users across the platform.
*   **Search:** Filter deployments by Module Name, Deployment ID, or User Email (for admins).
*   **Sort:** Order the list by Creation Date, Status, or Name.

### 2. Deployment Details
Each row in the list displays:
*   **Deployment ID:** A unique identifier for the deployment.
*   **Module:** The name of the deployed module.
*   **Status:** Current state (e.g., `SUCCESS`, `FAILURE`, `IN_PROGRESS`, `DELETED`).
*   **Created At:** Timestamp of creation.
*   **Actions:** Buttons to View Logs, Delete, or Update the deployment.

### 3. Detailed View & Logs
Clicking on a deployment row opens a detailed view:
*   **Logs:** Real-time streaming logs from the deployment process (Cloud Build / Terraform logs). This is crucial for debugging failures.
*   **Variables:** View the input variables used for this deployment.
*   **Resources:** (If available) A list of cloud resources created.

### 4. Management Actions
*   **Delete:** Tears down the infrastructure. This usually triggers a `terraform destroy` process.
*   **Update:** If a deployment failed, you can update to retry it with the same configuration.
*   **Purge:** You can purge a deployment configuration by deleting it from the system, without deleting the cloud resources.
*   **Rate:** Rate the module (1-5 stars) to help other users identify the best performing modules.

## How to Use

1.  Navigate to the **Deployments** page.
2.  Use the **Search** bar to find a specific deployment.
3.  Check the **Status** column to see if your infrastructure is healthy.
4.  Click on a deployment ID to inspect the **Logs** if you encounter issues.
5.  To remove infrastructure, click the **Delete** (trash can) icon. **Warning:** This action is destructive and cannot be undone.
