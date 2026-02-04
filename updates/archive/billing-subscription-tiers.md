# Subscription Tiers (Admin View)

The **Subscription Tiers** tab is where Administrators define the subscription packages available to users. These tiers determine how many credits users get, the price they pay, and the features they unlock.

## Features

*   **Create Tier:** Add a new subscription tier.
*   **Edit Tier:** Modify existing tiers (name, price, credits, etc.).
*   **Delete Tier:** Remove a tier (note: this may affect existing subscribers).
*   **Stripe Integration:** Link tiers to Stripe Price IDs for automated billing.

## Tier Configuration Fields

When creating or editing a tier, you can configure:

*   **Name:** The display name of the tier (e.g., "Pro Plan").
*   **Description:** A marketing description shown to users.
*   **Price:** The monthly cost.
*   **Currency:** The currency code (e.g., USD).
*   **Credits:** The number of "Purchased" credits included in this tier per month.
*   **Stripe Price ID:** The ID from your Stripe Dashboard (e.g., `price_12345`). This is required for checkout to work.
*   **Features:** A list of bullet points describing the benefits (e.g., "Priority Support", "Unlimited Deployments").

## How to Use

1.  Navigate to the **Billing** page and click on the **Subscription Tiers** tab.
2.  **To Create:** Click the **Add Tier** button. Fill in the form and save.
3.  **To Edit:** Click the **Edit** (pencil) icon on an existing tier card. Update the values and save.
4.  **To Delete:** Click the **Delete** (trash) icon. Confirm the action.

## Best Practices

*   Ensure the **Stripe Price ID** exactly matches the one in your Stripe account.
*   Test new tiers with a small group or in a test environment before promoting them.
*   Avoid deleting tiers that have active subscribers; instead, mark them as "Archived" in Stripe or hide them from the UI if supported.
