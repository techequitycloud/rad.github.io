---
title: Modules
sidebar_position: 3
description: Browse and deploy infrastructure modules from RAD Platform catalog - pre-configured Terraform modules for AWS, Azure, and Google Cloud
keywords: ['modules', 'module catalog', 'Terraform modules', 'infrastructure templates', 'cloud modules']
---

# Modules

The RAD Platform provides a comprehensive module system that enables you to deploy pre-configured infrastructure patterns across multiple cloud providers. Modules are Terraform-based infrastructure templates that can be customized and deployed with minimal configuration.

## Module Catalogs

The platform offers access to multiple module catalogs:

### Platform Modules

Platform modules are officially maintained by the RAD Platform team. These modules are thoroughly tested, follow best practices, and are regularly updated to incorporate the latest cloud provider features and security recommendations.

Platform modules cover common infrastructure patterns including compute instances, databases, networking, storage, security, and monitoring solutions.

### Partner Modules

Partner modules are created and maintained by partner organizations. Partners can publish custom modules to share infrastructure patterns within their organization or with other platform users. Partner modules undergo review before being made available in the catalog.

### Personal Modules

If you have partner status, you can create and publish your own modules by connecting your GitHub repository. Personal modules allow you to standardize infrastructure deployments within your organization and share best practices with your team.

## Module Structure

Each module consists of:

- **Terraform Configuration**: Infrastructure as code defining the resources to be deployed
- **Variables**: Configurable parameters that customize the deployment
- **Outputs**: Values returned after successful deployment
- **Documentation**: Description, usage instructions, and examples
- **Metadata**: Module name, version, author, and tags

## Browsing Modules

The Modules page provides a searchable catalog of available modules:

**Search and Filter**: Find modules by name, description, cloud provider, or tags

**Module Cards**: Each module displays its name, description, cloud provider, estimated cost, and deployment count

**Module Details**: Click on a module to view detailed information, configuration options, and deployment history

## Module Information

When viewing a module, you can see:

### Overview

- Module name and description
- Cloud provider (AWS, Azure, GCP)
- Author and publisher information
- Version number
- Last updated date
- Number of deployments

### Configuration

- Required and optional parameters
- Default values
- Parameter descriptions and validation rules
- Estimated credit cost

### Documentation

- Detailed usage instructions
- Architecture diagrams
- Prerequisites and requirements
- Post-deployment steps
- Troubleshooting guidance

### Deployment History

- Recent deployments of this module
- Success and failure rates
- Average deployment time
- Common configuration patterns

## Deploying a Module

To deploy a module:

1. **Select Module**: Browse or search for the desired module
2. **Review Details**: Read the module documentation and requirements
3. **Configure Parameters**: Fill in required configuration values
4. **Estimate Cost**: Review the credit cost estimate
5. **Deploy**: Submit the deployment request
6. **Monitor**: Track deployment progress in real-time

## Module Versions

Modules support versioning to ensure stability and enable controlled updates:

**Version Pinning**: Deploy specific module versions for consistency

**Version Updates**: Update to newer versions when available

**Changelog**: Review changes between versions

**Rollback**: Redeploy previous versions if needed

## Module Tags

Tags help organize and discover modules:

- **Cloud Provider**: AWS, Azure, GCP
- **Category**: Compute, Database, Networking, Storage, Security, Monitoring
- **Use Case**: Development, Production, Testing, Analytics
- **Compliance**: HIPAA, PCI-DSS, SOC 2, GDPR

## Best Practices

### Selecting Modules

- Review module documentation thoroughly before deployment
- Check module version and last updated date
- Review deployment history and success rates
- Verify cloud provider and region compatibility
- Ensure you have sufficient credits for deployment

### Configuration

- Use descriptive names for deployments
- Document custom configuration choices
- Store sensitive values securely
- Test in development before production deployment
- Review estimated costs before deploying

### Module Management

- Keep track of deployed module versions
- Subscribe to module update notifications
- Review changelogs before updating
- Test updates in non-production environments
- Maintain deployment documentation

## Module Development

Partners can develop custom modules following these guidelines:

### Module Requirements

- Valid Terraform configuration
- Clear variable definitions with descriptions
- Comprehensive documentation
- Example configurations
- Version control through Git

### Publishing Process

1. Create module in connected GitHub repository
2. Follow platform module structure
3. Test module thoroughly
4. Submit for review (if required)
5. Publish to catalog

### Module Maintenance

- Keep modules updated with latest provider versions
- Address security vulnerabilities promptly
- Respond to user feedback and issues
- Maintain backward compatibility when possible
- Document breaking changes clearly

## Troubleshooting

### Module Not Found

- Verify you have access to the module catalog
- Check if module has been deprecated
- Ensure you're searching in the correct catalog
- Contact support if module should be available

### Configuration Errors

- Review parameter validation rules
- Check required vs. optional parameters
- Verify parameter value formats
- Consult module documentation
- Review example configurations

### Deployment Failures

- Check deployment logs for specific errors
- Verify cloud provider permissions
- Ensure resource quotas are sufficient
- Review module prerequisites
- Contact module author or support

## Related Resources

- [Deployments](/docs/features/deployments) - Managing infrastructure deployments
- [Publishing Modules](/docs/features/publishing) - Creating and publishing custom modules
- [Partner Guide](/docs/guides/partner) - Partner-specific module capabilities
