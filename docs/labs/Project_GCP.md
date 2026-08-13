---
title: "Project GCP \u2014 Lab Guide"
description: "Hands-on lab: deploy the Project GCP Tier-0 guardrails module — API allowlists, quota ceilings, and optional sandbox project creation, applied before Services GCP."
---

# Project GCP — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Project_GCP)**

## Overview

**Estimated time:** 20–35 minutes (add ~10 minutes if exercising the optional project-creation path)

`Project GCP` is the **Tier-0 guardrails module** — the only module in this catalog applied *before* `Services GCP`. It doesn't provision application infrastructure; it hardens the project itself: an allowlist of which Google Cloud APIs may be enabled, a set of self-imposed quota ceilings, and — optionally — creation of the sandbox project itself along with a least-privilege deploying identity to operate inside it.

> **Audience: platform admins, not trainees.** Unlike every other lab in this catalog, this module is designed to be run by an identity with *organization or folder*-level IAM — a materially higher trust tier than the project-scoped identity every other module assumes. It is not meant to be reachable from the same pipeline or user action that deploys applications. If you are working through this lab as a trainee exercise rather than as a platform operator, read it for understanding rather than expecting to run every phase yourself — Phase 1's Path B (project creation) in particular requires organization-level roles most trainees will not hold.

This lab focuses on operating **`Project GCP` and the guardrails it establishes**, not on anything downstream. For the complete variable reference and the full rationale behind the two-identity design, the additive-floor API allowlist, and the Cloud Quotas API usage, see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Project_GCP) — this lab deliberately does not duplicate that detail so it stays accurate over time.

> **Folder-level organization policies are not deployed by this module.** They are applied once per folder via `rad-automation/scripts/02-setup-ui.sh` (step 10), decoupled from any individual sandbox project's Terraform lifecycle. This lab's Phase 5 verifies those inherited policies but does not deploy them — if you are running this lab against a folder that has never had that script's step 10 run, skip Phase 5's *pass* expectations and treat any policy check there as informational only.

### What the Module Automates

- Enables a hardcoded floor of ~35 Google Cloud APIs on `project_id`, plus anything in `additional_apis` (additive-only — nothing in this module can shrink the floor)
- Applies self-imposed quota ceilings via the Cloud Quotas API, selected by `tier` — Cloud Run regional CPU, Compute Engine regional CPU, project-wide GPUs, Memorystore capacity, three Filestore tiers, and all 81 Vertex AI accelerator quotas (GPUs, TPUs and accelerators capped to zero by default)
- Validates `create_project`'s companion variables at **plan time** — an incomplete project-creation request is rejected before anything is created
- *(Optional, `create_project = true`)* Creates the sandbox project, grants a least-privilege role bundle to a separate deploying identity, grants a strictly read-only bundle to the human who requested it, denies the deploying identity permission to raise its own quota caps, and places a deletion lien

### What You Do Manually

- Configure variables and choose Path A (govern an existing project) or Path B (create + govern a new project)
- Confirm the enabled/allowlisted APIs match what you configured
- Confirm the quota preferences were applied
- *(Path B only)* Confirm the new project, its IAM bundles, its quota-write deny policy, and its deletion lien
- Confirm the target folder's inherited org policies (informational — not deployed by this module)

---

## CLI and REST API Overview

```bash
# Set these variables at the start of each session
export PROJECT="your-gcp-project-id"     # the project this module governs (existing, or the one it will create)
export FOLDER="1024894257024"             # the folder ID you deployed with (default shown)
export REGION="us-central1"               # the region your quota guardrails are scoped to
export TOKEN=$(gcloud auth print-access-token)
```

---

## Prerequisites

| Requirement | Detail |
|---|---|
| Elevated deploying identity | The identity running this module needs org/folder-level `orgpolicy.policyAdmin`/`iam.denyAdmin`-class roles bound at the **organization** level (GCP rejects both at folder scope), plus `serviceusage.serviceUsageAdmin`-class permissions to write the API allowlist and quota preferences. In this platform's own deployment this is `rad-guardrails-admin`, impersonation-only, never wired to a Cloud Build trigger. |
| Folder already guardrail-configured | `rad-automation/scripts/02-setup-ui.sh` step 10 should already have been run once against the target folder — otherwise a newly created project inherits no folder-level org policies (see the Configuration Guide's "Folder-Level Org Policies" section). |
| Billing account access (Path B only) | Required to link a newly created project to `billing_account_id`. |
| `gcloud` CLI | Authenticated (`gcloud auth login`). |
| An existing project (Path A) *or* nothing yet (Path B) | Path A governs a project that already exists; Path B has this module create it. |

`Project GCP` is a standalone module with no runtime dependency on any other RAD module — it is applied *before* `Services GCP`, not alongside or after it.

---

## Phase 1 — Deploy Guardrails [AUTOMATED]

### Step 1.1 — Choose Your Lab Path

**Path A — Govern an Existing Project (fastest, ~10–15 min).** You already have a GCP project (with billing enabled) that some other identity will deploy `Services GCP`/application modules into. `Project GCP` only sets the API allowlist and quota ceilings on it.

```hcl
project_id       = "<your-existing-project-id>"
create_project   = false
folder_id        = "1024894257024"   # only relevant if you also want org-policy inheritance verified in Phase 5
region           = "us-central1"
```

**Path B — Create + Govern a New Sandbox Project (~20–35 min).** `Project GCP` creates the project itself, places it in `folder_id`, and provisions the full two-identity separation.

```hcl
project_id                = "<new-project-id>"        # 6-30 chars, lowercase letters/digits/hyphens, starts with a letter
create_project             = true
billing_account_id         = "<your-billing-account-id>"
deploying_identity_email   = "<sa-that-will-run-Services_GCP-etc>@<host-project>.iam.gserviceaccount.com"
deployed_by_email           = "<you>@example.com"
folder_id                   = "1024894257024"
region                       = "us-central1"
```

> Path B is rejected at plan time if `billing_account_id`, `deploying_identity_email`, or `deployed_by_email` is left empty while `create_project = true` — you cannot partially create a project with no deploying identity able to operate it.

Both paths accept `additional_apis` (list of extra `*.googleapis.com` strings) and `quota_value_overrides`/`additional_quota_overrides` (see the Configuration Guide) if a specific downstream lab needs something beyond the defaults.

### Step 1.2 — Initiate Deployment

Deployment is initiated the same way as any other module — from the RAD platform (impersonating the elevated identity described in Prerequisites) or directly via `tofu apply` from the module directory for a manual/admin run.

**Expected resource provisioning times:**

| Phase | Typical duration |
|---|---|
| API enablement (~35 APIs, no propagation wait built into this module) | 2–4 min |
| Quota preference apply (7 capacity caps + 81 Vertex AI accelerator caps, Cloud Quotas API) | 1–3 min |
| Project creation (Path B only) | 1–2 min |
| IAM bundle grants + deny policy + lien (Path B only) | 1–2 min |
| **Total (Path A)** | **5–10 min** |
| **Total (Path B)** | **10–20 min** |

### Step 1.3 — Record Outputs

| Output | Description |
|---|---|
| `enabled_apis` | The full set of APIs enabled (and allowlisted) on `project_id`. |
| `quota_overrides_applied` | Quota overrides actually applied, keyed by short name. |
| `created_project_id` | The project ID this invocation created, or `null` on Path A. |
| `deploying_identity_bundle_roles` | The exact roles granted to `deploying_identity_email` (Path B only). |

```bash
export PROJECT="your-gcp-project-id"
export TOKEN=$(gcloud auth print-access-token)
```

---

## Phase 2 — Verify the API Allowlist [MANUAL]

### Step 2.1 — Confirm Enabled APIs

```bash
gcloud services list --enabled --project=${PROJECT} \
  --format="table(config.name)" | sort
```

**Expected result:** All ~35 baseline APIs from the Configuration Guide's "The Additive-Floor API Allowlist" section are present, plus anything you supplied in `additional_apis`. Spot-check a few of the less obvious ones:

```bash
gcloud services list --enabled --project=${PROJECT} \
  --filter="config.name:(binaryauthorization.googleapis.com OR gkebackup.googleapis.com OR alloydb.googleapis.com)" \
  --format="table(config.name)"
```

> **REST API equivalent:**
> ```bash
> curl -s -H "Authorization: Bearer ${TOKEN}" \
>   "https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services?filter=state:ENABLED" \
>   | jq -r '.services[].config.name' | sort
> ```

### Step 2.2 — Confirm the Floor Cannot Be Bypassed

Re-plan the module without changing anything — a clean, empty plan confirms the `api_floor_never_shrinks` check passed and no baseline API was accidentally dropped from `effective_enabled_apis`:

```bash
tofu plan -detailed-exitcode
# exit code 0 = no changes; 2 = changes pending; 1 = error
```

---

## Phase 3 — Verify Quota Guardrails [MANUAL]

### Step 3.1 — List Applied Quota Preferences

```bash
gcloud beta quotas preferences list \
  --project=${PROJECT} \
  --billing-project=${PROJECT} \
  --format="table(name,service,quotaId,quotaConfig.preferredValue,reconciling)"
```

**Expected result (default `tier = sandbox`):** 88 preferences are listed — seven capacity caps (`run.googleapis.com/CpuAllocPerProjectRegion` = `16000` **milli**-vCPU, i.e. 16 vCPU; `compute.googleapis.com/CPUS-per-project-region` = `24`; `compute.googleapis.com/GPUS-ALL-REGIONS-per-project` = `0`; `redis.googleapis.com/TotalCapacityPerProjectPerRegion` = `16`; and three `file.googleapis.com` Filestore tiers) plus 81 `aiplatform.googleapis.com` Vertex AI accelerator quotas all capped to `0`. `tier = development` swaps in higher values and adds a BigQuery `QueryUsagePerDay` cap; `tier = production` applies no capacity caps. — or your overridden values if you set `quota_value_overrides`. `reconciling: true` means GCP is still applying the requested cap; re-check after a few minutes.

### Step 3.2 — Describe a Specific Preference

```bash
gcloud beta quotas preferences describe \
  "projects/${PROJECT}/locations/global/services/run.googleapis.com/quotaPreferences/<preference-id>" \
  --format="yaml(quotaConfig,justification,dimensions)"
```

(Substitute `<preference-id>` from the `name` field in Step 3.1's output.)

**Expected result:** `justification` reads the "Sandbox guardrail: ..." text from `quotas.tf`, and `dimensions` is **empty** for the `run.googleapis.com` preference this step describes. Only `compute.googleapis.com/CPUS-per-project-region` still carries `dimensions = { region = var.region }` (quotas.tf:255 — that quota rejects empty dimensions); every other cap, including the Vertex AI accelerator set, uses `dimensions = {}` (all regions).

### Step 3.3 — Confirm the Cap Is Actually Effective

The most convincing verification is indirect: deploy (or attempt to deploy) something that would exceed the cap and confirm it's rejected with a quota error naming the same `quota_id`, rather than assuming the preference "took" from the API response alone. This is optional for the lab but worth doing once if you're validating a non-default override.

---

## Phase 4 — Verify Project Creation & Identity Separation [MANUAL, Path B only]

Skip this phase entirely if you deployed Path A (`create_project = false`).

### Step 4.1 — Confirm the Project

```bash
gcloud projects describe ${PROJECT} \
  --format="yaml(projectId,name,parent,lifecycleState)"
```

**Expected result:** `parent.id` matches `folder_id`, `lifecycleState` is `ACTIVE`.

### Step 4.2 — Confirm the Deploying Identity's Bundle

```bash
gcloud projects get-iam-policy ${PROJECT} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:<deploying_identity_email>" \
  --format="table(bindings.role)"
```

**Expected result:** Exactly six roles — `roles/editor`, `roles/resourcemanager.projectIamAdmin`, `roles/iam.serviceAccountAdmin`, `roles/servicenetworking.networksAdmin`, `roles/pubsub.admin`, `roles/run.admin` — and **not** `roles/owner`.

### Step 4.3 — Confirm the End User's Read-Only Bundle

```bash
gcloud projects get-iam-policy ${PROJECT} \
  --flatten="bindings[].members" \
  --filter="bindings.members:user:<deployed_by_email>" \
  --format="table(bindings.role)"
```

**Expected result:** Only `*.viewer`/`roles/browser`-class roles — `roles/browser`, `roles/logging.viewer`, `roles/monitoring.viewer`, `roles/run.viewer`, `roles/container.viewer`, `roles/cloudsql.viewer`, `roles/compute.viewer`, `roles/storage.objectViewer`. No create/update/delete permission on anything.

### Step 4.4 — Confirm the Quota-Write Deny Policy

```bash
gcloud iam deny-policies describe deny-deploying-identity-quota-write \
  --project=${PROJECT} \
  --format="yaml(rules)"
```

**Expected result:** `deniedPrincipals` names the deploying identity (in `principal://iam.googleapis.com/projects/-/serviceAccounts/...` format, not the standard `serviceAccount:` prefix), and `deniedPermissions` includes both `cloudquotas.googleapis.com/quotas.update` and `serviceusage.googleapis.com/quotas.update`.

### Step 4.5 — Confirm the Deletion Lien

```bash
gcloud alpha resource-manager liens list --project=${PROJECT} \
  --format="table(name,origin,reason,restrictions)"
```

**Expected result:** A lien with `origin: project_gcp` and `restrictions: [resourcemanager.projects.delete]`. Attempting `gcloud projects delete ${PROJECT}` at this point should fail until the lien is explicitly removed — the intended, deliberate friction.

---

## Phase 5 — Confirm Inherited Folder-Level Org Policies [MANUAL, informational]

This module does not create these policies — they come from `rad-automation/scripts/02-setup-ui.sh` step 10, applied once per folder. This phase confirms the target project actually inherited them; it is informational, not a pass/fail gate on `Project GCP` itself.

```bash
gcloud org-policies list --folder=${FOLDER} --format="table(constraint)"
```

```bash
gcloud org-policies describe gcp.restrictServiceUsage \
  --folder=${FOLDER} \
  --format="yaml(spec)"
```

**Expected result (if step 10 was run against this folder):** A policy listing an allowed-services set that is a superset of `baseline_required_apis` — every API `Project GCP` enables should also be present in this allowlist, or its own `google_project_service.enabled` resource would itself fail. If nothing is returned here, the folder has never had the guardrails script run against it — a real, actionable gap for a platform admin to close, not a bug in this module.

---

## Phase 6 — Troubleshoot & Debug [MANUAL]

- **`google_iam_deny_policy` / org-policy resources fail with `PERMISSION_DENIED`:** the deploying identity for *this module* (not the sandbox project's own deploying identity) lacks the required org-level roles (`orgpolicy.policyAdmin`, `iam.denyAdmin`) at the **organization** scope — both are rejected at folder scope (`INVALID_ARGUMENT`). Confirm which principal is actually running the apply and what it holds at the org level, not just the project level.
  ```bash
  gcloud organizations get-iam-policy <ORG_ID> \
    --flatten="bindings[].members" \
    --filter="bindings.members:<your-principal>" \
    --format="table(bindings.role)"
  ```
- **An API enables here but is unusable from an application deploy:** check whether it is present in the folder's `gcp.restrictServiceUsage` allowlist (Phase 5) — this module enabling an API is necessary but not sufficient if the folder-level allowlist hasn't been kept in sync.
- **`google_cloud_quotas_quota_preference` apply is slow or shows `reconciling: true` for a long time:** this is normal — Cloud Quotas API changes are asynchronous. Re-check with Step 3.1/3.2 after a few minutes rather than assuming a stuck apply.
- **A quota cap you set is rejected outright:** the target value may be below the service's current default or live usage — check whether `ignore_safety_checks` needs to be set on that entry (`additional_quota_overrides`), and consult the resource's own documentation for the valid enum values before retrying.
- **`create_project = true` fails immediately at plan time:** check that `billing_account_id`, `deploying_identity_email`, and `deployed_by_email` are all non-empty — the `create_project_requires_billing_and_deploying_identity` check rejects the combination otherwise, by design.
- **`tofu destroy` on a Path B deployment fails on the project resource:** the deletion lien (Phase 4.5) and the provider's own `deletion_policy = "DELETE"` guard are both deliberate friction against accidental deletion. Removing the lien is a separate, explicit step — see the Configuration Guide's "Sandbox project lifecycle" note before doing this on any project that might hold real user data.

---

## Phase 7 — Tear Down [MANUAL]

> **Read this before tearing down.** Per the platform's sandbox-project lifecycle design, a Path B project is meant to be **fresh-create only** — it is not meant to be destroyed and recreated under the same or a new `project_id` for a different user. Only tear down a Path B project if you are certain no real, non-reproducible user data was ever deployed into it (e.g. this was a lab/test run).

### Step 7.1 — Path A (Governed, Not Created)

Simply run `tofu destroy` (or delete the deployment from the RAD platform). This removes the `google_project_service` and `google_cloud_quotas_quota_preference` resources — API enablement is left in place by design (`disable_on_destroy = false` on `google_project_service.enabled`), since disabling APIs out from under a project that may still have other resources depending on them is far riskier than leaving them enabled.

### Step 7.2 — Path B (Created by This Module)

1. Undeploy everything downstream first (`Services GCP`, application modules) — this module's own destroy does not cascade into them, and they will break if their VPC/database/NFS disappears first.
2. Remove the deletion lien explicitly:
   ```bash
   gcloud alpha resource-manager liens delete <LIEN_ID> --project=${PROJECT}
   ```
   (Get `<LIEN_ID>` from Phase 4.5's `name` field.)
3. Run `tofu destroy`. With the lien removed and `deletion_policy = "DELETE"` already set, this deletes the project (subject to GCP's standard 30-day soft-delete window — see the Configuration Guide).

**Expected teardown time:** 2–5 minutes for the guardrail resources; project deletion itself is asynchronous and the project enters GCP's own soft-delete state rather than disappearing immediately.

---

## Summary

| Action | Phase | Automated |
|---|---|---|
| Choose Path A (existing project) or Path B (create + govern) and configure variables | 1.1 | Manual |
| Deploy the API allowlist, quota preferences, and (Path B) the project + IAM bundles | 1.2 | Automated |
| Record outputs | 1.3 | Manual |
| Verify enabled/allowlisted APIs | 2 | Manual |
| Verify applied quota preferences | 3 | Manual |
| Verify project creation, identity separation, deny policy, and lien (Path B) | 4 | Manual |
| Confirm inherited folder-level org policies (informational) | 5 | Manual |
| Troubleshoot common issues | 6 | Manual |
| Tear down (with lifecycle caution) | 7 | Manual |
