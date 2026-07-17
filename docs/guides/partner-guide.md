---
title: "Partner Guide"
description: "RAD Platform partner guide — onboarding organizations, managing cohorts, and delivering Google Cloud certification training at scale."
---

# Partner Guide

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Partner_Guide.png" alt="Partner Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

For module authors who publish their own modules to RAD and earn a revenue share when others deploy them. New to RAD? Start with [Using RAD](using-rad.md).

A Partner is always also a User, so everything in [Using RAD](using-rad.md) — signing in, navigating, deploying, managing deployments, and credits — applies to you too. This guide covers the extra things only Partners can do.

> The Partner role is assigned manually by an administrator. Subscribing to a plan grants credits but does **not** make you a Partner. If you need Partner access, ask an administrator.

## What you can do

- Connect your own GitHub repository so RAD can read your modules.
- **Sync** your modules into the catalog from your repository.
- Deploy your own modules for free, alongside platform modules and other partners' public modules.
- Earn a partner revenue share when others deploy your modules (statements provided by the Finance team).
- See costs and invoices for the projects you own or deployed.

Your top navigation shows: **Credits**, **Explore**, **Sync**, **Deployments**, **Deploy**, **Help**. The **Explore** page lets you explore and refine your modules with Jules (available when Jules is configured).

## Connecting your GitHub repository

Before you can sync anything, connect the repository that holds your modules. Open the profile dropdown (top-right) and go to **Profile**, then install the **RAD Module Sync** GitHub App on the repository (or organization) that holds your modules. The GitHub App grants RAD read access to your repository — no personal access token is needed.

Once the app is installed and your repository is connected, the **Sync** page can read your modules from it.

## Syncing your modules

Go to the **Sync** page to bring your modules into the catalog. The page is a read-only sync console:

- It lists the valid modules found in your connected repository.
- Click **Sync Now** to refresh the catalog from your repository. Synced modules appear in the catalog for users to deploy.
- To update a module, change it in your repository and run **Sync Now** again — modules are managed in GitHub, not edited in RAD.
- Removing a module from your repository and re-syncing removes it from the catalog. You can only affect your own modules — never another partner's or a platform module.

If a module can't be read or has a configuration error, the Sync page shows which module is affected and why. Fix the issue in your repository, then sync again.

## How your modules appear to users

On the **Deploy** page you see two tabs:

- **Partner modules** — the modules you've published from your own repository. This is your workspace for testing and iterating.
- **Platform modules** — modules published by RAD, plus other partners' public modules.

Everyone else sees a single combined catalog of public modules. Each module card shows the description, a documentation link, an average star rating, how many times it's been deployed, and a credit cost badge.

Deploying your own module is **free** — no credits are deducted regardless of the module's credit cost.

## Earning revenue

You earn a partner revenue share when other users deploy your modules; your share is the portion allocated to you under the platform's revenue settings. There is no in-app page that shows your partner-module revenue — that data lives on the finance-only **Billing → Partner Revenue** view. Contact the Finance team for your partner-module revenue statements. (The **Revenue** page, if you reach it, shows only your own *referral* revenue, not module revenue.)

## Costs and invoices

You can see costs and invoices for the projects you own or deployed. These reflect the actual GCP cloud cost of running those projects. Costs and invoices for projects you don't own are not visible to you.

## Everyday tasks (same as any User)

These work exactly as described in [Using RAD](using-rad.md):

- **Deploy** — browse the catalog, fill in the guided configuration form, and launch.
- **Deployments** — track your deployments; open one for **Outputs**, **Build Status**, and build history; **Update**, **Delete**, or **Purge**; and rate modules.
- **Credits** — view your balance and **Credit Transactions** (with **Export CSV**), **Buy Credits**, and manage subscriptions.

## Getting help

Open the **Help** page and use the **Support** tab to contact the support team, or the **ROI** tab to estimate your savings. The **Contact us** link in the footer also goes to Help.
