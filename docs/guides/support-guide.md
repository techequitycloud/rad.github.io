---
title: "Support Guide"
description: "RAD Platform support guide — handling the support ticket queue, and viewing the deployments of the customers whose open tickets are assigned to you."
---

# Support Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Support_Guide.png" alt="Support Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

For help-desk staff who triage support requests and assist users on RAD. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

- Handle support tickets on the **Support Tickets** tab of the **Help** page — view tickets raised through the Help form, update their status, add notes, and claim them.
- View the deployments of the customers whose open tickets are assigned to you, on the **Deployments** page.
- Restore a deployment's configuration that the retention policy has marked for removal, when its owner asks you to.
- Raise a ticket of your own on the **Help** page's **Send Message** tab.

After you sign in you land on the **Help** page. Your top navigation shows: **Deployments** and **Help**. (**Support Tickets** is a tab inside the Help page, next to **Send Message** and **My tickets**.) The **Setup Requests** tab is not part of the Support role — it carries partner revenue figures, so it is limited to administrators and Finance.

## Handling support tickets

The **Support Tickets** tab on the **Help** page is your main workspace.

1. Click **Help** in the top navigation bar, then open the **Support Tickets** tab.
2. The list opens on the last 7 days and loads straight away. To look further back, change the **From** and **To** dates and click **Load Tickets**; both dates are required, and the range cannot exceed 366 days. You get the 100 most recent tickets in that range, so narrow the dates if you think you are missing older ones. You can also filter by status and by assignee (**All assignees**, **Assigned to me**, **Unassigned**), and download what you are looking at with **Export CSV**. Each ticket captures what a user submitted through the Help form.
3. Open a ticket to see its details.
4. Update the ticket **status** as you work it:
   - **New** — just received, not yet picked up.
   - **In progress** — you are actively working on it.
   - **Resolved** — the issue has been addressed.
   - **Closed** — the ticket is complete and needs no further action.
5. **Add notes** to record what you found, what you advised, or any steps you took. Notes keep the ticket history clear for you and your teammates.
6. **Claim** an unassigned ticket to take ownership of it, or **Release** one you hold if you picked it up by mistake. Claiming is also what gives you sight of that customer's deployments. You can claim only a ticket that is still open, and reopen only a ticket you hold. You cannot take a ticket off another agent or hand one to a colleague — ask an administrator or the finance team to reassign it. To be emailed when a ticket is assigned to you, switch on **Support ticket assigned to me** under your **Profile**'s notification settings.

## Where tickets come from

Tickets are created from the **Help** page.

- On the **Help** page, the **Send Message** tab is a contact form. When a user fills it in and submits, RAD raises a support ticket and emails the support team.
- The **Contact us** link in the footer also goes to the Help page.

When a user asks how to reach you, point them to **Help → Send Message** (or the **Contact us** footer link). Anything they submit there shows up for you on the **Support Tickets** tab. Raising a ticket needs purchased credits (a subscription or a top-up) only while credits are on sale — a user without any is shown a prompt to buy credits instead. While purchases are switched off, anyone may raise a ticket. Each user can raise up to 5 tickets in 24 hours.

Users can follow up on their own tickets: the **My tickets** tab on the Help page shows each ticket they raised, newest first, with its status (**New**, **In progress**, **Resolved** or **Closed**). So the status you set is what the customer sees. Your **notes** are internal and are never shown to the customer, and neither is who the ticket is assigned to.

## Viewing deployments

The **Deployments** page lets you look up deployments when helping a user. You cannot reach the module **Sync** console — module management is for admins and partners.

1. Click **Deployments** in the top navigation bar.
2. The view is **scoped to your own tickets**: it lists the deployments of the customers whose tickets are assigned to you and still **New** or **In progress**. Claiming a ticket is what gives you sight of that customer's deployments; resolving or closing it takes that access away again, and reopening the ticket restores it. If you need a deployment that belongs to someone else's ticket, ask the agent holding it or an administrator. Your scope covers at most 29 customers at a time; if you hold open tickets for more, resolve or release some to see the rest.
3. Each row shows the module, deployment ID, the star rating, who deployed it, when it was created, how long it took, the status, and the action. There is no project or credits column — open the deployment for its project, and its **Builds** tab for what each build consumed.
4. Open a deployment to see its overview (with secret values removed), **Build Status** (live logs, with secrets masked), **Builds** (build history) and, for a lab deployment, its lab panel. The **Outputs** tab is not available to you: outputs can carry connection strings and generated credentials, so only the deployment's owner and administrators can read them — as with the deployment's configuration variables and any credentials the module generated. Ask the user for any value you need from there.

Use the deployment ID a user gives you to find their specific deployment and review its status and logs. Opening another user's deployment status, build logs, or credit history is recorded in the platform audit trail against your account. That's expected while you're working their ticket — it's why the reads are worth keeping to the tickets you hold.

## Restoring a configuration marked for removal

When a deployment has been inactive for longer than the retention period, RAD marks its **configuration** (its saved settings and Terraform state) for removal and emails the owner. The email tells them to contact support if they want to keep it. Their cloud resources are not affected either way.

To restore it:

1. Claim the customer's ticket, so their deployments come into your view.
2. Open the deployment the ticket names. A banner says **This deployment's configuration is scheduled for removal**.
3. Select **Restore**, before the date in the customer's email.

The configuration goes back to how it was, and stays in RAD for another full retention period. If the deployment's resources had already been deleted before it was marked, it stays a deleted deployment: restoring keeps its settings, it does not recreate anything. Each restore is recorded in the audit log against your account. Once the date has passed, the configuration is gone and cannot be restored.

## What support can't do

To set expectations clearly, the Support role does **not** include:

- Viewing or editing user accounts.
- Changing anyone's credits or roles.
- Connecting a GitHub repository or syncing modules.
- Updating, deleting, purging, cancelling or re-deploying anyone else's deployment, or reading its configuration variables, outputs or generated credentials — those stay with the deployment's owner and administrators. Restoring is limited to configurations the retention policy marked for removal (see above); a **purged** deployment can be restored only by an administrator.
- Seeing deployments platform-wide — only those of the customers whose open tickets are assigned to you.
- **Setup Requests** — administrators and Finance handle those.
- Acting on another user's behalf — there is no impersonation anywhere in RAD.

If a request needs any of these, route it to an administrator (or to Finance for credit adjustments).

## Getting help

- For platform basics — signing in, navigation, credits, and how deployments work — see [Using RAD](using-rad.md).
- For your own questions, use the **Help** page: the **Send Message** tab raises a ticket, which lands on the same Support Tickets queue you work. Your own tickets are on the **My tickets** tab beside it.
