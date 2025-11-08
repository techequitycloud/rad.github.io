---
title: User Management
sidebar_position: 3
---

# User Management

Administrators have comprehensive user management capabilities to control access, manage credits, assign roles, and monitor user activity across the RAD Platform.

## User List

The User Management page displays all users registered on the platform with key information including email address, account status (active/inactive), role (user, partner, agent, admin), awarded credits balance, purchased credits balance, and last login date.

### Searching Users

Use the search functionality to find specific users by email address, name, or other identifying information. Filters allow you to view users by role, account status, or credit balance thresholds.

## User Roles

The platform supports four primary user roles:

**User**: Standard role with access to deploy modules, view their own deployments, purchase credits, and manage their profile. Users can deploy infrastructure but cannot publish custom modules or access administrative functions.

**Partner**: Extended role that includes all user capabilities plus the ability to publish custom modules, manage module repositories, and access partner-specific analytics. Partners can create and maintain their own module catalogs.

**Agent**: Specialized role for users who deploy infrastructure on behalf of others. Agents can view and manage deployments across multiple users, access extended deployment logs, and perform administrative deployment tasks.

**Administrator**: Full platform access including user management, billing configuration, global settings, platform analytics, and all user/partner/agent capabilities.

## Managing User Details

Click the Edit button next to any user to access their management interface.

### Credit Management

Administrators can manually adjust user credit balances for both awarded and purchased credits. Add credits for promotional purposes, error corrections, or compensation. Deduct credits if necessary for policy violations or billing corrections. All manual adjustments are logged in the transaction history with the administrator's name and reason.

### Role Assignment

Change a user's role to grant or revoke specific capabilities. Promote users to partner status to enable module publishing. Assign agent role for deployment management across users. Grant administrator privileges for platform management. Role changes take effect immediately.

### Account Status

Toggle user account status between active and inactive. Inactive accounts cannot log in or perform any platform actions. Existing deployments remain running but cannot be modified. Credits remain in the account and are restored when reactivated.

## Bulk Operations

Administrators can perform operations on multiple users simultaneously:

**Bulk Credit Adjustment**: Add or deduct credits for all users or filtered user groups. Useful for platform-wide promotions or policy changes.

**Bulk Notifications**: Send messages to all users or specific user segments. Communicate platform updates, maintenance windows, or policy changes.

**Bulk Export**: Export user data to CSV for reporting, analysis, or backup purposes.

## User Analytics

View platform-wide user statistics including total active users, new signups over time, users by role distribution, average credit balance, and deployment activity by user segment.

### User Activity Monitoring

Track individual user activity including deployment history and success rates, credit purchase patterns, module publishing activity (for partners), and login frequency and last access.

## Credit Allocation Policies

Administrators configure global credit policies that affect all users:

**Signup Credits**: Number of free credits awarded to new users upon account creation. Encourages initial platform exploration and testing.

**Low Balance Threshold**: Credit level at which users receive low balance warning emails. Helps users avoid service interruptions.

**Credit Expiration**: Whether credits expire and after what period (typically credits do not expire).

## User Invitations

Administrators and partners can invite new users to the platform:

**Email Invitations**: Send invitation emails with registration links. Track invitation status and acceptance rates.

**Role Pre-assignment**: Assign roles to users before they register. Streamlines onboarding for known partners or agents.

**Bulk Invitations**: Invite multiple users simultaneously from a CSV file or email list.

## Account Deactivation

When deactivating a user account, consider the impact on existing deployments, unused credit balances, and module ownership (for partners). Deactivated accounts can be reactivated later, restoring all data and access.

### Permanent Deletion

Account deletion is permanent and irreversible. All user data is removed except anonymized transaction records for audit purposes. Deployments created by the user remain but are transferred to administrator ownership. Published modules (for partners) can be transferred to another partner or archived.

## Security and Compliance

### Access Logs

Review user access logs to monitor login attempts, failed authentication events, IP addresses and locations, and session durations. Identify suspicious activity or potential security issues.

### Audit Trail

All administrative actions affecting users are logged including credit adjustments, role changes, account status modifications, and bulk operations. Audit logs include the administrator who performed the action, timestamp, and affected users.

## User Support

### Viewing User Issues

Access support tickets and help requests submitted by users. Assign tickets to appropriate team members. Track resolution status and response times.

### Impersonation (View As)

Some platforms allow administrators to view the platform as a specific user for troubleshooting purposes. This capability should be used carefully and logged for audit purposes.

## Best Practices

**Regular Audits**: Periodically review user accounts to identify inactive accounts, unusual credit patterns, or role assignment issues.

**Clear Communication**: Notify users before making significant changes to their accounts, especially credit adjustments or role changes.

**Documentation**: Document the reason for manual credit adjustments or account modifications in the transaction notes.

**Security**: Limit administrator access to trusted personnel. Use strong authentication for administrator accounts. Monitor administrator activity logs regularly.

**Privacy**: Handle user data according to privacy policies and regulations. Limit access to personal information to authorized personnel only.

## Troubleshooting

### User Cannot Log In

Verify the account is active, not deactivated. Check that the user is using the correct Google account. Review access logs for failed login attempts. Ensure the user has been properly invited or registered.

### Credit Balance Discrepancies

Review the user's transaction history for all credit movements. Check for pending transactions that haven't been processed. Verify manual adjustments were applied correctly. Contact support if the discrepancy cannot be explained.

### Role Permissions Not Working

Confirm the role was assigned correctly and saved. Have the user log out and log back in to refresh permissions. Check for conflicting role assignments. Verify the specific feature is available for that role.

## Related Resources

- [Administrator Guide](/docs/guides/admin) - Complete administrator capabilities
- [Global Settings](/docs/admin/settings) - Platform-wide configuration
- [Credits System](/docs/billing/credits) - Understanding credit management
- [Notifications](/docs/admin/notifications) - Communicating with users
