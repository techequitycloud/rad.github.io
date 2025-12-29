# Your Profile

The **Your Profile** page is your central hub for managing your account settings, integrations, and notification preferences. This guide explains how to configure and use the features available on your profile page.

## Accessing Your Profile

To access your profile:
1.  Log in to the platform.
2.  Click on your user avatar (profile picture) in the top-right corner of the navigation bar.
3.  Select **Profile** from the dropdown menu.

## Profile Information

At the top of the page, you will see your basic profile information:
*   **Profile Picture**: Displayed from your authentication provider.
*   **Name**: Your display name.
*   **Email**: The email address associated with your account.

## Admin Settings

> **Note:** This section is only visible to users with **Admin** privileges.

Admins can configure platform-wide settings that affect all users.

### Platform GitHub Token
This token allows the platform to access the central repository where shared modules are stored.

1.  **Generate a Token**: Go to [GitHub Developer Settings > Personal access tokens](https://github.com/settings/tokens) and generate a new token (classic).
2.  **Select Scopes**: Ensure the token has `repo` access to read private repositories.
3.  **Enter Token**: Paste the token into the **Platform GitHub Token** field.
4.  **Save**: Click **Save Token**.

### Platform GitHub Repository
Once a token is configured, you can select the repository that the platform will use for its core modules.

1.  **Select Repository**: Choose the appropriate repository from the dropdown list.
2.  **Update**: Click **Update Repo** to save your selection.

### Jules API Key
The Jules API Key enables the AI-powered "Jules" features for the platform.

1.  **Enter Key**: Paste your Jules API Key into the field.
2.  **Update**: Click **Update Key** to save.

## Partner Settings

> **Note:** This section is only visible to users with the **Partner** role.

Partners can configure their own GitHub integration to publish and manage their own modules.

### GitHub Token
To publish modules from your own private or public repositories, you need to provide a GitHub Personal Access Token.

1.  **Generate a Token**: Go to [GitHub Developer Settings > Personal access tokens](https://github.com/settings/tokens) and generate a new token (classic).
2.  **Select Scopes**: Select the `repo` scope to allow the platform to list and access your repositories.
3.  **Enter Token**: Paste the token into the **GitHub Token** field.
4.  **Save**: Click **Save Token**.

### GitHub Repository
After saving your token, you can select which repository you want to use as the source for your modules.

1.  **Select Repository**: Use the dropdown to choose one of your GitHub repositories.
2.  **Update**: Click **Update Repo**.
    *   *Note: Selecting a repository will make its modules available for you to publish.*

### Jules API Key
Partners can provide their own Jules API Key to enable the Refinement Agent for their specific workflows.

1.  **Enter Key**: Paste your Jules API Key.
2.  **Update**: Click **Save Key** (or **Update Key**).

## Email Notification Settings

Manage which email notifications you want to receive from the platform.

*   **Deployments**: Receive emails about the status of your deployments (success, failure).
*   **Billing**: Receive emails related to billing events (if credits are enabled).

Toggle the checkboxes to your preference and click **Save Settings**.

## Deleting Your Account

> **Warning:** This action is destructive and cannot be undone.

If you wish to permanently remove your account and all associated data:

1.  Click the **Delete Account** button at the bottom of the page.
2.  A confirmation modal will appear.
3.  Confirm that you want to delete your account.

**Note:** Deleting your account will sign you out immediately.
