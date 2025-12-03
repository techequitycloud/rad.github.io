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
      label: 'Quick Start',
      items: [
        { type: 'doc', id: 'quick-start/user', label: 'User' },
        { type: 'doc', id: 'quick-start/partner', label: 'Partner' },
        { type: 'doc', id: 'quick-start/agent', label: 'Agent' },
        { type: 'doc', id: 'quick-start/support', label: 'Support' },
        { type: 'doc', id: 'quick-start/finance', label: 'Finance' },
        { type: 'doc', id: 'quick-start/admin', label: 'Admin' },
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        { type: 'doc', id: 'guides/user', label: 'User' },
        { type: 'doc', id: 'guides/partner', label: 'Partner' },
        { type: 'doc', id: 'guides/agent', label: 'Agent' },
        { type: 'doc', id: 'guides/support', label: 'Support' },
        { type: 'doc', id: 'guides/finance', label: 'Finance' },
        { type: 'doc', id: 'guides/admin', label: 'Admin' },
      ],
    },
    {
      type: 'category',
      label: 'Workflow',
      items: [
        { type: 'doc', id: 'tutorials/user', label: 'User' },
        { type: 'doc', id: 'tutorials/partner', label: 'Partner' },
        { type: 'doc', id: 'tutorials/agent', label: 'Agent' },
        { type: 'doc', id: 'tutorials/support', label: 'Support' },
        { type: 'doc', id: 'tutorials/finance', label: 'Finance' },
        { type: 'doc', id: 'tutorials/admin', label: 'Admin' },
      ],
    },
  ],
};

export default sidebars;
