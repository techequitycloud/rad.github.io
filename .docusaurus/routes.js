import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/markdown-page',
    component: ComponentCreator('/markdown-page', '3d7'),
    exact: true
  },
  {
    path: '/docs',
    component: ComponentCreator('/docs', 'd93'),
    routes: [
      {
        path: '/docs',
        component: ComponentCreator('/docs', '60e'),
        routes: [
          {
            path: '/docs',
            component: ComponentCreator('/docs', '97f'),
            routes: [
              {
                path: '/docs/admin/notifications',
                component: ComponentCreator('/docs/admin/notifications', 'fe5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/admin/settings',
                component: ComponentCreator('/docs/admin/settings', '36d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/admin/users',
                component: ComponentCreator('/docs/admin/users', 'fd2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/credits',
                component: ComponentCreator('/docs/billing/credits', 'fa9'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/subscriptions',
                component: ComponentCreator('/docs/billing/subscriptions', 'df1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/transactions',
                component: ComponentCreator('/docs/billing/transactions', 'e92'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/deployments',
                component: ComponentCreator('/docs/features/deployments', '2fb'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/modules',
                component: ComponentCreator('/docs/features/modules', 'a4c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/publishing',
                component: ComponentCreator('/docs/features/publishing', '6e1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/roi-calculator',
                component: ComponentCreator('/docs/features/roi-calculator', '132'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/getting-started',
                component: ComponentCreator('/docs/getting-started', '310'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/admin',
                component: ComponentCreator('/docs/guides/admin', '834'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/agent',
                component: ComponentCreator('/docs/guides/agent', 'ba0'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/partner',
                component: ComponentCreator('/docs/guides/partner', 'f3a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/user',
                component: ComponentCreator('/docs/guides/user', 'ea2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/support',
                component: ComponentCreator('/docs/support', '7a7'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials',
                component: ComponentCreator('/docs/tutorials', '73c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/initial-setup',
                component: ComponentCreator('/docs/tutorials/administrators/initial-setup', '6b1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/user-management',
                component: ComponentCreator('/docs/tutorials/administrators/user-management', '29c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/advanced/multi-cloud-strategies',
                component: ComponentCreator('/docs/tutorials/advanced/multi-cloud-strategies', '233'),
                exact: true
              },
              {
                path: '/docs/tutorials/advanced/platform-architecture',
                component: ComponentCreator('/docs/tutorials/advanced/platform-architecture', '590'),
                exact: true
              },
              {
                path: '/docs/tutorials/agents/agent-revenue',
                component: ComponentCreator('/docs/tutorials/agents/agent-revenue', '2f1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/first-module',
                component: ComponentCreator('/docs/tutorials/partners/first-module', '0f1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/module-versions',
                component: ComponentCreator('/docs/tutorials/partners/module-versions', '58b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/production-module',
                component: ComponentCreator('/docs/tutorials/partners/production-module', 'faa'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/first-deployment',
                component: ComponentCreator('/docs/tutorials/users/first-deployment', '94e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/managing-credits',
                component: ComponentCreator('/docs/tutorials/users/managing-credits', 'a5d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/troubleshooting-deployments',
                component: ComponentCreator('/docs/tutorials/users/troubleshooting-deployments', '5b5'),
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
