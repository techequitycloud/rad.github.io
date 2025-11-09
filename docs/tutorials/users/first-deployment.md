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

First, you need to log in to the RAD Platform. The platform uses a secure single sign-on (SSO) system for authentication.

1.  Open your web browser and navigate to the [RAD Console](https://rad.techequity.cloud).
2.  You will be prompted to log in with your Google account. Click the **"Sign in with Google"** button and follow the authentication prompts.

![RAD Console login page](/img/tutorials/users/login-page.png)

Once you have successfully logged in, you will be redirected to the main dashboard, which is the **Deployments** page.

![Main dashboard after login](/img/tutorials/users/main-dashboard.png)

## Step 2: Select a Module to Deploy

Now that you are logged in, you can choose a pre-built module to deploy. For this tutorial, we will deploy a simple web server.

1.  On the **Deployments** page, click the **"Create New"** button located at the top right of the page.

    !["Create New" button on the Deployments page](/img/tutorials/users/create-new-button.png)

2.  You will be taken to the module selection screen. Here, you can browse the available **Platform Modules**. Each module is displayed as a card with its name, description, and the credit cost for deployment.

    ![Platform Modules catalog with various module cards](/img/tutorials/users/platform-modules-catalog.png)

3.  Locate the **"Simple Web Server"** module and click on its card to select it.

    !["Simple Web Server" module card highlighted](/img/tutorials/users/simple-web-server-module.png)

## Step 3: Configure Your Deployment

After selecting a module, you need to provide some configuration details. This tells the RAD Platform how to set up your application.

1.  You will be taken to the provisioning page, which displays a form with the required configuration variables for the module.

    ![Deployment configuration form for the web server module](/img/tutorials/users/deployment-config-form.png)

2.  Fill in the form with the following details:

    -   **Deployment Name:** A descriptive name for your deployment (e.g., `my-first-web-server`).
    -   **Project ID:** The Google Cloud Project ID where the server will be deployed.
    -   **Region:** The geographical region for your server (e.g., `us-central1`).
    -   **Zone:** The specific zone within the region (e.g., `us-central1-a`).

    *Note: The exact fields may vary depending on the module you choose.*

3.  Once you have filled in all the required fields, click the **"Submit"** button.

4.  A confirmation modal will appear, showing the credit cost for the deployment and your available credit balance. Click **"Confirm"** to proceed.

    ![Deployment confirmation modal showing credit cost](/img/tutorials/users/deployment-confirmation-modal.png)

## Step 4: Monitor Your Deployment

After confirming, your deployment will begin. You can monitor its progress in real-time from the **Deployments** page.

1.  You will be redirected back to the **Deployments** page. Your new deployment will appear at the top of the list with a **`PROVISIONING`** status.

    ![Deployments list showing the new deployment with "PROVISIONING" status](/img/tutorials/users/deployment-provisioning-status.png)

2.  The status will automatically update as the deployment progresses. A successful deployment will show a **`SUCCESS`** status.

    ![Deployment with "SUCCESS" status](/img/tutorials/users/deployment-success-status.png)

3.  To view the detailed logs, click on the **Deployment ID** of your new deployment. This will take you to the deployment details page.

    ![Deployment details page with log viewer](/img/tutorials/users/deployment-details-logs.png)

4.  The log viewer shows a step-by-step record of the entire deployment process. This is useful for understanding what the platform is doing and for troubleshooting if something goes wrong.

## Verification

Congratulations! You have successfully deployed your first application on the RAD Platform. To verify that your web server is running, you can check the deployment outputs.

1.  On the deployment details page, look for the **Outputs** section.
2.  You should see an output variable named `instance_ip` with an IP address. Copy this IP address and paste it into your web browser.
3.  If the deployment was successful, you will see a "Welcome to your new web server!" message.

## Troubleshooting

-   **`FAILURE` Status:** If your deployment shows a `FAILURE` status, check the logs on the deployment details page. The logs will contain error messages that can help you identify the problem.
-   **Insufficient Credits:** If you do not have enough credits, the deployment will not start. You can purchase more credits from the **Billing** page.
-   **Invalid Configuration:** If you enter an incorrect Project ID or other invalid parameters, the deployment may fail. Double-check your configuration and try again.

## Next Steps

Now that you have learned the basics of deploying a module, you can explore more advanced topics:

-   [Managing Your Credits and Subscriptions](./managing-credits.md)
-   [Troubleshooting Failed Deployments](./troubleshooting-deployments.md)
-   Browse the module catalog to discover other applications you can deploy.
