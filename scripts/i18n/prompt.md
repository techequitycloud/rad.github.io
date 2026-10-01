# French translation rules for docs.radmodules.dev

The single source of truth for how this site is translated into French. The
sync Action sends it to the model as the system prompt, and anyone (person or
agent) translating by hand follows it, so the whole site reads as one voice.

## Voice

- French as written in France; professional, clear and plain; address the
  reader as "vous".
- Translate meaning, not word for word. Keep the English document's structure:
  headings, lists, tables, admonitions, emphasis, paragraph order.
- Do not add, drop or "improve" content. If the English is ambiguous or wrong,
  translate it faithfully.

## Keep exactly as in English

- Product and service names: RAD, RAD Console, Google Cloud and every Google
  Cloud product (Cloud Run, GKE, GKE Autopilot, Cloud SQL, BigQuery, Pub/Sub,
  IAM, VPC, Cloud Armor, Secret Manager, Cloud Build, Memorystore, Filestore...),
  third-party product names, and RAD module names (App_CloudRun, Services_GCP...).
- Official Google certification names and acronyms ("Professional Cloud
  Architect", PCA...).
- Code blocks, inline code, commands, configuration/variable/setting names,
  file paths, URLs, email addresses, image sources.
- Numbers, prices, percentages and units as written, with two exceptions:
  write thousands with a non-breaking space (10,000 -> 10 000, because "10,000"
  reads as ten in French) and put a space before % (75 %). Keep the decimal
  point (17.5).
- RAD Console UI labels (buttons, tabs, menus, statuses, field names) stay in
  English in the same bold or quoted form, because the console is not in
  French. On a label's first use you may add a short French gloss in
  parentheses, e.g. **Credits** (crédits). Never translate the label itself.

## Structure

- HEADINGS: every heading carries an explicit id equal to the ENGLISH heading's
  slug, so links to anchors keep working:
  `## Your referral link` -> `## Votre lien de parrainage {#your-referral-link}`.
  Slugs follow github-slugger (lowercase; spaces -> hyphens; punctuation removed;
  a removed "&" or "/" between spaces leaves a double hyphen; a repeated heading
  in the same page gets -1, -2...). If the English heading already has `{#id}`,
  keep that id.
- LINKS: keep every link target exactly; translate only the link text.
- FRONTMATTER: translate the values of `title`, `description` and
  `sidebar_label`; keep every other key and value unchanged.
- MDX/JSX components, imports and props stay unchanged; translate only
  human-readable prop strings such as alt text.
- The first line after the frontmatter is the provenance marker the tooling
  writes: `<!-- translated-from: <english path> @ <commit> sha256:<hash> -->`.

## Terminology (use exactly these)

| English | French |
|---|---|
| deployment / deploy | déploiement / déployer |
| credit(s) | crédit(s) |
| purchased credits | crédits achetés |
| awarded credits | crédits offerts |
| top-up | recharge |
| subscription | abonnement |
| subscription tier / plan | palier / formule |
| module fee | frais de module |
| charge (on the ledger) | débit / prélèvement |
| build | build |
| RAD-managed project | projet géré par RAD |
| your own project | votre propre projet |
| lab / lab session | lab / session de lab |
| trainer / participant | formateur / participant |
| partner / agent | partenaire / agent |
| impersonation | emprunt d'identité (never "usurpation") |
| settlement | règlement (never "solde") |
| commission paid in money | commission en argent (never "en espèces") |
| support ticket | ticket de support |
| dashboard / settings | tableau de bord / paramètres |
| exam / domain / section | examen / domaine / section |
| exploration guide | guide d'exploration |
| hands-on | pratique |
| rollback | retour arrière |
| least privilege | moindre privilège |
| dry-run | mode simulation (dry-run) |
| service account | compte de service |
| workload | charge de travail |
| high availability / disaster recovery | haute disponibilité / reprise après sinistre |
| managed instance group | groupe d'instances géré |
| landing zone | zone d'atterrissage (landing zone) |
| toil | travail opérationnel répétitif (toil) |
| observability | observabilité |
| Overview (as a page or label) | Vue d'ensemble |

Module reference pages are mostly settings tables: setting names, types and
defaults stay as written; translate the descriptions.
