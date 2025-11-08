---
title: Administrator Guide
sidebar_position: 1
---

# Administrator Guide

## 1. Managing Deployments

As an administrator, you have an expanded view of the **Deployments** page. In addition to the "My Deployments" tab, which shows the modules you have personally deployed, you also have access to the "All Deployments" tab, which shows a list of every module deployed by all users across the platform.

### 1.1. Navigating the Dashboard

- **Search:** You can search for specific deployments by a module's name, its deployment ID, the associated project ID, or the email of the user who initiated the deployment.
- **Create New Deployment:** To deploy a new module, click the **Create New** button. This will take you to the module selection screen.
- **Deployment List:** The main area of the page lists deployments with key information such as the module name, status, creation date, and associated project ID. You can click on any deployment to view more details.
- **Pagination:** If there are many deployments, you can navigate through the pages using the controls at the bottom of the list.

## 2. Billing

Administrators have an expanded view of the **Billing** page, with additional tabs for managing the platform's finances and users.

### 2.1. Subscription Tiers Management

This tab allows administrators to create, edit, and manage the subscription tiers offered to users. You can define the price, the number of credits included, and the billing period for each tier.

### 2.2. Buy Credits

This tab provides a simple interface for making one-time credit purchases through Stripe.

### 2.3. User Credits

This tab provides a list of all users on the platform. Administrators can:

- **View User Information:** See each user's email, their balance of both awarded and purchased credits, and their partner status.
- **Edit User Details:** Click the **Edit** button next to a user to:
    - **Adjust Credit Balance:** Manually add or remove credits from a user's "Awarded" or "Purchased" balance.
    - **Change Partner Status:** Grant or revoke partner status for a user.
    - **Activate/Deactivate Account:** Toggle a user's account status.
- **Search:** Find specific users by searching for their email address.

### 2.4. Project Costs and Revenue

- **Project Costs:** This tab provides an aggregated view of the costs incurred by all projects across the platform.
- **Project Revenue:** This tab shows the total revenue generated from project deployments, giving administrators insight into the platform's financial performance.

### 2.5. Credit Settings

This page contains forms for managing global credit-related settings.

- **Adjust All User Credits:** Grant or deduct credits for all users at once, specifying whether to affect their "Awarded" or "Purchased" balances.
- **Price Per Credit:** Set the conversion rate for how many credits are equivalent to one unit of currency (e.g., USD).
- **Sign Up Credits:** Define the number of free credits a new user receives upon signing up.
- **Low Credit Alerts:** Set the credit balance threshold at which a user receives a low-credit notification email.
- **Send Message:** Send a custom message to all users or a select group of users.

## 3. Managing Your Profile

The **Profile** page allows you to manage your personal information and settings.

### 3.1. Profile Information

This section displays your basic profile information, including your name, email address, and profile picture, as provided by the authentication system.

### 3.2. Email Notification Settings

You can control which email notifications you receive from the application. You can toggle notifications for:

- **Deployments:** Receive updates on the status of your module deployments.
- **Billing:** Receive notifications related to your subscriptions and credit balance.

### 3.3. Configuring GitHub Repositories

As an administrator, you are responsible for setting up the global repository that hosts the **Platform Modules**.

1.  **Navigate to Profile:** Go to your profile page.
2.  **Provide a GitHub Token:** In the "Admin Settings" section, enter a GitHub Personal Access Token. This token needs `repo` scope to access the repositories.
3.  **Select the Repository:** After saving the token, a dropdown list of your available repositories will appear. Select the repository that contains the platform modules.

This repository will now be the source for all modules under the "Platform Modules" tab on the deployment page.

### 3.4. Deleting Your Account

At the bottom of the page, you will find an option to permanently delete your account. This action is irreversible and will remove all your data from the platform.

## 4. Administration

Administrators have access to a special **Admin** page for configuring global settings.

### 4.1. Admin Settings

This page allows administrators to set up the foundational configurations for the platform. This includes:

- **Mailbox Credentials:** Configure the credentials for the email service used to send notifications from the platform.
- **Deployment Retention:** Set the retention period for how long deployment history is stored.
- **Cleanup Schedule:** Configure the schedule (Daily, Weekly, or Monthly) for automatically cleaning up deployment records that are older than the retention period.
- **Other Global Variables:** Set other system-wide variables that control the application's behavior.

## 5. Help and Support

The **Help** page is your central resource for documentation and support. It contains:

- **User Guides:** Access to the Admin, Partner, Agent, and User guides.
- **Support Form:** A form to send a message directly to the support team or to specific users.

## 6. Theme Customization

You can switch between light and dark themes to suit your preference. The theme selector is located in the user menu in the top-right corner of the navigation bar.

## 7. Deployment Analysis

The "My Deployments" and "All Deployments" tabs are part of the Deployments page, which is accessible from the main navigation menu. This page provides a centralized view for tracking and analyzing all module deployments.

### 5.1. Deployments Table View

Both the "My Deployments" and "All Deployments" tabs present a table with a list of deployments. This table provides a high-level summary of each deployment, including:

- **Deployment ID:** A unique identifier for the deployment.
- **Module Name:** The name of the module that was deployed.
- **Status:** The current state of the deployment (e.g., PROVISIONING, SUCCESS, FAILURE, CANCELLED). This provides a quick, at-a-glance understanding of the deployment's outcome.
- **User:** The email of the user who initiated the deployment.
- **Created At:** The timestamp of when the deployment was initiated.
- **Actions:** A set of actions that can be performed on the deployment.

### 5.2. Detailed Deployment Analysis

The primary analysis feature is triggered when a user clicks on the Deployment ID of a specific deployment in the table. This action opens a detailed view, which contains several key features for in-depth analysis and troubleshooting.

#### 5.2.1. Deployment Details

The first thing you see is a summary of the deployment's core information, including:

- **Deployment ID:** The unique identifier is displayed again for reference.
- **Status:** The final status of the deployment (e.g., SUCCESS or FAILURE).
- **Creation and Completion Times:** Timestamps for when the deployment was started and when it finished, allowing users to understand the total duration.
- **Configuration Parameters:** A key-value list of all the variables and parameters that were used for this specific deployment instance. This is crucial for reproducing the deployment or debugging issues related to incorrect configuration.

#### 5.2.2. Tracking Deployment Stages and Progress

The platform provides a real-time, step-by-step log of the entire deployment process. This is the most critical feature for tracking progress and diagnosing issues.

- **Log Viewer:** The detailed view contains a dedicated log viewer that streams the logs directly from the backend build process (Cloud Build). Instead of waiting for the entire log file to be generated, it displays log entries as they happen, providing real-time feedback.
- **Step-by-Step Execution:** The logs are structured to show the distinct stages of the deployment pipeline, including cloning the Git repository, running Terraform to provision infrastructure, executing any custom scripts, and cleaning up resources.
- **Timestamps:** Every log line is timestamped, allowing for precise analysis of how long each step took to complete.

#### 5.2.3. Tracking Errors and Bugs

The log viewer is the primary tool for identifying and understanding errors.

- **Error Highlighting:** Failed steps and error messages from the underlying tools (like Terraform or shell scripts) are clearly visible in the log output. The deployment status will change to FAILURE, and the logs will contain the exact error message that caused the failure.
- **Root Cause Analysis:** By examining the logs, a user can pinpoint the exact stage and command that failed. For example, if a Terraform deployment fails, the `terraform apply` logs will show the specific resource that could not be created and the reason for the failure provided by the cloud provider. This allows for efficient debugging without needing to access the cloud console directly.
- **Full Context:** Since the entire log from start to finish is available, users can see the context leading up to an error, which is often essential for understanding the root cause.
