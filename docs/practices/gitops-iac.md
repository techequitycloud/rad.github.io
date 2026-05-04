---
id: gitops-iac
title: GitOps & IaC
---

# GitOps & Infrastructure as Code

Infrastructure is version-controlled, peer-reviewed, and deployed exclusively through pipelines — giving platform teams a reproducible, auditable, and self-service operating model. This document covers the IaC engine, GitOps mechanics, state management, drift detection, module versioning, and the developer experience built on top of these foundations.

## OpenTofu as the IaC engine

The platform standardises on **OpenTofu** — the OSS, community-governed Terraform fork:

- Open governance, MPL-2.0 licensed, no vendor lock to a commercial IaC product.
- Standard `tofu init / validate / plan / apply` workflow runs anywhere — Cloud Build, Cloud Shell, or a local workstation.
- Full Terraform provider ecosystem compatibility.

## State management

- **Per-deployment GCS state buckets** — `_DEPLOYMENT_BUCKET_ID` substitution gives each tenant and application its own state bucket, preventing cross-tenant blast radius and lock contention.
- **Versioning enforced** — state buckets use GCS object versioning. A bad apply rolls back to a prior generation. The `AGENTS.md` `/security` workflow mandates "GCS with versioning, not local".
- **No local state** — eliminates the laptop-as-single-point-of-failure anti-pattern.
- **State as inventory** — the `deployment_id` output and remote state give an inventory key that ties Terraform state to platform credit consumption. The `radlab.py list` action enumerates active deployments by reading state buckets directly.

## Reproducible deployments

- **Commit-pinned deploys** — Cloud Build persists `commit_hash.txt` and `repo_url.txt` per deployment so any prior production state is reconstructible.
- **Per-module repository support** — `_MODULE_GIT_REPO_URL` substitution lets applications live in their own repositories while sharing the same pipeline.
- **4-character deployment IDs** — every module has a `deployment_id` generated via `random_id` (or supplied by the user). The same ID identifies that deployment for `update`, `delete`, and cost attribution.

## Drift detection and re-assertion

- **Idempotent re-apply** — every module produces a no-op plan when state matches reality.
- **GCS KMS binding re-assertion** — `app_storage_wrapper` uses `data "external"` (not `null_resource`) so KMS binding drift is detected at plan time, not apply time.
- **GitHub App auto-approval** — `modules/App_Common/scripts/auto-approve-github-app.sh` keeps the GitHub installation in sync.

## Push-button rollback

- **Git revert + pipeline run** — infrastructure converges back to the prior state after reverting the offending commit and triggering the update pipeline.
- **Application-level rollback** — `gcloud run services update-traffic --to-revisions=...` for Cloud Run; `kubectl rollout undo` for GKE. See the disaster recovery capability documentation for backup/restore.

## State lock contention and recovery

GCS-backed state uses native object locking. When a lock is unexpectedly held (e.g. a pipeline crashed mid-apply):

1. **Identify the lock** — `tofu force-unlock` requires the lock ID, which appears in the error message. Alternatively: `gsutil cat gs://<DEPLOYMENT_BUCKET_ID>/<MODULE_NAME>/default.tflock`.
2. **Verify the holding process is dead** — check Cloud Build history for the build that acquired the lock. If the build has `FAILED` or `CANCELLED` status, the lock is stale.
3. **Release the lock** — `tofu force-unlock <LOCK_ID>` from within the module directory with the same backend configuration as the pipeline. Only the deployment owner or a platform engineer should do this.
4. **Inspect state before re-applying** — run `tofu plan` and review the diff carefully before re-running `apply`. A crashed mid-apply may have partially created resources.

Never delete the lock file directly — this corrupts the state metadata.

## Developer self-service

### One command to a running environment

```bash
cd modules/Istio_GKE
tofu init
tofu apply -var="existing_project_id=my-gcp-project"
```

A single apply provisions a GKE cluster, VPC with private nodes, Cloud NAT, an Istio control plane, the full observability stack, and optionally the Bookinfo sample. There is no separate "configure the mesh" step.

### Launcher CLI

`rad-launcher/radlab.py` walks through project / module / action / bucket selection interactively, and accepts a non-interactive command-line form for external CI integration:

```bash
# Create
python3 radlab.py -m AKS_GKE -a create -p my-mgmt-project \
  -b my-mgmt-project-radlab-tfstate -f /path/to/my.tfvars

# Update (e.g., scale node count)
python3 radlab.py -m Istio_GKE -a update -p my-mgmt-project \
  -b my-mgmt-project-radlab-tfstate -f /path/to/my.tfvars

# List all active deployments by scanning state buckets
python3 radlab.py -m Istio_GKE -a list -p my-mgmt-project \
  -b my-mgmt-project-radlab-tfstate
```

`rad-launcher/installer_prereq.py` installs OpenTofu, the Cloud SDK, `kubectl`, and Python dependencies in a single shot, auto-detecting Cloud Shell to skip what is already available.

### Scaffolding new modules

`scripts/create_modules.sh` scaffolds a new CloudRun + GKE + Common triple in one command. Adding a new module is `cp -a modules/Istio_GKE modules/MyNewModule` and editing the domain-specific `.tf` files.

### Standard outputs

Every module exposes the same outputs:

```hcl
output "deployment_id"
output "project_id"
output "cluster_credentials_cmd"   # copy-pastable gcloud command
output "external_ip"               # LoadBalancer IP, with fileexists() fallback
```

`cluster_credentials_cmd` delivers a one-line `gcloud` command that attaches `kubectl` to the cluster — the highest-impact output for day-one onboarding.

### On-demand tooling

`modules/Istio_GKE/istiosidecar.tf` installs `kubectl` and `istioctl` into `$HOME/.local/bin` if missing, so apply succeeds on a fresh workstation without a separate setup step.

## Hands-on labs

`scripts/gcp-istio-traffic/`, `scripts/gcp-istio-security/`, `scripts/gcp-cr-mesh/`, and `scripts/gcp-m2c-vm/` are interactive bash scripts with **preview / create / delete** modes for hands-on learning.

## Secret hygiene in IaC

GitHub PAT and similar high-value secrets must never be serialised into `terraform.tfstate`. The full mechanics — CSI driver mounting, credential-store cloning, pre-commit scanners — are canonical in [DevSecOps](./devsecops.md).

## Module versioning strategy

All modules use local relative paths (`source = "../App_CloudRun"`) within a single repository, giving atomic cross-module changes and eliminating version-skew between Foundation and Application modules. For consumers referencing modules from a separate repository:

- **Git tags as version markers** — stable releases are tagged `vMAJOR.MINOR.PATCH` on `main`. Pin to a tag: `source = "git::https://github.com/org/partner-modules.git//modules/App_CloudRun?ref=v1.2.0"`.
- **CHANGELOG.md** — maintained at the repo root; every tag entry notes breaking changes, new variables, and deprecated variables with migration instructions.
- **Semver contract** — PATCH: bug fixes, no variable changes. MINOR: new optional variables (backward-compatible). MAJOR: removed or renamed variables, output schema changes.

The platform catalog also has no separate versioning layer — consumers can pin to a Git commit SHA or branch when supplying `_MODULE_GIT_REPO_URL` to a Cloud Build pipeline.

## Provider version pinning

Provider upgrades are a common source of unexpected plan-time diffs:

- **`required_providers` block** — every module's `versions.tf` must pin the `google` and `google-beta` providers to a `~>` constraint locking the major version while allowing patch updates.
- **Lock file committed** — `terraform.lock.hcl` is committed to the repository. Dependabot or a monthly manual review updates the lock file; the update is a dedicated PR so provider diffs are isolated from feature changes.
- **OpenTofu version** — the custom Terraform image pins the OpenTofu binary version. Bump the image tag (not `latest`) when upgrading OpenTofu, and validate with `modules/Sample_CloudRun` + `modules/Sample_GKE` before rolling to production.

## IaC change approval workflow

The four-tier architecture means a change to Platform or Foundation modules has blast radius proportional to the number of Application Modules that consume it:

| Tier changed | PR reviewers required | Additional gate |
|---|---|---|
| Application (`<App>_CloudRun` / `<App>_GKE`) | 1 (app team) | None |
| Common (`<App>_Common`) | 1 (app team) | Confirm secrets and init-job outputs are unchanged |
| Foundation (`App_CloudRun` / `App_GKE`) | 2 (1 app team + 1 platform team) | Validate against `Sample_CloudRun` / `Sample_GKE` before merge |
| Platform (`Services_GCP`) | 2 (platform team) | Dry-run apply in non-production project; VPC-SC dry-run enabled |

Changes that add or remove variables in Foundation or Platform tiers trigger the propagation checklist documented in `CLAUDE.md` (variable mirroring, UIMeta tags, sync tooling).

## Documentation that explains *why*

Each module ships two markdown files:

- A short `README.md` for fast onboarding — usage, requirements, providers, resources, inputs, outputs.
- A long `<Module_Name>.md` covering architecture, networking, mesh trade-offs, and operational guidance — teaching material, not just reference.

`AGENTS.md` adds workflow modes that prime a new engineer or AI assistant with the right context for a specific module.

## Cross-references

- [IDP](./idp.md) — four-tier module pattern (the structural side of "infrastructure as code")
- [CI/CD](./cicd.md) — the pipeline that runs `tofu apply`, validation gates, integration tests
- [DevSecOps](./devsecops.md) — secret-out-of-state mechanics, state integrity
