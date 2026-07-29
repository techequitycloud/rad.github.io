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
gkebackup · firestore · alloydb
```

That's 35 APIs (each entry above maps to `<name>.googleapis.com`). Add anything an application-specific integration needs beyond this floor — e.g. `aiplatform.googleapis.com` for a Vertex AI-backed app — via `additional_apis`; it is automatically folded into both enablement and the allowlist output.

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

Three self-imposed caps ship as live defaults, each sized from this catalog's own proven-working ceiling rather than a guess:

| Key | Service | `quota_id` | Default | Rationale |
|---|---|---|---|---|
| `cloud_run_cpu_allocation` | `run.googleapis.com` | `CpuAllocPerProjectRegion` | `16` (in `var.region`) | Matches this catalog's own proven-working Cloud Run regional CPU ceiling — every baseline module has already been validated to run within it |
| `compute_cpus_per_region` | `compute.googleapis.com` | `CPUS-per-project-region` | `24` (in `var.region`) | Bounds Compute Engine VM cost, including GKE Autopilot node capacity, which draws from this same regional CPU pool |
| `compute_gpus_all_regions` | `compute.googleapis.com` | `GPUS-ALL-REGIONS-per-project` | `0` | No baseline module (`Services_GCP`/`App_CloudRun`/`App_GKE`) uses GPUs — a nonzero default would be pure abuse surface with no corresponding legitimate use |

Override an existing default's *value* with `quota_value_overrides` (keyed by the same short name, e.g. `{ cloud_run_cpu_allocation = 32 }`), or add an entirely new quota cap with `additional_quota_overrides`. Before adding a new entry:

1. Look up the real `quota_id` for the target service/project — the `google_cloud_quotas_quota_infos` data source, or `gcloud beta quotas info list --service=<api> --project=<id>`. Do not hand-type one from memory or carry over an old Service Usage metric name.
2. Confirm whether the target value needs `ignore_safety_checks` set (a cap below current default/usage may require it — see the resource's own documentation for the valid enum values).
3. Size the value deliberately *below* the shared org ceiling — many concurrent sandbox projects likely share one org-level quota pool, so a self-imposed cap fails fast and cheap in one sandbox instead of starving others.

---

## Optional Project Creation

Gated on `create_project = true` (default `false` — the module assumes an existing project by default). When enabled:

- **`google_project.sandbox`** creates the project under `folder_id`, linked to `billing_account_id`. `deletion_policy = "DELETE"` so a genuinely intended `tofu destroy` can complete — the provider otherwise defaults to `PREVENT` and blocks the destroy outright even after the lien (below) has already been removed.
- **`deploying_identity_bundle`** grants `deploying_identity_email` a least-privilege role set — `roles/editor`, `roles/resourcemanager.projectIamAdmin`, `roles/iam.serviceAccountAdmin`, `roles/servicenetworking.networksAdmin`, `roles/pubsub.admin`, `roles/run.admin` — assembled from four independently confirmed gaps in `roles/editor` alone (`setIamPolicy`/`getIamPolicy` is structurally excluded from Editor on nearly every resource type it otherwise fully manages: project IAM, Private Service Access peering, Pub/Sub topic IAM, Cloud Run service IAM). **Not yet validated against the full ~150-application-module catalog** — treat it as a candidate pending a real `/deploy-group-test`-style campaign, not a guaranteed-sufficient bundle.
- **`end_user_access_bundle`** grants `deployed_by_email` a strictly `*.viewer`/`roles/browser` bundle — enough to see logs, metrics, and running service status, never enough to create, update, or delete anything.
- **`google_iam_deny_policy.deny_deploying_identity_quota_write`** blocks `deploying_identity_email` from raising its own quota caps back up. `roles/editor` does *not* exclude quota-write the way it excludes `setIamPolicy` — quota-write is baked into the Editor primitive itself — so no combination of predefined roles closes this gap; a Deny Policy is required. Denies both the modern (`cloudquotas.googleapis.com/quotas.update`) and legacy (`serviceusage.googleapis.com/quotas.update`) write permissions for defense-in-depth.
- **`google_resource_manager_lien.prevent_deletion`** is a real, structural block on `resourcemanager.projects.delete`, independent of IAM role — holds even if `deploying_identity_email`'s grant is ever mistakenly widened toward Owner (which includes `resourcemanager.projects.delete`).

`validation.tf`'s `create_project_requires_billing_and_deploying_identity` check rejects `create_project = true` at plan time unless `billing_account_id`, `deploying_identity_email`, and `deployed_by_email` are all set — so a misconfigured attempt fails fast rather than partially creating a project with no deploying identity able to operate it.

> **Sandbox project lifecycle: fresh-create only, never recycle.** This platform is not training-only — some users deploy real, non-reproducible work into these sandbox projects, so a project can hold real user data. Do not destroy-and-reuse a project ID for a new user. GCP's own soft-delete (30-day window) is retained as a safety net, but is **not** a fast-recycle mechanism — a restored project is unusable for up to 36 hours/3 days, so it cannot back a "return this project to a pool for the next user" flow. Real teardown means a deliberate `projects.delete`, not a routine `tofu destroy`-and-reprovision cycle.

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
| `create_project` | `false` | Creates `project_id` as a new GCP project. When `false`, the caller brings a pre-existing project and grants `deploying_identity_email` access to it themselves — this module never touches that path. |
| `billing_account_id` | `""` | Billing account to link the new project to. Required when `create_project = true` (enforced at plan time). |
| `deploying_identity_email` | `""` | Service account that will deploy modules into the new project once it's created. Required when `create_project = true`. Receives the least-privilege bundle described above, never Owner. |
| `deployed_by_email` | `""` | Email of the human who requested the deployment. Required when `create_project = true`. Must be a real Google identity (Workspace/Gmail account) — an IAM grant to an email with no corresponding Google identity is accepted by the API but grants no real access until one exists. |
| `folder_id` | `"1024894257024"` | Numeric ID of the GCP folder that holds sandbox projects, used only to place a created project (`google_project.sandbox`). Not user-facing (no UIMeta tag) — an admin/platform decision, not a per-deployment override. Defaults to the dedicated "sandbox" folder with all ten of `02-setup-ui.sh`'s folder-level guardrails already applied. |
| `region` | `"us-central1"` | The region the default quota caps in `quotas.tf` apply to (Cloud Run `cpu_allocation`, Compute Engine CPUs — both region-dimensioned quotas). Not user-facing — matches every other module's `us-central1` default. |
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
