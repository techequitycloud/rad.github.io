---
title: "Hermes Agent on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Hermes Agent on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Hermes Agent on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hermes_GKE)**

## Overview

**Estimated time:** 45–60 minutes

Hermes Agent is Nous Research's self-hosted, self-improving personal AI agent —
it learns skills from experience, persists memory across sessions, and exposes an
OpenAI-compatible API plus messaging connectors from a single gateway process.
This lab takes you through the full operational lifecycle of the **Hermes on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down. Because
Hermes has **no Cloud SQL database**, deploys are noticeably faster than most
modules in this catalogue.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Hermes product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hermes_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and call the gateway's OpenAI-compatible API with
  the auto-generated bearer token.
- Reach the Hermes web dashboard through `kubectl port-forward`.
- Perform day-2 operations — update the version, rotate keys, and verify the
  agent's NFS-backed state survives a redeploy.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly, understanding what happens to the agent's
  state.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts) **with
  `create_network_filesystem = true`** — Hermes stores its entire identity on the
  shared NFS share, so the NFS server VM is **required** and must be `RUNNING`
  before you deploy:
  ```bash
  gcloud compute instances list --project="$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  ```
- A Google Cloud project with **billing enabled**.
- An **Anthropic API key** (or an OpenAI key) — the agent cannot run a turn
  without at least one model-provider key.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Hermes (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and paste your `anthropic_api_key`. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Hermes_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the single-replica gateway workload (`min=1`, `max=1`)
   into the GKE Autopilot cluster, provisions Secret Manager secrets (your
   provider key plus the auto-generated `API_SERVER_KEY` and dashboard password),
   mirrors the official `nousresearch/hermes-agent` image into Artifact Registry,
   exposes it through a LoadBalancer Service with a reserved static IP, and
   mounts the shared NFS at `/opt/data`. There is **no Cloud SQL instance, no
   database-init job, and no image build**, so first deploys typically finish in
   **10–20 minutes**.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep hermes | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   SVC_PORT=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].spec.ports[0].port}')
   echo "External endpoint: ${EXTERNAL_IP}:${SVC_PORT}"
   ```

2. The gateway's OpenAI-compatible API server authenticates every request with
   the auto-generated `API_SERVER_KEY` bearer token. Retrieve it from Secret
   Manager and call the API:

   ```bash
   API_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~hermes AND name~api-server-key" \
     --format="value(name)" --limit=1)
   KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT")

   curl -s -H "Authorization: Bearer $KEY" "http://${EXTERNAL_IP}:${SVC_PORT}/v1/models"
   curl -s -H "Authorization: Bearer $KEY" "http://${EXTERNAL_IP}:${SVC_PORT}/v1/models" | wc -c  # expect a non-zero byte count
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}:${SVC_PORT}/v1/models"  # expect 401/403
   ```

   A JSON model list confirms the gateway is up. Also confirm the response body
   is **non-empty** (the `wc -c` check) — a 200 with a zero-length body means
   the endpoint was answered by the wrong process, not the gateway.

3. Reach the **web dashboard** (API-key management, profile configuration) via
   port-forward — it runs on port 9119 behind basic auth and is deliberately not
   exposed by the Service:

   ```bash
   DASH_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~hermes AND name~dashboard-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DASH_SECRET" --project="$PROJECT"; echo

   DEPLOY=$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NS" deploy/"$DEPLOY" 9119:9119
   # In a browser: http://localhost:9119 — user `admin`, password from the secret above
   ```

   If you enabled Telegram (`enable_telegram` + bot token), message your bot —
   the connector long-polls outbound, so it works with no webhook or public
   callback URL.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pod, and the NFS mount:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl exec -n "$NS" deploy/"$DEPLOY" -- df -h /opt/data
   ```

2. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**. Because Hermes is NFS-backed, the
   foundation uses the `Recreate` strategy — the old pod stops before the new one
   starts (a brief availability gap is expected and protects the SQLite database
   from a two-writer overlap). Do **not** raise `max_instance_count` — a
   plan-time validation rejects anything above 1.

3. **Rotate keys.** Supply a new value for `api_server_key` (or
   `anthropic_api_key`) in the RAD platform and click **Update** — a new Secret
   Manager version is created and the pod restarts with it. Leaving a credential
   blank on an update preserves the stored version:

   ```bash
   gcloud secrets versions list "$API_SECRET" --project="$PROJECT"
   kubectl get secrets -n "$NS"
   ```

4. **Verify state survives a redeploy.** The agent's identity (SQLite config,
   sessions, learned skills, memories) lives at `/opt/data` on the shared NFS,
   not in the pod. After the version update in step 2, list the state directory
   from the new pod and confirm it is populated (not a fresh, empty directory):

   ```bash
   kubectl exec -n "$NS" deploy/"$DEPLOY" -- ls -la /opt/data
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$DEPLOY" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   Look for the s6-overlay init lines and the gateway/API-server startup messages.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts (expect a single steady pod — this
   module is intentionally single-replica). The uptime check is disabled by
   default (the API server requires auth), so alerting is metric-based — review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Hermes releases.

- **NFS server VM not `RUNNING` → pod stuck in `ContainerCreating`.** If the
  shared NFS VM is stopped or stocked out (`ZONE_RESOURCE_POOL_EXHAUSTED` — a
  capacity issue, not quota), the NFS volume cannot mount, or discovery finds no
  server and the module tries to create an inline NFS
  (`409 already exists` collisions). Confirm the VM first, wait for `RUNNING`,
  then re-deploy:
  ```bash
  gcloud compute instances list --project="$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  kubectl describe pod -n "$NS" <pod>    # Events show mount failures explicitly
  ```
- **Missing model-provider key → agent can't run turns.** The pod can be Ready
  (TCP probe passes) while every agent turn fails. Check the logs for provider
  authentication errors and confirm the Anthropic secret has a version:
  ```bash
  gcloud secrets versions list "$(gcloud secrets list --project="$PROJECT" \
    --filter='name~hermes AND name~anthropic' --format='value(name)' --limit=1)" \
    --project="$PROJECT"
  ```
- **Pod not Ready / rollout stuck:** inspect events and logs. The default probes
  are TCP; if someone switched them to an HTTP path on the authed API server,
  they 401 forever and the pod never becomes Ready — revert to TCP.
  ```bash
  kubectl describe pod -n "$NS" <pod>
  kubectl logs -n "$NS" <pod> --previous
  ```
- **Connector auth failures (Telegram):** a wrong or revoked bot token shows as
  repeated 401s from `api.telegram.org` in the logs. Update `telegram_bot_token`
  in the platform and redeploy; the connector long-polls, so no webhook
  registration is involved.
- **Image pull errors:** confirm the mirrored image exists in Artifact Registry
  and the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rules that `max_instance_count`
stays 1 and `enable_nfs` stays true).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform
can no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Kubernetes workload
and namespace, Secret Manager secrets, and mirrored Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, the NFS server,
registry) are managed separately and are not removed here — in particular,
**the agent's state directory on the shared NFS export is retained**, so a later
redeploy onto the same tenant reattaches to the existing agent identity.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the single-replica GKE workload, Secret Manager secrets, image mirror, LoadBalancer, and NFS mount — no Cloud SQL, no build |
| 2 — Access & verify | Manual | Authenticated `/v1/models` call succeeds with the Secret Manager bearer token; dashboard reached via port-forward 9119 |
| 3 — Operate | Manual | Update version (Recreate strategy), rotate keys, verify `/opt/data` state survives a redeploy |
| 4 — Observe | Manual | Query Cloud Logging; review the single steady pod and metrics |
| 5 — Troubleshoot | Manual | Diagnose NFS availability, provider-key, probe, connector, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes module resources; agent state on the shared NFS is retained |
