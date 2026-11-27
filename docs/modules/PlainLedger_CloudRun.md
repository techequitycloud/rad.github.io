---
title: "Plain Ledger on Google Cloud Run"
description: "Deploying Plain Ledger on Google Cloud Run with the RAD module: what to prepare before the first deploy, sign-in, email, custom domains, the demo, and the settings that are off by default."
---

# Plain Ledger on Google Cloud Run

Plain Ledger keeps the records of farms, care agencies, cleaning companies, schools, clinics,
shops, rentals, estates and other organisations so that they **cannot be quietly changed**.
Every record is an **append-only, hash-chained event**, signed by the phone that recorded it or
by its organisation's own Cloud KMS key, and an independent verifier (`ledger-verify`) checks
that nothing was changed after the fact without trusting whoever runs the service.

This module deploys the Plain Ledger API and console on **Cloud Run v2**, on top of the
[App_CloudRun](/docs/modules/App_CloudRun) foundation, with its own PostgreSQL 17 database on the Cloud SQL
instance from [Services_GCP](/docs/modules/Services_GCP). Application-specific configuration lives in
[PlainLedger_Common](/docs/modules/PlainLedger_Common).

## 1. Overview

| Component | What it is |
|---|---|
| Cloud Run service | The Plain Ledger API, console and phone app (FastAPI, uvicorn). Scales to zero by default; at most 3 instances |
| `db-init` Cloud Run job | Runs on every apply: creates Plain Ledger's database roles, restricts who may connect, applies migrations |
| Cloud SQL for PostgreSQL 17 | One database on the deployment's own Services_GCP instance, holding the event log |
| `anchor`, `watch`, `flash` Cloud Run jobs + Cloud Scheduler | The digest, the clock's exceptions, the weekly flash and billing (`python -m plainledger.<job>`) |
| `frequent` Cloud Run job + Cloud Scheduler | Every 5 minutes, **only where CARE or CLEANING is served**: late and missed visits, calendars, silent phones |
| Cloud Storage | Versioned `documents` and `anchors` buckets, **never `force_destroy`**, soft delete 7 days |
| Secret Manager | The runtime role's database password (and the demo login's, with `enable_demo`) |
| Cloud KMS | `plainledger-<prefix>`: one P-256 signing key per organisation. `plainledger-<prefix>-seal`: one sealing key per organisation (**on by default**) |
| Identity Platform | Console sign-in (an emailed link or Google, plus an authenticator app), and a browser API key restricted to sign-in |
| Cloud Run domain mappings | One per host in `domain_mappings` (no load balancer) |

## 2. Deploying it through RAD

A deployment of Plain Ledger is three RAD deployments made from the RAD UI,
with the same `tenant_id`:

1. **A project.** Either `Project_GCP` (RAD-managed: RAD's folder, billing and eight regions) or
   a project made by hand and entered by id (bring-your-own). A bring-your-own project is registered to your RAD
   account by RAD's proof of control (the `rad-verify` label) and keeps every region.
2. **[Services_GCP](/docs/modules/Services_GCP)** with:
   `availability_regions = ["europe-west1"]`, `create_postgres = true`,
   `postgres_database_version = "POSTGRES_17"`, `postgres_tier = "db-g1-small"`,
   `postgres_database_availability_type = "ZONAL"`, `create_network_filesystem = false`,
   `postgres_deletion_protection = true`, `postgres_disk_autoresize_limit = 50`,
   `postgres_backup_start_time` as wanted (default `04:00`), `sql_maintenance_window_day = 7`,
   `sql_maintenance_window_hour = 3`, `enable_query_insights = true`.
3. **PlainLedger_CloudRun** with the client's values (section 4).

### Before you deploy Plain Ledger

A checklist, in order. RAD shows a short form of it at the top of the deploy form and at the
start of the Configuration Assistant (the module's `deploy_checklist` variable: keep the two in
step); each setting's own description in the form says the same in fewer words. `PROJECT-ID` is the deployment's project id.

1. **Prepare the project.** In RAD's **Prepare your project** panel, run its script as a project
   Owner, then **Verify**. It enables the APIs (`project_prerequisites`: Identity Toolkit, API
   Keys, reCAPTCHA Enterprise, beyond Project_GCP's baseline), grants RAD's deployment service
   account its roles, adds the `rad-verify` label RAD checks, and makes the three custom roles
   (`plainledgerKeyCreator`, `plainledgerSigninLink`, `plainledgerAuthenticator`) that the plan
   reads and stops without. By hand, the role commands are below.
2. **Services_GCP first, in the same region and tenant.** Deploy [Services_GCP](/docs/modules/Services_GCP)
   before this module, with the same `tenant_id`, `create_postgres = true` (`POSTGRES_17`;
   `db-g1-small` is enough for 3 instances) and `availability_regions` starting with this
   module's `region` (`europe-west1` by default here; Services_GCP's own default is
   `us-central1`). Plain Ledger uses no NFS or Redis: `create_network_filesystem = false`. Section 2
   above lists a fuller Services_GCP configuration. Without Services_GCP the
   plan stops with *DEPLOYMENT BLOCKED - Services_GCP Module Not Found*; without its PostgreSQL,
   with *This application needs a PostgreSQL database*.
3. **Google sign-in: the OAuth client, then its secret.** Make the Google OAuth web client and a
   Secret Manager secret holding its client secret (e.g. `plainledger-google-client-secret`)
   **before** the deploy: the plan reads the secret and stops if it does not exist (section 3D,
   steps 1 to 7). The OAuth client needs only `https://PROJECT-ID.firebaseapp.com` as its
   JavaScript origin and `https://PROJECT-ID.firebaseapp.com/__/auth/handler` as its redirect
   URI: the console signs in through `PROJECT-ID.firebaseapp.com`
   (`PLAINLEDGER_CONSOLE_AUTH_DOMAIN`), so custom domains need no entry there.
4. **Email: a mailbox and its app password in a secret.** Plain Ledger sends every email
   (sign-in links when the server sends them, invitations, exceptions, the digest) through SMTP
   (`anchor_smtp_host`, `smtp.gmail.com` by default, implicit TLS on 465), signed in to one
   mailbox with its app password:
   - a Google **app password** for the mailbox (Google Account → Security → 2-Step Verification
     on → App passwords);
   - a secret, e.g. `plainledger-smtp-password`, holding it, made **before** the deploy that
     names it: the deploy grants the service access to it and fails if it is missing;
   - `anchor_smtp_password_secret` = that secret's name, `anchor_email_sender` = the From
     address. It is empty by default, and the plan stops if a mail credential
     (`anchor_smtp_password_secret` or `anchor_gmail_credential_secret`) is named without it;
   - to send from an alias (e.g. `noreply@example.org` through
     `support@example.org`'s account): in that mailbox's Gmail, Settings → Accounts
     → **Send mail as** → add the alias (without it Gmail replaces the From with the mailbox's
     own address), put the alias in `anchor_email_sender` (`console_signin_email_sender`
     falls back to it when empty), and in group 6 `environment_variables`
     set `PLAINLEDGER_SMTP_USER` = the mailbox (otherwise Plain Ledger signs in as the alias and
     Gmail refuses the password).

   Without the secret no email of any kind is sent: invitations, exceptions, the digest, and the
   server's sign-in links. Replies: a holding's emails carry `Reply-To` from its
   `email.reply_to` setting (by default `provider_support_email`); the sign-in email carries none.
5. **Sign-in by emailed link, and the lock-out trap.** `console_email_link_sign_in = true` lets
   people without a Google account sign in with a link; Identity Platform sends it from
   `noreply@PROJECT-ID.firebaseapp.com`. `console_server_signin_email = true` has Plain Ledger
   send it instead ("Welcome to Plain Ledger", from `console_signin_email_sender`, else
   `anchor_email_sender`). **It needs the mail credential of step 4 and a sender: with it on and
   no credential, no sign-in email would be sent by anyone, and nobody without Google could sign
   in.** The plan refuses both (`null_resource.validate_configuration`), so make the secret
   first and name it in the same deploy or earlier.

   **The authenticator app (TOTP)** is switched on by the module
   (`google_identity_platform_config.console`'s `mfa` block, while
   `console_manage_identity_platform` is on): nothing to enable in Identity Platform by hand.
   Every console user enrols an app the first time they sign in; it shows the account as
   **Plain Ledger**. If another application manages the project's Identity Platform
   (`console_manage_identity_platform = false`), TOTP, the authorised domains and the emailed
   link must be switched on there.
6. **Operators and the demo** (group 13, in the form's order): `operator_emails` (each signs in
   with that address and sets up an authenticator app the first time, then sees **Platform**),
   `enable_demo = true` and `demo_open = true` for a public Try the demo, `demo_schedule` kept at
   `0 * * * *` (section 3F).
7. **Your own domains (optional).** `domain_mappings` (group 10), `console_public_host` (group 3)
   and `docs_host` (group 13); section 3E. RAD's deployment service account must be a verified
   owner of the domain in Search Console first.
8. **Who provides the service.** Left empty, the `provider_*` fields present **TechEquity** as the
   provider everywhere: the footer's terms and privacy policy, `support@techequity.cloud`,
   whom invoices are paid to. Anyone else providing the service fills `provider_name`,
   `provider_website` and `provider_support_email` (and `provider_terms_url`,
   `provider_privacy_url` unless they are `<website>/terms` and `<website>/privacy`).
9. **Off until you set them.** None is needed to start (section 4, *Off by default*).
10. **After the deploy.** Open `service_url` and sign in as an operator. If sign-in is refused on
    Cloud Run's second, hashed `run.app` address, add that host to `console_extra_hosts`. RAD's
    **Housekeeping** note on the deployment says the project's `rad-verify` label is no longer
    needed: remove it. The demo's first copy is ready within about an hour; until then `/demo`
    says it is being prepared.

**Before the first deploy, by hand** (RAD's deploying identity never holds
`roles/iam.roleAdmin`, so it cannot make custom roles; an identity that can change a custom role
can widen it):

```bash
PROJECT=PROJECT-ID
gcloud iam roles create plainledgerKeyCreator --project=$PROJECT \
  --title="Plain Ledger signing key creator" \
  --permissions=cloudkms.cryptoKeys.create,cloudkms.cryptoKeys.get,cloudkms.cryptoKeyVersions.get,cloudkms.cryptoKeyVersions.list
gcloud iam roles create plainledgerSigninLink --project=$PROJECT \
  --title="Plain Ledger sign-in link" --permissions=firebaseauth.users.sendEmail
gcloud iam roles create plainledgerAuthenticator --project=$PROJECT \
  --title="Plain Ledger authenticator reset" --permissions=firebaseauth.users.update
```

The module reads each role (`data "google_iam_role"`) and **fails the plan** if one is missing or
lacks a permission the service needs; it then grants it to the service account. Their ids are
inputs (`console_key_creator_role_id`, `console_signin_link_role_id`,
`console_authenticator_role_id`), defaulting to the names above.

**Each secret by hand, before the deploy that names it:** put each secret's value into Secret
Manager once (Google OAuth client, SMTP, Stripe, Flutterwave, VAPID, LiteLLM): the module and
the form carry secret **ids** only, never values. A secret named in a setting must exist with a
value before the deploy that names it: the plan reads the Google OAuth client's (section 3D),
and the deploy grants the service access to every other and fails on a missing one.

**A new release** is an update of the deployment in RAD with the new `application_version`.

## 3. Google Cloud services, and how to explore them

### A. Cloud Run: the service

- `GET /` is the health check: 200 `{"service":"plain-ledger","status":"ok",...}` when the
  service reaches its database, 503 when it cannot.
- The phone app is served at `/phone/`, the console at `/console/`.

```bash
gcloud run services describe "$(tofu output -raw service_name)" --region europe-west1
curl -s "$(tofu output -raw service_url)/"
```

### B. Cloud SQL: the database roles

The Foundation's `db-create` job makes **one** login role (`DB_USER`), which owns the database.
Plain Ledger requires the running service to connect as a role that may **only read and insert**,
so `db-init` sets up:

| Role | Login | Rights |
|---|---|---|
| `<DB_USER>` | yes | Owner. Runs migrations and admin jobs |
| `<DB_USER>_rt` | yes | What the service connects as. A member of `<DB_USER>_app` |
| `<DB_USER>_app` | no | SELECT on the log's tables; INSERT on `event` only |
| `<DB_USER>_auditor` | no | SELECT only |
| `<DB_USER>_demo` | yes | With `enable_demo` only: the demo's own login |

The event log refuses UPDATE, DELETE and TRUNCATE for every role, the owner included.

**No `db-cleanup`.** `enable_db_cleanup` is off: App_CloudRun's job that drops the database on
destroy is never made, so deleting the deployment in RAD never drops a ledger's records.

### C. Cloud Storage

`documents` (certificates, reports, photographs, referred to by hash) and `anchors` (one object
per digest, uploaded create-only). Both versioned, public access prevention enforced, **not
`force_destroy`**: a destroy stops at a bucket that still holds objects. Soft delete is kept at
seven days. No general `data` bucket (`storage_buckets` defaults to none).

### D. The console: Cloud KMS and Identity Platform

- **Signing:** each organisation's records in the console are signed by its own key,
  `plainledger-<prefix>/org-<organisation id>`, made by the service the first time (with the
  hand-made key creator role, which cannot disable or destroy a key).
- **Sealing** (`enable_sealing`, **on by default**): `plainledger-<prefix>-seal`, one key per
  organisation, wrapping each holding's data keys. Every ledger needs it: phones deposit their PIN
  recovery secret sealed, and the care and cleaning ledgers seal what they record
  about people. The plan fails if CARE or CLEANING is served without it.
- **Identity Platform** is the project's own (`console_manage_identity_platform` on). Its
  authorized domains are the `run.app` host, `console_public_host`, `console_extra_hosts` and
  every host in `domain_mappings`.
- **Identity Platform's config outlives every destroy** (the API cannot delete it; a destroy
  only forgets it). Each plan asks whether the project already has one
  (`App_Common/scripts/get-identity-platform-config.sh`, a `GET
  https://identitytoolkit.googleapis.com/admin/v2/projects/<project>/config`, and its
  `defaultSupportedIdpConfigs`, `oauthIdpConfigs` and `inboundSamlConfigs`, billed to the
  project itself; it returns the authorized domains and the names of what is switched on, never
  a secret). The answers: `200` exists; `404 CONFIGURATION_NOT_FOUND` (never initialised) or
  `403 SERVICE_DISABLED` for this project (the API is off; the module enables it) is absent;
  anything else (no token, a permission error such as `USER_PROJECT_DENIED`, `SERVICE_DISABLED`
  for another project, 5xx, a provider list it could not read) **fails the plan** with the
  lookup's error, never taken for absent. A config made while the API was on and the API turned
  off afterwards is read as absent: the create then fails as before, and the next plan (with the
  API on again) decides as below.
- **An existing config is adopted only when it is this deployment's own.** It is one per
  project, so adopting another application's would overwrite its authorized domains and
  sign-in. The config is imported (`imports.tf`) -- a redeploy after a destroy, or after a first
  apply cancelled once the config was made, then needs nothing by hand -- only when all three
  hold:
  1. an authorized domain names this deployment's service: `<service_name>-*.run.app` (every
     config this module makes lists the service's `run.app` host; the name is deterministic, so
     known on a first plan, and any region or URL form counts);
  2. every authorized domain is one this module sets (`localhost`,
     `<project>.firebaseapp.com`, `<project>.web.app`, the `run.app` host,
     `console_public_host`, `console_extra_hosts`, `domain_mappings`) or another `run.app`
     host of this service;
  3. nothing is switched on that the module never sets: phone or anonymous sign-in,
     multi-tenancy, blocking functions, a provider other than `google.com`.

  Otherwise the plan **stops** at `google_identity_platform_config.console`: *"This project's
  Identity Platform is already set up, and not by this deployment. If another application
  manages it, set console_manage_identity_platform = false and add this service's domain there;
  to let this deployment take it over, set console_adopt_identity_platform = true."*, followed
  by which rule failed. `console_adopt_identity_platform = true` imports it anyway, and the
  module then sets it to what `console.tf` says. With `console_manage_identity_platform =
  false` there is no probe at all.
- **The rule is read on every plan**, since a plan cannot see whether the config is already in
  state. A config this module made or adopted passes: it is set to exactly what the rule
  expects. The one exception is a host dropped from `domain_mappings`, `console_extra_hosts` or
  `console_public_host`: it stays listed live until the apply, so that plan needs
  `console_adopt_identity_platform = true` (set it back afterwards, or leave it: in a project
  this deployment owns it changes nothing).
- **The browser API key** (`google_apikeys_key.console`) is made through a provider of its own,
  `google.console_apikeys`, with `user_project_override = true` and `billing_project` the
  deployment's project. Otherwise the API Keys API is billed to the CALLER's project, which for RAD's
  deploying identity is RAD's own project, not yours. The caller needs
  `serviceusage.services.use` on the deployment's project, which any identity that can enable its
  APIs has. Only that resource uses the alias; App_CloudRun's providers are unchanged.
- **The grants to the service's account** (KMS rings, the three custom roles, reCAPTCHA) name it
  by App_CloudRun's `service_account_email` output, never by a string built here: the account is
  made inside App_CloudRun (`ensure_cloudrun_sa`, by gcloud), and only the output makes a grant
  wait for it. Built as a string, the project's IAM refused the grant on a first deploy
  (`Service account plainledger-<prefix>@... does not exist`).
- **Google sign-in** needs an OAuth web client made once by hand in the deployment's own project
  (Google does not let OpenTofu create one). Without it nobody can sign in with Google. In the
  project's Google Cloud console (`PROJECT-ID` is the project's id):
  1. **APIs and Services → OAuth consent screen** (shown as *Google Auth Platform* in newer
     consoles): **External**; the app's name (e.g. Plain Ledger) and the support and contact
     emails it asks for.
  2. **Authorised domains:** `PROJECT-ID.firebaseapp.com`, and the site's own domain if it has
     one (e.g. `plainledger.app`).
  3. **Scopes:** keep the defaults (`email`, `profile`, `openid`); Google does not review an app
     for these.
  4. **Publish the app** so its status is **In production**. In *Testing* only the test users
     listed there can sign in.
  5. **Credentials → Create credentials → OAuth client ID → Web application**, with
     - Authorised JavaScript origin `https://PROJECT-ID.firebaseapp.com`
     - Authorised redirect URI `https://PROJECT-ID.firebaseapp.com/__/auth/handler`
  6. **Secret Manager → Create secret**, e.g. `plainledger-google-client-secret`, its value the
     client's secret. Make it **before** naming it: the plan reads its latest version
     (`data.google_secret_manager_secret_version.console_google_client_secret`, as RAD's deploying
     identity) and stops if it is missing.
  7. In RAD's form: `console_google_client_id` = the client ID (`....apps.googleusercontent.com`)
     and `console_google_client_secret_secret` = the secret's **name** (not its value, not a
     `projects/.../secrets/...` path). Google sign-in (`google_identity_platform_default_supported_idp_config.google`)
     is configured only when both are set.

  The console's own hosts (`console_public_host`, `console_extra_hosts`, `domain_mappings`) need
  no entry in the OAuth client: sign-in runs through `PROJECT-ID.firebaseapp.com`
  (`PLAINLEDGER_CONSOLE_AUTH_DOMAIN`), and the module lists the hosts in Identity Platform's
  authorised domains itself. For people without a Google account, `console_email_link_sign_in`
  sends a sign-in link instead; `console_password_sign_in` is for testing only (the console cannot
  make password accounts). To change the client's secret, add a version to the same secret and
  deploy again.

### E. Custom domains (`domain_mappings`)

Each host gets a `google_cloud_run_domain_mapping` to the service, with **no load balancer**
(App_CloudRun's `application_domains` attaches domains only through its Cloud Armor load
balancer). Before adding a host:

- the deploying identity (RAD's) must be a **verified owner** of the domain in Search Console;
- the host must not be mapped in another project (delete that mapping first; the certificate is
  issued again, a gap of minutes to hours);
- DNS points at Cloud Run: `CNAME ghs.googlehosted.com`, or for an apex the A/AAAA records the
  `domain_mappings` output lists;
- the region offers domain mappings (europe-west1 does; europe-north2 does not).

Search Console verification belongs to accounts, not projects: verify the domain as a person
(a DNS TXT record), then add RAD's deployment service account (the one RAD's **Prepare your
project** panel names) as an **Owner** under Settings → Users and permissions. If that is not
possible, make the mapping by hand in Cloud Run (as a verified owner), leave the host out of
`domain_mappings`, and put it in `console_extra_hosts` so it may still sign in.

After the deploy, point DNS at Cloud Run (the `domain_mappings` output lists each host's
records). Google issues the certificate once DNS answers: minutes to hours, during which the host
answers with a certificate error. Then:

- `console_public_host`: the main host, which links in emails use (`PLAINLEDGER_PUBLIC_URL`);
  empty, they use the `run.app` address;
- `console_extra_hosts`: further hosts that may sign in, such as Cloud Run's second, hashed
  `run.app` address, or a host mapped by hand;
- `docs_host`: the manual's own host (`PLAINLEDGER_DOCS_HOST`), mapped too. Everything on it that
  is not the manual is sent to the public host, so set `console_public_host` with it;
- `redirect_hosts`: old hosts that answer **only** with a permanent redirect to
  `console_public_host` (`PLAINLEDGER_REDIRECT_HOSTS`): nothing is served or signed in on them.
  Map each one too.

Every host in `domain_mappings`, `console_public_host` and `console_extra_hosts` is added by the
module to Identity Platform's authorised domains, the browser key's referrers and the demo's
reCAPTCHA domains; the OAuth client needs none of them.

### F. Try the demo (`enable_demo`)

Off by default, and off on a client's deployment. On (needs `enable_console`): the demo login's
secret, the `<service>-demo` job (`python -m plainledger.demo_reset`) on `demo_schedule`, the
documents bucket's `demo/` rule (deleted after 3 days), and a score-based reCAPTCHA Enterprise key
for the console's hosts.

Nothing is offered to visitors until the site setting `demo.try` is on. Either an operator
switches it on in the console (Platform -> Demo), or the deploy does, with **`demo_open = true`**
(needs `enable_demo`; the plan stops at `terraform_data.demo_open_needs_demo` otherwise): db-init
(given `PLAINLEDGER_DEMO_OPEN=true`) turns it on after the migrations, logged in the operators' log as
`SET_DEMO_TRY` by `deploy`. It only ever turns the demo **on**; `demo_open = false` leaves the
setting as it is. The console's switch is still the off button, but while `demo_open` stays true
each release's db-init turns the demo back on: **to keep it off, set `demo_open = false` too.**
Until the demo job's first build (within the first hour), `/demo` says the demo is being built.

**`operator_emails`** (a list, default empty) makes each address a platform operator at db-init,
as `python -m plainledger.admin add-operator --email` does, so a new deployment needs no admin
job to sign its operators in. Idempotent; an operator the list leaves out is **never removed**
(removal stays explicit). Each entry must be one address (the variable's validation; db-init
checks it again and stops naming its place in the list). The addresses reach db-init alone, as
`PLAINLEDGER_OPERATOR_EMAILS`, in its environment (a job's args are split on commas), and are
never logged.

Both need a Plain Ledger release that has `plainledger/db/deploy.py` vendored into
`PlainLedger_Common/scripts/app`; an older image's db-init ignores them.

#### Opening the demo on a new deployment

Everything is in RAD's form, in group 13, in the order the form shows it:

1. `console_google_client_id` and `console_google_client_secret_secret`: Google sign-in (section
   3D; the secret made first). Optionally `console_email_link_sign_in = true` for people without
   a Google account.
2. `operator_emails = ["ops@…"]`: who becomes a platform operator. They sign in with Google (or
   the emailed link) and set up an authenticator app the first time.
3. `enable_demo = true` (with `enable_console`, on by default).
4. `demo_open = true`: db-init opens the demo as it deploys.
5. `demo_schedule`: keep `0 * * * *`.

Deploy. The demo's first copy is ready within about an hour; until then `/demo` says it is being
prepared. To close it later: the console's Platform → Demo switch **and** `demo_open = false`
(otherwise the next deploy opens it again).

## 4. Configuration variables

The groups follow [App_CloudRun](/docs/modules/App_CloudRun). Plain Ledger's own inputs and the defaults
that differ from a typical app:

| Variable | Default | Group (RAD form) | Why |
|---|---|---|---|
| `region` | `europe-west1` | 1 | Where every regional resource is; must be Services_GCP's region. RAD's region picker (RAD's eight in a RAD-managed project; any in a bring-your-own one) |
| `tenant_id` | `demo` | 1 | 1-7 characters |
| `application_version` | `0.83.1` | 3, updatesafe | A Plain Ledger release label; changing it rebuilds the image |
| `ledgers` | `[]` | 3, updatesafe | The ledgers offered: `FARM`, `SYNDICATE`, `VENTURE`, `BUILDING`, `RENTAL`, `COMMUNITY`, `SCHOOL`, `CLINIC`, `SHOP`, `FLEET`, `ESTATE`, `CARE`, `CLEANING`. Sets `PLAINLEDGER_LEDGERS` (upper-cased, comma-separated); empty leaves it unset, every released ledger. Validated against the codes (a list, so no `options=`) |
| `ledgers_kept` | `[]` | 3, updatesafe | Ledgers no longer offered whose holdings remain: keeps the frequent job and the sealing check for them |
| `console_public_host` | `""` | 3, updatesafe | The host links in emails use (`PLAINLEDGER_PUBLIC_URL`), e.g. `plainledger.app` |
| `console_extra_hosts` | `[]` | 3, updatesafe | Further hosts allowed to sign in |
| `max_instance_count` | `3` | 4, updatesafe | 3 × a pool of 4, plus the demo's and the jobs', fits a `db-g1-small` (about 50 connections) |
| `database_type` | `POSTGRES_17` | 12 | 16 or 17 only |
| `domain_mappings` | `[]` | 10, updatesafe | Cloud Run domain mappings (section 3E); each host may also sign in |
| `storage_buckets` | `[]` | 11 | No `data` bucket |
| `frequent_schedule` | `*/5 * * * *` | 13, updatesafe | The frequent job, made only where CARE or CLEANING is served |
| `enable_sealing` | `true` | 13 (not updatesafe) | Section 3D. Key rings cannot be deleted |
| `docs_host` | `""` | 13, updatesafe | `PLAINLEDGER_DOCS_HOST`: the manual's own host, e.g. `docs.plainledger.app` |
| `redirect_hosts` | `[]` | 13, updatesafe | `PLAINLEDGER_REDIRECT_HOSTS`: old hosts answering only with a redirect, e.g. an old domain after a move |
| `data_region` | `""` | 13, updatesafe | `PLAINLEDGER_DATA_REGION`, the privacy notice's and care documents' wording; empty is `region` |
| `console_adopt_identity_platform` | `false` | 13, updatesafe | Take over the project's existing Identity Platform config even when it is not evidently this deployment's own (section 3D) |
| `console_key_creator_role_id` | `plainledgerKeyCreator` | 13, updatesafe | The hand-made custom role (section 2) |
| `console_signin_link_role_id` | `plainledgerSigninLink` | 13, updatesafe | Used with `console_server_signin_email` |
| `console_authenticator_role_id` | `plainledgerAuthenticator` | 13, updatesafe | The console's Reset authenticator |
| `enable_db_cleanup` | `false` | 13 | App_CloudRun's db-cleanup job (drops the database on destroy). On only for a throwaway test |
| `provider_name`, `provider_website`, `provider_terms_url`, `provider_privacy_url`, `provider_social`, `provider_support_email` | `""` | 13, updatesafe | The client's name everywhere `{{company}}` is filled (`PLAINLEDGER_PROVIDER_*`, `PLAINLEDGER_SUPPORT_EMAIL`); only what is set reaches the service |
| `enable_demo`, `demo_schedule` | `false`, `0 * * * *` | 13, updatesafe | Section 3F |
| `demo_open` | `false` | 13, updatesafe | db-init turns `demo.try` on (never off); needs `enable_demo`. Section 3F |
| `operator_emails` | `[]` | 13, updatesafe | db-init makes each a platform operator; never removes one. Section 3F |
| `dedicated_service_account` | `true` | 13, updatesafe | Plain Ledger runs as its own account, `plainledger-<prefix>` |
| `fence_enabled` | `false` | 13, updatesafe | Not needed in a project of its own |
| `anchor_*`, `push_vapid_private_key_secret`, `payment_*_secret`, `console_google_client_secret_secret` | `""` | 13, updatesafe | Secret Manager **ids** only; values put in by hand |
| `module_description`, `credit_cost`, `public_access`, ... | | 0 | Platform metadata; `public_access = false`, `shared_users` names who may deploy it |

Anything else Plain Ledger reads (`PLAINLEDGER_DB_POOL_MAX`, `PLAINLEDGER_SIGNUP`,
`PLAINLEDGER_TERMS_URL`, `PLAINLEDGER_TSA_URL`, `PLAINLEDGER_AI_LITELLM_URL`, ...) goes through
`environment_variables`.

### Off by default

None of these is needed for a working site; each stays off until it is set.

| What | How to turn it on | Unset |
|---|---|---|
| Email of any kind | `anchor_smtp_password_secret` (section 2, step 4) | No email is sent; the digest is stored and raises `ANCHOR_NOT_EMAILED` |
| The digest's outside recipients | `anchor_recipients`, or the `anchor.recipients` policy in the console | Digests are stored, not emailed |
| AI help (Ask AI, the public helpers) | `PLAINLEDGER_AI_LITELLM_URL` and `PLAINLEDGER_AI_API_KEY` in `environment_variables` (the key is stored as a secret); the model `PLAINLEDGER_AI_MODEL`, else the platform's `LLM_PRIMARY_MODEL` | No AI helper is offered |
| RFC 3161 timestamps on the digest | `PLAINLEDGER_TSA_URL`, e.g. `http://timestamp.digicert.com` | Digests are not timestamped |
| Card and mobile-money payment | `payment_stripe_*_secret`, `payment_flutterwave_*_secret` | No online payment is offered |
| Push notifications | `push_vapid_private_key_secret` (`python -m plainledger.webpush keys`) | Messages go by email |
| WhatsApp | `PLAINLEDGER_WHATSAPP_TOKEN`, `_PHONE_ID`, `_APP_SECRET`, `_VERIFY_TOKEN` in `environment_variables` | Not offered |
| The public demo | `enable_demo`, `demo_open` (section 3F) | No demo |
| Custom domains | `domain_mappings` (section 3E) | The `run.app` address only |

On by default: the scheduled jobs (`anchor`, `watch`, `flash`, and `frequent` where CARE or
CLEANING is served; an empty schedule disables one), sealing, the console, and Cloud SQL's own
backups as Services_GCP sets them (`postgres_backup_start_time`).

## 5. Outputs

As [App_CloudRun](/docs/modules/App_CloudRun), plus `domain_mappings` (each host and the DNS records its
mapping asks for) and `ledgers`. The one to give users is `service_url`.

## 6. Pitfalls

- **The custom roles must exist first.** The plan fails at `data.google_iam_role` otherwise.
- **A redeploy into a project whose Identity Platform this deployment set up before** needs
  nothing by hand: the plan imports the config (section 3 D). If the plan stops at
  `data.external.identity_platform_config`, the lookup itself failed: read its error, fix the
  deploying identity's access, and plan again. If it stops at
  `google_identity_platform_config.console` ("not by this deployment"), the config is another
  application's, or lists a host this deployment no longer sets: set
  `console_manage_identity_platform = false` (and add the service's host to that application's
  config) or, to take it over, `console_adopt_identity_platform = true`.
- **`scripts/app` must be vendored** before the first deploy: an empty `PlainLedger_Common/scripts/app`
  fails the image build.
- **Do not override `initialization_jobs`** unless the replacement also runs
  `python -m plainledger.db.cloudsql_init`.
- **Do not give the service owner credentials to "fix" a permission error.** The runtime role's
  limits are the point.
- **A sector moved out of `ledgers`** goes into `ledgers_kept` while it has holdings, so its
  scheduled work and sealing stay.
