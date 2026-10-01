import React from 'react';
import DocCardList from '@theme/DocCardList';
import {useDocsSidebar} from '@docusaurus/plugin-content-docs/client';

/**
 * A card for every category in the sidebar this page belongs to.
 *
 * Used by the section landing pages (/docs/labs, /docs/modules,
 * /docs/certification). Read from the sidebar rather than written by hand, so
 * a module added to a category appears here without anyone editing this page,
 * and the cards carry the translated category labels on /fr.
 */
export default function SectionIndex(): React.ReactElement | null {
  const sidebar = useDocsSidebar();
  if (!sidebar) return null;
  const categories = sidebar.items.filter((item) => item.type === 'category');
  return <DocCardList items={categories} />;
}
