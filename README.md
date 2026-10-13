# RAD Platform Documentation

**Live site: [docs.radmodules.dev](https://docs.radmodules.dev)**

Hands-on Google Cloud certification training by [Tech Equity Cloud](https://radmodules.dev):
seven certification study paths that map every official exam section to
deployment labs, drawn from 190+ open-source applications on Cloud Run
and GKE Autopilot — deployed into your own Google Cloud project.

## Start here

- [Certification study paths](https://docs.radmodules.dev/docs/certification/ACE_Certification_Guide) — ACE, PCA, PCD, PCDE, PCNE, PDE, PSE lab maps
- [Hands-on labs](https://docs.radmodules.dev/docs/labs/Services_GCP) — 353 guided deploy → verify → operate → tear-down walkthroughs
- [Module reference](https://docs.radmodules.dev/docs/modules/Services_GCP) — 532 configuration guides
- [AI Tooling on GCP](https://docs.radmodules.dev/docs/guides/ai-tooling-gcp) — the self-hosted LLM stack
- [About the author](https://docs.radmodules.dev/author) — Dr Shiyghan Emmanuel Navti
- [RAD Console](https://radmodules.dev) — the deployment portal behind these docs

Found a problem in the docs? [Open an issue](https://github.com/techequitycloud/rad.github.io/issues).

## Development

Built with [Docusaurus](https://docusaurus.io/).

```bash
npm install        # install dependencies
npm start          # local dev server with live reload
npm run build      # production build into build/ (also regenerates
                   # src/data/datePublished.ts and build/llms-full.txt)
npm run serve      # serve the production build locally
npm run typecheck  # TypeScript check
```

Deployment is **manual** (owner decision 2026-10-13, Actions spending limit):
pushing to `main` does **not** publish the site. Publish by starting
`.github/workflows/deploy.yml` with **Run workflow** or `gh workflow run
deploy.yml`; it builds, publishes to GitHub Pages, then submits changed URLs to
IndexNow (inputs `indexnow` / `indexnow_base` choose whether and since which
commit). The French translations workflow is manual too
(`gh workflow run translate-fr.yml`, `-f mode=validate` for the check).

Before pushing, run the checks locally — this never publishes anything:

```bash
bash scripts/ci-local.sh           # install, build, French check, stale report
bash scripts/ci-local.sh --list    # sections; --only <section> runs one
bash scripts/ci-local.sh --translate   # also translate stale French pages
                                       # (needs ANTHROPIC_API_KEY exported)
```
