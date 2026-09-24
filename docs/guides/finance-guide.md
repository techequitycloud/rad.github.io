---
title: "Finance Guide"
description: "RAD Platform finance guide — managing credits, billing, invoicing, and Google Cloud cost tracking for training deployments and cohorts."
---

# Finance Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Finance_Guide.png" alt="Finance Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

This guide is for people with the **Finance** role, who manage RAD's billing setup, run revenue and payout reports, and reconcile cloud costs. New to RAD? Start with [Using RAD](using-rad.md).

When you sign in as Finance, you land on the **Billing** page. Your navigation bar shows **Billing**, **Labs** (when lab sessions are switched on), **Audit Log** and **Help**. (**Setup Requests** is a tab inside the Help page.)

## What you can do

- Create and edit subscription plans and their per-provider prices (**Subscription Tiers**).
- Configure the credit economy — credits-per-unit and revenue shares (**Credit Settings**).
- Adjust any user's credit balance (**Credit Management**).
- Create event codes that give attendees of a partner event free credits (**Event Codes**).
- Report on **Partner Revenue**, and review and pay agent commission (**Agent Revenue**).
- See per-payee payout totals (**Payout Summary**).
- Review org-wide GCP cloud costs (**Project Invoices**).
- View all users and the full lists of agents and partners; make limited user edits.
- Manage managed-setup requests (the **Setup Requests** tab on the Help page).
- Review the money-related entries of the **Audit Log**.

## The Billing page

Open **Billing** from the navigation bar. The page is organized into these tabs — **Subscription Tiers**, **Credit Settings**, **Credit Management**, **Event Codes**, **Module Revenue**, **Agent Revenue**, **Project Transactions**, **Project Invoices**, and **Payout Summary** — described below. **Event Codes** is always shown; the others need subscriptions enabled, and the two project tabs also need project credits enabled.

### Subscription Tiers

Manage the recurring credit plans (tiers) that users can subscribe to. Each plan grants a set number of credits per billing cycle.

1. Go to **Billing** > **Subscription Tiers**.
2. Click to **create** a new tier, or select an existing one to **edit**.
3. Set the plan's name, its price, and the credits it grants. The form shows what that price would buy at the current credits-per-unit rate, so you can see whether the tier is better value than a straight top-up. Then, on each provider tab, paste the identifier of the matching price you have **already created in that provider's own dashboard** — **Price ID** for Stripe, **Plan ID** for Flutterwave. The price and credits are shared by both providers; only the identifier differs.
4. Save the tier. Update or remove tiers as your offerings change.

Above the tier table is a **Payment Providers** panel. Use it to switch **Stripe** and **Flutterwave** on or off — a provider's tab in the tier table stays disabled while that provider is off, and neither can be enabled until Credits and Subscriptions are both on. The same panel holds **Reset Subscription Credits**: leave it off and unused subscription credits carry over to the next billing cycle; switch it on and the allowance is replaced at each renewal instead of added to. Top-up credits are never affected either way.

Subscriptions only grant credits — they do not grant the Partner role.

### Credit Settings

Configure the global parameters of the credit economy.

1. Go to **Billing** > **Credit Settings**.
2. Set the **credits-per-unit** value (how credits map to currency).
3. Set the **revenue shares** — the percentage of revenue allocated to referring **agents** (Agent Revenue Share) and to module **partners** (Partner Revenue Share).
4. Set the rest of the economy from the same tab. Each setting is its own small form with its own Save button, so you can change one without touching the others: the free-credit grants (Signup, Monthly, Referral and the referral limit), the low-credit trigger, credits-per-hour, the four module fees (CR and GKE, fee and setup fee), the RAD-Managed Module Discount, the deploy credit buffer, the Sandbox/Development/Production/Lab admission floors and monthly project budgets, the project credit margin, the deployment refresh interval, and the starting values for the ROI calculator. The referral limit (**Referral Rewards**) takes three kinds of value: **-1** means unlimited, **0** switches the referral program off (no referral credits, and the **Invite Friends** card disappears from Help), and a positive number is the monthly number of referrals each referrer earns credits for. Agents are exempt from that monthly cap. **Solution bundle discounts** have no control on this tab: a solution's module fees are discounted 15% for three or four members, 20% for five or six and 25% for seven or more, and changing those tiers is an administrator's settings change (`solutionBundleDiscountTiers`), not a form here.
5. Decide what a **failed deployment** is charged, on the **Failed Deployments** card. It has two independent switches, and each label states its own outcome ("Build cost charged" / "Build cost not charged", "Module fee charged" / "Module fee not charged"):
   - **Build cost** — whether the metered Cloud Build time of a new deployment that fails or is cancelled is charged.
   - **Module fee** — whether the module fee is charged for that deployment even though it never succeeded.

   **In the current release both are off: no failed deployment is charged anything.** Turning either on applies to deployments that fail from then on; it never re-bills past failures. The switches cover the failure of a deployment's *creation* only — failed updates and teardowns are not charged, and lab deployments are billed through the trainer's session instead. Whatever you choose, charges for failures are capped per user (by default at three charged failures in any 24 hours), so a module that keeps failing cannot drain a customer's balance. A **successful** deployment is always charged in full, whichever way these are set.

This tab also holds **Adjust All Credits**, which applies the amount you enter to **every** user's balance at once — positive to grant, negative to deduct. Tick **Free** to move awarded credits, or leave it clear to move purchased credits. Large adjustments will not submit until you have given a reason and typed the confirmation phrase shown. Use Credit Management below to change one person instead.

Note: the master Credits on/off toggle is **admin-only** (set on the Admin Setup page). As Finance you see and configure the billing UI, but you do not switch credits on or off platform-wide.

### Credit Management

Adjust an individual user's credit balances.

1. Go to **Billing** > **Credit Management**.
2. Search for the user by email.
3. Click **Edit** and set the balances. There are three, and they behave differently: **Awards** are free credits reset each month, **Subscription** credits come from a plan and are replaced at renewal where reset is enabled, and **Top-up** credits were bought outright and never expire. Spending draws on awards first, then event credits (claimed with an event code, below, and not editable here), then subscription, then top-up. **Monthly Partner** is not a spendable balance — it is the recurring allotment added to a partner's Awards each month.
4. Save the change.

Two things to expect. You cannot adjust your **own** balance: the save is rejected and you are told to ask another finance or admin user, which keeps two identities on every grant. And if someone else changed that user's balance while your edit form was open, your save is rejected, the form closes and the table refreshes — re-open it and make the change from the current figure.

### Event Codes

Give the attendees of a partner event (a DevFest, a workshop) free credits they claim themselves by entering a code.

1. Go to **Billing** > **Event Codes** and click **New event code**.
2. Type a code or click **Generate**, and name the **Event**.
3. Set **Credits per claim** and **Maximum claims**. The form shows the most the code can give away (credits × claims) before you create it.
4. Set **Claim until** (and optionally **Claim from**), and when the credits expire — either a number of **days after claiming** or a **fixed expiry date**.
5. Optionally restrict it to **email domains** or a list of **attendees** (one email per line), then click **Create code**.

Each account can claim a code once, and only with a verified email address. The credits land in the user's **Event credits** balance: they are free (never counted as purchased), are spent after the monthly awards, do not pay for Google Cloud usage in a RAD-managed project, and expire on their own date rather than with the monthly reset. Once a code exists its credits and validity are fixed; you can still **Disable** or **Enable** it, move its closing date, or change its cap. **Details** lists who claimed it, and **Export claims (CSV)** downloads that list.

### Module Revenue

See revenue generated by partner-published modules and the share allocated to each partner.

1. Go to **Billing** > **Module Revenue**.
2. Choose a start and an end date — both are required, and the range cannot exceed 366 days — then click **Fetch Partner Revenue**. Nothing loads until you do.
3. With no partner or agent selected you are looking at full platform revenue for that period. Select one or more partners (or agents) to narrow it to their revenue share, calculated from the percentage set in Credit Settings. You can also filter by module.
4. Each row shows the date, module name, user email, credit cost and revenue. **Export to CSV** takes the full filtered set, not just the page on screen.

### Agent Revenue

Agent commission and the payouts that settle it. An agent earns a share (the **Agent Revenue Share** in Credit Settings) of the **module fees** their referred users pay with **purchased** credits. It is worked out in US dollars and paid in cash, outside RAD. Build charges, project usage, awarded or promotional credits, the self-serve project surcharge and anything spent in a lab never earn. The [Agent guide](agent-guide.md#how-commission-works) has the full rules.

The tab has two parts.

**The commission statement.**

1. Go to **Billing** > **Agent Revenue** and pick an agent. You see their statement exactly as they do: totals (Earned, Reversed, On hold, Payable, In payout, Paid) and one row per commission.
2. Each commission is **on hold for 30 days** before it becomes payable, so a refunded or disputed fee can be dealt with first.
3. To take a commission back, for example because its fee was refunded, use **Reverse** on its row and give a reason. The reversal is recorded as a new negative entry, never an edit. If the commission hasn't been paid yet, the pair nets to zero; if it has, the amount is deducted from that agent's next payout. The reason is shown to the agent and written to the audit log.

**Agent payouts.**

1. Choose a **Cut-off date** and click **Create payout batch**. The batch takes every commission payable by the cut-off and nets any reversals.
2. Agents owed less than the **$50 minimum** carry forward to a later batch; nothing is lost.
3. **A deactivated agent is left out.** Their commission stays recorded and on hold, and is paid in a later batch only if the account is reactivated. A deactivated account also earns no new commission.
4. Pay each agent outside RAD, then enter the **Payment reference** and mark the batch paid. The agent's statement then shows those commissions as **Paid**.

Creating a batch, marking it paid and reversing a commission each write an audit-log entry.

### Payout Summary

See per-payee payout totals across partners and agents. This tab is available to **finance and admin only**.

1. Go to **Billing** > **Payout Summary**. It opens on the last 7 days and loads straight away.
2. To report on another period, choose a start and an end date — both required, maximum 366 days — then click **Calculate Payouts**.
3. Each row shows the payee's email, whether they're paid as an Agent, a Partner or both, the number of transactions, the purchased credits behind them, the **Setup Revenue** a partner earned as the engineer on completed setup requests, and the Amount Due in your billing currency. Period totals appear beneath the table, and **Export to CSV** gives you the same list to work from.

#### Recording a partner payout

RAD does not send money — you pay partners outside the platform — but once you have, record it so both you and the partner have a lasting record.

1. Select the period the payment covers. **The period must have ended**: **Mark paid** stays disabled while the period includes today, because anything earned after you recorded it could never be paid.
2. On the partner's row, optionally enter your payment reference, then click **Mark paid**.
3. RAD recalculates the partner's amount for that period and **stores it with the rates in force at that moment**. That stored figure is the permanent record: if the revenue-share rate changes later, the live figure on this page moves but the recorded payment does not, and the row shows both when they differ.

A period can be recorded once per partner; marking the same period again changes nothing, and a period that overlaps one already recorded for that partner is refused. Each recorded payout writes an audit entry, and the partner sees it in the **Payouts** section of their **Module Revenue** tab. Agent commission has its own payout flow on **Agent Revenue**.

### Project Invoices

Reconcile actual Google Cloud spending.

1. Go to **Billing** > **Project Invoices**.
2. Select a month, then click **Fetch Project Invoice** — the data doesn't load until you do.
3. Each row shows the project's name and ID, its owner, the credit debit, and the total cost in your display currency. Monthly totals appear beneath the table, and **Export to CSV** exports every project for that month.

Per-deployment **Module Costs** are not a Billing tab — they live on the **Credits** page.

## Viewing users, agents, and partners

As Finance you can see all users and the full lists of agents and partners.

- See and search every account on **Billing** > **Credit Management** — the table lists all users and has a "Search by email" box. There is no separate Users page for Finance; that one is admin-only.
- See the partners and agents on the platform through the pickers on **Partner Revenue**, **Agent Revenue**, and the Assigned Engineer field on Setup Requests.

### Limited user edits

The only change you can make to a user account is to their **credit balances** (Awards, Purchases, and Monthly Partner Credits).

All **roles** — including granting or revoking the **Partner** role — and a user's **active** status are **admin-only**. On Credit Management the "Is Partner?" checkbox is shown read-only for Finance; you can still set the **Monthly Partner** allotment for someone who already holds the Partner role.

## Setup Requests

Managed-setup requests from users who want RAD to handle a deployment for them appear here.

1. Click **Help** in the navigation bar, then open the **Setup Requests** tab.
2. Choose a status filter and a start and end date, then click **Load Requests** — nothing loads until a date range is set.
3. Expand a request to work it: set its **status** (new, in-progress, completed or cancelled), choose an **Assigned Engineer** (only registered partners are accepted), record **Revenue Achieved**, and add internal notes. Click **Save** to apply.
4. Saving a request as *completed* is what calculates the split between platform and engineer revenue, so set the revenue figure before you mark it completed. The engineer keeps **75%** and the platform **25%** by default; an administrator can set a different platform share (**Platform revenue share (setup requests)** in settings), and a share of 0 is honoured. The module **Partner Revenue Share** does not affect setup requests. Changing the revenue on a request that is already completed recalculates the split without changing its completion date. **Export to CSV** gives you the loaded set for reporting.

## Audit Log

Open **Audit Log** from the navigation bar to see who changed what, and when, on the platform's money. Your view shows the money-related actions only: credit balance changes and bulk adjustments, referral awards, agent commission reversals and payouts, setup-request revenue splits, event codes, and lab session charges, refunds and settlements. Administrators see every action.

- The page opens on the last 7 days. Change the dates, pick an **Action**, or type part of an email in **Performed by**, then select **Load**. The range can be up to a year.
- Select **Show all** on a row to see everything recorded with it, such as the balance before and after a change.
- If a range holds more actions than one load can read, only the most recent are shown and a notice asks you to narrow the dates.

The log is read-only.

## Audit Log

Open **Audit Log** from the navigation bar to see who changed what, and when, on the platform's money. Your view shows the money-related actions only: credit balance changes and bulk adjustments, referral awards, agent commission reversals and payouts, setup-request revenue splits, event codes, and lab session charges, refunds and settlements. Administrators see every action.

- The page opens on the last 7 days. Change the dates, pick an **Action**, or type part of an email in **Performed by**, then select **Load**. The range can be up to a year.
- Select **Show all** on a row to see everything recorded with it, such as the balance before and after a change.
- If a range holds more actions than one load can read, only the most recent are shown and a notice asks you to narrow the dates.

The log is read-only.

## Getting help

Click **Help** in the navigation bar:

- **Support** tab — a contact form that raises a support ticket and emails the support team, with **My tickets** beneath it listing the tickets you have raised and their status.
- **Setup Requests** tab — described above.
- **Support Tickets** tab — the shared ticket queue. Because billing is one of its categories, you can triage it: Finance and admins may assign, reassign or clear a ticket's assignee to anyone, where support agents may only claim an unassigned ticket or release one they hold.

The **ROI** calculator is not on Help — it's a tab on the **Credits** page, after Buy Credits. Credits appears in your navigation only if your account also holds the ordinary user role; otherwise go to `/credits` directly.

A **Contact us** link in the footer also takes you to the Help page.
