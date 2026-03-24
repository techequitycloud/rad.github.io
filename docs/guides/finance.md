import AudioPlayer from '@site/src/components/AudioPlayer';

# Finance Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/finance_guide.png" alt="Finance Guide" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/guides/finance_guide.m4a" title="Finance Quick Start Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/guides/finance_guide.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction

Welcome to the Finance Guide. This documentation is intended for users with the **Finance** role. This role provides specialized access to the **Billing** section of the application, as well as revenue reports and management capabilities for the platform's credit economy and subscription products.

## 2. Access & Permissions

As a Finance user, you have elevated access to the **Billing** section of the application. Your view includes data for **all users** and **all projects** across the organization, allowing for comprehensive auditing, financial reporting, and configuration of billing parameters. Your navigation bar shows **Billing** and **Help**.

## 3. Financial Management & Reporting

Navigate to the **Billing** page to access your toolset. The Billing page is organized into the following tabs. *Note: The Subscription Tiers tab is only visible when subscriptions are enabled by the administrator.*

### 3.1. Subscription Tiers
Manage the subscription products available to your users.
*   **Create & Edit:** Define new subscription tiers with specific pricing, credit allocations, and features.
*   **Payment Provider Integration:** Monitor the connection status with Stripe and Flutterwave.
*   **Management:** Update existing tiers or remove obsolete ones to keep your offerings current.

### 3.2. Credit Settings
Configure the global parameters of the platform's credit economy.
*   **Price Per Credit:** Exchange rate (e.g., 100 credits = $1).
*   **Sign-up Credits:** Configure the amount of free credits given to new users.
*   **Referral Credits:** Set the credit reward for successful user referrals.
*   **Maximum Referrals:** Cap the monthly referrals per user (-1 for unlimited).
*   **Credits Per Hour:** The base rate of credit consumption for running deployments.
*   **Refresh Interval:** The frequency (in hours) at which the system deducts credits.
*   **Low Balance Alerts:** Set the threshold for notifying users when their balance is low.
*   **Agent Revenue Share:** The percentage of revenue shared with referring agents.
*   **Partner Revenue Share:** The percentage of revenue shared with module partners.
*   **Dry Run Modes:** Admins can configure the system to run in "Dry Run" mode for critical financial operations (like monthly credit resets or partner payouts). This allows you to verify calculations and system behavior without affecting actual user balances.

### 3.3. Credit Management
Audit and adjust individual user credit balances.
*   **Search & Filter:** Quickly locate users by email.
*   **Edit Balances:** Manually award or deduct credits across these categories:
    *   **Awarded Credits:** Free credits given by the platform.
    *   **Purchased Credits:** Credits bought via Stripe or Flutterwave.
    *   **Partner Credits:** Monthly allowances for partners.
*   **Status Indicators:** View user roles (Admin, Partner) directly in the table.

### 3.4. Project Costs
Analyze historical spending trends.
*   **Date Range:** Select any custom date range to view costs.
*   **Filter:** Drill down by Module type to see which applications are driving costs.
*   **Source:** This data is pulled directly from the Google Cloud Billing export in BigQuery, ensuring it matches your cloud invoice.

### 3.5. Revenue Reports
Track the platform's incoming value ("True Revenue"), defined as deployment costs paid for with purchased credits.

*   **Partner Revenue:** See which partner-published modules are generating the most revenue and the revenue share allocated to partners.
*   **Agent Revenue:** Track commissions and revenue driven by the Agent referral program based on their referred users' deployments.

### 3.6. Project Invoices
This is your primary tool for monthly reconciliation.
*   **View:** Select a month to see a line-item breakdown of costs for every project.
*   **Details:** See the Project Name, ID, Total Cost (in currency), and the Credit equivalent.
*   **Export:** Download the invoice data as a CSV file for import into your external accounting software.

## 4. Help & Support

Visit the **Help** page for additional resources:

*   **Support Tab:** Contact support if you need assistance.
*   **Platform Demos Tab:** View demonstrations of platform features.
*   **Platform Workflows Tab:** Browse documented platform workflows.
*   **Platform Guides Tab:** Access user guides and documentation.
*   **Platform Features Tab:** Explore the platform's feature catalog.
