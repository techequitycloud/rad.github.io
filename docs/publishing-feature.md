# Module Publishing Feature: Technical Documentation

## 1. Overview and Purpose

The Module Publishing feature is the bridge between a Git repository (containing Terraform modules) and the application's user-facing "Deploy" page. Its primary purpose is to allow administrators and partners to select which modules from a connected Git source should be made available for deployment within the platform.

A "Published" module is essentially a record in the application's Firestore database that mirrors a module from the Git repository. This database record holds the module's name, its configuration variables, and metadata about who published it. Without this publishing step, modules defined in Git are invisible to the deployment system.

The feature is designed as a **synchronization mechanism**, not just a simple "add" button. The state of the selections on the Publish page becomes the source of truth for the modules available for deployment. If a module is un-selected, it's removed from Firestore and can no longer be deployed.

## 2. Feature Workflow and User Roles

The feature's behavior and data scope are determined by the user's role.

### 2.1. Admin Workflow
- **Scope:** Admins manage the global, platform-wide modules (often called "admin" or "platform" modules). These are available to all users.
- **Git Source:** They use a single, globally configured GitHub repository URL, which is set in the admin settings.
- **Action:** When an admin publishes, they are creating, updating, or deleting module records in the `modules` Firestore collection where the `source` is marked as `'admin'`.

### 2.2. Partner Workflow
- **Scope:** Partners manage a private set of modules that are **only** visible and deployable by them. This allows partners to offer custom solutions without exposing them to all users.
- **Git Source:** Partners configure their own personal GitHub repository URL and access token in their user profile.
- **Action:** When a partner publishes, they are creating, updating, or deleting module records in the `modules` collection that are explicitly tied to their user ID via a `partnerId` field and their configured `githubRepoUrl`. This ensures data isolation and repository-specific synchronization.

## 3. Technical Implementation Details

The feature is implemented across a primary frontend component (`Publish.tsx`), a Backend-for-Frontend (BFF) API endpoint (`/api/publish/data`), and a core backend logic endpoint (`/api/modules`).

### 3.1. Frontend Implementation (`Publish.tsx`)

- **Location:** `rad-ui/webapp/src/routes/Publish.tsx`
- **Data Fetching:** On page load, it makes a single GET request to `/api/publish/data`. This endpoint efficiently provides all the necessary data:
    1.  A list of available modules from the user's configured Git repo.
    2.  A list of modules already published to Firestore for that user.
    3.  General application settings.
- **State Management:** It uses `@tanstack/react-query` for server state management, caching the response from `/api/publish/data`. This cache is explicitly invalidated and refetched after a successful publish action to ensure the UI reflects the new state.
- **User Interaction:**
    - The component renders a list of `PublishModule` components, allowing the user to toggle their selection.
    - The main action button's text dynamically changes from "Publish" to "Update" if the user's selection includes modules that are already published, providing clear contextual feedback.

### 3.2. Backend-for-Frontend (`/api/publish/data.ts`)

- **Purpose:** This endpoint acts as an aggregator to optimize frontend loading. It prevents the client from having to make multiple, separate API calls.
- **Process:**
    1.  Receives an authenticated GET request.
    2.  Uses `Promise.all` to execute three data-fetching operations in parallel:
        - **Git Modules:** Fetches the list of directories (modules) from the appropriate GitHub repository (`getGitHubModulesForAdmin` for admins, `getPartnerGitHubModulesWithSettings` for partners).
        - **Firestore Modules:** Fetches the list of already published modules from the `modules` collection in Firestore. For partners, this query is filtered by `partnerId`, `source: 'partner'`, and the user's specific `githubRepoUrl`.
        - **Settings:** Fetches the global application settings.
    3.  **Caching Strategy:** This endpoint does not implement its own server-side cache. Data freshness is managed by the client (`Publish.tsx`), which uses `@tanstack/react-query` configured with `staleTime: 0` to ensure it always fetches the latest data from the server on mount and window focus. The server API also sets `Cache-Control` headers to prevent browser-level caching.
- **Output:** Returns a single JSON object containing `availableModules`, `publishedModules`, and `settings`.

### 3.3. Core Backend Logic (`/api/modules.ts`)

- **Purpose:** This endpoint handles the core business logic of the publishing feature. It receives the user's desired state from the frontend and synchronizes Firestore to match it.
- **HTTP `POST` Handler (`createModule`):** This function performs the synchronization.
    1.  **Authorization:** It first verifies that the user is either an Admin or a Partner.
    2.  **Fetch Existing State:** It queries Firestore for all modules currently associated with that user/role. For partners, this query is filtered by `partnerId` and the current `githubRepoUrl` from the user's profile.
    3.  **Calculate Deletions:** It compares the list of existing modules (from the specific repo) with the list submitted by the user. Any module present in Firestore but *not* in the user's submission is deleted. This is the "unpublish" mechanism.
    4.  **Calculate Creations/Updates:** It iterates through the user's submitted list of modules.
        - If a module already exists in Firestore, its document is updated with the latest configuration.
        - If a module does not exist, a new document is created.
    5.  **Cache Invalidation:** After the database operations are complete, it calls `clearPublishDataCache()` and `clearModuleCache()`. This is part of a broader strategy where the frontend is responsible for refetching data after a mutation.
- **Output:** Returns a status code indicating success or failure.
- **HTTP `DELETE` Handler (`deleteModule`):**
    1.  **Authorization:** Verifies the user is an Admin or a Partner.
    2.  **Validation:** Ensures a `moduleId` is provided in the request query.
    3.  **Ownership Check:** Before deleting, it fetches the module from Firestore. If the user is a Partner, it verifies that the module's `partnerId` matches the user's UID. Admins can delete any module.
    4.  **Deletion:** Removes the specified module document from Firestore.
    5.  **Cache Invalidation:** Clears all relevant server-side caches to ensure the change is reflected immediately.

## 4. Deep Dive: Answering Key Questions

### 4.1. Selecting Modules for Publishing - How is this implemented?

1.  **Source Discovery:** The `/api/publish/data` endpoint calls utility functions (`getGitHubModulesForAdmin` or `getPartnerGitHubModulesWithSettings`) that use the GitHub API to list the directories in the root of the configured repository. Each directory is considered a potential module.
2.  **UI Representation:** The `Publish.tsx` component receives this list (`availableModules`) and renders a `PublishModule` component for each one.
3.  **State Tracking:** A local state array (`arrayModules` in `Publish.tsx`) stores the `name` of each module the user has selected. Clicking a module's button adds or removes its name from this array.
4.  **Comparison:** The component also receives the list of `publishedModules` from the API. This is used to determine the initial state of the selection and whether the final action should be labeled "Publish" or "Update".

### 4.2. Updating Module Configuration - How is this implemented?

Module configuration (the `variables` field) is **not** stored or edited directly in the Publish UI. The platform treats the Git repository as the single source of truth for module configuration. The update process is therefore implicit:

1.  **On-Demand Fetching:** When the user clicks "Publish" or "Update" in the `Publish.tsx` component, the `handlePublish` function is triggered.
2.  **Targeted API Call:** Before sending the data to the core `/api/modules` endpoint, the frontend makes a GET request to `/api/github/variables`. This request is specifically for the modules the user has selected.
3.  **File Reading:** The `/api/github/variables` endpoint reads the Terraform variable definition files (e.g., `variables.tf.json`) from the corresponding module directories in the Git repository.
4.  **Payload Assembly:** The `handlePublish` function then assembles the final payload, combining the module names with the freshly fetched variable configurations.
5.  **Saving to Firestore:** This complete payload is sent to `POST /api/modules`, which saves the entire module object, including the latest variables, to Firestore.

Therefore, to update a module's configuration, a user must first push the changes to the relevant files in the Git repository and then re-publish the module through the UI.

### 4.3. Saving Updated Configuration - What happens when this is performed?

When the "Publish" or "Update" button is clicked and the `handlePublish` function executes successfully, the following sequence of events occurs:

1.  **API Request:** A `POST` request is sent to `/api/modules` (or `/api/partner/modules`) with the list of selected modules and their full, freshly fetched variable configurations.
2.  **Database Synchronization:** The backend performs the sync logic described in section 3.3:
    - **Deletes:** Modules no longer selected by the user are deleted from Firestore.
    - **Updates:** Existing modules are overwritten with the new configuration.
    - **Creates:** New modules are saved as new documents in Firestore.
3.  **Server-Side Cache Invalidation:** The `/api/modules` endpoint programmatically calls functions to clear any server-side caches related to modules (`clearModuleCache()`) and the publish data endpoint (`clearPublishDataCache()`).
4.  **Client-Side Data Refetch:** The frontend's `handlePublish` function, upon receiving a successful `200 OK` response, uses the `refreshCache` hook (which in turn calls `queryClient.refetchQueries`) to trigger a fresh data fetch from the server. This ensures the UI has the most up-to-date information.
5.  **UI Feedback and Redirect:**
    - A success notification is displayed to the user.
    - The local state tracking selected modules is cleared.
    - The user is programmatically redirected to the `/deploy` page, where they can immediately see the result of their action and use the newly published or updated modules.

**Failure Outcome:** If any part of this process fails (e.g., the GitHub API is unreachable, Firestore write fails), the `axios` call in the frontend will throw an error. The `catch` block in `handlePublish` will then trigger an error notification in the UI, and the process is halted. The user's selection remains, allowing them to retry the action.
