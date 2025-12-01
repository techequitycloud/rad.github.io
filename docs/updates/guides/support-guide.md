# Support User Guide

## 1. Introduction

Welcome to the Support User Guide. As a member of the Support team, you have enhanced visibility into the platform's operations to assist users effectively. You possess all the capabilities of a Partner, with the additional privilege of viewing **All Deployments** made by any user on the platform.

## 2. Your Role & Privileges

The Support role is designed to help you troubleshoot user issues and manage the module catalog.

*   **View All Deployments:** Unlike standard users or partners (in default mode), you can see the deployment history for *every* user. This is critical for diagnosing failed builds or stuck deployments.
*   **Partner Capabilities:** You have full access to the **Publish** feature, allowing you to connect your own repository and publish/update modules.
*   **Credit Visibility:** You can view your own credit history and transaction logs.

## 3. Managing Deployments

Your primary workspace for support activities is the **Deployments** page.

1.  **Navigate to Deployments:** Click the **Deployments** link in the main navigation bar.
2.  **All Deployments Tab:** By default, or by clicking the tab, you will see the **All Deployments** view. This table lists every deployment on the platform.
3.  **Search & Filter:** Use the search bar to find a specific deployment by:
    *   **Deployment ID:** The unique identifier for the deployment.
    *   **User Email:** Filter to see all deployments made by a specific user you are helping.
    *   **Module Name:** Find all instances of a specific module.
4.  **Inspect Logs:** Click on any **Deployment ID** to open the detailed view. Here you can see:
    *   **Build Logs:** Raw output from the Cloud Build and Terraform processes. Look here for error messages (e.g., "Permissions denied", "Invalid variable").
    *   **Status History:** The timeline of the deployment's lifecycle.
    *   **Configuration:** The specific variables the user provided.

## 4. Publishing & Updating Modules

You can assist in maintaining the module catalog or testing fixes.

1.  **Configure Your Repo:** Go to your **Profile** and set up your GitHub token and repository (see the *Partner Guide* for detailed steps).
2.  **Publish:** Go to the **Publish** page to scan your repo and update module definitions.
3.  **Refining with Jules:** You can use the AI agent (if your API key is configured) to help debug or improve module code before publishing updates.

## 5. Troubleshooting Workflow

When a user reports an issue:

1.  **Ask for the Deployment ID:** This is the fastest way to locate their specific problem.
2.  **Search in "All Deployments":** Locate the record.
3.  **Check the Status:** Is it `FAILURE`, `TIMEOUT`, or stuck in `WORKING`?
4.  **Review Logs:** Identify the root cause (e.g., quota exceeded, bad configuration, API error).
5.  **Advise the User:** Based on your findings, guide the user to retry with different variables or escalate the issue to Engineering/Admin if it's a platform bug.
