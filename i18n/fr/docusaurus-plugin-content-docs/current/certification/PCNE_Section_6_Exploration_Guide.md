---
title: "Préparation PCNE, section 6 : sécurité du réseau cloud"
description: "Préparez la section 6 de l'examen Professional Cloud Network Engineer (PCNE) — sécurité du réseau cloud — avec des labs pratiques RAD sur Google Cloud."
---
<!-- translated-from: docs/certification/PCNE_Section_6_Exploration_Guide.md @ cb682e8 -->

# Guide de préparation à la certification PCNE : Section 6 — Configuration, mise en œuvre et gestion d'une solution de sécurité réseau cloud (Configuring, implementing and managing a cloud network security solution) (~13 % de l'examen) {#pcne-certification-preparation-guide-section-6--configuring-implementing-and-managing-a-cloud-network-security-solution-13-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pcne_section6.png" alt="Guide de préparation à la certification PCNE : Section 6 — Configuration, mise en œuvre et gestion d'une solution de sécurité réseau cloud (~13 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

La sécurité réseau est, après le réseau GKE, le point le plus fort de RAD pour cet examen. Les deux moteurs de déploiement construisent une stratégie **Cloud Armor** de niveau production (règles OWASP préconfigurées, Adaptive Protection, bannissement basé sur le débit), le VPC de la plateforme met en œuvre une **micro-segmentation du pare-feu par tags**, et **Cloud NAT** gère toute la sortie vers Internet des charges de travail privées. Les stratégies Cloud NGFW, Secure Web Proxy, les NVA, Packet Mirroring et Network Security Integration relèvent uniquement de l'étude. Déployez le profil **Global Edge** pour la partie 6.1 et le profil **VPC Foundation** pour les parties 6.2–6.4. Modules mis en pratique : `App_CloudRun`, `App_GKE`, `Services_GCP`.

---

## 6.1 Configuration des stratégies Google Cloud Armor (Configuring Google Cloud Armor policies) {#61-configuring-google-cloud-armor-policies}

> ⏱ ~60 min · 💰 stratégie Cloud Armor + frais par requête · ⚙️ Prérequis : profil Global Edge (`enable_cloud_armor = true`)

**Pourquoi c'est important pour l'examen** — Les questions sur Cloud Armor portent sur la mécanique des règles (priorité, expressions WAF préconfigurées, CEL personnalisé), la séparation entre stratégie edge et stratégie de backend, la limitation de débit (`throttle` ou `rate_based_ban`), Adaptive Protection pour les attaques DDoS de couche 7, la protection DDoS réseau avancée, la gestion des bots et Google Threat Intelligence.

**Comment RAD le met en œuvre** — Les deux moteurs créent la même forme vérifiée de stratégie Cloud Armor :

| Priorité | Règle | Action |
|---|---|---|
| 100 | liste d'autorisation `admin_ip_ranges` | `allow` (contourne les règles WAF) |
| 1000–1003 | `evaluatePreconfiguredExpr('sqli-v33-stable')`, `xss-v33-stable`, `lfi-v33-stable`, `rce-v33-stable` | `deny(403)` |
| 2000 | bannissement basé sur le débit : 500 requêtes/60 s par IP, dépassement → `deny(429)`, bannissement de 300 s | bannissement basé sur le débit |
| 2147483647 | `*` par défaut | `allow` |

S'y ajoute Adaptive Protection avec la défense DDoS de couche 7 activée. Le rattachement diffère selon le moteur : App_CloudRun définit la stratégie de sécurité sur le service de backend et **force l'entrée à `internal-and-cloud-load-balancing`** afin que l'accès direct par `*.run.app` ne puisse pas contourner le WAF ; App_GKE la rattache via la stratégie de sécurité par défaut de la `GCPBackendPolicy` et accepte, à la place, une stratégie gérée en externe via `cloud_armor_policy_name` (par défaut `default-waf-policy`) lorsque `enable_cloud_armor = false`. La règle d'autorisation `admin_ip_ranges` de priorité 100 existe désormais dans **les deux** stratégies ; sur Cloud Run, la même variable alimente *en outre* les niveaux d'accès VPC-SC. Les deux moteurs se comportent désormais de la même façon sur ce point : aucun n'exige de domaine pour Cloud Armor — App_CloudRun dérive un certificat `<ip-dashed>.nip.io` et la Gateway d'App_GKE un certificat `<ip>.nip.io`.

**Essayez**

1. Lisez la stratégie déployée et comparez-la au tableau :

   ```bash
   gcloud compute security-policies describe <service>-waf-policy \
     --format="yaml(rules[].priority,rules[].action,rules[].match,adaptiveProtectionConfig)"
   ```

2. Déclenchez le WAF et le limiteur de débit :

   ```bash
   # SQLi probe → expect 403
   curl -s -o /dev/null -w "%{http_code}\n" "https://<domain>/?q=1%27%20OR%20%271%27=%271"
   # Burst past 500 req/min → expect 429s, then a 300 s ban
   for i in $(seq 1 600); do curl -s -o /dev/null -w "%{http_code} " "https://<domain>/"; done | tr ' ' '\n' | sort | uniq -c
   ```

3. Inspectez l'application des règles dans **Console > Network Security > Cloud Armor policies > (policy) > Logs**, ou :

   ```bash
   gcloud logging read 'resource.type="http_load_balancer" AND jsonPayload.enforcedSecurityPolicy.name!=""' \
     --limit=5 --format="table(httpRequest.status,jsonPayload.enforcedSecurityPolicy.outcome,jsonPayload.enforcedSecurityPolicy.priority)"
   ```

4. Vous savez que cela a fonctionné lorsque la sonde SQLi journalise `outcome: DENY, priority: 1000` et que la rafale montre des 200 qui basculent en 429.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Un trafic d'administration légitime depuis le bureau déclenche sans cesse la règle XSS sur l'application GKE. Comment corriger sans affaiblir la protection pour tous ?</summary>

R : Renseignez `admin_ip_ranges` — le module insère une règle `allow` de priorité 100, évaluée *avant* les règles WAF (nombre plus bas = évaluée plus tôt). C'est aussi la réponse générique de Cloud Armor : une règle d'autorisation ciblée placée au-dessus de la règle de blocage. Les deux moteurs insèrent désormais cette règle ; sur Cloud Run, la même variable alimente aussi les niveaux d'accès VPC-SC. L'équivalent manuel est `gcloud compute security-policies rules create 100 --security-policy=<service>-waf-policy --src-ip-ranges=<office-cidr> --action=allow`.
</details>

<details>
<summary>Q2 : Quand avez-vous besoin d'une stratégie de sécurité *edge* plutôt que de la stratégie de backend qu'utilise RAD ?</summary>

R : Les stratégies edge sont évaluées en périphérie du réseau de Google, avant le cache ; elles peuvent donc filtrer les requêtes servies depuis le cache Cloud CDN et protéger les buckets de backend (GCS). Les stratégies de backend (le type utilisé par RAD) ne sont évaluées que sur les défauts de cache / le trafic hors CDN. « Bloquer le pays X pour le contenu mis en cache » → stratégie edge.
</details>

<details>
<summary>Q3 : Pourquoi l'activation de Cloud Armor sur App_CloudRun modifie-t-elle le paramètre d'entrée du service ?</summary>

R : Cloud Armor ne s'applique qu'au trafic qui traverse l'équilibreur de charge. L'URL Cloud Run par défaut (`*.run.app`) le contournerait ; le module force donc l'entrée à `internal-and-cloud-load-balancing` — le contrôle complémentaire standard attendu à l'examen. La même logique apparaît sous la forme « utiliser `internal-and-cloud-load-balancing` + LB » chaque fois que le WAF/CDN/IAP sur le LB ne doit pas pouvoir être contourné.
</details>

**Au-delà des modules** — À étudier : la règle d'inclusion de fichiers distants (`rfi-v33-stable`) — l'examen cite SQLi, XSS et RFI, et la stratégie de RAD couvre SQLi, XSS, LFI et RCE mais pas RFI ; la **protection DDoS réseau avancée** (stratégies de sécurité de périphérie réseau pour les Network LB passthrough, le transfert de protocole et les VM dotées d'IP publiques — Cloud Armor Enterprise) ; les variantes de limitation de débit (throttle ou le bannissement basé sur le débit de RAD ; options de clé d'application au-delà de l'IP — en-tête HTTP, cookie, IP XFF), les *niveaux de sensibilité* des règles préconfigurées et les champs d'exclusion (`evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 1})`), la gestion des bots avec les jetons d'action reCAPTCHA et les actions de redirection, les expressions Google Threat Intelligence (`evaluateThreatIntelligence('iplist-known-malicious-ips')`), et les *modèles granulaires* d'Adaptive Protection + le déploiement automatique de règles (RAD active la détection ; le tri des règles suggérées est manuel).

**⚠️ Piège d'examen** — La priorité de règle 0 est la *plus élevée* ; la règle par défaut se trouve à 2147483647. Une conception « tout refuser puis autoriser » qui place le refus à un nombre bas bloque tout — placez vos autorisations au-dessus du refus (c'est-à-dire avec un nombre plus petit).

---

## 6.2 Configuration et gestion des stratégies NGFW et des règles de pare-feu VPC (Configuring and managing NGFW policies and VPC Firewall rules) {#62-configuring-and-managing-ngfw-policies-and-vpc-firewall-rules}

> ⏱ ~45 min · 💰 aucun coût supplémentaire (les points de terminaison NGFW Enterprise seraient payants ; ils ne sont pas créés) · ⚙️ Prérequis : profil VPC Foundation ; GKE Network Lab pour la couche NetworkPolicy

**Pourquoi c'est important pour l'examen** — L'examen distingue désormais les *règles* de pare-feu VPC classiques des *stratégies* NGFW (Cloud Firewall) — hiérarchiques, globales et régionales —, ainsi que les tags et les comptes de service comme cibles, l'inspection L7 de NGFW Enterprise, la journalisation des règles et la stratégie de micro-segmentation.

**Comment RAD le met en œuvre** — Uniquement des règles de pare-feu VPC classiques par réseau, mais avec un modèle de micro-segmentation exemplaire dans le réseau Services_GCP :

- **Accès aux services limité par tag** : les règles ciblent le tag `nfsserver` (tcp 111/2049/6379, udp 2049), le tag `redisserver` (tcp 6379) et les tags `httpserver`/`webserver` (tcp 80/443/8080/8443). Le modèle de VM NFS porte les tags `nfsserver` et `redisserver`.
- **Stratégie de plages sources** : les autorisations intra-VPC sont limitées à l'ensemble calculé des CIDR internes (sous-réseaux + plages de base GKE lorsque GKE est activé), et non à 0.0.0.0/0 ; les règles NFS autonomes utilisent les trois super-plages RFC 1918.
- **Affinage par tag source** : le chemin intégré va plus loin — les autorisations d'entrée NFS/Redis sont limitées au tag source `app-nfs-client-<suffix>`, le tag que portent les interfaces de sortie VPC directe de Cloud Run, si bien que seule cette charge de travail atteint le serveur de fichiers.
- **Autorisations de plages spéciales** : `35.235.240.0/20` (transfert TCP d'IAP) pour SSH, `130.211.0.0/22` + `35.191.0.0/16` pour les vérifications d'état.
- **Couche supérieure** : micro-segmentation par NetworkPolicy Kubernetes via `enable_network_segmentation` (section 2.4) et règles Istio est-ouest multicluster (tcp 15012/15017/15443) lorsque `gke_cluster_count > 1`.

App_GKE ne crée intentionnellement aucune règle de pare-feu — les contrôleurs Gateway/LoadBalancer provisionnent automatiquement les règles de pare-feu de leur LB, et les nœuds Autopilot ne peuvent pas porter de tags personnalisés (une règle HTTP limitée par tag y serait donc inutile). Aucune stratégie hiérarchique, aucune stratégie de pare-feu réseau, aucune journalisation des règles.

**Essayez**

1. Associez chaque règle à son rôle de segmentation :

   ```bash
   gcloud compute firewall-rules list --filter="network~vpc-network" \
     --format="table(name,sourceRanges.list(),sourceTags.list(),targetTags.list(),allowed[].map().firewall_rule().list())"
   ```

2. Démontrez l'application basée sur les tags : retirez le tag `nfsserver` de l'instance NFS et observez l'échec des montages NFS ; ajoutez-le de nouveau.

   ```bash
   gcloud compute instances remove-tags <nfs-instance> --zone=us-central1-a --tags=nfsserver
   gcloud compute instances add-tags <nfs-instance> --zone=us-central1-a --tags=nfsserver
   ```

3. Recréez une règle sous forme de règle de *stratégie de pare-feu réseau* dans un VPC de test pour en percevoir la différence (les stratégies se rattachent aux réseaux ; les règles utilisent des tags sécurisés ou des comptes de service) :

   ```bash
   gcloud compute network-firewall-policies create pcne-policy --global
   gcloud compute network-firewall-policies rules create 1000 \
     --firewall-policy=pcne-policy --global-firewall-policy \
     --direction=INGRESS --action=allow --layer4-configs=tcp:2049 \
     --src-ip-ranges=10.0.0.0/24 --enable-logging
   gcloud compute network-firewall-policies associations create \
     --firewall-policy=pcne-policy --network=<scratch-vpc> --global-firewall-policy
   ```

4. Vous savez que cela a fonctionné lorsque l'instance dont le tag a été retiré cesse d'accepter les connexions sur le port 2049 en quelques secondes — les modifications de tags s'appliquent à chaud, sans redémarrage.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Tags ou comptes de service comme cibles de pare-feu pour une charge de travail à haute sécurité ?</summary>

R : Les comptes de service (ou les *tags sécurisés* régis par IAM dans les stratégies NGFW). Les tags réseau classiques peuvent être modifiés par quiconque dispose de `instanceAdmin` sur la VM — un attaquant capable de modifier les tags peut redéfinir la portée des règles de pare-feu, exactement la manipulation que vous avez effectuée dans « Essayez ». Les cibles de compte de service ne changent qu'avec un changement d'identité de la VM, et les tags sécurisés exigent le rôle IAM `tagUser`. RAD utilise des tags classiques par simplicité opérationnelle ; connaissez la réponse plus exigeante.
</details>

<details>
<summary>Q2 : Une organisation doit garantir « refuser tcp/22 depuis Internet » sur 200 projets, sans que les équipes projet puissent passer outre. Quel mécanisme ?</summary>

R : Une stratégie de pare-feu hiérarchique au niveau du nœud organisation/dossier avec une règle de refus — les règles hiérarchiques sont évaluées *avant* les stratégies réseau et les règles VPC, et `goto_next` par rapport à `allow`/`deny` contrôle la délégation. Les règles VPC par projet (le mécanisme de RAD) ne peuvent pas imposer cela de manière centralisée.
</details>

**Au-delà des modules** — À étudier : la stratégie de pare-feu (règles VPC, stratégies Cloud NGFW, stratégies hiérarchiques ou NVA tierces), l'ordre d'évaluation (hiérarchique → stratégie réseau globale → stratégie réseau régionale → règles VPC, modulé par le `firewall_policy_enforcement_order` du réseau) et la lecture du résultat *effectif* (`gcloud compute networks get-effective-firewalls`), les outils de migration des règles VPC vers les stratégies réseau, les niveaux NGFW (Essentials = stratégies/tags sécurisés ; Standard ajoute les objets FQDN/géolocalisation/Threat Intelligence ; Enterprise ajoute un IPS L7 avec inspection TLS via des points de terminaison de pare-feu), et NGFW avec le trafic GKE/Cloud LB. Documentation : « Cloud NGFW overview », « Hierarchical firewall policies », « Migrate VPC firewall rules ».

**⚠️ Piège d'examen** — Les règles implicites : chaque VPC possède une autorisation de sortie et un refus d'entrée implicites de priorité 65535. « Nous n'avons jamais écrit de règle de sortie, donc la sortie est bloquée » est l'inverse de la réalité — et la couche NetworkPolicy de RAD existe en partie parce que les pare-feu VPC seuls laissent la *sortie* grande ouverte.

---

## 6.3 Configuration et sécurisation du trafic sortant vers Internet avec Public Cloud NAT et Secure Web Proxy (Configuring and securing internet egress traffic using Public Cloud NAT and Secure Web Proxy) {#63-configuring-and-securing-internet-egress-traffic-using-public-cloud-nat-and-secure-web-proxy}

> ⏱ ~30 min · 💰 tarif horaire de la passerelle NAT + par Go · ⚙️ Prérequis : profil VPC Foundation

**Pourquoi c'est important pour l'examen** — L'adressage IP de Cloud NAT (automatique ou manuel, et pourquoi une liste d'autorisation exige des IP statiques manuelles), l'allocation de ports statique ou dynamique et le calcul de l'épuisement des ports, et les cas où Secure Web Proxy (stratégie de sortie tenant compte des URL/FQDN) remplace ou complète la NAT.

**Comment RAD le met en œuvre** — Deux déploiements NAT, tous deux réels : la plateforme crée `{net}-nat-gw-{region}`, appliquée à tous les sous-réseaux et à toutes les plages IP ; le chemin intégré crée une passerelle Cloud NAT avec allocation automatique des IP et la même portée sur tous les sous-réseaux. C'est ce qui permet à la VM NFS uniquement dotée d'une IP privée, aux nœuds/pods GKE et à Cloud Run en sortie `ALL_TRAFFIC` de joindre Internet sans aucune IP publique. Les paramètres d'allocation des ports sont laissés à leurs valeurs par défaut (allocation dynamique selon les valeurs par défaut actuelles de GCP ; aucun nombre minimal de ports fixé par VM). Secure Web Proxy n'est pas mis en œuvre.

**Essayez**

1. Vérifiez la passerelle et observez l'identité de sortie de la VM NFS :

   ```bash
   gcloud compute routers nats list --router=vpc-network-<prefix>-nat-gw-us-central1 \
     --region=us-central1
   gcloud compute routers nats describe vpc-network-<prefix>-nat-gw-us-central1 \
     --router=vpc-network-<prefix>-nat-gw-us-central1 --region=us-central1 \
     --format="yaml(natIpAllocateOption,sourceSubnetworkIpRangesToNat,minPortsPerVm,enableDynamicPortAllocation)"
   gcloud compute ssh <nfs-instance> --zone=us-central1-a --tunnel-through-iap \
     --command="curl -s ifconfig.me"
   ```

2. Passez à des IP NAT statiques manuelles — le modèle pour les listes d'autorisation :

   ```bash
   gcloud compute addresses create nat-egress-ip --region=us-central1
   gcloud compute routers nats update vpc-network-<prefix>-nat-gw-us-central1 \
     --router=vpc-network-<prefix>-nat-gw-us-central1 --region=us-central1 \
     --nat-external-ip-pool=nat-egress-ip
   ```

3. Relancez `curl ifconfig.me` — la commande renvoie désormais votre adresse réservée.
4. Vous savez que cela a fonctionné lorsque l'IP de sortie indiquée correspond à `nat-egress-ip` et reste stable lors de la recréation de la VM. (Revenez ensuite en arrière ; sinon, le module Terraform affichera une dérive.)

**Vérifiez vos acquis**
<details>
<summary>Q1 : Un partenaire a ajouté votre IP de sortie à sa liste d'autorisation, mais après une hausse du trafic, certaines connexions échouent par expiration et les journaux NAT montrent des rejets d'allocation. Diagnostic et corrections ?</summary>

R : Épuisement des ports : chaque IP NAT fournit environ 64k ports partagés entre les VM ; avec l'allocation statique, chaque VM détient un bloc fixe (`min_ports_per_vm`). Corrections : activer l'allocation dynamique des ports (les ports par VM augmentent à la demande entre le minimum et le maximum), augmenter `min_ports_per_vm` ou ajouter des IP NAT. Les signaux de métriques/journaux sont `dropped_sent_packets_count` avec le motif OUT_OF_RESOURCES et les journaux NAT ERRORS_ONLY.
</details>

<details>
<summary>Q2 : La conformité exige que les charges de travail ne puissent joindre que `*.github.com` et `pypi.org`. NAT ou Secure Web Proxy ?</summary>

R : Secure Web Proxy — la NAT opère en L3/L4 et ne peut pas filtrer par nom d'hôte/URL. SWP est un proxy explicite (ou atteint par routage basé sur des règles) doté de règles portant sur le FQDN/l'URL/le chemin et sur l'identité source (compte de service/tag sécurisé), déployé par région avec son propre certificat et sa propre ressource Gateway. NAT et SWP coexistent souvent : SWP pour la stratégie HTTP(S), NAT pour tout le reste.
</details>

**Au-delà des modules** — Étudiez « Cloud NAT port reservation » (le calcul), les règles NAT (des IP différentes par destination), Private NAT (cas de chevauchement NCC/inter-VPC) et « Secure Web Proxy overview » (`gcloud network-services gateways create --type=SECURE_WEB_GATEWAY`, objets `SecurityPolicy`/`UrlList`, option d'inspection TLS).

**⚠️ Piège d'examen** — Cloud NAT ne gère jamais les connexions *entrantes* — elle ne sert qu'à la sortie (hormis les réponses aux flux établis). « Utiliser Cloud NAT pour exposer la VM privée » est toujours faux ; pour l'entrée, ce sont les équilibreurs de charge, le transfert TCP d'IAP (`35.235.240.0/20`, que RAD autorise pour SSH) ou le transfert de protocole.

---

## 6.4 Configuration d'une appliance virtuelle réseau autogérée et de Packet Mirroring (Configuring self-managed network virtual appliance and Packet Mirroring) {#64-configuring-self-managed-network-virtual-appliance-and-packet-mirroring}

> ⏱ ~30 min d'étude · 💰 aucun, sauf si vous construisez le lab de test · ⚙️ Prérequis : profil VPC Foundation, uniquement pour l'équivalent

**Pourquoi c'est important pour l'examen** — Insérer des pare-feu/IDS tiers dans un chemin VPC : NVA multi-NIC couvrant plusieurs VPC, LB passthrough interne comme prochain saut pour la haute disponibilité, routes basées sur des règles redirigeant un trafic choisi à travers l'appliance, et Packet Mirroring pour l'inspection hors bande (le seul moyen de capturer les charges utiles complètes sans agent).

**Comment RAD le met en œuvre** — Non mis en œuvre. L'équivalent le plus proche, honnêtement, est la VM NFS/Redis autogérée : une VM d'appliance à une seule NIC exécutée dans un MIG avec des vérifications d'état TCP, l'autoréparation, une IP interne statique et des règles de pare-feu limitées par tag — la moitié *opérationnelle* d'un modèle NVA (appliance soumise à des vérifications d'état derrière une adresse stable) sans la moitié routage (pas de seconde NIC, pas d'ILB comme prochain saut, pas de routes personnalisées pointant vers elle). Aucune ressource Packet Mirroring n'existe.

**Essayez**

1. Étudiez les composants de l'équivalent, puis construisez la moitié routage manquante dans un projet de test :

   ```bash
   gcloud compute instance-templates describe <nfs-template> \
     --format="yaml(properties.networkInterfaces,properties.tags)"
   # Scratch lab: route selected traffic through an appliance via ILB next hop
   gcloud compute forwarding-rules create nva-ilb --load-balancing-scheme=INTERNAL \
     --backend-service=<nva-backend-service> --ip-protocol=TCP --ports=ALL \
     --network=<scratch-vpc> --subnet=<scratch-subnet> --region=us-central1
   gcloud compute routes create via-nva --network=<scratch-vpc> \
     --destination-range=0.0.0.0/0 --priority=800 \
     --next-hop-ilb=nva-ilb
   ```

2. Pour l'inspection hors bande, mettez en miroir le sous-réseau RAD vers un ILB collecteur dans une configuration de test :

   ```bash
   gcloud compute packet-mirrorings create rad-mirror --region=us-central1 \
     --network=vpc-network-<prefix> \
     --collector-ilb=<collector-forwarding-rule> \
     --mirrored-subnets=vpc-network-<prefix>-subnet-us-central1
   ```

3. Vous savez que cela a fonctionné lorsque tcpdump sur la VM collectrice affiche des paquets clonés (dans les deux sens) provenant du sous-réseau mis en miroir.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Une NVA doit inspecter le trafic entre un VPC « de confiance » et un VPC « non fiable ». Pourquoi plusieurs NIC, et quelle est la règle de routage ?</summary>

R : Chaque NIC se rattache à un VPC différent (les NIC sont fixées à la création de la VM), ce qui fait de l'appliance le seul chemin L3 entre eux ; chaque VPC reçoit une route personnalisée dont le prochain saut est l'IP de la NIC de l'appliance — ou, pour la haute disponibilité, un LB passthrough interne par VPC placé devant un MIG de NVA, avec `--next-hop-ilb`. La symétrie du routage compte : les réponses doivent traverser la même appliance, et c'est là qu'interviennent les routes basées sur des règles (qui peuvent aussi orienter selon la source) pour les conceptions multi-NIC en haute disponibilité.
</details>

<details>
<summary>Q2 : L'équipe sécurité veut une capture complète des paquets du trafic est-ouest pour un IDS, sans toucher aux charges de travail. Journaux de flux, journaux du pare-feu ou Packet Mirroring ?</summary>

R : Packet Mirroring — il clone des paquets entiers (en-têtes + charge utile) vers un ILB collecteur adossé à des instances IDS. Les journaux de flux sont des métadonnées à 5 tuples échantillonnées ; les journaux du pare-feu enregistrent les décisions des règles. Les filtres de mise en miroir (CIDR/protocole/sens) maintiennent un volume gérable sur le collecteur ; le trafic mis en miroir est facturé comme trafic sortant.
</details>

**Au-delà des modules** — Étudiez « Packet Mirroring overview » (portée de la stratégie par sous-réseau/tag/instance, le collecteur doit être un LB passthrough interne avec `--is-mirroring-collector` sur la règle de transfert, dans la même région), « Internal TCP/UDP load balancer as next hop » (hachage symétrique, pas de basculement vers une autre région fondé sur les vérifications d'état), les routes basées sur des règles pour l'insertion de NVA avec `--next-hop-ilb` et des règles d'exclusion pour le propre sous-réseau de l'appliance, une stratégie **Network Security Integration hors bande** (mise en miroir gérée par Google qui livre des copies d'un trafic choisi à une appliance de sécurité tierce, un modèle producteur/consommateur fondé sur des groupes de déploiement de mise en miroir et des groupes de points de terminaison, par opposition au Packet Mirroring autogéré vers votre propre collecteur), et le positionnement de l'alternative gérée : Cloud IDS / NGFW Enterprise ou NVA autogérées.

**⚠️ Piège d'examen** — L'*instance* désignée comme prochain saut d'une route statique personnalisée doit avoir le transfert IP activé (`--can-ip-forward`, défini à la création), sinon les paquets sont rejetés silencieusement. C'est la cause la plus fréquente de « le routage via la NVA ne fonctionne pas » — avant d'accuser les routes ou les pare-feu, vérifiez `canIpForward` sur l'appliance.
