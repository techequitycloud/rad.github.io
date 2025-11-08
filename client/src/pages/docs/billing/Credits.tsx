import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Credit System

The RAD Platform uses a credit-based system to manage resource allocation and track infrastructure costs. This comprehensive guide explains how credits work, how to acquire them, and how they're consumed.

## Credit Overview

### What Are Credits?

Credits are the platform's internal currency used to:

- Control access to module deployments
- Track infrastructure costs
- Implement chargeback and cost allocation
- Manage resource consumption across teams

### Credit Types

The platform manages two types of credits:

**Awarded Credits**: Free credits granted by administrators, including:
- Signup bonuses for new users
- Referral rewards
- Promotional credits
- Manual adjustments by administrators

**Purchased Credits**: Credits acquired through:
- One-time purchases via Stripe
- Recurring subscription tiers
- Enterprise credit packages

## Acquiring Credits

### Signup Credits

New users automatically receive awarded credits when they first sign up for the platform. The amount is configured by administrators in the Credit Settings.

**Monthly Signup Credits**: Administrators can enable monthly credit grants, automatically awarding credits to all users on a recurring basis.

### Referral Program

Users can earn credits by referring new users to the platform:

1. Share your referral link with colleagues
2. When they sign up and verify their account, you receive referral credits
3. The referral amount is configured by administrators

### Purchasing Credits

#### One-Time Purchases

Navigate to the Billing page and select the "Buy Credits" tab:

1. Enter the amount you want to spend
2. The system calculates the number of credits based on the configured price per credit
3. Click "Buy Credits" to proceed to Stripe checkout
4. Complete the payment securely through Stripe
5. Credits are added to your account immediately upon successful payment

#### Subscription Tiers

Subscribe to a recurring tier for regular credit allocations:

1. View available subscription tiers on the Billing page
2. Each tier displays:
   - Monthly price
   - Number of credits included
   - Billing period
   - Features included
3. Click "Subscribe" on your desired tier
4. Complete payment through Stripe
5. Credits are automatically added each billing period

**Managing Subscriptions**: You can view your active subscription, change tiers, or cancel auto-renewal from the Subscription Tiers tab.

## Credit Consumption

### Deployment Costs

Each module has an associated credit cost displayed on the module card. When you deploy a module:

1. The system checks your available credit balance
2. If sufficient credits are available, the deployment proceeds
3. The credit cost is deducted from your balance
4. The transaction is recorded in your credit history

### Credit Deduction Order

When credits are consumed, the system deducts in this order:

1. **Awarded Credits First**: Free credits are used before purchased credits
2. **Purchased Credits**: Used only after awarded credits are exhausted

This ensures you maximize the value of your purchased credits.

### Project Costs

In addition to deployment costs, the platform tracks ongoing project costs:

- Infrastructure running costs from cloud providers
- Resource consumption over time
- Periodic billing based on actual usage

These costs are automatically deducted from your credit balance based on the configured refresh interval.

## Credit Balance Management

### Checking Your Balance

View your current credit balance from:

- The Billing page header
- The deployment confirmation modal
- The Credits page dashboard

Your balance shows:
- Total available credits
- Breakdown of awarded vs. purchased credits (if enabled)
- Recent transactions

### Low Credit Notifications

When your balance falls below the configured threshold:

- You receive an email notification
- A warning appears on the Billing page
- Deployment confirmations show an alert

This gives you time to purchase additional credits before running out.

### Credit Transactions

The Credit Transactions tab provides a detailed history:

**Transaction Types**:
- Credit purchases (one-time and subscriptions)
- Deployment costs
- Project costs
- Awarded credits (signup, referral, manual adjustments)
- Refunds and corrections

**Transaction Details**:
- Date and time
- Transaction type and category
- Credits added or deducted
- Associated deployment ID (if applicable)
- Resulting balance after transaction

**Search and Filter**: Find specific transactions by:
- Deployment ID
- Date range
- Transaction type
- Amount

**Export**: Download your transaction history as CSV for external analysis or accounting purposes.

## Credit Settings (Administrators)

### Configuring the Credit System

Administrators control the credit economy through Credit Settings:

**Enable Credits**: Toggle the credit system on or off platform-wide

**Signup Credit Amount**: Set the number of credits new users receive

**Monthly Signup Credits**: Enable recurring monthly credit grants for all users

**Referral Credit Amount**: Configure rewards for successful referrals

**Price Per Credit**: Set the conversion rate between currency and credits

**Low Credit Trigger**: Define the threshold for low balance notifications

**Refresh Interval**: Set how often project costs are calculated and deducted

### Adjusting User Credits

Administrators can manually adjust credits for users:

**Individual Adjustments**: Add or remove credits for specific users through the User Credits tab

**Bulk Adjustments**: Apply credit changes to all users at once through the Adjust All User Credits form

**Credit Type Selection**: Choose whether to adjust awarded or purchased credits

All manual adjustments are logged as transactions for audit purposes.

## Best Practices

### For Users

**Monitor Your Balance**: Regularly check your credit balance to avoid deployment failures

**Plan Purchases**: Consider subscription tiers if you deploy frequently

**Track Usage**: Review credit transactions to understand your spending patterns

**Budget Appropriately**: Estimate credit needs based on planned deployments

### For Administrators

**Set Appropriate Costs**: Align module costs with actual infrastructure expenses

**Configure Alerts**: Set low credit thresholds that give users time to respond

**Review Pricing**: Regularly review and adjust the price per credit based on costs

**Monitor Usage**: Track platform-wide credit consumption to identify trends

**Communicate Changes**: Notify users before making significant changes to credit policies
`;

export default function Credits() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
