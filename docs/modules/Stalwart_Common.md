---
title: "Stalwart Common — Shared Application Configuration"
description: "Shared configuration reference for the Stalwart module — application-layer settings consumed by the GKE Autopilot deployment."
---

# Stalwart Common — Shared Application Configuration

`Stalwart_Common` is the **shared application layer** for Stalwart Mail Server. It
is not deployed on its own; instead it supplies the Stalwart-specific
configuration that [Stalwart_GKE](Stalwart_GKE.md) builds on. There is no Cloud
Run variant (see [§6](#6-why-gke-only)). End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform guide.

For the infrastructure that actually provisions and runs Stalwart, see the
platform guide ([Stalwart_GKE](Stalwart_GKE.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Stalwart_Common | Where it surfaces |
|---|---|---|
| Application secrets | **None.** The database credential is minted by the foundation; the bootstrap administrator is supplied by the operator as `STALWART_RECOVERY_ADMIN` | `secret_ids` / `secret_values` outputs are empty |
| Container image | Wraps the official `stalwartlabs/stalwart` image (default tag `v0.16.22`) with an entrypoint that generates `config.json`; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | **Cloud SQL for MySQL 8.0** (`database_type = "MYSQL_8_0"`), reached over the private IP with no Auth Proxy (`enable_cloudsql_volume = false`) | §Database in the platform guide |
| Database bootstrap | **No job.** The foundation's `db-create` step creates the database and user; Stalwart creates its own schema on first connect | `initialization_jobs` is empty unless you supply jobs |
| Object storage | Declares **no** buckets | `storage_buckets` output (empty) |
| Core settings | `container_port = 443`; `STALWART_PUBLIC_URL` (empty) and `STALWART_DATASTORE_TYPE` (`MySql`) | Application behaviour in the platform guide |
| Health checks | Passes through the probes it is given (the platform module supplies TCP probes on 443) | §Observability in the platform guide |

---

## 2. Stalwart's configuration model

Stalwart splits its configuration in two:

- **`/etc/stalwart/config.json`** holds *only* the **DataStore** object — the file
  *is* that object, keyed by an `@type` discriminator (`MySql`, `PostgreSql`, and
  other variants this module does not use). It does not ship in the image.
- **Everything else** — domains, listeners, TLS, the authentication directory —
  lives in the database and is managed over Stalwart's API with `stalwart-cli`.

The image's `CMD` is `--config /etc/stalwart/config.json`. Because `App_GKE` has no
way to mount a ConfigMap into the application container, Terraform cannot project
the file in, so this layer builds a thin wrapper image that **generates** it at
container start.

---

## 3. Container image and entrypoint

The Dockerfile is `FROM stalwartlabs/stalwart:${STALWART_VERSION}`. The build
argument is app-specific (the generic `APP_VERSION` the foundation injects is not
used); the default tag is `v0.16.22`, and the platform module's own
`application_version` is the value that takes effect. The Dockerfile switches to
root only to copy the entrypoint, returns to the image's unprivileged `stalwart`
user (uid 2000, which owns `/etc/stalwart` and `/var/lib/stalwart`), sets the new
`ENTRYPOINT`, and **restates `CMD ["--config", "/etc/stalwart/config.json"]`** —
Docker resets an inherited `CMD` whenever a Dockerfile sets `ENTRYPOINT`, and a
Stalwart started without its config argument opens port 8080 in bootstrap mode.

`scripts/entrypoint.sh` (POSIX `sh`, bare `set -e`) then:

1. **Refuses to start without the database settings.** `DB_IP`, `DB_NAME`,
   `DB_USER` and `DB_PASSWORD` must all be non-empty; otherwise it exits with a
   `FATAL` message. Starting without a config file would not fail — it would open
   8080 and look healthy to the image's own `HEALTHCHECK`.
2. **Creates `/var/log/stalwart`** defensively. The binary references it but the
   image never creates it; logging stays on stdout, where Cloud Logging collects it.
3. **Selects the DataStore type** from `STALWART_DATASTORE_TYPE` — `MySql`
   (default port 3306) or `PostgreSql` (5432) — and exits on any other value.
4. **Writes `config.json`** (`umask 077`), for example:

   ```json
   {
     "@type": "MySql",
     "host": "10.x.x.x",
     "port": 3306,
     "database": "<database>",
     "authUsername": "<user>",
     "authSecret": { "@type": "EnvironmentVariable", "variableName": "DB_PASSWORD" },
     "useTls": false,
     "allowInvalidCerts": false
   }
   ```

   `host` is `DB_IP`, the raw Cloud SQL private IP (`DB_HOST` is not usable: its
   socket-directory form is not a TCP host). `port` is `DB_PORT` when set.
   `useTls` and `allowInvalidCerts` come from `STALWART_DB_USE_TLS` and
   `STALWART_DB_ALLOW_INVALID_CERTS`, both defaulting to `false`. **No credential is
   written to the file** — `authSecret` names the `DB_PASSWORD` environment
   variable, which Stalwart reads at runtime.
5. **Logs what it did** — the DataStore target, whether `STALWART_RECOVERY_ADMIN`
   is set, and a reminder that 443 (not 8080) is the expected listener — and
   `exec`s `/usr/local/bin/stalwart` with the image's arguments.

The file is rewritten on every start. `/etc/stalwart` is deliberately not
persisted: the file is derived entirely from the platform's variables, and a
persisted copy could only drift from the database actually provisioned.

---

## 4. Database engine

`STALWART_DATASTORE_TYPE` is derived from this layer's `database_type`: any MySQL
variant (`MYSQL`, `MYSQL_5_6`, `MYSQL_5_7`, `MYSQL_8_0`, `MYSQL_8_4`) renders
`MySql`; anything else renders `PostgreSql`. The default — and, because the GKE
wrapper does not pass its own `database_type` through, the value always in effect
— is **`MYSQL_8_0`**, the engine the module was deployed and verified against
(Stalwart created 27 tables on first connect).

`enable_cloudsql_volume` is fixed at `false`: the DataStore takes a plain TCP host,
so an Auth Proxy sidecar would never be dialled — and in the job path one that
never exits would hang `db-create` until its deadline.

No initialization job is defined. Supplying `initialization_jobs` adds your own
jobs; none are needed for Stalwart itself.

---

## 5. Administrator access, secrets and replicas

- **Administrator.** `STALWART_RECOVERY_ADMIN`, with the value `username:password`,
  belongs in `secret_environment_variables` (from Secret Manager). If it is unset,
  Stalwart generates a random administrator password and prints it to the
  container log once. The `admin_username` and `admin_email` inputs of this layer
  are informational only.
- **Secrets.** This layer creates no secrets and enables no APIs.
- **Public URL.** `STALWART_PUBLIC_URL` is the base URL Stalwart publishes for
  OAuth, OIDC and JMAP discovery. It is empty by default on purpose — a wrong value
  is handed to clients in discovery documents.
- **Single replica.** Running more than one Stalwart replica requires its
  coordinator, which needs Redis. Stalwart's Redis connection is a URL
  (`redis://user:pass@host:port`), so a Memorystore AUTH string would have to be
  percent-encoded into it; the module does not do that and is designed to run one
  replica. (This layer passes `max_instance_count` through unchanged, so the
  platform module's value decides.)

---

## 6. Why GKE only

- **Protocol.** SMTP, IMAP, POP3 and ManageSieve are line protocols; Cloud Run
  forwards HTTP/gRPC only.
- **The `$PORT` contract is inverted.** Stalwart serves normally on **443**. Port
  **8080** opens in exactly two abnormal states — "No configuration file was found.
  Port 8080 is open for initial setup" and "Startup failed. Port 8080 is open for
  troubleshooting and recovery." A Cloud Run container would satisfy `$PORT=8080`
  precisely when it was unconfigured or crashed.

---

## 7. Health probe behaviour

The image's `HEALTHCHECK` is
`curl -fsSk https://127.0.0.1:443/healthz/live || curl -fsS http://127.0.0.1:8080/healthz/live`,
so it reports a server stuck on 8080 as healthy. This layer sets `container_port =
443`, and the platform module supplies **TCP** probes against it:

- A server that **failed to start** binds only 8080, so the TCP check on 443 fails —
  correctly.
- A server that started with its DataStore connected but **no server
  configuration** binds 443 too (both 443 and 8080 answered 200 on the verified
  deployment), so the probe passes. The tell is that 8080 is still open, which no
  Kubernetes probe can express; check it by hand (see the platform guide).

An HTTP probe is not an option: `App_GKE`'s HTTP probe has no `scheme` field and
cannot check an HTTPS port. Never repoint a failing probe at 8080.

---

## 8. What is not wired

**Domains, listeners and TLS.** The vendor's declarative path is: write
`config.json`, start with `STALWART_RECOVERY_MODE=1` and `STALWART_RECOVERY_ADMIN`,
run `stalwart-cli apply` with a JSON plan, then restart without the recovery
variables. `stalwart-cli` is a separate binary published as its own image
(`ghcr.io/stalwartlabs/cli`), so that step would be an initialization job using
that image. It is not wired, because every value in such a plan concerns a real
mail domain. Until it is applied, the server runs with its DataStore configured and
its defaults for everything else.

**Sending mail.** Google Cloud blocks outbound TCP 25 from every VM and pod, so
direct MX delivery is impossible; outbound mail needs a smart host on 587. Inbound
25 is unaffected. A production deployment also needs a domain with MX records,
forward and reverse DNS, and SPF/DKIM/DMARC.

---

For the Stalwart-specific, user-facing configuration (variables by group, the port
map, outputs, and how to explore each service from the Console and CLI), see the
platform guide: **[Stalwart_GKE](Stalwart_GKE.md)**.

<!-- related-guides -->

## Related guides

- [Stalwart on GKE Autopilot](Stalwart_GKE.md) — this configuration deployed on GKE.
