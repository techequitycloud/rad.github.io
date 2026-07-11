---
title: "Administrator Guide"
description: "RAD Platform administrator guide — managing users, roles, organizations, module catalogs, deployments, and platform settings."
---

# Administrator Guide

For administrators who run the RAD platform: managing users, roles, credits, modules, requests, and oversight. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

As an admin you have superuser access. In addition to everything a standard user can do (browse the **Deploy** catalog, configure and deploy modules, manage your own **Deployments**, use **Credits**, and the **ROI** calculator on **Help**), you can:

- View, search, create, edit, activate/deactivate, and delete **Users**.
- Edit any user's credits and role flags (User, Partner, Agent, Finance, Support, Admin).
- Award credits in bulk and message users.
- Configure platform-wide behavior on the **Setup** page, including turning **Credits** on or off.
- Publish and manage **platform modules**, and delete any module (platform or partner).
- Handle **Setup Requests** and **Support Tickets**.
- See all revenue, costs, invoices, and payouts across the platform.

After you sign in you land on **Deployments**. Your top navigation shows: Setup, Users, Setup Requests, Support Tickets, Explore, Publish, and Help. (Explore and Publish appear when the platform's repository/AI integration is configured.)

## Managing users

Go to the **Users** page to manage everyone on the platform.

**View and search.** You see a searchable, paginated list of all registered users. Search to find a user by email, then open their row to review their roles, credit balance, and active status.

**Create a user.** Use the create-user action to add an account directly. This is how you add people when the platform is in private mode and self-registration is closed.

**Edit credits and roles.** Open a user's row and edit:

- **Credits** — adjust their balance.
- **Active** status — see Activate/deactivate below.
- **Notification settings**.
- **Role flags** — User, Partner, Agent, Finance, Support, and Admin (see [Assigning roles](#assigning-roles)).

Save your changes to apply them.

**Activate or deactivate.** Toggle a user's active status to grant or revoke access. Safeguards apply: you cannot deactivate an account that holds the Admin role.

**Delete a user.** Deleting a user removes their modules and deployments and archives the account.

**Safeguards to know.**

- You cannot deactivate an admin.
- You cannot remove the last admin on the platform.
- There is no way to sign in as, or impersonate, another user. Admin oversight is done through the Users, Deployments, and reporting pages, not by acting as someone else.

## Assigning roles

RAD has six roles: **User, Admin, Partner, Agent, Finance, Support**. A person can hold several at once (for example Agent + Partner). A Partner is always also a User. Roles are granted by an administrator, and can also be granted through Google Group membership that admins manage.

Set a user's roles by editing their row on the **Users** page and toggling the role flags. What each role unlocks:

- **User** — the default. Deploy modules and manage their own deployments and credits.
- **Admin** — full platform administration (this guide).
- **Partner** — publish modules from their own repository and earn partner revenue. Granting Partner is manual; subscribing to a credit plan does not grant it.
- **Agent** — earn referral commission from users they referred; uses the **Revenue** page.
- **Finance** — financial reporting and payouts; uses the **Billing** page.
- **Support** — help-desk triage of **Support Tickets** and read-only module discovery.

## Bulk credit awards and messaging users

From the **Users** page you can act on many users at once:

- **Award credits in bulk** — grant credits to all users or to a selected set.
- **Message users** — send a message to all users or to selected users.

These are the fastest way to run promotions, top up balances after an outage, or send a platform-wide announcement.

## Platform settings (Setup)

The **Setup** page is where you configure platform-wide behavior. Adjust settings here whenever you need to change how the platform runs, then save.

Key controls available to you include turning **Credits** on or off for the whole platform. When credits are off, the Credits page and credit costs are hidden for users; when on, deployments are metered in credits as described in [Using RAD](using-rad.md).

## Managing modules

You are responsible for the catalog of **platform modules** that every user sees on the **Deploy** page.

**Publish platform modules.** Go to the **Publish** page to publish and update platform modules so they appear in the catalog. Use **Explore** for AI-assisted module discovery when the platform's AI integration is configured. (Publish and Explore appear in your navigation only when the platform's repository/AI integration is set up.)

**Update a module.** Re-publish a module from the Publish page to refresh its definition (description, configuration fields, and credit cost) in the catalog.

**Delete any module.** As an admin you can delete any module in the catalog — platform modules and partner-published modules alike.

## Setup Requests

The **Setup Requests** page is where managed-setup requests are handled. Review incoming requests, track their status, and follow them through to completion. Finance also has access to this page; as an admin you have full visibility into all requests.

## Support Tickets

The **Support Tickets** page lists tickets raised through the **Help** form. Triage each ticket: update its status (new, in progress, resolved, closed), add notes, and assign it. Support-role users also work this queue; as an admin you see all tickets.

## Visibility into revenue, costs, invoices, and payouts

You have platform-wide financial visibility:

- **Revenue** — all revenue across the platform, including partner revenue shares and agent (referral) commissions.
- **Costs and invoices** — module costs per deployment and **Project Invoices** (actual cloud cost per project per month).
- **Payouts** — per-payee payout totals.

These reports live in the financial area of the platform alongside the Finance role's tools. Use them to monitor platform health, reconcile partner and agent earnings, and review project spending.

## Getting help

Use the **Help** page for the **Support** form (which raises a support ticket) and the **ROI** calculator. The **Contact us** link in the footer also goes to Help. For sign-in, navigation, and core concepts like deploying modules and credits, see [Using RAD](using-rad.md).
