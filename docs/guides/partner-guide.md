---
title: "Partner Guide"
description: "RAD Platform partner guide — onboarding organizations, managing cohorts, and delivering Google Cloud certification training at scale."
---

# Partner Guide

For module authors who publish their own modules to RAD and earn a revenue share when others deploy them. New to RAD? Start with [Using RAD](using-rad.md).

A Partner is always also a User, so everything in [Using RAD](using-rad.md) — signing in, navigating, deploying, managing deployments, and credits — applies to you too. This guide covers the extra things only Partners can do.

> The Partner role is assigned manually by an administrator. Subscribing to a plan grants credits but does **not** make you a Partner. If you need Partner access, ask an administrator.

## What you can do

- Connect your own GitHub repository so RAD can read your modules.
- **Publish** your modules to the catalog, and update or delete your own modules.
- Discover modules with **Explore** (when the AI integration is configured).
- Deploy your own modules for free, alongside platform modules and other partners' public modules.
- Earn a partner revenue share when others deploy your modules (**Revenue** page).
- See costs and invoices for the projects you own or deployed.

Your top navigation shows: **Credits**, **Deploy**, **Deployments**, **Explore**, **Publish**, **Help**. **Explore** and **Publish** appear once your repository is configured.

## Connecting your GitHub repository

Before you can publish anything, connect the repository that holds your modules. Open the profile dropdown (top-right) and go to **Profile**, then provide:

1. **Repository URL** — the repository RAD should read your modules from.
2. **Access token** — a personal access token so RAD can read the repository.
3. **AI / Jules API key** — enables AI-assisted discovery on the **Explore** page.

Save your settings. Once your repository is connected, the **Publish** item appears in your navigation; **Explore** appears when the AI integration is configured.

## Publishing and managing modules

Go to the **Publish** page to manage which of your modules are available in the catalog.

- The page lists the valid modules found in your connected repository.
- Select the modules you want to make available and publish them. Published modules appear in the catalog for users to deploy.
- **Update** a module to refresh it after you change it in your repository.
- **Delete** removes a module from the catalog. You can update or delete only your own modules — never another partner's or a platform module.

If a module can't be read or has a configuration error, the Publish page shows which module is affected and why. Fix the issue in your repository, then publish again.

## Discovering modules with Explore

When the AI integration is configured (you've supplied an AI / Jules API key), the **Explore** page offers AI-assisted discovery of modules from your repository to help you prepare and refine what you publish.

## How your modules appear to users

On the **Deploy** page you see two tabs:

- **Partner modules** — the modules you've published from your own repository. This is your workspace for testing and iterating.
- **Platform modules** — modules published by RAD, plus other partners' public modules.

Everyone else sees a single combined catalog of public modules. Each module card shows the description, a documentation link, an average star rating, how many times it's been deployed, and a credit cost badge.

Deploying your own module is **free** — no credits are deducted regardless of the module's credit cost.

## Earning revenue

Open the **Revenue** page to see the partner revenue share you've earned from deployments of your modules. Revenue is generated when users deploy your modules; your share is the portion allocated to you under the platform's revenue settings. If you can't see the Revenue page, the Finance team can provide revenue statements.

## Costs and invoices

You can see costs and invoices for the projects you own or deployed. These reflect the actual GCP cloud cost of running those projects. Costs and invoices for projects you don't own are not visible to you.

## Everyday tasks (same as any User)

These work exactly as described in [Using RAD](using-rad.md):

- **Deploy** — browse the catalog, fill in the guided configuration form, and launch.
- **Deployments** — track your deployments; open one for **Outputs**, **Build Status**, and build history; **Update**, **Delete**, or **Purge**; and rate modules.
- **Credits** — view your balance and **Credit Transactions** (with **Export CSV**), **Buy Credits**, and manage subscriptions.

## Getting help

Open the **Help** page and use the **Support** tab to contact the support team, or the **ROI** tab to estimate your savings. The **Contact us** link in the footer also goes to Help.
