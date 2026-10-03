---
title: "Jitsi Common Shared Configuration Module"
description: "Shared configuration reference for the Jitsi module — application-layer settings consumed by the GKE Autopilot deployment."
---

# Jitsi Common Shared Configuration Module

The `Jitsi Common` module defines the Jitsi Meet video-conferencing configuration for the RAD Modules ecosystem. It produces a `config` output consumed by the platform wrapper module `Jitsi GKE`. Unlike most Common modules it is **not** purely declarative: it generates two internal XMPP component passwords and stores them in Secret Manager.

## 1. Overview

**Purpose**: To centralise all Jitsi-specific configuration — the four images and their shared release tag, the internal XMPP domain family, the environment for each component, the three back-end `additional_services`, and the shared component passwords — in one module.

**Architecture**:

```
Layer 3: Application Wrapper
└── Jitsi_GKE  ── reserves the jvb static IP, computes the prosody Service name,
                  instantiates Jitsi_Common
                           ↓
              Jitsi_Common (this module)
              Creates: 2 random passwords + 2 Secret Manager secrets (+ versions)
              Produces: config, secret_ids, secret_values, storage_buckets, path
                           ↓
Layer 2: Platform Module
└── App_GKE       (Kubernetes deployment)
                           ↓
Layer 1: App_Common (networking, storage, secrets, IAM)
```

There is no Cloud Run variant: the videobridge needs inbound UDP and a fixed public address.

**Key characteristics**:
- **Four images, one tag.** `jitsi/web` is the main container; `jitsi/prosody`, `jitsi/jicofo` and `jitsi/jvb` are `additional_services`. All four use `application_version` (default `stable-11031`).
- **Prebuilt, no Dockerfile.** All four images are driven purely by environment variables (s6 + confd templates), so `image_source = "prebuilt"` and the build config is disabled. The module has no `scripts/` directory.
- **No database.** `database_type = "NONE"`; conference state is in prosody's memory.
- **Media on UDP.** jvb is exposed as a UDP `LoadBalancer` pinned to an address the wrapper reserves. This build has no TCP media fallback.
- **Generated, shared component passwords** for jicofo and jvb, read by prosody and the matching component from the same Kubernetes Secret.

---

## 2. Outputs

### `config`
The application configuration object passed to `App_GKE` via `application_config`.

| Field | Value / Description |
|---|---|
| `app_name` | `var.application_name` (default `"jitsi"`) |
| `application_version` | `var.application_version` (default `"stable-11031"`) |
| `display_name` / `description` | `var.display_name` / `var.description` |
| `container_image` | `"jitsi/web"` |
| `image_source` | `"prebuilt"` |
| `enable_image_mirroring` | `var.enable_image_mirroring` (default `true`) |
| `container_build_config` | `enabled = false`, all other fields `null`/empty |
| `container_port` | `80` — the Gateway terminates TLS and forwards plain HTTP |
| `database_type` | `"NONE"` (`db_name`/`db_user` empty) |
| `enable_cloudsql_volume` | `false` |
| `gcs_volumes` | `[]` |
| `container_resources` | `cpu_limit = var.cpu_limit` (`"1000m"`), `memory_limit = var.memory_limit` (`"2Gi"`), requests `null` |
| `min_instance_count` / `max_instance_count` | `var.min_instance_count` (`1`) / `var.max_instance_count` (`3`) — the web tier only |
| `environment_variables` | Web-container variables (see §4) merged with `var.environment_variables` |
| `secret_environment_variables` | `JICOFO_AUTH_PASSWORD`, `JVB_AUTH_PASSWORD` (Secret Manager ids) merged with `var.secret_environment_variables` |
| `initialization_jobs` | `[]` |
| `startup_probe` / `liveness_probe` | `var.startup_probe` / `var.liveness_probe` (see §6) |
| `additional_services` | prosody, jicofo, jvb (see §5) |

### `secret_ids`
`{ JICOFO_AUTH_PASSWORD = <secret id>, JVB_AUTH_PASSWORD = <secret id> }`. The wrapper passes this as `module_secret_env_vars`.

### `secret_values` (sensitive)
The raw generated passwords. The wrapper passes them as `explicit_secret_values` so the **first** apply succeeds — the Foundation's plan-time Secret Manager lookup cannot read a version that the same apply has not yet created.

### `storage_buckets`
`[]` — Jitsi needs no buckets.

### `path`
The module directory.

---

## 3. Input Variables

### Application

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"jitsi"` | Base name; also part of the secret ids. |
| `application_version` | `string` | `"stable-11031"` | Tag applied to all four images. The wrapper's value wins. |
| `display_name` | `string` | `"Jitsi Meet"` | Display name. |
| `description` | `string` | `"Jitsi Meet — open-source video conferencing: browser-based meetings with no account required."` | Description. |
| `cpu_limit` | `string` | `"1000m"` | Web container CPU limit. |
| `memory_limit` | `string` | `"2Gi"` | Web container memory limit. |
| `min_instance_count` | `number` | `1` | Minimum web replicas. |
| `max_instance_count` | `number` | `3` | Maximum web replicas. |
| `environment_variables` | `map(string)` | `{}` | Extra web-container env vars, merged over the module's. |
| `secret_environment_variables` | `map(string)` | `{}` | Extra web-container secret env vars. |
| `enable_image_mirroring` | `bool` | `true` | Mirror the web image into Artifact Registry. |
| `startup_probe` / `liveness_probe` | `object` | see §6 | Web container probes. |

### Jitsi-specific

| Variable | Type | Default | Description |
|---|---|---|---|
| `public_url` | `string` | `""` | `PUBLIC_URL` for web and prosody — the URL browsers use. Not derived when empty. |
| `xmpp_domain` | `string` | `"meet.jitsi"` | Root of the internal XMPP domain family. Not public DNS. |
| `xmpp_server_host` | `string` | `""` | prosody's Service DNS name. Set by the wrapper (`<service-name>-prosody`); do not override. |
| `jvb_port` | `number` | `10000` | UDP media port. |
| `jvb_loadbalancer_ip` | `string` | `""` | Reserved external IP jvb advertises. Set by the wrapper from a `google_compute_address`. |
| `enable_auth` | `bool` | `false` | Require authentication to create a room. |
| `enable_guests` | `bool` | `true` | Let unauthenticated users join rooms created by an authenticated user. |
| `timezone` | `string` | `"UTC"` | `TZ` for every container. |

### Secrets placement

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | `""` | Project for the two Secret Manager secrets. |
| `resource_prefix` | `string` | `""` | Prefix in the secret ids (`secret-<prefix>-<application_name>-jicofo-auth`). |
| `region` | `string` | `"us-central1"` | The single replica location of both secrets. |

### Declared but unused

`labels`, `deployment_id_suffix`, `service_url`, `admin_username` (Jitsi has no administrator account or admin UI), `admin_email`, `tenant_id` (validated, not otherwise used), `db_name`, `db_user`, `gcs_volumes`, `initialization_jobs`, `enable_cloudsql_volume` and `enable_gcs_storage_volume` are declared for interface consistency but not read by `main.tf`. The descriptions on `startup_probe` and `enable_gcs_storage_volume` mention phinx/MySQL and a CMS library; they were carried over from another module and do not describe Jitsi.

---

## 4. Environment Variables

### Web container (`jitsi/web`)

| Variable | Value | Purpose |
|---|---|---|
| `TZ` | `var.timezone` | Container timezone. |
| `PUBLIC_URL` | `var.public_url` | Public URL written into the served config. |
| `XMPP_DOMAIN` | `var.xmpp_domain` | Main XMPP virtual host. |
| `XMPP_AUTH_DOMAIN` | `auth.<xmpp_domain>` | Authenticated users. |
| `XMPP_GUEST_DOMAIN` | `guest.<xmpp_domain>` | Guests. |
| `XMPP_MUC_DOMAIN` | `muc.<xmpp_domain>` | Conference rooms. |
| `XMPP_INTERNAL_MUC_DOMAIN` | `internal-muc.<xmpp_domain>` | Internal component rooms (bridge brewery). |
| `XMPP_RECORDER_DOMAIN` | `recorder.<xmpp_domain>` | Recorder domain. |
| `XMPP_SERVER` | `var.xmpp_server_host` | Where prosody actually runs. |
| `XMPP_BOSH_URL_BASE` | `http://<xmpp_server_host>:5280` | prosody BOSH/WebSocket endpoint that web proxies to. |
| `XMPP_WEBSOCKET` | `/xmpp-websocket` | Path on the public origin; the browser's XMPP WebSocket goes through web's nginx. |
| `ENABLE_AUTH` / `ENABLE_GUESTS` | `"1"` or `"0"` | Room-creation policy. |
| `ENABLE_LETSENCRYPT` | `"0"` | The Gateway terminates TLS; an in-pod certificate attempt would fail its HTTP-01 challenge. |
| `DISABLE_HTTPS` | `"1"` | The container serves HTTP only. |

### Back-end containers

| Container | Variables |
|---|---|
| prosody | `TZ`, `PUBLIC_URL`, all six `XMPP_*_DOMAIN` values, `JICOFO_AUTH_USER = "focus"`, `JVB_AUTH_USER = "jvb"`, `ENABLE_AUTH`, `ENABLE_GUESTS`; secrets `JICOFO_AUTH_PASSWORD`, `JVB_AUTH_PASSWORD` |
| jicofo | `TZ`, `XMPP_DOMAIN`, `XMPP_AUTH_DOMAIN`, `XMPP_INTERNAL_MUC_DOMAIN`, `XMPP_MUC_DOMAIN`, `XMPP_RECORDER_DOMAIN`, `XMPP_SERVER`, `JICOFO_AUTH_USER = "focus"`, `JVB_BREWERY_MUC = "jvbbrewery"`, `ENABLE_AUTH`; secrets as above |
| jvb | `TZ`, `XMPP_DOMAIN`, `XMPP_AUTH_DOMAIN`, `XMPP_INTERNAL_MUC_DOMAIN`, `XMPP_SERVER`, `JVB_AUTH_USER = "jvb"`, `JVB_BREWERY_MUC = "jvbbrewery"`, `JVB_PORT`, `JVB_ADVERTISE_IPS` and `DOCKER_HOST_ADDRESS` (both = `jvb_loadbalancer_ip`; both names are set because templates in this tag still read the older one in places), `JVB_DISABLE_STUN = "true"`; secrets as above |

`var.environment_variables` is merged into the **web** container only.

---

## 5. Additional Services

There are no initialization jobs. The back end is three `additional_services`, each built from a shared defaults object that supplies every field the Foundation reads (a module-supplied object bypasses the typed variable's optional defaults). Each runs exactly one replica (`min_instance_count = max_instance_count = 1`) and has no probes.

| Name | Image | Port(s) | Protocol | Service | Memory limit |
|---|---|---|---|---|---|
| `prosody` | `jitsi/prosody:<version>` | 5222; extra 5280 (`bosh`), 5347 (`xmpp-component`) | TCP | ClusterIP | `1Gi` |
| `jicofo` | `jitsi/jicofo:<version>` | 8888 (health/REST; required only to build a Service) | TCP | ClusterIP | `2Gi` |
| `jvb` | `jitsi/jvb:<version>` | `var.jvb_port` (10000) | **UDP** | **LoadBalancer** (`ingress = INGRESS_TRAFFIC_ALL`) on `loadbalancer_ip = var.jvb_loadbalancer_ip` | `2Gi` |

All three have a `1000m` CPU limit. The jvb entry depends on `App_GKE`'s per-service `protocol` field (default `"TCP"`), added for this module; GCP does not allow one LoadBalancer Service to mix TCP and UDP, so jvb has its own Service.

---

## 6. Health Probes

The probes apply to the **web** container only. `Jitsi_GKE` forwards its `startup_probe_config` and `health_check_config` into these variables, so the wrapper's values are what is deployed.

| Probe | `Jitsi_Common` default | As deployed by `Jitsi_GKE` (wrapper default) |
|---|---|---|
| Startup | HTTP `/`, 30s delay, 10s timeout, 15s period, 20 failures | HTTP `/`, 60s delay, 5s timeout, 10s period, 3 failures |
| Liveness | HTTP `/`, 60s delay, 10s timeout, 30s period, 3 failures | HTTP `/`, 60s delay, 5s timeout, 30s period, 3 failures |

---

## 7. Secrets

| Resource | Detail |
|---|---|
| `random_password.jicofo_auth`, `random_password.jvb_auth` | 32 characters, no special characters. Machine credentials, never typed by a human. |
| `google_secret_manager_secret.jicofo_auth` | `secret-<prefix>-<application_name>-jicofo-auth` |
| `google_secret_manager_secret.jvb_auth` | `secret-<prefix>-<application_name>-jvb-auth` |

Replication is `user_managed` with a single replica in `var.region`, not automatic: automatic replication registers the secret in location `global`, which the folder-level `constraints/gcp.resourceLocations` policy on RAD-managed projects denies. Replication is ignored after creation.

If prosody and a component ever see different passwords, prosody starts but refuses the component, and calls connect with no media — the same symptom as blocked UDP. Keeping both sides on one Kubernetes Secret is what prevents it.

---

## 8. Implementation Pattern

`Jitsi_GKE` instantiates `Jitsi_Common` like this (abridged):

```hcl
resource "google_compute_address" "jvb" {
  name         = "${module.deployment_id.service_name}-jvb"
  region       = local.region
  address_type = "EXTERNAL"
}

module "jitsi_app" {
  source = "../Jitsi_Common"

  project_id          = var.project_id
  resource_prefix     = module.deployment_id.tenant_resource_prefix
  xmpp_server_host    = "${module.deployment_id.service_name}-prosody"
  jvb_loadbalancer_ip = google_compute_address.jvb.address
  jvb_port            = var.jvb_port
  public_url          = var.public_url
  xmpp_domain         = var.xmpp_domain
  enable_auth         = var.enable_auth
  enable_guests       = var.enable_guests
  timezone            = var.timezone

  application_version = var.application_version
  cpu_limit           = var.container_resources.cpu_limit
  memory_limit        = var.container_resources.memory_limit
  startup_probe       = var.startup_probe_config
  liveness_probe      = var.health_check_config
  region              = local.region
  # ... other inputs
}

module "app_gke" {
  source = "../App_GKE"

  application_config     = { jitsi = local.jitsi_module }
  module_secret_env_vars = module.jitsi_app.secret_ids
  explicit_secret_values = module.jitsi_app.secret_values
  module_storage_buckets = module.jitsi_app.storage_buckets
  # ... other inputs
}
```

Because the prosody Service name is computed from the same `deployment_id` module `App_GKE` uses, it is known at plan time and cannot drift from the Service actually created.

<!-- related-guides -->

## Related guides

- [Jitsi GKE Module — Configuration Guide](Jitsi_GKE.md) — this configuration deployed on GKE.
- [Hands-on lab: Jitsi on GKE Autopilot](../labs/Jitsi_GKE.md) — deploy and operate it step by step.
