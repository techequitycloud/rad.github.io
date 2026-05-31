# VMware_Engine Module — Configuration Guide

`VMware_Engine` is a **standalone infrastructure module** that provisions Google Cloud VMware
Engine (GCVE) resources in an existing GCP project. It deploys a GCVE private cloud, a global
VMware Engine Network (VEN), a VPC network for peering and jump host access, VPC network
peering between the VEN and the peer VPC, a network policy for internet egress and external IP
allocation, default VPC firewall rules, and a Windows Server 2022 jump host VM for accessing
vCenter, NSX-T Manager, and HCX Manager via RDP.

This module is designed to support **VM migration workflows** and **GCVE lab environments**. It
is deployed directly to an existing GCP project (not through the standard App_CloudRun or
App_GKE foundation modules) and has no dependency on `Services_GCP`.

> **Provisioning time:** A GCVE private cloud takes **30–90 minutes** to provision.
> `google_vmwareengine_private_cloud` has a 180-minute timeout. Do not interrupt a running
> apply.

---

## §1 · Module Overview

### Always-created resources

Every deployment provisions the following resources regardless of feature flags:

| Resource | Name Pattern | Description |
|---|---|---|
| `google_vmwareengine_network` | `altostrat-<id>-ven` | Global VMware Engine Network (STANDARD type) — the logical network backing the private cloud and VEN-to-VPC routing. |
| `google_vmwareengine_private_cloud` | `altostrat-<id>-private-cloud` | GCVE private cloud — provisions vSphere, vSAN, NSX-T, and HCX management appliances. |
| `google_vmwareengine_network_policy` | `altostrat-<id>-edge-policy` | Network policy controlling internet egress and external IP allocation via the `edge_services_cidr`. |
| `google_vmwareengine_network_peering` | `altostrat-<id>-vpc-ven` | VPC peering between the VMware Engine Network and the peer VPC. Custom routes are imported and exported in both directions. |
| `google_compute_firewall` (allow-http) | `altostrat-<id>-allow-http` | Always-created firewall rule allowing TCP 80/443 to instances tagged `jump-host`. |

### Optionally-created resources

| Resource | Controlled by | Description |
|---|---|---|
| `google_compute_network` | `create_vpc = true` | Auto-mode VPC network for jump host and VEN peering. |
| `google_compute_firewall` × 4 | `create_default_firewall_rules = true` | Default-VPC-style rules: allow-internal, allow-ssh, allow-rdp, allow-icmp. |
| `google_compute_instance` | `create_jump_host = true` | Windows Server 2022 jump host VM (`jump-host` tag) for RDP access to GCVE management consoles. |
| `null_resource` (vCenter credentials reset) | `reset_vcenter_credentials = true` | Runs `gcloud vmware private-clouds vcenter credentials reset` after provisioning. Outputs credentials to Cloud Build logs. |
| `google_project_service` × 6 | `enable_services = true` | Enables required GCP APIs: `vmwareengine`, `vmmigration`, `compute`, `cloudresourcemanager`, `iam`, `iamcredentials`. |

### Resource naming

All resources use the `altostrat-<id>` prefix where `<id>` is either `var.deployment_id`
(when set) or a randomly generated 2-byte hex string.

---

## §2 · Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GCP Project                               │
│                                                                   │
│  VMware Engine Network (global, STANDARD)                        │
│  └── GCVE Private Cloud (zone-local)                             │
│       ├── vSphere                                                 │
│       ├── vSAN                                                    │
│       ├── NSX-T Manager                                           │
│       └── HCX Manager                                             │
│                                                                   │
│  Network Policy (regional)                                        │
│  ├── internet_access: enabled/disabled                            │
│  └── external_ip: enabled/disabled                               │
│                                                                   │
│  VEN ←──────── VPC Peering ────────→ Peer VPC (auto-mode)       │
│                   (custom routes exported+imported)               │
│                                                                   │
│  Peer VPC                                                         │
│  ├── Firewall: allow-internal                                     │
│  ├── Firewall: allow-ssh (0.0.0.0/0 → TCP 22)                  │
│  ├── Firewall: allow-rdp (0.0.0.0/0 → TCP 3389)               │
│  ├── Firewall: allow-icmp (0.0.0.0/0)                          │
│  ├── Firewall: allow-http (→ tag:jump-host TCP 80,443)          │
│  └── Jump Host VM (Windows Server 2022, tag:jump-host)           │
│       └── Used to RDP into vCenter, NSX-T, HCX consoles          │
└─────────────────────────────────────────────────────────────────┘
```

---

## §3 · Module Metadata (Group 0)

| Variable | Type | Default | Description |
|---|---|---|---|
| `module_description` | `string` | `"This module deploys Google Cloud VMware Engine infrastructure..."` | Human-readable description displayed in the platform UI. `{{UIMeta group=0 order=100}}` |
| `module_dependency` | `list(string)` | `["GCP Project"]` | Modules that must be deployed first. `{{UIMeta group=0 order=101}}` |
| `module_services` | `list(string)` | `["GCP", "VMware Engine", "Cloud Networking", "Cloud IAM"]` | Service tags shown in the platform catalogue. `{{UIMeta group=0 order=102}}` |
| `credit_cost` | `number` | `500` | Platform credits consumed on deployment. Reflects the high cost of GCVE private cloud nodes. `{{UIMeta group=0 order=103}}` |
| `require_credit_purchases` | `bool` | `false` | Do not require purchased credits (GCVE is typically a lab/evaluation scenario). `{{UIMeta group=0 order=104}}` |
| `enable_purge` | `bool` | `true` | Permit full deletion of all resources on destroy. `{{UIMeta group=0 order=105}}` |
| `public_access` | `bool` | `true` | Module is visible to all platform users. `{{UIMeta group=0 order=106}}` |
| `resource_creator_identity` | `string` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Terraform service account. Must hold `roles/owner` in the destination project. `{{UIMeta group=0 order=107}}` |
| `deployment_id` | `string` | `null` | Short alphanumeric suffix for resource names. Auto-generated (2-byte hex) when null or empty. `{{UIMeta group=0 order=108}}` |

---

## §4 · Project & Region (Group 1)

| Variable | Type | Default | Description |
|---|---|---|---|
| `existing_project_id` | `string` | `""` | GCP project ID where GCVE resources are deployed. The project must already exist — this module does not create it. `{{UIMeta group=1 order=101}}` |
| `region` | `string` | `"us-west2"` | GCP region for the private cloud and network policy. Must match a region where GCVE is available and the selected `node_type_id` is in stock. `{{UIMeta group=1 order=103}}` |
| `zone` | `string` | `"us-west2-a"` | GCP zone for the private cloud management cluster and jump host VM. Must be within `region`. `{{UIMeta group=1 order=104}}` |
| `enable_services` | `bool` | `true` | Automatically enable required GCP APIs (`vmwareengine`, `vmmigration`, `compute`, `cloudresourcemanager`, `iam`, `iamcredentials`). Set `false` when these APIs are already enabled. `{{UIMeta group=1 order=105}}` |

---

## §5 · Private Cloud (Group 4)

The private cloud is the central GCVE resource. It provisions vSphere, vSAN, NSX-T Manager,
and HCX Manager appliances in the specified zone. Provisioning takes **30–90 minutes**.

> **`management_cidr` is immutable.** It cannot be changed after the private cloud is created
> without destroying and recreating the entire private cloud. Plan this CIDR carefully before
> first deployment.

| Variable | Type | Default | Description |
|---|---|---|---|
| `management_cidr` | `string` | `"172.20.0.0/24"` | CIDR block for the GCVE management cluster (vCenter, NSX-T, HCX). A `/24` is the minimum required. Must not overlap with `edge_services_cidr` or any peered VPC subnet. **Immutable after creation.** `{{UIMeta group=4 order=402}}` |
| `private_cloud_type` | `string` | `"TIME_LIMITED"` | Private cloud deployment type. `"TIME_LIMITED"` provisions a single-node evaluation cloud (no SLA, limited duration). `"STANDARD"` provisions a production cloud with a minimum of 3 nodes. Options: `TIME_LIMITED`, `STANDARD`. `{{UIMeta group=4 order=403}}` |
| `node_type_id` | `string` | `"standard-72"` | VMware Engine node type. The UI shows `"ve1-standard-72"` but the API requires `"standard-72"`. Other valid values: `"standard-128"`, `"ve2-standard-64"`, `"ve2-large-64"`. Availability is zone-dependent. `{{UIMeta group=4 order=404}}` |
| `node_count` | `number` | `1` | Number of nodes in the management cluster. Must be `1` for `TIME_LIMITED`. `STANDARD` requires a minimum of `3`. `{{UIMeta group=4 order=405}}` |

---

## §6 · Network Peering (Group 5)

VPC peering connects the VMware Engine Network to the peer VPC so that GCVE management
appliances are reachable from the peer VPC (and vice versa). Custom routes are exported and
imported in both directions so NSX-T segments are automatically propagated to the peered VPC
routing table.

> Peering activates fully only after the private cloud is provisioned. The `network_peering_state`
> output shows `"ACTIVE"` once the private cloud is ready.

| Variable | Type | Default | Description |
|---|---|---|---|
| `create_vpc` | `bool` | `true` | Create the peer VPC network. Set `false` to reuse an existing VPC — in this case you must also set `create_default_firewall_rules = false` and create the peering manually. `{{UIMeta group=5 order=503}}` |

The peer VPC created when `create_vpc = true` uses `auto_create_subnetworks = true`
(auto-mode), which creates subnets in all regions with the `10.128.0.0/9` range.

---

## §7 · Network Policy (Group 6)

The network policy controls internet access and external IP allocation for GCVE workload VMs.
Activation can take up to **15 minutes** after apply. GCVE enforces one network policy per
VMware Engine Network — if a prior failed deployment left an orphaned policy, subsequent applies
will fail with `"Resource for the given network already exists"`.

> **Recovery from orphaned policy:**
> ```bash
> gcloud vmware network-policies list \
>   --project=PROJECT_ID --location=REGION \
>   --impersonate-service-account=SA_EMAIL
> gcloud vmware network-policies delete POLICY_NAME \
>   --project=PROJECT_ID --location=REGION \
>   --impersonate-service-account=SA_EMAIL --quiet
> ```
> If no policy appears in the list but the error persists, the policy is stuck in GCP internal
> state — contact GCP support to purge it.

| Variable | Type | Default | Description |
|---|---|---|---|
| `edge_services_cidr` | `string` | `"10.11.2.0/26"` | CIDR for VMware Engine edge services (internet ingress/egress). Must not overlap with `management_cidr` or any peered VPC subnet. A `/26` provides 64 addresses, which is the minimum recommended. `{{UIMeta group=6 order=602}}` |
| `enable_internet_access` | `bool` | `true` | Enable internet access from GCVE workload VMs via the edge services CIDR. `{{UIMeta group=6 order=603}}` |
| `enable_external_ip` | `bool` | `true` | Enable external IP address allocation for GCVE workload VMs. `{{UIMeta group=6 order=604}}` |

---

## §8 · Firewall Rules (Group 7)

When `create_default_firewall_rules = true`, four firewall rules are created on the peer VPC,
mirroring the default rules GCP creates on the auto-mode `default` VPC. One additional rule
(`allow-http`) is always created for the jump host.

| Rule | Ports | Source | Purpose |
|---|---|---|---|
| `altostrat-<id>-allow-internal` | All protocols | `internal_traffic_cidr` | Allow all traffic between VPC instances. |
| `altostrat-<id>-allow-ssh` | TCP 22 | `0.0.0.0/0` | SSH from any source. |
| `altostrat-<id>-allow-rdp` | TCP 3389 | `0.0.0.0/0` | RDP from any source — required for jump host access. |
| `altostrat-<id>-allow-icmp` | ICMP | `0.0.0.0/0` | Ping from any source. |
| `altostrat-<id>-allow-http` | TCP 80, 443 | `0.0.0.0/0` | HTTP/HTTPS to `jump-host` tagged instances. Always created. |

| Variable | Type | Default | Description |
|---|---|---|---|
| `create_default_firewall_rules` | `bool` | `true` | Create the four default VPC firewall rules. Set `false` if they already exist on the target VPC to avoid a duplicate-resource error. `{{UIMeta group=7 order=701}}` |
| `internal_traffic_cidr` | `string` | `"10.128.0.0/9"` | Source CIDR for the allow-internal rule. Matches the default VPC auto-mode subnet range. Override if using a custom-mode VPC with a different CIDR. `{{UIMeta group=7 order=702}}` |

---

## §9 · Jump Host (Group 8)

A Windows Server 2022 Compute Engine VM used to access vCenter, NSX-T Manager, and HCX Manager
consoles via RDP. The jump host is deployed on the peer VPC and has routed access to GCVE
management appliances once VPC peering is active.

> **Administrator password:** The Windows administrator password must be set manually via
> **"Set Windows Password"** in the GCP Console after the instance is created. The instance
> uses the `cloud-platform` service account scope for full API access from Cloud Shell.

| Variable | Type | Default | Description |
|---|---|---|---|
| `create_jump_host` | `bool` | `true` | Deploy the Windows Server 2022 jump host VM. Set `false` to skip when you have an existing bastion host or use Cloud Shell exclusively. `{{UIMeta group=8 order=801}}` |
| `jump_host_machine_type` | `string` | `"e2-medium"` | Machine type for the jump host. `e2-medium` (1 vCPU, 4 GB) is sufficient for console access. Increase if using the jump host for HCX migration traffic. `{{UIMeta group=8 order=803}}` |
| `jump_host_boot_disk_size_gb` | `number` | `50` | Boot disk size in GB. Minimum 50 GB recommended for Windows Server 2022. Uses `pd-balanced` disk type. `{{UIMeta group=8 order=804}}` |
| `jump_host_subnetwork` | `string` | `""` | Subnetwork self-link or name for the jump host NIC. Leave empty to let GCP auto-select the auto-mode subnet for the zone's region. Required for custom-mode VPCs. `{{UIMeta group=8 order=805}}` |

---

## §10 · vCenter Credentials (Group 9)

When `reset_vcenter_credentials = true`, a `null_resource` provisioner runs
`gcloud vmware private-clouds vcenter credentials reset` after the private cloud is provisioned.
The new credentials are printed to Cloud Build logs. These credentials are required for
registering the Migrate to Virtual Machines (M2VM) connector against the vCenter source.

The provisioner first checks the private cloud state; if it is not `ACTIVE`, it skips the
reset and prints manual instructions.

| Variable | Type | Default | Description |
|---|---|---|---|
| `reset_vcenter_credentials` | `bool` | `true` | Reset and retrieve vCenter solution user credentials after provisioning. Requires `gcloud` in the Terraform runner environment (Cloud Build). `{{UIMeta group=9 order=901}}` |
| `vcenter_solution_user` | `string` | `"solution-user-01@gve.local"` | vCenter solution user account to reset. Used for Migrate to Virtual Machines connector integration. `{{UIMeta group=9 order=902}}` |

---

## §11 · Outputs

| Output | Description |
|---|---|
| `deployment_id` | Module deployment ID (the `<id>` suffix in all resource names). |
| `project_id` | GCP project ID where resources were deployed. |
| `vmware_engine_network_id` | Full resource ID of the VMware Engine Network. |
| `private_cloud_id` | Full resource ID of the GCVE private cloud. |
| `vcenter_fqdn` | vCenter Server FQDN. Access the vSphere Client from the jump host browser using this URL. |
| `nsx_fqdn` | NSX-T Manager FQDN. Access the NSX-T console from the jump host browser. |
| `hcx_fqdn` | HCX Manager FQDN. |
| `network_peering_state` | Current state of the VPC peering. Shows `"ACTIVE"` once the private cloud is fully provisioned. |
| `network_policy_id` | Full resource ID of the VMware Engine Network Policy. |

---

## §12 · Required Providers

Declared in `versions.tf`:

| Provider | Source | Version |
|---|---|---|
| Terraform | — | `>= 1.3` |
| `google` | `hashicorp/google` | `>= 5.0, < 6.0` |
| `random` | `hashicorp/random` | `>= 3.0` |
| `null` | `hashicorp/null` | `>= 3.0` |
| `external` | `hashicorp/external` | `>= 2.0` |

---

## §13 · Notable Behaviour

### CIDR planning

Three CIDRs must be allocated without overlap before first deployment:

| CIDR | Variable | Default | Purpose |
|---|---|---|---|
| Management CIDR | `management_cidr` | `172.20.0.0/24` | GCVE management cluster (vCenter, NSX-T, HCX). **Immutable.** |
| Edge services CIDR | `edge_services_cidr` | `10.11.2.0/26` | Internet ingress/egress for GCVE workload VMs. |
| Peer VPC subnets | Auto-mode | `10.128.0.0/9` | Jump host and general VPC connectivity. |

### Destroy behaviour

Destroy is handled by the managed resources themselves:
- `google_vmwareengine_private_cloud` has a 180-minute `delete` timeout.
- The network policy is deleted before the VEN via implicit `depends_on` ordering.
- There are no destroy provisioners — concurrent gcloud + Terraform deletion would cause
  race conditions.

### Credential output

vCenter credentials are printed to Cloud Build (or local) stdout during apply. They are not
stored in Terraform state. If the reset fails (e.g. because the cloud is not yet `ACTIVE`),
manual instructions are printed.

---

## §14 · Usage Example

```hcl
module "vmware_engine" {
  source = "./modules/VMware_Engine"

  existing_project_id = "my-gcp-project"
  region              = "us-west2"
  zone                = "us-west2-a"

  # Private cloud
  management_cidr    = "172.20.0.0/24"
  private_cloud_type = "TIME_LIMITED"
  node_type_id       = "standard-72"
  node_count         = 1

  # Network policy
  edge_services_cidr = "10.11.2.0/26"
  enable_internet_access = true
  enable_external_ip     = true

  # Jump host
  create_jump_host           = true
  jump_host_machine_type     = "e2-medium"
  jump_host_boot_disk_size_gb = 50

  # vCenter credentials
  reset_vcenter_credentials = true
  vcenter_solution_user     = "solution-user-01@gve.local"
}

output "vcenter_url" {
  value = module.vmware_engine.vcenter_fqdn
}
```

### After deployment

```bash
# Get console access URLs (use from the jump host browser)
tofu output vcenter_fqdn
tofu output nsx_fqdn
tofu output hcx_fqdn

# Verify peering is active
tofu output network_peering_state  # → "ACTIVE" once private cloud is ready

# If credentials were not reset automatically (cloud not yet ACTIVE), reset manually:
gcloud vmware private-clouds vcenter credentials reset \
  --private-cloud=altostrat-<id>-private-cloud \
  --username=solution-user-01@gve.local \
  --location=us-west2-a \
  --project=my-gcp-project \
  --no-async

gcloud vmware private-clouds vcenter credentials describe \
  --private-cloud=altostrat-<id>-private-cloud \
  --username=solution-user-01@gve.local \
  --location=us-west2-a \
  --project=my-gcp-project \
  --format=json
```
