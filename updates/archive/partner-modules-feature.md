# Partner Modules Feature

The Partner Modules feature allows partners to publish their own Terraform modules to the platform, making them available for users to deploy. Partners can choose to keep modules private, make them public, or monetize them by setting a credit cost.

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Configuration](#configuration)
4. [Module Development](#module-development)
    - [Structure](#structure)
    - [Variables & Metadata](#variables--metadata)
5. [Publishing Workflow](#publishing-workflow)
6. [Access Control & Pricing](#access-control--pricing)
7. [Revenue & Analytics](#revenue--analytics)

## Overview

This feature transforms the platform into a marketplace where:
- **Admins** manage the core platform modules.
- **Partners** bring their own modules from their private GitHub repositories.
- **Users** can discover and deploy both platform and partner modules.

## Prerequisites

To use this feature as a publisher, you need:
- A user account with the **Partner** role.
- A private GitHub repository containing your Terraform modules.
- A GitHub Personal Access Token (PAT) with `repo` scope.

## Configuration

Before publishing, a partner must link their GitHub repository to their profile.

1. Navigate to **Profile** > **Settings**.
2. Enter your **GitHub Repository URL** (e.g., `https://github.com/my-org/my-modules`).
3. Enter your **GitHub Access Token**. This token is securely stored in Google Secret Manager and is never exposed to the frontend.

Once configured, the platform can scan your repository for valid Terraform modules.

## Module Development

### Structure

The platform expects a standard Terraform module structure. Each top-level directory in your repository is treated as a potential module.

```
my-modules-repo/
├── aws-vpc/
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
├── gcp-k8s/
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
└── README.md
```

### Variables & Metadata

You control module behavior, UI presentation, and platform features using standard Terraform input variables in your `variables.tf`.

The platform parses special comments in the `description` field to generate UI metadata.

**Example `variables.tf`:**

```hcl
variable "region" {
  description = "The target region for deployment {{UIMeta group=1 order=1}}"
  type        = string
  default     = "us-central1"
}

variable "credit_cost" {
  description = "Cost in credits to deploy this module"
  type        = number
  default     = 10
}

variable "public_access" {
  description = "Make this module visible to all users"
  type        = bool
  default     = true
}
```

## Publishing Workflow

1. **Navigate to Publish:** Go to the **Publish** page in the platform navigation.
2. **Select Modules:** The platform fetches the list of available modules from your connected GitHub repository.
3. **Review & Publish:** Select the modules you wish to publish or update.
    - **Publish:** Creates a new module entry in the platform.
    - **Update:** Updates the existing module configuration.
4. **Provisioning (Optional):** If a module requires specific initial configuration (handled via "zero group" data), you may be prompted to provide these values.
5. **Confirmation:** Click **Publish** to save the changes. The modules are now live and listed on the **Deploy** page.

## Access Control & Pricing

Control who can see your module and how much it costs using specific variable names in your `variables.tf`.

| Variable Name | Type | Description |
| :--- | :--- | :--- |
| `public_access` | `bool` | Set to `true` to make the module visible to all platform users. If `false` (default), it is only visible to you (the partner). |
| `credit_cost` | `number` | The number of credits deducted from a user's balance when they deploy this module. |
| `trusted_users` | `list(string)` | A list of user emails who are granted access to this module, even if it is private. |
| `trusted_groups` | `list(string)` | A list of group IDs granted access to this module. |

*Note: If `public_access` is false and no trusted users/groups are defined, the module effectively remains in a "Private Draft" mode.*

## Revenue & Analytics

Partners can track the performance and earnings of their modules.

- **Revenue:** When a user deploys your priced module, the `credit_cost` is deducted from their balance. Revenue sharing (Partner vs. Platform) is configured via `partnerRevenueShare` and `agentRevenueShare` variables or platform-wide settings.
- **Analytics:** View deployment counts, average ratings, and revenue data in the **Billing** > **Module Revenue** dashboard.
