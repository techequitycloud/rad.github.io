// Turn links written as full docs.radmodules.dev URLs into in-site paths.
//
// The English pages (and so their French copies, which must keep the same link
// targets) often link to other pages with an absolute URL, e.g.
// https://docs.radmodules.dev/docs/modules/Ghost_CloudRun. Docusaurus treats
// such a link as external, so it never gains the /fr/ prefix: a French reader
// clicking it lands on the English page. As a path (/docs/modules/...) it is an
// ordinary internal link, which Docusaurus localises per locale and checks for
// broken targets at build time.
const SITE = /^https?:\/\/(?:www\.)?docs\.radmodules\.dev(?=[/?#]|$)/i;

export function toSitePath(url) {
  if (typeof url !== 'string' || !SITE.test(url)) return null;
  let rest = url.replace(SITE, '') || '/';
  if (!rest.startsWith('/')) rest = `/${rest}`;
  // A link that names a locale already would be prefixed twice.
  return rest.replace(/^\/fr(?=[/?#]|$)/, '') || '/';
}

export default function siteLinks() {
  const walk = (node) => {
    if ((node.type === 'link' || node.type === 'definition') && node.url) {
      const local = toSitePath(node.url);
      if (local) node.url = local;
    }
    if (node.children) node.children.forEach(walk);
  };
  return walk;
}
