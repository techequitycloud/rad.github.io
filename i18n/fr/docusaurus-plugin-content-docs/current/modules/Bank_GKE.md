---
title: "Bank of Anthos sur GKE"
description: "Référence de configuration pour déployer Bank of Anthos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Bank_GKE.md @ 3055034 sha256:34f2a3f26ea1 -->

# Bank of Anthos sur GKE {#bank-of-anthos-on-gke}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Bank_GKE.png" alt="Bank of Anthos sur GKE" style={{maxWidth: "100%", borderRadius: "8px"}} />

Bank of Anthos est l'application bancaire de référence open source de Google Cloud — une démonstration de microservices polyglottes (services Python et Java, deux bases de données PostgreSQL et un générateur de charge synthétique) qui imite une banque de détail avec des comptes, un registre de transactions et un front-end web. Ce module est un déploiement **autonome** : il construit son propre VPC, son cluster GKE, son appartenance à la flotte, Cloud Service Mesh et la supervision, puis déploie les manifestes amont de Bank of Anthos sur le cluster. Il ne dépend d'aucun module socle partagé.

Le module est destiné à **la formation et la démonstration** — explorer GKE Autopilot, un maillage de services géré avec mTLS automatique, la gestion de flotte et Cloud Monitoring. Ce n'est pas un système bancaire de production.

Ce guide se concentre sur les services Google Cloud que provisionne le module et sur la manière de les explorer et de les exploiter depuis la console et la ligne de commande.

---

## 1. Vue d'ensemble {#1-overview}

Le module assemble un ensemble ciblé de services Google Cloud autour de la charge de travail Bank of Anthos :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot (ou Standard) | Un seul cluster régional ; Autopilot est la valeur par défaut et provisionne/met à l'échelle les nœuds automatiquement |
| Réseau | VPC, sous-réseau, Cloud Router + Cloud NAT, règles de pare-feu | Un VPC dédié avec des plages secondaires VPC-native pour les pods et les services ; NAT pour l'egress |
| Maillage de services | Cloud Service Mesh (Istio géré par Google) | Activé via la flotte avec `MANAGEMENT_AUTOMATIC` ; injecte des sidecars Envoy et applique le mTLS |
| Flotte | GKE Hub / appartenance à la flotte | Le cluster est enregistré dans la flotte, ce qui est nécessaire pour activer la fonctionnalité de maillage |
| Ingress | Cloud Load Balancing (L4 externe) | Le front-end est exposé via le Service amont `frontend` de type LoadBalancer ; une IP statique globale est également réservée |
| Observabilité | Cloud Monitoring, Managed Service for Prometheus, Cloud Logging, Cloud Trace | Managed Prometheus sur le cluster ; un service supervisé + un SLO d'utilisation du CPU par charge de travail |
| Application | Charges de travail Bank of Anthos `v0.6.10` | Neuf charges de travail — sept Deployments de microservices plus deux StatefulSets PostgreSQL — dans l'espace de noms `bank-of-anthos` |

**À savoir d'emblée :**

- **Il s'agit d'un module autonome.** Il crée son propre VPC, son cluster GKE et l'infrastructure associée. Il n'y a aucun module de plateforme/socle distinct à déployer au préalable — seulement un projet GCP avec la facturation activée.
- **Autopilot est la valeur par défaut.** `create_autopilot_cluster = true` fournit un cluster entièrement géré par Google. Définissez-le à `false` pour un cluster Standard ; le module provisionne alors un pool de nœuds Spot (`e2-standard-2`) avec 2 nœuds par zone dans chaque zone disponible de la région, ainsi qu'un compte de service de nœud dédié avec Workload Identity.
- **L'application est exposée en HTTP simple (L4).** Le Service `frontend` de Bank of Anthos est de type `LoadBalancer` ; il reçoit donc une IP externe classique servant du HTTP. Le module réserve aussi une IP statique globale nommée `bank-of-anthos`, mais la démonstration ne provisionne ni équilibreur de charge HTTPS, ni certificat TLS géré, ni domaine personnalisé.
- **Le plan de contrôle du maillage est entièrement géré.** Avec `enable_cloud_service_mesh = true`, Google exécute le plan de contrôle Istio — aucun pod `istiod` ne s'exécute dans votre cluster. L'espace de noms `bank-of-anthos` porte le libellé `istio.io/rev=asm-managed`, ce qui déclenche l'injection automatique de sidecars Envoy : chaque pod s'exécute donc en `2/2`.
- **L'apply attend que le maillage soit prêt.** Le provisionnement vérifie que l'appartenance à la flotte et le plan de contrôle du maillage atteignent l'état `ACTIVE` avant de déployer l'application ; les premiers déploiements prennent donc un certain temps (environ 30–45 minutes).
- **Les entrées de Config Management sont présentes mais inactives.** `enable_config_management` et les entrées associées existent pour une compatibilité future, mais ce module ne provisionne **pas** actuellement de ressources Anthos Config Management / Config Sync. Conservez la valeur par défaut.
- **Les manifestes de l'application sont récupérés depuis GitHub au moment de l'apply.** Le module télécharge l'archive de la version `v0.6.10` de Bank of Anthos et applique ses manifestes Kubernetes avec `kubectl`. Un accès Internet sortant depuis l'exécuteur du déploiement est nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT` et `REGION` sont définis. Le nom du cluster vaut `gke-cluster` par défaut ; l'espace de noms de l'application est `bank-of-anthos`.

### A. GKE — le cluster et la charge de travail bancaire {#a-gke--the-cluster-and-the-banking-workload}

Le cluster exécute les neuf charges de travail de Bank of Anthos — sept Deployments de microservices plus les StatefulSets PostgreSQL `accounts-db` et `ledger-db` — dans l'espace de noms `bank-of-anthos`. Sur Autopilot, les nœuds sont provisionnés et mis à l'échelle automatiquement ; sur Standard, un pool de nœuds Spot de 2 nœuds est créé. Managed Prometheus, le pilote CSI GCS FUSE, la Gateway API, la gestion des coûts GKE et la posture de sécurité BASIC (avec analyse des vulnérabilités des charges de travail) sont tous activés sur le cluster.

- **Console :** Kubernetes Engine → Clusters (mode, version, modules complémentaires) ; Workloads (les neuf services) ; Security Posture (vulnérabilités et erreurs de configuration détectées).
- **CLI :**
  ```bash
  gcloud container clusters describe gke-cluster --region "$REGION" --project "$PROJECT" \
    --format="table(name,autopilot.enabled,currentMasterVersion,status)"
  kubectl get pods -n bank-of-anthos          # expect every pod 2/2 (app + Envoy sidecar)
  kubectl get statefulset,pvc -n bank-of-anthos
  kubectl get nodes -o wide
  ```

### B. Cloud Service Mesh {#b-cloud-service-mesh}

Cloud Service Mesh est activé comme fonctionnalité de flotte avec `MANAGEMENT_AUTOMATIC`. Google gère le plan de contrôle Istio ; des sidecars Envoy sont injectés dans chaque pod de l'espace de noms `bank-of-anthos`, chiffrant tout le trafic de pod à pod avec mTLS et émettant la télémétrie des signaux clés sans aucune instrumentation de l'application.

- **Console :** Kubernetes Engine → Service Mesh — graphe de topologie en direct, latence/trafic/erreurs par service, santé du plan de contrôle.
- **CLI :**
  ```bash
  gcloud container fleet mesh describe --project "$PROJECT"
  kubectl get namespace bank-of-anthos --show-labels        # istio.io/rev=asm-managed
  # Confirm each pod has an istio-proxy sidecar:
  kubectl get pods -n bank-of-anthos \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'
  ```

### C. GKE Fleet {#c-gke-fleet}

Le cluster est enregistré comme membre de la flotte immédiatement après sa création. L'appartenance à la flotte est le prérequis à l'activation de la fonctionnalité de maillage, et elle offre un emplacement unique pour consulter l'état des fonctionnalités sur l'ensemble des clusters.

- **Console :** Kubernetes Engine → Fleets — état de l'appartenance et fonctionnalités activées.
- **CLI :**
  ```bash
  gcloud container fleet memberships list --project "$PROJECT"
  gcloud container fleet memberships describe gke-cluster --location global --project "$PROJECT"
  gcloud container fleet features list --project "$PROJECT"
  ```

### D. Réseau et équilibrage de charge {#d-networking--load-balancing}

Le module crée un VPC dédié (routage GLOBAL) avec un sous-réseau portant des plages secondaires VPC-native pour les pods et les services, une passerelle Cloud Router + Cloud NAT pour l'egress, et un ensemble de règles de pare-feu (plages des contrôles de santé de l'équilibreur de charge et de NFS, SSH via un tunnel IAP, trafic des pods à l'intérieur du VPC, HTTP/HTTPS). Une IP externe statique globale nommée `bank-of-anthos` est réservée. Le front-end de l'application est atteint via le Service amont `frontend` de type LoadBalancer.

- **Console :** VPC network → VPC networks / Firewall ; Network services → Cloud NAT et Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  gcloud compute networks subnets list --project "$PROJECT" \
    --format="table(name,region,ipCidrRange,secondaryIpRanges[].rangeName)"
  gcloud compute addresses list --global --project "$PROJECT"
  # External IP the application is actually served on:
  kubectl get svc frontend -n bank-of-anthos \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```

### E. Cloud Monitoring, Prometheus, Logging et Trace {#e-cloud-monitoring-prometheus-logging--trace}

Managed Service for Prometheus s'exécute sur le cluster. Lorsque la supervision est activée, le module enregistre chacune des neuf charges de travail comme service Cloud Monitoring et associe à chacune un SLO d'utilisation de la limite de CPU. Le stdout/stderr des pods arrive dans Cloud Logging, et les sidecars du maillage exportent les traces distribuées vers Cloud Trace.

- **Console :** Monitoring → Dashboards (GKE) et Services → SLOs ; Logging → Logs Explorer ; Trace → Trace list.
- **CLI :**
  ```bash
  gcloud monitoring services list --project "$PROJECT"
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="bank-of-anthos"' \
    --project "$PROJECT" --limit 50
  ```

### F. Les charges de travail Bank of Anthos {#f-the-bank-of-anthos-workloads}

Neuf services répartis sur trois niveaux : `frontend` (interface web Python) ; `userservice`, `contacts` et `accounts-db` (gestion des comptes plus PostgreSQL) ; `ledgerwriter`, `balancereader`, `transactionhistory` et `ledger-db` (transactions plus PostgreSQL) ; et `loadgenerator`, qui génère un trafic synthétique afin que la télémétrie et les SLO disposent de données. Les services communiquent en HTTP par nom DNS Kubernetes ; un JWT signé RSA (stocké comme Secret Kubernetes) authentifie les utilisateurs d'un service à l'autre.

- **CLI :**
  ```bash
  kubectl get all -n bank-of-anthos
  kubectl logs -n bank-of-anthos deploy/frontend --tail=50
  kubectl logs -n bank-of-anthos deploy/loadgenerator --tail=20
  ```

---

## 3. Comportement {#3-behaviour}

- **Provisionnement autonome.** Un apply réussi crée le VPC et le sous-réseau (avec les plages secondaires des pods et des services), Cloud Router + NAT, les règles de pare-feu, le cluster GKE, l'appartenance à la flotte, la fonctionnalité Cloud Service Mesh, les services supervisés et les SLO, une IP statique globale réservée et les charges de travail Bank of Anthos.
- **Les composants de Bank of Anthos.** Avec `deploy_application = true`, le module déploie neuf microservices — `frontend`, `userservice`, `contacts`, `ledgerwriter`, `balancereader`, `transactionhistory`, `loadgenerator`, et les bases de données PostgreSQL `accounts-db` et `ledger-db` — dans l'espace de noms `bank-of-anthos`, ainsi que le secret de signature/vérification des JWT.
- **Ordre donnant la priorité au maillage.** L'apply active les API GKE Hub et du maillage, accorde à l'agent de service GKE Hub les rôles dont il a besoin, enregistre l'appartenance à la flotte, active la fonctionnalité de maillage, puis **attend** (par interrogation périodique) que l'appartenance et le plan de contrôle du maillage indiquent `ACTIVE` avant de déployer l'application. C'est pourquoi les premiers déploiements prennent environ 30–45 minutes.
- **Déploiement de l'application.** Le module télécharge depuis GitHub l'archive de la version `v0.6.10` de Bank of Anthos, crée l'espace de noms `bank-of-anthos` avec le libellé de révision CSM correspondant au canal (`istio.io/rev=asm-managed` pour `REGULAR`, `-rapid`/`-stable` pour les autres canaux), applique le secret JWT et les manifestes Kubernetes avec `kubectl`, et attend que tous les déploiements soient disponibles. Il crée également un compte de service Workload Identity local au projet (`bank-of-anthos@<project>.iam.gserviceaccount.com`), lui accorde `roles/cloudtrace.agent` et `roles/monitoring.metricWriter`, le lie au compte de service Kubernetes `bank-of-anthos` et ré-annote ce KSA — les manifestes amont v0.6.10 codent en dur un compte de service situé dans le propre projet CI de Google, ce qui, sinon, fait planter les services Java au démarrage.
- **Injection du maillage.** Comme l'espace de noms porte le libellé de révision `asm-managed`, chaque pod reçoit un sidecar Envoy à l'admission et s'exécute en `2/2`. Tout le trafic à l'intérieur de l'espace de noms est chiffré en mTLS par défaut.
- **Mode d'exposition de l'application.** Le Service amont `frontend` est de type `LoadBalancer` ; Google Cloud lui attribue donc une IP externe servant du HTTP simple sur le port 80. L'IP statique globale réservée et le module complémentaire Gateway API sont disponibles pour des schémas d'exposition avancés, mais ne sont pas reliés à un équilibreur de charge HTTPS par ce module.
- **Supervision et SLO.** Lorsque `enable_monitoring = true`, un service Cloud Monitoring et un SLO d'utilisation de la limite de CPU (objectif de 95 %, période calendaire quotidienne, fenêtres de 5 minutes) sont créés par charge de travail, offrant un cadre de SLO prêt à l'emploi à explorer.
- **Suivi manuel.** TLS/HTTPS, un domaine personnalisé, IAP devant le front-end, les politiques de gestion du trafic (VirtualService/DestinationRule) et toute configuration GitOps/Config Sync ne sont pas provisionnés par le module et doivent être configurés manuellement après le déploiement si vous le souhaitez.
- **Éléments supplémentaires en mode Standard.** Avec `create_autopilot_cluster = false`, le module crée en outre un compte de service de nœud, un pool de nœuds Spot (`e2-standard-2`, 50 GB pd-ssd) dimensionné à **2 nœuds par zone dans chaque zone disponible de la région** (8 nœuds dans une région à quatre zones comme `us-central1`), ainsi que les liaisons IAM et le pool Workload Identity qu'Autopilot fournirait sinon automatiquement.
- **Remarques d'exécution.** L'archive de la version est retéléchargée à chaque apply ; les mises à jour récupèrent donc à nouveau les manifestes ; les bases de données de démonstration (`accounts-db`, `ledger-db`) contiennent toutes les données de comptes et de transactions et sont supprimées avec le cluster lors du démantèlement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et région {#group-1--project--region}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(utilise le projet par défaut)_ | Projet GCP de destination dans lequel le cluster et l'application sont déployés. Le compte de service de provisionnement doit y détenir `roles/owner`. |
| `region` | `us-central1` | Région du cluster, du VPC et de toutes les ressources régionales. Vérifiez que le quota est disponible. |
| `tenant_id` | `demo` | Identifiant de locataire utilisé dans le nommage des ressources. Doit comporter 1 à 20 caractères, uniquement des lettres minuscules, des chiffres et des tirets — toute autre valeur échoue à la validation au moment du plan. |

### Groupe 2 — Réseau {#group-2--network}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_network` | `true` | Crée un nouveau VPC et un sous-réseau. Définissez `false` pour utiliser un réseau existant identifié par `network_name`/`subnet_name`. |
| `network_name` | `vpc-network` | Nom du VPC (créé ou référencé). |
| `subnet_name` | `vpc-subnet` | Nom du sous-réseau (créé ou référencé). |
| `ip_cidr_ranges` | `["10.132.0.0/16", "192.168.1.0/24"]` | Blocs CIDR du sous-réseau. Utilisés uniquement lorsque `create_network = true` ; le premier est la plage principale des nœuds. |

### Groupe 5 — Cluster {#group-5--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cluster` | `true` | Crée un nouveau cluster GKE. Définissez `false` pour déployer sur un cluster existant nommé par `gke_cluster`. |
| `create_autopilot_cluster` | `true` | `true` pour Autopilot (nœuds entièrement gérés) ; `false` pour Standard (un pool de nœuds Spot de 2 nœuds est créé). |
| `gke_cluster` | `gke-cluster` | Nom du cluster (créé ou référencé). Également utilisé comme identifiant d'appartenance à la flotte. |
| `release_channel` | `REGULAR` | Cadence des mises à niveau : `RAPID`, `REGULAR`, `STABLE` ou `NONE`. |
| `pod_cidr_block` | `10.62.128.0/17` | Plage secondaire des IP de pods (VPC-native). Ne doit pas chevaucher les plages des nœuds ou des services. |
| `service_cidr_block` | `10.64.128.0/20` | Plage secondaire des ClusterIP des Services Kubernetes. Ne doit pas chevaucher les plages des nœuds ou des pods. |

> La plateforme expose également `pod_ip_range` (par défaut `pod-ip-range`) et `service_ip_range` (par défaut `service-ip-range`) — les noms d'alias des deux plages secondaires ci-dessus. Conservez leurs valeurs par défaut, sauf si vous vous rattachez à des plages nommées existantes sur un sous-réseau existant.

### Groupe 6 — Fonctionnalités {#group-6--features}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_monitoring` | `true` | Active Managed Prometheus et crée les services Cloud Monitoring et les SLO par charge de travail. |
| `enable_cloud_service_mesh` | `true` | Installe et configure Cloud Service Mesh (Istio géré) avec `MANAGEMENT_AUTOMATIC` — fournit le mTLS et la télémétrie du maillage. Google choisit la version du maillage à partir du `release_channel` du cluster ; il n'existe pas d'entrée de version. |
| `enable_config_management` | `false` | Réservé à Anthos Config Management. Actuellement relié à aucune ressource de ce module — conservez la valeur par défaut. |
| `config_sync_repo` | _(dépôt d'exemples ACM de GCP)_ | URL de dépôt Git Config Sync réservée (inactive — voir ci-dessus). |
| `config_sync_policy_dir` | _(racine multi-dépôt du quickstart)_ | Répertoire de politiques Config Sync réservé dans le dépôt (inactif — voir ci-dessus). |

### Groupe 7 — Application {#group-7--application}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Déploie les microservices Bank of Anthos `v0.6.10` sur le cluster. Définissez `false` pour provisionner uniquement le cluster et l'infrastructure. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | L'identifiant de déploiement utilisé pour rendre les noms de ressources uniques (la valeur que vous avez fournie, ou `null` lorsqu'il est généré automatiquement par la plateforme). |
| `project_id` | L'identifiant du projet de destination dans lequel le module a été déployé. |

> L'adresse externe de l'application n'est pas exposée comme sortie Terraform ; récupérez-la depuis le Service LoadBalancer `frontend` : `kubectl get svc frontend -n bank-of-anthos`.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_cloud_service_mesh` | `true` | Élevé | Sans le maillage, aucun sidecar n'est injecté — les pods s'exécutent en `1/1`, il n'y a ni mTLS ni télémétrie du maillage, et l'attente de disponibilité du maillage qui conditionne le déploiement de l'application est ignorée. |
| `deployment_id` | à définir une seule fois (ou laisser automatique) | Élevé | Le modifier après le premier déploiement renomme les ressources et force la recréation du VPC/du cluster — en pratique, un nouveau déploiement. |
| `pod_cidr_block` / `service_cidr_block` / `ip_cidr_ranges` | CIDR sans chevauchement | Élevé | Des plages secondaires qui se chevauchent ou sont trop petites font échouer la création du cluster ou épuisent les IP de pods/services à mesure que l'application monte en charge. |
| `region` | une région disposant de quota | Élevé | Un quota insuffisant de CPU/IP/SSD dans la région choisie fait échouer la création du cluster ou du pool de nœuds au milieu d'un long apply. |
| `enable_config_management` | `false` | Moyen | Les entrées ne sont reliées à aucune ressource ; l'activer laisse attendre une configuration GitOps/Config Sync que le module ne fournit pas. |
| `create_autopilot_cluster` | `true` | Moyen | Le mode Standard utilise un pool Spot de 2 nœuds — moins cher mais préemptible ; les nœuds peuvent être récupérés, perturbant brièvement les charges de travail. Utilisez Autopilot pour un comportement plus stable. |
| Exposition de l'application (HTTP uniquement) | ajouter TLS/IAP manuellement | Moyen | Le front-end est servi en HTTP simple sur une IP publique. Pour tout usage au-delà d'une démonstration, placez-le derrière HTTPS et/ou IAP après le déploiement. |
| `create_network = false` | sous-réseau existant correspondant | Moyen | Le sous-réseau existant doit déjà porter des plages secondaires dont les noms correspondent à `pod_ip_range`/`service_ip_range`, sinon la création du cluster échoue. |
| `release_channel` | `REGULAR` | Faible | `RAPID` effectue des mises à niveau fréquentes (plus de remous) ; `NONE` laisse le cluster en mises à niveau manuelles et peut le faire prendre du retard sur les versions prises en charge. |
| `enable_monitoring` | `true` | Faible | Le désactiver supprime les services supervisés et les SLO par charge de travail ; le parcours SLO/observabilité n'a alors rien à montrer. |

---

Pour le parcours opérationnel de bout en bout — déploiement, accès, opérations courantes, observabilité, dépannage et démantèlement — consultez le **[guide de lab Bank of Anthos sur GKE](../labs/Bank_GKE.md)**.
