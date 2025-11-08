import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Publishing Modules

The module publishing feature enables partners to make their custom infrastructure modules available for deployment through the RAD Platform.

## Overview

Publishing modules allows partner organizations to:

- Share custom infrastructure patterns within their team
- Maintain version control through GitHub integration
- Control module visibility and access
- Update modules as requirements evolve

## Prerequisites

Before you can publish modules, you must:

1. Have partner role assigned by an administrator
2. Configure GitHub integration in your profile
3. Have a GitHub repository containing valid module definitions
4. Provide a GitHub Personal Access Token with \`repo\` scope

## GitHub Integration Setup

### Configuring Your Repository

1. **Navigate to Profile**: Go to your profile page from the main navigation
2. **Partner Settings Section**: Locate the "Partner Settings" section
3. **GitHub Token**: Enter your GitHub Personal Access Token
4. **Repository Selection**: After saving the token, select your module repository from the dropdown

The system will validate your token and repository access before proceeding.

### GitHub Token Requirements

Your GitHub Personal Access Token must have:

- **\`repo\` scope**: Full control of private repositories
- **Valid expiration**: Ensure the token doesn't expire to maintain continuous access
- **Appropriate permissions**: Access to the repository containing your modules

## Publishing Workflow

### Accessing the Publish Page

Navigate to the Publish page from the main navigation. This page is only visible to users with partner role who have configured their GitHub repository.

### Publishing Interface

The Publish page displays two sections:

**Available Modules**: Modules in your GitHub repository that haven't been published yet

**Published Modules**: Modules that are currently available in the Partner Modules catalog

### Publishing Modules

1. **Review Available Modules**: The system scans your configured repository and displays all valid modules
2. **Select Modules**: Click on the modules you want to publish (you can select multiple)
3. **Publish**: Click the "Publish" button to make the modules available
4. **Confirmation**: The system validates and publishes the modules, then updates the catalog

### Updating Published Modules

When you modify a module in your GitHub repository:

1. Make changes to the module files in your repository
2. Commit and push changes to the configured branch
3. Return to the Publish page
4. Select the updated module
5. Click "Update" to fetch the latest version

The system will replace the existing module definition with the updated version.

## Module Validation

### Required Files

Each module must contain:

- **Terraform Configuration**: Valid \`.tf\` files defining infrastructure
- **Variable Definitions**: Structured variable declarations
- **README**: Documentation explaining the module's purpose and usage

### Validation Process

When publishing, the system validates:

- **File Structure**: Ensures all required files are present
- **Terraform Syntax**: Validates HCL syntax in configuration files
- **Variable Definitions**: Checks that variables are properly defined
- **Dependencies**: Verifies that declared dependencies are valid

If validation fails, the system provides error messages indicating what needs to be corrected.

## Syncing and Cleanup

### Automatic Syncing

The platform includes automatic syncing logic to ensure consistency between your GitHub repository and the published modules:

**Repository Changes**: When you change your configured repository URL, the system automatically removes modules from the old repository

**Deleted Modules**: If you delete a module from your repository, it will be removed from the catalog on the next sync

**Branch Updates**: Changes to the configured branch are reflected in published modules

### Manual Sync

You can trigger a manual sync by:

1. Navigating to the Publish page
2. The system automatically checks for changes when the page loads
3. Any discrepancies between your repository and published modules are displayed

## Module Visibility

### Access Control

Published partner modules are:

- **Visible to the Partner**: You can see and deploy your own modules
- **Visible to Admins**: Administrators can see all partner modules across the platform
- **Hidden from Other Users**: Standard users and other partners cannot see your modules

This ensures that custom modules remain private to the organization that created them.

### Deployment Access

Only you (the publishing partner) and platform administrators can deploy your partner modules. This maintains control over who can provision infrastructure using your custom templates.

## Best Practices

### Repository Organization

**Modular Structure**: Organize modules into separate directories within your repository

**Clear Naming**: Use descriptive names that indicate the module's purpose

**Documentation**: Include comprehensive README files for each module

**Version Tags**: Use Git tags to mark stable versions of your modules

### Publishing Strategy

**Test Before Publishing**: Validate modules in development environments before publishing

**Incremental Updates**: Publish new modules incrementally rather than all at once

**Communication**: Inform your team when publishing or updating modules

**Deprecation**: When retiring a module, communicate with users before removing it

### Maintenance

**Regular Updates**: Keep modules updated with security patches and improvements

**Monitor Usage**: Track which modules are being deployed and how often

**Gather Feedback**: Collect feedback from users to improve module quality

**Documentation Updates**: Keep README files current with any changes to module functionality
`;

export default function Publishing() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
