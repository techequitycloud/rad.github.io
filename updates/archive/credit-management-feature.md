# Credit Management Feature

## Overview

The Credit Management Feature allows Administrators and Finance users to manage the platform's credit economy. This includes awarding free credits, managing purchased credits, configuring automated credit awards (like sign-up bonuses), and adjusting user balances individually or in bulk.

The system distinguishes between different types of credits to accurately track revenue and costs.

## Credit Types

*   **Credit Awards (Free):** Credits granted to users for free (e.g., sign-up bonuses, manual awards). These are used to offset platform costs but do not count towards revenue.
*   **Credit Purchases:** Credits bought by users via the billing system. These represent actual revenue.
*   **Partner Credits:** Special credits allocated for partner activities.

## Management Capabilities

### 1. Individual User Management

Administrators and Finance users can manage credits for specific users via the **User Management** interface.

*   **Edit Balances:** You can manually set the exact amount of *Awards*, *Purchases*, and *Partner* credits for any user.
*   **Validation Range:** Credit values must be between **0** and **1,000,000**.
*   **Partner Status:** You can toggle a user's "Partner" status. Disabling this status automatically clears their Partner credits.
*   **Search:** Users can be searched by email to quickly find and adjust their records.

### 2. Bulk Credit Adjustment

The **Admin Credit Forms** dashboard allows for bulk adjustments across the entire user base.

*   **Global Awards/Deductions:** You can add (award) or remove (deduct) credits for **all users** simultaneously.
*   **Flexible Amounts:** Enter any amount (positive or negative) within the system limits.
*   **Safety Mechanisms:**
    *   **Confirmation:** Large adjustments require explicit text confirmation to prevent accidents.
    *   **Logging:** All bulk adjustments are logged in the audit system and trigger notifications to admins.

### 3. Automated Awards

The system can be configured to automatically award credits based on user actions:

*   **Sign-up Credits:** Automatically award a specific number of free credits when a new user registers. This can be a one-time bonus or configured to recur monthly.
*   **Referral Credits:** Award credits to users who refer new members to the platform.

## Configuration & Settings

Admins can fine-tune the credit economy through the **Credit Settings**:

*   **Price Per Credit:** Define the cost of a single credit unit for purchases.
*   **Low Credit Threshold:** Set the balance limit that triggers a "Low Credit" email alert to users.
*   **Revenue Share:** Configure the percentage of revenue shared with Agents and Partners.
*   **Refresh Interval:** Determine how often the system checks and updates project costs.

## Security & Auditing

*   **Role-Based Access:** Only users with the `Admin` or `Finance` role can access these credit management features.
*   **Audit Logs:** Critical actions, such as changing user permissions, deleting users, or performing bulk credit adjustments, are recorded in the `audit_logs` collection for security and compliance.
