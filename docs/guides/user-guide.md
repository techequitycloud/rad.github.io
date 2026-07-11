---
title: "User Guide"
description: "RAD Platform user guide — deploying training modules to Google Cloud, tracking progress, and working through certification labs."
---

# User Guide

This guide is for anyone using RAD to deploy and manage cloud modules — the default **User** role. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

- Browse the **Deploy** catalog and deploy ready-made modules through a guided form.
- Track and manage your own **Deployments** — view results and logs, update, and tear down.
- Manage **Credits** — check your balance, review your transaction history, and buy more.
- Subscribe to a recurring credit plan.
- Estimate your savings with the **ROI** calculator.
- View costs and invoices for the projects you own or have deployed to.
- Get help through the **Support** form.

After you sign in you land on the **Deployments** page. Your top navigation shows **Credits** (when credits are enabled), **Deployments**, **Deploy**, and **Help**.

## Finding a module

Click **Deploy** in the top navigation to open the module catalog. Modules appear as cards.

- **Browse:** You see a single combined catalog of public modules — both modules published by RAD and public modules published by partners.
- **Search:** Use the search bar to find a module by name, then page through the results.
- **Pin:** Click the pin on a card to keep a favourite module at the top of your catalog for quick access.
- **Read each card:** Every card shows the module description, a **documentation** link, an average star rating, how many times it has been deployed, and a **credit cost** badge.
- **Contact publisher:** Use the **Contact publisher** action on a card to email the module's publisher with a question.

A stats strip at the top shows total deployments, your current credit balance (when credits are enabled), and how long deployment history is retained.

## Deploying a module

1. **Open the form.** Click a module card to open its guided configuration form. Fields are grouped into steps that you move through in order. Administrative and internal fields are hidden from you. If you don't have an active subscription, some later steps may be locked.
2. **Fill in the configuration.** Complete the required fields on each step (for example, project and region). Move forward when each step is valid.
3. **Confirm.** Before launching, a confirmation dialog may appear — for example when the module costs credits, has dependencies, or needs special permissions. Review the details, including how many credits the deployment will cost.
4. **Deploy.** Click **Deploy** to queue the deployment. If you don't have enough credits, RAD shows the module's credit cost against your current balance and prompts you to top up first.

**What happens next:** Your deployment is queued and then provisioned on Google Cloud. You can follow its progress on the **Deployments** page and in the deployment's details.

## Managing your deployments

Click **Deployments** to see your deployments. Each row shows the module, deployment ID, project, status, the action, who deployed it, when, how long it took, the credits used, and an editable **star rating**.

Deployment statuses include Queued, Working, Success, Failure, Deleting, Deleted, Cancelled, Timeout, and Expired.

Open a deployment to see its details, which has these tabs:

- **Outputs** — the non-sensitive results of the deployment (such as application URLs, addresses, and endpoints exported by the module). These appear once the deployment succeeds.
- **Build Status** — live logs, useful for watching progress or troubleshooting a failure.
- **Builds** — the build history for the deployment.

From the details view you can also:

- **Update** — reopen the configuration form (pre-filled with the current values), change what you need, and re-apply. Available once a deployment has finished.
- **Delete** — remove the deployment. You get two choices:
  - **Delete** tears down the cloud resources the deployment created.
  - **Purge** removes the deployment from RAD *without* destroying the cloud resources. Use Purge when a deployment is stuck or was changed outside RAD.
- **Rate the module** — set or change the star rating to help others find high-quality modules.

## Credits

Open the **Credits** page to manage your balance. Your balance is your awarded credits plus any credits you've purchased. Credits are charged when you deploy a module, equal to that module's credit cost.

The Credits page has these tabs:

- **Credit Transactions** — your full history of credit awards, purchases, and spend. Filter by deployment and by date, and use **Export CSV** to download a report.
- **Buy Credits** (when enabled) — top up your balance.

**To buy credits:** open the **Buy Credits** tab, choose a currency and amount, pick a payment provider, and complete checkout on the provider's secure page. Your credits are added automatically once the payment confirms.

Some platforms require *purchased* credits (not just awarded credits) before you can deploy — in that case, buy credits first even if you have an awarded balance.

## Subscriptions

A subscription is an optional recurring plan that grants a set number of credits each billing cycle.

- **Subscribe:** choose a plan and complete checkout via your chosen payment provider.
- **Cancel:** stop future renewals. Your remaining credits stay available.
- **Reinstate:** resume automatic renewals on a cancelled plan if you change your mind.

A subscription only grants credits — it does not change your role on the platform.

## ROI calculator

Open **Help** and go to the **ROI** tab to use the interactive ROI calculator. It comes pre-filled with your real recent activity (your deployments and spend) and lets you adjust assumptions — monthly deployments, manual deployment time, engineer hourly cost, and time-savings percentage — to estimate your labour cost, platform cost, net savings, and return on investment. It's an estimator only: it never deploys anything or charges your account.

## Viewing your costs and invoices

You can see costs and invoices for the projects you own or have deployed to. This covers what your own deployments have cost. (You won't see costs or invoices for other people's projects.)

## Getting help

Open **Help** and use the **Support** tab to raise a question or report a problem. Fill in the form to send your message — this raises a support ticket and notifies the support team, who follow up with you. A **Contact us** link in the footer also takes you to the Help page.
