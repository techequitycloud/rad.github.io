import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Credit Transactions

The Credit Transactions feature provides a comprehensive audit trail of all credit-related activities on your account. This guide explains how to view, search, and export your transaction history.

## Accessing Transactions

Navigate to the **Billing** page and select the **Credit Transactions** tab. This tab is available to all users and displays transactions specific to your account.

Administrators can also view transactions for other users through the User Credits management interface.

## Transaction Table

The transaction table displays all credit movements with the following information:

### Transaction Columns

**Date**: Timestamp when the transaction occurred, displayed in your local timezone

**Awarded Credits**: Credits added or deducted from your awarded balance (free credits)

**Purchased Credits**: Credits added or deducted from your purchased balance (paid credits)

**Deployment ID**: If the transaction is related to a deployment, the deployment ID is shown as a clickable link

**Credits Spent**: Amount of credits deducted for deployments or project costs

**Balance**: Your total credit balance after this transaction

**Category**: Type of transaction (deployment, purchase, award, project cost, etc.)

## Transaction Types

### Credit Additions

**Signup Bonus**: Initial credits awarded when you first register

**Referral Reward**: Credits earned when someone signs up using your referral link

**Subscription Credits**: Recurring credits from your active subscription tier

**One-Time Purchase**: Credits purchased through the Buy Credits feature

**Manual Award**: Credits manually added by an administrator

**Monthly Grant**: Recurring monthly credits if enabled by administrators

### Credit Deductions

**Deployment Cost**: Credits deducted when deploying a module

**Project Cost**: Ongoing infrastructure costs deducted periodically

**Manual Adjustment**: Credits manually removed by an administrator

**Refund Reversal**: Correction of previously issued credits

## Searching and Filtering

### Search by Deployment ID

Use the search box to find transactions related to a specific deployment:

1. Enter the deployment ID in the search field
2. The table updates to show only matching transactions
3. Clear the search to view all transactions again

### Filter by Date Range

Narrow down transactions to a specific time period:

1. Click the date range picker
2. Select start and end dates
3. The table updates to show transactions within that range
4. Clear filters to view all transactions

### Combined Filters

You can combine search and date filters:

- Search for a deployment ID within a specific date range
- Filter by date and then search within those results

## Exporting Transactions

### CSV Export

Export your transaction history for external analysis or record-keeping:

1. Apply any desired filters (date range, search)
2. Click the **Export CSV** button
3. A CSV file downloads with the current view's data
4. Open in Excel, Google Sheets, or other spreadsheet applications

### Export Contents

The CSV export includes all visible columns:

- Transaction date and time
- Credit amounts (awarded and purchased)
- Deployment IDs
- Categories
- Balances
- Notes or descriptions

## Understanding Your Balance

### Balance Calculation

Your balance is calculated as:

\`\`\`
Total Balance = Awarded Credits + Purchased Credits
\`\`\`

### Balance History

Each transaction row shows your balance after that transaction, allowing you to:

- Track how your balance has changed over time
- Identify periods of high or low usage
- Verify that credits were added or deducted correctly

### Negative Balances

The platform prevents negative balances:

- Deployments are blocked if you have insufficient credits
- The confirmation modal shows your balance and deployment cost
- You must purchase credits before proceeding

## Transaction Details

### Deployment Transactions

When a transaction is related to a deployment:

- The **Deployment ID** is displayed as a clickable link
- Click the link to view full deployment details
- The deployment page shows configuration, logs, and status
- You can cross-reference the credit cost with the deployment outcome

### Project Cost Transactions

Project costs are deducted periodically based on actual infrastructure usage:

- **Frequency**: Determined by the refresh interval setting
- **Calculation**: Based on cloud provider billing data
- **Allocation**: Costs are attributed to the user who deployed the project
- **Transparency**: Each project cost transaction shows the associated project ID

## Best Practices

### Regular Monitoring

**Weekly Reviews**: Check your transactions weekly to stay informed about spending

**Budget Tracking**: Use transaction history to track spending against budgets

**Anomaly Detection**: Look for unexpected transactions or unusual patterns

**Reconciliation**: Compare transaction history with deployment records

### Record Keeping

**Export Regularly**: Download CSV exports monthly for your records

**Archive Data**: Keep historical exports for long-term analysis

**Audit Trail**: Use transaction history for internal audits or compliance

**Expense Reports**: Include transaction exports in expense reports or chargebacks

### Troubleshooting

**Verify Charges**: Check transactions if you notice unexpected balance changes

**Deployment Costs**: Cross-reference deployment costs with module pricing

**Support Requests**: Include transaction IDs when contacting support about billing issues

**Dispute Resolution**: Use transaction history as evidence for billing disputes

## For Administrators

### User Transaction Management

Administrators have additional capabilities:

**View All Users**: Access transaction history for any user through User Credits

**Audit Trail**: Review all credit adjustments and manual changes

**Bulk Operations**: Track the impact of bulk credit adjustments

**Revenue Reporting**: Aggregate transaction data for financial reporting

### Transaction Monitoring

**Platform-Wide View**: Monitor total credit flow across the platform

**Usage Patterns**: Identify trends in credit consumption

**Fraud Detection**: Look for suspicious transaction patterns

**Cost Analysis**: Analyze which modules and features drive credit consumption

## Privacy and Security

### Data Protection

- Transaction data is encrypted at rest and in transit
- Access is restricted based on user role and ownership
- Administrators can only view transactions for audit purposes
- No payment card data is stored (handled by Stripe)

### Audit Compliance

- All transactions are immutable once recorded
- Manual adjustments include administrator identification
- Timestamps are accurate and timezone-aware
- Export functionality supports compliance reporting
`;

export default function Transactions() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
