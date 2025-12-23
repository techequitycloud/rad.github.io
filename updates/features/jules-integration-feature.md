# Jules Integration Feature

The Jules Integration feature enables users to leverage AI to refine their private modules directly within the platform. By integrating with the Jules API, users can explore their module's capabilities, ask questions, and generate improvement plans or pull requests.

## Overview

The feature is accessible via a "Sparkles" icon on individual module cards. It opens a modal interface where users can initiate a chat-based session with Jules, an AI agent aware of the module's source code.

## Prerequisites

For the feature to be available, the following conditions must be met:
1.  **Partner Role:** The user must be a registered partner.
2.  **GitHub Configuration:** A valid GitHub repository must be configured in the user's profile.
3.  **Jules API Key:** A valid `partner-jules-api-key-<uid>` must be stored in the Google Cloud Secret Manager. The system checks this via the `isJulesConfigured` flag in the user store.

## User Workflow

1.  **Access:**
    -   Navigate to the module list (e.g., "Deploy" or "Publish" page).
    -   Locate a private module.
    -   Click the **Sparkles icon** in the bottom-left corner of the module card.

2.  **Verification:**
    -   Upon opening the modal, the system automatically validates if the module's repository is a registered source in the Jules system (`/api/jules/source`).
    -   If verified, the user is presented with an option to start a new session or resume an existing one.

3.  **Session Management:**
    -   **Start Session:** Clicking "Start Session" initializes a new conversation. A default prompt is sent to Jules to analyze the module's features and variables.
    -   **Resume Session:** If a previous session exists, the user can resume exactly where they left off. The system uses a secure session manager (`SecureSessionManager`) backed by `sessionStorage` and server-side verification to handle session persistence.
    -   **End Session:** Users can manually end the session, which clears the conversation history and local state.

4.  **Interaction:**
    -   **Chat:** Users can send natural language messages to Jules to ask for explanations, refactoring suggestions, or new features.
    -   **Activities:** The interface displays a log of activities, which updates every 30 seconds. Activities include:
        -   Messages (User and Agent)
        -   Progress Updates
        -   Generated Plans
        -   Pull Requests (PRs)
    -   **Filtering:** Users can filter the activity log to view specific types of information (e.g., only Plans or only Messages).

5.  **Outputs:**
    -   If Jules generates a Pull Request (e.g., after a plan is approved), a direct link to the PR is displayed in the "Outputs" section of the modal header.

## Technical Architecture

### Frontend
-   **`ModuleCard.tsx`:** Renders the entry point (Sparkles icon) conditionally based on `isJulesConfigured`.
-   **`JulesRefineModal.tsx`:** The core component managing the UI state, polling (30s interval) for updates, and displaying the chat interface. It uses `axios` to communicate with the backend API.

### Backend (Next.js API Routes)
The application acts as a proxy to the Jules API to secure credentials and manage session state.
-   **`/api/jules/source`:** Verifies if the GitHub repo is a valid source.
-   **`/api/jules/session`:** Handles creation, retrieval, listing, and deletion of sessions.
-   **`/api/jules/message`:** Sends user messages to the active session.
-   **`/api/jules/activities`:** Fetches the history of interactions and agent actions.

### Service Layer
-   **`JulesService` (`rad-ui/webapp/src/utils/jules.ts`):** A singleton service that handles the direct communication with `https://jules.googleapis.com/v1alpha`.
-   **Authentication:** Requests are authenticated using an `X-Goog-Api-Key` header. The API key is retrieved server-side from Secret Manager, ensuring it is never exposed to the client.

## Security & Privacy
-   **Sanitization:** All rendered markdown and HTML content is sanitized using `rehype-sanitize` and `isomorphic-dompurify` to prevent XSS attacks.
-   **Session Storage:** Session IDs are stored securely using a `SecureSessionManager` to allow session resumption without exposing sensitive data.
-   **API Key Protection:** The Jules API Key is handled exclusively on the server side.
