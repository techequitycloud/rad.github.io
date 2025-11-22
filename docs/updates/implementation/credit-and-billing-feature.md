# Credits & Billing System: Technical Documentation

This document provides a comprehensive technical overview of the Credits and Billing Management System. It is intended for engineers and technical staff responsible for maintaining and extending the platform.

## 1. Subscription Tiers

The Subscription Tiers feature allows administrators to create, manage, and delete different subscription levels that users can purchase to acquire credits. This feature is the primary mechanism for monetizing the platform through one-time purchases.

### 1.1. Implementation Details

- **Frontend Component**: `rad-ui/webapp/src/components/SubscriptionTierManagement.tsx`
  - This component provides the UI for administrators to view, add, edit, and delete subscription tiers.
  - It uses `@tanstack/react-query` for managing server state, including optimistic updates when editing a tier to provide a responsive user experience.
- **Backend API Endpoint**: `/api/subscriptions/tiers` and `/api/subscriptions/tiers/[id]`
  - These endpoints handle the business logic for creating, retrieving, updating, and deleting subscription tiers in the `subscription_tiers` Firestore collection.

### 1.2. Purpose and Trigger

- **Purpose**: To define the available credit packages for purchase.
- **Trigger**: An administrator navigates to the "Credits" -> "Subscription Tiers" tab and interacts with the UI (e.g., clicks "Add New Tier", "Edit", or "Delete").

### 1.3. Input and Output

- **Input**:
  - **Name**: The display name of the tier (e.g., "Starter Pack").
  - **Description**: A brief description of the tier.
  - **Price**: The cost of the tier in the configured currency.
  - **Price ID**: The corresponding Stripe Price ID for the tier.
  - **Credits**: The number of "purchased" credits the user receives upon buying the tier.
  - **Features**: A list of text-based features associated with the tier, displayed to the user.
- **Output**:
  - A new or updated subscription tier document in the `subscription_tiers` Firestore collection.
  - A success or failure notification in the UI.

### 1.4. Successful Execution vs. Failure

- **Success**: The tier is successfully created, updated, or deleted in Firestore. The UI is updated to reflect the change, and a success notification is displayed.
- **Failure**: An error occurs during the API call (e.g., invalid data, permission denied). The operation is rolled back (in the case of an optimistic update), and an error notification is shown to the user.

## 2. Credit Settings

The "Credit Settings" tab provides administrators with a suite of tools to configure the economic model of the platform. These settings are stored in the `settings` collection in Firestore.

### 2.1. Implementation Details

- **Frontend Component**: `rad-ui/webapp/src/components/AdminCreditForms.tsx`
  - This component acts as a container for several smaller, more focused form components.
- **Backend API Endpoint**: `/api/settings`
  - This is a general-purpose endpoint for updating application settings. Each form sends a `POST` request with the specific setting to be updated.

### 2.2. Forms and Features

#### 2.2.1. Signup Credits
- **Purpose**: To automatically grant a specified number of "awarded" credits to new users upon their first sign-in.
- **Component**: `SignupCreditForm.tsx`
- **Settings**:
  - `signupCreditAmount`: The number of credits to award.
  - `monthlySignUpCredit`: If true, the `signupCreditAmount` is awarded to all users on a monthly basis.

#### 2.2.2. Adjust All User Credits
- **Purpose**: To manually add or remove a specific number of "awarded" credits for all users simultaneously.
- **Component**: `CreditAdjustmentForm.tsx`
- **Interaction**:
  - **Input**: A positive or negative integer representing the number of credits to add or remove.
  - **Endpoint**: `POST /api/credit/adjust`
  - **Logic**: The API iterates through all users, updates their `creditAwards` balance, and creates a `credit_transactions` document for each user to log the adjustment.

#### 2.2.3. Referral Credits
- **Purpose**: To award credits to a user (the referrer) when a new user signs up using their referral code.
- **Component**: `ReferralCreditForm.tsx`
- **Setting**: `referralCreditAmount`: The number of "awarded" credits to grant to the referrer.

#### 2.2.4. Low Credit Notification
- **Purpose**: To configure the threshold for the automated low credit email notification.
- **Component**: `LowCreditForm.tsx`
- **Setting**: `lowCreditTriggerAmount`: When a user's total credit balance falls below this amount, the `low_credit` Cloud Function is triggered to send them a notification email.

#### 2.2.5. Price Per Unit
- **Purpose**: To establish the conversion rate between currency and credits.
- **Component**: `PricePerCreditForm.tsx`
- **Setting**: `creditsPerUnit`: The number of credits that are equivalent to one unit of the configured currency (e.g., 100 credits per USD). This is a fundamental value used in revenue and cost calculations.

#### 2.2.6. Refresh Interval
- **Purpose**: To set the interval for the `creditProject` Cloud Function, which periodically debits credits from users for their running projects.
- **Component**: `RefreshIntervalForm.tsx`
- **Setting**: `refreshInterval`: The interval in hours (e.g., 24 for daily).

#### 2.2.7. Revenue Share
- **Purpose**: To set the revenue share percentage for partners/agents.
- **Component**: `RevenueShareForm.tsx`
- **Setting**: `revenueShare` (as a percentage).

## 3. User Credits

This tab provides a direct way for administrators to view and manage the credit balances of individual users. It is essential for customer support and manual adjustments. If the `enableCredits` setting is disabled, this tab is renamed to "User Roles" and only displays user emails.

### 3.1. Implementation Details

- **Frontend Component**: `rad-ui/webapp/src/routes/Billing.tsx`
  - The "User Credits" tab is implemented directly within the `Billing.tsx` component.
  - It displays a table of all users. The table is equipped with a search bar to filter users by email and is paginated to handle large user bases efficiently.
  - The columns are conditionally rendered:
    - **Email**: Always visible.
    - **Awards**: Visible only if `enableCredits` is true.
    - **Purchases**: Visible only if `enableSubscription` is true.
    - **Actions**: Always visible for administrators.
- **Backend API Endpoint**: `PUT /api/users/[userId]`
  - This endpoint is used to update a specific user's document in Firestore when an admin saves changes.

### 3.2. Purpose and Trigger

- **Purpose**: To allow for granular control over individual user credit balances and roles.
- **Trigger**: An administrator uses the search bar to find a user, clicks the "Edit" button for that user in the table, modifies their credit values, and clicks "Save".

### 3.3. Input and Output

- **Input**:
  - `creditAwards`: The new value for the user's awarded credits.
  - `creditPurchases`: The new value for the user's purchased credits.
- **Output**:
  - An updated user document in the `users` Firestore collection.
  - The UI reflects the saved changes, and the table exits "edit" mode for that user.

## 4. Project Costs

The "Project Costs" tab is a reporting tool that provides a detailed breakdown of the actual costs incurred by projects, based on the underlying cloud provider's billing data.

### 4.1. Implementation Details

- **Frontend Component**: `rad-ui/webapp/src/components/ProjectCosts.tsx`
- **Backend API Endpoint**: `GET /api/costs`
- **Data Source**: A BigQuery table containing the GCP billing export.

### 4.2. Purpose and Trigger

- **Purpose**: To provide visibility into the actual cloud spend for each deployed project.
- **Trigger**: A user selects a date range, optionally filters by module, and clicks "Fetch Project Cost".

### 4.3. Input and Output

- **Input**:
  - **Module**: (Optional) The name of the module to filter by.
  - **Start Date**: The beginning of the reporting period.
  - **End Date**: The end of the reporting period.
- **Output**: A paginated list of projects with the following information:
  - **Module Name**: The name of the deployed module.
  - **Project ID**: The unique identifier of the GCP project.
  - **Created At**: The creation date of the deployment.
  - **Total Cost**: The total cost of the project in the configured currency, as reported by BigQuery.
  - **Credit Debit**: The equivalent cost in credits, calculated as `Total Cost * creditsPerUnit`.

### 4.4. How Costs are Computed

1. The frontend sends the date range and optional module filter to the `/api/costs` endpoint.
2. The backend queries the BigQuery billing table to get the total cost for each `projectId` within the specified date range.
3. The results are joined with data from the `deployments` collection in Firestore to associate each `projectId` with its corresponding module name and creation date.
4. The frontend displays the results and calculates the "Credit Debit" for presentational purposes.

## 5. Module Revenue

The "Module Revenue" tab provides a report of the "true revenue" generated by each module. True revenue is defined as the value of deployments paid for with "purchased" credits, excluding any portion paid for with "awarded" credits.

*Note: While the UI tab is named "Module Revenue," the underlying React component is named `ProjectRevenue.tsx`.*

### 5.1. Implementation Details

- **Frontend Component**: `rad-ui/webapp/src/components/ProjectRevenue.tsx`
- **Backend API Endpoint**: `GET /api/revenue`

### 5.2. Purpose and Trigger

- **Purpose**: To understand the profitability of each module.
- **Trigger**: A user selects a date range, optionally filters by a specific module, and clicks "Fetch Module Revenue".

### 5.3. Input and Output

- **Input**:
  - **Module**: (Optional) The name of the module to filter by.
  - **Start Date**: The beginning of the reporting period.
  - **End Date**: The end of the reporting period.
- **Output**: A paginated list of deployments with the following information:
  - **Module Name**: The name of the deployed module.
  - **Created At**: The creation date of the deployment.
  - **Credit Cost**: The cost of the deployment in credits that contributed to revenue.
  - **Revenue**: The calculated "true revenue" in the configured currency.

### 5.4. How "True Revenue" is Computed

The core logic resides in the `/api/revenue` endpoint and follows a multi-step process:

1.  **Determine User Scope**: The API first determines the target user population based on the requester's role and query parameters.
2.  **(Optional) BigQuery Scope Filtering**: If configured, the API queries a BigQuery billing table to get a list of all project IDs that are within the administrator's defined scope (e.g., folder or organization). Deployments associated with out-of-scope projects are filtered out before revenue is calculated.
3.  **Fetch Data**: The API fetches all deployments for the target users within the specified date range, along with all their credit transactions.
4.  **Calculate Total Free Credits**: For each user, the API calculates the total sum of their "awarded" credits by looking at all transactions *not* of type "PURCHASE".
5.  **Process Deployments Chronologically**: The API processes each user's deployments in chronological order.
6.  **Apply Free Credits**: It maintains a running total of `spentFreeCredits`. For each deployment, it "spends" the user's free credits first.
7.  **Calculate Revenue**: If a deployment's cost exceeds the remaining free credits, the portion of the cost paid for with the overflow is considered revenue. This is calculated as `(creditCost - freeCreditsApplied) / creditsPerUnit`.
8.  **Return Data**: The API returns a list of **all** processed deployments. The frontend (`ProjectRevenue.tsx`) is responsible for filtering this list to display only the deployments that generated revenue (i.e., where `revenue > 0`).

### 5.5. Role-Specific Logic

#### 5.5.1. Agent Logic
- **Revenue Share**: When an agent requests revenue data, the final revenue value for each deployment is multiplied by a `revenueShare` percentage (configured in Admin settings). This calculates the agent's commission.
- **Dynamic Module Filtering**: The API response for an agent includes a unique `modules` array. This array contains a list of only those modules for which the agent's referred users have generated revenue, providing a dynamically scoped filter dropdown in the UI.

#### 5.5.2. Admin Logic
- **Filtering by Agent**: In addition to filtering by user emails, administrators can filter the revenue report by one or more `agentEmails`. This allows them to see the revenue generated by all users referred by specific agents.

## 6. User Revenue

The "User Revenue" tab provides a report of the "true revenue" generated by specific users. This is particularly important for the "Agent" role, as it forms the basis for commission calculations.

### 6.1. Implementation Details

- **Frontend Component**: `rad-ui/webapp/src/components/UserRevenue.tsx`
- **Backend API Endpoint**: `GET /api/revenue`

### 6.2. Purpose and Trigger

- **Purpose**: To analyze the revenue generated by individual users or groups of users. For agents, this report is scoped to their referred users.
- **Trigger**: A user selects a date range, filters by user emails (if applicable), and clicks "Fetch User Revenue".

### 6.3. Role-Based Access Control

- **Admins**: Can view revenue data for any user by providing a comma-separated list of emails. They can also filter by `agentEmails` to see revenue from users referred by specific agents. If no filters are provided, they see revenue data for all users.
- **Agents**: Can only view revenue data for users who have their email in the `referredBy` field. The UI provides a multi-select dropdown of their referred users, and the backend API enforces this scoping.

### 6.4. Input and Output

- **Input**:
  - **User Emails**: (Optional) A comma-separated list of user emails to filter by.
  - **Agent Emails**: (Optional, Admin-only) A comma-separated list of agent emails to filter by.
  - **Start Date**: The beginning of the reporting period.
  - **End Date**: The end of the reporting period.
- **Output**: A paginated list of deployments with the same structure as the "Module Revenue" report, but with the addition of the `userEmail` field.

### 6.5. How Revenue is Computed

This feature uses the **exact same `/api/revenue` endpoint and "true revenue" calculation logic** as the "Module Revenue" feature. The only difference is that the API first determines the target user population based on the user's role and the `userEmails` query parameter before performing the calculation.

## 7. Project Revenue

The "Project Revenue" tab is an alias for the "Module Revenue" feature. It was likely named differently in the UI for business reasons, but it is technically identical.

- **Component**: `rad-ui/webapp/src/components/ProjectRevenue.tsx`
- **Endpoint**: `GET /api/revenue`
- **Functionality**: This tab renders the same component and uses the same backend logic as the "Module Revenue" tab. Please refer to Section 5 for a detailed explanation of its implementation and revenue calculation.

## 8. User Credit Transactions

This feature provides end-users (non-administrators) with a detailed view of their credit transaction history, allowing them to track their credit usage over time.

### 8.1. Implementation Details

-   **Frontend Component**: `rad-ui/webapp/src/components/CreditHistoryTable.tsx`
    -   This component is rendered within the "Credit Transactions" tab in `rad-ui/webapp/src/routes/Billing.tsx` for non-admin users.
    -   It displays a paginated table of the user's personal credit history.
-   **Hook**: `rad-ui/webapp/src/hooks/useCreditHistory.ts`
    -   This custom hook is responsible for fetching the paginated transaction data from the backend.
-   **Backend API Endpoint**: `GET /api/credit/history`
    -   This endpoint retrieves the credit transaction history for the authenticated user, supporting pagination and filtering.

### 8.2. Purpose and Trigger

-   **Purpose**: To provide transparency to users about how their credits are awarded, purchased, and spent.
-   **Trigger**: A non-admin user navigates to the "Credits" -> "Credit Transactions" tab.

### 8.3. Features and Functionality

The "Credit Transactions" view includes several user-friendly features:

-   **Search**: Users can filter their transaction history by a specific **Deployment ID**.
-   **Date Filter**: Users can select a specific date to view all transactions that occurred on that day.
-   **CSV Export**: A button allows users to download their entire filtered transaction history as a CSV file for personal record-keeping or analysis.
-   **Pagination**: The table is paginated to ensure performance even with a long transaction history.

### 8.4. Data Displayed

The table displays the following columns for each transaction:

-   **Date**: The timestamp of the transaction.
-   **Awards**: The number of awarded credits added or spent.
-   **Purchases**: The number of purchased credits added or spent (this column is only visible if `enableSubscription` is true).
-   **Deployment ID**: If the transaction is related to a deployment, this column contains a clickable link to the deployment's detail page.
-   **Deployments / Projects**: The amount of credits spent on deployments or projects.
-   **Balance**: The user's new total credit balance after the transaction.

## 9. Automated Credit Management System

The system is architected as a set of three independent, event-driven Google Cloud Functions. This decoupled design ensures that different stages of the credit lifecycle (initial purchase, recurring billing, and user notifications) are handled by specialized services, improving reliability and maintainability.

### 9.1. Core Architectural Principles:
- **Asynchronous Operations**: All credit-related tasks are performed asynchronously in the background, ensuring that user-facing operations (like module deployment) are not blocked.
- **Event-Driven**: Functions are triggered by specific events (Pub/Sub messages from Cloud Build, scheduled triggers from Cloud Scheduler) rather than direct API calls from the frontend.
- **Firestore as Source of Truth**: All state, including user balances, settings, and transaction history, is maintained in Firestore.
- **Safety First**: The system is designed with a critical safety mechanism to prevent runaway costs by automatically disabling a user's GCP billing if their credit balance is insufficient.

### 9.2. System Components:
1.  **`notification_status` Function**: Handles deployment status updates and performs the initial, one-time credit deduction for new deployments.
2.  **`project_credits` Function**: The recurring billing engine. It calculates and deducts credits for actual GCP resource consumption.
3.  **`low_credit` Function**: A proactive monitoring function that notifies users of low credit balances.

---

## 10. Function Deep Dive: `notification_status`

-   **File Location**: `rad-ui/automation/terraform/infrastructure/function/notification_status/index.js`
-   **Purpose**: To act as the central processor for all deployment status changes and to handle the critical, one-time credit charge upon successful module creation.
-   **Trigger**: **Pub/Sub Topic**. This function subscribes to a topic that receives status update messages directly from Google Cloud Build. Every change in a build's lifecycle (e.g., QUEUED, WORKING, SUCCESS, FAILURE) triggers this function.

### 10.1. Execution Flow & Logic:
1.  **Message Parsing**: The function receives a base64-encoded Pub/Sub message, which it parses to extract the JSON payload from Cloud Build. This payload contains the build ID, status, and substitution variables (like `_DEPLOYMENT_ID`).
2.  **Deployment Lookup**: It queries the `deployments` collection in Firestore to find the document corresponding to the build.
3.  **Status Update**: It maps the Cloud Build status to the application's internal status representation (e.g., "WORKING", "SUCCESS") and updates the Firestore document.
4.  **Email Notification**: Based on the new status (e.g., SUCCESS, FAILURE), it uses **Nodemailer** to send a templated email notification to the user.
5.  **Credit Deduction Logic**:
    -   **Condition**: The credit deduction logic is **only triggered if `action` is "CREATE" and `appStatus` is "SUCCESS"**. This is a critical check to ensure credits are only deducted once for the initial, successful deployment, not for subsequent updates or failed attempts.
    -   **Process**: It initiates a Firestore transaction to ensure atomicity.
    -   It reads the `creditCost` from the build record or falls back to the module's definition in the `modules` collection.
    -   It fetches the user's document and deducts the credits, prioritizing `creditAwards` before `creditPurchases` unless the module requires purchased credits.
    -   It creates a new document in the `credit_transactions` collection, logging the spend.
    -   It atomically increments the `deploymentCount` on the user's document.
    -   It sets a `creditsDeducted: true` flag on the deployment document to prevent any possibility of a double charge.

---

## 11. Function Deep Dive: `project_credits`

-   **File Location**: `rad-ui/automation/terraform/infrastructure/function/project_credits/index.js`
-   **Purpose**: To serve as the platform's recurring billing engine, ensuring users are charged for their actual cloud resource consumption.
-   **Trigger**: **Cloud Scheduler**. The function is invoked on a regular, configurable schedule (e.g., daily). The schedule's frequency is controlled by the `refreshInterval` setting in the `settings` collection.

### 11.1. Execution Flow & Logic:
1.  **Configuration Fetch**: Retrieves `refreshInterval`, `creditsPerUnit` (the USD-to-credit conversion rate), and the `lastDebitTimestamp` from Firestore. It exits if not configured.
2.  **Timing Check**: Ensures the time elapsed since the last run is greater than the `refreshInterval` before proceeding.
3.  **User Processing Loop**: Fetches all users and iterates through them.
4.  **Cost Calculation (per user)**:
    -   Identifies all GCP `projectId`s associated with the user.
    -   Executes a **BigQuery query** against the configured billing export table. The query sums the total cost incurred by the user's projects since their personal `lastDebitTimestamp`.
5.  **Billing and Credit Management**:
    -   The calculated USD cost is converted to platform credits.
    -   **Insufficient Funds**: If the user's `creditBalance` is less than the required credits, the function invokes the **Cloud Billing API** to programmatically disable billing for all of the user's projects. This is the system's primary cost-control safety mechanism.
    -   **Sufficient Funds**:
        -   The function first checks if any of the user's projects have billing disabled and re-enables it if necessary.
        -   It deducts the credits from the user's balance, updates their `lastDebitTimestamp`, and creates a `credit_transactions` record.
6.  **Global Timestamp Update**: After processing all users, it updates the global `lastDebitTimestamp` in the `settings` collection.

-   **Purpose**: Proactively notifies users when their credit balance falls below the `lowCreditTriggerAmount`.
-   **Trigger**: Cloud Scheduler (typically daily).
-   **Key Logic**: Checks user balance against the threshold and sends a throttled email notification.

### 3.4. `creditPartner` Function

-   **Purpose**: To automatically grant the monthly "Partner Credit" allowance to eligible users.
-   **Trigger**: Cloud Scheduler (runs at the beginning of each month).
-   **Key Logic**: The function iterates through all users. If a user has a `creditPartner` allowance greater than zero, the function adds that amount to the user's `creditPurchases` balance and creates a "PARTNER" type transaction in the credit history.
