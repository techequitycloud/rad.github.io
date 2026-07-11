---
title: "PCA Section 3 Prep: Security & Compliance Design"
description: "Prepare for the Professional Cloud Architect (PCA) exam Section 3 — designing for security and compliance — with hands-on RAD labs on Google Cloud."
---

# PCA Certification Preparation Guide: Section 3 — Designing for security and compliance (~17.5% of the exam)

Security design is where the RAD modules are at their densest: dedicated service accounts everywhere, secrets that never touch Terraform state, CMEK with automatic rotation and even automatic key *recovery*, Binary Authorization, VPC Service Controls with a deliberately staged dry-run rollout, and zero-trust access via IAP. Deploy the **Security and delivery** profile from the [Lab Map](PCA_Certification_Guide.md) on top of a baseline deployment. Modules exercised: `Services_GCP`, `App_CloudRun` (or `App_GKE`), and the `App_Common` security layers (secrets, IAM, CMEK, and VPC-SC).

---

## 3.1 Designing for security

> ⏱ ~2–3 h · 💰 moderate — KMS keys and the Cloud Armor load balancer; Binary Authorization and VPC-SC are free · ⚙️ Requires: Security and delivery profile (VPC-SC additionally needs the project in a GCP organization and non-empty `admin_ip_ranges`)

**Why the exam cares** — PCA security questions are layered-defense design: who can act (IAM, separation of duties), how data is protected (encryption at rest/in transit, CMEK control), what can run (supply-chain integrity), where data can flow (perimeters, network segmentation), and who can reach the app (zero-trust access). The exam tests choosing the right layer for a requirement — e.g. data-exfiltration prevention is VPC-SC, not firewall rules.

**How RAD implements it**

*Identity and least privilege.* Services_GCP creates dedicated service accounts per duty — `cloudrun-sa-{prefix}`, `cloudbuild-sa-{prefix}`, `clouddeploy-sa-{prefix}`, `gke-sa-{prefix}`, `nfs-sa-{prefix}` — never the default compute SA. The platform's IAM layer grants resource-scoped bindings: `roles/secretmanager.secretAccessor` *per secret* and `roles/storage.objectAdmin` *per bucket*, plus `roles/iam.serviceAccountUser` for controlled impersonation by the build SA. On GKE, Workload Identity binds a per-namespace KSA to the GCP SA via `roles/iam.workloadIdentityUser` — no key files anywhere.

*Secrets.* The platform's secrets layer generates the 32-character database password and stores it in Secret Manager; the GitHub token is written with `gcloud secrets versions add` precisely so it never enters deployment state. `secret_rotation_period` (default `2592000s` = 30 days) and `enable_auto_password_rotation` (default `false`) drive a dual-version, zero-downtime rotation flow: an Eventarc-triggered dispatcher runs a rotator job that executes `ALTER USER`, adds the new secret version, and disables the old one only after a propagation delay.

*Encryption.* `enable_cmek` (default `false`) creates a keyring with separate keys for Cloud SQL, Artifact Registry, and GCS, rotating every `cmek_key_rotation_period` (default `7776000s` = 90 days), and grants `roles/cloudkms.cryptoKeyEncrypterDecrypter` to each service agent. A plan-time recovery step in the platform's object-storage layer detects key versions scheduled for destruction or disabled and restores them before any encrypted resource is provisioned — operational self-healing for the classic "someone scheduled the key for destruction" incident.

*Supply chain.* `enable_binary_authorization` (default `false`) with `binauthz_evaluation_mode` (default `ALWAYS_ALLOW`; set `REQUIRE_ATTESTATION` to enforce) creates a KMS RSA-2048 signing key, a Container Analysis note and attestor, and an additive policy that blocks and audit-logs non-conforming images. GKE clusters enforce the project's singleton Binary Authorization policy when enabled. `enable_vulnerability_scanning` turns on Artifact Registry scanning.

*Perimeters.* `enable_vpc_sc` (default `false`, `vpc_sc_dry_run` default `true`) builds a perimeter restricting ~15 services with four access levels (VPC CIDRs, `admin_ip_ranges`, the IAP SA, CI/CD SAs). The organization ID is resolved from the project (with an explicit `organization_id` variable override available in App_CloudRun/App_GKE — needed when the project sits under a *folder*, where auto-discovery returns nothing), and a permission probe checks the caller's Access Context Manager rights, skipping with a warning instead of failing the apply.

*Edge and runtime.* `enable_iap` grants `roles/run.invoker` to the IAP service agent and `roles/iap.httpsResourceAccessor` to `iap_authorized_users`/`iap_authorized_groups` (validation requires at least one). `enable_cloud_armor` deploys OWASP preconfigured WAF rules (sqli/xss/lfi/rce, v33-stable), Adaptive Protection, and a 500 req/min/IP rate limit with a 300 s ban — and a validation requires `application_domains` to be set. On GKE, `enable_network_segmentation` (default `false`) creates default-deny-shaped NetworkPolicies on Dataplane V2: ingress only from the same namespace plus Google LB health-check and IAP ranges; egress only to DNS, HTTPS (including the restricted/private googleapis ranges `199.36.153.4/30` and `199.36.153.8/30`), Cloud SQL on 3307, the metadata server, and NFS when enabled.

**Try it**

1. In **Console > IAM & Admin > Service Accounts**, list the five platform SAs; pick one and inspect its bindings:

```bash
gcloud projects get-iam-policy <project-id> \
  --flatten="bindings[].members" \
  --filter="bindings.members:cloudrun-sa-" \
  --format="table(bindings.role)"
```

2. In **Console > Security > Secret Manager**, open the database password secret — confirm versions exist but values are never shown in plan output or the portal.
3. Enable `REQUIRE_ATTESTATION`, then attempt to deploy an unsigned image and watch the denial in **Console > Logging > Logs Explorer** (filter on Binary Authorization audit events).
4. With VPC-SC enabled in dry-run, review the perimeter:

```bash
gcloud access-context-manager perimeters list --policy=<policy-id> \
  --format="table(name,title,spec.restrictedServices.list():label=DRY_RUN_SERVICES)"
```

5. On GKE with segmentation enabled: `kubectl describe networkpolicy -n <namespace>` and trace each rule to a trust decision.
6. You know it worked when the unsigned image is blocked, the perimeter shows in dry-run (`spec` populated, not `status`), and every IAM binding you find is scoped to a specific resource or duty.

**Check yourself**
<details>
<summary>Q1: A regulator requires that your company control — and be able to revoke — the encryption keys protecting customer data, with rotation at least quarterly. Which platform settings satisfy this, and what is the operational risk the module mitigates?</summary>

A: `enable_cmek = true` with the default `cmek_key_rotation_period = "7776000s"` (90 days) gives customer-managed keys with quarterly rotation; disabling/destroying the key revokes access to the data. The operational risk is self-inflicted denial of service — a key version scheduled for destruction bricks every encrypted bucket and repo — which the platform's plan-time key-recovery step mitigates by restoring versions that were scheduled for destruction or disabled.
</details>

<details>
<summary>Q2: A security team wants to guarantee that only images built by the official CI pipeline run in production. Which control, and what mode?</summary>

A: Binary Authorization with `binauthz_evaluation_mode = "REQUIRE_ATTESTATION"` — the CI pipeline signs (attests) each image digest with the KMS key, and the policy blocks unattested images at deploy time while audit-logging the decision. Vulnerability scanning alone only *reports*; IAM alone controls who deploys, not *what* is deployed.
</details>

<details>
<summary>Q3: Why is `vpc_sc_dry_run = true` the default, and what is the rollout sequence the exam (and this module's variable description) expects?</summary>

A: An enforced perimeter with wrong access levels instantly breaks CI/CD, deployments, and admin access — VPC-SC denials are hard failures at the API layer. Correct sequence: deploy in dry-run, monitor audit logs for would-be violations for days, add missing IPs/SAs to access levels, then flip `vpc_sc_dry_run = false`. Dry-run logs violations without blocking.
</details>

**Beyond the modules** — Two examined areas are absent. (1) **Resource hierarchy and organization policies**: folders, inheritance, constraints like `iam.disableServiceAccountKeyCreation` — study "Organization Policy Service" and try `gcloud resource-manager org-policies list` in an org-attached project. (2) **Hierarchical firewall policies and Cloud NGFW** — the modules use classic VPC firewall rules only. (Workload Identity Federation, formerly absent, is now live: `enable_workload_identity_federation` in Services_GCP creates pool `wif-pool` with a GitHub Actions / GitLab CI / generic OIDC provider per `wif_provider_type` — a working keyless-CI lab.)

**⚠️ Exam trap** — IAP and Cloud Armor answer different questions: IAP authenticates *identities* (who are you?); Cloud Armor filters *traffic* (is this request malicious?). "Only employees may access the app" → IAP; "block SQL injection and DDoS" → Cloud Armor. Scenarios often need both, but never one as a substitute for the other.

---

## 3.2 Designing for compliance

> ⏱ ~60 min · 💰 low–moderate — Data Access audit logs can grow log storage costs · ⚙️ Requires: `enable_audit_logging = true`; SCC steps need `enable_security_command_center = true` (org-level roles required for notifications)

**Why the exam cares** — Compliance questions test evidence and control mapping: which logs prove who did what (Admin Activity vs Data Access), how findings are surfaced and routed, and how regional/regulatory constraints (HIPAA, PCI-DSS, data residency) shape architecture.

**How RAD implements it**

*Audit trail.* `enable_audit_logging` (default `false`) configures `allServices` audit logs for `ADMIN_READ`, `DATA_READ`, and `DATA_WRITE` — Admin Activity (`ADMIN_WRITE`) is always on and free, but Data Access logs must be explicitly opted in, which is exactly what the platform does, plus explicit per-service configs for Secret Manager and Cloud KMS so secret and key access is provably logged.

*Findings and posture.* `enable_security_command_center` (default `false`) plus `enable_scc_notifications` route findings to a Pub/Sub topic (`scc-{prefix}-findings`). The notification config is gated by an org-permission probe — if the deploying SA lacks org-level SCC roles, the feature is skipped with a warning rather than failing the apply. GKE clusters additionally enable security posture management (mode `BASIC`, vulnerability mode `VULNERABILITY_BASIC`).

*Exfiltration and residency controls.* VPC-SC (3.1) is also the compliance answer for data-boundary requirements; region placement is controlled by `availability_regions`.

**Try it**

1. Enable `enable_audit_logging = true`, then read or write a secret version and find the access event:

```bash
gcloud logging read \
  'logName:"cloudaudit.googleapis.com%2Fdata_access" AND protoPayload.serviceName="secretmanager.googleapis.com"' \
  --limit=5 --format="table(timestamp, protoPayload.methodName, protoPayload.authenticationInfo.principalEmail)"
```

2. In **Console > IAM & Admin > Audit Logs**, verify Data Read/Write are enabled for "All services" with per-service rows for Secret Manager and KMS.
3. If SCC is active, browse **Console > Security > Security Command Center > Findings** and check for the `scc-{prefix}-findings` topic in **Pub/Sub**.
4. You know it worked when the log query returns the principal email and method for your secret access — audit evidence on demand.

**Check yourself**
<details>
<summary>Q1: An auditor asks for proof of every read of patient-data secrets in the last 30 days. Default project logging cannot provide it — why, and what does this platform change?</summary>

A: Reads are Data Access (`DATA_READ`) events, which Google disables by default for cost reasons; only Admin Activity is always on. `enable_audit_logging = true` opts all services into `ADMIN_READ`/`DATA_READ`/`DATA_WRITE`, with explicit Secret Manager coverage — making the read trail queryable in Logs Explorer (and exportable to BigQuery for long retention).
</details>

<details>
<summary>Q2: Why does the SCC notification feature "silently skip with a warning" instead of failing, and what design principle is that?</summary>

A: SCC notification configs require org-level permissions the deploying service account may not hold in every tenant project. The permission probe degrades gracefully — partial security posture rather than a failed platform deployment. The principle: separate *mechanism availability* from *privilege availability*, and never let an optional control block the critical path. Know for the exam that full SCC management is organization-scoped.
</details>

**Beyond the modules** — Not covered: Assured Workloads (regulated regions/personnel controls), Access Transparency (logs of *Google* personnel access), org-policy-based data residency (`gcp.resourceLocations`), DLP/Sensitive Data Protection for PII discovery and masking, and formal compliance mappings (HIPAA BAA, PCI-DSS responsibility splits). Study the "Compliance resource center" and run a DLP inspection template against a sample bucket in a scratch project.

**⚠️ Exam trap** — Admin Activity logs are free, always on, and immutable; Data Access logs are opt-in, high-volume, and billable (BigQuery and some services differ). A scenario about "who *changed* the firewall" needs no configuration at all; "who *read* the data" needs Data Access logs enabled *before* the incident — you cannot enable them retroactively.
