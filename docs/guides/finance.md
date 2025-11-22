---
title: Finance Guide
description: Finance Guide for the Rapid Application Deployment (RAD) platform
---

# Finance User Guide

## 1. Introduction

Welcome to the Finance Guide. This documentation is intended for users with the **Finance** role. This role provides specialized access to financial data, invoices, and revenue reports without necessarily granting full administrative control over the platform configuration.

## 2. Access & Permissions

As a Finance user, you have elevated access to the **Billing** section of the application. Your view includes data for **all users** and **all projects** across the organization, allowing for comprehensive auditing and financial reporting.

## 3. Financial Reporting Tools

Navigate to the **Billing** page to access your toolset.

### 3.1. Project Invoices
This is your primary tool for monthly reconciliation.
*   **View:** Select a month to see a line-item breakdown of costs for every project.
*   **Details:** See the Project Name, ID, Total Cost (in currency), and the Credit equivalent.
*   **Export:** Download the invoice data as a CSV file for import into your external accounting software.

### 3.2. Project Costs
Analyze historical spending trends.
*   **Date Range:** Select any custom date range to view costs.
*   **Filter:** Drill down by Module type to see which applications are driving costs.
*   **Source:** This data is pulled directly from the Google Cloud Billing export in BigQuery, ensuring it matches your cloud invoice.

### 3.3. Revenue Reports
Track the platform's incoming value ("True Revenue"), defined as deployment costs paid for with purchased credits.

*   **Module Revenue:** See which products are generating the most revenue.
*   **User Revenue:** Audit revenue generation by specific users or groups.
*   **Agent Revenue:** Track commissions and revenue driven by the Agent program.

### 3.4. User Credit Management
You have read-access to the **User Credits** table (or write-access if also an Admin), allowing you to audit user balances:
*   **Awarded Credits:** Free credits given by the platform.
*   **Purchased Credits:** Credits bought via Stripe.
*   **Partner Credits:** Monthly allowances.

## 4. Subscription Management

You can view the **Subscription Tiers** configuration to understand the current pricing models and credit packages being offered to customers.
