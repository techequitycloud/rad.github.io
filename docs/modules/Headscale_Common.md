---
title: "Headscale Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Headscale module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Headscale Common — Shared Application Configuration

`Headscale_Common` is the **shared application layer** for Headscale. It is
not deployed on its own; instead it supplies the Headscale-specific
configuration that both [Headscale_GKE](Headscale_GKE.md) and
[Headscale_CloudRun](Headscale_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform
docs.

For the infrastructure that actually provisions and runs Headscale, see the
platform guides ([Headscale_GKE](Headscale_GKE.md),
[Headscale_CloudRun](Headscale_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Headscale_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps `headscale/headscale:<version>-debug` (a `ko`-built base) with a baked `config.yaml` and entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes `database_type = "NONE"` — Headscale is entirely embedded-SQLite | §Database in the platform guides |
| Storage | Declares the `storage` GCS bucket and the `/var/lib/headscale` mount (GCS Fuse on Cloud Run; conditionally on GKE) | `storage_buckets` output |
| Single-instance enforcement | Hardcodes `max_instance_count = 1` in the assembled `config` — the caller's variable value is never read | Runtime & Scaling in the platform guides |
| Core config | Baked `config.yaml`: SQLite backend, disabled embedded DERP, disabled MagicDNS, the `noise.private_key_path`/`dns` fields Headscale 0.26.1 requires | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |
| Secrets | None — `secret_ids`/`secret_values` are both empty maps | n/a |

---

## 2. No application-level secrets

Unlike most Common modules in this catalog, `Headscale_Common` generates
**no secrets at all**. There is no admin password, API token, or encryption
key to manage — Headscale has no built-in web login and no application-level
credential store of its own. `secret_ids` and `secret_values` are both empty
maps, forwarded as-is by both Application Modules.

---

## 3. Database engine — embedded SQLite only

`database_type = "NONE"` is fixed by `Headscale_Common`; no other database
backend is supported by this module. Headscale keeps its entire persistent
state in a single SQLite file:

```
/var/lib/headscale/db.sqlite              # + -wal / -shm sidecars (WAL mode)
/var/lib/headscale/noise_private.key      # Noise protocol (Tailscale v2) key, auto-generated
```

There is no separate database-initialization job — Headscale creates and
migrates its own schema automatically on first boot, the same way it would
on a bare-metal or VM deployment.

---

## 4. Container image — custom `ko`-built base with a thin wrapper

Unlike apps that deploy an official image directly, `Headscale_Common` sets
`image_source = "custom"` and ships a thin `Dockerfile`:

```dockerfile
ARG HEADSCALE_VERSION=0.26.1
FROM headscale/headscale:${HEADSCALE_VERSION}-debug

COPY config.yaml /etc/headscale/config.yaml
COPY entrypoint.sh /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/busybox/busybox", "sh", "/entrypoint.sh"]
```

`HEADSCALE_VERSION` resolves to the pinned `0.26.1` when
`application_version = "latest"` — the Dockerfile's own build ARG, distinct
from the generic `APP_VERSION` the Foundation injects (which would otherwise
force the tag to the non-existent `headscale:latest-debug`).

**Two real, live-confirmed gotchas found while building this image — caught
via local Docker testing before ever touching the cloud, which is itself a
validated methodology worth repeating for future custom-build modules:**

1. **The `-debug` tag was chosen for its bundled busybox, but that busybox is
   still not on `PATH` as `/bin/sh`.** Confirmed live:
   `docker run --entrypoint /bin/sh <image>` fails "no such file or
   directory". A `RUN chmod +x` build step and a `#!/bin/sh` shebang
   entrypoint both fail for the same reason. The fix: invoke the image's own
   `/busybox/busybox` binary directly — confirmed via `file` to be genuinely
   statically linked (unlike some other minimal base images elsewhere in this
   catalog that need an externally-grafted busybox) — via
   `ENTRYPOINT ["/busybox/busybox", "sh", "/entrypoint.sh"]`. No `chmod` is
   needed, since busybox interprets the script path as an argument rather
   than executing it as a file.
2. **The real Headscale binary lives at `/ko-app/headscale`, not
   `/usr/bin/headscale`.** The upstream image is built with Google's `ko`
   tool, which uses its own binary-placement convention rather than a
   conventional Dockerfile `COPY`. `entrypoint.sh` execs
   `/ko-app/headscale serve` directly.

---

## 5. Baked configuration — two fields 0.26.1 requires that upstream docs don't make obvious

`scripts/config.yaml` is baked into the image at build time. Only
`server_url`/`listen_addr` genuinely vary per deployment, and both are
overridden at runtime via the `HEADSCALE_SERVER_URL`/`HEADSCALE_LISTEN_ADDR`
env vars (Headscale is built on Viper, which auto-binds uppercase/underscore
env vars onto the equivalent config keys). Two fields had to be added beyond
a naive reading of Headscale's docs, both found via local testing:

- **`noise.private_key_path: /var/lib/headscale/noise_private.key`** —
  required by the Tailscale v2 Noise protocol. A missing key is normally
  auto-generated, but Headscale 0.26+ fails config validation outright
  ("headscale now requires a new `noise.private_key_path` field") if the
  field itself is absent from the file, not just unset.
- **A full `dns:` block**, with `magic_dns: false`, `override_local_dns:
  false`, and `nameservers.global: [1.1.1.1, 1.0.0.1]` explicit. Upstream
  docs say `override_local_dns` defaults to `false`, but 0.26.1 fails
  validation ("`dns.nameservers.global` must be set when
  `dns.override_local_dns` is true") unless the block is made explicit — the
  implicit zero-value default did not behave as documented in practice.

**MagicDNS is deliberately left disabled.** Enabling it requires
`dns.base_domain` to be set and genuinely different from `server_url`'s
domain. Since `server_url` is injected per-deployment at runtime, a single
baked `base_domain` cannot reliably satisfy that constraint across every
deployment. Clients still get Tailscale IP addressing without MagicDNS;
operators who want DNS-based hostnames can set both `base_domain` and
`magic_dns=true` via `environment_variables` post-deploy.

The embedded DERP relay is also left disabled (`derp.server.enabled: false`,
the upstream default) — clients rely on Tailscale's own public DERP relay
infrastructure for actual data relay when a direct peer-to-peer connection
isn't possible, keeping this control plane HTTP(S)-only with no UDP
requirement.

---

## 6. Storage — platform-dependent, and a genuine data-integrity distinction

Headscale's SQLite database needs real POSIX file locking for its WAL/journal
files:

- **Cloud Run:** `enable_gcs_storage_volume = true` always — `/var/lib/headscale`
  is mounted via GCS Fuse. This is a real, live-confirmed trade-off: gcsfuse
  does not reliably support the file locking SQLite's WAL mode needs
  (confirmed via repeated `BufferedWriteHandler.OutOfOrderError` log entries
  for `db.sqlite`/`db.sqlite-wal`/`db.sqlite-shm`, falling back to a slower
  legacy write path). It is only acceptable here because `max_instance_count`
  is hard-pinned to `1` — no fix is available on Cloud Run itself (no
  block-volume alternative exists there).
- **GKE:** `Headscale_GKE` defaults `stateful_pvc_enabled = true`, mounting a
  real block-storage PVC at the same path instead. `Headscale_GKE`'s
  `main.tf` sets `enable_gcs_storage_volume = !coalesce(var.stateful_pvc_enabled, false)`
  when calling this module, so the PVC and the GCS Fuse mount are mutually
  exclusive — never double-mounted. Confirmed live: GKE's logs are
  completely free of the gcsfuse write errors seen on Cloud Run.

---

## 7. Single instance only — hardcoded, not merely defaulted

`Headscale_Common`'s `locals.headscale_module.max_instance_count` is a
**literal `1`**, independent of whatever value either Application Module's
`max_instance_count` variable holds — that variable is declared for
convention-mirroring and UI purposes, but its value is never read here.
Headscale's own upstream docs confirm there is no built-in HA/active-active
support ("if one goes down, the whole tailnet is unreachable"), and two
writers against the same SQLite file would corrupt it regardless of storage
backend. `min_instance_count`, by contrast, **is** forwarded from the caller
and defaults to `0` on both platforms — unlike apps with a database or search
index to warm at boot, Headscale's SQLite file and WireGuard key make cold
starts fast.

---

## 8. Health probe behaviour

The default probes target `/health` — a real, unauthenticated endpoint
Headscale exposes for exactly this purpose (confirmed live returning HTTP 200
alongside "listening and serving HTTP" in the application logs).

| Probe | Type | Path | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/health` | 15s | 10s | 10 |
| Liveness | HTTP | `/health` | 30s | 30s | 3 |

---

## 9. First-run setup is a manual, post-deploy operator step

Headscale ships with no web-based signup flow and no default admin account.
Creating the first "user" (namespace) and issuing a pre-auth key for
registering client nodes both happen via the `headscale` CLI, run against the
same `/ko-app/headscale` binary the running service uses — `headscale users
create <name>` followed by `headscale preauthkeys create --user <name>`. See
the platform guides' Application Behaviour sections and the hands-on labs for
the concrete Cloud Run Job / `kubectl exec` mechanics on each platform.

---

For the Headscale-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Headscale_GKE](Headscale_GKE.md)** and
**[Headscale_CloudRun](Headscale_CloudRun.md)**.
