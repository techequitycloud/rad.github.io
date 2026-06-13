# SKILL.md — RAD Platform Docs: Design Principles, Best Practices & Fixes

This document captures the accumulated engineering knowledge for the RAD Platform documentation site (`docs.radmodules.dev`). It is the canonical reference for contributors and automated agents working in this repository.

---

## 1. Project Overview

**RAD (Rapid Application Deployment) Platform** provides Google Cloud infrastructure as Terraform/OpenTofu modules. This Docusaurus site is its documentation layer, covering:

- Module configuration guides (77 modules across Cloud Run and GKE variants)
- Hands-on lab guides (51 modules)
- Role-based features, tutorials, guides, and workflows
- GCP certification prep (ACE, PCA, PCD, PDE, PSE)
- Platform capabilities, practices, and business outcomes

**Live site**: https://docs.radmodules.dev  
**Tech stack**: Docusaurus 3.9.2, React 19, TypeScript 5.6, GitHub Pages (gh-pages branch)

---

## 2. Repository Structure

```
rad.github.io/
├── docs/                    # Published documentation
│   ├── capabilities/        # 16 platform capability overviews
│   ├── certification/       # Certification reference pages
│   ├── features/            # 6 role-based feature summaries
│   ├── guides/              # 6 role-based guides
│   ├── labs/                # 51 hands-on lab guides (subdir per module)
│   ├── modules/             # 77 module configuration guides (subdir per module)
│   ├── outcomes/            # 6 business outcome docs
│   ├── practices/           # 6 engineering practice docs
│   ├── runbooks/            # Operational runbooks
│   ├── tutorials/           # 8 role-based and getting-started tutorials
│   └── workflows/           # 9 role-based workflow docs
│       ├── ace/ pca/ pcd/   # GCP certification sections
│       └── pde/ pse/
│                            # docs/ is updated directly from the source repos
│                            # (rad-modules, rad-automation, partner-modules);
│                            # there is no longer an updates/ staging dir — see §11
│
├── src/
│   ├── components/          # Custom React components
│   │   └── YouTubeEmbed/    # Video player with GCS poster support
│   └── css/                 # Theme overrides
│
├── apply_all_updates.py     # LEGACY (updates/ → docs/) — retired, not run; see §11
├── apply_module_updates.py  # LEGACY merge logic — retired; kept for reference
├── update_videos.py         # Bulk YouTube embed insertion (5 patterns)
├── verify_changes.py        # Playwright browser verification
├── verify_final.py          # Final Playwright verification with video recording
├── docusaurus.config.ts     # Site configuration
└── sidebars.ts              # Sidebar navigation (explicit, not auto-discovered)
```

---

## 3. Documentation Architecture

### 3.1 Subdir-per-Module Pattern

Labs and module guides each live in their own subdirectory with a file that matches the directory name:

```
docs/labs/App_CloudRun/App_CloudRun.md
docs/modules/App_CloudRun/App_CloudRun.md
```

This isolates assets (diagrams, code samples) per module and keeps the `labs/` and `modules/` trees clean.

### 3.2 Flat Sections with Name Normalisation

Capabilities, features, guides, practices, outcomes, tutorials, and workflows are flat directories. Source files use varied naming conventions; map them to the canonical `docs/` filename when syncing (the legacy `NAME_MAP` in `apply_all_updates.py` records the historical mappings for reference).

Examples:
- `admins.md` → `admin.md`
- `kubernetes.md` → `container-orchestration.md`
- `gitops_iac.md` → `gitops-iac.md`
- `01-getting-started.md` → `getting-started.md`

### 3.3 Multi-Source Priority System

Docs originate in three source repositories. When the same page exists in more than one, precedence is (highest wins):

1. `rad-modules` — baseline module documentation
2. `rad-automation` — platform automation overrides
3. `partner-modules` — partner module content (highest priority)

Edit the canonical source, then sync directly into `docs/` (§11). These are sibling checkouts of this repo, not an in-repo `updates/` staging directory.

### 3.4 Sidebar Navigation is Explicit

`sidebars.ts` defines every entry manually using `{ type: 'doc', id: '...', label: '...' }`. Auto-discovery is not used. This keeps navigation intentional and prevents orphan pages from appearing in the sidebar.

**Sidebar entry format:**
```ts
{ type: 'doc', id: 'modules/App_CloudRun/App_CloudRun', label: 'App CloudRun' }
```

**Important:** `sidebar_label` in front matter overrides `sidebars.ts` labels. When the two conflict, the front matter wins — so keep them consistent or remove `sidebar_label` if `sidebars.ts` is the source of truth.

---

## 4. Front Matter

Every doc must begin with a YAML front matter block:

```yaml
---
title: "App on Cloud Run — Configuration Guide"
sidebar_label: "App CloudRun"
---
```

- `title` — used by Docusaurus for `<title>` and social sharing
- `sidebar_label` — display name in the nav tree (keep in sync with `sidebars.ts`)
- `id` and `slug` are optional and rarely needed; omit unless there is a specific routing reason

When adding a **new** page from a source repo (which ships no front matter), create a minimal block from the first `# Heading`, then add the `sidebars.ts` entry (§10) — pages are not auto-discovered. Use this shape:

```yaml
---
title: "<the page's # heading text>"
sidebar_label: "<short nav label>"
---
```

---

## 5. Content Patterns

### 5.1 Module Configuration Guide Structure

```markdown
---
title: "Module Name — Configuration Guide"
sidebar_label: "Module Name"
---

# Module Name — Configuration Guide

<YouTubeEmbed videoId="XXXX" poster="https://storage.googleapis.com/rad-public-2b65/modules/module_name.png" />

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/module_name.pdf" target="_blank">View Presentation (PDF)</a>

[Module description paragraph]

[ASCII architecture diagram]

## GCP Resources Created
| Resource | Name Pattern | Description |
|---|---|---|
...

## Input Variables
### Category
- `variable_name` (type) — description
```

**Decision guidance + pitfalls conventions** (established across the Services_GCP / App_CloudRun / App_GKE guides, 2026-06): a strong config guide does more than list variables — it helps the reader *decide*.
- **Per-group "Choosing…" blockquote.** Lead each variable group that has real trade-offs with a `> **Choosing <thing>.** …` blockquote naming the decision axis (cost vs availability, managed vs self-managed, exposure model, engine choice) — *when/why*, not just *how*. Don't add one to trivial groups.
- **"Configuration Pitfalls & Sensible Defaults" table.** Risk-leveled (Critical/High/Medium/Low) table of value/combination mistakes and their consequences, with a preamble noting that many are now caught at plan time.
- **🛡 plan-time badge.** In the pitfalls table, mark rows the module rejects at plan time (via `validation` blocks or `validation.tf` preconditions) with **🛡 plan-time**, and phrase the consequence as "…is rejected at plan time" rather than a runtime failure. Leave unmarked the genuine runtime/operational/sizing hazards the module cannot decide. State explicitly that a clean plan confirms value/combination rules, not sizing or topology.

### 5.2 Lab Guide Structure

```markdown
---
title: "Module Name — Lab Guide"
sidebar_label: "Module Name Lab"
---

# Module Name — Lab Guide

📖 **[Configuration Guide](link)**

[Brief intro]

---

## Table of Contents
1. [Overview](#1-overview)
...

## 1. Overview
### What Is Module_Name?
### Key Capabilities Demonstrated
| Capability | What It Demonstrates |
|---|---|

## 2. Architecture
[ASCII box diagram]

## 3. Prerequisites
## 4. Lab Setup

## Exercise 1 — Title
### Objective
### Steps
1. Navigate to **GCP Console → Cloud Run**
2. Click **Service name**

## Cleanup
## Reference
```

**Foundation-bound "full power" lab conventions** (App_CloudRun / App_GKE labs, 2026-06): a module lab should let the reader exercise the breadth without re-documenting every variable.
- **Foundation binding note.** App-module labs deploy onto a `Services_GCP` foundation — state up front to use the **same `tenant_deployment_id`** so the module auto-discovers the shared VPC / Cloud SQL / NFS / cluster / registry instead of provisioning inline.
- **"Choose your lab path" step.** Offer **Path A — Minimal** (defaults, set only `project_id` + `tenant_deployment_id`) and **Path B — Full-Feature** (a ready-to-paste config that turns on a representative breadth — DB, NFS, GCS, Redis, init jobs, uptime check, IAP). Keep the highest-blast-radius features (Binary Auth, VPC-SC, IAP) in **safe modes** so a learner can't lock themselves out.
- **Per-feature verification.** Tag verification steps with the flag that enables them (e.g. `[enable_nfs = true]`) so Minimal-path users skip cleanly, and verify each enabled capability actually came up (workload health/shape, DB + secret, NFS/GCS/Redis wiring, init-job success, IAP enforcement, uptime check) — not just a single health check.
- **Plan-time validation note.** Mention that invalid values/combinations are rejected at plan time, cross-linking the config guide's pitfalls table.
- Keep the lab's lean operational spine (Deploy → Access → Operate → Observe → Troubleshoot → Tear down); defer exhaustive variable detail to the config guide so the lab stays accurate over time.

### 5.3 Features / Guides / Workflows Structure

```markdown
---
title: "Admin Features"
sidebar_label: "Admin"
---

# Admin Features

<YouTubeEmbed videoId="XXXX" poster="https://storage.googleapis.com/rad-public-2b65/features/admin_features.png" />

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/features/admin_features.pdf" target="_blank">Download Feature PDF</a>

[Introduction]

## Feature Category
- **Feature Name** — description
```

### 5.4 Capabilities / Practices / Outcomes Structure

```markdown
> **Scope.** [One-sentence canonical ownership statement]

[Body sections with cross-references to modules/]
```

---

## 6. Formatting Rules

### 6.1 Heading Hierarchy

| Level | Usage |
|-------|-------|
| `#` | Page title only (one per file, matches `sidebar_label`) |
| `##` | Major sections (numbered 1, 2, 3… in labs) |
| `###` | Subsections |
| `####` | Deep details (use sparingly) |

### 6.2 Bold and Code Inline

- **Bold** for clickable UI elements: `**Save**, **Deploy**, **Admin Settings**`
- `Code backticks` for technical terms: `` `variable_name`, `terraform apply` ``

### 6.3 Module Display Names

Module names in headings and table cells omit underscores; use spaces:

```
# App CloudRun — Configuration Guide   ✓
# App_CloudRun — Configuration Guide   ✗
```

The `sidebar_label` and `sidebars.ts` label may retain underscores for file-name matching, but the `# ` heading and table cells must use spaces.

### 6.4 ASCII Box Diagrams

Architecture diagrams use Unicode box-drawing characters (not ASCII hyphens). Every line in the box **must** end at the same column as the right `│` border. Off-by-one spacing makes borders appear broken.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Services_GCP                                         │
│  ALWAYS CREATED                      OPTIONAL (feature flags)                │
│  ─────────────                       ──────────────────────                  │
│  • 46 GCP APIs enabled               • PostgreSQL (create_postgres)          │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Fix applied (commits 3047598, b93ac3e):** 658 misaligned lines were corrected across 56 lab and module docs, with the same corrections made in the source repos so a re-sync does not reintroduce them.

### 6.5 Section Dividers

Use a blank-line `---` divider between major sections:

```markdown
[Section content]

---

## Next Section
```

---

## 7. YouTube Embeds and PDF Links

All video content uses the custom `<YouTubeEmbed>` React component with a GCS-hosted poster image.

**Component usage:**
```jsx
<YouTubeEmbed
  videoId="dP3jBocmh4k"
  poster="https://storage.googleapis.com/rad-public-2b65/features/admin_features.png"
/>
```

**PDF link:**
```html
<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/features/admin_features.pdf" target="_blank">View Presentation (PDF)</a>
```

**GCS asset naming convention:**
- Poster: `{GCS_BASE}/{category}/{slug}.png`
- PDF: `{GCS_BASE}/{category}/{slug}.pdf`
- GCS base: `https://storage.googleapis.com/rad-public-2b65`

### 7.1 Five Video Integration Patterns (`update_videos.py`)

| Type | Context | Action |
|------|---------|--------|
| 1 | Workflow/guide pages with `<img>` + `<video>` | Replace both with `<YouTubeEmbed>` |
| 2 | Features pages with `<img>` + `<br/>` + `<video>` + `<br/>` | Replace, preserve PDF link |
| 3 | Already has `<YouTubeEmbed>` | Update `videoId` only |
| 4 | No video at all | Insert `<YouTubeEmbed>` after the `# ` heading |
| 5 | Module pages | Insert `<YouTubeEmbed>` (with poster) + `<br/>` + PDF link after heading |

---

## 8. MDX / JSX Build Error Prevention

Docusaurus renders `.md` files as MDX. Raw HTML and template syntax in prose can trigger build failures.

### 8.1 Escape Angle Brackets in Prose

Any `<` or `>` that is not a valid HTML/JSX tag must be escaped:

```markdown
Response time was <200ms   ✗  (parses as opening tag)
Response time was \<200ms  ✓
Response time was &lt;200ms ✓
```

**Fix applied (commit 6703130):** Escaped `<200ms` in `Django_CloudRun.md`.

### 8.2 Escape Bare Template Variables

Shell or Terraform variable syntax like `${SERVICE}` is treated as JSX expression interpolation:

```markdown
Run `${SERVICE}`   ✗  (MDX error: ReferenceError)
Run `\${SERVICE}`  ✓
```

**Fix applied (commit 4772e57):** Escaped `${SERVICE}` across prose text.

### 8.3 Avoid Unquoted Identifier-Like Expressions in Prose

Docusaurus SSG (Static Site Generation) runs JSX. Even valid-looking expressions like `{DB_NAME}` in Markdown text are evaluated as JSX. Use backticks or escape them:

```markdown
Set DB_NAME to your database name.   ✓  (no braces)
Set `DB_NAME` to your database name. ✓  (code span)
Set {DB_NAME} to your database name. ✗  (SSG ReferenceError)
```

**Fix applied (commit 5b1eeb6):** Fixed `{DB_NAME}` and `{DB_USER}` in `Wordpress_Common.md`.

### 8.4 Escape Angle Brackets in Code Placeholders

Placeholder syntax like `<external-ip>` in prose (outside code fences) is parsed as an HTML tag:

```markdown
Use <external-ip> as the address.   ✗
Use `<external-ip>` as the address. ✓
```

**Fix applied (commit 8e4ef98):** Wrapped bare angle-bracket placeholders in backticks in `Sample_GKE.md`.

---

## 9. Cross-Reference Links

Internal links use relative paths from the current file's location. Do not use absolute doc paths:

```markdown
[See capabilities/security.md](../capabilities/security.md) ✓
[See capabilities/security.md](/docs/capabilities/security)  ✗
```

Docusaurus validates all links at build time (`onBrokenLinks: 'throw'`). A broken link fails the entire build.

**Fix applied (commit 06021e7):** Corrected broken cross-reference links across capabilities, outcomes, and practices docs.

When linking to a directory that has a single file (e.g., `Ghost_Common/`), link to the file directly:

```markdown
[Ghost Common](../Ghost_Common/Ghost_Common.md)  ✓
[Ghost Common](../Ghost_Common/)                 ✗  (resolves to directory, not file)
```

**Fix applied (commit b36cf9a):** Fixed `Ghost_GKE` broken link pointing to a directory.

---

## 10. Sidebar Navigation Rules

### 10.1 Do Not Rely on `sidebar_label` in Front Matter to Rename Nav Entries

`sidebar_label` in YAML front matter **overrides** the label set in `sidebars.ts`. When these conflict, the front matter wins. Use front matter labels only when the page has no `sidebars.ts` entry, or keep both in sync.

**Fix applied (commit 7feefc4):** Removed conflicting `sidebar_label` from front matter where `sidebars.ts` was the intended source of truth.

### 10.2 Sidebar Section Positioning

Menu order is determined entirely by the order of entries in `sidebars.ts`. To move a section, move its entry in that file. There is no auto-sorting.

**Changes applied:**
- `Foundation` moved to top of Partner Modules (commit b1565f1)
- `Credit Management` moved from Getting Started to Platform Tutorials (commit 1ac507d)
- `VMware Engine` moved from Partner Modules to Platform Modules (commit 7da9c0d)
- Sidebar menu reordered (commit df174d0)

### 10.3 Module Name Casing in Sidebar Labels

Sidebar labels for GKE/CloudRun modules should use the format `Module CloudRun` or `Module GKE` (with a space, not an underscore). Display names in `sidebars.ts` are independent of the file path which retains underscores.

---

## 11. Update / Sync Workflow

Documentation originates in the **source repositories** — `rad-modules`, `rad-automation`, and `partner-modules` (checked out as siblings of this repo) — each under `docs/<section>/<file>.md`. The site is now updated **directly from those source repos**.

> **The `updates/` staging directory is no longer used.** Earlier, source docs were copied into `updates/<project>/docs/...` and merged into `docs/` by `apply_all_updates.py` / `apply_module_updates.py`. That staging step has been retired — edit the doc in its source repo and sync it straight into `docs/`. The `apply_*.py` scripts remain in the repo for historical reference only and should not be run.

### 11.1 Canonical source per doc

A given page has one canonical source repo. Where the same page exists in more than one, precedence is unchanged: `rad-modules` (baseline) → `rad-automation` → `partner-modules` (highest priority). Edit the doc in its source repo first so the two stay in sync, then sync it into the site.

### 11.2 Syncing a source doc into the site

Source docs are **plain Markdown** — they do **not** carry the site's YAML front matter or `<YouTubeEmbed>` video header. When updating `docs/<section>/<file>.md` from its source, the front matter and video header are **site-owned** and the body is **source-owned**:

1. Keep the existing front matter block (`--- … ---`) verbatim.
2. Keep the `<YouTubeEmbed>` + PDF-link header if the page has one (§5.1, §7).
3. Replace everything from the first `# ` heading onward with the source body.
4. Re-apply the formatting and MDX-safety rules (§6, §8) — escape `<`, `${…}`, and `{…}` in prose, and verify ASCII box alignment — since source bodies are not authored against Docusaurus/MDX.

This is the same preservation the retired `apply_update()` performed automatically; it now happens as part of the sync. A quick way to apply it for a single file:

```bash
# From the rad.github.io repo root, with the source repo as a sibling.
# Preserves the site front matter (first --- … --- block) and replaces the body.
python3 - <<'PY'
src = "../partner-modules/docs/modules/Services_GCP.md"   # source-owned body
dst = "docs/modules/Services_GCP.md"                       # site-owned front matter
import io
lines = io.open(dst, encoding="utf-8").read().splitlines()
close = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
fm = "\n".join(lines[:close+1])
body = io.open(src, encoding="utf-8").read().rstrip("\n")
io.open(dst, "w", encoding="utf-8").write(fm + "\n\n" + body + "\n")
PY
```

> If the page has a `<YouTubeEmbed>` header (most module/feature pages do), do **not** use the snippet above as-is — it preserves only the front matter. Either keep the heading-plus-video header block as well, or re-insert the video with `update_videos.py` (§11.3) after syncing.

### 11.3 `update_videos.py`

Bulk-inserts YouTube embeds and PDF links. Run it with a hardcoded list of `(file_path, video_id, [img_name, pdf_name])` tuples. It is not idempotent for new embeds (Type 1/2/4) but is safe for updates to existing embeds (Type 3). Still current — video headers remain site-owned content layered on top of the synced body.

---

## 12. Naming Conventions

| Artifact | Convention | Example |
|----------|------------|---------|
| Module directory | `PascalCase_Platform` | `App_CloudRun`, `Django_GKE` |
| Module doc file | Same as directory + `.md` | `App_CloudRun.md` |
| Sidebar label | Spaces instead of underscores | `App CloudRun` |
| Heading `#` | Spaces, no underscores | `# App CloudRun — Lab Guide` |
| PDF filename | `snake_case.pdf` | `admin_features.pdf` |
| GCS poster | `snake_case.png` | `admin_features.png` |
| PDF case sensitivity | Use exact casing: `Wordpress` not `WordPress` | `Wordpress_Common.pdf` |

**Fix applied (commit 3611277):** Corrected `WordPress_` to `Wordpress_` in PDF file name references throughout the site to match actual GCS object names (GCS is case-sensitive).

---

## 13. Git Workflow

Per `CLAUDE.md`:

1. **All development** goes on a `claude/...` feature branch
2. **Commit** with descriptive messages referencing what changed and why
3. **Push** to the feature branch, then **PR → squash merge to main**
4. Never push directly to `main`

---

## 14. Automated Verification

Two Playwright scripts verify the site after changes:

| Script | Purpose |
|--------|---------|
| `verify_changes.py` | Headless browser checks: page titles, sidebar visibility, screenshots |
| `verify_final.py` | Same but records a video to `~/verification/video_final/` |

Run against a local dev server (`yarn start`) before pushing significant structural changes.

---

## 15. Quick Reference: Common Fixes

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| MDX build error: ReferenceError | `{VAR}` or `${VAR}` in prose treated as JSX | Escape: `\${VAR}` or use backticks |
| MDX build error: unexpected tag | `<200ms` or `<external-ip>` in prose | Escape: `\<` or wrap in backticks |
| Broken link at build time | Relative path points to directory or missing file | Fix path; link to file, not directory |
| ASCII box looks broken | Lines end at wrong column | Count characters; pad/trim to match right `│` column |
| Sidebar shows wrong label | `sidebar_label` in front matter overrides `sidebars.ts` | Remove front matter label or sync both |
| PDF/poster 404 | Case mismatch with GCS object name | Use `Wordpress` not `WordPress`; match GCS exactly |
| Video not showing | Sync replaced the body but dropped the site-owned `<YouTubeEmbed>` header | Re-add the video header (§11.2), or re-run `update_videos.py` (§7.1) after syncing |
| Wrong section in nav | Module in wrong sidebar category | Move the entry in `sidebars.ts` |
| Module name with underscores in heading | Template auto-generated `sidebar_label` used as heading | Replace `_` with space in `# ` heading and table cells |
