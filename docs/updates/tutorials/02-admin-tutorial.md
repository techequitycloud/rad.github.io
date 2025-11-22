# Tutorial: Administrator Setup

## 1. Introduction
This tutorial covers the essential tasks for setting up a new RAD platform instance. You will configure global settings, create a subscription tier, and manage user credits.

## 2. Step 1: Global Configuration
1.  Click **Setup Menu** in the navigation bar.
2.  **Scope:** Set the "Folder ID" where you want all projects to be created.
3.  **Features:** Check **Enable Credits** and **Enable Subscription**. This turns on the monetization engine.
4.  **Mail:** Enter your SMTP credentials so the system can send emails.
5.  Click **Submit** to save.

## 3. Step 2: Create a Subscription Tier
Now that subscriptions are enabled, let's create a plan for users to buy.

1.  Go to the **Billing** page.
2.  Click the **Subscription Tiers** tab.
3.  Click **Add New Tier**.
4.  Fill in the form:
    *   **Name:** "Pro Plan"
    *   **Price:** "29.99"
    *   **Credits:** "5000"
    *   **Features:** "Access to all modules, Priority Support"
5.  Click **Save**. Your new tier is now live!

## 4. Step 3: Define Credit Settings
Let's set the exchange rate and freebies.

1.  Click the **Credit Settings** tab (still on the Billing page).
2.  **Price Per Credit:** Enter `100` (meaning 100 credits = 1 unit of currency). Click Save.
3.  **Signup Credits:** Enter `500`. Now every new user gets a head start. Click Save.

## 5. Step 4: Manage a User
A user just emailed saying they need extra credits.

1.  Scroll down to the **User Credits** table.
2.  Search for the user's email.
3.  Click **Edit** on their row.
4.  In the **Awarded** column, add `1000` to their current balance.
5.  Click **Save**.
6.  The user now has the credits instantly!
