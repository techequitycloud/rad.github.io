# Project Invoices Feature

## Overview
The **Project Invoices Feature** provides a comprehensive mechanism for users to evaluate and account for monthly invoice payments. It aggregates billing data from Google BigQuery and presents it in a user-friendly interface, allowing for detailed cost analysis and reporting.

## Key Features
- **Monthly Billing Analysis:** View detailed cost breakdowns by project for specific invoice months.
- **Role-Based Access Control (RBAC):** Data visibility is strictly governed by user roles (Finance/Admin vs. Partner/User).
- **Cost & Credit Calculation:** Displays total costs, applied credits (GCP discounts), and platform-specific credit debits.
- **Data Export:** Supports exporting invoice data to CSV for external processing.
- **Optimized Performance:** Uses server-side pagination and caching for efficient handling of large datasets.

## User Roles and Access

### Finance (Admin)
- **Scope:** Full visibility into all projects within the organization or configured folder.
- **Capabilities:**
  - View "GCP Discounts" (Total Credits) column.
  - Access billing data for any project in the scope.

### Partners and Users
- **Scope:** Restricted visibility. Can only view data for projects they have explicit access to.
- **Access Determination:** Access is granted based on three criteria:
  1.  **Deployment Origin:** Projects created via modules deployed by the user (`deployedByEmail` in Firestore).
  2.  **Ownership:** Projects where the user is listed as an owner (`variables.owner_users` in Firestore).
  3.  **IAM Permissions:** Projects where the user has IAM permissions (verified via Cloud Asset Inventory).

## Technical Implementation

### Frontend Architecture
The feature is implemented primarily in the `MonthlyInvoiceTab` component (`rad-ui/webapp/src/components/MonthlyInvoiceTab.tsx`).

- **Components:**
  - `InvoiceMonthSelector`: Allows users to select the billing period (YYYYMM).
  - `PaginationControls`: Handles large datasets via server-side pagination.
- **State Management:** Utilizes `@tanstack/react-query` for efficient data fetching, caching, and state synchronization.
- **Security:** Implements rigorous input sanitization (`sanitizeString`) and CSV sanitization (`sanitizeCSVValue`) to prevent XSS and CSV injection attacks.

### Backend Architecture
The backend logic resides in `rad-ui/webapp/src/pages/api/invoices/index.ts`.

- **Data Source:** Queries the Google Cloud Billing export table in BigQuery defined by the `BIGQUERY_BILLING_TABLE` environment variable.
- **Logic:**
  - **Discovery:** Dynamically builds a list of accessible project IDs for non-admin users using parallel lookups in Firestore and Cloud Asset Inventory.
  - **Aggregation:** Calculates:
    - `Total Cost`: Sum of costs from billing export.
    - `Total Credits`: Sum of credits (e.g., discounts, sustained use) unnested from the billing data.
    - `Net Cost`: Total Cost + Total Credits.
  - **Performance:** Executes "Count" and "Data" BigQuery queries in parallel to speed up response times.

## Data Fields

| Field | Description | Visible To |
|-------|-------------|------------|
| **Project Name** | The display name of the GCP project. | All |
| **Project ID** | The unique identifier of the GCP project. | All |
| **Credit Debit** | The calculated platform cost in credits (`Total Cost * Credits Per Unit`). | All |
| **Total Cost** | The raw cost from GCP billing (in currency). | All |
| **GCP Discounts** | The total value of GCP credits/discounts applied. | Admin Only |

## Usage Workflow

1.  **Navigate:** Go to the **Billing** page and select the **Monthly Invoice** tab.
2.  **Select Month:** Use the dropdown to choose a specific invoice month (e.g., "2023-10").
3.  **Fetch Data:** Click "Fetch Project Invoice" to retrieve data from BigQuery.
4.  **Analyze:** Review the table for project-level cost details. Use pagination controls to navigate through records.
5.  **Export:** Click "Export to CSV" to download the current dataset for offline analysis.
