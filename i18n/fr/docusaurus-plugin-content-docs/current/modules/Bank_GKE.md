---
title: "Bank of Anthos sur GKE"
description: "Référence de configuration pour le déploiement de Bank of Anthos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Bank_GKE.md @ e69407af sha256:fccd462292c0 -->

# Bank of Anthos sur GKE {#bank-of-anthos-on-gke}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Bank_GKE.png" alt="Bank of Anthos sur GKE" style={{maxWidth: "100%", borderRadius: "8px"}} />

Bank of Anthos est l'application bancaire de référence open source de Google Cloud — une démo de microservices polyglottes (services Python et Java, deux bases de données PostgreSQL et un générateur de charge synthétique) qui imite une banque de détail avec des comptes, un registre de transactions et une interface web. Ce module est un déploiement **autonome** : il construit son propre VPC, son cluster GKE, son adhésion à la flotte, son Cloud Service Mesh et sa surveillance, puis déploie les manifestes Bank of Anthos en amont sur le cluster. Il ne dépend d'aucun module de socle partagé.

Le module est destiné à l'**éducation et à la démonstration** — exploration de GKE Autopilot, d'un service mesh géré avec mTLS automatique, de la gestion de flotte et de Cloud Monitoring. Ce n'est pas un système bancaire de production.

Ce guide se concentre sur les services Google Cloud que le module provisionne et sur la manière de les explorer et de les exploiter depuis la Console et la ligne de commande.

---

## Coût de Bank of Anthos sur RAD et comparaison {#what-bank-of-anthos-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot de Bank of Anthos sur RAD coûte environ 24 US$ par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** Il n'y a aucun frais de module RAD pour Bank of Anthos — vous ne payez que les ressources Google Cloud qu'il utilise. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier en vue d'une certification, pour une démo, pour un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 24 US$ par mois deviennent presque rien. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet que RAD gère pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 0 crédit — gratuit dans un projet possédé et dans un projet géré par RAD | 0 crédit — gratuit |
| Temps de build | Quelques crédits, facturés à la minute de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 24 US$ par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **43 crédits par jour**, soit environ 1 290 par mois (environ 129 US$ au prix de la recharge, 103 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 0,5 Gio | 18,04 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| Frais de gestion du cluster GKE | 0 US$ si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 US$ (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 24 US$** |

### Comparaison {#how-it-compares}

- **Bank of Anthos est une application de référence gratuite, pas un produit avec un concurrent commercial — la comparaison honnête est avec l'exécution de l'échantillon vous-même.** Un cluster Kubernetes-in-Docker ou Minikube local est gratuit, mais vous devez alors configurer le service mesh, l'enregistrement de la flotte et la surveillance à la main, et vous le démontez et le reconstruisez vous-même à chaque fois.
- **Le faible coût d'exécution de RAD ici achète le câblage géré, pas un calcul moins cher.** Cloud Service Mesh avec mTLS automatique, adhésion à la flotte et Cloud Monitoring sont déjà connectés, sur une véritable infrastructure Google Cloud, pour environ 24 US$ par mois sans frais de module — utile pour un lab de certification ou une démo que vous voulez garder à portée de main, plutôt que de reconstruire le tutoriel à partir de zéro à chaque fois.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Bank of Anthos s'exécute dans **un projet que RAD gère pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — que d'exécuter Bank of Anthos en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet purement et simplement. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits au total (moins de 1 US$), contre le paiement des frais de module et d'un build complet à nouveau.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la plupart des utilisations d'étude et de démo). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce que Bank of Anthos écrit dans un bucket de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — la suppression douce de Cloud Storage est explicitement désactivée sur ce bucket. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de repli pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ 5 crédits (environ 0,50 US$) dans votre propre projet, ou 5 crédits dans un projet géré par RAD, car RAD reconstruit les ressources à partir de zéro. Il n'y a pas de frais de module ici, donc un redéploiement ne coûte que quelques crédits de temps de build — environ 5 crédits (moins de 1 US$). La suppression entre les utilisations est presque toujours rentable ; il y a très peu de frais à récupérer.
- **Le cluster GKE lui-même est une infrastructure partagée.** Si une autre application utilise le même cluster Autopilot, la suppression de Bank of Anthos seule ne sauve que son propre pod ; les frais de gestion du cluster ne diminuent que lorsque rien d'autre dans le projet n'en a besoin.
- **Conservez d'abord vos données.** Tout ce que Bank of Anthos écrit dans un bucket de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket que vous conservez) avant de supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient Bank of Anthos dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute Bank of Anthos pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais de RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Le module connecte un ensemble ciblé de services Google Cloud autour de la charge de travail Bank of Anthos :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot (ou Standard) | Cluster régional unique ; Autopilot est la valeur par défaut et provisionne/met à l'échelle les nœuds automatiquement |
| Réseau | VPC, sous-réseau, Cloud Router + Cloud NAT, règles de pare-feu | Un VPC dédié avec des plages secondaires natives VPC pour les pods et les services ; NAT pour l'égresse |
| Service mesh | Cloud Service Mesh (Istio géré par Google) | Activé via la flotte avec `MANAGEMENT_AUTOMATIC` ; injecte des sidecars Envoy et applique le mTLS |
| Flotte | GKE Hub / Adhésion à la flotte | Le cluster est enregistré dans la flotte, ce qui est nécessaire pour activer la fonctionnalité de mesh |
| Ingress | Cloud Load Balancing (L4 externe) | Le frontend est exposé via le service `frontend` de type LoadBalancer en amont ; une IP statique globale est également réservée |
| Observabilité | Cloud Monitoring, Managed Service for Prometheus, Cloud Logging, Cloud Trace | Prometheus géré sur le cluster ; un service surveillé + SLO d'utilisation du CPU par charge de travail |
| Application | Charges de travail Bank of Anthos `v0.6.10` | Neuf charges de travail — sept déploiements de microservices plus deux StatefulSets PostgreSQL — dans l'espace de noms `bank-of-anthos` |

**Choses à savoir d'emblée :**

- **Ceci est un module autonome.** Il crée son propre VPC, son cluster GKE et son infrastructure de support. Il n'y a pas de module de plateforme/fondation séparé à déployer en premier — seulement un projet GCP avec la facturation activée.
- **Autopilot est la valeur par défaut.** `create_autopilot_cluster = true` fournit un cluster entièrement géré par Google. Définissez-le sur `false` pour un cluster Standard, auquel cas le module provisionne un pool de nœuds Spot (`e2-standard-2`) avec 2 nœuds par zone dans chaque zone disponible de la région, et un compte de service de nœud dédié avec Workload Identity.
- **L'application est exposée via HTTP simple (L4).** Le service Bank of Anthos `frontend` est de type `LoadBalancer`, il reçoit donc une IP externe régulière servant HTTP. Le module réserve également une IP statique globale nommée `bank-of-anthos`, mais la démo ne provisionne pas de load balancer HTTPS, de certificat TLS géré ou de domaine personnalisé.
- **Le plan de contrôle du mesh est entièrement géré.** Avec `enable_cloud_service_mesh = true`, Google exécute le plan de contrôle Istio — aucun pod `istiod` ne s'exécute dans votre cluster. L'espace de noms `bank-of-anthos` est étiqueté `istio.io/rev=asm-managed`, ce qui déclenche l'injection automatique de sidecars Envoy afin que chaque pod exécute `2/2`.
- **L'apply attend que le mesh soit prêt.** Le provisionnement vérifie que l'adhésion à la flotte et le plan de contrôle du mesh atteignent `ACTIVE` avant de déployer l'application, de sorte que les premiers déploiements prennent un certain temps (environ 30 à 45 minutes).
- **Les entrées de Config Management sont présentes mais non actives.** `enable_config_management` et ses entrées associées existent pour la compatibilité future, mais ce module ne provisionne **pas** actuellement de ressources Anthos Config Management / Config Sync. Laissez-le à la valeur par défaut.
- **Les manifestes de l'application sont récupérés depuis GitHub au moment de l'apply.** Le module télécharge l'archive de la version Bank of Anthos `v0.6.10` et applique ses manifestes Kubernetes avec `kubectl`. Un accès Internet sortant depuis le runner de déploiement est requis.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT` et `REGION` sont définis. Le nom du cluster est par défaut `gke-cluster` ; l'espace de noms de l'application est `bank-of-anthos`.

### A. GKE — le cluster et la charge de travail bancaire {#a-gke--the-cluster-and-the-banking-workload}

Le cluster exécute les neuf charges de travail Bank of Anthos — sept déploiements de microservices plus les StatefulSets PostgreSQL `accounts-db` et `ledger-db` — dans l'espace de noms `bank-of-anthos`. Sur Autopilot, les nœuds sont provisionnés et mis à l'échelle automatiquement ; sur Standard, un pool de nœuds Spot de 2 nœuds est créé. Prometheus géré, le pilote CSI GCS FUSE, l'API Gateway, la gestion des coûts GKE et la posture de sécurité BASIC (avec analyse des vulnérabilités des charges de travail) sont tous activés sur le cluster.

- **Console :** Kubernetes Engine → Clusters (mode, version, modules complémentaires) ; Charges de travail (les neuf services) ; Posture de sécurité (vulnérabilités et erreurs de configuration).
- **CLI :**
  ```bash
  gcloud container clusters describe gke-cluster --region "$REGION" --project "$PROJECT" \
    --format="table(name,autopilot.enabled,currentMasterVersion,status)"
  kubectl get pods -n bank-of-anthos          # expect every pod 2/2 (app + Envoy sidecar)
  kubectl get statefulset,pvc -n bank-of-anthos
  kubectl get nodes -o wide
  ```

### B. Cloud Service Mesh {#b-cloud-service-mesh}

Cloud Service Mesh est activé en tant que fonctionnalité de flotte avec `MANAGEMENT_AUTOMATIC`. Google gère le plan de contrôle Istio ; des sidecars Envoy sont injectés dans chaque pod de l'espace de noms `bank-of-anthos`, chiffrant tout le trafic pod-à-pod avec mTLS et émettant des données de télémétrie de signal d'or sans aucune instrumentation d'application.

- **Console :** Kubernetes Engine → Service Mesh — graphique de topologie en direct, latence/trafic/erreurs par service, état du plan de contrôle.
- **CLI :**
  ```bash
  gcloud container fleet mesh describe --project "$PROJECT"
  kubectl get namespace bank-of-anthos --show-labels        # istio.io/rev=asm-managed
  # Confirm each pod has an istio-proxy sidecar:
  kubectl get pods -n bank-of-anthos \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.name}{" "}{end}{"\n"}{end}'
  ```

### C. Flotte GKE {#c-gke-fleet}

Le cluster est enregistré en tant que membre de la flotte immédiatement après sa création. L'adhésion à la flotte est le prérequis pour activer la fonctionnalité de mesh, et elle fournit un point unique pour visualiser l'état des fonctionnalités sur les clusters.

- **Console :** Kubernetes Engine → Flottes — état de l'adhésion et fonctionnalités activées.
- **CLI :**
  ```bash
  gcloud container fleet memberships list --project "$PROJECT"
  gcloud container fleet memberships describe gke-cluster --location global --project "$PROJECT"
  gcloud container fleet features list --project "$PROJECT"
  ```

### D. Réseau et équilibrage de charge {#d-networking--load-balancing}

Le module crée un VPC dédié (routage GLOBAL) avec un sous-réseau qui contient des plages secondaires natives VPC pour les pods et les services, une passerelle Cloud Router + Cloud NAT pour l'égresse, et un ensemble de règles de pare-feu (plages de vérification de l'état du load balancer et NFS, SSH tunnelisé IAP, trafic de pods intra-VPC, HTTP/HTTPS). Une IP externe statique globale nommée `bank-of-anthos` est réservée. Le frontend de l'application est accessible via le service `frontend` de type LoadBalancer en amont.

- **Console :** Réseau VPC → Réseaux VPC / Pare-feu ; Services réseau → Cloud NAT et Équilibrage de charge ; Réseau VPC → Adresses IP.
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

Managed Service for Prometheus s'exécute sur le cluster. Lorsque la surveillance est activée, le module enregistre chacune des neuf charges de travail en tant que service Cloud Monitoring et attache un SLO d'utilisation de la limite de CPU à chacune. Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging, et les sidecars du mesh exportent des traces distribuées vers Cloud Trace.

- **Console :** Monitoring → Tableaux de bord (GKE) et Services → SLOs ; Logging → Explorateur de journaux ; Trace → Liste des traces.
- **CLI :**
  ```bash
  gcloud monitoring services list --project "$PROJECT"
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="bank-of-anthos"' \
    --project "$PROJECT" --limit 50
  ```

### F. Les charges de travail Bank of Anthos {#f-the-bank-of-anthos-workloads}

Neuf services en trois niveaux : `frontend` (interface web Python) ; `userservice`, `contacts` et `accounts-db` (gestion de compte plus PostgreSQL) ; `ledgerwriter`, `balancereader`, `transactionhistory` et `ledger-db` (transactions plus PostgreSQL) ; et `loadgenerator`, qui génère du trafic synthétique afin que la télémétrie et les SLO aient des données. Les services communiquent via HTTP par nom DNS Kubernetes ; un JWT signé RSA (stocké en tant que Secret Kubernetes) authentifie les utilisateurs entre les services.

- **CLI :**
  ```bash
  kubectl get all -n bank-of-anthos
  kubectl logs -n bank-of-anthos deploy/frontend --tail=50
  kubectl logs -n bank-of-anthos deploy/loadgenerator --tail=20
  ```

---

## 3. Comportement {#3-behaviour}

- **Provisionnement autonome.** Un apply réussi crée le VPC et le sous-réseau (avec des plages secondaires de pods/services), Cloud Router + NAT, les règles de pare-feu, le cluster GKE, l'adhésion à la flotte, la fonctionnalité Cloud Service Mesh, les services surveillés et les SLO, une IP statique globale réservée, et les charges de travail Bank of Anthos.
- **Les composants de Bank of Anthos.** Avec `deploy_application = true`, le module déploie neuf microservices — `frontend`, `userservice`, `contacts`, `ledgerwriter`, `balancereader`, `transactionhistory`, `loadgenerator`, et les bases de données PostgreSQL `accounts-db` et `ledger-db` — dans l'espace de noms `bank-of-anthos`, ainsi que le secret de signature/vérification JWT.
- **Ordre mesh-first.** L'apply active les API GKE Hub et mesh, accorde à l'agent de service GKE Hub les rôles dont il a besoin, enregistre l'adhésion à la flotte, active la fonctionnalité mesh, puis **attend** (par sondage) que l'adhésion et le plan de contrôle mesh signalent `ACTIVE` avant de déployer l'application. C'est pourquoi les premiers déploiements prennent environ 30 à 45 minutes.
- **Déploiement de l'application.** Le module télécharge l'archive de la version Bank of Anthos `v0.6.10` depuis GitHub, crée l'espace de noms `bank-of-anthos` étiqueté avec la révision CSM correspondant au canal (`istio.io/rev=asm-managed` pour `REGULAR`, `-rapid`/`-stable` pour les autres canaux), applique le secret JWT et les manifestes Kubernetes avec `kubectl`, et attend que tous les déploiements deviennent disponibles. Il crée également un compte de service Workload Identity local au projet (`bank-of-anthos@<project>.iam.gserviceaccount.com`), lui accorde `roles/cloudtrace.agent` et `roles/monitoring.metricWriter`, le lie au compte de service Kubernetes `bank-of-anthos`, et ré-annote ce KSA — les manifestes v0.6.10 en amont codent en dur un compte de service dans le propre projet CI de Google, ce qui autrement fait planter les services Java au démarrage.
- **Injection de mesh.** Comme l'espace de noms porte l'étiquette de révision `asm-managed`, chaque pod est injecté avec un sidecar Envoy à l'admission et exécute `2/2`. Tout le trafic intra-espace de noms est chiffré mTLS par défaut.
- **Comment l'application est exposée.** Le service `frontend` en amont est de type `LoadBalancer`, de sorte que Google Cloud lui attribue une IP externe servant du HTTP simple sur le port 80. L'IP statique globale réservée et le module complémentaire Gateway API sont disponibles pour des modèles d'exposition avancés, mais ne sont pas connectés à un équilibreur de charge HTTPS par ce module.
- **Surveillance et SLO.** Lorsque `enable_monitoring = true`, un service Cloud Monitoring et un SLO d'utilisation de la limite de CPU (objectif de 95 %, période calendaire quotidienne, fenêtres de 5 minutes) sont créés par charge de travail, offrant un cadre SLO prêt à l'emploi à explorer.
- **Suivi manuel.** TLS/HTTPS, un domaine personnalisé, IAP devant le frontend, les politiques de gestion du trafic (VirtualService/DestinationRule) et toute configuration GitOps/Config Sync ne sont pas provisionnés par le module et doivent être configurés manuellement après le déploiement si désiré.
- **Extras du mode Standard.** Avec `create_autopilot_cluster = false`, le module crée en outre un compte de service de nœud, un pool de nœuds Spot (`e2-standard-2`, 50 Go pd-ssd) dimensionné à **2 nœuds par zone dans chaque zone disponible de la région** (8 nœuds dans une région à quatre zones telle que `us-central1`), et les liaisons IAM et le pool Workload Identity que Autopilot fournirait autrement automatiquement.
- **Notes d'exécution.** L'archive de la version est téléchargée à nouveau à chaque apply, donc les mises à jour récupèrent les manifestes ; les bases de données de démonstration (`accounts-db`, `ledger-db`) contiennent toutes les données de compte et de transaction et sont supprimées avec le cluster lors du démontage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et Région {#group-1--project--region}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(utilise le projet par défaut)_ | Projet GCP de destination où le cluster et l'application sont déployés. Le compte de service de provisionnement doit y détenir `roles/owner`. |
| `region` | `us-central1` | Région pour le cluster, le VPC et toutes les ressources régionales. Assurez-vous que le quota est disponible. |
| `tenant_id` | `demo` | Identifiant du locataire utilisé dans la dénomination des ressources. Doit contenir 1 à 20 caractères, uniquement des lettres minuscules, des chiffres et des tirets — tout autre caractère échoue à la validation au moment du plan. |

### Groupe 2 — Réseau {#group-2--network}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_network` | `true` | Crée un nouveau VPC et sous-réseau. Définissez `false` pour utiliser un réseau existant identifié par `network_name`/`subnet_name`. |
| `network_name` | `vpc-network` | Nom du VPC (créé ou référencé). |
| `subnet_name` | `vpc-subnet` | Nom du sous-réseau (créé ou référencé). |
| `ip_cidr_ranges` | `["10.132.0.0/16", "192.168.1.0/24"]` | Blocs CIDR pour le sous-réseau. Utilisé uniquement lorsque `create_network = true` ; le premier est la plage de nœuds principale. |

### Groupe 5 — Cluster {#group-5--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cluster` | `true` | Crée un nouveau cluster GKE. Définissez `false` pour déployer sur un cluster existant nommé par `gke_cluster`. |
| `create_autopilot_cluster` | `true` | `true` pour Autopilot (nœuds entièrement gérés) ; `false` pour Standard (un pool de nœuds Spot de 2 nœuds est créé). |
| `gke_cluster` | `gke-cluster` | Nom du cluster (créé ou référencé). Également utilisé comme ID d'adhésion à la flotte. |
| `release_channel` | `REGULAR` | Cadence de mise à niveau : `RAPID`, `REGULAR`, `STABLE` ou `NONE`. |
| `pod_cidr_block` | `10.62.128.0/17` | Plage secondaire pour les IP de pod (native VPC). Ne doit pas chevaucher les plages de nœuds/services. |
| `service_cidr_block` | `10.64.128.0/20` | Plage secondaire pour les ClusterIPs de service Kubernetes. Ne doit pas chevaucher les plages de nœuds/pods. |

> La plateforme expose également `pod_ip_range` (par défaut `pod-ip-range`) et `service_ip_range` (par défaut `service-ip-range`) — les alias pour les deux plages secondaires ci-dessus. Laissez-les à leurs valeurs par défaut, sauf si vous vous connectez à des plages nommées existantes sur un sous-réseau existant.

### Groupe 6 — Fonctionnalités {#group-6--features}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_monitoring` | `true` | Active Managed Prometheus et crée les services Cloud Monitoring et les SLO par charge de travail. |
| `enable_cloud_service_mesh` | `true` | Installe et configure Cloud Service Mesh (Istio géré) avec `MANAGEMENT_AUTOMATIC` — fournit mTLS et la télémétrie du mesh. Google sélectionne la version du mesh à partir de `release_channel` du cluster ; il n'y a pas d'entrée de version. |
| `enable_config_management` | `false` | Réservé à Anthos Config Management. Actuellement non connecté à aucune ressource dans ce module — laisser à la valeur par défaut. |
| `config_sync_repo` | _(dépôt d'exemples GCP ACM)_ | URL du dépôt Git Config Sync réservé (inactif — voir ci-dessus). |
| `config_sync_policy_dir` | _(racine multi-dépôts de démarrage rapide)_ | Répertoire de politiques Config Sync réservé dans le dépôt (inactif — voir ci-dessus). |

### Groupe 7 — Application {#group-7--application}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Déploie les microservices Bank of Anthos `v0.6.10` sur le cluster. Définissez `false` pour provisionner uniquement le cluster et l'infrastructure. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | L'ID de déploiement utilisé pour rendre les noms de ressources uniques (la valeur que vous avez fournie, ou `null` lorsqu'elle est générée automatiquement par la plateforme). |
| `project_id` | L'ID du projet de destination dans lequel le module a été déployé. |

> L'adresse externe de l'application n'est pas affichée comme une sortie Terraform ; récupérez-la depuis le service LoadBalancer `frontend` : `kubectl get svc frontend -n bank-of-anthos`.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_cloud_service_mesh` | `true` | Élevé | Avec le mesh désactivé, aucun sidecar n'est injecté — les pods exécutent `1/1`, il n'y a pas de mTLS ni de télémétrie de mesh, et l'attente de préparation du mesh qui bloque le déploiement de l'application est ignorée. |
| `deployment_id` | défini une fois (ou laisser auto) | Élevé | Le modifier après le premier déploiement renomme les ressources et force la recréation du VPC/cluster — ce qui équivaut à un nouveau déploiement. |
| `pod_cidr_block` / `service_cidr_block` / `ip_cidr_ranges` | CIDR non chevauchants | Élevé | Des plages secondaires qui se chevauchent ou sont trop petites entraînent l'échec de la création du cluster ou l'épuisement des IP de pod/service à mesure que l'application s'adapte. |
| `region` | une région avec quota | Élevé | Un quota CPU/IP/SSD insuffisant dans la région choisie entraîne l'échec de la création du cluster ou du pool de nœuds au milieu d'un long apply. |
| `enable_config_management` | `false` | Moyen | Les entrées ne sont connectées à aucune ressource ; l'activer crée des attentes de GitOps/Config Sync que le module ne fournit pas. |
| `create_autopilot_cluster` | `true` | Moyen | Le mode Standard utilise un pool Spot de 2 nœuds — moins cher mais préemptible ; les nœuds peuvent être récupérés, perturbant brièvement les charges de travail. Utilisez Autopilot pour un comportement plus stable. |
| Exposition de l'application (HTTP uniquement) | ajouter TLS/IAP manuellement | Moyen | Le frontend est servi via HTTP simple sur une IP publique. Pour toute utilisation au-delà d'une démo, protégez-le avec HTTPS et/ou IAP après le déploiement. |
| `create_network = false` | correspondant au sous-réseau existant | Moyen | Le sous-réseau existant doit déjà contenir des plages secondaires dont les noms correspondent à `pod_ip_range`/`service_ip_range`, sinon la création du cluster échoue. |
| `release_channel` | `REGULAR` | Faible | `RAPID` se met à jour fréquemment (plus de changements) ; `NONE` laisse le cluster sur des mises à niveau manuelles et peut prendre du retard sur les versions prises en charge. |
| `enable_monitoring` | `true` | Faible | Le désactiver supprime les services surveillés et les SLO par charge de travail, de sorte que le tutoriel SLO/observabilité n'a rien à montrer. |

---

Pour le guide opérationnel de bout en bout — déploiement, accès, opérations du deuxième jour, observabilité, dépannage et démontage — consultez le **[guide de lab Bank of Anthos sur GKE](../labs/Bank_GKE.md)**.
