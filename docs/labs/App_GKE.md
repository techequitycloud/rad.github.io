---
title: "App GKE \u2014 Lab Guide"
description: "Hands-on labs: deploy a baseline, then pick feature labs for every configuration group — each with an objective, tested settings, verification, pitfalls and revert steps — plus operations, observability and teardown."
---

# App GKE — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/App_GKE)**

## Overview

**Estimated time:** core path (Tasks 1–2) ~45–60 minutes; each feature lab 10–40 minutes; all labs ~12 hours.

`App GKE` is the **foundation deployment engine** for all GKE Autopilot application modules in this platform. It provisions a production-ready Kubernetes workload (Deployment or StatefulSet) on GKE Autopilot for any containerised application — complete with optional Cloud SQL (PostgreSQL or MySQL), shared NFS storage, GCS buckets and GCS Fuse mounts, Secret Manager secrets synced into Kubernetes, Cloud Build image builds and CI/CD, Cloud Monitoring, and an optional Gateway API load balancer with HTTPS, Identity-Aware Proxy and a Cloud Armor WAF. Application modules such as `Django_GKE` and `Ghost_GKE` call this engine internally; deployed directly, as in this lab, it builds and runs a **built-in sample Flask app** (from the module's `scripts/` directory: `app.py` plus its `Dockerfile`) so every feature has something real to exercise.

The sample app listens on port `8080` (gunicorn, running as the non-root `appuser`) and serves four endpoints you will use throughout the lab:

| Endpoint | What it returns | Use it to prove |
|---|---|---|
| `/` | `Hello from Sample App! Visitor count: N` — increments a counter in the database on every request | The app is serving **and** writing to Cloud SQL (on a DB error it still returns 200 with `(DB unavailable: …)` in the text, so read the body) |
| `/healthz` | `{"status": "healthy"}` with HTTP 200 | The probe and load-balancer health-check path |
| `/db` | `{"status": "connected", "version": "PostgreSQL …"}`, or HTTP 500 with the error | Database connectivity, isolated from the counter |
| `/whoami` | JSON with `remote_addr`, the forwarding headers, and the request header **names** | What the load balancer / Gateway actually delivers to the container |

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on the sample app itself. It is "many labs in one": after a short core path you pick the feature labs you care about from the menu.

> **This lab deploys onto a `Services_GCP` foundation.** Use the **same `tenant_id`** as your `Services_GCP` deployment so `App GKE` deploys into the shared **GKE Autopilot cluster** and binds to the shared VPC, Cloud SQL instance, NFS server, and Artifact Registry instead of provisioning its own inline cluster and infrastructure. (Standalone — `require_services_gcp_module = false` — creates an inline GKE cluster and takes much longer; the point of this lab is to exercise the foundation.)

> **Inputs are validated at plan time.** The module rejects invalid values and combinations — `stateful_pvc_enabled` with `workload_type = "Deployment"`, IAP with no OAuth client, a `prebuilt` image source with no image, a `mount_nfs` job with `enable_nfs = false`, a bare-integer ResourceQuota memory value, VPA together with `min_instance_count` above 1, two volumes mounted at one path — *before* anything is created, with a clear error naming the variable. The [Configuration Guide's *Configuration Pitfalls*](https://docs.radmodules.dev/docs/modules/App_GKE) table marks which combinations are caught this way.

### How this lab is organised

- **Part 1 — Core (Tasks 1–2).** Deploy a baseline and verify it. Everyone does this; every feature lab assumes it.
- **Part 2 — Feature labs (Labs 2–22).** One lab per variable group, numbered by group (Lab 4 = Group 4). After the baseline they are independent of each other and can be run in any order; each states its objective, time, cost and prerequisites, and ends with a **Revert** so you return to the baseline. Where a later lab builds on an earlier one it says so. Pick from the menu below.
- **Part 3 — Operate, observe, troubleshoot, tear down (Tasks 3–6).** Day-2 operations, logging and monitoring, the failure modes observed when this module was tested group by group on a live project, and a clean teardown that includes everything the feature labs leave behind.

Group 1 (project and tenant) is covered by Task 1 rather than a separate lab. Group 0 variables are platform wiring and are never shown on the form — see the [Appendix](#appendix--group-0-platform-wiring-variables).

### Lab menu

| Lab | Group | Objective (what you will be able to do) | Time | Adds cost? | External setup |
|---|---|---|---|---|---|
| [Lab 2](#lab-2--deployment-identity-group-2) | 2 | Route monitoring alerts to people and stamp cost-attribution labels on every resource, then see the dashboard and alerts that appear | 15 min | No (alert/dashboard only) | None |
| [Lab 3](#lab-3--application-identity-group-3) | 3 | Rename what operators see (dashboard, descriptions) without touching resource names, and understand which identity fields are immutable | 10 min | No | None |
| [Lab 4](#lab-4--runtime--scaling-group-4) | 4 | Size and scale the workload with the HPA, choose VPA vs HPA, and learn which runtime settings take effect only at creation | 30 min | Yes (more pods) | None |
| [Lab 5](#lab-5--environment-variables--secrets-group-5) | 5 | Inject plain configuration and Secret Manager secrets into the pod, and watch credential-looking values get moved into a Kubernetes Secret automatically | 20 min | Negligible | None (you create one secret) |
| [Lab 6](#lab-6--gke-backend-config-group-6) | 6 | Shape the Kubernetes Service (ports, affinity), the rollout strategy and grace period, and lock the namespace down with a NetworkPolicy without breaking traffic | 30 min | No | Service mesh needs ASM (not available in RAD-managed projects) |
| [Lab 7](#lab-7--statefulset--pvc-group-7) | 7 | Convert the workload to a StatefulSet with a per-pod persistent disk and **prove** persistence with a write–restart–read | 35 min | Yes (a 10 GiB disk per pod) | None |
| [Lab 8](#lab-8--resource-quota-group-8) | 8 | Cap what the namespace may consume with a ResourceQuota sized so rolling updates still work | 15 min | No | None |
| [Lab 9](#lab-9--reliability-group-9) | 9 | Keep the app available during node upgrades with a PodDisruptionBudget and spread replicas across zones | 20 min | Yes (a second pod) | None |
| [Lab 10](#lab-10--observability-group-10) | 10 | Tune startup/liveness/readiness probes (which also drive the Gateway health check), and add an uptime check and a custom alert | 25 min | Small (uptime check) | None |
| [Lab 11](#lab-11--workload-automation-group-11) | 11 | Run ordered initialization Jobs, a scheduled CronJob and a sibling service the app reaches by injected URL | 30 min | Small (one extra pod) | None |
| [Lab 12](#lab-12--cicd-group-12) | 12 | Turn on Binary Authorization for the cluster; read through the GitHub-driven Cloud Build trigger and Cloud Deploy pipeline | 20 min (BinAuthz) | No | **CI/CD and Cloud Deploy need a GitHub repo + token** |
| [Lab 13](#lab-13--nfs-storage-group-13) | 13 | Move the shared NFS mount, prove files survive a restart, and see why NFS is also what provides Redis | 20 min | No | None |
| [Lab 14](#lab-14--cloud-storage-group-14) | 14 | Provision a bucket, mount it into the pod with GCS Fuse, write to it as the non-root app user, and encrypt it with CMEK | 30 min | Small (bucket, KMS key) | None |
| [Lab 15](#lab-15--redis-cache-group-15) | 15 | Point the app at a Redis host/port and see how setting a password changes what is injected | 15 min | No | None |
| [Lab 16](#lab-16--database-configuration-group-16) | 16 | Alias the DB connection variables for apps with non-standard names and run a real, zero-downtime password rotation | 40 min | Small (rotation job) | None |
| [Lab 17](#lab-17--backup--maintenance-group-17) | 17 | Schedule the database export CronJob, run a backup on demand, and restore the bundled sample backup | 25 min | Small (backup bucket) | None (a sample `backup.sql` is staged for you) |
| [Lab 18](#lab-18--custom-sql-scripts-group-18) | 18 | Run your own ordered SQL scripts from a GCS bucket against the app database | 20 min | Negligible | You stage one bucket |
| [Lab 19](#lab-19--access--networking-group-19) | 19 | Put the app behind the Gateway API load balancer with a zero-config `nip.io` HTTPS certificate (or your own domain) and control its static IP | 40 min | Yes (global LB + IP) | Own domain optional (DNS record) |
| [Lab 20](#lab-20--identity-aware-proxy-group-20) | 20 | Require Google sign-in in front of the app with IAP | 30 min | Small | **OAuth consent screen + OAuth client** |
| [Lab 21](#lab-21--cloud-armor--cdn-group-21) | 21 | Attach a Cloud Armor WAF that blocks SQLi/XSS and rate-limits, and see what `enable_cdn` does and does not do | 35 min | Yes (Armor policy, LB) | None |
| [Lab 22](#lab-22--vpc-service-controls--audit-logging-group-22) | 22 | Turn on project audit logging; read through a VPC Service Controls perimeter in dry-run | 15 min | Yes (log volume) | **VPC-SC needs an organisation** |

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate every resource it provisions — namespace, workload, Service, Jobs, secrets, buckets, database.
- Connect to the GKE cluster and verify the running workload by reading it back, not by trusting a green apply.
- Change any group of settings with **Update**, predict whether the change is safe on a running deployment, and verify its effect.
- Configure scaling, persistence (NFS, per-pod disks, GCS), secrets, jobs, probes and monitoring for a GKE workload.
- Expose the workload through the Gateway API with HTTPS, and protect it with IAP and Cloud Armor.
- Operate, observe, troubleshoot and tear down the deployment, including what the feature labs leave behind.

## Prerequisites

- **Services_GCP** (provides the VPC, GKE Autopilot cluster, Cloud SQL, Artifact
  Registry, and shared service accounts this module depends on). You do not need
  to deploy this yourself first — the platform automatically detects whether it
  already exists in the target project and provisions it before this module if
  not (see Task 1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed, plus the **`gke-gcloud-auth-plugin`** (`gcloud components install gke-gcloud-auth-plugin`) so `kubectl` can authenticate to GKE; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project — you need `container.developer`-level access to the cluster to run the `kubectl` checks.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which is open to every account while builds are included in the price (on a lab environment, only an administrator can use it). Updates never carry a module fee.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task and lab below reuses them. Run the second block **after** Task 1 has finished, because it discovers names that only exist once the module is deployed:

```bash
export PROJECT="<your-project-id>"
export REGION="us-central1"           # the region you deploy into
export TENANT="demo"                  # tenant_id — must match your Services_GCP deployment
export APP="gkeapp"                   # application_name (the module default)
```

```bash
# Connect kubectl to the shared Services_GCP cluster
CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
LOCATION=$(gcloud container clusters list --project="$PROJECT" --format="value(location)" --limit=1)
gcloud container clusters get-credentials "$CLUSTER" --region="$LOCATION" --project="$PROJECT"

# Names the module derives (verified in code):
#   SERVICE = application_name + tenant_id + 8-hex hash   (e.g. gkeappdemo1a2b3c4d)
#   NS      = SERVICE (unless you set namespace_name)
#   PREFIX  = tenant_id + 8-hex hash — the TENANT-scoped prefix used for the
#             Gateway, NetworkPolicy, PDB and the synced "<PREFIX>-secrets" Secret
export NS=$(kubectl get ns -o name | sed 's|^namespace/||' | grep -E "^${APP}${TENANT}[0-9a-f]{8}$" | head -1)
export SERVICE="$NS"
export PREFIX="${SERVICE#"$APP"}"
export WL="deploy/$SERVICE"           # becomes sts/$SERVICE in Lab 7
echo "Cluster=$CLUSTER  NS=$NS  SERVICE=$SERVICE  PREFIX=$PREFIX"
```

> The app container is named after `application_name` (`$APP`) and has **no `curl`** (it is `python:3.11-slim`). In-pod HTTP checks in this lab therefore use `python3 -c "import urllib.request; …"`.

## How to change settings in the feature labs

- **The Update flow.** Open the deployment from the **Deployments** page, click **Update**, tick **Enable advanced mode** so every group is shown, change only the settings the lab names, then submit. The platform re-plans and applies the module against the same deployment. The HCL snippets in each lab show the values to enter; each line maps to one form field with the same name.
- **Update-safe vs not.** Each lab's settings table has an **Update-safe** column taken from the module's own metadata. A field flagged update-safe can be changed on a running deployment. A field **without** the flag shows a warning before you change it, because the change may destroy or replace a resource (a bucket, the workload, an IP address). When the deployment is set to **Enforce Update Safe**, unflagged fields are read-only — that is the platform protecting a production deployment, not a bug. In a lab project, read the warning, understand what will be replaced, then proceed.
- **Some fields are hidden in RAD-managed projects.** A few settings (VPC-SC, service mesh, `protect_sensitive_environment_variables`) are removed from the form when the project is RAD-managed and are reverted server-side on update. They are still documented below; run those parts in a bring-your-own project.
- **Plan-time validation is part of the lesson.** If a combination is invalid, the update fails at **plan** with an error naming the variables, and nothing is changed. Several labs deliberately show you one.
- **One lab at a time.** Apply one lab, verify it, then **Revert** (or keep it if a later lab says it builds on it). Mixing labs makes it hard to tell which change caused what.
- **Verify by reading back the deployed resource.** Every Verify step reads the live object — `kubectl get … -o jsonpath`, `gcloud … describe`, an env var inside the pod, a `curl` of the endpoint, or a write–restart–read for storage. When this module was tested group by group, several settings applied green while changing nothing (they are called out in each lab's *Watch out for*). A green apply is not proof.

---

## Task 1 — Deploy the baseline [Automated]

### Step 1.1 — Baseline settings

Set only the **Group 1** inputs and leave everything else at its default:

```hcl
project_id = "<your-project-id>"
tenant_id  = "demo"          # MUST match your Services_GCP deployment
region     = "us-central1"   # used when the Services_GCP subnet region cannot be discovered
```

That is Group 1 in full — there is no separate Group 1 lab. The `tenant_id` is 1–7 lowercase letters or digits and is baked into every resource name (the GCP service-account ID limit sets the 7-character cap); **never change it after deployment**.

The defaults then give you:

| Piece | Default | What you get |
|---|---|---|
| Image | `container_image_source = "custom"`, `application_version = "1.0.0"` | Cloud Build builds the sample Flask app from the module's `scripts/Dockerfile` and pushes it to the shared Artifact Registry |
| Workload | `workload_type = null`, `stateful_pvc_enabled = null` | A **Deployment**, 1 replica, HPA `min 1 / max 3` on CPU 70% / memory 80% |
| Rollout | `deployment_strategy = null` | **Recreate** — inferred because the app mounts NFS (two pods on one share can deadlock a rolling update) |
| Resources | `container_resources` | `1000m` CPU / `512Mi` memory (requests default to the limits) |
| Service | `service_type = "LoadBalancer"`, `reserve_static_ip = true` | An external L4 load balancer on a reserved static IP named `<SERVICE>-lb-ip`, port `80` → container `8080` |
| Database | `database_type = "POSTGRES"`, `enable_cloudsql_volume = true` | A database and user (both named after `SERVICE`) in the shared Cloud SQL instance, reached through a Cloud SQL Auth Proxy sidecar on `127.0.0.1` |
| Jobs | `initialization_jobs` default | `<SERVICE>-db-create` (Foundation), `<SERVICE>-db-init` (sample script) and `<SERVICE>-nfs-setup` Kubernetes Jobs |
| Storage | `enable_nfs = true`, `create_cloud_storage = true` | The shared NFS share mounted at `/mnt/nfs` (an app-scoped `/share/<SERVICE>` subtree), plus a backup bucket `gcs-<SERVICE>-backups` |
| Cache | `enable_redis = true` | `REDIS_HOST`/`REDIS_PORT`/`REDIS_URL` pointing at the Redis co-hosted on the Services_GCP NFS VM |
| Probes | `startup_probe_config`, `health_check_config` | HTTP probes on `/healthz` |
| Reliability | `enable_pod_disruption_budget = true` | A PDB named `<PREFIX>-pdb` (created because `max_instance_count` > 1) |

### Step 1.2 — Deploy

1. Open **Solutions → Solution Catalog → RAD modules** in the RAD platform top navigation, open **App (GKE)** from the **Platform Modules** list to start configuration, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id` and `tenant_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/App_GKE)
   documents every input by group, with defaults. Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, creates the database and its Secret Manager secret, builds the container image, and runs the initialization jobs. A first deploy takes roughly **20–35 minutes** (longer if `Services_GCP` is provisioned first). On a brand-new cluster the first GKE app may need a second apply to finish (the Secret Manager sync add-on registers during the first) — the platform pipeline runs that second pass for you.

3. When the status page reports success, run the **second shell block** from Prerequisites to connect `kubectl` and discover the names, then take an inventory:

   ```bash
   kubectl get deploy,sts,pods,svc,hpa,pdb,jobs,cronjobs -n "$NS"
   ```

   Expected: one Deployment `$SERVICE`, one pod `2/2 Running` (the app plus the `cloud-sql-proxy` sidecar), a `LoadBalancer` Service `$SERVICE` with an external IP, an HPA `$SERVICE` (`1/3`), a PDB `$PREFIX-pdb`, three Jobs `Complete`, and a CronJob `$SERVICE-db-export` (the database backup).

> **If the namespace does not exist after a "successful" apply**, see *Task 5 → The apply succeeded but there is no workload*. That was the most serious failure observed in testing, and the module now fails the plan instead of silently skipping the workload.

---

## Task 2 — Access & verify the baseline [Manual]

1. **Workload health and the external address:**

   ```bash
   kubectl get pods -n "$NS" -l app="$APP" -o wide          # 2/2 Running, 0 restarts
   export LB_IP=$(kubectl get svc "$SERVICE" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "LB_IP=$LB_IP"
   gcloud compute addresses list --project="$PROJECT" --filter="name=$SERVICE-lb-ip" \
     --format="table(name,address,status)"                    # same address, IN_USE
   ```

2. **The four endpoints** — read the bodies, not just the status codes:

   ```bash
   curl -s "http://$LB_IP/"; echo                            # Hello from Sample App! Visitor count: 1
   curl -s "http://$LB_IP/"; echo                            # ... Visitor count: 2  (the DB write works)
   curl -s "http://$LB_IP/healthz"; echo                     # {"status":"healthy"}
   curl -s "http://$LB_IP/db"; echo                          # {"status":"connected","version":"PostgreSQL ..."}
   curl -s "http://$LB_IP/whoami"; echo                      # remote_addr is your public IP (L4 LB preserves it)
   ```

   If `/` says `(DB unavailable: …)`, the app is up but the database path is not — go to Task 5.

3. **The probe path returns a literal 200 at the pod IP.** GKE's kubelet accepts any 2xx/3xx, but a Google load-balancer health check (used from Lab 19 onwards) needs exactly `200`:

   ```bash
   kubectl exec -n "$NS" "$WL" -c "$APP" -- python3 -c \
     "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/healthz').status)"   # 200
   ```

4. **Database, user and secret.** The database and user are named after `SERVICE` (hyphens become underscores) — **not** after `application_database_name`/`application_database_user`:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --filter="databaseVersion~POSTGRES" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
   gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)" | grep -v github | head -1)
   echo "DB password secret: $DB_SECRET"
   kubectl get secret "$PREFIX-secrets" -n "$NS"              # the Secret Manager → Kubernetes sync target
   ```

5. **What the module injected into the container:**

   ```bash
   kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'env | grep -E "^(DB_|REDIS_|NFS_|GKE_SERVICE_URL)" | sed -E "s/(PASSWORD=).*/\1***/" | sort'
   ```

   Expect `DB_HOST=127.0.0.1` (the proxy sidecar), `DB_NAME`/`DB_USER` = the service name, `DB_PASSWORD` (from the synced Secret), `REDIS_HOST` = `NFS_SERVER_IP`, and `GKE_SERVICE_URL=http://<LB_IP>`.

6. **Volumes and jobs:**

   ```bash
   kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{range .items[0].spec.containers[0].volumeMounts[*]}{.mountPath}{"\t"}{.name}{"\n"}{end}'
   kubectl get jobs -n "$NS" -o custom-columns=NAME:.metadata.name,SUCCEEDED:.status.succeeded
   kubectl logs -n "$NS" job/"$SERVICE"-db-init --all-containers | tail -5
   ```

   Expect `/mnt/nfs` (`nfs-data-volume`) among the mounts and every Job with `SUCCEEDED 1`.

7. **The image:**

   ```bash
   kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
   gcloud builds list --project="$PROJECT" --region="$REGION" --limit=3 --format="table(id,status,createTime)"
   ```

You now have the baseline every feature lab starts from.

---

## Part 2 — Feature labs

### Lab 2 — Deployment Identity (Group 2)

> **Objective:** Send monitoring alerts to named people and apply cost-attribution labels to every resource the module creates.

**You will:** add `support_users` and see the notification channels, default alerts and GKE dashboard appear · add `resource_labels` and confirm they land on an **already existing** namespace, Deployment and bucket.
**Time:** 15 min · **Cost:** none beyond alert/dashboard objects · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `support_users` | `[]` | Yes | Email recipients of Cloud Monitoring alerts. A non-empty list also switches monitoring on: one email notification channel per address, CPU and memory utilisation alerts, and a GKE dashboard. Grants no IAM access. |
| `resource_labels` | `{ env = "dev" }` | Yes | Labels merged into every resource's labels (alongside the module's own `application`, `deployment`, `tenant`, `managed-by`, `module` labels). |

`tenant_id`, documented with this group in the Configuration Guide, is a Group 1 field on the form — see Task 1.

#### Step 1 — Configure

```hcl
support_users = ["<your-email>"]          # receives alert notifications
resource_labels = {
  env       = "lab"                       # overrides the default env = "dev"
  cost-team = "platform"                  # any lowercase key/value pair
}
```

#### Step 2 — Apply

Click **Update**. Expect notification channels, two alert policies and a dashboard to be **created**, and labels to be **updated in place** on the namespace, Deployment, Service account objects and buckets. Nothing is replaced. ~5 minutes.

#### Step 3 — Verify

```bash
# Labels reached the live Kubernetes objects (they existed before this update)
kubectl get ns "$NS" --show-labels | tr ',' '\n' | grep -E "env=|cost-team="
kubectl get "$WL" -n "$NS" -o jsonpath='{.metadata.labels}{"\n"}'          # contains cost-team: platform

# ...and a GCS bucket
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format="yaml(labels)"

# Monitoring objects created by support_users
gcloud beta monitoring channels list --project="$PROJECT" --filter="displayName~$SERVICE" \
  --format="table(displayName,type,labels.email_address)"
gcloud alpha monitoring policies list --project="$PROJECT" --filter="displayName~$SERVICE" \
  --format="table(displayName,enabled)"                                      # cpu- and memory-utilization-alert
gcloud monitoring dashboards list --project="$PROJECT" --format="value(displayName)" | grep "GKE Dashboard"
```

Expected: both labels present on all three; a channel `$SERVICE-notification-0` with your address; `$SERVICE-cpu-utilization-alert` and `$SERVICE-memory-utilization-alert`; a dashboard `App_GKE Application - GKE Dashboard (…)`. Google sends a verification email to new notification addresses.

#### Explore further

- Add a second address and confirm a second channel `…-notification-1` appears.
- Open the dashboard in **Monitoring → Dashboards** and generate traffic (`for i in $(seq 50); do curl -s "http://$LB_IP/" >/dev/null; done`) to see request and CPU panels move.

#### Watch out for

- Labels must be lowercase keys/values (GCP label rules). An invalid label fails the apply on the first GCP resource that rejects it.
- `support_users` is for alerting only. Access to the app is controlled by IAP (Lab 20), not by this list.

#### Revert

```hcl
support_users   = []
resource_labels = { env = "dev" }
```

Reverting deletes the channels, alerts and dashboard (unless another monitoring feature — an uptime check or `alert_policies` — keeps monitoring switched on).

---

### Lab 3 — Application Identity (Group 3)

> **Objective:** Change what operators see about the application without disturbing any resource name, and know which identity field must never change.

**You will:** set a display name and description and find where they surface · understand why `application_name` is fixed · see what `application_version` does on a custom build.
**Time:** 10 min · **Cost:** none · **Prerequisites / external setup:** Lab 2's `support_users` makes the dashboard exist, which is where the display name shows.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `application_name` | `"gkeapp"` | **No** | Base of every app-scoped name (`SERVICE`, namespace, database, buckets, image name). Changing it creates a brand-new deployment beside the old one with an empty database. Set it only at create time. |
| `application_display_name` | `"App_GKE Application"` | Yes | Human-readable name used in the monitoring dashboard title and the static IP description. |
| `application_description` | `"App_GKE Custom Application - Flask App with Database"` | Yes | Free-text description for the platform and documentation. |
| `application_version` | `"1.0.0"` | Yes | Image tag. With `container_image_source = "custom"`, a new value triggers a Cloud Build and a rollout. |

#### Step 1 — Configure

```hcl
application_display_name = "Lab GKE App"                       # shows up in the dashboard title
application_description  = "App_GKE lab deployment"            # documentation only
```

#### Step 2 — Apply

**Update**. Only the dashboard is updated in place; no workload change. ~3 minutes.

#### Step 3 — Verify

```bash
gcloud monitoring dashboards list --project="$PROJECT" --format="value(displayName)" | grep "Lab GKE App"
kubectl get "$WL" -n "$NS" -o jsonpath='{.metadata.name}{"\n"}'     # still $SERVICE — names did not move
```

#### Explore further

- **Version bump:** set `application_version = "1.0.1"`. Watch **Cloud Build → History** for a new build, then confirm the new tag: `kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}'`. The pods use `imagePullPolicy: Always` for custom images, so a rebuilt image under a reused tag is still pulled.

#### Watch out for

- A version bump rebuilds the image — it tests Cloud Build as much as the module. If the build fails the workload keeps the previous image.
- The baseline uses the **Recreate** strategy (NFS is mounted), so a version rollout has a brief outage while the old pod stops before the new one starts.

#### Revert

```hcl
application_display_name = "App_GKE Application"
application_description  = "App_GKE Custom Application - Flask App with Database"
application_version      = "1.0.0"     # only if you bumped it; triggers another build
```

---

### Lab 4 — Runtime & Scaling (Group 4)

> **Objective:** Control how many pods run and how big they are, choose between horizontal (HPA) and vertical (VPA) autoscaling, and learn which runtime settings are applied only when the workload is created.

**You will:** raise the HPA floor and ceiling and watch a second pod appear · lengthen the load-balancer timeout · try to resize a running pod and see why it does not change · see the plan refuse VPA with a minimum above 1.
**Time:** 30 min · **Cost:** each extra pod is billed for its requested CPU/memory (Autopilot bills requests) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `deploy_application` | `true` | **No** | `false` provisions the supporting infrastructure (database, storage, namespace) without the workload. |
| `container_image_source` | `"custom"` | **No** | `custom` builds with Cloud Build; `prebuilt` deploys `container_image` as-is (plan fails if it is empty). |
| `container_image` | `""` | Yes | Image URI for `prebuilt`, or the source image when mirroring. |
| `container_build_config` | `{ enabled = true }` | Yes | Cloud Build settings: `dockerfile_path`, `dockerfile_content`, `context_path`, `build_args`, `artifact_repo_name`, `base_image`. |
| `enable_image_mirroring` | `true` | **No** | Copies an external image into Artifact Registry before deploying (avoids Docker Hub rate limits). |
| `min_instance_count` | `1` | Yes | HPA `minReplicas`. The HPA floor is never below 1 — `0` is treated as 1 on GKE. |
| `max_instance_count` | `3` | Yes | HPA `maxReplicas`; also the cost ceiling. Must be ≥ min (plan-time check). |
| `enable_vertical_pod_autoscaling` | `false` | **No** | Creates a VPA (`<SERVICE>-vpa`) and **removes the HPA** — the workload then scales up, never out. Refused at plan time with `min_instance_count` above 1. |
| `container_port` | `8080` | Yes | Port the container listens on; the Service targets it. Must match the app (the sample's gunicorn binds 8080). |
| `container_protocol` | `"http1"` | Yes | `h2c` advertises `appProtocol: kubernetes.io/h2c` on the Service port so Gateway backends speak HTTP/2 cleartext (gRPC). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Yes (flag) — but **create-time only**, see below | Limits plus optional `cpu_request`, `mem_request` (note: `mem_request`, not `memory_request`), `ephemeral_storage_limit`, `ephemeral_storage_request`. Requests default to the limits. |
| `timeout_seconds` | `300` | Yes | Backend timeout written to the Gateway's `GCPBackendPolicy` (`timeoutSec`). Takes effect once the Gateway exists (Labs 19–21). |
| `enable_cloudsql_volume` | `true` | Yes | Adds the Cloud SQL Auth Proxy sidecar; the app reaches the DB on `127.0.0.1`. Must be `false` when `database_type = "NONE"` (plan-time check). |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Yes | Socket path setting. On GKE the proxy listens on TCP loopback and this path is not mounted into the app container, so it has no visible effect. |
| `cloud_sql_proxy_version` | `"2-alpine"` | Yes | Tag of the proxy sidecar image (mirrored into Artifact Registry). |
| `service_annotations` | `{}` | **No** | Annotations on the Kubernetes Service. **Applied only when the Service is created.** |
| `service_labels` | `{ env = "dev" }` | **No** | Labels on the Kubernetes Service. **Applied only when the Service is created.** |

`deployment_timeout`, listed here in the Configuration Guide, is a Group 6 field on the form (Lab 6).

#### Step 1 — Configure

```hcl
min_instance_count = 2          # HPA floor: a second pod starts
max_instance_count = 5          # HPA ceiling / cost cap
timeout_seconds    = 600        # LB backend timeout (visible from Lab 19 on)
container_resources = {
  cpu_limit    = "2000m"        # attempt to resize the RUNNING pod (see Verify)
  memory_limit = "1Gi"
  cpu_request  = "500m"
  mem_request  = "512Mi"        # mem_request — a misspelt key is silently dropped
}
```

#### Step 2 — Apply

**Update**. The HPA is updated in place and scales the Deployment to 2 pods within a minute or two. ~5 minutes.

#### Step 3 — Verify

```bash
kubectl get hpa "$SERVICE" -n "$NS"                                   # MINPODS 2  MAXPODS 5  REPLICAS 2
kubectl get pods -n "$NS" -l app="$APP"                               # two pods, 2/2 Running

# Did the resource change reach the running pods?
kubectl get pods -n "$NS" -l app="$APP" -o custom-columns=\
"NAME:.metadata.name,CPU_REQ:.spec.containers[0].resources.requests.cpu,MEM_REQ:.spec.containers[0].resources.requests.memory,CPU_LIM:.spec.containers[0].resources.limits.cpu,MEM_LIM:.spec.containers[0].resources.limits.memory"
```

Expected: the HPA shows `2/5` and two pods run. The resource columns still show the **original** sizes (about `1` CPU / `512Mi`, as normalised by Autopilot): the module ignores later changes to the container's `resources` block because GKE Autopilot rewrites it after admission. The apply was green and reported no drift — this is the documented create-time-only behaviour, measured in testing.

#### Explore further

- **Prove the plan guard:** set `enable_vertical_pod_autoscaling = true` while `min_instance_count = 2`. The update fails at plan with *"enable_vertical_pod_autoscaling = true removes the HorizontalPodAutoscaler … min_instance_count = 2 would be SILENTLY IGNORED"*. Then try `min_instance_count = 1` with VPA on: it applies, `kubectl get vpa -n "$NS"` shows `$SERVICE-vpa`, and `kubectl get hpa -n "$NS"` shows **No resources found**.
- **To really resize a pod**, the pod template has to be recreated — for example by switching `workload_type` (Lab 7), which creates a new workload that picks up the current `container_resources`. In a self-managed Terraform workflow you would taint the Deployment.
- **Prebuilt image:** `container_image_source = "prebuilt"` with an empty `container_image` fails the plan — try it to see the message. A real prebuilt image must listen on `container_port` and answer the probe path, or the rollout never becomes Ready.

#### Watch out for

- `container_resources`, `service_annotations` and `service_labels` are **create-time only** on a running deployment: green apply, no diff, no change.
- On Autopilot you pay for **requests**. Leaving requests unset makes them equal to the limits.
- `max_instance_count` × the DB connections per pod must stay under Cloud SQL's `max_connections`.

#### Revert

```hcl
min_instance_count = 1
max_instance_count = 3
timeout_seconds    = 300
container_resources = { cpu_limit = "1000m", memory_limit = "512Mi" }
enable_vertical_pod_autoscaling = false     # if you tried it — this recreates the HPA
```

The HPA scales back to one pod.

---

### Lab 5 — Environment Variables & Secrets (Group 5)

> **Objective:** Deliver configuration and secrets to the pod safely — plain values as env vars, Secret Manager secrets through the GKE Secret Manager sync, and credential-looking plain values moved out of the pod spec automatically.

**You will:** create a Secret Manager secret and inject it as an env var · add plain env vars · watch a value named like a token become a `secretKeyRef` · read the rotation schedule.
**Time:** 20 min · **Cost:** negligible (one secret) · **Prerequisites / external setup:** none — you create the secret in Step 1.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `environment_variables` | `{}` | Yes | Plain env vars on the app container. `$(GKE_SERVICE_URL)` inside a value is replaced with the service URL. |
| `secret_environment_variables` | `{}` | Yes | Env var name → Secret Manager **secret name**. The value is synced into the namespace Secret `<PREFIX>-secrets` and injected with `secretKeyRef`; the workload SA is granted access to each named secret. |
| `secret_rotation_period` | `"2592000s"` | Yes | Rotation-notification period on module-managed secrets (the `s` suffix is required). Publishes a notification; it rotates nothing by itself — see Lab 16 for real DB password rotation. |
| `secret_propagation_delay` | `30` | Yes | Seconds to wait after creating/updating a secret before dependent steps run. |
| `protect_sensitive_environment_variables` | `true` | Yes · hidden in RAD-managed projects | Moves any `environment_variables` entry whose name ends in `PASSWORD`, `PASS`, `SECRET`, `TOKEN`, `API_KEY`, `PRIVATE_KEY`, `ACCESS_KEY`, `CLIENT_SECRET`, `CREDENTIALS`… into the Kubernetes Secret `<PREFIX>-explicit-secrets`, injected under the same name. |

#### Step 1 — Configure

Create the secret first (a reference to a missing secret fails the deployment). Pin the replica to your region — RAD-managed projects refuse globally replicated secrets:

```bash
printf 'lab-secret-value' | gcloud secrets create lab-gke-api-key --project="$PROJECT" \
  --replication-policy=user-managed --locations="$REGION" --data-file=-
```

Then in **Update**:

```hcl
environment_variables = {
  LAB_GROUP     = "5"                       # plain config, visible in the pod spec
  LAB_SELF_URL  = "$(GKE_SERVICE_URL)/db"   # sentinel replaced with the service URL
  LAB_API_TOKEN = "not-really-secret"       # name ends in _TOKEN -> moved to a Secret
}
secret_environment_variables = {
  LAB_API_KEY = "lab-gke-api-key"           # env name -> Secret Manager secret name
}                                           # use single underscores: the sync rejects "__"
secret_propagation_delay = 45
```

#### Step 2 — Apply

**Update**. The secret is added to the SecretSync, the Kubernetes Secrets are updated and the pod is rolled. ~5 minutes.

#### Step 3 — Verify

```bash
# Values the app sees
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'printenv LAB_GROUP LAB_SELF_URL LAB_API_KEY LAB_API_TOKEN'
# -> 5 / http://<LB_IP>/db / lab-secret-value / not-really-secret

# How each one is delivered in the pod spec
kubectl get "$WL" -n "$NS" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\t"}{.value}{.valueFrom.secretKeyRef.name}{"\n"}{end}' \
  | grep -E "^LAB_"
# LAB_GROUP      5
# LAB_SELF_URL   http://<LB_IP>/db
# LAB_API_KEY    <PREFIX>-secrets            (synced from Secret Manager)
# LAB_API_TOKEN  <PREFIX>-explicit-secrets   (moved out of plain text)

kubectl get secret "$PREFIX-secrets" -n "$NS" -o jsonpath='{.data}' | tr ',' '\n' | grep -o '"LAB_API_KEY"'
gcloud secrets get-iam-policy lab-gke-api-key --project="$PROJECT" \
  --format="table(bindings.role,bindings.members)"                    # gke-sa-... has secretAccessor
gcloud secrets describe "$DB_SECRET" --project="$PROJECT" --format="yaml(rotation)"
```

A pod that is `2/2 Running` is itself evidence here: an unresolvable `secretKeyRef` keeps a pod from starting.

#### Explore further

- Add a new version to the secret (`printf 'v2' | gcloud secrets versions add lab-gke-api-key --data-file=- --project="$PROJECT"`). The Secret Manager → Kubernetes sync rotates about every **120 s**, so within ~1–2 minutes `kubectl get secret "$PREFIX-secrets" -n "$NS" -o jsonpath='{.data.LAB_API_KEY}' | base64 -d` shows `v2`. The **running** process keeps the old value — env vars are read at start — until you restart it: `kubectl rollout restart "$WL" -n "$NS"`.
- Try a name with a double underscore (`LAB__KEY`) and observe the sync rejecting it.

#### Watch out for

- The referenced secret must exist before the update; otherwise the plan or the pod start fails.
- `secret_rotation_period` does not rotate anything — it only schedules notifications.
- Rotated values reach the Kubernetes Secret in ~2 minutes but reach the **pod** only on restart.

#### Revert

```hcl
environment_variables        = {}
secret_environment_variables = {}
secret_propagation_delay     = 30
```

Then delete the lab secret: `gcloud secrets delete lab-gke-api-key --project="$PROJECT" --quiet`.

---

### Lab 6 — GKE Backend Config (Group 6)

> **Objective:** Shape how the workload is exposed inside the cluster and how it rolls out, and isolate the namespace with a NetworkPolicy without cutting off real traffic.

**You will:** add a second Service port · switch session affinity · set the grace period and rollout timeout · enable network segmentation and prove the app still serves and still reaches its database and Redis.
**Time:** 30 min · **Cost:** none · **Prerequisites / external setup:** service mesh requires Cloud Service Mesh on the cluster and is not available in RAD-managed projects; the `prereq_*` CIDRs only apply to an inline cluster (not this lab's foundation path).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `gke_cluster_name` | `""` | Yes | Target cluster; empty = discover the Services_GCP cluster. |
| `gke_cluster_selection_mode` | `"primary"` | Yes | `primary`, `round-robin`, or `explicit` (requires `gke_cluster_name`; plan-time check). |
| `namespace_name` | `""` | Yes (flag) | Explicit namespace; empty = `SERVICE`. Changing it on a running app moves every Kubernetes object to a new namespace — treat it as create-time. |
| `workload_type` | `null` (Deployment) | **No** | `Deployment` or `StatefulSet`. See Lab 7. |
| `service_type` | `"LoadBalancer"` | **No** | `LoadBalancer` (external L4 IP), `ClusterIP` (internal), `NodePort`. While a Gateway is in use (Lab 19, CDN or Cloud Armor), `LoadBalancer` is created as `ClusterIP`, so the Gateway is the only public entry. |
| `service_port` | `80` | Yes | Port clients connect to on the Service. |
| `extra_service_ports` | `[]` | Yes | Extra Service ports: `name` (unique, plan-checked), `port`, optional `target_port`, `protocol` (default `TCP`). |
| `session_affinity` | `"ClientIP"` | Yes | `ClientIP` (sticky per client IP) or `None`. |
| `deployment_strategy` | `null` | **No** | `RollingUpdate` or `Recreate`; null infers `Recreate` when NFS is mounted, else `RollingUpdate`. |
| `enable_network_segmentation` | `false` | **No** | Creates the NetworkPolicy `<PREFIX>-namespace-isolation` restricting ingress and egress. |
| `configure_service_mesh` | `false` | **No** · hidden in RAD-managed projects | Labels the namespace `istio-injection: enabled`. Needs Cloud Service Mesh; fails in RAD-managed projects. |
| `termination_grace_period_seconds` | `60` | Yes | SIGTERM → SIGKILL grace period (0–3600). |
| `deployment_timeout` | `1800` | Yes | How long the apply waits for the rollout to finish. |
| `prereq_gke_subnet_cidr` | `"10.201.0.0/24"` | **No** | Inline-cluster subnet. Inline clusters only; never change after creation. |
| `prereq_subnet_cidr_override` | `""` | **No** | Inline VPC subnet override. Inline only. |
| `prereq_gke_pod_cidr_override` | `""` | **No** | Inline cluster pod range override. Inline only. |
| `prereq_gke_service_cidr_override` | `""` | **No** | Inline cluster service range override. Inline only; the three overrides must be set together (plan-time check). |
| `prereq_gke_master_cidr_override` | `""` | **No** | Inline cluster control-plane `/28`. Inline only. |

#### Step 1 — Configure

```hcl
extra_service_ports = [{
  name        = "metrics"     # must be unique among the Service's ports
  port        = 9090          # TCP only: one L4 LB cannot mix TCP and UDP
  target_port = 8080          # the sample app has a single port
  protocol    = "TCP"
}]
session_affinity                 = "None"   # spread requests across pods
termination_grace_period_seconds = 45
deployment_timeout               = 1800
enable_network_segmentation      = true
```

#### Step 2 — Apply

**Update**. The Service is updated in place, a NetworkPolicy is created, and the pod template change triggers a rollout. ~5 minutes.

#### Step 3 — Verify

```bash
kubectl get svc "$SERVICE" -n "$NS" -o jsonpath='{range .spec.ports[*]}{.name} {.port}->{.targetPort}/{.protocol}{"\n"}{end}{.spec.sessionAffinity}{"\n"}'
# http 80->8080/TCP, metrics 9090->8080/TCP, None

kubectl get networkpolicy -n "$NS"                                  # <PREFIX>-namespace-isolation
kubectl describe networkpolicy "$PREFIX-namespace-isolation" -n "$NS" | head -60

kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.terminationGracePeriodSeconds}{" "}{.spec.strategy.type}{"\n"}'   # 45 Recreate

# The policy did not cut anything off: external traffic, the DB and Redis still work
curl -s "http://$LB_IP/"; echo                                      # Visitor count increments
curl -s "http://$LB_IP/db"; echo                                    # "connected"
curl -s -o /dev/null -w "%{http_code}\n" "http://$LB_IP:9090/healthz"   # 200 via the extra port
kubectl exec -n "$NS" "$WL" -c "$APP" -- python3 -c \
  "import os,socket; s=socket.create_connection((os.environ['REDIS_HOST'],int(os.environ['REDIS_PORT'])),5); print('redis reachable')"
```

The NetworkPolicy explicitly allows the load balancer and health-check ranges, client traffic on the container port (an L4 load balancer preserves the client IP), DNS, HTTPS to Google APIs, egress to the real Cloud SQL private IP and to the Redis host.

#### Explore further

- Set `deployment_strategy = "RollingUpdate"` and do a version bump: two pods briefly overlap. With NFS mounted that is exactly the situation the inferred `Recreate` avoids.
- `service_type = "ClusterIP"` removes the external IP entirely (and with it, your `curl` access) — useful for internal-only apps; reach it with `kubectl port-forward -n "$NS" svc/"$SERVICE" 8080:80`.
- `namespace_name = "lab-shared"` (on a fresh deployment) places the app in a namespace you name; `NS` and `SERVICE` then differ.

#### Watch out for

- Enable segmentation only after mapping the app's real traffic. The module covers DB, Redis, DNS, Google APIs and the LB; anything else (a third-party API on a non-443 port, another namespace) is blocked.
- `extra_service_ports` must stay TCP-only on a LoadBalancer Service — mixing UDP leaves the Service stuck permanently.
- `configure_service_mesh = true` in a RAD-managed project fails at apply with `RESOURCE_USAGE_RESTRICTION_VIOLATED`.

#### Revert

```hcl
extra_service_ports              = []
session_affinity                 = "ClientIP"
termination_grace_period_seconds = 60
enable_network_segmentation      = false
```

---

### Lab 7 — StatefulSet / PVC (Group 7)

> **Objective:** Give each replica its own persistent block disk by switching the workload to a StatefulSet, and prove the data survives a pod replacement.

**You will:** convert the Deployment to a StatefulSet with a 10 GiB HDD PVC · add a headless Service · write a marker file, delete the pod, and read the marker back from the replacement.
**Time:** 35 min · **Cost:** one 10 GiB standard persistent disk per replica (kept until you delete it) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `stateful_pvc_enabled` | `null` | **No** | `true` adds a per-pod PVC template and auto-selects `StatefulSet` (plan fails if `workload_type = "Deployment"`). |
| `stateful_pvc_size` | `null` | Yes | PVC size, e.g. `"10Gi"` — required when enabled (plan-time check). |
| `stateful_pvc_mount_path` | `null` | Yes | Where the PVC is mounted — required when enabled; must differ from `nfs_mount_path` and any GCS mount (plan-time check). |
| `stateful_pvc_storage_class` | `null` (`standard-rwo`, SSD-backed Balanced PD) | **No** | StorageClass; `standard` (HDD) spares the tight regional SSD quota. Applies to **new** PVCs only. |
| `stateful_headless_service` | `null` | **No** | Creates `<SERVICE>-headless` (`clusterIP: None`) for stable per-pod DNS. |
| `stateful_pod_management_policy` | `null` (`OrderedReady`) | Yes | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` (`RollingUpdate`) | Yes | `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` (unset) | Yes (flag) — **create-time only** | Pod `fsGroup`: Kubernetes makes the volume group-writable for this GID and adds it to every container's groups, so a non-root app can write. |

#### Step 1 — Configure

```hcl
workload_type                  = "StatefulSet"   # explicit, though stateful_pvc_enabled implies it
stateful_pvc_enabled           = true
stateful_pvc_size              = "10Gi"
stateful_pvc_mount_path        = "/srv/appdata"  # NOT /mnt/nfs — one path, one volume
stateful_pvc_storage_class     = "standard"      # HDD: keeps SSD_TOTAL_GB quota free
stateful_headless_service      = true
stateful_pod_management_policy = "OrderedReady"
stateful_update_strategy       = "RollingUpdate"
stateful_fs_group              = 1000            # app runs as uid 999; any non-zero GID makes the PVC writable
```

#### Step 2 — Apply

The form warns: `workload_type` and `stateful_pvc_enabled` are not update-safe. The Deployment `$SERVICE` is **destroyed** and a StatefulSet `$SERVICE` is created, so expect a short outage. ~10 minutes. Then:

```bash
export WL="sts/$SERVICE"
```

#### Step 3 — Verify

```bash
kubectl get sts,pvc -n "$NS"                     # sts/$SERVICE 1/1; pvc data-$SERVICE-0 Bound 10Gi standard
kubectl get svc "$SERVICE-headless" -n "$NS" -o jsonpath='{.spec.clusterIP}{"\n"}'   # None
kubectl get pod "$SERVICE-0" -n "$NS" -o jsonpath='{.spec.securityContext.fsGroup}{"\n"}'   # 1000
kubectl exec -n "$NS" "$SERVICE-0" -c "$APP" -- df -h /srv/appdata /mnt/nfs   # a real block device + the NFS share

# Persistence: write, replace the pod, read back
kubectl exec -n "$NS" "$SERVICE-0" -c "$APP" -- sh -c 'echo lab7-marker > /srv/appdata/marker.txt'
kubectl delete pod "$SERVICE-0" -n "$NS"
kubectl wait --for=condition=Ready pod/"$SERVICE-0" -n "$NS" --timeout=300s
kubectl exec -n "$NS" "$SERVICE-0" -c "$APP" -- cat /srv/appdata/marker.txt   # lab7-marker
curl -s "http://$LB_IP/"; echo                   # still serving
```

#### Explore further

- Try `stateful_pvc_mount_path = "/mnt/nfs"` (the NFS path): the plan fails — *"A container cannot mount two volumes at one path."*
- Set `stateful_pvc_enabled = true` with `workload_type = "Deployment"`: the plan fails along with the size/path companions if they are missing.
- Raise `min_instance_count` to 2: a second pod `$SERVICE-1` starts only after `-0` is Ready (`OrderedReady`) and gets its **own** PVC `data-$SERVICE-1` — per-pod storage is not shared storage (use NFS, Lab 13, for that).

#### Watch out for

- `stateful_fs_group` and `container_resources` are create-time only on a StatefulSet: changing them later applies green and changes nothing.
- Changing `stateful_pvc_storage_class` later affects only new PVCs; existing disks keep their class with no plan diff.
- The default class is SSD-backed and the regional `SSD_TOTAL_GB` quota is small on lab projects; scaling to zero **keeps** PVCs.
- A StatefulSet update occasionally fails with *"Missing Resource Identity After Update"* (a provider bug). The change has usually landed: run **Update** again unchanged; it completes.

#### Revert

```hcl
workload_type                  = null       # back to Deployment
stateful_pvc_enabled           = null
stateful_pvc_size              = null
stateful_pvc_mount_path        = null
stateful_pvc_storage_class     = null
stateful_headless_service      = null
stateful_pod_management_policy = null
stateful_update_strategy       = null
stateful_fs_group              = 0
```

The StatefulSet is replaced by a Deployment (`export WL="deploy/$SERVICE"`). **PVCs are not deleted with the StatefulSet** — remove them to stop paying: `kubectl delete pvc -n "$NS" -l app="$APP"` (or `kubectl delete pvc data-$SERVICE-0 -n "$NS"`).

---

### Lab 8 — Resource Quota (Group 8)

> **Objective:** Cap the total CPU, memory and object counts the namespace may use, sized so normal rollouts still fit.

**You will:** create a ResourceQuota with headroom · read live usage against it · see the plan reject a bare-integer memory value.
**Time:** 15 min · **Cost:** none · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_resource_quota` | `false` | **No** | Creates the ResourceQuota `app-quota` in the namespace. |
| `quota_cpu_requests` | `"4"` | Yes | Total CPU requests across all pods (empty = no limit). |
| `quota_cpu_limits` | `"4"` | Yes | Total CPU limits; ≥ requests. |
| `quota_memory_requests` | `"4Gi"` | Yes | Total memory requests. **Binary suffix required** — a bare integer means bytes and is rejected at plan time. |
| `quota_memory_limits` | `"8Gi"` | Yes | Total memory limits; ≥ requests. Binary suffix required. |
| `quota_max_pods` | `"20"` | Yes | Max pods (includes Job and CronJob pods). |
| `quota_max_services` | `"10"` | Yes | Max Services. |
| `quota_max_pvcs` | `"5"` | Yes | Max PVCs. |

#### Step 1 — Configure

```hcl
enable_resource_quota = true
quota_cpu_requests    = "4"       # >= 2x what the app + sidecar + jobs request,
quota_cpu_limits      = "8"       # so a surge pod or a Job can still be admitted
quota_memory_requests = "8Gi"     # binary suffix: "8Gi", never "8"
quota_memory_limits   = "16Gi"
quota_max_pods        = "20"
quota_max_services    = "10"
quota_max_pvcs        = "5"
```

#### Step 2 — Apply

**Update**. One ResourceQuota object is created; pods are unaffected. ~3 minutes.

#### Step 3 — Verify

```bash
kubectl describe resourcequota app-quota -n "$NS"
# Used vs Hard for requests.cpu, requests.memory, limits.*, pods, services, persistentvolumeclaims
```

Expected: `Used` shows the running pod(s) — app plus proxy sidecar — well under `Hard`.

#### Explore further

- Set `quota_memory_requests = "8"`: the plan fails on variable validation before anything changes.
- Squeeze the quota to just above current usage (e.g. `quota_cpu_requests` equal to the used value) and do a version bump or `kubectl rollout restart "$WL" -n "$NS"`. With a RollingUpdate strategy the surge pod is refused (`kubectl get events -n "$NS" | grep -i quota` shows `exceeded quota`); this is why the lab sizes the quota at about twice the steady state.

#### Watch out for

- The quota counts **every** pod in the namespace, including init Jobs, the backup CronJob, and additional services (Lab 11). Size for the peak, not the steady state.
- A quota that fits exactly the running set deadlocks rolling updates.

#### Revert

```hcl
enable_resource_quota = false
```

---

### Lab 9 — Reliability (Group 9)

> **Objective:** Keep the app serving through voluntary disruptions such as Autopilot node upgrades, and spread replicas across failure domains.

**You will:** run two replicas with a PDB that allows exactly one eviction · add topology spread constraints and see them on the pod spec · learn which PDB values block drains forever.
**Time:** 20 min · **Cost:** a second pod · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_pod_disruption_budget` | `true` | Yes | Creates the PDB `<PREFIX>-pdb`. Skipped automatically when `max_instance_count` is 1. |
| `pdb_min_available` | `"1"` | Yes | Count or percentage that must stay up. A number must be strictly below `max_instance_count` (plan-time check). |
| `enable_topology_spread` | `false` | Yes | Adds zone and node `topologySpreadConstraints` to the pod spec. |
| `topology_spread_strict` | `false` | Yes | `true` = `DoNotSchedule` (pods can stay Pending); `false` = `ScheduleAnyway`. |

#### Step 1 — Configure

```hcl
min_instance_count           = 2      # Group 4: two replicas so one can be evicted
max_instance_count           = 5
enable_pod_disruption_budget = true
pdb_min_available            = "1"    # 1 of 2 must stay up -> 1 disruption allowed
enable_topology_spread       = true
topology_spread_strict       = false  # safe with few replicas/zones
```

#### Step 2 — Apply

**Update**. The PDB is updated, the pod template gains the spread constraints (a rollout), and the HPA scales to 2. ~5–10 minutes. On a StatefulSet (if you kept Lab 7) you may see the provider's "Missing Resource Identity" error — re-run **Update**.

#### Step 3 — Verify

```bash
kubectl get pdb "$PREFIX-pdb" -n "$NS"                     # MIN AVAILABLE 1  ALLOWED DISRUPTIONS 1
kubectl get pods -n "$NS" -l app="$APP" -o wide            # two pods; note the NODE column
kubectl get "$WL" -n "$NS" -o jsonpath='{range .spec.template.spec.topologySpreadConstraints[*]}{.topologyKey}{"  "}{.whenUnsatisfiable}{"\n"}{end}'
# topology.kubernetes.io/zone  ScheduleAnyway
# kubernetes.io/hostname       ScheduleAnyway
```

#### Explore further

- Set `pdb_min_available = "50%"` with `min_instance_count = 1`: `ALLOWED DISRUPTIONS` is `0` — 50% of one replica rounds up to one, so a single pod can never be evicted voluntarily.
- Set `pdb_min_available = "5"` with `max_instance_count = 5`: the plan fails — a PDB requiring every replica would block node drains permanently.
- `topology_spread_strict = true` with two replicas usually still schedules on Autopilot; with more replicas than zones, watch for `FailedScheduling` events.

#### Watch out for

- A PDB whose minimum equals the replica count blocks every drain and GKE upgrade. Keep a margin.
- `pdb_min_available = "1"` on a single replica allows zero disruptions; that is why the module skips the PDB when `max_instance_count` is 1.

#### Revert

```hcl
min_instance_count     = 1
max_instance_count     = 3
pdb_min_available      = "1"
enable_topology_spread = false
```

---

### Lab 10 — Observability (Group 10)

> **Objective:** Tune the probes that decide when a pod is started, alive and ready, and add synthetic and metric-based monitoring.

**You will:** set probe timings and see them on the live pod · create an uptime check against the default `nip.io` host · add a custom alert policy.
**Time:** 25 min · **Cost:** small (uptime check executions) · **Prerequisites / external setup:** Lab 2's `support_users` if you want the alerts to notify someone.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | Yes | Startup probe: `type` (`HTTP`/`TCP`), `path`, `initial_delay_seconds` (10), `timeout_seconds` (5), `period_seconds` (10), `failure_threshold` (3). |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | Yes | Liveness **and** readiness probes (same fields; defaults 15/5/30/3). When the Gateway is active (Labs 19–21) it also drives the load balancer's `HealthCheckPolicy`. When App_GKE is deployed directly this is the live variable. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | **No** | Cloud Monitoring uptime check: `enabled`, `path`, `check_interval` (`"60s"`), `timeout` (`"10s"`). Created only when there is a stable public host (see Watch out). |
| `alert_policies` | `[]` | Yes | Custom alerts: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`, `per_series_aligner` (default `ALIGN_MEAN`; use `ALIGN_RATE` for counters). |

#### Step 1 — Configure

```hcl
startup_probe_config = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/healthz"
  initial_delay_seconds = 5
  timeout_seconds       = 4
  period_seconds        = 8
  failure_threshold     = 12      # up to ~100 s for a slow start
}
health_check_config = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/healthz"   # must return a literal 200
  initial_delay_seconds = 20
  timeout_seconds       = 6
  period_seconds        = 20
  failure_threshold     = 5
}
uptime_check_config = {
  enabled        = true
  path           = "/"           # a real page, not the probe path
  check_interval = "60s"         # note the field name: check_interval
  timeout        = "10s"
}
alert_policies = [{
  name               = "lab-cpu-limit"
  metric_type        = "kubernetes.io/container/cpu/limit_utilization"   # a GAUGE metric
  comparison         = "COMPARISON_GT"
  threshold_value    = 0.85
  duration_seconds   = 300
  aggregation_period = "60s"
}]
```

#### Step 2 — Apply

**Update**. The pod template changes (a rollout), an uptime check and an alert policy are created. ~5–8 minutes.

#### Step 3 — Verify

```bash
kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}{"\n"}{.spec.template.spec.containers[0].readinessProbe}{"\n"}{.spec.template.spec.containers[0].startupProbe}{"\n"}'
# liveness/readiness: initialDelaySeconds 20, timeoutSeconds 6, periodSeconds 20, failureThreshold 5
# startup:            initialDelaySeconds 5,  timeoutSeconds 4, periodSeconds 8,  failureThreshold 12

gcloud monitoring uptime list-configs --project="$PROJECT" --filter="displayName~$SERVICE" \
  --format="table(displayName,monitoredResource.labels.host,httpCheck.path,period)"
# <SERVICE>-uptime-check   <LB_IP>.nip.io   /   60s
gcloud alpha monitoring policies list --project="$PROJECT" --filter="displayName~lab-cpu-limit" \
  --format="table(displayName,enabled)"
```

After a few minutes, **Monitoring → Uptime checks** shows the check passing from several regions.

#### Explore further

- Change `uptime_check_config.path` to `/healthz` and compare — on GKE it passes (unlike Cloud Run, where the front end intercepts `/healthz`), but a probe-only path proves less than a real page.
- Break the liveness probe on purpose (`path = "/nope"`): the app returns 404, kubelet restarts the container every `failure_threshold × period_seconds`, and `kubectl get pods` shows restarts climbing. Revert promptly.

#### Watch out for

- An uptime check is only created when the endpoint has a stable public host: a LoadBalancer Service with `reserve_static_ip = true` (probed as `<ip>.nip.io` over HTTP), a custom domain, or the Gateway with `enable_custom_domain = true`. On an ephemeral IP or a ClusterIP service the check is silently skipped.
- Keys not declared on the object (for example `period` instead of `check_interval`) are dropped without an error and the default is used. Check spelling.
- A probe path that returns 3xx or 204 keeps kubelet happy but fails the Gateway health check (which needs a literal 200) once you reach Lab 19.

#### Revert

```hcl
startup_probe_config = { enabled = true, path = "/healthz" }
health_check_config  = { enabled = true, path = "/healthz" }
uptime_check_config  = { enabled = false, path = "/" }
alert_policies       = []
```

---

### Lab 11 — Workload Automation (Group 11)

> **Objective:** Run one-off setup Jobs in a controlled order, a scheduled CronJob, and a sibling service that the app reaches by an injected URL.

**You will:** replace the default init job list with an ordered chain (restating the default `db-init`) · add a CronJob and run it on demand · add an `nginx` sibling and call it from inside the app container.
**Time:** 30 min · **Cost:** one small extra pod · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `initialization_jobs` | one `db-init` job (`postgres:15-alpine`, `scripts/db-init.sh`) | Yes | Kubernetes Jobs `<SERVICE>-<name>`. Fields: `name`, `image`, `command`, `args`, `script_path`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `mount_nfs`, `mount_gcs_volumes`, `depends_on_jobs`, `execute_on_apply`, `needs_db` (default true), `needs_secrets` (default true). **A list you supply replaces the default.** |
| `cron_jobs` | `[]` | Yes | CronJobs `<SERVICE>-<name>`: `schedule` (UTC), `image`, `command`, `args`, resources, `concurrency_policy` (`Forbid`), history limits, `suspend`, `mount_nfs`, `mount_gcs_volumes`, `script_path`. |
| `additional_services` | `[]` | Yes | Extra Deployments + Services `<SERVICE>-<name>` in the namespace. The app gets `<NAME>_URL = http://<SERVICE>-<name>:<port>` (or `output_env_var_name`). Fields include `image`, `port`, `env_vars`, `secret_env_vars`, resources, scaling, `persistent_volume`, probes. |

#### Step 1 — Configure

```hcl
initialization_jobs = [
  {                                   # restate the default, or it is dropped
    name             = "db-init"
    image            = "postgres:15-alpine"
    command          = ["/bin/sh", "/scripts/script.sh"]
    script_path      = "scripts/db-init.sh"
    execute_on_apply = true
  },
  {
    name             = "lab-base"
    image            = "curlimages/curl:8.11.1"
    command          = ["sh", "-c"]
    args             = ["echo base start; sleep 45; echo base done"]
    execute_on_apply = true           # Terraform WAITS for it -> dependents start after it COMPLETES
    needs_db         = false          # no Cloud SQL proxy / DB env needed
    needs_secrets    = false
  },
  {
    name            = "lab-dependent"
    image           = "curlimages/curl:8.11.1"
    command         = ["sh", "-c"]
    args            = ["echo dependent start"]
    depends_on_jobs = ["lab-base"]
    needs_db        = false
    needs_secrets   = false
  }
]
cron_jobs = [{
  name     = "lab-cron"
  schedule = "0 3 * * *"              # daily 03:00 UTC
  image    = "curlimages/curl:8.11.1"
  command  = ["sh", "-c"]
  args     = ["echo gke cron ran"]
}]
additional_services = [{
  name  = "nginx"                     # -> Service <SERVICE>-nginx, env NGINX_URL
  image = "nginx:alpine"
  port  = 80
}]
```

#### Step 2 — Apply

**Update**. New Jobs, a CronJob, a Deployment + Service for `nginx`, and a rollout of the app (it gains `NGINX_URL`). The apply waits ~45 s for `lab-base`. ~8 minutes.

#### Step 3 — Verify

```bash
kubectl get jobs -n "$NS" -o custom-columns=NAME:.metadata.name,START:.status.startTime,DONE:.status.completionTime
# <SERVICE>-lab-dependent START is after <SERVICE>-lab-base DONE
kubectl logs -n "$NS" job/"$SERVICE"-lab-base --all-containers

kubectl get cronjob "$SERVICE-lab-cron" -n "$NS"                         # SCHEDULE 0 3 * * *
kubectl create job lab-cron-manual --from=cronjob/"$SERVICE"-lab-cron -n "$NS"
kubectl wait --for=condition=complete job/lab-cron-manual -n "$NS" --timeout=180s
kubectl logs -n "$NS" job/lab-cron-manual                                # gke cron ran

kubectl get deploy,svc -n "$NS" | grep nginx                             # <SERVICE>-nginx
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'echo $NGINX_URL'         # http://<SERVICE>-nginx:80
kubectl exec -n "$NS" "$WL" -c "$APP" -- python3 -c \
  "import os,urllib.request; r=urllib.request.urlopen(os.environ['NGINX_URL']); print(r.status, r.read(60))"
# 200 b'<!DOCTYPE html>...'
```

#### Explore further

- Remove `execute_on_apply = true` from `lab-base` and re-run (change its `args` so the Job is re-created). Both Jobs now start in the same second: `depends_on_jobs` orders job **creation**; only `execute_on_apply = true` makes Terraform wait for **completion**.
- Chains are supported four levels deep (base → dependent → chained → deep). A fifth level or a cycle fails the plan naming the unplaced jobs.
- Set `suspend = true` on the CronJob and confirm `kubectl get cronjob` shows `SUSPEND True`.

#### Watch out for

- Supplying `initialization_jobs` **replaces** the default `db-init` — restate it if you still want it.
- Jobs are re-created only when their definition or mounted script changes; an unchanged apply leaves completed Jobs alone.
- Sibling pods count towards a ResourceQuota (Lab 8) and are billed like any pod.
- Delete manual test Jobs you create (`kubectl delete job lab-cron-manual -n "$NS"`); the module does not manage them.

#### Revert

```hcl
initialization_jobs = [{
  name             = "db-init"
  image            = "postgres:15-alpine"
  command          = ["/bin/sh", "/scripts/script.sh"]
  script_path      = "scripts/db-init.sh"
  execute_on_apply = true
}]
cron_jobs           = []
additional_services = []
```

---

### Lab 12 — CI/CD (Group 12)

> **Objective:** Enforce Binary Authorization on the cluster, and understand how the GitHub-triggered Cloud Build pipeline and the Cloud Deploy promotion pipeline are configured.

**You will:** enable Binary Authorization in `ALWAYS_ALLOW` mode and read back the cluster and project policy · confirm that sibling pods are covered by the same cluster policy · walk through the CI/CD and Cloud Deploy settings.
**Time:** 20 min for Binary Authorization; +40 min for CI/CD if you have a repo · **Cost:** none for BinAuthz; Cloud Build minutes for CI/CD · **Prerequisites / external setup:** **[External setup required for CI/CD]** a GitHub repository containing a Dockerfile, plus a GitHub Personal Access Token (`repo`, `admin:repo_hook`) or a Cloud Build GitHub App installation. Binary Authorization needs nothing external.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | Yes | Creates a Cloud Build GitHub connection and a trigger that builds and deploys on push. Requires `github_repository_url` (plan-time check). |
| `github_repository_url` | `""` | Yes | `https://github.com/ORG/REPO`. |
| `github_token` | `""` | Yes (sensitive) | PAT used to create the connection on the first apply; stored in Secret Manager (`secret-<SERVICE>-github-token`) and reused. |
| `github_app_installation_id` | `""` | Yes | Cloud Build GitHub App installation (preferred for organisations). |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Yes | `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `description`, `substitutions`. |
| `enable_cloud_deploy` | `false` | Yes | Replaces direct deploys with a Cloud Deploy pipeline. Requires `enable_cicd_trigger` (plan-time check). |
| `cloud_deploy_stages` | `dev`, `staging`, `prod` (prod requires approval) | Yes | Stages: `name`, `target_name`, `namespace` (default `<SERVICE>-<stage>`), `cluster`, `project_id`, `region`, `require_approval`, `auto_promote`. |
| `enable_binary_authorization` | `false` | **No** | Enforces the project Binary Authorization policy on the cluster and creates the attestor/KMS signing key if missing. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | Yes | `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`. |

`gateway_backend_stage` (which Cloud Deploy stage the Gateway serves) is a Group 19 field on the form.

#### Step 1 — Configure

```hcl
enable_binary_authorization = true
binauthz_evaluation_mode    = "ALWAYS_ALLOW"   # audit everything, block nothing
```

#### Step 2 — Apply

**Update** (the form warns: not update-safe). Expect the attestor, note and KMS signing key to be created or reused, and the policy to be imported. ~5–8 minutes.

#### Step 3 — Verify

```bash
gcloud container clusters describe "$CLUSTER" --region="$LOCATION" --project="$PROJECT" \
  --format="value(binaryAuthorization.evaluationMode)"         # PROJECT_SINGLETON_POLICY_ENFORCE
gcloud container binauthz policy export --project="$PROJECT" | grep -A2 defaultAdmissionRule
# evaluationMode: ALWAYS_ALLOW
gcloud container binauthz attestors list --project="$PROJECT" --format="value(name)"
kubectl get pods -n "$NS"                                      # app (and any sibling) still Running
```

Binary Authorization on GKE is enforced by the **cluster's** admission controller, so every pod in the cluster — including `additional_services` siblings — goes through the same policy; there is no per-workload setting to forget.

#### CI/CD walkthrough (read-only unless you have a repository)

With a repository and token you would set:

```hcl
enable_cicd_trigger   = true
github_repository_url = "https://github.com/<your-org>/<your-repo>"
github_token          = "<your-github-pat>"           # first apply only
cicd_trigger_config   = { branch_pattern = "^main$" }
```

Verify with `gcloud builds triggers list --project="$PROJECT" --region="$REGION"`, push a commit, and watch **Cloud Build → History** build and roll out a new image (`kubectl get "$WL" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}'`). Adding `enable_cloud_deploy = true` creates a delivery pipeline (`gcloud deploy delivery-pipelines list --region="$REGION" --project="$PROJECT"`) and one namespace per stage; promotions to `prod` wait for approval.

#### Explore further

- `binauthz_evaluation_mode = "REQUIRE_ATTESTATION"` blocks any image without an attestation, including emergency rollbacks; `ALWAYS_DENY` blocks everything. Only try these in a throwaway project, and check `kubectl get events -n "$NS"` for `image policy webhook` denials.

#### Watch out for

- The Binary Authorization policy is a **project-wide singleton**: tightening it affects every workload in every namespace of the project, not just this app.
- Cloud Deploy without the CI/CD trigger is refused at plan time — releases come only from the pipeline.
- Under Cloud Deploy the base-namespace Service is not created; workloads run in per-stage namespaces.

#### Revert

```hcl
binauthz_evaluation_mode    = "ALWAYS_ALLOW"
enable_binary_authorization = false
```

---

### Lab 13 — NFS Storage (Group 13)

> **Objective:** Mount the shared NFS share where the app writes, prove files survive a pod replacement, and recognise that the NFS VM also provides Redis.

**You will:** move the mount to a new path and volume name · write, restart, read · compare `NFS_SERVER_IP` with `REDIS_HOST` · set the Job deadline.
**Time:** 20 min · **Cost:** none (shared NFS server) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_nfs` | `true` | **No** | Mounts the Services_GCP NFS share (app-scoped subtree `/share/<SERVICE>`) into the pod and Jobs that ask for it. Also makes the default Redis host available. |
| `nfs_mount_path` | `"/mnt/nfs"` | Yes | Mount path in the container. Must not equal `stateful_pvc_mount_path` (plan-time check). |
| `nfs_volume_name` | `"nfs-data-volume"` | Yes | Kubernetes volume name for the mount. |
| `nfs_instance_name` | `""` | Yes | Use a specific NFS VM instead of discovering one. |
| `nfs_instance_base_name` | `"app-nfs"` | Yes | Base name for an inline NFS VM (standalone deployments only). |
| `job_active_deadline_seconds` | `3600` | Yes | Wall-clock budget for each Kubernetes Job, counted from Job **creation** (so Autopilot node provisioning time counts against it). |

#### Step 1 — Configure

```hcl
enable_nfs                  = true
nfs_mount_path              = "/srv/shared"        # where this app should write shared files
nfs_volume_name             = "lab-nfs-vol"
job_active_deadline_seconds = 1800
```

#### Step 2 — Apply

**Update**. The pod template changes and the pod is recreated (Recreate strategy). ~5 minutes.

#### Step 3 — Verify

```bash
kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{range .items[0].spec.containers[0].volumeMounts[*]}{.mountPath}{"\t"}{.name}{"\n"}{end}'
# /srv/shared   lab-nfs-vol
kubectl exec -n "$NS" "$WL" -c "$APP" -- df -h /srv/shared        # an NFS filesystem (server:/share/<SERVICE>)

# Persistence across a pod replacement
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'echo lab13-marker > /srv/shared/marker.txt'
kubectl rollout restart "$WL" -n "$NS" && kubectl rollout status "$WL" -n "$NS" --timeout=300s
kubectl exec -n "$NS" "$WL" -c "$APP" -- cat /srv/shared/marker.txt   # lab13-marker

# NFS also carries Redis
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'echo NFS=$NFS_SERVER_IP REDIS=$REDIS_HOST'   # equal
gcloud compute instances list --project="$PROJECT" --filter="name~nfs" --format="table(name,status,networkInterfaces[0].networkIP)"
```

#### Explore further

- Set `enable_nfs = false` while `enable_redis = true` and no `redis_host`: the plan fails, because the default Redis host **is** the NFS server. Equal `NFS_SERVER_IP` and `REDIS_HOST` values mean NFS is load-bearing even if the share is empty.
- With `enable_nfs = false` (and Redis off or pointed elsewhere) the inferred strategy becomes `RollingUpdate` — check `.spec.strategy.type`.

#### Watch out for

- Mount the share where the app **actually writes**. A mount at the wrong path gives you a healthy, empty share while the data stays on the pod's ephemeral disk — only a write–restart–read proves it.
- Lock-based stores (SQLite, LevelDB, bbolt, LMDB) misbehave on NFS; use a per-pod disk (Lab 7) for those.

#### Revert

```hcl
nfs_mount_path              = "/mnt/nfs"
nfs_volume_name             = "nfs-data-volume"
job_active_deadline_seconds = 3600
```

The marker file stays on the share (`/share/<SERVICE>`); it is removed when the deployment is deleted.

---

### Lab 14 — Cloud Storage (Group 14)

> **Objective:** Provision an application bucket, mount it into the pod with the GCS Fuse CSI driver, write to it as the non-root app user, and encrypt it with a customer-managed key.

**You will:** create an `assets` bucket with versioning · mount it at `/srv/gcs` with ownership mount options · write a file from the pod and find it in the bucket · enable CMEK on the buckets.
**Time:** 30 min · **Cost:** small (bucket storage, one KMS key version) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `create_cloud_storage` | `true` | **No** | Master switch for the buckets in `storage_buckets`. |
| `storage_buckets` | `[]` | **No** | Buckets named `gcs-<SERVICE>-<name_suffix>`: `location`, `storage_class`, `force_destroy` (default **true**), `versioning_enabled`, `lifecycle_rules`, `public_access_prevention`, `uniform_bucket_level_access`, `cors`. **Removing an entry destroys that bucket and its objects.** |
| `gcs_volumes` | `[]` | Yes | GCS Fuse mounts: `name`, `bucket_name` (empty = the `storage_buckets` entry whose `name_suffix` equals `name`), `mount_path`, `readonly`, `mount_options` (default `implicit-dirs`, `stat-cache-ttl=60s`, `type-cache-ttl=60s`). |
| `manage_storage_kms_iam` | `false` | **No** | Creates (or reuses) a KMS keyring and `storage-key`, grants the GCS service agent access, and sets CMEK as the buckets' default key. |
| `enable_artifact_registry_cmek` | `false` | **No** | Creates an Artifact Registry key; it is applied only to a registry this module creates itself, which it does not do on a Services_GCP foundation. |
| `max_images_to_retain` | `7` | Yes | Image retention guard — only for a module-created registry; no effect on the shared Services_GCP registry. |
| `delete_untagged_images` | `true` | Yes | Same scope as above. |
| `image_retention_days` | `30` | Yes | Same scope as above. |

#### Step 1 — Configure

```hcl
create_cloud_storage = true
storage_buckets = [{
  name_suffix        = "assets"        # -> gs://gcs-<SERVICE>-assets
  versioning_enabled = true
}]
gcs_volumes = [{
  name       = "assets"                # matches name_suffix, so bucket_name is derived
  mount_path = "/srv/gcs"
  readonly   = false
  # mount_options REPLACES the defaults, so restate them; uid/gid make the mount
  # writable by the sample app's non-root user (uid 999)
  mount_options = ["implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s",
                   "uid=999", "gid=999", "file-mode=0664", "dir-mode=0775"]
}]
manage_storage_kms_iam = true          # CMEK on the module's buckets
```

#### Step 2 — Apply

**Update** (warning: `storage_buckets` and `manage_storage_kms_iam` are not update-safe). A bucket and possibly a KMS key are created, and the pod is recreated with the Fuse sidecar. ~8 minutes.

#### Step 3 — Verify

```bash
gcloud storage buckets describe "gs://gcs-$SERVICE-assets" \
  --format="yaml(versioning,default_kms_key,iamConfiguration.publicAccessPrevention)"
# versioning enabled, a default_kms_key ending /cryptoKeys/storage-key, enforced

kubectl get pod -n "$NS" -l app="$APP" -o jsonpath='{.items[0].spec.volumes[*].csi.driver}{"\n"}'   # gcsfuse.csi.storage.gke.io
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'id; ls -ld /srv/gcs; echo hello-gcs > /srv/gcs/probe.txt && echo WRITE-OK'
gcloud storage cat "gs://gcs-$SERVICE-assets/probe.txt"                                    # hello-gcs
```

The write must reach the **bucket**, not just succeed in the container — the last command proves it.

#### Explore further

- Remove the `uid`/`gid`/mode options and write again. On a Deployment the mount is then owned by root and the uid-999 process typically gets `Permission denied` — the GKE Fuse driver does not default to a writable owner for non-root users. (On a StatefulSet with `stateful_fs_group` set, the fsGroup makes it group-writable instead — that is how it worked in testing.)
- Upload a file from your shell (`gcloud storage cp README.md "gs://gcs-$SERVICE-assets/"`) and list it from the pod after the stat cache expires (60 s).
- Note the backup bucket `gcs-$SERVICE-backups` (Lab 17) is created regardless of `storage_buckets`.

#### Watch out for

- `storage_buckets` is **not** update-safe and `force_destroy` defaults to `true`: removing an entry deletes the bucket **with its contents**.
- `mount_options` replaces the default list — always restate `implicit-dirs` and the cache TTLs.
- The registry-retention settings and `enable_artifact_registry_cmek` change nothing on a Services_GCP foundation, whose shared registry owns its own policy.
- A GCS mount path must not equal the PVC mount path (plan-time check).

#### Revert

```hcl
gcs_volumes            = []
storage_buckets        = []        # DELETES gs://gcs-<SERVICE>-assets and its objects
manage_storage_kms_iam = false
```

KMS keyrings and keys cannot be deleted in GCP; the key stays (unused) in the project.

---

### Lab 15 — Redis Cache (Group 15)

> **Objective:** Point the app at a Redis server and understand exactly which variables the module injects, with and without a password.

**You will:** change the Redis port · set `redis_auth` and see `REDIS_URL` disappear and `REDIS_AUTH` appear as a secret.
**Time:** 15 min · **Cost:** none · **Prerequisites / external setup:** none (the sample app does not use Redis, so this lab inspects the injected configuration).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_redis` | `true` | Yes | Injects `REDIS_HOST`, `REDIS_PORT` and (without a password) `REDIS_URL`. Requires a host: `redis_host`, or NFS (plan-time check). Set `false` for apps that do not use Redis. |
| `redis_host` | `""` | Yes | Redis host; empty = the NFS server's IP (Redis is co-hosted on the Services_GCP NFS VM). |
| `redis_port` | `"6379"` | Yes | Port; validated as a number at plan time. |
| `redis_auth` | `""` | Yes (sensitive) | Redis password. When set, `REDIS_AUTH` is injected from the Kubernetes Secret `<PREFIX>-explicit-secrets` and `REDIS_URL` is **no longer injected**. |

#### Step 1 — Configure

```hcl
enable_redis = true
redis_port   = "6380"                      # visible change in the pod env
redis_auth   = "lab-redis-password"        # switches REDIS_URL -> REDIS_AUTH secret
```

#### Step 2 — Apply

**Update**. The explicit-secrets Secret is updated and the pod rolls. ~5 minutes.

#### Step 3 — Verify

```bash
kubectl get "$WL" -n "$NS" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\t"}{.value}{.valueFrom.secretKeyRef.name}{"\n"}{end}' | grep REDIS
# REDIS_HOST  10.x.x.x
# REDIS_PORT  6380
# REDIS_AUTH  <PREFIX>-explicit-secrets
# (no REDIS_URL)
```

Compare with the baseline, where `REDIS_URL=redis://<nfs-ip>:6379` was present and `REDIS_AUTH` absent.

#### Explore further

- Set `enable_redis = false`: all `REDIS_*` variables disappear. This is the right setting for apps that do not use Redis.
- Point `redis_host` at a Memorystore instance's private IP (`gcloud redis instances list --region="$REGION"`) for a managed Redis.

#### Watch out for

- An app that reads `REDIS_URL` must build it itself once `redis_auth` is set, because the module stops composing a URL rather than embed the password in it.
- Pointing `redis_host` at a non-existent address deploys fine and fails only inside the app. With network segmentation (Lab 6) on, the NetworkPolicy allows egress to the configured Redis host.

#### Revert

```hcl
redis_port = "6379"
redis_auth = ""
```

---

### Lab 16 — Database Configuration (Group 16)

> **Objective:** Adapt the database connection to an application's expected variable names, understand which DB settings are inert or dangerous, and run a real password rotation.

**You will:** add alias env vars for host/user/name/port/password · confirm `application_database_name`/`user` rename nothing · enable automatic password rotation, trigger it, and confirm the app reconnects.
**Time:** 40 min · **Cost:** small (a rotation Cloud Run Job, a dispatcher service and an Eventarc trigger) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | Yes (flag) — treat as **create-time** | `POSTGRES`, `MYSQL`, a pinned version such as `POSTGRES_17`, or `NONE`. `NONE` also requires `enable_cloudsql_volume = false` (plan-time check). Changing the engine later points the app at a different, empty database. |
| `sql_instance_name` | `""` | Yes | Use a specific Cloud SQL instance instead of discovering the Services_GCP one. |
| `sql_instance_base_name` | `"app-sql"` | Yes | Base name for an inline instance (standalone only). |
| `application_database_name` | `"gkeappdb"` | Yes | **Inert**: the database is always named after `SERVICE`. |
| `application_database_user` | `"gkeappuser"` | Yes | **Inert**: the user is always named after `SERVICE`. |
| `database_password_length` | `32` | **No** | Length of the generated password (16–64). **Changing it on a running deployment breaks DB authentication** until the `db-create` job is re-run. |
| `enable_postgres_extensions` | `false` | Yes | Installs the extensions in `postgres_extensions` (a Group 0 list, not on the form). Enabling it alone from the form installs nothing on App_GKE. Must match the engine (plan-time check). |
| `enable_mysql_plugins` | `false` | Yes | Same, for MySQL plugins in `mysql_plugins` (Group 0). |
| `enable_auto_password_rotation` | `false` | Yes | Deploys a rotator Cloud Run Job `<SERVICE>-pw-rotator`, a dispatcher service and an Eventarc trigger fired by the secret's rotation schedule (`secret_rotation_period`). |
| `rotation_propagation_delay_sec` | `90` | Yes | Seconds the rotator waits after adding the new secret version before disabling the old one. |
| `db_password_env_var_name` | `""` | Yes | Extra env name carrying the DB password. |
| `db_host_env_var_name` | `""` | Yes | Extra env name carrying the DB host (`127.0.0.1` on GKE with the proxy). |
| `db_user_env_var_name` | `""` | Yes | Extra env name carrying the DB user. |
| `db_name_env_var_name` | `""` | Yes | Extra env name carrying the DB name. |
| `db_port_env_var_name` | `""` | Yes | Extra env name carrying the DB port. |

#### Step 1 — Configure

```hcl
application_database_name      = "labgkedb"          # set to prove it is inert
application_database_user      = "labgkeuser"
db_host_env_var_name           = "MYAPP_DB_HOST"     # aliases for an app expecting other names
db_user_env_var_name           = "MYAPP_DB_USER"
db_name_env_var_name           = "MYAPP_DB_NAME"
db_port_env_var_name           = "MYAPP_DB_PORT"
db_password_env_var_name       = "MYAPP_DB_PASSWORD"
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 120
```

#### Step 2 — Apply

**Update**. The pod rolls with the new env vars; the rotation job, dispatcher and trigger are created. ~8 minutes.

#### Step 3 — Verify

```bash
# Aliases carry the same values as the standard names
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'for v in HOST USER NAME PORT; do echo "$v: $(printenv DB_$v) / $(printenv MYAPP_DB_$v)"; done; [ "$DB_PASSWORD" = "$MYAPP_DB_PASSWORD" ] && echo "password alias matches"'
# HOST: 127.0.0.1 / 127.0.0.1 ...

# application_database_name/user created nothing
gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" --format="value(name)" | grep -c labgkedb   # 0

# Rotation machinery
gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~$SERVICE-pw-rotator" --format="value(metadata.name)"
gcloud secrets describe "$DB_SECRET" --project="$PROJECT" --format="yaml(rotation,topics)"
```

Now rotate the password for real, then make the app pick it up:

```bash
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --format="table(name,state)"   # note the latest version
gcloud run jobs execute "$SERVICE-pw-rotator" --project="$PROJECT" --region="$REGION" --wait
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --format="table(name,state)"   # new ENABLED version, old DISABLED

sleep 150   # the Secret Manager -> Kubernetes Secret sync rotates about every 120 s
kubectl rollout restart "$WL" -n "$NS" && kubectl rollout status "$WL" -n "$NS" --timeout=300s
curl -s "http://$LB_IP/db"; echo         # {"status":"connected", ...} with the NEW password
curl -s "http://$LB_IP/"; echo           # counter still increments
```

#### Explore further

- `database_type = "NONE"` on a **fresh** deployment (with `enable_cloudsql_volume = false`): no database, no proxy sidecar, and the sample `db-init` exits immediately with *"No database configured"*. Leaving `enable_cloudsql_volume = true` fails the plan.
- `enable_postgres_extensions = true` with `database_type = "MYSQL"` fails the plan.

#### Watch out for

- **Do not change `database_password_length` on a running deployment.** It writes a new secret version while the database keeps the old password, and the old version is destroyed — every connection fails until `db-create` is re-run. Use rotation instead.
- After a rotation, pods keep the password they started with. New DB connections from an unrestarted pod fail once the old password stops working; restart the workload after the sync interval (the step above does this).
- On GKE all DB host variables, including `DB_IP` and the host alias, resolve to `127.0.0.1` (the proxy). On Cloud Run the same alias resolves to the instance's private IP — do not assume they match across platforms.

#### Revert

```hcl
application_database_name     = "gkeappdb"
application_database_user     = "gkeappuser"
db_host_env_var_name          = ""
db_user_env_var_name          = ""
db_name_env_var_name          = ""
db_port_env_var_name          = ""
db_password_env_var_name      = ""
enable_auto_password_rotation = false
rotation_propagation_delay_sec = 90
```

Disabling rotation removes the job, dispatcher and trigger; the current (rotated) password remains valid.

---

### Lab 17 — Backup & Maintenance (Group 17)

> **Objective:** Schedule the database export, take a backup on demand, and restore a backup file into the database.

**You will:** move the backup CronJob schedule and retention · run an export now and find the file in the backup bucket · import the bundled sample `backup.sql` and confirm what it did · switch the import back off.
**Time:** 25 min · **Cost:** small (backup bucket storage) · **Prerequisites / external setup:** none — the module stages a non-destructive sample `backup.sql` into `gs://gcs-<SERVICE>-backups/` for you. To restore your **own** dump, upload it to that bucket first.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Yes | Cron (UTC) of the export CronJob `<SERVICE>-db-export`. |
| `backup_retention_days` | `7` | Yes | Lifecycle rule on `gcs-<SERVICE>-backups` deleting older files. |
| `enable_backup_import` | `false` | **No** | Runs the import Job `<SERVICE>-db-import`, restoring `backup_file` **over the live database**. Requires a database and a `backup_file` (plan-time checks). |
| `backup_source` | `"gcs"` | Yes | `gcs` (the backup bucket) or `gdrive`. |
| `backup_file` | `"backup.sql"` | Yes | A bare **filename** in the backup bucket — the module builds the `gs://` URI itself. |
| `backup_format` | `"sql"` | Yes | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto` (`auto` not allowed with `gdrive`). |

#### Step 1 — Configure

```hcl
backup_schedule       = "30 4 * * *"   # daily 04:30 UTC
backup_retention_days = 21
enable_backup_import  = true           # one-off restore of the sample file
backup_source         = "gcs"
backup_file           = "backup.sql"   # bare filename, already staged by the module
backup_format         = "sql"
```

#### Step 2 — Apply

**Update** (warning on `enable_backup_import`). The CronJob schedule and bucket lifecycle are updated and the import Job runs. ~5 minutes.

#### Step 3 — Verify

```bash
kubectl get cronjob "$SERVICE-db-export" -n "$NS" -o jsonpath='{.spec.schedule}{"\n"}'          # 30 4 * * *
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format="yaml(lifecycle_config)"   # age: 21

# Restore result — assert on what the SQL did, not just the Job status
kubectl get job "$SERVICE-db-import" -n "$NS"
kubectl logs -n "$NS" job/"$SERVICE"-db-import --all-containers | grep -E "CREATE TABLE|INSERT|validation table"
# CREATE TABLE / INSERT 0 1 / NOTICE: Platform validation table is ready.

# Take a backup now
kubectl create job lab-export-now --from=cronjob/"$SERVICE"-db-export -n "$NS"
kubectl wait --for=condition=complete job/lab-export-now -n "$NS" --timeout=600s
gcloud storage ls -l "gs://gcs-$SERVICE-backups/"            # backup.sql plus a new timestamped export
```

#### Step 4 — Switch the import off

Leaving `enable_backup_import = true` re-runs the restore whenever the import Job is re-created, overwriting newer data with the old file. Set it back now:

```hcl
enable_backup_import = false
```

#### Explore further

- Download the export you just made (`gcloud storage cp gs://gcs-$SERVICE-backups/<file> .`) and look inside — it is the dump you would restore with `backup_file = "<file>"`.
- Try `enable_backup_import = true` with `backup_file = ""`: the plan fails.

#### Watch out for

- An import **restores over the live database**. The bundled sample only creates a validation table, but a real dump replaces data. Take an export first.
- `backup_file` is a filename, not a `gs://` URI.
- Delete your manual Job afterwards: `kubectl delete job lab-export-now -n "$NS"`.

#### Revert

```hcl
backup_schedule       = "0 2 * * *"
backup_retention_days = 7
enable_backup_import  = false
```

---

### Lab 18 — Custom SQL Scripts (Group 18)

> **Objective:** Run your own SQL scripts, in a guaranteed order, against the app database during deployment.

**You will:** stage two scripts whose order matters · run them as the app user · read the Job log proving the order.
**Time:** 20 min · **Cost:** negligible · **Prerequisites / external setup:** a GCS bucket you create (Step 1). The module grants the workload service account read access to it.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | **No** | Runs the Job `<SERVICE>-custom-sql-scripts`, executing every `.sql` file under the prefix in lexicographic order. Requires a database, a bucket and a path (plan-time checks). |
| `custom_sql_scripts_bucket` | `""` | Yes | Bucket holding the scripts; the module grants `roles/storage.objectViewer` on it to the workload SA. |
| `custom_sql_scripts_path` | `""` | Yes | Prefix inside the bucket; an empty value is refused because it would silently run nothing. |
| `custom_sql_scripts_use_root` | `false` | Yes | Run as the root DB user (for `CREATE EXTENSION`, roles…) instead of the app user. |

#### Step 1 — Configure

Stage two scripts where `02` fails if it runs before `01`:

```bash
export SQL_BUCKET="<your-bucket>"            # globally unique, e.g. $PROJECT-lab-sql
gcloud storage buckets create "gs://$SQL_BUCKET" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
printf 'CREATE TABLE IF NOT EXISTS lab_order_check (id int);\n' > 01-create.sql
printf 'INSERT INTO lab_order_check VALUES (1);\n' > 02-insert.sql
gcloud storage cp 01-create.sql 02-insert.sql "gs://$SQL_BUCKET/sql/"
```

```hcl
enable_custom_sql_scripts   = true
custom_sql_scripts_bucket   = "<your-bucket>"   # the bucket you just created
custom_sql_scripts_path     = "sql"             # every .sql under sql/ runs, sorted by name
custom_sql_scripts_use_root = false             # run as the app's own DB user
```

#### Step 2 — Apply

**Update** (warning on `enable_custom_sql_scripts`). A bucket IAM grant and the scripts Job are created. ~5 minutes.

#### Step 3 — Verify

```bash
gcloud storage buckets get-iam-policy "gs://$SQL_BUCKET" --format="table(bindings.role,bindings.members)" | grep objectViewer
kubectl logs -n "$NS" job/"$SERVICE"-custom-sql-scripts --all-containers
# Found 2 SQL script(s) / 01-create.sql -> CREATE TABLE / 02-insert.sql -> INSERT 0 1
# Executing scripts as application user / Cloud SQL Proxy shutdown signal sent
kubectl get job "$SERVICE-custom-sql-scripts" -n "$NS"                 # COMPLETIONS 1/1
```

#### Explore further

- Add `03-select.sql` (`SELECT count(*) FROM lab_order_check;`) and change any script so the Job is re-created; the count grows on each run because `02` is not idempotent — design real scripts to be safe to re-run.
- `custom_sql_scripts_use_root = true` and a `CREATE EXTENSION IF NOT EXISTS pg_trgm;` script shows when root is needed.

#### Watch out for

- Scripts run in **filename** order; prefix them `01-`, `02-`…
- Scripts must exist before the update; a missing prefix makes the Job find nothing.

#### Revert

```hcl
enable_custom_sql_scripts = false
custom_sql_scripts_bucket = ""
custom_sql_scripts_path   = ""
```

Then delete the staged bucket (Task 6 lists it too): `gcloud storage rm -r "gs://$SQL_BUCKET"`.

---

### Lab 19 — Access & Networking (Group 19)

> **Objective:** Serve the app over HTTPS through the Gateway API global load balancer — with a zero-config `nip.io` certificate or your own domain — and control its static IP.

**You will:** activate the Gateway with `enable_custom_domain = true` and no domain · watch the managed certificate become ACTIVE and browse `https://<a-b-c-d>.nip.io` · see the Gateway health check mirror your liveness probe · learn what renaming the static IP does.
**Time:** 40 min (certificate issuance is most of it) · **Cost:** a global external Application Load Balancer and a global static IP · **Prerequisites / external setup:** none for `nip.io`; a domain and the ability to create a DNS `A` record if you use your own.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_custom_domain` | `false` | **No** | Activates the Gateway (`gke-l7-global-external-managed`) with HTTP and HTTPS listeners and a Certificate Manager certificate. With no `application_domains`, the host is the dashed `<a-b-c-d>.nip.io` of the Gateway IP. |
| `application_domains` | `[]` | **No** | Your hostnames; each needs a DNS `A` record to the Gateway IP before the certificate can be issued. |
| `reserve_static_ip` | `true` | Yes | Reserves a static IP: `<SERVICE>-lb-ip` (regional) for a plain LoadBalancer, `<SERVICE>-gateway-ip` (global) for the Gateway. |
| `static_ip_name` | `""` | **No** | Overrides the IP resource name. Renaming releases the old address and reserves a **new** one — the IP and `nip.io` host change. |
| `network_tags` | `["nfsserver"]` | Yes | **Inert**: merged into a value nothing reads; Autopilot does not let a workload set node tags. NFS does not depend on it. |
| `network_name` | `""` | Yes | VPC to use; required only when several Services_GCP networks exist. |
| `gateway_backend_stage` | `"dev"` | Yes | Cloud Deploy stage the Gateway routes to; ignored without Cloud Deploy. |

#### Step 1 — Configure

```hcl
enable_custom_domain = true      # Gateway + managed certificate
application_domains  = []        # empty -> zero-config <a-b-c-d>.nip.io host
reserve_static_ip    = true
```

To use your own domain instead, set `application_domains = ["app.example.com"]` and, after the apply, create an `A` record for it pointing at the Gateway IP.

#### Step 2 — Apply

**Update** (warning: `enable_custom_domain` is not update-safe). Expect a global IP `$SERVICE-gateway-ip`, a Gateway `$PREFIX-gateway`, an HTTPRoute `$PREFIX-route`, a `HealthCheckPolicy`, a `GCPBackendPolicy`, and Certificate Manager objects `$SERVICE-cert-nipio` / `$SERVICE-cert-map`. The regional `$SERVICE-lb-ip` is **released** (the Gateway now owns the stable address). ~10 minutes, then up to an hour for the certificate.

#### Step 3 — Verify

```bash
kubectl get gateway,httproute,healthcheckpolicy,gcpbackendpolicy -n "$NS"
export GW_IP=$(kubectl get gateway "$PREFIX-gateway" -n "$NS" -o jsonpath='{.status.addresses[0].value}')
export HOST="${GW_IP//./-}.nip.io"
echo "https://$HOST"

gcloud certificate-manager certificates list --project="$PROJECT" --filter="name~$SERVICE" \
  --format="table(name,managed.domains,managed.state)"        # PROVISIONING -> ACTIVE

# The Gateway health check mirrors health_check_config
kubectl get healthcheckpolicy "$PREFIX-health-check-policy" -n "$NS" -o jsonpath='{.spec.default.config}{"\n"}'   # requestPath /healthz

# Once the certificate is ACTIVE (and edge propagation has finished):
curl -s "https://$HOST/"; echo                 # Hello from Sample App! ...
curl -s "https://$HOST/whoami"; echo           # x_forwarded_for / x_forwarded_proto now set by the Google front end
kubectl exec -n "$NS" "$WL" -c "$APP" -- sh -c 'echo $GKE_SERVICE_URL $DOMAIN'   # https://<a-b-c-d>.nip.io <a-b-c-d>.nip.io
```

A fresh Gateway can return `404`/`502` or refuse TLS for 5–15 minutes after it reports `PROGRAMMED`, and the certificate typically takes 10–60 minutes. Do not diagnose the module during that window.

#### Explore further

- **Confirm there is no second door.** `kubectl get svc "$SERVICE" -n "$NS"` now shows `ClusterIP` with `EXTERNAL-IP <none>`: while the Gateway is active, a `LoadBalancer` setting is created as `ClusterIP`, so nothing reaches the pods around IAP or Cloud Armor. The old L4 IP is released when you switch the Gateway on, and a new one is assigned if you switch it off again. `NodePort` is not converted and its node ports are not behind the Gateway — avoid it with IAP or Cloud Armor.
- With the Gateway active, add `uptime_check_config = { enabled = true, path = "/" }` (Lab 10): the check now probes `https://<a-b-c-d>.nip.io`.
- **Static IP rename (not update-safe):** `static_ip_name = "lab-gke-ip"` re-addresses the Gateway — new IP, new `nip.io` host, new certificate. Verify with `gcloud compute addresses list --filter="name=lab-gke-ip"`.
- Set `network_tags = ["lab-tag", "nfsserver"]` and confirm nothing changes (`kubectl get nodes -o wide` shows no new tags, NFS still mounted).

#### Watch out for

- Switching the Gateway on or off changes the public address: on, the regional LB IP is released; off, a new regional IP is reserved. Update DNS records and bookmarks accordingly.
- Use the **dashed** `nip.io` form (`1-2-3-4.nip.io`); the dotted form resolves too but has no certificate.
- A Google-managed certificate for your own domain stays `PROVISIONING` until DNS points at the Gateway IP.

#### Revert

```hcl
enable_custom_domain = false
application_domains  = []
static_ip_name       = ""
network_tags         = ["nfsserver"]
```

The Gateway, certificate and global IP are deleted and a new regional `$SERVICE-lb-ip` is reserved — re-read `LB_IP` (Task 2, step 1). Remove any DNS record you created.

---

### Lab 20 — Identity-Aware Proxy (Group 20)

> **Objective:** Require a Google sign-in, limited to named users or groups, before anyone reaches the app.

**You will:** create an OAuth client · enable IAP on the Gateway backend · see an anonymous request redirected to Google sign-in and an authorised browser session succeed.
**Time:** 30 min · **Cost:** small · **Prerequisites / external setup:** **[External setup required]** an OAuth consent screen and an OAuth 2.0 client (Console only — programmatic creation is deprecated); the Gateway active (Lab 19's `enable_custom_domain = true`, or Lab 21's `enable_cloud_armor = true`); `enable_cdn = false`. You can read this lab without the external setup — Step 2's plan-time guards fire without it.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_iap` | `false` | Yes | Adds `iap` to the `GCPBackendPolicy` and grants `roles/iap.httpsResourceAccessor` at **project** level to the listed identities (plus the deploying identity). |
| `iap_authorized_users` | `[]` | Yes | `user:…` or `serviceAccount:…` (a bare email gets `user:` added). |
| `iap_authorized_groups` | `[]` | Yes | `group:…`. At least one user or group is required (plan-time check). |
| `iap_oauth_client_id` | `""` | Yes (sensitive) | OAuth client ID. Required (plan-time check). |
| `iap_oauth_client_secret` | `""` | Yes (sensitive) | Stored as the Kubernetes Secret `<SERVICE>-iap-oauth`. Required (plan-time check). |
| `iap_support_email` | `""` | Yes | Support contact for the consent screen. Required (plan-time check). |

#### Step 1 — External setup (Console)

1. **APIs & Services → OAuth consent screen**: configure it (type *Internal* if your project is in an organisation, else *External*), with your support email.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**. Create it, then edit it and add the authorised redirect URI `https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect` (substituting the new client ID).
3. Copy the client ID and secret.

#### Step 2 — Configure

```hcl
enable_custom_domain    = true                       # Gateway with HTTPS (from Lab 19)
enable_cdn              = false                      # IAP and CDN are mutually exclusive
enable_iap              = true
iap_authorized_users    = ["user:<your-email>"]
iap_authorized_groups   = []
iap_oauth_client_id     = "<client-id>.apps.googleusercontent.com"
iap_oauth_client_secret = "<client-secret>"
iap_support_email       = "<your-email>"
```

Try it first **without** the client ID/secret or the support email: the plan fails with *"When enable_iap is true, both iap_oauth_client_id and iap_oauth_client_secret must be provided. Without credentials, IAP is silently disabled and the application is exposed without authentication."* — and the companion checks for the support email and an authorised identity. Then fill them in and **Update**. ~5–10 minutes.

#### Step 3 — Verify

```bash
kubectl get gcpbackendpolicy "$PREFIX-backend-policy" -n "$NS" -o jsonpath='{.spec.default.iap}{"\n"}'   # enabled: true, clientID ...
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.role=roles/iap.httpsResourceAccessor" --format="value(bindings.members)"
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://$HOST/"
# 302 https://accounts.google.com/...      (anonymous request -> Google sign-in)
```

Open `https://$HOST/` in a browser signed in as an authorised user: after sign-in you see the visitor counter. A user not on the list sees an IAP access-denied page.

#### Explore further

- `curl -s "https://$HOST/whoami"` from an authorised browser session shows `X-Goog-Iap-Jwt-Assertion` among the header **names** — the signed identity assertion an app can verify.
- Try `enable_cdn = true` with IAP on: the plan fails — *"Cloud CDN and IAP cannot be enabled together."*

#### Watch out for

- IAP protects only the **Gateway** path. With the Gateway on, a `LoadBalancer` Service is created as `ClusterIP`, so there is no second address (see Lab 19 *Explore further*); `service_type = "NodePort"` is not converted and is not behind IAP — don't combine them.
- The IAP accessor role is granted at **project** level, so it also opens other IAP-protected apps in the same project to the same people.
- An empty allowlist is refused at plan time rather than locking everyone out.

#### Revert

```hcl
enable_iap              = false
iap_authorized_users    = []
iap_oauth_client_id     = ""
iap_oauth_client_secret = ""
iap_support_email       = ""
```

`curl` to `https://$HOST/` returns 200 again. Delete the OAuth client in the Console if you no longer need it.

---

### Lab 21 — Cloud Armor & CDN (Group 21)

> **Objective:** Put a Cloud Armor WAF in front of the app that blocks common attacks and rate-limits clients, and see precisely what `enable_cdn` does on GKE.

**You will:** enable Cloud Armor (which activates the Gateway with a `nip.io` certificate even without Lab 19) · find the policy attached to the Gateway's backend service · watch SQLi/XSS probes turn from 200 to 403 · enable CDN out-of-band.
**Time:** 35 min (rule propagation ~5–10 min) · **Cost:** a Cloud Armor policy (monthly + per-rule charges) and the global load balancer · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_cloud_armor` | `false` | **No** | Creates the policy `<SERVICE>-waf-policy` (SQLi, XSS, LFI, RCE at priorities 1000–1003; 500 req/min per IP rate-based ban at 2000; default allow) and attaches it via the `GCPBackendPolicy`. Activates the Gateway. Requires `service_type = "LoadBalancer"` or `enable_custom_domain` (plan-time check). |
| `admin_ip_ranges` | `[]` | Yes | CIDRs allowed at priority 100, ahead of the WAF rules. Also used as the VPC-SC admin access level (Lab 22). |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Yes | **Not applied.** With Armor on, the module always creates and attaches its own `<SERVICE>-waf-policy`; with Armor off, no policy is attached. |
| `enable_cdn` | `false` | Yes | Activates the Gateway path only. The `GCPBackendPolicy` has no CDN field, so the backend service keeps `enableCDN: false` until you enable CDN yourself. Mutually exclusive with IAP. |

#### Step 1 — Configure

```hcl
enable_cloud_armor = true
admin_ip_ranges    = ["203.0.113.0/24"]     # documentation range; use your office CIDR in real life
enable_cdn         = true                   # only if IAP (Lab 20) is OFF
```

#### Step 2 — Apply

**Update** (warning: `enable_cloud_armor` is not update-safe). If the Gateway was not already active (Lab 19 reverted), it is created now with a `nip.io` certificate, and the regional LB IP is released. ~10 minutes, plus certificate time.

#### Step 3 — Verify

```bash
gcloud compute security-policies describe "$SERVICE-waf-policy" --project="$PROJECT" \
  --format="table(rules.priority,rules.action,rules.description)"
# 100 allow (admin), 1000-1003 deny(403), 2000 rate_based_ban, 2147483647 allow

BS=$(gcloud compute backend-services list --project="$PROJECT" --global \
  --filter="securityPolicy~$SERVICE-waf-policy" --format="value(name)")
echo "Backend service: $BS"
gcloud compute backend-services describe "$BS" --global --project="$PROJECT" --format="yaml(securityPolicy,enableCDN)"
# securityPolicy: .../<SERVICE>-waf-policy   enableCDN: false

export GW_IP=$(kubectl get gateway "$PREFIX-gateway" -n "$NS" -o jsonpath='{.status.addresses[0].value}')
export HOST="${GW_IP//./-}.nip.io"
curl -s -o /dev/null -w "normal: %{http_code}\n" "https://$HOST/"
curl -s -o /dev/null -w "xss:    %{http_code}\n" "https://$HOST/?q=%3Cscript%3Ealert(1)%3C/script%3E"
curl -s -o /dev/null -w "sqli:   %{http_code}\n" "https://$HOST/?id=1%27%20OR%20%271%27=%271"
# normal 200; xss 403; sqli 403  (allow ~5-10 minutes after the apply for the rules to take effect)
```

Enable CDN yourself (the module cannot), then confirm:

```bash
gcloud compute backend-services update "$BS" --global --project="$PROJECT" --enable-cdn
gcloud compute backend-services describe "$BS" --global --project="$PROJECT" --format="value(enableCDN)"   # True
```

#### Explore further

- Send 600 requests in under a minute (`for i in $(seq 600); do curl -s -o /dev/null -w "%{http_code}\n" "https://$HOST/healthz"; done | sort | uniq -c`) — once the rate-based rule trips, responses switch to `429`.
- Add your own public IP (`curl -s https://ifconfig.me`) as `admin_ip_ranges = ["<your-ip>/32"]`; the XSS probe then returns 200, because priority 100 allows you before the WAF rules.

#### Watch out for

- Rules take **5–10 minutes** to propagate; an immediate 200 on an attack probe is not a failure.
- `cloud_armor_policy_name` does not select a policy — only the module's own policy is ever attached.
- Armor protects only the Gateway. A remaining external L4 IP on the Service (Lab 19 *Explore further*) is not protected.
- A CDN setting you add out-of-band is managed by GKE's Gateway controller, which may reset it when it reconciles the backend — re-check `enableCDN` after later updates.

#### Revert

```hcl
enable_cloud_armor = false
admin_ip_ranges    = []
enable_cdn         = false
```

The policy is detached and deleted; if no other Group 19–21 feature keeps the Gateway, it is removed and a regional LB IP is reserved again (re-read `LB_IP`).

---

### Lab 22 — VPC Service Controls & Audit Logging (Group 22)

> **Objective:** Turn on detailed Cloud Audit Logs for the project, and understand how the module builds — or honestly declines to build — a VPC Service Controls perimeter.

**You will:** enable data-access audit logs and read them back · request a VPC-SC perimeter in dry-run and read the module's own report of whether it was created.
**Time:** 15 min · **Cost:** increased Cloud Logging volume · **Prerequisites / external setup:** **[External setup required for VPC-SC]** the project must belong to an **organisation**, the deployer needs Access Context Manager admin at organisation scope, `admin_ip_ranges` must be non-empty, and a folder-nested project needs `organization_id`. In a RAD-managed project the VPC-SC fields are hidden. Audit logging needs nothing external.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_vpc_sc` | `false` | Yes · hidden in RAD-managed projects | Creates a regular perimeter with access levels for the VPC, admin IPs, IAP and CI/CD. Skips with a warning (and reports `vpc_sc_enabled = false`) when no organisation can be found, `admin_ip_ranges` is empty, or the deployer lacks permission. |
| `vpc_cidr_ranges` | `[]` | Yes · hidden in RAD-managed projects | VPC CIDRs for the network access level; empty = discovered (fallback `10.0.0.0/8`). |
| `vpc_sc_dry_run` | `true` | Yes · hidden in RAD-managed projects | Log violations without blocking. Keep `true` until the logs are clean. |
| `organization_id` | `""` | Yes · hidden in RAD-managed projects | Needed for folder-nested projects; auto-discovered otherwise. |
| `enable_audit_logging` | `false` | **No** | Project audit configs for `allServices` (`ADMIN_READ`, `DATA_READ`, `DATA_WRITE`) plus Secret Manager and Cloud KMS overrides. |

#### Step 1 — Configure

```hcl
enable_audit_logging = true
# Only in a bring-your-own project inside an organisation:
# enable_vpc_sc    = true
# vpc_sc_dry_run   = true
# admin_ip_ranges  = ["<your-ip>/32"]     # Group 21 field; required for VPC-SC
# organization_id  = "<your-org-id>"      # if the project sits under a folder
```

#### Step 2 — Apply

**Update** (warning on `enable_audit_logging`). ~3 minutes.

#### Step 3 — Verify

```bash
gcloud projects get-iam-policy "$PROJECT" --format="yaml(auditConfigs)"
# allServices, secretmanager.googleapis.com, cloudkms.googleapis.com with DATA_READ / DATA_WRITE / ADMIN_READ

curl -s "http://$LB_IP/" >/dev/null     # generate a secret read on the next pod start, or wait a few minutes
gcloud logging read 'logName:"cloudaudit.googleapis.com%2Fdata_access"' --project="$PROJECT" --limit=5 \
  --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName)"
```

If you also requested VPC-SC, the apply log contains a warning when the perimeter is skipped, and the platform's outputs report `vpc_sc_enabled = false` with no perimeter name — the module states what happened rather than what you asked for. Where it is created: `gcloud access-context-manager perimeters list --policy=<policy-id>` and dry-run violations under `protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"`.

#### Explore further

- In **IAM & Admin → Audit Logs**, see the per-service checkboxes the module set.
- With a perimeter in dry-run, review a day of violation logs before ever setting `vpc_sc_dry_run = false`.

#### Watch out for

- Audit configs are **project-wide**: they affect logging (and cost) for every service in the project, and another app that also manages them can overwrite or remove them.
- Enforcing VPC-SC without reviewing dry-run logs can break image pulls, the Cloud SQL proxy and Secret Manager reads at once.

#### Revert

```hcl
enable_audit_logging = false
enable_vpc_sc        = false
```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — controller, pods, autoscaler, disruption budget and volumes:

   ```bash
   kubectl get deploy,sts,pods,hpa,pdb,pvc -n "$NS"
   kubectl describe "$WL" -n "$NS"
   kubectl top pods -n "$NS" --containers            # live CPU/memory per container
   ```

2. **Scale** by changing `min_instance_count` / `max_instance_count` and clicking **Update** on the deployment details page — the module owns the workload spec and the HPA, so scaling is a configuration change, not a manual `kubectl scale` (a manual edit is overridden by the HPA or the next apply). The HPA never scales below 1 replica, so `min_instance_count = 0` does not park the app; to free cluster capacity on a lab project, delete the deployment when you are done (Task 6).

3. **Update the application version** by changing `application_version` via **Update** on the deployment details page; a new image builds and the pods are replaced (Recreate while NFS is mounted, so expect a short gap).

4. **Restart pods** to pick up rotated secrets or a re-pushed image:

   ```bash
   kubectl rollout restart "$WL" -n "$NS" && kubectl rollout status "$WL" -n "$NS" --timeout=300s
   ```

5. **Manage secrets, storage and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~$SERVICE"
   kubectl get jobs,cronjobs -n "$NS"                       # init jobs, db-export, your cron jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)"
   ```

6. **Re-run a database setup job** (for example after a manual password change) by re-creating it from its definition:

   ```bash
   kubectl get job "$SERVICE-db-create" -n "$NS" -o json \
     | python3 -c "import json,sys; j=json.load(sys.stdin); m=j['metadata']; [m.pop(k,None) for k in ('uid','resourceVersion','creationTimestamp','managedFields','ownerReferences')]; m['name']+='-rerun'; s=j['spec']; s.pop('selector',None); s['template']['metadata'].get('labels',{}).pop('controller-uid',None); s['template']['metadata'].get('labels',{}).pop('batch.kubernetes.io/controller-uid',None); j.pop('status',None); print(json.dumps(j))" \
     | kubectl apply -f -
   kubectl logs -n "$NS" job/"$SERVICE"-db-create-rerun --all-containers | tail -5
   kubectl delete job "$SERVICE-db-create-rerun" -n "$NS"
   ```

7. **Inspect the database** — the shared instance uses private IP, so check it from the app's own view rather than connecting from your workstation:

   ```bash
   curl -s "http://$LB_IP/db"; echo
   gcloud sql instances describe "$INSTANCE" --project="$PROJECT" --format="yaml(state,databaseVersion,settings.tier)"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" "$WL" -c "$APP" --tail=50            # gunicorn access/error log
   kubectl logs -n "$NS" "$WL" -c cloud-sql-proxy --tail=20     # proxy connections
   kubectl get events -n "$NS" --sort-by=.lastTimestamp | tail -20
   ```

   Logs Explorer filter (replace the namespace):

   ```
   resource.type="k8s_container"
   resource.labels.namespace_name="<your-namespace>"
   ```

   Add `resource.labels.container_name="gkeapp"` for the app only, or `severity>=ERROR` for failures.

2. **Monitoring** — with `support_users` set (Lab 2), open **Monitoring → Dashboards → App_GKE Application - GKE Dashboard**, and review **Alerting → Policies** (CPU and memory utilisation, plus your Lab 10 alert) and **Uptime checks** (Lab 10). The **Kubernetes Engine → Workloads** page shows CPU, memory and restart counts per pod.

3. **Load-balancer view** — once the Gateway is active (Labs 19–21), **Network services → Load balancing** shows request rate, latency and backend health, and Cloud Armor decisions appear in the load balancer's request logs (`resource.type="http_load_balancer"`, field `jsonPayload.enforcedSecurityPolicy`).

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques, plus the failure modes observed when this module was tested group by group on a live project.

- **The apply succeeded but there is no workload (no namespace, no pods).** The module discovers the cluster and reads its status by impersonating `resource_creator_identity`; if that impersonation is denied, the status read fails. Older versions treated that as "no cluster" and skipped every Kubernetes resource while reporting success. The module now **fails the plan** with *"Cluster '…' was discovered … but its status could not be read"* and the exact `gcloud … --impersonate-service-account` command to reproduce it. Fix the impersonation grant, or (outside the platform) use the caller identity.
- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:

  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events: scheduling, probe, mount, image errors
  kubectl logs -n "$NS" <pod> -c "$APP" --previous
  ```

  `exitCode 137` with `reason: Error` is a **probe kill**, not out-of-memory (which reports `OOMKilled`). Check the probe path returns a literal 200 at the pod (Task 2, step 3).
- **`/` says "DB unavailable" or `/db` returns 500:** confirm the `cloud-sql-proxy` sidecar is running (`kubectl get pod … -o jsonpath='{.status.containerStatuses[*].name}'`), the `db-create`/`db-init` Jobs succeeded, and `$PREFIX-secrets` exists. With network segmentation on (Lab 6), check the NetworkPolicy's Cloud SQL rule. After a password rotation, restart the pods (Lab 16).
- **Init job failed or never ran:** `kubectl get jobs -n "$NS"` and `kubectl logs -n "$NS" job/<name> --all-containers`. A Job that hits `job_active_deadline_seconds` reports `DeadlineExceeded` — on a cold Autopilot cluster, node provisioning counts against the budget. A dependency chain deeper than four levels fails the plan rather than silently not running.
- **Pending pod:** `kubectl describe pod` events show the reason — `exceeded quota` (Lab 8; raise the quota or use binary memory suffixes), `Insufficient cpu/memory` while Autopilot adds a node (wait), or `FailedScaleUp` (project CPU quota — scale down other apps). A PVC `Pending` on SSD often means the regional `SSD_TOTAL_GB` quota is exhausted; use `stateful_pvc_storage_class = "standard"`.
- **No external IP / `<pending>`:** `kubectl describe svc "$SERVICE" -n "$NS"`; an address quota (`IN_USE_ADDRESSES`, `STATIC_ADDRESSES`) is exhausted — free unused addresses (`gcloud compute addresses list --filter="status=RESERVED"`).
- **Gateway returns 503 / 404 / no TLS:** wait 5–15 minutes after `PROGRAMMED` and up to an hour for the certificate. If it persists, test the health path at the pod — the Gateway health check needs a literal `200`, while kubelet accepts redirects. `gcloud compute backend-services get-health` showing `EMPTY` is uninformative; trust the HTTP response through the LB.
- **A setting "applied" but nothing changed:** check the lab's *Watch out for* — `container_resources`, `stateful_fs_group`, `service_annotations`/`service_labels` (create-time only), `network_tags`, `application_database_name`/`user`, `cloud_armor_policy_name`, the registry retention settings (inert on a foundation), and misspelt object keys (dropped silently).
- **StatefulSet update fails with "Missing Resource Identity After Update":** a provider bug. Run **Update** again unchanged; in testing the second run completed both times.
- **Image build or mirror failed:** review **Cloud Build → History**; the workload keeps its previous image.
- **403 / permission errors from the app:** the pod runs as the Kubernetes SA bound by Workload Identity to `gke-sa-<PREFIX>`; each secret the app reads must grant that SA `secretAccessor` (the module does this for secrets it knows about — check with `gcloud secrets get-iam-policy`).

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). This removes everything the module created — the Kubernetes workload
and namespace, the database and user, Secret Manager secrets, GCS buckets,
Kubernetes Jobs, the Gateway and static IPs, the Cloud Armor policy, and monitoring objects. Resources owned by **Services_GCP**
(the VPC, GKE cluster, shared Cloud SQL, NFS server, registry) are managed separately and are
not removed here.

**What the feature labs leave behind — remove these yourself:**

| Left by | What | How to remove |
|---|---|---|
| Lab 5 | Secret `lab-gke-api-key` (created outside the module) | `gcloud secrets delete lab-gke-api-key --project="$PROJECT"` |
| Lab 7 / Lab 9 | PersistentVolumeClaims (and their disks) if you reverted the StatefulSet before deleting | `kubectl get pvc -A \| grep "$SERVICE"`; delete them, then check `gcloud compute disks list --filter="name~pvc"` |
| Lab 11 / Lab 17 | Manual Jobs (`lab-cron-manual`, `lab-export-now`) | Removed with the namespace; delete earlier with `kubectl delete job … -n "$NS"` |
| Lab 14 | KMS keyring and `storage-key` (GCP never deletes keys) | Nothing to do; disabled/unused keys cost little. Destroy key versions in **Security → Key Management** if required |
| Lab 18 | Your staged SQL bucket | `gcloud storage rm -r "gs://$SQL_BUCKET"` |
| Lab 19 | DNS `A` records for your own domain | Delete them at your DNS provider |
| Lab 20 | OAuth client and consent screen | **APIs & Services → Credentials** |
| Lab 21 | CDN enabled out-of-band | Removed with the backend service when the Gateway is deleted |
| Lab 12 | Binary Authorization attestor, note and signing key; project policy | Shared with other apps — leave unless the project is yours alone |

After deletion, confirm:

```bash
kubectl get ns "$NS"                                                     # NotFound
gcloud compute addresses list --project="$PROJECT" --filter="name~$SERVICE"   # empty
gcloud storage buckets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)"   # empty
```

A static IP or VPC address can take 20–30 minutes to be released after its load balancer is deleted; if a delete fails on an address still in use, wait and retry.

---

## Appendix — Group 0 platform-wiring variables

These variables are never shown on the form. The platform or a wrapper module (such as `Ghost_GKE`) sets them; leave them at their defaults when deploying `App_GKE` directly.

| Variable | Default | Purpose |
|---|---|---|
| `module_description` | module blurb | Catalogue description shown in the platform. |
| `module_documentation` | Configuration Guide URL | Help link in the platform. |
| `module_dependency` | `["Services_GCP"]` | Modules that must be deployed first. |
| `module_services` | GCP service list | Human-readable service list for the confirmation dialog. |
| `requires_services` | `create_postgres`, `create_network_filesystem`, `create_google_kubernetes_engine` … | Which Services_GCP features the platform must enable for this module. |
| `credit_cost` | `0` | Platform credit cost. |
| `require_credit_purchases` | `false` | Fee payable only from purchased credits. |
| `enable_purge` | `true` | Allows full deletion of module resources. |
| `public_access` | `true` | Listed in the public catalogue. |
| `require_services_gcp_module` | `true` | Fail the plan if no Services_GCP network exists. |
| `shared_users` | `[]` | Users who may see and deploy the module regardless of `public_access`. |
| `technical_support_users` | `[]` | Support contacts for the module. |
| `enable_multi_cluster_service` | `false` | Reserved for Multi-Cluster Services; creates nothing in this version. |
| `postgres_extensions` | `[]` | Extension list used with `enable_postgres_extensions` (Lab 16). |
| `mysql_plugins` | `[]` | Plugin list used with `enable_mysql_plugins` (Lab 16). |
| `resource_creator_identity` | RAD service account | Identity Terraform impersonates to create resources and probe the cluster. |
| `impersonation_service_account` | `""` | Identity for helper scripts' GCP calls (cross-project deployments). |
| `job_execution_wait_timeout` | `900` | Seconds the apply waits for the `db-create` Job. |
| `explicit_secret_values` | `{}` | Secret values supplied directly by a wrapper module. |
| `scripts_dir` | `""` | Script directory override for a wrapper; empty = this module's `scripts/`. |

## Summary

| Task / Lab | Type | Outcome |
|---|---|---|
| Task 1 — Deploy the baseline | Automated | Module deploys the sample Flask app into the shared GKE Autopilot cluster with a database, NFS, init jobs and an external IP |
| Task 2 — Access & verify | Manual | All four endpoints answer; DB, secrets, env, mounts, jobs and image confirmed from live objects |
| Lab 2 — Deployment Identity | Feature | Alert recipients, dashboard and default alerts; labels on existing resources |
| Lab 3 — Application Identity | Feature | Display name/description changed without renaming anything; version bump rebuilds the image |
| Lab 4 — Runtime & Scaling | Feature | HPA min/max honoured; container resources shown to be create-time only; VPA guard demonstrated |
| Lab 5 — Environment Variables & Secrets | Feature | Plain env, Secret Manager env via SecretSync, and automatic protection of credential-named values |
| Lab 6 — GKE Backend Config | Feature | Extra Service port, affinity, grace period and a NetworkPolicy that keeps LB, DB and Redis working |
| Lab 7 — StatefulSet / PVC | Feature | StatefulSet with an HDD PVC; persistence proven by write–restart–read |
| Lab 8 — Resource Quota | Feature | Namespace quota with surge headroom; bare-integer memory rejected |
| Lab 9 — Reliability | Feature | PDB allowing one disruption; zone/node topology spread |
| Lab 10 — Observability | Feature | Probe timings on the live pod; uptime check on the `nip.io` host; custom alert |
| Lab 11 — Workload Automation | Feature | Ordered init jobs, an on-demand CronJob run, and a sibling reached by injected URL |
| Lab 12 — CI/CD | Feature (CI/CD external) | Binary Authorization enforced cluster-wide; CI/CD and Cloud Deploy walkthrough |
| Lab 13 — NFS Storage | Feature | NFS mount moved and persistence proven; NFS shown to carry Redis |
| Lab 14 — Cloud Storage | Feature | Bucket + GCS Fuse mount written by the non-root user; CMEK on buckets |
| Lab 15 — Redis Cache | Feature | Port change and the `REDIS_URL` → `REDIS_AUTH` switch on setting a password |
| Lab 16 — Database Configuration | Feature | DB env aliases; inert name/user shown; real password rotation with reconnect |
| Lab 17 — Backup & Maintenance | Feature | Export schedule, on-demand backup, sample restore asserted on its SQL output |
| Lab 18 — Custom SQL Scripts | Feature | Ordered scripts from your bucket executed as the app user |
| Lab 19 — Access & Networking | Feature | Gateway with zero-config `nip.io` HTTPS; static IP behaviour |
| Lab 20 — Identity-Aware Proxy | Feature (external) | Anonymous requests redirected to Google sign-in; authorised users get through |
| Lab 21 — Cloud Armor & CDN | Feature | WAF attached and blocking SQLi/XSS; CDN enabled out-of-band |
| Lab 22 — VPC-SC & Audit Logging | Feature (VPC-SC external) | Project data-access audit logs on; VPC-SC perimeter outcome reported honestly |
| Task 3 — Operate | Manual | Inspect, scale, update, restart, manage secrets/jobs/storage, re-run DB setup |
| Task 4 — Observe | Manual | Container and LB logs; dashboard, alerts and uptime checks |
| Task 5 — Troubleshoot | Manual | Diagnose silent no-op deploys, pod, DB, job, scheduling, quota, Gateway and "applied but inert" issues |
| Task 6 — Tear down | Automated | Delete removes all module resources; clean up what the labs created outside the module |
