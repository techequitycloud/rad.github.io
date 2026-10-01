---
title: "Carte des labs de la certification Professional Cloud Network Engineer (PCNE)"
description: "Associez chaque domaine de l'examen Professional Cloud Network Engineer (PCNE) à des labs pratiques de déploiement RAD sur Google Cloud — un parcours d'étude concret, aligné sur l'examen."
---
<!-- translated-from: docs/certification/PCNE_Certification_Guide.md @ cb682e8 sha256:7f168005729e -->

# Carte des labs de la certification Professional Cloud Network Engineer (PCNE) {#professional-cloud-network-engineer-pcne-certification-lab-map}

> 📚 **Guide officiel de l'examen :** [Professional Cloud Network Engineer certification](https://cloud.google.com/learn/certification/cloud-network-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

La certification Professional Cloud Network Engineer valide la capacité à concevoir, mettre en œuvre et exploiter des réseaux VPC Google Cloud, la connectivité hybride, les services réseau (équilibrage de charge, CDN, DNS) et la sécurité réseau. Les quatre modules de fondation de la plateforme RAD — `Services_GCP` (VPC en mode personnalisé, sous-réseaux, règles de pare-feu, Cloud NAT, accès aux services privés, clusters GKE de VPC natif), `App_CloudRun` (sortie VPC directe, NEG sans serveur, équilibreur de charge d'application externe global, Cloud Armor, Cloud CDN), `App_GKE` (Gateway API, Kubernetes NetworkPolicy, GCPBackendPolicy) et `App_Common` (découverte réseau, VPC-SC) — vous offrent un lab réel et modifiable pour environ la moitié de cet examen. L'autre moitié (Interconnect, VPN, BGP, Network Connectivity Center, Cloud DNS, NGFW, Network Intelligence Center) n'est délibérément *pas* mise en œuvre par les modules ; ce guide est honnête sur ces lacunes et vous indique précisément ce qu'il faut étudier en dehors de la plateforme. Attendez-vous à vous appuyer davantage ici que dans tout autre guide de certification RAD sur les encadrés « Au-delà des modules ».

## Comment utiliser ce guide {#how-to-use-this-guide}

- Déployez l'un des profils ci-dessous depuis votre portail de déploiement, puis parcourez le guide d'exploration de la section correspondante pendant que l'infrastructure est en service.
- **Les paramètres d'un profil s'appliquent par une mise à jour (Update).** À la création, le formulaire de déploiement ne demande que la première page des entrées d'un module (dans un projet que RAD crée pour vous, guère plus que le nom du tenant et la région). Déployez d'abord le module, puis définissez les variables du profil avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode** (activer le mode avancé), ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour.
- **Certains paramètres nécessitent un projet que vous apportez.** Lorsqu'un déploiement est placé dans un projet géré par RAD (un projet que RAD crée pour vous), le formulaire de déploiement omet tous les paramètres qu'un module signale comme indisponibles dans ce cas — des paramètres qui dépassent le projet pour atteindre l'organisation de RAD, ou qui exigent une API que les paliers gérés par RAD n'autorisent pas. Dans ce guide, cela concerne `enable_vpc_sc`, ainsi que `gke_cluster_count` et `configure_cloud_service_mesh` pour la variante multicluster ; déployez les profils qui les définissent dans votre propre projet Google Cloud.
- Utilisez la légende de couverture pour planifier votre temps d'étude : les sujets ✅ peuvent être appris de façon pratique dans RAD ; les sujets 📘 nécessitent la documentation officielle et un projet de test.
- L'examen PCNE repose beaucoup sur des scénarios. Après chaque « Essayez », demandez-vous *pourquoi* les modules ont fait chaque choix (par exemple, pourquoi une plage PSA en /16, pourquoi Dataplane V2, pourquoi un ALB externe global).

**Légende de couverture**

| Symbole | Signification |
|---|---|
| ✅ | Entièrement démontré — déployez-le, observez-le, modifiez-le dans la plateforme RAD |
| 🟡 | Partiellement démontré — les modules abordent le concept ; complétez avec la documentation |
| 📘 | Concept uniquement — non mis en œuvre par les modules ; pistes d'étude fournies |

## Profils de déploiement {#deployment-profiles}

### Profil : VPC Foundation {#profile-vpc-foundation}
*Objectif :* VPC en mode personnalisé, sous-réseaux, règles de pare-feu, Cloud Router + Cloud NAT et accès aux services privés — le cœur des sections 1, 2 et 6.3.
*Modules :* `Services_GCP`, puis `App_CloudRun` par-dessus.
| Variable | Valeur |
|---|---|
| `availability_regions` | `["us-central1"]` (par défaut) |
| `subnet_cidr_range` | `["10.0.0.0/24"]` (par défaut) |
| `create_postgres` | `true` (par défaut — oblige à exercer l'appairage PSA) |
| `create_network_filesystem` | `true` (par défaut — règles de pare-feu basées sur des tags + vérifications d'état TCP) |
| `vpc_egress_setting` (App_CloudRun) | `PRIVATE_RANGES_ONLY` (par défaut) |
*Coût supplémentaire estimé :* Faible — une instance Cloud SQL `db-custom-1-3840` et une VM NFS e2-small dominent ; le VPC, la passerelle NAT et les règles de pare-feu coûtent quelques centimes par jour.

### Profil : GKE Network Lab {#profile-gke-network-lab}
*Objectif :* cluster de VPC natif avec plages secondaires nommées, Dataplane V2, Kubernetes NetworkPolicy et Workload Identity — sections 1.4, 2.4 et 6.2.
*Modules :* `Services_GCP` (avec GKE), puis `App_GKE`.
| Variable | Valeur |
|---|---|
| `create_google_kubernetes_engine` (Services_GCP) | `true` |
| `gke_cluster_mode` | `AUTOPILOT` (par défaut) |
| `gke_cluster_count` | `1` (définissez `2` + `configure_cloud_service_mesh = true` pour la variante multicluster avec pare-feu est-ouest) |
| `gke_subnet_base_cidr` / `gke_pod_base_cidr` / `gke_service_base_cidr` | valeurs par défaut `10.128.0.0/12` / `10.64.0.0/10` / `10.8.0.0/16` |
| `enable_network_segmentation` (App_GKE) | `true` |
| `service_type` (App_GKE) | `LoadBalancer` (par défaut) |
*Coût supplémentaire estimé :* Modéré — Autopilot facture selon les ressources demandées par pod ; un second cluster plus Cloud Service Mesh le double à peu près.

### Profil : Global Edge {#profile-global-edge}
*Objectif :* équilibreur de charge d'application externe global, NEG sans serveur, WAF Cloud Armor, Cloud CDN, Certificate Manager, adresses IP globales statiques — sections 3.1, 3.2, 6.1.
*Modules :* `App_CloudRun` (et/ou `App_GKE` pour l'équivalent Gateway API).
| Variable | Valeur |
|---|---|
| `enable_cloud_armor` | `true` |
| `application_domains` | `["app.example.com"]` (exigé par la validation d'App_CloudRun lorsque Cloud Armor est activé) |
| `enable_cdn` | `true` |
| `admin_ip_ranges` | les CIDR de votre bureau/VPN (liste d'autorisation WAF de priorité 100 sur les deux moteurs ; également un niveau d'accès VPC-SC sur App_CloudRun) |
| `enable_custom_domain` (App_GKE) | `true` |
| `reserve_static_ip` (App_GKE) | `true` (par défaut) |
*Coût supplémentaire estimé :* Modéré — les heures de règle de transfert, la stratégie Cloud Armor + les frais par requête, et le trafic sortant du cache CDN sont les principaux postes.

### Profil : Locked-Down Perimeter {#profile-locked-down-perimeter}
*Objectif :* périmètre VPC Service Controls, sortie restreinte vers les API Google, sortie VPC de tout le trafic — sections 2.1 et 6.2/6.3, défense en profondeur.
*Modules :* `Services_GCP` ou l'un ou l'autre des modules d'application (tous portent les variables VPC-SC).
| Variable | Valeur |
|---|---|
| `enable_vpc_sc` | `true` |
| `admin_ip_ranges` | non vide (obligatoire, sinon VPC-SC est ignoré avec un avertissement) |
| `vpc_sc_dry_run` | `true` (par défaut — auditer avant d'appliquer) |
| `vpc_egress_setting` (App_CloudRun) | `ALL_TRAFFIC` |
| `enable_network_segmentation` (App_GKE) | `true` (inclut la règle de sortie `restricted.googleapis.com` 199.36.153.4/30) |
*Coût supplémentaire estimé :* Faible — VPC-SC et les modifications de pare-feu/NetworkPolicy sont gratuits ; le coût est opérationnel (une organisation et l'autorisation Access Context Manager au niveau de l'organisation sont nécessaires).

## Section 1 : Conception et planification d'un réseau VPC Google Cloud (Designing and planning a Google Cloud VPC network) (~21 % de l'examen) {#section-1-designing-and-planning-a-google-cloud-vpc-network-21-of-the-exam}

Les modules démontrent une conception complète à VPC unique : mode de sous-réseau personnalisé, planification déterministe des CIDR, accès aux services privés pour les bases de données gérées et dimensionnement des plages secondaires GKE. Les niveaux de réseau, le VPC partagé, la conception hybride et la topologie DNS relèvent uniquement de l'étude.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 1.1 Conception d'une architecture réseau globale (Designing an overall network architecture) | 🟡 | choix de LB par `enable_cloud_armor`, appairage PSA, sortie VPC directe ; niveaux/DNS/rôles IAM réseau/quotas 📘 | [Guide de la section 1](PCNE_Section_1_Exploration_Guide.md#11-designing-an-overall-network-architecture) |
| 1.2 Conception de réseaux VPC (Designing VPC networks) | 🟡 | VPC en mode personnalisé, `subnet_cidr_range`, PSA /16 ; VPC partagé/NCC/PSC/IPv6/MTU/automatisation IPAM 📘 | [Guide de la section 1](PCNE_Section_1_Exploration_Guide.md#12-designing-vpc-networks) |
| 1.3 Conception d'un réseau hybride et multicloud résilient et performant (Designing a resilient and performant hybrid and multi-cloud network) | 📘 | Non mis en œuvre (Cloud Router n'existe que comme point d'ancrage de NAT) | [Guide de la section 1](PCNE_Section_1_Exploration_Guide.md#13-designing-a-resilient-and-performant-hybrid-and-multi-cloud-network) |
| 1.4 Conception pour Google Kubernetes Engine (Designing for Google Kubernetes Engine) | ✅ | plages secondaires calculées de façon déterministe, Autopilot/Standard, point de terminaison public | [Guide de la section 1](PCNE_Section_1_Exploration_Guide.md#14-designing-for-google-kubernetes-engine) |

## Section 2 : Mise en œuvre d'un réseau VPC (Implementing a VPC network) (~20 % de l'examen) {#section-2-implementing-a-vpc-network-20-of-the-exam}

C'est la section la plus riche en travail pratique : chaque déploiement crée (ou découvre) un VPC, des sous-réseaux, des règles de pare-feu, un appairage PSA avec échange de routes personnalisées et, s'il est activé, un périmètre VPC-SC. Le VPC partagé, le routage basé sur des règles et NCC relèvent uniquement de l'étude.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 2.1 Configuration des VPC (Configuring VPCs) | ✅ | VPC/sous-réseaux/pare-feu, plage PSA, périmètres VPC-SC ; VPC partagé 📘 | [Guide de la section 2](PCNE_Section_2_Exploration_Guide.md#21-configuring-vpcs) |
| 2.2 Configuration du routage VPC (Configuring VPC routing) | 🟡 | Cloud Router (NAT uniquement, ASN 64514), import/export de routes d'appairage ; routage basé sur des règles/ILB comme prochain saut 📘 | [Guide de la section 2](PCNE_Section_2_Exploration_Guide.md#22-configuring-vpc-routing) |
| 2.3 Configuration de Network Connectivity Center (Configuring Network Connectivity Center) | 📘 | Non mis en œuvre | [Guide de la section 2](PCNE_Section_2_Exploration_Guide.md#23-configuring-network-connectivity-center) |
| 2.4 Configuration et maintenance des clusters GKE (Configuring and maintaining GKE clusters) | ✅ | VPC natif + Dataplane V2, nœuds privés, Kubernetes NetworkPolicy ; point de terminaison privé / point de terminaison basé sur DNS / Cloud DNS pour GKE 📘 | [Guide de la section 2](PCNE_Section_2_Exploration_Guide.md#24-configuring-and-maintaining-gke-clusters) |

## Section 3 : Configuration des services réseau gérés (Configuring managed network services) (~16 % de l'examen) {#section-3-configuring-managed-network-services-16-of-the-exam}

Les deux moteurs de déploiement construisent un équilibreur de charge d'application externe global — l'un à partir des primitives LB de Terraform (Cloud Run), l'autre à partir de la Gateway API de GKE. Cloud DNS n'est pas du tout mis en œuvre.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 3.1 Configuration de l'équilibrage de charge (Configuring load balancing) | ✅ | chaîne NEG sans serveur de Cloud Run ; Gateway API de GKE ; gestion du trafic de l'ALB 📘 | [Guide de la section 3](PCNE_Section_3_Exploration_Guide.md#31-configuring-load-balancing) |
| 3.2 Configuration de Cloud CDN (Configuring Cloud CDN) | 🟡 | `enable_cdn` sur le service de backend Cloud Run (réel) ; l'option d'App_GKE provisionne la Gateway mais n'active pas le CDN | [Guide de la section 3](PCNE_Section_3_Exploration_Guide.md#32-configuring-cloud-cdn) |
| 3.3 Configuration de Cloud DNS (Configuring Cloud DNS) | 📘 | Non mis en œuvre (DNS générique nip.io utilisé à la place) ; inclut la migration vers Cloud DNS | [Guide de la section 3](PCNE_Section_3_Exploration_Guide.md#33-configuring-cloud-dns) |

## Section 4 : Configuration et mise en œuvre de l'interconnectivité réseau hybride et multicloud (Configuring and implementing hybrid and multicloud network interconnectivity) (~16 % de l'examen) {#section-4-configuring-and-implementing-hybrid-and-multicloud-network-interconnectivity-16-of-the-exam}

Entièrement conceptuelle dans RAD. Le Cloud Router créé par les modules ne porte aucune session BGP — il n'existe que pour héberger Cloud NAT. Traitez cette section comme un bloc d'étude pure ; le guide vous fournit un plan structuré et des commandes pour un projet de test.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 4.1 Configuration de Cloud Interconnect (Configuring Cloud Interconnect) | 📘 | Non mis en œuvre | [Guide de la section 4](PCNE_Section_4_Exploration_Guide.md#41-configuring-cloud-interconnect) |
| 4.2 Configuration d'un VPN IPSec de site à site (Configuring a site-to-site IPSec VPN) | 📘 | Non mis en œuvre | [Guide de la section 4](PCNE_Section_4_Exploration_Guide.md#42-configuring-a-site-to-site-ipsec-vpn) |
| 4.3 Configuration de Cloud Router (Configuring Cloud Router) | 🟡 | routeur NAT uniquement avec l'ASN 64514 ; BGP/BFD/annonce personnalisée 📘 | [Guide de la section 4](PCNE_Section_4_Exploration_Guide.md#43-configuring-cloud-router) |
| 4.4 Configuration de Network Connectivity Center (Configuring Network Connectivity Center) | 📘 | Non mis en œuvre | [Guide de la section 4](PCNE_Section_4_Exploration_Guide.md#44-configuring-network-connectivity-center) |

## Section 5 : Gestion, surveillance et dépannage des opérations réseau (Managing, monitoring, and troubleshooting network operations) (~14 % de l'examen) {#section-5-managing-monitoring-and-troubleshooting-network-operations-14-of-the-exam}

Les modules activent la journalisation des requêtes du LB (taux d'échantillonnage 1.0) et des modèles riches de vérification d'état et d'autoréparation, mais les journaux de flux VPC, la journalisation NAT et la journalisation du pare-feu ne sont *pas* activés — les activer manuellement sur le VPC déployé constitue en soi un excellent exercice.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 5.1 Journalisation et surveillance avec Google Cloud Observability (Logging and monitoring with Google Cloud Observability) | 🟡 | journalisation des requêtes du LB sur le backend Cloud Run ; règles d'alerte/tests de disponibilité ; journaux de flux/NAT/DNS 📘 | [Guide de la section 5](PCNE_Section_5_Exploration_Guide.md#51-logging-and-monitoring-with-google-cloud-observability) |
| 5.2 Maintenance et dépannage de la connectivité (Maintaining and troubleshooting connectivity) | 🟡 | vérifications d'état TCP du MIG NFS + autoréparation ; dépannage VPN/Interconnect 📘 | [Guide de la section 5](PCNE_Section_5_Exploration_Guide.md#52-maintaining-and-troubleshooting-connectivity-issues) |
| 5.3 Utilisation de Network Intelligence Center pour surveiller et résoudre les problèmes réseau courants (Using Network Intelligence Center to monitor and troubleshoot common networking issues) | 📘 | Exécuter les outils de Network Intelligence Center *sur* les ressources RAD | [Guide de la section 5](PCNE_Section_5_Exploration_Guide.md#53-using-network-intelligence-center-to-monitor-and-troubleshoot-common-networking-issues) |

## Section 6 : Configuration, mise en œuvre et gestion d'une solution de sécurité réseau cloud (Configuring, implementing and managing a cloud network security solution) (~13 % de l'examen) {#section-6-configuring-implementing-and-managing-a-cloud-network-security-solution-13-of-the-exam}

Cloud Armor est ici le ✅ phare — les deux moteurs créent une stratégie WAF complète avec des règles OWASP préconfigurées, Adaptive Protection et la limitation de débit. Les règles de pare-feu VPC classiques avec micro-segmentation par tags et Cloud NAT sont également en service ; les stratégies Cloud NGFW, Secure Web Proxy, Packet Mirroring et Network Security Integration relèvent uniquement de l'étude.

| Sujet de l'examen | Couverture | Où dans RAD | Guide |
|---|---|---|---|
| 6.1 Configuration des stratégies Google Cloud Armor (Configuring Google Cloud Armor policies) | ✅ | les deux modules d'application : règles OWASP v33 (SQLi/XSS/LFI/RCE), Adaptive Protection, limitation de débit ; stratégies edge, RFI, protection DDoS réseau avancée, gestion des bots, Threat Intelligence 📘 | [Guide de la section 6](PCNE_Section_6_Exploration_Guide.md#61-configuring-google-cloud-armor-policies) |
| 6.2 Configuration et gestion des stratégies NGFW et des règles de pare-feu VPC (Configuring and managing NGFW policies and VPC Firewall rules) | 🟡 | règles VPC basées sur des tags + NetworkPolicy K8s ; stratégies/niveaux Cloud NGFW (Essentials, Standard, Enterprise), migration, journalisation des règles 📘 | [Guide de la section 6](PCNE_Section_6_Exploration_Guide.md#62-configuring-and-managing-ngfw-policies-and-vpc-firewall-rules) |
| 6.3 Configuration et sécurisation du trafic sortant vers Internet avec Public Cloud NAT et Secure Web Proxy (Configuring and securing internet egress traffic using Public Cloud NAT and Secure Web Proxy) | 🟡 | Cloud NAT (`ALL_SUBNETWORKS_ALL_IP_RANGES`, IP automatiques) ; IP manuelles/réglage de l'allocation des ports, Secure Web Proxy 📘 | [Guide de la section 6](PCNE_Section_6_Exploration_Guide.md#63-configuring-and-securing-internet-egress-traffic-using-public-cloud-nat-and-secure-web-proxy) |
| 6.4 Configuration d'une appliance virtuelle réseau autogérée et de Packet Mirroring (Configuring self-managed network virtual appliance and Packet Mirroring) | 📘 | Analogue le plus proche : VM NFS autogérée dans un MIG ; NVA multi-NIC / Packet Mirroring / Network Security Integration 📘 | [Guide de la section 6](PCNE_Section_6_Exploration_Guide.md#64-configuring-self-managed-network-virtual-appliance-and-packet-mirroring) |

## Séquence d'étude suggérée {#suggested-study-sequence}

1. **Semaine 1 — lab réel (sujets ✅) :** déployez VPC Foundation, travaillez les sections 2.1–2.2, puis 1.1–1.2. Ajoutez le GKE Network Lab et terminez 1.4 et 2.4 pendant que le cluster est en service. Ces quatre sous-sections couvrent à elles seules l'essentiel du poids pratique de l'examen.
2. **Semaine 2 — edge et sécurité :** déployez Global Edge ; travaillez 3.1, 3.2 et 6.1 en une seule séance (le LB, le CDN et les objets Cloud Armor appartiennent au même déploiement). Puis 6.2 et 6.3 sur les ressources de VPC Foundation, et Locked-Down Perimeter pour la démonstration VPC-SC de la section 2.1.
3. **Semaine 3 — le tiers 📘 :** les sections 4 (en entier), 3.3, 2.3, 5.3 et 6.4 à partir de la documentation, plus les commandes pour projet de test de chaque encadré « Au-delà des modules ». Environ un tiers du poids de l'examen se trouve ici ; ne laissez pas la richesse du lab réel vous inciter à le sauter. Le lab HA VPN de la section 4.2 — qui utilise le VPC RAD comme l'un des deux côtés — est l'exercice sur projet de test le plus rentable.
4. **Dernière révision :** reprenez à froid chaque question « Vérifiez vos acquis ». Supprimez les profils de lab dont vous n'avez plus besoin ; les profils GKE Network Lab et Global Edge sont les principaux postes de coût.

## Capacités clés en référence rapide {#key-capabilities-for-quick-reference}

| Domaine | Ce qu'il démontre |
|---|---|
| Réseau Services_GCP | VPC en mode personnalisé, sous-réseaux, règles de pare-feu, Cloud Router + NAT, appairage PSA avec export de routes personnalisées |
| GKE Services_GCP | clusters de VPC natif, planification déterministe des plages secondaires, Dataplane V2, Gateway API, pools de nœuds Standard |
| Appliance NFS Services_GCP | règles de pare-feu ciblées par tags, vérifications d'état TCP, autoréparation du MIG (modèle d'exploitation d'appliance) |
| VPC-SC Services_GCP | périmètre VPC-SC, niveaux d'accès, mode simulation (dry-run), sondes d'autorisations |
| Edge App_CloudRun | NEG sans serveur → service de backend → mappage d'URL → proxys → IP globale ; Cloud Armor ; CDN ; gestion des certificats |
| Service App_CloudRun | sortie VPC directe, solution de repli VPC/NAT/PSA intégrée, allocation de CIDR basée sur un hachage |
| Edge App_GKE | ALB externe global via Gateway API, HTTPRoute, GCPBackendPolicy, Cloud Armor pour GKE |
| Segmentation App_GKE | micro-segmentation par Kubernetes NetworkPolicy, y compris les VIP googleapis restricted/private |
| Découverte App_Common | contrat de découverte des réseaux/sous-réseaux/tags (`managed-by=services-gcp`) |
