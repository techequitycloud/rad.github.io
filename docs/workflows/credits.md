---
title: "Credit Management"
sidebar_label: "Credit Management"
---

# Credit Management

The credit system controls access to paid module deployments. This page explains how credits are allocated, consumed, and managed — including subscription options, multi-currency payments, and automatic billing controls.

---

## Credit Types

The platform distinguishes between two types of credits, stored separately in your account:

| Type | Source | Priority | Special Rules |
| :--- | :--- | :--- | :--- |
| **Awarded Credits** | Sign-up bonuses, referrals, admin grants | Consumed **first** by default | Cannot be cashed out; do not contribute to Partner/Agent revenue calculations |
| **Purchased Credits** | One-time purchases or monthly subscriptions via Stripe or Flutterwave | Consumed **second** (after Awarded Credits are exhausted) | Count as "True Revenue" for Partners and Agents; required exclusively by some modules |

**Total Balance** = Awarded Credits + Purchased Credits

---

## How Credits Are Allocated

Credits reach your account through several channels:

- **Sign-Up Bonus:** New accounts are automatically provisioned with a configurable number of Awarded Credits.
- **Referral Program:** Share your unique referral link or QR code from the **Help > Support** tab. When a referred user signs up, both you and the new user receive Awarded Credits (subject to a maximum referral cap).
- **Subscriptions:** Subscribe to a tier on the **Credits > Buy Credits** tab. A monthly allowance of Purchased Credits is added to your account on each billing cycle.
- **One-Time Purchases:** Buy a specific credit bundle via Stripe or Flutterwave from the **Buy Credits** tab.
- **Admin Grants:** Platform administrators can manually add or adjust credits on your account at any time.

---

## How Credits Are Consumed

Credits are deducted **after** a deployment succeeds, not when it is submitted. Failed deployments do not consume credits.

The deduction order is:

1. **Awarded Credits are deducted first** until exhausted.
2. **Purchased Credits are deducted** for any remaining balance.

**Exception:** If a module has the `require_credit_purchases` flag set to `true`, the full cost is deducted exclusively from Purchased Credits. Awarded Credits are not used, even if your Awarded balance is high.

**Partner Exemption:** If you are a Partner deploying a module that you own, the credit cost is always zero — no credits are deducted regardless of the module's defined cost.

---

## Viewing Your Balance and History

Navigate to the **Credits** page from the top navigation bar:

- **Credit Balance:** Displayed in the header stats area and at the top of the Credits page.
- **Credit Transactions Tab:** A searchable, filterable history of every credit award, purchase, and spend event. Each transaction shows the date, amount, type (Awarded or Purchased), Deployment ID (as a clickable link), and running balance. Export the full history as a CSV file.
- **Module Costs Tab:** (If enabled) A breakdown of credit spending by module across all your deployments.
- **Project Costs Tab:** (If enabled) Historical infrastructure costs from Google Cloud, converted to credits using the platform's `price per credit` rate.
- **Project Invoices Tab:** (If enabled) Monthly invoices for your projects' cloud spending, queryable by month and exportable to CSV.
- **Subscriptions Tab:** (If enabled) View available subscription tiers and manage your current subscription.

---

## Low Credit Alerts

When your credit balance falls below the configured threshold, the platform sends an automated email alert. To avoid deployment interruptions, top up your balance via the **Buy Credits** tab before the balance reaches zero.

---

## Automatic Billing Suspension

If your account's credit balance reaches zero and ongoing project costs are being tracked, the platform will automatically **disable Google Cloud billing** for your projects to prevent unexpected charges. To restore billing:

1. Top up your credit balance via **Credits > Buy Credits**.
2. Billing is re-enabled automatically on the system's next billing cycle (runs daily at midnight UTC).
3. If you need immediate re-enablement, contact your platform administrator.

---

## Transaction Types Reference

| Transaction Type | Description |
| :--- | :--- |
| `SIGNUP` | Initial sign-up bonus credited to your account |
| `AWARD` | Free credits granted by an admin or earned via referral |
| `PURCHASE` | Credits added from a Stripe or Flutterwave payment |
| `SPEND` | Credits deducted for a successful module deployment |
| `PROJECT` | Credits deducted for ongoing Google Cloud infrastructure costs |
| `PARTNER` | Monthly partner credit allowance (Partners only) |

---

## Multi-Currency Payments

The platform supports payments in multiple currencies through Flutterwave. When you proceed to checkout, you can select your preferred currency from the supported list. The platform converts the credit price to your selected currency using daily-refreshed exchange rates.

**Supported currencies:** USD, EUR, GBP, NGN, GHS, KES, ZAR, TZS, UGX, RWF, XAF, XOF

**How exchange rates work:**
- Rates are automatically synced from a live exchange-rate feed every day at 1:00 AM UTC.
- The rate shown at checkout is the rate in effect at that moment.
- All credit balances and platform pricing are stored in USD internally; the currency conversion applies only to the checkout amount you pay.
- Stripe transactions are always processed in USD.

> **Note:** If you select a non-USD currency and the exchange rate changes between when you view the price and when you complete payment, the final converted amount may differ slightly. Flutterwave handles currency conversion on their end as part of processing.

---

## Managing Your Subscription

If you subscribe to a credit tier and later cancel or your subscription lapses, you can reinstate it without losing your subscription history.

**To reinstate a cancelled subscription:**

1. Navigate to **Credits > Buy Credits**.
2. Click the **Subscriptions** tab.
3. Find your previous plan and click **Reinstate**.
4. Confirm the action. Your subscription is reactivated with the same tier, and your next billing cycle begins immediately.

> **Note:** Credits from the reinstated cycle are added to your balance at the time of reinstatement, not backdated.
