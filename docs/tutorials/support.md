---
title: Support Tutorial
---

# Tutorial: Support Workflow

## Overview

Support users have elevated permissions that allow them to view and investigate deployments across all user accounts, not just their own. This tutorial explains how to use those permissions to troubleshoot deployment failures, manage the module catalog, and leverage the Jules AI agent for advanced debugging.

**Audience:** Users with the **Support** role  
**Estimated time:** 15 minutes

By the end of this tutorial you will have:
- Located and inspected a specific user's deployment using the All Deployments view
- Read and interpreted build logs to identify the root cause of a failure
- Updated a module definition using the Publish page
- Used the Jules AI agent to assist with code-level debugging (optional)

---

## Step 1: Access All User Deployments

Standard users can only see their own deployments. Support users have access to a broader view that spans all accounts.

1. Click **Deployments** in the main navigation bar.
2. Click the **All Deployments** tab (this tab is exclusive to Support and Admin users).
3. In the **Search** box, enter the user's **email address** or the specific **Deployment ID** they provided when raising the issue.
4. The list will filter to show matching records across all users.

---

## Step 2: Investigate a Failed Deployment

1. Locate the deployment showing a `FAILURE` or `TIMEOUT` status in the filtered list.
2. Click the blue **Deployment ID** link to open the full details page.
3. Scroll down to the **Build Logs** section and review the Terraform output carefully.
4. Identify the error type. Common failure categories include:

   | Failure Category | Typical Cause | How to Recognise It |
   | :--- | :--- | :--- |
   | **Invalid Input** | User provided a variable value that Terraform rejected (for example, a malformed Project ID or unsupported region) | Error message references a specific variable or input validation failure |
   | **Insufficient Permissions** | The deployment service account lacks an IAM role needed to create a resource | Error message contains `403`, `Permission denied`, or `roles/` references |
   | **Quota Exceeded** | The cloud project has reached a resource limit (for example, CPU quota, IP address quota) | Error message contains `quota`, `QUOTA_EXCEEDED`, or `resource exhausted` |
   | **API Not Enabled** | A required Google Cloud API is not active in the target project | Error message contains `API not enabled` or a `googleapis.com` service name |
   | **Timeout** | The Terraform run exceeded the maximum allowed build duration | Status shows `TIMEOUT`; logs may be truncated |

5. Based on your diagnosis, advise the user on the corrective action — for example, requesting a quota increase, correcting an input value, or enabling the required API in their Google Cloud project.

---

## Step 3: Update a Module Definition

Support users can publish and update module definitions, which is useful for rolling out quick fixes to module code or variable schemas without waiting for an administrator.

1. Go to your **Profile** (click your avatar in the top-right corner).
2. Ensure your **GitHub Token** is saved (click **Save Token** if not already done) and a repository is selected (click **Update Repo** if not already done).
3. Navigate to the **Publish** page.
4. Locate the module that needs updating and click its card to select it.
5. Click **Update** to pull the latest version from the connected repository and refresh its definition in the platform.

> **Note:** Clicking **Update** does not affect existing deployments — it only updates the module configuration that will be used for future deployments. Users who have already deployed the old version will not be automatically migrated.

---

## Step 4: Debug with Jules (Optional)

If you have configured a Jules API Key, you can use the Jules AI agent directly on the Publish page to analyse module code and suggest fixes. This is particularly useful when build logs indicate a code-level issue in the Terraform module itself.

1. Ensure your **Jules API Key** is saved in your Profile (see [Partner Tutorial — Step 2](./partner) for setup instructions).
2. Navigate to the **Publish** page.
3. Find the problematic module in the list.
4. Click the **Sparkles icon** (✨) on the module card.
5. In the Jules interface, describe the issue or paste the relevant error from the build logs.
6. Review Jules' analysis and suggested code changes, then apply fixes to your repository before clicking **Update** to refresh the module definition.

---

## Next Steps

- **[Admin Tutorial](./admin)** — Learn the full platform configuration workflow, including how to manage users and set credit policies.
- **[Partner Tutorial](./partner)** — Understand how module publishing works from the partner's perspective, including the full repository connection setup.
- **[Finance Tutorial](./finance)** — Deployment failures sometimes have billing implications. The Finance dashboard lets you review and correct credit charges where appropriate.
