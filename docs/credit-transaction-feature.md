# Credit Transaction Feature

## Overview
The **Credit Transaction Feature** allows users to track their credit usage and history on the platform. It provides a transparent view of all credit-related activities, including awards (free credits), purchases, and spending on deployments or ongoing project costs.

This feature is designed to help users manage their budget and understand exactly where their credits are being utilized.

## Accessing the Feature
To access your credit transaction history:

1.  Log in to the platform.
2.  Click on the **Credits** link in the main navigation bar.
    *   *Note: This link is visible only if the "Enable Credits" setting is active for the platform.*
3.  Ensure the **Credit Transactions** tab is selected (this is the default view).

## Features

### Transaction History Table
The core of this feature is the transaction history table, which displays a chronological list of all credit movements. The table includes the following columns:

*   **Date**: The date and time when the transaction occurred.
*   **Awards**: The amount of free or promotional credits added to your account.
*   **Purchases**: The amount of credits you have purchased (visible if Subscriptions are enabled).
*   **Deployment ID**: The unique identifier of the deployment associated with the transaction, if applicable. Clicking this ID links directly to the deployment details.
*   **Deployments**: Credits spent on initiating new deployments.
*   **Projects**: Credits deducted for ongoing running costs of your projects.
*   **Balance**: Your total remaining credit balance after the transaction.

### Filtering and Search
To help you find specific transactions, the page offers robust filtering tools:

*   **Search by Deployment ID**: Enter a partial or full Deployment ID in the search box to filter transactions related to specific deployments.
*   **Date Filter**: Use the date picker to narrow down transactions to a specific date.

### Export to CSV
For offline analysis or record-keeping, you can export your entire visible credit history.
*   Click the **Export CSV** button to download a `.csv` file containing your transaction data.
*   The CSV includes all relevant fields: Date, Awards, Purchases, Deployment ID, Spend amounts, and Balance.

## Transaction Types
Understanding the different types of transactions will help you read your history:

*   **Awards**: Credits granted to you by the platform (e.g., sign-up bonuses, manual awards by admins). These are typically used first before purchased credits.
*   **Purchases**: Credits you have bought through the "Buy Credits" tab.
*   **Spend (Deployments)**: One-time costs deducted when you successfully launch a new module.
*   **Spend (Projects)**: Recurring costs deducted for the maintenance of your active resources.

## Technical Implementation Summary
*   **Data Source**: All data is sourced from a secure, immutable `credit_transactions` collection in the platform's database.
*   **Dual-Balance System**: The platform tracks "Awarded" and "Purchased" credits separately to ensure the correct deduction logic is applied (e.g., using free awards before paid credits).
*   **Real-time Updates**: The transaction history reflects your balance in near real-time as deployments occur or credits are purchased.
