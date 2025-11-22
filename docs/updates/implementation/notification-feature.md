# Admin Notification System Architecture

## 1. Overview

The Admin Notification system is a decoupled, event-driven architecture designed for auditing and proactive operational awareness. Its primary function is to publish messages to a central message broker when significant, admin-initiated changes occur within the application. It is **not** a monolithic feature but a distributed system pattern.

The core design principle is **resilience**. The failure to publish a notification message must not interfere with the primary user-facing action.

## 2. System Architecture

The system follows a standard Publisher/Subscriber (Pub/Sub) model, utilizing Google Cloud services.

```mermaid
graph TD
    A[Admin User via UI] -->|Initiates Action| B{Next.js API Route};
    B -->|1. Perform Action (e.g., Firestore Write)| C[(Firestore)];
    B -->|2. On Success, construct message| D[JSON Payload];
    D -- topic: 'admin-notification' --> E(pushPubSubMsg Utility);
    E -->|3. Publish Message| F[(Google Cloud Pub/Sub Topic: admin-notification)];
    F -->|4. Delivers Message| G(External Subscriber);
    G -->|5. Process & Notify| H{Email / Slack / Logging};

    subgraph Web Application (rad-ui/webapp)
        B; D; E;
    end

    subgraph External Infrastructure
        G; H;
    end
```

### Components

*   **Publishers (Next.js API Routes):** Specific backend API endpoints are responsible for initiating the notification process *after* their primary logic has successfully completed.
    *   `pages/api/settings.ts`
    *   `pages/api/users/[userId].ts`

*   **Message Broker (Google Cloud Pub/Sub):** A single Pub/Sub topic, `admin-notification`, serves as the central, durable message bus. This decouples the message producers (the web app) from the consumers.

*   **Subscriber (External Service):** A downstream service, such as a Cloud Function with a Pub/Sub trigger, is responsible for subscribing to the `admin-notification` topic. **This component is not part of the `rad-ui/webapp` codebase.** Its role is to consume the messages and execute the final notification logic (e.g., format and send an email).

## 3. Implementation Details

### Triggers

A notification is published only upon the successful completion of these specific, admin-initiated events:

1.  **Application Settings Change:** A `POST` request to `/api/settings` that results in a successful write to the `settings` collection in Firestore.
2.  **User Credit Adjustment:** A `PUT` request to `/api/users/[userId]` where an admin manually alters the `creditAwards` or `creditPurchases` fields.
3.  **User Deactivation:** A `PUT` request to `/api/users/[userId]` where an admin sets the user's `active` status to `false`.

### `pushPubSubMsg` Utility

This is the core publishing function, located at `src/utils/api.ts`.

*   It dynamically determines the target topic by inspecting the `topic` field in the data payload it receives. If `topic` is present, it uses that value; otherwise, it falls back to a default based on the `action` field.
*   It authenticates to the Google Cloud Pub/Sub API using the application's service account credentials.

### Message Schema

The message published to the topic is a JSON object. For this system, the payload must include the `topic` field to ensure it is routed correctly.

**Example Payload:**
```json
{
  "subject": "User Access Deactivated",
  "message": "Access for user user@example.com has been deactivated.",
  "updatedByEmail": "admin@example.com",
  "topic": "admin-notification"
}
```

## 4. Operational Considerations

### Error Handling & Resilience

The system is designed to be resilient. The `pushPubSubMsg` function is wrapped in a `try...catch` block within the API route handler. If the primary action (e.g., updating a Firestore document) succeeds but the Pub/Sub publish action fails, the error is logged to the console, but the API request **does not fail**. This ensures that a failure in the ancillary notification system does not prevent the core application from functioning.

### Subscriber Responsibilities

The consuming service that subscribes to the `admin-notification` topic is responsible for:
*   **Idempotency:** Handling potential duplicate message deliveries from Pub/Sub.
*   **Formatting:** Transforming the JSON message into a human-readable format (e.g., an HTML email).
*   **Delivery:** Interfacing with the final notification service (e.g., SendGrid, Slack API).
*   **Error Handling:** Implementing retries or dead-lettering for failed notification attempts.

## 5. How to Extend the System

To add a new admin notification trigger:

1.  **Identify the API Route:** Locate the API route handler that executes the desired trigger event.
2.  **Find the Success Path:** Inside the handler, find the logical point immediately following the successful completion of the core action (e.g., after the `await db.collection(...).update(...)` call).
3.  **Construct the Payload:** Create a JSON object that adheres to the established schema, including a descriptive `subject` and `message`, the `updatedByEmail` from the request, and the essential `"topic": "admin-notification"`.
4.  **Call the Utility:** Pass the newly created object to the `pushPubSubMsg` function within a `try...catch` block to maintain resilience.

```typescript
// Example from pages/api/settings.ts

try {
  const adminNotificationData = {
    subject: "Settings Updated",
    message: changedSettings.join("\\n"), // A string describing what changed
    updatedByEmail: email,
    topic: "admin-notification",
  };
  await pushPubSubMsg(adminNotificationData);
  debug("Admin notification sent");
} catch (error) {
  debug("Could not send admin notification:", error);
}
```
