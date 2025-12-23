# Settings Configuration and Management

This document provides a technical deep-dive into the implementation of the global settings configuration feature, accessible via the "Setup" navigation link in the web application (often referred to as the "Setup Menu"). It is intended for technical professionals responsible for maintaining and extending the system.

## 1. Overview

The settings configuration feature provides a centralized interface for administrators to manage the platform's core operational parameters. It is implemented as a multi-step form that guides the administrator through various configuration sections. The system is designed to be robust, secure, and developer-friendly, separating general configuration from sensitive data.

- **Purpose**: To provide a user-friendly interface for administrators to configure the platform's behavior without needing to modify code or infrastructure directly.
- **Trigger**: The feature is triggered by an administrator navigating to the "Setup" page (`/setup`). The form is pre-populated with existing settings from the database. The final submission is triggered when the admin clicks the "Submit" button on the last step of the form.
- **Interactions**:
    - **Frontend**: The UI is built with React, using Formik for state management and Yup for validation.
    - **Backend**: It interacts with two primary backend services:
        - A Firestore database for storing general application settings.
        - Google Cloud Secret Manager for securely storing sensitive data (e.g., mail server passwords).
- **Input**: The administrator's configuration choices entered into the form fields.
- **Output**:
    - **Successful Execution**:
        1. General settings are saved to a "settings" document in Firestore.
        2. Sensitive data is saved as a new version of a secret in Google Cloud Secret Manager.
        3. The application's in-memory cache for settings is cleared.
        4. A Pub/Sub message is published to the `admin-notification` topic to notify other services of the configuration change.
        5. A success notification is displayed to the administrator in the UI.
    - **Failure**:
        1. If saving to Firestore or Secret Manager fails, the operation is halted.
        2. An error message is displayed to the administrator in the UI.
        3. The system state remains unchanged (no partial updates are performed).

## 2. Frontend Implementation

The frontend is composed of three main React components that work together to render the settings form.

- **`Setup.tsx` (`/src/routes/Setup.tsx`)**: This is the entry point and container component for the settings page. Its primary responsibilities are:
    - Fetching the current application settings and secret status using the `useSettings` and `useSecret` hooks.
    - Providing the top-level layout and navigation (e.g., the "Back" button).
    - Rendering the `DefaultCreateForm` component and passing the fetched data, the `DEFAULT_ADMIN_VARS_JSON` schema, and necessary callback functions to it.

- **`DefaultCreateForm.tsx` (`/src/components/forms/DefaultCreateForm.tsx`)**: This component orchestrates the form logic.
    - It uses the `FormikStepper` component to create a multi-step form experience.
    - It groups the variables defined in `DEFAULT_ADMIN_VARS_JSON` into logical steps.
    - It handles the `onSubmit` event, separating the form values into a `settings` payload and a `secret` payload.
    - It makes two separate `axios.post` calls: one to `/api/settings` and another to `/api/secret` for the mail server password if it has been changed.
    - It dynamically renders form fields based on dependencies (e.g., the `enable_subscription` field is only shown if `enable_credits` is true).

- **`DefaultStepCreator.tsx` (`/src/components/forms/DefaultStepCreator.tsx`)**: This component is responsible for rendering the individual form fields within each step.
    - It iterates over a list of variables for a given step.
    - Based on the `type` of each variable (e.g., "string", "bool"), it renders the appropriate field component (e.g., `StringField`, `BooleanField`).
    - It attaches validation logic to each field, providing immediate feedback to the user.

## 3. Backend Implementation

The backend consists of two API endpoints that handle the persistence of settings and secrets.

- **`/api/settings.ts`**: This endpoint manages the lifecycle of the main application settings.
    - **`GET`**: Fetches the current settings document from the "settings" collection in Firestore, scoped by the `gcpProjectId`.
        - **Defaults**: If no settings document exists, it returns a hardcoded default configuration object (e.g., `creditsPerUnit: 1`, `refreshInterval: 300`).
        - **Security**: It always masks the `mail_server_password` if one is set, ensuring it is never exposed to the client.
    - **`POST`**: This is an idempotent "upsert" operation. It checks if a settings document already exists.
        - **Validation**: It enforces specific validation rules, such as ensuring `maximumReferrals` is a non-negative integer under 1000.
        - **Singleton Pattern**: It enforces a single settings document per `gcpProjectId`, updating the existing one if found.
        - **Tracking**: It tracks changes to critical fields (e.g., `signupCreditAmount`, `private_mode`) and logs them for audit purposes.
    - **Notifications & Caching**: After successfully saving the data, it:
        - Clears the global settings cache (`clearSettingsCache`) to ensure immediate consistency.
        - Publishes a "SETTINGS" action message to the Pub/Sub topic.
        - Sends an "admin-notification" Pub/Sub message detailing exactly which fields changed.

- **`/api/secret.ts`**: This endpoint provides a secure mechanism for storing sensitive data.
    - It is protected by the `withAuth` middleware, ensuring only authenticated administrators can access it.
    - It accepts a `key` (the desired secret ID) and a `value` (the sensitive data).
    - It uses the `@google-cloud/secret-manager` client to create a new secret (if it doesn't exist) and add the provided value as the latest version. This ensures that sensitive values are never stored in the database or logs.

## 4. Feature Breakdown

The configuration fields are defined in `DEFAULT_ADMIN_VARS_JSON` (`/src/utils/data.ts`) and are grouped logically in the UI.

### 4.1. Organisation and Scope (Step 1)

- **Fields**: `organization_id`, `folder_id`, `enable_folder_scope`
- **Purpose**: These settings define the scope within Google Cloud Platform where the application will operate and query for resources.
- **`organization_id`**: Specifies the GCP organization domain (e.g., `techequity.cloud`). Corresponds to `gcp_organization_domain` in the backend type definition. Used as the top-level scope for BigQuery queries when folder scope is disabled.
- **`folder_id`**: The ID of a specific GCP folder (corresponds to `gcp_client_folder_id`).
- **`enable_folder_scope`**: A boolean toggle.
    - If **true**, the `folder_id` is used as the primary scope for BigQuery queries, narrowing the focus of cost and usage reports.
    - If **false**, the `organization_id` is used, providing an organization-wide view.

### 4.2. Billing and Credits (Step 2)

- **Fields**: `billing_account_id`, `enable_credits`, `enable_subscription`
- **Purpose**: To control the platform's monetization and cost tracking features.
- **`billing_account_id`**: The ID of the GCP billing account to associate with deployed projects.
- **`enable_credits`**: A master switch for the credits system.
    - If **true**, the platform tracks user credit balances, deducts credits for deployments, and displays credit-related information in the UI. The "Credits" navigation link becomes visible.
    - If **false**, all credit-related functionality is disabled.
- **`enable_subscription`**: A switch for the subscription tier feature. This field is only visible and can only be enabled if `enable_credits` is true.
    - If **true**, users can subscribe to tiers to receive recurring credits. The "Buy Credits" and subscription management UIs are enabled.
    - If **false**, the subscription system is disabled, and `require_credit_purchases` is automatically set to false in the backend.

### 4.3. Data Management and Privacy (Step 3)

- **Fields**: `private_mode`, `cleanupSchedule`, `retentionPeriod`, `enableSoftDelete`, `enableOrphanCleanup`, `notifyBeforeDelete`, `softDeleteGracePeriod`
- **Purpose**: To manage data visibility, privacy, and automated cleanup policies.
- **`private_mode`**: A boolean toggle affecting data visibility for 'partner' roles.
    - If **true**, partners can see all deployment data across the platform.
    - If **false**, partners can only see their own deployment data.
- **`cleanupSchedule`**: A dropdown (`Daily`, `Weekly`, `Monthly`) that configures the frequency of automated cleanup jobs.
- **`retentionPeriod`**: An integer (options: 30, 90, 180, 365) representing the days to retain deployment history. Records older than this are deleted.
- **`enableSoftDelete`**: Enables a grace period before records are permanently deleted.
- **`softDeleteGracePeriod`**: The number of days (default: 7) a record remains in the "soft deleted" state before being permanently removed.
- **`enableOrphanCleanup`**: Enables the deletion of orphaned records in the cloud storage bucket that no longer have a corresponding database entry.
- **`notifyBeforeDelete`**: If enabled, users are notified before their records are permanently deleted.

### 4.4. Notifications (Step 4)

- **Fields**: `email_notifications`, `mail_server_email`, `mail_server_password`, `support_email`
- **Purpose**: To configure the platform's ability to send email notifications.
- **`email_notifications`**: A master switch for email functionality.
    - If **true**, the other email-related fields become visible, and the system will attempt to send emails for events like low credit warnings.
    - If **false**, all email functionality is disabled.
- **`mail_server_email`**: The username/email address for the SMTP server.
- **`mail_server_password`**: The password for the SMTP server. This value is **never** stored in Firestore. It is sent directly to the `/api/secret` endpoint and stored securely in Google Cloud Secret Manager under the key `mailBoxCred`.
- **`support_email`**: The email address to be used as the "from" or "reply-to" address in outgoing support and notification emails.

### Note on Credit Values
While the `/api/settings` endpoint supports fields like `signupCreditAmount`, `referralCreditAmount`, and `creditsPerUnit`, these are **not** managed via the main "Setup" form described here. Instead, they are managed via the "Credits" or "Billing" interface (using the `AdminCreditForms` component), which allows for granular control over credit economics without cluttering the global infrastructure setup.
