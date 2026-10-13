# Claude Code Instructions

## Git Workflow

- Commit directly to `main` and push straight to it — that is this repo's actual practice. `main` has GitHub branch-protection rules configured, but pushes are done directly; GitHub reports "Bypassed rule violations" (naming the specific rule, e.g. "Changes must be made through a pull request") rather than rejecting the push. Only use a `claude/...` feature branch + PR if the user explicitly asks for one.
- Pushing to `main` does **not** publish docs.radmodules.dev: GitHub Actions is manual-only (owner decision 2026-10-13, Actions spending limit). Run `bash scripts/ci-local.sh` before pushing; publishing is a deliberate `gh workflow run deploy.yml` (or **Run workflow**) and only when the user asks. Never trigger it on your own.
