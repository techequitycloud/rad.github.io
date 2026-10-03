---
title: "Stalwart on GKE Autopilot — Lab Guide"
description: "Hands-on lab: deploy Stalwart on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Stalwart on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Stalwart_GKE)**

## Overview

**Estimated time:** 60–90 minutes

Stalwart is an open-source mail server that serves SMTP, IMAP, POP3, JMAP and
ManageSieve from a single binary. This lab takes you through the full operational
lifecycle of the **Stalwart on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Stalwart product features or on running a production mail domain. For the
complete list of provisioned services and every configuration input (organised by
group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Stalwart_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

> **What this lab can and cannot show.** It verifies that Stalwart starts against
> Cloud SQL and that the mail ports are published on the load balancer. It cannot
> show mail flowing: that needs a real domain with MX and reverse DNS, and Google
> Cloud blocks **outbound** port 25 from every VM and pod, so sending to other
> domains requires a smart-host relay on 587.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and verify the workload and its seven published ports.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP** (provides the VPC, GKE Autopilot cluster, Cloud SQL for MySQL,
  Artifact Registry, and shared service accounts this module depends on). You do
  not need to deploy this yourself first — the platform automatically detects
  whether it already exists in the target project and provisions it before this
  module if not (see Task 1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which needs a credit balance that covers the update's estimated build cost (updates never carry a module fee). On a lab environment only an administrator can use Advanced mode.
- **RAD platform access** with permission to deploy modules into the project.
- **`openssl`** and **`nc`** (netcat) on your workstation, for the port checks in Task 2.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. **(Recommended) Create the administrator secret first.** Stalwart's bootstrap
   administrator is read from `STALWART_RECOVERY_ADMIN` as `username:password`.
   Without it, Stalwart prints a random password to the container log once.

   ```bash
   printf 'admin:%s' "$(openssl rand -base64 24)" | \
     gcloud secrets create stalwart-recovery-admin --data-file=- --project="$PROJECT"
   ```

   You will map this secret into the deployment in step 2 (the input is in the
   *Environment Variables & Secrets* group; if it is not on the create form, add
   it afterwards with **Update** in advanced mode).

2. Open **Solutions → Solution Catalog → RAD modules** in the RAD platform top navigation, open **Stalwart (GKE)** from the **Platform Modules** list to start configuration, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Stalwart_GKE)
   documents every input by group, with defaults. Recommended for this module:
   `secret_environment_variables = { STALWART_RECOVERY_ADMIN = "stalwart-recovery-admin" }`,
   `max_instance_count = 1` and `application_display_name = "Stalwart Mail Server"`.
   Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

3. The platform builds the wrapper image, reserves a regional static IP, creates
   the Stalwart database and user in Cloud SQL (MySQL 8.0) with its password secret,
   and deploys a single-replica StatefulSet with a 10 GiB PVC at
   `/var/lib/stalwart`, behind a `LoadBalancer` Service that publishes 443, 25,
   465, 587, 993, 995 and 4190. There is no application init job — Stalwart creates
   its own tables on first connect. First deploys take roughly **20–35 minutes**.

4. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep stalwart | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running, and read the startup lines the entrypoint writes —
   they name the DataStore target and say whether an administrator was supplied:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pod -n "$NS" "$POD"
   kubectl logs -n "$NS" "$POD" | grep '\[startup\]'
   # [startup] DataStore=MySql 10.x.x.x:3306/... as ... (password via env DB_PASSWORD, not in the file)
   # [startup] recovery_admin=<set>
   ```

   If you did not set `STALWART_RECOVERY_ADMIN`, the random administrator password
   is printed in this log on the first start — copy it now.

2. Check health from inside the pod. Port 443 must answer; port 8080 answering
   means Stalwart is still on its bootstrap/recovery surface (expected until the
   server configuration is applied — see step 4):

   ```bash
   kubectl exec -n "$NS" "$POD" -- curl -sk -o /dev/null -w '443:  %{http_code}\n' https://127.0.0.1:443/healthz/live
   kubectl exec -n "$NS" "$POD" -- curl -s  -o /dev/null -w '8080: %{http_code}\n' http://127.0.0.1:8080/healthz/live
   ```

3. Find the external IP and confirm every published port:

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   kubectl get svc -n "$NS" -o jsonpath='{range .items[*].spec.ports[*]}{.name}{"\t"}{.port}{"\n"}{end}'

   for p in 25 443 465 587 993 995 4190; do nc -z -w 3 "$EXTERNAL_IP" "$p" && echo "$p open" || echo "$p closed"; done

   # ManageSieve answers in plain text with Stalwart's own banner:
   nc -w 3 "$EXTERNAL_IP" 4190 | head -3
   ```

   Port 25 may show as closed **from your workstation** if your own network blocks
   outbound 25 — that is a client-side restriction, not the deployment.

4. **Know the current state.** The module configures only Stalwart's DataStore.
   Domains, listeners and TLS are stored in the database and are applied with
   `stalwart-cli` (a separate image, `ghcr.io/stalwartlabs/cli`) against a real mail
   domain — the module does not do this. Until it is done, port 8080 stays open in
   the pod, and HTTPS connections to `$EXTERNAL_IP` from outside the VPC may be
   closed without a certificate even though the in-pod check on 443 returns 200.
   That is the expected state of a fresh deployment, not a fault.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, PVC, and (only if
   `max_instance_count > 1`) the autoscaler and disruption budget:

   ```bash
   kubectl get statefulset,pods,pvc,hpa,pdb -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Keep it to one replica.** If `hpa` appears above, set `max_instance_count = 1`
   via **Update** on the deployment details page — a second replica needs Stalwart's
   Redis-backed coordinator, which this module does not configure. Scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply).

3. **Update the application version** by changing `application_version` to another
   exact Stalwart release (e.g. `v0.16.x`) via **Update**; a new image builds and the
   StatefulSet rolls the pod. If you rebuild under the **same** tag, roll the pod
   yourself so the new image is pulled:

   ```bash
   kubectl rollout restart statefulset -n "$NS" "$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')"
   ```

4. **Confirm the static IP** that MX and DNS records should point at:

   ```bash
   gcloud compute addresses list --project="$PROJECT" --filter="name~stalwart" \
     --format="table(name,address,region,status)"
   ```

5. **Manage secrets, storage and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~stalwart"
   kubectl get secrets,jobs,cronjobs -n "$NS"     # db-create, backup CronJob
   ```

6. **Open a database session** for inspection (Stalwart owns its tables — look,
   don't change):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   # Role and database are tenant-prefixed (e.g. stalwartdemo426161cf) — not the bare app name.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^stalwart" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — Stalwart logs to stdout (file logging is not enabled), so everything
   is in `kubectl logs` and Cloud Logging:

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and PVC usage. The module's uptime check is
   disabled by default (it would probe plain HTTP against Stalwart's HTTPS-only
   443); review Alerting → Policies for any policies you configured.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Stalwart releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" "$POD"          # Events: scheduling, probe, PVC mount errors
  kubectl logs -n "$NS" "$POD" --previous       # logs from the crashed container
  ```
  A `FATAL: DB_IP is empty or unset` (or `DB_NAME` / `DB_USER` / `DB_PASSWORD`)
  line means the foundation did not inject the database settings — the entrypoint
  refuses to start rather than fall back to the 8080 bootstrap surface.
- **Startup probe keeps failing:** the probe is TCP on 443, which binds only when
  Stalwart starts normally. Check the log for a DataStore connection error and
  confirm the Cloud SQL instance is `RUNNABLE`. Do **not** "fix" it by pointing the
  probe at 8080 — that port answers precisely when Stalwart failed to start.
- **Pod is Ready but port 8080 still answers:** the DataStore is connected but no
  server configuration (domains, listeners, TLS) has been applied — see Task 2,
  step 4. No probe can detect this; it is an operator check.
- **Database connection errors after changing `database_password_length`:** the
  new password reached Secret Manager but not the Cloud SQL user. Avoid changing it
  on a running deployment.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the project has a free regional external IP
  for the reserved address.
- **Outbound mail never arrives elsewhere:** Google Cloud blocks outbound port 25.
  Configure Stalwart to relay through a smart host on 587.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). Delete removes everything the module created — the Kubernetes workload,
Service and namespace, the reserved static IP, the Stalwart database and user,
the database password secret, GCS buckets, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL instance,
registry) are managed separately and are not removed here. The
`stalwart-recovery-admin` secret you created by hand in Task 1 is not managed by
the module — delete it yourself:

```bash
gcloud secrets delete stalwart-recovery-admin --project="$PROJECT"
```

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Wrapper image, static IP, Cloud SQL (MySQL 8.0) database, single-replica StatefulSet with PVC, LoadBalancer with 443 + six mail ports |
| 2 — Access & verify | Manual | Startup log shows the DataStore; 443 healthy in-pod; all seven ports reachable; ManageSieve banner; 8080 state understood |
| 3 — Operate | Manual | Inspect workload, hold one replica, update version, confirm static IP, manage secrets/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review GKE metrics and alert policies |
| 5 — Troubleshoot | Manual | Diagnose crash, probe, bootstrap-state, database, IP and outbound-mail issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources; remove the hand-made admin secret |
