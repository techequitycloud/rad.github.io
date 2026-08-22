---
title: "Using RAD"
description: "How to use the RAD Platform: signing in, navigation, roles, deploying modules to your own Google Cloud project, credits, and billing."
---

# Using RAD

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Using_RAD.png" alt="Using RAD" style={{maxWidth: "100%", borderRadius: "8px"}} />

This is the shared overview for everyone who uses RAD. It covers signing in, finding your way around, the roles, and the core concepts (modules, deployments, credits, billing, and getting help). Each role guide links back here for the basics, then focuses on what that role does.

---

## What is RAD

RAD (Rapid Application Deployment) is a web portal for deploying ready-made Google Cloud modules without writing any infrastructure code. You pick a module, fill in a guided configuration form, and the platform provisions it on Google Cloud for you.

Usage is metered in **credits**: most modules cost a set number of credits to deploy, and your balance is checked before a deployment runs.

---

## Signing in

1. Open the RAD sign-in page and click **Sign in with Google**.
2. Choose your Google account.

The first time you sign in, your account is created automatically. New accounts start with the **User** role and are active right away. (If the platform is running in private mode, only people who already have a RAD account can sign in — new self-registration is turned off, so ask an administrator to create your account if you can't get in.)

To sign out, open the **profile dropdown** in the top-right corner and choose **Sign out**.

---

## Finding your way around

The top navigation bar shows only the items relevant to your role (or roles). Wherever you are, you'll find:

- A **profile dropdown** (top-right) with **Profile** and **Sign out**.
- A **Contact us** link in the footer that takes you to the **Help** page.

There is no separate combined dashboard — each item in the top nav is its own page.

After you sign in, RAD takes you to the page that fits your role:

- **Admin**, **Partner**, **User** → **Deployments**
- **Finance** → **Billing**
- **Agent** → **Revenue**
- No role assigned yet → **Help**

---

## Roles at a glance

You can hold more than one role at once (for example Agent and Partner), and a **Partner is always also a User**. Roles are granted by an administrator.

| Role | What they do | Where they start |
| :--- | :--- | :--- |
| **User** | Browse the catalog, deploy and manage their own modules, manage their credits | Deployments |
| **Admin** | Everything a user can do, plus full platform administration: users, settings, modules, and oversight | Deployments |
| **Partner** | A user who also publishes their own modules and earns revenue from them | Deployments |
| **Agent** | Earns referral commission on activity from users they referred | Revenue |
| **Finance** | Financial reporting and payouts: subscription tiers, revenue, invoices | Billing |
| **Support** | Triages support tickets; sees deployments for the customers whose open tickets are assigned to them | Deployments |
| **Trainer** | Provisions lab deployments for an assigned roster of participants, one per participant, and sees what they provisioned | Deployments |

See the role guides at the end for the full task lists.

---

## Core concepts

### The Modules catalog

The **Modules** page is the module catalog. Each module appears as a **card** showing its description, a documentation link, an average star rating, how many times it has been deployed, and a **credit cost** badge.

There are two kinds of modules:

- **Platform modules** — published by RAD.
- **Partner modules** — published by partners.

If you're a partner you'll see two tabs (your own **Partner modules** and **Platform modules**, which also includes other partners' public modules). Everyone else sees a single combined catalog of public modules.

You can **pin** the modules you use most so they stay at the top, **search** by name, filter by **category** from the list beside the grid, and page through the catalog. A stats strip at the top shows total deployments, your credit balance (when credits are enabled), and how long deployment history is kept.

### Deploying a module

1. Click a module card to open its guided, multi-step **configuration form**. Fill in the fields, using **Next** to move through the steps. Required fields can't be left blank, and the form checks your entries before you continue.
2. A confirmation dialog appears if the module costs credits, has dependencies, or needs special permissions.
3. Click **Deploy Module**. The deployment is queued and provisioned, and you're taken to the **Deployments** page. If you don't have enough credits, RAD shows the module's cost against your balance and prompts you to top up.

On the **Deployments** page each row shows the module, the deployment ID, an editable **star rating**, when it was created, how long it took, the status, and the action. There's no project or credits column — open a deployment for its project, and its **Builds** tab for what each build consumed. Admins and support see an extra column for who deployed it, and can switch between **All deployments** and **My deployments**; everyone else sees their own. For support, "All deployments" is scoped to the customers whose open tickets are assigned to them, not the whole platform.

Click a deployment to open its details, which has three tabs:

- **Outputs** — the non-sensitive results (such as URLs and endpoints), shown once the deployment succeeds.
- **Build Status** — live logs as the deployment runs. Once it succeeds, **Explain this** opens a plain-English summary of what was created in your Google Cloud project; on a step that failed, **Search for a fix** and **Ask for help** both work from the error that step printed.
- **Builds** — the build history for that deployment.

From the details view you can:

- **Update** — re-open the configuration form (pre-filled) and re-apply changes. Available once a deployment has finished.
- **Delete** — choose **Delete** to tear down the cloud resources, or **Purge** to remove the deployment from RAD *without* destroying the cloud resources (useful when a deployment is stuck or was changed outside RAD). A RAD-managed GCP project ("GCP Project on RAD") is torn down the same way, but because that takes the whole project with it, RAD refuses while any other deployment is still running in that project and lists the ones to delete first. Google keeps a deleted project recoverable for about 30 days.
- **Cancel** — released a deployment that is stuck in Queued and never starts building, or a purge that has stalled.

Deployment statuses you may see include Queued, Pending, Working, Waiting (on a prerequisite deployment to finish), Success, Failure, Internal Error, Deleting, Deleted, Cancelled, Timeout, and Expire.

### Solutions

The **Solutions** page is a catalog of ready-made **solutions** — bundles of modules that deploy together as one unit into a single project. Solutions are grouped into categories, and each card shows a combined credit cost and an average rating derived from the modules it contains.

A solution's modules are grouped into **waves**, a rough deploy order — but what actually gates a member's start is its real configuration dependency on another member: it waits only for that specific producer to finish, not for its whole nominal wave, so members frequently provision concurrently both within and across waves. Provisioning a solution walks you through a single configuration form covering its members. The resulting **solution deployment** gets its own details page, where — as with a module deployment — you can update, delete, or purge it.

### Credits

Usage is metered in credits, held in three separate balances:

- **Awards** — free credits (signup, monthly, referral), reset each month.
- **Subscription** — credits from a subscription plan. Where the platform is set to reset them, a renewal replaces the allowance rather than adding to it.
- **Top-up** — credits bought outright as a one-off. These never expire.

Spending draws on awards first, then subscription, then top-up, so the credits that expire soonest go first. Your **balance** is all three together and is checked before each deployment.

Deploying a module costs that module's credit cost plus a build cost, metered from how long the build actually runs and charged once it finishes — so the final figure can differ a little from the estimate in the confirmation dialog. If the build cost exceeds your balance, the remainder carries over and is settled from your next purchase. A partner deploying their own module isn't charged the module cost, but does pay the build cost. An update charges the build cost only.

The **Credits** page has:

- A **Credit Transactions** tab — your full history of awards, purchases, and spend, filterable by deployment and date, with **Export CSV**.
- A **Subscriptions** tab and a **Buy Credits** tab (when enabled).
- An **ROI** tab — the calculator described below.

To buy credits, choose a currency and amount, pick a payment provider, and complete checkout on the provider's secure page. Your credits are added automatically once the payment confirms.

Some platforms require *purchased* credits (not just awarded ones) for certain deployments — the confirmation dialog will tell you when that applies.

### Billing and subscriptions

Payments are handled through **Stripe** and **Flutterwave**. You choose the provider at checkout; which ones are available depends on your currency and what the platform has enabled. Pricing is shown in your selected currency.

Subscriptions are optional recurring plans ("tiers") that grant a set number of credits each billing cycle. You can subscribe, and cancel or reinstate at any time, but you can hold only one subscription at a time — to move to a different tier, or a different payment provider, cancel the current one first. Subscriptions only grant credits — they do not grant the Partner role, which an administrator assigns manually.

### ROI

The **ROI** tab on the **Credits** page is an interactive estimator. It comes pre-filled with your recent activity and lets you adjust assumptions (such as monthly deployments, manual deployment time, engineer hourly cost, and time-savings percentage) to estimate your labour cost, platform cost, net savings, and ROI. It's an estimator only — it doesn't deploy or charge anything.

### Costs and invoices

You can see your own spending on the **Credits** page, two ways. **Credit Transactions** lists every award, purchase and charge on your account. **Project Transactions** — shown whenever project credits are enabled — breaks the project side of that down per Google Cloud project, with the credits debited and the underlying cloud cost for each, over a date range you choose. It exists because a project charge reaches the ledger as one combined row covering all your projects at once.

Platform-wide reporting stays an administrator and finance view: the **Module Costs** and **Project Invoices** tabs on the Credits page, and the whole **Billing** page, are limited to those two roles. If you need a formal invoice, ask through the Support form.

---

## Getting help

The **Help** page's **Support** tab is a contact form that raises a support ticket and emails the support team. Depending on your role you may see more tabs there: **Setup Requests** (admin and finance) and **Support Tickets** (admin, support, and finance). Where referrals are enabled, the Support tab also carries your **Invite Friends** card with your referral link and code.

You can also reach Help from the **Contact us** link in the footer.

---

## Role guides

For the full set of tasks in each role:

- [Admin](admin-guide.md)
- [Partner](partner-guide.md)
- [User](user-guide.md)
- [Agent](agent-guide.md)
- [Finance](finance-guide.md)
- [Support](support-guide.md)
- [Trainer](trainer-guide.md)
