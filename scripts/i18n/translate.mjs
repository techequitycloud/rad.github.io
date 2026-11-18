#!/usr/bin/env node
// Translate English pages into French with an AI model.
//
//   node scripts/i18n/translate.mjs docs/labs/Ghost_CloudRun.md ...
//   ... --from-stale [--include-missing] [--max N]     take the list from stale.mjs
//
// Options:
//   --dry-run        make NO model calls: print, per page, how it would be
//                    translated (sections reused / parts sent), the number of
//                    calls, and an approximate token count and cost.
//   --max-calls N    stop cleanly after N model calls (default 150). Pages not
//                    started are listed in the summary; a page cut off half-way
//                    keeps its previous French. 0 = no limit.
//   --model ID       override TRANSLATE_MODEL.
//   --force          translate an explicitly named page even when its French is
//                    already up to date (default: skip it, it would cost a call
//                    and change nothing).
//   --max N          at most N pages.
//
// Providers (TRANSLATE_PROVIDER):
//   vertex     Gemini on Vertex AI (default). Env: VERTEX_PROJECT, VERTEX_LOCATION
//              (default global), TRANSLATE_MODEL (default gemini-3.5-flash-lite;
//              a larger model, e.g. gemini-3.8-flash, is opt-in with --model).
//              Auth: GOOGLE_ACCESS_TOKEN if set, else `gcloud auth print-access-token`
//              (refreshed every 45 minutes) -- in CI, gcloud is signed in through
//              Workload Identity Federation, so no key is stored anywhere.
//              Every request carries labels {caller: "docs-translate"}, so the
//              billing export attributes the spend.
//   anthropic  Claude. Env: ANTHROPIC_API_KEY, TRANSLATE_MODEL (default claude-sonnet-5).
// TRANSLATE_CONCURRENCY (default 4).
//
// Only what changed is sent. A STALE page (stale.mjs: the English moved on since
// the French was stamped) is split at its H2/H3 headings; every section whose
// English is byte-identical to the English the French was made from (read from
// git at the marker's commit, and only trusted when its sha256 matches the
// marker) keeps its existing French, and only the changed sections go to the
// model, adjacent changed sections in one call. A boilerplate edit to one table
// row of 351 module pages is then 351 calls of ~400 words rather than 569 calls
// of whole pages (measured with --dry-run: ~4x fewer input tokens, ~15x fewer
// output tokens). When the old English cannot be
// recovered, the French does not line up with it section for section, or most
// of the page changed, the whole page is translated as before.
//
// Each translation uses scripts/i18n/prompt.md as the system prompt, is
// stamped with its provenance marker, then run through the validator. A page
// that fails is retried once, whole, with the validator's errors; if it still
// fails, the previous French (if any) is restored and the page is reported,
// never written half-right. Writes a JSON summary to stdout.
import {existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT, frenchFor, readText, readMarker, sha12, markerLine, writeMarker, headCommit, analyse, englishIds, INLINE_CODE} from './lib.mjs';
import {checkFile} from './check.mjs';

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PROVIDER = process.env.TRANSLATE_PROVIDER || 'vertex';
const MODEL = flagValue('--model') || process.env.TRANSLATE_MODEL || (PROVIDER === 'vertex' ? 'gemini-3.5-flash-lite' : 'claude-sonnet-5');
const MAX_CALLS = Number(flagValue('--max-calls') ?? 150);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
/** Share of a page's words that may change before it is cheaper and safer to translate it whole. */
const INCREMENTAL_MAX_CHANGED = 0.6;
/** USD per 1M tokens (input, output), list price, for the --dry-run estimate only. */
const PRICES = {
  'gemini-2.5-flash-lite': [0.1, 0.4],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-pro': [1.25, 10],
  'claude-sonnet-5': [3, 15],
};
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || 4);
const KEY = process.env.ANTHROPIC_API_KEY;
const VERTEX_PROJECT = process.env.VERTEX_PROJECT;
// Gemini 3.x is served only on the `global` location (NOT_FOUND in us-central1),
// and `global` has no regional host prefix: https://aiplatform.googleapis.com.
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'global';
const VERTEX_HOST = VERTEX_LOCATION === 'global' ? 'aiplatform.googleapis.com' : `${VERTEX_LOCATION}-aiplatform.googleapis.com`;
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
  const url = `https://${VERTEX_HOST}/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${MODEL}:streamGenerateContent?alt=sse`;
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
        // Attributes the spend in the billing export (cost review 2026-11-15).
        labels: {caller: 'docs-translate'},
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
    out.push(line);
  }
  if (fence) out.push(put('C', buf.join('\n')));
  // Inline code, matched the way lib.mjs's validator reads it: per paragraph,
  // each table row on its own, so a span the English wraps across a line is
  // masked whole. Fenced blocks are already placeholders by now.
  const masked = out
    .join('\n')
    .split(/(\n[ \t]*\n)/)
    .map((para) => {
      // Units: a run of non-table lines, or one table row. Joined back with the
      // same '\n' that separated them, so the text is reproduced exactly.
      const units = [];
      let run = null;
      for (const line of para.split('\n')) {
        if (/^\s*\|/.test(line)) {
          if (run !== null) units.push(run.join('\n'));
          run = null;
          units.push(line);
        } else (run ??= []).push(line);
      }
      if (run !== null) units.push(run.join('\n'));
      return units.map((u) => u.replace(INLINE_CODE, (m) => put('I', m))).join('\n');
    })
    .join('');
  return {masked, saved};
}

function unmaskCode(text, saved) {
  return text.replace(/⟦([CI])(\d+)⟧/g, (m, _k, n) => (saved[Number(n)] !== undefined ? saved[Number(n)] : m));
}

/** Split a page at its H2 and H3 headings (outside code and frontmatter). Lossless: parts.join('\n') === text. */
function headingSections(text) {
  const lines = text.split('\n');
  const out = [[]];
  let fence = null;
  let inFrontmatter = lines[0] === '---';
  lines.forEach((line, idx) => {
    if (inFrontmatter && idx > 0 && line === '---') inFrontmatter = false;
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && !inFrontmatter && /^#{2,3} /.test(line) && idx > 0) out.push([]);
    out.at(-1).push(line);
  });
  return out.map((l) => l.join('\n'));
}

const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

const git = (...a) => {
  try {
    return execFileSync('git', a, {cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20}).toString();
  } catch {
    return null;
  }
};

/**
 * The English the current French was made from, or null. Only trusted when its
 * sha256 matches the marker's. Tried at the marker's commit first, then back
 * through the file's recent history: a page stamped while its English edit was
 * still uncommitted records an older commit than the English it hashed.
 */
function previousEnglish(enRel, frText) {
  const m = readMarker(frText);
  if (!m?.sha || m.source !== enRel) return null;
  const commits = [m.commit, ...(git('rev-list', '-n', '20', 'HEAD', '--', enRel) ?? '').split('\n').filter(Boolean)];
  for (const c of commits) {
    const old = git('show', `${c}:${enRel}`);
    if (old !== null && sha12(old) === m.sha) return old;
  }
  return null;
}

/**
 * How to produce the French for one page: a list of pieces, each either kept
 * French text ({keep}) or English to translate ({en, ids}). Incremental when
 * the existing French lines up with the English it came from, section by
 * section; otherwise the whole page in CHUNK_WORDS parts.
 */
function planPage(enRel, {full = false} = {}) {
  const en = readText(enRel);
  const ids = englishIds(analyse(en).headings);
  const whole = () => {
    let off = 0;
    return {
      mode: 'full',
      pieces: chunk(en).map((part) => {
        const n = analyse(part).headings.length;
        const piece = {en: part, ids: ids.slice(off, off + n)};
        off += n;
        return piece;
      }),
    };
  };
  const frAbs = path.join(ROOT, frenchFor(enRel));
  if (full || !existsSync(frAbs)) return whole();
  const frText = readFileSync(frAbs, 'utf8');
  const old = previousEnglish(enRel, frText);
  if (old === null) return whole();

  const oldSecs = headingSections(old);
  const frSecs = headingSections(frText);
  if (oldSecs.length !== frSecs.length) return whole();
  // The French must line up with the old English: same headings per section,
  // carrying the old English ids.
  const oldIds = englishIds(analyse(old).headings);
  const frenchOf = new Map();
  let off = 0;
  for (let i = 0; i < oldSecs.length; i++) {
    const n = analyse(oldSecs[i]).headings.length;
    const frIds = analyse(frSecs[i]).headings.map((h) => h.id);
    if (frIds.length !== n || frIds.some((id, k) => id !== oldIds[off + k])) return whole();
    off += n;
    if (!frenchOf.has(oldSecs[i])) frenchOf.set(oldSecs[i], {fr: frSecs[i], ids: frIds});
  }

  const pieces = [];
  let changedWords = 0;
  off = 0;
  for (const sec of headingSections(en)) {
    const n = analyse(sec).headings.length;
    const secIds = ids.slice(off, off + n);
    off += n;
    const prior = frenchOf.get(sec);
    // Reuse only when the heading ids it carries are the ones this position
    // needs (a repeated heading text can slug differently elsewhere).
    if (prior && prior.ids.join('\n') === secIds.join('\n')) {
      pieces.push({keep: prior.fr});
      continue;
    }
    changedWords += wordCount(sec);
    const last = pieces.at(-1);
    if (last?.en !== undefined && wordCount(last.en) + wordCount(sec) <= CHUNK_WORDS) {
      last.en += '\n' + sec;
      last.ids.push(...secIds);
    } else pieces.push({en: sec, ids: [...secIds]});
  }
  if (changedWords > INCREMENTAL_MAX_CHANGED * wordCount(en)) return whole();
  return {mode: 'incremental', pieces};
}

const callsIn = (plan) => plan.pieces.filter((p) => p.en !== undefined).length;

function userPrompt(piece, {enRel, label, feedback}) {
  const masked = maskCode(piece.en);
  const text = [
    `Translate this English ${label} into French, following the rules.`,
    `Source file: ${enRel}`,
    piece.ids.length ? `Its headings, in order, must carry exactly these ids: ${piece.ids.map((i) => `{#${i}}`).join(' ')}` : '',
    'Tokens like ⟦C3⟧ and ⟦I12⟧ stand for code that is restored after translation: copy every one exactly, once, in the same place, and never translate or drop one.',
    feedback ? `A previous attempt failed validation. Fix these problems:\n${feedback}` : '',
    '<english>',
    masked.masked,
    '</english>',
  ].filter(Boolean).join('\n\n');
  return {text, saved: masked.saved, maskedChars: masked.masked.length};
}

const pieceLabel = (plan, k, n) =>
  plan.mode === 'incremental'
    ? 'excerpt of a page (the rest of the page is already translated; translate only this excerpt)'
    : `page${n > 1 ? ` (part ${k + 1} of ${n}; translate only this part)` : ''}`;

class BudgetExhausted extends Error {}
const budget = {used: 0, reserved: 0};
/** Reserve n calls against --max-calls; false when they would exceed it. */
const reserve = (n) => {
  if (MAX_CALLS > 0 && budget.reserved + n > MAX_CALLS) return false;
  budget.reserved += n;
  return true;
};

async function translatePlan(enRel, plan, feedback, tally) {
  const toSend = plan.pieces.filter((p) => p.en !== undefined);
  const out = [];
  for (const piece of plan.pieces) {
    if (piece.keep !== undefined) {
      out.push(piece.keep);
      continue;
    }
    if (MAX_CALLS > 0 && budget.used >= MAX_CALLS) throw new BudgetExhausted('max-calls reached');
    const u = userPrompt(piece, {enRel, label: pieceLabel(plan, toSend.indexOf(piece), toSend.length), feedback});
    budget.used++;
    tally.calls++;
    const fr = unmaskCode((await callModel(u.text)).replace(/\s+$/, ''), u.saved);
    // Keep the English piece's trailing blank lines, so the next section starts where it did.
    out.push(fr + piece.en.match(/\s*$/)[0]);
  }
  const text = out.join('\n');
  return text.endsWith('\n') ? text : text + '\n';
}

async function run(enRel, commit) {
  const frRel = frenchFor(enRel);
  const frAbs = path.join(ROOT, frRel);
  const previous = existsSync(frAbs) ? readFileSync(frAbs, 'utf8') : null;
  const stamp = (t) => writeMarker(t, markerLine(enRel, commit, sha12(readText(enRel)), /\.mdx$/.test(enRel)));
  let feedback = null;
  let mode = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // The retry is always the whole page: a failed incremental result may have
    // failed because of the French it kept.
    const plan = planPage(enRel, {full: FORCE || attempt === 2});
    mode ??= plan.mode;
    const need = callsIn(plan);
    if (!reserve(need)) return restore(enRel, frAbs, previous, 'max-calls reached', {budget: true});
    const tally = {calls: 0};
    try {
      const fr = stamp(await translatePlan(enRel, plan, feedback, tally));
      mkdirSync(path.dirname(frAbs), {recursive: true});
      writeFileSync(frAbs, fr);
      const r = checkFile(frRel);
      if (!r.errors.length) return {page: enRel, ok: true, mode, attempts: attempt, warnings: r.warnings};
      feedback = r.errors.join('\n');
    } catch (e) {
      if (e instanceof BudgetExhausted) return restore(enRel, frAbs, previous, e.message, {budget: true});
      feedback = null;
      if (attempt === 2) return restore(enRel, frAbs, previous, String(e.message || e));
    } finally {
      // Hand back what this attempt reserved but did not use (it threw part-way).
      budget.reserved -= need - tally.calls;
    }
  }
  return restore(enRel, frAbs, previous, feedback);
}

function restore(enRel, frAbs, previous, why, {budget: cut = false} = {}) {
  if (previous !== null) writeFileSync(frAbs, previous);
  else if (existsSync(frAbs)) unlinkSync(frAbs);
  return {page: enRel, ok: false, budget: cut, error: why};
}

/** True when the page's French exists and was made from the current English. */
function upToDate(enRel) {
  const frAbs = path.join(ROOT, frenchFor(enRel));
  if (!existsSync(frAbs)) return false;
  const m = readMarker(readFileSync(frAbs, 'utf8'));
  return !!m?.sha && m.sha === sha12(readText(enRel));
}

// ---- arguments ----
const WITH_VALUE = new Set(['--max', '--max-calls', '--model']);
let pages = [];
for (let i = 0; i < args.length; i++) {
  if (WITH_VALUE.has(args[i])) i++;
  else if (!args[i].startsWith('--')) pages.push(args[i]);
}
for (const f of ['--max', '--max-calls']) {
  const v = flagValue(f);
  if (v !== undefined && !/^\d+$/.test(v)) {
    console.error(`${f} needs a whole number`);
    process.exit(2);
  }
}
let skippedUpToDate = [];
if (args.includes('--from-stale')) {
  const s = JSON.parse(execFileSync('node', ['scripts/i18n/stale.mjs', '--json'], {cwd: ROOT}).toString());
  pages = [...s.stale, ...(args.includes('--include-missing') ? s.missing : [])];
} else if (!FORCE) {
  skippedUpToDate = pages.filter(upToDate);
  pages = pages.filter((p) => !skippedUpToDate.includes(p));
}
const maxPages = flagValue('--max');
if (maxPages !== undefined) pages = pages.slice(0, Number(maxPages));

if (DRY_RUN) {
  // No model calls: the plan for each page, and what running it would cost.
  const price = PRICES[MODEL];
  let calls = 0;
  let inTok = 0;
  let outTok = 0;
  let withinBudget = 0;
  const modes = {full: 0, incremental: 0};
  for (const page of pages) {
    const plan = planPage(page, {full: FORCE});
    const n = callsIn(plan);
    modes[plan.mode]++;
    const sent = plan.pieces.filter((p) => p.en !== undefined);
    let pin = 0;
    let pout = 0;
    sent.forEach((piece, k) => {
      const u = userPrompt(piece, {enRel: page, label: pieceLabel(plan, k, sent.length)});
      // ~4 characters a token; French output runs ~20% longer than the English.
      pin += Math.ceil((SYSTEM.length + u.text.length) / 4);
      pout += Math.ceil((u.maskedChars * 1.2) / 4);
    });
    if (MAX_CALLS === 0 || calls + n <= MAX_CALLS) withinBudget++;
    calls += n;
    inTok += pin;
    outTok += pout;
    const kept = plan.pieces.filter((p) => p.keep !== undefined).length;
    const words = sent.map((p) => wordCount(p.en));
    console.log(`${page}: ${plan.mode}, ${n} call(s)${plan.mode === 'incremental' ? `, ${kept} section(s) kept` : ''}, words sent ${words.join('+') || 0}`);
  }
  const cost = price ? (inTok * price[0] + outTok * price[1]) / 1e6 : null;
  console.log('');
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        provider: PROVIDER,
        model: MODEL,
        pages: pages.length,
        skippedUpToDate: skippedUpToDate.length,
        modes,
        calls,
        maxCalls: MAX_CALLS || null,
        pagesWithinMaxCalls: withinBudget,
        approxInputTokens: inTok,
        approxOutputTokens: outTok,
        approxCostUSD: cost === null ? `unknown (no price for ${MODEL})` : Number(cost.toFixed(2)),
        note: 'Estimate for one attempt per page; a validation retry re-sends the whole page.',
      },
      null,
      2,
    ),
  );
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
let stopped = false;
await Promise.all(
  Array.from({length: Math.min(CONCURRENCY, pages.length)}, async () => {
    while (!stopped && next < pages.length) {
      const page = pages[next++];
      const r = await run(page, commit);
      results.push(r);
      if (r.budget) {
        stopped = true;
        console.error(`stop ${page} -- --max-calls ${MAX_CALLS} reached`);
      } else console.error(`${r.ok ? 'ok  ' : 'FAIL'} ${page}${r.ok ? ` (${r.mode})` : ` -- ${String(r.error).split('\n')[0]}`}`);
    }
  }),
);
const done = new Set(results.filter((r) => !r.budget).map((r) => r.page));
const notTranslated = pages.filter((p) => !done.has(p));
console.log(
  JSON.stringify(
    {
      provider: PROVIDER,
      model: MODEL,
      requested: pages.length,
      skippedUpToDate: skippedUpToDate.length,
      translated: results.filter((r) => r.ok).length,
      incremental: results.filter((r) => r.ok && r.mode === 'incremental').length,
      calls: budget.used,
      maxCalls: MAX_CALLS || null,
      stoppedBy: stopped ? 'max-calls' : null,
      notTranslated,
      failed: results.filter((r) => !r.ok && !r.budget),
    },
    null,
    2,
  ),
);
if (stopped) console.error(`Stopped at --max-calls ${MAX_CALLS}: ${notTranslated.length} page(s) not translated; run again to continue.`);
process.exit(results.some((r) => !r.ok && !r.budget) ? 1 : 0);
