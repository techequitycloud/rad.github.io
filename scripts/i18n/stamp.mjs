#!/usr/bin/env node
// Stamp the provenance marker on hand- or agent-written French pages.
//
//   node scripts/i18n/stamp.mjs docs/labs/Ghost_CloudRun.md ...
//
// Writes "translated-from: <english> @ <HEAD> sha256:<english hash>" into the
// matching French file, so stale.mjs can tell later whether the English moved
// on. translate.mjs does this itself; this is for translations made outside it.
import {existsSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {ROOT, frenchFor, readText, sha12, markerLine, writeMarker, headCommit} from './lib.mjs';

const commit = headCommit();
let bad = 0;
for (const en of process.argv.slice(2)) {
  const fr = frenchFor(en);
  if (!fr || !existsSync(path.join(ROOT, fr))) {
    console.error(`no French file for ${en} (expected ${fr})`);
    bad++;
    continue;
  }
  writeFileSync(path.join(ROOT, fr), writeMarker(readText(fr), markerLine(en, commit, sha12(readText(en)), /\.mdx$/.test(en))));
  console.log(`stamped ${fr}`);
}
process.exit(bad ? 1 : 0);
