import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'getting-started',
      label: 'Getting Started',
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        { type: 'doc', id: 'guides/user-guide', label: 'User' },
        { type: 'doc', id: 'guides/partner-guide', label: 'Partner' },
        { type: 'doc', id: 'guides/agent-guide', label: 'Agent' },
        { type: 'doc', id: 'guides/support-guide', label: 'Support' },
        { type: 'doc', id: 'guides/finance-guide', label: 'Finance' },
        { type: 'doc', id: 'guides/admin-guide', label: 'Admin' },
        { type: 'doc', id: 'guides/roi-guide', label: 'ROI' },
      ],
    },
    {
      type: 'category',
      label: 'Features',
      items: [
        {
          type: 'category',
          label: 'Users',
          items: [
            { type: 'doc', id: 'features/deploy', label: 'Deploy' },
            { type: 'doc', id: 'features/deployments', label: 'Deployments' },
            { type: 'doc', id: 'features/your-profile', label: 'Your Profile' },
            { type: 'doc', id: 'features/roi', label: 'ROI Calculator' },
            { type: 'doc', id: 'features/explore', label: 'Explore' },
            {
              type: 'category',
              label: 'Credits',
              items: [
                { type: 'doc', id: 'features/credits-buy-credits', label: 'Buy Credits' },
                { type: 'doc', id: 'features/credits-credit-transaction', label: 'Credit Transactions' },
                { type: 'doc', id: 'features/credits-module-cost', label: 'Module Costs' },
                { type: 'doc', id: 'features/credits-project-costs', label: 'Project Costs' },
                { type: 'doc', id: 'features/credits-project-invoices', label: 'Project Invoices' },
              ]
            },
            {
              type: 'category',
              label: 'Help',
              items: [
                { type: 'doc', id: 'features/help-support', label: 'Support Page' },
                { type: 'doc', id: 'guides/user-guide', label: 'User Guide' },
                { type: 'doc', id: 'guides/roi-guide', label: 'ROI Guide' },
                { type: 'doc', id: 'guides/support-guide', label: 'Support Guide' },
              ]
            },
          ]
        },
        {
          type: 'category',
          label: 'Partners',
          items: [
            { type: 'doc', id: 'features/publish', label: 'Publish' },
            { type: 'doc', id: 'features/revenue-module-revenue', label: 'Module Revenue' },
            { type: 'doc', id: 'features/billing-partner-revenue', label: 'Partner Revenue Dashboard' },
            { type: 'doc', id: 'features/your-profile', label: 'Your Profile' },
            { type: 'doc', id: 'guides/partner-guide', label: 'Partner Guide' },
          ]
        },
        {
          type: 'category',
          label: 'Agents',
          items: [
            { type: 'doc', id: 'features/revenue-my-referral-revenue', label: 'My Referral Revenue' },
            { type: 'doc', id: 'features/billing-user-revenue', label: 'User Revenue Dashboard' },
            { type: 'doc', id: 'features/billing-agent-revenue', label: 'Agent Revenue Dashboard' },
            { type: 'doc', id: 'guides/agent-guide', label: 'Agent Guide' },
          ]
        },
        {
          type: 'category',
          label: 'Finance',
          items: [
            { type: 'doc', id: 'features/billing-credit-management', label: 'Credit Management' },
            { type: 'doc', id: 'features/billing-project-invoices', label: 'Project Invoices (All)' },
            { type: 'doc', id: 'features/billing-project-costs', label: 'Project Costs (All)' },
            { type: 'doc', id: 'features/billing-agent-revenue', label: 'Agent Revenue' },
            { type: 'doc', id: 'features/billing-partner-revenue', label: 'Partner Revenue' },
            { type: 'doc', id: 'features/billing-user-revenue', label: 'User Revenue' },
            { type: 'doc', id: 'guides/finance-guide', label: 'Finance Guide' },
          ]
        },
        {
          type: 'category',
          label: 'Support',
          items: [
            { type: 'doc', id: 'features/help-support', label: 'Help & Support' },
            { type: 'doc', id: 'features/deployments', label: 'Deployments' },
            { type: 'doc', id: 'guides/support-guide', label: 'Support Guide' },
          ]
        },
        {
          type: 'category',
          label: 'Admins',
          items: [
            { type: 'doc', id: 'features/setup', label: 'Setup' },
            { type: 'doc', id: 'features/users', label: 'User Management' },
            { type: 'doc', id: 'features/billing-credit-settings', label: 'Credit Settings' },
            { type: 'doc', id: 'features/billing-subscription-tiers', label: 'Subscription Tiers' },
            { type: 'doc', id: 'features/billing-credit-management', label: 'Credit Management' },
            { type: 'doc', id: 'features/publish', label: 'Publish' },
            { type: 'doc', id: 'features/deployments', label: 'Deployments' },
            { type: 'doc', id: 'features/your-profile', label: 'Your Profile' },
            { type: 'doc', id: 'guides/admin-guide', label: 'Admin Guide' },
          ]
        },
      ],
    },
    {
      type: 'category',
      label: 'Workflow',
      items: [
        { type: 'doc', id: 'workflows/user-tutorial', label: 'User' },
        { type: 'doc', id: 'workflows/partner-tutorial', label: 'Partner' },
        { type: 'doc', id: 'workflows/agent-tutorial', label: 'Agent' },
        { type: 'doc', id: 'workflows/support-tutorial', label: 'Support' },
        { type: 'doc', id: 'workflows/finance-tutorial', label: 'Finance' },
        { type: 'doc', id: 'workflows/admin-tutorial', label: 'Admin' },
        { type: 'doc', id: 'workflows/roi-tutorial', label: 'ROI' },
      ],
    },
  ],
};

export default sidebars;
