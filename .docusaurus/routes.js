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
    component: ComponentCreator('/docs', '565'),
    routes: [
      {
        path: '/docs',
        component: ComponentCreator('/docs', '993'),
        routes: [
          {
            path: '/docs',
            component: ComponentCreator('/docs', 'b1a'),
            routes: [
              {
                path: '/docs/admin/notifications',
                component: ComponentCreator('/docs/admin/notifications', 'c21'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/admin/settings',
                component: ComponentCreator('/docs/admin/settings', '036'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/admin/users',
                component: ComponentCreator('/docs/admin/users', 'b86'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/credits',
                component: ComponentCreator('/docs/billing/credits', '04e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/subscriptions',
                component: ComponentCreator('/docs/billing/subscriptions', 'c5c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/billing/transactions',
                component: ComponentCreator('/docs/billing/transactions', 'e17'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/deployments',
                component: ComponentCreator('/docs/features/deployments', '6f9'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/modules',
                component: ComponentCreator('/docs/features/modules', 'd89'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/features/publishing',
                component: ComponentCreator('/docs/features/publishing', 'afc'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/getting-started',
                component: ComponentCreator('/docs/getting-started', 'c6c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/admin',
                component: ComponentCreator('/docs/guides/admin', 'cf0'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/agent',
                component: ComponentCreator('/docs/guides/agent', 'c6e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/partner',
                component: ComponentCreator('/docs/guides/partner', 'e4d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/user',
                component: ComponentCreator('/docs/guides/user', 'bc3'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/support',
                component: ComponentCreator('/docs/support', '275'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials',
                component: ComponentCreator('/docs/tutorials', '1e5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/initial-setup',
                component: ComponentCreator('/docs/tutorials/administrators/initial-setup', '5f2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/user-management',
                component: ComponentCreator('/docs/tutorials/administrators/user-management', '1b5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/advanced/multi-cloud-strategies',
                component: ComponentCreator('/docs/tutorials/advanced/multi-cloud-strategies', '3c6'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/advanced/platform-architecture',
                component: ComponentCreator('/docs/tutorials/advanced/platform-architecture', '107'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/first-module',
                component: ComponentCreator('/docs/tutorials/partners/first-module', '8b2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/module-versions',
                component: ComponentCreator('/docs/tutorials/partners/module-versions', '4d0'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/production-module',
                component: ComponentCreator('/docs/tutorials/partners/production-module', '0dd'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/first-deployment',
                component: ComponentCreator('/docs/tutorials/users/first-deployment', 'd8b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/managing-credits',
                component: ComponentCreator('/docs/tutorials/users/managing-credits', '07a'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/troubleshooting-deployments',
                component: ComponentCreator('/docs/tutorials/users/troubleshooting-deployments', '87c'),
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
