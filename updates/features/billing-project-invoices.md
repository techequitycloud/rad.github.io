# Project Invoices (Admin View)

The **Project Invoices** tab allows Finance users to view and generate monthly invoice reports for all projects. This is essential for reconciliation and understanding the platform's monthly burn rate.

## Features

*   **Monthly Selection:** Select a specific month (e.g., "October 2023") to view data for that billing cycle.
*   **Invoice Generation:** Generates a detailed breakdown of costs for the selected month.
*   **User Association:** Maps project costs to specific users where possible.
*   **Export:** Ability to export the invoice data for accounting purposes.

## How to Use

1.  Navigate to the **Billing** page and click on the **Project Invoices** tab.
2.  Select the desired **Month** and **Year** from the dropdown menu.
3.  The system will query BigQuery for billing data associated with that month.
4.  A table will appear showing:
    *   Project ID
    *   User / Owner
    *   Total Cost
    *   Service Breakdown
5.  Use the **Export** button to download the data as a CSV or PDF (if configured).

## Notes

*   Data availability depends on the BigQuery export latency (typically 1-2 days).
*   This view shows the *actual* infrastructure cost incurred by the platform.
