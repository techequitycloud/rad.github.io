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
│
├── updates/                 # External source files, merged into docs/
│   ├── rad-modules/         # Base module documentation
│   ├── rad-automation/      # Platform automation docs (overrides)
│   └── partner-modules/     # Partner module docs (highest priority)
│
├── src/
│   ├── components/          # Custom React components
│   │   └── YouTubeEmbed/    # Video player with GCS poster support
│   └── css/                 # Theme overrides
│
├── apply_all_updates.py     # Master sync: updates/ → docs/
├── apply_module_updates.py  # Module merge logic (preserves video headers)
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

Capabilities, features, guides, practices, outcomes, tutorials, and workflows are flat directories. Update files arriving from sub-projects use varied naming conventions; `apply_all_updates.py` normalises them via `NAME_MAP` before writing to `docs/`.

Examples:
- `admins.md` → `admin.md`
- `kubernetes.md` → `container-orchestration.md`
- `gitops_iac.md` → `gitops-iac.md`
- `01-getting-started.md` → `getting-started.md`

### 3.3 Multi-Source Priority System

Three sub-project sources are merged in priority order (last wins on conflict):

1. `updates/rad-modules` — baseline module documentation
2. `updates/rad-automation` — platform automation overrides
3. `updates/partner-modules` — partner module content (highest priority)

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

When `apply_all_updates.py` creates a new doc, it auto-generates minimal front matter from the first `# Heading` of the update file.

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

**Fix applied (commits 3047598, b93ac3e):** 658 misaligned lines were corrected across 56 lab and module docs, and the same corrections were mirrored in the `updates/` source files.

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

## 11. Update / Merge Workflow

### 11.1 `apply_all_updates.py`

Merges all `.md` files from `updates/` into `docs/`, in source-priority order:

```bash
python3 apply_all_updates.py
```

**What it does:**
- Resolves each update file to a target path in `docs/`
- Calls `apply_update()` to merge content while preserving video headers
- Creates new docs (with auto-generated front matter) if no target exists
- Skips files in `implementation/` directories and README files

### 11.2 `apply_module_updates.py` — `apply_update()`

Core merge logic. Behaviour depends on whether the published doc already has a `<YouTubeEmbed>`:

| Published state | Action |
|-----------------|--------|
| Has `YouTubeEmbed` | Preserve entire original header (front matter + heading + video + PDF + trailing blanks), append update body |
| No `YouTubeEmbed` | Preserve only front matter, replace content from heading onward |

This ensures video sections and PDF links are not overwritten by upstream content updates.

### 11.3 `update_videos.py`

Bulk-inserts YouTube embeds and PDF links. Run it with a hardcoded list of `(file_path, video_id, [img_name, pdf_name])` tuples. It is not idempotent for new embeds (Type 1/2/4) but is safe for updates to existing embeds (Type 3).

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
| Video not showing | Update merged via `apply_update()` overwrote header | Fix: `has_video=True` preserves header; check detection logic |
| Wrong section in nav | Module in wrong sidebar category | Move the entry in `sidebars.ts` |
| Module name with underscores in heading | Template auto-generated `sidebar_label` used as heading | Replace `_` with space in `# ` heading and table cells |
