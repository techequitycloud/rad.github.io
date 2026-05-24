---
title: User Tutorial
---

# Tutorial: User Guide

## Overview

This tutorial covers the core day-to-day tasks you will perform as a platform user: browsing and deploying modules, monitoring and managing your deployments, tracking your credit balance, and getting help when you need it.

**Audience:** Any authenticated user  
**Estimated time:** 15–20 minutes

By the end of this tutorial you will have:
- Deployed a module from the platform catalog
- Monitored a live deployment and interpreted its status
- Reviewed your credit balance and transaction history
- Located the support and help resources available to you

---

## Step 1: Deploy a Module

The core feature of the platform is deploying pre-configured software modules — each one provisions a real cloud application or service into your Google Cloud project using Terraform.

1. Click **Deploy** in the top navigation bar to open the module catalog.
2. **Find a module:**
   - Browse the **Platform Modules** tab for modules curated by platform administrators.
   - Use the **Search** bar to filter by name.
   - If you have access to partner-published modules, click the **Partner Modules** tab.
3. Click a module card to open its configuration form.
4. Fill in the required variables — at minimum a **Project ID** and a **Region**. Optional fields can be left at their defaults.
5. Review the **estimated credit cost** shown in the form (if credits are enabled on your platform).
6. Click **Deploy** and then **Confirm** on the cost confirmation modal.

> **Tip:** Modules are sorted by deployment count and average rating — the most-used and highest-rated modules appear first. You can pin frequently used modules to the top of your list using the **Pin** icon on each card.

---

## Step 2: Monitor Your Deployments

Once a module is submitted, you can track its progress and manage it throughout its lifecycle.

1. Click **Deployments** in the navigation bar.
2. **Interpret the status:**

   | Status | Meaning |
   | :--- | :--- |
   | `QUEUED` | The deployment is waiting for a build runner to become available |
   | `WORKING` | Infrastructure is actively being provisioned |
   | `SUCCESS` | The deployment completed successfully |
   | `FAILURE` | The deployment encountered an error — review the build logs |
   | `TIMEOUT` | The build exceeded the maximum allowed duration |

3. Use the **Search** bar to filter by deployment name or ID if you have many deployments.
4. Click on any deployment row to expand it and access:
   - **Build logs** — Full real-time output from the Terraform provisioning run. This is the primary tool for diagnosing failures.
   - **Deployment details** — Configuration values used, timestamps, and credit cost breakdown.
5. To remove an application you no longer need, click the **trash icon** (Delete) on the deployment row. This deprovisions the infrastructure and stops any ongoing credit charges.

---

## Step 3: Manage Credits and Costs

If your platform instance uses a credit system, you will need to monitor and top up your balance to continue deploying.

1. Click **Credits** in the navigation bar.
2. Your **current balance** is displayed in the header stats at the top of the page.
3. **Purchase credits (if subscriptions are enabled):**
   - Click the **Buy Credits** tab.
   - Choose a subscription plan or a one-time credit bundle from the options available.
4. **Review your transaction history:**
   - Click the **Credit Transactions** tab.
   - Each row shows the deployment it relates to and the number of credits consumed.
   - Click **Export CSV** to download a full transaction report for your records or for expense reporting.

> **Note:** Your total credit cost for a deployment typically has two components — a fixed module fee charged at the time the deployment is submitted, and a variable **Build Time** charge based on how long the Terraform run takes to complete. Both are visible in your transaction history.

---

## Step 4: Get Help

Several help resources are available directly within the platform.

1. Click **Help** in the navigation bar.
2. **User Guide tab** — Detailed documentation covering all platform features for your role.
3. **Support tab** — Fill out the support form to send a message directly to the platform admin team. Include your Deployment ID if you are reporting a specific issue, as this significantly speeds up diagnosis.
4. **Invite Friends** (if enabled) — Copy your personal referral link or scan the QR code to invite new users. You may earn commission on their deployments through the Agent Programme.
5. **ROI Calculator** (if enabled) — Estimate your time and cost savings from using the platform. See the [ROI Tutorial](./roi) for a walkthrough.

---

## Next Steps

- **[Getting Started Tutorial](./getting-started)** — If you haven't deployed your first module yet, start here.
- **[ROI Tutorial](./roi)** — Learn to use the ROI Calculator to quantify your efficiency gains.
- **[Agent Tutorial](./agent)** — If you want to earn commission by referring other users, the Agent Programme is explained here.
