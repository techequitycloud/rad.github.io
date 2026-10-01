#!/usr/bin/env node
// Which English pages need (re)translating into French?
//
//   node scripts/i18n/stale.mjs                 summary
//   node scripts/i18n/stale.mjs --json          {stale:[...], missing:[...], orphaned:[...]}
//   node scripts/i18n/stale.mjs --backfill      upgrade old markers (commit only) to carry the
//                                               sha256 of the English text they came from
//
// STALE   the English changed since the French was made: the marker's sha256 no
//         longer matches the English file.
// MISSING an English page in a translated section with no French page yet.
//         (Docusaurus shows the English page there in the meantime.)
// ORPHANED a French page whose English page no longer exists.
import {readdirSync, statSync, existsSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT, DOCS_FR, SECTIONS, frenchFor, englishFor, readMarker, readText, sha12, markerLine, writeMarker} from './lib.mjs';

const walk = (dir) =>
  existsSync(path.join(ROOT, dir))
    ? readdirSync(path.join(ROOT, dir)).flatMap((n) => {
        const rel = `${dir}/${n}`;
        return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.mdx?$/.test(n) ? [rel] : [];
      })
    : [];

const englishAt = (commit, rel) => {
  try {
    return execFileSync('git', ['show', `${commit}:${rel}`], {cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore']}).toString();
  } catch {
    return null;
  }
};

const args = process.argv.slice(2);

if (args.includes('--backfill')) {
  let updated = 0;
  for (const fr of [...walk(DOCS_FR), ...walk('i18n/fr/docusaurus-plugin-content-pages')]) {
    const text = readText(fr);
    const m = readMarker(text);
    if (!m || m.sha) continue;
    const en = englishAt(m.commit, m.source);
    if (en === null) {
      console.warn(`cannot read ${m.source} at ${m.commit}; left ${fr} as is`);
      continue;
    }
    writeFileSync(path.join(ROOT, fr), writeMarker(text, markerLine(m.source, m.commit, sha12(en), /\.mdx$/.test(fr))));
    updated++;
  }
  console.log(`backfilled ${updated} markers`);
  process.exit(0);
}

const stale = [];
const missing = [];
const orphaned = [];
for (const section of SECTIONS) {
  for (const en of walk(`docs/${section}`)) {
    const fr = frenchFor(en);
    if (!existsSync(path.join(ROOT, fr))) {
      missing.push(en);
      continue;
    }
    const m = readMarker(readText(fr));
    if (!m || !m.sha || m.sha !== sha12(readText(en))) stale.push(en);
  }
}
for (const fr of walk(DOCS_FR)) {
  const en = englishFor(fr);
  if (en && !existsSync(path.join(ROOT, en))) orphaned.push(fr);
}

if (args.includes('--json')) {
  console.log(JSON.stringify({stale, missing, orphaned}, null, 2));
} else {
  const bySection = (xs) => SECTIONS.map((s) => `${s} ${xs.filter((x) => x.startsWith(`docs/${s}/`)).length}`).join(', ');
  console.log(`stale:    ${stale.length}  (${bySection(stale)})`);
  console.log(`missing:  ${missing.length}  (${bySection(missing)})`);
  console.log(`orphaned: ${orphaned.length}`);
  for (const s of stale.slice(0, 20)) console.log(`  stale  ${s}`);
  for (const o of orphaned) console.log(`  orphan ${o}`);
}
