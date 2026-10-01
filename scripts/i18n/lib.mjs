// Shared helpers for the French translation tooling (check, stale, translate).
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import matter from 'gray-matter';
import GithubSlugger from 'github-slugger';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const DOCS_FR = 'i18n/fr/docusaurus-plugin-content-docs/current';
export const PAGES_FR = 'i18n/fr/docusaurus-plugin-content-pages';

/** Sections whose pages are translated. */
export const SECTIONS = ['guides', 'design', 'certification', 'labs', 'modules'];

/** English source path (repo-relative) for a French file, or null. */
export function englishFor(frPath) {
  if (frPath.startsWith(DOCS_FR + '/')) return 'docs/' + frPath.slice(DOCS_FR.length + 1);
  if (frPath.startsWith(PAGES_FR + '/')) return 'src/pages/' + frPath.slice(PAGES_FR.length + 1);
  return null;
}

/** French path for an English source path. */
export function frenchFor(enPath) {
  if (enPath.startsWith('docs/')) return DOCS_FR + '/' + enPath.slice('docs/'.length);
  if (enPath.startsWith('src/pages/')) return PAGES_FR + '/' + enPath.slice('src/pages/'.length);
  return null;
}

export const sha12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

/** Current HEAD commit, short. */
export const headCommit = () => execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: ROOT}).toString().trim();

const MARKER = /<!--\s*translated-from:\s*(\S+)\s*@\s*([0-9a-f]+)(?:\s+sha256:([0-9a-f]+))?\s*-->|\{\/\*\s*translated-from:\s*(\S+)\s*@\s*([0-9a-f]+)(?:\s+sha256:([0-9a-f]+))?\s*\*\/\}/;

/** {source, commit, sha} from a French file's provenance marker, or null. */
export function readMarker(text) {
  const m = text.match(MARKER);
  if (!m) return null;
  return m[1] ? {source: m[1], commit: m[2], sha: m[3] ?? null} : {source: m[4], commit: m[5], sha: m[6] ?? null};
}

export const markerLine = (source, commit, sha, mdx) =>
  mdx ? `{/* translated-from: ${source} @ ${commit} sha256:${sha} */}` : `<!-- translated-from: ${source} @ ${commit} sha256:${sha} -->`;

/** Replace (or insert after the frontmatter) the provenance marker. */
export function writeMarker(text, line) {
  if (MARKER.test(text)) return text.replace(MARKER, line);
  const fm = text.match(/^---\n[\s\S]*?\n---\n/);
  return fm ? fm[0] + '\n' + line + '\n' + text.slice(fm[0].length) : line + '\n\n' + text;
}

/**
 * Split a markdown body into prose and fenced code. Code is returned verbatim
 * so callers can compare it byte for byte; prose has code removed so a "#"
 * inside a shell block is never mistaken for a heading.
 */
export function splitFences(body) {
  const lines = body.split('\n');
  const prose = [];
  const blocks = [];
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
        blocks.push(buf.join('\n'));
        fence = null;
      }
      continue;
    }
    prose.push(line);
  }
  if (fence) blocks.push(buf.join('\n'));
  return {prose: prose.join('\n'), blocks};
}

const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/**
 * Inline code spans, matched the way CommonMark does: a span may continue
 * across a line break inside a paragraph (the break renders as a space), but
 * never across a blank line, and it opens and closes with the same number of
 * backticks. Matching one line at a time paired the wrong backticks wherever
 * the English wrapped a span (`stateful_pvc_enabled =` / `true`), turning the
 * prose between them into "code" -- 112 false failures in the first bulk run.
 * Whitespace inside a span is normalised so a span wrapped differently in
 * French still compares equal.
 */
export const INLINE_CODE = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
export function inlineCodeSpans(prose) {
  // Paragraphs end at a blank line; a TABLE ROW is always its own unit (a span
  // never crosses rows), so a stray backtick in one cell cannot pair with a
  // backtick rows away. Whitespace inside a span is ignored for comparison: a
  // span the English wrapped as `a.` / `b` and the French wrote as `a.b` is the
  // same code.
  const units = prose.split(/\n[ \t]*\n/).flatMap((para) => {
    const out = [];
    let run = null;
    for (const line of para.split('\n')) {
      if (/^\s*\|/.test(line)) {
        if (run !== null) out.push(run.join('\n'));
        run = null;
        out.push(line);
      } else (run ??= []).push(line);
    }
    if (run !== null) out.push(run.join('\n'));
    return out;
  });
  return units.flatMap((u) => [...u.matchAll(INLINE_CODE)].map((m) => m[2].replace(/\s+/g, '')));
}

/** Everything the validator compares, extracted from one markdown file. */
export function analyse(text) {
  const parsed = matter(text);
  const {prose, blocks} = splitFences(parsed.content);
  const clean = stripHtmlComments(prose);
  const headings = [];
  for (const line of clean.split('\n')) {
    const h = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (!h) continue;
    const idm = h[2].match(/\s*\{#([^}]+)\}\s*$/);
    headings.push({level: h[1].length, text: idm ? h[2].slice(0, idm.index).trim() : h[2].trim(), id: idm ? idm[1] : null});
  }
  const inlineCode = inlineCodeSpans(clean);
  const links = [
    ...[...clean.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...clean.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map((m) => m[1]),
  ];
  const tableRows = clean.split('\n').filter((l) => /^\s*\|.*\|\s*$/.test(l)).length;
  const words = clean.replace(/`[^`]*`/g, ' ').split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
  const numbers = [...clean.replace(/`[^`]*`/g, ' ').matchAll(/\d[\d,.   ]*\d|\d/g)]
    .map((m) => m[0].replace(/(\d)[,   ](?=\d{3}\b)/g, '$1').replace(/\s+/g, ''));
  return {frontmatter: parsed.data, headings, blocks, inlineCode, links, tableRows, words, numbers};
}

/** Docusaurus/github-slugger ids for the English headings, in page order. */
export function englishIds(headings) {
  const slugger = new GithubSlugger();
  return headings.map((h) => h.id ?? slugger.slug(h.text));
}

export const readText = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Multiset difference, for "these were dropped / these appeared" reports. */
export function multisetDiff(a, b) {
  const count = new Map();
  for (const x of a) count.set(x, (count.get(x) ?? 0) + 1);
  for (const x of b) count.set(x, (count.get(x) ?? 0) - 1);
  const missing = [];
  const extra = [];
  for (const [k, v] of count) {
    if (v > 0) missing.push(k);
    if (v < 0) extra.push(k);
  }
  return {missing, extra};
}
