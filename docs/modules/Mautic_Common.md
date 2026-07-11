---
title: "Mautic Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Mautic module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Mautic Common — Shared Application Configuration

`Mautic_Common` is the **shared application layer** for Mautic. It is not deployed on
its own; instead it supplies the Mautic-specific configuration that both
[Mautic_GKE](Mautic_GKE.md) and [Mautic_CloudRun](Mautic_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Mautic, see the platform
guides ([Mautic_GKE](Mautic_GKE.md), [Mautic_CloudRun](Mautic_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Mautic_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates the Mautic admin password and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Pins the official Mautic image (PHP/Apache) and the build that extends it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** media bucket | `storage_buckets` output |
| Core settings | Sets the baseline Mautic environment (admin identity, mailer identity, migrations on start, trusted proxies) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe behaviour, including the Cloud Run TCP-probe adjustment | §Observability in the platform guides |

---

## 2. Admin credential in Secret Manager

The Mautic administrator password is generated automatically and stored as a Secret
Manager secret — it is never set in plain text. Retrieve it after deployment:

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~admin"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared secret
and Workload Identity model.

---

## 3. Database engine and bootstrap

Mautic requires **MySQL 8.0**; the engine is fixed and PostgreSQL is not supported.
On the first deployment a one-shot job connects to Cloud SQL through the Auth Proxy
and idempotently:

1. creates the Mautic database (if absent),
2. creates the application user with the generated password,
3. grants the user full privileges on that database.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Mautic_Common` establishes the baseline Mautic environment so the application comes
up correctly on first boot:

- **Admin identity** — the initial admin login and email (configurable in Group 23 of
  the platform module).
- **Mailer identity** — the outbound sender name and address (Group 23). Use a domain
  with valid SPF/DKIM or campaign mail will be rejected or marked as spam.
- **Migrations on start** — Mautic runs its database migrations on each instance
  start, so version upgrades apply schema changes automatically.
- **Trusted proxies** — Mautic is told it sits behind a proxy so client IPs and the
  HTTPS scheme are honoured.

Platform-specific adjustments handled here:

- **Cloud Run** additionally pins the public service URL and sets `HTTPS=on` so Mautic
  generates correct absolute links and avoids HTTP→HTTPS redirect loops behind the
  Cloud Run front end.

---

## 5. Health probe behaviour

The default probes target Mautic's login page, which returns HTTP 200 only once the
application is fully initialised, with a generous startup delay to allow first-boot
database setup.

- **GKE** keeps the HTTP probe — in-cluster probe traffic reaches the container
  directly.
- **Cloud Run** uses a **TCP** startup probe instead, because Cloud Run health
  traffic arrives over plain HTTP and Apache answers with a 301 redirect to HTTPS, so
  an HTTP probe would never observe a 200. A TCP probe only checks that the port is
  open and is unaffected by the redirect.

---

## 6. Object storage

A dedicated **Cloud Storage** media bucket is declared here and provisioned by the
foundation, which also grants the workload service account access. Combined with the
shared Filestore (NFS) volume, this gives Mautic durable media storage that is
consistent across all instances. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Mautic-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Mautic_GKE](Mautic_GKE.md)** and **[Mautic_CloudRun](Mautic_CloudRun.md)**.
