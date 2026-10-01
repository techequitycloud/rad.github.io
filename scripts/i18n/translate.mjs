#!/usr/bin/env node
// Translate English pages into French with the Claude API.
//
//   ANTHROPIC_API_KEY=... node scripts/i18n/translate.mjs docs/labs/Ghost_CloudRun.md ...
//   ... --from-stale [--include-missing] [--max N]     take the list from stale.mjs
//
// Providers (TRANSLATE_PROVIDER):
//   vertex     Gemini on Vertex AI (default). Env: VERTEX_PROJECT, VERTEX_LOCATION
//              (default us-central1), TRANSLATE_MODEL (default gemini-2.5-flash).
//              Auth: GOOGLE_ACCESS_TOKEN if set, else `gcloud auth print-access-token`
//              (refreshed every 45 minutes) -- in CI, gcloud is signed in through
//              Workload Identity Federation, so no key is stored anywhere.
//   anthropic  Claude. Env: ANTHROPIC_API_KEY, TRANSLATE_MODEL (default claude-sonnet-5).
// TRANSLATE_CONCURRENCY (default 4).
//
// Each page is translated with scripts/i18n/prompt.md as the system prompt,
// stamped with its provenance marker, then run through the validator. A page
// that fails is retried once with the validator's errors; if it still fails,
// the previous French (if any) is restored and the page is reported, never
// written half-right. Writes a JSON summary to stdout.
import {existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT, frenchFor, readText, sha12, markerLine, writeMarker, headCommit, splitFences, analyse, englishIds} from './lib.mjs';
import {checkFile} from './check.mjs';

const PROVIDER = process.env.TRANSLATE_PROVIDER || 'vertex';
const MODEL = process.env.TRANSLATE_MODEL || (PROVIDER === 'vertex' ? 'gemini-2.5-flash' : 'claude-sonnet-5');
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || 4);
const KEY = process.env.ANTHROPIC_API_KEY;
const VERTEX_PROJECT = process.env.VERTEX_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const CHUNK_WORDS = 4500;
const RULES = readFileSync(path.join(ROOT, 'scripts/i18n/prompt.md'), 'utf8');

const SYSTEM = `${RULES}

## Output contract
Return ONLY the translated markdown of the part you are given: no preamble, no
commentary, and do not wrap it in a code fence. Do not write the provenance
marker; the tooling adds it.`;

/** One model call: the provider's streamed text for this prompt. */
const callModel = (user) => (PROVIDER === 'vertex' ? callGemini(user) : callClaude(user));

let token = null;
let tokenAt = 0;
function googleToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  if (!token || Date.now() - tokenAt > 45 * 60 * 1000) {
    token = execFileSync('gcloud', ['auth', 'print-access-token'], {stdio: ['ignore', 'pipe', 'pipe']}).toString().trim();
    tokenAt = Date.now();
  }
  return token;
}

/** Read a server-sent-event stream, calling onData with each event's parsed JSON. */
async function readSse(res, onData) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, {stream: true}).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = event.split('\n').find((l) => l.startsWith('data: '));
      if (data) onData(JSON.parse(data.slice(6)));
    }
  }
}

async function callGemini(user) {
  const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${MODEL}:streamGenerateContent?alt=sse`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {authorization: `Bearer ${googleToken()}`, 'content-type': 'application/json'},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: SYSTEM}]},
        contents: [{role: 'user', parts: [{text: user}]}],
        // Translation needs no reasoning: thinking off keeps the whole budget
        // for output and the cost to output tokens. Low temperature for a
        // faithful rather than creative rendering.
        generationConfig: {maxOutputTokens: 65535, temperature: 0.2, thinkingConfig: {thinkingBudget: 0}},
      }),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
      continue;
    }
    if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 300)}`);
    let text = '';
    let finish = null;
    await readSse(res, (msg) => {
      const cand = msg.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) if (p.text) text += p.text;
      if (cand?.finishReason) finish = cand.finishReason;
    });
    if (finish && finish !== 'STOP') throw new Error(`Gemini stopped early: ${finish}`);
    return text.replace(/^\s*```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1');
  }
}

async function callClaude(user) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
      body: JSON.stringify({model: MODEL, max_tokens: 32000, stream: true, system: SYSTEM, messages: [{role: 'user', content: user}]}),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2 ** attempt * 2000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    // Streamed so a long page does not hit the non-streaming request timeout.
    let text = '';
    let stop = null;
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, {stream: true});
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const event = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = event.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        const msg = JSON.parse(data.slice(6));
        if (msg.type === 'content_block_delta' && msg.delta?.type === 'text_delta') text += msg.delta.text;
        if (msg.type === 'message_delta') stop = msg.delta?.stop_reason ?? stop;
        if (msg.type === 'error') throw new Error(`API stream error: ${JSON.stringify(msg.error)}`);
      }
    }
    if (stop === 'max_tokens') throw new Error('output truncated (max_tokens)');
    return text.replace(/^\s*```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1');
  }
}

/** Split a page at H2 boundaries (outside code) into parts of at most ~CHUNK_WORDS. */
function chunk(text) {
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  if (words(text) <= CHUNK_WORDS) return [text];
  const lines = text.split('\n');
  const parts = [];
  let cur = [];
  let fence = null;
  let inFrontmatter = lines[0] === '---';
  lines.forEach((line, idx) => {
    if (inFrontmatter && idx > 0 && line === '---') inFrontmatter = false;
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && !inFrontmatter && /^## /.test(line) && words(cur.join('\n')) >= CHUNK_WORDS) {
      parts.push(cur.join('\n'));
      cur = [];
    }
    cur.push(line);
  });
  parts.push(cur.join('\n'));
  return parts;
}

/**
 * Take code out of the model's hands. Every fenced block and inline code span
 * becomes a placeholder (⟦Cn⟧ / ⟦In⟧) before the text is sent, and is put back
 * byte for byte afterwards. Models "helpfully" translate code comments and
 * string defaults -- the first Gemini pilot did on two pages of three -- and a
 * placeholder cannot be translated. It also shrinks the request.
 */
function maskCode(text) {
  const saved = [];
  const put = (kind, s) => `⟦${kind}${saved.push(s) - 1}⟧`;
  const lines = text.split('\n');
  const out = [];
  let fence = null;
  let buf = [];
  for (const line of lines) {
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fence && open) {
      fence = open[1];
      buf = [line];
      continue;
    }
    if (fence) {
      buf.push(line);
      if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') {
        out.push(put('C', buf.join('\n')));
        fence = null;
      }
      continue;
    }
    out.push(line.replace(/`[^`\n]+`/g, (m) => put('I', m)));
  }
  if (fence) out.push(put('C', buf.join('\n')));
  return {masked: out.join('\n'), saved};
}

function unmaskCode(text, saved) {
  return text.replace(/⟦([CI])(\d+)⟧/g, (m, _k, n) => (saved[Number(n)] !== undefined ? saved[Number(n)] : m));
}

async function translatePage(enRel, feedback) {
  const en = readText(enRel);
  const ids = englishIds(analyse(en).headings);
  const parts = chunk(en);
  let idOffset = 0;
  const out = [];
  for (let p = 0; p < parts.length; p++) {
    const partHeadings = analyse(parts[p]).headings.length;
    const partIds = ids.slice(idOffset, idOffset + partHeadings);
    const masked = maskCode(parts[p]);
    idOffset += partHeadings;
    const user = [
      `Translate this English page${parts.length > 1 ? ` (part ${p + 1} of ${parts.length}; translate only this part)` : ''} into French, following the rules.`,
      `Source file: ${enRel}`,
      partIds.length ? `Its headings, in order, must carry exactly these ids: ${partIds.map((i) => `{#${i}}`).join(' ')}` : '',
      'Tokens like ⟦C3⟧ and ⟦I12⟧ stand for code that is restored after translation: copy every one exactly, once, in the same place, and never translate or drop one.',
      feedback ? `A previous attempt failed validation. Fix these problems:\n${feedback}` : '',
      '<english>',
      masked.masked,
      '</english>',
    ].filter(Boolean).join('\n\n');
    out.push(unmaskCode((await callModel(user)).replace(/\s+$/, ''), masked.saved));
  }
  return out.join('\n\n') + '\n';
}

async function run(enRel, commit) {
  const frRel = frenchFor(enRel);
  const frAbs = path.join(ROOT, frRel);
  const previous = existsSync(frAbs) ? readFileSync(frAbs, 'utf8') : null;
  const stamp = (t) => writeMarker(t, markerLine(enRel, commit, sha12(readText(enRel)), /\.mdx$/.test(enRel)));
  let feedback = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const fr = stamp(await translatePage(enRel, feedback));
      mkdirSync(path.dirname(frAbs), {recursive: true});
      writeFileSync(frAbs, fr);
      const r = checkFile(frRel);
      if (!r.errors.length) return {page: enRel, ok: true, attempts: attempt, warnings: r.warnings};
      feedback = r.errors.join('\n');
    } catch (e) {
      feedback = null;
      if (attempt === 2) return restore(enRel, frAbs, previous, String(e.message || e));
    }
  }
  return restore(enRel, frAbs, previous, feedback);
}

function restore(enRel, frAbs, previous, why) {
  if (previous !== null) writeFileSync(frAbs, previous);
  else if (existsSync(frAbs)) unlinkSync(frAbs);
  return {page: enRel, ok: false, error: why};
}

const args = process.argv.slice(2);
let pages = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
if (args.includes('--from-stale')) {
  const s = JSON.parse(execFileSync('node', ['scripts/i18n/stale.mjs', '--json'], {cwd: ROOT}).toString());
  pages = [...s.stale, ...(args.includes('--include-missing') ? s.missing : [])];
}
const maxIdx = args.indexOf('--max');
if (maxIdx >= 0) pages = pages.slice(0, Number(args[maxIdx + 1]));

if (args.includes('--dry-run')) {
  // No API calls: show how each page would be split and which heading ids each
  // part must carry, so the chunking can be checked without a key.
  for (const page of pages) {
    const en = readText(page);
    const ids = englishIds(analyse(en).headings);
    const parts = chunk(en);
    const perPart = parts.map((p) => analyse(p).headings.length);
    const words = parts.map((p) => p.split(/\s+/).filter(Boolean).length);
    const rejoined = parts.join('\n') === en;
    console.log(`${page}: ${parts.length} part(s), words ${words.join('+')}, headings ${perPart.join('+')}=${ids.length}, lossless split: ${rejoined}`);
  }
  process.exit(0);
}
if (PROVIDER === 'anthropic' && !KEY) {
  console.error('ANTHROPIC_API_KEY is not set');
  process.exit(2);
}
if (PROVIDER === 'vertex' && !VERTEX_PROJECT) {
  console.error('VERTEX_PROJECT is not set');
  process.exit(2);
}
const commit = headCommit();
const results = [];
let next = 0;
await Promise.all(
  Array.from({length: Math.min(CONCURRENCY, pages.length)}, async () => {
    while (next < pages.length) {
      const page = pages[next++];
      const r = await run(page, commit);
      results.push(r);
      console.error(`${r.ok ? 'ok  ' : 'FAIL'} ${page}${r.ok ? '' : ` -- ${String(r.error).split('\n')[0]}`}`);
    }
  }),
);
console.log(JSON.stringify({provider: PROVIDER, model: MODEL, requested: pages.length, translated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok)}, null, 2));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
