---
title: Admin Tutorial
---

# Tutorial: Administrator Setup

## Overview

This tutorial covers the essential configuration tasks required to set up a new RAD platform instance. You will connect the platform to a GitHub module repository, publish modules for users, and configure the monetisation engine — including subscription tiers, credit settings, and user credit management.

**Audience:** Users with the **Admin** role  
**Estimated time:** 20–30 minutes

By the end of this tutorial you will have:
- Configured global platform settings (organisation, billing, and email)
- Connected a GitHub repository containing Terraform modules
- Published modules to the deployment catalog
- Created a subscription tier and defined credit pricing
- Adjusted credits for an individual user

---

## Step 1: Configure Global Settings

1. Click **Setup** in the navigation bar.
2. Fill in the required organisation fields:

   | Field | Description |
   | :--- | :--- |
   | **Organization ID** | Your Google Cloud Organisation ID |
   | **Billing Account ID** | The Billing Account to charge for all provisioned projects |
   | **Folder ID** | The GCP Folder where new projects will be created |

3. Under **Features**, check both **Enable Credits** and **Enable Subscription** to activate the monetisation engine.
4. Set the **Retention Period** — the number of days deployment history is retained before automatic cleanup (for example, `90`).
5. Enter your **Mail Server Email** and **Mail Server Password** (SMTP credentials). Check **Email Notifications** to activate outbound emails for deployment events.
6. Click **Submit** to save your global configuration.

---

## Step 2: Connect the Platform Repository

Modules are sourced from a GitHub repository containing Terraform code. You must connect the platform to that repository before users can deploy anything.

1. Click your **Profile Icon** in the top-right corner and select **Profile**.
2. Scroll down to the **Admin Settings** section.
3. **Platform GitHub Token** — Enter a GitHub Personal Access Token with `repo` scope access to your modules repository. Click **Save Token**.

   > **Security note:** Store this token securely. It grants the platform read access to your entire modules repository. Rotate it regularly and never commit it to version control.

4. **Platform GitHub Repository** — Once the token is saved, a dropdown will appear listing accessible repositories. Select the correct repository and click **Update Repo**.

---

## Step 3: Publish Modules

With the repository connected, you can now select which modules to expose to users on the Deploy page.

1. Click **Publish** in the navigation bar.
2. The page lists all valid modules detected in your connected repository.
3. Click a module card to select it (selected modules are highlighted). Select all modules you want to make available.
4. Click **Publish** (or **Update** if modules were previously published).
5. The selected modules now appear on the **Deploy** page for all platform users.

> **Note:** You can return to this page at any time to add newly developed modules or remove modules that are no longer supported.

---

## Step 4: Create a Subscription Tier

Subscription tiers define the plans available to users when purchasing credits. You can create multiple tiers (for example, a free tier, a professional tier, and an enterprise tier).

> **Prerequisite:** Accessing the **Billing** page requires the **Finance** role. If you do not see a **Billing** link in the navigation, go to the **Users** page and assign the Finance role to your account before continuing.

1. Click **Billing** in the navigation bar.
2. Click the **Subscription Tiers** tab.
3. Click **Add New Tier**.
4. Fill in the form:

   | Field | Example value |
   | :--- | :--- |
   | **Name** | `Pro Plan` |
   | **Price** | `29.99` |
   | **Credits** | `5000` |
   | **Features** | `Access to all modules, Priority Support` |

5. Click **Save**. The new tier is immediately visible to users on the Credits page.

---

## Step 5: Configure Credit Settings

Credit settings define the exchange rate, sign-up bonuses, and ongoing credit allocations for all users.

1. Click the **Credit Settings** tab (on the Billing page).
2. Configure each setting and click **Save** after each one:

   | Setting | Example | Description |
   | :--- | :--- | :--- |
   | **Price Per Credit** | `100` | Number of credits per one unit of currency |
   | **Signup Credits** | `500` | Free credits awarded to every new user on first login |
   | **Credits Per Hour** | `100` | Build-time cost charged per hour of deployment duration |
   | **Low Credit Notification** | `50` | Balance threshold that triggers a low-credit warning email |
   | **Monthly Credits** | `200` | Recurring credits automatically awarded to users each month |

---

## Step 6: Manage Individual User Credits

Use this step when a user needs a credit adjustment — for example, as a goodwill gesture after a failed deployment, or to correct an accounting error.

1. Click the **Credit Management** tab.
2. Use the search bar to locate the user by email address.
3. Click **Edit** on their row.
4. Update the **Awards** field to the new total credit amount (for example, enter `1000` to set their awarded credits to 1,000).
5. Click **Save**. The adjustment is applied instantly and the user's balance reflects the change immediately.

---

## Next Steps

- **[Finance Tutorial](./finance)** — Deep dive into billing dashboards, agent revenue reporting, and invoice generation.
- **[Support Tutorial](./support)** — Learn how to investigate user deployment failures and manage the module catalog.
- **[Partner Tutorial](./partner)** — Understand the partner workflow for publishing custom modules.
