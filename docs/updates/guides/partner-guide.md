# Partner Guide

## 1. Introduction

Welcome to the Partner Guide. As a Partner, you play a special role in the ecosystem. You have the ability to publish your own **Private Modules** and deploy them, in addition to the standard platform modules available to everyone.

## 2. Setting Up Your Repository

Before you can publish modules, you need to connect your Git repository and configure your optional AI tools.

1.  **Navigate to Profile:** Click your avatar in the top right and select "Profile".
2.  **Partner Settings:** Scroll down to the "Partner Settings" section.
3.  **GitHub Token:** Enter a GitHub Personal Access Token. It must have `repo` scope so the platform can read your private repositories.
4.  **Fetch Repos:** Click the "Fetch Repos" button to retrieve a list of your repositories.
5.  **Select Repository:** Select the repository that contains your Terraform modules from the dropdown list.
6.  **Jules API Key:** (Optional) Enter your Jules API Key if you wish to use the AI-powered module refinement agent.

## 3. Publishing Modules

Once your repo is connected, you can manage your module catalog.

1.  **Go to "Publish":** Click the **Publish** link in the main navigation.
2.  **View Modules:** You will see a grid of all valid modules found in the root of your connected repository.
3.  **Select:** Click on the module cards you want to make available for deployment. Selected modules will be highlighted.
4.  **Publish/Update:** Click the button at the bottom of the page to save your selection.
    *   **Publish:** New modules will be added to the system.
    *   **Update:** Existing modules will be updated with any changes you've made to their code or variables in GitHub.
    *   **Remove:** Deselecting a module and clicking Update will remove it from the deployment list.

## 4. Refining Modules with Jules

If you have configured your Jules API Key, you can use the AI agent to improve your modules directly from the Publish page.

1.  **Locate Module:** Find the module you want to refine in the list.
2.  **Click Sparkles Icon:** Click the sparkles icon (✨) in the top right of the module card.
3.  **Chat Interface:** A modal will open where you can chat with Jules. You can ask it to refactor code, add features, or fix bugs.
4.  **Commit:** Jules will propose changes and, upon your approval, commit them directly to your GitHub repository.

## 5. Deploying Partner Modules

Your modules are exclusive to you (unless the Admin has enabled "Private Mode" or you are deploying Platform modules).

1.  **Go to "Deploy":** Navigate to the deployment page.
2.  **Partner Modules Tab:** Click on the "Partner Modules" tab to see your published modules.
3.  **Deploy:** Select and deploy your modules just like any other platform module. You can also **Pin** your favorite modules to the top of the list for easy access.

## 6. Partner Credits & Costs

You can track your credit usage and project costs.

1.  **Go to "Credits":** Click the **Credits** link in the main navigation.
2.  **Credit Transactions:** View a history of your credit awards and usage.
3.  **Project Costs:** See a detailed breakdown of costs associated with your running projects.
4.  **Buy Credits:** If enabled, you can purchase additional credits here.

## 7. Private Mode & Data Visibility

The platform has a global setting called **Private Mode** that affects what you can see.

*   **Private Mode DISABLED (Default):** You operate in a silo. You only see *your* deployments and *your* modules.
*   **Private Mode ENABLED:** You are elevated to an Admin-like view. You can see **All Deployments** from all users across the organization.
