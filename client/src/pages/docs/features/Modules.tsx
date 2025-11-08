import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Module Management

The RAD Platform's module system provides a flexible and extensible approach to infrastructure deployment, supporting both platform-provided modules and custom partner modules.

## Module Types

### Platform Modules

Platform modules are curated infrastructure templates maintained by platform administrators. These modules are designed to follow best practices for security, compliance, and operational excellence.

**Characteristics**:
- Available to all users regardless of role
- Regularly updated for security patches and feature enhancements
- Include comprehensive documentation and examples
- Tested across multiple cloud providers
- Support common infrastructure patterns (networking, compute, storage, databases)

**Examples of Platform Modules**:
- Secure landing zones for AWS, Azure, and GCP
- Kubernetes cluster deployments
- Data platform stacks (data lakes, warehouses, pipelines)
- Compliance-aligned templates (SOC 2, HIPAA, PCI)
- Disaster recovery configurations

### Partner Modules

Partner modules are custom infrastructure templates created and maintained by partner organizations. These modules address organization-specific requirements and can be kept private or shared within the organization.

**Characteristics**:
- Created and published by users with partner role
- Stored in private GitHub repositories
- Visible only to the partner who published them (or admins)
- Support custom infrastructure patterns and workflows
- Can extend or customize platform modules

## Module Structure

### Module Definition

Each module is defined by a set of configuration files stored in a GitHub repository:

**Terraform Configuration**: The core infrastructure code written in Terraform HCL (HashiCorp Configuration Language).

**Variable Definitions**: A structured definition of all configurable parameters, including:
- Variable name and type
- Description and default values
- Validation rules and constraints
- Display order and grouping

**Dependencies**: Declaration of any required modules or resources that must exist before deployment.

**Documentation**: README files and inline comments explaining the module's purpose, usage, and outputs.

### Module Metadata

The platform stores additional metadata for each module:

- Module name and description
- Source (platform or partner)
- Partner ID (for partner modules)
- Credit cost for deployment
- Version information
- Last updated timestamp

## Publishing Modules

### For Partners

Partners can publish custom modules from their configured GitHub repositories:

1. **Configure GitHub Integration**: In your profile, provide a GitHub Personal Access Token with \`repo\` scope and select your module repository.

2. **Access the Publish Tab**: Navigate to the Publish page to view modules available for publishing from your repository.

3. **Select Modules**: Choose which modules to make available for deployment. You can publish multiple modules at once.

4. **Publish**: Click the Publish or Update button to make the modules available in the Partner Modules catalog.

5. **Sync**: The system automatically syncs with your repository, removing modules that no longer exist and updating those that have changed.

### Module Publishing Workflow

When you publish a module, the platform:

1. **Fetches Module Data**: Retrieves the module definition from your GitHub repository
2. **Validates Structure**: Ensures the module has all required files and valid configuration
3. **Extracts Metadata**: Parses variable definitions and dependencies
4. **Stores in Database**: Saves the module information to Firestore
5. **Updates Catalog**: Makes the module available in the Partner Modules tab

### Version Control

The platform integrates with GitHub's version control:

- **Branch Selection**: Specify which branch to use for module definitions (typically \`main\` or \`master\`)
- **Automatic Updates**: When you update a module in your repository and republish, the platform fetches the latest version
- **Change Tracking**: Module updates are logged with timestamps for audit purposes

## Module Discovery

### Browsing Modules

The Deploy page provides an organized view of available modules:

**Platform Modules Tab**: Shows all platform-provided modules available to all users.

**Partner Modules Tab**: Shows custom modules published by the current partner user (visible only to partners with configured repositories).

**Search Functionality**: Filter modules by name or description to quickly find what you need.

**Pagination**: Navigate through large module catalogs with page controls.

### Module Cards

Each module is displayed as a card showing:

- Module name and description
- Credit cost for deployment
- Source indicator (Platform or Partner)
- Action buttons (Deploy, Delete for authorized users)

## Module Deletion

### Permissions

Module deletion is restricted based on role:

**Admins**: Can delete any module (Platform or Partner) across the entire platform.

**Partners**: Can only delete their own modules. The system verifies ownership by comparing the user ID to the module's partner ID.

**Users**: Cannot delete modules.

### Deletion Process

1. Click the delete icon on a module card
2. Confirm deletion in the modal dialog
3. The system removes the module from the database
4. The module is immediately removed from the catalog
5. Existing deployments using the module are not affected

## Best Practices

### For Module Authors

**Documentation**: Provide clear README files explaining the module's purpose, requirements, and usage examples.

**Variable Design**: Use descriptive variable names and provide helpful descriptions. Set sensible defaults where possible.

**Testing**: Test modules thoroughly in development environments before publishing.

**Versioning**: Use semantic versioning and maintain a changelog for significant updates.

**Dependencies**: Clearly document any prerequisites or dependencies required for the module.

### For Module Users

**Review Documentation**: Read the module documentation before deployment to understand requirements and configuration options.

**Test First**: Deploy to non-production environments first to validate configuration.

**Monitor Deployments**: Watch deployment logs to ensure the module provisions correctly.

**Provide Feedback**: Report issues or suggestions to module authors for continuous improvement.
`;

export default function Modules() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
