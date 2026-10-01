---
title: "Préparation PCNE, section 5 : opérations et dépannage réseau"
description: "Préparez la section 5 de l'examen PCNE — gestion, surveillance et dépannage des opérations réseau — avec des labs pratiques de déploiement RAD sur Google Cloud."
---
<!-- translated-from: docs/certification/PCNE_Section_5_Exploration_Guide.md @ cb682e8 sha256:04da9e08a849 -->

# Guide de préparation à la certification PCNE : Section 5 — Gestion, surveillance et dépannage des opérations réseau (Managing, monitoring, and troubleshooting network operations) (~14 % de l'examen) {#pcne-certification-preparation-guide-section-5--managing-monitoring-and-troubleshooting-network-operations-14-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pcne_section5.png" alt="Guide de préparation à la certification PCNE : Section 5 — Gestion, surveillance et dépannage des opérations réseau (~14 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [Professional Cloud Network Engineer certification](https://cloud.google.com/learn/certification/cloud-network-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

Cette section évalue l'exploitation d'un réseau : quels journaux existent et où les activer, quelles métriques comptent pour VPN/Interconnect/LB/NAT, et comment utiliser Network Intelligence Center pour diagnostiquer la joignabilité et les performances. RAD vous fournit un réseau réel à instrumenter — un ALB externe global avec la journalisation des requêtes déjà activée, des groupes d'instances gérés soumis à des vérifications d'état, et la mécanique d'alerte — mais il est livré délibérément avec les journaux de flux VPC, la journalisation NAT et la journalisation du pare-feu **désactivés**, ce qui fait de leur activation votre exercice de lab. Déployez les profils **VPC Foundation** et **Global Edge**. Modules mis en pratique : `Services_GCP` et `App_CloudRun`.

---

## 5.1 Journalisation et surveillance avec Google Cloud Observability (Logging and monitoring with Google Cloud Observability) {#51-logging-and-monitoring-with-google-cloud-observability}

> ⏱ ~60 min · 💰 frais liés au volume de journaux si vous activez les journaux de flux avec un échantillonnage élevé · ⚙️ Prérequis : profils VPC Foundation + Global Edge

**Pourquoi c'est important pour l'examen** — Vous devez savoir quels journaux réseau sont *optionnels* (journaux de flux VPC par sous-réseau, journalisation des règles de pare-feu par règle, journalisation Cloud NAT par NAT, journalisation DNS par stratégie/zone) et lesquels sont activés par défaut, où chacun arrive dans l'explorateur de journaux (Logs Explorer), ainsi que les métriques principales des tunnels VPN, des rattachements Interconnect, des Cloud Routers, des équilibreurs de charge et des passerelles NAT.

**Comment RAD le met en œuvre** — État vérifié de l'ensemble déployé :

| Télémétrie | État dans RAD |
|---|---|
| Journaux de requêtes du LB | **Activés** — journalisation des requêtes du service de backend au taux d'échantillonnage complet |
| Journaux de flux VPC | Non activés (aucune journalisation des flux sur aucun sous-réseau) |
| Journalisation des règles de pare-feu | Non activée (aucune journalisation sur aucune règle de pare-feu) |
| Journalisation Cloud NAT | Non activée |
| Cloud Audit Logs | `enable_audit_logging` (par défaut `false`) → allServices ADMIN_READ/DATA_READ/DATA_WRITE |
| Journalisation/surveillance GKE | journalisation `SYSTEM_COMPONENTS` + `WORKLOADS`, Prometheus géré |
| Alertes | `support_users` → canaux e-mail ; liste `alert_policies` (métrique, comparaison, seuil). `uptime_check_config` (par défaut `{ enabled = false, path = "/" }`) crée, une fois activé, un `<service>-uptime-check` + une règle d'alerte lorsque le point de terminaison est joignable publiquement ; les déploiements internes uniquement n'en reçoivent pas |

**Essayez**

1. Lisez les journaux de requêtes de l'ALB qui sont déjà produits (générez d'abord du trafic) :

   ```bash
   gcloud logging read 'resource.type="http_load_balancer"' --limit=5 \
     --format="table(timestamp,httpRequest.status,httpRequest.requestUrl)"
   ```

2. Activez les journaux de flux VPC sur le sous-réseau principal — l'activation optionnelle par excellence à l'examen :

   ```bash
   gcloud compute networks subnets update vpc-network-<prefix>-subnet-us-central1 \
     --region=us-central1 --enable-flow-logs \
     --logging-aggregation-interval=interval-5-sec --logging-flow-sampling=0.5
   gcloud logging read 'logName:"compute.googleapis.com%2Fvpc_flows"' --limit=3
   ```

3. Activez la journalisation NAT sur la NAT de la plateforme (les erreurs seules constituent le choix économique et riche en signal) :

   ```bash
   gcloud compute routers nats update vpc-network-<prefix>-nat-gw-us-central1 \
     --router=vpc-network-<prefix>-nat-gw-us-central1 --region=us-central1 \
     --enable-logging --log-filter=ERRORS_ONLY
   ```

4. Dans **Console > Monitoring > Metrics explorer**, tracez `loadbalancing.googleapis.com/https/backend_latencies` pour votre LB et `router.googleapis.com/nat/dropped_sent_packets_count` pour la NAT.
5. Vous savez que cela a fonctionné lorsque les entrées des journaux de flux affichent des enregistrements à 5 tuples avec les annotations `src_instance`/`dest_instance`, et que le flux de journaux NAT reste vide tant que vous n'épuisez pas les ports (voir 6.3).

**Vérifiez vos acquis**
<details>
<summary>Q1 : L'équipe sécurité demande un enregistrement de chaque connexion autorisée et refusée vers la VM NFS. Qu'activez-vous, et où est le piège ?</summary>

R : La journalisation des règles de pare-feu sur les règles concernées (`gcloud compute firewall-rules update vpc-network-<prefix>-fw-allow-nfs-tcp --enable-logging`). Les pièges : la journalisation se fait par *règle*, seules les règles TCP/UDP peuvent journaliser, et le trafic rejeté par le refus implicite ne génère aucun journal — vous devez créer une règle de refus explicite de faible priorité avec journalisation pour capturer les refus. Les journaux de flux VPC complètent ce dispositif, mais ils échantillonnent les flux et n'enregistrent pas la décision de la règle.
</details>

<details>
<summary>Q2 : Quelle métrique vous indique qu'un rattachement VLAN Interconnect approche de sa capacité, et laquelle vous indique le plafond de bande passante d'un tunnel VPN ?</summary>

R : Rattachement : `interconnect.googleapis.com/network/attachment/sent_bytes_count` (par rapport à la capacité configurée). VPN : `vpn.googleapis.com/network/sent_bytes_count` par tunnel, par rapport au plafond d'environ 3 Gbit/s par tunnel — la réponse standard à « VPN lent sous charge » consiste à ajouter des tunnels (ECMP), et non à redimensionner un tunnel.
</details>

**Au-delà des modules** — Étudiez les pages de journalisation par produit : « VPC Flow Logs » (échantillonnage, agrégation, annotations de métadonnées, leviers de coût), « Firewall Rules Logging », « Cloud NAT logging » (TRANSLATIONS_ONLY ou ERRORS_ONLY), « Cloud DNS logging » (journaux de requêtes via des stratégies de serveur pour les zones privées ; journalisation des requêtes sur la zone pour les zones publiques), les journaux d'audit VPC-SC (les refus apparaissent dans le journal d'audit de la stratégie *au niveau de l'organisation*), les journaux **Cloud NGFW** (journalisation des règles de stratégie de pare-feu et journaux de menaces NGFW Enterprise), et les journaux NCC/Cloud Router (état des `bgp_routes` via `get-status`, journaux des tâches du routeur). Pour les métriques, ajoutez Cloud Armor (nombre de requêtes par stratégie de `networksecurity.googleapis.com`, autorisées ou bloquées) à la liste VPN/Interconnect/Router/LB/NAT. Voyez aussi Firewall Insights et Flow Analyzer (5.3).

**⚠️ Piège d'examen** — Les journaux de flux VPC ne capturent que les flux associés aux VM du sous-réseau (y compris les nœuds GKE) ; ils ne capturent pas le trafic vers les frontends de LB *globaux* (utilisez les journaux du LB) ni les flux côté producteur PSA. Choisir « activer les journaux de flux » pour déboguer une erreur 502 du LB est une erreur — les journaux du service de backend et les vérifications d'état sont les bons outils.

---

## 5.2 Maintenance et dépannage des problèmes de connectivité (Maintaining and troubleshooting connectivity issues) {#52-maintaining-and-troubleshooting-connectivity-issues}

> ⏱ ~45 min · 💰 aucun coût supplémentaire · ⚙️ Prérequis : profil VPC Foundation (VM NFS activée, par défaut)

**Pourquoi c'est important pour l'examen** — Le tri de scénarios : drainage des LB et redirection du trafic pendant la maintenance, tunnels VPN qui ne s'établissent pas (incompatibilité IKE, sélecteurs qui se chevauchent), sessions Interconnect/BGP en panne, et utilisation des journaux de flux, des journaux du pare-feu et de Packet Mirroring pour localiser une panne.

**Comment RAD le met en œuvre** — Le chemin de données autoréparateur de la plateforme est le meilleur matériau réel : la VM NFS/Redis s'exécute dans un groupe d'instances géré avec des **vérifications d'état TCP sur les ports 2049 et 6379** et l'autoréparation — arrêtez le processus et observez la détection, la recréation et la reprise, la même boucle observer-diagnostiquer-rétablir que celle évaluée à l'examen. Le concept de drainage des connexions apparaît côté Cloud Run sous la forme du basculement de révisions par `traffic_split` et de l'élagage des anciennes révisions, et le service de backend Cloud Run (délai d'expiration de 30 s) est l'objet que vous draineriez dans un scénario classique de maintenance d'ALB. Il n'y a ni VPN ni Interconnect à dépanner — construisez le lab de test de la section 4.2 pour vous y exercer.

**Essayez**

1. Observez l'autoréparation détecter une défaillance sur la VM NFS :

   ```bash
   gcloud compute health-checks list --format="table(name,type,tcpHealthCheck.port)"
   # SSH via IAP (allowed by the fw-allow-iap-ssh rule) and stop the NFS service
   gcloud compute ssh <nfs-instance-name> --zone=us-central1-a --tunnel-through-iap \
     --command="sudo systemctl stop nfs-kernel-server"
   watch -n 10 "gcloud compute instance-groups managed list-instances <nfs-mig-name> \
     --zone=us-central1-a --format='table(name,instanceStatus,currentAction)'"
   ```

2. Observez `currentAction: RECREATING` (ou VERIFYING) lorsque la vérification d'état échoue, puis le rétablissement du service.
3. Diagnostiquez une panne de pare-feu volontaire : supprimez temporairement la règle d'autorisation des vérifications d'état et observez l'instabilité du MIG, puis rétablissez-la :

   ```bash
   gcloud compute firewall-rules describe vpc-network-<prefix>-fw-allow-lb-hc
   ```

4. Vous savez que cela a fonctionné lorsque vous pouvez corréler l'événement de recréation du MIG dans **Console > Compute Engine > Instance groups** avec le changement d'état de la vérification d'état.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Vous devez retirer du service un MIG de backend d'ALB pour maintenance sans perdre aucune requête. Quelles étapes ?</summary>

R : Configurez le drainage des connexions sur le service de backend (`--connection-draining-timeout`), puis retirez/abandonnez le backend (ou réglez son capacity scaler à 0) : les requêtes en cours se terminent pendant la fenêtre de drainage, tandis que les nouvelles requêtes sont acheminées vers les backends restants. Pour le NEG sans serveur de RAD, l'équivalent consiste à basculer `traffic_split` vers une autre révision avant de supprimer l'ancienne.
</details>

<details>
<summary>Q2 : Un tunnel HA VPN affiche ESTABLISHED, mais la session BGP reste inactive. Principales causes ?</summary>

R : Des IP link-local d'interface/de pair qui ne correspondent pas entre l'interface du Cloud Router et la configuration du pair ; un mauvais ASN de pair ; un pare-feu sur site qui bloque TCP/179 dans le tunnel ; ou une authentification MD5 incohérente. `gcloud compute routers get-status <router> --region=...` affiche l'état de la session BGP et constitue le premier diagnostic attendu à l'examen. (Si le tunnel n'est même pas ESTABLISHED → il s'agit plutôt de problèmes de version IKE, de secret partagé ou d'IP du pair.)
</details>

**Au-delà des modules** — Pratiquez les parcours de tri classiques : « Troubleshoot Cloud VPN » (échecs de phase IKE, coupures lors du renouvellement des clés, réduction de MTU/MSS — MTU VPN d'environ 1460 moins la surcharge ESP, MSS réduite à environ 1360), « Troubleshoot Cloud Interconnect » (LACP, niveaux de signal optique, état des rattachements), le diagnostic des instabilités BGP avec les compteurs BFD, et Packet Mirroring comme outil d'inspection approfondie lorsque les journaux ne suffisent pas (voir 6.4).

**⚠️ Piège d'examen** — Une vérification d'état de LB en échec relève plus souvent d'une question de *pare-feu* que d'application : les backends doivent autoriser `35.191.0.0/16` et `130.211.0.0/22` (ou `35.235.240.0/20` pour certains chemins régionaux). RAD l'encode à deux endroits — la règle VPC `fw-allow-lb-hc` et les blocs d'entrée de la NetworkPolicy GKE — car chacune des deux couches peut casser indépendamment les vérifications d'état.

---

## 5.3 Utilisation de Network Intelligence Center pour surveiller et résoudre les problèmes réseau courants (Using Network Intelligence Center to monitor and troubleshoot common networking issues) {#53-using-network-intelligence-center-to-monitor-and-troubleshoot-common-networking-issues}

> ⏱ ~40 min · 💰 les Connectivity Tests sont gratuits pour un usage modéré · ⚙️ Prérequis : profil VPC Foundation (tout déploiement vous fournit des cibles de test)

**Pourquoi c'est important pour l'examen** — Chacun des cinq outils de Network Intelligence Center répond à une question précise : **Network Topology** (qui communique avec qui, avec le débit), **Connectivity Tests** (un 5-tuple atteindrait-il/atteint-il sa destination, et quelle règle/route en décide), **Performance Dashboard** (latence/perte de paquets, avec une vue à l'échelle de Google et une vue limitée au projet), **Firewall Insights** (règles masquées/trop permissives/inutilisées), **Network Analyzer** (contrôles de configuration continus — épuisement des IP, conflits de routes, PSA mal configuré), plus **Flow Analyzer** sur les journaux de flux VPC.

**Comment RAD le met en œuvre** — Non mis en œuvre sous forme de ressources (rien à configurer), mais chaque outil peut être pointé *vers* l'ensemble déployé, ce qui correspond à la compétence réaliste attendue à l'examen. Le VPC RAD offre des cas de test tout prêts : VM→IP privée de Cloud SQL via PSA, VM→VM sous les règles intra-VPC, Internet→frontend du LB, et chemins plage de pods→NFS.

**Essayez**

1. Lancez un Connectivity Test depuis la VM NFS vers l'IP privée de Cloud SQL — il traverse l'appairage PSA et affiche la trace de transfert complète :

   ```bash
   gcloud network-management connectivity-tests create nfs-to-sql \
     --source-instance=projects/<project>/zones/us-central1-a/instances/<nfs-instance> \
     --destination-ip-address=<cloudsql-private-ip> \
     --destination-port=5432 --protocol=TCP
   gcloud network-management connectivity-tests describe nfs-to-sql \
     --format="yaml(reachabilityDetails.result,reachabilityDetails.traces[0].steps[].description)"
   ```

2. Créez un test volontairement bloqué (par exemple le port de destination 25 vers une IP externe) et lisez quelle étape le refuse.
3. Ouvrez **Console > Network Intelligence > Network Topology** et repérez l'arête LB → Cloud Run générée par votre trafic de test ; ouvrez ensuite **Network Analyzer** et cherchez des insights portant sur les plages secondaires GKE (des avertissements d'utilisation des IP apparaissent à mesure que les plages se remplissent).
4. Vous savez que cela a fonctionné lorsque le premier test renvoie `result: REACHABLE` avec une étape de trace montrant le saut d'appairage, et que le test bloqué nomme le refus précis.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Des utilisateurs à Francfort signalent un accès lent aux backends de us-central1, mais les métriques de l'application semblent saines. Quel outil NIC utiliser en premier ?</summary>

R : Performance Dashboard — il affiche la latence inter-régions et la perte de paquets mesurées par Google pour le trafic de votre projet par rapport à la référence mondiale, ce qui permet de distinguer « le réseau est lent » de « l'application est lente ». Si le réseau est sain, passez aux métriques `backend_latencies` et `total_latencies` du LB pour séparer le temps de l'origine du temps en périphérie.
</details>

<details>
<summary>Q2 : Une nouvelle règle de refus a été ajoutée et une application a cessé de fonctionner, mais il existe des dizaines de règles candidates. Quel est le chemin le plus rapide vers la coupable ?</summary>

R : Un Connectivity Test pour le 5-tuple exact — sa trace nomme la règle correspondante (autorisation ou refus) à chaque étape, y compris les règles implicites. Firewall Insights le complète pour l'hygiène (détection des règles masquées : une règle jamais atteinte parce qu'une règle de priorité supérieure la masque).
</details>

**Au-delà des modules** — Étudiez « Network Analyzer insights reference » (il signale exactement ce que la conception de RAD empêche : allocations PSA qui se chevauchent, épuisement de la plage de pods GKE, prochains sauts invalides), « Flow Analyzer » (analyse des journaux de flux VPC adossée à BigQuery — exige que vous ayez activé les journaux de flux, comme en 5.1), et l'*analyse du plan de données en direct* des Connectivity Tests (qui envoie de vrais paquets de sonde pour les chemins compatibles, par opposition à l'analyse de configuration toujours disponible).

**⚠️ Piège d'examen** — L'analyse de configuration des Connectivity Tests peut renvoyer REACHABLE alors que la charge de travail échoue toujours : elle modélise la configuration du VPC (routes/pare-feu/appairage), pas les pare-feu sur la VM (iptables), les écouteurs de l'application ni la NetworkPolicy Kubernetes. Les stratégies `enable_network_segmentation` de RAD lui sont invisibles — une connexion de pod refusée avec un Connectivity Test au vert est normale, pas contradictoire.
