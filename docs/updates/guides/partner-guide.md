# Partner Guide

## 1. Introduction

Welcome to the Partner Guide. As a Partner, you play a special role in the ecosystem. You have the ability to publish your own **Private Modules** and deploy them, in addition to the standard platform modules available to everyone.

## 2. Setting Up Your Repository

Before you can publish modules, you need to connect your Git repository.

1.  **Navigate to Profile:** Click your avatar in the top right and select "Profile".
2.  **Partner Settings:** Look for the "GitHub Configuration" section.
3.  **Access Token:** Enter a GitHub Personal Access Token. It must have `repo` scope so the platform can read your private repositories.
4.  **Select Repository:** After saving the token, select the repository that contains your Terraform modules from the dropdown list.

## 3. Publishing Modules

Once your repo is connected, you can manage your module catalog.

1.  **Go to "Publish":** Click the **Publish** link in the main navigation.
2.  **View Modules:** You will see a list of all valid modules found in the root of your connected repository.
3.  **Select:** Check the boxes for the modules you want to make available for deployment.
4.  **Publish/Update:** Click the button to save your selection.
    *   **Create:** New modules will be added to the system.
    *   **Update:** Existing modules will be updated with any changes you've made to their code or variables in GitHub.
    *   **Remove:** Unchecking a module and clicking Update will remove it from the deployment list.

## 4. Deploying Partner Modules

Your modules are exclusive to you (unless the Admin has enabled "Private Mode").

1.  **Go to "Deploy":** Navigate to the deployment page.
2.  **Partner Modules Tab:** You will see a dedicated tab for "Partner Modules".
3.  **Deploy:** Select and deploy your modules just like any other platform module.

## 5. Private Mode & Data Visibility

The platform has a global setting called **Private Mode** that affects what you can see.

*   **Private Mode DISABLED (Default):** You operate in a silo. You only see *your* deployments, *your* revenue, and *your* modules.
*   **Private Mode ENABLED:** You are elevated to an Admin-like view. You can see **All Deployments** from all users, **All Invoices**, and **All Costs** across the organization.

## 6. Partner Credits

You may be eligible for a monthly credit allowance.
*   **Automatic Grant:** If an admin has configured it, you will receive a set amount of "Purchased" credits automatically at the start of each month.
*   **Check Balance:** View your "Purchased" balance on the **Billing** page to see your available funds.
