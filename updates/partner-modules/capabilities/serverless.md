# Serverless

> **Scope.** Canonical home for the runtime mechanics that make this a serverless-first platform: Cloud Run v2, GKE Autopilot, VPA, Cloud Run Jobs vs Kubernetes Jobs, and the managed-service backbone. The cost lens is in [practices/finops.md](../practices/finops.md); the data-tier services are detailed in [capabilities/data_and_databases.md](data_and_databases.md).

## What this repo uniquely brings to serverless

### 1. Cloud Run v2 as the default compute (canonical)

`modules/App_CloudRun/service.tf` is a complete `google_cloud_run_v2_service` configuration:

- **Scale-to-zero** — `min_instance_count = 0` default; per-second billing.
- **Concurrency tuning** — request concurrency, max-instance ceilings, CPU-allocation modes configurable per app.
- **Direct VPC Egress** — reaches private Cloud SQL / Redis without the legacy Serverless VPC Connector and its per-instance fee (network details in [capabilities/networking.md](networking.md)).
- **Native IAP** — no load balancer required (security details in [practices/devsecops.md](../practices/devsecops.md)).
- **Health probes** — startup, liveness, readiness with sensible defaults.

### 2. Cloud Run Jobs

- `modules/App_CloudRun/jobs.tf` + `job_manifests.tf` — initialization jobs (DB migrations, plugin installs, custom SQL) run as Cloud Run Jobs, billed only while executing.
- Defined declaratively in `modules/<App>_Common/main.tf` via `script_path` references; executed automatically after each deploy.

### 3. GKE Autopilot — serverless Kubernetes (canonical)

For workloads that don't fit Cloud Run (StatefulSets, NFS-backed apps, custom controllers):

- **`modules/Services_GCP/gke.tf`** — Autopilot cluster with cost management enabled. Pods billed per-second on actual resource requests; no node-pool sizing required.
- **Vertical Pod Autoscaling** — enabled by default; continuously right-sizes CPU/memory requests.
- **Kubernetes CronJobs** — `modules/App_GKE/cronjob.tf`.
- **Kubernetes Jobs** — `modules/App_GKE/jobs.tf`, with CSI secret materialisation wait (see [practices/sre.md](../practices/sre.md)).

### 4. Fully managed dependencies

Every supporting service is managed (canonical detail per service in [capabilities/data_and_databases.md](data_and_databases.md)):

| Service | Module file |
|---|---|
| Cloud SQL (MySQL/PG) | `modules/Services_GCP/mysql.tf`, `pgsql.tf` |
| AlloyDB | `modules/Services_GCP/alloydb.tf` |
| Memorystore Redis | `modules/Services_GCP/redis.tf` |
| Filestore NFS | `modules/Services_GCP/filestore.tf` |
| Secret Manager | (consumed everywhere) |
| Artifact Registry | `modules/Services_GCP/registry.tf`, `modules/App_CloudRun/registry.tf` |

### 5. Serverless CI/CD

The pipeline itself is serverless: Cloud Build runs in ephemeral builders. See [practices/cicd.md](../practices/cicd.md).

### 6. CloudRun-vs-GKE choice as a deployment-time decision

Every application ships in **both** flavours (`<App>_CloudRun` and `<App>_GKE`) using a shared `<App>_Common` module:

- Stateless web apps default to Cloud Run.
- Apps needing persistent volumes / StatefulSets fall back to Autopilot.
- The choice is per-deployment, not per-application.

### 7. Event-driven / serverless-friendly catalogue items

Some applications are themselves serverless workflow engines: N8N, Activepieces, Kestra, NodeRED, Flowise. See the full catalogue in [outcomes/developer_productivity.md](../outcomes/developer_productivity.md).

## Cross-references

- [practices/finops.md](../practices/finops.md) — cost economics of scale-to-zero, lifecycle policies
- [capabilities/data_and_databases.md](data_and_databases.md) — managed dependency details (Cloud SQL, AlloyDB, Redis, etc.)
- [capabilities/networking.md](networking.md) — Direct VPC Egress, ingress controls
- [practices/devsecops.md](../practices/devsecops.md) — IAP, secret CSI mounting
- [practices/cicd.md](../practices/cicd.md) — serverless pipeline (Cloud Build)
- [practices/sre.md](../practices/sre.md) — PDB, progress deadlines, health probes (reliability lens)
