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
    component: ComponentCreator('/docs', 'd74'),
    routes: [
      {
        path: '/docs',
        component: ComponentCreator('/docs', '0d8'),
        routes: [
          {
            path: '/docs',
            component: ComponentCreator('/docs', '138'),
            routes: [
              {
                path: '/docs/admin/notifications',
                component: ComponentCreator('/docs/admin/notifications', 'a94'),
                exact: true
              },
              {
                path: '/docs/admin/settings',
                component: ComponentCreator('/docs/admin/settings', 'ae0'),
                exact: true
              },
              {
                path: '/docs/admin/users',
                component: ComponentCreator('/docs/admin/users', '13d'),
                exact: true
              },
              {
                path: '/docs/billing/credits',
                component: ComponentCreator('/docs/billing/credits', '1ec'),
                exact: true
              },
              {
                path: '/docs/billing/subscriptions',
                component: ComponentCreator('/docs/billing/subscriptions', '09e'),
                exact: true
              },
              {
                path: '/docs/billing/transactions',
                component: ComponentCreator('/docs/billing/transactions', '78d'),
                exact: true
              },
              {
                path: '/docs/features/deployments',
                component: ComponentCreator('/docs/features/deployments', '6a2'),
                exact: true
              },
              {
                path: '/docs/features/modules',
                component: ComponentCreator('/docs/features/modules', '2b2'),
                exact: true
              },
              {
                path: '/docs/features/publishing',
                component: ComponentCreator('/docs/features/publishing', '664'),
                exact: true
              },
              {
                path: '/docs/features/roi-calculator',
                component: ComponentCreator('/docs/features/roi-calculator', 'a2d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/getting-started',
                component: ComponentCreator('/docs/getting-started', '0c6'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/admin',
                component: ComponentCreator('/docs/guides/admin', 'faf'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/agent',
                component: ComponentCreator('/docs/guides/agent', '516'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/partner',
                component: ComponentCreator('/docs/guides/partner', '25e'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/guides/user',
                component: ComponentCreator('/docs/guides/user', 'c20'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/support',
                component: ComponentCreator('/docs/support', '648'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials',
                component: ComponentCreator('/docs/tutorials', '941'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/initial-setup',
                component: ComponentCreator('/docs/tutorials/administrators/initial-setup', '783'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/administrators/user-management',
                component: ComponentCreator('/docs/tutorials/administrators/user-management', 'cec'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/advanced/multi-cloud-strategies',
                component: ComponentCreator('/docs/tutorials/advanced/multi-cloud-strategies', '4dd'),
                exact: true
              },
              {
                path: '/docs/tutorials/advanced/platform-architecture',
                component: ComponentCreator('/docs/tutorials/advanced/platform-architecture', '32a'),
                exact: true
              },
              {
                path: '/docs/tutorials/agents/agent-revenue',
                component: ComponentCreator('/docs/tutorials/agents/agent-revenue', '0ea'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/first-module',
                component: ComponentCreator('/docs/tutorials/partners/first-module', '619'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/module-versions',
                component: ComponentCreator('/docs/tutorials/partners/module-versions', 'bed'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/partners/production-module',
                component: ComponentCreator('/docs/tutorials/partners/production-module', '2c1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/first-deployment',
                component: ComponentCreator('/docs/tutorials/users/first-deployment', 'cd5'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/managing-credits',
                component: ComponentCreator('/docs/tutorials/users/managing-credits', '38d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/docs/tutorials/users/troubleshooting-deployments',
                component: ComponentCreator('/docs/tutorials/users/troubleshooting-deployments', '13a'),
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
