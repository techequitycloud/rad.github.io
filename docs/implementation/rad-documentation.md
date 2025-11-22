SETUP \- GLOBAL SETTINGS

### 1\. Deployment Scope

The Enable Folder Scope option controls the scope of deployments and queries. When enabled, project and billing queries are restricted to the Google Cloud folder ID specified in the Client Folder ID setting. When disabled, queries are run against the entire Google Cloud organization.

### 2\. Enabling Credits

The Enable Credits setting controls the credit system. When enabled:

* The credit cost of a module is displayed on the module card on the "Publish" and "Deploy" pages.  
* During deployment, the credit cost of the module is deducted from the user's credit balance.  
* If a user has insufficient credits, the deployment is blocked.

### 3\. Enabling Subscription

The Enable Subscription option controls the visibility of subscription-related features. When enabled:

* The "Subscription Tiers" tab is visible in the billing section to admins and the "Buy Credits" tab is visible to non-admin users.  
* The "Project Costs", "Deployment Revenue", and "Project Invoices" tabs are visible in the billing section for admin users.

### 4\. Private Mode

The "Private Mode" option controls two things:

* Data Visibility: When enabled, partner users can see all cost and invoice data, just like an admin. When disabled, they can only see data for their own deployments.  
* User Onboarding: When enabled, users cannot self enrol themselves and are therefore not automatically added to the rad-users Google Group. They must be added manually to the group to gain access to the application. When disabled, new users can self enrol, and are automatically added to the rad-users group. 

### 5\. Retention Period

The "Retention Period" setting determines how long deployment history is kept. The options are 30, 90, 180, 365 days or never deleted. When a retention period is set, a cleanup process runs periodically (daily, weekly, or monthly, depending on the Cleanup Schedule setting) and deletes any deployment records and their associated Google Cloud Storage artifacts that are older than the specified period.

### 6\. Cleanup Now

The "Run Cleanup Now" button manually triggers the deployment cleanup process. This immediately delete all deployments older than the configured retention period.

### 7\. Cleanup Schedule

The Cloud Scheduler is an infrastructure-level component that provides a reliable, periodic "pulse" or trigger. It can be configured to run every day at a predefined schedule, e.g. "0 0 \* \* \*" for midnight every day. The actual clean up is performed based on the Cleanup Schedule, e.g. "Daily" for every day at midnight, "Weekly" for every Sunday at midnight, and "Monthly" for the 1st day of the month at midnight.

### 8.Enable Notification

The "Enable Notification" checkbox controls whether email notifications are sent for deployment events (e.g., when a deployment is created or deleted). When enabled, emails are sent to the user who initiated the deployment, as well as any users listed in the trusted\_users and owner\_users fields of the deployment.

### 9\. Support email and mail server email accounts

* The Mail Server Email and its password are the credentials used to send all emails from the application, including deployment notifications and support requests.  
* The Support Email is the address that receives emails sent from the "Send Message" form on the Help page.

CREDIT SETTINGS

 1\. Credit Settings

* This page is displayed to administrators under the "Credit Settings" tab.   
* It displays several individual forms, each responsible for a specific credit-related setting.

2\.  "Credits" page

* It first checks if the logged-in user is an administrator.  
* For administrators, it displays a navigation bar with several tabs, including "Credit Settings".  
* When the "Credit Settings" tab is clicked and becomes active, this component renders Admin Credit Forms.

3\. Admin Credit Forms

* When it first loads, it fetches the current application-wide settings from the backend (e.g., signup credit amount, referral bonus, etc.).  
* It then passes these initial values down to the individual form components.  
* The forms displayed include:  
  * The Signup Credit Form allows an administrator to set the number of credits a new user receives upon signing up.   
  * The Referral Credit Form allows an administrator to set the amount of credits a user receives for a successful referral.  
  * The Refresh Interval Form allows an administrator to set a refresh interval in hours. This is likely used for a recurring background task related to credits.   
  * The Low Credit Form allows an administrator to set the low credit trigger amount, which is used to notify users when their credit balance is low.   
  * The Price Per Credit Form allows an administrator to define how many credits are awarded per unit of currency (e.g., per dollar or GBP depending on the Google Cloud billing account currency). 

4\. Forms

* Forms contain a label, an input field for the value, and a "Save" or "Set Amount" button.  
* When the button is clicked, it saves the new value in the database, and  triggers a success notification, re-fetch the settings, and ensure the entire page reflects the updated data.

### SUBSCRIPTION TIERS

### 1\. Subscription Tiers

* Subscription tiers define the name, price, the number of credits it grants, and a list of features for each subscription  
* Subscription tiers are created by admins and displayed to users when the subscription service is enabled.

### 2\. Admin Experience: Managing Tiers

* Subscription tiers can be managed on the "Billing" page, accessible from the main navigation.  
* For an admin user, this page displays a "Subscription Tiers" tab, which renders the SubscriptionTierManagement component.  
* This provides a full management interface for admins:  
  * View: It lists all existing tiers in a table.  
  * Create: An "Add New Tier" button opens a form (SubscriptionTier Form) to define a new subscription plan with its price, features, and other details.  
  * Edit & Delete: Each tier in the table has "Edit" and "Delete" buttons to modify or remove it.

### 3\. User Experience: Purchasing Tiers

* Regular users also access this functionality from the "Billing" page.  
* For non-admin users, the page shows a "Buy Credits" tab, which renders the UserSubscriptionTiers component.  
* This component is responsible for displaying the tiers for purchase:  
  * It fetches and displays available tiers as individual cards.  
  * It integrates with Stripe to handle payments. When a user clicks "Subscribe," it communicates with the backend to create a Stripe Checkout session and redirects the user to Stripe to complete the payment securely.  
  * It also manages the user's current subscription status, showing them which plan they are on and providing an option to cancel it.

BUY CREDITS

The "Buy Credits" functionality allows non-administrator users to purchase credits, which are used to pay for services. This feature is primarily located on the Credits page and is only available when the subscription and credit system is enabled by an administrator.

The system offers two distinct ways for users to acquire credits:

1. Recurring Subscriptions: Users can subscribe to predefined tiers that provide a set number of credits on a recurring basis (e.g., monthly).  
2. One-Time Purchases: Users can make a single, non-recurring purchase of a specific number of credits.

The entire payment process is handled by Stripe, ensuring that sensitive payment details are processed securely and are never stored within the application.

### The Payment Flow (User Journey)

1. A non-admin user navigates to the Credits page.  
2. The user clicks on the "Buy Credits" tab.  
3. They are presented with options: subscribe to a tier or make a one-time purchase.  
4. If they choose a subscription:  
   * They click "Subscribe" on their desired tier.  
   * They are redirected to Stripe to enter their payment information and confirm the subscription.  
5. If they choose a one-time purchase:  
   * They enter a monetary amount in the Buy Credits Form.  
   * They click "Buy Credits."  
   * They are redirected to Stripe to complete the purchase.  
6. After a successful payment, Stripe redirects the user back to the application's billing page.  
7. The Billing component detects the successful redirect, displays a confirmation message, and automatically updates the user's credit balance and transaction history.

### 

### USER CREDITS

The "User Credits" page is an administrative feature designed to manage users and their associated attributes within the application.

1\. User Interface (UI) \- Admin View:

* The functionality is located under a "User Credits" tab within the Billing section, which is only visible to administrators.  
* It displays a comprehensive table of all registered users, with the following columns:  
  * Email: The user's login email.  
  * Active: A checkbox that shows whether a user's account is enabled or disabled.  
  * Partner: A checkbox that designates a user as a "partner," which grants them special permissions or access.  
  * Credit Balance: The amount of credits the user currently has.  
  * Actions: An "Edit" button to modify the user's details.  
* To handle a large number of users, the table includes pagination and a search bar that can filter users by their email or credit balance.

2\. Core Administrative Actions:

* By clicking the "Edit" button, an administrator can:  
  * Activate or Deactivate Users: Toggling the "Active" checkbox controls a user's ability to access the platform.  
  * Manage Partner Status: Toggling the "Partner" checkbox assigns or revokes partner-level privileges.  
  * Adjust Credit Balances: Manually change the number of credits a user has. This is useful for awarding promotional credits, making corrections, or other manual adjustments.  
* After making changes, the administrator clicks a "Save" button to apply them.

3\. Backend Logic and Security:

* All actions are handled by a secure backend API that requires administrator authentication for all operations.  
* When an administrator updates a user:  
  * Credit Adjustments are Audited: Any change to a user's credit balance is recorded as a formal transaction in a credit\_transactions collection in the database, creating a clear audit trail.  
  * Access Control is Automated: Changing the "Active" or "Partner" status automatically adds or removes the user from corresponding Google Cloud Identity groups. This is a robust way to manage permissions, as access to platform resources is likely tied to group membership.

In summary, the "User Credits" page provides a centralized and secure interface for administrators to perform key user management tasks: viewing user data, controlling their access and partner status, and managing their credit balances, all while maintaining a log of important financial-related changes.

### CREDIT TRANSACTIONS

### 1.The Billing Page

* Regular (non-admin) users can access the "Credit Transactions" tab.  
* Non-admin users can view their list of transactions on the "Credit Transactions" tab. They can also search by deploymentId or date to filter the results.

### 2\. The Transaction Table 

This table displays the list of transactions in a clean, formatted table with details such as:

* Date  
* Awarded Credits  
* Purchased Credits (this column is only shown if the subscription/purchase feature is enabled globally)  
* Deployment ID (which is a clickable link to the deployment's detail page)  
* Credits spent on deployments or projects  
* The final credit balance after the transaction.

### PROJECT COSTS

The "Project Costs" tab, found on the "Credits" page, is a reporting tool designed to provide visibility into historical spending. It is not a place where costs are defined or configured. The actual cost of a project is determined by an indirect, credit-based system. Here’s a step-by-step breakdown of the implementation:

### 1\. How Costs Are Defined

Project costs are not set directly in a currency (e.g. USD or GBP) amount. Instead, they are based on a two-tiered system:

* Module Credit Cost: Each application module that can be deployed has a Credit Cost associated with it. This is the number of credits required to deploy the module. This value is assigned when a module is published.  
* Price Per Credit: In the Admin \-\> Credit Settings tab, an administrator uses the Price Per Credit form to define a global conversion rate. This value determines how many credits are equivalent to one unit of currency (e.g., 10 credits \= $1).

### 2\. How Costs Are Incurred and Tracked

1. Deployment: When a user deploys a module, their account is debited the Credit Cost of that module.  
2. Billing Data: The underlying cloud infrastructure costs (e.g., virtual machines, databases) are tracked by Google Cloud's billing services and exported to BigQuery. This is the source of truth for actual Google Cloud resource monetary spending.  
3. Credit Debit: A scheduled process runs periodically. It checks Billing Data and deducts credits from the user's balance based on the Google Cloud resource consumption.

### 3\. How "Project Costs" Works

The "Project Costs" tab serves as a dashboard to view the historical monetary cost of projects.

1. Fetching Data: When an admin or user navigates to this tab, they can select a date range..  
2. Backend Logic:  The BigQuery billing export data is queried to retrieve the actual costs incurred by Google Cloud projects within the specified date range.  
3. Displaying Data: The frontend receives this cost data and displays it in a table with the following key columns:  
   * PROJECT ID: The unique identifier of the Google Cloud project.  
   * TOTAL COST: The actual monetary cost for that project as recorded in the billing data.  
   * CREDIT DEBIT: This value is calculated for display purposes. It takes the TOTAL COST and multiplies it by the creditsPerUnit setting to show the equivalent value in credits.  
   * Filtering: The view can be filtered by module, allowing users to see costs associated with specific applications.

In summary, the "Project Costs" tab provides a retrospective view of real-world spending by querying billing logs. It bridges the gap between the abstract credit system used within the application and the actual monetary costs of the underlying cloud resources. The definition of these costs happens upstream, through module credit assignments and the global price-per-credit setting.

PROJECT INVOICES

The "Project Invoices" feature provides a detailed, monthly breakdown of project costs, with powerful role-based access control to ensure data security.

### 1. User Interface and Interaction

*   **Entry Point**: The feature is accessed via the "Project Invoices" tab on the "Credits" page. This tab is only visible when the `enableSubscription` setting is active.
*   **Invoice Month Selector**: The primary UI element is a dropdown menu that allows users to select the month for which they want to view invoice data.
*   **Data Fetching**: The data is not loaded automatically. Users must click the "Fetch Project Invoice" button to trigger the API call. This on-demand fetching improves performance and prevents unnecessary queries.
*   **Data Display**: The fetched data is displayed in a paginated table with the following columns:
    *   **Project Name**
    *   **Project ID**
    *   **Credit Debit**: The project's cost represented in platform credits.
    *   **Total Cost**: The final cost in the configured currency (e.g., USD).
    *   **GCP Discounts** (Admin-only): This column shows the total value of Google Cloud credits or discounts applied to the project, providing a clear view of the actual vs. billed cost.
*   **CSV Export**: An "Export to CSV" button allows users to download the currently displayed data for offline analysis or record-keeping.

### 2. Backend Logic and Data Source

*   **Data Source**: The "Project Invoices" feature uses the Google Cloud billing export in **BigQuery** as its source of truth for all cost data.
*   **API Endpoint**: All requests are handled by the `/api/invoices` endpoint.
*   **Pagination**: The API uses server-side pagination to efficiently handle potentially large billing datasets, ensuring the UI remains responsive.

### 3. Role-Based Access Control (RBAC)

The system implements a strict, multi-tiered access control model to ensure users can only see the data they are authorized to view:

*   **Administrators**: Have full, unrestricted access. They can view invoice data for all projects across the entire platform.
*   **Partners (Private Mode Enabled)**: When "Private Mode" is enabled in the global settings, partners are elevated to an admin-like view and can see invoice data for all projects.
*   **Partners (Private Mode Disabled) & Regular Users**: Have the most restricted view. The backend API automatically filters the BigQuery results, showing them data **only for the projects they have personally deployed**. This is achieved by first querying Firestore to get a list of their deployment `projectId`s and then using that list to filter the BigQuery query.

GIT REPOSITORY CONFIGURATION

## Overview

The module publishing process allows administrators and partners to select modules from a configured GitHub repository and make them available for deployment within the application. 

### 1\. Git Repository Configuration

The system offers two distinct mechanisms for handling Git repositories: one for administrators (platform modules) and one for partners (partner modules).

### Admin (Platform) Modules

An administrator configures the platform-wide GitHub repository URL and a personal access token through the admin settings. Any configurations performed by admins are shared across all admins and used to access platform modules. 

### Partner Modules

## A partner configures their own GitHub repository URL and a personal access token in their user profile. The resources configured by partners are private to the partner and not shared with other users.

## 2\. Fetching Available Modules

When the Publish page loads, it determines if the user is an admin or a partner.  
Based on the user's role, it get the list of available modules from a platform GitHub repository which contains modules made available to all users, or a partner GitHub repository which is private to the partner.

### 3\. Fetching Published Modules

Modules that are already published are displayed so the user can see the current state.

### User Interaction

* The user can select or de-select modules  
* Clicking the "Publish" (or "Update") button to update and publish modules

## 4\. Fetching Available Modules from GitHub (Backend)

* Uses the partner's specific github Repo Url stored in their user profile or a platform  github Repo Url shared across administrators.  
* Fetches a partner-specific GitHub token from Secret Manager or a platform GitHub token for platform modules,

### 5\. Syncing Logic 

Additional safeguard included to ensure that any modules that no longer exist in the source Git repository are removed from the Deploy tab. This is particularly important when a partner changes their configured repository URL, or the admin changes the platform repository URL.

### PUBLISHING MODULES

The "Publish" tab allows administrators and partners to select and publish modules for deployment.

The "Publish" tab 

The publish tab displays a list of modules available for publishing from the configured GitHub repository. For administrators, this is the main platform repository. For partners, it's their own configured repository. 

Published Modules: A list of modules that have already been published is fetched from the database. The system tracks a list of available modules, the list of published modules, and an array of the names of the modules that are currently selected by the user. Each module can be selected using a button that displays the module's name. When a user clicks on the Publish button, the selected module’s configuration is saved and made accessible to users for deployment.

### MODULE DEPLOYMENT

#### Core Deployment Process

The deployment process begins on the Deploy page, where users can browse and select from a list of available "Platform" and (for partners) "Partner" modules.

Available modules are displayed as individual ModuleCard components.Clicking a module card navigates the user to the Provision Module workflow based on variables defined in the selected module's source code.

After filling out the required parameters, the user submits the form. This deployment logic validates the user and module information, generates a unique deploymentId, saves the initial deployment document, and executes the deployment pipeline, which runs the deployment of the selected module.

#### Workflow Variations Based on Settings

The user experience and backend logic change significantly based on the status of the Enable Credits setting. The Enable Subscription setting does not directly impact the module deployment flow itself but controls access to features like purchasing credits.

##### Scenario 1: Credits Disabled (Enable Credits: false)

This is the default and most basic workflow.

* User Interface:  
  * No credit cost is displayed on the module cards in the "Deploy" page.  
  * Confirmation: When the user submits the deployment form, there is no mention of credits. If the module has dependencies, a confirmation modal will appear, but it will not show any cost.  
  * Success Message: The success notification simply confirms that the deployment has started (e.g., "Deploy Success").  
* Backend Logic:  
  * The API does not perform any credit balance checks.  
  * No credits are deducted from the user's account.  
  * No credit transaction is logged.  
  * The deployment proceeds as long as all other requirements are met.

##### Scenario 2: Credits Enabled (Enable Credits: true)

This workflow introduces cost management and credit validation.

* User Interface:  
  * The Credit Cost for each module is fetched and displayed prominently on its card.  
  * Confirmation Modal: Before the deployment is submitted, the following is displayed:  
    1. The module’s Credit Cost.  
    2. The user's current Credit Balance.  
    3. Any dependencies the module has.   
    4. The user must explicitly confirm to proceed, acknowledging the cost.  
  * Success Message: The success notification informs the user that the deployment has started and confirms the number of credits that were debited from their account (e.g., "Deploy Success \- deployment-abc. 10 credits will be debited from your account.").  
* Backend Logic:  
  * The API first checks if the deploying user has sufficient credits to cover the module's creditCost.  
  * Insufficient Credits: If userCreditBalance \< creditCost, the API immediately rejects the request. An alert notifying the user that they have insufficient credits is displayed. The deployment is blocked.  
  * Sufficient Credits: If the user has enough credits, the API performs the following actions within a single transaction to ensure atomicity:  
    1. Deducts the Credit Cost from the user's creditBalance in their user document.  
    2. Creates a new document in the Credit Transactions table to log the expenditure for auditing purposes.  
    3. Creates the deployment document in the deployments collection.  
  * Only after the transaction is successful is the deployment performed. 

### Functionality and User Interaction

* Transparency: When credits are enabled, the system is transparent about costs, showing them upfront and requiring explicit confirmation before debiting the user's account.  
* Cost Control: The credit system acts as a gate, preventing users from initiating deployments they cannot afford.  
* Flexibility: The ability to enable or disable the credit system allows administrators to choose between a free-for-all deployment model and a pay-per-use model.  
* Error Feedback: In the case of insufficient funds, the system provides clear and immediate feedback, guiding the user to top up their account.

### DEPLOYMENT ANALYSIS

For a detailed technical breakdown of this feature, see the [All/My Deployments Feature Analysis](./deployments-feature.md).

The "My Deployments" and "All Deployments" tabs are part of the Deployments page, which is accessible from the main navigation menu. This page provides a centralized view for tracking and analyzing all module deployments.

### Deployments Table View

Both the "My Deployments" and "All Deployments" tabs present a table with a list of deployments. This table provides a high-level summary of each deployment, including:

* Deployment ID: A unique identifier for the deployment.  
* Module Name: The name of the module that was deployed.  
* Status: The current state of the deployment (e.g., PROVISIONING, SUCCESS, FAILURE, CANCELLED). This provides a quick, at-a-glance understanding of the deployment's outcome.  
* User: The email of the user who initiated the deployment.  
* Created At: The timestamp of when the deployment was initiated.  
* Actions: A set of actions that can be performed on the deployment.

### Detailed Deployment Analysis

The primary analysis feature is triggered when a user clicks on the Deployment ID of a specific deployment in the table. This action opens a detailed view, typically in a modal window, which contains several key features for in-depth analysis and troubleshooting.

#### 1\. Deployment Details

The first thing you see is a summary of the deployment's core information, including:

* Deployment ID: The unique identifier is displayed again for reference.  
* Status: The final status of the deployment (e.g., SUCCESS or FAILURE).  
* Creation and Completion Times: Timestamps for when the deployment was started and when it finished, allowing users to understand the total duration.  
* Configuration Parameters: A key-value list of all the variables and parameters that were used for this specific deployment instance. This is crucial for reproducing the deployment or debugging issues related to incorrect configuration.

#### 2\. Tracking Deployment Stages and Progress

The platform provides a real-time, step-by-step log of the entire deployment process. This is the most critical feature for tracking progress and diagnosing issues.

* Log Viewer: The detailed view contains a dedicated log viewer. This viewer streams the logs directly from the backend build process (Cloud Build). Instead of waiting for the entire log file to be generated, it displays log entries as they happen, providing real-time feedback.  
* Step-by-Step Execution: The logs are structured to show the distinct stages of the deployment pipeline. You can see entries for:  
  * Cloning the Git repository.  
  * Running Terraform to provision infrastructure (terraform init, terraform plan, terraform apply).  
  * Executing any custom scripts.  
  * Cleaning up resources.  
* Timestamps: Every log line is timestamped, allowing for precise analysis of how long each step took to complete.

#### 3\. Tracking Errors and Bugs

The log viewer is the primary tool for identifying and understanding errors.

* Error Highlighting: Failed steps and error messages from the underlying tools (like Terraform or shell scripts) are clearly visible in the log output. The deployment status will change to FAILURE, and the logs will contain the exact error message that caused the failure.  
* Root Cause Analysis: By examining the logs, a user can pinpoint the exact stage and command that failed. For example, if a Terraform deployment fails, the terraform apply logs will show the specific resource that could not be created and the reason for the failure provided by the cloud provider. This allows for efficient debugging without needing to access the cloud console directly.  
* Full Context: Since the entire log from start to finish is available, users can see the context leading up to an error, which is often essential for understanding the root cause.

In summary, when a user selects a deployment, they are presented with a comprehensive diagnostic view. They can track the deployment's progress through real-time logs, see the exact configuration used, and, if an error occurs, get the detailed messages needed to debug the problem directly within the platform's UI. This tight integration between the deployment action and its detailed feedback makes for an efficient and user-friendly experience.

