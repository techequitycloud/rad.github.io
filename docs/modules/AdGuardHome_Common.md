---
title: "AdGuardHome Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the AdGuardHome module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# AdGuardHome Common — Shared Application Configuration

`AdGuardHome_Common` is the **shared application layer** for AdGuard Home. It
is not deployed on its own; instead it supplies the AdGuard-Home-specific
configuration that both [AdGuardHome_GKE](AdGuardHome_GKE.md) and
[AdGuardHome_CloudRun](AdGuardHome_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

> ⚠️ **CRITICAL scope note.** AdGuard Home's core value (network-wide DNS
> ad/tracker blocking) requires clients to query it on port 53 (TCP+UDP).
> **Neither Cloud Run nor GKE's standard HTTP(S) Gateway pattern used by these
> modules can expose raw port 53.** This layer wires up AdGuard Home's **web
> admin console only** (port 3000) for filter-list, rule, and client
> configuration management. The deployed instance is **not reachable as a
> public DNS resolver** on either platform.

For the infrastructure that actually provisions and runs AdGuard Home, see the
platform guides ([AdGuardHome_GKE](AdGuardHome_GKE.md),
[AdGuardHome_CloudRun](AdGuardHome_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by AdGuardHome_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `adguard/adguardhome` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | No external database (`database_type = "NONE"`) — configuration is a flat YAML file | §Database in the platform guides |
| Persistent storage | Declares TWO Cloud Storage buckets (`conf`, `work`) and mounts them via GCS Fuse | `storage_buckets` output; `gcs_volumes` in `config` |
| Core settings | Fixes `container_port = 3000` (the setup wizard's port) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` | §Observability in the platform guides |
| Secrets | None — the admin credential is set through AdGuard Home's own first-run web wizard | `secret_ids` output is `{}` |

---

## 2. Container image and entrypoint

The custom image (`modules/AdGuardHome_Common/scripts/Dockerfile`) wraps
`adguard/adguardhome:<version>` with a thin shell entrypoint
(`adguardhome-entrypoint.sh`):

- **Ensures `conf/` and `work/` are writable**, falling back to `/tmp` (with a
  loud warning that nothing there survives a restart) if the GCS Fuse mounts
  are somehow unavailable — protects against a silent crash-loop under a
  misconfigured deployment.
- **Logs the DNS-scope limitation** on every container boot, so it is visible
  in Cloud Logging even without reading this documentation.
- **Builds the full AdGuard Home invocation explicitly**
  (`--no-check-update -c <conf>/AdGuardHome.yaml -h 0.0.0.0 -w <work>`) rather
  than relying on any inherited `CMD` — declaring a custom `ENTRYPOINT` in a
  Dockerfile discards the base image's own `CMD`, so this repo's convention is
  to have the entrypoint script supply the full command itself.

The base tag is driven by an app-specific `ADGUARDHOME_VERSION` build ARG, not
the generic `APP_VERSION` (which the Foundation injects into `build_args` and
would otherwise win the merge). AdGuard Home publishes plain semver release
tags (no `latest-<suffix>` combos), so `application_version = "latest"`
already resolves correctly on Docker Hub — the pinned fallback (`v0.107.63`)
exists only so a fresh build never silently depends on a moving tag.

Retrieve the built image:

```bash
gcloud artifacts docker images list <artifact-repo> --project "$PROJECT" --filter="package~adguardhome"
```

---

## 3. Persistent storage (no database bootstrap)

AdGuard Home has no external database and needs no first-deploy schema/init
job — `AdGuardHome_Common`'s `initialization_jobs` config simply passes through
whatever the operator supplies (empty by default). Instead, this layer
provisions **two** Cloud Storage buckets and mounts each as a separate GCS
Fuse volume:

| Bucket (`name_suffix`) | Mount path | Contents |
|---|---|---|
| `conf` | `/opt/adguardhome/conf` | `AdGuardHome.yaml` — all configuration (DNS filters, clients, upstream servers, the admin account), written by the first-run setup wizard |
| `work` | `/opt/adguardhome/work` | Query log and stats database |

Two separate buckets/mounts are used — rather than one mount at
`/opt/adguardhome` — because that parent directory also holds the AdGuardHome
binary itself; mounting a single GCS Fuse volume there would shadow the binary
and break the container (`exec: no such file or directory`), the same
volume-shadowing failure class documented for other apps in this catalogue
that co-locate a binary and its data directory.

Both `gcs_volumes` entries are declared with `bucket_name = null`, so the
Foundation auto-resolves the actual bucket name by matching the volume's
`name` against the `storage_buckets` output's `name_suffix` — no manually
computed bucket-name string is needed (and none can drift out of sync).

Inspect after deployment:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~adguardhome"
gcloud storage cat gs://<conf-bucket>/AdGuardHome.yaml
```

---

## 4. Health probe behaviour

The default probes target `/` — AdGuard Home has no dedicated health
endpoint, but its admin-console root returns `200` both before initial setup
(the setup wizard page) and after (the login page or dashboard). Both Cloud
Run and GKE variants default to an HTTP `GET /` startup and liveness probe.

---

## 5. What this layer deliberately does NOT provide

- **No DNS-port exposure.** This layer does not attempt to wire up port 53 —
  see the scope note at the top of this document. A raw L4
  `Service type=LoadBalancer` for port 53 is possible in principle on GKE
  (unlike Cloud Run, which cannot do this at all) but is out of scope for this
  first cut.
- **No secrets.** No API token, admin password, or encryption key is
  generated or injected. The admin username/password are set entirely through
  AdGuard Home's own first-run web setup wizard and stored in its own YAML
  config on the persistent `conf` volume.
- **No Redis, no queue, no worker process.** AdGuard Home is a single static
  binary; `enable_redis` has no effect for this application.

---

For the AdGuard-Home-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[AdGuardHome_GKE](AdGuardHome_GKE.md)** and
**[AdGuardHome_CloudRun](AdGuardHome_CloudRun.md)**.
