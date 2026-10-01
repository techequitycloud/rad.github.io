---
title: "Istio sur GKE"
description: "Référence de configuration pour déployer Istio sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Istio_GKE.md @ 3055034 sha256:0181180b3f54 -->

# Istio sur GKE {#istio-on-gke}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Istio_GKE.png" alt="Istio sur GKE" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce module met en place un **cluster GKE Standard** et y installe le **maillage de services open source Istio** — le projet CNCF amont sur lequel reposent Google Cloud Service Mesh et de nombreuses autres offres de maillage gérées. Istio est installé directement avec `istioctl`, si bien que chaque décision de configuration est transparente et inspectable, ce qui en fait un environnement pratique idéal pour les ingénieurs plateforme qui veulent comprendre en profondeur le fonctionnement d'un maillage de services.

Au moment du déploiement, vous choisissez l'une des deux architectures de plan de données : le **mode sidecar** (un proxy Envoy injecté dans chaque pod pour un contrôle complet du trafic par pod) ou le **mode ambient** (un proxy `ztunnel` partagé par nœud, complété de proxys waypoint facultatifs, avec une consommation de ressources bien moindre). En plus d'Istio, le module installe la pile d'observabilité open source complète — **Prometheus, Jaeger, Grafana et Kiali** — afin que vous puissiez explorer immédiatement la télémétrie du maillage. Il s'agit d'un module d'infrastructure autonome : il provisionne son propre VPC, son propre cluster et son propre réseau, et ne s'appuie sur aucun socle partagé.

Ce module est destiné à des **fins pédagogiques et d'évaluation**.

---

## 1. Vue d'ensemble {#1-overview}

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cluster GKE Standard | Un seul pool de nœuds avec `node_count = 2` **par zone** dans chaque zone active (UP) de la région — 8 nœuds préemptifs `e2-standard-2` (16 vCPU) dans une région à 4 zones telle que `us-central1` ; vous gérez directement la configuration des nœuds (pas Autopilot) |
| Réseau | Réseau VPC + sous-réseau | VPC en mode personnalisé, routage global, VPC natif (IP d'alias) avec plages secondaires pour les pods et les services |
| Sortie | Cloud Router + Cloud NAT | Provisionnés pour le VPC, mais le cluster n'est **pas** privé (pas de `private_cluster_config`) : les nœuds disposent donc d'IP externes et sortent directement ; l'installation d'Istio elle-même s'exécute en `local-exec` sur l'hôte Terraform, et non sur les nœuds |
| Identité | Workload Identity + compte de service de nœud dédié | Compte de service de nœud au moindre privilège ; les pods obtiennent une identité GCP sans fichier de clé |
| Maillage de services | Istio open source (via `istioctl`) | Mode sidecar **ou** ambient, plus une Istio Ingress Gateway exposée via un LoadBalancer externe |
| Observabilité | Prometheus, Jaeger, Grafana, Kiali | Modules complémentaires open source installés dans le cluster, dans `istio-system` ; GKE Managed Prometheus également activé au niveau du cluster |
| Posture de sécurité | GKE Security Posture, Gateway API | Posture BASIC + analyse des vulnérabilités ; canal standard de la Gateway API activé |

**À savoir dès le départ :**

- **GKE Standard, et non Autopilot.** Vous contrôlez directement le pool de nœuds, le type de machine et les paramètres du cluster. Le cluster autorise la capacité `NET_ADMIN`, dont le mode sidecar a besoin pour mettre en place l'interception du trafic.
- **Le mode sidecar est la valeur par défaut.** `install_ambient_mesh` vaut `false` par défaut (mode sidecar). Définissez-le sur `true` pour le mode ambient. Le mode est choisi au moment du déploiement, et en changer nécessite un redéploiement.
- **L'installation d'Istio s'exécute comme une étape du déploiement.** Une fois le cluster créé, la plateforme télécharge `istioctl`, installe Istio avec le profil sélectionné, étiquette l'espace de noms `default` pour l'inscription au maillage et installe les quatre modules complémentaires d'observabilité. Les échecs transitoires des modules complémentaires sont journalisés comme avertissements et ne font pas échouer le déploiement.
- **L'Ingress Gateway obtient une IP publique.** Les deux modes installent un Service `istio-ingressgateway` de type `LoadBalancer`, qui provisionne un équilibreur de charge externe GCP. Comptez 1 à 2 minutes après l'installation pour que l'IP soit attribuée.
- **Aucune application de démonstration n'est provisionnée.** Le maillage et la pile d'observabilité sont installés, mais le module ne déploie aucune charge de travail d'exemple. Pour explorer la gestion du trafic, déployez vos propres charges de travail (ou l'exemple Istio Bookinfo) dans l'espace de noms `default`, déjà étiqueté pour l'inscription au maillage.
- **Nœuds préemptifs.** Les nœuds peuvent être récupérés avec un préavis d'environ 30 secondes. Cela maintient des coûts bas pour un environnement d'apprentissage, mais ne convient pas à la production.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes `kubectl` / `istioctl` supposent que vous avez d'abord récupéré les identifiants du cluster (la commande exacte est renvoyée dans la [sortie](#5-outputs) `cluster_credentials_cmd`) :

```bash
gcloud container clusters get-credentials <gke_cluster> --region <region> --project <project>
```

### A. Cluster GKE Standard {#a-gke-standard-cluster}

Le cluster exécute un seul pool de nœuds régional de deux nœuds préemptifs `e2-standard-2` **par zone** — 8 nœuds dans une région à 4 zones telle que `us-central1` — avec le réseau VPC natif, Workload Identity, GKE Security Posture (BASIC), Managed Prometheus et le canal standard de la Gateway API activés. Vérifiez votre quota régional de CPU (16 vCPU pour `e2-standard-2` × 8) avant de déployer.

- **Console :** Kubernetes Engine → Clusters → sélectionnez le cluster → Details (canal de publication, version), Nodes (pool de nœuds), Security (Workload Identity, Security Posture).
- **CLI :**
  ```bash
  gcloud container clusters describe <gke_cluster> --region <region> --project <project> \
    --format="value(currentMasterVersion,releaseChannel.channel)"
  kubectl get nodes -o wide
  kubectl top nodes
  ```

### B. Réseau VPC, pare-feu et Cloud NAT {#b-vpc-networking-firewall-and-cloud-nat}

Un VPC en mode personnalisé avec un sous-réseau (plages secondaires pour les pods et les services), des règles de pare-feu, ainsi qu'un Cloud Router et un Cloud NAT pour le trafic sortant. L'installation d'Istio dépend de NAT pour télécharger `istioctl` et les manifestes des modules complémentaires.

- **Console :** VPC network → VPC networks (sous-réseau + plages secondaires) ; VPC network → Firewall ; Network services → Cloud NAT.
- **CLI :**
  ```bash
  gcloud compute networks subnets describe <subnet_name> --region <region> --project <project>
  gcloud compute firewall-rules list --project <project>
  gcloud compute routers get-nat-mapping-info cr1-<region> --region <region> --project <project>
  ```

### C. Plan de contrôle Istio {#c-istio-control-plane}

`istiod` (le plan de contrôle unifié Pilot / Citadel / Galley) et l'Istio Ingress Gateway s'exécutent dans l'espace de noms `istio-system`. `istiod` diffuse la configuration Envoy/ztunnel via le protocole xDS et joue le rôle d'autorité de certification du maillage.

- **Console :** Kubernetes Engine → Workloads → filtrez sur l'espace de noms `istio-system`.
- **CLI :**
  ```bash
  kubectl get all -n istio-system
  istioctl version
  istioctl verify-install
  istioctl proxy-status            # all proxies synced to the control plane
  istioctl analyze -A              # configuration validation
  ```

### D. Plan de données — sidecar ou ambient {#d-data-plane--sidecar-vs-ambient}

En **mode sidecar**, un proxy Envoy est injecté dans chaque pod d'un espace de noms étiqueté `istio-injection=enabled` (le module étiquette `default`). En **mode ambient**, un DaemonSet `ztunnel` gère le mTLS de couche 4 par nœud pour les espaces de noms étiquetés `istio.io/dataplane-mode=ambient`, avec des proxys waypoint facultatifs pour la couche 7.

- **CLI (sidecar) :**
  ```bash
  kubectl get namespace default --show-labels        # expect istio-injection=enabled
  kubectl get mutatingwebhookconfiguration | grep istio
  istioctl proxy-config all <pod>                    # Envoy config for a pod's sidecar
  ```
- **CLI (ambient) :**
  ```bash
  kubectl get namespace default --show-labels        # expect istio.io/dataplane-mode=ambient
  kubectl get daemonset ztunnel -n istio-system
  kubectl get pods -n istio-system -l app=ztunnel -o wide
  istioctl ztunnel-config workloads
  ```

### E. Istio Ingress Gateway {#e-istio-ingress-gateway}

Un `Deployment` Envoy autonome placé derrière un Service `LoadBalancer` qui provisionne un équilibreur de charge externe GCP — le point d'entrée du trafic dans le maillage.

- **Console :** Kubernetes Engine → Service & Ingress → `istio-ingressgateway` ; Network services → Load balancing.
- **CLI :**
  ```bash
  kubectl get svc istio-ingressgateway -n istio-system
  # Read the external IP from the Service (the external_ip output is not reliably populated):
  kubectl get svc istio-ingressgateway -n istio-system \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'; echo
  ```

### F. Pile d'observabilité {#f-observability-stack}

Prometheus, Jaeger, Grafana et Kiali sont installés dans `istio-system`. On y accède par redirection de port (le module ne les expose pas à l'extérieur). GKE Managed Prometheus fonctionne à leurs côtés au niveau du cluster.

- **Console :** Monitoring → Metrics Explorer (Managed Prometheus / PromQL) ; Kubernetes Engine → Workloads (`istio-system`) pour les pods des modules complémentaires.
- **CLI :**
  ```bash
  kubectl get pods -n istio-system -l 'app in (prometheus,grafana,jaeger,kiali)'
  kubectl port-forward svc/kiali 20001:20001 -n istio-system        # http://localhost:20001
  kubectl port-forward svc/grafana 3000:3000 -n istio-system        # http://localhost:3000
  kubectl port-forward svc/tracing 16686:80 -n istio-system         # Jaeger UI
  kubectl port-forward svc/prometheus 9090:9090 -n istio-system
  ```

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux système du cluster et ceux des charges de travail sont envoyés vers Cloud Logging ; les métriques du cluster et de Managed Prometheus sont envoyées vers Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards (GKE / Kubernetes).
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="istio-system"' \
    --project <project> --limit 50
  ```

---

## 3. Comportement {#3-behaviour}

**Séquence au moment du déploiement :**

1. Activer les API requises du projet et attendre l'activation de la Container API.
2. Créer le VPC, le sous-réseau (avec les plages secondaires pour les pods et les services), les règles de pare-feu, ainsi que le Cloud Router et le Cloud NAT — sauf si `create_network = false`, auquel cas le réseau et le sous-réseau existants désignés sont utilisés.
3. Créer le cluster GKE Standard et un pool de deux nœuds préemptifs avec un compte de service de nœud dédié au moindre privilège — sauf si `create_cluster = false`, auquel cas Istio est installé sur le cluster existant désigné.
4. Exécuter l'installation d'Istio comme étape du déploiement : télécharger `istioctl` pour la version `istio_version` demandée, récupérer les identifiants du cluster, créer l'espace de noms `istio-system` et installer Istio avec le profil sélectionné.
5. Étiqueter l'espace de noms `default` pour l'inscription au maillage, puis installer les modules complémentaires Prometheus, Jaeger, Grafana et Kiali et exécuter une vérification de l'installation.

**Mode sidecar (`install_ambient_mesh = false`, par défaut) :**

- Istio est installé avec des identifiants de maillage et une Ingress Gateway à mise à l'échelle automatique (2 répliques minimum / 5 maximum, cible CPU de 80 %). Si ce chemin d'installation échoue, l'étape se rabat sur une installation avec le profil `minimal`.
- L'espace de noms `default` est étiqueté `istio-injection=enabled`. Les pods qui y sont créés reçoivent un sidecar Envoy `istio-proxy` ; le cluster autorise `NET_ADMIN` afin que le sidecar puisse programmer l'interception du trafic. **Les pods existants doivent être redémarrés pour recevoir un sidecar.**

**Mode ambient (`install_ambient_mesh = true`) :**

- Istio est installé avec le profil `ambient` et une Ingress Gateway de type LoadBalancer, et un quota de ressources est appliqué pour protéger les pods critiques des nœuds.
- Un DaemonSet `ztunnel` fournit le mTLS de couche 4 par nœud. L'espace de noms `default` est étiqueté `istio.io/dataplane-mode=ambient` et un proxy waypoint lui est appliqué pour les politiques de couche 7. L'inscription ne nécessite **aucun redémarrage de pod**.

**Remarques sur l'exécution :**

- **IP d'entrée.** Après l'installation, l'IP externe de l'Ingress Gateway met 1 à 2 minutes à apparaître. Les journaux de déploiement l'affichent ; lisez-la à tout moment avec `kubectl get svc istio-ingressgateway -n istio-system`. La sortie `external_ip` du module est fournie au mieux et indique souvent `IP not available` — utilisez plutôt le Service.
- **Pas d'application d'exemple.** Bien qu'une option `deploy_application` soit présente, le module actuel ne provisionne aucune charge de travail de démonstration. Déployez vos propres services (ou l'exemple Istio Bookinfo fourni avec la version d'Istio téléchargée) dans l'espace de noms `default`, déjà étiqueté, pour tester la gestion du trafic, le mTLS et les politiques d'autorisation.
- **mTLS permissif par défaut.** Le maillage accepte à la fois le trafic en clair et le trafic mTLS jusqu'à ce que vous appliquiez une politique `PeerAuthentication` `STRICT` — un choix délibéré pour permettre une adoption progressive.
- **Démantèlement.** La destruction exécute une désinstallation ordonnée qui supprime les waypoints/étiquettes, les modules complémentaires d'observabilité, l'installation d'Istio et l'espace de noms `istio-system` avant le démantèlement du cluster et du réseau. Les étapes de nettoyage sont exécutées au mieux et ne bloquent jamais la destruction.

---

## 4. Variables de configuration {#4-configuration-variables}

Regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Les paramètres de métadonnées du module (groupe 0) sont gérés par la plateforme et ne figurent pas ici.

### Groupe 1 — Projet et région {#group-1--project--region}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet GCP de destination où le cluster et le maillage sont déployés. Doit déjà exister. |
| `tenant_id` | `demo` | Identifiant du locataire. Doit comporter de 1 à 20 caractères alphanumériques minuscules ou tirets. **N'a actuellement aucun effet** — il est validé mais n'est référencé par aucune ressource de ce module ; les noms de ressources utilisent à la place le suffixe de l'ID de déploiement. |
| `region` | `us-central1` | Région du cluster, du VPC et de toutes les ressources régionales. Assurez-vous de disposer d'un quota suffisant. |

### Groupe 2 — Réseau {#group-2--network}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_network` | `true` | Crée un nouveau VPC et un nouveau sous-réseau. Définissez `false` pour installer dans un réseau/sous-réseau existant. |
| `network_name` | `vpc-network` | Nom de base du VPC. Lorsque `create_network = true`, le VPC est créé sous le nom `<network_name>-<deployment_id>` (un suffixe aléatoire est ajouté) ; lorsque `create_network = false`, ce nom est comparé tel quel au réseau existant. |
| `subnet_name` | `vpc-subnet` | Nom du sous-réseau — créé ou référencé selon `create_network`. |
| `ip_cidr_ranges` | `["10.132.0.0/16", "192.168.1.0/24"]` | Blocs CIDR des plages du sous-réseau (utilisés uniquement lors de la création d'un réseau). Le premier est la plage principale des nœuds. |

### Groupe 3 — Cluster GKE {#group-3--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cluster` | `true` | Crée un nouveau cluster GKE Standard. Définissez `false` pour installer Istio sur un cluster existant. |
| `gke_cluster` | `gke-cluster` | Nom du cluster — créé ou référencé selon `create_cluster`. |
| `release_channel` | `REGULAR` | Canal de publication GKE : `RAPID`, `REGULAR`, `STABLE` ou `NONE` (mises à niveau manuelles). |
| `pod_cidr_block` | `10.62.128.0/17` | Plage secondaire pour les IP des pods. Ne doit pas chevaucher les plages des nœuds ou des services. |
| `service_cidr_block` | `10.64.128.0/20` | Plage secondaire pour les ClusterIP des Services. Ne doit pas chevaucher les plages des nœuds ou des pods. |

### Groupe 4 — Fonctionnalités Istio {#group-4--istio-features}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `istio_version` | `1.30.3` | Version d'Istio open source à installer (majeure.mineure.correctif). Doit être prise en charge par le canal de publication choisi. |
| `install_ambient_mesh` | `false` | `false` installe le mode sidecar (Envoy par pod) ; `true` installe le mode ambient (ztunnel par nœud + waypoints facultatifs). |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | Renvoie l'**entrée** `deployment_id`, et non le suffixe généré. Lorsque l'entrée conserve sa valeur par défaut (`null`), cette sortie est vide, alors même que les ressources sont nommées avec un suffixe aléatoire généré automatiquement. |
| `project_id` | L'ID du projet de destination. |
| `cluster_credentials_cmd` | Commande `gcloud container clusters get-credentials` prête à l'emploi pour le cluster. |
| `external_ip` | Indique **toujours** `IP not available` — elle lit `scripts/app/external_ip.txt`, un fichier que ce module ne crée jamais. Lisez plutôt l'IP depuis le Service `istio-ingressgateway` (ou dans les journaux de déploiement). |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `pod_cidr_block` / `service_cidr_block` / `ip_cidr_ranges` | plages sans chevauchement | Critical | Des plages secondaires qui se chevauchent (entre elles ou avec des réseaux appairés/sur site) font échouer la création du cluster ou provoquent des conflits de routage difficiles à corriger. |
| `install_ambient_mesh` | choisi une fois au déploiement | High | Le mode est fixé au moment de l'installation ; passer du mode sidecar au mode ambient (ou inversement) après le déploiement nécessite de démanteler puis de réinstaller le maillage. |
| `istio_version` | une étiquette de version réellement publiée (par ex. `1.30.3`) | High | Une version indisponible ou non prise en charge fait échouer le téléchargement/l'installation de `istioctl`, laissant le cluster sans maillage. |
| `create_cluster` / `gke_cluster` | correspondre à la cible réelle | High | Avec `create_cluster = false`, un nom `gke_cluster` incorrect fait échouer la recherche du cluster existant et l'installation est interrompue. |
| `create_network` avec un réseau existant | `network_name` / `subnet_name` corrects | High | Un nom de réseau/sous-réseau existant erroné fait échouer la recherche, ou place le cluster dans un réseau non prévu. |
| Attentes concernant l'IP d'entrée | à lire depuis le Service, pas depuis `external_ip` | Medium | Se fier à la sortie `external_ip` (souvent `IP not available`) prête à confusion ; l'IP du LoadBalancer figure toujours sur le Service `istio-ingressgateway`. |
| `release_channel` | `REGULAR` | Medium | `RAPID` introduit des versions précoces de Kubernetes qui peuvent ne pas être validées avec la version `istio_version` choisie ; `NONE` désactive l'application automatique des correctifs. |
| Nœuds préemptifs (fixe) | acceptables pour les labs uniquement | Medium | Les deux nœuds peuvent être récupérés simultanément, rendant brièvement indisponibles le plan de contrôle et la passerelle. Pas pour la production. |
| S'attendre à une application de démonstration intégrée | déployer votre propre charge de travail | Low | Le module installe uniquement le maillage ; rien ne sert de trafic tant que vous n'avez pas déployé une charge de travail dans l'espace de noms `default`. |

---

Pour une présentation pratique du déploiement, de la vérification, de l'exploitation, de l'observation et du démantèlement de ce module — y compris l'exploration des modes sidecar et ambient et de la pile d'observabilité — consultez le **[guide de lab Istio sur GKE](../labs/Istio_GKE.md)**.
