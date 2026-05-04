import AudioPlayer from '@site/src/components/AudioPlayer';

# User Workflow

<img src="https://storage.googleapis.com/rad-public-2b65/workflows/user_workflow.png" alt="User Workflow" style={{marginBottom: '20px'}} />

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflows/user_workflow.m4a" title="User Workflow Audio" />

<video width="100%" controls style={{marginTop: '20px'}}>
  <source src="https://storage.googleapis.com/rad-public-2b65/workflows/user_workflow.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## 1. Introduction
Welcome to the platform! This tutorial covers the core actions you'll perform as a user: deploying applications, managing them, retrieving deployment outputs, and tracking your credits.

## 2. Step 1: Deploy a Module
The core feature of the platform is deploying pre-configured software modules.

1.  Click **Deploy** in the top navigation bar.
2.  **Find a Module:**
    *   Browse the **Platform Modules** tab for public modules.
    *   Use the search bar to find modules by name.
    *   If you have access to partner-specific modules, click the **Partner Modules** tab.
    *   Click the **Pin** icon on any module card to keep frequently-used modules at the top of your list.
3.  **Start Deployment:**
    *   Click on a module card to start the configuration process.
    *   Fill in the required variables (e.g., project name, region).
    *   Review the estimated cost (if credits are enabled).
    *   Click **Deploy** to launch your application.

> **Credit check:** The platform verifies your credit balance before queuing the deployment. If the module requires Purchased Credits specifically, your Awarded Credits balance will not satisfy the requirement — you must buy additional credits first.

## 3. Step 2: Manage Your Deployments
Once you've deployed a module, you can monitor and manage it.

1.  Click **Deployments** in the navigation bar.
2.  **View Status:**
    *   You will see a list of your deployments with their current status (e.g., `QUEUED`, `WORKING`, `SUCCESS`, `FAILURE`).
    *   Use the search bar to find specific deployments by name or ID.
3.  **View Details, Logs, and Outputs:**
    *   Click on any deployment row to open the details view.
    *   You can view real-time build logs to troubleshoot issues or verify success.
    *   Click the **Outputs** tab to see the Terraform outputs from a successful deployment — this is where you find application URLs, IP addresses, service endpoints, and any other values exported by the module.
4.  **Update a Deployment:**
    *   To change a variable on an existing deployment (e.g., upgrade an instance type, fix a bad value), click the **Update** button on the details page.
    *   The configuration form opens pre-filled with the current values. Adjust as needed and submit.
5.  **Cancel a Deployment:**
    *   If a deployment is in `QUEUED` or `WORKING` state and you want to stop it, click **Cancel** on the details page.
6.  **Delete a Deployment:**
    *   If you no longer need an application, click the **Trash** icon (Delete) to tear down all associated cloud infrastructure.
    *   Deletion runs `terraform destroy` and cannot be undone. The deployment record is retained for history.

### Restoring a Soft-Deleted Deployment

When the platform's retention policy triggers (or you manually delete a deployment), it is first **soft-deleted** — a grace period of 7 days applies before permanent removal. During this window you can restore the deployment and its record.

**To restore:**

1.  Click the restoration link in the notification email you received when the deployment was soft-deleted, **or**
2.  Navigate to **Deployments**, find the deployment with status `SOFT_DELETED`, open the details view, and click **Restore**.

> **Warning:** After the 7-day grace period, the deployment record and all Cloud Storage artifacts are permanently deleted and cannot be recovered.

## 4. Step 3: Manage Credits & Costs
If your platform uses a credit system, you'll need to manage your balance.

1.  Click **Credits** in the navigation bar.
2.  **Check Balance:** Your current balance is displayed in the top header stats or on this page.
3.  **Buy Credits (if enabled):**
    *   Click the **Buy Credits** tab.
    *   Choose a subscription plan or purchase a one-time credit bundle.
    *   **Payment providers:** Stripe and Flutterwave are supported. Flutterwave supports payment in multiple currencies (see below).
4.  **Multi-Currency Payments:**
    *   When checking out via Flutterwave, select your preferred currency from the dropdown.
    *   Supported currencies include USD, EUR, GBP, NGN, GHS, KES, ZAR, TZS, UGX, RWF, XAF, and XOF.
    *   Exchange rates are refreshed daily — the rate shown at checkout reflects the current day's rate.
5.  **Review Transactions:**
    *   The **Credit Transactions** tab shows a complete history of credit awards, purchases, and spending.
    *   Each row links to the deployment that consumed the credits (if applicable).
    *   Click **Export CSV** to download a report for your records.
6.  **Manage Your Subscription:**
    *   The **Subscriptions** tab (if enabled) shows available plans and your current subscription status.
    *   If your subscription was cancelled and you want to reactivate it, click **Reinstate** on your previous plan. Credits for the new cycle are added immediately.

## 5. Step 4: Get Help
Need assistance or more detailed guides?

1.  Click **Help** in the navigation bar.
2.  **Read Guides:** Access the **User Guide** tab for detailed documentation.
3.  **Contact Support:**
    *   Click the **Support** tab.
    *   Fill out the support form to send a message directly to the admin team.
    *   **Invite Friends:** (If enabled) Use the "Invite Friends" card to copy your referral link or scan the QR code to invite new users. Both you and the new user receive Awarded Credits when they sign up.
4.  **ROI Calculator** (If enabled):
    *   Available in the **Help** section, the ROI Calculator shows the value you have received from the platform.
    *   It calculates metrics including total deployments, monthly deployment rate, total credits spent, and your effective cost per deployment.
    *   Use it to build a business case or compare your cloud spending against the platform's pricing.
