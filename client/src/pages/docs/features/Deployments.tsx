import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Deployment Management

This comprehensive guide covers the full lifecycle of module deployments, from selection and configuration to monitoring and analysis.

## Module Deployment Overview

The RAD Platform provides a streamlined workflow for deploying infrastructure modules across multiple cloud providers. The deployment process is built on Terraform and Cloud Build, providing robust automation with comprehensive logging and monitoring.

### Module Visibility and Roles

The application controls module visibility based on user roles to ensure users only see relevant modules. This logic is enforced on the backend and reflected in the UI.

**Platform Modules**: Standard modules available to all users, maintained by platform administrators. These modules follow best practices and are regularly updated for security and compliance.

**Partner Modules**: Custom modules published by users with the partner role. Partners can create organization-specific modules and make them available for deployment within their team.

#### Role-Based Access

**Standard Users**: Can view and deploy Platform Modules only. This ensures users have access to vetted, production-ready infrastructure patterns.

**Partners**: Can view all Platform Modules and their own Partner Modules. The Partner Modules tab is only visible when a GitHub repository is configured.

**Admins**: Have full oversight and can view all modules across the platform, including all Platform Modules and Partner Modules from every partner.

## Deployment Workflow

### 1. Module Selection

Navigate to the Deploy page to browse available modules. Each module card displays:

- Module name and description
- Credit cost for deployment
- Module source (Platform or Partner)
- Delete option (for admins and module owners)

Use the search functionality to filter modules by name or description. Results are paginated for easy navigation through large module catalogs.

### 2. Configuration

After selecting a module, you'll be directed to the provisioning page where you configure the deployment:

**Dynamic Form Generation**: The system automatically generates a configuration form based on the module's required variables. Forms are organized into logical steps for complex modules.

**Variable Types**: The form supports multiple input types including text fields, checkboxes, dropdowns, and multi-select lists, automatically rendered based on variable definitions.

**Validation**: Required fields are marked with an asterisk. The system validates all inputs before allowing submission.

### 3. Deployment Confirmation

Before initiating the deployment, a confirmation modal displays:

- **Deployment Cost**: The credit cost for the module
- **Credit Balance**: Your available credit balance
- **Insufficient Credits Alert**: If your balance is too low, the confirmation button is disabled

Upon confirmation, the deployment request is submitted to the backend and the provisioning process begins.

### 4. Monitoring Progress

The Deployments page provides real-time monitoring of all your deployments:

**Status Tracking**: Each deployment shows its current status (PROVISIONING, SUCCESS, FAILURE, CANCELLED) with automatic updates.

**Real-time Logs**: Click on any deployment to view detailed logs streamed directly from Cloud Build. Logs are displayed in real-time as the deployment progresses.

**Deployment Details**: View comprehensive information including:
- Deployment ID and module name
- Creation and completion timestamps
- Configuration parameters used
- User who initiated the deployment

## Deployment Analysis

### Log Viewer

The detailed deployment view contains a dedicated log viewer that streams logs directly from the Cloud Build process. This provides real-time feedback without waiting for the entire log file to be generated.

**Step-by-Step Execution**: Logs are structured to show distinct stages of the deployment pipeline:
- Cloning the Git repository
- Running Terraform to provision infrastructure
- Executing custom scripts
- Cleaning up resources

**Timestamps**: Every log line is timestamped, allowing precise analysis of how long each step took to complete.

### Error Tracking and Debugging

The log viewer is the primary tool for identifying and understanding errors:

**Error Highlighting**: Failed steps and error messages from Terraform or shell scripts are clearly visible in the log output. The deployment status changes to FAILURE when errors occur.

**Root Cause Analysis**: By examining the logs, you can pinpoint the exact stage and command that failed. For example, if a Terraform deployment fails, the \`terraform apply\` logs show the specific resource that could not be created and the reason provided by the cloud provider.

**Full Context**: Since the entire log from start to finish is available, you can see the context leading up to an error, which is essential for understanding the root cause.

## Deployment Management

### Viewing Deployments

**My Deployments**: Shows all modules you have personally deployed. This is the default view for standard users.

**All Deployments** (Admins only): Shows every module deployed by all users across the platform. Administrators can search by module name, deployment ID, project ID, or user email.

### Deployment Actions

**View Details**: Click on any deployment ID to access the detailed view with logs and configuration parameters.

**Delete Deployment**: Remove deployment records and associated artifacts. Deletion policies are controlled by the retention period configured by administrators.

**Export Data**: Export deployment information and logs for external analysis or compliance reporting.

## Best Practices

### Configuration Management

- **Document Parameters**: Keep notes on configuration parameters for reproducibility
- **Test in Stages**: Deploy to development environments before production
- **Version Control**: Track module versions and configuration changes

### Monitoring and Troubleshooting

- **Watch Logs**: Monitor deployment logs in real-time to catch issues early
- **Check Prerequisites**: Ensure all required resources and permissions are in place
- **Review Errors**: Examine full error context in logs for effective debugging

### Cost Management

- **Monitor Credits**: Keep track of your credit balance before initiating deployments
- **Plan Deployments**: Consider subscription tiers for frequent deployments
- **Review Costs**: Regularly check project costs to optimize resource usage
`;

export default function Deployments() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
