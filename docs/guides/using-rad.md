---
title: "Using RAD"
description: "How to use the RAD Platform: signing in, navigation, roles, deploying modules to your own Google Cloud project, credits, and billing."
---

# Using RAD

This is the shared overview for everyone who uses RAD. It covers signing in, finding your way around, the roles, and the core concepts (modules, deployments, credits, billing, and getting help). Each role guide links back here for the basics, then focuses on what that role does.

---

## What is RAD

RAD (Rapid Application Deployment) is a web portal for deploying ready-made Google Cloud modules without writing any infrastructure code. You pick a module, fill in a guided configuration form, and the platform provisions it on Google Cloud for you.

Usage is metered in **credits**: most modules cost a set number of credits to deploy, and your balance is checked before a deployment runs.

---

## Signing in

1. Open the RAD sign-in page and click **Sign in with Google**.
2. Choose your Google account.

The first time you sign in, your account is created automatically. New accounts start with the **User** role and are active right away. (If the platform is running in private mode, sign-ins from outside the allowed organization are refused — ask an administrator if you can't get in.)

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
| **Support** | Triages support tickets and views deployments | Deployments |

See the role guides at the end for the full task lists.

---

## Core concepts

### Modules and the Deploy catalog

The **Deploy** page is the module catalog. Each module appears as a **card** showing its description, a documentation link, an average star rating, how many times it has been deployed, and a **credit cost** badge.

There are two kinds of modules:

- **Platform modules** — published by RAD.
- **Partner modules** — published by partners.

If you're a partner you'll see two tabs (your own **Partner modules** and **Platform modules**, which also includes other partners' public modules). Everyone else sees a single combined catalog of public modules.

You can **pin** the modules you use most so they stay at the top, **search** by name, and page through the catalog. A stats strip at the top shows total deployments, your credit balance (when credits are enabled), and how long deployment history is kept.

### Deploying a module

1. Click a module card to open its guided, multi-step **configuration form**. Fill in the fields, using **Next** to move through the steps. Required fields can't be left blank, and the form checks your entries before you continue.
2. A confirmation dialog appears if the module costs credits, has dependencies, or needs special permissions.
3. Click **Deploy**. The deployment is queued and provisioned, and you're taken to the **Deployments** page. If you don't have enough credits, RAD shows the module's cost against your balance and prompts you to top up.

On the **Deployments** page each row shows the module, deployment ID, project, status, the action, who deployed it, when, how long it took, the credits used, and an editable **star rating**. (Admins and support can switch between **All deployments** and **My deployments**; everyone else sees their own.)

Click a deployment to open its details, which has three tabs:

- **Outputs** — the non-sensitive results (such as URLs and endpoints), shown once the deployment succeeds.
- **Build Status** — live logs as the deployment runs.
- **Builds** — the build history for that deployment.

From the details view you can:

- **Update** — re-open the configuration form (pre-filled) and re-apply changes. Available once a deployment has finished.
- **Delete** — choose **Delete** to tear down the cloud resources, or **Purge** to remove the deployment from RAD *without* destroying the cloud resources (useful when a deployment is stuck or was changed outside RAD).

Deployment statuses you may see include Queued, Working, Success, Failure, Deleting, Deleted, Cancelled, Timeout, and Expired.

### Credits

Usage is metered in credits. Your **balance** is your awarded credits plus your purchased credits, and it's checked before each deployment. Deploying a module costs that module's credit cost. (A partner deploying their own module isn't charged.)

The **Credits** page has:

- A **Credit Transactions** tab — your full history of awards, purchases, and spend, filterable by deployment and date, with **Export CSV**.
- A **Buy Credits** tab (when enabled).

To buy credits, choose a currency and amount, pick a payment provider, and complete checkout on the provider's secure page. Your credits are added automatically once the payment confirms.

Some platforms require *purchased* credits (not just awarded ones) for certain deployments — the confirmation dialog will tell you when that applies.

### Billing and subscriptions

Payments are handled through **Stripe** and **Flutterwave**. You choose the provider at checkout; which ones are available depends on your currency and what the platform has enabled. Pricing is shown in your selected currency.

Subscriptions are optional recurring plans ("tiers") that grant a set number of credits each billing cycle. You can subscribe, and cancel or reinstate at any time. Subscriptions only grant credits — they do not grant the Partner role, which an administrator assigns manually.

### ROI

The **ROI** tab on the **Help** page is an interactive estimator. It comes pre-filled with your recent activity and lets you adjust assumptions (such as monthly deployments, manual deployment time, engineer hourly cost, and time-savings percentage) to estimate your labour cost, platform cost, net savings, and ROI. It's an estimator only — it doesn't deploy or charge anything.

### Costs and invoices

What you can see depends on your role. Regular users and partners can see costs and invoices only for projects they own or deployed. Admins and finance users can see costs and invoices across all users and projects, including org-wide cloud-cost invoices. These detailed views live on the **Credits** and **Billing** pages.

---

## Getting help

The **Help** page has two tabs:

- **Support** — a contact form that raises a support ticket and emails the support team.
- **ROI** — the ROI Calculator described above.

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
