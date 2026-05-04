---
id: cicd
title: CI/CD
---

# Continuous Integration and Continuous Delivery

Infrastructure is delivered as a product through a managed pipeline of Cloud Build configurations and a Python CLI that automates local apply-cycles. This document covers the full deployment pipeline: Cloud Build configurations, build triggers, image builds, progressive delivery, validation gates, integration tests, and the IaC mechanics that underpin reproducible deployments.

## Cloud Build pipelines

The platform provides end-to-end Cloud Build pipelines covering the full deployment lifecycle:

| File | Purpose | Timeout |
|---|---|---|
| `cloudbuild-create.yaml` / `cloudbuild_deployment_create.yaml` | Initial `tofu apply` | 3600s |
| `cloudbuild-update.yaml` / `cloudbuild_deployment_update.yaml` | Re-apply with changed variables | 3600s |
| `cloudbuild-destroy.yaml` / `cloudbuild_deployment_destroy.yaml` | `tofu destroy` | 3600s |
| `cloudbuild-purge.yaml` / `cloudbuild_deployment_purge.yaml` | Destroy plus post-cleanup of stuck resources | 600s |

All pipelines run `tofu init / plan / apply` in a custom Terraform-aware container with Secret Manager substitutions for `GIT_TOKEN`. Pipelines persist `commit_hash.txt` and `repo_url.txt` into the workspace for reproducible destroy and full deployment traceability across the lifecycle.

## Parameterised, multi-tenant pipelines

A single pipeline serves every tenant and module via substitutions: `_MODULE_NAME`, `_DEPLOYMENT_ID`, `_DEPLOYMENT_BUCKET_ID`, `_MODULE_GIT_REPO_URL`. New applications and tenants require zero pipeline changes.

Every module has a 4-character `deployment_id` generated via `random_id` (or supplied by the user). The same ID identifies that deployment for `update` or `delete` later.

## Image build and progressive delivery

- **Inline container builds** — `modules/App_Common/buildappcontainer.tf` plus the `app_build` sub-module wire Cloud Build → Artifact Registry → deploy in one apply. App-specific build context lives in `modules/<App>_Common/scripts/`.
- **Skaffold + Cloud Deploy** — `modules/App_CloudRun/skaffold.tf` and `modules/App_GKE/skaffold.tf` generate `skaffold.yaml` and Cloud Deploy delivery pipelines.
- **Build triggers** — `modules/App_CloudRun/trigger.tf` and `modules/App_GKE/trigger.tf` create push/PR-driven Cloud Build triggers wired to the application source repository.

## Validation gates

Platform-wide validation gates apply before any module change is merged or deployed:

```bash
tofu init && tofu validate && tofu fmt -check
tofu plan -var="existing_project_id=my-test-project"
```

- **Validation blocks** — `modules/App_CloudRun/validation.tf` and `modules/App_GKE/validation.tf` reject misconfigurations at `tofu plan` time.
- **Prerequisite resources** — `prerequisites.tf` provisions API enablement, PSA service agents, and IAM bindings before dependents, with retry logic for GCP's async IAM propagation.
- **Lint** — `tofu fmt -check -recursive` is enforced as a pre-merge gate.

These gates are the definition-of-ready for any module change.

## Secrets management in pipelines

Cloud Build substitution variables (`_MODULE_GIT_REPO_URL`, `_DEPLOYMENT_BUCKET_ID`, etc.) carry configuration but not credentials. The resource creator identity (`var.resource_creator_identity`) is a service account whose access token is minted at apply time via impersonation — no long-lived key is passed into the pipeline. Any additional secrets (e.g., cross-cloud credentials for AKS/EKS modules) must be sourced from Secret Manager using the `secretEnv` or `availableSecrets` stanza in the Cloud Build YAML, not from substitution variables. See [DevSecOps](./devsecops.md) for the full secret-handling rules.

## Post-apply automation

- **Initialization jobs** — DB migrations, plugin installs, and custom SQL are declared in `*_Common/main.tf` and run as Cloud Run Jobs or Kubernetes Jobs after each deploy.
- **Cleanup automation** — revision pruning, Artifact Registry cleanup, and stale-service cleanup are covered in [FinOps](./finops.md) (cost lens) and [SRE](./sre.md) (toil lens).

## Local pipeline parity

`rad-launcher/radlab.py` runs the same apply flow from a workstation or Cloud Shell, with a non-interactive command-line form for external CI integration:

```bash
python3 radlab.py -m AKS_GKE -a create -p my-mgmt-project \
  -b my-mgmt-project-radlab-tfstate -f /path/to/my.tfvars
```

`rad-launcher/installer_prereq.py` installs OpenTofu, the Cloud SDK, `kubectl`, and Python dependencies in a single shot, including auto-detecting Cloud Shell to skip what is already available. The `list` action enumerates active deployments by reading state buckets directly — no external inventory database is required.

## Integration testing

- **Go integration suite** — `tests/` (Terratest-style) drives `tofu apply` against a live GCP project.
- **Reference modules** — `modules/Sample_CloudRun` and `modules/Sample_GKE` validate Foundation changes before they propagate.
- **`TESTING_STRATEGY.md`** — documents the layered testing approach.

## Branch strategy

The repository follows a trunk-based model with short-lived feature branches:

- **`main`** — the stable trunk; direct commits are restricted to the platform team.
- **`feature/<name>`** — short-lived branches merged via PR with at least one reviewer approval and a passing `tofu validate` + `tofu fmt -check` run.
- **`release/<version>`** — cut from `main` for coordinated multi-module releases; used when Foundation or Platform changes must propagate atomically.

Cloud Build triggers in `trigger.tf` are wired to `main` (deploy) and PR branches (plan-only preview). Destroy pipelines are never triggered automatically — they require manual invocation to prevent accidental teardown.

## Rollback strategy

Cloud Build pipelines do not automatically roll back a failed `tofu apply`. If an update pipeline fails mid-run, the remote state in GCS reflects whatever partial resources were created. Recovery steps:

1. Re-run the update pipeline after fixing the root cause — OpenTofu's state lock prevents concurrent applies.
2. If state is inconsistent, use `tofu state rm` to remove the orphaned resource and re-apply.
3. For unrecoverable state, use the purge pipeline (600s timeout) which adds post-cleanup logic on top of `tofu destroy`.

The `/troubleshoot` workflow in `AGENTS.md` pairs each failure symptom with a diagnostic command and a file:line reference.

## Production approval gates

Destructive and high-impact pipeline runs require a human approval step before `tofu apply` executes:

- **Destroy / purge pipelines** — a Cloud Build `approval` step is mandatory; no auto-approval path exists.
- **Foundation or Platform changes** — changes to `modules/App_CloudRun`, `modules/App_GKE`, or `modules/Services_GCP` require a second reviewer approval on the PR before the trigger fires, enforced via GitHub branch-protection rules.
- **Drift remediation** — when a scheduled drift-detection run surfaces unexpected changes, an approval gate is inserted before the remediation apply.

## Build caching and pipeline speed

Pipeline speed is both a developer-experience lever and a direct cost driver (Cloud Build charges per build-minute):

- **Docker layer caching** — the custom Terraform image is built once and re-pulled by all pipelines rather than rebuilt on each run.
- **`tofu init` provider caching** — the GCS workspace bucket stores provider binaries between builds at `gs://${_DEPLOYMENT_BUCKET_ID}/terraform-provider-cache/${_MODULE_NAME}/providers.tar.gz`, restored via `TF_PLUGIN_CACHE_DIR` before each `tofu init` and saved back after success. A missing cache is non-fatal.
- **Go test caching** — `tests/` integration tests use Go's module cache; pre-warming the cache in the test image layer reduces `go mod download` time.

Cache invalidation: bump the cache key (image tag or GCS path prefix) whenever the provider lock file (`terraform.lock.hcl`) changes.

## Pipeline failure notifications

Build failures must surface to operators immediately:

- **Cloud Monitoring alert policy** — a metric filter on `cloudbuild.googleapis.com/finished_build_step_count` with `status = FAILURE` triggers a notification channel (email, PagerDuty, or Slack webhook) within two minutes of failure.
- **Pub/Sub → Cloud Functions** — for richer Slack messages (tenant name, module, failed step, log link), `cloudbuild-notifications.yaml` can route build status events through a Pub/Sub topic to a lightweight Cloud Function.
- **Cloud Build history** — all build logs are retained in GCS and surfaced in the Cloud Build console for post-mortem inspection; see [SRE](./sre.md) for the incident response process.

Notification channels are configured in `modules/Services_GCP` and inherited by all pipelines via shared substitutions. The same Pub/Sub channel is used for budget alerts — see [FinOps](./finops.md).

## Managed Kubernetes upgrades

GKE `release_channel` lets the control plane be upgraded continuously by Google. The `/maintain` workflow in `AGENTS.md` covers promoting a deployment between channels.

## Cross-references

- [GitOps & IaC](./gitops-iac.md) — OpenTofu, state, drift detection, idempotent re-apply
- [FinOps](./finops.md) — revision pruning, Artifact Registry cleanup policies
- [SRE](./sre.md) — DORA-metric impact of fast deploys, incident response
- [DevSecOps](./devsecops.md) — secret-handling rules in pipelines
- [IDP](./idp.md) — multi-tenant pipeline parameterisation
