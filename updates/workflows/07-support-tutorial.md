import AudioPlayer from '@site/src/components/AudioPlayer';

# Support Workflow

<img src="https://storage.googleapis.com/rad-public-2b65/workflows/support_workflow.png" alt="Support Workflow" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflows/support_workflow.m4a" title="Support Workflow Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/workflows/support_workflow.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction
This tutorial is designed for **Support** users. You will learn how to use your enhanced permissions to troubleshoot user deployments and manage the module catalog.

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

## 4. Step 3: Managing Modules (Optional)
As a Support user, you can also publish and update modules, just like a Partner.

1.  Go to your **Profile** and ensure your GitHub settings are configured.
2.  Navigate to the **Publish** page.
3.  Select a module and click **Update** to refresh its definition in the system.
4.  This is useful for rolling out quick fixes to module code or variables.

## 5. Step 4: Using Jules for Debugging
If you have configured your **Jules API Key** in your Profile:

1.  Go to the **Publish** page.
2.  Find the problematic module.
3.  Click the **Sparkles Icon** (✨).
4.  Ask Jules to analyze the code or suggest a fix for the error you found in the logs.
