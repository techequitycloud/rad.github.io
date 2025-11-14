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
      label: 'User Roles & Guides',
      items: [
        'guides/admin',
        'guides/partner',
        'guides/agent',
        'guides/user',
        'guides/finance',
      ],
    },
    {
      type: 'category',
      label: 'Tutorials',
      items: [
        'tutorials/index',
        {
          type: 'category',
          label: 'User Tutorials',
          items: [
            'tutorials/users/first-deployment',
            'tutorials/users/managing-credits',
            'tutorials/users/troubleshooting-deployments',
          ],
        },
        {
          type: 'category',
          label: 'Partner Tutorials',
          items: [
            'tutorials/partners/first-module',
            'tutorials/partners/production-module',
            'tutorials/partners/module-versions',
          ],
        },
        {
          type: 'category',
          label: 'Agent Tutorials',
          items: [
            'tutorials/agents/agent-revenue',
          ],
        },
        {
          type: 'category',
          label: 'Administrator Tutorials',
          items: [
            'tutorials/administrators/initial-setup',
            'tutorials/administrators/user-management',
          ],
        },
      ],
    },
    'features/roi-calculator',
    'support',
  ],
};

export default sidebars;
