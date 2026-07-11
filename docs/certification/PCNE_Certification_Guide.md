---
title: "Professional Cloud Network Engineer (PCNE) Certification Lab Map"
description: "Map every Professional Cloud Network Engineer (PCNE) exam domain to hands-on RAD deployment labs on Google Cloud — a practical, exam-aligned study path."
---

# Professional Cloud Network Engineer (PCNE) Certification Lab Map
> 📚 **Official exam guide:** [Professional Cloud Network Engineer certification](https://cloud.google.com/learn/certification/cloud-network-engineer) — always confirm section weightings against the current Google Cloud exam guide.


The Professional Cloud Network Engineer certification validates the ability to design, implement, and operate Google Cloud VPC networks, hybrid connectivity, network services (load balancing, CDN, DNS), and network security. The RAD platform's four foundation modules — `Services_GCP` (custom-mode VPC, subnets, firewall rules, Cloud NAT, private services access, GKE VPC-native clusters), `App_CloudRun` (Direct VPC egress, serverless NEGs, global external Application Load Balancer, Cloud Armor, Cloud CDN), `App_GKE` (Gateway API, Kubernetes NetworkPolicy, GCPBackendPolicy), and `App_Common` (network discovery, VPC-SC) — give you a live, modifiable lab for roughly half of this exam. The other half (Interconnect, VPN, BGP, Network Connectivity Center, Cloud DNS, NGFW, Network Intelligence Center) is deliberately *not* implemented by the modules; this guide is honest about those gaps and tells you exactly what to study outside the platform. Expect to lean on the "Beyond the modules" blocks more heavily here than in any other RAD certification guide.

## How to use this guide

- Deploy one of the profiles below through your deployment portal, then work through the matching section exploration guide while the infrastructure is live.
- Use the coverage legend to plan your study time: ✅ topics can be learned hands-on in RAD; 📘 topics need official docs and a scratch project.
- The PCNE exam is scenario-heavy. After each "Try it", ask yourself *why* the modules made each choice (e.g., why a /16 PSA range, why Dataplane V2, why a global external ALB).

**Coverage legend**

| Symbol | Meaning |
|---|---|
| ✅ | Fully demonstrated — deploy it, see it, modify it in the RAD platform |
| 🟡 | Partially demonstrated — the modules touch the concept; supplement with docs |
| 📘 | Concept-only — not implemented by the modules; study pointers provided |

## Deployment profiles

### Profile: VPC Foundation
*Purpose:* Custom-mode VPC, subnets, firewall rules, Cloud Router + Cloud NAT, and private services access — the core of Sections 1, 2, and 6.3.
*Modules:* `Services_GCP`, then `App_CloudRun` on top.
| Variable | Value |
|---|---|
| `availability_regions` | `["us-central1"]` (default) |
| `subnet_cidr_range` | `["10.0.0.0/24"]` (default) |
| `create_postgres` | `true` (default — forces the PSA peering to be exercised) |
| `create_network_filesystem` | `true` (default — tag-based firewall rules + TCP health checks) |
| `vpc_egress_setting` (App_CloudRun) | `PRIVATE_RANGES_ONLY` (default) |
*Estimated incremental cost:* Low — a `db-custom-1-3840` Cloud SQL instance and one e2-small NFS VM dominate; the VPC, NAT gateway, and firewall rules are cents per day.

### Profile: GKE Network Lab
*Purpose:* VPC-native cluster with named secondary ranges, Dataplane V2, Kubernetes NetworkPolicy, and Workload Identity — Sections 1.4, 2.4, and 6.2.
*Modules:* `Services_GCP` (with GKE), then `App_GKE`.
| Variable | Value |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `gke_cluster_mode` | `AUTOPILOT` (default) |
| `gke_cluster_count` | `1` (set `2` + `configure_cloud_service_mesh = true` for the multi-cluster east-west firewall variant) |
| `gke_subnet_base_cidr` / `gke_pod_base_cidr` / `gke_service_base_cidr` | defaults `10.128.0.0/12` / `10.64.0.0/10` / `10.8.0.0/16` |
| `enable_network_segmentation` (App_GKE) | `true` |
| `service_type` (App_GKE) | `LoadBalancer` (default) |
*Estimated incremental cost:* Moderate — Autopilot bills per pod resource request; a second cluster plus Cloud Service Mesh roughly doubles it.

### Profile: Global Edge
*Purpose:* Global external Application Load Balancer, serverless NEG, Cloud Armor WAF, Cloud CDN, Certificate Manager, static global IPs — Sections 3.1, 3.2, 6.1.
*Modules:* `App_CloudRun` (and/or `App_GKE` for the Gateway API equivalent).
| Variable | Value |
|---|---|
| `enable_cloud_armor` | `true` |
| `application_domains` | `["app.example.com"]` (required by App_CloudRun validation when Cloud Armor is on) |
| `enable_cdn` | `true` |
| `admin_ip_ranges` | your office/VPN CIDRs (priority-100 WAF allowlist on both engines; also a VPC-SC access level on App_CloudRun) |
| `enable_custom_domain` (App_GKE) | `true` |
| `reserve_static_ip` (App_GKE) | `true` (default) |
*Estimated incremental cost:* Moderate — forwarding-rule hours, Cloud Armor policy + per-request charges, and CDN cache egress are the drivers.

### Profile: Locked-Down Perimeter
*Purpose:* VPC Service Controls perimeter, restricted Google API egress, all-traffic VPC egress — Sections 2.1 and 6.2/6.3 defense-in-depth.
*Modules:* `Services_GCP` or either app module (all carry the VPC-SC variables).
| Variable | Value |
|---|---|
| `enable_vpc_sc` | `true` |
| `admin_ip_ranges` | non-empty (required, or VPC-SC is skipped with a warning) |
| `vpc_sc_dry_run` | `true` (default — audit before enforcing) |
| `vpc_egress_setting` (App_CloudRun) | `ALL_TRAFFIC` |
| `enable_network_segmentation` (App_GKE) | `true` (includes the `restricted.googleapis.com` 199.36.153.4/30 egress rule) |
*Estimated incremental cost:* Low — VPC-SC and firewall/NetworkPolicy changes are free; the cost is operational (requires an organization and org-level Access Context Manager permission).

## Section 1: Designing and planning a Google Cloud VPC network (~21% of the exam)

The modules demonstrate a complete single-VPC design: custom subnet mode, deterministic CIDR planning, private services access for managed databases, and GKE secondary-range sizing. Network tiers, Shared VPC, hybrid design, and DNS topology are study-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 1.1 Designing an overall network architecture | 🟡 | `enable_cloud_armor` LB choice, PSA peering, Direct VPC egress; tiers/DNS/quotas 📘 | [Section 1 guide](PCNE_Section_1_Exploration_Guide.md#11-designing-an-overall-network-architecture) |
| 1.2 Designing VPC networks | 🟡 | custom-mode VPC, `subnet_cidr_range`, PSA /16; Shared VPC/NCC/PSC/IPv6/MTU 📘 | [Section 1 guide](PCNE_Section_1_Exploration_Guide.md#12-designing-vpc-networks) |
| 1.3 Designing a resilient and performant hybrid and multi-cloud network | 📘 | Not implemented (Cloud Router exists only as a NAT anchor) | [Section 1 guide](PCNE_Section_1_Exploration_Guide.md#13-designing-a-resilient-and-performant-hybrid-and-multi-cloud-network) |
| 1.4 Designing for Google Kubernetes Engine | ✅ | deterministically computed secondary ranges, Autopilot/Standard, public endpoint | [Section 1 guide](PCNE_Section_1_Exploration_Guide.md#14-designing-for-google-kubernetes-engine) |

## Section 2: Implementing a VPC network (~20% of the exam)

This is the strongest section for hands-on work: every deployment creates (or discovers) a VPC, subnets, firewall rules, a PSA peering with custom-route exchange, and a VPC-SC perimeter if enabled. Shared VPC, policy-based routing, and NCC are study-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 2.1 Configuring VPCs | ✅ | VPC/subnets/firewall, PSA range, VPC-SC perimeters; Shared VPC 📘 | [Section 2 guide](PCNE_Section_2_Exploration_Guide.md#21-configuring-vpcs) |
| 2.2 Configuring VPC routing | 🟡 | Cloud Router (NAT-only, ASN 64514), peering route import/export; policy-based routing/ILB next hop 📘 | [Section 2 guide](PCNE_Section_2_Exploration_Guide.md#22-configuring-vpc-routing) |
| 2.3 Configuring Network Connectivity Center | 📘 | Not implemented | [Section 2 guide](PCNE_Section_2_Exploration_Guide.md#23-configuring-network-connectivity-center) |
| 2.4 Configuring and maintaining GKE clusters | ✅ | VPC-native + Dataplane V2, Kubernetes NetworkPolicy; private clusters / Cloud DNS for GKE 📘 | [Section 2 guide](PCNE_Section_2_Exploration_Guide.md#24-configuring-and-maintaining-google-kubernetes-engine-clusters) |

## Section 3: Configuring managed network services (~16% of the exam)

Both deployment engines build a global external Application Load Balancer — one from Terraform LB primitives (Cloud Run), one from the GKE Gateway API. Cloud DNS is not implemented at all.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 3.1 Configuring load balancing | ✅ | Cloud Run serverless NEG chain; GKE Gateway API; ALB traffic management 📘 | [Section 3 guide](PCNE_Section_3_Exploration_Guide.md#31-configuring-load-balancing) |
| 3.2 Configuring Cloud CDN | 🟡 | `enable_cdn` on the Cloud Run backend service (real); App_GKE flag provisions the Gateway but does not enable CDN | [Section 3 guide](PCNE_Section_3_Exploration_Guide.md#32-configuring-cloud-cdn) |
| 3.3 Configuring Cloud DNS | 📘 | Not implemented (nip.io wildcard DNS used instead) | [Section 3 guide](PCNE_Section_3_Exploration_Guide.md#33-configuring-cloud-dns) |

## Section 4: Configuring and implementing hybrid and multicloud network interconnectivity (~16% of the exam)

Entirely concept-only in RAD. The Cloud Router the modules create carries no BGP sessions — it exists solely to host Cloud NAT. Treat this section as a pure-study block; the guide gives you a structured plan and scratch-project commands.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 4.1 Configuring Cloud Interconnect | 📘 | Not implemented | [Section 4 guide](PCNE_Section_4_Exploration_Guide.md#41-configuring-cloud-interconnect) |
| 4.2 Configuring a site-to-site IPSec VPN | 📘 | Not implemented | [Section 4 guide](PCNE_Section_4_Exploration_Guide.md#42-configuring-a-site-to-site-ipsec-vpn) |
| 4.3 Configuring Cloud Router | 🟡 | NAT-only router with ASN 64514; BGP/BFD/custom advertisement 📘 | [Section 4 guide](PCNE_Section_4_Exploration_Guide.md#43-configuring-cloud-router) |
| 4.4 Configuring Network Connectivity Center | 📘 | Not implemented | [Section 4 guide](PCNE_Section_4_Exploration_Guide.md#44-configuring-network-connectivity-center) |

## Section 5: Managing, monitoring, and troubleshooting network operations (~14% of the exam)

The modules enable LB request logging (sample rate 1.0) and rich health-check/auto-healing patterns, but VPC Flow Logs, NAT logging, and firewall logging are *not* enabled — turning them on manually against the deployed VPC is itself a great exercise.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 5.1 Logging and monitoring with Google Cloud Observability | 🟡 | LB request logging on the Cloud Run backend; alert policies/uptime checks; flow/NAT/DNS logs 📘 | [Section 5 guide](PCNE_Section_5_Exploration_Guide.md#51-logging-and-monitoring-with-google-cloud-observability) |
| 5.2 Maintaining and troubleshooting connectivity | 🟡 | NFS MIG TCP health checks + auto-healing; VPN/Interconnect troubleshooting 📘 | [Section 5 guide](PCNE_Section_5_Exploration_Guide.md#52-maintaining-and-troubleshooting-connectivity-issues) |
| 5.3 Monitoring, maintaining, and troubleshooting latency and traffic flow | 📘 | Run Network Intelligence Center tools *against* RAD resources | [Section 5 guide](PCNE_Section_5_Exploration_Guide.md#53-monitoring-maintaining-and-troubleshooting-latency-and-traffic-flow) |

## Section 6: Configuring, implementing and managing a cloud network security solution (~13% of the exam)

Cloud Armor is the flagship ✅ here — both engines create a full WAF policy with preconfigured OWASP rules, Adaptive Protection, and rate limiting. Classic VPC firewall rules with tag-based micro-segmentation and Cloud NAT are also live; NGFW policies, Secure Web Proxy, and Packet Mirroring are study-only.

| Exam topic | Coverage | Where in RAD | Guide |
|---|---|---|---|
| 6.1 Implementing and managing Google Cloud Armor | ✅ | both app modules: OWASP v33 rules, Adaptive Protection, rate limiting | [Section 6 guide](PCNE_Section_6_Exploration_Guide.md#61-implementing-and-managing-google-cloud-armor) |
| 6.2 Configuring NGFW policies and VPC firewall rules | 🟡 | Tag-based VPC rules + K8s NetworkPolicy; hierarchical/NGFW tiers 📘 | [Section 6 guide](PCNE_Section_6_Exploration_Guide.md#62-configuring-ngfw-policies-and-vpc-firewall-rules) |
| 6.3 Controlling internet egress traffic with Cloud NAT and Secure Web Proxy | 🟡 | Cloud NAT (`ALL_SUBNETWORKS_ALL_IP_RANGES`, auto IPs); Secure Web Proxy 📘 | [Section 6 guide](PCNE_Section_6_Exploration_Guide.md#63-controlling-internet-egress-traffic-with-cloud-nat-and-secure-web-proxy) |
| 6.4 Implementing a self-managed network virtual appliance and Packet Mirroring | 📘 | Nearest analogue: self-managed NFS VM in a MIG; multi-NIC NVAs / Packet Mirroring 📘 | [Section 6 guide](PCNE_Section_6_Exploration_Guide.md#64-implementing-a-self-managed-network-virtual-appliance-and-packet-mirroring) |

## Suggested study sequence

1. **Week 1 — live lab (✅ topics):** Deploy VPC Foundation, work Sections 2.1–2.2, then 1.1–1.2. Add the GKE Network Lab and complete 1.4 and 2.4 while the cluster is up. These four subsections alone cover most of the hands-on weight of the exam.
2. **Week 2 — edge and security:** Deploy Global Edge; work 3.1, 3.2, 6.1 in one sitting (the LB, CDN, and Cloud Armor objects are the same deployment). Then 6.2 and 6.3 against the VPC Foundation resources, and Locked-Down Perimeter for the VPC-SC walk-through in 2.1.
3. **Week 3 — the 📘 third:** Sections 4 (all), 3.3, 2.3, 5.3, and 6.4 from docs plus the scratch-project commands in each "Beyond the modules" block. Roughly a third of the exam weight lives here; do not let the strength of the live lab tempt you into skipping it. The HA VPN lab in Section 4.2 — using the RAD VPC as one side — is the single highest-value scratch exercise.
4. **Final pass:** Re-run every "Check yourself" question cold. Tear down the lab profiles you no longer need; the GKE Network Lab and Global Edge profiles are the cost drivers.

## Key capabilities for quick reference

| Area | What it demonstrates |
|---|---|
| Services_GCP networking | Custom-mode VPC, subnets, firewall rules, Cloud Router + NAT, PSA peering with custom-route export |
| Services_GCP GKE | VPC-native clusters, deterministic secondary-range planning, Dataplane V2, Gateway API, Standard node pools |
| Services_GCP NFS appliance | Tag-targeted firewall rules, TCP health checks, MIG auto-healing (appliance ops pattern) |
| Services_GCP VPC-SC | VPC-SC perimeter, access levels, dry-run mode, permission probes |
| App_CloudRun edge | Serverless NEG → backend service → URL map → proxies → global IP; Cloud Armor; CDN; cert management |
| App_CloudRun service | Direct VPC egress, inline VPC/NAT/PSA fallback, hash-based CIDR allocation |
| App_GKE edge | Gateway API global external ALB, HTTPRoute, GCPBackendPolicy, Cloud Armor for GKE |
| App_GKE segmentation | Kubernetes NetworkPolicy micro-segmentation incl. restricted/private googleapis VIPs |
| App_Common discovery | Network/subnet/tag discovery contract (`managed-by=services-gcp`) |
