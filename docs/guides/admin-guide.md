import AudioPlayer from '@site/src/components/AudioPlayer';

# Admin Guide

<img src="https://storage.googleapis.com/rad-public-2b65/guides/admin_guide.png" alt="Admin Guide" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/guides/admin_guide.m4a" title="Admin Quick Start Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/guides/admin_guide.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction

Welcome to the Administrator Guide for the Rapid Application Deployment (RAD) platform. As an administrator, you have full control over the platform's configuration, user management, billing, and deployment oversight. This guide will walk you through your key responsibilities and the tools available to you.

## 2. Platform Setup & Global Configuration

The **Setup** page is your command center for configuring the platform's behavior. It is a one-time setup wizard that can be revisited whenever you need to change global settings.

### 2.1. Accessing Settings
Navigate to the **Setup** link in the main navigation bar. Alternatively, you can access these settings by clicking the **Admin Settings** button on the "All Deployments" tab of the Deployments page.

### 2.2. Key Configurations

*   **Deployment Scope:** Decide whether the platform operates at the Google Cloud **Organization** level or within a specific **Folder**. This determines the scope of data visible in reports and the target for deployments.
*   **Features:** Enable or disable major modules:
    *   **Enable Credits:** Turns on the credit-based cost management system.
    *   **Enable Subscription:** (Requires Credits) Activates the subscription tier system and payment provider integration (Stripe and Flutterwave).
    *   **Enable Partner Modules:** Allows the platform to support "Partner Modules" from a separate GitHub organization (`partner_github_org`).
    *   **Private Mode:**
        *   **Enabled:** Access is restricted to authorized users only. New users cannot self-register and must be manually added by an administrator.
        *   **Disabled (Default):** Public registration is open. New users can sign up and access the platform automatically.
*   **Notification Settings:**
    *   **Email Configuration:** Configure the `email_service` (default: gmail), `smtp_host`, `smtp_port`, and the `mail_secret_name` (Secret Manager secret containing credentials) for system emails.
    *   **Slack Integration:** Set the `slack_webhook_url` to receive system alerts in a Slack channel.
    *   **Alert Emails:** Configure `alert_email` and `alert_from_email` for critical system notifications (e.g., via SendGrid using `sendgrid_api_key`).
*   **Cleanup & Retention:**
    *   **Retention Period:** Set a period (e.g., 90 days) to automatically delete old deployment records.
    *   **Grace Period:** The `deployment_cleanup_grace_period` (default: 7 days) determines how long a "deleted" deployment remains in a soft-delete state before permanent removal.
*   **Dry Run Modes (Testing):**
    *   **Monthly Credit Reset:** `credit_monthly_dry_run` simulates monthly credit resets without applying changes.
    *   **Partner Credit Awards:** `credit_partner_dry_run` simulates partner payouts.
    *   **Low Credit Notifications:** `credit_low_dry_run` simulates sending low balance alerts.

### 2.3. Jules AI Configuration
To enable the AI-powered module refinement features for yourself and the platform:
1.  Navigate to your **Profile** page (click your avatar in the top right).
2.  Scroll down to the **Admin Settings** section.
3.  Enter your **Jules API Key** and click Save.
4.  This enables the "Jules Refinement" tool on module cards, allowing you to use AI to improve Terraform code.

### 2.4. Platform Repository
Also in the **Admin Settings** section of your Profile:
*   Configure the **Platform GitHub Token** and **Platform GitHub Repository**.
*   This repository serves as the source for "Platform Modules" available to all users.

## 3. User Management

Manage your platform's users from the **Users** page (accessible via the main navigation).

### 3.1. Managing Users
*   **View Users:** See a searchable, paginated list of all registered users.
*   **Activate/Deactivate:** Toggle the "Active" checkbox to grant or revoke login access. Deactivating a user removes them from all access groups.
*   **Assign Roles:** Click the **Edit** button on a user row to toggle the following role checkboxes, then click **Save**:
    *   **User:** Standard access to deploy platform modules.
    *   **Partner:** Grants access to the "Publish" tab for deploying private modules and viewing "Partner Revenue".
    *   **Agent:** Grants access to "Agent Revenue" reporting for their referred users. *Note: This role checkbox is only visible when subscriptions are enabled.*
    *   **Finance:** Grants access to the "Billing" page for financial settings, subscription tiers, and reports. *Note: This role checkbox is only visible when subscriptions are enabled.*
    *   **Support:** Grants access to view "All Deployments" across the platform to assist with troubleshooting, but restricts access to sensitive settings.
*   **Note:** Admin accounts are marked with a badge. Use caution when modifying Admin accounts to prevent accidental lockouts.

## 4. Credit & Billing Management

The **Billing** page is your financial hub. **Note:** Access to the Billing page requires the **Finance** role. As an admin, you can assign this role to yourself or others via the Users page.

### 4.1. Subscription Tiers
*   Go to the **Subscription Tiers** tab.
*   **Create**, **Edit**, and **Delete** subscription packages.
*   Define the Name, Price, Payment Provider Price ID (Stripe or Flutterwave), and Credit amount for each tier.

### 4.2. Credit Settings
*   **Credit Settings:** Configure the economic model:
    *   **Price Per Credit:** Exchange rate (e.g., 100 credits = $1).
    *   **Sign-up Credits:** Free credits for new users. Can be configured to be a one-time bonus or a monthly recurring grant.
    *   **Referral Credits:** The amount of credits awarded to a referrer when a new user signs up using their referral code.
    *   **Maximum Referrals:** Cap the number of referrals a user can make per month. Set to -1 for unlimited.
    *   **Global Adjustments:** Grant/remove credits from *all* users.
    *   **Low Credit Notification Threshold:** Set a credit balance amount (e.g., 100). Users with a balance below this amount will receive an automated email notification (sent at most once every 24 hours).
    *   **Credits Per Hour:** The rate at which credits are consumed by active deployments.
    *   **Refresh Interval:** How often (in hours) the system checks active deployments and deducts credits.
    *   **Agent Revenue Share:** The percentage of "True Revenue" generated by a referred user that is allocated to the referring Agent.
    *   **Partner Revenue Share:** The percentage of "True Revenue" generated by a module that is allocated to the Partner who published it.
*   **Credit Management:** A dedicated table to manually adjust the "Awarded" or "Purchased" credit balance for individual users.

### 4.3. Financial Reports
*   **Project Costs:** Analyze historical spending trends across all deployments.
*   **Partner Revenue:** See which partner-published modules are generating the most "True Revenue". True Revenue is defined as the deployment costs that are paid for specifically with **Purchased Credits** (real money), excluding costs covered by free Awarded Credits.
*   **Agent Revenue:** Monitor commissions and revenue driven by your Agents based on their referred users' deployments.
*   **Project Invoices:** View and export monthly cost breakdowns for every project.

**True Revenue Calculation:** Revenue is calculated based on "True Revenue," which counts only deployments paid for with **Purchased Credits**. Deployments covered by free "Awarded Credits" (e.g., sign-up bonuses) are excluded from revenue totals to ensure accurate financial reporting.

## 5. Managing Deployments

You have complete visibility into all activity on the platform.

*   **All vs. My Deployments:** The **Deployments** page has tabs to view "All Deployments" (everyone's activity) or just "My Deployments" (your own). Only admins can switch between both tabs.
*   **Admin Settings:** The "Admin Settings" button in the "All Deployments" view provides quick access to global platform configuration.
*   **Search:** Use the search bar to find deployments by Module Name, Deployment ID, or User Email.
*   **Ratings:** View the 1-5 star ratings given by users to gauge user satisfaction with specific modules.
*   **Logs & Debugging:** Click on any Deployment ID to view its full build logs, status history, and configuration variables.
*   **Purge vs. Delete:**
    *   **Delete (Soft Delete):** This is the standard action. It marks the deployment for deletion, triggers a resource cleanup, but retains the record for the defined retention period.
    *   **Purge (Hard Delete):** This is a force-cleanup action. It immediately triggers an aggressive resource removal pipeline (`DEPLOYMENT_ACTIONS.PURGE`) and removes the deployment record once complete. Use this for stuck deployments or when immediate cleanup is required.

## 6. Publishing Platform Modules

You are responsible for the catalog of standard modules available to all users.

1.  **Configure Repo:** Ensure your Platform GitHub Repository is configured in your **Profile** (see section 2.4).
2.  **Publish:** Go to the **Publish** page. You will see a list of modules found in your repo.
3.  **Refining Modules with Jules:** Click the **Sparkles** icon on any module card to open the Jules AI Refinement tool. Jules can help you improve code, add documentation, or fix bugs before publishing.
4.  **Select & Save:** Select the modules you want to make public and click "Publish" (or "Update"). These will immediately appear on the "Deploy" page for all users.

## 7. Help & Communication

The **Help** page provides tools for communication and platform documentation, organized across multiple tabs:

*   **Support Tab:** As an admin, you can broadcast messages to all users or specific groups via the "Send Message" form.
*   **Platform Demos Tab:** View demonstration videos and showcases for platform features.
*   **Platform Workflows Tab:** Browse documented platform workflows.
*   **Platform Guides Tab:** Access user guides and documentation for each role.
*   **Platform Features Tab:** Explore and review the platform's feature catalog.

## 8. Profile & Notifications

Click your avatar in the top right to access your **Profile** page, where you can manage:

*   **Notification Settings:** Toggle **Deployment Notifications** and **Billing Notifications** on or off to control which email alerts you receive.
*   **Admin Settings:** Configure your Platform GitHub Token, Repository, and Jules API Key (see sections 2.3 and 2.4).
*   **Account Management:** View your account email. If needed, you can delete your account from this page (requires email confirmation).
*   **Theme:** Toggle between Light and Dark mode using the sun/moon icon in the navigation bar.
