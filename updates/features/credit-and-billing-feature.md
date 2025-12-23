# Automated Credit Management System

The system is architected as a set of independent, event-driven Google Cloud Functions. This decoupled design ensures that different stages of the credit lifecycle (initial purchase, recurring billing, and user notifications) are handled by specialized services, improving reliability and maintainability.

### 1. Core Architectural Principles:
- **Asynchronous Operations**: All credit-related tasks are performed asynchronously in the background, ensuring that user-facing operations (like module deployment) are not blocked.
- **Event-Driven**: Functions are triggered by specific events (Pub/Sub messages from Cloud Build, scheduled triggers from Cloud Scheduler) rather than direct API calls from the frontend.
- **Firestore as Source of Truth**: All state, including user balances, settings, and transaction history, is maintained in Firestore.
- **Safety First**: The system is designed with a critical safety mechanism to prevent runaway costs by automatically disabling a user's GCP billing if their credit balance is insufficient.

### 2. System Components:
1.  **`notification_status` Function**: Handles deployment status updates and performs the initial, one-time credit deduction for new deployments.
2.  **`project_credits` Function**: The recurring billing engine. It calculates and deducts credits for actual GCP resource consumption.
3.  **`low_credit` Function**: A proactive monitoring function that notifies users of low credit balances.
4.  **`creditPartner` Function**: Automatically awards monthly partner credits.

---

## 3. Function Deep Dive: `notification_status`

-   **File Location**: `rad-ui/automation/terraform/infrastructure/function/notification_status/index.js`
-   **Purpose**: To act as the central processor for all deployment status changes and to handle the critical, one-time credit charge upon successful module creation.
-   **Trigger**: **Pub/Sub Topic**. This function subscribes to a topic that receives status update messages directly from Google Cloud Build. Every change in a build's lifecycle (e.g., QUEUED, WORKING, SUCCESS, FAILURE) triggers this function.

### 3.1. Execution Flow & Logic:
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

## 4. Function Deep Dive: `project_credits`

-   **File Location**: `rad-ui/automation/terraform/infrastructure/function/credit_project/index.js`
-   **Purpose**: To serve as the platform's recurring billing engine, ensuring users are charged for their actual cloud resource consumption.
-   **Trigger**: **Cloud Scheduler**. The function is invoked on a regular, configurable schedule (e.g., daily). The schedule's frequency is controlled by the `refreshInterval` setting in the `settings` collection.

### 4.1. Execution Flow & Logic:
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

---

## 5. Function Deep Dive: `low_credit`

-   **File Location**: `rad-ui/automation/terraform/infrastructure/function/credit_low/index.js`
-   **Purpose**: Proactively notifies users when their credit balance falls below the `lowCreditTriggerAmount`.
-   **Trigger**: Cloud Scheduler (typically daily).
-   **Key Logic**: Checks user balance against the threshold and sends a throttled email notification.

---

## 6. Function Deep Dive: `creditPartner`

-   **File Location**: `rad-ui/automation/terraform/infrastructure/function/credit_partner/index.js`
-   **Purpose**: To automatically grant the monthly "Partner Credit" allowance to eligible users.
-   **Trigger**: Cloud Scheduler (runs at the beginning of each month).
-   **Key Logic**: The function iterates through all users. If a user has a `creditPartner` allowance greater than zero, the function adds that amount to the user's `creditPurchases` balance and creates a "PARTNER" type transaction in the credit history.
