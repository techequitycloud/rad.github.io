---
title: "Odoo on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on labs: deploy a baseline, then pick feature labs for every configuration group — each with an objective, tested settings, verification, pitfalls and revert steps — plus operations, observability and teardown."
---

# Odoo on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Odoo_GKE)**

## Overview

**Estimated time:** core path (Tasks 1–2) about 60 minutes, most of it waiting for the first
deploy; each feature lab 10–40 minutes; every lab end to end about 9–11 hours.

Odoo is a comprehensive open-source ERP suite covering CRM, accounting, inventory,
manufacturing, HR, and eCommerce. The **Odoo on GKE Autopilot** module deploys Odoo Community
Edition as a Kubernetes workload on top of the `App_GKE` foundation: a custom Odoo image built
by Cloud Build, a PostgreSQL database on the shared Cloud SQL instance (reached through a Cloud
SQL Auth Proxy sidecar), Odoo's filestore and generated `odoo.conf` on the shared NFS server, an
`addons` Cloud Storage bucket mounted at `/mnt/extra-addons`, secrets in Secret Manager, and a
Gateway API load balancer with a free `nip.io` HTTPS hostname.

This lab takes you through the module's full operational lifecycle — deploy it, sign in to Odoo,
then change and verify **every group of settings** the deployment form exposes, run it day to
day, observe it, troubleshoot it, and tear it down. It focuses on operating the module and the
Google Cloud platform underneath it, not on Odoo's business features.

### How this lab is organised

- **Part 1 — Core (Tasks 1–2).** Everyone does this. Deploy a baseline with the defaults, sign in
  to Odoo for the first time, and learn to see each piece the baseline provisioned.
- **Part 2 — Feature labs (Labs 2–22).** One lab per variable group, numbered by group (Lab 4 is
  Group 4). After the baseline they are **independent of each other** — pick the features you
  care about from the menu and run them in any order. Each lab states its objective, time, cost
  and prerequisites, lists every setting in the group, and walks you through configure → apply →
  verify → explore → revert.
- **Part 3 — Operate, observe, troubleshoot, tear down (Tasks 3–6).**

### Lab menu

| Lab | Group | Objective (what you will be able to do) | Time | Adds cost? | External setup |
|---|---|---|---|---|---|
| Task 1–2 | 1 | Deploy Odoo, sign in as the administrator, and locate every resource it created | 60 min | Baseline | None |
| Lab 2 | 2 | Route monitoring alerts to people and stamp cost-tracking labels on every resource | 10 min | No | None |
| Lab 3 | 3 | Rename the app in the console, and understand which identity fields are safe to change | 10 min | No | None |
| Lab 4 | 4 | Size, autoscale (HPA or VPA) and tune the Odoo pod and its load-balancer timeout | 30 min | Small | None |
| Lab 5 | 5 | Inject plain and Secret Manager–backed settings (e.g. SMTP) into Odoo safely | 20 min | No | A Secret Manager secret you create |
| Lab 6 | 6 | Lock down pod traffic with a NetworkPolicy and tune shutdown and rollout timing | 25 min | No | Mesh/MCS options need ASM / a fleet |
| Lab 7 | 7 | Convert Odoo to a StatefulSet with its own block disk and prove the disk persists | 30 min | Small (disk) | None |
| Lab 8 | 8 | Cap the namespace's CPU and memory with a ResourceQuota that still allows rollouts | 15 min | No | None |
| Lab 9 | 9 | Protect Odoo during node maintenance with a PodDisruptionBudget and zone spreading | 15 min | No | None |
| Lab 10 | 10 | Tune the probes that gate traffic, and add an uptime check and a CPU alert | 25 min | Small | None |
| Lab 11 | 11 | Add your own init job, a nightly CronJob and a companion service beside Odoo | 35 min | Small | None |
| Lab 12 | 12 | Turn on Binary Authorization, and walk through GitHub CI/CD and Cloud Deploy | 20 min (read-only for CI/CD) | Small | **[External setup required]** GitHub for CI/CD |
| Lab 13 | 13 | Prove Odoo's filestore lives on NFS by writing, restarting and reading back | 20 min | No | None |
| Lab 14 | 14 | Add buckets, mount the addons bucket, and understand image retention and CMEK | 25 min | Small | KMS key for Artifact Registry CMEK |
| Lab 15 | 15 | Connect Odoo to Redis and confirm the setting reached `odoo.conf` | 15 min | No | None |
| Lab 16 | 16 | Install PostgreSQL extensions, add env-var aliases and rotate the DB password safely | 40 min | Small | None |
| Lab 17 | 17 | Schedule database backups, run one on demand, and understand restore-on-deploy | 20 min (+import) | Small | Backup import needs a staged backup file |
| Lab 18 | 18 | Run your own SQL scripts from a bucket against the Odoo database | 20 min | No | A bucket you create |
| Lab 19 | 19 | Serve Odoo on your own hostname with a managed certificate and a named static IP | 30 min | No | A DNS name (or nip.io) |
| Lab 20 | 20 | Put Google sign-in (IAP) in front of Odoo | 30 min | No | **[External setup required]** OAuth client |
| Lab 21 | 21 | Attach a Cloud Armor WAF and watch it block XSS/SQLi probes | 25 min | Yes | None |
| Lab 22 | 22 | Turn on detailed audit logging, and understand VPC Service Controls | 15 min | Small (logs) | **[External setup required]** for VPC-SC (organisation) |

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform, sign in to Odoo, and locate every resource it provisions.
- Change any setting group through **Update** with advanced mode, predict what the update will
  create, change or replace, and verify the result on the deployed resource itself.
- Tell an update-safe setting from one that can destroy or replace resources.
- Operate the workload day to day — scale, update, manage secrets, storage, jobs and the database.
- Observe it with Cloud Logging and Cloud Monitoring, including Odoo's own log file.
- Diagnose the failure modes seen when every group of this module was tested on a live deployment.
- Tear the deployment down cleanly and remove what the labs created outside it.

## Prerequisites

- **Services_GCP** (provides the VPC, GKE Autopilot cluster, Cloud SQL,
  Filestore, Artifact Registry, and shared service accounts this module depends
  on). You do not need to deploy this yourself first — the platform
  automatically detects whether it already exists in the target project and
  provisions it before this module if not (see Task 1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed, plus the `gke-gcloud-auth-plugin`
  (`gcloud components install gke-gcloud-auth-plugin`); `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project, so you can read the cluster, Cloud SQL,
  Secret Manager and Monitoring. `kubectl` needs at least **Kubernetes Engine Developer**.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including every setting in the feature labs below — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which is open to every account while builds are included in the price (on a lab environment, only an administrator can use it). Updates never carry a module fee.
- **RAD platform access** with permission to deploy modules into the project.
- `curl`, and optionally `jq`, on your workstation.

Set these shell variables once; every task and lab below reuses them:

```bash
export PROJECT="<your-project-id>"
export REGION="us-central1"     # the region you deploy into
export APP="odoo"               # application_name (Group 3) — change if you chose another
export TENANT="demo"            # tenant_id (Group 1)

# Connect to the GKE cluster provided by Services_GCP
export CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

# Derived names. The module names everything after the SERVICE NAME:
#   service_name = application_name + tenant_id + an 8-character hash
# and, unless you set namespace_name, the namespace has the same name.
export NS=$(kubectl get ns -o name | cut -d/ -f2 | grep -E "^${APP}${TENANT}[0-9a-f]{8}$" | head -1)
export SERVICE="$NS"                       # Deployment / Service / job prefix
export PREFIX="${SERVICE#${APP}}"          # tenant prefix, e.g. demo1a2b3c4d (Gateway, PDB, NetworkPolicy)
echo "Cluster=$CLUSTER  Namespace=$NS  Service=$SERVICE  TenantPrefix=$PREFIX"
```

Two more variables come from the running deployment and are set in Task 1, step 4: `HOST` (the
public HTTPS hostname) and `URL`.

## How to change settings in the feature labs

- **Update with advanced mode.** On the **Deployments** page open your Odoo deployment, click
  **Update**, tick **Enable advanced mode**, find the group named in the lab, change the values,
  and submit. The configuration snippets in this lab are written as HCL so every value is exact;
  enter them field by field in the form. Updates never carry a module fee.
- **Update-safe or not.** Every table below has an *Update-safe* column. An update-safe setting is
  one the module marks as safe to change on a running deployment. Changing any other setting makes
  the form warn you that the update may destroy or replace resources, and asks you to confirm.
  That warning is real: changing `application_name` creates a whole new Odoo; removing a
  `storage_buckets` entry deletes that bucket and its contents; `static_ip_name` gives the Gateway a
  new IP address. When an administrator turns on **Enforce Update Safe**, unflagged fields are
  read-only on updates. "Update-safe" means "will not destroy data", not "takes effect" — some
  update-safe fields are create-time only on GKE, and the labs say where.
- **Plan-time validation is your friend.** The module refuses invalid combinations before it
  changes anything — for example IAP without an OAuth client, VPA with `min_instance_count` above 1,
  or a PVC mounted on the NFS path. A refused update leaves the deployment exactly as it was; read
  the error, fix the values, submit again. Several labs deliberately trigger one.
- **One lab at a time.** Apply one group, verify it, then **Revert** (or keep it, if a later lab
  you plan to run builds on it). Labs assume the baseline plus nothing else unless they say so.
- **A green update is not proof.** Several settings in this module are accepted, applied and
  silently do nothing (they are called out as *inert* or *create-time only*). Every Verify step
  reads the deployed object back — `kubectl get … -o yaml`, the container's environment, a `curl`
  of the endpoint, or a write-restart-read for storage. Do the same whenever you change anything.

---

## Task 1 — Deploy the baseline [Automated]

The baseline is the module's defaults. Group 1 (`project_id`, `tenant_id`, `region`) is the only
group you must set, so it is covered here rather than in its own lab.

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `project_id` | *(required)* | No | Project everything is deployed into. |
| `tenant_id` | `demo` | No | 1–7 lowercase letters/digits. Every module on the same tenant in a project shares that tenant's network, cluster, database server and service accounts; change it to get a separate set of names. |
| `region` | `us-central1` | No | Fallback region; the region of the Services_GCP network wins when one is discovered. |

What the defaults give you: one Odoo pod (1 vCPU / 2 GiB) autoscaled from 1 to 3 pods by an HPA;
a Deployment with the `Recreate` update strategy (because it uses NFS); a `LoadBalancer` Service
plus a Gateway with a reserved global IP, a Google-managed certificate and a `<ip-with-dashes>.nip.io`
HTTPS hostname; a PostgreSQL database and user named after the service; the master password and
database password in Secret Manager; buckets `gcs-<service>-addons`, `gcs-<service>-data` and
`gcs-<service>-backups`; a nightly database-export CronJob; and a PodDisruptionBudget.

1. Open **Solutions → Solution Catalog → RAD modules** in the RAD platform top navigation, open **Odoo (GKE)** from the **Platform Modules** list to start configuration, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review the inputs.
   Leave everything else at its default for the baseline. If an Odoo already runs on the same
   tenant in this project, set `application_name` (Group 3) to something else, such as `odoo-lab`,
   so this lab gets its own namespace, database, secrets, buckets and NFS directory — and update
   `APP` in your shell variables to match.
   Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

2. The platform deploys Services_GCP first if the project does not have it, then builds the Odoo
   image with Cloud Build (Ubuntu Noble plus the Odoo nightly `.deb` for `application_version`),
   creates the database secrets, the namespace, the Kubernetes Secrets synced from Secret Manager,
   the buckets, and runs the one-shot jobs in order: the foundation's `nfs-setup` and `db-create`,
   then Odoo's own `nfs-init` (creates `/mnt/filestore`, `/mnt/sessions` and `/mnt/extra-addons`
   owned by the Odoo user, uid 101) and `db-init` (creates or updates the database role and the
   database). Finally it creates the Odoo Deployment and the Gateway. A first deploy takes roughly
   **25–40 minutes**; Cloud SQL and the image build dominate when Services_GCP is new.

   > On a brand-new cluster the first apply can finish before Kubernetes custom resources (such as
   > the Secret Manager sync) are registered. The platform's create pipeline runs a second,
   > Kubernetes-aware apply automatically, so you do not need to do anything — just expect two
   > apply phases in the log.

3. When the deployment shows success, re-run the shell-variable block from **Prerequisites** so
   `NS`, `SERVICE` and `PREFIX` are populated, then list what is in the namespace:

   ```bash
   kubectl get deploy,sts,pods,svc,hpa,pdb,jobs,cronjobs -n "$NS"
   kubectl get gateway,httproute,healthcheckpolicy,gcpbackendpolicy -n "$NS"
   ```

   Expect a Deployment named `$SERVICE` with one pod whose containers are all Ready, completed
   jobs `…-nfs-setup`, `…-db-create`, `…-nfs-init` and `…-db-init`, a CronJob `…-db-export`, and a
   Gateway `${PREFIX}-gateway`.

4. Find the public address. The deployment's **Outputs** show `service_url`; you can also derive
   it from the Gateway's address:

   ```bash
   GW_IP=$(kubectl get gateway -n "$NS" -o jsonpath='{.items[0].status.addresses[0].value}')
   export HOST="$(echo "$GW_IP" | tr . -).nip.io"     # the dashed form is the one the certificate covers
   export URL="https://${HOST}"
   echo "$URL"
   ```

   The Gateway is the only public entry point. Because Odoo_GKE turns the Gateway on, the
   Odoo Service is created as `ClusterIP` even though `service_type` defaults to
   `LoadBalancer`, so it has no external IP of its own and nothing can bypass IAP (Lab 20) or
   Cloud Armor (Lab 21): `kubectl get svc "$SERVICE" -n "$NS"` shows `ClusterIP` and
   `EXTERNAL-IP <none>`.

---

## Task 2 — Access & verify the baseline [Manual]

1. **Health.** Odoo's `/web/health` endpoint answers `200` only when the server is up and
   connected to its database. It is also the path the Gateway's health check uses, and that check
   needs a literal `200` (a redirect would mark the backend unhealthy):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"      # expect: 200
   curl -s "${URL}/web/health"; echo                                  # expect: {"status": "pass"}
   ```

   > A brand-new Google-managed certificate and Gateway can take **5–15 minutes** after the deploy
   > finishes before HTTPS answers. Meanwhile use the Service IP over HTTP:
   > `curl -s -o /dev/null -w "%{http_code}\n" "http://$(kubectl get svc "$SERVICE" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')/web/health"`.
   > On the very first boot Odoo installs its base module; the startup probe allows up to 9 minutes
   > (180 s delay + 3 × 120 s) before it gives up.

2. **First run: the database is already created for you.** Unlike a stock Odoo, this module does
   not ask you to create a database in the browser:
   - `db-init` creates a PostgreSQL database and role, both named after the service (hyphens
     become underscores, e.g. `odoodemo1a2b3c4d`).
   - At first boot the container generates `/mnt/odoo.conf` on the NFS share and starts
     `odoo -c /mnt/odoo.conf -i base`, which installs Odoo's base module into that database.
   - The generated configuration sets `list_db = False`, so the browser **database manager is
     disabled** — `/web/database/manager` reports that the administrator has disabled it, and
     nobody can create, duplicate, back up or drop databases from the web. Database lifecycle is
     handled by the module (Labs 16–18) instead.

   Confirm it from inside the pod (this prints no secrets):

   ```bash
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- \
     grep -E '^(db_name|list_db|data_dir|addons_path|workers|logfile)[[:space:]]*=' /mnt/odoo.conf
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- odoo --version
   ```

3. **Sign in as the administrator.** A database initialised from the command line with
   `-i base` has Odoo's built-in administrator: login `admin`, password `admin`. Check the
   credentials work before you open the browser (a number in `"uid"` means success; `false`
   means they were rejected):

   ```bash
   DB=$(kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- printenv DB_NAME)
   curl -s -X POST "${URL}/web/session/authenticate" -H 'Content-Type: application/json' \
     -d "{\"jsonrpc\":\"2.0\",\"params\":{\"db\":\"${DB}\",\"login\":\"admin\",\"password\":\"admin\"}}" \
     | grep -o '"uid": *[0-9a-z]*'
   ```

   Then open `$URL` in a browser, sign in as `admin` / `admin`, and **change the password
   immediately**: click your avatar (top right) → **My Profile** (called **Preferences** in older
   releases) → **Account Security** → **Change Password**. The deployment is on the public internet
   from the moment it is created, and `admin`/`admin` is the first thing anyone tries. Then set the
   administrator's email and the company details under **Settings**, and install the apps you need
   from **Apps** (an install can take a minute or two on the single-process server; the page may
   look idle while it works).

   > If `uid` comes back `false`, the database was not initialised by this module's first boot —
   > for example a backup was imported over it (Lab 17) — and its own administrator credentials
   > apply. Task 5 shows how to reset the administrator password from the cluster.

4. **The master password.** Odoo's master password (`admin_passwd`, used by the database manager)
   is generated by the module, stored in Secret Manager, injected as `ODOO_MASTER_PASS` and written
   into `odoo.conf` on every boot. With the database manager disabled you do not need it day to day,
   but keep it secret — it is what would protect database operations if the manager were ever
   re-enabled:

   ```bash
   MASTER_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~${PREFIX}-${APP}-master-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$MASTER_SECRET" --project="$PROJECT"
   ```

5. **See what the baseline provisioned.** Run each and match it to the description in Task 1:

   ```bash
   # Workload, autoscaler, disruption budget
   kubectl get deploy,hpa,pdb -n "$NS"
   kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.spec.strategy.type}{"\n"}'   # Recreate

   # Containers in the pod: Odoo plus the Cloud SQL Auth Proxy (and the GCS FUSE sidecar)
   kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{range .items[0].spec.containers[*]}{.name}{"\n"}{end}'

   # Storage: NFS at /mnt, the addons bucket at /mnt/extra-addons
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- df -h /mnt /mnt/extra-addons
   gcloud storage buckets list --project="$PROJECT" --filter="name~${SERVICE}" --format="value(name)"

   # Database: the shared instance, your database and user
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --filter="databaseVersion~POSTGRES" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --filter="name~${SERVICE//-/_}"
   gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" --filter="name~${SERVICE//-/_}"

   # Secrets: Secret Manager and the Kubernetes Secrets synced from it
   gcloud secrets list --project="$PROJECT" --filter="name~${SERVICE} OR name~${PREFIX}-${APP}" --format="value(name)"
   kubectl get secretsync,secret -n "$NS"

   # Edge: Gateway IP, certificate, static address
   gcloud compute addresses list --global --project="$PROJECT" --filter="name~${SERVICE}"
   gcloud certificate-manager certificates list --project="$PROJECT" --filter="name~${SERVICE}"
   ```

   `df` should show an NFS export (`<nfs-ip>:/share/<service>`) on `/mnt`, not `overlay` — if it
   shows `overlay`, the filestore is on the pod's disposable disk (see Lab 13).

---

## Part 2 — Feature labs

### Lab 2 — Deployment Environment (Group 2)

> **Objective:** route Cloud Monitoring notifications to named people and label every resource for cost tracking.

**You will:** add support contacts; add resource labels; find both on the deployed resources.
**Time:** 10 min · **Cost:** none · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `support_users` | `[]` | Yes | Emails that get project access and an email notification channel for this deployment's alerts and uptime check. |
| `resource_labels` | `{}` | Yes | Labels merged onto every resource the module creates (namespace, workloads, buckets, secrets, monitoring). |

#### Step 1 — Configure

```hcl
support_users   = ["<your-email>"]                                     # receives alert/uptime notifications
resource_labels = { environment = "lab", team = "erp", cost-centre = "it" }  # lowercase keys and values
```

#### Step 2 — Apply

Click **Update**. Expect about a dozen resources to be created (notification channel, IAM) and
many updated in place as labels are added. No pod restart is required. 3–8 minutes.

#### Step 3 — Verify

```bash
kubectl get ns "$NS" --show-labels                                        # environment=lab, team=erp …
kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.metadata.labels}{"\n"}'
gcloud storage buckets describe "gs://gcs-${SERVICE}-addons" --format="value(labels)"
gcloud beta monitoring channels list --project="$PROJECT" \
  --filter="displayName~${SERVICE}" --format="table(displayName,labels.email_address)"
```

Expected: the labels on the namespace, Deployment and bucket; a notification channel named
`<service>-notification-0` addressed to your email.

#### Explore further

- Filter billing by label: in **Billing → Reports**, group by label `cost-centre` (labels reach
  billing after up to a day).
- Add a second support user and check that a second channel appears.

#### Watch out for

- Label keys and values must be lowercase letters, digits, `_` and `-`; a capital letter fails the
  apply on the first resource that rejects it.
- On the Kubernetes **Service**, labels are create-time only (see Lab 4); everything else picks
  them up on update.

#### Revert

Set `support_users = []` and `resource_labels = {}`. The notification channel is deleted.

---

### Lab 3 — Application Identity (Group 3)

> **Objective:** change how Odoo is named and described in the console, and understand which identity fields are safe to change.

**You will:** change the display name and description; check the running Odoo version; learn why `application_name` and `application_version` need care.
**Time:** 10 min · **Cost:** none · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `application_name` | `odoo` | **No** | Base of every resource name (service name = this + tenant + hash). Changing it creates a completely new, empty Odoo beside the old one. |
| `application_display_name` | `Odoo ERP` | Yes | Friendly name in the console and monitoring. |
| `application_description` | `Odoo ERP on GKE Autopilot` | Yes | Description annotation on the workload. |
| `application_version` | `18.0` | Yes | Odoo nightly series to build (`18.0`, `17.0`, …). Passed to the Dockerfile as `ODOO_VERSION`. |

#### Step 1 — Configure

```hcl
application_display_name = "Odoo ERP (lab)"                    # cosmetic
application_description  = "Odoo 18 ERP on GKE Autopilot - lab" # cosmetic
application_version      = "18.0"                               # leave the series unchanged
```

#### Step 2 — Apply

**Update**. Metadata changes in place; a few jobs and annotations are refreshed. 3–6 minutes.

#### Step 3 — Verify

```bash
kubectl get deploy "$SERVICE" -n "$NS" -o yaml | grep -iE 'description|display' | head
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- odoo --version     # Odoo Server 18.0-…
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"           # 200
```

#### Explore further

- Compare `odoo --version` with the image tag: `kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}'`.
  Building again on the same series picks up the latest nightly of that series.

#### Watch out for

- **`application_name`** is the identity of the whole deployment. Changing it does not rename
  anything — it builds a second Odoo with a new namespace, database, secrets, buckets and NFS
  directory, and the old one is destroyed. Treat it as fixed after the first deploy.
- **`application_version` across major series.** Odoo does not migrate a database from one major
  version to another by itself. Moving an existing 18.0 database to 17.0 (a downgrade) or to a
  newer series without Odoo's upgrade process can leave Odoo unable to start. Change the series
  only on a fresh deployment, or after following Odoo's upgrade procedure.

#### Revert

Restore `Odoo ERP` / `Odoo ERP on GKE Autopilot`.

---

### Lab 4 — Runtime & Scaling (Group 4)

> **Objective:** size and autoscale the Odoo pod, choose between HPA and VPA, and tune the load balancer's request timeout.

**You will:** raise the replica range; compare HPA with VPA; set the backend timeout; learn which runtime settings are create-time only.
**Time:** 30 min · **Cost:** small — each extra pod costs about as much as the first (Autopilot bills requested CPU/memory) · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `deploy_application` | `true` | **No** | `false` provisions everything except the Odoo workload. Flipping it on a running deployment removes the workload. |
| `container_image_source` | `custom` | **No** | `custom` builds the Odoo image with Cloud Build; `prebuilt` deploys `container_image` as is. Odoo needs `custom`. |
| `container_image` | `""` | Yes | Image URI for `prebuilt`. |
| `container_build_config` | `{ enabled = true }` | Yes | Dockerfile, context and build args for `custom`. The module always passes `ODOO_VERSION` from `application_version`. |
| `enable_image_mirroring` | `true` | **No** | Copies the image into Artifact Registry before deploying. |
| `min_instance_count` | `1` | Yes | HPA minimum. Keep at least 1 — Odoo's scheduled actions run inside the server. |
| `max_instance_count` | `3` | Yes | HPA maximum (cost ceiling). |
| `enable_vertical_pod_autoscaling` | `false` | **No** | Creates a VPA that sets requests from observed usage, and removes the HPA. |
| `container_port` | `8069` | Yes | Odoo's HTTP port. Do not change. |
| `container_protocol` | `http1` | Yes | `h2c` is for gRPC backends; Odoo speaks HTTP/1.1. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Yes (create-time only) | CPU/memory limits and optional `cpu_request` / `mem_request`. |
| `timeout_seconds` | `300` | Yes | Gateway backend timeout (`GCPBackendPolicy.timeoutSec`). |
| `enable_cloudsql_volume` | `true` | Yes | Adds the Cloud SQL Auth Proxy sidecar. Odoo needs it. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Yes | Where the proxy socket directory is mounted. |
| `service_annotations` | `{}` | Yes (create-time only) | Extra annotations on the Kubernetes Service. |
| `service_labels` | `{}` | Yes (create-time only) | Extra labels on the Kubernetes Service. |

#### Step 1 — Configure

Part A — HPA range and timeout (the safe, common case):

```hcl
min_instance_count = 1       # always one Odoo running (scheduler, mail fetch)
max_instance_count = 2       # allow one extra pod under load
timeout_seconds    = 600     # long reports / imports over the Gateway
```

Part B — try VPA instead of the HPA (tested values):

```hcl
enable_vertical_pod_autoscaling = true   # VPA sizes the single pod; the HPA is removed
min_instance_count              = 1      # must be 1 with VPA (plan-time guard)
```

#### Step 2 — Apply

Part A: the HPA and the `GCPBackendPolicy` are updated in place; no pod restart. 3–6 minutes.
Part B: creates a `VerticalPodAutoscaler` and deletes the HPA.

#### Step 3 — Verify

```bash
# Part A
kubectl get hpa -n "$NS"                                                    # MINPODS 1  MAXPODS 2
kubectl get gcpbackendpolicy -n "$NS" -o yaml | grep timeoutSec            # timeoutSec: 600

# Part B
kubectl get vpa -n "$NS"                                                    # ${SERVICE}-vpa
kubectl get hpa -n "$NS"                                                    # No resources found
kubectl describe vpa "${SERVICE}-vpa" -n "$NS" | sed -n '/Recommendation/,$p'

# Resources actually applied to the running container
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.containers[0].resources}{"\n"}'
```

#### Explore further

- **Plan-time guard:** with VPA on, set `min_instance_count = 2` and submit. The update is refused
  with an explanation — VPA removes the HPA, and nothing would then enforce the minimum.
- **Create-time only:** change `container_resources` to `{ cpu_limit = "2000m", memory_limit = "4Gi" }`
  on the running deployment. The update succeeds, but the `resources` printed above do not change:
  the module ignores later changes to the container's requests and limits (GKE Autopilot rewrites
  them, and the module would otherwise fight it on every apply). New values apply only when the
  workload is created — at first deploy, or when Lab 7 converts it to a StatefulSet.
  The same is true of `service_annotations` and `service_labels` on the Service.
- Use `kubectl top pod -n "$NS"` before and after a busy period to choose a sensible memory size.

#### Watch out for

- **Do not go below 2 GiB of memory.** Odoo's own memory guard (`limit_memory_hard` ≈ 1.5 GiB,
  `limit_memory_soft` ≈ 640 MiB in `odoo.conf`) only works below the container limit; at 512 MiB
  the kernel kills Odoo before it can recycle itself, especially during `-i base` on first boot.
- `mem_request` (not `memory_request`) is the field name. A misspelt attribute is silently
  dropped, and the request falls back to the limit.
- `min_instance_count = 0` stops Odoo completely between scale-ups — scheduled actions, mail
  fetching and reminders stop with it.
- Changing the workload with the default `Recreate` strategy has a short outage: the old pod
  stops before the new one starts, because two Odoo pods must not hold the same NFS files during
  an update.

#### Revert

`enable_vertical_pod_autoscaling = false` (the VPA is deleted and the HPA returns), `min_instance_count = 1`,
`max_instance_count = 3`, `timeout_seconds = 300`.

---

### Lab 5 — Environment Variables & Secrets (Group 5)

> **Objective:** pass configuration and secrets to Odoo without exposing secret values in the pod spec.

**You will:** add plain env vars; reference a Secret Manager secret; see a credential-looking variable moved into a Kubernetes Secret automatically.
**Time:** 20 min · **Cost:** none · **Prerequisites / external setup:** one Secret Manager secret you create (below).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `environment_variables` | `{}` | Yes | Plain env vars for the Odoo container. |
| `secret_environment_variables` | `{}` | Yes | Map of env var → Secret Manager secret name. Synced into a Kubernetes Secret and injected with `secretKeyRef`. |
| `secret_rotation_period` | `2592000s` | Yes | Rotation schedule for the module's secrets; creates the Pub/Sub topic `secret-<service>-rotation`. |
| `secret_propagation_delay` | `30` | Yes | Seconds to wait after writing a secret before dependent steps use it. |
| `protect_sensitive_environment_variables` | `true` | Yes | Moves any `environment_variables` entry whose name looks like a credential (`…_PASSWORD`, `…_TOKEN`, `…_SECRET`, `…_API_KEY` …) into a Kubernetes Secret. Hidden in RAD-managed projects. |

`explicit_secret_values` (for example a custom `ODOO_MASTER_PASS`) is not on the form — see the appendix.

#### Step 1 — Configure

Create the secret first, in your region (RAD-managed projects reject global secrets):

```bash
printf 'lab-secret-value' | gcloud secrets create odoo-lab-marker --project="$PROJECT" \
  --replication-policy=user-managed --locations="$REGION" --data-file=-
```

```hcl
environment_variables = {
  TZ                = "UTC"          # plain value
  ODOO_LAB_MARKER   = "group-5"      # plain marker to find in the pod
  SMTP_LAB_PASSWORD = "not-real"     # name ends in _PASSWORD → moved into a Kubernetes Secret
}
secret_environment_variables = { ODOO_LAB_SECRET = "odoo-lab-marker" }  # env var → Secret Manager secret
secret_propagation_delay     = 60
```

#### Step 2 — Apply

**Update**. The SecretSync resource and Kubernetes Secret gain a key, and the Deployment's pod
template changes, so Odoo restarts (short outage with `Recreate`). 5–10 minutes.

#### Step 3 — Verify

```bash
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- printenv TZ ODOO_LAB_MARKER   # UTC / group-5
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sh -c 'test -n "$ODOO_LAB_SECRET" && echo secret-present'

# How each variable is injected: plain value vs secretKeyRef
kubectl get deploy "$SERVICE" -n "$NS" -o yaml | grep -A4 -E 'name: (ODOO_LAB_MARKER|ODOO_LAB_SECRET|SMTP_LAB_PASSWORD)$'
```

Expected: `ODOO_LAB_MARKER` has a `value:`; `ODOO_LAB_SECRET` and `SMTP_LAB_PASSWORD` show
`valueFrom: secretKeyRef:` — the password-like value never appears in the Deployment.

#### Explore further

- **Real SMTP for Odoo.** Odoo's outgoing mail server is configured in the Odoo UI (**Settings →
  Technical → Outgoing Mail Servers**, with developer mode on). Use Group 5 to carry the values your
  own add-ons or scripts read.
- **Secret updates.** Add a new version: `printf 'v2' | gcloud secrets versions add odoo-lab-marker --data-file=- --project="$PROJECT"`.
  The cluster's Secret Manager sync refreshes the Kubernetes Secret about every 2 minutes;
  environment variables are read at container start, so restart to pick it up:
  `kubectl rollout restart deploy/"$SERVICE" -n "$NS"`.

#### Watch out for

- The secret must exist **before** the update, in the same project; a missing secret keeps the
  pod out of Ready.
- Env var names with a double underscore (`__`) cannot be synced as Kubernetes Secret keys; use
  single underscores.
- Turning `protect_sensitive_environment_variables` off puts credential values in plain text in
  the pod spec for anyone who can read it.

#### Revert

Set `environment_variables = {}`, `secret_environment_variables = {}`, `secret_propagation_delay = 30`,
then delete the secret: `gcloud secrets delete odoo-lab-marker --project="$PROJECT" --quiet`.

---

### Lab 6 — GKE Backend & Cluster (Group 6)

> **Objective:** isolate the Odoo namespace with a NetworkPolicy and tune shutdown and rollout timing, while keeping the load balancer path working.

**You will:** enable network segmentation; prove Odoo still reaches Cloud SQL and the internet path still works; tune grace period and rollout timeout.
**Time:** 25 min · **Cost:** none · **Prerequisites / external setup:** Multi-Cluster Services needs a registered fleet; service mesh needs Cloud Service Mesh — both optional and not required for this lab.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `gke_cluster_name` | `""` | Yes | Target cluster; empty auto-discovers the Services_GCP cluster. Changing it moves the app to another cluster. |
| `namespace_name` | `""` | Yes | Namespace; empty uses the service name. Changing it moves every namespaced resource. |
| `workload_type` | `null` | **No** | `Deployment` or `StatefulSet`; `null` picks StatefulSet when `stateful_pvc_enabled = true` (Lab 7). |
| `service_type` | `LoadBalancer` | **No** | Kubernetes Service type. While a Gateway is in use (custom domain, CDN or Cloud Armor — the Odoo default), `LoadBalancer` is created as `ClusterIP` so the Gateway is the only way in. `NodePort` is honoured as set. |
| `session_affinity` | `ClientIP` | Yes | Sticky routing on the Service. |
| `enable_multi_cluster_service` | `false` | Yes | Creates a `ServiceExport` for fleet-wide consumption. Needs a fleet with MCS. |
| `configure_service_mesh` | `false` | **No** | Labels the namespace for Istio sidecar injection. Needs Cloud Service Mesh. |
| `deployment_strategy` | `null` | **No** | `RollingUpdate` or `Recreate`. `null` lets the foundation choose — `Recreate` here, because Odoo is NFS-backed. |
| `enable_network_segmentation` | `false` | **No** | Creates the NetworkPolicy `<tenant-prefix>-namespace-isolation`. |
| `termination_grace_period_seconds` | `30` | Yes | Seconds Odoo gets after SIGTERM before it is killed. |
| `deployment_timeout` | `1800` | Yes | How long an apply waits for the rollout to finish. |

#### Step 1 — Configure

```hcl
enable_network_segmentation      = true    # default-deny with explicit allow rules
termination_grace_period_seconds = 60      # let in-flight requests finish
deployment_timeout               = 2400    # first boots and big images take time
session_affinity                 = "ClientIP"
service_type                     = "LoadBalancer"
```

#### Step 2 — Apply

Creates one NetworkPolicy; the pod template changes (grace period), so Odoo restarts. 5–10 minutes.

#### Step 3 — Verify

```bash
kubectl get networkpolicy -n "$NS"
kubectl describe networkpolicy "${PREFIX}-namespace-isolation" -n "$NS" | sed -n '/Allowing egress/,$p' | head -40

# Odoo can still reach the database through the proxy, and the LB path still works
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"                       # 200
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
  'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select 1"'   # 1
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.terminationGracePeriodSeconds}{"\n"}'  # 60
```

The policy allows traffic inside the namespace, from Google's load-balancer and health-check
ranges, DNS, the Cloud SQL instance's private IP, the NFS server and Redis.

#### Explore further

- Start a throwaway pod in another namespace and try to reach Odoo directly — it should time out:
  `kubectl run np-test -n default --rm -it --image=curlimages/curl --restart=Never -- curl -m 5 -s -o /dev/null -w '%{http_code}\n' http://${SERVICE}.${NS}.svc.cluster.local/web/health`.
- Read the egress rules and note the Cloud SQL rule targets the instance's real private IP.

#### Watch out for

- `gke_cluster_name` and `namespace_name` are flagged update-safe but changing them relocates the
  app (and recreates the Gateway and its reserved IP). If you ever pin them, pin them to the
  derived values you see today (`$CLUSTER`, `$NS`).
- `deployment_strategy = "RollingUpdate"` briefly runs two Odoo pods on the same NFS share and database during an update. The inferred `Recreate` avoids exactly that; override it only if you accept the overlap. Check the result with `kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.spec.strategy.type}'`.
- Turning on `configure_service_mesh` or `enable_multi_cluster_service` without the platform
  feature behind it fails the apply or does nothing useful.

#### Revert

`enable_network_segmentation = false`, `termination_grace_period_seconds = 30`, `deployment_timeout = 1800`.

---

### Lab 7 — StatefulSet (Group 7)

> **Objective:** run Odoo as a StatefulSet with its own block disk, and prove data on that disk survives a pod replacement.

**You will:** convert the workload to a StatefulSet with a PVC; mount it beside (not over) the NFS share; write, delete the pod, and read back.
**Time:** 30 min · **Cost:** small — a 10 GiB standard persistent disk · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `stateful_pvc_enabled` | `null` | **No** | Adds a per-pod PVC; with `workload_type = null` the workload becomes a StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Yes | PVC size. |
| `stateful_pvc_mount_path` | `/data` | Yes | Where the PVC is mounted. Must not be `/mnt` (the NFS mount). |
| `stateful_pvc_storage_class` | `standard-rwo` | Yes | `standard-rwo` is SSD-backed balanced disk; `standard` is HDD. |
| `stateful_headless_service` | `null` | **No** | Adds a headless Service for stable per-pod DNS. |
| `stateful_pod_management_policy` | `null` | Yes | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` | Yes | `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` | Yes (create-time only) | Pod `fsGroup`; makes the disk writable by a non-root process. Odoo runs as uid/gid 101. |

#### Step 1 — Configure

```hcl
stateful_pvc_enabled           = true
stateful_pvc_size              = "10Gi"
stateful_pvc_mount_path        = "/var/lib/odoo-block"  # OUTSIDE /mnt, where the NFS share is
stateful_pvc_storage_class     = "standard"             # HDD: spares the tight SSD quota
stateful_headless_service      = true
stateful_pod_management_policy = "OrderedReady"
stateful_update_strategy       = "RollingUpdate"
stateful_fs_group              = 101                    # the odoo user's gid
```

#### Step 2 — Apply

The Deployment is **replaced** by a StatefulSet (short outage), a PVC is created and bound, and a
headless Service is added. The Odoo data itself is unaffected — it is on NFS and Cloud SQL.
8–15 minutes.

#### Step 3 — Verify

```bash
kubectl get sts,pvc,svc -n "$NS"                                     # PVC Bound, 10Gi, standard
POD=$(kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NS" "$POD" -c "$APP" -- df -h /var/lib/odoo-block   # a /dev/sd* block device

# Write – replace the pod – read back
kubectl exec -n "$NS" "$POD" -c "$APP" -- sh -c 'date -u > /var/lib/odoo-block/marker && cat /var/lib/odoo-block/marker'
kubectl delete pod "$POD" -n "$NS"
kubectl wait --for=condition=Ready pod/"$POD" -n "$NS" --timeout=900s
kubectl exec -n "$NS" "$POD" -c "$APP" -- cat /var/lib/odoo-block/marker   # same timestamp
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"               # 200
```

From now on use `sts/"$SERVICE"` (or `$POD`) instead of `deploy/"$SERVICE"` in commands.

#### Explore further

- **Plan-time guards:** set `stateful_pvc_mount_path = "/mnt"` and submit — refused, because a
  container cannot mount two volumes at one path. Set `workload_type = "Deployment"` together with
  `stateful_pvc_enabled = true` — refused too.
- Compare `fsGroup` on the pod (`kubectl get pod "$POD" -n "$NS" -o jsonpath='{.spec.securityContext}'`).

#### Watch out for

- Odoo itself keeps its data on NFS (`/mnt/filestore`) and in Cloud SQL; the block disk is extra
  space for your own add-ons or tools, not a replacement for NFS.
- Mount the PVC **outside** `/mnt` — mounting over it would hide Odoo's filestore and `odoo.conf`.
- `stateful_fs_group` must be set when the StatefulSet is created; changing it later is ignored.
  Without it (or with the wrong gid) the odoo user cannot write to the disk.
- SSD (`standard-rwo`) draws on a small regional SSD quota; scaling to zero keeps the PVC and its
  quota until the PVC is deleted.

#### Revert

Set `stateful_pvc_enabled = null` and `stateful_headless_service = null` (and leave the other
fields at their defaults). The StatefulSet is replaced by a Deployment again (short outage).
Check whether the PVC was removed — `kubectl get pvc -n "$NS"` — and delete it if it remains:
`kubectl delete pvc -n "$NS" --all` (only PVCs from this lab live in this namespace).

---

### Lab 8 — Resource Quota (Group 8)

> **Objective:** cap the namespace's total CPU and memory without blocking Odoo's own updates and jobs.

**You will:** create a ResourceQuota sized with headroom; see usage accounted against it; trigger the binary-unit validation.
**Time:** 15 min · **Cost:** none · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_resource_quota` | `false` | **No** | Creates the ResourceQuota `app-quota` in the namespace. |
| `quota_cpu_requests` | `""` | Yes | Total CPU requests, e.g. `4`. |
| `quota_cpu_limits` | `""` | Yes | Total CPU limits, ≥ requests. |
| `quota_memory_requests` | `""` | Yes | Total memory requests with a binary suffix, e.g. `8Gi`. |
| `quota_memory_limits` | `""` | Yes | Total memory limits with a binary suffix, ≥ requests. |

#### Step 1 — Configure

Size for at least twice the running pods plus jobs, so a new pod can start while the old one is
still accounted:

```hcl
enable_resource_quota = true
quota_cpu_requests    = "4"
quota_cpu_limits      = "8"
quota_memory_requests = "8Gi"     # binary suffix is mandatory
quota_memory_limits   = "16Gi"
```

#### Step 2 — Apply

Creates one ResourceQuota. No restart. 3–5 minutes.

#### Step 3 — Verify

```bash
kubectl describe resourcequota app-quota -n "$NS"     # Used vs Hard for each resource
```

Expected: `requests.cpu`, `limits.memory` and the others show non-zero usage from Odoo and its
sidecars, well under the hard limits.

#### Explore further

- **Validation:** set `quota_memory_requests = "8000000000"` and submit — refused; a bare number
  means bytes to Kubernetes and would block scheduling.
- Lower `quota_memory_limits` until a restart (`kubectl rollout restart`) leaves a pod `Pending`
  with an `exceeded quota` event (`kubectl get events -n "$NS" --sort-by=.lastTimestamp | tail`).
  Then raise it again.

#### Watch out for

- A quota sized for exactly one pod deadlocks updates and job runs. Every init job and CronJob
  pod counts too.

#### Revert

`enable_resource_quota = false` and the four quota fields back to `""`.

---

### Lab 9 — Reliability Policies (Group 9)

> **Objective:** decide how much of Odoo may be evicted during node maintenance, and spread pods across zones.

**You will:** set a PodDisruptionBudget; add topology spread constraints; read the allowed-disruptions count.
**Time:** 15 min · **Cost:** none (more if you raise the replica count) · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_pod_disruption_budget` | `true` | Yes | Creates `<tenant-prefix>-pdb`. |
| `pdb_min_available` | `1` | Yes | Pods that must stay up during voluntary disruptions — a number or a percentage. |
| `enable_topology_spread` | `false` | Yes | Adds zone topology spread constraints to the pod. |
| `topology_spread_strict` | `false` | Yes | `true` = `DoNotSchedule`; `false` = `ScheduleAnyway`. |

#### Step 1 — Configure

```hcl
enable_pod_disruption_budget = true
pdb_min_available            = "50%"
enable_topology_spread       = true
topology_spread_strict       = false    # never leave a pod unscheduled because of spreading
```

#### Step 2 — Apply

Updates the PDB and the pod template (Odoo restarts). 5–8 minutes.

#### Step 3 — Verify

```bash
kubectl get pdb -n "$NS"     # MIN AVAILABLE 50%   ALLOWED DISRUPTIONS 0 (with one replica)
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.topologySpreadConstraints}{"\n"}'
```

#### Explore further

- With one replica, both `"1"` and `"50%"` allow **zero** voluntary disruptions (50% of 1 rounds
  up to 1), so node upgrades wait on Odoo. Set `min_instance_count = 2` (Lab 4) and watch
  `ALLOWED DISRUPTIONS` become 1.
- **Plan-time guard:** with `max_instance_count = 2`, set `pdb_min_available = "2"` — refused,
  because a budget equal to the maximum could never allow an eviction.

#### Watch out for

- A PDB that allows zero disruptions can stall cluster upgrades for as long as GKE respects it.
- `topology_spread_strict = true` with fewer zones than pods can leave pods `Pending`.

#### Revert

`pdb_min_available = "1"`, `enable_topology_spread = false`.

---

### Lab 10 — Observability & Health (Group 10)

> **Objective:** tune the probes that decide when Odoo receives traffic, and add an uptime check and a CPU alert.

**You will:** change probe timings and see them on the pod and the Gateway health check; create an uptime check and an alert policy.
**Time:** 25 min · **Cost:** small (uptime checks and alerting have a free allowance) · **Prerequisites:** Lab 2's `support_users` if you want email notifications.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `startup_probe_config` | path `/web/health`, delay 180, timeout 60, period 120, threshold 3 | Yes | Startup probe — no traffic and no liveness checks until it passes. |
| `health_check_config` | path `/web/health`, delay 30, timeout 5, period 30, threshold 3 | Yes | Liveness **and readiness** probe; also mirrored into the Gateway `HealthCheckPolicy`. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | **No** | Cloud Monitoring uptime check against the public HTTPS hostname. |
| `alert_policies` | `[]` | Yes | Metric alert policies, notified to `support_users`. |

#### Step 1 — Configure

```hcl
health_check_config  = { enabled = true, type = "HTTP", path = "/web/health",
                         initial_delay_seconds = 45, timeout_seconds = 10, period_seconds = 20, failure_threshold = 5 }
startup_probe_config = { enabled = true, type = "HTTP", path = "/web/health",
                         initial_delay_seconds = 60, timeout_seconds = 30, period_seconds = 15, failure_threshold = 40 }  # up to ~11 min
uptime_check_config  = { enabled = true, path = "/web/health", check_interval = "300s", timeout = "30s" }
alert_policies = [{
  name = "odoo-high-cpu", metric_type = "kubernetes.io/container/cpu/limit_utilization",
  comparison = "COMPARISON_GT", threshold_value = 0.85, duration_seconds = 300, aggregation_period = "60s"
}]
```

#### Step 2 — Apply

Pod template changes (Odoo restarts); the `HealthCheckPolicy` is updated; an uptime check, its
alert and your alert policy are created. 5–10 minutes.

#### Step 3 — Verify

```bash
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.containers[0].livenessProbe}{"\n"}{.items[0].spec.containers[0].startupProbe}{"\n"}'
kubectl get healthcheckpolicy -n "$NS" -o yaml | grep -E 'requestPath|checkIntervalSec|timeoutSec'
gcloud monitoring uptime list-configs --project="$PROJECT" --filter="displayName~${SERVICE}" \
  --format="table(displayName,httpCheck.path,period,monitoredResource.labels.host)"
gcloud alpha monitoring policies list --project="$PROJECT" --filter="displayName~${SERVICE}" --format="value(displayName)"
```

Expected: the probe timings you set; a `HealthCheckPolicy` probing `/web/health`; an uptime
check `<service>-uptime-check` on the dashed `nip.io` host; policies `<service>-odoo-high-cpu`
and `<service>-uptime-check-alert`.

#### Explore further

- Open **Monitoring → Uptime checks** and watch results arrive from several regions.
- Set a deliberately low CPU threshold (e.g. `0.01`) to see an incident open and an email arrive,
  then put it back.

#### Watch out for

- **Keep the probe path on `/web/health`.** It returns a literal `200`. Odoo answers `/` with a
  redirect, which Kubernetes accepts but Google's load-balancer health check does not — the pod
  would look healthy while the Gateway returns 503.
- `health_check_config` is the live probe on this module and drives the Gateway health check too;
  a too-short timeout here takes Odoo out of the load balancer during slow requests.
- Use a generous startup budget: the first boot installs the base module and can take several minutes.
- The uptime check is only created when a public endpoint exists (the Gateway with a domain or a
  reserved IP — the default).

#### Revert

Restore the default probe objects shown in the table, `uptime_check_config = { enabled = false, path = "/" }`,
`alert_policies = []`.

---

### Lab 11 — Jobs & Scheduled Tasks (Group 11)

> **Objective:** run your own one-off and scheduled jobs beside Odoo, and add a companion service.

**You will:** add a third init job after Odoo's own; add a nightly CronJob; deploy an nginx companion and reach it from Odoo.
**Time:** 35 min · **Cost:** small (one extra small pod) · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `initialization_jobs` | `[]` | Yes | One-shot Kubernetes Jobs. **Empty means "use Odoo's `nfs-init` and `db-init`". A non-empty list REPLACES them.** Fields include `needs_db` and `needs_secrets`. |
| `cron_jobs` | `[]` | Yes | Kubernetes CronJobs `<service>-<name>`. |
| `additional_services` | `[]` | Yes | Companion Deployments and Services `<service>-<name>` in the namespace. |

#### Step 1 — Configure

Restate Odoo's two jobs, then add yours (this is the tested configuration):

```hcl
initialization_jobs = [
  { # Odoo's own NFS layout job — restated because a non-empty list replaces the defaults
    name = "nfs-init", image = "alpine:3.19", mount_nfs = true, execute_on_apply = true, needs_db = false
    command = ["/bin/sh", "-c"]
    args = ["mkdir -p /mnt/filestore /mnt/sessions /mnt/extra-addons && chown -R 101:101 /mnt/filestore /mnt/sessions /mnt/extra-addons && chmod -R 777 /mnt/filestore /mnt/sessions /mnt/extra-addons"]
  },
  { # Odoo's own database/role job — the script ships with the module
    name = "db-init", image = "postgres:15-alpine", script_path = "../Odoo_Common/scripts/db-init.sh"
    depends_on_jobs = ["nfs-init"], execute_on_apply = true, timeout_seconds = 600
    secret_env_vars = { DB_PASSWORD = "DB_PASSWORD", ROOT_PASSWORD = "ROOT_PASSWORD" }
  },
  { # your job, third in the chain
    name = "lab-probe", image = "alpine:3.19", mount_nfs = true, needs_db = false, needs_secrets = false
    depends_on_jobs = ["db-init"], execute_on_apply = true
    command = ["/bin/sh", "-c"], args = ["date -u > /mnt/lab-probe.marker && cat /mnt/lab-probe.marker"]
    cpu_limit = "500m", memory_limit = "256Mi"
  },
]
cron_jobs = [{
  name = "lab-cron", schedule = "17 3 * * *", image = "alpine:3.19", mount_nfs = true
  command = ["/bin/sh", "-c"], args = ["echo \"lab cron tick $(date -u)\""]
  cpu_limit = "500m", memory_limit = "256Mi"
}]
additional_services = [{
  name = "lab-sidecar", image = "nginx:alpine", port = 80, cpu_limit = "500m", memory_limit = "256Mi"
}]
```

#### Step 2 — Apply

Creates the `lab-probe` Job, the CronJob, and a Deployment plus Service for nginx. A job is
re-created only when its definition or script changes. 5–10 minutes.

#### Step 3 — Verify

```bash
kubectl get jobs,cronjobs -n "$NS"
kubectl logs -n "$NS" job/"${SERVICE}-lab-probe"                   # a UTC timestamp
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- cat /mnt/lab-probe.marker

# Run the CronJob now instead of waiting for 03:17 UTC
kubectl create job -n "$NS" --from=cronjob/"${SERVICE}-lab-cron" lab-cron-manual
kubectl logs -n "$NS" job/lab-cron-manual                           # lab cron tick …

# The companion service, reached from inside Odoo by cluster DNS
kubectl get deploy,svc -n "$NS" | grep lab-sidecar
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- curl -s -o /dev/null -w "%{http_code}\n" "http://${SERVICE}-lab-sidecar:80/"   # 200
```

#### Explore further

- **Ordering is creation, not completion.** `depends_on_jobs` orders when Jobs are *created*; a job
  only waits for its predecessor to *finish* if the predecessor has `execute_on_apply = true` (which
  also makes the apply wait). Remove it from `db-init` and compare the jobs' start times
  (`kubectl get jobs -n "$NS" -o custom-columns=NAME:.metadata.name,START:.status.startTime`).
- Edit only the `lab-probe` command and apply: only that Job is re-created.

#### Watch out for

- **Forgetting to restate `nfs-init` and `db-init`** removes them: an existing deployment keeps
  working, but a fresh database or NFS share would never be prepared.
- Chains deeper than four levels are refused at plan time.
- `needs_db = false` stops the Cloud SQL proxy sidecar being attached to a job that does not use the
  database; a job that does need it but has it off cannot connect.

#### Revert

Set all three lists back to `[]` (Odoo's default jobs return). Delete the manual job:
`kubectl delete job lab-cron-manual -n "$NS"`, and the marker: `kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- rm -f /mnt/lab-probe.marker`.

---

### Lab 12 — CI/CD & GitHub Integration (Group 12)

> **Objective:** enforce Binary Authorization on Odoo's cluster, and understand how GitHub CI/CD and Cloud Deploy would take over image delivery.

**You will:** turn on Binary Authorization and read the cluster and project policy; walk through the CI/CD and Cloud Deploy settings.
**Time:** 20 min (CI/CD as a read-only walkthrough) · **Cost:** small · **Prerequisites / external setup:** **[External setup required]** for CI/CD — a GitHub repository plus a personal access token (`repo`, `admin:repo_hook`) or the Cloud Build GitHub App installation. You can complete the Binary Authorization part without it.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | Yes | Creates a Cloud Build GitHub connection and trigger that builds and deploys on push. |
| `github_repository_url` | `""` | Yes | Repository URL; required with the trigger. |
| `github_token` | `""` | Yes | PAT used to create the connection (stored in Secret Manager after the first apply). |
| `github_app_installation_id` | `""` | Yes | Cloud Build GitHub App installation id (preferred for organisations). |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Yes | Branch pattern, included/ignored files, substitutions. |
| `enable_cloud_deploy` | `false` | Yes | Routes releases through a Cloud Deploy pipeline. Requires the trigger. |
| `cloud_deploy_stages` | dev, staging, prod (prod needs approval) | Yes | Pipeline stages; each stage gets its own namespace `<service>-<stage>`. |
| `enable_binary_authorization` | `false` | **No** | Enforces the project's Binary Authorization policy on the cluster. |

#### Step 1 — Configure

```hcl
enable_binary_authorization = true    # enforced on the cluster; the project policy stays ALWAYS_ALLOW
enable_cicd_trigger         = false   # [EXT] leave off unless you have the GitHub setup
enable_cloud_deploy         = false
```

#### Step 2 — Apply

The project policy is imported/updated and the cluster enforces it. Odoo keeps running. 5–10 minutes.

#### Step 3 — Verify

```bash
gcloud container clusters describe "$CLUSTER" --region="$REGION" --project="$PROJECT" \
  --format="value(binaryAuthorization.evaluationMode)"          # PROJECT_SINGLETON_POLICY_ENFORCE
gcloud container binauthz policy export --project="$PROJECT" | grep -A2 defaultAdmissionRule   # ALWAYS_ALLOW
kubectl get pods -n "$NS"                                       # Odoo still Running
```

#### Explore further (CI/CD walkthrough)

1. Fork or create a repository holding your Odoo Dockerfile and add-ons.
2. Create a PAT with `repo` and `admin:repo_hook`, or install the Cloud Build GitHub App and note its
   installation id.
3. Set `enable_cicd_trigger = true`, `github_repository_url`, `github_token` (first apply only),
   optionally `github_app_installation_id` and `cicd_trigger_config.branch_pattern`. Apply, then
   `gcloud builds triggers list --region="$REGION" --project="$PROJECT"` shows the trigger and a push
   to the branch starts a build.
4. Cloud Deploy (`enable_cloud_deploy = true`) moves the workload into per-stage namespaces
   (`<service>-dev`, `<service>-staging`, `<service>-prod`), each with its own database, and the
   Gateway serves the `dev` stage until you promote. That is a large change to a running Odoo — try
   it on a separate deployment.

#### Watch out for

- A stricter policy (attestations required) blocks every unsigned image, including Odoo's own
  rebuilds and the job images. The module does not change the project policy's rule for you.
- `enable_cloud_deploy = true` without `enable_cicd_trigger = true` is refused at plan time.

#### Revert

`enable_binary_authorization = false`.

---

### Lab 13 — Filesystem (NFS) (Group 13)

> **Objective:** prove Odoo's filestore, sessions and `odoo.conf` live on the shared NFS server and survive a pod replacement.

**You will:** inspect the NFS mount and its per-app directory; attach a file in Odoo; replace the pod and read the attachment back.
**Time:** 20 min · **Cost:** none · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_nfs` | `true` | **No** | Mounts the Services_GCP NFS server into Odoo and its jobs. Odoo requires it. |
| `nfs_mount_path` | `/mnt` | Yes | Mount path. Must stay `/mnt`: Odoo's config, filestore and sessions are written there. |
| `nfs_volume_name` | `nfs-data-volume` | Yes | Name of the volume in the pod spec. |
| `nfs_instance_name` | `""` | Yes | Use a specific NFS VM instead of discovering one. |
| `nfs_instance_base_name` | `app-nfs` | Yes | Base name if an NFS VM had to be created inline (not with Services_GCP). |

#### Step 1 — Configure

This group is best explored with the defaults. Optionally rename the volume to see an update-safe
change propagate:

```hcl
enable_nfs      = true
nfs_mount_path  = "/mnt"            # do not change for Odoo
nfs_volume_name = "odoo-nfs-data"   # cosmetic: the pod-spec volume name
```

#### Step 2 — Apply

Only if you changed the volume name: the pod template changes and Odoo restarts. 5 minutes.

#### Step 3 — Verify

```bash
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- df -h /mnt /mnt/filestore   # <nfs-ip>:/share/<service>, NOT overlay
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- ls -la /mnt                  # odoo.conf filestore sessions extra-addons
kubectl get deploy "$SERVICE" -n "$NS" -o jsonpath='{.spec.template.spec.volumes[*].name}{"\n"}'
```

Now prove persistence. In Odoo, open **Contacts**, open any contact, and attach a file in the
chatter. Then:

```bash
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sh -c 'find /mnt/filestore -type f -newermt "-10 minutes" | head'
kubectl rollout restart deploy/"$SERVICE" -n "$NS"
kubectl rollout status deploy/"$SERVICE" -n "$NS" --timeout=900s
```

Re-open the contact in the browser and download the attachment: it is still there.

#### Explore further

- See the share from the NFS server's side: `gcloud compute instances list --project="$PROJECT" --filter="name~nfs"`.
- Note `REDIS_HOST` and `NFS_SERVER_IP` in the pod (`printenv NFS_SERVER_IP`): the NFS VM also hosts
  Redis, which Lab 15 uses.

#### Watch out for

- If `df` ever shows `overlay` for `/mnt/filestore`, the mount path is wrong and every attachment is
  lost when the pod restarts — while the pod still looks healthy.
- `enable_nfs = false` is not supported for Odoo; it would also remove the default Redis host.
- Each app has its own directory (`/share/<service>`) on a shared server; do not point two
  deployments at the same path.

#### Revert

`nfs_volume_name = "nfs-data-volume"`.

---

### Lab 14 — Cloud Storage & Artifact Registry (Group 14)

> **Objective:** add a bucket, understand how the module's own `addons` bucket and mount are merged with yours, and learn which retention settings actually act.

**You will:** add a versioned bucket; re-declare the addons mount; load an add-on file through the bucket; check image retention.
**Time:** 25 min · **Cost:** small (bucket storage) · **Prerequisites / external setup:** Artifact Registry CMEK needs a Cloud KMS key — optional.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `create_cloud_storage` | `true` | **No** | Create the buckets at all. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | **No** | Buckets `gcs-<service>-<suffix>`. Merged by `name_suffix` with the module's own `addons` bucket. **Removing an entry deletes that bucket and its contents.** |
| `gcs_volumes` | `[]` | Yes | GCS FUSE mounts. **A non-empty list REPLACES Odoo's default `addons` mount** at `/mnt/extra-addons`. |
| `manage_storage_kms_iam` | `false` | **No** | Create a CMEK key and encrypt the buckets with it. Set at first deploy. |
| `enable_artifact_registry_cmek` | `false` | **No** | CMEK for Artifact Registry. |
| `max_images_to_retain` | `7` | Yes | Image-count guard — applies only to a repository this deployment created itself. |
| `delete_untagged_images` | `true` | Yes | Applies only to a repository this deployment created itself. |
| `image_retention_days` | `30` | Yes | Applies only to a repository this deployment created itself. |

#### Step 1 — Configure

```hcl
storage_buckets = [
  { name_suffix = "data" },                                   # keep the default bucket
  { name_suffix = "addons", versioning_enabled = true,        # override settings of Odoo's addons bucket
    public_access_prevention = "enforced" },
]
gcs_volumes = [{                                              # restate Odoo's addons mount: a list REPLACES it
  name = "addons", mount_path = "/mnt/extra-addons", readonly = false
  mount_options = ["implicit-dirs", "metadata-cache-ttl-secs=60"]
}]
```

#### Step 2 — Apply

The `addons` bucket is updated in place (versioning on); the pod template is unchanged if the
mount matches. 3–8 minutes.

#### Step 3 — Verify

```bash
gcloud storage buckets list --project="$PROJECT" --filter="name~${SERVICE}" --format="table(name,versioning_enabled)"
kubectl get deploy "$SERVICE" -n "$NS" -o yaml | grep -B2 -A6 'gcsfuse.csi.storage.gke.io' | grep -E 'bucketName|mountOptions|mountPath'

# Load a file through the bucket and read it from Odoo's addons path
echo "# lab" | gcloud storage cp - "gs://gcs-${SERVICE}-addons/lab_readme.txt"
sleep 70   # metadata cache is 60 s
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- ls -l /mnt/extra-addons/
```

Expected: buckets `gcs-<service>-addons` (versioning `True`), `-data`, `-backups`; the file visible
under `/mnt/extra-addons`. To deploy a real add-on, copy its folder into the bucket, restart Odoo,
then **Apps → Update Apps List** (developer mode) and install it.

#### Explore further

- Writes from inside the pod run as the odoo user (uid 101). If
  `kubectl exec … -- touch /mnt/extra-addons/x` is refused, add `"uid=101", "gid=101"` to
  `mount_options` and apply.
- Image retention: `gcloud artifacts repositories list --project="$PROJECT"` — with Services_GCP the
  repository is shared and its cleanup policy belongs to Services_GCP, so the three retention fields
  above have no effect on it.

#### Watch out for

- `storage_buckets` is **not** update-safe: dropping `data` from the list deletes
  `gcs-<service>-data` and everything in it (`force_destroy` defaults to true).
- An empty `gcs_volumes` keeps Odoo's mount; a list that omits `addons` silently unmounts your
  add-ons directory.
- `enable_artifact_registry_cmek` and `manage_storage_kms_iam` change encryption — decide at first deploy.

#### Revert

`storage_buckets = [{ name_suffix = "data" }]`, `gcs_volumes = []`. Versioning on the addons bucket
returns to off; old object versions are then not kept for new writes. Remove the test file:
`gcloud storage rm "gs://gcs-${SERVICE}-addons/lab_readme.txt"`.

---

### Lab 15 — Redis Cache (Group 15)

> **Objective:** connect Odoo to Redis and confirm the setting reached Odoo's configuration, not just its environment.

**You will:** turn on Redis using the NFS server's co-hosted Redis; check env vars, `odoo.conf` and network reachability.
**Time:** 15 min · **Cost:** none with the co-hosted Redis · **Prerequisites:** none (Memorystore optional).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_redis` | `false` | Yes | Injects `ENABLE_REDIS`, `REDIS_HOST`, `REDIS_PORT`; Odoo's start script writes `redis_host`/`redis_port` into `odoo.conf` on every boot. |
| `redis_host` | `""` | Yes | Redis host; empty uses the NFS server, which co-hosts Redis. |
| `redis_port` | `6379` | Yes | Redis port. |
| `redis_auth` | `""` | Yes | Redis password, injected as a secret. Setting it stops the platform injecting `REDIS_URL`. |

#### Step 1 — Configure

```hcl
enable_redis = true
redis_host   = ""        # use the NFS VM's Redis
redis_port   = "6379"
```

#### Step 2 — Apply

Pod template changes; Odoo restarts. 5–8 minutes.

#### Step 3 — Verify

```bash
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sh -c 'echo ENABLE_REDIS=$ENABLE_REDIS REDIS_HOST=$REDIS_HOST NFS_SERVER_IP=$NFS_SERVER_IP'
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- grep -E '^redis_(host|port)' /mnt/odoo.conf
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- python3 -c \
  "import os,redis; print(redis.Redis(host=os.environ.get('REDIS_HOST') or os.environ['NFS_SERVER_IP'], port=int(os.environ.get('REDIS_PORT','6379')), socket_timeout=5).ping())"   # True
```

Expected: `REDIS_HOST` equal to `NFS_SERVER_IP` (or empty, with the start script falling back to
it), `redis_host = <that IP>` in `odoo.conf`, and `True` from the ping — which also proves the
network path is open (with Lab 6's NetworkPolicy on, Redis has its own allow rule).

#### Explore further

- Turn it off again and confirm the `redis_*` lines disappear from `odoo.conf` after the restart —
  the start script removes them as well as adding them.
- Point `redis_host` at a Memorystore instance in the same VPC.

#### Watch out for

- The module wires Redis into Odoo's configuration; stock Odoo Community does not include a Redis
  session store, so confirm the add-on you rely on actually reads `redis_host`.
- `enable_redis = true` with no `redis_host` and NFS disabled is refused at plan time.

#### Revert

`enable_redis = false`.

---

### Lab 16 — Database Backend (Group 16)

> **Objective:** extend Odoo's PostgreSQL database with extensions, expose its connection under extra env-var names, and rotate its password without breaking Odoo.

**You will:** install `pg_trgm` and `unaccent`; add `ODOO_DB_*` aliases; enable automatic rotation and run one rotation end to end.
**Time:** 40 min · **Cost:** small (a Cloud Run job and Eventarc trigger for rotation) · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `database_type` | `POSTGRES` | Yes | Database engine. Odoo supports PostgreSQL only — do not change. |
| `application_database_name` | `gkeappdb` | Yes | **Inert**: the real database is named after the service. |
| `application_database_user` | `gkeappuser` | Yes | **Inert**: the real user is named after the service. |
| `database_password_length` | `32` | **No** | Length of the generated password. Set once at first deploy. |
| `enable_postgres_extensions` | `false` | Yes | Runs the `<service>-db-extensions` job. |
| `postgres_extensions` | `[]` | Yes | Extensions to create. |
| `enable_mysql_plugins` | `false` | Yes | MySQL only — not applicable to Odoo. |
| `mysql_plugins` | `[]` | Yes | MySQL only. |
| `enable_auto_password_rotation` | `false` | Yes | Deploys a rotation Cloud Run job and Eventarc trigger, run on `secret_rotation_period` (Lab 5). |
| `rotation_propagation_delay_sec` | `90` | Yes | Wait between writing the new secret version and disabling the old one. |
| `db_password_env_var_name` | `""` | Yes | Extra env var carrying the DB password. |
| `db_host_env_var_name` | `""` | Yes | Extra env var carrying the DB host (`127.0.0.1` on GKE — the proxy). |
| `db_user_env_var_name` | `""` | Yes | Extra env var carrying the DB user. |
| `db_name_env_var_name` | `""` | Yes | Extra env var carrying the DB name. |
| `db_port_env_var_name` | `""` | Yes | Extra env var carrying the DB port. |

#### Step 1 — Configure

```hcl
database_type                  = "POSTGRES"
enable_postgres_extensions     = true
postgres_extensions            = ["pg_trgm", "unaccent"]   # Odoo uses both for fuzzy/accent-insensitive search
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 120
db_host_env_var_name           = "ODOO_DB_HOST_ALIAS"
db_port_env_var_name           = "ODOO_DB_PORT_ALIAS"
db_user_env_var_name           = "ODOO_DB_USER_ALIAS"
db_password_env_var_name       = "ODOO_DB_PASSWORD_ALIAS"
db_name_env_var_name           = "ODOO_DB_NAME_ALIAS"
```

#### Step 2 — Apply

Creates the extensions job, the rotation job `<service>-pw-rotator`, the Eventarc trigger
`<service>-pw-rot-trigger`, and restarts Odoo with the alias env vars. 8–15 minutes.

#### Step 3 — Verify

```bash
# Extensions, checked from inside Odoo through the proxy
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
  'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select extname from pg_extension order by 1"'
# Aliases equal the standard variables
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sh -c 'echo "$DB_HOST=$ODOO_DB_HOST_ALIAS $DB_NAME=$ODOO_DB_NAME_ALIAS $DB_USER=$ODOO_DB_USER_ALIAS"'
# Rotation plumbing
gcloud run jobs list --region="$REGION" --project="$PROJECT" --filter="metadata.name~${SERVICE}-pw-rotator"
gcloud eventarc triggers list --location="$REGION" --project="$PROJECT" --filter="name~${SERVICE}"
```

Now run one rotation end to end:

```bash
DB_SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~${SERVICE}" --format="value(name)" \
  | grep -v -e master-password -e github -e rotation | head -1)
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --limit=3
gcloud run jobs execute "${SERVICE}-pw-rotator" --region="$REGION" --project="$PROJECT" --wait
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --limit=3     # a new ENABLED version, the old one DISABLED

# The Kubernetes Secret follows within ~2 minutes; compare fingerprints, not values
sleep 150
for s in $(kubectl get secret -n "$NS" -o name); do
  kubectl get "$s" -n "$NS" -o jsonpath='{.data.DB_PASSWORD}' 2>/dev/null | base64 -d | sha256sum | sed "s|-|$s|"; done | grep -v e3b0c442
gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT" | sha256sum

# Restart Odoo so it reads the new password, then check it reconnects
kubectl rollout restart deploy/"$SERVICE" -n "$NS" && kubectl rollout status deploy/"$SERVICE" -n "$NS" --timeout=900s
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"                          # 200
```

Odoo's start script rewrites `db_password` in `/mnt/odoo.conf` from the environment on every
boot, so after the restart Odoo connects with the rotated password.

#### Explore further

- Watch the restart log line `Reconciled database connection settings in /mnt/odoo.conf.` with
  `kubectl logs -n "$NS" deploy/"$SERVICE" -c "$APP" | head -40`.
- Try `postgres_extensions = ["not_a_real_ext"]` and read the extensions job's log to see a failure
  reported clearly.

#### Watch out for

- **Restart after a rotation.** The running pod keeps the password it started with; once the old
  password is disabled, new database connections from that pod can fail until it restarts.
- **Do not change `database_password_length` on a running deployment.** It writes a new password to
  Secret Manager while the database keeps the old one, and the old secret version is destroyed —
  database connections fail until the database setup job is re-run. Rotation (above) is the
  supported way to change the password.
- `application_database_name` / `application_database_user` change nothing; the database and user
  are always named after the service (`printenv DB_NAME` shows the real name).
- `database_type = "NONE"` would also require `enable_cloudsql_volume = false` (a plan-time rule),
  and Odoo cannot run without PostgreSQL.

#### Revert

`enable_postgres_extensions = false`, `postgres_extensions = []` (installed extensions stay in the
database — harmless), `enable_auto_password_rotation = false` (the job and trigger are deleted;
the current password stays valid), all five `db_*_env_var_name` back to `""`.

---

### Lab 17 — Backup & Maintenance (Group 17)

> **Objective:** schedule Odoo's database exports, run one on demand, and understand what a restore-on-deploy does.

**You will:** change the backup schedule and retention; trigger a backup now and find the file; walk through a backup import.
**Time:** 20 min (+20 min for an import) · **Cost:** small (bucket storage) · **Prerequisites / external setup:** an import needs a staged backup file; it **restores over the live database**.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `backup_schedule` | `0 2 * * *` | Yes | Cron (UTC) for the CronJob `<service>-db-export`. |
| `backup_retention_days` | `7` | Yes | Lifecycle rule on `gcs-<service>-backups` deleting older backups. |
| `enable_backup_import` | `false` | **No** | Runs a one-time import job during the update. |
| `backup_source` | `gcs` | Yes | `gcs` (this deployment's backups bucket) or `gdrive`. |
| `backup_file` | `backup.sql` | Yes | A bare file name in the backups bucket (or a Drive file id). |
| `backup_format` | `sql` | Yes | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip` or `auto` (`auto` is not allowed with `gdrive`). |

#### Step 1 — Configure

```hcl
backup_schedule       = "30 3 * * *"   # 03:30 UTC daily
backup_retention_days = 14
enable_backup_import  = false          # keep off unless you mean to overwrite the database
```

#### Step 2 — Apply

The CronJob schedule and the bucket lifecycle rule are updated in place. 3–5 minutes.

#### Step 3 — Verify

```bash
kubectl get cronjob "${SERVICE}-db-export" -n "$NS" -o jsonpath='{.spec.schedule}{"\n"}'       # 30 3 * * *
gcloud storage buckets describe "gs://gcs-${SERVICE}-backups" --format="yaml(lifecycle_config)"   # age: 14

# Take a backup now
kubectl create job -n "$NS" --from=cronjob/"${SERVICE}-db-export" backup-now
kubectl wait --for=condition=complete job/backup-now -n "$NS" --timeout=900s
kubectl logs -n "$NS" job/backup-now -c "$(kubectl get job backup-now -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].name}')" | tail
gcloud storage ls -l "gs://gcs-${SERVICE}-backups/**" | tail -5
```

#### Explore further (backup import walkthrough)

1. Copy a backup **out** of the project first (Drive, or a bucket you keep) — the backups bucket is
   deleted with the deployment.
2. To restore, put the file in `gs://gcs-<service>-backups/` and set `enable_backup_import = true`,
   `backup_source = "gcs"`, `backup_file = "<file name only>"`, `backup_format` to match. From Drive,
   use `backup_source = "gdrive"` and the file id.
3. The update runs an import job (`kubectl get jobs -n "$NS" | grep -i import`) that loads the dump
   **into the live database**. Restart Odoo afterwards and check your data and attachments — the
   export is the database; attachments live on NFS (Lab 13).
4. Set `enable_backup_import = false` again so later updates do not import again.

#### Watch out for

- An import overwrites what is there. Never enable it on a deployment whose data you want to keep
  unless the backup is newer.
- `backup_file` is a file name, not a `gs://` URI.
- `backup_schedule` is in UTC.

#### Revert

`backup_schedule = "0 2 * * *"`, `backup_retention_days = 7`; `kubectl delete job backup-now -n "$NS"`.

---

### Lab 18 — Custom SQL Scripts (Group 18)

> **Objective:** run your own SQL scripts from a Cloud Storage bucket against Odoo's database as part of an update.

**You will:** stage two ordered scripts; run them as the application user; read the job log and query the result.
**Time:** 20 min · **Cost:** none · **Prerequisites / external setup:** a bucket you create (below).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | **No** | Runs the job `<service>-custom-sql-scripts`. |
| `custom_sql_scripts_bucket` | `""` | Yes | Bucket holding the scripts; the module grants its workload identity read access. |
| `custom_sql_scripts_path` | `""` | Yes | Prefix; every `.sql` file under it runs in lexicographic order. |
| `custom_sql_scripts_use_root` | `false` | Yes | Run as the `postgres` superuser instead of the app user. |

#### Step 1 — Configure

Stage the scripts. Use a table of your own — never modify Odoo's tables from SQL:

```bash
export SQL_BUCKET="<your-bucket>"
gcloud storage buckets create "gs://${SQL_BUCKET}" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
printf 'CREATE TABLE IF NOT EXISTS lab_marker (id serial primary key, note text, at timestamptz default now());\n' \
  | gcloud storage cp - "gs://${SQL_BUCKET}/sql/01-create.sql"
printf "INSERT INTO lab_marker (note) VALUES ('group 18 ran');\n" \
  | gcloud storage cp - "gs://${SQL_BUCKET}/sql/02-insert.sql"
```

```hcl
enable_custom_sql_scripts   = true
custom_sql_scripts_bucket   = "<your-bucket>"
custom_sql_scripts_path     = "sql"
custom_sql_scripts_use_root = false   # app user owns the new table, so Odoo's user can read it
```

#### Step 2 — Apply

Creates an IAM binding on your bucket, a ConfigMap and the job. 5–8 minutes.

#### Step 3 — Verify

```bash
kubectl logs -n "$NS" job/"${SERVICE}-custom-sql-scripts" --all-containers | grep -E 'Found|\.sql|CREATE|INSERT|as application'
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
  'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "select note, at from lab_marker"'
```

Expected: `Found 2 SQL script(s)`, `01-create.sql` before `02-insert.sql`, and a `group 18 ran` row.

#### Explore further

- Rename `02-insert.sql` to `00-insert.sql` on a fresh table name and watch it fail first — proof of
  the ordering.
- Uploading new script content does **not** by itself re-run the job; it runs again when the job's
  definition changes (for example a different `custom_sql_scripts_path` or bucket). Write scripts so
  they are safe to run more than once.

#### Watch out for

- `custom_sql_scripts_use_root = true` runs as the superuser; objects it creates belong to
  `postgres`, and Odoo's user may not be able to use them.

#### Revert

`enable_custom_sql_scripts = false` and the other three fields back to defaults. Drop the table
(`... -c "drop table lab_marker"` with the same `psql` command) and delete the bucket in Task 6.

---

### Lab 19 — Custom Domain, Static IP & Networking (Group 19)

> **Objective:** serve Odoo on a hostname you choose, with a Google-managed certificate, on a static IP you name.

**You will:** name the Gateway's static IP; point a hostname at it; watch the certificate become active; learn which networking fields are inert.
**Time:** 30 min (certificates take 10–60 min) · **Cost:** none (the address already exists) · **Prerequisites / external setup:** a DNS name you control, or use a `nip.io` name as below.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_custom_domain` | `true` | **No** | Uses the Gateway API load balancer with HTTPS. `false` removes the Gateway (unless Cloud Armor or CDN need it) and leaves only the Service's plain-HTTP IP. |
| `application_domains` | `[]` | **No** | Hostnames to serve; one managed certificate each. Empty → a `<ip-with-dashes>.nip.io` hostname. |
| `reserve_static_ip` | `true` | Yes | Keep a stable reserved address and the derived `nip.io` hostname. |
| `static_ip_name` | `""` | **No** | Name of the reserved global address; empty → `<service>-gateway-ip`. **Changing it creates a new address — the Gateway's IP changes.** |
| `network_tags` | `["nfsserver"]` | Yes | **Inert**: no resource reads it; NFS works without it. |

#### Step 1 — Configure

Two updates, because the new IP is only known after the first one.

Update 1 — name the address:

```hcl
static_ip_name = "odoo-lab-ip"     # a new global address; the Gateway moves to it
```

After it applies, read the new IP and build a hostname for it (or create an `A` record in your own DNS):

```bash
gcloud compute addresses describe odoo-lab-ip --global --project="$PROJECT" --format="value(address)"
```

Update 2 — serve a named host:

```hcl
enable_custom_domain = true
application_domains  = ["<new-ip-with-dashes>.nip.io"]   # or ["erp.example.com"] with an A record to the IP
reserve_static_ip    = true
```

#### Step 2 — Apply

Update 1 creates a new global address and re-points the Gateway (expect a few minutes when the old
hostname stops working). Update 2 creates a certificate, a certificate-map entry and updates the
HTTPRoute. 5–10 minutes each, plus certificate provisioning.

#### Step 3 — Verify

```bash
kubectl get gateway -n "$NS" -o jsonpath='{.items[0].status.addresses[0].value}{"\n"}'
kubectl get httproute -n "$NS" -o jsonpath='{.items[0].spec.hostnames}{"\n"}'
gcloud certificate-manager certificates list --project="$PROJECT" --filter="name~${SERVICE}" \
  --format="table(name,managed.domains,managed.state)"        # ACTIVE when ready
export HOST="<your-new-host>"; export URL="https://${HOST}"
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"   # 200 once the certificate is ACTIVE
kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- printenv GKE_SERVICE_URL   # the URL Odoo is told it lives at
```

#### Explore further

- In Odoo, **Settings → Technical → System Parameters**: `web.base.url` follows the URL you open
  Odoo on while an administrator is signed in. Set it explicitly, and freeze it with
  `web.base.url.freeze = True`, so emailed links use your new hostname.

#### Watch out for

- `static_ip_name` and `application_domains` are not update-safe: the address and certificates are
  replaced, and bookmarks, DNS records and uptime checks on the old host stop working.
- A real domain's certificate stays `PROVISIONING` until its DNS `A` record points at the Gateway IP.
- Use the **dashed** `nip.io` form (`1-2-3-4.nip.io`) — that is the name the certificate covers.

#### Revert

`application_domains = []` and `static_ip_name = ""` (the Gateway gets a newly reserved
`<service>-gateway-ip` address — the IP changes again; recompute `HOST` as in Task 1, step 4).
Remove any DNS record you created.

---

### Lab 20 — Identity-Aware Proxy (IAP) (Group 20)

> **Objective:** require a Google sign-in before anyone reaches Odoo's login page.

**You will:** create an OAuth client; enable IAP on the Gateway backend; see unauthenticated requests redirected to Google.
**Time:** 30 min · **Cost:** none · **Prerequisites / external setup:** **[External setup required]** — an OAuth consent screen and an OAuth 2.0 client (Console only). You can read this lab without them; the plan-time checks in "Explore further" work without them.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_iap` | `false` | Yes | Turns on IAP for the Gateway backend. |
| `iap_authorized_users` | `[]` | Yes | Who may pass, e.g. `user:alice@example.com`. |
| `iap_authorized_groups` | `[]` | Yes | Groups, e.g. `group:erp@example.com`. |
| `iap_oauth_client_id` | `""` | Yes | OAuth client id (sensitive). |
| `iap_oauth_client_secret` | `""` | Yes | OAuth client secret (sensitive). |
| `iap_support_email` | `""` | Yes | Support email for the consent screen. |

#### Step 1 — Configure

External setup: in the Console, **Google Auth Platform → Branding** (OAuth consent screen) — create
it if the project has none; then **Clients → Create client → Web application**. Add the authorised
redirect URI `https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect` after the
client is created. Note the client id and secret.

```hcl
enable_iap              = true
iap_authorized_users    = ["user:<your-email>"]
iap_authorized_groups   = []
iap_oauth_client_id     = "<client-id>.apps.googleusercontent.com"
iap_oauth_client_secret = "<client-secret>"
iap_support_email       = "<your-email>"
enable_cdn              = false     # IAP and CDN cannot be combined
```

#### Step 2 — Apply

Creates a Kubernetes Secret `<service>-iap-oauth`, updates the `GCPBackendPolicy`, and grants IAP
access. 5–10 minutes, plus a few minutes for IAP to take effect.

#### Step 3 — Verify

```bash
kubectl get gcpbackendpolicy -n "$NS" -o yaml | grep -A4 'iap:'          # enabled: true
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "${URL}/web/login"
# expect: 302 https://accounts.google.com/...
```

Open `$URL` in a private browser window: Google sign-in appears first; after signing in as an
authorised user, Odoo's own login page follows (IAP is in front of Odoo's login, not instead of it).

#### Explore further

- **Plan-time guards (no OAuth client needed):** set `enable_iap = true` with an empty client id —
  refused; with no authorised users or groups — refused; with no support email — refused; together
  with `enable_cdn = true` — refused.
- Sign in as a non-authorised account: IAP shows an access-denied page.

#### Watch out for

- **IAP guards only what goes through the Gateway.** With the Gateway on, the Odoo Service is
  `ClusterIP` and has no external IP, so there is no way around IAP. `service_type = "NodePort"`
  is not converted and does not pass through IAP — keep the default. Confirm there is no second
  address:

  ```bash
  kubectl get svc "$SERVICE" -n "$NS"     # TYPE ClusterIP, EXTERNAL-IP <none>
  ```
- The uptime check (Lab 10) cannot sign in, so with IAP on it reports the service as failing.
- Odoo's mobile apps and external integrations (XML-RPC/JSON-RPC from outside) cannot pass IAP.
- IAP access grants are project-wide: another app in the project that also uses IAP shares them.

#### Revert

`enable_iap = false` and clear the five other fields. Delete the OAuth client in the Console if you
no longer need it.

---

### Lab 21 — Cloud Armor (Group 21)

> **Objective:** put a web application firewall in front of Odoo and watch it block attack-shaped requests.

**You will:** attach a Cloud Armor policy with an admin allowlist; probe it with XSS and SQL-injection patterns; understand what `enable_cdn` does and does not do.
**Time:** 25 min (+5–10 min propagation) · **Cost:** **Yes** — Cloud Armor bills per policy and per rule monthly, plus per request · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_cloud_armor` | `false` | **No** | Creates `<service>-waf-policy` and attaches it to the Gateway backend (forces the Gateway path). |
| `admin_ip_ranges` | `[]` | Yes | CIDRs given an explicit allow rule ahead of the WAF rules. |
| `cloud_armor_policy_name` | `default-waf-policy` | Yes | **Not applied**: the module always creates and attaches its own `<service>-waf-policy`, and with Cloud Armor off attaches none. |
| `enable_cdn` | `false` | Yes | Forces the Gateway path only; the module cannot switch Cloud CDN on itself. Excludes IAP. |

#### Step 1 — Configure

```hcl
enable_cloud_armor = true
admin_ip_ranges    = ["203.0.113.0/24"]   # replace with your office/VPN range
enable_cdn         = false
```

#### Step 2 — Apply

Creates the security policy and updates the `GCPBackendPolicy`. 5–8 minutes, then **5–10 minutes**
before the rules take effect at the edge.

#### Step 3 — Verify

```bash
gcloud compute security-policies describe "${SERVICE}-waf-policy" --project="$PROJECT" \
  --format="table(rules.priority,rules.action,rules.description)"
kubectl get gcpbackendpolicy -n "$NS" -o yaml | grep securityPolicy

# After ~5-10 minutes:
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/health"                                  # 200
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/login?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"  # 403
curl -s -o /dev/null -w "%{http_code}\n" "${URL}/web/login?id=1%27%20OR%20%271%27%3D%271"          # 403
```

#### Explore further

- **CDN:** set `enable_cdn = true` (and Cloud Armor on or off), apply, and check the backend
  service: `gcloud compute backend-services list --global --project="$PROJECT" --format="table(name,enableCDN,securityPolicy)"`.
  `enableCDN` stays `False` — the module prepares the Gateway path, and CDN must be switched on
  outside the module.
- Look at **Network Security → Cloud Armor policies → `<service>-waf-policy` → Logs** for the
  blocked requests.

#### Watch out for

- **Cloud Armor filters only what goes through the Gateway.** With the Gateway on, the Odoo
  Service is `ClusterIP` with no external IP, so every request passes Cloud Armor. Deployments
  updated before this behaviour existed lose their old Service IP on their next update — that
  is intended.
- Probes return `200` for the first few minutes — that is propagation, not a broken policy.
- Odoo's own forms can trip generic WAF rules when users paste HTML or code into fields; check the
  policy's logs before blaming Odoo.
- `enable_cloud_armor = true` with `enable_custom_domain = false` and a non-LoadBalancer Service is
  refused at plan time.

#### Revert

`enable_cloud_armor = false`, `admin_ip_ranges = []`, `enable_cdn = false`. The policy is deleted.

---

### Lab 22 — VPC Service Controls & Audit Logging (Group 22)

> **Objective:** turn on detailed Cloud Audit Logs for the project and understand how the module handles a VPC Service Controls perimeter it cannot create.

**You will:** enable audit logging and read the project's audit configuration; request VPC-SC in dry-run and read what the module reports.
**Time:** 15 min · **Cost:** small (extra log volume) · **Prerequisites / external setup:** **[External setup required]** for VPC-SC — an organisation, Access Context Manager permissions, and a project directly under the organisation (or `organization_id` set). These settings are hidden in RAD-managed projects.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_vpc_sc` | `false` | Yes | Creates a VPC-SC perimeter around the project's APIs. |
| `vpc_cidr_ranges` | `[]` | Yes | CIDRs for the perimeter's network access level; empty = discovered subnets. |
| `vpc_sc_dry_run` | `true` | Yes | Log violations only. |
| `organization_id` | `""` | Yes | Needed when the project is inside a folder. |
| `enable_audit_logging` | `false` | **No** | Adds DATA_READ, DATA_WRITE and ADMIN_READ audit logs. |

#### Step 1 — Configure

```hcl
enable_audit_logging = true
enable_vpc_sc        = true    # [EXT] — only takes effect with an organisation behind the project
vpc_sc_dry_run       = true    # never start in enforced mode
```

#### Step 2 — Apply

Audit configs are added to the project IAM policy. VPC-SC is created — or, when the organisation
cannot be found (for example a folder-nested project with no `organization_id`), skipped with a
warning in the apply log. 3–6 minutes.

#### Step 3 — Verify

```bash
gcloud projects get-iam-policy "$PROJECT" --format=json | python3 -c \
  "import json,sys; print([c['service'] for c in json.load(sys.stdin).get('auditConfigs',[])])"
```

Check the deployment's **Outputs**: `audit_logging_enabled = true`; `vpc_sc_enabled` reports
whether a perimeter was actually created (`false` if it was skipped), with `vpc_sc_perimeter_name`
and `vpc_sc_dry_run_mode`. In Logs Explorer, `logName:"cloudaudit.googleapis.com%2Fdata_access"`
now returns entries.

#### Explore further

- With an organisation available, look at the dry-run perimeter in **Security → VPC Service
  Controls** and review its violation logs before ever setting `vpc_sc_dry_run = false`.

#### Watch out for

- Audit configuration is **project-wide**: another app that also manages it shares the same
  setting, and turning it off here turns it off for the project.
- An enforced perimeter can block the platform's own deploy and build calls; stay in dry run.

#### Revert

`enable_audit_logging = false`, `enable_vpc_sc = false`.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,sts,pods,hpa,vpa,pvc,pdb -n "$NS"
   kubectl describe deploy "$SERVICE" -n "$NS" | sed -n '/Containers:/,/Volumes:/p'
   kubectl top pod -n "$NS"
   ```

2. **Scale** by changing `min_instance_count` / `max_instance_count` and clicking **Update** on the
   deployment details page (Lab 4). The module owns the workload spec — a manual `kubectl scale` is
   overridden by the HPA. Keep at least one pod: Odoo's scheduled actions run inside it.

3. **Update the application.** Changing `application_version` (or re-running **Update** to pick up a
   newer nightly of the same series) rebuilds the image and replaces the pod with the `Recreate`
   strategy — a short outage. Do it outside business hours, and back up first (step 6).

4. **Restart Odoo** without changing anything (for example after a password rotation, Lab 16):

   ```bash
   kubectl rollout restart deploy/"$SERVICE" -n "$NS"
   kubectl rollout status deploy/"$SERVICE" -n "$NS" --timeout=900s
   ```

5. **Secrets, storage and jobs:**

   ```bash
   kubectl get secretsync,secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~${SERVICE} OR name~${PREFIX}-${APP}"
   kubectl get jobs,cronjobs -n "$NS"
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- du -sh /mnt/filestore    # filestore size on NFS
   ```

6. **Database session and on-demand backup.** The Cloud SQL instance has only a private IP, so
   connect from inside the pod through the proxy rather than with `gcloud sql connect`:

   ```bash
   kubectl exec -it -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
     'PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME"'
   # Then e.g.:  select login, active from res_users;   \q to quit

   kubectl create job -n "$NS" --from=cronjob/"${SERVICE}-db-export" "backup-$(date +%s)"
   ```

7. **Odoo housekeeping.** Keep the administrator password changed (Task 2), give staff their own
   users rather than sharing `admin`, and review **Settings → Technical → Scheduled Actions** —
   they run in the Odoo pod, so they stop if the pod count is ever zero.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Where the logs are.** The generated `odoo.conf` sets `logfile = /var/log/odoo/odoo.log`, so:
   - `kubectl logs` and Cloud Logging show the module's start script (config generation, the
     reconcile messages, the NFS write check, `Starting Odoo server...`) and the sidecars.
   - Odoo's own request and error log is in the file inside the container, and is lost when the
     pod is replaced.

   ```bash
   kubectl logs -n "$NS" deploy/"$SERVICE" -c "$APP" --tail=50
   kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- tail -n 100 /var/log/odoo/odoo.log
   kubectl logs -n "$NS" deploy/"$SERVICE" -c cloud-sql-proxy --tail=20 2>/dev/null \
     || kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.containers[*].name}{"\n"}'
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

   > **Optional — send Odoo's log to Cloud Logging.** The module writes `/mnt/odoo.conf` only when it
   > does not exist, and on later boots rewrites only the database, master-password and Redis lines.
   > Removing the `logfile` line therefore sticks, and Odoo then logs to standard output:
   > `kubectl exec -n "$NS" deploy/"$SERVICE" -c "$APP" -- sed -i '/^logfile[[:space:]]*=/d' /mnt/odoo.conf`
   > followed by a restart (Task 3, step 4). This is a manual change to a file on the share — note it
   > in your runbook.

2. **Monitoring.** Open **Kubernetes Engine → Workloads → `<service>`** for CPU, memory and restart
   counts, and **SQL → your instance → Monitoring** for connections and CPU. With Lab 2 and Lab 10
   applied, review **Monitoring → Uptime checks** and **Alerting → Policies** (`<service>-…`):

   ```bash
   gcloud monitoring uptime list-configs --project="$PROJECT" --filter="displayName~${SERVICE}" --format="value(displayName)"
   kubectl get events -n "$NS" --sort-by=.lastTimestamp | tail -20
   ```

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit, including those found when
every group of this module was tested on a live deployment.

- **Pod not Ready / CrashLoopBackOff** — read events, then the previous container's log and the
  Odoo log file:
  ```bash
  POD=$(kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].metadata.name}')
  kubectl describe pod "$POD" -n "$NS" | sed -n '/Events:/,$p'
  kubectl logs "$POD" -n "$NS" -c "$APP" --previous | tail -40
  ```
  `ERROR: Cannot write to /mnt/filestore` → the NFS mount or `nfs-init` is wrong (Lab 13, Lab 11).
  `exitCode 137` with `reason: Error` is a probe kill, not an out-of-memory kill (`OOMKilled`).
- **Health check non-200 on first boot.** The first start installs the base module; wait for the
  startup probe (up to 9 minutes by default) and for every init job to be `Complete`:
  `kubectl get jobs -n "$NS"`.
- **Gateway returns 503 while the pod is Ready.** The load balancer's health check needs a literal
  `200` on the probe path. Check the path is still `/web/health` (Lab 10), test it at the pod —
  `kubectl exec -n "$NS" "$POD" -c "$APP" -- curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8069/web/health` —
  and allow 5–15 minutes after a Gateway or certificate change.
- **"password authentication failed" after a password change.** Check the three copies agree
  (fingerprints, as in Lab 16): Secret Manager latest version, the Kubernetes Secret, and the pod's
  `DB_PASSWORD`. If the Kubernetes Secret lags, wait two minutes; then restart Odoo so it rewrites
  `odoo.conf`. If `database_password_length` was changed on a running deployment, the database
  itself still has the old password — enable rotation (Lab 16) and run the rotator job to set a new
  password on both sides.
- **Odoo can't reach the database or Redis after enabling network segmentation.** Describe the
  NetworkPolicy (Lab 6) and confirm egress rules exist for the Cloud SQL IP and the Redis/NFS IP;
  test with the `psql select 1` and Redis ping commands from Labs 6 and 15.
- **Init job failed or never ran:**
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/"${SERVICE}-db-init" --all-containers | tail -30
  kubectl logs -n "$NS" job/"${SERVICE}-nfs-init" | tail
  ```
  If you set `initialization_jobs`, check `nfs-init` and `db-init` are still in the list (Lab 11).
- **A setting "did nothing".** Check the lab's table: `container_resources`, `stateful_fs_group`,
  `service_annotations` and `service_labels` are create-time only; `network_tags`,
  `application_database_name`/`_user` and `cloud_armor_policy_name` are inert.
- **Update refused at plan time.** Read the message — it names the conflicting settings (VPA with
  `min_instance_count` above 1, IAP without an OAuth client, a PVC on the NFS path, a bare-number
  memory quota, Cloud Deploy without a trigger…). Nothing was changed.
- **First deploy of a fresh cluster reports missing CRDs.** The platform runs a second apply
  automatically; if you deployed some other way, apply again.
- **Pending pod / no external IP.** Check events for quota (`exceeded quota` → Lab 8; SSD quota →
  use `standard` storage in Lab 7) and `gcloud compute project-info describe --project="$PROJECT"`
  for address quotas.
- **Locked out of the Odoo administrator account.** Reset the password from the cluster with Odoo's
  shell (replace `new-strong-password`):
  ```bash
  kubectl exec -it -n "$NS" deploy/"$SERVICE" -c "$APP" -- bash -c \
    'odoo shell -c /mnt/odoo.conf -d "$DB_NAME" --no-http' <<'PY'
  u = env.ref('base.user_admin'); u.password = 'new-strong-password'; env.cr.commit()
  PY
  ```

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). This removes everything the module created — the Kubernetes workload and
namespace, Cloud SQL database, Secret Manager secrets, the NFS directory, GCS
buckets (including the backups bucket — copy any backup you want to keep first), and Artifact Registry images. Resources owned by **Services_GCP** (the VPC,
GKE cluster, shared Cloud SQL, registry) are managed separately and are not removed
here.

Remove what the feature labs created **outside** the module yourself:

```bash
gcloud secrets delete odoo-lab-marker --project="$PROJECT" --quiet          # Lab 5
gcloud storage rm -r "gs://<your-bucket>"                                    # Lab 18 SQL bucket
kubectl get pvc -n "$NS" 2>/dev/null                                         # Lab 7: should be gone with the namespace
gcloud compute addresses list --global --project="$PROJECT" --filter="name~odoo"   # no leftover named IP (Lab 19)
```

Also delete the OAuth client from Lab 20 (Console → Google Auth Platform → Clients), any DNS
records you created in Lab 19, Cloud CDN if you enabled it by hand in Lab 21, and backups you
copied out of the project if you no longer need them. If you turned audit logging on in Lab 22,
check the project's audit configuration afterwards — it is project-wide.

---

## Appendix — Group 0 platform-wiring variables

These are never shown on the form. The platform or the module sets them; you normally leave them alone.

| Variable | Purpose |
|---|---|
| `module_description`, `module_documentation`, `module_dependency`, `module_services` | Catalogue text, documentation link, dependency on Services_GCP, services list. |
| `requires_services` | Which Services_GCP features this module needs (PostgreSQL, NFS VM, GKE). |
| `credit_cost`, `require_credit_purchases`, `enable_purge`, `public_access`, `shared_users`, `technical_support_users` | Pricing, purge permission, catalogue visibility and support routing. |
| `require_services_gcp_module` | Refuse to deploy unless a Services_GCP network exists (default `true`). |
| `resource_creator_identity`, `impersonation_service_account` | Identity the platform deploys as / impersonates. |
| `explicit_secret_values` | Values written into the module's Kubernetes Secret — the way to supply your own `ODOO_MASTER_PASS`. |
| `job_execution_wait_timeout`, `job_active_deadline_seconds` | Job time budgets; declared here but the foundation's own values apply. |
| `network_name`, `gke_cluster_selection_mode`, `sql_instance_name`, `sql_instance_base_name`, `scripts_dir` | Declared for compatibility; not used by this module. |
| `quota_max_pods`, `quota_max_services`, `quota_max_pvcs` | Not used by this module (Lab 8 covers the quota fields that are). |
| `prereq_gke_subnet_cidr`, `prereq_subnet_cidr_override`, `prereq_gke_master_cidr_override`, `binauthz_evaluation_mode`, `extra_service_ports` | Not used by this module. |

---

## Summary

| Task / Lab | Type | Outcome |
|---|---|---|
| 1 — Deploy the baseline | Automated | Odoo workload, Cloud SQL database, NFS directory, buckets, secrets, Gateway with nip.io HTTPS; init jobs complete |
| 2 — Access & verify | Manual | `/web/health` 200; database pre-created, manager disabled; signed in as `admin` and password changed; every resource located |
| Lab 2 — Deployment Environment | Feature | Support contacts receive alerts; labels on every resource |
| Lab 3 — Application Identity | Feature | Display name/description changed; why name and major version are fixed |
| Lab 4 — Runtime & Scaling | Feature | HPA range and backend timeout tuned; VPA tried; create-time-only resources understood |
| Lab 5 — Environment Variables & Secrets | Feature | Plain, Secret Manager and auto-protected env vars injected and verified |
| Lab 6 — GKE Backend & Cluster | Feature | NetworkPolicy isolates the namespace while DB, Redis and LB paths keep working |
| Lab 7 — StatefulSet | Feature | Odoo on a StatefulSet with a PVC; persistence proven by write-delete-read |
| Lab 8 — Resource Quota | Feature | Namespace quota with rollout headroom; binary-unit validation seen |
| Lab 9 — Reliability Policies | Feature | PDB and zone spreading; allowed disruptions understood |
| Lab 10 — Observability & Health | Feature | Probes tuned on pod and Gateway; uptime check and CPU alert created |
| Lab 11 — Jobs & Scheduled Tasks | Feature | Custom init job chained after Odoo's, a CronJob, and a reachable companion service |
| Lab 12 — CI/CD & GitHub Integration | Feature | Binary Authorization enforced; CI/CD and Cloud Deploy walked through |
| Lab 13 — Filesystem (NFS) | Feature | Filestore on NFS proven by an attachment surviving a restart |
| Lab 14 — Cloud Storage & Artifact Registry | Feature | Buckets merged/overridden, addons mount restated, retention scope understood |
| Lab 15 — Redis Cache | Feature | Redis wired into env, `odoo.conf` and the network path |
| Lab 16 — Database Backend | Feature | Extensions installed, aliases added, password rotated end to end |
| Lab 17 — Backup & Maintenance | Feature | Backup schedule/retention set, backup taken on demand, import understood |
| Lab 18 — Custom SQL Scripts | Feature | Ordered SQL scripts run from a bucket and verified in the database |
| Lab 19 — Custom Domain, Static IP & Networking | Feature | Named static IP, custom hostname with an ACTIVE managed certificate |
| Lab 20 — Identity-Aware Proxy | Feature | Google sign-in enforced in front of Odoo (302 to Google) |
| Lab 21 — Cloud Armor | Feature | WAF attached; XSS/SQLi probes blocked with 403; CDN behaviour understood |
| Lab 22 — VPC Service Controls & Audit Logging | Feature | Detailed audit logs on; VPC-SC requested and its outcome read from outputs |
| 3 — Operate | Manual | Inspect, scale, update, restart, manage secrets/storage/jobs, DB access and backups |
| 4 — Observe | Manual | Start-script and Odoo log locations; Monitoring, uptime checks and alerts |
| 5 — Troubleshoot | Manual | Diagnose pods, first boot, Gateway 503, passwords, NetworkPolicy, jobs, inert settings, lockout |
| 6 — Tear down | Automated | Delete removes all module resources; lab extras removed by hand |
