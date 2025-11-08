import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Global Settings

The Global Settings interface provides administrators with centralized control over the platform's operational parameters. This guide covers all available settings and their impact on platform behavior.

## Accessing Settings

Navigate to the **Admin** page from the main navigation (visible only to administrators). The settings are organized into logical sections using a multi-step form interface.

## Deployment Settings

### Deployment Scope

**Enable Folder Scope**: Controls the scope of deployments and queries.

- **When Enabled**: Project and billing queries are restricted to the Google Cloud folder ID specified in the Client Folder ID setting
- **When Disabled**: Queries run against the entire Google Cloud organization

**Client Folder ID**: The Google Cloud folder ID to use when folder scope is enabled. This restricts visibility and operations to resources within this folder.

**Use Case**: Enable folder scope for multi-tenant deployments or when you want to isolate different business units or customers.

### Retention and Cleanup

**Retention Period**: Determines how long deployment history is kept.

Options:
- 30 days
- 90 days
- 180 days
- 365 days
- Never delete

When a retention period is set, a cleanup process runs periodically and deletes deployment records and their associated Google Cloud Storage artifacts that are older than the specified period.

**Cleanup Schedule**: Configures when the automated cleanup process runs.

Options:
- **Daily**: Runs every day at midnight
- **Weekly**: Runs every Sunday at midnight
- **Monthly**: Runs on the 1st day of each month at midnight

The schedule uses Cloud Scheduler to provide reliable, periodic execution.

**Cleanup Now**: Manually trigger the deployment cleanup process immediately. This deletes all deployments older than the configured retention period without waiting for the scheduled run.

## Credit System Settings

### Enable Credits

**Purpose**: Master toggle for the credit system.

When enabled:
- Module cards display credit costs
- Deployment costs are deducted from user balances
- Users with insufficient credits are blocked from deploying
- Credit-related UI elements are visible

When disabled:
- All users can deploy without credit restrictions
- Credit costs are not displayed or tracked
- Billing features are hidden

### Enable Subscription

**Purpose**: Controls visibility of subscription-related features.

When enabled:
- "Subscription Tiers" tab is visible to admins in the billing section
- "Buy Credits" tab is visible to non-admin users
- "Project Costs", "Deployment Revenue", and "Project Invoices" tabs are visible to admins
- Users can purchase credits and subscribe to tiers

When disabled:
- Subscription and purchase features are hidden
- Only awarded credits are available

## Access Control Settings

### Private Mode

**Purpose**: Controls data visibility and user onboarding.

**Data Visibility**:
- **When Enabled**: Partner users can see all cost and invoice data (like admins)
- **When Disabled**: Partners can only see data for their own deployments

**User Onboarding**:
- **When Enabled**: Users cannot self-enroll and must be manually added to the rad-users Google Group
- **When Disabled**: New users can self-enroll and are automatically added to the rad-users group

**Use Case**: Enable private mode for enterprise deployments where you want controlled access and full partner visibility.

## Notification Settings

### Enable Notification

**Purpose**: Controls whether email notifications are sent for deployment events.

When enabled:
- Emails are sent when deployments are created
- Emails are sent when deployments are deleted
- Notifications go to the user who initiated the deployment
- Additional recipients listed in trusted_users and owner_users fields receive notifications

When disabled:
- No deployment notifications are sent
- Users must manually check deployment status

### Mail Server Configuration

**Mail Server Email**: The email address used to send all platform emails, including:
- Deployment notifications
- Support request responses
- Low credit alerts
- System notifications

**Mail Server Password**: The password for the mail server email account. This is stored securely in Google Cloud Secret Manager.

**Support Email**: The email address that receives messages sent from the "Send Message" form on the Help page.

**Configuration Requirements**:
- Use an email account that supports SMTP
- Ensure the account has appropriate sending limits
- Configure SPF and DKIM records for deliverability
- Test email delivery after configuration

## Implementation Details

### Settings Storage

**Firestore**: General application settings are stored in the "settings" collection in Firestore, scoped by GCP project ID.

**Secret Manager**: Sensitive data (mail server password) is stored securely in Google Cloud Secret Manager.

**Caching**: Settings are cached in memory for performance. The cache is cleared automatically when settings are updated.

### Settings Propagation

When settings are saved:

1. General settings are saved to Firestore
2. Sensitive data is saved to Secret Manager
3. The in-memory settings cache is cleared
4. A Pub/Sub message is published to notify other services
5. Changes take effect immediately across the platform

### Validation

The settings form includes validation:

- **Required Fields**: Marked with asterisks and must be filled
- **Format Validation**: Email addresses, numbers, and other formats are validated
- **Dependency Validation**: Some fields are only shown when related settings are enabled
- **Error Messages**: Clear error messages guide administrators to correct issues

## Best Practices

### Deployment Settings

**Retention Period**: Balance storage costs with audit requirements. Consider:
- Compliance requirements for log retention
- Storage costs for long retention periods
- Need for historical deployment analysis

**Cleanup Schedule**: Choose based on deployment frequency:
- Daily for high-volume platforms
- Weekly for moderate usage
- Monthly for low-volume or development environments

### Credit Settings

**Gradual Rollout**: When enabling credits for the first time:
1. Start with generous signup credits
2. Monitor user feedback and usage patterns
3. Adjust pricing and costs based on actual infrastructure expenses
4. Communicate changes clearly to users

**Subscription Strategy**: Design subscription tiers that:
- Cover common usage patterns
- Provide clear value at each tier
- Encourage users to subscribe rather than make one-time purchases

### Access Control

**Private Mode**: Enable for:
- Enterprise deployments with strict access control
- Multi-tenant environments
- Platforms where partners need full visibility

**Self-Enrollment**: Disable when:
- You need to vet users before granting access
- Compliance requires controlled access
- You want to limit platform usage to specific organizations

### Notifications

**Email Configuration**: 
- Use a dedicated email account for platform notifications
- Monitor the account for bounces and delivery issues
- Set up email authentication (SPF, DKIM, DMARC)
- Test notifications after configuration changes

**Notification Strategy**:
- Enable notifications for production environments
- Consider disabling for development to reduce noise
- Provide users with notification preferences in their profiles

## Troubleshooting

### Settings Not Saving

**Check Permissions**: Ensure your admin account has appropriate Firestore and Secret Manager permissions

**Validate Input**: Review error messages for validation failures

**Check Logs**: Review Cloud Logging for backend errors

**Clear Cache**: Try clearing your browser cache and reloading

### Emails Not Sending

**Verify Credentials**: Ensure mail server email and password are correct

**Check SMTP**: Verify the email account supports SMTP and has it enabled

**Review Logs**: Check Cloud Logging for email sending errors

**Test Connectivity**: Ensure the platform can connect to the mail server

### Changes Not Applying

**Wait for Propagation**: Settings changes may take a few seconds to propagate

**Clear Cache**: The platform clears its cache automatically, but you may need to refresh your browser

**Check Pub/Sub**: Verify that Pub/Sub messages are being published and received

**Restart Services**: In rare cases, services may need to be restarted to pick up changes
`;

export default function Settings() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
