---
title: "Jitsi GKE Module — Configuration Guide"
description: "Configuration reference for deploying Jitsi on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Jitsi GKE Module — Configuration Guide

This guide describes every configuration variable available in the `Jitsi_GKE` module. `Jitsi_GKE` is a **wrapper module** that combines the generic [`App_GKE`](./App_GKE.md) infrastructure module with the [`Jitsi_Common`](./Jitsi_Common.md) shared application configuration to deploy [Jitsi Meet](https://jitsi.org/jitsi-meet/) — open-source, browser-based video conferencing with no account required to join — on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Jitsi GKE` map directly to the same options in `App GKE`. Where a variable is identical in behaviour, this guide references the `App GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Jitsi** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

> **GKE only:** Jitsi's videobridge carries all audio and video over **UDP port 10000** and must advertise a fixed public address to browsers. Cloud Run cannot accept inbound UDP, so Jitsi is offered on GKE only.

---

## Standard Configuration Reference

The following configuration areas are provided by the underlying `App_GKE` module. Consult the linked sections of the [App_GKE Configuration Guide](./App_GKE.md) for full documentation.

| Configuration Area | App_GKE Guide Section | Jitsi-Specific Notes |
|---|---|---|
| Project & Identity | Group 1 — Project & Identity | Identical. `region` also places the videobridge's static IP. |
| Application Identity | Group 3 — Application Identity | `application_version` pins **all four** images; see [Group 3](#group-3-application-identity). |
| Runtime & Scaling | Group 4 — Runtime & Scaling | `container_image_source = "prebuilt"`, `container_port = 80`; see [Group 4](#group-4-runtime--scaling). |
| Environment Variables & Secrets | Group 5 — Environment Variables & Secrets | Jitsi-specific inputs `public_url`, `xmpp_domain`, `enable_auth`, `enable_guests`, `timezone`; see [Group 5](#group-5-environment-variables--secrets). |
| GKE Backend Configuration | Group 6 — GKE Backend Config | `service_type = "ClusterIP"`; adds `jvb_port`; see [Group 6](#group-6-gke-backend-configuration). |
| Additional Services | Group 11 — Workload Automation | prosody, jicofo and jvb are supplied by `Jitsi Common`; see [Group 11](#group-11-workload-automation). |
| Storage — NFS | Group 13 — NFS Storage | Enabled by default but unused by Jitsi; see [Group 13](#group-13-nfs). |
| Storage — GCS | Group 14 — Cloud Storage | A `data` bucket is created by default but unused by Jitsi; see [Group 14](#group-14-cloud-storage). |
| Database Configuration | Group 16 — Database Configuration | **No database** — engine fixed at `NONE`; see [Group 16](#group-16-database). |
| Backup Schedule & Retention | Group 17 — Backup & Maintenance | Not applicable (no database). |
| Custom SQL Scripts | Group 18 — Custom SQL Scripts | Not applicable (no database). |
| Observability & Health Checks | Group 10 — Observability | `startup_probe_config` / `health_check_config` **are** the deployed web probes; see [Group 10](#group-10-observability--health). |
| Cloud Armor WAF | Group 21 — Cloud Armor & CDN | Protects the web entry point only — not the jvb UDP load balancer. |
| Identity-Aware Proxy | Group 20 — Identity-Aware Proxy | Protects the web entry point only. |
| Binary Authorization | Group 12 — CI/CD | Identical. |
| VPC Service Controls | Group 22 — VPC Service Controls & Audit Logging | Identical. |
| Secrets Store CSI Driver | Group 5 — Environment Variables & Secrets | Always enabled — no configuration required. |
| Traffic & Ingress | Group 19 — Access & Networking | Web through the Gateway; media through a separate UDP LoadBalancer. |
| Custom Domain & Static IP | Group 19 — Access & Networking | Set `public_url` to match; see [Group 19](#group-19-custom-domain--networking). |
| Cloud Build Triggers | Group 12 — CI/CD | Identical. |
| Cloud Deploy Pipeline | Group 12 — CI/CD | Identical. |
| Image Mirroring | Group 4 — Runtime & Scaling | Applies to the web image. |
| Pod Disruption Budgets | Group 9 — Reliability | Enabled by default for the web workload. |
| Redis Cache | Group 15 — Redis Cache | Not used by any Jitsi component. |

---

## How Jitsi GKE Relates to App GKE

`Jitsi GKE` passes its variables through to `App GKE` and adds a `Jitsi Common` sub-module that supplies the Jitsi-specific configuration. It also creates one resource of its own. The main effects are:

1. **Four images, one tag.** `jitsi/web` is the main container; `jitsi/prosody`, `jitsi/jicofo` and `jitsi/jvb` are supplied as `additional_services`. All four use the `application_version` tag (default `stable-11031`). Mixing releases is unsupported — jicofo and jvb speak a versioned protocol to prosody — and none of the images has a `latest` tag.
2. **No build, no database.** `container_image_source = "prebuilt"`: the upstream images are configured entirely through environment variables, so there is no Dockerfile. `database_type` is fixed at `NONE` by `Jitsi Common`; no Cloud SQL instance, database user or initialization job is created.
3. **A reserved address for the videobridge.** The wrapper creates a regional external `google_compute_address` named `<service-name>-jvb` and passes it to jvb as `JVB_ADVERTISE_IPS` (and `DOCKER_HOST_ADDRESS`). jvb hands this address to browsers inside ICE candidates, so it must be known before jvb starts — an ephemeral LoadBalancer IP is only known afterwards. `JVB_DISABLE_STUN = "true"` because the advertised address is already public.
4. **Media on its own UDP LoadBalancer.** jvb's Service is a `LoadBalancer` on **UDP 10000** pinned to that address. GCP does not allow one LoadBalancer Service to mix TCP and UDP, so jvb cannot share the web Service. There is no TCP fallback in this build.
5. **Web behind the Gateway.** `service_type = "ClusterIP"`; the browser reaches `jitsi/web` on port 80 through the L7 Gateway, which terminates TLS. The container is told not to do TLS itself (`ENABLE_LETSENCRYPT = 0`, `DISABLE_HTTPS = 1`).
6. **prosody is found by Service name.** Upstream's docker-compose reaches prosody through a network alias. Kubernetes has none, so the wrapper computes the prosody Service name (`<service-name>-prosody`) from the same `deployment_id` module `App GKE` uses and sets it as `XMPP_SERVER`.
7. **Generated component passwords.** `Jitsi Common` generates `JICOFO_AUTH_PASSWORD` and `JVB_AUTH_PASSWORD`, stores them in Secret Manager (regional, user-managed replication), and all three back-end containers read them from the same Kubernetes Secret, so prosody provisions the accounts with exactly the passwords the components use.
8. **Probes reach the deployed container.** Unlike some wrappers, `Jitsi GKE` forwards `startup_probe_config` and `health_check_config` into `Jitsi Common` as the web container's `startup_probe`/`liveness_probe`, so changing them changes the deployed probes. The back-end containers have no probes.

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE](./App_GKE.md#group-1--project--identity).

| Variable | Default | Description |
|---|---|---|
| `project_id` | *(required)* | GCP project into which `Services_GCP` has been deployed. |
| `tenant_id` | `"demo"` | 1–7 lowercase alphanumeric characters appended to resource names. |
| `region` | `"us-central1"` | Fallback region when VPC subnet discovery cannot determine one. The discovered (or fallback) region is also where the jvb static IP and the two Secret Manager replicas are created. |

---

## Group 2: Deployment Environment

Identical to `App_GKE`: `support_users` (`[]`) receive monitoring alerts; `resource_labels` (`{}`) are applied to every resource.

---

## Group 3: Application Identity

| Variable | Jitsi GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"jitsi"` | `"gkeapp"` | Base name for all GCP and Kubernetes resources. **Do not change after deployment.** |
| `application_display_name` | `"Jitsi Meet"` | `"App GKE Application"` | Shown in the platform UI. Can be changed freely. |
| `application_description` | `"Jitsi Meet — open-source video conferencing: browser-based meetings with no account required."` | — | Descriptive label. |
| `application_version` | `"stable-11031"` | `"1.0.0"` | Tag applied to **all four** images. Change it only to another published `stable-NNNN` that exists for web, prosody, jicofo and jvb. |

---

## Group 4: Runtime & Scaling

| Variable | Jitsi GKE Default | Notes |
|---|---|---|
| `container_image_source` | `"prebuilt"` | Keep `"prebuilt"`. Jitsi ships no Dockerfile; `"custom"` would render a Cloud Build step with no Dockerfile to build. |
| `container_image` | `"jitsi/web"` | The web image; the tag comes from `application_version`. |
| `enable_image_mirroring` | `true` | Mirrors the web image into Artifact Registry. |
| `container_port` | `80` | Fixed by `Jitsi Common` — `jitsi/web` serves plain HTTP on 80. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Applies to the **web** container only, and only the limits are forwarded. The back-end containers have fixed limits: prosody `1000m`/`1Gi`, jicofo `1000m`/`2Gi`, jvb `1000m`/`2Gi`. |
| `min_instance_count` | `1` | Minimum web replicas. |
| `max_instance_count` | `3` | Maximum web replicas. prosody, jicofo and jvb are fixed at **one replica each** and are not scaled by these variables. |
| `enable_cloudsql_volume` | `false` | No database. Setting it `true` is rejected at plan time while `database_type = "NONE"`. |

The remaining runtime variables (`deploy_application`, `container_build_config`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) behave as described in [App_GKE](./App_GKE.md#group-4--runtime--scaling).

---

## Group 5: Environment Variables & Secrets

These Jitsi-specific variables are passed into `Jitsi Common`:

| Variable | Default | Description |
|---|---|---|
| `public_url` | `""` | Public URL browsers use, e.g. `"https://meet.example.com"`. Set as `PUBLIC_URL` on web and prosody and written into the config the web app serves — a wrong value gives a page that loads and then cannot connect. **Not derived automatically.** |
| `xmpp_domain` | `"meet.jitsi"` | Root of the internal XMPP domain family. `auth.`, `guest.`, `muc.`, `internal-muc.` and `recorder.` subdomains are derived from it. These are prosody's virtual hosts, never resolved in public DNS. All four containers must agree — leave the default unless you know why you are changing it. |
| `enable_auth` | `false` | `ENABLE_AUTH`: require authentication to **create** a room. |
| `enable_guests` | `true` | `ENABLE_GUESTS`: let unauthenticated participants join rooms an authenticated user created. |
| `timezone` | `"UTC"` | `TZ` on every container. |

**Environment variables the module sets on `jitsi/web`:**

| Variable | Value |
|---|---|
| `PUBLIC_URL` | `var.public_url` |
| `XMPP_DOMAIN`, `XMPP_AUTH_DOMAIN`, `XMPP_GUEST_DOMAIN`, `XMPP_MUC_DOMAIN`, `XMPP_INTERNAL_MUC_DOMAIN`, `XMPP_RECORDER_DOMAIN` | Derived from `xmpp_domain` |
| `XMPP_SERVER` | `<service-name>-prosody` |
| `XMPP_BOSH_URL_BASE` | `http://<service-name>-prosody:5280` |
| `XMPP_WEBSOCKET` | `/xmpp-websocket` (a path on the public origin, proxied by web) |
| `ENABLE_AUTH`, `ENABLE_GUESTS` | `"1"`/`"0"` from the variables above |
| `ENABLE_LETSENCRYPT` | `"0"` |
| `DISABLE_HTTPS` | `"1"` |

`environment_variables` entries are merged **over** these on the web container (they do not reach prosody, jicofo or jvb). `secret_environment_variables` adds to the two generated component passwords.

**Secrets created by `Jitsi Common`:**

| Secret | Env var | Read by |
|---|---|---|
| `secret-<prefix>-jitsi-jicofo-auth` | `JICOFO_AUTH_PASSWORD` | prosody, jicofo |
| `secret-<prefix>-jitsi-jvb-auth` | `JVB_AUTH_PASSWORD` | prosody, jvb |

Both are 32-character random values with no special characters, replicated to the deployment region only (`user_managed`), because the folder location policy on RAD-managed projects denies `global` secrets.

The remaining variables (`protect_sensitive_environment_variables`, `secret_propagation_delay`, `secret_rotation_period`) behave as described in [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Group 6: GKE Backend Configuration

| Variable | Jitsi GKE Default | Notes |
|---|---|---|
| `service_type` | `"ClusterIP"` | The web Service. The Gateway already has an external address; a `LoadBalancer` here allocates a **second** external IP for the same HTTP surface, which on a quota-capped project can leave both the web and jvb load balancers stuck in `<pending>`. |
| `service_port` | `80` | Port on the web Service. |
| `jvb_port` | `10000` | UDP port of the videobridge Service and `JVB_PORT`. The jvb Service is always `LoadBalancer` and always UDP. |
| `session_affinity` | `"ClientIP"` | Web Service affinity. |
| `workload_type` | `"Deployment"` | The web workload. |
| `termination_grace_period_seconds` | `30` | — |
| `deployment_strategy` | `null` | Declared but not referenced — no effect. |

`namespace_name` and `enable_network_segmentation` behave as described in [App_GKE](./App_GKE.md#group-6--gke-backend-config).

---

## Group 7: Stateful Workloads

Identical to `App_GKE`. Jitsi stores nothing on disk, so `stateful_pvc_enabled` (default `false`) should stay off.

---

## Group 9: Reliability Policies

| Variable | Default | Notes |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Creates a PodDisruptionBudget for the web workload. |
| `pdb_min_available` | `"1"` | With a single web replica this means voluntary evictions (node upgrades) wait for a replacement. |

---

## Group 10: Observability & Health

`startup_probe_config` and `health_check_config` are forwarded into `Jitsi Common` as the **web** container's startup and liveness probes, so they are the probes that actually run.

| Probe | Path | Initial delay | Timeout | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup (`startup_probe_config`) | `/` (HTTP) | 60s | 5s | 10s | 3 |
| Liveness (`health_check_config`) | `/` (HTTP) | 60s | 5s | 30s | 3 |

prosody, jicofo and jvb have no probes, so a back-end container that is running but not connected (for example jvb refused by prosody) is not restarted automatically — check their logs.

`uptime_check_config` defaults to `{ enabled = false, path = "/" }`. `alert_policies` behaves as described in [App_GKE](./App_GKE.md#group-10--observability).

---

## Group 11: Workload Automation

`Jitsi Common` always supplies three `additional_services`; your own `additional_services` entries are **appended** to them.

| Service | Image | Service type | Ports | Limits |
|---|---|---|---|---|
| `prosody` | `jitsi/prosody:<version>` | ClusterIP | TCP 5222, 5280 (`bosh`), 5347 (`xmpp-component`) | `1000m` / `1Gi` |
| `jicofo` | `jitsi/jicofo:<version>` | ClusterIP | TCP 8888 (required to build a Service; nothing connects to it) | `1000m` / `2Gi` |
| `jvb` | `jitsi/jvb:<version>` | **LoadBalancer** on the reserved IP | **UDP** `jvb_port` (10000) | `1000m` / `2Gi` |

Each runs one replica. jicofo joins the `jvbbrewery` MUC on the internal MUC domain to discover the bridge; prosody provisions the `focus` (jicofo) and `jvb` accounts.

`initialization_jobs` is empty (Jitsi needs none) and `cron_jobs` behaves as described in [App_GKE](./App_GKE.md#group-11--workload-automation).

---

## Group 12: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE](./App_GKE.md#group-12--cicd). Variables: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.

---

## Group 13: NFS

| Variable | Default | Notes |
|---|---|---|
| `enable_nfs` | `true` | Mounts the `Services_GCP` NFS share into the web pod. No Jitsi component reads or writes it. |
| `nfs_mount_path` | `"/mnt/nfs"` | — |

`nfs_volume_name`, `nfs_instance_name` and `nfs_instance_base_name` behave as described in [App_GKE](./App_GKE.md#group-13--nfs-storage).

---

## Group 14: Cloud Storage

`create_cloud_storage = true` with the default `storage_buckets = [{ name_suffix = "data" }]` creates one bucket. Jitsi does not use it, and `Jitsi Common` declares no buckets of its own. The remaining storage and image-retention variables behave as described in [App_GKE](./App_GKE.md#group-14--cloud-storage).

---

## Group 15: Redis

`enable_redis` (default `false`), `redis_host`, `redis_port`, `redis_auth` behave as in [App_GKE](./App_GKE.md#group-15--redis-cache). No Jitsi component uses Redis.

---

## Group 16: Database

Jitsi has no database. `Jitsi Common` sets `database_type = "NONE"` in the application config, and that is what `App GKE` provisions regardless of the wrapper's own `database_type` (default `"NONE"`), which only feeds the plan-time validation guards. `application_database_name`/`application_database_user` (`"jitsi"`), `database_password_length`, the PostgreSQL/MySQL extension variables, `enable_auto_password_rotation` and the `db_*_env_var_name` aliases have no effect.

---

## Groups 17–18: Backup & Maintenance, Custom SQL

Not applicable. `enable_backup_import` and `enable_custom_sql_scripts` are rejected at plan time while `database_type = "NONE"`.

---

## Group 19: Custom Domain & Networking

Identical to `App_GKE`. See [App_GKE](./App_GKE.md#group-19--access--networking).

| Variable | Default | Notes |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions the Gateway for the web Service. |
| `application_domains` | `[]` | Empty uses a free `nip.io` hostname derived from the Gateway's reserved IP, with a Google-managed certificate. |
| `reserve_static_ip` | `true` | Global static IP for the Gateway (separate from the regional jvb IP). |

> **Set `public_url` to match.** When serving on a custom domain, set `public_url = "https://<your-domain>"`. Browsers grant camera and microphone access only on secure (HTTPS) origins, so test calls over the HTTPS URL.

---

## Groups 20–22: IAP, Cloud Armor, VPC Service Controls

Identical to `App_GKE` — see [App_GKE](./App_GKE.md#group-20--identity-aware-proxy). IAP and Cloud Armor apply to the Gateway (the web entry point). They do **not** sit in front of the jvb UDP load balancer, which must accept media from every participant's network.

---

## Exploring the Deployment

### Google Cloud Console

**Workloads:** **Kubernetes Engine → Workloads**, filtered to the deployment's namespace, shows four Deployments — the web workload plus `<service-name>-prosody`, `<service-name>-jicofo` and `<service-name>-jvb`.

**Services:** **Kubernetes Engine → Gateways, Services & Ingress** shows the web Service (ClusterIP), the prosody and jicofo Services (ClusterIP) and the jvb Service (`LoadBalancer`, UDP).

**IP addresses:** **VPC Network → IP Addresses** lists the regional `*-jvb` address and the Gateway's global address.

**Secrets:** **Security → Secret Manager** lists the `*-jicofo-auth` and `*-jvb-auth` secrets.

### gcloud CLI and kubectl

```bash
# Cluster credentials
gcloud container clusters get-credentials CLUSTER_NAME --region=REGION --project=PROJECT_ID

# All four workloads and their Services
kubectl get deploy,pods,svc -n NAMESPACE

# The videobridge's reserved address and its UDP forwarding rule
gcloud compute addresses list --project=PROJECT_ID --filter="name~jvb"
gcloud compute forwarding-rules list --project=PROJECT_ID --filter="IPProtocol=UDP"

# jicofo has authenticated to prosody and found the bridge
kubectl logs -n NAMESPACE deploy/SERVICE_NAME-jicofo | grep -E "authenticated|addJvbAddress"

# jvb advertises the public address (StaticMappingCandidateHarvester ... mask=<public-ip>)
kubectl logs -n NAMESPACE deploy/SERVICE_NAME-jvb | grep StaticMapping

# The web front end
curl -s -o /dev/null -w "%{http_code}\n" SERVICE_URL/
```

---

## Module Outputs

`Jitsi GKE` exposes the standard `App_GKE` outputs. The ones relevant to Jitsi:

| Output | Description |
|---|---|
| `service_name` | Name of the web Kubernetes Service (also the prefix of the prosody/jicofo/jvb Services) |
| `service_url` | URL of the web entry point (the Gateway `nip.io` URL when no custom domain is set) |
| `service_external_ip` | External LoadBalancer IP (if static IP is reserved) |
| `namespace` | Kubernetes namespace |
| `deployment_id` / `resource_prefix` | Naming identifiers |
| `storage_buckets` | Created GCS buckets |
| `container_image` | Web container image |
| `kubernetes_ready` | `true` when the cluster endpoint was reachable and Kubernetes resources were deployed |

The database outputs are empty. There is no output for the jvb address — read it from the jvb Service or the `*-jvb` compute address.

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable / condition | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `project_id` | _(required)_ | **Critical** | No default — deployment fails immediately. |
| UDP 10000 to the jvb IP blocked | — | **Critical** | Calls join and list participants but carry no audio or video. There is no TCP fallback. Check client networks and any firewall in front of them. |
| `application_version` | `"stable-11031"` | **High** | All four images take this tag. A tag missing from any one image fails that pod's pull; mismatched releases between components are unsupported. |
| `public_url` | `""` | **High** | Written into the served config. A value that does not match the URL users browse to gives a page that loads and then cannot connect. |
| `xmpp_domain` | `"meet.jitsi"` | **High** | Every container derives its XMPP virtual hosts from it; changing it is rarely needed and a mismatch stops components binding. |
| `service_type` | `"ClusterIP"` | **Medium** | `"LoadBalancer"` adds a second external IP for the web surface and can exhaust the project's external-address quota, leaving the jvb load balancer `<pending>`. |
| `jvb_port` | `10000` | **High** | Changing it changes the Service and `JVB_PORT` together; any client-side allowlist must change too. |
| `container_image_source` | `"prebuilt"` | **High** | `"custom"` has no Dockerfile to build; the build fails. |
| `enable_auth` | `false` | **Medium** | With auth off, anyone who can reach the URL can create rooms. |
| `enable_cloudsql_volume` | `false` | **Low** | `true` is rejected at plan time (no database). |
| `enable_nfs` / `create_cloud_storage` | `true` / `true` | **Low** | Provisioned but unused by Jitsi — a small, avoidable cost. |
| `max_instance_count` | `3` | **Low** | Scales only the web tier; it does not add videobridge capacity. |
| `enable_pod_disruption_budget` | `true` | **Low** | With one web replica, node drains wait for a replacement pod. |
| First apply of a fresh deployment (OpenTofu run directly) | — | **Medium** | The `Jitsi_Common` README records a plan failure (`local.additional_services will be known only after apply`) while the jvb address is not yet in state; it was resolved by `tofu apply -target=google_compute_address.jvb`, then `tofu apply`. |

<!-- related-guides -->

## Related guides

- [Hands-on lab: Jitsi on GKE Autopilot](../labs/Jitsi_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Jitsi Common — Shared Application Configuration](Jitsi_Common.md) — the Jitsi-specific configuration this module builds on.
