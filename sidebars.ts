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
      label: 'Quick Start',
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        {
          type: 'category',
          label: 'Admin',
          items: [
            'guides/admin/documentation',
            'guides/admin/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'Partner',
          items: [
            'guides/partner/documentation',
            'guides/partner/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'Agent',
          items: [
            'guides/agent/documentation',
            'guides/agent/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'User',
          items: [
            'guides/user/documentation',
            'guides/user/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'Finance',
          items: [
            'guides/finance/documentation',
            'guides/finance/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'Support',
          items: [
            'guides/support/documentation',
            'guides/support/audio_video',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Workflow',
      items: [
        {
          type: 'category',
          label: 'Admin',
          items: [
            'workflows/admin/documentation',
            'workflows/admin/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'Partner',
          items: [
            'workflows/partner/documentation',
            'workflows/partner/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'User',
          items: [
            'workflows/user/documentation',
            'workflows/user/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'Agent',
          items: [
            'workflows/agent/documentation',
            'workflows/agent/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'Finance',
          items: [
            'workflows/finance/documentation',
            'workflows/finance/audio_video',
          ],
        },
        {
          type: 'category',
          label: 'Support',
          items: [
            'workflows/support/documentation',
            'workflows/support/audio_video',
          ],
        },
      ],
    },
  ],
};

export default sidebars;
