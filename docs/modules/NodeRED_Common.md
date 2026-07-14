---
title: "NodeRED Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the NodeRED module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# NodeRED Common — Shared Application Configuration

`NodeRED_Common` is the **shared application layer** for Node-RED. It is not
deployed on its own; instead it supplies the Node-RED-specific configuration
that both [NodeRED_GKE](NodeRED_GKE.md) and [NodeRED_CloudRun](NodeRED_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI inputs
of its own — but understanding what it provides explains the defaults you see
in the platform docs.

For the infrastructure that actually provisions and runs Node-RED, see the
platform guides ([NodeRED_GKE](NodeRED_GKE.md),
[NodeRED_CloudRun](NodeRED_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by NodeRED_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official `nodered/node-red` image from Docker Hub | `container_image` output of the platform deployment |
| Port binding | Sets `container_port = 1880` — Node-RED's native HTTP port | Service/revision configuration |
| Safe-mode guard | Always injects `NODE_RED_ENABLE_SAFE_MODE = "false"` | Environment variables in the platform deployment |
| Database setting | Hardcodes `database_type = "NONE"` — no Cloud SQL instance | §Database in the platform guides |
| No Cloud SQL proxy | Sets `enable_cloudsql_volume = false` | Sidecar configuration |
| Object storage | Declares a **Cloud Storage** bucket (suffix `storage`) | `storage_buckets` output |
| Health checks | Supplies HTTP GET `/` startup and liveness probe defaults | §Observability in the platform guides |
| No initialization jobs | Empty `initialization_jobs` by default — no schema or seeding required | `initialization_jobs` output |

**Key distinction from database-backed Common modules.** Unlike modules such
as Mautic or WordPress, `NodeRED_Common` creates no GCP resources and no
Secret Manager secrets. The only credential this application uses —
`NODE_RED_CREDENTIAL_SECRET` — is generated and managed entirely by the
foundation (`App_CloudRun` or `App_GKE`) via the `database_password_length`
variable, not by this layer.

---

## 2. Flow credential encryption

`NODE_RED_CREDENTIAL_SECRET` is a randomly generated secret that Node-RED uses
to encrypt all credentials stored in its `flows_cred.json` file (API keys,
passwords, tokens inside flows). The foundation generates this secret
automatically using `database_password_length` (default 32 characters) and
injects it at runtime from Secret Manager.

Retrieve it after deployment:

```bash
# The secret name follows the deployment's resource prefix:
gcloud secrets list --project "$PROJECT" --filter="name~credential"
gcloud secrets versions access latest --secret=<credential-secret> --project "$PROJECT"
```

**Important:** Changing or rotating this secret after flows are deployed
renders all stored flow credentials permanently unreadable. Do not enable
`enable_auto_password_rotation` unless you have a procedure for re-encrypting
credentials after each rotation.

---

## 3. Container image and port

Node-RED uses the official `nodered/node-red` image published on Docker Hub.
No custom Dockerfile is bundled with this module. The image tag is controlled
by `application_version` in the wrapper module (default `"latest"`; pin to a
specific version such as `"4.0.9"` for reproducible deployments):

```
nodered/node-red:<application_version>
```

Image mirroring into Artifact Registry is enabled by default
(`enable_image_mirroring = true` in the wrapper), which copies the image from
Docker Hub into the project's Artifact Registry repository to avoid rate
limits. Node-RED listens on port `1880`.

---

## 4. Persistent flow storage

All Node-RED state — the flow definition (`flows.json`), the encrypted
credential file (`flows_cred.json`), installed palette nodes, and the settings
file — lives in the `/data` directory. `NodeRED_Common` itself declares no NFS
variables; it is the platform variants — [NodeRED_CloudRun](NodeRED_CloudRun.md)
and [NodeRED_GKE](NodeRED_GKE.md) — that default `enable_nfs = true` and
`nfs_mount_path = "/data"`, so the Filestore NFS share is mounted exactly
there out of the box.

Without NFS (or a StatefulSet PVC), every container restart or redeploy starts
Node-RED with an empty `/data` directory and all flows, credentials, and
installed nodes are lost.

Explore the NFS mount after deployment:

```bash
# GKE:
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep nfs

# Cloud Run (NFS details in service spec):
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.volumes)'
```

---

## 5. Core application settings

`NodeRED_Common` establishes the baseline Node-RED environment:

- **Safe mode guard.** `NODE_RED_ENABLE_SAFE_MODE = "false"` is always
  injected and merged with any caller-supplied `environment_variables` (caller
  values take precedence). This ensures flows execute on every startup. Set it
  to `"true"` via `environment_variables` to start Node-RED with flows
  disabled for debugging a faulty flow.
- **No database.** `database_type = "NONE"` is hardcoded; no Cloud SQL
  instance is provisioned and no Cloud SQL Auth Proxy sidecar is injected.
- **No initialization jobs.** Unlike database-backed applications, Node-RED
  requires no schema initialization, user creation, or data seeding. The
  `initialization_jobs` list defaults to empty; pass custom jobs only for
  specific tasks such as importing a flow archive or pre-installing palette
  nodes.

---

## 6. Health probe behaviour

Both startup and liveness probes use HTTP GET against the root path `/`, which
returns the Node-RED editor UI once the application is fully started. A
30-second initial delay is sufficient because Node-RED starts quickly without
any database migration or long bootstrap step.

- **Startup probe:** HTTP GET `/`, 30s initial delay, 10s period, 3 failure threshold.
- **Liveness probe:** HTTP GET `/`, 30s initial delay, 30s period, 3 failure threshold.

These defaults apply identically to both the GKE and Cloud Run variants.
Unlike applications such as Mautic (where Cloud Run health traffic triggers
redirects), Node-RED serves a 200 response on `/` over plain HTTP, so no
TCP-probe workaround is needed.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (suffix `storage`) is declared here and
provisioned by the foundation, which also grants the workload service account
access. This bucket is intended for flow exports, backup archives, and other
Node-RED application data. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~nodered"
```

---

For the Node-RED-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[NodeRED_GKE](NodeRED_GKE.md)** and
**[NodeRED_CloudRun](NodeRED_CloudRun.md)**.
