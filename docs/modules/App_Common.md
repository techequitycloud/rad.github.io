---
title: "App Common \u2014 Configuration Guide"
---

# App Common — Configuration Guide

## Overview

App Common is the shared capability library that underpins every application deployment in this platform. It is **not deployed directly by users**. Instead, it is consumed internally by the two foundation deployment engines — [App CloudRun](App_CloudRun.md) and [App GKE](App_GKE.md) — which call into it automatically when you deploy any application module (such as Django CloudRun or Odoo GKE).

Think of App Common as the platform's "standard infrastructure toolkit." Every time an application is deployed, App Common is responsible for discovering the GCP environment already in place, wiring the application into it, and provisioning the supporting services the application needs — databases, storage buckets, secrets, monitoring, security controls, and CI/CD pipelines.

Because App Common runs as part of every deployment, improvements and fixes made to it automatically benefit all applications without any changes to individual application modules.

This guide is organised by **capability** rather than by configuration group: App Common is a shared library and exposes no UI-deployable variables or top-level outputs of its own. For the user-facing input variables and deployment outputs of an actual deployment, see the [App GKE Configuration Guide](App_GKE.md) and the [App CloudRun Configuration Guide](App_CloudRun.md).

## Deployed GCP Services

App Common does not deploy independently. On behalf of each application deployment, it provisions and configures the following GCP services. Each capability maps to one or more Google Cloud services, described in detail in the sections below.

| Capability | Google Cloud Service | Notes |
|---|---|---|
| Networking | Compute Engine (VPC, Subnets, Firewall) | Discovers the shared VPC and firewall tags |
| Database | Cloud SQL | Provisions application databases and users on the shared instance |
| Storage | Cloud Storage (GCS) | Application data buckets and backup buckets |
| File Storage | Cloud Filestore / Compute Engine NFS VM | Discovers shared NFS for multi-instance file sharing |
| Container Images | Artifact Registry, Cloud Build | Image registry discovery and Kaniko image builds |
| IAM | IAM (service-account role bindings) | Least-privilege workload and Cloud Build bindings |
| Secrets | Secret Manager, Pub/Sub | Password generation, validation, and rotation notifications |
| Monitoring | Cloud Monitoring | Alert policies, notification channels, and dashboards |
| CI/CD *(optional)* | Cloud Build (v2 GitHub), Cloud Deploy | GitHub connections and multi-stage delivery pipelines |
| Security *(optional)* | Binary Authorization, Container Analysis, VPC Service Controls | Image attestation and API perimeters |
| Encryption *(optional)* | Cloud KMS | CMEK keyring and CryptoKeys for GCS and Artifact Registry |
| Password Rotation *(optional)* | Cloud Run Jobs, Eventarc | `pw-rotator` job and `rot-dispatch` dispatcher |

---

## Networking

### VPC Network Discovery

App Common automatically discovers the VPC network and subnets that were provisioned by Services GCP. It identifies which subnets exist in each region, maps regions to their subnets, and collects the network firewall tags used to route traffic correctly. This means application workloads are connected to the right private network without any manual configuration — Cloud Run services with direct VPC egress and GKE pods both receive the correct network placement and firewall tag assignments automatically.

### Exploring in GCP

Console: **VPC network** → **VPC networks** → select the network → **Subnets** tab to see subnets by region; **Firewall** tab to see rules and their target tags.

```bash
# List VPC networks in the project
gcloud compute networks list --project=PROJECT_ID

# List subnets with their regions and CIDRs
gcloud compute networks subnets list \
  --network=NETWORK_NAME \
  --project=PROJECT_ID \
  --format="table(name,region,ipCidrRange)"

# Show firewall rules and their target tags
gcloud compute firewall-rules list \
  --filter="network:NETWORK_NAME" \
  --format="table(name,targetTags.list(),allowed[].map().firewall_rule().list())" \
  --project=PROJECT_ID
```

---

## Database

### Cloud SQL Integration

App Common discovers the Cloud SQL instance that Services GCP provisioned for the project. It reads the instance's connection name, internal IP address, and database engine version, then generates a secure random database password and stores it in Secret Manager. It also provisions the application's specific database and database user on the shared instance, so each application gets its own isolated credentials while sharing the underlying Cloud SQL infrastructure.

The database password secret follows the naming convention `INSTANCE_NAME-RESOURCE_PREFIX-db-password`. Application workloads retrieve this secret at runtime through Secret Manager rather than receiving it as a plain environment variable.

### Exploring in GCP

Console: **SQL** → select the instance → **Databases** tab to see provisioned databases; **Users** tab to see provisioned users.

```bash
# List Cloud SQL instances
gcloud sql instances list --project=PROJECT_ID

# Describe a specific instance (connection name, IP addresses, version)
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(connectionName,ipAddresses,databaseVersion,region)"

# List databases on an instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List users on an instance
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID
```

---

## Storage

### Cloud Storage Buckets

App Common provisions one or more GCS buckets for application use. Buckets are created with versioning, uniform bucket-level access, and public access prevention enabled by default. Lifecycle rules are applied to automatically transition or delete objects based on age and version conditions, keeping storage costs predictable. A dedicated backup bucket is also created for each application with a configurable retention period.

When CMEK encryption is enabled (see the CMEK section below), all buckets are encrypted with a customer-managed KMS key.

### Exploring in GCP

Console: **Cloud Storage** → **Buckets** — filter by the application's resource prefix to find its buckets.

```bash
# List buckets belonging to an application (replace PREFIX with the app's resource prefix)
gcloud storage buckets list \
  --filter="name:PREFIX*" \
  --project=PROJECT_ID

# Show bucket details including versioning, lifecycle, and encryption
gcloud storage buckets describe gs://BUCKET_NAME

# List lifecycle rules on a bucket
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="json(lifecycle)"
```

---

## File Storage

### Cloud Filestore and NFS Discovery

For applications that need shared file storage (for example, a CMS with user-uploaded media shared across multiple instances), App Common discovers the NFS infrastructure that Services GCP has made available. It supports two types: managed Cloud Filestore instances and GCE-based NFS servers. When both are present, the Filestore instance takes precedence. The discovered NFS endpoint is made available to the application workload so it can mount the shared filesystem at startup.

### Exploring in GCP

Console: **Filestore** → **Instances** to see managed NFS instances and their IP addresses.

```bash
# List Filestore instances in the project
gcloud filestore instances list --project=PROJECT_ID

# Describe a specific Filestore instance (IP address, capacity, tier)
gcloud filestore instances describe INSTANCE_NAME \
  --zone=ZONE \
  --project=PROJECT_ID \
  --format="yaml(networks,fileShares,tier)"
```

---

## Container Images

### Artifact Registry

App Common discovers the shared Artifact Registry repository provisioned by Services GCP. This repository stores all application container images and database utility images. The discovered repository location and ID are used by both the container build process and the CI/CD pipeline triggers to ensure images are pushed to and pulled from the correct registry.

### Exploring in GCP

Console: **Artifact Registry** → **Repositories** → select the repository → browse images and tags.

```bash
# List Artifact Registry repositories in the project
gcloud artifacts repositories list --project=PROJECT_ID

# List images in a repository
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --include-tags

# Show details of a specific image including its digest
gcloud artifacts docker images describe \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/IMAGE_NAME:TAG
```

### Container Image Building

When an application module includes a custom container build, App Common uses **Cloud Build** with Kaniko to build the image from source and push it to Artifact Registry. The build is triggered automatically during deployment and re-triggered whenever the Dockerfile, build context, or build arguments change. Build logs are available in Cloud Build history.

### Exploring in GCP

Console: **Cloud Build** → **History** — filter by trigger or image name to find build runs for a specific application.

```bash
# List recent Cloud Build builds (most recent first)
gcloud builds list \
  --project=PROJECT_ID \
  --limit=20

# Stream logs for a specific build
gcloud builds log BUILD_ID --project=PROJECT_ID

# List builds filtered by a specific image tag
gcloud builds list \
  --filter="images:IMAGE_NAME" \
  --project=PROJECT_ID
```

---

## IAM

### Workload Identity and Role Bindings

App Common sets up the IAM bindings needed for each application's service account to operate with least-privilege access. Specifically, it grants the workload service account:

- **Secret Manager** — `roles/secretmanager.secretAccessor` on the database password secret and any additional secrets the application declares.
- **Cloud Storage** — `roles/storage.objectAdmin` and `roles/storage.legacyBucketReader` on each of the application's GCS buckets.

When CI/CD is enabled, App Common also grants the Cloud Build service account the appropriate deployment role (`roles/run.developer` or `roles/container.developer`) and the ability to act as the workload service account.

### Exploring in GCP

Console: **IAM & Admin** → **IAM** — filter by the application service account email to see its bindings. For per-resource bindings (secrets, buckets), check the **Permissions** tab on the individual resource.

```bash
# Show IAM bindings for the project (filter by service account)
gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:SA_EMAIL" \
  --format="table(bindings.role)"

# Show IAM policy on a specific GCS bucket
gcloud storage buckets get-iam-policy gs://BUCKET_NAME

# Show IAM policy on a specific Secret Manager secret
gcloud secrets get-iam-policy SECRET_NAME --project=PROJECT_ID
```

---

## Secrets

### Secret Manager

App Common manages the full lifecycle of application secrets in Secret Manager. For each deployment it:

- Generates a random database password and stores it as a versioned secret.
- Validates that any additional secrets declared by the application module (API keys, third-party credentials, etc.) already exist in Secret Manager before the deployment proceeds.
- Creates a Pub/Sub topic to receive secret rotation notifications at a configurable rotation interval.

Secrets are referenced by application workloads at runtime — Cloud Run services resolve them as environment variables at startup, while GKE workloads receive them as Kubernetes Secrets.

### Exploring in GCP

Console: **Secret Manager** — filter by the application's resource prefix to find its secrets. Click a secret to see its versions, rotation schedule, and access audit logs.

```bash
# List secrets in the project (filter by prefix)
gcloud secrets list \
  --filter="name:PREFIX" \
  --project=PROJECT_ID

# Show details of a secret including rotation schedule
gcloud secrets describe SECRET_NAME --project=PROJECT_ID

# List versions of a secret
gcloud secrets versions list SECRET_NAME --project=PROJECT_ID

# Access a secret's current value (requires secretmanager.versions.access permission)
gcloud secrets versions access latest \
  --secret=SECRET_NAME \
  --project=PROJECT_ID
```

### Automatic Password Rotation

When automatic password rotation is enabled for an application, App Common deploys a rotation architecture built on three components:

1. **Cloud Run Job** (`pw-rotator`) — executes the rotation: generates a new password, updates the Cloud SQL user, adds the new secret version, waits for propagation, then disables the old version. This zero-downtime approach ensures running workloads are never disrupted.
2. **Cloud Run Service** (`rot-dispatch`) — a lightweight scale-to-zero dispatcher that bridges the Eventarc trigger to the rotation job.
3. **Eventarc trigger** — fires the dispatcher whenever Secret Manager emits a rotation notification on the Pub/Sub topic.

### Exploring in GCP

Console: **Cloud Run** — look for `pw-rotator` (Job) and `rot-dispatch` (Service) in the application's region. **Eventarc** → **Triggers** to see the rotation trigger.

```bash
# List Cloud Run Jobs in the project
gcloud run jobs list --project=PROJECT_ID --region=REGION

# Show details of the rotation job
gcloud run jobs describe pw-rotator \
  --project=PROJECT_ID \
  --region=REGION

# List Eventarc triggers
gcloud eventarc triggers list \
  --project=PROJECT_ID \
  --location=REGION
```

---

## Monitoring

### Alert Policies and Notification Channels

App Common creates Cloud Monitoring alert policies for each application. By default it provisions:

- A **CPU utilization alert** — fires when CPU usage exceeds 90% for 60 seconds.
- A **memory utilization alert** — fires when memory usage exceeds 90% for 60 seconds.

Both alerts notify the email addresses designated as support users for the deployment and re-notify every 30 minutes while the condition persists. Applications can also define additional custom alert policies with their own filters, thresholds, and aggregation periods.

### Exploring in GCP

Console: **Monitoring** → **Alerting** → **Policies** — filter by the application name to find its alerts. **Alerting** → **Notification channels** to see the email channels.

```bash
# List alert policies in the project
gcloud alpha monitoring policies list --project=PROJECT_ID

# List notification channels
gcloud alpha monitoring channels list --project=PROJECT_ID
```

### Cloud Monitoring Dashboards

App Common creates a pre-built Cloud Monitoring dashboard tailored to the deployment platform:

- **Cloud Run** — displays request count, p95 request latency, container instance count, and CPU utilization, filtered by service name.
- **GKE** — displays CPU usage, memory usage, pod restart count, and network egress, filtered by Kubernetes namespace.

### Exploring in GCP

Console: **Monitoring** → **Dashboards** — find the dashboard named after the application or service.

```bash
# List custom dashboards in the project
gcloud monitoring dashboards list --project=PROJECT_ID
```

---

## CI/CD

### Cloud Build v2 GitHub Integration

When CI/CD is enabled for an application, App Common establishes a Cloud Build v2 connection to GitHub using an OAuth token and GitHub App installation. It then creates a Cloud Build v2 repository resource linked to the application's GitHub repository. This connection allows Cloud Build triggers to respond to push events and pull request activity in GitHub.

### Exploring in GCP

Console: **Cloud Build** → **Repositories (2nd gen)** — find the connection and linked repository for the application.

```bash
# List Cloud Build v2 connections
gcloud builds connections list \
  --project=PROJECT_ID \
  --region=REGION

# List Cloud Build v2 repositories linked to a connection
gcloud builds repositories list \
  --connection=CONNECTION_NAME \
  --project=PROJECT_ID \
  --region=REGION
```

### Cloud Deploy Delivery Pipelines

For applications using multi-stage delivery, App Common provisions a **Cloud Deploy** delivery pipeline with ordered promotion stages (for example, `dev → staging → prod`). Each stage maps to a named target (a Cloud Run service or GKE cluster) and can be configured with:

- **Manual approval gates** — a human must approve promotion to the next stage.
- **Auto-promotion** — the pipeline automatically advances to the next stage on a successful rollout.

A GCS bucket is created to store Skaffold configuration and per-stage deployment manifests. Cloud Deploy's service agent receives the permissions it needs to deploy to Cloud Run or GKE.

### Exploring in GCP

Console: **Cloud Deploy** → **Delivery pipelines** — select the pipeline to see its stages, releases, and rollout history.

```bash
# List Cloud Deploy delivery pipelines
gcloud deploy delivery-pipelines list \
  --project=PROJECT_ID \
  --region=REGION

# Describe a pipeline and its stages
gcloud deploy delivery-pipelines describe PIPELINE_NAME \
  --project=PROJECT_ID \
  --region=REGION

# List releases for a pipeline
gcloud deploy releases list \
  --delivery-pipeline=PIPELINE_NAME \
  --project=PROJECT_ID \
  --region=REGION
```

---

## Security

### Binary Authorization

When Binary Authorization is enabled, App Common ensures that only signed, attested container images can be deployed. It provisions:

- A **Cloud KMS asymmetric signing key** used to sign image digests.
- A **Container Analysis note** and **attestor** (`pipeline-attestor`) that the Binary Authorization policy references.
- A **Binary Authorization policy** scoped to the project.

After each successful container build, the application image is signed using the KMS key and an attestation is recorded in Container Analysis. The policy is configurable across three enforcement modes: permissive (allow all), require attestation (enforce signed images), or emergency deny (block all deployments).

### Exploring in GCP

Console: **Binary Authorization** → **Policy** to see the enforcement mode and attestors. **Security** → **Container Analysis** → **Occurrences** to see attestation records.

```bash
# Show the current Binary Authorization policy
gcloud container binauthz policy export --project=PROJECT_ID

# List attestors in the project
gcloud container binauthz attestors list --project=PROJECT_ID

# List attestations for an image digest
gcloud container binauthz attestations list \
  --attestor=pipeline-attestor \
  --attestor-project=PROJECT_ID \
  --artifact-url=IMAGE_URI@sha256:DIGEST
```

### VPC Service Controls

When VPC Service Controls are enabled, App Common configures an Access Context Manager perimeter around the project to restrict which identities and networks can call protected GCP APIs. The perimeter covers the key services used by the platform, including Cloud Run, GKE, Cloud SQL, Secret Manager, Cloud Storage, Artifact Registry, Cloud Build, KMS, and Pub/Sub.

App Common automatically discovers the organization ID from the project and the VPC subnet CIDR ranges, then constructs four access levels:

- **VPC access** — traffic originating within the project's VPC subnets.
- **Admin access** — specified administrator IP ranges.
- **IAP access** — the Identity-Aware Proxy service agent.
- **CI/CD access** — the Cloud Build service account and deployment identity.

A dry-run mode is available to audit perimeter violations before enforcing the policy.

### Exploring in GCP

Console: **VPC Service Controls** — view the access policy and perimeter for the project.

```bash
# List Access Context Manager access policies (requires org-level access)
gcloud access-context-manager policies list \
  --organization=ORG_ID

# List service perimeters in a policy
gcloud access-context-manager perimeters list \
  --policy=POLICY_NAME

# Describe a specific perimeter
gcloud access-context-manager perimeters describe PERIMETER_NAME \
  --policy=POLICY_NAME
```

---

## Encryption

### Customer-Managed Encryption Keys (CMEK)

When CMEK is enabled, App Common provisions and manages Cloud KMS keys so that Cloud Storage buckets and the Artifact Registry repository are encrypted with customer-managed keys rather than Google-managed keys. It:

- Discovers any existing KMS keyring created by Services GCP (prefix `PROJECT_ID-cmek-`) and reuses it; creates a new keyring only when none exists.
- Provisions a `storage-key` CryptoKey for GCS bucket encryption and grants the Cloud Storage service account the `roles/cloudkms.cryptoKeyEncrypterDecrypter` permission on it.
- Optionally provisions an `artifact-registry-key` CryptoKey and grants the Artifact Registry service agent the same permission.

At plan time, App Common also checks for any KMS key versions that are scheduled for destruction or disabled, and restores them before provisioning encrypted resources — preventing accidental data loss from key version expiry.

### Exploring in GCP

Console: **Security** → **Key Management** — find the keyring named `PROJECT_ID-cmek-keyring` and its keys.

```bash
# List KMS keyrings in a location
gcloud kms keyrings list \
  --location=REGION \
  --project=PROJECT_ID

# List keys in a keyring
gcloud kms keys list \
  --keyring=KEYRING_NAME \
  --location=REGION \
  --project=PROJECT_ID

# Describe a key and show its key versions
gcloud kms keys describe KEY_NAME \
  --keyring=KEYRING_NAME \
  --location=REGION \
  --project=PROJECT_ID

# List key versions and their states
gcloud kms keys versions list \
  --key=KEY_NAME \
  --keyring=KEYRING_NAME \
  --location=REGION \
  --project=PROJECT_ID
```

---

## Deployment Inputs and Outputs

App Common is an internal shared library. It has no UI-deployable input variables and exposes no top-level deployment outputs of its own — its capabilities are always consumed through a foundation module. For the user-facing configuration variables and the outputs returned after a successful deployment, see the [App GKE Configuration Guide](App_GKE.md) and the [App CloudRun Configuration Guide](App_CloudRun.md).
