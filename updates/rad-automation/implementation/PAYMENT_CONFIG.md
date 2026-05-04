# Payment Provider Configuration Guide

This guide details the configuration required to enable Flutterwave and Paystack payment providers in the application.

## Prerequisites

1.  **Global Settings**: The application must have `enable_credits` and/or `enable_subscriptions` set to `true` in the Admin Settings for any payment provider to be visible.
2.  **Secret Manager**: API keys must be stored in Google Cloud Secret Manager.

## 1. Flutterwave Configuration

To enable Flutterwave support:

1.  **Obtain Keys**: Get your Public Key, Secret Key, and Encryption Key (for Secret Hash) from the Flutterwave Dashboard.
2.  **Configure Secrets**:
    *   Add `flutterwave-public-key` to Secret Manager.
    *   Add `flutterwave-secret-key` to Secret Manager.
    *   Add `flutterwave-secret-hash` to Secret Manager (used for webhook verification).
3.  **Enable Feature**:
    *   Go to **Admin > Settings**.
    *   Toggle **Enable Flutterwave** to `ON`.
    *   Save changes.

## 2. Paystack Configuration

To enable Paystack support:

1.  **Obtain Keys**: Get your Public Key and Secret Key from the Paystack Dashboard.
2.  **Configure Secrets**:
    *   Add `paystack-public-key` to Secret Manager.
    *   Add `paystack-secret-key` to Secret Manager.
3.  **Enable Feature**:
    *   Go to **Admin > Settings**.
    *   Toggle **Enable Paystack** to `ON`.
    *   Save changes.

## 3. Stripe Configuration (Existing)

Stripe configuration remains unchanged but now respects the independent toggle:

1.  **Secrets**: Ensure `stripe-publishable-key`, `stripe-secret-key`, and `stripe-webhook-secret` are set.
2.  **Enable Feature**: Toggle **Enable Stripe** in **Admin > Settings**.

## Troubleshooting

*   **Provider not showing?**
    *   Verify that *both* the API key is accessible (check server logs for "Successfully fetched key") *and* the feature flag is enabled in settings.
    *   Ensure you are on a page that allows payments (Credits or Subscriptions).
*   **Webhook Errors?**
    *   Check that `FLUTTERWAVE_SECRET_HASH` matches the value configured in your Flutterwave dashboard.
    *   Check `stripe-webhook-secret` for Stripe.
