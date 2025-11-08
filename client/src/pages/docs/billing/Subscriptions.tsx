import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Subscription Tiers

Subscription tiers provide a recurring credit allocation model for users who regularly deploy infrastructure modules. This guide covers how subscriptions work for both users and administrators.

## Overview

Subscription tiers offer:

- **Predictable Costs**: Fixed monthly pricing for regular credit allocations
- **Automatic Renewal**: Credits are automatically added each billing period
- **Flexible Plans**: Multiple tiers to match different usage patterns
- **Easy Management**: Simple subscription and cancellation through Stripe

## For Users

### Viewing Available Tiers

Navigate to the Billing page and select the "Subscription Tiers" or "Buy Credits" tab (depending on your role). Each tier displays:

- **Tier Name**: Descriptive name (e.g., "Basic", "Professional", "Enterprise")
- **Monthly Price**: The recurring cost in your billing currency
- **Credits Included**: Number of credits allocated each billing period
- **Features**: List of included features or benefits
- **Billing Period**: Frequency of charges (typically monthly)

### Subscribing to a Tier

1. **Review Options**: Compare available tiers to find the best fit for your usage
2. **Select Tier**: Click the "Subscribe" button on your chosen tier
3. **Stripe Checkout**: You'll be redirected to Stripe's secure payment page
4. **Payment Information**: Enter your payment details (credit card or other accepted methods)
5. **Confirm Subscription**: Complete the checkout process
6. **Immediate Access**: Credits are added to your account immediately
7. **Return to Platform**: Stripe redirects you back to the Billing page with a confirmation message

### Active Subscriptions

Once subscribed:

- Your active tier is highlighted on the Subscription Tiers page
- Other tiers are disabled (you can only have one active subscription)
- Credits are automatically added at the start of each billing period
- Your payment method is charged automatically

### Managing Your Subscription

**View Status**: Check your current subscription tier and next billing date on the Billing page

**Cancel Auto-Renewal**: You can cancel your subscription to prevent future charges:
1. Navigate to the Subscription Tiers tab
2. Click "Manage Subscription" or "Cancel" on your active tier
3. Confirm cancellation
4. You'll retain access until the end of your current billing period

**Change Tiers**: To switch to a different tier:
1. Cancel your current subscription
2. Wait for the current period to end
3. Subscribe to the new tier

### Subscription Billing

**Recurring Charges**: Your payment method is charged automatically at the start of each billing period

**Failed Payments**: If a payment fails:
- You'll receive an email notification
- Stripe will attempt to retry the payment
- Your subscription may be suspended if payment cannot be processed
- Update your payment method through the Stripe customer portal

**Invoices**: Monthly invoices are available on the "Monthly Invoices" tab for your records

## For Administrators

### Creating Subscription Tiers

Administrators can create and manage subscription tiers from the Billing page:

1. **Navigate to Subscription Tiers**: Access the "Subscription Tiers" tab (admin view)
2. **Add New Tier**: Click the "Add New Tier" button
3. **Configure Tier**:
   - **Name**: Descriptive tier name
   - **Price**: Monthly cost in your billing currency
   - **Credits**: Number of credits to grant each period
   - **Features**: List of included features (one per line)
   - **Billing Period**: Typically "month" for monthly subscriptions
4. **Save**: Click "Save" to create the tier

### Editing Tiers

To modify an existing tier:

1. Locate the tier in the Subscription Tiers table
2. Click the "Edit" button
3. Update the desired fields
4. Save changes

**Note**: Changes to tier pricing or credits affect new subscriptions and renewals, not existing active subscriptions mid-period.

### Deleting Tiers

To remove a tier:

1. Click the "Delete" button next to the tier
2. Confirm deletion
3. The tier is removed from the available options

**Important**: Deleting a tier doesn't cancel existing subscriptions to that tier. Users with active subscriptions will continue to be billed until they cancel.

### Tier Strategy

Consider these factors when designing subscription tiers:

**Usage Patterns**: Analyze typical user deployment frequency and credit consumption

**Pricing**: Balance between attractiveness to users and covering infrastructure costs

**Tier Differentiation**: Create clear value differences between tiers

**Feature Bundling**: Include additional benefits beyond credits (e.g., priority support, extended retention)

## Stripe Integration

### Payment Processing

All subscription payments are processed through Stripe:

- **Security**: Payment information is never stored on the RAD Platform
- **PCI Compliance**: Stripe handles all PCI compliance requirements
- **Payment Methods**: Supports credit cards, debit cards, and other Stripe-enabled payment methods
- **Global Support**: Accepts payments in multiple currencies

### Webhook Integration

The platform uses Stripe webhooks to handle subscription events:

- **Subscription Created**: Credits are added when a subscription starts
- **Subscription Renewed**: Credits are added at each billing cycle
- **Subscription Cancelled**: Auto-renewal is stopped
- **Payment Failed**: User is notified and subscription may be suspended

### Customer Portal

Users can manage their subscriptions through Stripe's customer portal:

- Update payment methods
- View billing history
- Download invoices
- Cancel subscriptions

## Best Practices

### For Users

**Choose Appropriately**: Select a tier that matches your expected usage to avoid overpaying

**Monitor Usage**: Track your credit consumption to ensure your tier is sufficient

**Plan Ahead**: Subscribe before you need credits to avoid deployment delays

**Annual Planning**: Consider your annual infrastructure needs when selecting a tier

### For Administrators

**Market Research**: Review competitor pricing and user feedback when setting prices

**Clear Communication**: Clearly describe what's included in each tier

**Regular Review**: Periodically review tier performance and adjust as needed

**Grandfathering**: Consider grandfathering existing subscribers when making price increases

**Support**: Provide clear guidance on which tier is appropriate for different use cases

## Troubleshooting

### Payment Issues

**Declined Card**: Update payment method through the Stripe customer portal

**Insufficient Funds**: Ensure your payment method has sufficient funds

**Expired Card**: Update card information before the next billing cycle

### Subscription Not Active

**Check Email**: Look for confirmation emails from Stripe

**Verify Payment**: Ensure the payment was processed successfully

**Contact Support**: If issues persist, contact platform support with your subscription details

### Credits Not Added

**Wait for Processing**: Credit allocation may take a few minutes after payment

**Check Transactions**: Review your credit transaction history

**Refresh Page**: Reload the Billing page to see updated balance

**Contact Support**: If credits don't appear within an hour, contact support
`;

export default function Subscriptions() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
