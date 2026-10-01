---
title: "Préparation PCNE, section 4 : connectivité hybride et multicloud"
description: "Préparez la section 4 de l'examen PCNE (connectivité hybride et multicloud) avec des labs pratiques de déploiement RAD sur Google Cloud."
---
<!-- translated-from: docs/certification/PCNE_Section_4_Exploration_Guide.md @ cb682e8 sha256:50bb01326a6c -->

# Guide de préparation à la certification PCNE : Section 4 — Configuration et mise en œuvre de l'interconnectivité réseau hybride et multicloud (Configuring and implementing hybrid and multicloud network interconnectivity) (~16 % de l'examen) {#pcne-certification-preparation-guide-section-4--configuring-and-implementing-hybrid-and-multicloud-network-interconnectivity-16-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pcne_section4.png" alt="Guide de préparation à la certification PCNE : Section 4 — Configuration et mise en œuvre de l'interconnectivité réseau hybride et multicloud (~16 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [Professional Cloud Network Engineer certification](https://cloud.google.com/learn/certification/cloud-network-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Soyons honnêtes d'emblée : les modules de fondation RAD ne mettent en œuvre **aucun** élément de cette section. Il n'y a ni Interconnect, ni VPN, ni session BGP, ni hub NCC nulle part dans `Services_GCP`, `App_CloudRun`, `App_GKE` ou `App_Common`. Ce que la plateforme vous *fournit*, c'est un point d'ancrage réaliste côté cloud — un VPC personnalisé (`vpc-network-{prefix}`), un Cloud Router (ASN `64514`) et un appairage PSA avec export de routes personnalisées — sur lequel chaque modèle hybride de cette section peut être pratiqué dans un projet de test. Déployez le profil **VPC Foundation** pour que ces points d'ancrage existent, puis traitez ce guide comme un programme d'étude structuré. Attendez-vous à ce qu'environ 16 % de l'examen porte sur des éléments que vous ne verrez pas fonctionner dans RAD.

---

## 4.1 Configuration de Cloud Interconnect (Configuring Cloud Interconnect) {#41-configuring-cloud-interconnect}

> ⏱ ~60 min d'étude · 💰 aucun (Interconnect ne peut pas être véritablement testé en lab sans circuit) · ⚙️ Prérequis : profil VPC Foundation, uniquement pour le VPC cible

**Pourquoi c'est important pour l'examen** — Le choix entre Dedicated et Partner Interconnect (capacité, présence en colocation, modèles Partner L2 ou L3), la configuration des rattachements VLAN, les topologies SLA à 99.9 % et 99.99 %, Cross-Cloud Interconnect vers d'autres clouds, et le chiffrement d'Interconnect par HA VPN sur Interconnect ou MACsec.

**Comment RAD le met en œuvre** — Non mis en œuvre par les modules de fondation.

**Essayez**

1. Vous pouvez répéter la création des objets *côté cloud* sans circuit physique (dans un projet de test, les rattachements restent non provisionnés mais montrent le processus) :

   ```bash
   gcloud compute interconnects locations list --format="table(name,city,availabilityZone)"
   gcloud compute interconnects attachments partner create my-attachment \
     --region=us-central1 \
     --router=vpc-network-<prefix>-nat-gw-us-central1 \
     --edge-availability-domain=availability-domain-1
   gcloud compute interconnects attachments describe my-attachment \
     --region=us-central1 --format="yaml(pairingKey,state)"
   ```

2. Notez la `pairingKey` — le jeton que vous remettez à un fournisseur Partner Interconnect — et l'état `PENDING_PARTNER`.
3. Vous savez que vous l'avez compris lorsque vous pouvez expliquer pourquoi le rattachement référence le *Cloud Router* (terminaison BGP) et ce qui change pour un rattachement Dedicated (vous indiquez l'`--interconnect` au lieu d'obtenir une clé d'appairage). Supprimez ensuite le rattachement pour éviter des frais.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Besoin de 5 Gbit/s, aucune présence dans un centre de colocation, et le trafic doit être chiffré. Quelle conception ?</summary>

R : Partner Interconnect (l'absence de présence en colocation exclut Dedicated, dont les circuits physiques commencent à 10 Gbit/s) avec HA VPN sur Interconnect pour le chiffrement — Interconnect lui-même n'est pas chiffré, et la disponibilité de MACsec dépend du type et de l'emplacement de la connexion. Avec un partenaire L3, le routeur du partenaire établit l'appairage avec Cloud Router pour votre compte ; en L2, vous exécutez vous-même BGP vers Cloud Router.
</details>

<details>
<summary>Q2 : Qu'est-ce qui permet précisément d'obtenir le SLA Interconnect à 99.99 % ?</summary>

R : Quatre rattachements VLAN sur au moins deux connexions Dedicated/Partner dans **deux zones métropolitaines**, des rattachements répartis sur les deux domaines de disponibilité edge de chaque zone métropolitaine, des Cloud Routers dans au moins deux régions, et le mode de routage dynamique **global** — plus une redondance côté site. Deux rattachements dans une seule zone métropolitaine répartis sur les deux domaines de disponibilité n'offrent que 99.9 %.
</details>

**Au-delà des modules** — Étudiez « Cloud Interconnect overview », « Partner Interconnect provisioning », « Cross-Cloud Interconnect » (liaisons dédiées gérées par Google vers AWS/Azure, même modèle rattachement VLAN + Cloud Router), « HA VPN over Cloud Interconnect » (des passerelles VPN sur les rattachements, qui servent aussi de réponse pour le chiffrement) et MACsec pour Cloud Interconnect. À mémoriser : Dedicated = 10/100 Gbit/s physiques, dans votre colocation ; Partner = 50 Mbit/s–50 Gbit/s via un fournisseur ; les rattachements sont régionaux et se lient à un Cloud Router.

**⚠️ Piège d'examen** — Plan de données : une *connexion* Interconnect est physique et limitée à une zone métropolitaine ; le *rattachement VLAN* est l'objet régional routé. Une connexion à Chicago peut desservir des rattachements à des routeurs de n'importe quelle région (les coûts de sortie diffèrent), mais le calcul du SLA compte les zones métropolitaines et les domaines de disponibilité, pas seulement les régions.

---

## 4.2 Configuration d'un VPN IPSec de site à site (Configuring a site-to-site IPSec VPN) {#42-configuring-a-site-to-site-ipsec-vpn}

> ⏱ ~60 min de pratique possible dans un projet de test · 💰 ~$0.05/h par tunnel + trafic sortant · ⚙️ Prérequis : profil VPC Foundation comme l'un des deux côtés

**Pourquoi c'est important pour l'examen** — HA VPN (deux interfaces, 99.99 % avec la bonne topologie de tunnels, BGP uniquement) ou Classic VPN (une seule interface, 99.9 %, prend en charge les tunnels statiques basés sur des règles/des routes), le VPN entre deux VPC, et l'interaction avec le mode de routage dynamique.

**Comment RAD le met en œuvre** — Non mis en œuvre par les modules de fondation. Le Cloud Router déployé (`{net}-nat-gw-{region}`, ASN 64514) est techniquement capable d'héberger des sessions BGP VPN, et les sous-réseaux du VPC ainsi que la plage PSA (export de routes personnalisées déjà activé sur l'appairage) sont exactement ce que vous annonceriez à un site distant.

**Essayez**

1. Celui-ci, vous *pouvez* le tester entièrement en lab : créez un second VPC dans un projet de test et construisez un HA VPN entre ce VPC et le VPC RAD :

   ```bash
   # One HA VPN gateway per side (note: two interfaces each, automatically)
   gcloud compute vpn-gateways create rad-side-gw --network=vpc-network-<prefix> --region=us-central1
   gcloud compute vpn-gateways create remote-side-gw --network=scratch-vpc --region=us-central1

   gcloud compute routers create remote-router --network=scratch-vpc --region=us-central1 --asn=65010

   # Tunnels (repeat with interface 1 / peer counterpart for full HA)
   gcloud compute vpn-tunnels create rad-to-remote-0 \
     --region=us-central1 --vpn-gateway=rad-side-gw --interface=0 \
     --peer-gcp-gateway=remote-side-gw --shared-secret=SECRET \
     --router=vpc-network-<prefix>-nat-gw-us-central1 --ike-version=2

   gcloud compute routers add-interface vpc-network-<prefix>-nat-gw-us-central1 \
     --interface-name=if-tun0 --vpn-tunnel=rad-to-remote-0 \
     --ip-address=169.254.0.1 --mask-length=30 --region=us-central1
   gcloud compute routers add-bgp-peer vpc-network-<prefix>-nat-gw-us-central1 \
     --peer-name=remote-peer-0 --interface=if-tun0 \
     --peer-ip-address=169.254.0.2 --peer-asn=65010 --region=us-central1
   ```

2. Vérifiez : `gcloud compute vpn-tunnels describe rad-to-remote-0 --region=us-central1 --format="value(status)"` → `ESTABLISHED`, puis contrôlez les routes apprises avec `gcloud compute routers get-status`.
3. Vous savez que cela a fonctionné lorsqu'une VM (ou la VM du serveur NFS, tag `nfsserver`) du VPC RAD peut envoyer un ping à une VM du VPC de test à travers le tunnel — n'oubliez pas que les règles de pare-feu intra-VPC n'autorisent que les CIDR internes : ajoutez d'abord une autorisation d'entrée pour le CIDR distant.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Un équipement sur site ne prend en charge qu'un VPN basé sur des règles avec routage statique. HA VPN ou Classic ?</summary>

R : Classic VPN — HA VPN exige BGP. Les tunnels statiques basés sur des règles/des routes n'existent que sur Classic VPN (SLA de 99.9 %, déconseillé pour les nouveaux déploiements dynamiques). Lorsque l'équipement *sait* faire du BGP, la meilleure réponse à l'examen est toujours HA VPN avec deux tunnels pour 99.99 %.
</details>

<details>
<summary>Q2 : HA VPN est opérationnel, mais le site ne parvient pas à joindre l'IP privée de Cloud SQL, alors que les VM y parviennent. Pourquoi ?</summary>

R : L'instance Cloud SQL réside dans le VPC *producteur*, derrière l'appairage PSA. Les routes d'appairage ne sont pas annoncées via BGP sauf si le consommateur les exporte : activez l'export de routes personnalisées sur l'appairage PSA (RAD le fait déjà) **et** ajoutez le /16 PSA aux routes annoncées personnalisées de Cloud Router — la plage PSA n'est pas un sous-réseau du VPC consommateur, si bien que l'annonce par défaut l'omet.
</details>

**Au-delà des modules** — Étudiez « HA VPN topologies » (GCP↔GCP, GCP↔site avec 2 ou 4 tunnels, actif/actif ou actif/passif et la mise en garde sur la bande passante divisée par deux), les algorithmes de chiffrement IKE et le dépannage des tunnels (section 5.2). Connaissez l'adressage BGP link-local (un 169.254.x.x/30 par interface de tunnel, comme dans les commandes ci-dessus).

**⚠️ Piège d'examen** — Créer deux tunnels depuis *une seule* interface de passerelle HA VPN vers le pair ne donne pas droit à 99.99 % — le SLA exige des tunnels depuis **les deux** interfaces de la passerelle HA VPN, associés à des points de terminaison pairs redondants.

---

## 4.3 Configuration de Cloud Router (Configuring Cloud Router) {#43-configuring-cloud-router}

> ⏱ ~30 min · 💰 aucun · ⚙️ Prérequis : profil VPC Foundation

**Pourquoi c'est important pour l'examen** — Cloud Router est le locuteur BGP derrière toute topologie hybride dynamique : choix de l'ASN, MED (priorité des routes annoncées), routes annoncées personnalisées, priorité des routes apprises (`--advertised-route-priority`, ajustement de la priorité de base), BFD pour un basculement rapide, authentification MD5 et mode de sélection du meilleur chemin.

**Comment RAD le met en œuvre** — Partiellement. La plateforme crée un véritable Cloud Router nommé `{net}-nat-gw-{region}`, avec l'ASN 64514 et aucun groupe annoncé, dont le seul consommateur est la passerelle Cloud NAT (NAT appliquée à tous les sous-réseaux et à toutes les plages IP). Le chemin intégré crée un Cloud Router simple, sans aucune configuration BGP. Il n'existe nulle part de pair BGP, d'annonce personnalisée ni de BFD.

**Essayez**

1. Inspectez le routeur réel et ajoutez une annonce personnalisée (sans danger en l'absence de pair — cela modifie ce qui *serait* annoncé) :

   ```bash
   gcloud compute routers describe vpc-network-<prefix>-nat-gw-us-central1 \
     --region=us-central1 --format="yaml(bgp,nats[].name)"
   gcloud compute routers update vpc-network-<prefix>-nat-gw-us-central1 \
     --region=us-central1 \
     --advertisement-mode=CUSTOM \
     --set-advertisement-groups=ALL_SUBNETS \
     --set-advertisement-ranges=<psa-range-cidr>=PSA-range
   gcloud compute routers get-status vpc-network-<prefix>-nat-gw-us-central1 \
     --region=us-central1
   ```

2. Vous savez que cela a fonctionné lorsque `describe` affiche `advertiseMode: CUSTOM` avec votre plage. Revenez ensuite à `--advertisement-mode=DEFAULT` pour éviter une dérive Terraform lors de la prochaine application de la plateforme.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Deux rattachements Interconnect ; vous voulez que l'un soit privilégié pour le trafic *vers* le site, et que le site privilégie un chemin pour le *retour*. Quels réglages ?</summary>

R : En entrée vers Google : le site influence le choix de Google via le MED qu'il envoie ; côté Google, la préférence entre préfixes identiques appris suit la priorité de la route (dérivée du MED + du coût inter-régional). En sortie de Google : définissez `--advertised-route-priority` (le MED qu'envoie Google) par pair BGP — un MED plus bas est davantage privilégié par le site. Les questions d'asymétrie se résolvent presque toujours par « le MED dans chaque sens ».
</details>

<details>
<summary>Q2 : Le basculement entre deux tunnels VPN prend ~60 s. Comment le ramener sous la seconde ?</summary>

R : Activez BFD sur les deux pairs BGP (`gcloud compute routers update-bgp-peer --bfd-session-initialization-mode=ACTIVE --bfd-min-transmit-interval=...`). Les temporisateurs de maintien BGP seuls se comptent en dizaines de secondes ; BFD détecte une défaillance du plan de données en quelques centaines de millisecondes et retire immédiatement la route.
</details>

**Au-delà des modules** — Étudiez « Cloud Router overview » : les règles d'ASN (plages privées 64512–65534/4200000000+ ; le côté Google d'un appairage de type PSA par rapport à votre `--asn`), le routage dynamique régional ou global et la façon dont il modifie les sous-réseaux annoncés par le routeur, l'authentification MD5 des sessions BGP, l'adressage BGP link-local, les **routes apprises personnalisées** (`gcloud compute routers update-bgp-peer --set-custom-learned-route-ranges`, routes appliquées comme si elles avaient été apprises du pair), et les modes de sélection du meilleur chemin legacy et standard. Notez aussi que chaque routeur NAT seul (le cas de RAD) compte malgré tout dans les quotas de routeurs.

**⚠️ Piège d'examen** — Par défaut, Cloud Router annonce les routes de *sous-réseau* (selon le mode de routage) ; **les routes personnalisées, les plages d'appairage (comme le /16 PSA de RAD) et les plages secondaires hors de la portée du mode exigent le mode d'annonce CUSTOM**. « C'est dans le VPC, donc c'est annoncé » est faux pour les plages PSA.

---

## 4.4 Configuration de Network Connectivity Center (Configuring Network Connectivity Center) {#44-configuring-network-connectivity-center}

> ⏱ ~30 min d'étude · 💰 aucun · ⚙️ Prérequis : rien — concept uniquement

**Pourquoi c'est important pour l'examen** — L'angle NCC de la section 4 est l'angle *hybride* (par opposition à l'angle spoke VPC de la section 2.3) : les rattachements VPN/Interconnect comme spokes hybrides, le transfert de données de site à site via le réseau backbone de Google, les appliances de routeur (intégration SD-WAN) comme spokes établissant un appairage BGP avec Cloud Router, et les règles de transitivité.

**Comment RAD le met en œuvre** — Non mis en œuvre par les modules de fondation.

**Essayez**

1. Si vous avez construit le lab HA VPN de la partie 4.2, transformez-le en topologie NCC dans le projet de test :

   ```bash
   gcloud network-connectivity hubs create hybrid-hub
   gcloud network-connectivity spokes linked-vpn-tunnels create vpn-spoke \
     --hub=hybrid-hub --region=us-central1 \
     --vpn-tunnels=rad-to-remote-0,rad-to-remote-1 \
     --site-to-site-data-transfer
   gcloud network-connectivity spokes list --hub=hybrid-hub
   ```

2. Vous savez que cela a fonctionné lorsque le spoke affiche `ACTIVE` et que la table de routage du hub inclut des préfixes appris via les tunnels.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Deux agences, chacune reliée à GCP par VPN, ont besoin de trafic d'agence à agence sans nouveaux circuits. Solution ?</summary>

R : Un hub NCC avec les deux ensembles de tunnels VPN comme spokes hybrides et le transfert de données de site à site activé — le trafic entre agences transite par le réseau backbone de Google entre les spokes. Sans NCC, deux tunnels VPN aboutissant dans un même VPC ne se transmettent *pas* de trafic l'un à l'autre (un VPC n'est pas un routeur de transit pour les flux d'externe à externe).
</details>

<details>
<summary>Q2 : Quelle est la place des appliances de routeur ?</summary>

R : Un spoke d'appliance de routeur est une VM (généralement une appliance SD-WAN d'un fournisseur) dans le VPC, qui établit un appairage BGP avec Cloud Router ; NCC traite ensuite les préfixes qu'elle a appris comme ceux de n'importe quel spoke hybride. C'est le modèle de réponse à « intégrer notre infrastructure SD-WAN à Google Cloud ».
</details>

**Au-delà des modules** — Étudiez « NCC site-to-site data transfer » (régions compatibles, facturation), la configuration BGP des appliances de routeur, la combinaison de spokes VPC et de spokes hybrides (le hub fournit la transitivité qui manque à l'appairage — mais spokes VPC et spokes hybrides interagissent selon des règles documentées, pas sans condition), et Private NAT au niveau du hub pour les plages de sites qui se chevauchent.

**⚠️ Piège d'examen** — « Appairage VPC + VPN = le site joint le VPC appairé » est faux (non transitif). Les deux corrections prises en charge sont : exporter/importer des routes personnalisées via l'appairage avec Cloud Router qui les annonce, ou restructurer avec des spokes NCC. Sachez reconnaître ce que le scénario permet.
