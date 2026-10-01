---
title: "Préparation PCNE, section 3 : services réseau gérés"
description: "Préparez la section 3 de l'examen Professional Cloud Network Engineer (PCNE) — configuration des services réseau gérés — avec des labs pratiques RAD sur Google Cloud."
---
<!-- translated-from: docs/certification/PCNE_Section_3_Exploration_Guide.md @ cb682e8 -->

# Guide de préparation à la certification PCNE : Section 3 — Configuration des services réseau gérés (Configuring managed network services) (~16 % de l'examen) {#pcne-certification-preparation-guide-section-3--configuring-managed-network-services-16-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pcne_section3.png" alt="Guide de préparation à la certification PCNE : Section 3 — Configuration des services réseau gérés (~16 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cette section couvre l'équilibrage de charge, Cloud CDN et Cloud DNS. RAD vous fournit *deux* constructions complètes d'équilibreur de charge d'application externe global à comparer : le moteur Cloud Run en assemble une explicitement à partir des primitives d'équilibrage de charge (NEG → service de backend → mappage d'URL → proxys → règles de transfert), tandis que le moteur GKE laisse le contrôleur Gateway assembler la même chaîne à partir de manifestes Kubernetes. Déployez le profil **Global Edge** avant de commencer. Cloud DNS n'est pas mis en œuvre — prévoyez un réel temps d'étude pour la partie 3.3.

---

## 3.1 Configuration de l'équilibrage de charge (Configuring load balancing) {#31-configuring-load-balancing}

> ⏱ ~90 min · 💰 frais de règle de transfert + de requêtes LB tant qu'il est déployé · ⚙️ Prérequis : profil Global Edge (`enable_cloud_armor = true` sur App_CloudRun (`application_domains` facultatif) ; `enable_custom_domain = true` sur App_GKE)

**Pourquoi c'est important pour l'examen** — L'arbre de décision des LB (interne/externe × régional/global × application/proxy/passthrough) ainsi que la mécanique des backends — types de NEG, modes d'équilibrage, affinité de session, vérifications d'état, mappages d'URL — constituent le sujet le plus rentable de la section 3. GKE y ajoute le choix entre les contrôleurs Gateway et Ingress, et l'équilibrage de charge natif en conteneurs avec des NEG.

**Comment RAD le met en œuvre** —

**Chemin Cloud Run** : lorsque `enable_cloud_armor` (par défaut `false`) ou `enable_cdn` (par défaut `false`) vaut true, le module règle l'entrée du service sur `internal-and-cloud-load-balancing` et construit : un NEG sans serveur *régional* pointant vers le service Cloud Run → un service de backend (protocole HTTPS, délai d'expiration de 30 s, schéma externe géré, journalisation des requêtes au taux d'échantillonnage complet) → un mappage d'URL → un proxy cible HTTPS avec un mappage de certificats Certificate Manager (certificats gérés par Google par domaine) → des règles de transfert globales sur une IP statique globale réservée (`{service}-lb-ip`), plus une redirection HTTP→HTTPS (permanente). Sans domaine personnalisé (chemin CDN seul), un certificat SSL géré par Google est émis à la place pour un nom d'hôte `<ip-dashed>.nip.io`.

**Chemin GKE** : lorsque `enable_custom_domain = true`, une `Gateway` avec `gatewayClassName: gke-l7-global-external-managed` (ALB externe global), des écouteurs HTTP/80 (+HTTPS/443 lorsque `application_domains` est défini), une `NamedAddress` pointant vers une adresse globale réservée, un mappage de certificats via l'annotation `networking.gke.io/cert-map`, une `HTTPRoute` vers le Service et une `GCPBackendPolicy` portant le délai d'expiration du backend, IAP en option et la stratégie de sécurité Cloud Armor. Sans la Gateway, l'exposition par défaut est un Service `LoadBalancer` (Network LB *passthrough* externe régional) avec `session_affinity` par défaut `ClientIP` et une IP statique régionale facultative (`reserve_static_ip`, par défaut `true`). Vérifications d'état : Cloud Run s'appuie sur la plateforme plus les `startup_probe_config`/`health_check_config` du conteneur ; les backends GKE reçoivent des sondes à partir des mêmes variables, et le pare-feu du VPC partagé (`fw-allow-lb-hc`) admet les plages des sondes de Google.

**Essayez**

1. Déployez le profil Global Edge, puis parcourez la chaîne LB de Cloud Run dans **Console > Network services > Load balancing** :

   ```bash
   gcloud compute network-endpoint-groups list --format="table(name,networkEndpointType,region)"
   gcloud compute backend-services describe <service>-backend --global \
     --format="yaml(loadBalancingScheme,protocol,backends,securityPolicy,enableCDN,logConfig)"
   gcloud compute url-maps list
   gcloud compute forwarding-rules list --global \
     --format="table(name,IPAddress,portRange,target)"
   ```

2. Côté GKE, comparez avec ce qu'a généré le contrôleur Gateway :

   ```bash
   kubectl get gateway,httproute,gcpbackendpolicy -n <app-namespace>
   kubectl describe gateway <prefix>-gateway -n <app-namespace>   # note the programmed IP
   gcloud compute backend-services list --format="table(name,loadBalancingScheme)"  # gkegw1-* entries
   ```

3. Interrogez l'IP statique avec curl et un en-tête Host avant que le DNS n'existe :

   ```bash
   curl -sk -H "Host: app.example.com" https://<global-ip>/ -o /dev/null -w "%{http_code}\n"
   ```

4. Vous savez que cela a fonctionné lorsque la ressource Gateway affiche une condition `Programmed: True` et que les deux LB apparaissent avec une portée globale dans la liste d'équilibrage de charge de la console.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Pourquoi le NEG sans serveur est-il régional alors que l'équilibreur de charge est global ?</summary>

R : Les NEG sans serveur sont toujours des objets régionaux (ils encapsulent un service Cloud Run/Functions régional), mais un ALB externe global peut rattacher des NEG régionaux de plusieurs régions à un même service de backend et acheminer les clients vers la région opérationnelle la plus proche via l'anycast. C'est le modèle de RAD avec une seule région ; une configuration multirégion ajouterait un NEG par région au même service de backend.
</details>

<details>
<summary>Q2 : Le trafic doit être réparti à 90/10 entre deux versions de l'application. Où RAD le fait-il, et où l'*examen* le ferait-il sur un ALB ?</summary>

R : RAD répartit au niveau de la *révision* Cloud Run via `traffic_split` (pourcentages LATEST/REVISION) — le LB n'en a pas connaissance. La réponse native de l'ALB passe par les `routeRules` du mappage d'URL avec `weightedBackendServices` (plus `requestMirrorPolicy` pour la mise en miroir et `urlRewrite` pour les réécritures), ou, sur GKE Gateway, par plusieurs `backendRefs` avec `weight` dans la HTTPRoute. Connaissez les deux niveaux et sachez qu'ils se combinent.
</details>

<details>
<summary>Q3 : Les requêtes d'un client aboutissent sans cesse sur des pods différents malgré `sessionAffinity: ClientIP` sur le Service GKE. L'application est atteinte via la Gateway. Pourquoi ?</summary>

R : Le trafic Gateway/ALB atteint les pods via des NEG, en contournant la sémantique des Services de kube-proxy — l'affinité ClientIP du Service s'applique au trafic passthrough/interne au cluster, pas à la sélection de backend de l'ALB. Pour le chemin Gateway, configurez l'affinité sur le backend via `GCPBackendPolicy` (`sessionAffinity`), que RAD laisse non défini.
</details>

**Au-delà des modules** — Non mis en œuvre : ALB/NLB internes (aucun schéma `INTERNAL_MANAGED`/`INTERNAL` nulle part, aucun sous-réseau proxy-only), backends MIG avec autoscaling, modes d'équilibrage (UTILIZATION/RATE/CONNECTION) et capacité de service (`--max-rate-per-instance`, capacity scaler) — le seul backend des modules est un NEG sans serveur, qui n'accepte aucun mode d'équilibrage —, l'accès global sur les LB internes, l'ancien **contrôleur GKE Ingress** avec `BackendConfig` (RAD a choisi Gateway API), et la **gestion du trafic** de l'ALB (répartitions pondérées, mise en miroir, réécritures d'URL). Étudiez « Choose a load balancer » (mémorisez l'arbre de décision) et « Traffic management overview for global external Application Load Balancers » ; dans un projet de test, créez un ALB interne pour voir le sous-réseau proxy-only requis (`gcloud compute networks subnets create ... --purpose=REGIONAL_MANAGED_PROXY`).

**⚠️ Piège d'examen** — Les LB passthrough (Network LB interne/externe) préservent les IP sources des clients et exigent des règles de pare-feu de backend pour les plages des *clients* ; les LB proxy (ALB, NLB proxy) terminent les connexions, si bien que les backends voient les plages des proxys et que vous devez autoriser `130.211.0.0/22` + `35.191.0.0/16` pour les vérifications d'état et lire les IP des clients dans `X-Forwarded-For`. Confondre les deux fausse à la fois les réponses sur le pare-feu et sur la journalisation.

---

## 3.2 Configuration de Cloud CDN (Configuring Cloud CDN) {#32-configuring-cloud-cdn}

> ⏱ ~30 min · 💰 frais de sortie du cache pendant les tests · ⚙️ Prérequis : profil Global Edge avec `enable_cdn = true` (App_CloudRun)

**Pourquoi c'est important pour l'examen** — Savoir quelles origines Cloud CDN prend en charge (services de backend avec MIG, buckets de backend pour GCS, NEG sans serveur pour Cloud Run, NEG Internet pour les origines externes), comment fonctionnent les modes de cache et l'invalidation, et que le CDN se greffe sur le *service de backend/bucket de backend* d'un ALB externe global.

**Comment RAD le met en œuvre** — Sur le moteur Cloud Run, c'est réel et vérifiable : `enable_cdn` (par défaut `false`) active Cloud CDN directement sur le service de backend Cloud Run et force la création de l'ALB externe global, ce qui illustre « Cloud CDN pour Cloud Run via un NEG sans serveur ». Notez qu'il n'est **pas** utilisable seul : la précondition 26 de `validation.tf` exige `enable_cloud_armor = true` en parallèle, car le CDN se rattache à l'équilibreur de charge que provisionne Cloud Armor. Sur le moteur GKE, soyez prudent : `enable_cdn` (par défaut `false` ; un domaine personnalisé n'est **pas** requis — cette validation a été assouplie) fait passer le module sur le chemin Gateway, mais **aucune ressource n'active réellement le CDN** — le CRD `GCPBackendPolicy` ne prend pas en charge de champ CDN ; le CDN pour la Gateway GKE doit donc être activé hors bande sur le service de backend généré par le contrôleur.

**Essayez**

1. Avec le profil Global Edge déployé, vérifiez le CDN sur le backend Cloud Run et sollicitez le cache :

   ```bash
   gcloud compute backend-services describe <service>-backend --global \
     --format="yaml(enableCDN,cdnPolicy)"
   curl -s -D- -o /dev/null https://<your-domain>/ | grep -iE "age|cache|via"
   ```

   Répétez le curl — un en-tête `Age:` qui augmente indique un succès de cache (cache hit).
2. Invalidez le cache comme l'attend l'examen :

   ```bash
   gcloud compute url-maps invalidate-cdn-cache <service>-lb --path "/*" --async
   ```

3. Sur GKE, mettez en évidence la lacune, puis comblez-la manuellement (exercice hors bande) :

   ```bash
   BS=$(gcloud compute backend-services list --format="value(name)" --filter="name~gkegw1")
   gcloud compute backend-services describe $BS --global --format="value(enableCDN)"   # False/empty
   gcloud compute backend-services update $BS --global --enable-cdn --cache-mode=CACHE_ALL_STATIC
   ```

4. Vous savez que cela a fonctionné lorsque **Console > Network services > Cloud CDN** liste la ou les origines et que le second curl renvoie un en-tête `Age`.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Du contenu doit être servi depuis une origine hébergée sur AWS, derrière l'ALB Google avec CDN. Comment ?</summary>

R : Créez un NEG Internet (`gcloud compute network-endpoint-groups create --network-endpoint-type=INTERNET_FQDN_PORT`) référençant l'origine externe, rattachez-le à un service de backend de l'ALB externe global et activez le CDN sur ce service de backend. Cloud CDN prend en charge les backends externes via des NEG Internet — aucun VPN/Interconnect n'est requis pour ce modèle.
</details>

<details>
<summary>Q2 : Après le déploiement d'un correctif, les utilisateurs voient encore l'ancienne ressource pendant des heures. Invalidation du cache ou TTL plus court ?</summary>

R : La correction immédiate est `gcloud compute url-maps invalidate-cdn-cache --path` (basée sur des modèles de chemin, effective en quelques minutes, mais soumise à une limite de débit et non destinée à un usage courant). La solution durable passe par des URL versionnées ou des en-têtes `Cache-Control` / des TTL de mode de cache corrects. Les réponses d'examen du type « invalider à chaque déploiement » sont fausses.
</details>

**Au-delà des modules** — Étudiez le CDN pour le **stockage d'objets tiers** (un NEG Internet vers un bucket compatible S3, avec authentification d'origine privée), les *buckets* de backend (`gcloud compute backend-buckets create --gcs-bucket-name --enable-cdn` — les buckets GCS de RAD ne sont jamais des origines CDN), les modes de cache (`USE_ORIGIN_HEADERS`, `CACHE_ALL_STATIC`, `FORCE_CACHE_ALL`), les URL/cookies signés et la mise en cache négative. Pour la lacune GKE ci-dessus, le modèle pris en charge à long terme pour Gateway consiste à configurer le CDN via les mécanismes voisins de `GCPBackendPolicy` ou à gérer le paramètre du service de backend hors bande ; pour l'ancien contrôleur Ingress, c'est `BackendConfig.spec.cdn`.

**⚠️ Piège d'examen** — `FORCE_CACHE_ALL` met *tout* en cache, y compris les réponses avec `Set-Cookie` ou des données privées, et casse le contenu dynamique. Ne le choisissez que pour des backends purement statiques ; la valeur sûre par défaut avec des origines bien configurées est `USE_ORIGIN_HEADERS`.

---

## 3.3 Configuration de Cloud DNS (Configuring Cloud DNS) {#33-configuring-cloud-dns}

> ⏱ ~45 min d'étude · 💰 quelques centimes pour une zone de test · ⚙️ Prérequis : rien — concept uniquement

**Pourquoi c'est important pour l'examen** — Les types de zones (publiques/privées), l'horizon partagé, les règles de routage (pondéré, géolocalisation, basculement), DNSSEC, le DNS hybride (zones de transfert, stratégies de serveur, appairage DNS, liaison entre projets) et le modèle external-DNS de GKE font tous partie des sujets d'examen listés.

**Comment RAD le met en œuvre** — Non mis en œuvre : aucune ressource Cloud DNS n'existe dans les quatre modules de fondation. Les modules contournent le DNS de deux façons vérifiables : le moteur Cloud Run dérive un nom d'hôte sans configuration à partir de l'IP statique du LB via le service DNS générique public nip.io (IP `34.56.78.90` → `34-56-78-90.nip.io`) et émet pour lui un certificat géré par Google, et les certificats de domaine Certificate Manager pour `application_domains` restent à l'état `PROVISIONING` jusqu'à ce que *vous* créiez les enregistrements DNS pointant vers l'IP du LB — une dépendance externe que le portail de déploiement s'attend à ce que vous satisfassiez.

**Essayez**

1. Créez une zone publique dans un projet de test et faites-la pointer vers votre LB déployé :

   ```bash
   gcloud dns managed-zones create pcne-lab --dns-name="lab.example.com." \
     --description="PCNE practice" 
   gcloud dns record-sets create app.lab.example.com. --zone=pcne-lab \
     --type=A --ttl=300 --rrdatas=<rad-lb-static-ip>
   ```

2. Construisez le modèle de zone privée pertinent pour l'hybride sur le VPC RAD :

   ```bash
   gcloud dns managed-zones create internal-zone --dns-name="internal.lab." \
     --visibility=private --networks=vpc-network-<prefix> --description="split horizon demo"
   ```

3. Essayez une règle de routage de basculement (un grand classique de l'examen) :

   ```bash
   gcloud dns record-sets create svc.lab.example.com. --zone=pcne-lab --type=A --ttl=60 \
     --routing-policy-type=FAILOVER \
     --routing-policy-primary-data=<primary-ip> \
     --routing-policy-backup-data-type=GEO \
     --routing-policy-backup-data="us-central1=<backup-ip>"
   ```

4. Vous savez que cela a fonctionné lorsque `dig app.lab.example.com @8.8.8.8` résout une fois la délégation NS du bureau d'enregistrement en place, et que l'enregistrement privé ne se résout que depuis une VM située dans le VPC RAD.

**Vérifiez vos acquis**
<details>
<summary>Q1 : Des résolveurs sur site doivent résoudre des enregistrements d'une zone privée Cloud DNS. Que configurez-vous ?</summary>

R : Une stratégie de serveur DNS entrante sur le VPC (`gcloud dns policies create --enable-inbound-forwarding --networks=...`), qui alloue des IP de redirecteur entrant dans chaque région de sous-réseau ; faites pointer les redirecteurs conditionnels sur site vers ces IP via VPN/Interconnect. Le sens inverse (noms du cloud vers le site) utilise une *zone de transfert* ciblant les serveurs DNS sur site.
</details>

<details>
<summary>Q2 : Deux VPC qui ne sont PAS appairés doivent tous deux résoudre une zone privée appartenant à un projet hub. Quelles options ?</summary>

R : Soit lier la zone privée à des réseaux supplémentaires (liaison entre projets — la zone réside dans un projet mais liste des VPC d'autres projets), soit créer des zones d'*appairage* DNS dans les VPC consommateurs, ciblant le VPC producteur. L'appairage DNS fonctionne sans appairage VPC — la connectivité DNS et celle du plan de données sont indépendantes, une distinction récurrente à l'examen.
</details>

**Au-delà des modules** — Étudiez « Cloud DNS overview », « DNS server policies », « DNS routing policies and health checks » (géolocalisation + basculement avec des cibles LB internes soumises à des vérifications d'état), l'activation de DNSSEC (`gcloud dns managed-zones update --dnssec-state=on` plus l'enregistrement DS chez le bureau d'enregistrement), la **migration vers Cloud DNS** (exporter/importer la zone existante avec `gcloud dns record-sets import`, réduire les TTL, puis basculer les enregistrements NS chez le bureau d'enregistrement — avec DNSSEC désactivé ou de nouvelles clés pendant la migration), et l'opérateur **external-DNS** pour GKE (les Services/Ingresses annotés créent automatiquement des enregistrements Cloud DNS — l'automatisation naturelle pour les `application_domains` de RAD, pointés manuellement).

**⚠️ Piège d'examen** — Une zone privée n'est visible que par les réseaux VPC pour lesquels elle est *autorisée* — pas par les VPC appairés, pas depuis le site, pas par d'autres projets — sauf si vous ajoutez des liaisons, un appairage DNS ou un transfert. « Elle est privée, donc le VPC appairé peut la voir » est toujours faux.
