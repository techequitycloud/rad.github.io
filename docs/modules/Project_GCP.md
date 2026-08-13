---
title: "Project GCP \u2014 Tier-0 Sandbox Guardrails"
description: "Configuration reference for the Project GCP RAD module — the Tier-0 module that sets the API allowlist, quota ceilings, and optional sandbox project creation, applied before Services GCP."
---

# Project GCP — Tier-0 Sandbox Guardrails

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Project_GCP.png" alt="Project GCP — Tier-0 Sandbox Guardrails" style={{maxWidth: "100%", borderRadius: "8px"}} />

`Project GCP` is the platform's **Tier-0** module — the only module in this catalog applied *before* `Services GCP`. It does not deploy an application or shared application infrastructure; it hardens the **project itself**: which Google Cloud APIs are allowed to be enabled at all, a set of self-imposed quota ceilings, and — optionally — the creation of the sandbox project and a least-privilege deploying identity to operate inside it once created.

**Deployment order:**

```
Project GCP  →  Services GCP  →  App CloudRun / App GKE  →  Application Modules
```

Unlike every other module in this catalog, `Project GCP` is not meant to be run by the same identity, pipeline, or trainee-facing action that deploys applications — see "Two Identities, Deliberately Separate" below.

---

## What It Manages

| File | Resource | Governs |
|---|---|---|
| `apis.tf` | `google_project_service` | Which Google Cloud APIs are enabled on the target project |
| `quotas.tf` | `google_cloud_quotas_quota_preference` | Self-imposed quota ceilings (Cloud Run regional CPU, Compute Engine regional CPU, project-wide GPUs) |
| `project.tf` | `google_project`, `google_project_iam_member`, `google_iam_deny_policy`, `google_resource_manager_lien` | Optional project creation, least-privilege IAM for a separate deploying identity, a deny policy blocking that identity from raising its own quota caps, and a deletion lien |
| `validation.tf` | `check` blocks | Plan-time regression guards (the API floor can never shrink; `create_project` requires its companion identity variables) |
| `budget.tf` | `google_billing_budget` | A billing budget scoped to the created project, so a spend alert names one user's sandbox |

**Folder-level organization policy guardrails (external-IP denial, service-account key restrictions, the `gcp.restrictServiceUsage` allowlist, etc.) are *not* managed by this module** — see "Folder-Level Org Policies" below.

---

## Why a Separate Module, Applied by a Separate Identity

Every other module in this catalog assumes a project-scoped deploying identity. `Project GCP` needs *organization or folder*-level IAM (org-scoped `orgpolicy.policyAdmin`/`iam.denyAdmin`, `serviceusage.serviceUsageAdmin`-class permissions to write API allowlists and quota preferences) — a materially different trust tier than anything downstream. It is designed to be applied by a platform admin impersonating a dedicated, impersonation-only service account (`rad-guardrails-admin` in this platform's own deployment), never wired to a Cloud Build trigger, Cloud Function, or Pub/Sub path a trainee action could reach. An identity that can both execute arbitrary Terraform on request *and* rewrite the org's own guardrails would defeat the reason the guardrails exist.

---

## Two Identities, Deliberately Separate

| Identity | Variable | Role |
|---|---|---|
| **Resource creator** | `resource_creator_identity` | Impersonated to *run* this module. Applies the API allowlist and quota preferences; when `create_project = true`, creates the project itself (GCP auto-grants it `roles/owner` on the project it creates — there is no documented way to suppress this). |
| **Deploying identity** | `deploying_identity_email` | The identity that actually runs `Services GCP` / application-module deploys *inside* the new project once it exists. Receives the `deploying_identity_bundle` role set below — **never** Owner. |
| **Deployed-by (human)** | `deployed_by_email` | The human who requested the deployment. Receives a strictly read-only role bundle so they can see what was deployed for them without being able to create, modify, or delete anything themselves. |

This separation is the point: the identity that sets guardrails is never the same one — or reachable via the same user-triggered path — as the one that operates inside them.

---

## The Additive-Floor API Allowlist

`apis.tf` enables a hardcoded floor of APIs (`local.baseline_required_apis` in `main.tf`) merged with `var.additional_apis` — the variable can only **add** to the floor; nothing in this module can shrink it. `validation.tf`'s `api_floor_never_shrinks` check exists purely as a regression guard against a future edit accidentally introducing a filter or subtraction.

The floor was grep-verified against `Services_GCP`, `App_CloudRun`, and `App_GKE` — the actual set of `*.googleapis.com` strings a resource in those three modules reads — not the larger list `Services_GCP`'s own `default_apis` enables (which also turns on several APIs no resource in those three modules consumes, e.g. Gmail, Calendar, Docs, Drive, Vertex AI):

```
compute · servicenetworking · sqladmin · run · cloudbuild · artifactregistry
secretmanager · iam · iamcredentials · file · redis · cloudresourcemanager
logging · monitoring · storage · cloudscheduler · certificatemanager · iap
binaryauthorization · eventarc · container · cloudkms · containeranalysis
ondemandscanning · pubsub · gkehub · gkeconnect · mesh · anthospolicycontroller
anthosconfigmanagement · accesscontextmanager · clouddeploy · securitycenter
Replace the code block's last line with:

gkebackup · firestore · dns · servicedirectory · billingbudgets

`alloydb` was removed on 2026-08-11 when AlloyDB was dropped from the sandbox/development folder allowlists and added to the production denylist on an explicit cost decision — leaving it in the floor would fail `google_project_service` on any fresh project. `billingbudgets` was added because `budget.tf`'s `google_billing_budget` call is quota-attributed to *this* project; without it the apply fails with a bare `Error 403: The caller does not have permission`, which reads as an IAM problem and is not one (confirmed live 2026-08-11 on deployments 605ab251 and d5f4b359). The count at line 65 stays correct: the floor is still 38 APIs (one removed, one added — verified by counting `local.baseline_required_apis`).
```

That's 38 APIs (each entry above maps to `<name>.googleapis.com`). Add anything an application-specific integration needs beyond this floor — e.g. `aiplatform.googleapis.com` for a Vertex AI-backed app — via `additional_apis`; it is automatically folded into both enablement and the allowlist output.

**`dns` and `servicedirectory` are on the floor because GKE Autopilot cluster creation calls them unconditionally**, not because any module configures them. Autopilot provisions a VPC-scoped Cloud DNS managed zone for cluster DNS, and calls Service Directory (`ManagedResourceService.AddServiceBundle`) during cluster bring-up. Neither is optional and neither can be opted out of. Omitting `dns` blocks `google_container_cluster` creation outright with `Error 403: Request is disallowed by organization's constraints/gcp.restrictServiceUsage constraint ... attempting to use service 'dns.googleapis.com'`; omitting `servicedirectory` leaves the cluster stuck in `ERROR` with the equivalent message for `servicedirectory.googleapis.com`. Both were confirmed live deploying a GKE module into a RAD-managed project.

**This enables the API on the project.** It does not by itself decide whether the API is *permitted* — see the next section.

---

## Folder-Level Org Policies (Not Managed Here)

Folder-scoped organization policy guardrails — `compute.vmExternalIpAccess` deny, service-account key creation/upload disabled, Cloud SQL public-IP restriction, and (the companion restriction to this module's own API allowlist) `gcp.restrictServiceUsage`, which controls which APIs are *allowed to be enabled anywhere in the folder* — were originally implemented inside this module and then removed.

**Why removed:** GCP allows only one policy object per `(folder, constraint)` pair. Every sandbox project sharing a folder had its own Terraform state believing it owned the exact same folder-scoped resource — confirmed live to cause real drift (one project's apply silently overwriting another's folder policy), and, worse, meant tearing down any *one* sandbox project's state would delete the shared policy for every other project in that folder.

Folder-level guardrails now live in `rad-automation/scripts/02-setup-ui.sh` (step 10, "Enable organization level configuration and deployments"), applied **once per folder** at setup time via raw `gcloud org-policies set-policy` calls — decoupled from any individual sandbox project's Terraform lifecycle. Every new sandbox project created under that folder inherits the policies automatically through GCP's policy hierarchy; you do not need to (and cannot, from this module) re-apply them per project.

An API enabled by this module (`apis.tf`) but *not* present in the folder's `gcp.restrictServiceUsage` allowlist would itself fail to enable — keep `02-setup-ui.sh`'s hardcoded allowlist in sync with `baseline_required_apis` by hand if the baseline ever changes; there is no longer an automatic computed link between the two.

`compute.requireOsLogin` is deliberately absent from the folder defaults until `Services_GCP`'s NFS/Redis VM is updated to support OS Login (it currently uses IAP-SSH + key metadata instead of OS Login).

---

## Quota Overrides

`quotas.tf` uses the modern **Cloud Quotas API** (`google_cloud_quotas_quota_preference`) — the older Service Usage consumer-quota-override resource no longer exists in the current `hashicorp/google` provider (`tofu validate` rejects it outright). A quota is identified by a human-readable `quota_id` per service (e.g. `"CpuAllocPerProjectRegion"`), not a metric/unit/limit triple.

Replace line 91 with:

"Seven self-imposed caps ship as live **sandbox** defaults — Cloud Run regional CPU, Compute Engine regional CPU, project-wide GPUs, Redis regional memory, and three Filestore tiers (standard, premium, high-scale SSD) — each sized from this catalog's own proven-working ceiling rather than a guess. A further **81 Vertex AI accelerator caps are pinned to `0` and merged into every tier** (`local.vertex_accelerator_overrides`), because Vertex bills against its own accelerator quota family rather than Compute Engine's `GPUS-ALL-REGIONS-per-project`. The `development` tier raises several values (Cloud Run 16000→32000 milli-vCPU, Compute 24→48 vCPU, Redis 16→32 GB) and adds a BigQuery `QueryUsagePerDay` cap of `1048576` MiBy (1 TiB/day); `production` inherits development's map wholesale (`local.production_quota_overrides = local.development_quota_overrides`, quotas.tf:428)."

Also: (a) line 22's `quotas.tf` row currently reads "(Cloud Run regional CPU, Compute Engine regional CPU, project-wide GPUs)" — extend to "(Cloud Run regional CPU, Compute Engine regional CPU, project-wide GPUs, Redis regional memory, three Filestore tiers, a BigQuery daily-scan cap on development/production, and 81 Vertex AI accelerator quotas)"; (b) line 178's `additional_quota_overrides` description "Adds quota overrides beyond the three defaults" must lose "three"; (c) the table at lines 107-111 lists only 3 of the 7 rows.

Replace "Every cap is applied with `dimensions = {}` ..." with:

"**Most** caps are applied with `dimensions = {}`, making them the project-wide default for that quota **across all regions** rather than only in `var.region`. The one exception is `compute_cpus_per_region`: the Cloud Quotas API *requires* the region dimension on `CPUS-per-project-region` (confirmed live 2026-08-11 — an empty map fails with `Dimension values must be set for all the dimensions ... defined for the quota`, Error 400), so that single cap is set with `{ region = var.region }` and therefore binds in `var.region` only. Every other region falls back to GCP's untuned Compute CPU default; closing that properly needs one preference per region or a `gcp.resourceLocations` policy, which is a product decision rather than a code fix. The five other regional quotas still carry `{}` because they exist and update cleanly today — `quotas info describe` reports `dimensions=[region]` for each, so a genuinely fresh project will likely hit the same error on them."

Keep the surrounding paragraphs (the 2026-08-06 history and the `lifecycle { ignore_changes = [dimensions] }` explanation at lines 101-105) as-is — both are still accurate. It was
previously scoped to `var.region`, which was safe only while
`constraints/gcp.resourceLocations` pinned every sandbox project to
`us-central1`. That policy was removed on 2026-08-06 so users could escape
regional resource exhaustion, which left the caps binding in one region and
every other region on GCP's untuned defaults (250–10,000 vCPU).

`dimensions` is under `lifecycle { ignore_changes }`. A quota preference's
**location is fixed when it is created** — an empty map creates it at `global`,
a region dimension creates it at that region — and the Cloud Quotas API has no
way to move one. Without the exemption, a project created before that change
would plan a diff Terraform can never apply.

| Key | Service | `quota_id` | Default | Rationale |
|---|---|---|---|---|
| `cloud_run_cpu_allocation` | `run.googleapis.com` | `CpuAllocPerProjectRegion` | `16000` milli-vCPU (= 16 real vCPU), all regions | Matches this catalog's own proven-working Cloud Run regional CPU ceiling. **The unit is milli-vCPU, not vCPU** — a literal `16` is 0.016 vCPU and silently fails every real Cloud Run deploy with `Quota violated: CpuAllocPerProjectRegion requested: 3000 allowed: 16` (unit bug fixed 2026-07-31, confirmed live on gcp-rad-fce0738a). `compute_cpus_per_region` below is *not* affected — `compute.googleapis.com/cpus` is denominated in whole vCPU. The `development` and `production` tiers raise this to `32000`. |
| `compute_cpus_per_region` | `compute.googleapis.com` | `CPUS-per-project-region` | `24` — **`var.region` only** (this quota requires its region dimension); `48` on development/production | Bounds Compute Engine VM cost, including GKE Autopilot node capacity, which draws from this same regional CPU pool. Unlike every other cap here it cannot use `dimensions = {}` — the Cloud Quotas API rejects a preference on this quota with empty dimensions (Error 400) — so the cap binds only in `var.region`. |
| `compute_gpus_all_regions` | `compute.googleapis.com` | `GPUS-ALL-REGIONS-per-project` | `0` | No baseline module (`Services_GCP`/`App_CloudRun`/`App_GKE`) uses GPUs — a nonzero default would be pure abuse surface with no corresponding legitimate use |

Override an existing default's *value* with `quota_value_overrides` (keyed by the same short name, e.g. `{ cloud_run_cpu_allocation = 32 }`), or add an entirely new quota cap with `additional_quota_overrides`. Before adding a new entry:

1. Look up the real `quota_id` for the target service/project — the `google_cloud_quotas_quota_infos` data source, or `gcloud beta quotas info list --service=<api> --project=<id>`. Do not hand-type one from memory or carry over an old Service Usage metric name.
2. Confirm whether the target value needs `ignore_safety_checks` set (a cap below current default/usage may require it — see the resource's own documentation for the valid enum values).
3. Size the value deliberately *below* the shared org ceiling — many concurrent sandbox projects likely share one org-level quota pool, so a self-imposed cap fails fast and cheap in one sandbox instead of starving others.

---

## Optional Project Creation

Gated on `create_project`, which defaults to **`true`** — the module creates the project by default. Set it to `false` to bring a pre-existing project instead. When enabled:

- **`google_project.tier_project`** creates the project under `folder_id`, linked to `billing_account_id`.

(The old `google_project.sandbox` address survives only as the `from =` side of the `moved` block in `modules/Project_GCP/moved.tf:21`; no resource of that name exists.) `deletion_policy = "DELETE"` so a genuinely intended `tofu destroy` can complete — the provider otherwise defaults to `PREVENT` and blocks the destroy outright even after the lien (below) has already been removed.
- **`deploying_identity_bundle`** grants `deploying_identity_email` a least-privilege role set — `roles/editor`, `roles/resourcemanager.projectIamAdmin`, `roles/iam.serviceAccountAdmin`, `roles/servicenetworking.networksAdmin`, `roles/pubsub.admin`, `roles/run.admin` — assembled from four independently confirmed gaps in `roles/editor` alone (`setIamPolicy`/`getIamPolicy` is structurally excluded from Editor on nearly every resource type it otherwise fully manages: project IAM, Private Service Access peering, Pub/Sub topic IAM, Cloud Run service IAM). **Not yet validated against the full ~150-application-module catalog** — treat it as a candidate pending a real `/deploy-group-test`-style campaign, not a guaranteed-sufficient bundle.
- **`end_user_access_bundle`** grants `deployed_by_email` a **tier-dependent** role set (`local.end_user_roles`, `project.tf`). All three tiers get the read-only base (`roles/browser` plus `logging`/`monitoring`/`run`/`container`/`cloudsql`/`compute`.viewer and `storage.objectViewer`). **`development`** additionally gets a build-and-deploy set (`run.developer`, `container.developer`, `cloudsql.client`, `storage.objectAdmin`, `secretmanager.secretAccessor`, `secretmanager.secretVersionAdder`, `artifactregistry.writer`, `monitoring.editor`, `errorreporting.user`, `cloudtrace.user`), so a development end user genuinely can create and update resources; it also gets a purpose-built, permissionless `rad-app-runtime` service account (`google_service_account.app_runtime`, created only on this tier) that the user holds `roles/iam.serviceAccountUser` on. **`production`** is deliberately *tighter* than development — it adds only `monitoring.editor`, `errorreporting.viewer` and `cloudtrace.user` (operate, not reconfigure). No tier ever receives `roles/owner`, `roles/cloudquotas.admin`, `roles/orgpolicy.policyAdmin`, or project-scoped `roles/iam.serviceAccountUser`.

The same correction is needed at doc line 43 (Two Identities table, "Deployed-by (human)" row): replace "Receives a strictly read-only role bundle so they can see what was deployed for them without being able to create, modify, or delete anything themselves." with "Receives a tier-dependent role bundle: read-only in `sandbox`, read-only plus operator roles in `production`, and read-only plus build-and-deploy roles in `development`."
- **`google_iam_deny_policy.deny_deploying_identity_quota_write`** blocks `deploying_identity_email` from raising its own quota caps back up. `roles/editor` does *not* exclude quota-write the way it excludes `setIamPolicy` — quota-write is baked into the Editor primitive itself — so no combination of predefined roles closes this gap; a Deny Policy is required. Denies both the modern (`cloudquotas.googleapis.com/quotas.update`) and legacy (`serviceusage.googleapis.com/quotas.update`) write permissions for defense-in-depth.
- **`google_resource_manager_lien.prevent_deletion`** is a real, structural block on `resourcemanager.projects.delete`, independent of IAM role — holds even if `deploying_identity_email`'s grant is ever mistakenly widened toward Owner (which includes `resourcemanager.projects.delete`).

`validation.tf`'s `create_project_requires_billing_and_deploying_identity` check rejects `create_project = true` at plan time unless `billing_account_id`, `deploying_identity_email`, and `deployed_by_email` are all set — so a misconfigured attempt fails fast rather than partially creating a project with no deploying identity able to operate it.

> **Sandbox project lifecycle: fresh-create only, never recycle.** This platform is not training-only — some users deploy real, non-reproducible work into these sandbox projects, so a project can hold real user data. Do not destroy-and-reuse a project ID for a new user. GCP's own soft-delete (30-day window) is retained as a safety net, but is **not** a fast-recycle mechanism — a restored project is unusable for up to 36 hours/3 days, so it cannot back a "return this project to a pool for the next user" flow. Real teardown means a deliberate `projects.delete`, not a routine `tofu destroy`-and-reprovision cycle.

---

## Per-Project Billing Budget

`budget.tf` creates a `google_billing_budget` scoped to the project this module created, so a spend alert names one user's sandbox. It is created only when **all three** of `create_project = true`, `enable_project_budget = true`, and a non-empty `billing_account_id` hold.

**This is not a spend cap.** A GCP budget only *notifies* — it never blocks an API call or detaches billing. Enforcement stays with the platform's own `credit_billing_guard` (15-minute poll, disables billing on arrears) and `credit_project` (hourly metering against the BigQuery billing export). What the budget adds is *speed*: both of those inherit the billing export's multi-hour latency, whereas budget thresholds fire off Google's near-real-time spend tracking, making this the fastest available signal that a specific sandbox is running away.

It exists per-project because the platform-side budget is scoped to the whole **billing account** and cannot be narrowed there — this module mints a fresh project ID per user at deploy time, so no static project list exists on the platform side at `tofu apply` time. Inside the module that creates the project, the ID *is* known.

Four threshold rules fire: at **50%**, **90%** and **100%** of actual spend, plus once when Google *forecasts* the month will end over budget (typically days before the actual-spend rule). Credits and promotions are excluded (`EXCLUDE_ALL_CREDITS`) so the threshold tracks real chargeable spend. Notifications go to billing-account admins and users, **deliberately not to the end user** — they hold read-only IAM on their sandbox and can do nothing about an overrun, and the spend lands on the platform's account rather than theirs.

| Variable | Default | Description |
|---|---|---|
| `enable_project_budget` | `true` | Creates the per-project budget. Has no effect unless `create_project = true` and `billing_account_id` is set. |
| `project_budget_amount` | `150` | Monthly budget in whole currency units, sized against a typical single-user stack. |
| `project_budget_currency` | `"USD"` | Must match the billing account's own currency, or the budget is rejected. |
| `project_budget_pubsub_topic` | `""` | Optional Pub/Sub topic for programmatic notifications, as `projects/<project>/topics/<topic>`. Empty means email-only alerts to billing-account admins. Wiring this to an automated responder is the fastest possible reaction path. |

---

## Configuration Variables

Group 0 (module metadata — `module_description`, `module_dependency`, `credit_cost`, `public_access`, `shared_users`, etc.) mirrors every other module's mandatory metadata block and is not reproduced here; see `CLAUDE.md`'s "Group 0 metadata variables are mandatory" convention. Three of the meaningful configuration knobs live in Group 0 rather than a dedicated group, since they're closer to admin/API-surface settings than per-deployment project config:

| Variable | Default | Description |
|---|---|---|
| `additional_apis` | `[]` | Additional Google Cloud APIs to enable beyond the built-in baseline. Also added to the API allowlist automatically. |
| `resource_creator_identity` | `""` | Service account to impersonate for all API calls this module makes. Leave blank to use the caller's own credentials. The caller must already hold `roles/iam.serviceAccountTokenCreator` on this identity. |
| `enable_services` | `true` | Present for cross-module UI consistency with `Services_GCP`'s own toggle of the same name. **Deliberately not wired to anything** — this module's API allowlist (`apis.tf`) is always enforced regardless of this value; there is no supported way to skip it. |

### Project Configuration

| Variable | Default | Description |
|---|---|---|
| `project_id` | *(required)* | When `create_project = true`, the ID of the new project to create (6–30 chars, lowercase letters/digits/hyphens, starting with a letter); otherwise an existing project ID. |
| `create_project` | `true` | Creates `project_id` as a new GCP project. When `false`, the caller brings a pre-existing project and grants `deploying_identity_email` access to it themselves — this module never touches that path. |
| `billing_account_id` | `""` | Billing account to link the new project to. Required when `create_project = true` (enforced at plan time). |
| `deploying_identity_email` | `""` | Service account that will deploy modules into the new project once it's created. Required when `create_project = true`. Receives the least-privilege bundle described above, never Owner. |
| `deployed_by_email` | `""` | Email of the human who requested the deployment. Required when `create_project = true`. Must be a real Google identity (Workspace/Gmail account) — an IAM grant to an email with no corresponding Google identity is accepted by the API but grants no real access until one exists. |
| `folder_id` | `"1024894257024"` | Numeric ID of the GCP folder that holds **this tier's** projects — `rad-sandbox`, `rad-development` or `rad-production`, selected by `var.tier` and injected by the platform — used only to place a created project (`google_project.tier_project`). Not user-facing (no UIMeta tag) — an admin/platform decision, not a per-deployment override. The default is the dedicated `rad-sandbox` folder, with all ten of `02-setup-ui.sh`'s folder-level guardrails already applied; the three tier folders deliberately carry different org policy sets. |
| `region` | `"us-central1"` | Scopes the one quota cap that cannot be applied project-wide: `compute_cpus_per_region` (`CPUS-per-project-region`) requires its region dimension, so `quotas.tf` sets it with `{ region = var.region }` while every other cap uses `dimensions = {}` (all regions). Not user-facing (no UIMeta tag) — a platform/admin decision about where sandbox compute lands, matching every other module's `region` default. |

(The claim "no resource reads this value" is now false: `google_cloud_quotas_quota_preference.guardrails` reads it through `local.default_quota_overrides.compute_cpus_per_region.dimensions`.)
| `quota_value_overrides` | `{}` | Overrides the numeric value of a default quota override, keyed by the same name (e.g. `{ cloud_run_cpu_allocation = 32 }`). |
| `additional_quota_overrides` | `{}` | Adds quota overrides beyond the three defaults, keyed by a short name. See "Quota Overrides" above before adding an entry. |

---

## Outputs

| Output | Description |
|---|---|
| `enabled_apis` | The full set of APIs enabled (and allowlisted) on `project_id` by this invocation. |
| `quota_overrides_applied` | Quota overrides applied to `project_id`, keyed by the same short names as `default_quota_overrides` / `additional_quota_overrides`. |
| `created_project_id` | The project ID this invocation created, or `null` if `create_project` was `false` (project assumed pre-existing). |
| `deploying_identity_bundle_roles` | The exact roles granted to `deploying_identity_email` when `create_project = true` — the candidate least-privilege bundle, pending full-catalog validation. |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `create_project` + `billing_account_id`/`deploying_identity_email`/`deployed_by_email` | Set all three together, or leave `create_project = false` | **High** 🛡 plan-time | `create_project = true` with any of the three companion variables empty is rejected at plan time (`create_project_requires_billing_and_deploying_identity`) rather than partially creating a project with no deploying identity able to operate it. |
| `folder_id` | The pre-configured sandbox folder (default) | **Critical** | A project placed in a folder that hasn't had `02-setup-ui.sh` step 10 run against it inherits **no** folder-level org policy guardrails (external-IP denial, SA key restrictions, the API allowlist) — the project is created but effectively unguarded at the org-policy layer, and this module cannot detect or warn about that from inside a single project's state. |
| `additional_apis` | Add only what a specific integration needs | **Medium** | Every API this module enables is also implicitly trusted to already be in the folder's `gcp.restrictServiceUsage` allowlist — an API added here but missing from that allowlist fails to enable outright; an API added to both becomes a standing, permanent part of the project's attack surface. |
| `quota_value_overrides` / `additional_quota_overrides` | Keep new caps below the shared org ceiling | **Medium** | A cap set at or above the org's own shared pool provides no real guardrail — the point of a self-imposed cap is to fail fast and cheap in *this* sandbox before starving every other concurrent sandbox project sharing the same org-level quota pool. |
| `deploying_identity_bundle` (fixed role set, not itself a variable) | — | **Low** | Not yet validated against the full ~150-application-module catalog — a deploy that needs a permission outside the six roles in the bundle fails with a clear IAM `PERMISSION_DENIED`, not silently. Treat it as a candidate pending a real `/deploy-group-test` campaign, not a guaranteed-sufficient bundle. |
| Destroying and reusing a `project_id` for a new user | Never — fresh-create only | **Critical** | This platform is not training-only; a project can hold real, non-reproducible user data. GCP's soft-delete is a 30-day safety net, not a fast-recycle mechanism (restore takes up to 36 hours/3 days) — it cannot back a "return this project to a pool" flow. |
