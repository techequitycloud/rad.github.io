---
title: Support Features
slug: /features/support
---

import AudioPlayer from '@site/src/components/AudioPlayer';

<img src="https://storage.googleapis.com/rad-public-2b65/features/support_features.png" alt="Support Features Infographic" />

<br/>

<AudioPlayer src="https://storage.googleapis.com/rad-public-2b65/features/support_features.m4a" />

<br/>

<video controls width="100%">
  <source src="https://storage.googleapis.com/rad-public-2b65/features/support_features.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

[Download Feature PDF](https://storage.googleapis.com/rad-public-2b65/features/support_features.pdf)

## 1. Introduction

Welcome to the Support User Guide. As a member of the Support team, you have enhanced visibility into the platform's operations to assist users effectively. Your primary capability is the ability to view **All Deployments** made by any user on the platform, which is essential for troubleshooting and user assistance. You also have access to the module publishing tools if your repository and Jules AI are configured.

## 2. Your Role & Privileges

The Support role is designed to help you troubleshoot user issues and assist with module management. Your navigation bar shows **Publish** (if configured), **Deployments**, and **Help**.

*   **View All Deployments:** Unlike standard users or partners, you see the deployment history for *every* user by default. This is critical for diagnosing failed builds or stuck deployments.
*   **Module Publishing:** You can access the **Publish** feature if your GitHub repository and Jules API key have been configured in your Profile. This allows you to assist in maintaining and testing modules.
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
    *   **Status History:** The timeline of the deployment's lifecycle. Key statuses to know:
        *   `QUEUED` — Waiting for Cloud Build to pick up the build.
        *   `WORKING` — Build actively running.
        *   `COMPLETED` / `FAILED` — Terminal build states.
        *   `CANCELLED` — Stopped before or during provisioning. Available follow-up actions depend on context (see below).
        *   `INTERNAL_ERROR` — A non-transient platform-level failure during provisioning. The deployment surfaces as actionable rather than silently stuck in `QUEUED`.
        *   `DELETED` — Soft-deleted, awaiting permanent removal.
    *   **Configuration:** The specific variables the user provided.
5.  **Auto-Reconciliation:** A scheduled job runs every 30 minutes to verify deployments stuck in `QUEUED` or `WORKING` against Cloud Build's actual status. If Cloud Build reports a terminal state the deployment is updated accordingly; if the build no longer exists (404) the deployment is cancelled. Wait one reconciliation cycle (up to 30 minutes) before manually intervening on a stuck deployment — it may self-resolve.
6.  **Cancel Action:** For deployments stuck in `QUEUED`, a **Cancel** button is available (visible to admins and the deployment owner). This marks the deployment as `CANCELLED` without triggering resource teardown. It is the safest first step when a build has not yet started.

## 4. Publishing & Updating Modules

If your repository is configured, you can assist in maintaining the module catalog or testing fixes.

1.  **Configure Your Repo:** Go to your **Profile** and set up your GitHub token and repository (see the *Partner Guide* for detailed steps).
2.  **Publish:** Go to the **Publish** page to scan your repo and update module definitions.
3.  **Refining with Jules:** You can use the AI agent (if your Jules API key is configured) to help debug or improve module code before publishing updates.

## 5. Troubleshooting Workflow

When a user reports an issue:

1.  **Ask for the Deployment ID:** This is the fastest way to locate their specific problem.
2.  **Search in "All Deployments":** Locate the record using the search bar.
3.  **Check the Status:** Is it `FAILED`, `INTERNAL_ERROR`, `QUEUED`, or stuck in `WORKING`?
    *   `FAILED` — Build started and errored. Review build logs for the root cause.
    *   `INTERNAL_ERROR` — The deployment function crashed before or during Cloud Build submission. Review logs for a platform-level error and escalate to Engineering if needed.
    *   `QUEUED` (prolonged) — Build never started. Wait up to 30 minutes for auto-reconciliation, or use **Cancel** to unblock the user immediately.
    *   `WORKING` (prolonged) — Build is running but appears stuck. Wait for auto-reconciliation to verify the Cloud Build status.
    *   `CANCELLED` — Deployment was stopped. Check whether infrastructure was deployed (if the original action was `UPDATE` or `DELETE`, resources may still be running).
4.  **Review Logs:** Identify the root cause (e.g., quota exceeded, bad configuration, API error).
5.  **Advise the User:** Based on your findings, guide the user to retry with different variables or escalate the issue to Engineering/Admin if it's a platform bug.

## 6. Help & Resources

Visit the **Help** page for additional resources:

*   **Support Tab:** Contact support or access assistance tools.
*   **Platform Demos Tab:** View demonstrations of platform features that you can share with users.
*   **Platform Workflows Tab:** Browse documented platform workflows.
*   **Platform Guides Tab:** Access user guides and documentation for each role.
*   **Platform Features Tab:** Explore the platform's feature catalog.
