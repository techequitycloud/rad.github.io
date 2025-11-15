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
    'getting-started',
    {
      type: 'category',
      label: 'Platform Guides',
      items: [
        { type: 'doc', id: 'guides/admin', label: 'Admin' },
        { type: 'doc', id: 'guides/partner', label: 'Partner' },
        { type: 'doc', id: 'guides/agent', label: 'Agent' },
        { type: 'doc', id: 'guides/user', label: 'User' },
        { type: 'doc', id: 'guides/finance', label: 'Finance' },
      ],
    },
    {
      type: 'category',
      label: 'Tutorials',
      items: [
        { type: 'doc', id: 'tutorials/index', label: 'Overview' },
        {
          type: 'category',
          label: 'User',
          items: [
            'tutorials/users/first-deployment',
            'tutorials/users/managing-credits',
            'tutorials/users/troubleshooting-deployments',
          ],
        },
        {
          type: 'category',
          label: 'Partner',
          items: [
            'tutorials/partners/first-module',
            'tutorials/partners/production-module',
            'tutorials/partners/module-versions',
          ],
        },
        {
          type: 'category',
          label: 'Agent',
          items: [
            'tutorials/agents/agent-revenue',
          ],
        },
        {
          type: 'category',
          label: 'Admin',
          items: [
            'tutorials/administrators/initial-setup',
            'tutorials/administrators/user-management',
          ],
        },
        {
          type: 'category',
          label: 'Finance',
          items: [
            'tutorials/finance/managing-billing',
          ],
        },
      ],
    },
    { type: 'doc', id: 'features/roi-calculator', label: 'ROI Calculator' },
    { type: 'doc', id: 'support', label: 'Support' },
  ],
};

export default sidebars;
