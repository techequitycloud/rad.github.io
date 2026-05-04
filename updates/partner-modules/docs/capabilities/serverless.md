# Serverless

> **Scope.** Canonical home for the runtime mechanics that make this a serverless-first platform: Cloud Run v2, GKE Autopilot, VPA, Cloud Run Jobs vs Kubernetes Jobs, Cloud Deploy multi-stage promotion, custom container builds, and the managed-service backbone. The cost lens is in [practices/finops.md](../practices/finops.md); the data-tier services are detailed in [capabilities/data_and_databases.md](data_and_databases.md).

## What this repo uniquely brings to serverless

### 1. Cloud Run v2 as the default compute (canonical)

`modules/App_CloudRun/service.tf` is a complete `google_cloud_run_v2_service` configuration:

- **Scale-to-zero** — `min_instance_count = 0` default; per-second billing.
- **Concurrency tuning** — request concurrency, max-instance ceilings, CPU-allocation modes configurable per app.
- **Direct VPC Egress** — reaches private Cloud SQL / Redis without the legacy Serverless VPC Connector and its per-instance fee (network details in [capabilities/networking.md](networking.md)).
- **Native IAP** — no load balancer required (security details in [practices/devsecops.md](../practices/devsecops.md)).
- **Health probes** — startup, liveness, readiness with sensible defaults.

### 2. Cloud Run Jobs

`modules/App_CloudRun/jobs.tf` + `job_manifests.tf` — initialization jobs run as Cloud Run Jobs, billed only while executing:

- **DB migration & init** — schema migrations, Django/Odoo/WordPress install scripts.
- **Plugin & extension installs** — MySQL plugin installation, PostgreSQL extension activation (`pgvector`, `pg_trgm`, etc.).
- **Custom SQL scripts** — `enable_custom_sql_scripts = true` runs per-app SQL against the provisioned database.
- **Backup / restore** — export and import jobs (GCS or Google Drive source) orchestrated by the same job machinery.
- **Teardown** — `db-cleanup.sh` runs on `deploy_application = false`.

Jobs are defined declaratively in `modules/<App>_Common/main.tf` via `script_path` references and executed automatically after each deploy.

### 3. GKE Autopilot — serverless Kubernetes (canonical)

For workloads that don't fit Cloud Run (StatefulSets, NFS-backed apps, custom controllers):

- **`modules/Services_GCP/gke.tf`** — Autopilot cluster with cost management enabled. Pods billed per-second on actual resource requests; no node-pool sizing required.
- **Vertical Pod Autoscaling** — enabled by default; continuously right-sizes CPU/memory requests.
- **StatefulSets** — `modules/App_GKE/statefulset.tf` for workloads requiring stable network identity and ordered, persistent storage (e.g. Elasticsearch, database sidecars).
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

### 5. Custom container builds and image mirroring

`modules/App_CloudRun/main.tf` supports three image sources controlled by `container_image_source`:

- **`prebuilt`** — a pre-built OCI image URI is deployed directly to Cloud Run.
- **`custom`** — Cloud Build compiles a Dockerfile from `modules/<App>_Common/scripts/`. Build arguments (e.g. `APP_VERSION`), Dockerfile path, and build context are all configurable via the `container_build_config` variable.
- **`mirror`** — `enable_image_mirroring = true` copies an upstream image into the project's Artifact Registry before deployment, satisfying Binary Authorization requirements and keeping traffic inside the project's network boundary.

Artifact Registry is the default image store; the registry name, location, and optional CMEK encryption key are all configurable.

### 6. Cloud Deploy multi-stage promotion (canonical)

`modules/App_CloudRun/skaffold.tf` generates a `skaffold.yaml` and Cloud Run service manifests; `modules/App_Common/modules/app_cloud_deploy/` provisions the Cloud Deploy pipeline.

Key mechanics:

- **`enable_cloud_deploy = true`** activates the pipeline; `cloud_deploy_stages` is a list of stage objects (name, optional `project_id`, optional `region`).
- **First stage only is Terraform-managed** — Terraform pre-creates the Cloud Run service for stage 0 (typically `dev`). Subsequent stages (e.g. `staging`, `prod`) are created by Cloud Deploy on first promotion, keeping later-stage lifecycles outside Terraform state.
- **Skaffold profiles** — one profile per stage; each profile references its stage's Cloud Run service manifest stored in GCS.
- **Auto-promotion and approval gates** — configurable per stage (`auto_promote`, `approval_required`). A stage with `approval_required = true` pauses the pipeline until a human approves in the Cloud Deploy UI or via `gcloud deploy releases promote`.
- **Post-deploy IAM hooks** — a Skaffold `after-deploy` hook binds `roles/run.invoker` for later stages that Cloud Deploy (not Terraform) creates, ensuring IAP and public-access settings are applied consistently.
- **CI/CD integration** — `cicd_enable_cloud_deploy = true` instructs the Cloud Build trigger to create a Cloud Deploy release rather than deploying directly to Cloud Run.

### 7. Serverless CI/CD

The pipeline itself is serverless: Cloud Build runs in ephemeral builders. See [practices/cicd.md](../practices/cicd.md).

### 8. CloudRun-vs-GKE choice as a deployment-time decision

Every application ships in **both** flavours (`<App>_CloudRun` and `<App>_GKE`) using a shared `<App>_Common` module:

- Stateless web apps default to Cloud Run.
- Apps needing persistent volumes / StatefulSets fall back to Autopilot.
- The choice is per-deployment, not per-application.

### 9. Event-driven / serverless-friendly catalogue items

Some applications are themselves serverless workflow engines: N8N, Activepieces, Kestra, NodeRED, Flowise. See the full catalogue in [outcomes/developer_productivity.md](../outcomes/developer_productivity.md).

## Cross-references

- [practices/finops.md](../practices/finops.md) — cost economics of scale-to-zero, lifecycle policies
- [capabilities/data_and_databases.md](data_and_databases.md) — managed dependency details (Cloud SQL, AlloyDB, Redis, etc.)
- [capabilities/networking.md](networking.md) — Direct VPC Egress, ingress controls, Cloud Armor
- [practices/devsecops.md](../practices/devsecops.md) — IAP, secret CSI mounting, Binary Authorization
- [practices/cicd.md](../practices/cicd.md) — serverless pipeline (Cloud Build + Cloud Deploy)
- [practices/sre.md](../practices/sre.md) — PDB, progress deadlines, health probes (reliability lens)
