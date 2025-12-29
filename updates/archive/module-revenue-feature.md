# Module Revenue Feature

## Overview

The **Module Revenue** feature (internally referred to as `ProjectRevenue`) is a critical financial tool designed to calculate, track, and report the "True Revenue" generated from module deployments. Unlike simple cost tracking, this feature distinguishes between costs covered by free credits (awards) and those paid for by purchased credits (actual revenue).

This feature also handles commission and revenue sharing for **Agents** (referrals) and **Partners** (module authors).

## Key Concepts

### 1. True Revenue Calculation
The core logic resides in the backend API. "True Revenue" is defined as the credit cost of a deployment that is *not* covered by free/awarded credits.

*   **Chronological Deduction:** The system iterates through a user's deployments chronologically.
*   **Free Credit Exhaustion:** It first deducts the cost from the user's available `creditAwards` (free credits).
*   **Revenue Recognition:** Only when free credits are fully exhausted does the system begin to count deployment costs as revenue.
*   **Split Costs:** If a deployment's cost partially exhausts the remaining free credits, only the uncovered portion is counted as revenue.

### 2. Revenue Sharing & Commissions
The system calculates revenue shares based on the user's role and the context of the deployment:

*   **Agent Share:** Applied when a deployment is made by a user referred by the Agent (`user.referredBy === agent.email`). The share percentage is defined by `agentRevenueShare` in global settings.
*   **Partner Share:** Applied when a deployment uses a module published by the Partner (`module.partnerId === partner.id`). The share percentage is defined by `partnerRevenueShare` in global settings.

## Architecture

### Backend (`/api/revenue`)
*   **File:** `rad-ui/webapp/src/pages/api/revenue/index.ts`
*   **Functionality:**
    *   Fetches users, deployments, and credit transactions.
    *   Performs the "True Revenue" calculation logic.
    *   Applies role-based filtering and permission checks.
    *   Returns a list of revenue events.
*   **Filtering:** Supports filtering by date range (`startDate`, `endDate`), module list (`modules`), and user emails.

### Frontend Components
*   **Main Component:** `ProjectRevenue.tsx` (`rad-ui/webapp/src/components/ProjectRevenue.tsx`)
    *   Fetches data from `/api/revenue`.
    *   Displays revenue data in a paginated table.
    *   Provides filters for Date Range and Module.
    *   Supports CSV export of the data.
*   **Container Routes:**
    *   **Finance:** Accessed via `Billing.tsx` -> "Module Revenue" tab.
    *   **Agents/Partners:** Accessed via `Revenue.tsx` -> "Module Revenue" tab.

## Role-Based Access

| Role | View Scope | Revenue Value | Access Route |
| :--- | :--- | :--- | :--- |
| **Finance / Admin** | All deployments from all users. | 100% of True Revenue. | `/billing` |
| **Agent** | Deployments by users they referred. | Scaled by `agentRevenueShare`. | `/revenue` |
| **Partner** | Deployments of modules they own. | Scaled by `partnerRevenueShare`. | `/revenue` |

*Note: Users with multiple roles (e.g., Agent + Partner) see a combined view where applicable.*

## Data Models

### Settings (`Variables`)
*   `agentRevenueShare`: Percentage of revenue shared with agents.
*   `partnerRevenueShare`: Percentage of revenue shared with partners.
*   `creditsPerUnit`: Conversion rate for calculating monetary value from credits.

### User
*   `referredBy`: Email of the agent who referred the user.
*   `creditAwards`: Total free credits awarded to the user.
*   `creditPurchases`: Total credits purchased by the user.

### Module
*   `partnerId`: Identifies the partner who owns the module.

## Usage

1.  **Navigate** to the appropriate revenue tab based on your role (Billing for Finance, Revenue for Agents/Partners).
2.  **Select Date Range:** Choose a start and end date for the report.
3.  **Filter (Optional):** Select a specific module to narrow down the results.
4.  **View Data:** The table updates to show relevant deployments and the calculated revenue.
5.  **Export:** Click the "Export to CSV" button to download the report for offline analysis.
