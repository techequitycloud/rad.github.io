---
title: "SparkyFitness on GKE Autopilot"
description: "Configuration reference for deploying SparkyFitness on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# SparkyFitness on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SparkyFitness_GKE.png" alt="SparkyFitness on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

SparkyFitness is a self-hosted, AI-assisted family food, fitness, water, and health
tracker built as a Node.js/Express backend (`codewithcj/sparkyfitness_server`) with a
separate React frontend served by nginx (`codewithcj/sparkyfitness`). This module
deploys SparkyFitness on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services SparkyFitness uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every GKE application — namespace/Service model, scaling, CI/CD, IAP,
Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What SparkyFitness costs on RAD, and how that compares

**Running SparkyFitness in your own GCP project costs about $142.62/month in Google Cloud charges; RAD's module fee is a one-time 300 credits (or 270 credits in a RAD-managed project), covering setup and support -- not the ongoing cloud bill, which Google bills you directly in your own project or RAD meters hourly in credits in a RAD-managed one.**
If a lower running cost matters more than the deployment target, see the Cloud Run guide for the lower-cost option; otherwise, if you deploy into a RAD-managed project you can pause the whole thing for free when you are not using it -- see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below.

### What you pay on RAD

| | Your own project | RAD-managed project |
|---|---|---|
| Module fee | 300 credits, once | 270 credits, once (10% lower) |
| Build time | metered in credits as the build runs (a few credits, typically) | same |
| Google Cloud running cost | ~$142.62/month, billed to your own billing account at Google's list price | ~113 credits/day, metered hourly by RAD at list price plus margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| GKE Autopilot pod, 2x vCPU / 2 GiB | $72.16 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | $51.02 |
| NFS/cache file server (small VM) | $13.43 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~$73 |
| **Total** | **$142.62** |

### How it compares

- Running it yourself on a bare VPS is still the cheapest cash option -- Hetzner CPX22 (2 vCPU/4GB) runs about **$24/month**, a DigitalOcean 2 vCPU/4GB Droplet is also **$24/month**, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about **$49/month** -- plus the admin's own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you -- but RAD's price is never meant to beat a VPS, only to replace the admin time a VPS still needs.
- SparkyFitness is used by a handful of people a few times a day, not a continuously-loaded service, so the running cost below is what actually drives the bill -- not the module fee.

### Pause it for free: delete a RAD-managed project, restore it when you need it

**This is the headline for a RAD-managed project.** Deleting a RAD-managed project first unlinks
its billing, then asks Google to delete the project outright -- Google's own 30-day recoverable
soft delete. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the
compute resource one by one: the whole project simply stops, and nothing is charged while it
waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project
and reattaches its billing account, then asks you to run Update on each deployment to confirm
everything came back. Because nothing was individually destroyed, that Update finds the same
resources already there -- it is a check, not a rebuild, and an Update never charges the module
fee again. This costs only a handful of credits (under US$1) in total for a typical 2-3-deployment
chain.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days -- after that Google deletes it for good -- and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most
services are fully working again within 36 hours of a restore.

**One real gap:** nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete
the project -- even though the project itself is recoverable for 30 days. If you have customised
the app and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the
project) before deleting. For a default install with nothing irreplaceable in it, this does not
matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project (or once you are past the 30-day restore window above), the alternative is to delete SparkyFitness outright and redeploy it later. A redeploy costs the module fee again, plus the builds -- roughly 300 + 3-6 credits of build time.

Deleting saves money only once SparkyFitness would otherwise sit unused long enough to clear that redeploy cost against its own daily running cost -- against the own-project total above, that works out to about 6 days or more. Most of the running cost here is usually the database and the NFS/cache VM; they stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.

**Keep data first:** nightly backups go to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the
  app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
  by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; https://cloud.google.com/resource-manager/docs/delete-restore-projects for the pause/restore mechanics.

## 1. Overview

Unlike the Cloud Run variant (which must run both containers in one multi-container
service due to a Cloud Run platform constraint — see
[SparkyFitness_CloudRun](SparkyFitness_CloudRun.md)), GKE has no HTTPS-only
requirement between in-cluster Services, so SparkyFitness deploys as **two separate
Deployments/Services**, exactly matching the vendor's own docker-compose model:

- The **backend** (`codewithcj/sparkyfitness_server`, port 3010) is the **main app**
  — the Foundation's standard Deployment/Service/init-job wiring.
- The **frontend** (`codewithcj/sparkyfitness`, port 80) is an **`additional_services`**
  entry: its own Deployment+Service, with a **reserved static external LoadBalancer
  IP**, reaching the backend at its cluster-internal DNS name over plain HTTP.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot (2 Deployments) | Backend (main, 2 vCPU/2Gi default) + frontend (`additional_services`, 0.5 vCPU/512Mi) |
| Database | Cloud SQL for PostgreSQL 15 | Required — no other engine is supported |
| Secrets | Secret Manager → K8s Secret | Auto-generated `SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD`; database password |
| Ingress | Reserved external LoadBalancer IP (frontend) | Deterministic across redeploys — known at plan time |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** No other engine is supported.
- **Two database roles, one Terraform-managed.** `db_user` (default `sparky`) is the
  admin/migration role created by the `db-init` job; `app_db_user` (default
  `sparky_app`) is a limited-privilege role the **backend creates and maintains
  itself** at every boot.
- **No separate migrate job.** The backend runs its own database migrations on every
  container start.
- **The backend's Service is always exposed on port 80**, regardless of
  `container_port` (3010) — this is a general App_GKE convention (Service port is
  fixed, targetPort maps to the real container port). The frontend's nginx is
  therefore wired to proxy to `:80`, not `:3010`.
- **A static IP is always reserved for the frontend LoadBalancer** so the
  browser-reachable URL (used for `SPARKY_FITNESS_FRONTEND_URL` CORS checks) is known
  at plan time and never changes across redeploys.
- **The frontend image is prebuilt; the backend is a thin custom build.** The
  backend inherits `SparkyFitness_Common`'s `image_source = "custom"` (a Dockerfile
  patching its `pg.Pool` constructors for Cloud SQL SSL), so a Cloud Build step runs
  for it; `container_image_source` is deliberately left unset here so that config
  flows through.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT`, `REGION`, and `NAMESPACE` are set (namespace name is in
the deployment [Outputs](#5-outputs)).

### A. GKE Autopilot — the SparkyFitness workloads

Two Deployments run in the same namespace: the backend (main app) and the frontend
(`additional_services`).

- **Console:** Kubernetes Engine → Workloads → filter by namespace.
- **CLI:**
  ```bash
  kubectl get deployments -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE"
  kubectl get services -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<backend-deployment> --tail=100
  kubectl logs -n "$NAMESPACE" deployment/<frontend-deployment> --tail=100
  ```

See [App_GKE](App_GKE.md) for scaling, resource quotas, and rollout behaviour.

### B. Cloud SQL for PostgreSQL 15

SparkyFitness stores all application data in a managed Cloud SQL for PostgreSQL 15
instance. The backend (main app) connects through the **Cloud SQL Auth Proxy**
sidecar over `127.0.0.1` when `enable_cloudsql_volume = true` (the default).

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql instances describe <instance-name> --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
backups, and password rotation.

### C. Secret Manager / Kubernetes Secrets

Three cryptographic secrets are generated in Secret Manager and materialised as a
Kubernetes Secret for the backend pod: `SPARKY_FITNESS_API_ENCRYPTION_KEY`,
`BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD`.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~sparkyfitness"
kubectl get secret -n "$NAMESPACE"
```

### D. Networking & the frontend LoadBalancer

The frontend's Service is a `LoadBalancer` pinned to a reserved static external IP.

```bash
kubectl get service <frontend-service> -n "$NAMESPACE" -o wide
gcloud compute addresses list --project "$PROJECT" --filter="name~frontend-ip"
```

### E. Cloud Logging & Monitoring

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. SparkyFitness Application Behaviour

- **First-deploy database setup.** A single `db-init` initialization Job creates the
  **admin** role (`db_user`) and database (`db_name`) only.
- **Migrations run on every boot.** The backend applies its own schema migrations at
  startup using the admin `db_user` credentials.
- **`app_db_user` is self-healing.** The backend creates or updates this
  limited-privilege role at every start.
- **First-run account creation.** Sign up via the frontend URL to create the first
  user account, then set `admin_email` and redeploy to grant admin privileges.
- **Disable signup after first use.** Set `disable_signup = true` once the admin
  account exists.
- **Health path.** `GET /api/health` on port 3010 (backend) — confirmed via the
  upstream Dockerfile's own `HEALTHCHECK` directive.
- **Reserved frontend LB IP.** `public_uri` overrides the auto-derived
  `http://<reserved-ip>` URL with a custom domain — set both this variable and the
  domain's DNS record, then redeploy.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for SparkyFitness are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `sparkyfitness` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Tags BOTH images identically. Use `latest` or a `v`-prefixed tag exactly as published upstream (e.g. `v0.17.3`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `2000m` / `2Gi` | Resource limits for the **backend** (main app). |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Replica scaling bounds. |
| `container_port` | `3010` | Backend's listening port. |

### Group 5 — SparkyFitness Application Config

| Variable | Default | Description |
|---|---|---|
| `public_uri` | `""` | Custom-domain override for the frontend URL. Leave empty to use the reserved static LB IP automatically. |
| `app_db_user` | `sparky_app` | Limited-privilege runtime role, self-created by the backend. |
| `disable_signup` | `false` | Disable new self-registration. |
| `admin_email` | `""` | Grants admin to an EXISTING user on startup. |
| `log_level` / `timezone` | `ERROR` / `Etc/UTC` | Backend log verbosity / TZ. |

### Group 7 — SMTP (optional)

| Variable | Default | Description |
|---|---|---|
| `smtp_enabled` | `false` | Enable password-reset/notification email; set all `smtp_*` fields together. |

### Group 11 — Jobs & Services

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `additional_services` | `[]` | The frontend is already included automatically; use this for any EXTRA services. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/health`, port 3010 | Targets the backend (main app). |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `db_name` | `sparkyfitness_db` | Database name. Immutable after first deploy. |
| `db_user` | `sparky` | Admin/migration role. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar — resolves to `127.0.0.1` loopback (no TLS needed). |

### Group 21 — Redis (not used natively)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | SparkyFitness does not natively use Redis; the Foundation's generic Redis wiring is deliberately left enabled as a capability for future backend versions. Set it to `false` to avoid provisioning a cache nothing reads. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Backend Kubernetes Service name. |
| `namespace` | Kubernetes namespace. |
| `frontend_url` | Browser-reachable URL of the frontend — open this to access the application. |
| `backend_cluster_url` | Cluster-internal URL of the backend API. |
| `database_instance_name` / `database_name` / `database_user` | Cloud SQL identifiers. |
| `database_password_secret` | Secret Manager secret holding the admin DB password. |
| `storage_buckets` | Created Cloud Storage buckets (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `BETTER_AUTH_SECRET` (auto-generated) | Never rotate after users enable 2FA | Critical | Rotating it locks out every user with 2FA enabled. |
| `SPARKY_FITNESS_API_ENCRYPTION_KEY` (auto-generated) | Never rotate after first connection | Critical | Rotating it invalidates all stored external-data-source credentials. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; changing recreates the DB and destroys all data. |
| Frontend proxy target port | `80` (fixed by App_GKE), not `container_port` | High | Pointing the frontend's `SPARKY_FITNESS_SERVER_PORT` at `3010` hits a nonexistent Service listener — every `/api` call hangs. |
| `application_version` | Use upstream's exact tag (`v0.17.3`) | High | A bare `0.17.3` (no `v` prefix) does not exist upstream — pull fails. |
| `admin_email` | Set only after the account exists | Medium | Setting it before signup has no effect. |
| `disable_signup` | `true` after first admin | Medium | Leaving signup open lets anyone with the URL create an account. |
| `public_uri` | Set together with real DNS when using a custom domain | Medium | An unreachable/mismatched `public_uri` breaks CORS/session-origin checks. |

---

For the foundation behaviour referenced throughout — namespace model, scaling,
ingress, CI/CD, IAP, Binary Authorization, VPC-SC, backups, and image mirroring —
see **[App_GKE](App_GKE.md)**. SparkyFitness-specific application configuration
shared with the Cloud Run variant is described in
**[SparkyFitness_Common](SparkyFitness_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: SparkyFitness on GKE Autopilot](../labs/SparkyFitness_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [SparkyFitness on Google Cloud Run](SparkyFitness_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [SparkyFitness Common — Shared Application Configuration](SparkyFitness_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Grocy on GKE Autopilot](Grocy_GKE.md), [Mealie on GKE Autopilot](Mealie_GKE.md), [Homebox on GKE Autopilot](Homebox_GKE.md), [Wallos on GKE Autopilot](Wallos_GKE.md) in the **Home & Life Management** solution.
