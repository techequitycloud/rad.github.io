---
title: "PCA Section 4 Prep: Process Analysis & Optimization"
description: "Prepare for the PCA exam Section 4 — analyzing and optimizing technical and business processes — with hands-on RAD deployment labs on Google Cloud."
---

# PCA Certification Preparation Guide: Section 4 — Analyzing and optimizing technical and business processes (~15% of the exam)

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pca_section4.png" alt="PCA Certification Preparation Guide: Section 4 — Analyzing and optimizing technical and business processes (~15% of the exam)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Official exam guide:** [Professional Cloud Architect certification](https://cloud.google.com/learn/certification/cloud-architect) — always confirm section weightings against the current Google Cloud exam guide.


This section is about *process* architecture: software delivery lifecycle, testing and release strategy, and the organizational controls (approvals, cost governance, decision-making) wrapped around them. The deployable half lives in `App_CloudRun`'s CI/CD surface and the platform's Cloud Deploy layer; the people half — SRE culture, stakeholder management, post-mortems — must be studied from the SRE books and Architecture Framework. Deploy the **Security and delivery** profile from the [Lab Map](PCA_Certification_Guide.md) with `enable_cicd_trigger = true` and `enable_cloud_deploy = true`.

---

## 4.1 Analyzing and defining technical processes

> ⏱ ~90 min · 💰 low — Cloud Build minutes and Artifact Registry storage · ⚙️ Requires: Security and delivery profile + a GitHub repository (`github_repository_url`, token or App installation)

**Why the exam cares** — The exam tests SDLC design choices: where builds happen, how artifacts gain provenance, how releases progress through environments, and how risk is contained per stage (canary percentages, approval gates, rollback paths). Expect questions distinguishing CI (build/test/integrate) from CD (release/promote) and asking which Google tool owns which step.

**How RAD implements it**

| SDLC stage | Implementation | Variables (defaults) |
|---|---|---|
| Source trigger | Cloud Build GitHub trigger on push | `enable_cicd_trigger` (default `false`), `cicd_trigger_config.branch_pattern` (default `"^main$"`, plus included/ignored file filters) |
| Build | Kaniko executor `v1.23.2` builds in-cluster-less (no Docker daemon) and pushes to Artifact Registry tagged `latest`, the app version, and `COMMIT_SHA` | `enable_cicd_trigger` |
| Provenance | optional `gcloud beta container binauthz attestations sign-and-create` step signs the `COMMIT_SHA` digest with the KMS attestor key | `enable_binary_authorization` |
| Deploy (simple) | `gcloud run services update` to the new image | default path |
| Deploy (progressive) | Cloud Deploy pipeline with per-stage targets and skaffold configs in GCS | `enable_cloud_deploy` (default `false`), `cloud_deploy_stages` — default `dev` → `staging` → `prod` where **`prod` has `require_approval = true`** |
| Canary / blue-green | Cloud Run revision traffic splitting; entries must sum to exactly 100 (validated) | `traffic_split` (default `[]` = all traffic to latest) |
| Artifact hygiene | AR cleanup policies | `max_images_to_retain` (default `7`), `delete_untagged_images` (default `true`), `image_retention_days` (default `30`) |

Two details to internalize as exam material: builds tag every image with the immutable `COMMIT_SHA` (the digest the attestation signs — `latest` is never the deployment contract), and the default pipeline encodes the governance asymmetry the exam expects: pre-production promotes freely, production requires a human.

**Try it**

1. Push a commit to the configured branch and watch **Console > Cloud Build > History** — identify the Kaniko build step and (if enabled) the attestation step.
2. Inspect the resulting tags:

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/<project>/<repo>/<image> \
  --include-tags --limit=5
```

3. With Cloud Deploy enabled, open **Console > Cloud Deploy > Delivery pipelines**, promote the release from `dev` to `staging`, then observe that `prod` waits in "Needs approval".
4. Configure a canary: set `traffic_split` to 90% LATEST / 10% a previous revision (with a `tag = "canary"`), apply, and verify:

```bash
gcloud run services describe <service-name> --region=us-central1 \
  --format="yaml(status.traffic)"
```

5. You know it worked when the prod stage is blocked pending approval and `status.traffic` shows the 90/10 split with the tagged canary URL.

**Check yourself**
<details>
<summary>Q1: A team wants new releases validated on 5% of production traffic with instant rollback. Which mechanism here, and what is the rollback action?</summary>

A: Cloud Run `traffic_split` — e.g. 95% to the stable revision, 5% to the new one (optionally with a stable `tag` URL for targeted testing). Rollback is a traffic reassignment to the previous revision, not a redeploy, because Cloud Run retains prior revisions (`max_revisions_to_retain`, default `7`). This is the serverless analogue of canary deployments the exam describes.
</details>

<details>
<summary>Q2: Why does the pipeline sign the image's COMMIT_SHA tag rather than `latest`?</summary>

A: Attestations bind to an immutable digest. `latest` is a moving pointer — signing it would attest "whatever this tag points to," defeating supply-chain integrity. The Binary Authorization policy verifies the digest being deployed carries a valid signature from the attestor, which only holds for the specific built artifact.
</details>

<details>
<summary>Q3: Where is the CI/CD boundary in this platform's pipeline?</summary>

A: CI = Cloud Build (trigger → Kaniko build → push to Artifact Registry → attest): producing a verified artifact. CD = Cloud Deploy (release → dev → staging → approval → prod): promoting that artifact through environments. The exam expects you to assign testing/build failures to CI and promotion/approval/rollout strategy to CD.
</details>

**Beyond the modules** — The exam also covers testing strategy (unit vs integration vs load; the pipeline here runs no test step — adding one is a good exercise), post-mortem/root-cause culture, and troubleshooting tooling (Cloud Profiler, Cloud Trace). Study the DORA metrics (deployment frequency, lead time, change-failure rate, MTTR) and the "Application deployment and testing strategies" architecture doc — rolling vs blue-green vs canary trade-offs are recurring exam material.

**⚠️ Exam trap** — Don't conflate Cloud Build triggers with Cloud Deploy. A scenario about "build on every merge" is Cloud Build; "promote the same artifact through dev/staging/prod with approvals" is Cloud Deploy. Rebuilding the image per environment (instead of promoting one artifact) is the anti-pattern the exam wants you to reject.

---

## 4.2 Analyzing and defining business processes

> ⏱ ~45 min · 💰 no additional cost · ⚙️ Requires: Cloud Deploy enabled (Security and delivery profile)

**Why the exam cares** — Architects operate change-management and governance processes, not just infrastructure: enforced approvals for regulated environments, cost accountability, skills-based platform choices (a team that cannot run Kubernetes should not be handed Kubernetes), and data-driven decision frameworks like SRE error budgets.

**How RAD implements it** — The deployable artifacts here are governance encoded as configuration. The default `cloud_deploy_stages` makes production promotion a human decision (`require_approval = true` on `prod`) — an auditable change-management gate satisfying separation-of-duties expectations, with `auto_promote` available per stage where velocity matters more. Cost accountability comes from `create_billing_budget` + `budget_alert_thresholds` (Section 1.1) and from GKE cost allocation (enabled on every cluster, supporting namespace-level cost breakdown in billing). And the platform's *existence* demonstrates a skills-readiness decision: the portal lets a team choose Cloud Run (low Kubernetes skill requirement) or GKE (full orchestration) for the same application — the choice itself is the business-process artifact.

**Try it**

1. Create a release and promote it to the `prod` stage; in **Console > Cloud Deploy > Delivery pipelines > (pipeline) > Releases**, click into the pending rollout and use **Approve** (or reject it).
2. Review the audit trail of that approval:

```bash
gcloud deploy rollouts list \
  --delivery-pipeline=<pipeline-name> --release=<release-name> \
  --region=us-central1 \
  --format="table(name,state,approvalState,deployStartTime)"
```

3. You know it worked when the rollout shows `approvalState: APPROVED` with a timestamp — evidence a change-advisory process can consume.

**Check yourself**
<details>
<summary>Q1: A regulated insurer requires documented sign-off before production changes, but wants zero friction in lower environments. How is this expressed in this platform — and in exam terms, what process is being implemented?</summary>

A: `cloud_deploy_stages` with `require_approval = false` (optionally `auto_promote = true`) on dev/staging and `require_approval = true` on prod — exactly the module default. This implements change management with separation of duties: the deployer and the production approver are distinct, and Cloud Deploy records both, producing the audit evidence (SOC 2-style change control) the scenario demands.
</details>

<details>
<summary>Q2: Leadership must choose between Cloud Run and GKE for a new product; the team has strong app developers and no platform engineers. What does the exam expect you to weigh?</summary>

A: Team skills readiness is a first-class architectural input. With no Kubernetes operations capability, Cloud Run's managed model (no clusters, quotas, PDBs, upgrades) reduces operational risk even if GKE offers more control; choosing GKE would require hiring or training (a cost and timeline factor). The exam consistently rewards matching platform complexity to organizational capability, not maximal flexibility.
</details>

**Beyond the modules** — Study what no module can show: SRE error budgets as a decision mechanism (feature velocity vs reliability), SLI/SLO definition with stakeholders, incident communication, and translating technical metrics into business KPIs. The free Google SRE book chapters "Embracing Risk" and "Service Level Objectives" are the canonical exam preparation here.

**⚠️ Exam trap** — An approval gate is change *management*, not change *validation*. If the scenario asks how to catch bad releases automatically, the answer is canary analysis/testing in the pipeline — a human approval button does not verify correctness, it assigns accountability.
