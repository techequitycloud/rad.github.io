import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/rad.github.io/markdown-page',
    component: ComponentCreator('/rad.github.io/markdown-page', '1fd'),
    exact: true
  },
  {
    path: '/rad.github.io/docs',
    component: ComponentCreator('/rad.github.io/docs', '11a'),
    routes: [
      {
        path: '/rad.github.io/docs',
        component: ComponentCreator('/rad.github.io/docs', '0c0'),
        routes: [
          {
            path: '/rad.github.io/docs',
            component: ComponentCreator('/rad.github.io/docs', '5c1'),
            routes: [
              {
                path: '/rad.github.io/docs/admin/notifications',
                component: ComponentCreator('/rad.github.io/docs/admin/notifications', 'db2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/admin/settings',
                component: ComponentCreator('/rad.github.io/docs/admin/settings', 'e23'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/admin/users',
                component: ComponentCreator('/rad.github.io/docs/admin/users', '20c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/billing/credits',
                component: ComponentCreator('/rad.github.io/docs/billing/credits', 'fea'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/billing/subscriptions',
                component: ComponentCreator('/rad.github.io/docs/billing/subscriptions', 'bfb'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/billing/transactions',
                component: ComponentCreator('/rad.github.io/docs/billing/transactions', '280'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/features/deployments',
                component: ComponentCreator('/rad.github.io/docs/features/deployments', 'ec0'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/features/modules',
                component: ComponentCreator('/rad.github.io/docs/features/modules', '476'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/features/publishing',
                component: ComponentCreator('/rad.github.io/docs/features/publishing', '6ce'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/getting-started',
                component: ComponentCreator('/rad.github.io/docs/getting-started', 'e1d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/guides/admin',
                component: ComponentCreator('/rad.github.io/docs/guides/admin', 'd8d'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/guides/agent',
                component: ComponentCreator('/rad.github.io/docs/guides/agent', 'a68'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/guides/partner',
                component: ComponentCreator('/rad.github.io/docs/guides/partner', '0ef'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/guides/user',
                component: ComponentCreator('/rad.github.io/docs/guides/user', '835'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/support',
                component: ComponentCreator('/rad.github.io/docs/support', '038'),
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
    path: '/rad.github.io/',
    component: ComponentCreator('/rad.github.io/', 'c31'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
