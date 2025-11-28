---
title: Support & Resources
sidebar_position: 10
description: Get help with RAD Platform - troubleshooting guides, support resources, and documentation assistance
keywords: ['support', 'help', 'troubleshooting', 'documentation', 'resources']
---

import AudioPlayer from '@site/src/components/AudioPlayer';

# Support & Resources

<AudioPlayer url="https://storage.googleapis.com/rad-public-2b65/workflow/support_workflow.m4a" title="Listen to the Support Workflow" />

Welcome to the RAD Platform support resources. This page provides information on how to get help, report issues, and access additional resources.

## Getting Help

### Documentation

This comprehensive documentation site is your first resource for understanding platform features, learning how to perform specific tasks, troubleshooting common issues, and following best practices. Use the navigation menu to browse by topic or use the search functionality to find specific information.

### Platform Help Page

The platform includes a built-in Help page accessible from the main navigation with user guides providing quick access to role-specific guides, a support form to send messages directly to the support team, and user invitation capabilities for partners and admins.

## Reporting Issues

### Deployment Issues

If you encounter problems with a deployment, check deployment logs by clicking on the deployment ID, review your configuration parameters, ensure required resources and permissions exist, and copy exact error messages. Contact support with the deployment ID, module name, error message, configuration parameters (remove sensitive data), and screenshots if applicable.

### Billing Issues

For credit or billing problems, review your transaction history, verify payments were processed through Stripe, check your current credit balance, and contact support with transaction IDs, payment confirmation numbers, screenshots, and a description of expected vs. actual behavior.

### Technical Issues

For platform bugs or technical problems, try to reproduce the issue consistently, document the exact steps that cause the problem, and collect information including browser and version, operating system, screenshots or screen recordings, and console error messages (F12 in most browsers).

## Troubleshooting

### Common Error Messages

#### Missing Tables in Billing Tab

**Symptom**: When navigating to the Project Costs tab (or other tabs) in the Billing section, the data table is missing or fails to load.

**Possible Cause**: This issue often occurs when the user's session data is not fully synchronized with the frontend component, resulting in a missing User ID.

**Diagnosis**:
1. Open your browser's Developer Tools (F12).
2. Navigate to the **Console** tab.
3. Look for a debug message similar to: `BillingTabContent - Tab Changed {activeTab: 1, ..., userId: undefined}`.
4. If `userId` is `undefined`, the component cannot fetch the necessary data.

**Resolution**:
1. Try refreshing the page to force a reload of the user session.
2. Log out and log back in to refresh the authentication token and user profile.
3. If the issue persists, please report it to the support team with the console logs attached.

## Community Resources

### GitHub Repository

The RAD Platform documentation is open source at [https://github.com/techequitycloud/rad.github.io](https://github.com/techequitycloud/rad.github.io). You can submit pull requests to improve documentation, report documentation issues or suggest improvements, and participate in community discussions.

## Frequently Asked Questions

**How do I get started with the platform?**

Begin with the Getting Started guide, then review the guide for your specific role (Admin, Partner, Agent, or User).

**What cloud providers are supported?**

The platform supports AWS, Azure, and Google Cloud Platform through Terraform-based modules.

**Can I create custom modules?**

Yes, if you have partner role. Configure your GitHub repository in your profile and publish custom modules.

**How do I get more credits?**

Purchase credits through the Billing page using one-time purchases or subscribe to a recurring tier.

**What happens if I run out of credits?**

You won't be able to deploy new modules until you purchase more credits. Existing deployments continue running.

**Do credits expire?**

No, credits do not expire. They remain in your account until used.

**How long does a deployment take?**

Deployment time varies by module complexity and cloud provider, typically ranging from 5-30 minutes.

**Can I cancel a deployment in progress?**

Yes, you can cancel a deployment from the Deployments page. Note that partially created resources may need manual cleanup.

**How do I become a partner?**

Contact an administrator to request partner status. They can grant partner privileges through the User Management interface.

## Additional Resources

### Terraform Documentation

Since the platform uses Terraform for infrastructure provisioning:

- **Terraform Registry**: [https://registry.terraform.io/](https://registry.terraform.io/)
- **Terraform Tutorials**: [https://learn.hashicorp.com/terraform](https://learn.hashicorp.com/terraform)
- **Provider Documentation**: Specific documentation for AWS, Azure, and GCP providers

### Cloud Provider Documentation

- **AWS**: [https://docs.aws.amazon.com/](https://docs.aws.amazon.com/)
- **Azure**: [https://docs.microsoft.com/azure/](https://docs.microsoft.com/azure/)
- **Google Cloud**: [https://cloud.google.com/docs](https://cloud.google.com/docs)

## Contact Information

- **GitHub Issues**: [https://github.com/techequitycloud/rad.github.io/issues](https://github.com/techequitycloud/rad.github.io/issues)
- **Documentation**: [https://techequitycloud.github.io/rad.github.io/](https://techequitycloud.github.io/rad.github.io/)

For urgent issues or security concerns, contact your platform administrator directly.
