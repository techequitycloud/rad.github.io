---
title: "Bank of Anthos multi-cluster sur GKE"
description: "Référence de configuration pour déployer Bank of Anthos multi-cluster sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/MC_Bank_GKE.md @ 3055034 sha256:6042a43f4e63 -->

# Bank of Anthos multi-cluster sur GKE {#multi-cluster-bank-of-anthos-on-gke}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MC_Bank_GKE.png" alt="Bank of Anthos multi-cluster sur GKE" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce module déploie **Bank of Anthos** — la démo bancaire open source à base de microservices de Google — sur **plusieurs clusters GKE répartis dans plusieurs régions**, reliés entre eux pour former une seule plateforme applicative. Il s'agit d'un module autonome et indépendant : il construit son propre VPC, crée chaque cluster GKE, les enregistre tous dans une **GKE Fleet**, les réunit dans un seul **Cloud Service Mesh multi-primaire** et place devant eux une **passerelle multi-cluster / un équilibreur de charge externe global**, de sorte qu'une seule adresse publique serve la région saine la plus proche.

Il est conçu comme une référence pédagogique de l'architecture active-active et géo-redondante qu'utilisent les plateformes financières réglementées et les plateformes de paiement mondiales pour satisfaire aux exigences de haute disponibilité et de résidence des données. Ce n'est pas un système bancaire de production.

Ce guide se concentre sur les services Google Cloud que le module met en œuvre et sur la manière de les explorer et de les exploiter depuis la console Cloud et la ligne de commande — en accordant une attention particulière au travail **sur plusieurs clusters à la fois**.

---

## 1. Vue d'ensemble {#1-overview}

Le module met en place une plateforme multi-cluster complète à partir de rien, puis y déploie l'application bancaire :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot (Standard en option) | Un cluster par région ; `cluster_size` clusters, 2 par défaut |
| Gestion multi-cluster | GKE Fleet (Hub) | Chaque cluster est enregistré comme membre de la Fleet |
| Maillage de services | Cloud Service Mesh (Istio géré) | Multi-primaire, activé à l'échelle de la Fleet en mode de gestion automatique |
| Découverte inter-clusters | Multi-Cluster Services (MCS) | Fonctionnalité de la Fleet pour des backends de services répartis entre clusters |
| Ingress global | Multi-Cluster Ingress + équilibreur de charge d'application externe global | Une seule IP anycast achemine vers le cluster sain le plus proche |
| TLS | Certificat géré par Google | Provisionné automatiquement pour un domaine `sslip.io` dérivé de l'IP globale |
| Réseau | VPC partagé, sous-réseaux par cluster, Cloud Router + Cloud NAT, règles de pare-feu | VPC à routage global ; un Cloud Router + Cloud NAT par région de cluster. Les clusters ne sont **pas** privés — le module ne déclare aucun `private_cluster_config`, si bien que les nœuds et le point de terminaison du plan de contrôle utilisent la configuration publique par défaut de GKE |
| Observabilité | Cloud Logging, Cloud Monitoring, Managed Service for Prometheus, Cloud Trace | Agrégée sur l'ensemble de la Fleet |
| Application | Bank of Anthos (v0.6.10) | 9 microservices (Python + Java) plus deux bases de données PostgreSQL dans le cluster |

**À savoir d'emblée :**

- **Il s'agit réellement d'un déploiement multi-cluster.** `cluster_size` clusters (par défaut `2`) sont créés et chacun est placé dans une région de `available_regions` selon un ordre circulaire (round-robin). Avec les valeurs par défaut, vous obtenez deux clusters : `gke-cluster-1` dans `us-west1` et `gke-cluster-2` dans `us-east1`. Ajouter des régions ou augmenter `cluster_size` étend la répartition (par ex. 2 régions + 4 clusters parcourent cycliquement `us-west1`, `us-east1`, `us-west1`, `us-east1`).
- **Les noms de clusters sont numérotés à partir de 1** — `gke-cluster-1`, `gke-cluster-2`, …, `gke-cluster-N`. `cluster1` est toujours le **cluster principal / de configuration**, situé dans `available_regions[0]`.
- **Les bases de données résident uniquement sur le cluster principal.** Les StatefulSets PostgreSQL `accounts-db` et `ledger-db` ne sont déployés que sur `gke-cluster-1`. Les clusters non principaux exécutent les services sans état ainsi que les *Services* et *ConfigMaps* des bases de données, mais pas les pods de bases de données — ils sont conçus pour atteindre les bases du cluster principal à travers la Fleet. Perdre le cluster principal met la couche de données hors ligne.
- **Une IP globale, un domaine.** Une seule adresse globale est réservée et l'application est publiée à l'adresse `https://boa.<GLOBAL_IP>.sslip.io`, avec un certificat TLS émis automatiquement. `sslip.io` résout tout nom `<ip>.sslip.io` vers cette IP ; aucune zone DNS n'est donc nécessaire.
- **Le maillage est multi-primaire.** Cloud Service Mesh est activé au niveau de la Fleet avec gestion automatique ; chaque cluster exécute un plan de contrôle géré et partage un même domaine de confiance (`<project>.svc.id.goog`), si bien que les sidecars de n'importe quel cluster s'authentifient mutuellement.
- **L'application n'utilise ni Cloud SQL, ni Memorystore, ni Secret Manager.** Bank of Anthos exécute son propre PostgreSQL dans le cluster et une paire de clés JWT stockée dans un Secret Kubernetes. (Certaines API de projet associées sont activées, mais l'application ne dépend pas de ces services gérés.)
- **Le premier déploiement est long.** Créer plusieurs clusters, enregistrer la Fleet, provisionner le maillage géré et mettre en service l'équilibreur de charge global avec un certificat géré prend généralement **40 à 60 minutes**.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Comme il s'agit d'un déploiement multi-cluster, l'essentiel de l'exploration consiste à **passer d'un contexte de cluster à l'autre**. Configurez un contexte par cluster et réutilisez-les tout au long :

```bash
export PROJECT="<your-project-id>"
export REGION1="us-west1"   # available_regions[0] — primary/config cluster
export REGION2="us-east1"   # available_regions[1]

gcloud container clusters get-credentials gke-cluster-1 --region "$REGION1" --project "$PROJECT"
gcloud container clusters get-credentials gke-cluster-2 --region "$REGION2" --project "$PROJECT"

# Friendlier context aliases
kubectl config rename-context "gke_${PROJECT}_${REGION1}_gke-cluster-1" cluster1
kubectl config rename-context "gke_${PROJECT}_${REGION2}_gke-cluster-2" cluster2
kubectl config get-contexts
```

L'espace de noms de l'application est `bank-of-anthos` sur chaque cluster.

### A. Clusters GKE — la trame de calcul {#a-gke-clusters--the-compute-fabric}

Chaque cluster exécute les charges de travail bancaires sur Autopilot (Standard est facultatif). Les clusters sont VPC-native, inscrits dans la release channel choisie, et GKE Security Posture, Managed Prometheus, le pilote CSI GCS FUSE, la Gateway API et la gestion des coûts y sont activés.

- **Console :** Kubernetes Engine → Clusters liste chaque cluster avec son mode, sa région, sa version et son nombre de nœuds.
- **CLI :**
  ```bash
  gcloud container clusters list --project "$PROJECT" \
    --format="table(name,location,autopilot.enabled,currentMasterVersion,status)"
  kubectl --context cluster1 get nodes -o wide
  kubectl --context cluster2 get nodes -o wide
  ```

### B. GKE Fleet (Hub) {#b-gke-fleet-hub}

Chaque cluster est enregistré comme membre de la Fleet (ID de membre = nom du cluster) au sein d'une Fleet unique au niveau du projet. C'est la Fleet qui permet au maillage, à MCS et à Multi-Cluster Ingress de s'étendre sur plusieurs clusters.

- **Console :** Kubernetes Engine → Fleets affiche tous les membres et les fonctionnalités de la Fleet activées pour chaque cluster.
- **CLI :**
  ```bash
  gcloud container fleet memberships list --project "$PROJECT"
  gcloud container fleet features list --project "$PROJECT"
  ```

### C. Multi-Cluster Services (MCS) {#c-multi-cluster-services-mcs}

MCS est activé en tant que fonctionnalité de la Fleet afin que les services puissent avoir des backends répartis entre clusters. Le frontend est publié à l'échelle de la Fleet via un `MultiClusterService` (`bank-of-anthos-mcs`) sur le cluster de configuration.

- **Console :** Kubernetes Engine → Services & Ingress (sur le cluster de configuration) affiche le Service multi-cluster.
- **CLI :**
  ```bash
  kubectl --context cluster1 get multiclusterservice -n bank-of-anthos
  kubectl --context cluster1 describe multiclusterservice bank-of-anthos-mcs -n bank-of-anthos
  # The MCS importer runs in the gke-mcs namespace on member clusters:
  kubectl --context cluster2 get pods -n gke-mcs
  ```

### D. Cloud Service Mesh (multi-primaire) {#d-cloud-service-mesh-multi-primary}

Le maillage est activé à l'échelle de la Fleet avec gestion automatique — Google exécute le plan de contrôle Istio de chaque cluster. L'espace de noms `bank-of-anthos` porte le label de révision CSM correspondant à la release channel du cluster — `istio.io/rev=asm-managed` pour `REGULAR`, `-rapid`/`-stable` pour les deux autres — si bien que chaque pod reçoit un sidecar Envoy (chaque pod applicatif affiche `2/2` prêts). Un label désignant une révision que la channel ne sert pas ne provoque aucune erreur ; l'injection est silencieusement ignorée et les pods démarrent sans sidecar. Tous les clusters partagent un même domaine de confiance : le maillage est donc multi-primaire et le trafic entre clusters est mutuellement authentifié.

- **Console :** Kubernetes Engine → Service Mesh affiche la topologie combinée, les signaux clés (golden signals) et l'état mTLS de tous les clusters.
- **CLI :**
  ```bash
  gcloud container fleet mesh describe --project "$PROJECT"   # per-membership control/data plane state
  # Confirm sidecar injection on each cluster:
  kubectl --context cluster1 get pods -n bank-of-anthos
  kubectl --context cluster2 get pods -n bank-of-anthos
  # Inspect the SPIFFE identity in a sidecar's certificate:
  POD=$(kubectl --context cluster1 get pod -n bank-of-anthos -l app=frontend -o jsonpath='{.items[0].metadata.name}')
  kubectl --context cluster1 exec "$POD" -n bank-of-anthos -c istio-proxy -- \
    cat /var/run/secrets/workload-spiffe-credentials/certificates.pem \
    | openssl x509 -noout -text | grep -E "URI:"
  ```

### E. Passerelle multi-cluster et équilibrage de charge global {#e-multi-cluster-gateway--global-load-balancing}

Une seule IP globale (`bank-of-anthos`) est réservée et un `MultiClusterIngress` (`bank-of-anthos-mci`) sur le cluster de configuration provisionne un équilibreur de charge d'application externe global dont les backends couvrent tous les clusters. Le réseau de Google achemine chaque utilisateur vers le cluster sain le plus proche. Notez que le manifeste `MultiClusterIngress` ne comporte aucune annotation `networking.gke.io/static-ip` ni `networking.gke.io/pre-shared-certs` : l'équilibreur de charge **n'adopte donc pas** l'adresse globale réservée, et les objets `ManagedCertificate` et `FrontendConfig` (HTTP→HTTPS 301) appliqués au cluster de configuration ne sont pas référencés par lui — le manifeste `Ingress` mono-cluster qui les lierait (`manifests/ingress.yaml`) est généré mais jamais appliqué. Lisez l'adresse réelle de l'équilibreur de charge dans l'état du `MultiClusterIngress` (`kubectl get mci -n bank-of-anthos -o jsonpath='{.items[0].status.VIP}'`).

- **Console :** Network Services → Load balancing affiche l'équilibreur de charge global, ses frontends, le service de backend et l'état de santé de chaque Network Endpoint Group par cluster.
- **CLI :**
  ```bash
  gcloud compute addresses list --global --project "$PROJECT" --filter="name~bank"
  kubectl --context cluster1 get multiclusteringress -n bank-of-anthos
  kubectl --context cluster1 get managedcertificate -n bank-of-anthos \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.certificateStatus}{"\n"}{end}'
  # Backend health per cluster NEG:
  BACKEND=$(gcloud compute backend-services list --global --project "$PROJECT" \
    --filter="name~bank-of-anthos" --format="value(name)" | head -1)
  gcloud compute backend-services get-health "$BACKEND" --global --project "$PROJECT"
  ```

### F. Réseau (VPC, NAT, pare-feu) {#f-networking-vpc-nat-firewall}

Tous les clusters partagent un même VPC à routage global. Chaque cluster reçoit son propre sous-réseau avec des plages secondaires pour les pods et les services, un Cloud Router + Cloud NAT pour la sortie privée, une IP externe statique réservée et un ensemble de règles de pare-feu (trafic interne, plan de contrôle GKE, vérifications d'état de l'équilibreur de charge et ports du webhook ASM). Notez que le module crée aussi une règle `allow-ssh-<deployment_id>` ouvrant **TCP/22 à l'ensemble du VPC depuis `0.0.0.0/0`** — restreignez-la ou supprimez-la si vous conservez le déploiement au-delà d'une démo.

- **Console :** VPC network → VPC networks → le réseau du déploiement ; VPC network → Firewall.
- **CLI :**
  ```bash
  gcloud compute networks subnets list --project "$PROJECT" \
    --format="table(name,region,ipCidrRange)"
  gcloud compute firewall-rules list --project "$PROJECT" \
    --format="table(name,direction,allowed[].map().firewall_rule().list())"
  ```

### G. Observabilité (Logging, Monitoring, Prometheus, Trace) {#g-observability-logging-monitoring-prometheus-trace}

Les journaux des pods sont acheminés vers Cloud Logging ; les métriques GKE et du maillage vers Cloud Monitoring et Managed Prometheus ; le maillage envoie les traces distribuées à Cloud Trace. Le tout est agrégé sur l'ensemble de la Fleet, ce qui permet de comparer les clusters côte à côte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards (groupe GKE) ; Kubernetes Engine → Service Mesh pour les signaux clés.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="bank-of-anthos"' \
    --project "$PROJECT" --limit 20 \
    --format="table(timestamp,resource.labels.cluster_name,resource.labels.location)"
  kubectl --context cluster1 top pods -n bank-of-anthos
  kubectl --context cluster2 top pods -n bank-of-anthos
  ```

### H. L'application Bank of Anthos {#h-the-bank-of-anthos-application}

Bank of Anthos est une simulation de banque de détail : inscription, connexion, consultation des soldes et virements. Elle comprend un `frontend`, `userservice`, `contacts`, `ledgerwriter`, `balancereader`, `transactionhistory`, un `loadgenerator` (trafic synthétique continu) et les bases de données PostgreSQL `accounts-db` / `ledger-db`. Le générateur de charge maintient un flux de trafic constant, si bien que les tableaux de bord et les traces du maillage affichent immédiatement des données en direct. L'authentification utilise une paire de clés JWT stockée dans le Secret Kubernetes `jwt-key`.

- **Console :** Kubernetes Engine → Workloads (filtré sur l'espace de noms `bank-of-anthos`), pour chaque cluster.
- **CLI :**
  ```bash
  kubectl --context cluster1 get deploy,statefulset,svc -n bank-of-anthos
  kubectl --context cluster2 get deploy,statefulset,svc -n bank-of-anthos   # note: no DB StatefulSets here
  ```

---

## 3. Comportement {#3-behaviour}

**Ce qui est déployé à l'apply.** Le module active les API de projet requises, crée (ou réutilise) le VPC partagé et les sous-réseaux/NAT/pare-feu par cluster, puis crée `cluster_size` clusters GKE dans les régions choisies. Chaque cluster est enregistré dans la Fleet et le module attend que chaque membre atteigne l'état `READY` (interrogé pendant environ 10 minutes au maximum) avant de poursuivre. Si le maillage est activé, il l'est au niveau de la Fleet et pour chaque membre en mode de gestion automatique, et le module attend que le maillage soit configuré sur chaque cluster.

**Déploiement de l'application sur les clusters.** Avec `deploy_application = true`, le module télécharge la version épinglée de Bank of Anthos (v0.6.10), crée l'espace de noms `bank-of-anthos` (labellisé pour l'injection de sidecar) sur chaque cluster, applique le secret JWT, puis applique les manifestes des charges de travail :

- Sur le **cluster principal** (`cluster1`), l'ensemble complet des manifestes est appliqué, **y compris** les StatefulSets `accounts-db` et `ledger-db`.
- Sur **tous les autres clusters**, les mêmes manifestes sont appliqués mais les StatefulSets de bases de données en sont retirés — les services sans état ainsi que les Services/ConfigMaps des bases de données sont tout de même créés pour que les autres pods puissent les résoudre, et ils sont conçus pour utiliser les bases de données du cluster principal à travers la Fleet. Tout StatefulSet de base de données préexistant sur un cluster non principal est supprimé.

Le module attend que les déploiements soient disponibles sur chaque cluster avant de signaler la réussite.

**Ingress global.** Une fois l'application en cours d'exécution, le module active la fonctionnalité Multi-Cluster Ingress de la Fleet (cluster de configuration = `cluster1`) et applique, sur le cluster de configuration, le `MultiClusterService` (backends du frontend répartis entre clusters), le `MultiClusterIngress` (l'équilibreur de charge global), un service NodePort + BackendConfig (vérifications d'état de l'équilibreur de charge), le certificat géré pour `boa.<GLOBAL_IP>.sslip.io`, le FrontendConfig (redirection HTTPS) et une ConfigMap de télémétrie du maillage dans `istio-system`. Le trafic circule alors ainsi : utilisateur → IP anycast globale → NEG du cluster sain le plus proche → pod frontend (sidecar Envoy) → services en aval via le mTLS du maillage.

**Suivi manuel.** Le certificat géré par Google est provisionné de manière asynchrone et peut mettre **10 à 60 minutes** à devenir `Active` ; d'ici là, HTTPS peut afficher un avertissement ou échouer. Utilisez les identifiants de démonstration affichés sur la page de connexion de Bank of Anthos pour vous connecter. Pour activer le CDN, des domaines personnalisés, IAP ou des politiques de trafic inter-clusters (VirtualService/DestinationRule), appliquez les ressources Kubernetes correspondantes après le déploiement.

**Remarques sur l'exécution.** Chaque pod applicatif s'exécute en `2/2` (application + sidecar). Le maillage partage un même domaine de confiance : les appels inter-clusters sont donc mutuellement authentifiés. Comme la couche de données réside uniquement sur le cluster principal, réduire le principal à zéro ou perdre sa région affecte les bases de données — les frontends sans état des autres clusters restent accessibles via l'équilibreur de charge global, mais dépendent du principal pour les données.

**Destruction.** Le démantèlement exécute des étapes de nettoyage ordonnées qui suppriment les ressources Multi-Cluster Ingress/Service, désactivent les fonctionnalités de maillage et de Multi-Cluster Ingress de la Fleet, désenregistrent les membres de la Fleet et suppriment les règles de pare-feu MCS et les NEG résiduels avant de supprimer les clusters et le VPC. Les API activées par le module restent activées pour ne pas perturber d'autres charges de travail.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et régions {#group-1--project--regions}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. Il doit déjà exister. |
| `tenant_id` | `demo` | Identifiant du tenant. Doit comporter de 1 à 20 lettres minuscules, chiffres et tirets — toute autre valeur échoue à la validation. Présent dans le formulaire, mais référencé par aucune ressource de ce module. |
| `available_regions` | `["us-west1", "us-east1"]` | Régions dans lesquelles les clusters sont placés, de manière circulaire selon l'index du cluster. S'il y a moins de régions que de clusters, les régions sont réutilisées en boucle. Doit comporter au moins une entrée. |

### Groupe 2 — Réseau {#group-2--network}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_network` | `true` | Crée un nouveau VPC partagé pour tous les clusters. Définissez `false` pour utiliser un réseau existant désigné par `network_name`. |
| `network_name` | `vpc-network` | Nom du VPC partagé. Lors de la création, un suffixe unique est ajouté automatiquement. |
| `subnet_name` | `vpc-subnet` | Nom de base des sous-réseaux par cluster (`<subnet_name>-cluster<N>`). Utilisé uniquement lorsque `create_network = true`. |

### Groupe 3 — Clusters GKE {#group-3--gke-clusters}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_autopilot_cluster` | `true` | Crée des clusters Autopilot (nœuds entièrement gérés). Définissez `false` pour des clusters Standard avec des pools de nœuds gérés. S'applique à tous les clusters. |
| `release_channel` | `REGULAR` | Release channel GKE de tous les clusters : `RAPID`, `REGULAR`, `STABLE` ou `NONE`. |
| `cluster_size` | `2` | Nombre de clusters GKE à créer. Minimum 2 pour une démo multi-cluster pertinente ; limite supérieure fixée par le quota régional. |

### Groupe 4 — Maillage de services {#group-4--service-mesh}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_service_mesh` | `true` | Installe et configure Cloud Service Mesh (Istio géré) à l'échelle de la Fleet pour le mTLS, le trafic inter-clusters et une observabilité unifiée. Google choisit la version du maillage à partir du `release_channel` des clusters ; il n'existe aucune entrée de version. |

### Groupe 5 — Application {#group-5--application}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Déploie Bank of Anthos sur tous les clusters après leur création. Définissez `false` pour ne provisionner que l'infrastructure des clusters. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | L'ID de déploiement (fourni ou généré automatiquement) utilisé comme suffixe des noms de ressources. |
| `project_id` | L'ID du projet cible. |

> L'adresse publique de l'application n'est pas exposée en tant que sortie Terraform. Récupérez l'IP globale depuis l'adresse globale réservée (`gcloud compute addresses list --global --filter="name~bank"`) ou depuis l'état du `MultiClusterIngress`, puis ouvrez `https://boa.<GLOBAL_IP>.sslip.io`.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `cluster_size` | `2` (ou plus) | Élevé | La valeur `1` va à l'encontre de l'objectif — ni ingress multi-cluster, ni maillage étendu, ni basculement. Des valeurs très élevées peuvent épuiser le quota régional et faire échouer l'apply en cours de route. |
| `available_regions` | ≥ 2 régions distinctes | Élevé | Une seule région supprime la géo-redondance ; tous les clusters partagent le domaine de défaillance d'une même région. |
| Cluster principal (`cluster1`) | à traiter comme la couche de données | Critique | Les bases de données `accounts-db` / `ledger-db` ne s'exécutent que sur le cluster principal. Perdre sa région, ou le réduire à zéro, met la couche de données hors ligne pour tous les clusters. |
| `deployment_id` | à définir une fois, puis à ne plus toucher | Critique | Le modifier après le premier déploiement force la recréation des ressources nommées (VPC, clusters), ce qui détruit l'état en cours d'exécution. |
| `release_channel` | laisser `REGULAR` sauf raison particulière | Élevé | Le label de révision CSM géré (`asm-managed`/`-rapid`/`-stable`) et la ConfigMap de configuration du maillage `istio-<revision>` en dérivent tous deux. Changer de channel après le premier déploiement ne déplace **pas** le maillage — CSM conserve la channel avec laquelle il a été provisionné. |
| `create_network` / `network_name` | `true` pour un nouveau projet | Moyen | Pointer (avec `false`) vers un réseau existant inexistant ou dont les plages se chevauchent casse la création des sous-réseaux et des clusters. |
| Attente du certificat géré | prévoir 10 à 60 min | Moyen | Ouvrir `https://boa.<IP>.sslip.io` avant que le certificat soit `Active` affiche des avertissements ou des échecs TLS — c'est attendu pendant le provisionnement et ne constitue pas une erreur de déploiement. |
| `create_autopilot_cluster` | `true` | Faible | Les clusters Standard ajoutent la gestion des pools de nœuds et un coût par nœud ; Autopilot est plus simple et moins coûteux pour cette démo. |
| `enable_cloud_service_mesh` | `true` | Moyen | Le désactiver supprime le mTLS, la gestion du trafic inter-clusters et l'observabilité Service Mesh que le module est conçu pour démontrer. |
| Durée du premier déploiement | prévoir 40 à 60 min | Faible | Le provisionnement multi-cluster + Fleet + maillage géré + équilibreur de charge global est intrinsèquement lent ; ne concluez pas à un blocage. |

---

Il s'agit d'un module pédagogique autonome qui construit son propre VPC, ses clusters, sa Fleet, son maillage et son équilibreur de charge global — il ne dépend d'aucun module socle distinct. Pour l'application amont, consultez le [dépôt Bank of Anthos](https://github.com/GoogleCloudPlatform/bank-of-anthos).
