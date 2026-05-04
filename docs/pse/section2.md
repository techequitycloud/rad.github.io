# PSE Certification Preparation Guide: Section 2 — Securing communications and establishing boundary protection (~22% of the exam)
<YouTubeEmbed videoId="caJp5wZT_N4" poster="https://storage.googleapis.com/rad-public-2b65/gcp/pse_section2.png" />

<br/>

[Download PDF](https://storage.googleapis.com/rad-public-2b65/gcp/pse_section2.pdf)



This guide helps candidates preparing for the Google Cloud Professional Cloud Security Engineer (PSE) certification explore Section 2 of the exam through the lens of the Tech Equity RAD platform at [https://radmodules.dev](https://radmodules.dev). Three modules are relevant to this section: **GCP Services**, which establishes the foundational shared infrastructure; **App CloudRun**, which deploys serverless containerised applications on Cloud Run; and **App GKE**, which deploys containerised workloads on GKE Autopilot.

You interact with each module by configuring its variables in the RAD UI deployment portal, then exploring the resulting infrastructure in the GCP Console. This guide maps each exam topic to the relevant variables you can configure and the console locations where you can observe the outcomes. It also highlights PSE objectives that are *not* currently implemented by these modules, providing guidelines for self-guided research and exploration.

---

## 2.1 Designing and configuring perimeter security

### Cloud Armor WAF and Global Load Balancer
**Concept:** Deploying a perimeter layer that inspects and filters all inbound traffic before it reaches any application workload.

**In the RAD UI:**
*   **Web Application Firewall (WAF):** Activating `enable_cloud_armor` (Group 9 for App CloudRun, Group 13 for App GKE) deploys a Global External Application Load Balancer and attaches a Cloud Armor security policy enforcing the OWASP Top 10 preconfigured rule sets (blocking SQL injection, cross-site scripting, remote file inclusion, and other common web exploits). Adaptive Protection is also enabled, providing AI-driven anomaly detection and automatic DDoS mitigation rule recommendations.
*   **Identity-Aware Proxy (IAP):** When `enable_iap` (Group 4) is also enabled, IAP is added as a second perimeter layer on top of Cloud Armor — Cloud Armor filters by threat signature and rate-limits at the edge, while IAP verifies authenticated identity before any request reaches the backend.

**Console Exploration:**
Navigate to **Network Security > Cloud Armor**. Inspect the security policy attached to the load balancer backend. Review the individual WAF rules, their priority order, and the default action. Click the **Targets** tab to confirm the policy is bound to the backend service routing to your application. Click **Logs** to see requests evaluated (and potentially blocked) by the policy in real time.

**Real-world example:** An e-commerce company enables Cloud Armor's OWASP CRS rules on its checkout API. During a promotional event, Cloud Armor's Adaptive Protection module detects an unusual spike in requests from an Eastern European ASN matching credential-stuffing patterns. It automatically generates a recommended rate-limiting rule targeting that ASN — which an on-call engineer approves with a single click from the Cloud Armor console, reducing the mitigation time from hours of manual firewall work to under two minutes.

### 💡 Additional Perimeter Security Objectives & Learning Guidelines
*   **Cloud Next Generation Firewall (Cloud NGFW):** Cloud NGFW extends firewall capabilities beyond stateful allow/deny rules to include Layer 7 application-layer inspection (parsing protocols like HTTP, DNS, and TLS to identify application intent), FQDN-based rules (allowing or denying traffic to specific domain names rather than IP addresses), and integration with Google's threat intelligence feeds. Research Cloud NGFW firewall policies — both Hierarchical (attached at org/folder level, enforced before VPC rules) and Network (attached to a specific VPC). Navigate to **VPC network > Firewall policies** to explore the evaluation order.
*   **Certificate Authority Service (CAS):** Research how CAS provides a managed, private Certificate Authority for issuing TLS certificates within your organization. CAS is used for mutual TLS (mTLS) authentication between services — where both client and server present certificates — providing cryptographic service identity verification stronger than IP-based controls. Navigate to **Security > Certificate Authority Service** to explore CA pool creation, subordinate CA configuration, and certificate issuance. Understand the difference between a Root CA (self-signed, highest trust anchor) and a Subordinate CA (signed by Root, used for day-to-day issuance).
*   **Secure Web Proxy (SWP):** Research Secure Web Proxy as an explicit forward proxy for outbound HTTP(S) traffic from GCP workloads to the internet. Unlike Cloud NAT (which provides source IP masquerading without content inspection), SWP applies URL filtering policies — blocking access to disallowed domains, enforcing safe browsing categories, and logging all outbound requests for audit purposes. Navigate to **Network Security > Secure Web Proxy** to explore policy and gateway configuration.
*   **Cloud DNS Security Settings:** Study how to enable DNSSEC on Cloud DNS public zones to cryptographically sign DNS records, preventing DNS spoofing and cache poisoning attacks. Understand DNS Response Policy Zones (RPZ), which allow you to intercept and override DNS responses for known-malicious domains — effectively blocking resolution of C2 (command-and-control) infrastructure. Navigate to **Network Services > Cloud DNS** and explore DNSSEC configuration on a public zone.
*   **Continually Monitoring and Restricting Configured APIs:** Navigate to **APIs & Services > Enabled APIs & Services** to audit which APIs are active in your project. Every enabled but unused API represents unnecessary attack surface. Research the Organization Policy `constraints/serviceuser.services` to restrict which APIs can be enabled across projects. Understand how to scope API keys to specific APIs, HTTP referrers, or IP address ranges to limit the impact of key compromise.

---

## 2.2 Configuring boundary segmentation

### VPC Network Isolation and VPC Service Controls
**Concept:** Isolating services behind private network boundaries and preventing data exfiltration at the API level, independent of IAM permissions.

**In the RAD UI:**
*   **Private-IP Cloud SQL:** Cloud SQL instances are provisioned with private IP addresses only — accessible exclusively from workloads within the same VPC. No public internet access is configured.
*   **VPC Service Controls:** Enabling `enable_vpc_sc` (Group 10 in GCP Services) creates a VPC Service Perimeter around the project's Google APIs. Requests to APIs within the perimeter (Cloud Storage, BigQuery, Cloud SQL, Secret Manager) are blocked unless they originate from within the trusted perimeter boundary — even from authenticated, authorized identities outside the perimeter.
*   **GKE Network Policies:** The App GKE module uses GKE Dataplane V2 (eBPF-based Cilium) to enforce Kubernetes NetworkPolicies, creating microsegmentation between pods so that only explicitly permitted pod-to-pod traffic is allowed.

**Console Exploration:**
Navigate to **VPC network > VPC networks** and inspect the subnets. Go to **SQL** and verify the Cloud SQL instance displays only a Private IP (no Public IP). Navigate to **Security > VPC Service Controls** to view the service perimeter definition, the services it restricts, and any access levels or ingress/egress rules. For GKE: connect to the cluster via Cloud Shell and run `kubectl get networkpolicies -A` to view active microsegmentation rules.

**Real-world example:** A financial institution uses VPC Service Controls to protect their Cloud Storage bucket containing pre-trade research reports. Even if a data analyst's credentials are stolen and used from the attacker's home network, the API call to list or download objects is blocked by the perimeter — the attacker receives a VPC Service Controls violation error regardless of IAM permissions. This provides a second layer of exfiltration protection that IAM alone cannot offer, because IAM controls *who* can access resources but not *from where*.

### 💡 Additional Boundary Segmentation Objectives & Learning Guidelines
*   **Shared VPC Architecture:** Understand the Host/Service project model: a Host project owns the VPC networks and subnets, while Service projects attach to the Host and deploy workloads into shared subnets. This centralizes network security administration (firewall rules, subnets, routes) in one team while allowing delegated resource management in Service projects. Navigate to **VPC network > Shared VPC** in a Host project to explore subnet sharing and IAM delegation.
*   **VPC Peering vs. Shared VPC:** Understand that VPC peering connects two separate VPCs at the routing layer (traffic flows between them, but each VPC retains its own firewall rules and administration; peering is non-transitive and requires non-overlapping IP ranges). Shared VPC uses a single VPC shared across multiple projects with centralized administration. Know when each is appropriate: Shared VPC for centralized security governance within an organization; VPC peering for connecting distinct business units or partner networks that should remain administratively separate.
*   **N-Tier Application Network Isolation:** Practice designing firewall rules for a multi-tier application: a web tier subnet that accepts HTTPS from the internet via a load balancer (no external IPs on VMs); an application tier subnet reachable only from the web tier on a specific port (enforced by firewall rules using network tags); and a data tier subnet reachable only from the application tier on the database port. Each tier uses network tags (`web-tier`, `app-tier`, `data-tier`) as firewall rule targets, enabling precise directional access control independent of IP addresses.

---

## 2.3 Establishing private connectivity

### Direct VPC Egress for Cloud Run
**Concept:** Routing all workload traffic through the private VPC to prevent exposure of internal resources over the public internet.

**In the RAD UI:**
*   **Direct VPC Egress:** The `vpc_egress_setting` variable (Group 4 for App CloudRun) controls whether Cloud Run routes only traffic to private RFC 1918 ranges or all outbound traffic (`ALL_TRAFFIC`) through the VPC. Setting `ALL_TRAFFIC` means even requests to external public APIs from the container traverse the VPC first, enabling Cloud NAT logging, firewall rule inspection, and consistent egress IP visibility.

**Console Exploration:**
Go to **Cloud Run > [service] > Networking** tab. Review the VPC network egress setting. Go to **Network Connectivity > Private Service Connect** to see the managed endpoint through which Cloud SQL traffic is routed privately from within the VPC, without traversing the public Google API endpoints.

**Real-world example:** A Cloud Run service processing payment data uses Direct VPC Egress with `ALL_TRAFFIC`. All outbound traffic — including calls to the payment gateway's public API — exits through a Cloud NAT gateway with a static, reserved IP address. The payment gateway's IP allowlist is configured with this static NAT IP, so only traffic from the company's designated NAT gateway can reach the payment API. A rogue Cloud Run revision deployed outside this configuration would fail to reach the payment gateway, providing an additional security boundary beyond IAM.

### 💡 Additional Private Connectivity Objectives & Learning Guidelines
*   **Private Google Access:** Research how Private Google Access allows VM instances with no external IP addresses to reach Google APIs (Cloud Storage, BigQuery, Pub/Sub, etc.) using their internal IP addresses via Google's private network. Enable it per subnet: **VPC network > [subnet] > Private Google Access: On**. Understand the distinction between standard Private Google Access (uses the `private.googleapis.com` VIP at 199.36.153.8/30) and Restricted Google Access (`restricted.googleapis.com` at 199.36.153.4/30, which only allows APIs compatible with VPC Service Controls perimeters — blocking exfiltration via unsupported APIs).
*   **HA VPN and Cloud Interconnect:** Study HA VPN for encrypted site-to-site connectivity between on-premises and GCP (two VPN tunnels across two Google edge routers, 99.99% uptime SLA, up to ~3 Gbps per tunnel). Understand when Cloud Interconnect is appropriate: Dedicated Interconnect provides a direct physical connection (10 or 100 Gbps, unencrypted by default — use MACsec for encryption at the physical layer) for high-bandwidth, low-latency requirements. Navigate to **Network Connectivity > VPN** and **Interconnect** in the console to compare configuration requirements and routing (BGP is required for both).
*   **Cloud NAT:** Understand how Cloud NAT provides outbound internet access for VM instances and serverless workloads that have no external IP addresses, without exposing any inbound ports. Cloud NAT logs (enable via the NAT gateway settings) capture every outbound connection's source IP, destination, and port — useful for auditing and anomaly detection. Navigate to **Network Services > Cloud NAT** to review configuration and enable logging.
*   **Private Service Connect for Google APIs:** Research how Private Service Connect (PSC) allows you to consume Google Cloud APIs through private IP addresses internal to your VPC, rather than routing to shared public API endpoints. PSC endpoints appear as regular internal IP addresses in your VPC, meaning API traffic never leaves the Google network. Navigate to **Network Connectivity > Private Service Connect > Published services** to explore available Google-managed endpoints and how to create consumer forwarding rules.
