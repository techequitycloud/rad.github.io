---
title: "Stalwart GKE Module — Configuration Guide"
description: "Configuration reference for deploying Stalwart on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Stalwart GKE Module — Configuration Guide

This guide describes the configuration variables available in the `Stalwart_GKE` module. `Stalwart_GKE` is a **wrapper module** that combines the generic [`App_GKE`](./App_GKE.md) infrastructure module with the [`Stalwart_Common`](./Stalwart_Common.md) shared application configuration to deploy [Stalwart Mail Server](https://stalw.art/) — an open-source mail server that serves SMTP, IMAP, POP3, JMAP and ManageSieve from a single Rust binary — on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Stalwart GKE` map directly to the same options in `App GKE`. Where a variable is identical in behaviour, this guide references the `App GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Stalwart** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

> **GKE only:** There is no Cloud Run variant. Mail protocols are line protocols that Cloud Run cannot forward, and Stalwart serves normally on 443 while its port 8080 opens only when it is unconfigured or has failed to start — so Cloud Run's `$PORT` contract would be satisfied exactly when the server is broken.

---

## Standard Configuration Reference

The following configuration areas are provided by the underlying `App_GKE` module. Consult the linked sections of the [App_GKE Configuration Guide](./App_GKE.md) for full documentation.

| Configuration Area | App GKE.md Section | Stalwart-Specific Notes |
|---|---|---|
| Project & Identity | §2 IAM & Access Control | Identical. |
| Application Identity | §3.A Compute (GKE Autopilot) | Change the leftover `Wiki.js` display name; see [Group 3](#group-3-application-identity). |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | `container_port = 443`; keep one replica; see [Group 4](#group-4-runtime--scaling). |
| Environment Variables & Secrets | §3 Core Service Configuration | `STALWART_RECOVERY_ADMIN` belongs in `secret_environment_variables`; see [Group 5](#group-5-environment-variables--secrets). |
| Kubernetes Service & Ports | §5 Traffic & Ingress | L4 `LoadBalancer` carrying 443 plus six mail ports; see [Group 6 and the port map](#group-6-kubernetes-service-workload--ports). |
| Stateful Workloads | §3.A Compute (GKE Autopilot) | StatefulSet with a PVC at `/var/lib/stalwart`; see [Group 7](#group-7-stateful-workloads). |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | Only created while `max_instance_count > 1`. |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | **TCP probes on 443**; see [Group 10](#group-10-observability--health). |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | No init job — Stalwart creates its own schema. |
| CI/CD, Binary Authorization | §6 CI/CD & Delivery, §4.C | Identical. |
| Storage — NFS / GCS | §3.C Storage (NFS / GCS / GCS Fuse) | Not used by Stalwart; see [Groups 13–14](#groups-13-and-14-storage). |
| Redis | §8.A Redis / Memorystore | Leave off; see [Group 15](#group-15-redis). |
| Database Configuration | §3.B Database (Cloud SQL) | **MySQL 8.0, fixed by `Stalwart_Common`**; see [Group 16](#group-16-database). |
| Backup Schedule, Import & Custom SQL | §3.B, §8.B, §3.E | Identical. |
| Custom Domain & Static IP | §5.C Static IP Reservation | Static IP on the LoadBalancer; no Gateway; see [Group 19](#group-19-custom-domain-static-ip--network-tags). |
| IAP, Cloud Armor, CDN | §4.A, §4.B, §5.B | Gateway (HTTP) features — they do not cover mail ports. |
| VPC Service Controls | §4.D VPC Service Controls | Identical. |

---

## How Stalwart GKE Relates to App GKE

`Stalwart GKE` passes its variables through to `App GKE` and adds a `Stalwart Common` sub-module that supplies the Stalwart-specific application configuration. The main effects are:

1. **A wrapper image writes `config.json`.** Stalwart reads a single `--config /etc/stalwart/config.json` file that holds only its **DataStore** definition, and the file does not ship in the image. `App_GKE` cannot mount a ConfigMap into the app container, so `Stalwart_Common` builds `FROM stalwartlabs/stalwart:<version>` with an entrypoint that renders the file from the foundation's `DB_IP`, `DB_PORT`, `DB_NAME` and `DB_USER` on every start. The password is not written into the file — its `authSecret` is `{ "@type": "EnvironmentVariable", "variableName": "DB_PASSWORD" }`.
2. **The database is MySQL 8.0, reached over the private IP.** `Stalwart_Common` sets `database_type = "MYSQL_8_0"` and `enable_cloudsql_volume = false`; the DataStore `host` is the raw Cloud SQL private IP. These values come from `Stalwart_Common` and override the wrapper's own `database_type` and `enable_cloudsql_volume` inputs, as does the container port (443).
3. **There is no initialization job.** The foundation's `db-create` step provisions the database and user, and Stalwart creates its own tables (27 on a fresh install) on first connect.
4. **The container serves on 443, never 8080.** Stalwart's normal HTTPS listener (admin UI, JMAP, `/healthz/live`) is 443. Port 8080 opens only in its bootstrap ("no configuration file was found") and recovery ("startup failed") states.
5. **Probes are TCP on 443.** The image's own `HEALTHCHECK` is `curl https://127.0.0.1:443/healthz/live || curl http://127.0.0.1:8080/healthz/live`, which reports a broken server as healthy via the 8080 fallback. An HTTP probe is not possible either: `App_GKE`'s HTTP probe has no `scheme` field, so it cannot check an HTTPS port.
6. **The Service is an L4 TCP LoadBalancer with the mail ports added.** `service_port = 443` plus `extra_service_ports` (25, 465, 587, 993, 995, 4190).
7. **Single replica by design.** A second replica needs Stalwart's coordinator, which needs Redis; the module avoids Redis. Note that the wrapper's `max_instance_count` default is `3` — set it to `1`.
8. **Domains, listeners and TLS are not configured.** Every Stalwart setting other than the DataStore lives in the database and is applied with `stalwart-cli` (a separate image). The module does not wire that step.

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE](./App_GKE.md#group-1--project--identity). Inputs: `project_id` (required), `tenant_id` (`"demo"`), `region` (`"us-central1"`).

---

## Group 2: Deployment Environment

Identical to `App_GKE`: `support_users` (`[]`) and `resource_labels` (`{}`).

---

## Group 3: Application Identity

| Variable | Stalwart GKE Default | Notes |
|---|---|---|
| `application_name` | `"stalwart"` | Base name for all GCP and Kubernetes resources. **Do not change after deployment.** |
| `application_display_name` | `"Wiki.js"` | A leftover from the module the wrapper was copied from. It is what the GCP Console, the static IP description and dashboards show — set it to `"Stalwart Mail Server"` or similar. |
| `application_description` | `"Wiki.js - The most powerful and extensible open source Wiki software"` | Also a leftover, but **not used** — the workload description comes from `Stalwart_Common` ("Stalwart — open-source mail and collaboration server…"). |
| `application_version` | `"v0.16.22"` | `stalwartlabs/stalwart` tag, passed to the build as `STALWART_VERSION`. **Pin an exact release** — this value overrides the `_Common` default. A rebuild under an unchanged tag produces no Terraform diff. |

---

## Group 4: Runtime & Scaling

| Variable | Stalwart GKE Default | Notes |
|---|---|---|
| `container_port` | `443` | **No effect** — `App_GKE` takes the container port from `Stalwart_Common`, which fixes it at 443, Stalwart's normal HTTPS listener (never 8080, the bootstrap/recovery port). The TCP probes check this port. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Also passed to `Stalwart_Common` as the container's limits. |
| `min_instance_count` | `1` | Keep at least one replica — mail must be received continuously. |
| `max_instance_count` | `3` | **Set to `1`.** Any value above 1 creates a HorizontalPodAutoscaler (min `min_instance_count`, max this value, scaling on CPU and memory utilisation) and a PodDisruptionBudget. A second replica requires Stalwart's coordinator, which requires Redis, which this module does not configure. |
| `container_image_source` | `"custom"` | Builds the wrapper image. `"prebuilt"` would deploy an image without the `config.json` generator; Stalwart would then find no configuration and open port 8080. |
| `container_image` | `"stalwartlabs/stalwart"` | Base image reference. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |
| `enable_cloudsql_volume` | `true` | **No effect** — `Stalwart_Common` always sets it to `false` (no Auth Proxy sidecar). |
| `service_annotations` / `service_labels` | `{}` | Applied to the Kubernetes Service **at creation only**; `App_GKE` ignores later changes to them. |

---

## Group 5: Environment Variables & Secrets

These variables behave identically to `App_GKE`. See [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

**Stalwart-specific behaviour:**

`Stalwart_Common` sets two environment variables, and `environment_variables` is merged over them:

| Variable | Default | Purpose |
|---|---|---|
| `STALWART_PUBLIC_URL` | `""` | Published base URL for OAuth, OIDC and JMAP discovery. Left empty on purpose — a wrong value is handed to clients in discovery documents. The wrapper has no dedicated input for it; set it through `environment_variables` once you have a domain (e.g. `https://mail.example.com`). |
| `STALWART_DATASTORE_TYPE` | `"MySql"` | The DataStore `@type` the entrypoint renders, derived from the engine `Stalwart_Common` provisions. Do not override it. |

The entrypoint also reads `STALWART_DB_USE_TLS` and `STALWART_DB_ALLOW_INVALID_CERTS` (both default `false`) for the DataStore connection; the defaults are correct for Cloud SQL over the private IP.

**Bootstrap administrator — set it:**

Stalwart's administrator is supplied as `STALWART_RECOVERY_ADMIN`, with the value `username:password`. Store it in Secret Manager and map it in `secret_environment_variables`:

```bash
printf 'admin:%s' "$(openssl rand -base64 24)" | \
  gcloud secrets create stalwart-recovery-admin --data-file=- --project "$PROJECT"
```

```hcl
secret_environment_variables = {
  STALWART_RECOVERY_ADMIN = "stalwart-recovery-admin"
}
```

Without it, Stalwart generates a random administrator password and prints it to the container log **once**; the entrypoint logs `recovery_admin=<unset - a random password will be printed below>` just before.

The remaining secrets variables (`secret_rotation_period`, `secret_propagation_delay`, `protect_sensitive_environment_variables`) behave as described in [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Group 6: Kubernetes Service, Workload & Ports

| Variable | Default | Notes |
|---|---|---|
| `service_type` | `"LoadBalancer"` | An external passthrough Network Load Balancer (`networking.gke.io/load-balancer-type: External`). Mail protocols need this — a Gateway/Ingress carries HTTP only. |
| `service_port` | `443` | Primary Service port (named `http`), targeting container port 443. |
| `session_affinity` | `"ClientIP"` | Requests from one client IP go to the same pod. |
| `workload_type` | `"StatefulSet"` | Stable identity plus the per-pod PVC in Group 7. |
| `namespace_name` | `""` | Derived from the service name when empty. |
| `enable_network_segmentation` | `false` | Kubernetes NetworkPolicies. |
| `termination_grace_period_seconds` | `30` | Seconds between SIGTERM and SIGKILL. |

**Port map.** `extra_service_ports` (a Group 0, platform-managed input) adds the mail ports to the same Service. Each targets the same port on the container and uses TCP:

| Port | Name | Protocol |
|---|---|---|
| `443` | `http` | HTTPS — admin UI, JMAP, `/healthz/live`. TLS is terminated by Stalwart, not by Google. |
| `25` | `smtp` | SMTP. Inbound only in practice — Google Cloud blocks outbound 25. |
| `465` | `submissions` | SMTP submission, implicit TLS. |
| `587` | `submission` | SMTP submission (STARTTLS); also the port for relaying outbound mail through a smart host. |
| `993` | `imaps` | IMAP, implicit TLS. |
| `995` | `pop3s` | POP3, implicit TLS. |
| `4190` | `managesieve` | ManageSieve (verified to return Stalwart's own banner). |

Plaintext IMAP (143) and POP3 (110) are omitted on purpose — the implicit-TLS ports do the same job without a cleartext credential path. Port 8080 is not published. GKE creates the firewall rules for a `LoadBalancer` Service automatically. The variable's own description still says it is "declared but NOT forwarded"; that text is out of date — `main.tf` forwards it to `App_GKE`.

---

## Group 7: Stateful Workloads

| Variable | Default | Notes |
|---|---|---|
| `stateful_pvc_enabled` | `true` | One PVC per pod. |
| `stateful_pvc_mount_path` | `"/var/lib/stalwart"` | Stalwart's working directory and local state. Mail itself is stored in the Cloud SQL DataStore. |
| `stateful_pvc_size` | `"10Gi"` | Size of each PVC. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Balanced PD. StatefulSet PVC templates are immutable — choose the class before the first deploy. |
| `stateful_fs_group` | `0` | Pod `fsGroup`. |
| `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy` | `null` | `App_GKE` defaults (`OrderedReady`, `RollingUpdate`). |

`/etc/stalwart` is deliberately **not** persisted — `config.json` is regenerated from the platform's variables on every start.

---

## Group 9: Reliability Policies

`enable_pod_disruption_budget` (`true`) and `pdb_min_available` (`"1"`). `App_GKE` creates the PDB only when `max_instance_count > 1`; with the recommended `max_instance_count = 1` no PDB exists. See [App_GKE](./App_GKE.md).

---

## Group 10: Observability & Health

Unlike wrappers whose probes come from their `_Common` module's own variables, `Stalwart GKE` passes `startup_probe_config` and `health_check_config` to `Stalwart_Common`, so **these two inputs are the probes on the Stalwart container**.

**Startup probe (`startup_probe_config`):**

| Field | Default | Notes |
|---|---|---|
| `type` | `"TCP"` | TCP connect to `container_port` (443). Do not switch to HTTP — the probe cannot speak HTTPS. |
| `initial_delay_seconds` | `60` | |
| `timeout_seconds` | `5` | |
| `period_seconds` | `10` | |
| `failure_threshold` | `3` | |

**Liveness probe (`health_check_config`):** `TCP`, `initial_delay_seconds = 60`, `timeout_seconds = 5`, `period_seconds = 30`, `failure_threshold = 3`.

**What the probe catches.** It fails a server that did not start (only 8080 is bound then). It does **not** fail a server that started with its DataStore connected but no server configuration — 443 is bound in that state as well, and on the verified deployment both 443 and 8080 answered `/healthz/live` with 200. Checking that 8080 is closed is an operator task:

```bash
kubectl exec -n "$NS" <pod> -- curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz/live
```

A fully configured server refuses that connection. **Do not repoint a failing probe at 8080.**

`uptime_check_config` defaults to `{ enabled = false, path = "/" }`. Without a Gateway, `App_GKE`'s uptime check is a plain-HTTP (no SSL) check against `service_port` on the external address — but Stalwart serves 443 over HTTPS only, so leave it disabled.

---

## Group 11: Jobs & Additional Services

No initialization job is defined — leave `initialization_jobs = []`. `cron_jobs` and `additional_services` behave as in [App_GKE](./App_GKE.md#group-11--workload-automation).

---

## Group 12: CI/CD & Binary Authorization

Identical to `App_GKE`. See [App_GKE](./App_GKE.md#group-12--cicd).

---

## Groups 13 and 14: Storage

| Variable | Default | Notes |
|---|---|---|
| `enable_nfs` | `true` | Mounts an NFS share at `nfs_mount_path` (`"/mnt/nfs"`). Stalwart does not read or write it; its state is on the PVC and in Cloud SQL. |
| `create_cloud_storage` | `true` | Creates the generic `data` bucket from `storage_buckets`. `Stalwart_Common` declares no buckets of its own. |
| `gcs_volumes` | `[]` | No GCS FUSE mounts by default. |

The remaining storage and image-retention inputs behave as in [App_GKE](./App_GKE.md#group-13--nfs-storage).

---

## Group 15: Redis

`enable_redis` defaults to `false`; leave it off. Redis would only be needed for multiple replicas, and Stalwart's Redis connection is a URL (`redis://user:pass@host:port`), into which a Memorystore AUTH string would have to be percent-encoded — the module does not do that.

---

## Group 16: Database

| Variable | Default | Notes |
|---|---|---|
| `database_type` | `"MYSQL_8_0"` | Used only by plan-time validation. The engine provisioned and rendered into `config.json` is set by `Stalwart_Common` (MySQL 8.0); the wrapper does not forward this value to it. |
| `application_database_name` / `application_database_user` | `"stalwart"` | **Inert** — the foundation names the database and user after the service. |
| `database_password_length` | `32` | Do not change on a running deployment — it writes a new password to Secret Manager without updating the database user. |
| `enable_postgres_extensions` | `false` | Not applicable to MySQL; leave `false`. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Stalwart reads the password from the `DB_PASSWORD` environment variable, so a rotated password takes effect when the pod is restarted after rotation. |

---

## Group 17: Backup

Identical to `App_GKE`: `backup_schedule` (`"0 2 * * *"`, a Kubernetes CronJob), `backup_retention_days` (`7`, a lifecycle rule on the backups bucket), and the `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` restore inputs.

---

## Group 18: Custom SQL Scripts

Identical to `App_GKE`. Scripts run against the Stalwart database over the private IP. Do not alter the tables Stalwart owns.

---

## Group 19: Custom Domain, Static IP & Network Tags

| Variable | Default | Notes |
|---|---|---|
| `reserve_static_ip` | `true` | Reserves a **regional** static external IP and assigns it to the LoadBalancer Service, so MX and DNS records have a stable target. (It is not applied while Cloud Deploy is enabled.) |
| `static_ip_name` | `""` | Auto-generated as `<service-name>-lb-ip` when empty. |
| `enable_custom_domain` | `false` | Leave `false`. `true` creates a Gateway, which is HTTP-only and duplicates the 443 already on the LoadBalancer — and uses another external IP. |
| `application_domains` | `[]` | Only used with a Gateway. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags. |

---

## Groups 20–22: IAP, Cloud Armor & CDN, VPC Service Controls

`enable_iap`, `enable_cloud_armor` and `enable_cdn` all act on a Gateway (HTTP); enabling Cloud Armor or CDN creates one. None of them protects the mail ports on the LoadBalancer. VPC Service Controls and audit logging (Group 22) are identical to [App_GKE](./App_GKE.md).

---

## Validation Guards

`validation.tf` fails the plan when `min_instance_count > max_instance_count`; when `enable_redis = true` with neither `redis_host` nor `enable_nfs`; when `enable_iap = true` without both OAuth client fields; or when `enable_cloudsql_volume = true` with `database_type = "NONE"`.

---

## Exploring the Deployment

### Google Cloud Console

- **Kubernetes Engine → Workloads** — the Stalwart StatefulSet and its pod.
- **Kubernetes Engine → Gateways, Services & Ingress** — the LoadBalancer Service with its seven ports and external IP.
- **VPC network → IP addresses** — the reserved `…-lb-ip` address.
- **SQL** — the Cloud SQL instance holding the Stalwart database.
- **Secret Manager** — the database password and your `STALWART_RECOVERY_ADMIN` secret.

### gcloud CLI and kubectl

```bash
# Cluster credentials
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"

# Namespace, pod, Service and PVC
NS=$(kubectl get ns -o name | grep stalwart | head -1 | cut -d/ -f2)
kubectl get statefulset,pods,svc,pvc -n "$NS"

# The ports published on the LoadBalancer
kubectl get svc -n "$NS" -o jsonpath='{range .items[*].spec.ports[*]}{.name}{"\t"}{.port}{"\n"}{end}'

# Startup lines written by the entrypoint (DataStore target, admin state)
kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" | grep '\[startup\]'

# Health from inside the pod (443 must answer; 8080 should refuse once configured)
POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NS" "$POD" -- curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:443/healthz/live
kubectl exec -n "$NS" "$POD" -- curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/healthz/live

# Database password secret
gcloud secrets list --project "$PROJECT" --filter="name~stalwart"
```

---

## Module Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service |
| `namespace` | Kubernetes namespace |
| `service_cluster_ip` | ClusterIP of the Service |
| `service_external_ip` | External LoadBalancer IP — the address mail clients and MX records point to |
| `service_url` | Rendered as `http://` plus the external IP. Stalwart answers **HTTPS on 443**, so use `https://` + `service_external_ip`. |
| `database_instance_name` / `database_name` / `database_user` | Cloud SQL instance, database and user |
| `database_password_secret` | Secret Manager secret holding the DB password |
| `database_host` | Always reports `127.0.0.1` (the foundation's proxy default); Stalwart actually connects to the Cloud SQL private IP |
| `database_port` | Database port |
| `storage_buckets` | Created GCS buckets |
| `container_image` | Container image used for the deployment |
| `initialization_jobs` / `db_import_job` | Job names |
| `cicd_enabled` / `github_repository_url` | CI/CD status |
| `kubernetes_ready` | `true` when the cluster endpoint was reachable and the Kubernetes resources were deployed |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `startup_probe_config` / `health_check_config` | `type = "TCP"` | **Critical** | An `HTTP` probe cannot check Stalwart's HTTPS-only 443 and will fail a healthy pod. The probe port is fixed at 443 by `Stalwart_Common`; never work around a failing probe by targeting 8080, which answers exactly when Stalwart is unconfigured or has failed to start. |
| `container_image_source` | `"custom"` | **Critical** | Without the wrapper there is no `config.json`; Stalwart opens 8080 in bootstrap mode and serves no mail. |
| `STALWART_RECOVERY_ADMIN` | Set via `secret_environment_variables` | **High** | Unset, the only administrator password is printed once to the container log. |
| `max_instance_count` | `1` | **High** | The default `3` lets the HPA add replicas, which need a Redis-backed coordinator the module does not configure, and creates a PDB. |
| Server configuration (domains, listeners, TLS) | Apply with `stalwart-cli` after deploy | **High** | Not done by the module. Until it is, port 8080 stays open in the pod and external TLS connections were observed to be closed without a certificate. |
| Outbound mail | Smart host on 587 | **High** | Google Cloud blocks outbound port 25; direct MX delivery to other domains cannot work. |
| `database_password_length` | Leave unchanged | **High** | Changing it on a running deployment breaks database authentication. |
| `application_version` | An exact release tag | **Medium** | A rebuild under an unchanged tag creates no new pod template; `kubectl rollout restart` pulls the rebuilt image (pull policy `Always`). |
| `enable_custom_domain` / `enable_cloud_armor` / `enable_cdn` | `false` | **Medium** | Each creates a Gateway that carries HTTP only and consumes another external IP; mail ports are unaffected. |
| `reserve_static_ip` | `true` | **Medium** | With `false` the LoadBalancer gets an ephemeral IP that changes whenever the Service is recreated — MX records would go stale. |
| `stateful_pvc_storage_class` / `stateful_pvc_size` | Decide before first deploy | **Medium** | StatefulSet PVC templates are immutable; later changes do not apply to the existing PVC. |
| `application_display_name` | `"Stalwart Mail Server"` | **Low** | The shipped default shows `Wiki.js` in the Console and dashboards. |
| `enable_nfs` | `false` if nothing else needs it | **Low** | Defaults `true` and mounts an NFS share Stalwart never uses. |

<!-- related-guides -->

## Related guides

- [Hands-on lab: Stalwart on GKE Autopilot](../labs/Stalwart_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Stalwart Common Shared Configuration Module](Stalwart_Common.md) — the application layer this module builds on.
