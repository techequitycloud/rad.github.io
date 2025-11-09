---
title: "Your First Deployment: A Step-by-Step Guide"
sidebar_position: 1
description: "Learn how to deploy your first application on the RAD Platform. This tutorial guides you through selecting a module, configuring your deployment, and monitoring its progress."
keywords: ["tutorial", "first deployment", "getting started", "RAD Platform", "deploy application"]
---

# Your First Deployment: A Step-by-Step Guide

Welcome to the RAD Platform! This tutorial will guide you through the process of deploying your first application. By the end of this guide, you will know how to select a module, configure it for deployment, and monitor its progress.

## What You'll Learn

- How to sign in to the RAD Console.
- How to browse and select a deployment module.
- How to configure and launch a module.
- How to monitor your deployment's status and logs.

### Prerequisites

- A RAD Platform account. If you don't have one, please contact your administrator.
- A web browser.

### Estimated Time

- **15 minutes**

---

## Step 1: Sign In to the RAD Console

First, you need to log in to the RAD Platform.

1.  Open your web browser and navigate to the RAD Console.
2.  You will be prompted to log in.

![RAD Console login page](/img/site/1-user-signin-page.png)

Once you have successfully logged in, you will be redirected to the main dashboard, which is the **Deployments** page.

![Main dashboard after login](/img/site/3.1-user-deployments.png)

## Step 2: Select a Module to Deploy

Now that you are logged in, you can choose a pre-built module to deploy.

1. From the main navigation menu on the left, click on **"Deploy"**.

    ![Deploy menu item](/img/site/4-user-deploy-menu.png)

2.  You will be taken to the module selection screen. Here, you can browse the available **Platform Modules**. Each module is displayed as a card with its name and a brief description.

    ![Platform Modules catalog](/img/site/4.1-user-deploy-platform_modules.png)

3.  Click on a module card to see more information about it.

    ![Module information](/img/site/4.1.1-user-deploy-platform_modules-information.png)

4.  Click the **"Deploy"** button to start the configuration process.

## Step 3: Configure Your Deployment

After selecting a module, you need to provide some configuration details. This tells the RAD Platform how to set up your application.

1.  You will be taken to the provisioning page, which displays a multi-step form with the required configuration variables for the module.

    ![Deployment configuration form page 1](/img/site/4.2.1-user-deployments-deployment-create-update-form-page1.png)
    ![Deployment configuration form page 2](/img/site/4.2.1-user-deployments-deployment-create-update-form-page2.png)
    ![Deployment configuration form page 3](/img/site/4.2.1-user-deployments-deployment-create-update-form-page3.png)
    ![Deployment configuration form page 4](/img/site/4.2.1-user-deployments-deployment-create-update-form-page4.png)
    ![Deployment configuration form page 5](/img/site/4.2.1-user-deployments-deployment-create-update-form-page5.png)
    ![Deployment configuration form page 6](/img/site/4.2.1-user-deployments-deployment-create-update-form-page6.png)

2.  Fill in the form with the required details. The exact fields will vary depending on the module you choose.

3.  Once you have filled in all the required fields, click the **"Submit"** button.

4.  A confirmation modal will appear. Review the details and click **"Confirm"** to proceed.

## Step 4: Monitor Your Deployment

After confirming, your deployment will begin. You can monitor its progress in real-time from the **Deployments** page.

1.  Your new deployment will appear in the list with a **`PROVISIONING`** status.

    ![Deployments list showing the new deployment with "PROVISIONING" status](/img/site/3.1-user-deployments.png)

2.  Click on the deployment to see more details. You can view the build status and logs.

    ![Deployment builds](/img/site/3.1.1-user-deployments-deployment-builds.png)

3.  The status will automatically update as the deployment progresses. A successful deployment will show a **`SUCCESS`** status.

    ![Deployment with "SUCCESS" status](/img/site/3.1.6-user-deployments-deployment-build-status-success.png)

4.  You can also view the deployment outputs, which may contain useful information like IP addresses or URLs.

    ![Deployment outputs](/img/site/3.1.3-user-deployments-deployment-outputs.png)

## Verification

Congratulations! You have successfully deployed your first application on the RAD Platform.

## Troubleshooting

-   **`FAILURE` Status:** If your deployment shows a `FAILURE` status, check the logs on the deployment details page. The logs will contain error messages that can help you identify the problem.

    ![Deployment with "FAILURE" status](/img/site/3.1.4-user-deployments-deployment-builds-failure.png)
    ![Deployment failure status details](/img/site/3.1.5-user-deployments-deployment-build-status-failure.png)

-   **Insufficient Credits:** If you do not have enough credits, the deployment will not start. You can purchase more credits from the **Credits** page.

-   **Deleting Deployments:** You can delete a deployment by clicking the trash icon. You will be asked to confirm the deletion.

    ![Delete deployment confirmation](/img/site/3.1.8-user-deployments-deployment-delete-confirmation.png)

-   **Purging Deployments:** Purging a deployment will remove all associated resources. This is a permanent action.

    ![Purge deployment confirmation](/img/site/3.1.9-user-deployments-deployment-purge-confirmation.png)

## Next Steps

Now that you have learned the basics of deploying a module, you can explore more advanced topics:

-   [Managing Your Credits](./managing-credits.md)
-   [Troubleshooting Failed Deployments](./troubleshooting-deployments.md)
-   Browse the module catalog to discover other applications you can deploy.
