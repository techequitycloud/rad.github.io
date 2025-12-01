# Platform Modules Feature

## Overview

The Platform Modules feature enables users to deploy infrastructure modules using a credit-based system. This feature supports two primary sources of modules: **Platform Modules** (managed by administrators) and **Partner Modules** (published by partners). The system integrates with GitHub for module source management and Google Cloud Build for deployment execution.

## Module Types

The platform supports two distinct categories of modules:

### 1. Platform Modules
-   **Source:** `admin`
-   **Managed By:** Platform Administrators.
-   **Visibility:** Available to all users.
-   **Repository:** Synced from the global platform GitHub repository configured in Admin Settings.

### 2. Partner Modules
-   **Source:** `partner`
-   **Managed By:** Partners.
-   **Visibility:**
    -   Always visible to the partner who owns them.
    -   Visible to other users if `public_access` is enabled in the module configuration.
-   **Repository:** Synced from the partner's personal GitHub repository configured in their profile.

## Publishing Workflow

Modules are not uploaded directly but are synchronized from a connected GitHub repository.

1.  **Configuration:** A `module.yaml` (or similar) configuration file in the repository defines module metadata, including:
    -   `variables`: Input variables for the Terraform module.
    -   `credit_cost`: The cost to deploy the module.
    -   `require_credit_purchases`: Whether purchased credits are mandatory.
2.  **Sync Process:**
    -   **Admins** sync modules via the Admin Settings panel.
    -   **Partners** sync modules via the "Publish" page.
    -   The system validates module names to ensure uniqueness within the relevant scope.
    -   Modules are stored in the Firestore `modules` collection.

## Deployment & Credit System

The deployment process is gated by a robust credit system that ensures users have sufficient funds before resources are provisioned.

### Credit Logic

Users have two types of credits:
1.  **Awarded Credits (`creditAwards`):** Free credits granted by admins or upon signup.
2.  **Purchased Credits (`creditPurchases`):** Credits bought via Stripe.

**Total Balance** = `creditAwards` + `creditPurchases`

### Cost Calculation

The cost of a deployment is determined by the `credit_cost` variable defined in the module.

### Billing Rules

1.  **Standard Deployment:**
    -   The system checks if `Total Balance` >= `credit_cost`.
    -   If insufficient, the deployment is rejected (`INSUFFICIENT_TOTAL_CREDITS`).

2.  **Premium Modules (`require_credit_purchases = true`):**
    -   Some modules may strictly require purchased credits.
    -   The system checks if `creditPurchases` >= `credit_cost`.
    -   If insufficient, the deployment is rejected (`INSUFFICIENT_PURCHASED_CREDITS`), even if the user has a large balance of Awarded Credits.

3.  **Partner Privilege (Free Self-Deployment):**
    -   **Rule:** If a Partner deploys a module that **they own** (i.e., `module.partnerId === user.uid`), the deployment is **free**.
    -   `credit_cost` is treated as `0`.
    -   `require_credit_purchases` check is bypassed.

## Deployment Architecture

The deployment flow follows a serverless, event-driven architecture:

1.  **User Action:** User clicks "Deploy" in the UI (`Deploy.tsx`).
2.  **API Validation (`POST /api/deployments`):**
    -   Verifies user authentication.
    -   Calculates final credit cost (applying Partner Privilege if applicable).
    -   Checks user credit balance.
    -   Creates a deployment record in Firestore with status `QUEUED`.
3.  **Asynchronous Trigger:**
    -   The API publishes a message to Google Cloud Pub/Sub.
    -   This message contains details like `repoUrl`, `variables`, and `buildId`.
4.  **Execution (Cloud Build):**
    -   A Cloud Build trigger consumes the Pub/Sub message.
    -   It clones the appropriate repository (Platform or Partner).
    -   It runs Terraform to provision the infrastructure.
5.  **Status Updates:**
    -   Cloud Build steps update the deployment status in Firestore (e.g., `provisioning`, `success`, `failed`).
    -   Upon success, a Cloud Function (`update_status`) triggers the actual credit deduction.

## User Interface

-   **Deploy Page:** Users browse modules via "Platform Modules" and "Partner Modules" tabs.
-   **Search:** Modules can be searched by name.
-   **Stats:** Users can view their remaining credit balance and deployment count.
-   **Module Card:** Displays module details, star ratings, and pinned status.
