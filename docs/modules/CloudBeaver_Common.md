---
title: "CloudBeaver Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the CloudBeaver module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# CloudBeaver Common — Shared Application Configuration

`CloudBeaver_Common` is the **shared application layer** for CloudBeaver. It is not
deployed on its own; instead it supplies the CloudBeaver-specific configuration that
both [CloudBeaver_GKE](CloudBeaver_GKE.md) and
[CloudBeaver_CloudRun](CloudBeaver_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

CloudBeaver is a web-based, browser-accessible database manager from the DBeaver
project: an administrative console for connecting to and querying PostgreSQL, MySQL,
SQL Server, Oracle, SQLite and many other engines through a single web UI. It is
self-contained — it stores its own state (an embedded metadata database, saved
connections, users and configuration) in a workspace directory and requires **no
external application database** of its own.

For the infrastructure that actually provisions and runs CloudBeaver, see the
platform guides ([CloudBeaver_GKE](CloudBeaver_GKE.md),
[CloudBeaver_CloudRun](CloudBeaver_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by CloudBeaver_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `dbeaver/cloudbeaver` image via a thin Dockerfile so the foundation can build/mirror it into **Artifact Registry** | `container_image` output of the platform deployment |
| Container port | Fixes the web UI port at **8978** | §Compute in the platform guides |
| Database engine | Sets `database_type = "NONE"` — CloudBeaver provisions **no Cloud SQL**; it keeps its own state in the workspace volume | §Application behaviour in the platform guides |
| Persistent storage | Declares a **Cloud Storage** bucket (`storage` suffix) and a workspace volume mounted at `/opt/cloudbeaver/workspace` | `storage_buckets` output; §Persistence in the platform guides |
| Secrets | Emits **empty** `secret_ids` / `secret_values` — CloudBeaver needs no service-level secret to boot (the admin account is created by the first-run setup wizard) | §Secrets in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` (HTTP 200 once the UI is ready) | §Observability in the platform guides |
| Scaling defaults | `min_instance_count = 1`, `max_instance_count = 1` — a single-writer JVM service | §Scaling in the platform guides |

---

## 2. Container image and build

CloudBeaver ships as a prebuilt upstream image, `dbeaver/cloudbeaver`. This layer
wraps it in a **thin Dockerfile** (`scripts/Dockerfile`) so the foundation can build
it with Cloud Build (Kaniko) and mirror the result into the deployment's Artifact
Registry repository:

```dockerfile
ARG CLOUDBEAVER_VERSION=latest
FROM dbeaver/cloudbeaver:${CLOUDBEAVER_VERSION}
```

- **`image_source = "custom"`** with `container_build_config.enabled = true` — the
  image is built (mirrored) rather than pulled directly.
- **`CLOUDBEAVER_VERSION` is an app-specific build ARG.** The foundation injects the
  generic `APP_VERSION` (and would force it to `latest`); the Dockerfile deliberately
  reads its **own** `CLOUDBEAVER_VERSION` ARG instead so a pinned
  `application_version` propagates correctly. The upstream `dbeaver/cloudbeaver:latest`
  tag is valid, so `latest` passes through cleanly.
- No custom entrypoint is grafted — the upstream image's own startup is used
  unchanged. The admin account is created interactively via the setup wizard on first
  access, so no boot-time seeding is required.

Inspect the deployed image:

```bash
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'   # Cloud Run
```

---

## 3. No application database

Unlike DB-backed apps, `CloudBeaver_Common` sets **`database_type = "NONE"`**. The
platform provisions **no Cloud SQL instance, no application database, and no db-init
job** for CloudBeaver. All of CloudBeaver's own state — its embedded H2 metadata
database, the connection definitions, the users it manages, and its configuration —
lives entirely in the workspace directory (`/opt/cloudbeaver/workspace`), which is
backed by the persistent volume described below.

The databases CloudBeaver *administers* are entirely separate: an operator adds them
in the CloudBeaver UI after deployment (for example, pointing at the deployment's own
shared Cloud SQL over the VPC). Those connections are not provisioned by this module.

Because there is no application database, `initialization_jobs` defaults to empty and
no bootstrap job is injected. Operator-supplied `initialization_jobs` are still
forwarded verbatim if provided.

---

## 4. Persistent storage — the workspace

CloudBeaver persists **all** of its state under a fixed workspace directory,
`/opt/cloudbeaver/workspace`. That path is baked into the upstream image and is not
env-configurable, so it must be the mount target of the persistent volume. This layer
declares a single **Cloud Storage** bucket for that purpose:

```hcl
storage_buckets = [{ name_suffix = "storage", storage_class = "STANDARD", ... }]
```

How the workspace is actually mounted differs by platform:

- **Cloud Run** — the bucket is mounted as a **GCS FUSE** volume named `storage` at
  `/opt/cloudbeaver/workspace` (`enable_gcs_storage_volume` defaults to `true` in this
  layer).
- **GKE** — when a StatefulSet **block PVC** is enabled (`stateful_pvc_enabled = true`,
  the recommended setup), the PVC is mounted at the same path and the layer
  automatically sets `enable_gcs_storage_volume = false` to avoid a double-mount at
  `/opt/cloudbeaver/workspace`. A block PVC — not GCS FUSE — is the correct backing
  store for CloudBeaver's embedded H2 database.

List the bucket after deployment:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 5. No service secrets

`CloudBeaver_Common` emits **empty** `secret_ids` and `secret_values` outputs on
purpose. CloudBeaver requires no service-level secret env var to boot: the
administrator account is created interactively through the first-run **setup wizard**
on first access, and all state lives in the persistent workspace. The empty maps are
kept so the variant wiring (`module_secret_env_vars = secret_ids`,
`explicit_secret_values = secret_values`) resolves cleanly.

> **Security note.** Because the admin account is claimed by whoever completes the
> setup wizard first, complete it immediately after the service is reachable and keep
> ingress restricted until you have. See the platform guides.

---

## 6. Health probe behaviour

The default startup and liveness probes are HTTP checks targeting the root path `/` —
CloudBeaver serves its web UI there and returns **HTTP 200** once the JVM has fully
started and the workspace is ready. Because the endpoint is public and unauthenticated
(the login/setup page), it is a valid probe target for both the Cloud Run front-end
and the GKE kubelet.

- **Cloud Run** — startup probe HTTP `/`, 15 s initial delay, 10-failure window;
  liveness probe HTTP `/`, 30 s initial delay.
- **GKE** — the same HTTP `/` probe defaults, tuned for the JVM startup time.

CloudBeaver is JVM-based and cold-starts slowly, which is why both variants default
`min_instance_count = 1`.

---

## 7. Scaling model

CloudBeaver's workspace is a **single-writer** store (an embedded H2 database plus
file-based config). Running more than one instance against the same workspace corrupts
that state. Both variants therefore default to a single instance:

- **`min_instance_count = 1`** — keep one warm instance to avoid slow JVM cold starts.
- **`max_instance_count = 1`** — never run a second writer against the workspace.

There is no Redis and no queue: `enable_redis` is forced to `false` in both variants.

---

For the CloudBeaver-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[CloudBeaver_GKE](CloudBeaver_GKE.md)** and
**[CloudBeaver_CloudRun](CloudBeaver_CloudRun.md)**.
