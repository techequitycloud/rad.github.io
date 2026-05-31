# Grafana_Common Module

`Grafana_Common` is the shared application configuration module for Grafana deployments. It is called internally by `Grafana_CloudRun` and `Grafana_GKE` — it is not deployed directly.

---

## Purpose

`Grafana_Common` assembles the four values consumed by the Foundation Modules (`App_CloudRun` and `App_GKE`):

- **`config`** — The application configuration object containing the container image, port, resource limits, database settings, probes, and initialization jobs.
- **`secret_ids`** — Secret Manager secret references to inject as environment variables. Grafana_Common returns an empty map — no application-level secrets are auto-generated.
- **`storage_buckets`** — A list containing the `grafana-data` GCS bucket definition.
- **`path`** — The filesystem path to this module, used to resolve `scripts_dir` in the parent module.

---

## Container Configuration

`Grafana_Common` sets the following fixed values in its `config` output:

| Field | Value | Notes |
|---|---|---|
| `container_image` | `grafana/grafana` | Official Grafana Docker Hub image. |
| `image_source` | `custom` | Cloud Build compiles a custom image extending the official base. |
| `container_port` | `3000` | Grafana's default HTTP port. |
| `database_type` | `POSTGRES_15` | PostgreSQL 15 is required. Fixed — cannot be overridden. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Cloud SQL Auth Proxy Unix socket mount path. |

---

## Health Probes

Both the startup and liveness probes target `/api/health` — Grafana's dedicated health endpoint. The startup probe uses a generous initial delay and failure threshold to accommodate database migrations on first boot:

| Probe | Path | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|
| Startup | `/api/health` | 30s | 10s | 12 (total tolerance: ~150s) |
| Liveness | `/api/health` | 60s | 30s | 3 |
| Readiness | `/api/health` | 15s | 10s | 3 |

---

## Storage Buckets

`Grafana_Common` provisions one GCS bucket automatically:

| Suffix | Class | Notes |
|---|---|---|
| `grafana-data` | `STANDARD` | Default data bucket for Grafana. `public_access_prevention = "enforced"`. |

---

## Variables

`Grafana_Common` accepts the following internal variables (not user-facing — set by the parent CloudRun or GKE module):

| Variable | Default | Description |
|---|---|---|
| `application_name` | `'grafana'` | Application name used in resource naming. |
| `deployment_id` | `""` | Unique deployment ID passed from the parent module. |
| `application_version` | `'11.4.0'` | Grafana version tag for the container build. |
| `db_name` | `'grafana'` | PostgreSQL database name. |
| `db_user` | `'grafana'` | PostgreSQL application user. |
| `enable_cloudsql_volume` | `true` | Injects the Cloud SQL Auth Proxy sidecar. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts passed through from the parent. |
| `cpu_limit` | `'1000m'` | CPU limit for the container. |
| `memory_limit` | `'2Gi'` | Memory limit for the container. |
| `environment_variables` | `{}` | Additional plain-text environment variables. |
| `secret_environment_variables` | `{}` | Additional Secret Manager references. |
| `initialization_jobs` | `[]` | Initialization jobs. Leave empty — Grafana auto-migrates its schema. |
| `description` | `'Grafana observability platform'` | Application description. |
| `startup_probe` | (see above) | Startup probe configuration. |
| `liveness_probe` | (see above) | Liveness probe configuration. |
| `enable_image_mirroring` | `false` | Enable mirroring to Artifact Registry. |
| `min_instance_count` | `1` | Minimum instances. |
| `max_instance_count` | `3` | Maximum instances. |
| `region` | `'us-central1'` | GCP region for resource deployment. |

---

## Scripts

The `Grafana_Common/scripts/` directory contains shell scripts and Dockerfile assets used during the Cloud Build image pipeline. The `scripts_dir` output from this module is used by the parent CloudRun and GKE modules to locate these scripts at apply time.
