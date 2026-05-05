---
title: "Infrastructure as Code"
sidebar_label: "Infrastructure as Code"
---

# Infrastructure as Code

> **Scope.** Canonical home for the OpenTofu/Terraform module conventions, provider authentication patterns, UIMeta variable annotations, the deployment ID contract, destroy safety invariants, and validation gates. The Cloud Build pipeline mechanics that execute these modules are in [practices/cicd.md](../practices/cicd.md); per-deployment state isolation is in [practices/gitops_iac.md](../practices/gitops-iac.md).

Every module in this repo follows a set of shared conventions that make them behave predictably and compose safely. This page is the orientation map — understanding these conventions is the prerequisite for adding or modifying any module.

## OpenTofu, not Terraform

The repo standardises on OpenTofu (a drop-in replacement for Terraform) via the `rad-launcher`'s installer. Validation runs on:

```bash
tofu init && tofu validate && tofu fmt -check
```

(`SKILLS.md` §5). All module changes must pass these three checks before being considered ready to merge — see [Validation gates](#validation-gates) below.

## Module layout

Every module follows the same file structure:

```
modules/<Name>/
├── main.tf              # project bootstrap, API enablement, random_id
├── provider-auth.tf     # impersonation pattern (or provider.tf for attached clusters)
├── versions.tf          # required_providers + required_version
├── variables.tf         # UIMeta-annotated inputs
├── outputs.tf           # deployment_id, project_id, cluster_credentials_cmd, external_ip
├── network.tf           # VPC, subnet, firewall, Cloud Router + NAT
├── gke.tf               # cluster, node pool, cluster SA, IAM
├── <feature>.tf         # null_resource installing workloads (one file per feature)
├── manifests/           # raw YAML applied at deploy time
├── templates/           # Terraform-rendered YAML templates
├── README.md
└── <Module_Name>.md     # deep-dive walkthrough
```

(`SKILLS.md` §2). To scaffold a new module: `cp -a modules/Istio_GKE modules/MyNewModule` and edit the domain-specific files.

## Provider authentication patterns

Two patterns documented in `SKILLS.md` §3.2:

| Pattern | File | Used by | How it works |
|---|---|---|---|
| **Impersonation** | `provider-auth.tf` | `Istio_GKE`, `Bank_GKE`, `MC_Bank_GKE` | Provider mints a short-lived token for `var.resource_creator_identity`; falls back to ADC if unset |
| **Direct** | `provider.tf` | `AKS_GKE`, `EKS_GKE` | Configures `azurerm` / `aws` / `helm` providers directly without GCP impersonation wrapping |

## UIMeta annotations

Every variable description ends with `{{UIMeta group=N order=M [updatesafe] }}` (`SKILLS.md` §3.4). The platform UI reads these annotations to render a grouped, ordered deployment form — each group becomes a card in the deployment wizard.

| Group | Section shown in UI |
|---|---|
| 0 | Provider / Metadata |
| 1 | Main (project, region) |
| 2 | Network |
| 3 | Cluster |
| 4 | Features |
| 6 | Application |

`updatesafe` marks fields that are safe to edit on an in-place re-apply without triggering resource recreation.

## Standard outputs

Every GKE-based module exposes the same four outputs (`SKILLS.md` §3.5):

| Output | Content |
|---|---|
| `deployment_id` | 4-character hex ID used in all resource names |
| `project_id` | GCP project the module deployed into |
| `cluster_credentials_cmd` | Copy-pastable `gcloud` command to fetch kubeconfig |
| `external_ip` | Public IP of the module's ingress |

Downstream tools (the `rad-launcher` list action, Cloud Build pipelines) rely on this contract being stable across all modules.

## Deployment ID and random_id

Every module generates a 4-character hex `deployment_id` at first apply via `random_id.default` in `main.tf`, unless the caller supplies one explicitly via `var.deployment_id`. This ID is embedded in all resource names (cluster name, GCS bucket suffix, etc.) so multiple deployments can coexist in the same GCP project without name collision.

The same ID is required to `update` or `destroy` the deployment later — it is the key the `radlab.py list` action uses to enumerate active deployments by reading GCS state buckets.

## rad-launcher: local apply equivalent

`rad-launcher/radlab.py` is the workstation / Cloud Shell equivalent of the Cloud Build pipelines. It runs the same `tofu init / apply / destroy` cycle locally:

```bash
python3 radlab.py -m Bank_GKE -a create \
  -p my-mgmt-project \
  -b my-mgmt-project-radlab-tfstate \
  -f /path/to/my.tfvars
```

The `list` action enumerates active deployments by reading state buckets directly. See [practices/cicd.md](../practices/cicd.md) for the Cloud Build pipeline counterpart.

## Module versioning and pinning

Cloud Build pipelines pull module source from a configurable Git URL (`_MODULE_GIT_REPO_URL` substitution in the YAML configs). Consumers pin to a specific commit SHA or release tag by setting this variable. The deployed commit is recorded in `commit_hash.txt` inside the deployment bucket for traceability across the deployment lifecycle.

## Destroy safety

Every `null_resource` with a create-time effect has a matching `when = destroy` provisioner that uses:

- `set +e` (not `set -e`) — allows destroy to continue past non-fatal errors
- `--ignore-not-found` on `kubectl delete` — safe to run on already-deleted resources
- `|| echo "Warning: ..."` or `|| true` on each step — errors are logged but do not block teardown

(`SKILLS.md` §6, observed in `modules/Istio_GKE/istiosidecar.tf`, `modules/MC_Bank_GKE/mcs.tf`, `modules/Bank_GKE/hub.tf`).

## API enablement invariant

Every `google_project_service` resource sets:

```hcl
disable_dependent_services = false
disable_on_destroy         = false
```

This ensures a `tofu destroy` never disables a GCP API that another deployment in the same project might depend on (`SKILLS.md` §6).

## No secrets in defaults

Inputs like `client_secret` (AKS_GKE) and `aws_secret_key` (EKS_GKE) have no defaults. Callers source them from environment variables or a secret store at apply time. See [practices/devsecops.md](../practices/devsecops.md).

## Validation gates

> **These four commands are the definition of "ready to merge" for any module change** (`SKILLS.md` §5):

```bash
tofu init
tofu validate
tofu fmt -check
tofu plan -var="existing_project_id=my-test-project"
```

The Cloud Build CI pipeline runs the same sequence. A change that passes `tofu validate` but fails `tofu plan` is not considered validated.

## State

Remote state is stored in GCS with versioning and object-level encryption. The bucket IAM is not publicly readable. `.terraform/` is in `.gitignore`. Per-deployment state isolation (one bucket per tenant deployment) is documented in [practices/gitops_iac.md](../practices/gitops-iac.md).

## What is not here — and what to add next

| Missing capability | Notes |
|---|---|
| OpenTofu Cloud / remote runs | All orchestration is via Cloud Build or `rad-launcher`; no Terraform/OpenTofu Cloud integration exists |
| Module registry | Modules are sourced directly from Git by URL; no private registry is used today |
| Automated drift detection | `tofu plan` is run on-demand; scheduled drift detection (e.g. via Cloud Scheduler + Cloud Build) is not currently wired |

## Cross-references

- [practices/cicd.md](../practices/cicd.md) — Cloud Build pipelines that execute `tofu apply` (the pipeline counterpart to `rad-launcher`)
- [practices/gitops_iac.md](../practices/gitops-iac.md) — per-deployment state isolation, commit-pinned deploys
- [practices/devsecops.md](../practices/devsecops.md) — provider impersonation, no-secrets-in-defaults, GCS state security
- [multitenancy-saas](multitenancy-saas) — deployment ID as the tenant isolation key
- [container-orchestration](container-orchestration) — GKE module structure in practice
