# User Management Feature Technical Documentation

## 1. Overview

The User Management feature provides administrators with a centralized interface to manage the entire user lifecycle within the platform. This includes managing user roles, credit balances, and account status. This document details the technical implementation of this feature, from the frontend user interface to the backend API and its interactions with external services.

## 2. Feature Purpose

The primary purpose of the User Management page is to allow administrators to:

*   View a comprehensive list of all registered users.
*   Fetch and view the details of a single user.
*   Activate or deactivate user accounts.
*   Assign or revoke specific roles (`Partner`, `Agent`).
*   Manually adjust a user's awarded and purchased credit balances.
*   Permanently delete a user and all their associated data.

This functionality is crucial for maintaining the security, integrity, and operational management of the platform.

## 3. Implementation Details

### 3.1. Frontend

The frontend of the User Management feature is implemented as a React component located at `rad-ui/webapp/src/routes/Users.tsx`.

#### 3.1.1. Core Components and Libraries

*   **React**: The core UI library.
*   **@tanstack/react-query**: Used for data fetching, caching, and state management. Specifically, the `useUsers` hook fetches the list of users.
*   **axios**: Used for making HTTP requests to the backend API.
*   **Custom Components**: `RouteContainer`, `PaginationControls`, `Search`, `Loading`.

#### 3.1.2. Workflow

1.  **Data Fetching**: Upon loading, the `UsersPage` component uses the `useUsers` hook to fetch a list of all users from the `/api/users` endpoint. This hook is enabled only if the current user has administrator privileges (`isAdmin`).
2.  **Display**: The fetched user data is displayed in a paginated table. Each row represents a user and includes their email address and checkboxes for their `Active`, `Partner`, and `Agent` statuses.
3.  **Editing**: When an administrator clicks the "Edit" button for a user, the corresponding row becomes editable. The checkboxes are enabled, allowing the administrator to modify the user's roles.
4.  **Saving**: Clicking the "Save" button triggers the `handleSaveClick` function, which sends a `PUT` request to the `/api/users/{user_email}` endpoint. The request payload contains the updated boolean values for `active`, `isPartner`, and `isAgent`.
5.  **State Update**: After a successful save operation, the `react-query` cache for `["users"]` is invalidated, which triggers a refetch of the user list to display the updated information.

### 3.2. Backend

The backend logic for user management is handled by a single, multi-functional Next.js API route at `rad-ui/webapp/src/pages/api/users/[userId].ts`.

#### 3.2.1. API Endpoints

The API route handles `GET`, `PUT`, and `DELETE` requests for a specific user.

*   **`GET /api/users/{userId}`**: Fetches a single user's details.
*   **`PUT /api/users/{userId}`**: Updates a user's roles, status, credits, or settings.
*   **`DELETE /api/users/{userId}`**: Deletes a user from the platform.
*   **`userId`**: The email address of the target user.

#### 3.2.2. Middleware

The endpoint is protected by the `withAuth` middleware (`rad-ui/webapp/src/utils/middleware.ts`), which performs the following actions:

*   **Authentication**: Verifies the user's Firebase authentication token.
*   **Authorization**: Checks if the authenticated user has the necessary permissions (in this case, administrator).
*   **User Caching**: Caches user data to reduce Firestore reads.
*   **Role Synchronization**: Ensures the user's Firestore document is consistent with their Google Group memberships.

#### 3.2.3. Core Logic

The API handler contains three main functions corresponding to the HTTP methods:

**`getUser(req, res)`**

*   Handles `GET` requests.
*   Fetches a single user document from the `users` Firestore collection based on the `userId` (email) provided in the URL.
*   Returns the full user object.

**`updateUser(req, res)`**

*   Handles `PUT` requests.
*   **Request Handling**: Extracts the user's email from the query and any of the following from the request body: `active`, `isPartner`, `isAgent`, `creditAwards`, `creditPurchases`, `notificationSettings`.
*   **Credit Management**:
    *   If `creditAwards` or `creditPurchases` are provided, it calculates the difference from the current balances.
    *   It creates a new document in the `credit_transactions` collection to log the adjustment, specifying the type (`AWARD` or `PURCHASE`).
    *   It updates the user's `creditAwards`, `creditPurchases`, and the total `creditBalance` in their user document.
    *   It publishes a message to a Pub/Sub topic to notify administrators of the change.
*   **Google Group Management**: This is the core of the role management system.
    *   If `active` is set to `true`, the user is added to the `rad-users` Google Group.
    *   If `active` is set to `false`, the user is removed from `rad-users`, `rad-partners`, and `rad-agents` groups to ensure their access is fully revoked.
    *   If `isPartner` is `true`, the user is added to the `rad-partners` Google Group. If `false`, they are removed.
    *   If `isAgent` is `true`, the user is added to the `rad-agents` Google Group. If `false`, they are removed.
*   **Firestore Update**: The function updates the user's document in Firestore with all the new values.
*   **Cache Invalidation**: The `roleCache` and `userDocumentCache` for the updated user are invalidated to ensure that subsequent requests for this user's data receive the updated information.

**`deleteUser(req, res)`**

*   Handles `DELETE` requests.
*   Performs a comprehensive deletion process:
    1.  **Archive**: Creates a record of the user in the `deleted_users` collection for auditing purposes.
    2.  **Delete Firestore Data**: Deletes the main user document from the `users` collection, as well as all associated documents from the `deployments` and `credit_transactions` collections.
    3.  **Remove from Group**: Removes the user from the `rad-users` Google Group via the Google Cloud Identity API.
    4.  **Delete Auth User**: Deletes the user from Firebase Authentication, permanently revoking their ability to log in.

**User Creation (`createUser` in `pages/api/users/index.ts`)**

*   **Trigger**: Called automatically when a user signs in for the first time.
*   **Initial Credits**: Retrieves the `signUpCredits` value from the application settings.
*   **Logic**: Sets the new user's `tokenBalance` (legacy field) and `creditAwards` to the configured sign-up credit amount. This ensures new users can immediately start exploring the platform.

## 4. Interactions and Dependencies

*   **Firestore**: The single source of truth for user data (email, roles, etc.).
*   **Google Cloud Identity API**: Used to manage memberships in Google Groups, which control access to different parts of the application.
*   **Firebase Authentication**: Used for user authentication.
*   **React Query**: Manages client-side data fetching and caching.

## 5. Input and Output

### 5.1. Frontend -> Backend

*   **`GET /api/users/{userId}`**: No request body.
*   **`DELETE /api/users/{userId}`**: No request body.
*   **`PUT /api/users/{userId}`**: A JSON body with any of the following optional fields:
    ```json
    {
      "active": boolean,
      "isPartner": boolean,
      "isAgent": boolean,
      "creditAwards": number,
      "creditPurchases": number,
      "notificationSettings": object
    }
    ```

### 5.2. Backend -> Frontend

*   **`GET` Success Output**: `200 OK` response with a JSON body containing the user object:
    ```json
    {
      "user": { ... }
    }
    ```
*   **`PUT` Success Output**: `200 OK` response with a JSON body containing the updated user object:
    ```json
    {
      "user": {
        "id": "...",
        "email": "...",
        "active": true,
        "isPartner": false,
        "isAgent": true,
        ...
      }
    }
    ```
*   **`DELETE` Success Output**: `200 OK` response with a JSON body:
    ```json
    {
      "message": "User deleted successfully"
    }
    ```
*   **Failure Output**: Standard HTTP error codes (400, 403, 404, 500) with a JSON body containing an error message.

## 6. Feature Enablement

The features associated with each checkbox are as follows:

*   **Active**: Controls the user's ability to log in to the platform. If unchecked, the user is effectively disabled and will be redirected to the sign-in page.
*   **Partner**: Grants the user access to the "Publish" tab, allowing them to connect their own GitHub repository and publish private modules.
*   **Agent**: Grants the user access to agent-specific features, such as the "User Revenue" and "Module Revenue" tabs in the Billing section, which show revenue generated by their referred users.

## 7. Failure Scenarios

*   **API Failures**: If the Google Cloud Identity API fails to update group memberships, the user's roles may become out of sync between Firestore and their actual permissions. The backend logs these errors.
*   **Firestore Failures**: If Firestore is unavailable, the user management page will not load, and updates will fail.
*   **Authentication/Authorization Failures**: If a non-admin user attempts to access the user management page or API, they will be denied access.
