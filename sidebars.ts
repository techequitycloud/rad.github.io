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
      label: 'Workflows',
      items: [
        { type: 'doc', id: 'workflows/getting-started', label: 'Getting Started' },
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
