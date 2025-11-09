---
title: "Initial Platform Setup for Organizations"
sidebar_position: 1
description: "A guide for administrators on how to perform the initial setup and configuration of the RAD Platform for their organization."
keywords: ["tutorial", "administrator", "initial setup", "configuration", "platform setup"]
---

# Initial Platform Setup for Organizations

This tutorial is for new administrators who are setting up the RAD Platform for their organization for the first time. It covers the essential steps to configure the platform, set up the module repository, and prepare for user onboarding.

## What You'll Learn

- How to configure global platform settings.
- How to set up the Platform Modules repository.
- How to configure the credit system.
- How to set up email notifications.

### Prerequisites

- A RAD Platform account with **Administrator** privileges.
- A GitHub repository to host your organization's platform modules.

### Estimated Time

- **40 minutes**

---

## Step 1: Configure Global Settings

Global settings control the overall behavior of the platform.

1.  Navigate to the **Admin** page from the main menu.
2.  Under the **"Admin Settings"** tab, you can configure:

    -   **Mailbox Credentials:** Set up the email service for sending platform notifications.
    -   **Deployment Retention:** Define how long to keep deployment history.
    -   **Cleanup Schedule:** Schedule automated cleanup of old deployment records.

    [SCREENSHOT: Admin Settings page with global configuration options]

## Step 2: Set Up the Platform Modules Repository

This repository will be the source for the modules available to all users in your organization.

1.  Go to your **Profile** page and find the **"Admin Settings"** section.
2.  Create a GitHub Personal Access Token with `repo` scope, as described in the [partner tutorial](./../partners/first-module.md).
3.  Paste the token into the **"GitHub Token"** field and save.
4.  Select your organization's module repository from the dropdown list and save.

    [SCREENSHOT: Admin Settings in the profile for configuring the platform module repository]

## Step 3: Configure the Credit System

Administrators have full control over the platform's economy.

1.  Go to the **Billing** page and select the **"Credit Settings"** tab.
2.  Here you can configure:

    -   **Price Per Credit:** The conversion rate from currency to credits.
    -   **Sign Up Credits:** The number of free credits new users receive.
    -   **Low Credit Alerts:** The threshold for sending low-balance notifications.

    [SCREENSHOT: Credit Settings tab on the Billing page]

3.  Under the **"Subscription Tiers Management"** tab, you can create and manage the subscription plans available to your users.

    [SCREENSHOT: Subscription Tiers Management tab]

## Step 4: Set Up Email Notifications

Reliable email notifications are crucial for user communication.

1.  On the **Admin** page, ensure you have correctly configured the **Mailbox Credentials**.
2.  On your **Profile** page, under **"Email Notification Settings"**, you can control which notifications you, as an admin, receive.
3.  Users can configure their own notification preferences in their profiles.

## Verification

Your platform is set up correctly if:

-   You can see the modules from your configured repository on the **Deploy** page.
-   New users receive the correct number of sign-up credits.
-   You can create a new subscription tier.

## Next Steps

-   [User and Credit Management](./user-management.md)
-   [Monitoring Platform Health and Usage](./platform-monitoring.md)
-   Begin onboarding users to the platform.
