---
title: "Préparation PSE, section 2 : sécurisation des communications et des frontières"
description: "Préparez la section 2 de l'examen PSE — sécurisation des communications et mise en place de la protection des frontières — avec des labs de déploiement RAD pratiques sur Google Cloud."
---
<!-- translated-from: docs/certification/PSE_Section_2_Exploration_Guide.md @ cb682e8 -->

# Guide de préparation à la certification PSE : Section 2 — Sécurisation des communications et mise en place de la protection des frontières (Securing communications and establishing boundary protection) (~22 % de l'examen) {#pse-certification-preparation-guide-section-2--securing-communications-and-establishing-boundary-protection-22-of-the-exam}

<img src="https://storage.googleapis.com/rad-public-2b65/certification/pse_section2.png" alt="Guide de préparation à la certification PSE : Section 2 — Sécurisation des communications et mise en place de la protection des frontières (~22 % de l'examen)" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide couvre la section 2 de l'examen Professional Cloud Security Engineer. Les modules fondamentaux concernés : `Services_GCP` construit le VPC, les règles de pare-feu, Cloud NAT et Private Services Access ; `App_CloudRun` et `App_GKE` mettent chacun en œuvre une périphérie protégée par le WAF Cloud Armor et un périmètre VPC Service Controls ; `App_GKE` ajoute la micro-segmentation par NetworkPolicy Kubernetes sur Dataplane V2. Avant de commencer, déployez **guarded-edge** (ou **zero-trust-gke**) et **perimeter-lab**, décrits dans la carte des labs.

---

## 2.1 Conception et configuration de la sécurité du périmètre (Designing and configuring perimeter security) {#21-designing-and-configuring-perimeter-security}

> ⏱ ~2 h · 💰 modéré — frais de l'équilibreur de charge global + de la stratégie Cloud Armor · ⚙️ Prérequis : `enable_cloud_armor = true` (`application_domains` facultatif sur Cloud Run)

**Pourquoi l'examen s'y intéresse** — Vous devez choisir le bon contrôle de périphérie pour chaque menace : les règles WAF préconfigurées de Cloud Armor contre les attaques OWASP, les bannissements basés sur le débit contre la force brute et le scraping, Adaptive Protection contre les attaques DDoS de couche 7, et IAP pour l'identité — et savoir que Cloud Armor ne protège que le trafic qui transite réellement par l'équilibreur de charge auquel il est associé.

**Comment RAD le met en œuvre** — `enable_cloud_armor` (`false` par défaut) crée une stratégie de sécurité Cloud Armor dont le contenu des règles est identique dans les deux modules :

| Priorité | Règle | Action |
|---|---|---|
| 100 | liste d'autorisation `admin_ip_ranges` | `allow` (contourne les règles WAF) |
| 1000–1003 | `evaluatePreconfiguredExpr('sqli-v33-stable')`, `xss-v33-stable`, `lfi-v33-stable`, `rce-v33-stable` | `deny(403)` |
| 2000 | limite de débit de 500 requêtes/min par IP | `rate_based_ban` → `deny(429)`, bannissement de 300 s |
| 2147483647 | par défaut | `allow` |

Adaptive Protection (défense contre les attaques DDoS de couche 7) est activé dans les deux. La mécanique diffère :

- **App_CloudRun** construit toute la périphérie : NEG sans serveur → service de backend (un équilibreur de charge d'application externe, avec journalisation des requêtes au taux d'échantillonnage maximal) → mappage d'URL → proxy HTTPS → adresse IP statique globale, avec des certificats gérés par Google via Certificate Manager pour chaque entrée de `application_domains` et une redirection permanente HTTP→HTTPS. L'entrée (ingress) de Cloud Run est forcée sur internal-and-cloud-load-balancing dès que `enable_cloud_armor` ou `enable_cdn` vaut true, de sorte que l'URL directe `*.run.app` ne peut pas contourner le WAF. Une validation au moment du plan exige au moins une entrée dans `application_domains` lorsque `enable_cloud_armor = true` ; un certificat de secours géré par Google et dérivé de nip.io n'existe que pour le chemin équilibreur de charge sans Cloud Armor (par ex. CDN seul).
- **App_GKE** crée la stratégie sous le nom `{service}-waf-policy` et l'associe au backend de la Gateway API via une `GCPBackendPolicy` ; une validation au moment du plan exige `enable_custom_domain = true` ou `service_type = "LoadBalancer"`. La règle d'autorisation `admin_ip_ranges` de priorité 100 est présente dans les deux stratégies ; sur App_CloudRun, la même variable alimente *aussi* le niveau d'accès VPC-SC, de sorte que les réseaux de confiance contournent le WAF et franchissent le périmètre avec un seul paramètre.

**Essayez**
1. Déployez guarded-edge. Dans **Console > Network Security > Cloud Armor policies**, ouvrez `{service}-waf-policy` et passez en revue les priorités des règles ainsi que l'onglet Adaptive Protection.
2. Envoyez une injection SQL simulée sur l'équilibreur de charge et observez son rejet :
```bash
LB_IP=$(gcloud compute addresses list --global \
  --filter="name~lb-ip" --format="value(address)")
curl -sk "https://app.example.com/?q=1%27%20OR%20%271%27=%271" -o /dev/null -w "%{http_code}\n"
# Expect 403 from rule sqli-v33-stable
gcloud compute security-policies describe <service>-waf-policy \
  --format="yaml(rules[].priority, rules[].action, rules[].description)"
```
3. Vérifiez que le contournement est fermé : `curl -s -o /dev/null -w "%{http_code}\n" https://<service>-<hash>.run.app/` renvoie 404/403, car l'entrée est limitée à l'équilibreur de charge.
4. Vous savez que cela a fonctionné lorsque les refus du WAF apparaissent dans **Logging > Logs Explorer**, dans le journal `requests` du service de backend, avec `jsonPayload.enforcedSecurityPolicy.outcome="DENY"`.

**Testez-vous**
<details>
<summary>Q1 : Scénario — après l'activation de Cloud Armor sur Cloud Run, un testeur d'intrusion atteint toujours l'application via son URL run.app. Qu'est-ce qui a été oublié ?</summary>

R : L'entrée est restée sur `all`. Cloud Armor n'inspecte que le trafic qui traverse l'équilibreur de charge ; le service doit être limité à `internal-and-cloud-load-balancing` pour que les URL directes soient refusées. Le module RAD le fait automatiquement — l'examen attend que vous sachiez que c'est nécessaire.
</details>

<details>
<summary>Q2 : Un botnet de bourrage d'identifiants (credential stuffing) envoie 2 000 requêtes/min/IP. Laquelle des règles déployées réagit, et comment ?</summary>

R : La règle `rate_based_ban` de priorité 2000 : chaque IP source qui dépasse 500 requêtes/60 s reçoit `deny(429)` et un bannissement de 300 secondes. Adaptive Protection complète ce dispositif en détectant les anomalies distribuées de couche 7 qui échappent aux limites par IP, et en suggérant des règles ciblées.
</details>

<details>
<summary>Q3 : Quand IAP est-il le bon contrôle de périphérie à la place de Cloud Armor (ou en complément) ?</summary>

R : Cloud Armor filtre selon la signature ou la source de la requête (sans notion d'identité) ; IAP exige une identité Google authentifiée et autorisée. Pour un outil interne, IAP seul suffit. Pour une application publique, Cloud Armor (WAF/DDoS/limitation de débit). Pour une application interne sensible exposée via un équilibreur de charge, combinez les deux : Armor élimine les attaques en périphérie, IAP impose l'identité.
</details>

**Au-delà des modules** — Non mis en œuvre : les stratégies de pare-feu réseau/hiérarchiques de Cloud NGFW (la plateforme utilise des règles de pare-feu VPC classiques avec des tags réseau), les règles FQDN/géolocalisation/threat intelligence, l'inspection de la couche application (couche 7) avec la prévention des intrusions de Cloud NGFW Enterprise, la gestion des bots par Cloud Armor avec reCAPTCHA, les stratégies de sécurité en périphérie (edge security policies), Certificate Authority Service pour le mTLS, Secure Web Proxy pour le filtrage du trafic sortant, et les paramètres de sécurité Cloud DNS (DNSSEC, stratégies de réponse DNS, journalisation des requêtes DNS). Connaissez aussi la distinction entre IP privée et IP publique sur laquelle s'appuie la plateforme (Cloud SQL n'a pas d'IPv4 publique et le serveur NFS n'a pas d'IP externe, tandis que l'équilibreur de charge expose l'application sur une adresse externe globale réservée), et la manière de surveiller et de restreindre en continu les API activées — `constraints/gcp.restrictServiceUsage` (les dossiers de palier de RAD l'appliquent, c'est pourquoi une API absente de la liste d'autorisation d'un dossier fait échouer une application dans un projet géré par RAD), les restrictions de clés API, et Cloud Asset Inventory pour auditer ce qui est activé. Pour démarrer dans un projet de test : `gcloud compute network-firewall-policies create demo-policy --global` et `gcloud compute security-policies update <policy> --enable-layer7-ddos-defense`.

**⚠️ Piège d'examen** — Les règles WAF préconfigurées existent en plusieurs niveaux de sensibilité et peuvent produire des faux positifs sur des contenus légitimes (par ex. un CMS qui enregistre du HTML). La réponse attendue à l'examen consiste à exécuter les nouvelles règles en mode `preview` et à les ajuster avec `evaluatePreconfiguredWaf(...,{'sensitivity': N})` ou en excluant des ID de règles — et non à désactiver le WAF.

---

## 2.2 Configuration de la segmentation des frontières (Configuring boundary segmentation) {#22-configuring-boundary-segmentation}

> ⏱ ~2.5 h · 💰 aucun pour VPC-SC/NetworkPolicy · ⚙️ Prérequis : perimeter-lab (organisation + autorisation ACM) ; zero-trust-gke pour NetworkPolicy

**Pourquoi l'examen s'y intéresse** — IAM répond à la question *qui*, la segmentation réseau répond à *d'où*, et VPC Service Controls répond à *où les données peuvent circuler au niveau des API*. Les scénarios d'examen où des identifiants volés mais valides servent à exfiltrer des données Cloud Storage ou BigQuery sont des questions VPC-SC ; les scénarios de mouvement latéral entre pods sont des questions NetworkPolicy.

**Comment RAD le met en œuvre** —

*VPC Service Controls* (créé dans App_CloudRun/App_GKE lorsque `enable_vpc_sc = true`, `false` par défaut ; `Services_GCP` dispose d'un équivalent autonome). Ces paramètres ne sont proposés que lorsque vous déployez dans un projet qui vous appartient — un projet géré par RAD les retire du formulaire, car une organisation possède une seule stratégie Access Context Manager et un périmètre de tenant modifierait celle de RAD :
- **Contrat relatif à l'ID d'organisation :** l'ID d'organisation est découvert automatiquement à partir du projet. Dans App_CloudRun/App_GKE, un `organization_id` explicite (`""` par défaut) remplace la découverte et n'est *requis que lorsque le projet est imbriqué dans un dossier* ; les projets autonomes ignorent VPC-SC avec un avertissement. `Services_GCP` s'appuie uniquement sur la découverte automatique (il n'a pas de variable `organization_id`).
- La création est en outre conditionnée par : un `admin_ip_ranges` non vide (prévention du verrouillage) et une sonde d'autorisation au moment du plan, qui exécute `gcloud access-context-manager policies list --organization=...` et ignore proprement toutes les ressources VPC-SC avec un avertissement si l'appelant ne dispose pas de l'autorisation ACM au niveau de l'organisation.
- Ce qui est construit : une stratégie Access Context Manager (réutilisée si l'organisation en possède déjà une), quatre niveaux d'accès — les plages CIDR des sous-réseaux VPC (découvertes automatiquement à partir du réseau lorsque `vpc_cidr_ranges` est vide, avec repli sur `10.0.0.0/8`), `admin_ip_ranges`, l'agent de service IAP et les comptes de service CI/CD — et un périmètre de service standard qui restreint 15 services (Cloud Run, GKE, Cloud SQL Admin, Secret Manager, Storage, Artifact Registry, Cloud Build, KMS, Pub/Sub, Redis, Filestore, Firestore, Compute, Certificate Manager, IAP) avec restriction des services accessibles depuis le VPC, des règles d'entrée issues des quatre niveaux d'accès et des règles de sortie délimitées.
- `vpc_sc_dry_run` (`true` par défaut) écrit la configuration dans la spécification de simulation (dry-run) du périmètre : les violations sont journalisées, pas bloquées.

*NetworkPolicy Kubernetes* (`enable_network_segmentation`, `false` par défaut, nécessite Dataplane V2 — que les clusters `Services_GCP` utilisent toujours via le chemin de données avancé) : une stratégie de refus par défaut (par omission) qui sélectionne tous les pods de l'espace de noms, en entrée comme en sortie. Entrées autorisées : les pods du même espace de noms, les plages des équilibreurs de charge et des vérifications d'état Google `130.211.0.0/22` et `35.191.0.0/16`, `35.235.240.0/20`, et — dès que `service_type` vaut `LoadBalancer` (la valeur par défaut du module) ou `NodePort` — `0.0.0.0/0` sur le seul port du conteneur, car un équilibreur de charge réseau L4 conserve l'IP d'origine du client, si bien que le trafic réel ne correspond à aucune des plages Google. Restreindre les appelants relève alors de Cloud Armor (`enable_cloud_armor` + `admin_ip_ranges`) ou d'un `service_type` interne, et non de la NetworkPolicy. Sorties autorisées : DNS (53 TCP/UDP), HTTPS 443 (y compris les VIP googleapis restreintes/privées `199.36.153.4/30` et `199.36.153.8/30`), les pods du même espace de noms, le loopback du proxy Cloud SQL plus le port 3307 vers `10.0.0.0/8`, le serveur de métadonnées `169.254.169.254/32:80` (point de terminaison des jetons Workload Identity), et NFS 2049 lorsqu'il est activé.

*Isolation au niveau du réseau :* Cloud SQL n'utilise qu'une IP privée (pas d'IPv4 publique, mode SSL chiffré uniquement), et les règles de pare-feu utilisent des tags réseau (`httpserver`, `nfsserver`, etc.) plutôt que de larges autorisations par CIDR.

**Essayez**
1. Déployez perimeter-lab. Dans **Console > Security > VPC Service Controls**, passez à l'onglet de simulation (dry-run) et ouvrez le périmètre ; passez en revue les services restreints et les niveaux d'accès.
```bash
POLICY=$(gcloud access-context-manager policies list \
  --organization=ORG_ID --format="value(name)")
gcloud access-context-manager perimeters dry-run list --policy=$POLICY
gcloud access-context-manager levels list --policy=$POLICY
```
2. Depuis une machine *extérieure* à `admin_ip_ranges`, exécutez `gcloud secrets versions access latest --secret=secret-<instance>-<service>`, puis recherchez dans **Logs Explorer** les violations `protoPayload.metadata.dryRun="true"` concernant `secretmanager.googleapis.com`.
3. Pour NetworkPolicy, déployez zero-trust-gke et sondez la segmentation :
```bash
kubectl get networkpolicy -n <namespace>
kubectl describe networkpolicy <prefix>-namespace-isolation -n <namespace>
# Negative test from a scratch namespace — should time out:
kubectl run probe --image=busybox -n default --rm -it --restart=Never \
  -- wget -T 5 -qO- http://<service>.<namespace>.svc.cluster.local
```
4. Vous savez que cela a fonctionné lorsque le trafic entre pods d'espaces de noms différents expire alors que l'application continue de répondre aux vérifications d'état de l'équilibreur de charge et d'atteindre Cloud SQL.

**Testez-vous**
<details>
<summary>Q1 : Scénario — un attaquant vole une clé de compte de service disposant de `roles/storage.admin` et exécute `gsutil cp` depuis son réseau domestique. IAM l'autorise. Quel contrôle déployé bloque la copie, et pourquoi ?</summary>

R : Le périmètre VPC-SC (une fois `vpc_sc_dry_run = false`). `storage.googleapis.com` est un service restreint, et la requête provient de l'extérieur de tous les niveaux d'accès (ni les plages CIDR du VPC, ni `admin_ip_ranges`, ni les identités IAP/CI-CD) ; l'appel d'API lui-même est donc rejeté, quelle que soit la validité des identifiants. VPC-SC contrôle *d'où*, IAM contrôle *qui*.
</details>

<details>
<summary>Q2 : Pourquoi le module refuse-t-il de créer le périmètre lorsque `admin_ip_ranges` est vide ?</summary>

R : Pour prévenir le verrouillage. Avec l'application activée et sans niveau d'accès administrateur, les opérateurs et la CI/CD situés hors du VPC ne pourraient appeler aucune API restreinte — y compris les appels nécessaires pour corriger ou supprimer le périmètre. Le module émet plutôt un avertissement et ignore la création.
</details>

<details>
<summary>Q3 : Vos pods GKE doivent atteindre Secret Manager sous la NetworkPolicy. Quelles sont les deux règles de sortie qui le permettent ?</summary>

R : La sortie 443 (qui couvre les points de terminaison googleapis, y compris les plages de VIP restreintes `199.36.153.4/30`/`199.36.153.8/30` lorsque Cloud DNS y fait pointer `*.googleapis.com`) et la sortie vers le serveur de métadonnées `169.254.169.254:80`, que Workload Identity utilise pour échanger le jeton du KSA contre un jeton d'accès du GSA avant que l'appel HTTPS puisse s'authentifier.
</details>

**Au-delà des modules** — Non mis en œuvre : les projets hôtes/de service de VPC partagé (Shared VPC), l'appairage VPC entre VPC clients, les stratégies de pare-feu hiérarchiques, l'inspection L7 de Cloud NGFW, et une granularité des stratégies par pod (plutôt que par espace de noms). Pour l'isolation à N niveaux, étudiez l'utilisation de sous-réseaux ou de VPC distincts par niveau, avec des règles de pare-feu basées sur les comptes de service ou des tags sécurisés, afin que chaque niveau n'accepte que le trafic du niveau situé devant lui. Étudiez le modèle IAM du VPC partagé (`roles/compute.networkUser` sur les sous-réseaux partagés) et essayez `gcloud compute shared-vpc enable HOST_PROJECT` dans une organisation de test. Étudiez également la sémantique des règles d'entrée/sortie VPC-SC pour le partage entre périmètres, ainsi que les ponts de périmètre.

**⚠️ Piège d'examen** — Le mode simulation (dry-run) est le bon choix par défaut pour un déploiement progressif, mais il n'applique *rien*. Un constat d'audit « VPC-SC configuré » ne signifie pas « VPC-SC appliqué » — vérifiez `vpc_sc_dry_run` (le module le définit à `true` par défaut) ainsi que la spécification appliquée par rapport à la spécification de simulation du périmètre, avant d'affirmer une protection contre l'exfiltration.

---

## 2.3 Mise en place d'une connectivité privée (Establishing private connectivity) {#23-establishing-private-connectivity}

> ⏱ ~1.5 h · 💰 faible — traitement des données par Cloud NAT ; PSA/sortie VPC directe gratuits · ⚙️ Prérequis : secure-platform + n'importe quel module d'application (les valeurs par défaut suffisent)

**Pourquoi l'examen s'y intéresse** — L'examen teste le choix entre Private Google Access, Private Services Access (PSA), Private Service Connect, la sortie VPC directe (Direct VPC egress) / l'accès VPC sans serveur, et les options hybrides (HA VPN, Interconnect) — et la connaissance de celle qui offre une accessibilité privée aux *API Google*, aux *services gérés* ou à *votre propre VPC*.

**Comment RAD le met en œuvre** —
- **Private Services Access** : une plage interne `/16` réservée, utilisée pour l'appairage VPC, plus une connexion Service Networking avec importation/exportation de routes personnalisées — c'est ainsi que Cloud SQL, AlloyDB et Memorystore obtiennent des IP privées dans le réseau producteur appairé à votre VPC.
- **Sortie VPC directe sur Cloud Run** : le service associe une interface réseau dans le sous-réseau ; `vpc_egress_setting` (`PRIVATE_RANGES_ONLY` par défaut, ou `ALL_TRAFFIC`) détermine si seul le trafic destiné aux plages RFC-1918 ou l'ensemble du trafic est acheminé via le VPC. Aucun connecteur d'accès VPC sans serveur (Serverless VPC Access) n'est utilisé.
- **Cloud NAT** : un Cloud Router + une passerelle NAT par région (couvrant tous les sous-réseaux et toutes les plages d'IP) donnent aux instances et aux charges de travail sortantes un accès Internet sortant sans IP externe.
- **VIP restreintes/privées des API Google** : la NetworkPolicy GKE autorise explicitement `199.36.153.4/30` (restricted.googleapis.com, le point de terminaison compatible avec VPC-SC) et `199.36.153.8/30` (private.googleapis.com).
- Le sidecar Cloud SQL Auth Proxy sur GKE se connecte à l'IP *privée* de l'instance (`--private-ip`, port 3307), ce qui maintient tout le trafic de base de données sur le VPC.
- **Private Google Access** : `Services_GCP` crée ses sous-réseaux avec Private Google Access activé, de sorte que les instances sans IP externe (comme le serveur NFS) atteignent les API Google par le chemin privé.

**Essayez**
1. Dans **Console > VPC network > VPC network peering**, observez l'appairage `servicenetworking` créé par PSA ; dans **SQL > instance > Connections**, vérifiez qu'il n'y a pas d'IP publique.
```bash
gcloud services vpc-peerings list --network=vpc-network-<prefix>
gcloud sql instances describe <instance> \
  --format="value(settings.ipConfiguration.ipv4Enabled, ipAddresses[].ipAddress)"
gcloud compute routers nats list --router=<router> --region=us-central1
```
2. Passez `vpc_egress_setting` à `ALL_TRAFFIC` dans le portail et redéployez ; dans **Cloud Run > service > Networking**, le paramètre de sortie change — les appels sortants vers des API publiques passent désormais par Cloud NAT avec l'IP NAT (vérifiez avec `curl https://ifconfig.me` depuis le conteneur).
3. Vous savez que cela a fonctionné lorsque l'instance Cloud SQL n'affiche qu'une adresse 10.x et que l'IP de sortie publique du conteneur est égale à l'adresse NAT.

**Testez-vous**
<details>
<summary>Q1 : Scénario — une passerelle de paiement n'autorise qu'une seule IP statique. Votre service Cloud Run doit l'appeler. Comment garantir une IP source stable avec l'architecture déployée ?</summary>

R : Définissez `vpc_egress_setting = "ALL_TRAFFIC"` pour que tout le trafic sortant passe par le VPC, puis assurez-vous que Cloud NAT utilise une adresse externe statique réservée. La passerelle ne voit alors que l'IP NAT. Avec `PRIVATE_RANGES_ONLY`, les appels vers des points de terminaison publics sortiraient directement du pool sans serveur de Google, avec des IP imprévisibles.
</details>

<details>
<summary>Q2 : Quelle est la différence entre Private Services Access (utilisé ici pour Cloud SQL) et Private Service Connect ?</summary>

R : PSA crée un appairage VPC vers un réseau producteur géré par Google et alloue une plage d'IP dans votre espace d'adressage — la connectivité est de réseau à réseau et non transitive. PSC expose un service (API Google ou service d'un producteur) sous la forme d'une *IP de point de terminaison dans votre propre sous-réseau*, sans appairage et avec un contrôle plus fin. L'examen privilégie PSC pour les nouvelles conceptions nécessitant des points de terminaison par service ou une tolérance aux chevauchements d'IP ; PSA reste le mécanisme qu'utilisent classiquement les IP privées de Cloud SQL/Memorystore.
</details>

**Au-delà des modules** — Non mis en œuvre : Cloud VPN / HA VPN, Cloud Interconnect (Dedicated/Partner, MACsec), le routage BGP personnalisé au-delà de NAT, Network Connectivity Center, Private Google Access pour les hôtes sur site, les points de terminaison Private Service Connect pour les API Google, les sous-réseaux proxy uniquement, les équilibreurs de charge internes, et les zones privées Cloud DNS pour le mappage `*.googleapis.com` → VIP restreinte (la NetworkPolicy autorise ces plages CIDR, mais la zone DNS elle-même n'est pas créée). Vérifiez l'indicateur Private Google Access déployé avec `gcloud compute networks subnets describe SUBNET --region=R --format="value(privateIpGoogleAccess)"`, et utilisez `gcloud compute vpn-gateways create ...` dans un projet de test pour étudier la topologie HA VPN.

**⚠️ Piège d'examen** — `restricted.googleapis.com` ne sert que les API prises en charge par VPC-SC et constitue le point de terminaison à utiliser *à l'intérieur* d'un périmètre ; `private.googleapis.com` sert presque toutes les API mais n'offre aucune protection contre l'exfiltration. Faire pointer des charges de travail d'un périmètre vers la VIP privée au lieu de la VIP restreinte est une erreur de durcissement classique que l'examen cherche à repérer.
