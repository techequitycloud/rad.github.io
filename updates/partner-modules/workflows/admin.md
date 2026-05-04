# Admin Workflows

This document outlines the key workflows for **System Administrators** and **Network Administrators** in Cyclos. Admins are responsible for the overall configuration, security, and user management of the platform.

## User Management

### Creating a New User (Member)
1.  Navigate to **Users** in the main menu.
2.  Click **Registration** or **New Member**.
3.  Select the **Group** for the new user (e.g., "Member", "Business").
4.  Fill in the required profile fields (Name, Email, Login Name).
5.  Set an initial password or choose to send an activation email.
6.  Click **Submit** to create the user.

### Managing User Groups
1.  Go to **Settings** > **Users** > **Groups**.
2.  Here you can view, edit, or create new user groups.
3.  **Permissions**: Click on a group to edit its permissions. This controls what users in this group can do (e.g., make payments, view directory, manage products).
4.  **Save** any changes to apply them immediately.

### Blocking/Unblocking a User
1.  Search for the user in the **Users** section.
2.  Open the user's profile.
3.  Click the **Block** or **Unblock** action button.
4.  Provide a comment/reason if prompted.

## System Configuration

### Configuring Transaction Fees
1.  Navigate to **Settings** > **Accounts** > **Transaction Fees**.
2.  Click **New** to create a fee.
3.  Define the fee parameters:
    *   **Payer**: Sender or Receiver.
    *   **Amount**: Fixed amount or percentage.
    *   **Destination**: System account or specific user.
4.  Apply the fee to specific **Transfer Types**.

### Managing Access Channels
1.  Go to **Settings** > **Channels**.
2.  Enable or disable access channels (e.g., Web, Mobile, POS, API).
3.  Configure security settings for each channel (e.g., allow specific IP ranges).

## Network Management

### Global Settings
1.  Navigate to **Settings** > **General**.
2.  Update basic information like Application Name, Date Format, and Number Format.
3.  Configure global security settings (Password policy, Session timeout).

### Managing Currencies
1.  Go to **Settings** > **Accounts** > **Currencies**.
2.  View existing currencies or create new ones (if multi-currency is enabled).
3.  Set currency symbols and precision.

## Troubleshooting

### Viewing System Logs
1.  Navigate to **System** > **Logs** (if available in the UI) or **Alerts**.
2.  Review recent error messages or system alerts.
3.  For detailed technical logs, refer to the Cloud Logging in the Google Cloud Console.

### System Status
1.  Go to **System** > **Status**.
2.  Check the status of connected services (Database, Search Engine, external integrations).
