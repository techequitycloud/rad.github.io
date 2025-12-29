# Setup

The Platform Setup wizard allows administrators to configure core platform settings, including Google Cloud integration, billing features, data retention policies, and notification systems. This 4-step process ensures the platform is correctly tailored to your organization's needs.

To access the setup configuration, navigate to the **Settings** or **Admin** section of the dashboard. This feature is restricted to users in the **Admin Group**.

## Step 1: Organization & Scope

This step defines how the platform interacts with your Google Cloud environment.

| Field | Description | Type |
|-------|-------------|------|
| **Organization Id** | The Google Cloud Organization ID where resources will be managed. | String (Optional) |
| **Folder Id** | The Google Cloud Folder ID to scope operations to a specific folder within the organization. | String (Optional) |
| **Enable Folder Scope** | When enabled, all platform operations are limited to the specified `Folder Id`. Unchecking this allows operations across the entire organization. | Boolean |

**Outcome:** These settings determine the scope of visibility and control the platform has over your GCP resources. Using a Folder ID is recommended for compartmentalization.

## Step 2: Billing & Credits

Configure how the platform handles costs, user credits, and subscriptions.

| Field | Description | Type |
|-------|-------------|------|
| **Billing Account Id** | The Google Cloud Billing Account ID to associate with deployed resources. | String (Required) |
| **Enable Credits** | Activates the internal credit system. This allows users to "spend" credits on deployments. | Boolean |
| **Enable Subscription** | *Visible only when "Enable Credits" is checked.* Enables the subscription module, allowing users to purchase credit tiers via Stripe. | Boolean |

**Outcome:**
*   **Billing Account Id** is critical for tagging resources with the correct billing information.
*   Enabling **Credits** transforms the platform into a managed service where users track consumption.
*   Enabling **Subscription** allows for monetization or quota management via purchased tiers.

## Step 3: Data Management & Privacy

Manage data retention, cleanup policies, and access control.

| Field | Description | Type |
|-------|-------------|------|
| **Private Mode** | Restricts platform access exclusively to internal users. External partners or public users will be blocked. | Boolean |
| **Cleanup Schedule** | Determines how often the system checks for old deployment history to clean up. Options: *Daily, Weekly, Monthly*. | Dropdown |
| **Retention Period** | The duration to keep deployment history before deletion. Options: *30, 90, 180, 365* days. | Dropdown |
| **Enable Soft Delete** | When enabled, deleted records are kept in a "soft deleted" state for a grace period before permanent removal. | Boolean |
| **Enable Orphan Cleanup** | Automatically identifies and deletes orphaned records in the cloud storage bucket to save costs. | Boolean |
| **Notify Before Delete** | Sends email notifications to users before their records are permanently deleted. | Boolean |
| **Soft Delete Grace Period** | The number of days a record remains in the soft-delete state before permanent deletion (Default: 7). | Number |

**Outcome:** These settings help manage storage costs and compliance. **Private Mode** is essential for internal-only deployments. **Soft Delete** adds a safety layer against accidental data loss.

## Step 4: Notifications

Configure the email server for platform-wide notifications (e.g., deployment status, alerts).

| Field | Description | Type |
|-------|-------------|------|
| **Email Notifications** | Master switch to enable or disable all email notifications. | Boolean |
| **Support Email** | The email address displayed to users for support inquiries. | String |
| **Mail Server Email** | The email address used to send notifications (e.g., `noreply@yourdomain.com`). | String |
| **Mail Server Password** | The app password or credentials for the mail server email. This is stored securely in Google Secret Manager. | Password |

**Outcome:** Configuring a mail server allows the platform to send critical updates to users. The password is never stored in plain text and is handled via a secure API.

## Finalizing Setup

After completing all 4 steps, click **Submit** to save your configuration.
*   **Settings** are stored in the platform's database.
*   **Secrets** (like the mail server password) are securely stored in Google Secret Manager.
*   The application may require a refresh for all changes to take full effect across the UI.
