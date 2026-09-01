---
title: "DataAnalyst Common — Shared Application Configuration"
description: "Shared configuration reference for the Data Analyst Agent module — application-layer settings consumed by the Cloud Run deployment."
---

# DataAnalyst Common — Shared Application Configuration

`DataAnalyst_Common` is the **shared application layer** for the Data Analyst Agent. It is
not deployed on its own; instead it supplies the agent-specific configuration that
[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md) builds on. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform guide.

For the infrastructure that actually provisions and runs the agent, see
[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md) and the foundation guide
[App_CloudRun](App_CloudRun.md).

---

## 1. What this layer provides

| Area | Provided by DataAnalyst_Common | Where it surfaces |
|---|---|---|
| No credential of any kind | Declares no Secret Manager secret — Vertex AI auth is the Cloud Run service's own runtime service account | No secret appears in the deployment at all |
| No database, no bucket | Sets `database_type = NONE` and provisions no GCS bucket | No Cloud SQL instance, init job, or bucket appears in the deployment |
| Container image | Builds a custom image (Python, FastAPI + Google ADK) from the `Dockerfile` in `scripts/` | `container_image` output of the platform deployment |
| Sandboxed code execution | Hosts the ADK agent, its tools (`list_uploaded_files`, `inspect_file`, `execute_code`), and the sandbox-launcher execution wrapper | Application behaviour in the platform guide |
| Ephemeral upload storage | Every uploaded file lives under `UPLOAD_ROOT/<session_id>/` in container-local storage only | Never appears in any durable Google Cloud resource |
| Health checks | Supplies HTTP probes targeting `GET /_health` — deliberately not `/healthz` | §Observability in the platform guide |

---

## 2. A history worth knowing: this module was re-purposed

`DataAnalyst_CloudRun`/`DataAnalyst_Common` began as a reference-catalogue chat advisor that
cloned this repository's own private module catalogue to help a user configure a *different*
deployment via natural language. That design was retired in favour of the current, more
general sandboxed data-analysis agent — a better fit for Cloud Run's sandbox launcher, whose
real value is isolating **arbitrary code execution**, not read-only file search. Two
consequences that explain choices you'll see elsewhere in these docs:

- **No GCS bucket, no Secret Manager secret, no git-clone step remain.** The previous design
  needed all three (a repo-cache bucket, a GitHub PAT, a runtime `git clone`); none of that
  applies to a module whose only "data" is whatever a user uploads.
- **`public_access` defaults to `true`.** The previous design defaulted it `false`, because a
  self-serve deploy into a project the *end user* administers would have made the cached,
  cloned catalogue trivially readable via that user's own GCP IAM — a real, confirmed finding
  during that design's review. That confidentiality concern does not apply to a general
  data-analysis tool with no proprietary source material to protect.

---

## 3. Container image and build

`DataAnalyst_Common` always triggers a custom image build (`image_source = "custom"`). The
Dockerfile installs `pandas`, `numpy`, `openpyxl` (Excel support), and `matplotlib` (Agg
backend, for charts) alongside FastAPI and the Google ADK.

matplotlib builds a font cache on first import. Because the sandbox launcher's writes are an
isolated memory overlay discarded after each call, that cache could never persist from one
`execute_code` call to speed up the next — so the Dockerfile **pre-builds it at image-build
time** at a fixed path (`MPLCONFIGDIR=/opt/mplcache`), and the `execute_code` preamble pins
`MPLCONFIGDIR` to that same path explicitly before generated code ever imports matplotlib —
deliberately not relying on `$HOME` or other environment variables that may not survive into
the sandbox any more than `PATH` does (see §4).

```
ARG DATA_ANALYST_VERSION=1.0.0
FROM python:3.11-slim@sha256:...   # digest-pinned for build reproducibility
# ca-certificates (TLS trust for Vertex AI), then requirements.txt,
# then the matplotlib font-cache pre-build, then the agent/frontend code.
```

---

## 4. The sandboxed execution model

Every tool that touches file content or executes code runs through
`sandbox_exec.run_isolated`, which invokes Cloud Run's `--sandbox-launcher` binary
(`/usr/local/gcp/bin/sandbox do -- <command>`) when present, or the command directly outside
Cloud Run (local development).

Confirmed security properties (from Google's own sandbox documentation, not just assumed):

- **Network egress is deny-by-default** — no call here ever requests `--allow-egress`, so
  sandboxed code has zero network access regardless of what it tries.
- **Writes land in an isolated memory overlay, discarded after the call** — nothing a script
  writes (including an attempt to modify an uploaded file, or save a chart to disk) persists.
- **The sandboxed process cannot read this service's own environment variables or reach the
  metadata server** — moot for credentials here (there are none to protect), but this
  extends further than expected: **`PATH` is an environment variable too**, so a bare command
  name (`python3`, `head`) cannot be resolved by `exec()` inside the sandbox at all. Confirmed
  live: every call failed with `error finding executable "python3" in PATH []` until
  `run_isolated` was fixed to resolve every command to an absolute path (via `shutil.which()`,
  in the *calling* process, which has a normal `PATH`) before it ever reaches the sandbox.

**What this boundary does NOT cover:** isolation between different chat sessions
concurrently warm on the *same* instance. Session directories are named with an unguessable
UUID, but the sandboxed process still sees the same container filesystem the main process
does — the sandbox restricts network/write/environment access, not which files on disk are
readable. Set `max_concurrent_requests = 1` on the platform module if this matters for your
data.

Each `execute_code` run additionally prepends a resource-limiting preamble
(`resource.setrlimit` on `RLIMIT_AS` and `RLIMIT_CPU`) before the generated code executes,
bounded by `execute_code_memory_limit_mb` and the call's own timeout — confirmed enforced on
the Linux containers this module deploys to (not portable to every platform: `setrlimit` on
`RLIMIT_AS` is silently rejected on macOS, which only affects local development/testing).

---

## 5. Upload handling and chart delivery

- **Uploads.** `POST /upload` validates the file extension and streams the body, rejecting
  once the configured size cap is exceeded — checked as bytes arrive, never trusted from a
  declared `Content-Length`. Cleanup of expired session directories runs opportunistically on
  every upload rather than on a schedule.
- **Charts.** The agent's generated code may print a `CHART_PNG_BASE64:<base64>` marker line;
  `execute_code` extracts it from stdout server-side and returns it as a distinct
  `chart_base64` field. The chat server inspects the raw ADK tool-call *response* event
  directly and forwards the image to the browser as its own WebSocket message the moment it
  appears — independent of whatever the model's own natural-language reply says, since an
  LLM is not reliably good at re-quoting a multi-hundred-KB blob verbatim.
- **Structured logging.** Every tool call emits one JSON line to stderr (tool name, session
  ID, success/failure, duration, exit code) — Cloud Logging parses this automatically into
  `jsonPayload`/`severity` fields with no logging library or added dependency.

---

## 6. Health probe behaviour

The default probes target `GET /_health` on the container's port — public and
unauthenticated, since Cloud Run's own startup/liveness probes need to reach it. Deliberately
**not** named `/healthz`: confirmed live that requests to that exact path receive a
Google-branded 404 with zero container-side request logs, while every other path (including
this one) reaches the application normally — Google's own edge routing (GFE) appears to
treat `/healthz` as a reserved, infrastructure-level path on at least some Cloud Run surfaces.

---

For the agent-specific, user-facing configuration (variables by group, outputs, and how to
explore each service from the Console and CLI), see the platform guide:
**[DataAnalyst_CloudRun](DataAnalyst_CloudRun.md)**.

<!-- related-guides -->

## Related guides

- [Data Analyst Agent on Google Cloud Run](DataAnalyst_CloudRun.md) — this configuration deployed on Cloud Run.
