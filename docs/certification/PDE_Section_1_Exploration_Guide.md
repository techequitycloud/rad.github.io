---
title: "PDE Section 1 Prep: Bootstrapping a Google Cloud Org"
description: "Prepare for the PDE exam Section 1 — bootstrapping and maintaining a Google Cloud organization — with hands-on RAD deployment labs on Google Cloud."
---

# PDE Certification Preparation Guide: Section 1 — Bootstrapping and maintaining a Google Cloud organization (~20% of the exam)

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pde_section1.png" alt="PDE Certification Preparation Guide: Section 1 — Bootstrapping and maintaining a Google Cloud organization (~20% of the exam)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Official exam guide:** [Professional Cloud DevOps Engineer certification](https://cloud.google.com/learn/certification/cloud-devops-engineer) — always confirm section weightings against the current Google Cloud exam guide.

This guide covers exam Section 1 using the RAD platform as a lab. The foundation modules exercised here are `App_CloudRun` and `App_GKE` (the deployment engines), `Services_GCP` (the once-per-project platform layer), and the `App_Common` building blocks they share. Deploy the **Pipeline engineer** profile from the [Lab Map](PDE_Certification_Guide.md) before starting.

---

## 1.1 Designing the overall resource hierarchy for an organization

> ⏱ ~30 min · 💰 no additional cost · ⚙️ Requires: default deployment

**Why the exam cares** — DevOps engineers inherit the org → folder → project → resource hierarchy and must know where to attach what: organization policies and IAM at folders for environment-wide guardrails, billing accounts outside the hierarchy, projects as the isolation and quota boundary. Exam scenarios test whether you put a constraint at the right level (e.g., a folder-level policy instead of repeating it per project) and whether you isolate environments by project rather than by naming convention.

**How RAD implements it** — Not meaningfully: all four foundation modules operate inside a single existing project; no folders, organization policies, or project-factory resources are created. The nearest adjacent capability is governance labeling — `resource_labels` (default `{}`) in both application engines is merged into a common label set (which always adds `application`, `deployment`, `tenant`, and `managed-by` keys) and stamped on every resource, which is the foundation for label-based cost attribution and log filtering.

Two other 1.1 considerations have an observable footprint in the lab. *Shared networking*: `Services_GCP` builds one VPC per project and reaches Google-managed private-IP services such as Cloud SQL through private services access, which is a VPC Network Peering (`google_service_networking_connection`); the application engines discover that VPC by label instead of creating their own. *Service accounts*: builds run as a dedicated per-deployment Cloud Build SA (`cloudbuild-sa-*`, see 1.3), not a broad default identity. Shared VPC, Private Service Connect endpoints, multi-project monitoring, and data residency controls are not configured by the modules.

**Try it**
1. In the portal, set `resource_labels = { team = "payments", env = "lab" }` on a deployed application module and apply.
2. In **Console > Cloud Run > (service) > Details**, confirm the labels; then in **Billing > Reports**, group by label key `team` to see cost attribution per label.
3. Confirm from the CLI:

```bash
gcloud run services describe <service-name> --region=us-central1 \
  --format="value(metadata.labels)"
gcloud projects get-ancestors $GOOGLE_PROJECT_ID
```

4. You know it worked when the `team` and `env` labels appear alongside the module-injected `managed-by` and `tenant` labels, and `get-ancestors` shows where your lab project sits in the hierarchy.

**Check yourself**
<details>
<summary>Q1: Your company wants every non-production project to be restricted to us-central1 while production projects stay multi-region. Where do you implement this with the least ongoing effort?</summary>

A: Attach a `constraints/gcp.resourceLocations` organization policy to a `non-production` folder and place all non-prod projects under it. Policies inherit down the hierarchy, so new projects get the restriction automatically — no per-project configuration or Terraform changes needed.
</details>

<details>
<summary>Q2: Why do the RAD modules stamp a `tenant` and `deployment` label on every resource instead of relying on resource names?</summary>

A: Labels are queryable in billing exports, log filters, and asset inventory, while names are free-form strings. Labels give you cost showback and operational grouping across heterogeneous resource types — the same mechanism the exam expects for chargeback in a multi-team organization.
</details>

**Beyond the modules** — Study the resource hierarchy and organization policy docs directly: practice `gcloud resource-manager folders list --organization=<ORG_ID>`, `gcloud org-policies list --project=<PROJECT>`, and review the Cloud Foundation Fabric/FAST landing-zone blueprints for how enterprises bootstrap folders, billing, and IAM with Terraform. Also know that a billing account is linked to projects but lives outside the hierarchy. For the rest of the 1.1 list: Shared VPC (host and service projects) vs. VPC Network Peering vs. Private Service Connect; multi-project monitoring through a Cloud Monitoring metrics scope and aggregated log sinks or log buckets; service account hygiene (dedicated per-workload SAs, no user-managed keys, `iam.disableServiceAccountKeyCreation`); and data residency through the `gcp.resourceLocations` constraint and regional log buckets.

**⚠️ Exam trap** — Organization policies are *not* IAM: denying a permission in IAM and constraining a resource configuration (e.g., `disableServiceAccountKeyCreation`) are different control planes, and the exam likes answers that combine both.

---

## 1.2 Managing infrastructure

> ⏱ ~60 min · 💰 no additional cost · ⚙️ Requires: any deployed module

**Why the exam cares** — The exam tests IaC decision criteria: declarative state-based tooling (Terraform/OpenTofu, Infrastructure Manager) vs. imperative scripts, how remote state enables collaboration and locking, how drift is detected and reconciled, and when to deliberately let another system own part of a resource. Expect scenarios on what `terraform plan` shows after someone clicks around the console.

**How RAD implements it** — The deployment modules *are* the artifact:

| Practice | Where you see it |
|---|---|
| Declarative full-stack modules | `App_CloudRun` declares a Cloud Run v2 service; `App_GKE` declares a Kubernetes Deployment |
| Parameterization, no hardcoding | each engine exposes 130–160 variables with validations, e.g. `traffic_split` entries must sum to 100 |
| Plan-time guardrails | `App_GKE` carries dozens of precondition checks, e.g. min ≤ max instances, binary-suffix memory quotas |
| Deliberate shared ownership | the Cloud Run service that Cloud Deploy targets ignores changes to the container image, so Cloud Deploy owns image rollouts while Terraform owns everything else |
| CI for the IaC itself | a repo-level Cloud Build pipeline runs convention checks, `tofu fmt -check` + `tofu validate` on every module, `tflint`, and `tofu test` against the App_CloudRun validation tests |
| Discovery over duplication | the networking layer discovers Services_GCP-managed VPCs by label instead of re-declaring them |

The deployment-control variable is `deploy_application` (default `true`) — setting it `false` provisions supporting infrastructure without the workload, a staged-rollout pattern worth knowing.

**Try it**
1. Understand the validation gate: before any deployment, the platform's CI runs a credential-free static-analysis loop on the IaC — `tofu init -backend=false`, then `tofu validate` (type and reference checks) and a formatting check (`tofu fmt -check`) — so syntax, type, and precondition errors are caught without touching a live project. This is the code-review gate; you experience its result as a deployment that is rejected before it ever reaches `plan`/`apply`.
2. Simulate drift: in **Console > Cloud Run > (service) > Edit & deploy new revision**, change the memory limit to `1Gi` manually. The next time the platform re-applies your deployment, `terraform plan` proposes reverting memory to the declared `container_resources` memory limit (default `512Mi`) — because the console change is drift against the declared state.
3. Contrast with sanctioned drift: deploy a new image through the Cloud Deploy pipeline (Pipeline engineer profile). On the next apply, the plan shows no diff for the image, because the container image is deliberately ignored by Terraform.
4. You know it worked when step 2's plan proposes an in-place update reverting your manual change, while step 3 shows "No changes" for the image attribute.

**Check yourself**
<details>
<summary>Q1: After a hotfix was deployed with `gcloud run services update --image=...`, the next `terraform apply` reverted it and re-broke production. What design prevents this class of incident?</summary>

A: Either route all image changes through the pipeline that Terraform delegates to (Cloud Deploy) and have Terraform ignore the image attribute, as this platform does, or make the emergency path update the IaC source first. The root cause is two writers owning one attribute; the fix is explicitly assigning ownership.
</details>

<details>
<summary>Q2: Why does the repo run `tofu validate` and `tofu test` in CI rather than only `tofu plan` against live infrastructure?</summary>

A: Validation and unit tests run without credentials or a live project (`-backend=false`), so they catch syntax, type, and precondition violations cheaply on every commit. Plans against live state are slower, need secrets, and belong to the deployment pipeline, not the code-review gate.
</details>

**Beyond the modules** — The exam names more IaC tooling than this lab uses: Infrastructure Manager (Google's managed Terraform runner), Cloud Foundation Toolkit blueprints, Config Connector (Google Cloud resources as Kubernetes objects), Helm, and GitOps controllers. The GitOps pattern is partly visible here: in a project you bring yourself, `Services_GCP`'s `configure_config_management = true` registers the cluster in a fleet and enables Config Sync, but it syncs Google's public quickstart sample repository, not a repo you control, and the option is hidden for projects RAD creates for you. Also practise scripting against Google Cloud with the Python or Go client libraries, since "automation with scripting" is its own bullet.

**⚠️ Exam trap** — `terraform plan` detects drift only for *attributes Terraform manages*. Resources created entirely outside Terraform are invisible to it; finding those requires Cloud Asset Inventory or config scanning, not a plan.

---

## 1.3 Designing a CI/CD architecture stack in Google Cloud, hybrid, and multi-cloud environments

> ⏱ ~45 min · 💰 low (Cloud Build minutes) · ⚙️ Requires: Pipeline engineer profile

**Why the exam cares** — Architecture questions test tool selection: Cloud Build for CI, Artifact Registry for artifacts, Cloud Deploy for progressive delivery, Binary Authorization for deploy-time supply-chain enforcement — and where the trust boundaries sit (which service account does what, where attestations are created and verified).

**How RAD implements it** — The full stack is wired in `App_CloudRun` (the GKE engine mirrors it):

- **CI**: `enable_cicd_trigger` (default `false`) creates a Cloud Build trigger with an *inline* build definition — no separate build-config file is needed in the application repo. Step 1 builds with Kaniko (`gcr.io/kaniko-project/executor:v1.23.2`, layer cache enabled with a 24h cache TTL).
- **Artifact management**: images are pushed with three tags — the configured version, `latest`, and `$COMMIT_SHA` — to the shared Artifact Registry repo (`shared-repo-*`), discovered or created as a fallback.
- **Supply-chain security**: when `enable_binary_authorization = true`, step 2 resolves the image *digest* and runs `gcloud beta container binauthz attestations sign-and-create` against the `pipeline-attestor` attestor, signing with the KMS key `binauthz-signer` in the `{project}-binauthz-keyring` keyring. The Cloud Run service uses the project's default Binary Authorization policy; the GKE cluster enforces the project singleton policy. Policy enforcement strength comes from `binauthz_evaluation_mode` (default `ALWAYS_ALLOW`; set `REQUIRE_ATTESTATION` to enforce).
- **CD**: `enable_cloud_deploy` (default `false`) provisions a Cloud Deploy delivery pipeline plus one target per stage. Note that setting it without `enable_cicd_trigger = true` is rejected by a plan-time precondition — a delivery pipeline without a CI trigger would never receive releases. Skaffold configs live in a GCS bucket named `{project}-{8-char-hash}-cd-configs`.
- **Builds run as a dedicated SA** (`cloudbuild-sa-*`), granted `roles/clouddeploy.releaser` and read access to the Skaffold bucket — not as a broad default identity.

**Try it**
1. Deploy the Pipeline engineer profile, then push a commit to the connected repo's `main` branch (the trigger's `cicd_trigger_config.branch_pattern` defaults to `^main$`).
2. Watch the build: **Console > Cloud Build > History** — identify the Kaniko step, the attestation step, and the deploy step.

```bash
gcloud builds list --region=us-central1 --limit=3
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/$GOOGLE_PROJECT_ID/<repo-name>/<app-name> \
  --include-tags --limit=5
gcloud container binauthz attestations list \
  --attestor=pipeline-attestor --attestor-project=$GOOGLE_PROJECT_ID --limit=3
```

3. In **Console > Cloud Deploy > Delivery pipelines**, open the pipeline and confirm a release named `release-<short-sha>` landed in the first stage.
4. You know it worked when the image appears in Artifact Registry with the commit-SHA tag, an attestation exists for its digest, and the dev stage shows a successful rollout.

**Check yourself**
<details>
<summary>Q1: Why does the attestation step sign the image digest rather than the `:latest` or commit-SHA tag?</summary>

A: Tags are mutable pointers; a digest is the content-addressed identity of the image. Binary Authorization verifies attestations against the digest being deployed, so signing a tag would let a re-pushed image inherit a signature it never earned.
</details>

<details>
<summary>Q2: A teammate sets `enable_cloud_deploy = true` but leaves `enable_cicd_trigger = false`, and the plan fails with a precondition error. Bug or design?</summary>

A: Design — a plan-time precondition rejects `enable_cloud_deploy = true` without `enable_cicd_trigger = true`, because a delivery pipeline without a CI trigger to feed it releases would sit empty. The exam parallel: CD is downstream of CI; design the stack as one flow.
</details>

<details>
<summary>Q3: Why Kaniko instead of a Docker daemon build step?</summary>

A: Kaniko builds OCI images entirely in userspace inside the build container — no privileged Docker daemon socket — which shrinks the attack surface of the build environment and is the recommended pattern in Cloud Build.
</details>

**Beyond the modules** — The lab is Google Cloud only. For the hybrid and multi-cloud half of the title, study how Cloud Deploy reaches GKE attached clusters and custom targets, and where widely used third-party tools fit: Jenkins or GitHub Actions as an alternative CI, Argo CD as a pull-based GitOps CD, Packer for VM images, and kpt for package-based Kubernetes configuration. The module-generated Skaffold configs deploy raw manifests (`rawYaml`); Kustomize, which Cloud Deploy also renders through Skaffold, is not used. For security of CI/CD tooling, know private pools for Cloud Build, least-privilege build service accounts, and Workload Identity Federation for external CI in place of service account keys.

**⚠️ Exam trap** — `binauthz_evaluation_mode = "ALWAYS_ALLOW"` (the default here) means Binary Authorization is *configured but not enforcing*. Attestations being created in the pipeline does nothing until the policy says `REQUIRE_ATTESTATION`.

---

## 1.4 Managing multiple environments

> ⏱ ~45 min · 💰 low–moderate (one Cloud Run service or GKE namespace per stage) · ⚙️ Requires: Pipeline engineer profile with `enable_cloud_deploy = true`

**Why the exam cares** — You must keep dev/staging/prod structurally identical while varying parameters, decide where approval gates belong, and know what isolation boundary each environment needs (namespace vs. service vs. project). Exam scenarios probe promotion mechanics: what artifact moves between stages and what must *not* be rebuilt.

**How RAD implements it** — `cloud_deploy_stages` defines the promotion path. The default is:

```hcl
[
  { name = "dev",     require_approval = false, auto_promote = false },
  { name = "staging", require_approval = false, auto_promote = false },
  { name = "prod",    require_approval = true,  auto_promote = false },
]
```

Each stage becomes a Cloud Deploy target (with `require_approval` mapped directly) and a stage-suffixed runtime: Cloud Run services named `<service>-<stage>`, or GKE namespaces per stage passed to Skaffold via the `NAMESPACE` deploy parameter. Stages with `auto_promote = true` get a Cloud Deploy automation with an advance-rollout rule, so a successful rollout advances automatically. Terraform provisions only the *first* stage's service/namespace; later stages materialize when Cloud Deploy promotes into them — the same rendered release, same image digest, no rebuild. Per-stage overrides (`project_id`, `region`, `service_name`) exist on each stage object, so cross-project promotion is expressible, though the lab runs all stages in one project.

The other 1.4 considerations, and where the lab touches them:

- **Ephemeral environments**: every deployment is created and destroyed through the portal, so a short-lived test environment is a deploy followed by a delete. The modules do not expire one automatically.
- **Safe patching and upgrading**: the `Services_GCP` GKE cluster is enrolled in the `REGULAR` release channel, so Google upgrades it automatically; Cloud SQL maintenance is scheduled with `sql_maintenance_window_day` (default `7`), `sql_maintenance_window_hour` (default `3`) and `sql_maintenance_update_track` (default `stable`; `canary` receives updates roughly a week earlier, which is how a pre-production project sees a maintenance problem before production does).
- **Fleets and policy**: in a project you bring yourself, `Services_GCP` registers its cluster in a GKE fleet when you set `configure_config_management`, `configure_policy_controller` (OPA Gatekeeper constraints), `configure_cloud_service_mesh`, or `gke_cluster_count` above `1`. These options are hidden for projects RAD creates for you.

**Try it**
1. With the Pipeline engineer profile deployed, promote the current release out of dev:

```bash
gcloud deploy releases promote \
  --delivery-pipeline=<pipeline-name> \
  --region=us-central1 --project=$GOOGLE_PROJECT_ID
```

2. Promote again toward prod, then open **Console > Cloud Deploy > (pipeline)** — the prod rollout stops in **Pending approval**. Approve it:

```bash
gcloud deploy rollouts list --delivery-pipeline=<pipeline-name> \
  --release=<release-name> --region=us-central1
gcloud deploy rollouts approve <rollout-name> \
  --delivery-pipeline=<pipeline-name> --release=<release-name> \
  --region=us-central1
```

3. Compare environments: `gcloud run services list` now shows `<service>-dev`, `<service>-staging`, `<service>-prod` running the identical image digest.
4. You know it worked when the prod rollout required an explicit approval and all three services report the same image digest in `gcloud run services describe ... --format="value(spec.template.spec.containers[0].image)"`.

**Check yourself**
<details>
<summary>Q1: Staging validated image digest X, but prod is running digest Y after promotion. In a correctly designed pipeline, is this possible?</summary>

A: No — Cloud Deploy promotes the *release*, which pins image digests at release-creation time. If prod shows a different digest, something outside the pipeline deployed it (audit logs will show who), or the pipeline rebuilds per stage, which defeats the build-once/promote-many principle the exam expects.
</details>

<details>
<summary>Q2: Where would you add a fully automatic dev → staging hop while keeping the prod gate?</summary>

A: Set `auto_promote = true` on the dev stage — the module then creates a Cloud Deploy automation with an advance-rollout rule scoped to the dev target. Prod keeps `require_approval = true`, so automation never bypasses the human gate.
</details>

**Beyond the modules** — The lab keeps all stages in one project. For exam completeness, study per-environment *project* isolation (separate IAM, quotas, VPCs per environment), Cloud Deploy deploy parameters and custom targets, and post-deployment verification (`verify` in Skaffold profiles), none of which the modules configure. Also study fleet-wide management at enterprise scale (fleet scopes, team namespaces, Config Sync from your own repository, fleet-level Policy Controller bundles), GKE maintenance windows and exclusions, and surge upgrades for node pools.

**⚠️ Exam trap** — `require_approval` gates the *rollout into the target*, not release creation. A release can exist and sit unpromoted forever; approval is per-target, which is why only prod's target carries the flag.

---

## 1.5 Enabling secure cloud development environments

> ⏱ ~45 min · 💰 low (one Cloud Run service while it runs) · ⚙️ Requires: a `CodeServer_CloudRun` deployment (optional)

**Why the exam cares** — Developer environments are part of the delivery system: a laptop with long-lived credentials and hand-installed tools is both a security risk and a source of "works on my machine" drift. The exam tests managed alternatives (Cloud Workstations, Cloud Shell), how an environment is bootstrapped with the right tooling (custom images, IDE, Cloud SDK), and where AI assistance fits in development and operations: Gemini Code Assist in the IDE, Gemini Cloud Assist in the console, and the Gemini CLI in the terminal.

**How RAD implements it** — Only by analogy. No module provisions Cloud Workstations or configures Gemini. The nearest adjacent capability is the `CodeServer_CloudRun` / `CodeServer_GKE` wrappers (and the `Coder_CloudRun` / `Coder_GKE` wrappers, which deploy the Coder workspace platform), which run a browser-based VS Code on the same foundation engines as any other application:

- **Custom image**: the image is built from a one-line Dockerfile (`FROM codercom/code-server`). That is where a team would bake in the Cloud SDK and its own tooling; the module does not add any.
- **Access control**: `enable_password` (default `true`) generates a random editor password and stores it in Secret Manager; `enable_iap` (default `false`) with `iap_authorized_users` puts Identity-Aware Proxy in front of the editor, so access requires a Google identity.
- **Persistence**: on Cloud Run, the home directory is backed by a Cloud Storage bucket declared by the module.

**Try it**
1. Deploy `CodeServer_CloudRun`, then set `enable_iap = true` and `iap_authorized_users = ["user:you@example.com"]` with **Update**.
2. Open the service URL in a private browser window and confirm you are sent to a Google sign-in before the editor loads.
3. Compare with the managed product in a scratch project: **Console > Cloud Workstations**, create a workstation configuration from a predefined image, and note what Google manages for you (image patching, idle shutdown, no public IP).
4. You know it worked when an unauthenticated request never reaches the editor, and you can name two things Cloud Workstations manages that the self-hosted editor leaves to you.

**Check yourself**
<details>
<summary>Q1: Contractors need a consistent, pre-configured IDE with access to private resources in a VPC, and security forbids source code on personal laptops. Which Google Cloud service fits?</summary>

A: Cloud Workstations. Workstation configurations define a container image (predefined or custom, with your tooling baked in), run inside your VPC, and can be restricted to private endpoints, so source code stays in Google Cloud. Cloud Shell is a personal, ephemeral environment with a small persistent home directory, not a governed team environment.
</details>

<details>
<summary>Q2: An on-call engineer wants a plain-language summary of why a Cloud Run service's error rate rose, without writing a log query first. Which AI tool is designed for that?</summary>

A: Gemini Cloud Assist, which works inside the Google Cloud console on your project's resources, logs and metrics. Gemini Code Assist is aimed at writing code in the IDE, and the Gemini CLI brings the model to the terminal.
</details>

**Beyond the modules** — Study Cloud Workstations configurations (predefined vs. custom images, idle and running timeouts, private clusters, persistent disks), Cloud Shell (5 GB persistent home, preinstalled Cloud SDK, ephemeral VM), and the three Gemini surfaces named in the exam guide: Gemini Code Assist, Gemini Cloud Assist, and the Gemini CLI. None are provisioned or configured by the RAD modules.

**⚠️ Exam trap** — A self-hosted browser IDE is not a Cloud Workstations equivalent just because it runs on Google Cloud. The managed service is the answer when a question stresses centrally governed images, VPC-private access, or no source code on endpoints.
