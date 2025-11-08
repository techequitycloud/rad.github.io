---
title: Deployments
sidebar_position: 1
---

# Deployments


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

## Part 2: The "Deployments" Page - Viewing and Managing Deployments

This section provides a technical overview of the "All Deployments" and "My Deployments" tabs located on the Deployments page of the application.

### 2.1. Core Component and Data Fetching

-   **Main Component**: The user interface for both tabs is managed by the `Deployments.tsx` component, located at `rad-ui/webapp/src/routes/Deployments.tsx`.

-   **Data Fetching Hook**: The component uses a custom hook, `useDeployments` (`rad-ui/webapp/src/hooks/useDeployments.ts`), to handle all data fetching and state management for the deployment lists.

-   **Real-time Updates**: The `useDeployments` hook leverages Firebase's `onSnapshot` listener to subscribe to real-time updates from the `deployments` collection in Firestore. This ensures that any changes to the deployment data (e.g., status updates, new deployments) are immediately reflected in the UI without requiring a manual refresh. The data is ordered by the `createdAt` timestamp in descending order.

### 2.2. Role-Based Access Control and Tab Visibility

The visibility of the tabs is determined by the user's role:

-   **Admin Users**: Administrators can see both the "All Deployments" and "My Deployments" tabs, allowing them to view all deployments across the platform or filter down to only their own. The "All Deployments" tab is the default view for admins.

-   **Non-Admin Users**: Regular users only see the "My Deployments" view. The tabbed interface is hidden, and they are presented with a single, filtered list of their own deployments.

### 2.3. Data Filtering and Display

-   **"All Deployments"**: This view displays all deployment documents fetched from the `deployments` Firestore collection.

-   **"My Deployments"**: The `useDeployments` hook filters the complete list of deployments to only include those where the `deployedByEmail` field matches the email of the currently logged-in user. This filtered list is then displayed in the "My Deployments" tab.

### 2.4. Search and Pagination on the Deployments Page

-   **Search Functionality**: A search bar is provided to filter the deployments in the currently active tab.
    -   For "All Deployments", users can search by module name, deployment ID, project ID, or the deploying user's email.
    -   For "My Deployments", the search is limited to module name, deployment ID, or project ID.

-   **Pagination**: To efficiently manage large sets of data, both tabs implement pagination. The `usePagination` custom hook is used to handle the logic for slicing the data into pages, and the `PaginationControls` component renders the UI for navigating between pages.

### 2.5. Additional UI Features on the Deployments Page

-   **Deployment Details**: Clicking on a deployment in either list navigates the user to a detailed view of that deployment, where they can view logs and other information.

-   **Empty State**: If there are no deployments to display in either tab, a user-friendly "empty state" component is rendered, which provides guidance on how to create a new deployment.

---

## Part 3: Deployment Deletion

This section outlines the end-to-end process for deleting a deployment, including the technologies involved, the data affected, and the automated cleanup procedures.

### 3.1. User-Initiated Deletion

When a user initiates the deletion of a deployment from the web application, the following steps occur:

*   **API Request:** The frontend sends a `DELETE` request to the API endpoint at `rad-ui/webapp/src/pages/api/deployments/[id]/index.ts`.
*   **Queuing the Deletion:** The `deleteDeployment` function in this API route does not immediately delete the deployment. Instead, it queues the deletion by:
    1.  Fetching the deployment document from the `deployments` collection in Firestore to verify its existence.
    2.  Creating a Pub/Sub message containing the deployment details, including the `deploymentId` and the `DELETE` action.
    3.  Publishing this message to the Pub/Sub topic specified by the `NEXT_PUBLIC_PUBSUB_DEPLOYMENTS_DELETE_TOPIC` environment variable.
    4.  Updating the deployment's `status` in Firestore to `QUEUED`.

This asynchronous approach ensures that the user interface remains responsive while the potentially long-running deletion process is handled in the background.

### 3.2. The Asynchronous Deletion Process

The actual deletion is handled by a Cloud Function and a Cloud Build pipeline:

*   **Cloud Function Trigger:** The Pub/Sub message is received by the Cloud Function defined in `rad-ui/automation/terraform/infrastructure/function/delete_deployment/index.js`.
*   **Cloud Build Execution:** This Cloud Function is responsible for triggering a Cloud Build pipeline. It:
    1.  Verifies the deployment exists in Firestore.
    2.  Initiates a Cloud Build run based on the configuration in `rad-ui/automation/cloudbuild_delete_deployment.yaml`.
    3.  Passes necessary information, such as the `_DEPLOYMENT_ID` and `_MODULE_NAME`, to the Cloud Build pipeline as substitutions.
    4.  Updates the deployment's `builds` array in Firestore with the new build ID and sets the status to `QUEUED`.

### 3.3. What is Deleted?

The `cloudbuild_delete_deployment.yaml` configuration reveals what is actually deleted:

*   **Terraform Resources:** The pipeline uses Terraform to destroy the infrastructure associated with the deployment. The `terraform destroy` command is executed, which removes all the Google Cloud resources that were created when the deployment was provisioned.
*   **What is NOT Deleted (Initially):**
    *   **Firestore Document:** The Cloud Build pipeline **does not** delete the deployment document from the `deployments` collection in Firestore. This document is retained for historical purposes and to track the status of the deletion.
    *   **Cloud Storage Assets:** The pipeline **does not** delete the deployment artifacts (such as the Terraform configuration and logs) from the Google Cloud Storage bucket.

### 3.4. How Failures are Handled

If the Cloud Build pipeline fails, the deployment's status is updated to reflect the failure (e.g., `FAILURE`, `INTERNAL_ERROR`, `TIMEOUT`). The Firestore document and Cloud Storage assets are not deleted, which allows for debugging and potential retries. The `updateDeploymentStatus` function in `rad-ui/webapp/src/utils/api.ts` is responsible for mapping the Cloud Build status to the deployment status in Firestore.

### 3.5. Data Retention and Automated Cleanup

While user-initiated deletions don't remove the Firestore document or GCS assets, there is an automated cleanup process:

*   **Cleanup API Endpoint:** The API endpoint at `rad-ui/webapp/src/pages/api/deployments/cleanup.ts` provides a mechanism for administrators to manually trigger a cleanup of old deployments.
*   **Scheduled Cleanup:** This cleanup functionality is also designed to be triggered by a scheduled job (likely a Cloud Scheduler job that calls the cleanup endpoint).
*   **Retention Period:** The cleanup process is governed by a `retentionPeriod` setting, which is configured in the application's admin settings.
*   **What is Deleted During Cleanup:** The `doDeploymentsCleanup` function in `rad-ui/webapp/src/utils/deployment.ts` performs the following actions for deployments older than the retention period:
    1.  **Deletes the Firestore document:** It removes the entire deployment document from the `deployments` collection.
    2.  **Deletes the Cloud Storage folder:** It deletes the corresponding folder in the Google Cloud Storage bucket, which contains all the artifacts for that deployment.

This automated cleanup ensures that data is not retained forever and helps manage storage costs.
