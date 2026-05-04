import AudioPlayer from '@site/src/components/AudioPlayer';

# Support Workflow

<img src="https://storage.googleapis.com/rad-public-2b65/workflows/support_workflow.png" alt="Support Workflow" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflows/support_workflow.m4a" title="Support Workflow Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/workflows/support_workflow.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction
This tutorial is designed for **Support** users. You will learn how to use your enhanced permissions to troubleshoot user deployments, restore soft-deleted deployments, manage the module catalog, and leverage the Jules AI assistant to debug module issues.

## 2. Step 1: Accessing User Deployments
The most common task is investigating a user's failed deployment.

1.  Click **Deployments** in the main navigation bar.
2.  Select the **All Deployments** tab.
3.  In the **Search** box, enter the user's **email address** or the **Deployment ID** they provided.
4.  The list will filter to show relevant records.

## 3. Step 2: Investigating a Failure
1.  Locate the failed deployment in the list (look for a status like `FAILURE` or `TIMEOUT`).
2.  Click on the blue **Deployment ID** link to open the details page.
3.  Scroll down to the **Build Logs** section.
4.  Review the text logs to find the error message. Common issues include:
    *   **Invalid Input:** The user provided a variable value that Terraform rejected.
    *   **Permissions:** The service account lacked permission to create a resource.
    *   **Quotas:** The cloud project has reached a resource limit.
5.  If the deployment is stuck in `QUEUED` or `WORKING` with no progress, use the **Purge** action to force-remove the record so the user can start fresh.

### Viewing Deployment Outputs

After a successful deployment, you can inspect the Terraform outputs to verify what was provisioned:

1.  Open the deployment details page.
2.  Click the **Outputs** tab to see all values exported by the module (URLs, IP addresses, resource names, etc.).
3.  Share relevant output values with the user if they are unable to find them in their own view.

## 4. Step 3: Restoring a Soft-Deleted Deployment

When a deployment is soft-deleted (by the retention policy or a user action), it enters a 7-day grace period during which it can be restored before permanent deletion.

**To restore a soft-deleted deployment:**

1.  Search for the deployment in **All Deployments**. Filter by status `SOFT_DELETED` if needed.
2.  Click the **Deployment ID** to open the details page.
3.  Click **Restore**. The deployment record is reinstated and the grace period timer is reset.
4.  Notify the user that their deployment has been restored.

> **Warning:** After the 7-day grace period, the deployment record and all Cloud Storage artifacts are permanently deleted and cannot be recovered — not even by Support users. Act promptly when a user reports an accidental deletion.

## 5. Step 4: Managing Modules (Optional)
As a Support user, you can also publish and update modules, just like a Partner.

1.  Go to your **Profile** and ensure your GitHub settings are configured.
2.  Navigate to the **Publish** page.
3.  Select a module and click **Update** to refresh its definition in the system.
4.  This is useful for rolling out quick fixes to module code or variables without waiting for a Partner or Admin to act.

## 6. Step 5: Using Jules for Debugging

Jules is an AI assistant that can analyse module Terraform code and suggest fixes for deployment errors. If you have configured your **Jules API Key** in your Profile, you can use it to speed up root cause analysis.

### Setting Up Jules

1.  Click your **Profile Avatar** > **Profile**.
2.  Scroll to **API Settings**.
3.  Enter your **Jules API Key** and click **Save API Settings**.

### Using Jules to Debug a Module

1.  Go to the **Publish** page.
2.  Find the module that the failing deployment used.
3.  Click the **Sparkles Icon** (✨) to open a Jules session for that module.
4.  In the Jules panel:
    *   Paste the relevant error from the build logs and ask Jules to identify the cause.
    *   Ask Jules to review the module's variable definitions for missing constraints or incorrect types.
    *   Request a suggested fix — Jules will propose a code or configuration change.
5.  Review Jules's suggestions in the **Activities** list.
6.  Click **Approve** to apply a suggestion, or dismiss it and continue the conversation if you need further clarification.
7.  After applying a fix, click **Update** on the module to publish the corrected version. Advise the user to retry their deployment.

### Jules Session Reference

| Action | What It Does |
| :--- | :--- |
| **New Session** | Starts a fresh Jules conversation scoped to the selected module |
| **Send Message** | Submits your question or error description to Jules |
| **View Activities** | Lists all suggestions Jules has generated in this session |
| **Approve** | Applies the selected suggestion to the module |
| **Add Source** | Attaches additional context (log snippets, Terraform files) to the session |
