---
title: "Initial Platform Setup"
sidebar_position: 1
description: "A guide for administrators on how to perform the initial setup and configuration of the RAD Platform for their organization."
keywords: ["tutorial", "administrator", "initial setup", "configuration", "platform setup"]
---

# Initial Platform Setup

This tutorial is for new administrators who are setting up the RAD Platform for their organization for the first time. It covers the essential steps to configure the platform and prepare for user onboarding.

## What You'll Learn

- How to navigate the admin setup process.
- How to configure the credit system.
- How to set up email and payment processing.
- How to configure cloud providers.

### Prerequisites

- A RAD Platform account with **Administrator** privileges.

### Estimated Time

- **20 minutes**

---

## Step 1: Navigate to the Setup Page

All initial platform configuration is handled on the **Setup** page.

1.  From the main navigation menu, click on **"Setup"**.
    ![Setup Menu](/img/site/11-admin-setup-menu.png)

## Step 2: Complete the Setup Form

The setup process is a multi-step form that guides you through the essential configurations.

### Step 2.1: Credit and Subscription Settings

1.  Configure the initial credit allocation for new users and set up your subscription tiers.
    ![Setup Form - Page 1](/img/site/11.1-admin-setup-form1.png)

### Step 2.2: Email and Payment Configuration

1.  Enter your SMTP server details for sending email notifications.
2.  Connect your Stripe account to enable payment processing for credit purchases.
    ![Setup Form - Page 2](/img/site/11.1-admin-setup-form2.png)

### Step 2.3: Cloud Provider Setup

1.  Configure the cloud providers that will be available for deployments. This includes setting up service accounts and credentials.
    ![Setup Form - Page 3](/img/site/11.1-admin-setup-form3.png)
    ![Setup Form - Page 4](/img/site/11.1-admin-setup-form4.png)

## Verification

Your platform is set up correctly if:

-   You can save the setup form without errors.
-   New users receive the correct number of sign-up credits.
-   You can see the configured cloud providers on the deployment pages.

## Next Steps

-   [User Management](./user-management.md)
-   Begin onboarding users to the platform.
