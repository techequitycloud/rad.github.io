import DocsLayout from "@/components/DocsLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Streamdown } from "streamdown";

const content = `
# Getting Started

Welcome to the RAD Platform Technical Documentation. This comprehensive guide provides in-depth information for technical users, partners, and administrators seeking to understand and leverage the full capabilities of the Rapid Application Deployment platform.

## Platform Overview

The RAD Platform is an enterprise-grade infrastructure deployment solution that enables organizations to rapidly provision and manage multi-cloud infrastructure. Built on Terraform and integrated with Google Cloud Platform services, RAD provides a secure, scalable, and auditable approach to infrastructure as code.

### Key Capabilities

**Multi-Cloud Support**: Deploy infrastructure across AWS, Azure, and Google Cloud Platform using a unified interface and consistent workflows.

**Terraform-Based Automation**: Leverage the power of Terraform for infrastructure provisioning, with pre-configured modules and templates that follow best practices.

**Enterprise Security**: Implement role-based access control through Google Cloud Identity integration, ensuring proper governance and compliance.

**Cost Management**: Track and control infrastructure costs through a credit-based allocation system with detailed billing and reporting.

**Module Ecosystem**: Access platform-provided modules and create custom modules through GitHub integration for organization-specific requirements.

## Architecture & Components

### Core Components

The RAD Platform consists of several integrated components that work together to provide a complete infrastructure deployment solution.

**Deployment Engine**: Orchestrates the infrastructure provisioning process using Cloud Build and Terraform. Each deployment runs in an isolated environment with comprehensive logging and monitoring.

**Module Registry**: Maintains a catalog of infrastructure modules, including both platform-provided modules and partner-specific modules stored in GitHub repositories.

**Credit System**: Manages resource allocation through a credit-based model, enabling fine-grained cost control and chargeback capabilities.

**Identity & Access Management**: Integrates with Google Cloud Identity to provide role-based access control with four distinct user roles: Admin, Partner, Agent, and User.

**Billing & Invoicing**: Tracks infrastructure costs, processes credit purchases through Stripe integration, and generates detailed invoices and reports.

**Notification System**: Sends email notifications for deployment events, billing activities, and system alerts using a configurable mail server.

### Deployment Pipeline

When a user initiates a module deployment, the following process occurs:

1. **Configuration Validation**: The system validates the deployment configuration and checks credit availability.
2. **Dependency Resolution**: Module dependencies are identified and validated to ensure all requirements are met.
3. **Build Initiation**: A Cloud Build job is triggered with the module configuration and Terraform code.
4. **Infrastructure Provisioning**: Terraform applies the configuration to create or modify cloud resources.
5. **Status Monitoring**: Real-time logs are streamed to the user interface for monitoring progress.
6. **Completion**: Upon successful completion, deployment details and outputs are stored for future reference.

## Authentication & Access Control

### User Roles

The platform implements four distinct user roles, each with specific permissions and capabilities:

**Administrator**: Full platform access including global settings, user management, billing configuration, and all deployment operations. Administrators configure the platform, manage users, and oversee all activities.

**Partner**: Can deploy both platform modules and custom modules from their private GitHub repositories. Partners have access to module publishing features and can manage their own module catalog.

**Agent**: Focused on tracking revenue from referred users. Agents have access to revenue reports and analytics but cannot deploy modules or access administrative functions.

**User**: Standard access for deploying platform modules. Users can manage their own deployments, view their credit balance, and access billing information.

### Google Cloud Identity Integration

Access control is enforced through Google Cloud Identity groups. User roles are automatically synchronized with corresponding groups, ensuring consistent permissions across the platform and Google Cloud resources.

## Quick Start Guide

### For Administrators

1. **Initial Setup**: Configure global settings including deployment scope, credit system, and notification preferences.
2. **GitHub Integration**: Set up the platform module repository by providing a GitHub token with appropriate permissions.
3. **User Management**: Add users and assign appropriate roles (Partner, Agent, or User).
4. **Credit Configuration**: Define signup credits, referral bonuses, and pricing per credit.
5. **Billing Setup**: Configure Stripe integration for credit purchases and subscription management.

### For Partners

1. **Profile Configuration**: Navigate to your profile and configure your GitHub repository for custom modules.
2. **Module Publishing**: Use the Publish tab to select and publish modules from your repository.
3. **Module Deployment**: Deploy modules from both the platform catalog and your custom module catalog.
4. **Monitor Usage**: Track deployments and costs through the billing and analytics interfaces.

### For Users

1. **Browse Modules**: Access the deployment page to view available platform modules.
2. **Configure Deployment**: Select a module and fill out the required configuration parameters.
3. **Monitor Progress**: Track deployment status and view real-time logs during provisioning.
4. **Manage Credits**: Purchase credits or subscribe to a tier for ongoing access to deployment capabilities.

## Next Steps

Explore the detailed guides for your specific role:

- [Administrator Guide](/docs/guides/admin) - Comprehensive administrative functions and configuration
- [Partner Guide](/docs/guides/partner) - Custom module development and publishing
- [Agent Guide](/docs/guides/agent) - Revenue tracking and reporting
- [User Guide](/docs/guides/user) - Module deployment and account management

For detailed information on specific features, refer to the Core Features section in the navigation menu.
`;

export default function GettingStarted() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
