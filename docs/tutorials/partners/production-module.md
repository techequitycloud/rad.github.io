---
title: "Creating a Production-Ready Module"
sidebar_position: 2
description: "Learn best practices for building high-quality, maintainable, and secure custom modules for the RAD Platform."
keywords: ["tutorial", "partner", "production module", "best practices", "Terraform"]
---

# Creating a Production-Ready Module

This tutorial builds on the concepts from [Publishing Your First Custom Module](./first-module.md) and covers best practices for creating robust, secure, and maintainable modules suitable for production use.

## What You'll Learn

- How to structure your module for clarity and reusability.
- Best practices for defining variables and outputs.
- How to write comprehensive module documentation.
- How to implement basic validation and error handling.
- How to prepare your module for use by a wider team.

### Prerequisites

- You have completed the [Publishing Your First Custom Module](./first-module.md) tutorial.
- A good understanding of Terraform concepts.

### Estimated Time

- **45 minutes**

---

## Step 1: Adopt a Standard Module Structure

A consistent structure makes modules easier to understand and maintain. A production-ready module should include:

-   `main.tf`: Core logic of the module.
-   `variables.tf`: All input variables.
-   `outputs.tf`: All output values.
-   `README.md`: Detailed documentation.
-   `versions.tf`: Specifies provider version constraints.
-   `examples/`: A subdirectory containing example usage of your module.

**`versions.tf` Example:**

It's crucial to lock your module to specific provider versions to avoid unexpected breaking changes.

```terraform
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 4.0.0, < 5.0.0"
    }
  }
}
```

## Step 2: Define High-Quality Variables

Well-defined variables are the key to a flexible and user-friendly module.

### Provide Descriptions and Types

Every variable must have a clear `description` and a specific `type`.

```terraform
variable "project_id" {
  description = "The ID of the Google Cloud project where resources will be created."
  type        = string
}
```

### Use Validation Rules

Add `validation` blocks to enforce constraints on input values. This prevents common configuration errors.

```terraform
variable "environment" {
  description = "The deployment environment (e.g., dev, staging, prod)."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "The environment must be one of: dev, staging, prod."
  }
}
```

### Be Mindful of Defaults

-   Provide sensible `default` values for optional variables.
-   Do **not** provide defaults for required variables (like `project_id`). This forces the user to provide a value, preventing accidental deployments in the wrong project.

## Step 3: Create Meaningful Outputs

Outputs provide important information back to the user after a deployment. They are also used to chain modules together.

-   **Be Descriptive:** Every output must have a `description`.
-   **Output Key Information:** Expose important resource attributes like IP addresses, hostnames, and identifiers.
-   **Control Sensitivity:** Mark sensitive outputs (like passwords or private keys) with `sensitive = true` to prevent them from being displayed in logs.

```terraform
output "instance_ip_address" {
  description = "The public IP address of the created virtual machine."
  value       = google_compute_instance.main.network_interface[0].access_config[0].nat_ip
}

output "db_password" {
  description = "The password for the database root user."
  value       = google_sql_database_instance.main.settings.database_version
  sensitive   = true
}
```

## Step 4: Write Comprehensive Documentation

Your `README.md` is the user manual for your module. It should include:

-   A clear description of what the module does.
-   Prerequisites for using the module (e.g., required APIs to be enabled).
-   A simple usage example.
-   A detailed description of all input variables and outputs.
-   Any important considerations or limitations.

## Step 5: Provide Usage Examples

Create an `examples/` directory in your module's folder. Inside, provide one or more `.tf` files showing how to use your module.

**`examples/simple_usage/main.tf`**

```terraform
module "my_production_app" {
  source = "../../"

  project_id  = "my-gcp-project"
  environment = "prod"
  # ... other variables
}
```

This helps users understand how to integrate your module into their own Terraform configurations.

## Verification

A module is production-ready when:

-   It has been successfully deployed in a non-production environment.
-   The documentation is clear and complete.
-   Variables and outputs are well-defined.
-   It has been reviewed by another team member.

## Next Steps

-   [Managing Module Versions and Updates](./module-versions.md)
-   Implement a CI/CD pipeline to automatically test your module on every change.
-   Publish your module to a private Terraform registry for easier consumption within your organization.
