# Module Publishing Feature

This document describes the implementation of the Module Publishing feature on the platform. It allows Administrators and Partners to publish Terraform modules, making them available for users to deploy.

## Overview

The Publishing feature serves as the bridge between a Git repository (containing Terraform modules) and the platform's deployment catalog. It enables:

1.  **Admins** to publish "Platform Modules" available to all users.
2.  **Partners** to publish "Partner Modules" available to themselves (and potentially other users, depending on visibility settings).
3.  **Synchronization** of module metadata and variables from the Git repository to the platform's database (Firestore).

## User Roles & Permissions

Access to the publishing feature is strictly controlled via Role-Based Access Control (RBAC):

*   **Administrator (`isAdmin`)**:
    *   Can publish "Platform Modules" (`source: "admin"`).
    *   These modules are visible to **all users**.
    *   Uses the globally configured GitHub repository.
    *   Can overwrite any module.

*   **Partner (`isPartner`)**:
    *   Can publish "Partner Modules" (`source: "partner"`).
    *   These modules are visible to the partner and users with specific access.
    *   Uses the partner's personally configured GitHub repository.
    *   Cannot overwrite Platform Modules or other Partners' modules (name collision check).

*   **Support (`isSupport`)**:
    *   Has similar publishing capabilities to Partners for troubleshooting and assistance.

*   **User**:
    *   **Cannot** access the publishing interface.
    *   Can only *view* and *deploy* published modules.

## Architecture

The feature is built using a React frontend and a Next.js/Node.js backend with Firestore as the database.

### Frontend Components (`rad-ui/webapp/src/routes/Publish.tsx`)

*   **`Publish.tsx`**: The main route/controller. It manages the state of selected modules, handles the publishing flow, and renders the UI.
*   **`PublishModule.tsx`**: A reusable component that displays an individual module card with selection logic.
*   **`Search.tsx`**: Provides search-as-you-type functionality to filter the list of available modules.

### Backend API (`rad-ui/webapp/src/pages/api/`)

*   **`/api/publish/data`**: A Backend-for-Frontend (BFF) endpoint.
    *   Aggregates data from GitHub (available modules) and Firestore (currently published modules).
    *   Uses caching to optimize performance.
*   **`/api/publish`**: The core publishing endpoint.
    *   `GET`: Returns a list of published modules, filtered by user role.
    *   `POST`: Handles the creation, update, and deletion of modules. It performs validation, collision checks, and batch database updates.
*   **`/api/github/variables`**: Fetches the `variables.tf` content for selected modules from GitHub to parse configuration options.

### Data Model (`Firestore: modules`)

A published module is stored in the `modules` collection with the following key fields:

*   `name`: The name of the module (matches the folder name in the repo).
*   `source`: `"admin"` or `"partner"`.
*   `partnerId`: The UID of the publisher (if source is partner).
*   `githubRepoUrl`: The repository URL the module was sourced from.
*   `variables`: A map of configuration variables parsed from Terraform.
*   `projectId`: The GCP project ID.

## Publishing Workflow

1.  **Selection**:
    *   The user navigates to the "Publish" page.
    *   The system fetches the list of *directories* from the connected GitHub repository.
    *   Previously published modules are pre-selected.
    *   The user selects which modules they want to publish or unpublish.

2.  **Validation & Preparation**:
    *   The user clicks "Publish" or "Update".
    *   The frontend validates the user's email.
    *   **Fetch Variables**: The system fetches the `variables.tf` file for each selected module from GitHub (`/api/github/variables`).
    *   **Data Check**: It checks if any module requires specific "zero data" handling (empty defaults for complex types).

3.  **Submission**:
    *   The frontend sends a payload to `POST /api/publish` containing:
        *   `modules`: An array of module objects with names, variables, and publisher info.

4.  **Processing (Backend)**:
    *   **Security Check**: Verifies the user's role and configured repository.
    *   **Collision Check**: Ensures partners are not overwriting platform modules or other partners' modules.
    *   **Sync Logic**:
        *   **Create/Update**: Saves the submitted modules to Firestore.
        *   **Delete**: Identifies modules that were *previously* published by this user (from this repo) but are *missing* from the current submission, and deletes them. This ensures the platform stays in sync with the user's intent.

5.  **Completion**:
    *   On success, the frontend invalidates local caches.
    *   The user is redirected to the "Deploy" page to see their newly published modules.

## Security & Best Practices

*   **Input Sanitization**: All module names and inputs are sanitized to prevent injection attacks.
*   **Validation**: Strict validation of email formats, module name patterns, and payload structure.
*   **Least Privilege**: The system explicitly checks `isAdmin`, `isPartner`, or `isSupport` before allowing any write operations.
*   **Rate Limiting**: The API limits the number of modules processed in a single request.
