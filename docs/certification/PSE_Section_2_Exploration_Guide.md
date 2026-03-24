# PSE Certification Preparation Guide: Exploring Section 2 (Securing communications and establishing boundary protection)

This guide is designed to help candidates preparing for the Google Cloud Professional Security Engineer (PSE) certification. It focuses specifically on Section 2 of the exam guide (Securing communications and establishing boundary protection, which covers ~22% of the exam) by walking you through how these concepts are practically implemented in Google Cloud. You can experiment with these configurations directly through your web-based deployment portal.

---

## 2.1 Designing and configuring perimeter security

### Concept
Configuring network perimeter controls, Cloud NGFW, IAP, load balancers, and web application firewalls (WAF).

### Implementation Context
*   **Perimeter Controls:** By enabling features like `enable_cloud_armor` or `enable_iap` in the portal, the environment configures a Global External Application Load Balancer to protect the application.
*   **Web Application Firewalls:** Cloud Armor is configured with WAF policies (e.g., OWASP Top 10 protection) to defend against common web exploits.

### Exploration
*   Go to **Network Security > Cloud Armor**. Inspect the security policy attached to the load balancer. Review the default rules and check the 'Targets' tab to confirm it is protecting the backend service routing to your application.

### Customization
*   In your deployment portal, add your current public IP address to the `admin_ip_ranges` setting. Apply the changes and view the Cloud Armor policy in the console to see the explicit 'allow' rule prioritized above the default WAF rules, demonstrating how exception handling and IP-based access controls work at the edge.

---

## 2.2 Configuring boundary segmentation

### Concept
VPC properties, VPC peering, network isolation, and VPC Service Controls.

### Implementation Context
*   **Network Isolation:** Cloud SQL instances and Redis caches are deployed with private IPs within the VPC, isolating them from the public internet.
*   **VPC Service Controls:** If `enable_vpc_sc` is activated in the portal, the environment enforces VPC Service Controls perimeters around the GCP APIs used, preventing data exfiltration.
*   **GKE Network Policies:** The GKE deployment utilizes GKE Dataplane V2 to enforce micro-segmentation via Kubernetes NetworkPolicies.

### Exploration
*   **VPC and SQL:** Navigate to **VPC network > VPC networks** and inspect the subnets. Go to **SQL** and verify the instance only has a Private IP address.
*   **GKE:** Connect to the cluster and use `kubectl get networkpolicies -A` to view the intra-cluster segmentation rules that restrict pod-to-pod communication.

### Customization
*   Try to connect to the Cloud SQL instance from a Cloud Shell environment (which is outside the VPC). The connection will timeout. Then, deploy a tiny test VM inside the same VPC network and attempt the connection again to prove network isolation boundaries.

---

## 2.3 Establishing private connectivity

### Concept
Private connectivity between VPC networks, on-premises hosts, and Google APIs.

### Implementation Context
*   **Private connectivity to internal resources:** The Cloud Run deployment uses Direct VPC Egress (configurable via `vpc_egress_setting`) to securely route outbound traffic from the serverless environment into the VPC network, allowing it to reach internal resources like Cloud SQL without traversing the public internet. The GKE deployment uses VPC-native clusters for secure internal communication.

### Exploration
*   Go to **Cloud Run**, select the service, and check the **Networking** tab. Review the "VPC network egress" settings to confirm whether 'All Traffic' or 'Private Ranges Only' is being routed internally.

### Customization
*   In your deployment portal, change the `vpc_egress_setting` from 'PRIVATE_RANGES_ONLY' to 'ALL_TRAFFIC'. Deploy the change and consider the impact: now, even requests from your container to external public APIs will be routed through your VPC, potentially allowing you to inspect them using Cloud NAT logging or Firewall Rules.
