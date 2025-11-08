import DocsLayout from "@/components/DocsLayout";
import { Streamdown } from "streamdown";

const content = `
# Support & Resources

Welcome to the RAD Platform support resources. This page provides information on how to get help, report issues, and access additional resources.

## Getting Help

### Documentation

This comprehensive documentation site is your first resource for:

- Understanding platform features and capabilities
- Learning how to perform specific tasks
- Troubleshooting common issues
- Following best practices

Use the navigation menu to browse by topic or use the search functionality to find specific information.

### Help Page

The platform includes a built-in Help page accessible from the main navigation:

**User Guides**: Quick access to role-specific guides (Admin, Partner, Agent, User)

**Support Form**: Send messages directly to the support team

**Invite User**: Partners and admins can invite new users to the platform

### Support Form

To contact the support team:

1. Navigate to the Help page in the platform
2. Fill out the "Send Message" form with:
   - Your name and email
   - Subject line describing your issue
   - Detailed message explaining the problem or question
3. Click "Send" to submit your request
4. You'll receive a confirmation and a response via email

## Reporting Issues

### Deployment Issues

If you encounter problems with a deployment:

**Check Deployment Logs**: Click on the deployment ID to view detailed logs

**Review Configuration**: Verify all configuration parameters are correct

**Check Prerequisites**: Ensure required resources and permissions exist

**Error Messages**: Copy the exact error message from the logs

**Contact Support**: If the issue persists, contact support with:
- Deployment ID
- Module name
- Error message
- Configuration parameters (remove sensitive data)
- Screenshots if applicable

### Billing Issues

For credit or billing problems:

**Review Transactions**: Check your credit transaction history

**Verify Payments**: Ensure payments were processed successfully through Stripe

**Check Balance**: Confirm your current credit balance

**Contact Support**: Provide:
- Transaction IDs
- Payment confirmation numbers
- Screenshots of the issue
- Expected vs. actual behavior

### Technical Issues

For platform bugs or technical problems:

**Reproduce the Issue**: Try to reproduce the problem consistently

**Document Steps**: Write down the exact steps that cause the issue

**Collect Information**:
- Browser and version
- Operating system
- Screenshots or screen recordings
- Console error messages (F12 in most browsers)

**Report to Support**: Include all collected information

## Community Resources

### GitHub Repository

The RAD Platform documentation is open source:

**Repository**: [https://github.com/techequitycloud/rad.github.io](https://github.com/techequitycloud/rad.github.io)

**Contributions**: Submit pull requests to improve documentation

**Issues**: Report documentation issues or suggest improvements

**Discussions**: Participate in community discussions

### Best Practices

Learn from the community:

- Review example module configurations
- Study successful deployment patterns
- Share your own experiences and solutions
- Contribute to the knowledge base

## Frequently Asked Questions

### General Questions

**Q: How do I get started with the platform?**

A: Begin with the [Getting Started](/docs/getting-started) guide, then review the guide for your specific role (Admin, Partner, Agent, or User).

**Q: What cloud providers are supported?**

A: The platform supports AWS, Azure, and Google Cloud Platform through Terraform-based modules.

**Q: Can I create custom modules?**

A: Yes, if you have partner role. Configure your GitHub repository in your profile and publish custom modules.

### Credit Questions

**Q: How do I get more credits?**

A: Purchase credits through the Billing page using one-time purchases or subscribe to a recurring tier.

**Q: What happens if I run out of credits?**

A: You won't be able to deploy new modules until you purchase more credits. Existing deployments continue running.

**Q: Do credits expire?**

A: No, credits do not expire. They remain in your account until used.

### Deployment Questions

**Q: How long does a deployment take?**

A: Deployment time varies by module complexity and cloud provider, typically ranging from 5-30 minutes.

**Q: Can I cancel a deployment in progress?**

A: Yes, you can cancel a deployment from the Deployments page. Note that partially created resources may need manual cleanup.

**Q: Why did my deployment fail?**

A: Check the deployment logs for specific error messages. Common causes include insufficient permissions, resource quotas, or configuration errors.

### Account Questions

**Q: How do I change my email address?**

A: Email addresses are tied to your Google authentication and cannot be changed within the platform.

**Q: Can I delete my account?**

A: Yes, you can permanently delete your account from your Profile page. This action is irreversible.

**Q: How do I become a partner?**

A: Contact an administrator to request partner status. They can grant partner privileges through the User Management interface.

## Additional Resources

### Terraform Documentation

Since the platform uses Terraform for infrastructure provisioning:

**Terraform Registry**: [https://registry.terraform.io/](https://registry.terraform.io/)

**Terraform Tutorials**: [https://learn.hashicorp.com/terraform](https://learn.hashicorp.com/terraform)

**Provider Documentation**: Specific documentation for AWS, Azure, and GCP providers

### Cloud Provider Documentation

**AWS**: [https://docs.aws.amazon.com/](https://docs.aws.amazon.com/)

**Azure**: [https://docs.microsoft.com/azure/](https://docs.microsoft.com/azure/)

**Google Cloud**: [https://cloud.google.com/docs](https://cloud.google.com/docs)

### Infrastructure as Code

**Best Practices**: Learn IaC patterns and anti-patterns

**Security**: Understand security considerations for infrastructure code

**Testing**: Explore tools for testing infrastructure code

## Support Hours and Response Times

### Support Availability

**Business Hours**: Monday-Friday, 9 AM - 5 PM (your timezone)

**After Hours**: Limited support for critical issues

**Holidays**: Reduced support on major holidays

### Response Time Expectations

**Critical Issues** (platform unavailable): 1-2 hours

**High Priority** (deployment failures, billing issues): 4-8 hours

**Medium Priority** (feature questions, minor bugs): 1-2 business days

**Low Priority** (feature requests, documentation): 3-5 business days

### Escalation

If you need to escalate an issue:

1. Reply to your original support ticket indicating urgency
2. Provide additional context on business impact
3. Request escalation to senior support or engineering
4. For critical issues, include management contacts

## Feedback and Suggestions

### Feature Requests

We welcome your ideas for platform improvements:

**Submit Requests**: Use the support form to describe desired features

**Provide Context**: Explain your use case and how the feature would help

**Vote on Requests**: Participate in community discussions about proposed features

### Documentation Feedback

Help us improve this documentation:

**Report Issues**: Submit GitHub issues for errors or unclear content

**Suggest Improvements**: Recommend additional topics or examples

**Contribute**: Submit pull requests with corrections or new content

### Platform Feedback

Share your experience with the platform:

**User Surveys**: Participate in periodic user surveys

**Beta Programs**: Join beta testing for new features

**Case Studies**: Share your success stories for others to learn from

## Contact Information

**Support Email**: Available on the Help page within the platform

**GitHub Issues**: [https://github.com/techequitycloud/rad.github.io/issues](https://github.com/techequitycloud/rad.github.io/issues)

**Documentation**: [https://techequitycloud.github.io/rad.github.io/](https://techequitycloud.github.io/rad.github.io/)

For urgent issues or security concerns, contact your platform administrator directly.
`;

export default function Support() {
  return (
    <DocsLayout>
      <article className="prose prose-slate dark:prose-invert max-w-none">
        <Streamdown>{content}</Streamdown>
      </article>
    </DocsLayout>
  );
}
