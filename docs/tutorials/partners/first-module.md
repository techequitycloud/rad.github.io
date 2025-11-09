---
title: "Publishing Your First Custom Module"
sidebar_position: 1
description: "A step-by-step guide for partners on how to create, publish, and test a custom infrastructure module on the RAD Platform."
keywords: ["tutorial", "partner", "custom module", "publish module", "Terraform"]
---

# Publishing Your First Custom Module

This tutorial is for RAD Platform partners who want to create and publish their own custom infrastructure modules. You will learn how to set up your GitHub repository, structure a module correctly, and make it available for deployment in the RAD Console.

## What You'll Learn

- How to create a GitHub Personal Access Token for the RAD Platform.
- How to connect your GitHub repository to your RAD profile.
- The required file structure for a custom module.
- How to publish and test your new module.

### Prerequisites

- A RAD Platform account with **Partner** status.
- A GitHub account and a repository to host your modules.
- Basic knowledge of Terraform.

### Estimated Time

- **30 minutes**

---

## Step 1: Create a GitHub Personal Access Token

The RAD Platform needs access to your GitHub repository to read your modules. You will provide this access by creating a Personal Access Token (PAT).

1.  Go to your GitHub **Settings** > **Developer settings** > **Personal access tokens**.
2.  Click **"Generate new token"**.
3.  Give the token a descriptive name (e.g., `rad-platform-token`).
4.  Set the **Expiration** for the token.
5.  Under **Scopes**, select the `repo` scope. This grants read access to your repositories.

6.  Click **"Generate token"** and copy the token value. You will not be able to see it again.

## Step 2: Connect Your GitHub Repository

Now, you need to add the GitHub token and repository to your RAD Platform profile.

1.  In the RAD Console, go to your **Profile** page.
    ![Partner Profile Page](/img/site/6.2-partner-profile.png)
2.  Scroll down to the **"Partner Settings"** section.
3.  Paste your GitHub PAT into the **"GitHub Token"** field and select the repository where you will store your modules, then click **"Save"**.


## Step 3: Structure Your Module

The RAD Platform expects a specific file structure for modules. Each module must be in its own directory within your repository.

1.  In your GitHub repository, create a new directory for your module (e.g., `simple-gcs-bucket`).
2.  Inside this directory, create the following files:

    -   `main.tf`: This file contains the main Terraform code to create the resources.
    -   `variables.tf`: This file defines the input variables for your module.
    -   `outputs.tf`: This file defines the output values of your module.
    -   `README.md`: Documentation for your module.

### Example: `simple-gcs-bucket`

**`main.tf`**

```terraform
resource "google_storage_bucket" "bucket" {
  name     = var.bucket_name
  location = var.location
}
```

**`variables.tf`**

```terraform
variable "bucket_name" {
  description = "The name of the GCS bucket."
  type        = string
}

variable "location" {
  description = "The location of the GCS bucket."
  type        = string
  default     = "US"
}
```

**`outputs.tf`**

```terraform
output "bucket_url" {
  description = "The URL of the created GCS bucket."
  value       = google_storage_bucket.bucket.url
}
```

**`README.md`**

```markdown
# Simple GCS Bucket

This module creates a simple Google Cloud Storage bucket.
```

## Step 4: Publish Your Module

Once your module is pushed to your GitHub repository, you can publish it to the RAD Platform.

1.  In the RAD Console, navigate to the **"Publish"** tab in the main menu.
    ![Publish menu item](/img/site/8-partner-publish-menu.png)
2.  You will see a list of modules found in your connected GitHub repository.
    ![Publish tab showing the new `simple-gcs-bucket` module](/img/site/8.1-partner-publish-partner_modules.png)
3.  Select your new module and click the **"Publish"** button.

## Step 5: Test Your Module

Now that your module is published, you can deploy it just like any other platform module.

1.  Go to the **"Deploy"** page.
    ![Deploy menu item](/img/site/9-partner-deploy-menu.png)
2.  Select the **"Partner Modules"** tab. You should see your new module.
    ![Partner Modules tab showing the newly published module](/img/site/9.1-partner-deploy-partner_modules.png)
3.  Click on your module and configure the deployment by providing a `bucket_name`.
4.  Launch the deployment and monitor its progress.

## Verification

If the deployment succeeds, you have successfully published and deployed your first custom module! You can verify the bucket was created by checking the deployment outputs or by looking in the Google Cloud Console.

## Next Steps

-   [Creating a Production-Ready Module](./production-module.md)
-   [Managing Module Versions and Updates](./module-versions.md)
-   Add more complex resources and variables to your module.
