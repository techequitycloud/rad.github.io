---
title: "Agent Guide"
description: "RAD Platform agent guide — sharing your referral link, earning cash commission on referred users' module fees, tracking it on Credits → My Commission, and how payouts work."
---

# Agent Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/Agent_Guide.png" alt="Agent Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

For referral partners who earn a cash commission when the people they refer pay for module deployments on RAD. Agent is a sales role. New to RAD? Start with [Using RAD](using-rad.md).

## What you can do

As an Agent your role is about referrals and commission:

- Share your referral link. Everyone who signs up through it is linked to you.
- Earn **commission in cash** on the module fees those users pay with credits they bought.
- Earn **referral bonus credits** for every signup, with no monthly limit.
- Track every commission, and every payout made to you, on **Credits → My Commission**.

An agent's account usually also holds the **User** role, the one every signup starts with. If yours does, you keep everything a user has: deploying modules and solutions, your own credits and billing, and your deployments. See [Using RAD](using-rad.md).

## Getting the Agent role

An administrator grants the role on the **Users** page. It can be granted only while people can pay on the platform, meaning the credit system is on and at least one payment provider (Stripe or Flutterwave) is switched on. With payments off there is nothing for an agent to earn from, so the checkbox stays locked. An existing agent keeps the role if payments are later switched off.

After you sign in you land on **Credits**, on the **My Commission** tab. Your top navigation includes **Credits** and **Help**, plus the menus of any other role you hold. (**Credits** is hidden while the platform's credit system is switched off.)

## Your referral link

Your link and code are on your **Profile** (open the profile menu, top right), in the **Refer and earn** section. If your account also holds the User or Partner role, the **Credit Transactions** tab on **Credits** has a **Get your referral link** shortcut to it. The **Invite Friends** card there shows your code, a QR code, and **Copy Link** and **Share** buttons. The card appears whenever the referral program is on, including when referrals are unlimited; it is hidden only when the platform has switched the program off, and it is never shown to administrator accounts.

Anyone who signs up with your link is linked to your account. Self-referrals don't count, and neither does a pair of accounts referring each other.

**Referral bonus credits.** Each signup through your link adds referral credits to your balance. Ordinary users only get these up to a monthly limit. **Agents have no monthly limit**, so the card shows how many rewards you earned this month with no cap or progress bar. These are *awarded* credits: you can spend them on deployments, but they are not commission and are never paid out.

## How commission works

You earn a share of the **module fees** your referred users pay **with credits they bought** (from a subscription or a top-up).

| Counts towards commission | Never counts |
|---|---|
| A module's own fee, including the fees of the Google Cloud project and shared-services modules RAD sets up alongside it | Build (time-based) charges, and Google Cloud project usage |
| The part of a fee paid with purchased credits | The part paid with free or awarded credits (signup, monthly, referral, event codes) |
| | The self-serve project surcharge |
| | Anything spent inside a **lab** (training) session |
| | Subscriptions and credit purchases themselves (you earn when the credits are *spent* on module fees) |

- **Rate.** Set by Finance as the *Agent Revenue Share* (15% at the time of writing), fixed on each fee when it is charged. A later change to the rate never changes what you have already earned.
- **Currency.** Commission is worked out in US dollars from the credits' list price. For example, a 100-credit fee paid with purchased credits, at 10 credits per dollar and 15%, earns **$1.50**.
- **Timing.** Only fees charged **after** the person was referred, and **while you held the Agent role**, count. If your role is removed, you keep what you earned while you had it.
- **Deactivated accounts earn nothing.** If your account is deactivated, no further commission is recorded for you, and commission already recorded is **held back from payouts**. It stays on your statement and is paid only if the account is reactivated.

## Tracking your commission: Credits → My Commission

The **My Commission** tab is your statement.

- **Totals** across the top: **Earned**, **Reversed**, **On hold**, **Payable**, **In payout** and **Paid**.
- **One row per commission**: date, module, the module fee, the part paid with purchased credits, your rate, the commission, and its status.
- **Status** tells you where each one stands:
  - **On hold until** a date: every commission is held for **30 days** before it can be paid, so a refunded or disputed fee can be reversed first.
  - **Payable**: past the hold, waiting for the next payout.
  - **In payout**: included in a payout Finance is making.
  - **Paid**: included in a payout Finance has marked as paid.
  - **Reversed — not paid** / **Deducted from next payout**: Finance reversed it (for example, the fee was refunded), with the reason shown on the row.
- **Your payouts** lists every payout batch that paid you, marked *paid* with a date or *being paid*.

## How you get paid

Payouts are made by Finance in **batches**, in cash, **outside RAD** (by bank transfer or similar):

1. Finance picks a cut-off date and creates a batch. It takes everything payable up to that date and nets off any reversals.
2. You are included once your payable total reaches the **$50 minimum**. Anything smaller carries forward to the next batch; nothing is lost.
3. Finance pays you and marks the batch paid with a payment reference. Your statement then shows those commissions as **Paid**.

You don't request payouts yourself. If you think a payout is missing, raise a ticket from the **Send Message** tab on **Help**.

## What you can't do

The Agent role is deliberately narrow. As an agent you cannot:

- See the individual activity, deployments, balances or settings of the users you referred. Your statement shows the fee and the module, never their account.
- Run or approve payouts, reverse commissions, or see other agents' figures.
- Publish or manage modules, manage user accounts, or change platform settings.
- Act on another user's behalf. There is no impersonation anywhere in RAD.

## Getting help

Visit the **Help** page and use the **Send Message** tab to raise a support ticket; the **My tickets** tab lists the tickets you have raised and their status. While credits can be bought on the platform, raising a ticket needs purchased credits on your account; when purchases are switched off, anyone may raise one. You can raise up to 5 tickets in any 24 hours. You can also reach Help from the **Contact us** link in the footer.
