---
title: "Passbolt Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Passbolt module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Passbolt Common — Shared Application Configuration

`Passbolt_Common` is the **shared application layer** for Passbolt. It is not
deployed on its own; instead it supplies the Passbolt-specific configuration
that both [Passbolt_GKE](Passbolt_GKE.md) and [Passbolt_CloudRun](Passbolt_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of
its own — but understanding what it provides explains the defaults you see in
the platform docs.

For the infrastructure that actually provisions and runs Passbolt, see the
platform guides ([Passbolt_GKE](Passbolt_GKE.md),
[Passbolt_CloudRun](Passbolt_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. What this layer provides

| Area | Provided by Passbolt_Common | Where it surfaces |
|---|---|---|
| Container image | The official `passbolt/passbolt` image, deployed as-is — genuinely prebuilt, no custom Dockerfile or Cloud Build step | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL** (`MYSQL_8_0`) as the only supported engine, using discrete `DATASOURCES_DEFAULT_*` env var names | §Database in the platform guides |
| Database bootstrap | Defines a 2-stage initialization job chain — `db-init` → `admin-bootstrap` | `initialization_jobs` output |
| Cryptographic state | Two purpose-built GCS volumes (`storage` at `/etc/passbolt/gpg`, `jwt` at `/etc/passbolt/jwt`) holding the vendor-self-generated GPG server keypair and JWT keypair | `storage_buckets` output |
| Secrets | **None.** Passbolt has no Terraform-generated secret of its own — `secret_ids`/`secret_values` are always empty `{}` | §Secrets below |
| HTTPS URL generation | Statically injects `HTTPS = "on"` so Passbolt's `bootstrap.php` generates `https://` URLs despite edge-terminated TLS | `config.environment_variables` |
| Health checks | Supplies the default startup/liveness probe targeting `GET /healthcheck/status.json` | §Observability in the platform guides |

---

## 2. Container image — genuinely prebuilt, no entrypoint wrapper

Unlike many application modules in this catalog that wrap their upstream image
with a custom `entrypoint.sh` to bridge platform env var conventions,
`Passbolt_Common` deploys the official `passbolt/passbolt` image **as-is**:

```hcl
container_image        = "passbolt/passbolt"
image_source            = "prebuilt"
container_build_config = { enabled = false, ... }
```

There is no custom Dockerfile and no Cloud Build step. Instead, the Application
Modules bridge the platform's standard `DB_HOST`/`DB_USER`/`DB_NAME`/`DB_PASSWORD`
convention onto Passbolt's own discrete CakePHP/PDO env var names via the
Foundation's aliasing mechanism:

```hcl
db_host_env_var_name     = "DATASOURCES_DEFAULT_HOST"
db_user_env_var_name     = "DATASOURCES_DEFAULT_USERNAME"
db_name_env_var_name     = "DATASOURCES_DEFAULT_DATABASE"
db_password_env_var_name = "DATASOURCES_DEFAULT_PASSWORD"
```

confirmed against the vendor's own `/passbolt/env.sh`, which reads exactly
these names.

---

## 3. Database engine

Passbolt requires **MySQL**; the engine is fixed to `MYSQL_8_0` and other
engines are not supported (Passbolt's CakePHP schema is MySQL-only). Both
Application Modules run the shared catalog-wide `db-init.sh` script
(`mysql:8.0-debian`), which is `caching_sha2_password`-safe — it detects
whether a Cloud SQL Auth Proxy Unix socket is available and falls back to TCP
via the private IP otherwise, creates the role and database, grants
privileges, and verifies the app user can actually connect before completing.

---

## 4. The GPG server keypair and JWT keypair — self-healing, vendor-native state

This is Passbolt's most distinctive infrastructure requirement in this
catalog, and the reason its bootstrap flow looks nothing like a typical
WordPress/Laravel-style app. Confirmed by reading the actual
`passbolt/passbolt` image's `/passbolt/entrypoint.sh` source:

1. **The GPG server keypair.** The vendor entrypoint generates
   `/etc/passbolt/gpg/serverkey.asc` and
   `/etc/passbolt/gpg/serverkey_private.asc` on first boot **only if those
   files don't already exist**, then reuses them on every subsequent boot.
   `Passbolt_Common` doesn't generate this key — it just gives the path a
   persistent volume.
2. **The JWT keypair.** Same self-healing pattern, at `/etc/passbolt/jwt`.

Both are mounted as **separate, narrowly-scoped** volumes — `storage` at
`/etc/passbolt/gpg`, `jwt` at `/etc/passbolt/jwt` — deliberately not the whole
`/etc/passbolt` directory, which would shadow baked-in config/PHP files
(`app.php`, `bootstrap.php`, `routes.php`) that live directly under
`/etc/passbolt` in the image. This is the same volume-shadowing trap already
documented in this catalog for Cloudreve, where mounting a fresh block volume
over a directory that contains both the app binary and its data hides the
binary.

```hcl
gcs_volumes = tolist(concat(
  [for v in var.gcs_volumes : { ... }],   # operator-supplied extras
  [
    { name = "storage", mount_path = "/etc/passbolt/gpg", mount_options = [...uid=33...] },
    { name = "jwt",      mount_path = "/etc/passbolt/jwt", mount_options = [...uid=33...] },
  ]
))
```

### GKE-specific: the GCS Fuse UID must match the actual runtime user

Even though the `passbolt/passbolt` image's top-level container process runs
as root (no `USER` directive in the image), the vendor entrypoint's
`gpg_gen_key()` function performs the actual key-export step as
`su ... www-data` (uid=33/gid=33) — confirmed via reading
`/passbolt/entrypoint.sh`. GKE's GCS Fuse CSI driver, unlike Cloud Run's own
gcsfuse integration, does not default to a writable mount for a non-root UID.
Without an explicit override, `www-data` gets `EACCES: permission denied`
writing the GPG/JWT key files on first boot. Both volumes therefore set:

```hcl
mount_options = [
  "implicit-dirs",
  "stat-cache-ttl=60s",
  "type-cache-ttl=60s",
  "uid=33",
  "gid=33",
  "file-mode=0664",
  "dir-mode=0775",
]
```

This is the second confirmed instance of this exact bug *class* found in this
catalog on the same day — once for a uid-1000 Node app, once for this uid-33
PHP/`www-data` case. The general lesson: verify the actual runtime UID of
whatever process writes to a GCS-Fuse-mounted path, not just the image's
declared `USER`.

---

## 5. The 2-stage initialization job chain

1. **`db-init`** (`mysql:8.0-debian`, `depends_on_jobs = []`) — the shared
   catalog-wide MySQL init script (see §3).

2. **`admin-bootstrap`** (`passbolt/passbolt:<version>`,
   `depends_on_jobs = ["db-init"]`, mounts the `storage` and `jwt` volumes) —
   registers the initial admin account. This job exists specifically because
   Cloud Run Jobs and Kubernetes Jobs invoke a container's `command`/`args`
   **directly**, bypassing the vendor's own `/docker-entrypoint.sh` chain
   entirely. A naive `cake passbolt register_user` on a freshly-provisioned
   container fails with an Internal Error 500, because the GPG server keypair
   (normally generated during the vendor entrypoint's own boot sequence)
   doesn't exist yet, and the schema hasn't been installed either.

   The job instead replicates the relevant slice of the vendor's actual boot
   sequence:
   ```bash
   source /passbolt/entrypoint.sh
   source /passbolt/env.sh
   source /passbolt/deprecated_paths.sh

   manage_docker_env
   check_deprecated_paths

   mkdir -p "$passbolt_config/gpg"
   if [ ! -f "$gpg_private_key" ] || [ ! -f "$gpg_public_key" ]; then
     gpg_gen_key
     gpg_import_key
   else
     gpg_import_key
   fi

   if [ ! -f "$ssl_key" ] && [ ! -L "$ssl_key" ] && [ ! -f "$ssl_cert" ] && [ ! -L "$ssl_cert" ]; then
     gen_ssl_cert
   fi

   install    # also handles JWT key generation and schema install/migrate

   su -c '/usr/share/php/passbolt/bin/cake passbolt register_user \
     -u "<admin_email>" -f "<admin_first_name>" -l "<admin_last_name>" -r admin' \
     -s /bin/bash www-data
   ```

   Every step is confirmed against the real vendor `/passbolt/entrypoint.sh`
   source, not guessed. The job is idempotent — `gpg_gen_key`/`install()`
   no-op once the keys and schema already exist from a prior run. Crucially,
   `register_user` is run **without** the `-q`/quiet flag, so the one-time
   setup URL (`https://<host>/setup/start/<user-id>/<token>`) is printed to
   stdout and lands in Cloud Logging.

---

## 6. Secrets — the one genuinely empty secrets output in this catalog

```hcl
output "secret_ids"    { value = {} }
output "secret_values" { value = {} }
```

Passbolt's security model requires the **client** — a browser extension — to
generate its own GPG keypair and master password locally during setup. There
is no server-side password for Terraform to seed, and no application
encryption key analogous to a Laravel `APP_KEY` or WordPress salts. The two
pieces of server-side cryptographic state that *do* exist (the GPG server
keypair and the JWT keypair) are self-generated by the vendor's own entrypoint
on first boot, not by Terraform — see §4.

This makes the operator-facing bootstrap flow genuinely different from almost
every other application module in this catalog: there is no credential to
retrieve from Secret Manager after deploy. The only artifact of the
`admin-bootstrap` job is the one-time setup URL printed to logs.

---

## 7. Environment variables

Static config set in `config.environment_variables`:

| Name | Value |
|---|---|
| `HTTPS` | `"on"` — always set. See §Overview in the platform guides for why. |
| `APP_FULL_BASE_URL` | `var.service_url`, only when non-empty. |

---

## 8. Storage buckets

| Bucket (`name_suffix`) | Mount path | Purpose |
|---|---|---|
| `storage` | `/etc/passbolt/gpg` | Self-generated GPG server keypair |
| `jwt` | `/etc/passbolt/jwt` | Self-generated JWT keypair |

Both are `STANDARD` storage class, `force_destroy = true`,
`public_access_prevention = "enforced"`.

---

## 9. Outputs

| Output | Description |
|---|---|
| `config` | Full application configuration object for the Foundation Module |
| `secret_ids` | `{}` — always empty. |
| `secret_values` | `{}` — always empty (sensitive). |
| `storage_buckets` | `[{ name_suffix = "storage", ... }, { name_suffix = "jwt", ... }]` |
| `path` | Module path (used to resolve `scripts_dir`) |

---

For the platform-specific deployment details, defaults, and variable groupings,
see [Passbolt_CloudRun](Passbolt_CloudRun.md) and [Passbolt_GKE](Passbolt_GKE.md).
