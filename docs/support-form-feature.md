# Support Form Feature

## Overview

The Support Form feature allows authenticated users to raise support requests directly from the application. It provides a structured way for users to report technical issues, ask billing questions, request features, or report bugs. The system ensures that support requests are categorized, prioritized, and securely delivered to the support team via email.

## User Experience

The support form is designed to be intuitive and user-friendly, providing immediate feedback and guidance.

### Fields
Users are required to fill out the following fields:
- **Subject**: A brief summary of the issue (min 5, max 200 characters).
- **Category**: Classifies the request (Technical Issue, Billing Question, Feature Request, Bug Report, Account Issue, Other).
- **Priority**: Indicates urgency (Low, Medium, High, Urgent).
- **Message**: A detailed description of the issue (min 10, max 1000 characters).

### Key Interactions
- **Validation**: Real-time validation ensures all required fields are completed correctly.
- **Priority Confirmation**: If a user selects "High" or "Urgent" priority, a confirmation dialog appears to ensure the priority level is appropriate, as these levels may trigger immediate alerts for the support team.
- **Rate Limiting**: To prevent spam, users must wait 5 seconds between submissions.
- **Feedback**: Success or error notifications are displayed via toast alerts upon form submission.

## Technical Implementation

### Frontend (`SupportForm.tsx`)

The frontend is built using React and leverages several key libraries for robustness and security:
- **Formik**: Manages form state and submission handling.
- **Yup**: Provides schema-based validation for all input fields.
- **DOMPurify**: Sanitizes user input on the client side to prevent Cross-Site Scripting (XSS) attacks.

**File Location:** `rad-ui/webapp/src/components/forms/SupportForm.tsx`

### Backend (`/api/support/contact`)

The backend API endpoint handles the secure processing and delivery of support requests.

**Endpoint:** `POST /api/support/contact`

**Process Flow:**
1.  **Authentication**: The endpoint is protected by the `withAuth` middleware, ensuring only logged-in users can submit requests.
2.  **Input Validation**: Checks for required fields and validates data integrity.
3.  **Sanitization**: Uses `isomorphic-dompurify` to sanitize the message body, stripping malicious code while preserving basic formatting.
4.  **Configuration Retrieval**:
    -   Fetches application settings (support email address) from Firestore.
    -   Retrieves email server credentials securely from Google Secret Manager.
5.  **Email Construction**: Generates a formatted HTML email containing the user's details, request category, priority, and message.
6.  **Delivery**: Sends the email to the configured support address using the internal mail service.

**File Location:** `rad-ui/webapp/src/pages/api/support/contact.ts`

## Configuration

To ensure the support form functions correctly, the following configurations are required:

### Firestore Settings
The `settings` collection in Firestore must contain a document for the project with the `variables` map including:
-   `support_email`: The email address where support requests will be sent.
-   `mail_server_email`: The email address used to send the notifications (sender address).

### Secret Manager
The Google Cloud Secret Manager must store the email server password under the key:
-   `mailBoxCred`

## Security Measures

-   **Authentication**: Strictly enforces user authentication for all API access.
-   **Input Sanitization**: Both frontend and backend implement sanitization to block XSS attacks.
-   **Rate Limiting**: A client-side cooldown period prevents accidental double-submissions and reduces spam risk.
-   **Secure Credentials**: Sensitive email credentials are never hardcoded and are retrieved securely at runtime.
