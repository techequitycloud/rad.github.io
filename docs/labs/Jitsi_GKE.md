---
title: "Jitsi on GKE Autopilot — Lab Guide"
description: "Hands-on lab: deploy Jitsi on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Jitsi on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Jitsi_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Jitsi Meet is open-source, browser-based video conferencing. This lab takes you
through the full operational lifecycle of the **Jitsi on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Jitsi product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Jitsi_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

Jitsi differs from most modules in two ways that shape every task below: it runs as
**four** workloads (web, prosody, jicofo and the jvb videobridge), and all audio and
video travel over **UDP port 10000** to a dedicated load balancer on a reserved IP.
There is no database.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and verify all four Jitsi components.
- Confirm the videobridge is advertising its public address on UDP 10000.
- Perform day-2 operations — inspect, scale the web tier, update the release, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP** (provides the VPC, GKE Autopilot cluster, NFS server and shared
  service accounts this module depends on). You do not need to deploy this yourself
  first — the platform automatically detects whether it already exists in the target
  project and provisions it before this module if not (see Task 1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which needs a credit balance that covers the update's estimated build cost (updates never carry a module fee). On a lab environment only an administrator can use Advanced mode.
- **RAD platform access** with permission to deploy modules into the project.
- A network that allows **outbound UDP to port 10000** for the browsers you test with. Some corporate networks block it; Jitsi has no TCP fallback in this build.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Open **Solutions → Solution Catalog → RAD modules** in the RAD platform top navigation, open **Jitsi (GKE)** from the **Platform Modules** list to start configuration, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Jitsi_GKE)
   documents every input by group, with defaults. If you already own the domain users
   will browse to, set `public_url` (for example `https://meet.example.com`) and
   `application_domains` now. Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

2. The platform reserves a regional static IP for the videobridge, generates the two
   internal XMPP passwords into Secret Manager, deploys the four workloads into the
   GKE Autopilot cluster, and publishes the web front end through a Gateway. No
   container image is built and no database is created.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep jitsi | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm all four components are running — the web workload plus three
   Deployments whose names end in `-prosody`, `-jicofo` and `-jvb`:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl get svc -n "$NS"     # web, prosody and jicofo are ClusterIP; jvb is LoadBalancer (UDP)
   ```

2. Find the videobridge's public address and confirm it carries UDP 10000:

   ```bash
   JVB_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "jvb IP: $JVB_IP"
   kubectl get svc -n "$NS" -o wide | grep -i udp
   gcloud compute addresses list --project="$PROJECT" --filter="name~jvb"
   ```

   The address in the Service should match the reserved `*-jvb` address.

3. Confirm the back end is wired together — jicofo has authenticated to prosody and
   found the bridge, and jvb is advertising the public address:

   ```bash
   kubectl logs -n "$NS" deploy/$(kubectl get deploy -n "$NS" -o name | grep jicofo | cut -d/ -f2) \
     | grep -E "authenticated|addJvbAddress"
   kubectl logs -n "$NS" deploy/$(kubectl get deploy -n "$NS" -o name | grep jvb | cut -d/ -f2) \
     | grep StaticMapping      # expect ... mask=<the jvb IP>:9/udp
   ```

4. Find the web URL. On the deployment's page in the RAD platform, read the
   `service_url` output; it is the Gateway's `nip.io` URL unless you set a custom
   domain. Check it serves the Jitsi page:

   ```bash
   SERVICE_URL="<service_url from the deployment outputs>"
   curl -s "$SERVICE_URL/" | grep -o "<title>[^<]*</title>"   # expect <title>Jitsi Meet</title>
   ```

5. Open the URL in a browser over **HTTPS** (browsers only allow camera and
   microphone on secure origins), create a room, and join it from a second device or
   browser on a different network. If both participants appear but neither sees nor
   hears the other, UDP 10000 to the jvb IP is not getting through — see Task 5.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workloads** — deployments, pods and (if more than one web replica
   is allowed) the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale the web tier** by changing the min/max instance inputs and clicking
   **Update** on the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual edit
   would be reverted on the next apply). prosody, jicofo and jvb always run one
   replica each; these inputs do not add videobridge capacity.

3. **Update the Jitsi release** by changing `application_version` via **Update**. All
   four images move to the new tag together, so choose a `stable-NNNN` that is
   published for web, prosody, jicofo and jvb.

4. **Manage secrets:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~jitsi"   # *-jicofo-auth, *-jvb-auth
   ```

   These are machine credentials shared by prosody and the components that register
   with it. Do not edit them by hand: prosody and the components must see the same
   values.

5. **Change who can create rooms** with `enable_auth` and `enable_guests` via
   **Update**.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   for d in $(kubectl get deploy -n "$NS" -o name); do
     echo "== $d"; kubectl logs -n "$NS" "$d" --tail=20
   done
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation and restart counts, paying most attention to the jvb pod, which
   carries all media. The module also provisions an **uptime check** (when enabled);
   review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Jitsi releases.

- **Participants join but there is no audio or video:** this is the signature of
  both failures below. First confirm the jvb Service has an external IP and that
  `StaticMapping` in its log shows that IP. Then check the client network allows
  outbound UDP to port 10000 — there is no TCP fallback.
- **jvb or jicofo refused by prosody:** look for authentication errors in the prosody,
  jicofo and jvb logs. The two component passwords come from the same Secret Manager
  secrets; if they have been changed by hand, they no longer match.
- **Page loads but cannot connect:** check `public_url` matches the URL in the
  browser's address bar.
- **jvb Service stuck in `<pending>`:** check the project's external IP address
  quota (`IN_USE_ADDRESSES`) — leaving `service_type` at `ClusterIP` avoids spending
  an extra address on the web Service.
- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/pull errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Image pull errors:** confirm the `application_version` tag exists for all four
  `jitsi/*` images.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). Delete removes everything the module created — the four Kubernetes workloads and their
Services, the namespace, the jvb static IP, the Secret Manager secrets and the GCS
bucket. Resources owned by **Services_GCP** (the VPC, GKE cluster, NFS server) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys web, prosody, jicofo and jvb, reserves the jvb IP and creates the component secrets |
| 2 — Access & verify | Manual | All four components running; jvb advertises its public IP on UDP 10000; web serves Jitsi Meet |
| 3 — Operate | Manual | Inspect workloads, scale the web tier, update the release, manage secrets and room policy |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose no-media calls, component authentication, URL, quota, pod and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
