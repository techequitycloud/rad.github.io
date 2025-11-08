import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Notification System

The RAD Platform includes a comprehensive notification system that keeps users informed about deployment events, billing activities, and system alerts through email notifications.

## Notification Types

### Deployment Notifications

**Deployment Created**: Sent when a new module deployment is initiated

- Recipient: User who created the deployment
- Additional Recipients: Users listed in trusted_users and owner_users fields
- Content: Deployment ID, module name, configuration summary
- Timing: Immediately after deployment is submitted

**Deployment Completed**: Sent when a deployment finishes successfully

- Recipient: User who created the deployment
- Additional Recipients: Trusted users and owners
- Content: Deployment ID, completion status, deployment outputs
- Timing: Immediately after Cloud Build completes successfully

**Deployment Failed**: Sent when a deployment encounters an error

- Recipient: User who created the deployment
- Additional Recipients: Trusted users and owners
- Content: Deployment ID, error summary, link to logs
- Timing: Immediately after Cloud Build reports failure

**Deployment Deleted**: Sent when a deployment is removed

- Recipient: User who created the deployment
- Additional Recipients: Trusted users and owners
- Content: Deployment ID, deletion timestamp
- Timing: Immediately after deletion is confirmed

### Billing Notifications

**Low Credit Alert**: Sent when a user's credit balance falls below the configured threshold

- Recipient: User with low balance
- Content: Current balance, threshold amount, link to purchase credits
- Timing: When balance drops below trigger amount

**Subscription Renewal**: Sent when a subscription is renewed

- Recipient: Subscriber
- Content: Renewal amount, credits added, next billing date
- Timing: After successful payment processing

**Payment Failed**: Sent when a subscription payment fails

- Recipient: Subscriber
- Content: Failure reason, retry schedule, update payment link
- Timing: After Stripe reports payment failure

**Credits Purchased**: Sent when a one-time credit purchase is completed

- Recipient: Purchaser
- Content: Amount paid, credits added, transaction ID
- Timing: After successful Stripe payment

### Administrative Notifications

**User Onboarding** (Private Mode): Sent to admins when a new user attempts to access the platform

- Recipient: Platform administrators
- Content: User email, registration timestamp, approval link
- Timing: When user first logs in

**System Alerts**: Sent for critical system events

- Recipient: Platform administrators
- Content: Alert type, severity, recommended action
- Timing: When system detects critical conditions

## Configuration

### Enabling Notifications

Administrators control notification settings through the Admin Settings page:

**Enable Notification**: Master toggle for the entire notification system

- **When Enabled**: All configured notifications are sent
- **When Disabled**: No notifications are sent (except critical system alerts)

### Mail Server Setup

Configure email sending through the Admin Settings:

**Mail Server Email**: The "from" address for all platform emails

- Use a dedicated email account for platform notifications
- Ensure the account has appropriate sending limits
- Configure SPF and DKIM records for deliverability

**Mail Server Password**: Securely stored in Google Cloud Secret Manager

- Required for SMTP authentication
- Encrypted at rest
- Never displayed in the UI after initial setup

**Support Email**: The address that receives support requests

- Displayed on the Help page
- Receives messages from the "Send Message" form
- Should be monitored regularly for user inquiries

### SMTP Configuration

The platform uses SMTP to send emails. Ensure your mail server:

- Supports SMTP authentication
- Allows connections from Google Cloud Platform IP ranges
- Has sufficient sending limits for your user base
- Is configured for TLS/SSL encryption

## User Preferences

### Email Notification Settings

Users can control which notifications they receive through their Profile page:

**Deployment Notifications**: Toggle to receive deployment status updates

- Enabled by default
- Affects deployment created, completed, failed, and deleted notifications
- Does not affect notifications where user is listed as trusted_user or owner

**Billing Notifications**: Toggle to receive billing and credit updates

- Enabled by default
- Affects low credit alerts, subscription renewals, and payment notifications
- Critical billing notifications (e.g., payment failures) are always sent

### Managing Preferences

Users can update their notification preferences at any time:

1. Navigate to Profile page
2. Locate Email Notification Settings section
3. Toggle desired notification types
4. Changes are saved automatically
5. Preferences take effect immediately

## Notification Content

### Email Structure

All platform emails follow a consistent structure:

**Header**: Platform logo and name

**Subject Line**: Clear, descriptive subject indicating notification type

**Body**: 
- Greeting with user's name
- Clear explanation of the event
- Relevant details (IDs, amounts, timestamps)
- Call-to-action links (view deployment, purchase credits, etc.)
- Support contact information

**Footer**: 
- Unsubscribe instructions
- Privacy policy link
- Platform contact information

### Personalization

Notifications are personalized with:

- User's name (from authentication profile)
- Specific deployment or transaction details
- Relevant timestamps in user's timezone
- Direct links to related platform pages

## Delivery and Reliability

### Delivery Guarantees

**Best Effort**: The platform makes best efforts to deliver all notifications but cannot guarantee delivery due to:

- Email server availability
- Recipient mail server policies
- Spam filters and blocklists
- Network connectivity issues

**Retry Logic**: Failed email sends are retried:

- Up to 3 retry attempts
- Exponential backoff between retries
- Logged for administrator review

### Monitoring Delivery

Administrators can monitor email delivery:

**Cloud Logging**: All email send attempts are logged with:
- Recipient address
- Notification type
- Delivery status
- Error messages (if failed)

**Metrics**: Track email delivery rates:
- Total emails sent
- Successful deliveries
- Failed deliveries
- Bounce rates

### Troubleshooting Delivery Issues

**User Not Receiving Emails**:

1. Check user's notification preferences
2. Verify email address is correct
3. Check spam/junk folders
4. Review Cloud Logging for delivery errors
5. Verify mail server configuration

**High Bounce Rate**:

1. Review mail server authentication (SPF, DKIM)
2. Check if mail server IP is blocklisted
3. Verify SMTP credentials are correct
4. Monitor for pattern in bounced addresses

## Best Practices

### For Administrators

**Test Configuration**: Send test emails after configuring mail server

**Monitor Logs**: Regularly review email delivery logs for issues

**Maintain Reputation**: Keep mail server IP reputation high by:
- Sending only legitimate notifications
- Honoring unsubscribe requests
- Maintaining clean recipient lists

**Backup Communication**: Have alternative communication channels for critical alerts

### For Users

**Whitelist Sender**: Add platform email to contacts to avoid spam filtering

**Check Preferences**: Ensure notification preferences match your needs

**Update Email**: Keep your email address current in your profile

**Report Issues**: Contact support if you're not receiving expected notifications

## Privacy and Compliance

### Data Protection

- Email addresses are encrypted at rest
- Notification content includes only necessary information
- Emails are sent over encrypted connections (TLS)
- Unsubscribe options are provided for non-critical notifications

### Compliance

**CAN-SPAM**: All emails include:
- Clear sender identification
- Accurate subject lines
- Physical mailing address
- Unsubscribe mechanism

**GDPR**: Users can:
- Control notification preferences
- Request deletion of email history
- Access their notification data

## Advanced Features

### Notification Templates

Administrators can customize notification templates:

- Edit email subject lines
- Modify email body content
- Add custom branding
- Include additional links or resources

**Template Variables**: Use placeholders for dynamic content:
- \`{{user_name}}\`: Recipient's name
- \`{{deployment_id}}\`: Deployment identifier
- \`{{credit_balance}}\`: Current credit balance
- \`{{timestamp}}\`: Event timestamp

### Notification Webhooks

For advanced integrations, configure webhooks to receive notification events:

- Send notifications to Slack or Microsoft Teams
- Integrate with external monitoring systems
- Trigger custom workflows based on events
- Archive notifications in external systems

### Batch Notifications

For administrative communications:

**Send Message to All Users**: From Credit Settings page

- Compose custom message
- Select recipient group (all users, partners, specific roles)
- Preview before sending
- Track delivery status

**Use Cases**:
- Platform maintenance announcements
- Policy updates
- Feature releases
- Promotional campaigns
`;

export default function Notifications() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
