---
title: Subscriptions
sidebar_position: 2
description: RAD Platform subscription tiers and recurring billing - choose the right plan for your infrastructure deployment needs
keywords: ['subscriptions', 'pricing plans', 'recurring billing', 'subscription management', 'platform tiers']
---

# Subscriptions

The RAD Platform offers subscription tiers that provide recurring credit allocations at discounted rates compared to one-time purchases. Subscriptions are managed through Stripe and automatically renew based on your selected billing period.

## Subscription Tiers

Administrators configure subscription tiers with specific credit amounts, pricing, and billing periods. Common tier structures include:

**Starter Tier**: Designed for individual users or small teams with moderate infrastructure needs. Provides a monthly credit allocation suitable for development and testing environments.

**Professional Tier**: Targeted at growing teams with regular production deployments. Offers increased credit allocations and better per-credit pricing than the starter tier.

**Enterprise Tier**: Built for large organizations with extensive infrastructure requirements. Provides the highest credit allocations and best per-credit rates, along with priority support.

## Purchasing a Subscription

To subscribe to a tier, navigate to the Billing page and select the Buy Credits tab. Review available subscription tiers, compare credit allocations and pricing, select your preferred tier, and complete payment through Stripe. Your subscription activates immediately, and credits are added to your account.

## Subscription Management

### Viewing Your Subscription

Your active subscription details are displayed on the Billing page, including the tier name, credit allocation per billing period, next renewal date, total cost per period, and payment method.

### Renewal Process

Subscriptions automatically renew at the end of each billing period. The platform processes payment through Stripe, adds credits to your account upon successful payment, and sends a confirmation email. If payment fails, you receive a notification with instructions to update your payment method.

### Changing Subscriptions

You can upgrade or downgrade your subscription tier at any time. When changing tiers, the new tier takes effect at the next renewal date. Your current subscription continues until the end of the current billing period. Credits from the current tier remain in your account and can be used alongside credits from the new tier.

### Canceling Subscriptions

To cancel your subscription, navigate to your subscription settings and select the cancel option. Your subscription remains active until the end of the current billing period. After cancellation, no further charges occur, and you retain any unused credits in your account.

## Billing Periods

Subscriptions support multiple billing periods:

**Monthly**: Credits are allocated and billed every month. Suitable for users who prefer flexibility and lower upfront costs.

**Quarterly**: Credits are allocated and billed every three months. Offers moderate savings compared to monthly billing.

**Annual**: Credits are allocated and billed once per year. Provides the best value with significant savings compared to monthly or quarterly billing.

## Payment Methods

Subscriptions are processed through Stripe, which supports credit cards, debit cards, and various digital payment methods depending on your region. Payment information is stored securely by Stripe and never directly by the RAD Platform.

### Updating Payment Methods

To update your payment method, access your subscription settings, select "Update Payment Method," and enter new payment information through the secure Stripe interface. Changes take effect immediately for future renewals.

## Subscription Benefits

Compared to one-time credit purchases, subscriptions offer discounted per-credit pricing, predictable monthly costs, automatic credit replenishment, and no need to manually purchase credits.

## Subscription vs. One-Time Purchases

**Subscriptions** are ideal for users with regular, ongoing infrastructure needs who want predictable costs and the best per-credit rates. They provide automatic renewals and consistent credit availability.

**One-Time Purchases** are better for users with occasional or unpredictable infrastructure needs who prefer to pay only when needed. They offer flexibility without recurring commitments.

You can use both subscriptions and one-time purchases together. Credits from both sources are combined in your account balance.

## Troubleshooting

### Payment Failed

If a subscription payment fails, check that your payment method is valid and has sufficient funds. Update your payment information in subscription settings. Contact your bank if the issue persists. Reach out to support if you need assistance.

### Credits Not Added

If credits don't appear after a successful payment, wait a few minutes for processing to complete. Check your transaction history to confirm payment. Refresh the Billing page. Contact support with your transaction ID if credits still don't appear.

### Subscription Not Renewing

Verify that your subscription is active and not canceled. Check that your payment method is up to date. Review your email for payment failure notifications. Contact support if the issue persists.

## Related Resources

- [Credits System](/docs/billing/credits) - Understanding how credits work
- [Transactions](/docs/billing/transactions) - Viewing transaction history
- [Administrator Guide](/docs/guides/admin) - Managing subscription tiers (admins only)
