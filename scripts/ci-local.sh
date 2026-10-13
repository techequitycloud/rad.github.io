#!/usr/bin/env bash
# Local mirror of the non-deploy parts of .github/workflows/deploy.yml and
# .github/workflows/translate-fr.yml.
#
# GitHub Actions is manual-only for this repo (owner decision 2026-10-13,
# Actions spending limit). Pushing to main does NOT publish the site any more;
# publishing is a deliberate "Run workflow" on deploy.yml. This script checks
# the same things locally and never publishes.
#
#   bash scripts/ci-local.sh                     install, build, i18n-check, i18n-stale
#   bash scripts/ci-local.sh --list              list the sections
#   bash scripts/ci-local.sh --only build        run one section (repeatable)
#   bash scripts/ci-local.sh --translate         also run the translate section
#        [--translate-max N]                     at most N stale pages (default 50)
#        [--translate-pages "docs/labs/X.md ..."]  exactly these English pages
#
# translate calls an AI model (Anthropic, via scripts/i18n/translate.mjs) and
# writes French pages under i18n/fr for you to review and commit. It needs
# ANTHROPIC_API_KEY exported in your shell; without it the section is SKIPPED.
# The key is only passed through the environment, never printed. The Vertex
# provider the GitHub workflow uses is deliberately not used here: it would call
# Google Cloud.
#
# Never deploys or publishes, never calls Google Cloud, never prints secrets.
# A missing tool is reported as SKIP. Every selected section runs; the exit code
# is non-zero if any section FAILED.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

ALL=(install build i18n-check i18n-stale translate)
describe() {
  case "$1" in
    install)    echo "npm ci (exact lockfile install, as the Pages build does)" ;;
    build)      echo "npm run build -> build/ (the Pages build, NOT uploaded or published)" ;;
    i18n-check) echo "node scripts/i18n/check.mjs --all (the former PR check)" ;;
    i18n-stale) echo "node scripts/i18n/stale.mjs (report-only: out-of-date French pages; WARN, never FAIL)" ;;
    translate)  echo "opt-in with --translate: translate stale pages via Anthropic (needs ANTHROPIC_API_KEY)" ;;
  esac
}

ONLY=(); TRANSLATE=0; TMAX=50; TPAGES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      for s in "${ALL[@]}"; do printf '  %-11s %s\n' "$s" "$(describe "$s")"; done
      exit 0 ;;
    --only)
      [ $# -ge 2 ] || { echo "--only needs a section name (see --list)" >&2; exit 2; }
      ok=0; for s in "${ALL[@]}"; do [ "$s" = "$2" ] && ok=1; done
      [ $ok = 1 ] || { echo "unknown section: $2 (see --list)" >&2; exit 2; }
      ONLY+=("$2"); shift 2 ;;
    --translate) TRANSLATE=1; shift ;;
    --translate-max)
      [ $# -ge 2 ] && [[ "$2" =~ ^[0-9]+$ ]] || { echo "--translate-max needs a whole number" >&2; exit 2; }
      TMAX="$2"; shift 2 ;;
    --translate-pages)
      [ $# -ge 2 ] || { echo "--translate-pages needs a space-separated page list" >&2; exit 2; }
      TPAGES="$2"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (try --list or --help)" >&2; exit 2 ;;
  esac
done
if [ ${#ONLY[@]} -gt 0 ]; then SECTIONS=("${ONLY[@]}"); else SECTIONS=("${ALL[@]}"); fi

have() { command -v "$1" >/dev/null 2>&1; }
RESULTS=()
record() { RESULTS+=("$1|$2|$3"); echo "$2${3:+: $3}"; }

run_translate() {
  if [ "$TRANSLATE" != 1 ]; then
    record translate SKIP "opt-in: pass --translate to call the model"; return
  fi
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    record translate SKIP "ANTHROPIC_API_KEY is not set in this shell (export it to translate locally)"; return
  fi
  local args=()
  if [ -n "$TPAGES" ]; then
    for p in $TPAGES; do
      if ! printf '%s' "$p" | grep -Eq '^docs/(guides|design|certification|labs|modules)/[A-Za-z0-9_.-]+\.mdx?$' || [ ! -f "$p" ]; then
        record translate FAIL "not a translatable English page: $p"; return
      fi
      args+=("$p")
    done
  else
    args=(--from-stale --max "$TMAX")
  fi
  # Anthropic provider only: the Vertex provider would call Google Cloud.
  local out rc
  out="$(mktemp "${TMPDIR:-/tmp}/ci-local-translate.XXXXXX")"
  env -u GOOGLE_ACCESS_TOKEN -u VERTEX_PROJECT TRANSLATE_PROVIDER=anthropic \
    node scripts/i18n/translate.mjs "${args[@]}" > "$out"
  rc=$?
  cat "$out"; rm -f "$out"
  if [ $rc -ne 0 ]; then record translate FAIL "translate.mjs exit $rc"; return; fi
  if node scripts/i18n/check.mjs --all >/dev/null; then
    record translate PASS "review and commit the changes under i18n/fr"
  else
    record translate FAIL "translations written but check.mjs --all fails - review i18n/fr"
  fi
}

run_section() {
  local s="$1" rc
  echo
  echo "=== $s: $(describe "$s")"
  if ! have node || ! have npm; then record "$s" SKIP "node/npm not installed"; return; fi
  if [ "$s" != install ] && [ ! -d node_modules ]; then
    record "$s" SKIP "no node_modules - run: bash scripts/ci-local.sh --only install"; return
  fi
  case "$s" in
    install)    npm ci; rc=$? ;;
    build)
      if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = true ]; then
        echo "note: shallow clone - dates come from the committed map (deploy.yml uses full history)"
      fi
      # The prebuild hook regenerates src/data/datePublished.ts (the Pages build
      # does the same on its throwaway runner). Put it back if it was clean, so a
      # local check leaves no diff behind.
      local dp=src/data/datePublished.ts dp_clean=0
      git diff --quiet -- "$dp" 2>/dev/null && dp_clean=1
      npm run build; rc=$?
      [ $dp_clean = 1 ] && git checkout -q -- "$dp" 2>/dev/null ;;
    i18n-check) node scripts/i18n/check.mjs --all; rc=$? ;;
    i18n-stale)
      local json n
      if ! json="$(node scripts/i18n/stale.mjs --json)"; then record "$s" FAIL "stale.mjs failed"; return; fi
      node scripts/i18n/stale.mjs
      n="$(printf '%s' "$json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);console.log(`${s.stale.length} stale, ${s.missing.length} never translated, ${s.orphaned.length} orphaned`)})')"
      case "$n" in
        "0 stale, "*", 0 orphaned") record "$s" PASS "$n" ;;
        *) record "$s" WARN "$n (report-only, as in the workflow)" ;;
      esac
      return ;;
    translate) run_translate; return ;;
  esac
  if [ "$rc" -eq 0 ]; then record "$s" PASS ""; else record "$s" FAIL "exit $rc - see output above"; fi
}

for s in "${SECTIONS[@]}"; do run_section "$s"; done

echo
echo "=== Summary"
printf '%-11s %-5s %s\n' SECTION RESULT NOTE
failed=0
for r in "${RESULTS[@]}"; do
  IFS='|' read -r s st note <<<"$r"
  printf '%-11s %-5s %s\n' "$s" "$st" "$note"
  [ "$st" = FAIL ] && failed=1
done
echo
echo "Nothing was published. To publish docs.radmodules.dev: gh workflow run deploy.yml"
exit $failed
