import AudioPlayer from '@site/src/components/AudioPlayer';

# Finance Workflow

<img src="https://storage.googleapis.com/rad-public-2b65/workflows/finance_workflow.png" alt="Finance Workflow" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflows/finance_workflow.m4a" title="Finance Workflow Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/workflows/finance_workflow.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction
The Finance role provides deep visibility into the platform's economics — revenue by partner and user, credit spending, project infrastructure costs, payment provider activity, and automated reconciliation.

## 2. Step 1: Access Billing Dashboard
1.  Click **Billing** in the navigation bar.
2.  You will see several tabs including **Subscription Tiers**, **Credit Settings**, **Project Costs**, **User Revenue**, **Partner Revenue**, and more.

## 3. Step 2: Analyze Revenue

### Partner and User Revenue

1.  Click the **Partner Revenue** tab (labeled **Project Revenue** in some views).
    *   **True Revenue:** This metric excludes credits that were awarded for free (sign-up bonuses, referrals, admin grants). It shows only revenue generated from credit purchases actually consumed by deployments — a reliable measure of real monetary throughput.
    *   **Filter:** Filter by date range or specific project IDs to narrow results.
2.  Click **User Revenue**.
    *   See which users are your top spenders.
    *   Drill down into specific user activities to understand deployment patterns.

### Understanding "True Revenue" vs Total Revenue

| Metric | Includes | Use For |
| :--- | :--- | :--- |
| **Total Revenue** | All credits consumed (Awarded + Purchased) | Platform usage volume |
| **True Revenue** | Only Purchased Credits consumed | Actual monetary earnings; Partner/Agent commissions |

> **Important:** Partner and Agent commission calculations are based on **True Revenue** only. Awarded Credits consumed by a referred user do not generate commission for the referrer.

## 4. Step 3: Credit Management
1.  Click **Credit Settings** to adjust global rates (Price Per Credit, Sign-up Bonus, Low Credit Threshold, Monthly Top-Up).
2.  Click **Credit Management** to search for and adjust individual user credit balances.

## 5. Step 4: Invoices and Project Costs

1.  Click **Project Invoices**.
2.  Select a month from the filter to view that month's invoices for all Google Cloud projects linked to the platform.
3.  Click **Export CSV** to download the invoice data for accounting and compliance purposes.
4.  Click **Project Costs** to see a breakdown of infrastructure costs by project, converted to credits using the platform's configured Price Per Credit rate.

## 6. Step 5: Payment Providers and Multi-Currency

The platform accepts payments through two providers: **Stripe** and **Flutterwave**. As a Finance user you should understand how each provider is configured and which currencies each supports.

| Provider | Currencies | Notes |
| :--- | :--- | :--- |
| **Stripe** | USD only | Used for subscriptions and one-time purchases; webhook-validated |
| **Flutterwave** | USD, EUR, GBP, NGN, GHS, KES, ZAR, TZS, UGX, RWF, XAF, XOF | Broad currency support; exchange rates synced daily at 1:00 AM UTC |

### Exchange Rate Management

Exchange rates used for Flutterwave currency conversion are updated automatically every day at 1:00 AM UTC by a Cloud Scheduler job. To force an immediate update (for example after a major currency movement):

1.  Contact your platform administrator to trigger a manual currency sync from the Admin panel.
2.  The sync fetches the latest rates and updates the platform's rate table; the new rates take effect for any checkout initiated after the sync completes.

## 7. Step 6: Payment Reconciliation

The platform runs an automatic payment reconciliation job every day at 2:00 AM UTC. This job cross-references payment provider records against internal credit transaction logs and flags:

*   **Missing credits** — payment succeeded at the provider but credits were not added
*   **Duplicate credits** — credits were added more than once for a single payment

### Viewing Reconciliation Results

1.  Navigate to **Billing > Credit Management**.
2.  Click **Reconcile Payments** to trigger a manual run, or view results from the last automated run.
3.  The reconciliation report shows a list of discrepancies with the affected user, payment provider, transaction ID, and recommended correction.
4.  To resolve a discrepancy, click **Adjust Credits** on the affected row and enter the corrected credit amount.

> **Tip:** Run a manual reconciliation if a user reports that a payment went through but their balance was not updated. The reconciliation report will surface the missing transaction.

## 8. Step 7: Subscription Management

Finance users can view and manage all subscriptions across providers.

1.  Navigate to **Billing > Subscription Tiers** to view active tiers and subscriber counts.
2.  To **reinstate a cancelled subscription** for a user:
    *   Go to **Credit Management**, find the user, and click **Edit**.
    *   Use the **Reinstate Subscription** action to reactivate their plan and trigger an immediate credit top-up.
3.  To **manually sync** a user's Flutterwave subscription status (e.g., after a webhook was missed):
    *   Find the user in **Credit Management** and click **Sync Subscription**.
    *   The platform re-fetches the subscription state from Flutterwave and updates the record accordingly.
