# Getting Started with Cyclos

This guide provides an overview of how to access and log in to your deployed Cyclos application for the first time.

## Prerequisites

Before you begin, ensure you have the following information from your deployment output or administrator:

1.  **Application URL**: The web address where your Cyclos instance is accessible (e.g., `https://cyclos-[id].run.app` or your custom domain).
2.  **Initial Admin Credentials**:
    *   **Username**: Typically `admin`.
    *   **Password**: This is auto-generated during deployment. You can retrieve it from Google Secret Manager (look for a secret named `cyclos-admin-password` or similar) or from the Terraform output if configured to display it.

## Step 1: Accessing the Application

1.  Open your web browser.
2.  Navigate to the **Application URL**.
3.  You should see the Cyclos login page.

## Step 2: Logging in as Admin

1.  On the login page, locate the login form.
2.  Enter the **Username** (e.g., `admin`).
3.  Enter the **Initial Password**.
4.  Click **Submit** or **Login**.

> **Note:** If you are unable to log in, verify that the application has fully started. It may take a few minutes after the initial deployment for the database initialization to complete.

## Step 3: Changing the Admin Password

For security reasons, you should change the auto-generated password immediately after your first login.

1.  Once logged in, go to the **Personal** menu (usually at the top right or in the user profile section).
2.  Select **Password** or **Change Password**.
3.  Enter the **Current Password**.
4.  Enter your **New Password** and confirm it.
5.  Click **Submit** to save your changes.

## Step 4: Exploring the Dashboard

After logging in, you will be presented with the Admin Dashboard. This is the central hub for managing your Cyclos network.

Key areas include:
*   **Users**: Manage members, admins, and brokers.
*   **Accounts**: View system accounts and transaction history.
*   **Settings/Configuration**: Configure global system settings, channels, and access rules.
*   **Reports**: Generate system reports.

## Next Steps

Now that you are logged in, you can proceed to specific workflows based on your role:

*   [Admin Workflows](admin.md) - For System and Network Administrators.
*   [Agent Workflows](agent.md) - For Brokers and Agents managing members.
*   [Finance Workflows](finance.md) - For managing accounts and fees.
*   [Partner Workflows](partner.md) - For business partners and merchants.
*   [Support Workflows](support.md) - For support operators.
*   [User Workflows](user.md) - For standard members.
