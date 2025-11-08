---
title: User Guide
sidebar_position: 4
description: User guide for deploying multi-cloud infrastructure using RAD Platform modules across AWS, Azure, and Google Cloud
keywords: ['user guide', 'infrastructure deployment', 'cloud deployment', 'getting started', 'RAD Platform usage']
---

# User Guide

## 1. Getting Started

Welcome to the RAD Platform documentation. This guide covers the key features and functionalities available in the [RAD Console](https://rad.techequity.cloud).

### 1.1. Logging In

Access the [RAD Console](https://rad.techequity.cloud) to begin. Authentication is handled through a secure sign-on system. Upon your first visit, you will be prompted to log in with your Google credentials.

### 1.2. The Main Dashboard

After logging in, you will land on the **Deployments** page. This is your main dashboard, providing a comprehensive overview of all module deployments. You will see a list of all the modules you have personally deployed ("My Deployments").

### 1.3. Navigating the Dashboard

- **Search:** A search bar is located at the top of the page, allowing you to quickly find specific deployments. You can search by a module's name, its deployment ID, or the associated project ID.
- **Create New Deployment:** To deploy a new module, click the **Create New** button. This will take you to the module selection screen.
- **Deployment List:** The main area of the page lists your deployments with key information such as the module name, status, creation date, and associated project ID. You can click on any deployment to view more details.
- **Pagination:** If there are many deployments, you can navigate through the pages using the controls at the bottom of the list.

## 2. Deploying a Module

The core functionality of the application is to deploy pre-built modules. This process is designed to be straightforward.

### 2.1. Selecting a Module

1. From the **Deployments** page, click the **Create New** button.
2. You will be taken to the module selection page, where you can browse the available platform modules. Each module card displays its name, a brief description, and the credit cost to deploy it.
3. Click on the card of the module you wish to deploy.

### 2.2. Configuring the Deployment

After selecting a module, you will be taken to the provisioning page, where you need to configure the deployment.

1. **Configuration Form:** A form will be displayed with a series of fields. These are the variables required to deploy the module, such as project IDs, regions, or other specific settings.
2. **Fill out the Form:** Complete all the required fields with the appropriate information for your deployment.
3. **Submit:** Once you have filled out the form, click the **Submit** button. The application will display module dependencies and validate your inputs and, if your credit balance is sufficient, begin the deployment process.

You will be redirected back to the **Deployments** page, where you can monitor the status of your new deployment.

## 3. Billing

The **Billing** page allows you to manage your credits, subscriptions, and view your spending history. You can access it from the main navigation menu.

### 3.1. Subscription Tiers

This tab displays all available subscription tiers. You can subscribe to a tier to receive a recurring amount of credits.

- **Subscribing:** Click the **Subscribe** button on your desired tier to be redirected to a secure payment page.
- **Active Subscriptions:** If you have an active subscription, it will be highlighted, and the other tiers will be disabled.
- **Managing Subscriptions:** You can manage your active subscription, such as canceling the auto-renewal, from this tab.

### 3.2. Buy Credits

This tab provides a simple interface for making one-time credit purchases through Stripe. This is useful if you need more credits than your subscription provides.

### 3.3. Credit Transactions

This tab provides a detailed history of all your credit transactions.

- **Transaction History:** The table lists all credit additions (from subscriptions or direct purchases) and deductions (from deploying modules or project costs). It shows the date, category, amount, and your resulting credit balance after each transaction.
- **Search and Filter:** You can search for specific transactions by deployment ID or filter the list by date.
- **Export:** You can export your credit history as a CSV file by clicking the **Export CSV** button.

### 3.3. Project Costs

This tab shows you the ongoing costs associated with your deployed projects, deducted from your credit balance. It helps you monitor your spending over time.

### 3.4. Monthly Invoices

Here you can view and download your monthly invoices for your records.

## 4. Managing Your Profile

The **Profile** page allows you to manage your personal information and settings.

### 4.1. Profile Information

This section displays your basic profile information, including your name, email address, and profile picture, as provided by the authentication system.

### 4.2. Email Notification Settings

You can control which email notifications you receive from the application. You can toggle notifications for:

- **Deployments:** Receive updates on the status of your module deployments.
- **Billing:** Receive notifications related to your subscriptions and credit balance.

### 4.3. Deleting Your Account

At the bottom of the page, you will find an option to permanently delete your account. This action is irreversible and will remove all your data from the platform.

## 5. Help and Support

The **Help** page is your central resource for documentation and support. It contains:

- **User Guides:** Access to the Admin, Partner, Agent, and User guides.
- **Support Form:** A form to send a message directly to the support team.
- **Invite User:** A form to invite a new user to the platform.

## 6. Theme Customization

You can switch between light and dark themes to suit your preference. The theme selector is located in the user menu in the top-right corner of the navigation bar.

## 7. Deployment Analysis

The "My Deployments" tab is part of the Deployments page, which is accessible from the main navigation menu. This page provides a centralized view for tracking and analyzing all module deployments.

### 5.1. Deployments Table View

The "My Deployments" tab presents a table with a list of deployments. This table provides a high-level summary of each deployment, including:

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
