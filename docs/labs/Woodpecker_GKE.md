---
title: "Woodpecker CI on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Woodpecker CI on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Woodpecker CI on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Woodpecker_GKE)**

## Overview

**Estimated time:** 45–75 minutes

Woodpecker CI is a lightweight, container-native CI/CD engine — a simpler,
self-hostable alternative to Drone. Pipelines are defined as YAML files, and
each pipeline step runs in its own container. This module co-locates the
Woodpecker server and agent in a single GKE Autopilot pod, with the agent
dynamically creating a Kubernetes Pod for every pipeline step via a
namespace-scoped RBAC `Role` this module provisions. This lab takes you
through the full operational lifecycle of the **Woodpecker CI on GKE
Autopilot** module: deploy it, connect a real Gitea/Forgejo forge and run an
actual pipeline, operate it day-to-day, observe it, diagnose common
problems, and tear it down.

**There is no Cloud Run variant of this module and there never will be.**
Woodpecker's execution backend (`WOODPECKER_BACKEND=kubernetes`) needs real
Kubernetes API access to dynamically create a pod for each pipeline step —
Cloud Run has no Kubernetes API to call and no privilege for
docker-in-docker. This is a permanent architectural decision, the same class
as this catalogue's other Common+GKE-only modules (Kopia, RocketChat,
Immich, Temporal, Prowlarr, VictoriaMetrics, Plausible, LobeChat, Supabase).

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Woodpecker's own pipeline-authoring features beyond what's
needed to prove the deployment works end to end. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Woodpecker_GKE)
— this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions.
- Understand why the server refuses to boot without a forge configured, and
  register a real Gitea/Forgejo OAuth application to make the deployment
  actually usable for CI.
- Trigger a real pipeline and watch the agent dynamically create a
  Kubernetes Pod to run it.
- Perform day-2 operations — inspect the co-located server+agent pod, the
  RBAC grant, and pipeline pod activity.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and connection issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL capability, Artifact Registry, and shared
  service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **A reachable Gitea or Forgejo instance** to register Woodpecker against —
  this catalogue's own `Forgejo_GKE` module works. Without one, the
  deployment boots but pipelines cannot trigger (see Task 2).
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the
  project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Woodpecker
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. The module deploys cleanly with
   defaults — including placeholder forge credentials — so a first-pass
   deploy needs no changes beyond `project_id`/`tenant_deployment_id`.
   **If you already have a real Gitea/Forgejo OAuth application ready**, set
   `forge_url`/`forge_client_id`/`forge_client_secret` now to skip the
   Update round-trip in Task 2. Configure anything else you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Woodpecker_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the
   deployment status page with real-time logs.

2. The platform builds a custom container image (the official Woodpecker
   server image with the agent binary grafted on, plus a static busybox
   shell), generates one secret (`WOODPECKER_AGENT_SECRET`) in Secret
   Manager, provisions a Cloud SQL PostgreSQL 15 database via the `db-init`
   job, provisions a namespace-scoped RBAC `Role`/`RoleBinding` for the
   agent's Kubernetes execution backend, and deploys the co-located
   server+agent pod. First-deploy time is typically **10–15 minutes**,
   dominated by the image build and Cloud SQL provisioning.

3. Connect to the cluster and discover the namespace with a name-agnostic
   filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep woodpecker | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running and check its health:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl get pods -n "$NS"                 # expect 1/1 Running

   # /healthz is unauthenticated and returns 204 — confirmed live
   kubectl exec -n "$NS" "$POD" -- wget -qO- --server-response http://localhost:8000/healthz 2>&1 | head -5
   ```

2. Find the Service's reachable address. If quota forced `service_type =
   "ClusterIP"` at deploy time (see the Configuration Guide's §6 — a
   deployment-time choice made on the reference deployment, not a module
   default), there is no external IP; use an in-cluster check or a
   port-forward instead:

   ```bash
   kubectl get svc -n "$NS"

   # If LoadBalancer:
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"

   # If ClusterIP (no external IP), port-forward to reach the UI locally:
   kubectl port-forward -n "$NS" svc/<service-name> 8000:80
   # then browse http://localhost:8000
   ```

3. **Confirm the forge-boot requirement.** Check the pod logs for the
   forge configuration line — with placeholder values still in place, the
   server is up but not functional for real forge login:

   ```bash
   kubectl logs -n "$NS" "$POD" | grep -i gitea
   ```

   If you deployed with the placeholder `forge_url`/`forge_client_id`/
   `forge_client_secret` (the module default), the web UI loads but forge
   login and pipeline triggers do not work — this is expected, not a bug.
   **This is the #1 post-deploy step**: register a real OAuth application.

4. **Register a real Gitea/Forgejo OAuth application.** On your
   Gitea/Forgejo instance (e.g. this catalogue's `Forgejo_GKE`), go to
   **Settings → Applications → Manage OAuth2 Applications**, create a new
   application with redirect URI `<woodpecker-url>/authorize`, and note the
   generated client ID and secret.

5. **Update the deployment** with the real forge values via the RAD
   platform's **Update** flow (`forge_url`, `forge_client_id`,
   `forge_client_secret`, and optionally `admin_username` to match your
   forge account). Confirm the values landed:

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50 | grep -i gitea
   ```

6. Open the Woodpecker web UI and log in via your forge's OAuth flow. Enable
   a repository from the UI's repo list, then push a commit (or trigger
   manually from the UI) containing a minimal `.woodpecker.yml`:

   ```yaml
   steps:
     - name: hello
       image: alpine
       commands:
         - echo "hello from the Woodpecker GKE lab"
   ```

7. **Watch the agent dynamically create a pipeline pod** — this proves the
   RBAC grant and the co-located agent actually work end to end, not just
   that the server booted:

   ```bash
   kubectl get pods -n "$NS" -w
   ```

   You should see a short-lived pod appear (named after the pipeline step),
   run, and be deleted by the agent once the step completes. Confirm the
   pipeline's result in the Woodpecker web UI.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the co-located workload:**

   ```bash
   kubectl get deployment,pods,svc -n "$NS"
   kubectl describe deployment -n "$NS"
   kubectl logs -n "$NS" "$POD" --tail=100     # server + agent share one log stream
   ```

2. **Inspect the agent's RBAC grant:**

   ```bash
   kubectl get role,rolebinding -n "$NS"
   kubectl describe role <resource-prefix> -n "$NS"
   kubectl describe rolebinding <resource-prefix> -n "$NS"
   ```

   Confirm the `RoleBinding` subject matches the pod's actual
   ServiceAccount:

   ```bash
   kubectl get deployment -n "$NS" -o jsonpath='{.items[0].spec.template.spec.serviceAccountName}'
   ```

3. **Update the application version** by changing `application_version` in
   the RAD platform and applying it via **Update**. A new image builds
   (server + agent + busybox re-grafted), the pod is recreated, and the
   `db-init` job's idempotent logic is safe to re-run if it fires again.

4. **Do not scale beyond one instance.** `max_instance_count` is hard-capped
   at `1` by a plan-time validation — each pod runs a co-located
   server+agent, and Woodpecker's server has no documented/verified
   multi-instance coordination for its own database-backed state. Attempting
   to raise it fails the plan, not the apply.

5. **Retrieve the agent secret** if you ever need to manually verify the
   server↔agent gRPC connection:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~agent-secret"
   gcloud secrets versions access latest --project="$PROJECT" \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~agent-secret" --format='value(name)')"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — server and agent share one container's stdout, so a single
   `kubectl logs` shows both:

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=100 -f
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE Workloads dashboard and review pod CPU and
   memory utilisation. A burst of short-lived pipeline pods during an active
   build is expected and normal — the agent creates and deletes one per
   pipeline step. `uptime_check_config` is **disabled by default**; if
   enabled, it targets `/healthz`.

3. **Pipeline pod activity** — a live view of what the agent is doing right
   now:

   ```bash
   kubectl get pods -n "$NS" --watch
   ```

---

## Task 5 — Troubleshoot & debug [Manual]

- **Server boots but the UI shows no login option / OAuth errors:** almost
  always placeholder forge credentials still in place. Check:
  ```bash
  kubectl logs -n "$NS" "$POD" | grep -i gitea
  ```
  and confirm `WOODPECKER_GITEA_URL` points at a real, reachable
  Gitea/Forgejo instance with a real registered OAuth application — see
  Task 2.

- **Pod in `CrashLoopBackOff` with no forge configured at all:** expected
  and by design — confirmed live, Woodpecker's server exits fatally
  ("forge not configured") if every forge variable is unset. This module's
  placeholder defaults avoid this specific failure mode; if you overrode
  them to empty strings, restore at least the placeholder values or real
  ones.
  ```bash
  kubectl logs -n "$NS" "$POD" --previous
  ```

- **Pipelines never trigger even with a real forge configured:** confirm
  the registered OAuth application's redirect URI matches the deployment's
  actual reachable URL, and that `service_type` is `LoadBalancer` (not
  `ClusterIP`) if the forge needs to reach this server over the public
  internet for webhook delivery — see the next item.

- **No external IP / forge webhooks can't reach the server:** check
  `service_type`:
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
  If it's `ClusterIP`, this was very likely a deliberate quota-driven
  choice at deploy time (the reference deployment hit exhausted
  `IN_USE_ADDRESSES` quota), not the module default (`LoadBalancer`). Flip
  it back once quota allows — see the Configuration Guide §6.

- **Pipeline triggered from the UI, but no pod ever appears:** check the
  agent's RBAC grant — a missing or misconfigured `Role`/`RoleBinding` is
  the most likely cause on GKE, since the Kubernetes API call to create the
  pipeline pod would be rejected:
  ```bash
  kubectl get role,rolebinding -n "$NS"
  kubectl logs -n "$NS" "$POD" | grep -i -E "forbidden|rbac|permission"
  ```
  Also confirm the `RoleBinding` subject's ServiceAccount name matches the
  pod's actual `serviceAccountName` (see Task 3, step 2) — a mismatch here
  silently breaks the agent's pod-creation calls.

- **Startup/liveness probe failures on an otherwise-healthy-looking pod:**
  probes target `GET /healthz`. Confirm it's actually reachable and
  unauthenticated from inside the pod:
  ```bash
  kubectl exec -n "$NS" "$POD" -- wget -qO- --server-response http://localhost:8000/healthz
  ```

- **Image pull errors:** confirm the image exists in Artifact Registry
  (`enable_image_mirroring = true` mirrors the built image there) and the
  node service account can pull it.

- **Trying to deploy Woodpecker on Cloud Run instead:** don't — there is no
  `Woodpecker_CloudRun` module, and there will not be one. Woodpecker's
  Kubernetes execution backend needs real in-cluster API access that Cloud
  Run cannot provide, no matter the configuration. Use `Woodpecker_GKE`.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the placeholder-forge trap, the
quota-driven `ClusterIP` deviation, and two stale variable defaults left
over from this module's clone source).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash**
icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes workload, namespace, RBAC `Role`/`RoleBinding`, the Cloud SQL
database, and the `WOODPECKER_AGENT_SECRET` Secret Manager secret. Resources
owned by **Services_GCP** (the VPC, GKE cluster, registry) are managed
separately and are not removed here.

> **Before tearing down**, note that pipeline history and configured
> repositories/secrets live entirely in the Cloud SQL database this module
> provisions — deleting the deployment deletes that database along with
> everything else, with no separate export step built into this module.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the co-located image, generates the agent secret, provisions Cloud SQL + the `db-init` job, and deploys the RBAC-backed pod |
| 2 — Access & verify | Manual | Confirm `/healthz`; register a real Gitea/Forgejo OAuth application; trigger a real pipeline and watch the agent create a pod for it |
| 3 — Operate | Manual | Inspect the co-located pod and its RBAC grant, update the version, understand the `max=1` scaling limit |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; watch live pipeline pod activity |
| 5 — Troubleshoot | Manual | Diagnose forge-boot, RBAC, exposure, and probe issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the Cloud SQL database and the agent secret |
