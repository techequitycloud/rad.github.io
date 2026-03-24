import AudioPlayer from '@site/src/components/AudioPlayer';

# User Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/user_guide.png" alt="User Guide" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/guides/user_guide.m4a" title="User Quick Start Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/guides/user_guide.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction

Welcome to the User Guide for the Rapid Application Deployment (RAD) platform. This guide will help you navigate the platform, deploy modules, and manage your account.

## 2. Getting Started

### 2.1. Logging In
Access the platform using your Google credentials. If it's your first time, an account will be created for you automatically. Depending on the platform settings, you may receive initial "Sign-up Credits" to get you started.

### 2.2. The Dashboard
After logging in, you'll be taken to the **Deployments** page, which is your home base for managing your deployed applications. Your navigation bar includes **Credits** (if credits are enabled), **Deployments**, **Deploy**, **ROI**, and **Help**.

## 3. Deploying Applications

To deploy a new application, click the **Deploy** link in the top navigation bar.

### 3.1. Finding a Module
*   **Browse:** Explore "Platform Modules" (available to everyone) or "Partner Modules" (if you have specific access).
*   **Search:** Use the search bar to find modules by name.
*   **Pinning:** Click the **Pin** icon on any module card to save it to the top of your list for quick access.
*   **Stats:** View deployment counts, your current credit balance (if enabled), and the retention period for deployment history.

### 3.2. Launching a Deployment
1.  Click on any module card to start the provisioning process.
2.  **Configure:** Fill out the required variables (e.g., Project ID, Region).
3.  **Confirm:** Review your settings. If the module has a credit cost, you will see the amount that will be deducted from your balance.
4.  **Deploy:** Submit the form. You will be redirected to the status page where you can watch the deployment progress in real-time.

## 4. Managing Deployments

### 4.1. Monitoring & Actions
*   **Logs:** Click on a deployment to view real-time build logs. This is essential for troubleshooting if a deployment fails.
*   **Rating:** After a successful deployment, you can rate the module (1-5 stars) to help others identify high-quality modules.
*   **Delete:** To remove a deployment and destroy its resources, click the **Trash** icon. **Warning:** This action is irreversible.
*   **Purge:** For deployments that are stuck or require immediate, aggressive cleanup, use the **Purge** option. This forces a hard deletion of all resources and removes the deployment record immediately upon completion.

## 5. Billing & Credits

Manage your platform credits and costs on the **Credits** page.

### 5.1. Dashboard Tabs
*   **Buy Credits Tab:** (If enabled) Purchase additional credits via one-time payments through Stripe or Flutterwave.
*   **Credit Transactions Tab:** A detailed, searchable history of your credit balance. Filter by date range and export your transaction history as a CSV file.
    *   **Awarded Credits:** Free credits granted by the platform (e.g., sign-up bonus, referrals). These are used first but cannot be cashed out or used for revenue calculation.
    *   **Purchased Credits:** Credits you have bought via Stripe or Flutterwave. Deployment costs paid with these credits contribute to the "True Revenue" calculation for agents and partners.
*   **Module Costs Tab:** (If enabled) View a breakdown of costs by module across your deployments.
*   **Project Costs Tab:** (If enabled) View a breakdown of cloud infrastructure costs associated with your projects.
*   **Project Invoices Tab:** (If enabled) Access monthly invoices for your usage.
*   **Subscriptions Tab:** (If enabled) View available subscription tiers and manage your subscription to receive monthly credit allowances.

### 5.2. Subscriptions
If subscription tiers are available, you can upgrade your plan to receive a monthly allowance of credits and access to premium features.

## 6. ROI Calculator

Access the **ROI** page from your navigation bar to use the interactive Return on Investment calculator. This tool helps you estimate your cost and time savings by comparing RAD's automation against manual deployment workflows.

## 7. Help & Support

Need assistance? Visit the **Help** page, which is organized into multiple tabs:

*   **Support Tab:** Submit a support request by filling out the form with a Subject, Category (Technical, Billing, Feature, Bug, Account, or Other), Priority level, and a detailed message. If referrals are enabled, this tab also includes your unique **Referral Link** and **QR Code** for inviting new users to the platform. You can track your referral usage and share your link via the copy or share buttons.
*   **Platform Demos Tab:** View demonstration videos and showcases for platform features.
*   **Platform Workflows Tab:** Browse documented platform workflows.
*   **Platform Guides Tab:** Access user guides and documentation.
*   **Platform Features Tab:** Explore the platform's feature catalog.

## 8. Profile & Settings

Click your avatar in the top right to access your **Profile** page:

*   **Notification Settings:** Toggle **Deployment Notifications** and **Billing Notifications** on or off to control which email alerts you receive.
*   **Account Management:** View your account email. If needed, you can delete your account from this page (requires email confirmation).
*   **Theme:** Toggle between Light and Dark mode using the sun/moon icon in the navigation bar.
