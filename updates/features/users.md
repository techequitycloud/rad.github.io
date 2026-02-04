---
title: User Management
slug: /features/admin-user-management
---

# Users

This guide provides a comprehensive overview of how to manage users and roles within the platform. Management responsibilities are split between the **Platform UI** (for specific operational tasks) and **Google Groups** (for high-level access control).

## User Roles & Permissions

The platform utilizes a Role-Based Access Control (RBAC) system. The available roles and their capabilities are:

| Role | Description | Key Capabilities |
|------|-------------|------------------|
| **Admin** | System Administrator | Full access to all settings, global configuration, and user management. |
| **Finance** | Financial Controller | Access to the Billing dashboard, including Revenue, Costs, Invoices, and Credit Management. |
| **Support** | Customer Support | Ability to view all deployments and logs to assist users with troubleshooting. |
| **Partner** | Module Publisher | Ability to publish, update, and manage software modules. Access to partner-specific analytics. |
| **Agent** | Referral Partner | Access to referral codes and revenue tracking for referred users. |
| **User** | Standard User | Basic access to deploy modules and manage their own deployments. |

---

## Method 1: Managing Roles via Google Groups (Recommended)

For organizational security and ease of management, high-privilege roles (**Admin, Finance, Support, Agent, Partner**) are designed to be managed via your organization's Google Cloud Identity / Workspace Groups.

### How it Works
When a user logs in, the platform checks their membership in specific Google Groups. If they are a member, they are automatically granted the corresponding role for that session.

### Configuration Options
The platform checks for membership in the following default groups (configured via your system's environment variables):

*   **Admins:** `rad-admins@<your-domain>`
*   **Finance Team:** `rad-finance@<your-domain>`
*   **Support Team:** `rad-support@<your-domain>`
*   **Agents:** `rad-agents@<your-domain>`
*   **Partners:** `rad-partners@<your-domain>`
*   **General Users:** `rad-users@<your-domain>` (New users are added here automatically)

### Implementation Steps
To grant a role to a user:
1.  Navigate to your **Google Admin Console** (admin.google.com).
2.  Go to **Directory > Groups**.
3.  Select the group corresponding to the role (e.g., `rad-finance`).
4.  Add the user's email address as a member.
5.  **Outcome:** The user will have the new role immediately upon their next login.

---

## Method 2: Managing Users via the Platform UI

For day-to-day operations, specifically for managing **Partners** and **User Credits**, you can use the built-in **Credit Management** interface.

**Prerequisites:** You must have the **Admin** or **Finance** role to access this area.

### Accessing the Interface
1.  Log in to the platform.
2.  Click on **Billing** in the main navigation menu.
3.  Select the **Credit Management** tab.

### Available Actions

#### 1. Managing Partner Access
While Partner access can be granted via groups, it can also be toggled individually within the UI. This is useful for external partners who may not be in your organization's Google Groups.

*   **Steps:**
    1.  Use the **Search** bar to find the user by email.
    2.  Click the **Edit** button on the user's row.
    3.  Toggle the **Is Partner?** checkbox.
    4.  Click **Save**.
*   **Outcome:**
    *   **Checked:** The user is granted the **Partner** role. They will see the "Publish" tab in their navigation bar and can begin publishing modules.
    *   **Unchecked:** The user loses publishing privileges.

#### 2. Managing User Credits
You can manually adjust the credit balance for any user. This is often used for resolving billing disputes, granting goodwill credits, or setting up test accounts.

*   **Fields:**
    *   **Awards:** The balance of "free" or granted credits. These are typically consumed first.
    *   **Purchases:** The balance of credits the user has paid for.
    *   **Monthly Credits:** (Partners only) A recurring monthly credit allowance for partners to test their own modules without incurring costs.
*   **Steps:**
    1.  Click **Edit** on the user's row.
    2.  Enter the new values in the respective fields.
    3.  Click **Save**.
*   **Outcome:** The user's balance is updated instantly. They can immediately use these credits to deploy modules.

---

## Summary of Configuration Outcomes

| Action | Configuration Method | Outcome |
|--------|----------------------|---------|
| **Grant Admin Access** | Google Group (`rad-admins`) | User gains full system control. |
| **Grant Finance Access** | Google Group (`rad-finance`) | User gains access to Billing & Revenue dashboards. |
| **Grant Support Access** | Google Group (`rad-support`) | User can view all global deployments for debugging. |
| **Enable Partner Mode** | UI or Google Group | User can publish modules to the marketplace. |
| **Adjust Credits** | UI (Credit Management) | User's deployable balance is increased or decreased. |
