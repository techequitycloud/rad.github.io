#!/usr/bin/env node
/**
 * Generates build/llms-full.txt: a single-fetch markdown export of all
 * certification guides and their section exploration guides, for LLMs/AI
 * agents that ingest content in one request instead of crawling 41 URLs.
 * Referenced from static/llms.txt. Runs after `npm run build` (postbuild),
 * writing directly into the build output.
 */
import {readdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const certDir = join(repoRoot, 'docs', 'certification');
const buildDir = join(repoRoot, 'build');

if (!existsSync(buildDir)) {
  console.error('[generate-llms-full] build/ not found — run after docusaurus build');
  process.exit(1);
}

// Certification guides first (overview before sections), then section guides,
// grouped by cert code in a stable order.
const files = readdirSync(certDir)
  .filter((f) => f.endsWith('.md'))
  .sort((a, b) => {
    const cert = (f) => f.split('_')[0];
    const isOverview = (f) => f.includes('_Certification_Guide');
    if (cert(a) !== cert(b)) return cert(a).localeCompare(cert(b));
    if (isOverview(a) !== isOverview(b)) return isOverview(a) ? -1 : 1;
    return a.localeCompare(b);
  });

const stripFrontmatter = (src) => src.replace(/^---\n[\s\S]*?\n---\n/, '');

const parts = [
  '# RAD Platform — Google Cloud Certification Guides (full text)',
  '',
  '> Single-fetch export of every certification lab map and section exploration',
  '> guide on https://docs.radmodules.dev — generated from the same markdown',
  '> source as the site. Index: https://docs.radmodules.dev/llms.txt',
  '> Note: on this site PDE = Professional Cloud DevOps Engineer (not Data',
  '> Engineer) and PCDE = Professional Cloud Database Engineer.',
  '',
];

for (const file of files) {
  const url = `https://docs.radmodules.dev/docs/certification/${file.replace(/\.md$/, '')}`;
  parts.push('---', '', `<!-- Source: ${url} -->`, '');
  parts.push(stripFrontmatter(readFileSync(join(certDir, file), 'utf8')).trim(), '');
}

writeFileSync(join(buildDir, 'llms-full.txt'), parts.join('\n'));
console.log(`[generate-llms-full] wrote build/llms-full.txt (${files.length} guides)`);
