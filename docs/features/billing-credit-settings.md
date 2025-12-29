# Credit Settings

The **Credit Settings** tab allows Administrators to configure global settings for the credit system. These settings control how credits are valued, how they are awarded upon signup, how they are shared, and how the billing system operates.

## Configuration Options

### 1. Global Credit Values

These settings define the fundamental value and costs associated with credits.

*   **Credits Per Unit:** Defines the monetary value of a single credit (e.g., $1.00 per credit). This conversion rate is used for calculating project costs and generating invoices.
*   **Credits Per Hour:** The default cost in credits per hour for running platform resources. This sets the baseline consumption rate for deployments.

### 2. User Incentives & Awards

These settings control the automatic distribution of free credits to users.

*   **Sign-up Credits:** The number of free "Award" credits automatically granted to new users when they register. Set this to 0 to disable sign-up bonuses.
*   **Monthly Credits:** A recurring amount of free "Award" credits granted to users at the start of each month. This is useful for providing a consistent free tier.
*   **Referral Credits:** The number of credits awarded to a user when someone they referred signs up and becomes active.
*   **Maximum Referrals:** The maximum number of successful referrals for which a user can receive credit awards. This prevents abuse of the referral system.

### 3. Revenue Sharing

These settings configure the percentage of revenue shared with different stakeholders.

*   **Agent Revenue Share:** The percentage of revenue (generated from credit purchases by referred users) that is allocated to the referring Agent.
*   **Partner Revenue Share:** The percentage of revenue (generated from deployments of a partner's module) that is allocated to the Partner who owns the module.

### 4. Operational Settings

These settings control the behavior of the background billing and notification systems.

*   **Low Credit Trigger:** The threshold at which a "Low Credit" email notification is sent to a user.
    *   When a user's total balance drops below this amount, the system sends an alert.
    *   Alerts are rate-limited (e.g., sent at most once every 24 hours) to prevent spam.
*   **Refresh Interval:** The frequency (in hours) at which the background billing job runs to calculate costs and deduct credits for running deployments.

### 5. Bulk Actions

*   **Adjust All Credits:** A powerful tool for Finance and Admin users to manually add or remove credits from **all users** in the system at once.
    *   This can be used for system-wide compensations, promotional drops, or corrections.
    *   You can specify whether the adjustment applies to "Award" (free) credits or "Purchase" credits.
    *   **Warning:** This is a critical operation. Large adjustments require a confirmation step and a reason for the audit log.

## How to Update Settings

1.  Navigate to the **Billing** page and click on the **Credit Settings** tab.
2.  Locate the setting you wish to change.
3.  Enter the new value in the input field.
4.  Click the **Save**, **Update**, or **Set Amount** button next to the setting.
5.  A success message will appear confirming the change.

## Impact of Changes

*   **Sign-up Credits:** Only affects users who register *after* the change is saved.
*   **Monthly Credits:** Will be applied during the next scheduled monthly credit distribution.
*   **Credits Per Unit:** Affects revenue calculations for *future* transactions. Historical data remains unchanged.
*   **Low Credit Trigger:** Applies immediately to the next scheduled check.
*   **Revenue Shares:** Applies to future revenue calculations.
