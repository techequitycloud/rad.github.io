---
title: "Administrator Guide"
description: "RAD Platform administrator guide — managing users and roles, platform settings, the module catalogue, setup requests and support tickets, and oversight of revenue, costs and audit."
---

# Administrator Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Admin_Guide.png" alt="Administrator Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

For administrators who run the RAD platform: managing users, roles, credits, modules, requests, and oversight. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

As an admin you have superuser access. In addition to everything a standard user can do (build a solution from a description, browse the module catalog on **Solutions → Solution Modules**, configure and deploy, manage your own **Deployments**, use **Credits**, and the **Calculate ROI** tab on the **Credits** page), you can:

- View, search, create, edit, activate/deactivate, and delete **Users**.
- Edit any user's role flags (User, Partner, Agent, Finance, Support, Trainer, Admin), and any other user's credit balances.
- Award credits in bulk and message users.
- Configure platform-wide behavior on the **Setup** page, including turning **Credits** on or off.
- Sync **platform modules** into the catalog from their GitHub repository.
- Handle **Setup Requests** and **Support Tickets** (tabs on the **Help** page).
- See all revenue, costs, invoices, and payouts across the platform.
- Review the **Audit Log**: every recorded action on the platform, who did it and when.

After you sign in you land on the **Users** page. Your top navigation shows: Setup, Users, Audit Log, Sync, Deployments, Solutions, and Help, plus **Credits** if your account also holds the User, Partner or Agent role (and credits are switched on). The module catalog is the **Solution Modules** tab on Solutions; it no longer has its own menu entry. Setup Requests and Support Tickets are tabs inside the **Help** page rather than top-level navigation items.

## Managing users

Go to the **Users** page to manage everyone on the platform.

**View and search.** You see a searchable, paginated list of all registered users. Search to find a user by email, then read their row: role badges beside the address, and a column for their active status and for each role (Admin, User, Partner, Agent, Finance, Support, Trainer). Credit balances are not shown here.

**Create a user.** Switch on **Private Mode** in **Setup** and two buttons appear above the user list. **Add New User** creates an account directly so that person can sign in. **Restore User** re-admits someone you previously deleted, clearing the record that was blocking their email — they get no fresh sign-up credits. Neither button appears, and neither action is accepted, while the platform is in public mode, because people can register for themselves.

**Edit roles.** Select **Edit** on a user's row, then set:

- **Active** status — see Activate/deactivate below.
- **Role flags** — Admin, User, Partner, Agent, Support and Trainer are always shown. **Finance** appears only once **Enable Subscription** is switched on in **Setup**. The **Agent** box can be ticked only while users can pay (see [Assigning roles](#assigning-roles)).

Select **Save** to apply your changes.

**Editing credits is elsewhere.** Per-user balances live on the **Credit Management** tab of the **Billing** page, which edits Awards, Subscription, Top-up and the Monthly Partner allotment separately. Nobody — admins included — can change their own balance; ask another admin or finance user, so the record carries two identities. For the same reason, admin and finance accounts cannot claim **event codes**, and nobody can claim a code they created.

**Activate or deactivate.** Toggle a user's active status to grant or revoke access. Deactivating clears every non-admin role the account held (User, Partner, Agent, Finance, Support, Trainer) and its monthly partner allotment; reactivating turns only **User** back on, so re-grant any other role by hand. Safeguards apply: you cannot deactivate an account that holds the Admin role.

**Delete a user.** Deleting a user permanently deletes their modules and deployments, then deletes the account. A user with any live (not yet destroyed) deployment can't be deleted — destroy those first. A minimal record is kept only to stop the same email re-registering, and credit-transaction history is preserved for audits.

**Safeguards to know.**

- You cannot deactivate an admin.
- You cannot remove the last admin on the platform, and you cannot delete the last admin's account either.
- A founding (bootstrap) admin cannot have their admin role revoked and cannot be deleted. Remove their email from the bootstrap admin allow-list first, then retry.
- Nobody can change their own credit balance, admins included.
- There is no way to sign in as, or impersonate, another user. Admin oversight is done through the Users, Deployments, and reporting pages, not by acting as someone else.

## Assigning roles

RAD has seven roles: **User, Admin, Partner, Agent, Finance, Support, Trainer**. A person can hold several at once (for example Agent + Partner), and their menu combines every role they hold. A Partner or a Trainer is always also a User. Roles are granted by an administrator via the **Users** page and stored on the user's account record (the founding admin is pinned via a bootstrap allow-list).

Set a user's roles by editing their row on the **Users** page and toggling the role flags. What each role unlocks:

- **User** — the default. Deploy modules and manage their own deployments and credits.
- **Admin** — full platform administration (this guide).
- **Partner** — publish modules from their own repository and earn partner revenue. Granting Partner is manual; subscribing to a credit plan does not grant it.
- **Agent** — a sales role: earns a cash commission on the module fees their referred users pay with purchased credits, tracked on **Credits → My Commission** (see the [Agent Guide](agent-guide.md)). It can be granted only while users can **buy credits or subscribe**, meaning credits are on and Stripe or Flutterwave is on. With payments off the box stays locked and a note says why. An existing agent can always be un-ticked, and keeps the role if payments are switched off later. **Deactivating** an agent's account stops their commission: nothing new is recorded, and what is already recorded is held back from payouts until the account is reactivated.
- **Finance** — financial reporting and payouts; uses the **Billing** page.
- **Support** — help-desk triage of **Support Tickets** (a Help-page tab). A support agent sees deployments only for the customers whose open tickets are assigned to them, and never a deployment's variables or outputs. Resolving or closing the ticket ends that access.
- **Trainer** — runs **lab sessions** from the **Lab Sessions** tab on **Solutions**: enrols a cohort of participants, funds them or has them buy their own place, and builds one lab environment per participant. The role is the whole grant — there is no roster to fill in — so unticking it removes the access. Deactivating an account also clears it, and reactivating does not restore it. A trainer is always treated as a user as well, so they keep the user's pages, including **Credits**, which funds their sessions. Unlike Support, a trainer may update and destroy the lab environments they provisioned, so a course does not leave infrastructure behind. A trainer can see a lab environment's outputs (with sensitive values removed) but never its configuration variables or generated credentials, never sees a participant's own personal deployments, and can't deploy on anyone's behalf from the ordinary deploy form.

See the [Trainer Guide](trainer-guide.md) for the trainer's own view of this.

### Onboarding a partner

Making someone a partner takes three steps, and the last one is yours:

1. Tick **Partner** on their row on the **Users** page.
2. The partner connects their GitHub repository from their **Profile** (installing the RAD Module Sync GitHub App, then choosing the repository). That lets RAD **read** their modules, so they can sync them and see them listed — see the [Partner Guide](partner-guide.md).
3. **Enable deployments of their modules.** Building a deployment clones the partner's repository with a per-partner credential that only an administrator can create. In the RAD platform project's **Secret Manager**, create a secret named `partner-github-token-<partner's user ID>` — the ID is the partner's Firebase Authentication user ID, the same value stored as `partnerId` on their modules — with automatic replication, holding a GitHub token that can read that repository. Until it exists, any deployment of the partner's modules (by the partner or by a customer) is refused with *"Deployment repository credentials are not configured"*, so do this before the partner makes a module public.

Revoking the Partner role, or deactivating the account, stops their monthly partner allotment. Delete the secret as well if the partner should no longer be deployable.

**How lab sessions work.** Switch on **Enable Lab Sessions** in **Setup** first; while it is off, the **Lab Sessions** tab on Solutions and Finance's **Labs** menu entry are hidden, and every lab route answers *not found*. The same Setup variables set the ceilings a trainer works within: maximum participants, duration and credits per participant, plus provisioning concurrency.

A trainer creates a session on the **Lab Sessions** tab and chooses who pays:
- **Participants buy their own place.** This is the default for a new session. Each participant pays from their own purchased credits before anything is built for them. When one can't pay on RAD (a bank the payment provider won't accept, or cash), the trainer can pay for that one place from their own purchased credits with **Pay for place**; the row then shows **Paid by trainer**. Only the session's own trainer is offered this, because it spends their credits.
- **The trainer pays.** The whole allowance is reserved from the trainer's purchased credits up front.

Each participant gets **one environment** on the **lab** tier, which has its own folder, org policies and budget. The lab tier is never offered as a manual choice on any deploy form. Unused credits settle back to the trainer once Google has reported the session's costs.

You can see and manage every trainer's sessions, and you alone can force a teardown. Finance can see every session and end one, but can't change it. Only you can deploy on someone else's behalf from the ordinary deploy form, and only into a RAD-managed project: each participant's deployment goes into their own project and is paid for by that participant.

## Bulk credit awards and messaging users

Two bulk actions are available to you, and neither is on the Users page:

- **Award credits in bulk** — the **Credit Settings** tab on the **Billing** page. The adjustment applies to *every* user at once; you cannot pick a subset. Enter a positive amount to grant or a negative one to deduct, and choose whether it lands as free award credits or as purchased credits. Amounts of 10,000 or more need a reason and a typed confirmation, and credits must be enabled platform-wide. To change one person's balance instead, use **Credit Management** on the same page.
- **Message users** — the **Send Message** tab on the **Help** page, which shows you a message form rather than the support form other users see. Send to all users, or search for and select up to 100 recipients; messages are capped at 5,000 characters.

These are the fastest way to run promotions, top up balances after an outage, or send a platform-wide announcement.

## Platform settings (Setup)

The **Setup** page is where you configure platform-wide behavior. Adjust settings here whenever you need to change how the platform runs, then save.

Key controls available to you include turning **Credits** on or off for the whole platform. When credits are off, the Credits page and credit costs are hidden for users; when on, deployments are metered in credits as described in [Using RAD](using-rad.md).

**Enable Subscription** is, despite its name, the switch for every purchase. Switched off, nobody can start a new subscription **or** a one-off top-up: both payment providers are switched off, the checkout routes refuse, the *Buy credits* and *Subscribe* links disappear across the app, and the public **Pricing** and sign-in pages stop listing plans. Payments already made are still credited, and existing subscribers are not cut off: their plan keeps renewing until they cancel it, which they can still do from the **Credits** page.

**Enforce Update Safe** controls what happens when someone edits a setting that cannot be changed on a running deployment — a region, an encryption key, a toggle that creates or destroys a resource. Modules declare which of their settings are safe to change in place; everything else is treated as destructive.

- **Off (the default)** — the field stays editable and changing it raises a confirmation naming exactly which settings will rebuild resources. The user decides.
- **On** — those fields are read-only while updating an existing deployment, so changing one means deleting and redeploying. Admins and partners are exempt.

Turn it on where an accidental rebuild is expensive — shared environments, customer-facing deployments, training cohorts. Leave it off where users are expected to reshape their own deployments.

## Managing modules

You are responsible for the catalog of **platform modules** that every user sees on the **Solutions → Solution Modules** tab.

**Sync platform modules.** Go to the **Sync** page to bring platform modules into the catalog. The page is a read-only sync console: it lists the modules found in the platform repository, and the **Sync Now** action refreshes the catalog from that repository. Modules themselves are managed in the repository, not edited on this page.

**Update a module.** Change the module in the repository, then run **Sync Now** from the Sync page to refresh its definition (description, configuration fields, and credit cost) in the catalog.

**Removing a module.** Module management is read-only by default: the **Module Console Read-Only** setting on the **Setup** page ships switched on, which hides the delete action on module cards and on a module's own page, and makes the platform reject a console delete. To remove a module, delete it from its GitHub repository and let the next sync drop it from the catalog. Only if you turn that setting off does a delete action appear — and then you can delete any module, platform or partner-published.

## Setup Requests

The **Setup Requests** tab on the **Help** page is where managed-setup requests are handled. Review incoming requests, assign an engineer (who must be an existing partner account), track their status, and follow them through to completion. When a request is completed, its revenue is split 75% to the engineer and 25% to the platform, unless the platform setting `platformRevenueSharePct` (audited as *Platform revenue share (setup requests)*; it has no form control yet) holds another value between 0 and 100. Finance also has access to this tab; as an admin you have full visibility into all requests. Support-role users do not see Setup Requests — the requests carry revenue and partner-payout figures.

## Support Tickets

The **Support Tickets** tab on the **Help** page lists tickets raised through the **Help** form. Triage each ticket: update its status (new, in progress, resolved, closed), add notes, and assign it. Support-role users also work this queue; as an admin you see all tickets. The customer follows their ticket on their own **My tickets** tab, which shows the status you set but never your notes or who the ticket is assigned to.

## Visibility into revenue, costs, invoices, and payouts

You have platform-wide financial visibility:

- **Revenue** — **Module Revenue** (module fees and partner revenue shares) and **Agent Revenue** (the agent commission statement, where a commission can be reversed with a reason, and agent payout batches that are created with a cut-off date and marked paid with a payment reference; agents are paid outside RAD).
- **Costs and invoices** — **Project Transactions** and **Project Invoices** (actual cloud cost per project per month); both need **Enable Project Credits**. Module costs per deployment are the **Module Costs** tab on the **Credits** page.
- **Payouts** — **Payout Summary**, per-payee totals for agents and partners. **Mark paid** there records a partner's payout for an ended period, once, at the rate in force; agents are paid through Agent Revenue instead.

Apart from Module Costs, these reports are tabs of the **Billing** page. Two things to know before you go looking for them: your admin navigation has no Billing entry, so either grant yourself the Finance role as well (which adds it) or go to `/billing` directly; and every Billing tab except **Event Codes** requires **Enable Subscription** in **Setup**, so with that switched off the page opens on Event Codes and shows nothing else. Use them to monitor platform health, reconcile partner and agent earnings, and review project spending.

## Audit log

Open **Audit Log** from the navigation bar to review what has been done on the platform. It lists every recorded action, newest first: role and account changes, settings changes, credit grants and adjustments, forced deletions, credential reveals, payouts, and lab session activity. Each row shows when it happened, the action, and who performed it (**System** for scheduled jobs).

- The page opens on the last 7 days. Change the dates, pick an **Action**, or type part of an email in **Performed by**, then select **Load**. The range can be up to a year.
- Select **Show all** on a row to see everything recorded with it. Secret values are never recorded; a changed secret shows as redacted.
- If a range holds more actions than one load can read, only the most recent are shown and a notice asks you to narrow the dates.

Finance also has an **Audit Log**, limited to the money-related actions. The log is read-only: nobody, admins included, can edit or delete an entry.

## Getting help

On the **Help** page your **Send Message** tab shows the message form described above, not the support request form other users see, so you have no My tickets tab; the Setup Requests and Support Tickets tabs sit next to it. **Calculate ROI** is a tab on the **Credits** page. The **Contact us** link in the footer also goes to Help. For sign-in, navigation, and core concepts like deploying modules and credits, see [Using RAD](using-rad.md).
