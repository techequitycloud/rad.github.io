import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# User Management

The User Management interface provides administrators with comprehensive tools to manage users, their credits, roles, and access permissions across the platform.

## Accessing User Management

Navigate to the **Billing** page and select the **User Credits** tab. This tab is only visible to administrators and provides a centralized interface for all user management operations.

## User List View

The User Credits page displays a comprehensive table of all registered users with the following information:

### User Columns

**Email**: The user's login email address (also serves as their unique identifier)

**Active**: Checkbox indicating whether the user's account is enabled or disabled

**Partner**: Checkbox indicating whether the user has partner-level privileges

**Credit Balance**: The user's current total credit balance (awarded + purchased)

**Actions**: Edit button to modify user details

### Table Features

**Pagination**: Navigate through large user lists with page controls at the bottom

**Search**: Filter users by email address or credit balance using the search bar

**Sorting**: Click column headers to sort by email, status, or balance

## User Management Actions

### Editing User Details

Click the **Edit** button next to any user to open the user management modal:

#### Account Status

**Active Toggle**: Enable or disable user accounts

- **When Active**: User can log in and access the platform
- **When Inactive**: User cannot log in; existing sessions are terminated
- **Use Case**: Temporarily suspend accounts for policy violations or offboarding

**Impact**: Changing the Active status automatically adds or removes the user from the corresponding Google Cloud Identity group.

#### Partner Status

**Partner Toggle**: Grant or revoke partner-level privileges

- **When Enabled**: User gains access to partner features:
  - GitHub repository configuration
  - Module publishing capabilities
  - Partner Modules tab visibility
  - Enhanced billing visibility (if private mode is enabled)
- **When Disabled**: User has standard access only

**Impact**: Changing Partner status automatically manages Google Cloud Identity group membership.

#### Credit Balance Adjustment

**Awarded Credits**: Manually adjust the user's awarded (free) credit balance

- Enter a positive number to add credits
- Enter a negative number to deduct credits
- Changes are applied to the awarded balance only

**Purchased Credits**: Manually adjust the user's purchased credit balance

- Typically used for refunds or corrections
- Enter positive or negative values as needed

**Audit Trail**: All manual credit adjustments are recorded as transactions in the credit_transactions collection, including:
- Administrator who made the change
- Timestamp of the adjustment
- Amount and type (awarded vs. purchased)
- Reason or notes (if provided)

### Saving Changes

After making modifications:

1. Review all changes in the edit modal
2. Click the **Save** button to apply changes
3. The system updates the user record in Firestore
4. Google Cloud Identity groups are updated if role changes were made
5. Credit transactions are recorded for audit purposes
6. A success notification confirms the changes

## Bulk Operations

### Adjust All User Credits

Administrators can apply credit adjustments to all users at once through the Credit Settings page:

1. Navigate to **Billing** → **Credit Settings**
2. Locate the "Adjust All User Credits" form
3. Enter the amount to add or deduct
4. Select credit type (Awarded or Purchased)
5. Click **Apply** to execute the bulk adjustment

**Use Cases**:
- Platform-wide promotional credits
- Corrections for billing errors
- Seasonal credit bonuses
- Compensation for service disruptions

**Audit**: Each user receives an individual transaction record for the bulk adjustment.

## Access Control Integration

### Google Cloud Identity Groups

The platform uses Google Cloud Identity groups to manage permissions:

**rad-users**: All active users are members of this group

**rad-partners**: Users with partner status are members of this group

**rad-admins**: Administrators are members of this group

### Automatic Synchronization

When you change a user's status:

1. **Activate User**: Added to rad-users group
2. **Deactivate User**: Removed from rad-users group
3. **Grant Partner**: Added to rad-partners group
4. **Revoke Partner**: Removed from rad-partners group

This ensures that access to Google Cloud resources is automatically managed based on platform roles.

### Permission Implications

Group membership controls:

- Access to deployed infrastructure
- Visibility of cloud resources
- Billing and cost data access
- API and service account permissions

## User Lifecycle Management

### New User Onboarding

When a new user signs up:

1. **Self-Enrollment** (if enabled):
   - User logs in with Google credentials
   - Automatically added to rad-users group
   - Receives signup credits (if configured)
   - Can immediately access platform features

2. **Manual Enrollment** (private mode):
   - User attempts to log in
   - Administrator manually adds user to rad-users group
   - Administrator can configure initial credits and role
   - User gains access after manual approval

### User Offboarding

To offboard a user:

1. Navigate to User Credits
2. Click **Edit** for the user
3. Toggle **Active** to disabled
4. Optionally adjust credits or change partner status
5. Save changes

**Effects**:
- User is immediately logged out
- Removed from rad-users group
- Cannot log in again
- Existing deployments remain intact
- Credit balance is preserved

### Account Deletion

Users can delete their own accounts from their Profile page. When a user deletes their account:

- User record is removed from Firestore
- Credit balance is forfeited
- Deployment history may be retained based on retention policy
- Google Cloud Identity group memberships are removed

Administrators cannot delete user accounts through the User Management interface; users must initiate deletion themselves.

## Monitoring and Reporting

### Credit Balance Monitoring

**Low Balance Alerts**: Identify users approaching zero credits

**High Balance Users**: Find users with unusually high balances (potential fraud or errors)

**Balance Trends**: Track how user balances change over time

### Usage Patterns

**Active Users**: Identify users who frequently deploy modules

**Inactive Users**: Find users who haven't deployed recently

**Partner Activity**: Monitor partner module publishing and usage

### Audit and Compliance

**Credit Adjustments**: Review all manual credit changes

**Role Changes**: Track partner status grants and revocations

**Access Changes**: Monitor account activations and deactivations

**Transaction History**: Access complete audit trail for any user

## Best Practices

### Credit Management

**Regular Audits**: Periodically review user credit balances for anomalies

**Documented Adjustments**: Keep notes on why manual credit adjustments were made

**Consistent Policies**: Apply credit policies consistently across all users

**Communication**: Notify users before making significant credit adjustments

### Access Control

**Least Privilege**: Grant partner status only when necessary

**Regular Reviews**: Periodically review partner status assignments

**Prompt Offboarding**: Deactivate accounts promptly when users leave

**Group Verification**: Verify Google Cloud Identity group memberships match platform roles

### User Support

**Responsive Management**: Address user credit or access issues quickly

**Clear Communication**: Explain account status changes to affected users

**Documentation**: Keep records of support interactions and resolutions

**Escalation Path**: Define clear escalation procedures for complex issues

## Troubleshooting

### User Cannot Log In

**Check Active Status**: Verify the user's account is active

**Verify Group Membership**: Ensure user is in rad-users group

**Check Private Mode**: If enabled, verify manual enrollment is complete

**Review Logs**: Check Cloud Logging for authentication errors

### Credit Balance Issues

**Verify Transactions**: Review user's credit transaction history

**Check Adjustments**: Look for recent manual adjustments

**Validate Calculations**: Ensure balance matches transaction sum

**Audit Trail**: Review who made recent changes and why

### Partner Features Not Available

**Confirm Partner Status**: Verify partner toggle is enabled

**Check Group Membership**: Ensure user is in rad-partners group

**GitHub Configuration**: Verify user has configured their GitHub repository

**Cache Issues**: Have user log out and back in to refresh permissions

### Group Sync Issues

**Manual Sync**: Manually add/remove user from groups if automatic sync fails

**Check Permissions**: Verify platform has permissions to manage groups

**Review Logs**: Check for errors in group management operations

**Contact Support**: Escalate persistent sync issues to platform support
`;

export default function Users() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
