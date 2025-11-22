# Deployments Feature: Technical Documentation

This document provides a comprehensive technical overview of the module deployment feature, covering the full lifecycle from launching to viewing and deleting deployments.

---

## Part 1: The "Deploy" Page - Selecting and Launching a Module

This section details the user journey for selecting, configuring, and launching a new module deployment from the "Deploy" page.

### 1.1. Module Visibility and Roles

The application controls module visibility based on user roles (Admin, Partner, User) to ensure users only see relevant modules. This logic is enforced on the backend in the `/api/modules` endpoint and reflected in the UI.

-   **Platform Modules**: These are the standard modules available to all users. They are identified in Firestore by having `source: 'admin'`. All roles can see these modules.

-   **Partner Modules**: These are custom modules published by users with the 'partner' role. They are identified by having `source: 'partner'` and a `partnerId` field matching the publisher's user UID.

#### Role-Based Views:

-   **Standard Users**: Can only see Platform Modules.
-   **Partners**: Can see all Platform Modules and *only* the Partner Modules they have personally published. The "Partner Modules" tab in the `Deploy.tsx` component is only visible to them if their repository is configured.
-   **Admins**: Have full oversight and can see all modules—all Platform Modules and all Partner Modules from every partner.

### 1.2. Data Fetching and Caching

The data for the Deploy page is fetched and managed as follows:

-   **API Endpoint**: All modules are fetched from the `/api/modules` endpoint. This single endpoint contains the role-based logic to return the correct set of modules based on the authenticated user's permissions.
-   **Role-Based Access Control (RBAC)**: The API handler (`/api/modules.ts`) checks the user's role (`isAdmin`, `isPartner`) and UID to query Firestore for the appropriate documents, ensuring the principle of least privilege.
-   **Server-Side Caching**: The `/api/modules` endpoint previously used a short-lived in-memory cache to reduce frequent Firestore reads. However, to ensure data is always fresh, especially after a module is published or deleted, this cache has been disabled (`CACHE_DURATION: 0`).
-   **Client-Side Caching**: The frontend does not use a persistent client-side cache like React Query for the module list. The data is fetched fresh each time the `Deploy.tsx` component mounts to ensure the user always sees the most up-to-date list of available modules.
-   **Cache Invalidation**: When a module is created, updated (via the Publish flow), or deleted, the `clearModuleCache()` and `clearPublishDataCache()` functions are called on the server-side to ensure that any subsequent API calls (even within the same server instance) fetch fresh data. The client is also redirected or forced to refetch data to reflect the changes immediately.

### 1.3. UI Features on the Deploy Page

#### Search

-   **Implementation**: A search bar, implemented in the `Search.tsx` component, allows users to filter the list of modules.
-   **Functionality**: The search is performed client-side on the currently visible list of modules (either Platform or Partner). It uses a pre-built index of module names for efficient filtering and returns a list of matching modules to the `Deploy.tsx` component, which then updates the state to re-render the list.

#### Pagination

-   **Implementation**: The `usePagination` custom hook is used to manage the state for pagination. The `PaginationControls.tsx` component renders the UI for navigating between pages.
-   **Functionality**: Both the Platform and Partner module lists are paginated independently. The hook slices the array of filtered modules based on the current page and items per page, and a the controls allow the user to navigate through the pages of results.

### 1.4. Module Actions

#### Module Deletion

-   **Permissions**: The ability to delete a module is restricted.
    -   **Admins**: Can delete any module (Platform or Partner).
    -   **Partners**: Can only delete their own modules. A check in `ModuleCard.tsx` compares `user.uid` to the module's `partnerId` to determine ownership.
-   **Process**:
    1.  The delete action is initiated by clicking a `TrashIcon` on the `ModuleCard`.
    2.  This action triggers the `DeleteModuleModal.tsx` to appear, asking for confirmation.
    3.  Upon confirmation, the modal sends a `DELETE` request to the `/api/modules?moduleId=<ID>` endpoint.
    4.  The backend API handler verifies the user's permissions again, deletes the module from Firestore, and clears the server-side caches.
    5.  On successful deletion, the `Deploy.tsx` component refetches the entire list of modules to update the UI.

### 1.5. Initiating a Deployment: The Form Flow

The process of configuring and launching a module is a multi-step flow that dynamically generates a form based on the selected module's requirements.

#### 1. Navigation and Variable Fetching (`ProvisionModule.tsx`)

-   When a user clicks a `ModuleCard`, the application navigates to `/modules/provision`.
-   `ProvisionModule.tsx` is the entry point for the deployment configuration process. It receives the module's basic information (name, source) via navigation state.
-   It is responsible for fetching the detailed configuration variables for that specific module from the backend.

#### 2. Dynamic Form Rendering (`CreateForm.tsx` & `StepCreator.tsx`)

-   The fetched variables are passed to `CreateForm.tsx`, which orchestrates the form-building process.
-   It uses a `FormikStepper` to create a multi-step user experience, grouping variables into logical steps.
-   For each step, a `StepCreator.tsx` component is rendered. This component iterates through the variables assigned to that step and dynamically renders the appropriate input field (e.g., text input for a `string`, a checkbox for a `bool`, a multi-select for a `list`) based on the variable's `type`.
-   Variable order within a step is determined by the `order` property, and mandatory fields (`required: true`) are marked with an asterisk.

#### 3. Deployment Confirmation (`DeploymentConfirmationModal.tsx`)

-   After the user fills out the form and clicks "Submit," the `handleSubmit` function in `CreateForm.tsx` triggers the `DeploymentConfirmationModal.tsx`.
-   This modal serves as a final verification step before initiating the deployment. It displays:
    -   **Deployment Cost**: The credit cost for the module.
    -   **Credit Balance**: The user's available balance. The modal intelligently checks the `require_credit_purchases` flag to show the correct balance (purchased credits only, or the combined total).
    -   **Insufficient Credits Alert**: If the user's balance is too low, the confirmation button is disabled, and an error is shown.
-   Upon final confirmation, the deployment request is sent to the `/api/deployments` endpoint.

---

## Part 2: Backend Execution - The `create_deployment` Function

When a deployment is initiated, the API creates a record in Firestore but offloads the heavy lifting to a dedicated Cloud Function.

### 2.1. Pub/Sub Trigger

-   **Function Name**: `create_deployment`
-   **Trigger**: Google Cloud Pub/Sub.
-   **Process**: The `/api/deployments` endpoint publishes a message to a specific topic. This message contains all the necessary context: `deploymentId`, `moduleId`, `variables`, and critically, the `gitRepoUrl`.

### 2.2. Dynamic Repository Selection

A key feature of the system is its ability to deploy from different repositories based on the module source.

-   **`_GIT_REPO_URL` Substitution**: The `create_deployment` function receives the correct Git repository URL (either the global platform repo or a partner's private repo) in the Pub/Sub message.
-   **Cloud Build Configuration**: This URL is passed to the Cloud Build trigger as the `_GIT_REPO_URL` substitution variable. This allows the build process to dynamically clone the correct source code without hardcoding repository locations.

### 2.3. Credit Deduction Logic (`update_status`)

Credits are **not** deducted when the deployment is requested. Instead, they are deducted only after the deployment successfully completes. This logic is handled by the `update_status` Cloud Function (also known as `notification_status`).

-   **Trigger**: Cloud Build status updates (via Pub/Sub).
-   **Condition**: Credit deduction only occurs if the build status is `SUCCESS` and the action was `CREATE`.
-   **Logic**:
    1.  It checks the module's `require_credit_purchases` flag.
    2.  **If `true`**: It deducts credits exclusively from the user's `creditPurchases` balance.
    3.  **If `false` (default)**: It attempts to deduct from `creditAwards` (free credits) first. If those are insufficient, it deducts the remainder from `creditPurchases`.
    4.  It records the transaction in the `credit_transactions` collection.
    5.  It increments the user's `deployments` count.

---

## Part 3: The "Deployments" Page - Viewing and Managing Deployments

This section provides a technical overview of the "All Deployments" and "My Deployments" tabs located on the Deployments page of the application.

### 3.1. Core Component and Data Fetching

-   **Main Component**: The user interface for both tabs is managed by the `Deployments.tsx` component, located at `rad-ui/webapp/src/routes/Deployments.tsx`.

-   **Data Fetching Hook**: The component uses a custom hook, `useDeployments` (`rad-ui/webapp/src/hooks/useDeployments.ts`), to handle all data fetching and state management for the deployment lists.

-   **Real-time Updates**: The `useDeployments` hook leverages Firebase's `onSnapshot` listener to subscribe to real-time updates from the `deployments` collection in Firestore. This ensures that any changes to the deployment data (e.g., status updates, new deployments) are immediately reflected in the UI without requiring a manual refresh. The data is ordered by the `createdAt` timestamp in descending order.

### 3.2. Role-Based Access Control and Tab Visibility

The visibility of the tabs is determined by the user's role:

-   **Admin Users**: Administrators can see both the "All Deployments" and "My Deployments" tabs, allowing them to view all deployments across the platform or filter down to only their own. The "All Deployments" tab is the default view for admins.

-   **Non-Admin Users**: Regular users only see the "My Deployments" view. The tabbed interface is hidden, and they are presented with a single, filtered list of their own deployments.

### 3.3. Deployment Details and Logs

-   **Separation of Concerns**: The API for deployment details is split to optimize performance.
    -   `/api/deployments/[id]/status`: Returns structured JSON data about the deployment status and build steps.
    -   `/api/deployments/[id]/logs`: Returns the raw text content of the build logs.
-   **Log Streaming**: The logs endpoint streams the log file directly from Google Cloud Storage (GCS) to the client, rather than generating a signed URL. This allows it to work seamlessly with Application Default Credentials (ADC) and enforces application-level access control.

