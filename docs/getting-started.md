---
sidebar_position: 1
title: Getting Started with RAD Platform
description: Get started with RAD Platform - enterprise-grade infrastructure deployment for AWS, Azure, and Google Cloud Platform using Terraform automation
keywords: [getting started, RAD Platform, infrastructure deployment, multi-cloud, Terraform, AWS, Azure, GCP, DevOps]
---

# Getting Started

Welcome to the RAD Platform technical documentation. This comprehensive guide provides in-depth information for technical users, partners, and administrators seeking to understand and leverage the full capabilities of the platform.

## What is RAD Platform?

The RAD Platform is an enterprise-grade infrastructure deployment solution that enables teams to deploy multi-cloud infrastructure using Terraform-based automation. The platform provides comprehensive monitoring, role-based access control, credit-based resource allocation, and enterprise-grade management capabilities.

## Key Features

### Multi-Cloud Infrastructure as Code

Deploy infrastructure across AWS, Azure, and Google Cloud Platform using Terraform-based automation. Pre-configured secure landing zones and compliance templates ensure your deployments meet enterprise standards from day one. Real-time monitoring with Cloud Build integration provides complete visibility into your deployment pipeline.

### Enterprise-Grade Management

Implement role-based access control with Google Cloud Identity integration. Credit-based resource allocation and billing provide granular cost management. Comprehensive audit trails and deployment analytics give you complete oversight of your infrastructure operations and spending.

### Extensible Module System

Leverage GitHub-integrated custom module repositories for your organization's specific needs. Access platform and partner module catalogs for common infrastructure patterns. Automated module publishing and version control streamline your deployment workflow and ensure consistency across teams.

## Who Should Use This Documentation?

This documentation is designed for:

- **Technical Users** seeking detailed understanding of platform capabilities and architecture
- **Partners** building and publishing custom modules for their organizations
- **Administrators** managing platform settings, users, and billing
- **Agents** deploying infrastructure on behalf of users
- **DevOps Teams** integrating the platform into their workflows

## Documentation Structure

### User Roles & Guides

Learn about the different roles within the platform and their specific capabilities:

- [Administrator Guide](/docs/guides/admin) - Platform management and configuration
- [Partner Guide](/docs/guides/partner) - Module development and publishing
- [Agent Guide](/docs/guides/agent) - Deployment management
- [User Guide](/docs/guides/user) - Basic platform usage

### Core Features

Understand the platform's main features:

- [Deployments](/docs/features/deployments) - Infrastructure deployment management
- [Modules](/docs/features/modules) - Module catalog and usage
- [Publishing](/docs/features/publishing) - Custom module publishing

### Billing & Credits

Learn about the credit system and billing:

- [Credits System](/docs/billing/credits) - How credits work
- [Subscriptions](/docs/billing/subscriptions) - Subscription tiers and management
- [Transactions](/docs/billing/transactions) - Transaction history and auditing

### Administration

Platform administration and configuration:

- [Global Settings](/docs/admin/settings) - Platform-wide configuration
- [User Management](/docs/admin/users) - Managing users and permissions
- [Notifications](/docs/admin/notifications) - Email notification system

## Quick Start

### For Users

1. **Sign in** to the platform using your Google account
2. **Browse modules** from the platform or partner catalogs
3. **Configure deployment** parameters for your selected module
4. **Deploy** and monitor your infrastructure

### For Partners

1. **Configure GitHub repository** in your profile settings
2. **Create module** following the platform's module structure
3. **Publish module** to make it available in the catalog
4. **Manage versions** and updates through GitHub

### For Administrators

1. **Configure global settings** for your organization
2. **Set up credit system** and subscription tiers
3. **Manage users** and assign appropriate roles
4. **Monitor** platform usage and costs

## Platform Architecture

The RAD Platform is built on Google Cloud Platform and integrates with:

- **Google Cloud Identity** for authentication and authorization
- **Cloud Build** for deployment execution
- **Firestore** for data storage
- **Cloud Storage** for deployment artifacts
- **Stripe** for payment processing
- **GitHub** for module repositories

## Support and Resources

- [Support & Resources](/docs/support) - Getting help and troubleshooting
- [GitHub Repository](https://github.com/techequitycloud/rad.github.io) - Documentation source code
- Platform support - Contact your administrator

## Next Steps

Choose the guide that matches your role to get started:

- **New to the platform?** Start with the [User Guide](/docs/guides/user)
- **Building modules?** Read the [Partner Guide](/docs/guides/partner)
- **Managing the platform?** See the [Administrator Guide](/docs/guides/admin)
- **Deploying for others?** Check the [Agent Guide](/docs/guides/agent)
