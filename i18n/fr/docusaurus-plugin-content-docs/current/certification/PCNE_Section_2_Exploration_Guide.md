---
title: "Préparation PCNE, section 2 : mise en œuvre d'un réseau VPC"
description: "Préparez la section 2 de l'examen Professional Cloud Network Engineer (PCNE) — mise en œuvre d'un réseau VPC — avec des labs pratiques RAD sur Google Cloud."
---
<!-- translated-from: docs/certification/PCNE_Section_2_Exploration_Guide.md @ cb682e8 sha256:48154ceafc21 -->

# Guide de préparation à la certification PCNE : Section 2 — Mise en œuvre d'un réseau VPC (Implementing a VPC network) (~20 % de l'examen) {#pcne-certification-preparation-guide-section-2--implementing-a-vpc-network-20-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pcne_section2.png" alt="Guide de préparation à la certification PCNE : Section 2 — Mise en œuvre d'un réseau VPC (~20 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

> 📚 **Guide officiel de l'examen :** [Professional Cloud Network Engineer certification](https://cloud.google.com/learn/certification/cloud-network-engineer) — vérifiez toujours la pondération des sections dans le guide d'examen Google Cloud en vigueur.

La section 2 passe de la conception aux automatismes `gcloud compute networks ...` : création de VPC, de sous-réseaux, de règles de pare-feu, de routes et de clusters GKE de VPC natif. Déployez le profil **VPC Foundation** (Services_GCP + App_CloudRun) pour les parties 2.1–2.2 et ajoutez le profil **GKE Network Lab** pour la partie 2.4. Ajoutez le profil **Locked-Down Perimeter** si vous voulez des ressources VPC-SC réelles. Modules mis en pratique : `Services_GCP`, `App_GKE`, `App_Common`.

---

## 2.1 Configuration des VPC (Configuring VPCs) {#21-configuring-vpcs}

> ⏱ ~60 min · 💰 aucun coût supplémentaire · ⚙️ Prérequis : profil VPC Foundation (ajoutez Locked-Down Perimeter pour VPC-SC)

**Pourquoi c'est important pour l'examen** — C'est le domaine de mise en œuvre de base : réseaux en mode personnalisé, création et *extension* de sous-réseaux, règles de pare-feu ou stratégies, allocation de l'accès aux services privés, accès privé à Google (Private Google Access), rattachement au VPC partagé et périmètres VPC-SC.

**Comment RAD le met en œuvre** — Voici comment la plateforme construit le réseau :

| Ressource | Points clés |
|---|---|
| Réseau VPC | `vpc-network-{prefix}`, en mode personnalisé (les sous-réseaux ne sont pas créés automatiquement) |
| Sous-réseau GCE | un par entrée de `availability_regions`, CIDR issu de `subnet_cidr_range` (par défaut `["10.0.0.0/24"]`), description `managed-by=services-gcp` |
| Règles de pare-feu | `{net}-fw-allow-lb-hc` (sources `35.191.0.0/16`, `130.211.0.0/22`, tcp 80/2049/6379) ; `{net}-fw-allow-iap-ssh` (source `35.235.240.0/20`, tcp 22) ; autorisation intra-VPC tcp/udp/icmp depuis tous les CIDR internes ; règles limitées par tag (`nfsserver`, `redisserver`, `httpserver`, `webserver`) |
| PSA | adresse globale `{net}-psconnect-ip-range` réservée à l'appairage VPC avec une longueur de préfixe de 16, plus une connexion Service Networking (l'appairage est abandonné, et non supprimé, lors de la suppression) |

Private Google Access est activé partout : il est actif sur les sous-réseaux GCE et GKE de Services_GCP, ainsi que sur les sous-réseaux *intégrés* créés lorsqu'aucun VPC Services_GCP n'existe — les instances sans IP externe (par exemple la VM NFS) joignent donc les API Google par le chemin privé. Pour VPC-SC : `enable_vpc_sc` (par défaut `false`) construit le périmètre `vpcsc_{prefix}_perimeter` avec 15 services restreints, quatre niveaux d'accès (CIDR du VPC, `admin_ip_ranges`, l'agent de service IAP, les comptes de service CI/CD) et `vpc_sc_dry_run` (par défaut `true`). Il est ignoré avec un avertissement dans la console, sauf si un ID d'organisation peut être découvert depuis le projet, si `admin_ip_ranges` n'est pas vide et si l'appelant réussit une sonde d'autorisation Access Context Manager au niveau de l'organisation.

**Essayez**

1. Listez les règles et comparez-les au tableau ci-dessus :

   ```bash
   gcloud compute firewall-rules list \
     --filter="network~vpc-network" \
     --format="table(name,direction,sourceRanges.list(),allowed[].map().firewall_rule().list(),targetTags.list())"
   ```

2. Vérifiez Private Google Access pour chaque sous-réseau — tous les sous-réseaux gérés par les modules devraient l'afficher comme activé :

   ```bash
   gcloud compute networks subnets list --network=vpc-network-<prefix> \
     --format="table(name,region,ipCidrRange,privateIpGoogleAccess)"
   ```

3. Connaissez l'équivalent manuel pour les sous-réseaux que vous créez vous-même (les sous-réseaux des modules ont déjà PGA activé) :

   ```bash
   gcloud compute networks subnets update <your-subnet> \
     --region=us-central1 --enable-private-ip-google-access
   ```

4. Si vous avez déployé le profil Locked-Down Perimeter dans un projet rattaché à une organisation, affichez le périmètre : **Console > Security > VPC Service Controls** — il apparaît sous la stratégie d'accès de l'organisation, en mode simulation (dry-run).
5. Vous savez que cela a fonctionné lorsque `privateIpGoogleAccess: True` s'affiche sur chaque sous-réseau des modules et que (pour VPC-SC) `gcloud access-context-manager perimeters list --policy=<policy-id>` affiche `vpcsc_<prefix>_perimeter`.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Le sous-réseau 10.0.0.0/24 est presque plein. Pouvez-vous l'agrandir sans interruption de service, et quelle est la contrainte ?</summary>

R : Oui — `gcloud compute networks subnets expand-ip-range vpc-network-<prefix>-subnet-us-central1 --region=us-central1 --prefix-length=23`. L'extension ne peut que *raccourcir* le préfixe (plage plus grande), ne doit chevaucher aucun autre sous-réseau ni l'allocation PSA, et ne peut pas être annulée. Le Terraform de RAD afficherait ensuite une dérive — dans les environnements IaC, modifiez plutôt `subnet_cidr_range` et laissez le plan s'en charger.
</details>

<details>
<summary>Q2 : Pourquoi les règles de pare-feu des vérifications d'état autorisent-elles exactement 35.191.0.0/16 et 130.211.0.0/22 ?</summary>

R : Ce sont les plages centrales des sondes de vérification d'état de Google pour la plupart des types d'équilibreurs de charge. Sans autorisation d'entrée depuis ces plages, les backends sont marqués comme non opérationnels et le LB renvoie des erreurs 502 alors que l'application fonctionne — l'une des réponses de dépannage de LB les plus fréquentes à l'examen. RAD les intègre à la fois dans les règles VPC (`fw-allow-lb-hc`) et dans la NetworkPolicy GKE.
</details>

<details>
<summary>Q3 : enable_vpc_sc = true, mais aucun périmètre n'apparaît et l'application a réussi. Pourquoi ?</summary>

R : Par conception, le module se dégrade proprement : VPC-SC est ignoré (avec un avertissement) si le projet n'a pas d'organisation découvrable, si `admin_ip_ranges` est vide (prévention du verrouillage), ou si l'appelant échoue à la sonde d'autorisation `gcloud access-context-manager policies list`. Recherchez dans le journal d'application les lignes WARNING des validateurs VPC-SC.
</details>

**Au-delà des modules** — Non mis en œuvre : le **VPC partagé** (`gcloud compute shared-vpc enable`, `associated-projects add`, attributions de `roles/compute.networkUser` au niveau du sous-réseau), l'**appairage VPC entre VPC consommateurs** (seul l'appairage avec le producteur PSA existe), les **pools privés** pour Cloud Build à l'intérieur du périmètre, les **interfaces publiques** pour les API Google comme alternative à Private Google Access, et les **stratégies de pare-feu réseau** globales (les modules utilisent les règles de pare-feu VPC classiques par réseau — voir la section 6.2). Étudiez « Provision Shared VPC » et « Migrate firewall rules to network firewall policies ».

**⚠️ Piège d'examen** — Un périmètre VPC-SC n'est pas un pare-feu : il contrôle l'accès aux *API* Google (qui peut appeler `storage.googleapis.com` pour les données du projet), pas le flux de paquets entre VM. À l'inverse, les règles de pare-feu ne peuvent pas empêcher une exfiltration via `gsutil cp` vers un bucket appartenant à un attaquant — c'est exactement la raison d'être de VPC-SC.

---

## 2.2 Configuration du routage VPC (Configuring VPC routing) {#22-configuring-vpc-routing}

> ⏱ ~40 min · 💰 aucun coût supplémentaire · ⚙️ Prérequis : profil VPC Foundation

**Pourquoi c'est important pour l'examen** — La priorité des routes (les routes de sous-réseau l'emportent sur tout ; viennent ensuite les routes personnalisées statiques/dynamiques selon leur priorité), le routage dynamique global ou régional, les routes basées sur des règles, le LB interne comme prochain saut pour les NVA, et l'échange de routes personnalisées via l'appairage peuvent tous faire l'objet de questions.

**Comment RAD le met en œuvre** — Trois éléments de routage vérifiés :

1. **Cloud Router** — un Cloud Router nommé `{net}-nat-gw-{region}` avec l'ASN 64514 et aucun groupe annoncé. Il n'existe que pour héberger Cloud NAT ; aucun pair BGP n'est configuré.
2. **Échange de routes d'appairage** — l'appairage PSA importe et exporte des routes personnalisées afin que les plages de *pods* GKE atteignent le réseau producteur de Cloud SQL, et inversement.
3. **Export de routes de sous-réseau via PSA** — le chemin GKE intégré va encore plus loin : comme une plage secondaire GKE est une route de *sous-réseau* (et non une route personnalisée), la plateforme exécute `gcloud compute networks peerings update servicenetworking-googleapis-com --export-subnet-routes-with-public-ip --import-subnet-routes-with-public-ip`. Sans cela, le trafic des pods atteint Cloud SQL sur le port 3307, mais les réponses n'ont pas de route de retour.

**Essayez**

1. Affichez la table de routage effective et identifiez l'origine de chaque route :

   ```bash
   gcloud compute routes list \
     --filter="network~vpc-network" \
     --format="table(name,destRange,nextHopGateway.basename(),nextHopPeering,priority)"
   ```

   À attendre : une route de sous-réseau par sous-réseau/plage secondaire, une `default-route-*` vers `default-internet-gateway`, et des routes d'appairage pour la plage PSA.
2. Inspectez les indicateurs d'échange de routes de l'appairage :

   ```bash
   gcloud compute networks peerings list --network=vpc-network-<prefix> \
     --format="table(name,exportCustomRoutes,importCustomRoutes,exchangeSubnetRoutes)"
   ```

3. Vérifiez le mode de routage dynamique du réseau (les modules conservent la valeur par défaut) :

   ```bash
   gcloud compute networks describe vpc-network-<prefix> --format="value(routingConfig.routingMode)"
   ```

4. Vous savez que cela a fonctionné lorsque vous pouvez expliquer chaque ligne de la liste des routes — en particulier celles qui proviennent de l'appairage `servicenetworking`.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Deux routes statiques personnalisées correspondent à une destination : 0.0.0.0/0 de priorité 1000 via la passerelle Internet, et 10.50.0.0/16 de priorité 900 via une NVA. Un paquet à destination de 10.50.1.5 — par où passe-t-il ?</summary>

R : Par la NVA. La correspondance du préfixe le plus long l'emporte avant même que la priorité ne soit prise en compte (/16 l'emporte sur /0) ; la priorité ne sert qu'à départager des routes de même longueur de préfixe (le nombre le plus bas l'emporte).
</details>

<details>
<summary>Q2 : Pourquoi App_GKE a-t-il eu besoin de `--export-subnet-routes-with-public-ip` sur l'appairage PSA alors que l'export de routes personnalisées était déjà activé ?</summary>

R : Les plages secondaires GKE (IP d'alias) se propagent sous forme de *routes de sous-réseau*, et l'export de routes personnalisées ne couvre que les routes personnalisées statiques/dynamiques. Les indicateurs « subnet routes with public IP », au nom trompeur, contrôlent l'export/import des routes de sous-réseau via l'appairage ; sans leur export, le VPC producteur n'a aucun chemin de retour vers les IP des pods. Cette distinction — échange de routes personnalisées ou de routes de sous-réseau via l'appairage — correspond précisément au sous-thème « configuration de l'import/export de routes personnalisées » de la partie 2.2.
</details>

**Au-delà des modules** — À étudier : les **tags réseau sur les routes** (`gcloud compute routes create --tags` limite une route aux instances taguées — RAD n'utilise les tags que sur les règles de pare-feu), les **routes basées sur des règles** (`gcloud network-connectivity policy-based-routes create`, correspondance sur protocole/source/destination, redirection vers un LB interne), le **LB passthrough interne comme prochain saut** pour des NVA en haute disponibilité, les **priorités de routes en routage dynamique global** (coût inter-région ajouté à la priorité des routes apprises, et la manière dont les routes basées sur des règles prennent le pas sur les routes dynamiques), ainsi que l'**import/export de routes personnalisées via NCC** et l'appairage de réseaux VPC. Rien de cela n'existe dans les modules.

**⚠️ Piège d'examen** — Supprimer la route par défaut (`0.0.0.0/0 → default-internet-gateway`) ne bloque *pas* l'accès aux API Google si Private Google Access est activé — le chemin PGA fonctionne toujours. En revanche, cela casse la sortie Cloud NAT, qui dépend de cette route par défaut.

---

## 2.3 Configuration de Network Connectivity Center (Configuring Network Connectivity Center) {#23-configuring-network-connectivity-center}

> ⏱ ~30 min d'étude · 💰 aucun · ⚙️ Prérequis : rien — concept uniquement

**Pourquoi c'est important pour l'examen** — NCC est la réponse en étoile (hub-and-spoke) de Google au problème « de nombreux VPC + de nombreux sites » : les spokes VPC offrent une joignabilité transitive de VPC à VPC que l'appairage simple ne permet pas, les spokes hybrides (VPN/Interconnect/appliance de routeur) permettent le transfert de données de site à site via le réseau backbone de Google, et les spokes de VPC producteur propagent les réseaux PSA.

**Comment RAD le met en œuvre** — Non mis en œuvre par les modules de fondation. L'élément réel le plus proche est le *problème que NCC résout* : l'appairage PSA de RAD est non transitif, et son schéma de VPC intégrés multi-déploiements (CIDR distincts par hachage, section 1.2) existe précisément parce qu'aucun hub ne relie ces VPC.

**Essayez**

1. Dans un projet de test, créez un hub et rattachez-y le VPC RAD en tant que spoke (impact en lecture seule sur le VPC lui-même) :

   ```bash
   gcloud network-connectivity hubs create rad-lab-hub --description="PCNE practice"
   gcloud network-connectivity spokes linked-vpc-network create rad-vpc-spoke \
     --hub=rad-lab-hub --global \
     --vpc-network=projects/<project>/global/networks/vpc-network-<prefix>
   gcloud network-connectivity hubs route-tables list --hub=rad-lab-hub
   ```

2. Vous savez que cela a fonctionné lorsque la table de routage du hub liste les sous-réseaux RAD comme entrées dynamiques — c'est NCC qui apprend les routes du spoke VPC.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Le VPC-A est appairé avec le VPC-B, le VPC-B avec le VPC-C. A doit joindre C. NCC ou davantage d'appairages ?</summary>

R : NCC, avec les trois VPC comme spokes VPC sur un même hub (topologie maillée) — l'appairage est non transitif, et ajouter un appairage A↔C évolue en O(n²). Avec NCC, les sous-réseaux des spokes sont échangés par le hub et la joignabilité est transitive ; utilisez des filtres d'export IP/CIDR sur les spokes pour exclure des plages (par exemple celles qui se chevauchent).
</details>

<details>
<summary>Q2 : Quand choisir une topologie en étoile plutôt que maillée pour des spokes VPC ?</summary>

R : En étoile lorsque les VPC périphériques ne doivent joindre que le centre (services partagés) et *pas* les uns les autres — par exemple des VPC par client qui doivent rester mutuellement isolés tout en consommant des services centraux. La topologie maillée offre une connectivité de tous vers tous.
</details>

**Au-delà des modules** — Étudiez « Network Connectivity Center overview » : les types de spokes (spoke VPC, spoke hybride — VPN, rattachement VLAN ou appliance de routeur — et spoke de VPC producteur), étoile ou maillage, les filtres d'export d'inclusion/exclusion de plages IP/CIDR sur les spokes, Private NAT au niveau du hub pour les spokes qui se chevauchent, la propagation PSC via NCC, et la surveillance (tables de routage du hub, état des spokes). Sachez que les spokes hybrides ne permettent le *transfert de données de site à site* que dans les régions compatibles.

---

## 2.4 Configuration et maintenance des clusters GKE (Configuring and maintaining GKE clusters) {#24-configuring-and-maintaining-gke-clusters}

> ⏱ ~75 min · 💰 coût du cluster Autopilot · ⚙️ Prérequis : profil GKE Network Lab (`enable_network_segmentation = true` sur App_GKE)

**Pourquoi c'est important pour l'examen** — Le pendant « mise en œuvre » de la partie 1.4 : clusters de VPC natif avec IP d'alias, Dataplane V2 ou stratégies réseau Calico, points de terminaison privés/réseaux autorisés, SNAT/masquage d'IP, et choix du DNS du cluster.

**Comment RAD le met en œuvre** — Câblage du cluster vérifié :

| Aspect | Mise en œuvre dans RAD |
|---|---|
| VPC natif | clusters à IP d'alias avec plages secondaires nommées par cluster |
| Dataplane V2 | activé sur tous les clusters Services_GCP ; le cluster intégré ne l'active que lorsque `enable_network_segmentation = true` |
| Accès au plan de contrôle | Point de terminaison public ; le cluster intégré ajoute des réseaux autorisés maîtres avec l'accès des CIDR publics de Google activé et un bloc `0.0.0.0/0` explicite (l'authentification reste imposée par les identifiants) |
| NetworkPolicy | `enable_network_segmentation` (par défaut `false`) crée une stratégie couvrant tout l'espace de noms : entrée depuis le même espace de noms + plages de vérification d'état du LB + `35.235.240.0/20`, plus `0.0.0.0/0` sur le port du conteneur dès que `service_type` vaut `LoadBalancer` ou `NodePort` (un NLB L4 préserve l'IP du client, si bien que le trafic réel ne correspond à aucune plage Google) ; sortie limitée au DNS (53), au HTTPS y compris `199.36.153.4/30` et `199.36.153.8/30`, au loopback du proxy Cloud SQL et à `3307 → 10.0.0.0/8`, aux métadonnées `169.254.169.254:80` et au NFS 2049 |
| Exposition du service | `service_type` par défaut `LoadBalancer` avec l'annotation `networking.gke.io/load-balancer-type: External`, `session_affinity` par défaut `ClientIP` |
| DNS | kube-dns/Cloud DNS par défaut du cluster selon les valeurs par défaut de GKE — les modules ne configurent rien de spécifique au DNS |

**Essayez**

1. Déployez, puis vérifiez Dataplane V2 et les plages secondaires en une seule passe :

   ```bash
   gcloud container clusters describe gke-cluster-1-<prefix> --location=us-central1 \
     --format="yaml(datapathProvider,ipAllocationPolicy.clusterSecondaryRangeName,ipAllocationPolicy.servicesSecondaryRangeName,masterAuthorizedNetworksConfig)"
   ```

2. Inspectez la NetworkPolicy créée par le module et testez son application :

   ```bash
   gcloud container clusters get-credentials gke-cluster-1-<prefix> --location=us-central1
   kubectl get networkpolicy -A
   kubectl describe networkpolicy -n <app-namespace> <prefix>-namespace-isolation
   # Negative test: a pod in a *different* namespace cannot reach the app
   kubectl run probe --rm -it --image=busybox --restart=Never -n default \
     -- wget -qO- --timeout=5 http://<service-name>.<app-namespace>.svc.cluster.local || echo "BLOCKED (expected)"
   ```

3. Passez `enable_network_segmentation = false` dans votre portail, redéployez et relancez la sonde — elle réussit désormais.
4. Vous savez que cela a fonctionné lorsque la sonde inter-espaces de noms expire avec la stratégie activée et réussit sans elle.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Pourquoi la stratégie de sortie autorise-t-elle le port 443 vers 199.36.153.4/30 et aussi une règle 443 sans restriction ?</summary>

R : `199.36.153.4/30` correspond à restricted.googleapis.com — il ne sert le trafic que lorsqu'une zone Cloud DNS fait correspondre `*.googleapis.com` à ces VIP. RAD ne crée pas cette zone DNS ; kube-dns renvoie donc des IP Google publiques (par exemple pour `sqladmin.googleapis.com`), et le sidecar cloud-sql-proxy se bloquerait sans une autorisation générale de sortie HTTPS. Le module documente ce raisonnement à double chemin dans la NetworkPolicy — et l'examen affectionne la dépendance « la VIP restreinte exige la zone DNS ».
</details>

<details>
<summary>Q2 : Les pods d'un cluster Standard doivent joindre une plage sur site 172.16.0.0/12, mais le trafic arrive sur site avec les IP des nœuds, ce qui casse les ACL basées sur la source. Que se passe-t-il ?</summary>

R : L'agent de masquage d'IP effectue une SNAT des IP de pods vers les IP des nœuds pour les destinations situées hors de ses `nonMasqueradeCIDRs` (la valeur par défaut couvre la RFC 1918, mais les configurations personnalisées la réduisent souvent). Corrigez en ajoutant 172.16.0.0/12 aux nonMasqueradeCIDRs (ou en configurant l'équivalent de Dataplane V2) afin que les IP de pods soient préservées — puis assurez-vous que le site dispose d'une route de retour vers le CIDR des pods. RAD ne configure pas le masquage ; connaissez le comportement par défaut.
</details>

<details>
<summary>Q3 : Pourquoi `0.0.0.0/0` dans les réseaux autorisés du cluster intégré n'équivaut-il pas à « aucune authentification » ?</summary>

R : Les réseaux autorisés sont un filtre de *couche réseau* sur qui peut ouvrir une session TCP vers le plan de contrôle ; chaque requête exige toujours des identifiants IAM/OIDC valides. Le module les ouvre parce que les IP des workers Cloud Build sont imprévisibles. Les alternatives de durcissement sont les points de terminaison privés avec des pools privés, ou le point de terminaison du plan de contrôle basé sur DNS, qui autorise via IAM plutôt que par CIDR.
</details>

**Au-delà des modules** — À étudier : les **clusters en VPC partagé** (les plages secondaires résident dans le projet hôte ; les agents de service GKE ont besoin de `roles/compute.networkUser` + Host Service Agent User) ; les **clusters privés** et les points de terminaison privés du plan de contrôle ; le **point de terminaison basé sur DNS** (`gcloud container clusters update --enable-dns-access`) ; les **plages de pods supplémentaires** pour soulager l'espace IP ; **NodeLocal DNSCache** et **Cloud DNS pour GKE** (`--cluster-dns=clouddns`) ; les détails de SNAT/`ip-masq-agent`. Documentation : « About cluster networking », « Use Cloud DNS for GKE ».

**⚠️ Piège d'examen** — La NetworkPolicy Kubernetes sur GKE nécessite un moteur d'application : Dataplane V2 (ou l'ancien Calico en mode Standard). Sur un cluster créé sans fournisseur de chemin de données spécifié et sans Calico, les stratégies sont acceptées par le serveur d'API mais ne sont silencieusement pas appliquées — c'est exactement pour cela que RAD lie Dataplane V2 à `enable_network_segmentation`, et que modifier cet indicateur ultérieurement impose de *recréer* le cluster (le champ est immuable).
