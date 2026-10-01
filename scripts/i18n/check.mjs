#!/usr/bin/env node
// Validate French translations against their English sources.
//
//   node scripts/i18n/check.mjs --all            every French doc and page
//   node scripts/i18n/check.mjs <fr-file> ...    just these
//   add --json for machine-readable output
//
// A translation FAILS when its structure, code, links or anchors differ from
// the English: those are the defects that break the site or mislead a reader,
// and they are mechanical to detect. Number and length differences are
// WARNINGS, because French legitimately spells some numbers out and runs longer.
// Exit code 1 if anything failed.
import {readdirSync, statSync, existsSync} from 'node:fs';
import path from 'node:path';
import {ROOT, DOCS_FR, PAGES_FR, englishFor, analyse, englishIds, readMarker, readText, multisetDiff} from './lib.mjs';

const walk = (dir) =>
  existsSync(path.join(ROOT, dir))
    ? readdirSync(path.join(ROOT, dir)).flatMap((n) => {
        const rel = `${dir}/${n}`;
        return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.mdx?$/.test(n) ? [rel] : [];
      })
    : [];

const short = (xs) => xs.slice(0, 5).map((x) => JSON.stringify(x).slice(0, 80)).join(', ') + (xs.length > 5 ? ` (+${xs.length - 5})` : '');

export function checkFile(frRel) {
  const errors = [];
  const warnings = [];
  const enRel = englishFor(frRel);
  if (!enRel || !existsSync(path.join(ROOT, enRel))) {
    return {file: frRel, errors: [`no English source (${enRel ?? 'unmapped path'}) -- orphaned translation`], warnings};
  }
  const frText = readText(frRel);
  const enText = readText(enRel);

  const marker = readMarker(frText);
  if (!marker) errors.push('missing translated-from marker');
  else if (marker.source !== enRel) errors.push(`marker names ${marker.source}, expected ${enRel}`);

  let en, fr;
  try {
    en = analyse(enText);
    fr = analyse(frText);
  } catch (e) {
    return {file: frRel, errors: [`unparseable: ${e.message}`], warnings};
  }

  const enKeys = Object.keys(en.frontmatter).sort().join(',');
  const frKeys = Object.keys(fr.frontmatter).sort().join(',');
  if (enKeys !== frKeys) errors.push(`frontmatter keys differ: en[${enKeys}] fr[${frKeys}]`);
  for (const k of Object.keys(en.frontmatter)) {
    if (['title', 'description', 'sidebar_label'].includes(k)) continue;
    if (JSON.stringify(en.frontmatter[k]) !== JSON.stringify(fr.frontmatter[k])) errors.push(`frontmatter "${k}" changed`);
  }

  if (en.headings.length !== fr.headings.length) {
    errors.push(`heading count ${fr.headings.length}, English has ${en.headings.length}`);
  } else {
    const ids = englishIds(en.headings);
    en.headings.forEach((h, i) => {
      const f = fr.headings[i];
      if (f.level !== h.level) errors.push(`heading ${i + 1} is h${f.level}, English h${h.level} ("${h.text.slice(0, 50)}")`);
      if (f.id !== ids[i]) errors.push(`heading ${i + 1} id {#${f.id ?? '—'}} should be {#${ids[i]}} ("${h.text.slice(0, 50)}")`);
    });
  }

  if (en.blocks.length !== fr.blocks.length) errors.push(`code block count ${fr.blocks.length}, English has ${en.blocks.length}`);
  else en.blocks.forEach((b, i) => b !== fr.blocks[i] && errors.push(`code block ${i + 1} differs from English`));

  const code = multisetDiff(en.inlineCode, fr.inlineCode);
  if (code.missing.length || code.extra.length) errors.push(`inline code changed: missing ${short(code.missing)}; extra ${short(code.extra)}`);

  const links = multisetDiff(en.links, fr.links);
  if (links.missing.length || links.extra.length) errors.push(`link targets changed: missing ${short(links.missing)}; extra ${short(links.extra)}`);

  if (en.tableRows !== fr.tableRows) errors.push(`table rows ${fr.tableRows}, English has ${en.tableRows}`);

  if (en.words > 40) {
    const ratio = fr.words / en.words;
    if (ratio < 0.7) errors.push(`only ${Math.round(ratio * 100)}% of the English length -- truncated?`);
    else if (ratio > 2) warnings.push(`${Math.round(ratio * 100)}% of the English length`);
  }

  const nums = multisetDiff(en.numbers, fr.numbers);
  if (nums.missing.length) warnings.push(`numbers not found in French: ${short(nums.missing)}`);

  return {file: frRel, errors, warnings};
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const files = args.includes('--all') ? [...walk(DOCS_FR), ...walk(PAGES_FR)] : args.filter((a) => !a.startsWith('--'));
  const results = files.map((f) => checkFile(path.isAbsolute(f) ? path.relative(ROOT, f) : f));
  const failed = results.filter((r) => r.errors.length);
  if (json) {
    console.log(JSON.stringify({checked: results.length, failed: failed.length, results}, null, 2));
  } else {
    for (const r of results) {
      if (!r.errors.length && !r.warnings.length) continue;
      console.log(`${r.errors.length ? 'FAIL' : 'warn'}  ${r.file}`);
      for (const e of r.errors) console.log(`        ✗ ${e}`);
      for (const w of r.warnings) console.log(`        · ${w}`);
    }
    console.log(`\n${results.length} checked, ${failed.length} failed, ${results.filter((r) => !r.errors.length && r.warnings.length).length} with warnings only`);
  }
  process.exit(failed.length ? 1 : 0);
}
