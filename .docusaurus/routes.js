import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/__docusaurus/debug',
    component: ComponentCreator('/__docusaurus/debug', '5ff'),
    exact: true
  },
  {
    path: '/__docusaurus/debug/config',
    component: ComponentCreator('/__docusaurus/debug/config', '5ba'),
    exact: true
  },
  {
    path: '/__docusaurus/debug/content',
    component: ComponentCreator('/__docusaurus/debug/content', 'a2b'),
    exact: true
  },
  {
    path: '/__docusaurus/debug/globalData',
    component: ComponentCreator('/__docusaurus/debug/globalData', 'c3c'),
    exact: true
  },
  {
    path: '/__docusaurus/debug/metadata',
    component: ComponentCreator('/__docusaurus/debug/metadata', '156'),
    exact: true
  },
  {
    path: '/__docusaurus/debug/registry',
    component: ComponentCreator('/__docusaurus/debug/registry', '88c'),
    exact: true
  },
  {
    path: '/__docusaurus/debug/routes',
    component: ComponentCreator('/__docusaurus/debug/routes', '000'),
    exact: true
  },
  {
    path: '/markdown-page',
    component: ComponentCreator('/markdown-page', '3d7'),
    exact: true
  },
  {
    path: '/docs',
    component: ComponentCreator('/docs', '371'),
    routes: [
      {
        path: '/docs',
        component: ComponentCreator('/docs', 'b73'),
        routes: [
          {
            path: '/docs',
            component: ComponentCreator('/docs', '3b5'),
            routes: [
              {
                path: '/docs/admin/notifications',
                component: ComponentCreator('/docs/admin/notifications', 'fca'),
                exact: true
              },
              {
                path: '/docs/admin/settings',
                component: ComponentCreator('/docs/admin/settings', '3c7'),
                exact: true
              },
              {
                path: '/docs/admin/users',
                component: ComponentCreator('/docs/admin/users', '757'),
                exact: true
              },
              {
                path: '/docs/billing/credits',
                component: ComponentCreator('/docs/billing/credits', '079'),
                exact: true
              },
              {
                path: '/docs/billing/subscriptions',
                component: ComponentCreator('/docs/billing/subscriptions', 'e03'),
                exact: true
              },
              {
                path: '/docs/billing/transactions',
                component: ComponentCreator('/docs/billing/transactions', 'd96'),
                exact: true
              },
              {
                path: '/docs/features/deployments',
                component: ComponentCreator('/docs/features/deployments', 'b8c'),
                exact: true
              },
              {
                path: '/docs/features/modules',
                component: ComponentCreator('/docs/features/modules', 'bc2'),
                exact: true
              },
              {
                path: '/docs/features/publishing',
                component: ComponentCreator('/docs/features/publishing', '874'),
                exact: true
              },
              {
                path: '/docs/features/roi-calculator',
                component: ComponentCreator('/docs/features/roi-calculator', 'f1f'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/getting-started',
                component: ComponentCreator('/docs/getting-started', '8b7'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/admin',
                component: ComponentCreator('/docs/guides/admin', 'f73'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/agent',
                component: ComponentCreator('/docs/guides/agent', 'd04'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/finance',
                component: ComponentCreator('/docs/guides/finance', '16a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/partner',
                component: ComponentCreator('/docs/guides/partner', 'e84'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/user',
                component: ComponentCreator('/docs/guides/user', 'f31'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/support',
                component: ComponentCreator('/docs/support', '835'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials',
                component: ComponentCreator('/docs/tutorials', '558'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/initial-setup',
                component: ComponentCreator('/docs/tutorials/administrators/initial-setup', 'dc8'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/user-management',
                component: ComponentCreator('/docs/tutorials/administrators/user-management', '812'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/advanced/multi-cloud-strategies',
                component: ComponentCreator('/docs/tutorials/advanced/multi-cloud-strategies', '204'),
                exact: true
              },
              {
                path: '/docs/tutorials/advanced/platform-architecture',
                component: ComponentCreator('/docs/tutorials/advanced/platform-architecture', 'fa1'),
                exact: true
              },
              {
                path: '/docs/tutorials/agents/agent-revenue',
                component: ComponentCreator('/docs/tutorials/agents/agent-revenue', '3d9'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/first-module',
                component: ComponentCreator('/docs/tutorials/partners/first-module', '560'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/module-versions',
                component: ComponentCreator('/docs/tutorials/partners/module-versions', '72a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/production-module',
                component: ComponentCreator('/docs/tutorials/partners/production-module', 'e04'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/first-deployment',
                component: ComponentCreator('/docs/tutorials/users/first-deployment', '8c3'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/managing-credits',
                component: ComponentCreator('/docs/tutorials/users/managing-credits', 'e82'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/troubleshooting-deployments',
                component: ComponentCreator('/docs/tutorials/users/troubleshooting-deployments', 'c10'),
                exact: true,
                sidebar: "docsSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '/',
    component: ComponentCreator('/', 'e5f'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
