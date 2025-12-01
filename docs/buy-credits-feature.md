# Buy Credits & Subscription Plans

This document outlines the "Buy Credits" and "Subscription Plans" features on the platform, which allow users to purchase credits for deploying resources and subscribe to recurring plans that provide monthly credits and additional features.

## Overview

The platform offers two primary ways for users to acquire credits:
1.  **One-time Credit Purchase**: Users can buy a specific amount of credits as a one-time transaction.
2.  **Subscription Plans**: Users can subscribe to a recurring plan (e.g., Professional, Startup, SMB, Enterprise) that automatically awards credits and unlocks specific features on a monthly basis.

Both features are integrated with Stripe for secure payment processing.

## User Interface

The features are accessible via the **Credits** page (typically found under the user menu or navigation bar). When the `enable_subscription` setting is active, a "Buy Credits" tab is available.

### One-time Credit Purchase

Located at the bottom of the "Buy Credits" tab, the **Buy Credits Form** allows for flexible, on-demand credit acquisition.

**How it works:**
1.  **Input Amount**: The user enters the monetary amount they wish to spend (in the configured currency, e.g., USD).
2.  **Credit Calculation**: The system automatically calculates the number of credits the user will receive based on the globally configured `creditsPerUnit` rate.
    *   *Example*: If `creditsPerUnit` is 10 and the user enters $100, they will receive 1,000 credits.
3.  **Purchase**: Clicking "Buy Credits" redirects the user to a secure Stripe Checkout page.
4.  **Completion**: Upon successful payment, the user is redirected back to the platform, and the credits are immediately added to their `Purchased Credits` balance.

### Subscription Plans

The "Buy Credits" tab displays available subscription tiers in a card layout.

**Features of Subscription Tiers:**
-   **Tiers**: Typically includes levels like Professional, Startup, SMB, and Enterprise.
-   **Benefits**: Each tier displays its cost, the number of monthly credits provided, and specific features included (e.g., "Priority Support", "Advanced Analytics").
-   **Status**: The UI clearly indicates the user's current active subscription.

**How to Subscribe:**
1.  **Select Tier**: The user clicks the "Subscribe" button on their desired plan.
2.  **Payment**: The user is redirected to Stripe to set up the recurring payment.
3.  **Activation**: After payment, the system verifies the subscription (via polling) and activates the plan. Credits for the first month are awarded immediately.

**Managing Subscriptions:**
-   Users can view their renewal date.
-   Users can **Cancel** their subscription directly from the card. Cancellation takes effect at the end of the current billing period.

## Admin Configuration

Administrators manage these features via the **Admin Settings**.

1.  **Enable/Disable**: The entire subscription and buy-credits system can be toggled via the `enable_subscription` setting.
2.  **Credit Rate**: The `creditsPerUnit` setting determines how many credits a user gets per unit of currency (for one-time purchases).
3.  **Subscription Tiers**: Admins can create, edit, and delete subscription tiers via the **Subscription Management** interface (`SubscriptionTierManagement`). Configurable fields include:
    -   Name (e.g., "Gold Plan")
    -   Price & Currency
    -   Stripe Price ID (links to the product in Stripe)
    -   Credits included
    -   Feature list

## Technical Implementation

### Backend API

-   **One-time Purchase**:
    -   Endpoint: `POST /api/stripe/checkout-session`
    -   Logic: Creates a one-time Stripe Checkout Session. It embeds the `userId` and calculated `credits` in the session metadata for fulfillment via webhooks.

-   **Subscriptions**:
    -   Endpoint: `POST /api/stripe/subscription-checkout`
    -   Logic: Creates a subscription-mode Stripe Checkout Session using the selected tier's `priceId`.

-   **Webhooks**:
    -   Endpoint: `/api/stripe/webhook`
    -   Logic: Listens for Stripe events (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`) to securely update user balances and subscription states in the database.

### Frontend Components

-   **`UserSubscriptionTiers.tsx`**: The main container component that fetches and renders available tiers and the user's current subscription status. It handles the polling logic to confirm subscription activation.
-   **`BuyCreditsForm.tsx`**: A reusable form component for handling one-time purchases, performing input validation (min/max amounts), and initiating the Stripe checkout flow.
