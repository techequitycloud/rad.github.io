import AudioPlayer from '@site/src/components/AudioPlayer';

# Support Guide

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/guides/support_guide.m4a" title="Support Quick Start Audio" />

## 1. Introduction

Welcome to the Support User Guide. As a member of the Support team, you have enhanced visibility into the platform's operations to assist users effectively. Your primary capability is the ability to view **All Deployments** made by any user on the platform, which is essential for troubleshooting and user assistance.

## 2. Your Role & Privileges

The Support role is designed to help you troubleshoot user issues. Your navigation bar includes **Deployments** and **Help**. If you also hold the **Partner** role and have configured your repository, you will also see **Publish**.

*   **View All Deployments:** Unlike standard users, you see the deployment history for *every* user by default. This is critical for diagnosing failed builds or stuck deployments.
*   **Module Publishing:** If you are also a Partner, you can access the **Publish** feature to assist in maintaining and testing modules.
*   **Help Resources:** Access platform documentation, demos, workflows, guides, and features through the Help page.

## 3. Managing Deployments

Your primary workspace for support activities is the **Deployments** page.

1.  **Navigate to Deployments:** Click the **Deployments** link in the main navigation bar.
2.  **All Deployments View:** You will see the **All Deployments** list showing every deployment on the platform. Note that unlike Admins, you do not have a "My Deployments" tab — your view is focused entirely on platform-wide support.
3.  **Search & Filter:** Use the search bar to find a specific deployment by:
    *   **Deployment ID:** The unique identifier for the deployment.
    *   **User Email:** Filter to see all deployments made by a specific user you are helping.
    *   **Module Name:** Find all instances of a specific module.
4.  **Inspect Logs:** Click on any **Deployment ID** to open the detailed view. Here you can see:
    *   **Build Logs:** Raw output from the Cloud Build and Terraform processes. Look here for error messages (e.g., "Permissions denied", "Invalid variable").
    *   **Status History:** The timeline of the deployment's lifecycle. Key statuses:
        *   `QUEUED` — Waiting for Cloud Build to start.
        *   `WORKING` — Build actively running.
        *   `COMPLETED` / `FAILED` — Terminal build states.
        *   `TIMEOUT` — Cloud Build job exceeded its time limit, or the stuck deployment was auto-reconciled and the build no longer exists.
        *   `CANCELLED` — Stopped before or during provisioning. Available follow-up actions depend on the original action type.
        *   `INTERNAL_ERROR` — A platform-level failure during provisioning; the deployment is surfaced as actionable.
        *   `DELETED` — Soft-deleted, awaiting permanent removal.
        *   `PURGE` — Admin-initiated force-cleanup in progress; the deployment record will be removed once it completes.
    *   **Configuration:** The specific variables the user provided.

## 4. Publishing & Updating Modules

*Note: This feature requires the **Partner** role.*

If your repository is configured, you can assist in maintaining the module catalog or testing fixes.

1.  **Configure Your Repo:** Go to your **Profile** and set up your GitHub token and repository (see the *Partner Guide* for detailed steps).
2.  **Publish:** Go to the **Publish** page to scan your repo and update module definitions.
3.  **Refining with Jules:** You can use the AI agent (if your Jules API key is configured) to help debug or improve module code before publishing updates.

## 5. Troubleshooting Workflow

When a user reports an issue:

1.  **Ask for the Deployment ID:** This is the fastest way to locate their specific problem.
2.  **Search in "All Deployments":** Locate the record using the search bar.
3.  **Check the Status:** Is it `FAILED`, `INTERNAL_ERROR`, `TIMEOUT`, `QUEUED`, stuck in `WORKING`, or showing `PURGE`?
    *   `FAILED` — Build started and errored. Review build logs for the root cause.
    *   `INTERNAL_ERROR` — Platform-level failure before or during build submission. Escalate to Engineering if needed.
    *   `TIMEOUT` — Build exceeded its time limit. Review logs for slow Terraform steps and advise the user to contact the module publisher.
    *   `QUEUED` (prolonged) — Build never started. Wait up to 30 minutes for auto-reconciliation.
    *   `WORKING` (prolonged) — Build appears stuck. Wait for auto-reconciliation to verify Cloud Build status.
    *   `PURGE` — Force-cleanup in progress; no action needed.
4.  **Review Logs:** Identify the root cause (e.g., quota exceeded, bad configuration, API error).
5.  **Advise the User:** Based on your findings, guide the user to retry with different variables or escalate the issue to Engineering/Admin if it's a platform bug.

## 6. Help & Resources

Visit the **Help** page for additional resources:

*   **Support Tab:** Contact support or access assistance tools.
*   **Platform Demos Tab:** View demonstrations of platform features that you can share with users.
*   **Platform Workflows Tab:** Browse documented platform workflows.
*   **Platform Guides Tab:** Access user guides and documentation for each role.
*   **Platform Features Tab:** Explore the platform's feature catalog.
