#!/usr/bin/env node
// Print the anchor id each heading of an English page must keep in French.
//
//   node scripts/i18n/ids.mjs docs/labs/Ghost_CloudRun.md
//
// One line per heading, in page order: "<level> {#id}  <english text>". Copy the
// {#id} onto the matching French heading so existing links keep working.
import {analyse, englishIds, readText} from './lib.mjs';

for (const en of process.argv.slice(2)) {
  const {headings} = analyse(readText(en));
  const ids = englishIds(headings);
  if (process.argv.length > 3) console.log(`# ${en}`);
  headings.forEach((h, i) => console.log(`${'#'.repeat(h.level)} {#${ids[i]}}  ${h.text}`));
}
