# Project Cost Feature

The Project Cost Feature provides a comprehensive view of the costs associated with deployed projects on the platform. It allows users to track expenses, converting dollar costs from Google Cloud BigQuery into platform credits.

## Overview

The feature is designed to provide transparency into project spending. It aggregates billing data from Google Cloud BigQuery and presents it to users, filtered by their permissions and roles.

Key capabilities include:
- **Cost Tracking:** View total costs for each project within a specified date range.
- **Credit Conversion:** Automatically converts dollar costs into platform credits based on a configurable exchange rate (`creditsPerUnit`).
- **Data Export:** Allows exporting cost data to CSV for external analysis.
- **Filtering:** Filter costs by specific modules and date ranges.
- **Role-Based Access Control (RBAC):** Ensures users only see costs for projects they are authorized to view.

## Implementation Details

### Frontend Components

The user interface is built using React and resides in `rad-ui/webapp/src/components/ProjectCosts.tsx`.

-   **`ProjectCosts.tsx`**: The main component responsible for:
    -   Fetching cost data via the `/api/costs` endpoint using React Query (`useQuery`).
    -   Displaying a filterable table of project costs.
    -   Handling date range and module selection.
    -   Implementing CSV export functionality with security sanitization.
    -   Converting monetary costs to credit debits using the `creditsPerUnit` setting.

### Backend API

The backend logic is implemented in `rad-ui/webapp/src/pages/api/costs/index.ts`.

-   **`/api/costs` Endpoint**:
    -   **Data Source**: Queries the Google Cloud BigQuery billing table (`process.env.BIGQUERY_BILLING_TABLE`).
    -   **Authentication**: Protected by `withAuth` middleware.
    -   **Authorization**:
        -   **Admins**: Have full access to all project data.
        -   **Finance Users**: Have full access within their organization or folder scope.
        -   **Partners (Private Mode)**: Have full access within their scope.
        -   **Standard Users/Partners**: Access is restricted to projects they have deployed (tracked in Firestore `deployments` collection) or projects they explicitly own (verified via Cloud Asset Inventory `searchAllIamPolicies` checking for `roles/owner`).
    -   **Caching**: Implements a 5-minute in-memory cache for project ownership checks to optimize performance.
    -   **Query Optimization**: Uses parameterized queries to prevent SQL injection and optimizes performance with pagination and window functions.

### Data Flow

1.  **User Interaction**: The user selects a date range and optional module filter in the UI.
2.  **API Request**: The frontend sends a GET request to `/api/costs` with the selected parameters.
3.  **Authorization Check**: The backend determines the list of project IDs the user is allowed to view.
4.  **BigQuery Execution**: The backend constructs and executes a BigQuery SQL query to aggregate costs for the authorized projects.
5.  **Response**: The aggregated data is returned to the frontend.
6.  **Display**: The frontend renders the data, calculating the "Credit Debit" value as `Total Cost ($) * Credits Per Unit`.

## Configuration

The feature relies on several environment variables and application settings:

-   **Environment Variables**:
    -   `BIGQUERY_BILLING_PROJECT_ID`: The project ID where the billing dataset resides.
    -   `BIGQUERY_BILLING_TABLE`: The full ID of the BigQuery table containing billing data.
    -   `BIGQUERY_BILLING_LOCATION`: The location of the BigQuery dataset.
    -   `GCP_ORG_ID` / `GCP_FOLDER_ID`: Defines the scope for Cloud Asset Inventory searches.

-   **Application Settings** (Firestore):
    -   `creditsPerUnit`: The conversion rate from currency units to platform credits.
    -   `private_mode`: Enables expanded access for partners.

## Security

-   **Least Privilege**: Users only see data for projects they own or deployed.
-   **Input Validation**: All inputs (dates, module names) are validated before processing.
-   **Output Sanitization**: CSV exports are sanitized to prevent formula injection attacks.
-   **Role-Based Access**: Strict enforcement of roles (Admin, Finance, Partner, User).
