# Finance Workflows

This document details the workflows for **Finance Managers** and Administrators responsible for the economic configuration of the Cyclos platform. This includes managing accounts, fees, limits, and reporting.

## Account Management

### Account Types
Cyclos supports multiple account types (e.g., Member Account, Organization Account, Debit/Credit).

1.  Navigate to **Settings** > **Accounts** > **Account Types**.
2.  Select an account type to configure its currency, limits, and associated transfer types.

### Viewing System Accounts
1.  Go to **Accounts** > **System Accounts**.
2.  Here you can view the balances of the system's internal accounts (e.g., Member Fee Collection, System Sink, System Source).
3.  Monitor these accounts to ensure the system's economic health.

## Fee Configuration

### Transaction Fees
Fees can be applied to transfers (e.g., 1% fee on payments).

1.  Navigate to **Settings** > **Accounts** > **Transaction Fees**.
2.  **Create/Edit Fee**:
    *   **Amount**: Set fixed or percentage amounts.
    *   **Max/Min**: Define maximum or minimum fee caps.
    *   **Receiver**: Specify where the fee goes (e.g., to the System or a Broker).
3.  **Apply to Transfer Type**: Link the fee to specific transfer types (e.g., "Member Payment").

### Contribution/Membership Fees
1.  Configure scheduled fees for account maintenance or membership.
2.  Go to **Settings** > **Accounts** > **Scheduled Fees**.
3.  Define the frequency (monthly, yearly) and the amount.

## Limits and Controls

### Credit Limits
1.  Navigate to **Settings** > **Users** > **Groups**.
2.  Select a group (e.g., "Standard Members") and go to **Account Settings**.
3.  Set the **Credit Limit** (maximum negative balance) and **Upper Credit Limit** (maximum positive balance).

### Transfer Limits
1.  In Group settings, go to **Transfer Limits**.
2.  Define daily, weekly, or monthly limits for transaction volume or count.

## Reporting

### Transaction History
1.  Go to **Reports** > **Transactions**.
2.  Filter by date range, user, transfer type, or status.
3.  Export data to CSV or PDF for external analysis.

### Balance Reports
1.  Go to **Reports** > **Balances**.
2.  Generate snapshots of system-wide balances at a specific point in time.
