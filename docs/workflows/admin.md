import AudioPlayer from '@site/src/components/AudioPlayer';

# Tutorial: Administrator Workflow

<img src="https://storage.googleapis.com/rad-public-2b65/workflows/admin_workflow.png" alt="Admin Workflow" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflows/admin_workflow.m4a" title="Admin Workflow Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/workflows/admin_workflow.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction
This tutorial covers the essential tasks for setting up a new RAD platform instance. You will configure global settings, connect the platform repository, publish modules, and configure monetization settings like subscription tiers and user credits.

## 2. Step 1: Global Configuration
1.  Click **Setup** in the navigation bar.
2.  **Organization Id:** Enter your Google Cloud **Organization ID**.
3.  **Billing Account Id:** Enter the **Billing Account ID** associated with your Google Cloud projects.
4.  **Folder Id:** Set the **Folder ID** where you want all projects to be created.
5.  **Features:** Check **Enable Credits** and **Enable Subscription**. This turns on the monetization engine.
6.  **Retention Period:** Select the number of days to keep deployment history (30, 90, 180, or 365 days, or never). After this period, deployments are soft-deleted with a 7-day grace period before permanent removal.
7.  **Mail:** Enter your SMTP credentials (email address and app password) so the platform can send low-credit alerts, retention notifications, and system emails.
8.  Click **Submit** to save.

## 3. Step 2: Configure Platform Repository
To allow users to deploy modules, you must first connect the platform to a GitHub repository containing your Terraform modules.

1.  Click your **Profile Icon** in the top right and select **Profile**.
2.  Scroll down to the **Admin Settings** section.
3.  **Platform GitHub Token:** Enter a GitHub Personal Access Token with `repo` scope that has read access to your modules repository.
4.  **Platform GitHub Repository:** Once the token is validated, select your repository from the dropdown list.
5.  Click **Save Github Settings**.

### Managing Multiple GitHub Repositories

The platform supports multiple GitHub repositories as module sources. To add additional repositories:

1.  Navigate to **Profile > Admin Settings**.
2.  Enter a token that has access to the additional repository.
3.  Select the repository from the dropdown and save. The new repository is added alongside existing ones.
4.  When publishing modules (Step 3), modules from all connected repositories will appear in the list.

> **Token scope:** Each token must have the `repo` scope. The platform validates token accessibility at save time — an error will be shown if the token cannot reach the selected repository.

## 4. Step 3: Publish Modules
Now that the repository is connected, you need to publish specific modules to make them available to users.

1.  Click **Publish** in the navigation bar.
2.  You will see a list of available modules from your connected repository.
3.  Select the modules you want to make available by clicking them (selected modules are highlighted).
4.  Click **Publish** (or **Update**).
5.  The selected modules will now be visible on the **Deploy** page for users.

> **Re-publishing:** When module code is updated in the source repository, return to the Publish page and click **Update** on the affected module. This refreshes the module definition (variables, description, cost) in the platform without removing existing deployments.

## 5. Step 4: Create a Subscription Tier
Now that subscriptions are enabled, let's create a plan for users to buy.

**Note:** You must have the **Finance** role to access the Billing page. If you don't see the 'Billing' link, go to the **Users** page and assign the Finance role to your account.

1.  Click **Billing** in the navigation bar.
2.  Click the **Subscription Tiers** tab.
3.  Click **Add New Tier**.
4.  Fill in the form:
    *   **Name:** "Pro Plan"
    *   **Price:** "29.99"
    *   **Credits:** "5000"
    *   **Features:** "Access to all modules, Priority Support"
5.  Click **Save**. Your new tier is now live and visible to users on the Buy Credits page.

## 6. Step 5: Define Credit Settings
Let's set the exchange rate for credits and new user bonuses.

1.  Click the **Credit Settings** tab (still on the Billing page).
2.  **Price Per Credit:** Enter `100` (meaning 100 credits = 1 unit of currency). Click **Save**.
3.  **Signup Credits:** Enter `500`. Now every new user gets a head start. Click **Save**.
4.  **Low Credit Threshold:** Enter a value (e.g., `50`) to notify users when their balance is low. Click **Save**.
5.  **Monthly Top-Up:** Enable this feature and set an amount (e.g., `200`) to give users recurring monthly credits. Click **Save**.

## 7. Step 6: Manage a User
If a user needs extra credits or adjustments:

1.  Click the **Credit Management** tab.
2.  Use the search bar to find the user by email.
3.  Click **Edit** on their row.
4.  Update the **Awards** field to the new total amount (e.g., if they have 0 and you want to give 1000, enter `1000`).
5.  Click **Save**.
6.  The user receives the credits instantly!

### Bulk User Operations

To update credits or roles for multiple users at once:

1.  Navigate to the **Users** page.
2.  Select the users you want to modify using the checkboxes.
3.  Click **Bulk Update** and choose the action (assign role, award credits).
4.  Confirm the action. Changes are applied to all selected users immediately.

## 8. Step 7: Payment Health & Reconciliation

The platform automatically reconciles payments from both payment providers (Stripe and Flutterwave) every day at 2:00 AM UTC. This job detects:

*   **Missing credits** — a payment completed successfully but no credits were added to the user's account.
*   **Duplicate credits** — a payment was credited more than once.

To **manually trigger reconciliation** or view the results:

1.  Navigate to **Billing > Credit Management**.
2.  Click **Reconcile Payments**. The job runs immediately and displays a summary of any discrepancies found.
3.  Review the report and take corrective action (manually add or adjust credits) as needed.

### Payment Provider Health

The platform monitors the availability of all three payment providers in real time. If a provider is degraded or unreachable:

*   The checkout page will hide that provider's option automatically.
*   Users will still be able to pay through the remaining available providers.
*   The health status is visible to administrators via the system health endpoint.

## 9. Step 8: Automated Background Jobs

The platform runs the following scheduled jobs automatically. Understanding the schedule helps you diagnose unexpected credit changes or billing events.

| Job | Schedule (UTC) | What It Does |
| :--- | :--- | :--- |
| **Credit Project** | Daily 00:00 | Deducts credits from user accounts based on actual GCP project infrastructure costs for the previous day |
| **Credit Low Alert** | Daily 00:20 | Sends email notifications to users whose credit balance has dropped below the configured threshold |
| **Credit Monthly** | Monthly | Processes monthly subscription top-ups, adding Purchased Credits to subscriber accounts |
| **Credit Partner** | Monthly | Allocates monthly revenue credits to Partner accounts based on deployments by referred/managed users |
| **Credit Processor** | Continuous | Processes the credit transaction queue — awards, purchases, and spend events |
| **Payment Reconciliation** | Daily 02:00 | Reconciles payments across Stripe and Flutterwave; flags discrepancies |
| **Currency Sync** | Daily 01:00 | Fetches the latest exchange rates and updates supported currency codes for Flutterwave checkouts |

> **Tip:** If a user reports that their credits weren't deducted after a deployment or that a payment didn't register, check whether the relevant job ran recently and whether there are any error logs in Cloud Logging for the corresponding Cloud Function.
