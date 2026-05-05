---
title: "Modernization"
sidebar_label: "Modernization"
---

# Application Modernization

> **Scope.** Canonical home for the lift-and-modernize path: the Bank of Anthos 12-factor reference application, the Migrate-to-Containers lab, the Cloud Run modernization target, and stateful workload placement patterns for multi-region topologies. The GitOps delivery model that follows a migration is in [hybrid-cloud](hybrid-cloud); the serverless runtime for modernized workloads is in [serverless](serverless).

Application modernization means moving workloads from virtual machines (or legacy monoliths) onto a managed, containerised runtime — gaining automatic scaling, mesh security, and GitOps delivery in the process. This repo supports three landing zones for modernized workloads, and provides a guided lab for the initial migration step.

## Choosing a modernization target

The right landing zone depends on the workload's statefulness and operational requirements:

| Target | Best for | Key constraint | Module / script |
|---|---|---|---|
| **Cloud Run** | Stateless, HTTP-driven services; scale-to-zero desired | No persistent volumes; max 60 min request timeout | `App_CloudRun` modules |
| **GKE Autopilot** | Stateful apps, background workers, apps needing NFS | Slightly higher cold-start latency than Cloud Run | `App_GKE` modules |
| **GKE + mesh** | Workloads requiring mTLS, traffic management, or multi-region HA | Requires GKE cluster; most operationally complex | `Bank_GKE`, `MC_Bank_GKE` |
| **GCVE (VMware Engine)** | VMs that cannot be re-containerised | No containerisation; maintains VM model | `VMware_Engine` module |

Every application module ships in both Cloud Run and GKE flavours via a shared `<App>_Common` module — the target is a per-deployment decision, not a per-application one.

## Bank of Anthos as a 12-factor reference

Bank of Anthos is a microservices banking application deployed by both `modules/Bank_GKE/` and `modules/MC_Bank_GKE/`. It demonstrates how a fully modernized workload uses managed identity, mesh mTLS, multi-region routing, and observability together — all the capabilities documented in this repo.

The deploy logic (`deploy.tf`) downloads the Bank of Anthos release tarball at apply time and applies the manifests:

- `modules/Bank_GKE/deploy.tf` — single-cluster deployment.
- `modules/MC_Bank_GKE/deploy.tf` — `for_each` over clusters; database StatefulSets (`accounts-db`, `ledger-db`) deploy to `cluster1` (primary) only; non-primary clusters reach the databases via Multi-Cluster Services.

The download is forced on every apply via `always_run = timestamp()`; changing the release URL is the only step needed to upgrade the app version.

## Stateful workloads in a multi-region topology

The database placement pattern in `MC_Bank_GKE` is an important pattern for any multi-region modernization:

1. `accounts-db` and `ledger-db` are Kubernetes `StatefulSet` resources deployed **only to `cluster1`** (the primary region).
2. Application pods on `cluster2`–`cluster4` reach these databases through **Multi-Cluster Services** — a fleet-level DNS name that routes to the primary cluster's endpoints over the mesh.
3. This preserves data consistency (no distributed database) while allowing stateless application tiers to scale globally.

Use this pattern for any stateful workload that cannot or should not be replicated: pin state to one cluster, expose it via MCS, let stateless tiers scale freely.

## Migrate-to-Containers lab

`scripts/gcp-m2c-vm/gcp-m2c-vm.sh` is an interactive lab walking through Migrate-to-Containers for a Linux VM workload, with **preview / create / delete** modes. It is the entry point for teams whose modernization strategy includes lifting existing VM workloads onto a unified Kubernetes target without rewriting application code.

## Cloud Run as a modernization target

`scripts/gcp-cr-mesh/gcp-cr-mesh.sh` demonstrates the Cloud Run + mesh path. Modernized workloads do not have to land on Kubernetes — Cloud Run is the preferred target for stateless, event-driven services. The script shows how to put a Cloud Run service behind Cloud Service Mesh via a serverless NEG. See [serverless](serverless) for full runtime mechanics.

## Post-migration lifecycle: GitOps

After landing workloads on Kubernetes via Migrate-to-Containers, the natural next step is enabling **Anthos Config Management (Config Sync)** on the target cluster so application manifests are sourced from Git rather than applied imperatively. This shifts the operational model from `kubectl apply` to commit-driven reconciliation:

1. Enable ACM on the target cluster (opt-in flag in `Bank_GKE`).
2. Push Kubernetes manifests to a Git repository.
3. Config Sync continuously reconciles cluster state to the Git source; any drift is surfaced as a sync error.
4. Add Policy Controller to enforce organisational guardrails (resource limits, label requirements, disallowed image registries) as OPA Gatekeeper constraints.

See [hybrid-cloud](hybrid-cloud) for the ACM/Config Sync model and fleet-wide policy enforcement.

## What is not here — and what to add next

| Gap | Notes |
|---|---|
| GitOps workflow for post-migration delivery | ACM/Config Sync is documented as the path; no pre-configured Git repo or Kustomize/Helm overlay structure is shipped today |
| Database migration tooling | `db-init.sh` handles schema initialisation; migration frameworks (Flyway, Liquibase) are not pre-integrated |
| Canary and blue/green deploy patterns | Cloud Deploy supports staged promotion (see [serverless](serverless) §7); Istio traffic splits (see [service-mesh](service-mesh)) provide the primitives, but a combined canary-deploy pattern is not pre-built |
| GCVE workload migration guide | `VMware_Engine` module provisions the network peering; a step-by-step VM migration walkthrough is not yet available |

## Cross-references

- [serverless](serverless) — Cloud Run and GKE Autopilot runtime mechanics; Cloud Deploy multi-stage promotion
- [hybrid-cloud](hybrid-cloud) — Anthos Config Management, Config Sync, and fleet-wide Policy Controller
- [service-mesh](service-mesh) — mesh identity, mTLS, and traffic management for modernized workloads
- [networking](networking) — VMware Engine hybrid connectivity; multi-cluster topology
- [container-orchestration](container-orchestration) — GKE cluster configuration that hosts modernized workloads
- [outcomes/modernization.md](../outcomes/modernization.md) — business outcomes and modernization ROI framing
