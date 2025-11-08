---
title: Transactions
sidebar_position: 3
description: View and audit RAD Platform transaction history - track credit purchases, usage, and billing records
keywords: ['transactions', 'transaction history', 'billing history', 'credit usage', 'audit trail']
---

# Transactions

The RAD Platform maintains a comprehensive transaction history for all credit-related activities. This provides complete transparency and auditability for credit purchases, deployments, refunds, and administrative adjustments.

## Transaction Types

The platform records several types of transactions:

**Credit Purchase**: One-time credit purchases through Stripe. Includes the purchase amount, credits added, and payment confirmation.

**Subscription Renewal**: Automatic credit additions from subscription renewals. Records the subscription tier, billing period, and renewal date.

**Deployment Cost**: Credits deducted when deploying infrastructure. Includes the module name, deployment ID, and credit cost.

**Manual Adjustment**: Administrative credit additions or deductions. Records the administrator who made the change and the reason.

**Signup Bonus**: Free credits awarded when creating a new account. Configured by administrators as part of the onboarding process.

**Refund**: Credits returned due to deployment failures or cancellations. Links to the original deployment transaction.

## Viewing Transaction History

Access your transaction history from the Billing page. The transaction list displays the transaction date and time, type of transaction, credit amount (positive for additions, negative for deductions), running balance after the transaction, and description or reference information.

### Filtering Transactions

Filter your transaction history by date range, transaction type, or amount range. Search for specific transactions using deployment IDs, payment references, or descriptions.

### Exporting Transactions

Export your transaction history to CSV or PDF format for accounting purposes, expense reporting, or record keeping. Exported files include all transaction details and can be filtered before export.

## Transaction Details

Click on any transaction to view detailed information:

**Basic Information**: Transaction ID, timestamp, type, and amount.

**Credit Impact**: Credits added or deducted and account balance before and after the transaction.

**Related Information**: For deployments, the module name, deployment ID, and project ID. For purchases, payment method, Stripe transaction ID, and receipt. For manual adjustments, the administrator name and adjustment reason.

**Audit Trail**: User who initiated the transaction, IP address (for purchases), and any associated notes or comments.

## Credit Balance Tracking

Your current credit balance reflects all transactions in your history. The balance is calculated as signup bonus credits plus purchased credits plus subscription credits plus manual adjustments minus deployment costs.

### Balance Verification

You can verify your balance by reviewing your transaction history. The running balance column shows your balance after each transaction. The final entry should match your current balance displayed on the Billing page.

## Deployment Cost Transactions

When you deploy infrastructure, a transaction records the credit cost. Deployment transactions include the module name and version, deployment ID for reference, estimated vs. actual cost, deployment status, and timestamp of deployment initiation.

If a deployment fails before infrastructure is created, the credits may be refunded automatically. A refund transaction will appear in your history linked to the original deployment.

## Purchase Transactions

Credit purchases through Stripe generate detailed transaction records including the purchase amount in your currency, credits added to your account, Stripe transaction ID, payment method used, and receipt available for download.

### Receipt Access

Access receipts for all purchases from the transaction details page. Receipts include your account information, purchase details, payment method, and Stripe transaction reference. Download receipts as PDF for expense reporting or accounting.

## Subscription Renewal Transactions

Each subscription renewal creates a transaction record showing the subscription tier name, billing period, credits allocated, renewal cost, and next renewal date.

Renewal transactions help you track your subscription history and understand your credit allocation patterns over time.

## Manual Adjustment Transactions

Administrators can manually adjust credit balances for various reasons including promotional credits, error corrections, refunds for service issues, or compensation for platform downtime.

Manual adjustment transactions always include the administrator who made the change, the reason for the adjustment, and the date and time of the change. This ensures full accountability and transparency.

## Transaction Notifications

You receive email notifications for significant transactions including credit purchases, subscription renewals, large deployments, low balance warnings, and payment failures.

Configure notification preferences in your profile settings to control which transaction types trigger emails.

## Audit and Compliance

The transaction system provides complete audit trails for compliance purposes. All transactions are immutable once created and include timestamps, user information, and detailed descriptions. Administrators can access platform-wide transaction reports for financial oversight.

### Data Retention

Transaction records are retained indefinitely for audit purposes. Even after account deletion, anonymized transaction records may be retained for financial and legal compliance.

## Troubleshooting

### Missing Transactions

If you expect a transaction that doesn't appear in your history, wait a few minutes for processing delays. Refresh the transaction page. Verify the transaction was actually completed (check email confirmations). Contact support with relevant details if the transaction is still missing.

### Incorrect Balance

If your balance doesn't match your transaction history, try refreshing the page to ensure you're viewing current data. Calculate the balance manually from your transaction history. Check for pending transactions that haven't been processed yet. Contact support if the discrepancy persists.

### Failed Transactions

Failed transactions may appear in your history with a "Failed" status. Review the failure reason in the transaction details. For payment failures, update your payment method and try again. For deployment failures, check deployment logs for specific errors. Contact support if you need assistance resolving the failure.

## Related Resources

- [Credits System](/docs/billing/credits) - Understanding how credits work
- [Subscriptions](/docs/billing/subscriptions) - Managing recurring credit purchases
- [Deployments](/docs/features/deployments) - Understanding deployment costs
