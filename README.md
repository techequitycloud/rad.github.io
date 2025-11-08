# RAD Platform Technical Documentation

Enterprise-grade infrastructure deployment platform documentation for technical teams and partners.

## Overview

This repository contains comprehensive technical documentation for the RAD Platform, organized for technical users, partners, and administrators seeking in-depth understanding of the platform's capabilities.

## Documentation Structure

- **Getting Started**: Introduction and quick start guide
- **User Roles & Guides**: Role-specific guides for Administrators, Partners, Agents, and Users
- **Core Features**: Detailed documentation on Deployments, Modules, and Publishing
- **Billing & Credits**: Credit system, subscriptions, and transaction management
- **Administration**: Global settings, user management, and notifications
- **Support & Resources**: Help resources and troubleshooting guides

## Live Documentation

Visit the live documentation site at: [https://techequitycloud.github.io/rad.github.io/](https://techequitycloud.github.io/rad.github.io/)

## Development

This site is built with:
- **React 19** - UI framework
- **Vite** - Build tool and dev server
- **Tailwind CSS 4** - Styling
- **TypeScript** - Type safety
- **Wouter** - Client-side routing
- **Streamdown** - Markdown rendering

### Local Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Build for production
pnpm run build
```

### Project Structure

```
client/
  src/
    pages/          # Page components
      docs/         # Documentation pages
        guides/     # Role-specific guides
        features/   # Feature documentation
        billing/    # Billing documentation
        admin/      # Administration documentation
    components/     # Reusable components
    contexts/       # React contexts
  public/           # Static assets
```

## Deployment

The site is automatically deployed to GitHub Pages when changes are pushed to the `main` branch using GitHub Actions.

### Manual Deployment

To manually trigger a deployment:

1. Go to the **Actions** tab in GitHub
2. Select the "Deploy to GitHub Pages" workflow
3. Click "Run workflow"

### GitHub Pages Configuration

The site is configured to deploy from GitHub Actions:

1. Repository Settings → Pages
2. Source: GitHub Actions
3. The workflow file is located at `.github/workflows/deploy.yml`

## Contributing

Contributions to improve the documentation are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

### Content Guidelines

- Use clear, professional language
- Include code examples where applicable
- Add screenshots for UI-related documentation
- Keep content up-to-date with platform changes
- Follow the existing documentation structure

## Related Resources

- **RAD Platform**: Main platform repository
- **RAD Lab**: [https://googlecloudplatform.github.io/rad-lab/](https://googlecloudplatform.github.io/rad-lab/)
- **Original Documentation**: [https://github.com/techequitycloud/rad.github.io](https://github.com/techequitycloud/rad.github.io)

## License

© 2025 Tech Equity Cloud. All rights reserved.

## Support

For questions or issues with the documentation:

- Open an issue in this repository
- Contact the RAD Platform support team
- Submit pull requests for corrections or improvements
