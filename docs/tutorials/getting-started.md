---
title: Quick Start Tutorial
---

# Tutorial: Getting Started

## Overview

This tutorial walks you through your first experience with the Rapid Application Deployment (RAD) platform — from logging in, to exploring the dashboard, to successfully deploying and monitoring your first module.

**Audience:** Any new user  
**Estimated time:** 10–15 minutes

By the end of this tutorial you will have:
- Logged in to the platform using your Google account
- Familiarised yourself with the navigation and dashboard
- Deployed your first module
- Monitored a live deployment build and confirmed success

---

## Step 1: Log In

1. Navigate to the RAD platform URL provided by your administrator.
2. Click the **Sign in with Google** button.
3. Enter your Google credentials and complete any two-factor authentication prompts.
4. You will be redirected to the **Deployments** page — your role-specific home page.

> **Tip:** If you are a new user, check your notification area after signing in. The platform may have automatically credited your account with **Sign-up Credits** to get you started.

---

## Step 2: Explore the Dashboard

The **Deployments** page is your main hub on the platform. Take a moment to familiarise yourself with the layout.

**My Deployments** — The list is empty right now. It will populate as soon as you deploy your first application.

**Navigation bar items:**

| Item | Purpose |
| :--- | :--- |
| **Credits** | View your current credit balance and full transaction history |
| **Deployments** | Monitor running applications, view build logs, and manage existing deployments |
| **Deploy** | Browse the module catalog and launch new applications |
| **Help** | Access guides, tutorials, and the support contact form |

---

## Step 3: Deploy a Module

Let's launch your first application.

1. Click **Deploy** in the top navigation bar.
2. Ensure you are on the **Platform Modules** tab.
3. Browse the module cards or type a name into the **Search** bar (for example, try searching for "Simple Website").
4. Click a module card to open its configuration form.
5. Fill in the required fields:
   - **Project ID** — Enter a unique identifier for your cloud project.
   - **Region** — Select a deployment region (for example, `us-central1`).

   > **Note:** The configuration form may have multiple steps. Click **Next** to move between them. Required fields are marked; optional fields can be left at their defaults.

6. Click **Submit** to proceed.
7. A confirmation modal will display the credit cost for this deployment. Review it and click **Confirm** to proceed.

---

## Step 4: Monitor Your Deployment

After confirming, you are returned to the **Deployments** page.

1. Locate your new deployment in the list — it will initially show a status of `QUEUED` or `WORKING`.
2. Click the **Deployment ID** link to open the details view.
3. Scroll down to the **Build Logs** section. Logs stream in real time as the platform provisions your infrastructure.
4. Wait for the status indicator to turn green: **`SUCCESS`**.

> **Tip:** Build times vary by module complexity. Most standard modules complete within 5–15 minutes. If the status changes to `FAILURE`, open the build logs to review the error — the [Support Tutorial](./support) explains how to interpret common failure types.

---

## Congratulations

You have successfully deployed your first module on the RAD platform. Your application is now provisioned and running in your Google Cloud project.

---

## Next Steps

- **[User Tutorial](./user)** — Learn how to manage deployments, handle credits, and get help.
- **[ROI Tutorial](./roi)** — Use the ROI Calculator to quantify the time and cost savings from using RAD.
- **[Platform Guides](/docs/guides/user)** — Explore detailed feature-by-feature documentation for your role.
