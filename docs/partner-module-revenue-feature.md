# Partner Module Revenue Feature

## Overview
The Partner Module Revenue feature allows partners to track the revenue generated from the modules they have published on the platform. This feature provides transparency into how much "true revenue" (paid credit usage) their modules are generating and calculates their share based on the platform's configuration.

## Key Features

### 1. Revenue Dashboard
Partners can access a dedicated **Module Revenue** view (located under the Revenue page). This dashboard provides a tabular view of all revenue-generating deployments associated with their modules.

**Data Displayed:**
*   **Module Name**: The specific module used.
*   **Created At**: Date and time of the deployment.
*   **Credit Cost**: The total credit cost of the deployment.
*   **Revenue**: The partner's calculated share of the revenue in the platform's currency.

### 2. "True Revenue" Calculation
The system distinguishes between **Free/Awarded Credits** and **Purchased Credits**. Revenue is only counted when a deployment consumes *purchased* credits.
*   Deployments covered by free credits generate **0 revenue**.
*   Deployments partially covered by free credits generate revenue only for the portion paid with purchased credits.

### 3. Revenue Share Calculation
The revenue displayed to the partner is calculated based on the global **Partner Revenue Share** percentage configured by administrators.
*   **Formula**: `Revenue Share = Gross Revenue (from purchased credits) * (Partner Revenue Share %)`

### 4. Filtering and Reporting
Partners can filter the revenue data to analyze specific performance metrics:
*   **Date Range**: Filter revenue by start and end dates.
*   **Module Filter**: View revenue for "All Modules" or drill down into a specific module.
*   **CSV Export**: Export the filtered revenue data to a CSV file for offline analysis and accounting.

## Technical Implementation

### Access Control
*   **Role-Based Access**: The feature is strictly protected. Partners can **only** view data related to modules they have published (`partnerId` match). They cannot see revenue from platform modules or other partners' modules.
*   **Finance/Admin View**: Administrators and Finance users have a global view and can see revenue across all partners and modules.

### Backend Logic (`/api/revenue`)
The revenue calculation engine performs the following steps:
1.  **Fetch Users**: Identifies relevant users (all users for Partners to detect global usage of their modules).
2.  **History Reconstruction**: Reconstructs the credit history for each user to accurately determine if a specific deployment was paid for with free or purchased credits at that point in time.
3.  **Filtering**: Applies security filters to ensure partners only see records for `deployment.module` matching their published list.

## Configuration
Administrators manage the `partnerRevenueShare` percentage in the system settings (`Variables`). This single setting applies globally to all partner revenue calculations.
