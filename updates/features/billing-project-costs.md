# Project Costs (Admin View)

The **Project Costs** tab within the Billing section provides a comprehensive view of infrastructure costs across the platform. Unlike the User view which shows only their own projects, the Admin view allows Finance users to audit costs for all projects and deployments.

## Features

*   **Global Cost View:** Aggregates costs from all user projects.
*   **BigQuery Integration:** Fetches accurate, historical billing data directly from Google BigQuery.
*   **Breakdown by Project:** See costs grouped by Google Cloud Project ID.
*   **Breakdown by Service:** See which Google Cloud services (e.g., Compute Engine, Cloud Storage) are driving costs.
*   **Date Filtering:** View costs for specific billing periods.

## How to Use

1.  Navigate to the **Billing** page and click on the **Project Costs** tab.
2.  The view defaults to the current month or a recent window.
3.  Use the controls to adjust the time range or filter by specific project IDs.
4.  Review the cost breakdown to identify high-spending projects or services.

## Data Source

This data is sourced from the configured BigQuery export of Cloud Billing data. It reflects the "True Cost" of the underlying infrastructure, which may differ from the "Credit Cost" charged to users (as credit costs are defined by the module price, while project costs are the actual GCP bill).
