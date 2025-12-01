# Deployments Feature Implementation

This document details the implementation of the Deployment feature in the RAD platform, reflecting the current state of the codebase.

## Overview

The deployment feature allows users to provision modules (infrastructure-as-code templates) to Google Cloud. It supports modules from the platform's central repository ("Platform Modules") as well as private modules from partners ("Partner Modules"). The feature includes a full lifecycle management system: provisioning, monitoring (logs/status), updating, and deletion.

## User Roles & Permissions

*   **User**: Can deploy Platform Modules and their own organization's modules (if applicable). Can view and manage their own deployments.
*   **Partner**: Can publish and deploy their own private modules. Can view and manage their own deployments.
*   **Admin / Support**: Can view all deployments across the platform. Can manage system-wide settings like retention periods.

## Architecture

The deployment system is built on a serverless architecture:

1.  **Frontend (React/Next.js)**: Provides the UI for browsing modules, configuring variables, and managing deployments.
2.  **Backend (Next.js API)**: Handles business logic, input validation, credit checks, and database interactions.
3.  **Database (Firestore)**: Stores module definitions, deployment state, and user data.
4.  **Infrastructure Orchestration**:
    *   **Cloud Build**: Executes the actual deployment (Terraform plan/apply).
    *   **Pub/Sub**: Decouples the API from the long-running build process.
    *   **Cloud Functions**: Handles post-deployment status updates and notifications (e.g., `notification_status`).

## Frontend Implementation

### 1. Module Selection (`src/routes/Deploy.tsx`)
*   **Purpose**: Lists available modules for deployment.
*   **Key Features**:
    *   **Tabs**: Separates "Platform Modules" and "Partner Modules".
    *   **Search**: Client-side filtering by module name.
    *   **Sorting**: Pinned modules first, then by deployment count, rating, and name.
    *   **Validation**: Automatically detects and cleans up misconfigured modules (e.g., missing variables) during fetch.
    *   **Stats**: Displays total deployment count and user credit balance.

### 2. Provisioning Configuration (`src/routes/ProvisionModule.tsx`)
*   **Purpose**: A form to configure variables for a selected module before deployment.
*   **Key Features**:
    *   **Dynamic Form**: Renders inputs based on the module's variable definitions (fetched from `/api/github/...`).
    *   **Validation**: Uses a `CreateForm` component (and `Formik`/`yup` internally) to validate inputs against constraints.
    *   **Credit Check**: Displays the credit cost and validates if the user has sufficient credits (if applicable).

### 3. Deployment List (`src/routes/Deployments.tsx`)
*   **Purpose**: Displays a list of deployments.
*   **Key Features**:
    *   **Role-Based View**:
        *   **Standard Users**: See "My Deployments" (their own).
        *   **Admins/Support**: See "My Deployments" and "All Deployments" tabs.
    *   **Client-Side Search**: Allows filtering deployments by name, ID, or email.
    *   **Pagination**: Handles large lists efficiently (though search is currently client-side on the fetched page set).
    *   **Real-time Updates**: Uses a custom hook `useDeployments` (likely wrapping a Firestore listener) for live status updates.

### 4. Deployment Details (`src/routes/DeploymentDetails.tsx`)
*   **Purpose**: Detailed view of a single deployment.
*   **Key Features**:
    *   **Status Indicators**: Real-time build status (Queued, Working, Success, Failure).
    *   **Tabs**:
        *   **Outputs**: Terraform outputs (only on success).
        *   **Build Status**: Live logs from Cloud Build.
        *   **Builds**: History of previous builds/updates for this deployment.
    *   **Actions**: Update (re-deploy with new variables), Delete (destroy resources), Purge (remove record after destruction).
    *   **Polling**: Polls `/api/deployments/[id]/status` for updates during active builds.

## Backend Implementation

### 1. Deployment Management API (`/api/deployments/index.ts`)

#### GET /api/deployments
*   **Functionality**: Lists deployments with server-side pagination, sorting, and filtering.
*   **Optimization**:
    *   **Module Name Resolution**: Efficiently resolves `moduleId` to `moduleName` using a batching strategy (Firestore `in` queries) to avoid N+1 query performance issues.
    *   **Filtering**: Supports filtering by `userId` (for "My Deployments") and simple text filtering on the `module` field.

#### POST /api/deployments
*   **Functionality**: Initiates a new deployment.
*   **Workflow**:
    1.  **Validation**: Checks for required fields (`deployedByEmail`, `module`) and verifies the user exists.
    2.  **Module Resolution**: Finds the module by ID or Name. Validates `source` (Admin vs. Partner) to ensure correct access.
    3.  **Variable Merging**: Merges user-provided variables with module defaults.
    4.  **Credit Logic (Transactional)**:
        *   Calculates cost (`credit_cost` variable).
        *   Checks `require_credit_purchases` flag.
        *   Verifies user balance (`creditAwards` + `creditPurchases`).
        *   **Crucial**: Throws specific errors (`INSUFFICIENT_PURCHASED_CREDITS`, `INSUFFICIENT_TOTAL_CREDITS`) if funds are low.
    5.  **State Creation**: Creates a deployment document in Firestore with status `QUEUED`.
    6.  **Trigger Build**: Publishes a message to Pub/Sub (default topic or inferred) to trigger the infrastructure pipeline.
    7.  **Notification**: Sends a "Provisioning" email.

#### DELETE /api/deployments
*   **Functionality**: Soft-deletes deployments and triggers resource destruction.
*   **Workflow**:
    1.  **Verification**: Checks if the deployment exists and isn't already being deleted.
    2.  **Trigger Destruction**: Publishes a message to the **`rad-topic-destroy`** Pub/Sub topic.
    3.  **Update Status**: Sets status to `DELETING`.
    4.  **Notification**: Sends a "Deleting" email.

### 2. Status API (`/api/deployments/[id]/status.ts`)
*   **Functionality**: Proxies status requests to the Google Cloud Build API.
*   **Details**: Returns the status of the most recent build and specifically extracts the status of the Terraform "Apply" step.

### 3. Cleanup API (`/api/deployments/cleanup.ts`)
*   **Functionality**: Admin-only endpoint to permanently remove old deployment records.
*   **Logic**: Uses the `retentionPeriod` setting to determine which soft-deleted records to purge.

## Key Logic & Considerations

*   **Credit System**: The platform distinguishes between "Awarded" (free) and "Purchased" credits. Some modules (Partner modules) may strictly require purchased credits. The logic is handled transactionally in `POST /api/deployments`.
*   **Security**:
    *   **RBAC**: All endpoints are protected by `withAuth`.
    *   **Input Validation**: Strict type checking and sanitization on inputs (e.g., `deployId` regex validation in `DeploymentDetails`).
    *   **Secret Management**: GitHub tokens for private modules are retrieved from Secret Manager (`git-access-token` or `partner-github-token-*`) and passed securely to the build process.
*   **Concurrency**: The creation process uses UUIDs for `deploymentId` and `buildId` to prevent collisions.
*   **Error Handling**: Detailed debug logging (via `utils/debug`) is implemented throughout the stack to trace issues in production.

## Data Model

### Deployment Object (Simplified)
```typescript
interface IDeployment {
  id: string;              // Firestore Doc ID
  deploymentId: string;    // User-facing short ID (4 chars)
  module: string;          // Module ID
  moduleName: string;      // Cached Module Name
  status: DEPLOYMENT_STATUS; // QUEUED, WORKING, SUCCESS, FAILURE, etc.
  deployedByEmail: string; // Owner
  variables: Record<string, any>; // Configuration
  githubRepoUrl?: string;  // For partner modules
  createdAt: Timestamp;
  deletedAt?: Timestamp;   // For soft deletes
  builds: IBuild[];        // History of builds
}
```
