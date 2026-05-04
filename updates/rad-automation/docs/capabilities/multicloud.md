# Multicloud

> **Scope.** RAD's current production footprint is GCP-only. The
> architecture, tooling choices, and abstractions described below are
> deliberately cloud-neutral so additional providers (AWS, Azure, on-prem)
> can be added without rewriting the platform.

## Today's footprint: GCP-first

[`infrastructure/versions.tf`](../../rad-ui/automation/terraform/infrastructure/versions.tf)
declares only the `google` and `google-beta` providers (`~> 7.0`). The
managed services in use — Cloud Run, Cloud Functions, Firestore, BigQuery,
Cloud Storage, Secret Manager, IAM Credentials, Pub/Sub, Cloud Asset — are
all GCP-native (see [Serverless](./serverless.md) and [Data &
Analytics](./data.md)).

## Cloud-neutral foundations

The platform was built with provider portability in mind:

- **OpenTofu, not (only) Terraform.**
  [`rad-launcher/tofu_installer.py`](../../rad-launcher/tofu_installer.py)
  installs OpenTofu, which supports the full Terraform provider ecosystem
  (AWS, Azure, Kubernetes, etc.). Custom builder image:
  [`modules/of-builder/`](../../rad-ui/automation/terraform/modules/of-builder).
  Full IaC story: [GitOps & IaC](../practices/gitops_iac.md).
- **Module-based deployment lifecycle.** The Cloud Build pipelines under
  [`rad-ui/automation/`](../../rad-ui/automation) call
  `tofu init/plan/apply` against whatever module is supplied, agnostic to
  the underlying provider — see [Platform
  Engineering](../practices/platform_engineering.md).
- **Provider-agnostic billing abstraction.** Three independent payment
  providers — Stripe, Paystack, Flutterwave — share a common
  credit/billing model so customers can pay with whichever provider fits
  their region. See [FinOps](../practices/finops.md).
- **OIDC / federated identity.** Workload Identity Federation is the same
  primitive AWS IAM and Azure AD expose, making cross-cloud CI a drop-in
  extension. See [DevSecOps](../practices/devsecops.md).

## Multi-region within GCP

Within GCP, RAD already separates control plane (`us-central1` Cloud Run /
Cloud Build) from per-customer module deployments, which can target any
GCP region the user selects:
[`pages/api/regions.ts`](../../rad-ui/webapp/src/pages/api/regions.ts).

## Extending to AWS or Azure

1. Add the provider to a new `versions.tf` for the target module set.
2. Author module(s) under `rad-ui/automation/terraform/modules/<provider>/`
   following the same shape as
   [`modules/project/`](../../rad-ui/automation/terraform/modules/project).
3. Register the module in the catalogue
   ([`tools/service-catalog.py`](../../tools/service-catalog.py)).
4. Add a per-provider OIDC trust policy mirroring the GCP Workload
   Identity setup.

The deployment lifecycle, UI, CLI, billing, and observability layers do
not need to change.

## See also

- [GitOps & IaC](../practices/gitops_iac.md), [DevSecOps](../practices/devsecops.md), [FinOps](../practices/finops.md).
