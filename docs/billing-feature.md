# Billing Feature Implementation Guide

This document outlines the implementation of the billing feature in the RAD platform. The billing system is designed to handle credit management, subscription tiers, project costs, and revenue reporting for different user roles (Admin, Partner, Agent, User).

## Overview

The billing feature is implemented across the frontend (React/Next.js) and backend (Next.js API Routes, Cloud Functions, Firestore, BigQuery). It supports:
- **User Credits**: Awarded and Purchased credit balances.
- **Subscription Tiers**: Configurable tiers for purchasing credits via Stripe.
- **Project Costs**: Tracking actual GCP costs via BigQuery.
- **Revenue Reporting**: Calculating "true revenue" for modules and users.
- **Automated Billing**: Cloud Functions for credit deduction and low-balance notifications.

## 1. Frontend Implementation

### 1.1. Routes & Pages

- **Admin/Finance View (`src/routes/Billing.tsx`)**:
  - The main entry point for Admins and Finance users.
  - Renders a tabbed interface using `Headless UI` tabs.
  - Tabs include:
    - **Subscription Tiers**: Manages subscription plans (`SubscriptionTierManagement.tsx`).
    - **Project Costs**: Reports GCP costs (`ProjectCosts.tsx`).
    - **Project Revenue**: Reports module revenue (`ProjectRevenue.tsx`).
    - **User Revenue**: Reports user-generated revenue (`UserRevenue.tsx`).
    - **Agent Revenue**: Specific view for agent commissions (`UserRevenue.tsx`).
    - **Monthly Invoice**: Aggregated monthly billing data (`MonthlyInvoiceTab.tsx`).
    - **Credit Settings**: Global credit configuration (`AdminCreditForms.tsx`).
    - **User Credits**: User management table for manual adjustments.

- **User View (`src/routes/Credits.tsx`)**:
  - The billing page for standard users, partners, and agents.
  - Tabs include:
    - **Credit Transactions**: History of credit usage (`CreditHistoryTable.tsx`).
    - **Project Costs**: Costs for their own projects (`ProjectCosts.tsx`).
    - **Monthly Invoice**: Their own invoices (`MonthlyInvoiceTab.tsx`).
    - **Buy Credits**: Form to purchase credits via Stripe (`BuyCreditsForm.tsx` / `UserSubscriptionTiers.tsx`).
    - **User/Module Revenue**: Visible to Agents for tracking their commissions (`UserRevenue.tsx` / `ProjectRevenue.tsx`).

### 1.2. Key Components

- **`SubscriptionTierManagement.tsx`**:
  - Allows admins to Create, Read, Update, Delete (CRUD) subscription tiers.
  - Uses `react-query` for state management and optimistic updates.
  - Fields: Name, Description, Price, Stripe Price ID, Credits, Features.

- **`UserSubscriptionTiers.tsx`**:
  - Displays available tiers to users.
  - Handles Stripe Checkout integration.
  - Shows "Popular" badge and features list.

- **`ProjectCosts.tsx`**:
  - Fetches cost data from `/api/costs`.
  - Filters by date range and module.
  - Displays costs in both currency (USD) and Credits.

- **`ProjectRevenue.tsx` & `UserRevenue.tsx`**:
  - Fetches revenue data from `/api/revenue`.
  - Calculates "True Revenue": `(Credit Cost - Free Credits Used) / Exchange Rate`.
  - Supports filtering by Agent for commission tracking.

- **`AdminCreditForms.tsx`**:
  - Collection of forms for global settings:
    - Signup Credits
    - Referral Credits
    - Low Credit Threshold
    - Price Per Credit Unit
    - Refresh Interval (for billing job)
    - Revenue Share %

## 2. Backend Implementation

### 2.1. API Routes

- **`/api/billing`**:
  - BFF (Backend-for-Frontend) endpoint.
  - Aggregates data for the `Billing.tsx` page to reduce round-trips.
  - Fetches settings, tiers, and user data in parallel.

- **`/api/revenue`**:
  - Complex endpoint for revenue calculation.
  - Logic:
    1. Fetches deployments and credit transactions for target users.
    2. Calculates "Free Credit" balance for each user.
    3. Iterates deployments chronologically.
    4. Deducts free credits first.
    5. Remaining cost is considered "True Revenue".
  - Scopes data based on role (Admin vs Agent).

- **`/api/costs`**:
  - Queries BigQuery for GCP billing data.
  - Groups by `projectId` and joins with Firestore `deployments` to map to Module Names.

- **`/api/subscriptions/tiers`**:
  - CRUD endpoints for `subscription_tiers` collection.

- **`/api/credit/adjust`**:
  - Bulk adjustment of user credits by Admin.
  - Batches updates to Firestore.

- **`/api/stripe/webhook`**:
  - Listens for Stripe events (`checkout.session.completed`, `customer.subscription.deleted`).
  - Updates user roles (adds/removes 'Partner' role) and credit balances.

### 2.2. Cloud Functions (Automation)

- **`notification_status`**:
  - Trigger: Pub/Sub from Cloud Build.
  - Action: Updates deployment status.
  - **Billing Action**: On `CREATE` + `SUCCESS`, deducts one-time credit cost from user.

- **`project_credits` (Scheduled)**:
  - Trigger: Cloud Scheduler (configurable interval).
  - Action:
    1. Queries BigQuery for recent costs.
    2. Deducts credits from user balance.
    3. **Safety**: Disables GCP Billing for the project if user runs out of credits.

- **`low_credit` (Scheduled)**:
  - Trigger: Daily.
  - Action: Checks user balances against `lowCreditTriggerAmount` and sends email alerts.

## 3. Data Models

### 3.1. User Object (Firestore `users` collection)
```typescript
interface User {
  uid: string;
  email: string;
  creditAwards: number;    // Free/System granted credits
  creditPurchases: number; // Paid credits (Stripe)
  isPartner: boolean;      // Toggled by Subscription
  stripeCustomerId?: string;
  // ... other fields
}
```

### 3.2. Subscription Tier (Firestore `subscription_tiers` collection)
```typescript
interface SubscriptionTier {
  id: string;
  name: string;
  description: string;
  price: number;
  priceId: string; // Stripe Price ID
  credits: number; // Credits to award
  features: string[];
  popular?: boolean;
}
```

## 4. Role-Based Logic

| Feature | Admin | Finance | Partner | Agent | User |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Manage Tiers** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **View Global Revenue** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **View Own Revenue** | N/A | N/A | ✅ | ✅ | ❌ |
| **Global Credit Settings** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Adjust User Credits** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Buy Credits** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **View Own Costs** | ✅ | ✅ | ✅ | ✅ | ✅ |

## 5. Deployment & Configuration

- **Environment Variables**:
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: Stripe public key.
  - `STRIPE_SECRET_KEY`: Stripe secret key.
  - `STRIPE_WEBHOOK_SECRET`: For validating webhook signatures.
  - `NEXT_PUBLIC_ENABLE_CREDITS`: Feature flag to enable/disable credit system.
  - `NEXT_PUBLIC_ENABLE_SUBSCRIPTION`: Feature flag for subscriptions.

- **BigQuery Setup**:
  - Requires a BigQuery dataset exporting GCP billing data.
  - Configured via `settings` document in Firestore.

This architecture ensures a separation of concerns, with the frontend handling presentation and user interaction, the API layer handling business logic and data aggregation, and background functions ensuring reliable billing and credit enforcement.
