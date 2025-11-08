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
    component: ComponentCreator('/rad.github.io/docs', '147'),
    routes: [
      {
        path: '/rad.github.io/docs',
        component: ComponentCreator('/rad.github.io/docs', 'e6d'),
        routes: [
          {
            path: '/rad.github.io/docs',
            component: ComponentCreator('/rad.github.io/docs', 'eea'),
            routes: [
              {
                path: '/rad.github.io/docs/admin/notifications',
                component: ComponentCreator('/rad.github.io/docs/admin/notifications', '38c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/admin/settings',
                component: ComponentCreator('/rad.github.io/docs/admin/settings', 'a92'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/admin/users',
                component: ComponentCreator('/rad.github.io/docs/admin/users', 'd2b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/billing/credits',
                component: ComponentCreator('/rad.github.io/docs/billing/credits', 'aaa'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/billing/subscriptions',
                component: ComponentCreator('/rad.github.io/docs/billing/subscriptions', 'a1b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/billing/transactions',
                component: ComponentCreator('/rad.github.io/docs/billing/transactions', '6aa'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/features/deployments',
                component: ComponentCreator('/rad.github.io/docs/features/deployments', '3b1'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/features/modules',
                component: ComponentCreator('/rad.github.io/docs/features/modules', 'c25'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/features/publishing',
                component: ComponentCreator('/rad.github.io/docs/features/publishing', '8de'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/getting-started',
                component: ComponentCreator('/rad.github.io/docs/getting-started', 'd6b'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/guides/admin',
                component: ComponentCreator('/rad.github.io/docs/guides/admin', '7eb'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/guides/agent',
                component: ComponentCreator('/rad.github.io/docs/guides/agent', '713'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/guides/partner',
                component: ComponentCreator('/rad.github.io/docs/guides/partner', '5e2'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/guides/user',
                component: ComponentCreator('/rad.github.io/docs/guides/user', 'f6c'),
                exact: true,
                sidebar: "docsSidebar"
              },
              {
                path: '/rad.github.io/docs/support',
                component: ComponentCreator('/rad.github.io/docs/support', 'b4d'),
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
