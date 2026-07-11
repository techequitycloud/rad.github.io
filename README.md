# RAD Platform Documentation

**Live site: [docs.radmodules.dev](https://docs.radmodules.dev)**

Hands-on Google Cloud certification training by [Tech Equity Cloud](https://radmodules.dev):
seven certification study paths that map every official exam section to
deployment labs, drawn from 100+ open-source application modules on Cloud Run
and GKE Autopilot — deployed into your own Google Cloud project.

## Start here

- [Certification study paths](https://docs.radmodules.dev/docs/certification/ACE_Certification_Guide) — ACE, PCA, PCD, PCDE, PCNE, PDE, PSE lab maps
- [Hands-on labs](https://docs.radmodules.dev/docs/labs/Services_GCP) — 109 guided deploy → verify → operate → tear-down walkthroughs
- [Module reference](https://docs.radmodules.dev/docs/modules/Services_GCP) — 156 configuration guides
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

Deployment is automated: pushes to `main` build and publish to GitHub Pages,
then submit changed URLs to IndexNow (see `.github/workflows/deploy.yml`).
