
# Using RAD

<YouTubeEmbed videoId="YPjTzJX2Cak" poster="https://storage.googleapis.com/rad-public-2b65/modules/Using_RAD.png" />

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/Using_RAD.pdf" target="_blank">View Presentation (PDF)</a>

## 1. Introduction

This guide covers the full deployment lifecycle on the Rapid Application Deployment (RAD) platform — from browsing and deploying a module for the first time, to monitoring progress, fixing failures, updating or removing deployments, and managing your credit balance.

---

## 2. Deploying a Module from Scratch

### Step 1 — Navigate to the Deploy Page

Click **Deploy** in the top navigation bar. This opens the module catalog — the central marketplace where you browse, search, and launch deployments.

At the top of the page you will see a summary of your account:

*   **Deployment Count** — The total number of deployments you have initiated.
*   **Credit Balance** — Your current available credits (Awarded Credits + Purchased Credits combined). This is the balance that will be checked before any deployment starts.
*   **Retention Period** — How long your deployment history is kept before automatic cleanup begins.

---

### Step 2 — Browse and Find a Module

Modules are pre-configured, infrastructure-as-code templates (built on Terraform) that provision real cloud applications and services. The catalog is divided into two tabs:

*   **Platform Modules (Basic Deployment):** Curated modules managed by platform administrators, sourced from the global platform repository. Available to all users.
*   **Partner Modules (Custom Deployment):** Modules published by certified Partners from their own GitHub repositories. Visible only if you are a Partner, or if the module's owner has made it public or granted you explicit access.

Each module is shown as a card displaying:

| Field | What it Tells You |
| :--- | :--- |
| **Name** | The module's identifier |
| **Description** | A brief summary of what the module provisions |
| **Star Rating** | Community quality score (1–5 stars), averaged across all user deployments |
| **Deployment Count** | How many times this module has been successfully deployed — higher counts indicate a trusted, popular module |
| **Credit Cost** | Credits deducted from your balance on a successful deployment (only shown when credits are enabled) |

**To search:** Type in the search bar to filter modules by name.

**To pin a module:** Click the **Pin** icon on any card to keep it at the top of your list. Pinned modules always appear first, making frequently used modules faster to find.

The catalog is sorted by: Pinned first → Deployment Count (descending) → Average Rating (descending) → Name (alphabetical).

---

### Step 3 — Confirm Your Prerequisites

Before clicking a module, verify that you meet the following requirements. The platform checks these at submission time; understanding them in advance prevents avoidable failures.

#### Account Requirements

*   You must be signed in with your Google account.
*   Your account must be active (not deactivated by an administrator).
*   You need at least the **User** role to deploy Platform Modules. Deploying a Partner Module requires partner-level access or an explicit grant from the module owner.

#### Credit Requirements

The platform enforces a credit balance check before any deployment is queued.

| Scenario | Requirement |
| :--- | :--- |
| **Standard module (credits enabled)** | `Awarded Credits + Purchased Credits` ≥ module `credit_cost` |
| **Custom deployment (`require_credit_purchases = true`)** | `Purchased Credits` alone ≥ module `credit_cost` — Awarded Credits are not accepted for these modules |
| **Partner deploying their own module** | No credits required — the cost is always zero for the module owner |
| **Credits disabled platform-wide** | No credit check is performed |

If your balance is insufficient, the deployment will be blocked at submission with an error. Navigate to **Credits > Buy Credits** to top up your balance before retrying.

> **Tip:** Your current credit balance is visible in the dashboard stats at the top of the Deploy page. Check it before selecting a module to confirm you have enough to cover the cost shown on the module card.

---

### Step 4 — Open the Configuration Form

Click on the module card you want to deploy. The platform loads a dynamic configuration form based on the input variables (`variables.tf`) defined in that module's source code.

---

### Step 5 — Configure Variables

Fill in all required fields. Common variables include:

*   **Project ID** — The Google Cloud project where resources will be created.
*   **Region** — The geographic region for your resources (e.g., `us-central1`).
*   Additional module-specific inputs such as instance sizes, resource names, feature flags, and access settings.

The form validates your entries against the type and constraint rules defined in the module. Required fields cannot be left blank, and out-of-range or incorrectly typed values will be flagged before you can proceed. The form may be divided into multiple pages — use the **Next** button to step through them.

> **Common configuration failure:** Providing a Project ID that does not exist, or a Region that is not supported for the chosen resource type, will cause the deployment to fail during the Terraform apply stage. Double-check both values before submitting.

---

### Step 6 — Review Cost and Confirm

Before the deployment is submitted, a confirmation modal is shown displaying:

*   The module's **Credit Cost** (if credits are enabled).
*   Your current **Credit Balance**.
*   Any **module dependencies** that will also be provisioned.

Review this carefully. If the cost shown would reduce your balance to zero or below, top up first to avoid a low-credit alert or automatic billing suspension later.

Once satisfied, click **Confirm** to proceed.

> **If the module requires Purchased Credits:** The confirmation modal will indicate this. Ensure your Purchased Credits balance specifically is sufficient — your Awarded Credits balance will not be used for these modules even if it is high.

---

### Step 7 — Submit the Deployment

Click **Deploy**. The platform will:

1. Validate your configuration and credit balance.
2. Create a deployment record in the system with status `QUEUED`.
3. Publish a message to the Cloud Build pipeline to trigger infrastructure provisioning.
4. Redirect you to the **Deployments** page to track progress.
5. Deduct the credit cost from your balance after the deployment completes successfully (failed deployments are not charged).

#### What Can Go Wrong After Submission

Even when all prerequisites are satisfied, a deployment can fail during the build pipeline. The table below covers the most common scenarios:

| Failure Scenario | Symptom | Resolution |
| :--- | :--- | :--- |
| **Insufficient total credits** | Blocked at submission: `INSUFFICIENT_TOTAL_CREDITS` | Purchase or earn more credits and retry |
| **Insufficient purchased credits** | Blocked at submission: `INSUFFICIENT_PURCHASED_CREDITS` | Buy additional Purchased Credits — Awarded Credits will not satisfy this requirement |
| **Invalid Project ID or Region** | Status `FAILURE`; logs show `INVALID_ARGUMENT` or `resource not found` | Correct the values and use the **Update** action to retry |
| **Missing IAM permissions** | Status `FAILURE`; logs show `PERMISSION_DENIED` | Grant the required IAM role to the Cloud Build service account on the target project |
| **Resource quota exceeded** | Status `FAILURE`; logs show `QUOTA_EXCEEDED` | Request a quota increase for the affected resource in Google Cloud Console |
| **Partner GitHub token expired** | Status stays `QUEUED`; logs show a repository clone failure | Update the GitHub Personal Access Token in Profile > Partner Settings and re-publish the module |
| **Module misconfiguration** | Module missing from catalog or variables form is empty | The partner must correct `variables.tf` in their repository and re-publish |
| **Cloud Build timeout** | Status changes from `WORKING` to `TIMEOUT` | Review logs for slow Terraform steps; simplify the module or extend the Cloud Build timeout |
| **Deployment stuck** | Status stays `QUEUED` or `WORKING` with no progress | Use the **Purge** action to force-remove the record and start again |

---

## 3. Tracking Deployment Progress

### 3.1. The Deployments Page

Navigate to **Deployments** in the top navigation. You will see a list of your deployments with the following information:

| Column | Description |
| :--- | :--- |
| **Deployment ID** | A unique short identifier for the deployment |
| **Module** | The name of the deployed module |
| **Status** | The current state of the deployment (see below) |
| **Created At** | Timestamp of when the deployment was initiated |

### 3.2. Deployment Statuses

| Status | Meaning |
| :--- | :--- |
| `QUEUED` | The deployment request has been received and is waiting for the build pipeline to pick it up |
| `WORKING` | The Cloud Build pipeline is actively running (cloning the repository, executing Terraform) |
| `SUCCESS` | The infrastructure was provisioned successfully |
| `FAILURE` | The deployment failed — view the logs to identify the cause |
| `DELETING` | A delete action has been triggered; Terraform destroy is running |
| `DELETED` | The infrastructure has been destroyed; the record is retained for history |
| `CANCELLED` | The deployment was cancelled before completion |

### 3.3. Viewing Real-Time Logs

Click any **Deployment ID** in the list to open the detailed view. This page provides:

*   **Progress Steps** — A visual representation of each stage in the pipeline (clone, init, plan, apply, cleanup).
*   **Live Log Stream** — Logs are streamed in real time directly from Cloud Build. You can watch each Terraform command execute as it happens.
*   **Outputs Tab** — Terraform outputs (e.g., URLs, IP addresses) displayed after a successful deployment.
*   **Builds Tab** — A history of all Cloud Build runs associated with this deployment, including retries and updates.

The status page refreshes automatically every 10 seconds. There is no need to manually reload the page.

---

## 4. Fixing Issues

When a deployment status shows `FAILURE`, use the following approach to diagnose and resolve it.

### 4.1. Read the Logs

1.  Click the **Deployment ID** to open the details view.
2.  Navigate to the **Logs** tab.
3.  Scroll through the output to find the first error message. Terraform errors are clearly marked and explain which resource failed and why.

### 4.2. Common Fixes

| Log Error | Cause | Fix |
| :--- | :--- | :--- |
| `PERMISSION_DENIED` | Cloud Build service account lacks IAM roles | Grant the required role to the build service account in Google Cloud IAM |
| `INVALID_ARGUMENT` | A variable value is invalid (wrong format, unsupported value) | Update the deployment with corrected variable values |
| `QUOTA_EXCEEDED` | Resource quota limit reached in the target project | Request a quota increase in Google Cloud Console |
| `Error: Failed to clone repository` | GitHub token is expired, revoked, or lacks `repo` scope | Update the GitHub Personal Access Token in Profile > Partner Settings |
| `Error creating resource: already exists` | A resource with the same name already exists in the project | Use a unique Project ID or resource name |

### 4.3. Retrying with an Update

Once you have identified the issue, use the **Update** action to retry the deployment with corrected values (see Section 5 below). You do not need to delete and recreate the deployment from scratch.

---

## 5. Updating a Deployment

The Update action re-runs a deployment with modified configuration variables, applying changes via `terraform apply` against the existing infrastructure.

### When to Use Update

*   A deployment failed due to an invalid variable value and you want to retry with the correct value.
*   You want to change a configuration setting on an existing successful deployment (e.g., upgrade an instance type).

### How to Update

1.  Navigate to **Deployments**.
2.  Click the **Deployment ID** of the deployment you want to modify.
3.  Click the **Update** button (Adjustments icon) in the detail view header.
4.  The configuration form opens pre-filled with the current variable values.
5.  Make your changes, step through the form, and click **Submit**.
6.  A new Cloud Build run is triggered. The deployment status returns to `QUEUED` / `WORKING` while the update applies.

---

## 6. Deleting a Deployment

Deleting a deployment tears down all associated cloud infrastructure via `terraform destroy`. This is permanent and cannot be undone.

### How to Delete

1.  Navigate to **Deployments**.
2.  Click the **Trash** icon on the deployment row, or open the deployment details and click **Delete**.
3.  A confirmation modal will appear. Review the warning and confirm the action.
4.  The deployment status changes to `DELETING`. The platform publishes a message to the destruction pipeline.
5.  Cloud Build executes `terraform destroy`, removing all Google Cloud resources.
6.  Once complete, the status changes to `DELETED`. The deployment record is retained for historical reference.

> **Warning:** Deletion is irreversible. All cloud resources (VMs, databases, storage buckets, networking, etc.) created by this deployment will be permanently destroyed.

### What Is and Is Not Removed

| Artifact | Removed on Delete? |
| :--- | :--- |
| Google Cloud resources (VMs, databases, etc.) | Yes — via `terraform destroy` |
| Firestore deployment record | No — retained for history |
| Cloud Storage artifacts (logs, Terraform state) | No — cleaned up later by the retention policy |

---

## 7. Purging a Deployment

Purge is a more aggressive cleanup action that forcibly removes both the cloud resources and the deployment record from the system immediately. It is designed for deployments that are **stuck**, **unresponsive**, or where a standard delete did not complete successfully.

### When to Use Purge

*   A deployment is stuck in `QUEUED` or `WORKING` and is not progressing.
*   A delete action failed and the deployment record is in an inconsistent state.
*   You want to immediately remove all trace of a deployment without waiting for the graceful deletion pipeline.

### How to Purge

1.  Navigate to **Deployments**.
2.  Open the deployment details by clicking the Deployment ID.
3.  Click the **Purge** button.
4.  Confirm the action in the modal.
5.  The platform performs a hard deletion: all associated resources are forcibly removed, and the deployment record is deleted from the system immediately upon completion.

> **Warning:** Purge bypasses the normal destruction pipeline. Use it only when the standard Delete action has failed or the deployment is irrecoverably stuck.

### Retention Policy and Automated Cleanup

The platform also enforces an automated retention policy:

*   **Retention Period:** Deployments older than the configured retention period (30, 90, 180, or 365 days, or never) are automatically soft-deleted.
*   **Grace Period:** After soft deletion, you have a grace period (default 7 days) to restore the deployment before it is permanently removed.
*   **Restoration:** Click the restoration link in the notification email, or navigate to the deployment details and click **Restore**.
*   **Permanent Removal:** After the grace period, the Firestore record and all Cloud Storage artifacts are permanently deleted.

---

## 8. Credit Management

The credit system controls access to paid module deployments. Understanding how credits are allocated and consumed helps you plan your usage and avoid interrupted deployments.

### 8.1. Credit Types

The platform distinguishes between two types of credits, stored separately in your account:

| Type | Source | Priority | Special Rules |
| :--- | :--- | :--- | :--- |
| **Awarded Credits** | Sign-up bonuses, referrals, admin grants | Consumed **first** by default | Cannot be cashed out; do not contribute to Partner/Agent revenue calculations |
| **Purchased Credits** | One-time purchases or monthly subscriptions via Stripe or Flutterwave | Consumed **second** (after Awarded Credits are exhausted) | Count as "True Revenue" for Partners and Agents; required exclusively by some modules |

**Total Balance** = Awarded Credits + Purchased Credits

### 8.2. How Credits Are Allocated

Credits reach your account through several channels:

*   **Sign-Up Bonus:** New accounts are automatically provisioned with a configurable number of Awarded Credits.
*   **Referral Program:** Share your unique referral link or QR code from the **Help > Support** tab. When a referred user signs up, both you and the new user receive Awarded Credits (subject to a maximum referral cap).
*   **Subscriptions:** Subscribe to a tier on the **Credits > Buy Credits** tab. A monthly allowance of Purchased Credits is added to your account on each billing cycle.
*   **One-Time Purchases:** Buy a specific credit bundle via Stripe or Flutterwave from the **Buy Credits** tab.
*   **Admin Grants:** Platform administrators can manually add or adjust credits on your account at any time.

### 8.3. How Credits Are Consumed

Credits are deducted **after** a deployment succeeds, not when it is submitted. Failed deployments do not consume credits.

The deduction order is:

1. **Awarded Credits are deducted first** until exhausted.
2. **Purchased Credits are deducted** for any remaining balance.

**Exception:** If a module has the `require_credit_purchases` flag set to `true`, the full cost is deducted exclusively from Purchased Credits. Awarded Credits are not used, even if your Awarded balance is high.

**Partner Exemption:** If you are a Partner deploying a module that you own, the credit cost is always zero — no credits are deducted regardless of the module's defined cost.

### 8.4. Viewing Your Balance and History

Navigate to the **Credits** page from the top navigation bar:

*   **Credit Balance:** Displayed in the header stats area and at the top of the Credits page.
*   **Credit Transactions Tab:** A searchable, filterable history of every credit award, purchase, and spend event. Each transaction shows the date, amount, type (Awarded or Purchased), Deployment ID (as a clickable link), and running balance. Export the full history as a CSV file.
*   **Module Costs Tab:** (If enabled) A breakdown of credit spending by module across all your deployments.
*   **Project Costs Tab:** (If enabled) Historical infrastructure costs from Google Cloud, converted to credits using the platform's `price per credit` rate.
*   **Project Invoices Tab:** (If enabled) Monthly invoices for your projects' cloud spending, queryable by month and exportable to CSV.
*   **Subscriptions Tab:** (If enabled) View available subscription tiers and manage your current subscription.

### 8.5. Low Credit Alerts

When your credit balance falls below the configured threshold, the platform sends an automated email alert. To avoid deployment interruptions, top up your balance via the **Buy Credits** tab before the balance reaches zero.

### 8.6. Automatic Billing Suspension

If your account's credit balance reaches zero and ongoing project costs are being tracked, the platform will automatically **disable Google Cloud billing** for your projects to prevent unexpected charges. Billing is re-enabled automatically once your balance is restored and the system's next billing cycle runs.

### 8.7. Transaction Types Reference

| Transaction Type | Description |
| :--- | :--- |
| `SIGNUP` | Initial sign-up bonus credited to your account |
| `AWARD` | Free credits granted by an admin or earned via referral |
| `PURCHASE` | Credits added from a Stripe or Flutterwave payment |
| `SPEND` | Credits deducted for a successful module deployment |
| `PROJECT` | Credits deducted for ongoing Google Cloud infrastructure costs |
| `PARTNER` | Monthly partner credit allowance (Partners only) |
