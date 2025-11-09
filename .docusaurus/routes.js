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
    component: ComponentCreator('/docs', 'b32'),
    routes: [
      {
        path: '/docs',
        component: ComponentCreator('/docs', '165'),
        routes: [
          {
            path: '/docs',
            component: ComponentCreator('/docs', 'c4f'),
            routes: [
              {
                path: '/docs/admin/notifications',
                component: ComponentCreator('/docs/admin/notifications', '62b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/admin/settings',
                component: ComponentCreator('/docs/admin/settings', '9b4'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/admin/users',
                component: ComponentCreator('/docs/admin/users', 'afa'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/credits',
                component: ComponentCreator('/docs/billing/credits', '916'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/subscriptions',
                component: ComponentCreator('/docs/billing/subscriptions', '11b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/transactions',
                component: ComponentCreator('/docs/billing/transactions', '1d3'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/deployments',
                component: ComponentCreator('/docs/features/deployments', 'fd0'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/modules',
                component: ComponentCreator('/docs/features/modules', 'c16'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/publishing',
                component: ComponentCreator('/docs/features/publishing', 'ba5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/getting-started',
                component: ComponentCreator('/docs/getting-started', 'f8a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/admin',
                component: ComponentCreator('/docs/guides/admin', '936'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/agent',
                component: ComponentCreator('/docs/guides/agent', '960'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/partner',
                component: ComponentCreator('/docs/guides/partner', '6e9'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/user',
                component: ComponentCreator('/docs/guides/user', '4e9'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/support',
                component: ComponentCreator('/docs/support', 'f20'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials',
                component: ComponentCreator('/docs/tutorials', 'b73'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/initial-setup',
                component: ComponentCreator('/docs/tutorials/administrators/initial-setup', 'ac6'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/user-management',
                component: ComponentCreator('/docs/tutorials/administrators/user-management', '61a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/advanced/multi-cloud-strategies',
                component: ComponentCreator('/docs/tutorials/advanced/multi-cloud-strategies', '184'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/advanced/platform-architecture',
                component: ComponentCreator('/docs/tutorials/advanced/platform-architecture', '72b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/agents/agent-revenue',
                component: ComponentCreator('/docs/tutorials/agents/agent-revenue', '2bd'),
                exact: true
              },
              {
                path: '/docs/tutorials/partners/first-module',
                component: ComponentCreator('/docs/tutorials/partners/first-module', '88f'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/module-versions',
                component: ComponentCreator('/docs/tutorials/partners/module-versions', 'af5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/production-module',
                component: ComponentCreator('/docs/tutorials/partners/production-module', '20d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/first-deployment',
                component: ComponentCreator('/docs/tutorials/users/first-deployment', 'f95'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/managing-credits',
                component: ComponentCreator('/docs/tutorials/users/managing-credits', '5f2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/troubleshooting-deployments',
                component: ComponentCreator('/docs/tutorials/users/troubleshooting-deployments', 'f6b'),
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
