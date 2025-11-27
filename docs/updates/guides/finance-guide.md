# Finance User Guide

## 1. Introduction

Welcome to the Finance Guide. This documentation is intended for users with the **Finance** role. This role provides specialized access to financial data, invoices, and revenue reports, as well as management capabilities for the platform's credit economy and subscription products.

## 2. Access & Permissions

As a Finance user, you have elevated access to the **Billing** section of the application. Your view includes data for **all users** and **all projects** across the organization, allowing for comprehensive auditing, financial reporting, and configuration of billing parameters.

## 3. Financial Management & Reporting

Navigate to the **Billing** page to access your toolset.

### 3.1. Subscription Tiers
Manage the subscription products available to your users.
*   **Create & Edit:** Define new subscription tiers with specific pricing, credit allocations, and features.
*   **Stripe Integration:** Monitor the connection status with Stripe.
*   **Management:** Update existing tiers or remove obsolete ones to keep your offerings current.

### 3.2. Credit Settings
Configure the global parameters of the platform's credit economy.
*   **Cost Basis:** Set the **Price Per Credit** to determine the exchange rate between real currency and platform credits.
*   **Incentives:** Configure **Signup Credits** to welcome new users and **Low Balance Alerts** to notify users when they are running low.

### 3.3. Credit Management
Audit and adjust individual user credit balances.
*   **Search & Filter:** Quickly locate users by email.
*   **Edit Balances:** Manually award or deduct credits across three categories:
    *   **Awarded Credits:** Free credits given by the platform.
    *   **Purchased Credits:** Credits bought via Stripe.
    *   **Partner Credits:** Monthly allowances for partners.
*   **Status Indicators:** View user roles (Admin, Partner) directly in the table.

### 3.4. Project Costs
Analyze historical spending trends.
*   **Date Range:** Select any custom date range to view costs.
*   **Filter:** Drill down by Module type to see which applications are driving costs.
*   **Source:** This data is pulled directly from the Google Cloud Billing export in BigQuery, ensuring it matches your cloud invoice.

### 3.5. Revenue Reports
Track the platform's incoming value ("True Revenue"), defined as deployment costs paid for with purchased credits.

*   **Module Revenue:** See which products are generating the most revenue.
*   **User Revenue:** Audit revenue generation by specific users.
*   **Agent Revenue:** Track commissions and revenue driven by the Agent referral program.

### 3.6. Project Invoices
This is your primary tool for monthly reconciliation.
*   **View:** Select a month to see a line-item breakdown of costs for every project.
*   **Details:** See the Project Name, ID, Total Cost (in currency), and the Credit equivalent.
*   **Export:** Download the invoice data as a CSV file for import into your external accounting software.
