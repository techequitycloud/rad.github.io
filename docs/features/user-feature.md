# User Management Feature

## Overview

The User Management system provides a comprehensive suite of tools for administrators and finance teams to manage user identities, access controls, roles, and credit balances within the platform. It is designed with security, scalability, and auditability in mind, integrating directly with Firebase Authentication and Google Cloud Identity.

## User Roles & Permissions

The platform utilizes a role-based access control (RBAC) system. A single user can hold multiple roles simultaneously, with their permissions being additive.

| Role | Description | Key Capabilities |
| :--- | :--- | :--- |
| **Admin** | Full system access. | Manage users, configure platform settings, view all deployments, manage global Git repositories. |
| **Finance** | Financial oversight. | Access billing dashboards, manage subscription tiers, view revenue reports, manage user credits. |
| **Support** | Customer support. | View all deployments and user details to assist with troubleshooting (read-only admin view). |
| **Partner** | Module publisher. | Publish and manage Terraform modules, configure private Git repositories, earn revenue from module usage. |
| **Agent** | Referral partner. | Refer new users to the platform and earn commission based on their usage. |
| **User** | Standard user. | Deploy modules, manage own projects, purchase credits/subscriptions. |

## User Management Interface

The primary interface for managing users is located on the **Users** page (accessible to Admins).

### Key Features:
*   **Search**: Find users quickly by email address (minimum 3 characters).
*   **User List**: View a paginated list of all users, displaying their email, active status, and assigned roles.
*   **Role Management**: Inline checkboxes allow Admins to instantly toggle roles (Admin, Finance, Support, Partner, Agent, User) for any user.
*   **Account Status**: Admins can deactivate or reactivate user accounts. Deactivating a user immediately revokes their access to the platform and removes them from all security groups.
*   **Security**: Critical actions, such as removing the last administrator, are blocked to prevent lockout.

## Credit Management

Credits are the currency of the platform, used to pay for deployment costs. The system tracks three types of credit balances for each user:

1.  **Awarded Credits**: Free credits granted by admins (e.g., for trials or promotions).
2.  **Purchased Credits**: Credits bought by the user via Stripe.
3.  **Partner Credits**: Credits earned by partners (if applicable).

### Credit Management Tools (Finance & Admin)
Located within the **Billing** section, the **Credit Management** tab allows authorized personnel to:
*   Search for specific users.
*   Manually adjust `Awarded`, `Purchased`, and `Partner` credit balances.
*   **Bulk Updates**: Apply credit awards to multiple users or the entire user base simultaneously (e.g., "Gift 100 credits to all users").
*   **Notifications**: Users automatically receive email notifications when their credit balance is manually adjusted or bulk-updated.

## User Lifecycle & Operations

### 1. User Creation
*   **Self-Service**: Users can sign up via the public sign-in page.
*   **Admin Provisioning**: Admins can manually create users via the API.
*   **Referrals**: New users can sign up with a referral code, linking them to an Agent.

### 2. User Updates
*   **Profile**: Users can manage their own profile settings (e.g., notification preferences).
*   **Admin Updates**: Admins can update any user field. All sensitive changes (roles, status) generate an **Audit Log** entry.

### 3. User Deletion
Deleting a user is a destructive operation that performs a comprehensive cleanup:
*   **Identity**: Removes the user from Firebase Authentication and Google Cloud Identity groups.
*   **Resources**: Deletes all deployments, credit transaction history, and (if they are a Partner) all their published modules.
*   **Archival**: The user record is moved to a `deleted_users` collection for audit purposes.

## Security & Auditing

*   **Rate Limiting**: API endpoints for creation, updates, and searches are rate-limited to prevent abuse.
*   **Audit Logging**: Critical actions (role changes, status updates, deletions, bulk credit updates) are logged to the `audit_logs` collection in Firestore, recording *who* performed the action, *when*, and *what* changed.
*   **Group Sync**: User roles are automatically synchronized with Google Cloud Identity groups (e.g., `rad-admins`, `rad-partners`) to ensure consistent access control across cloud resources.

## API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/users` | List users (supports pagination and filtering). |
| `POST` | `/api/users` | Create a new user. |
| `GET` | `/api/users/[email]` | Get details for a specific user. |
| `PUT` | `/api/users/[email]` | Update a user's roles, status, or credits. |
| `DELETE` | `/api/users/[email]` | Delete a user and cleanup resources. |
| `POST` | `/api/users/bulk-update` | Bulk update user credits. |
| `GET` | `/api/users/search?term=...` | Search users by email. |
