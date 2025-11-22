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
        { type: 'doc', id: 'tutorials/admin', label: 'Admin' },
        { type: 'doc', id: 'tutorials/partner', label: 'Partner' },
        { type: 'doc', id: 'tutorials/user', label: 'User' },
        { type: 'doc', id: 'tutorials/agent', label: 'Agent' },
      ],
    },
    {
      type: 'category',
      label: 'Implementation',
      items: [
        { type: 'doc', id: 'implementation/rad-documentation', label: 'Overview' },
        { type: 'doc', id: 'implementation/credit-and-billing-feature', label: 'Billing & Credits' },
        { type: 'doc', id: 'implementation/deployments-feature', label: 'Deployments' },
        { type: 'doc', id: 'implementation/publishing-feature', label: 'Publishing' },
        { type: 'doc', id: 'implementation/user-feature', label: 'Users' },
        { type: 'doc', id: 'implementation/settings-feature', label: 'Settings' },
        { type: 'doc', id: 'implementation/notification-feature', label: 'Notifications' },
        { type: 'doc', id: 'implementation/help-feature', label: 'Help' },
        { type: 'doc', id: 'implementation/delete-feature', label: 'Delete' },
      ],
    },
    { type: 'doc', id: 'support', label: 'Support' },
  ],
};

export default sidebars;
