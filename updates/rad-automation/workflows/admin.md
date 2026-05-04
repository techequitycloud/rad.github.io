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
6.  **Retention Period:** Select the number of days to keep deployment history (e.g., 90).
7.  **Mail:** Enter your SMTP credentials (Email and Password) so the system can send emails.
8.  Click **Submit** to save.

## 3. Step 2: Configure Platform Repository
To allow users to deploy modules, you must first connect the platform to a GitHub repository containing your Terraform modules.

1.  Click your **Profile Icon** in the top right and select **Profile**.
2.  Scroll down to the **Admin Settings** section.
3.  **Platform GitHub Token:** Enter a GitHub Personal Access Token that has access to your modules repository.
4.  **Platform GitHub Repository:** Once the token is entered, select your repository from the dropdown list.
5.  Click **Save Github Settings**.

## 4. Step 3: Publish Modules
Now that the repository is connected, you need to publish specific modules to make them available to users.

1.  Click **Publish** in the navigation bar.
2.  You will see a list of available modules from your connected repository.
3.  Select the modules you want to make available by clicking them (selected modules are highlighted).
4.  Click **Publish** (or **Update**).
5.  The selected modules will now be visible on the **Deploy** page for users.

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
5.  Click **Save**. Your new tier is now live!

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
