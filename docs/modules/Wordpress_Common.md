---
title: "WordPress Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the WordPress module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# WordPress Common — Shared Application Configuration

`Wordpress_Common` is the **shared application layer** for WordPress. It is not deployed on its own; instead it supplies the WordPress-specific configuration that both [Wordpress_GKE](Wordpress_GKE.md) and [Wordpress_CloudRun](Wordpress_CloudRun.md) build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs WordPress, see the platform guides ([Wordpress_GKE](Wordpress_GKE.md), [Wordpress_CloudRun](Wordpress_CloudRun.md)) and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Wordpress_Common | Where it surfaces |
|---|---|---|
| Authentication secrets | Generates eight WordPress security keys and salts and stores them in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Builds a custom PHP 8.4 + Apache image from the official WordPress source via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `wp-uploads` media bucket | `storage_buckets` output |
| Core settings | Sets the baseline WordPress environment (table prefix, debug mode, Redis connection, trusted proxy handling) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup (TCP) and liveness (HTTP `/wp-admin/install.php`) probe configuration | §Observability in the platform guides |

---

## 2. WordPress authentication secrets in Secret Manager

Eight WordPress security constants are generated automatically as 64-character random strings (including special characters) and stored as Secret Manager secrets — they are never set in plain text. Retrieve them after deployment:

```bash
# List all secrets for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"

# Retrieve a specific secret value:
gcloud secrets versions access latest --secret=<resource-prefix>-auth-key --project "$PROJECT"
```

The eight secrets correspond to the WordPress constants `AUTH_KEY`, `SECURE_AUTH_KEY`, `LOGGED_IN_KEY`, `NONCE_KEY`, `AUTH_SALT`, `SECURE_AUTH_SALT`, `LOGGED_IN_SALT`, and `NONCE_SALT`. They are injected into the application pods at runtime via the Kubernetes Secrets Store CSI driver (GKE) or Cloud Run secret mounting (Cloud Run).

**Important:** Rotating these secrets (by deleting and recreating them) immediately invalidates all active WordPress browser sessions. Every logged-in user — including administrators — will be signed out. Rotate only if a secret is believed to have been compromised.

The database password is generated and managed separately by the foundation; its secret name is reported in the platform deployment outputs (`database_password_secret`). See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

WordPress requires **MySQL 8.0**; the engine is fixed and PostgreSQL is not supported. On the first deployment a one-shot `db-init` job connects to Cloud SQL through the Auth Proxy and idempotently:

1. Creates the WordPress database (if absent).
2. Creates the application user with the generated password.
3. Grants the user full privileges on that database.

The job runs on **every** `tofu apply` because it is idempotent — it safely skips steps that are already complete. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image

The WordPress image is built from a custom `Dockerfile` based on `php:8.4-apache`. The build is performed by Cloud Build at deploy time with `application_version` passed as the `APP_VERSION` build argument, which controls which WordPress release is downloaded from wordpress.org.

The image includes:

- **PHP extensions:** `bcmath`, `exif`, `gd` (AVIF, FreeType, JPEG, WebP), `intl`, `mysqli`, `zip`
- **PECL extensions:** `imagick` (ImageMagick for advanced image processing), `redis` (required by the WP Redis object cache plugin)
- **Apache modules:** `mod_rewrite` (WordPress permalink support), `mod_expires`, `mod_remoteip` (trusts `X-Forwarded-For` from Cloud Run and GKE load balancers)
- **PHP.ini overrides:** `memory_limit`, `upload_max_filesize`, and `post_max_size` are baked in from the build arguments set in the platform module

PHP configuration changes (memory limit, upload size) require a new Cloud Build run and deployment. Inspect the active values in a running instance:

```bash
# GKE:
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- php -r "
  echo 'memory_limit: ' . ini_get('memory_limit') . PHP_EOL;
  echo 'upload_max_filesize: ' . ini_get('upload_max_filesize') . PHP_EOL;
  echo 'post_max_size: ' . ini_get('post_max_size') . PHP_EOL;
"
# Cloud Run:
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
```

---

## 5. Core application settings

`Wordpress_Common` establishes the baseline WordPress environment so the application comes up correctly on first boot:

- **Table prefix** — `WORDPRESS_TABLE_PREFIX` is set to `wp_`. Override via `environment_variables` only when migrating an existing database with a non-standard prefix.
- **Debug mode** — `WORDPRESS_DEBUG` is set to `false`. Enable in development environments only; debug mode may expose sensitive information in HTTP responses.
- **Redis object cache** — when `enable_redis = true`, `WP_REDIS_HOST` and `WP_REDIS_PORT` are injected and the `docker-entrypoint.sh` configures the WP Redis plugin. When `redis_host` is left empty, the `$(NFS_SERVER_IP)` placeholder is resolved at container start time to the NFS server's IP address — enabling Redis on the NFS VM without knowing its IP at plan time.

Platform-specific adjustments handled here:

- **Cloud Run** additionally derives `WP_HOME` and `WP_SITEURL` from the `CLOUDRUN_SERVICE_URL` environment variable (always injected by the foundation with the correct URL), so WordPress generates correct absolute links and avoids HTTP→HTTPS redirect loops.

---

## 6. Health probe behaviour

The default probes are tuned for WordPress's startup characteristics:

- **Startup probe (TCP):** Checks that Apache's port is open. Uses TCP rather than HTTP because WordPress may issue redirects or return errors before the database connection is established and the application is fully initialised. The high `failure_threshold` (20 attempts × 15 seconds = 300 seconds of grace) accommodates the `db-init` job and WordPress's first-boot initialisation phase.
- **Liveness probe (HTTP):** Polls `/wp-admin/install.php` with a 300-second initial delay. This WordPress-managed page returns HTTP 200 whether WordPress is freshly installed or already configured, making it a reliable liveness indicator that does not depend on a custom `/healthz` route.

The probes are identical for both GKE and Cloud Run variants — both use TCP for startup and HTTP for liveness.

---

## 7. Object storage

A dedicated **Cloud Storage** media bucket with the name suffix `wp-uploads` is declared here and provisioned by the foundation, which also grants the workload service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~wp-uploads"
```

The bucket is provisioned in the deployment region. Combined with the shared Filestore (NFS) volume, this gives WordPress durable media storage that is consistent across all instances.

---

For the WordPress-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guides:
**[Wordpress_GKE](Wordpress_GKE.md)** and **[Wordpress_CloudRun](Wordpress_CloudRun.md)**.
