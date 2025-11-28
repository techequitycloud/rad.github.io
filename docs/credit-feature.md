# Platform Credit System Documentation

## Overview

The Platform Credit System provides a flexible mechanism for managing usage quotas and monetization. It allows users to acquire credits through various channels (sign-up bonuses, referrals, purchases) and consume them to deploy modules. The system is designed with separate buckets for "awarded" (free) and "purchased" (paid) credits to support distinct business rules, such as modules that require paid credits.

## Credit Architecture

The system distinguishes between two types of credits, stored in the user's profile:

1.  **Awarded Credits (`creditAwards`):**
    *   **Source:** Sign-up bonuses, referral rewards, manual admin grants.
    *   **Purpose:** Allow users to explore the platform and try modules without immediate payment.
    *   **Priority:** Consumed *first* by default during deployments.

2.  **Purchased Credits (`creditPurchases`):**
    *   **Source:** One-time Stripe purchases, monthly subscriptions.
    *   **Purpose:** Paid usage for premium features or extended quotas.
    *   **Priority:** Consumed *second* generally, but *exclusively* required for modules with the `require_credit_purchases` flag.

**Total Balance:** A user's effective balance is the sum of `creditAwards` and `creditPurchases`.

## Credit Acquisition

### 1. User Provisioning (Sign-Up)
New users are automatically provisioned with credits based on platform settings.
*   **Trigger:** User creation via `/api/users`.
*   **Configuration:** `settings.variables.signupCreditAmount`.
*   **Logic:** If configured, the `creditAwards` balance is initialized with this amount.

### 2. Referral Program
Users can earn credits by referring others.
*   **Mechanism:** Users share a unique referral link (`/?ref=CODE`).
*   **Reward:** Both the referrer and the new user can receive credits (configurable).
*   **Limits:** Configurable `maximumReferrals` cap per user to prevent abuse.
*   **Tracking:** Referrals are tracked in `referral_analytics` and the user profile (`monthlyReferralCount`).

### 3. Stripe Integration (Purchases)
*   **One-Time Purchases:** Users can buy credit packs. Credits are added to `creditPurchases`.
*   **Subscriptions:** Users can subscribe to tiers (e.g., Pro, Enterprise). Credits associated with the tier are added to `creditPurchases` upon successful payment (`invoice.paid` or `checkout.session.completed`).

### 4. Admin Adjustments
Admins and Finance users can manually adjust balances.
*   **Bulk:** Add/remove credits for *all* users (e.g., platform-wide apology gift).
*   **Individual:** Correct specific user balances.
*   **Audit:** All adjustments are logged in `credit_transactions`.

## Credit Consumption (Deployments)

When a user deploys a module, the system enforces credit costs.

### 1. Cost Determination
*   **Module Cost:** Defined in the module's variables as `credit_cost`.
*   **Exemptions:** Partners deploying their *own* modules are not charged (free deployment for testing).

### 2. Pre-Deployment Check
Before a deployment starts, the API (`POST /api/deployments`) verifies funds:
*   **Standard Modules:** Checks if `(creditAwards + creditPurchases) >= cost`.
*   **Premium Modules:** If `require_credit_purchases` is true, checks if `creditPurchases >= cost`.
*   **Failure:** Returns `402 Payment Required` if insufficient funds.

### 3. Deduction Logic
Credits are deducted *after* a successful deployment via the backend system (Cloud Functions).
*   **Order of Operations:**
    1.  Deduct from `creditAwards` first.
    2.  If `creditAwards` are exhausted, deduct the remainder from `creditPurchases`.
    *   *Exception:* If `require_credit_purchases` is enabled, deduct entirely from `creditPurchases`.

## Transaction Logging

Every change to a user's credit balance is recorded in the `credit_transactions` Firestore collection.

**Transaction Types:**
*   `AWARD`: Free credits granted (Admin, Referral).
*   `PURCHASE`: Paid credits added (Stripe).
*   `SIGNUP`: Initial sign-up bonus.
*   `SPEND`: Credits consumed by a deployment.

**Transaction Categories:**
*   `DEPLOYMENT`: Cost related to a module deployment.
*   `PROJECT`: Ongoing project costs (if applicable).
*   `PURCHASE`: Buying credits.

## Admin Management

### Bulk Adjustments
*   **Endpoint:** `POST /api/credits/adjust`
*   **Capability:** Increment `creditBalance` for all users in the system.
*   **Use Case:** Compensating users for downtime or running promotions.
*   **Performance:** Uses Firestore `BulkWriter` for efficient large-scale updates.

### Reporting
*   **Endpoint:** `GET /api/credits/history`
*   **Features:** Pagination, date filtering, and search by `deploymentId`.
*   **Access:** Users see their own history; Admins/Support can view any user's history.

## Technical Implementation

### Key Data Models (`types.ts`)
*   **User:** `creditAwards`, `creditPurchases`, `referralCode`.
*   **Transaction:** `type`, `category`, `amount`, `balance`, `deploymentId`.
*   **Settings:** `enable_credits`, `signupCreditAmount`, `referralCreditAmount`.

### Key Files
*   **API Routes:**
    *   `src/pages/api/credits/history.ts`: Fetch transaction history.
    *   `src/pages/api/credits/adjust.ts`: Admin bulk credit tool.
    *   `src/pages/api/users/index.ts`: User provisioning and sign-up credits.
    *   `src/pages/api/stripe/webhook.ts`: Payment processing.
    *   `src/pages/api/deployments/index.ts`: Credit verification before deployment.
*   **Utilities:**
    *   `src/utils/user-provisioning.ts`: Logic for sign-up bonuses and referrals.
    *   `src/store/user.ts`: Frontend state management for real-time balance updates.
