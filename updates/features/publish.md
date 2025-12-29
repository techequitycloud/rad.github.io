# Publish Modules

The **Publish** page is designed for Partners and Administrators to onboard new modules onto the platform. It allows you to select Terraform modules from your connected GitHub repository and make them available to users.

## Prerequisites

*   **Partner or Admin Role:** You must have the appropriate permissions to access this page.
*   **GitHub Connection:** Your account (or the platform) must be connected to a GitHub repository containing Terraform modules.

## Features

### 1. Repository Scanning
*   The page automatically scans the connected GitHub repository.
*   It detects folders that contain valid `main.tf` or `variables.tf` files, identifying them as potential modules.
*   **Search:** You can search through the discovered modules by name.

### 2. Module Selection
*   **Available Modules:** A list of all valid modules found in the repo.
*   **Selection:** Click on a module card to select it for publishing. You can select multiple modules at once.
*   **Status Indicators:**
    *   **Published:** Modules that are already live are highlighted. Selecting them again allows you to **Update** them.
    *   **New:** Modules that have not yet been published.

### 3. Publishing / Updating
*   **Publish Button:** Once you have selected modules, click the "Publish" (or "Update") button.
*   **Variable Fetching:** The system will automatically fetch the input variables (`variable "..." {}`) defined in your Terraform code.
*   **Configuration:** You may be asked to configure default values or UI settings for these variables (e.g., marking a variable as "required" or adding a description).

## How to Publish a Module

1.  Navigate to the **Publish** page.
2.  Wait for the system to scan your repository.
3.  **Search** for the module you want to publish.
4.  **Click** the module card to select it. It will turn green or show a checkmark.
5.  Click the **Publish** button at the bottom.
6.  The system will process the module variables and register it in the marketplace.
7.  Once successful, the module will appear on the **Deploy** page for users to use.

## Updating a Module

To update a module (e.g., after you pushed code changes to GitHub):
1.  Go to the **Publish** page.
2.  Select the already-published module.
3.  Click **Update**.
4.  The system will re-scan the variables and update the module definition in the platform.
