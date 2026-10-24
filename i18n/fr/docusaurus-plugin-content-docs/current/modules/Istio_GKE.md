---
title: "Istio sur GKE"
description: "Référence de configuration pour le déploiement d'Istio sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Istio_GKE.md @ 1665a43e sha256:738a5d71fdfe -->

# Istio sur GKE {#istio-on-gke}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Istio_GKE.png" alt="Istio sur GKE" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce module met en place un **cluster GKE Standard** et y installe le **service mesh Istio open source** — le projet CNCF en amont qui sous-tend Google Cloud Service Mesh et de nombreuses autres offres de mesh gérées. Istio est installé directement avec `istioctl`, de sorte que chaque décision de configuration est transparente et inspectable, ce qui en fait un environnement pratique idéal pour les ingénieurs de plateforme qui apprennent le fonctionnement d'un service mesh à partir de zéro.

Au moment du déploiement, vous choisissez l'une des deux architectures de plan de données : le **mode sidecar** (un proxy Envoy injecté dans chaque pod pour un contrôle total du trafic par pod) ou le **mode ambiant** (un proxy `ztunnel` partagé par nœud plus des proxys de point de cheminement optionnels, avec une surcharge de ressources beaucoup plus faible). En plus d'Istio, le module installe la pile d'observabilité open source complète — **Prometheus, Jaeger, Grafana et Kiali** — afin que vous puissiez explorer immédiatement la télémétrie du mesh. Il s'agit d'un module d'infrastructure autonome : il provisionne son propre VPC, son cluster et son réseau, et ne s'appuie sur aucune fondation partagée.

Ce module est destiné à des **fins éducatives et d'évaluation**.

---

## Ce que coûte Istio sur RAD, et comment cela se compare {#what-istio-costs-on-rad-and-how-that-compares}

**Istio sur RAD coûte environ 24 US$ par mois dans votre propre projet, et RAD ne facture aucun frais de module pour cela.** C'est un service mesh que vous installez sur un cluster, pas une application avec ses propres données, donc la plupart de ce qui rend les autres modules intéressants à mettre en pause plutôt qu'à supprimer ne s'applique pas ici — voir "Comment cela se compare" ci-dessous pour ce que cela signifie en pratique. Istio n'est livré que sous forme de module GKE sur RAD ; il n'y a pas de variante Cloud Run, car Istio est une infrastructure pour un cluster Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | pas de frais | pas de frais |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **24,04 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **43 crédits par jour** |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge unique, moins sur un plan. Dans un projet géré par RAD, la
base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième
application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 0,5 Gio | 18,04 US$ |
| Cloud NAT et réseau | 5,00 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 US$ |
| Frais de gestion de cluster GKE | partagés entre toutes les applications GKE du projet ; 0 $ si c'est votre seul cluster, sinon ~73 |
| **Total** | **environ 24,04 US$** |

### Comment cela se compare {#how-it-compares}

- Istio n'a pas de plan SaaS propre — c'est le projet open source derrière les produits de mesh gérés de plusieurs fournisseurs, pas un produit hébergé en soi. La comparaison commerciale la plus proche est un module complémentaire de mesh géré sur un cluster que vous exécutez déjà, plutôt qu'un abonnement autonome, et nous n'avons pas pu vérifier un prix actuel comparable à citer ici.
- Le pod de ce module est petit (0,5 vCPU, 0,5 Gio) — le plan de contrôle du mesh lui-même est léger ; ce qui coûte de l'argent, c'est le cluster qui le sous-tend. Un cluster GKE Autopilot nu de taille similaire, ou un petit cluster Kubernetes sur un droplet Hetzner CPX22 / DigitalOcean 2 vCPU/4 Go (environ 24 $/mois), exécute Istio avec `istioctl` vous-même — le module de RAD automatise exactement cette installation et vous fournit Prometheus, Jaeger, Grafana et Kiali déjà câblés.
- Parce que ce module est explicitement destiné à l'**éducation et à l'évaluation** plutôt qu'à une charge de travail de production, l'intérêt de RAD ici est moins d'économiser de l'argent par rapport à un cluster nu que de sauter le temps de configuration de l'installation et du câblage manuel de la pile d'observabilité.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Istio s'exécute dans un projet que RAD gère pour vous et que vous prévoyez d'y revenir — une pause
entre les cours, un creux saisonnier, ou simplement ne pas savoir encore si vous en aurez besoin le mois
prochain — c'est la meilleure option, et cela ne coûte presque rien.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le
projet purement et simplement : la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression d'Istio en tant que
module unique, cela ne démantèle pas le cluster GKE, le plan de contrôle du mesh et le réseau un par un — l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le
projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour
trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne
facture jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits (moins de 1 US$) en temps de build
pour une chaîne de déploiements typique.

Ce qu'il faut : vous devez posséder le projet (pas un projet que RAD gère uniquement pour la facturation), vous devez
le restaurer vous-même dans les 30 jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits achetés doit toujours dépasser le
seuil du palier (100 crédits pour le palier sandbox que la plupart utilisent conviennent). Google dit que la plupart des services sont
entièrement fonctionnels à nouveau dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a
la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il soit parti dès que vous
supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours. Istio ne contient pas de données d'application propres — la configuration du mesh est réappliquée par Terraform lors de la mise à jour, non restaurée à partir d'une sauvegarde — il n'y a donc rien à perdre en supprimant le projet de toute façon.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que la fenêtre de 30 jours ci-dessus est passée, la solution de repli est de supprimer
Istio purement et simplement et de le redéployer plus tard.

- **Ce que coûte un redéploiement :** les frais de module à nouveau, plus les builds — environ les frais de module
  indiqués ci-dessus plus 3 à 6 crédits de temps de build.
- **Quand cela en vaut la peine :** la suppression n'économise de l'argent que si Istio devait autrement rester inutilisé
  — mais comme il n'y a pas de frais de module, le redéploiement ne coûte que quelques crédits de temps de build, il n'y a donc pas de seuil réel à attendre : supprimez-le dès qu'une session est terminée. Il n'y a pas de base de données ou de données persistantes ici, donc la suppression d'Istio supprime son coût d'exécution total par elle-même.
- **Conservez d'abord les données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement, et
  ce bucket est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un bucket
  que vous conservez) avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie pour la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
  par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Google Cloud : supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

---

## 1. Vue d'ensemble {#1-overview}

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cluster GKE Standard | Pool de nœuds unique avec `node_count = 2` **par zone** dans toutes les zones UP de la région — 8 nœuds `e2-standard-2` préemptibles (16 vCPU) dans une région à 4 zones telle que `us-central1` ; vous gérez directement la configuration des nœuds (pas Autopilot) |
| Réseau | Réseau VPC + sous-réseau | VPC en mode personnalisé, routage global, VPC-natif (IP d'alias) avec des plages secondaires pour les pods et les services |
| Sortie | Cloud Router + Cloud NAT | Provisionné pour le VPC, mais le cluster n'est **pas** privé (pas de `private_cluster_config`), donc les nœuds ont des IP externes et sortent directement ; l'installation d'Istio elle-même exécute `local-exec` sur l'hôte Terraform, pas sur les nœuds |
| Identité | Workload Identity + compte de service de nœud dédié | SA de nœud à moindre privilège ; les pods obtiennent une identité GCP sans fichiers de clés |
| Service mesh | Istio open source (via `istioctl`) | Mode sidecar **ou** ambiant, plus une passerelle d'entrée Istio exposée via un équilibreur de charge externe |
| Observabilité | Prometheus, Jaeger, Grafana, Kiali | Modules complémentaires open source intra-cluster installés dans `istio-system` ; GKE Managed Prometheus également activé au niveau du cluster |
| Posture de sécurité | GKE Security Posture, Gateway API | Posture BASIC + analyse des vulnérabilités ; canal standard Gateway API activé |

**Choses à savoir d'emblée :**

- **GKE Standard, pas Autopilot.** Vous contrôlez directement le pool de nœuds, le type de machine et les paramètres du cluster. Le cluster autorise la capacité `NET_ADMIN`, dont le mode sidecar a besoin pour sa configuration d'interception de trafic.
- **Sidecar est le mode par défaut.** `install_ambient_mesh` est par défaut `false` (mode sidecar). Définissez-le sur `true` pour le mode ambiant. Le mode est choisi au moment du déploiement, et le changer nécessite un redéploiement.
- **L'installation d'Istio s'exécute comme une étape de déploiement.** Après la création du cluster, la plateforme télécharge `istioctl`, installe Istio avec le profil sélectionné, étiquette l'espace de noms `default` pour l'inscription au mesh, et installe les quatre modules complémentaires d'observabilité. Les échecs transitoires des modules complémentaires sont enregistrés comme des avertissements et ne font pas échouer le déploiement.
- **La passerelle d'entrée obtient une IP publique.** Les deux modes installent un service `istio-ingressgateway` de type `LoadBalancer`, qui provisionne un équilibreur de charge externe GCP. Attendez 1 à 2 minutes après l'installation pour que l'IP soit attribuée.
- **Aucune application de démonstration n'est provisionnée.** Le mesh et la pile d'observabilité sont installés, mais aucune charge de travail d'exemple n'est déployée par le module. Pour explorer la gestion du trafic, vous déployez vos propres charges de travail (ou l'exemple Istio Bookinfo) dans l'espace de noms `default`, qui est déjà étiqueté pour l'inscription au mesh.
- **Nœuds préemptibles.** Les nœuds peuvent être récupérés avec un préavis d'environ 30 secondes. Cela permet de maintenir les coûts bas pour un environnement d'apprentissage, mais ne convient pas à la production.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes `kubectl` / `istioctl` supposent que vous avez d'abord récupéré les identifiants du cluster (la commande exacte est renvoyée dans la sortie `cluster_credentials_cmd` [output](#5-outputs)) :

```bash
gcloud container clusters get-credentials <gke_cluster> --region <region> --project <project>
```

### A. Cluster GKE Standard {#a-gke-standard-cluster}

Le cluster exécute un pool de nœuds régional unique de deux nœuds `e2-standard-2` préemptibles **par zone** — 8 nœuds dans une région à 4 zones telle que `us-central1` — avec un réseau VPC-natif, Workload Identity, GKE Security Posture (BASIC), Managed Prometheus et le canal standard Gateway API activé. Vérifiez votre quota de CPU régional (16 vCPU pour `e2-standard-2` × 8) avant le déploiement.

- **Console :** Kubernetes Engine → Clusters → sélectionnez le cluster → Détails (canal de publication, version), Nœuds (pool de nœuds), Sécurité (Workload Identity, Security Posture).
- **CLI :**
  ```bash
  gcloud container clusters describe <gke_cluster> --region <region> --project <project> \
    --format="value(currentMasterVersion,releaseChannel.channel)"
  kubectl get nodes -o wide
  kubectl top nodes
  ```

### B. Réseau VPC, pare-feu et Cloud NAT {#b-vpc-networking-firewall-and-cloud-nat}

Un VPC en mode personnalisé avec un sous-réseau (plages secondaires pour les pods et les services), des règles de pare-feu et un Cloud Router + Cloud NAT pour la sortie. L'installation d'Istio dépend de NAT pour télécharger `istioctl` et les manifestes des modules complémentaires.

- **Console :** Réseau VPC → Réseaux VPC (sous-réseau + plages secondaires) ; Réseau VPC → Pare-feu ; Services réseau → Cloud NAT.
- **CLI :**
  ```bash
  gcloud compute networks subnets describe <subnet_name> --region <region> --project <project>
  gcloud compute firewall-rules list --project <project>
  gcloud compute routers get-nat-mapping-info cr1-<region> --region <region> --project <project>
  ```

### C. Plan de contrôle Istio {#c-istio-control-plane}

`istiod` (le plan de contrôle unifié Pilot / Citadel / Galley) et la passerelle d'entrée Istio s'exécutent dans l'espace de noms `istio-system`. `istiod` pousse la configuration Envoy/ztunnel via le protocole xDS et agit comme l'autorité de certification du mesh.

- **Console :** Kubernetes Engine → Charges de travail → filtrez l'espace de noms `istio-system`.
- **CLI :**
  ```bash
  kubectl get all -n istio-system
  istioctl version
  istioctl verify-install
  istioctl proxy-status            # all proxies synced to the control plane
  istioctl analyze -A              # configuration validation
  ```

### D. Plan de données — sidecar vs ambiant {#d-data-plane--sidecar-vs-ambient}

En **mode sidecar**, un proxy Envoy est injecté dans chaque pod d'un espace de noms étiqueté `istio-injection=enabled` (le module étiquette `default`). En **mode ambiant**, un DaemonSet `ztunnel` gère le mTLS L4 par nœud pour les espaces de noms étiquetés `istio.io/dataplane-mode=ambient`, avec des proxys de point de cheminement optionnels pour le L7.

- **CLI (sidecar) :**
  ```bash
  kubectl get namespace default --show-labels        # expect istio-injection=enabled
  kubectl get mutatingwebhookconfiguration | grep istio
  istioctl proxy-config all <pod>                    # Envoy config for a pod's sidecar
  ```
- **CLI (ambiant) :**
  ```bash
  kubectl get namespace default --show-labels        # expect istio.io/dataplane-mode=ambient
  kubectl get daemonset ztunnel -n istio-system
  kubectl get pods -n istio-system -l app=ztunnel -o wide
  istioctl ztunnel-config workloads
  ```

### E. Passerelle d'entrée Istio {#e-istio-ingress-gateway}

Un `Deployment` Envoy autonome doté d'un service `LoadBalancer` qui provisionne un équilibreur de charge externe GCP — le point d'entrée du trafic dans le mesh.

- **Console :** Kubernetes Engine → Service & Ingress → `istio-ingressgateway` ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  kubectl get svc istio-ingressgateway -n istio-system
  # Read the external IP from the Service (the external_ip output is not reliably populated):
  kubectl get svc istio-ingressgateway -n istio-system \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'; echo
  ```

### F. Pile d'observabilité {#f-observability-stack}

Prometheus, Jaeger, Grafana et Kiali sont installés dans `istio-system`. Ils sont accessibles par transfert de port (le module ne les expose pas en externe). GKE Managed Prometheus s'exécute à leurs côtés au niveau du cluster.

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

Les journaux système et de charge de travail du cluster sont acheminés vers Cloud Logging ; les métriques du cluster et de Managed Prometheus sont acheminées vers Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord (GKE / Kubernetes).
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="istio-system"' \
    --project <project> --limit 50
  ```

---

## 3. Comportement {#3-behaviour}

**Séquence de déploiement :**

1. Activez les API de projet requises et attendez l'activation de l'API Container.
2. Créez le VPC, le sous-réseau (avec des plages secondaires de pods et de services), les règles de pare-feu et le Cloud Router + Cloud NAT — sauf si `create_network = false`, auquel cas le réseau et le sous-réseau existants nommés sont utilisés.
3. Créez le cluster GKE Standard et un pool de nœuds préemptibles à deux nœuds avec un compte de service de nœud dédié à moindre privilège — sauf si `create_cluster = false`, auquel cas Istio s'installe sur le cluster existant nommé.
4. Exécutez l'installation d'Istio comme une étape de déploiement : téléchargez `istioctl` pour le `istio_version` demandé, récupérez les identifiants du cluster, créez l'espace de noms `istio-system` et installez Istio avec le profil sélectionné.
5. Étiquetez l'espace de noms `default` pour l'inscription au mesh, puis installez les modules complémentaires Prometheus, Jaeger, Grafana et Kiali et exécutez une vérification d'installation.

**Mode sidecar (`install_ambient_mesh = false`, par défaut) :**

- Istio est installé avec des identifiants de mesh et une passerelle d'entrée autoscalée (min 2 / max 5 réplicas, cible CPU 80 %). Si ce chemin d'installation échoue, l'étape revient à une installation de profil `minimal`.
- L'espace de noms `default` est étiqueté `istio-injection=enabled`. Les pods créés là reçoivent un sidecar Envoy `istio-proxy` ; le cluster autorise `NET_ADMIN` afin que le sidecar puisse programmer l'interception de trafic. **Les pods existants doivent être redémarrés pour prendre en compte un sidecar.**

**Mode ambiant (`install_ambient_mesh = true`) :**

- Istio est installé avec le profil `ambient` plus une passerelle d'entrée LoadBalancer, et un quota de ressources est appliqué pour protéger les pods critiques des nœuds.
- Un DaemonSet `ztunnel` fournit un mTLS L4 par nœud. L'espace de noms `default` est étiqueté `istio.io/dataplane-mode=ambient` et un proxy de point de cheminement lui est appliqué pour la politique L7. L'inscription ne nécessite **aucun redémarrage de pod**.

**Notes d'exécution :**

- **IP d'entrée.** Après l'installation, l'IP externe de la passerelle d'entrée met 1 à 2 minutes à apparaître. Les journaux de déploiement l'affichent ; lisez-la à tout moment avec `kubectl get svc istio-ingressgateway -n istio-system`. La sortie `external_ip` du module est au mieux approximative et rapporte souvent `IP not available` — utilisez plutôt le service.
- **Pas d'application d'exemple.** Bien qu'un commutateur `deploy_application` soit présent, le module actuel ne provisionne pas de charge de travail de démonstration. Déployez vos propres services (ou l'exemple Istio Bookinfo fourni avec la version Istio téléchargée) dans l'espace de noms `default` déjà étiqueté pour exercer la gestion du trafic, le mTLS et les politiques d'autorisation.
- **mTLS permissif par défaut.** Le mesh accepte le trafic en texte clair et mTLS jusqu'à ce que vous appliquiez une politique `STRICT` `PeerAuthentication` — intentionnel pour une adoption incrémentielle.
- **Démantèlement.** La destruction exécute une désinstallation gracieuse qui supprime les points de cheminement/étiquettes, les modules complémentaires d'observabilité, l'installation d'Istio et l'espace de noms `istio-system` avant que le cluster et le réseau ne soient démantelés. Les étapes de nettoyage sont au mieux approximatives et ne bloquent jamais la destruction.

---

## 4. Variables de configuration {#4-configuration-variables}

Groupées exactement comme elles apparaissent sur la plateforme de déploiement. Les paramètres de métadonnées de module (Groupe 0) sont gérés par la plateforme et ne sont pas affichés ici.

### Groupe 1 — Projet et Région {#group-1--project--region}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet GCP de destination où le cluster et le mesh sont déployés. Doit déjà exister. |
| `tenant_id` | `demo` | Identifiant du locataire. Doit être composé de 1 à 20 caractères alphanumériques minuscules ou de tirets. **N'a actuellement aucun effet** — il est validé mais jamais référencé par aucune ressource dans ce module ; les noms de ressources utilisent le suffixe d'identifiant de déploiement à la place. |
| `region` | `us-central1` | Région pour le cluster, le VPC et toutes les ressources régionales. Assurez-vous d'avoir un quota suffisant. |

### Groupe 2 — Réseau {#group-2--network}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_network` | `true` | Crée un nouveau VPC et sous-réseau. Définissez `false` pour installer dans un réseau/sous-réseau existant. |
| `network_name` | `vpc-network` | Nom de base du VPC. Lorsque `create_network = true`, le VPC est créé sous le nom `<network_name>-<deployment_id>` (un suffixe aléatoire est ajouté) ; lorsque `create_network = false`, cela correspond littéralement au réseau existant. |
| `subnet_name` | `vpc-subnet` | Nom du sous-réseau — créé ou référencé selon `create_network`. |
| `ip_cidr_ranges` | `["10.132.0.0/16", "192.168.1.0/24"]` | Blocs CIDR pour les plages de sous-réseaux (utilisés uniquement lors de la création d'un réseau). Le premier est la plage de nœuds principale. |

### Groupe 3 — Cluster GKE {#group-3--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cluster` | `true` | Crée un nouveau cluster GKE Standard. Définissez `false` pour installer Istio sur un cluster existant. |
| `gke_cluster` | `gke-cluster` | Nom du cluster — créé ou référencé selon `create_cluster`. |
| `release_channel` | `REGULAR` | Canal de publication GKE : `RAPID`, `REGULAR`, `STABLE` ou `NONE` (mises à niveau manuelles). |
| `pod_cidr_block` | `10.62.128.0/17` | Plage secondaire pour les IP de pod. Ne doit pas chevaucher les plages de nœuds ou de services. |
| `service_cidr_block` | `10.64.128.0/20` | Plage secondaire pour les ClusterIP de service. Ne doit pas chevaucher les plages de nœuds ou de pods. |

### Groupe 4 — Fonctionnalités Istio {#group-4--istio-features}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `istio_version` | `1.30.3` | Version d'Istio open source à installer (majeure.mineure.patch). Doit être prise en charge par le canal de publication choisi. |
| `install_ambient_mesh` | `false` | `false` installe le mode sidecar (Envoy par pod) ; `true` installe le mode ambiant (ztunnel par nœud + points de cheminement optionnels). |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `deployment_id` | Renvoie l'**entrée** `deployment_id`, pas le suffixe généré. Lorsque l'entrée est laissée à sa valeur par défaut (`null`), cette sortie est vide même si les ressources sont toujours nommées avec un suffixe aléatoire auto-généré. |
| `project_id` | L'ID du projet de destination. |
| `cluster_credentials_cmd` | Commande `gcloud container clusters get-credentials` prête à l'emploi pour le cluster. |
| `external_ip` | Rapporte **toujours** `IP not available` — il lit `scripts/app/external_ip.txt`, un fichier que ce module ne crée jamais. Lisez l'IP du service `istio-ingressgateway` (ou des journaux de déploiement) à la place. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `pod_cidr_block` / `service_cidr_block` / `ip_cidr_ranges` | plages non chevauchantes | Critique | Des plages secondaires qui se chevauchent (entre elles ou avec des réseaux appairés/sur site) empêchent la création du cluster ou provoquent des conflits de routage difficiles à annuler. |
| `install_ambient_mesh` | choisi une fois au déploiement | Élevé | Le mode est fixé au moment de l'installation ; le passage du mode sidecar au mode ambiant après le déploiement nécessite de démanteler le mesh et de le réinstaller. |
| `istio_version` | une vraie balise publiée (par exemple `1.30.3`) | Élevé | Une version indisponible ou non prise en charge fait échouer le téléchargement/l'installation de `istioctl`, laissant le cluster sans mesh. |
| `create_cluster` / `gke_cluster` | correspondre à la cible réelle | Élevé | Avec `create_cluster = false`, un nom `gke_cluster` incorrect fait échouer la recherche du cluster existant et l'installation est annulée. |
| `create_network` avec un réseau existant | `network_name` / `subnet_name` corrects | Élevé | Un nom de réseau/sous-réseau existant incorrect fait échouer la recherche ou place le cluster dans un réseau non intentionnel. |
| Attentes d'IP d'entrée | lire à partir du service, pas `external_ip` | Moyen | S'appuyer sur la sortie `external_ip` (souvent `IP not available`) crée de la confusion ; l'IP de l'équilibreur de charge est toujours sur le service `istio-ingressgateway`. |
| `release_channel` | `REGULAR` | Moyen | `RAPID` introduit des versions de Kubernetes antérieures qui peuvent ne pas être validées par rapport au `istio_version` choisi ; `NONE` désactive les correctifs automatiques. |
| Nœuds préemptibles (fixes) | acceptable pour les labs uniquement | Moyen | Les deux nœuds peuvent être récupérés simultanément, rendant brièvement le plan de contrôle et la passerelle indisponibles. Non destiné à la production. |
| Attendre une application de démonstration intégrée | déployer votre propre charge de travail | Faible | Le module installe uniquement le mesh ; rien ne sert le trafic tant que vous ne déployez pas une charge de travail dans l'espace de noms `default`. |

---

Pour une présentation pratique du déploiement, de la vérification, de l'exploitation, de l'observation et du démantèlement de ce module — y compris l'exploration du mode sidecar vs ambiant et de la pile d'observabilité — consultez le **[guide de lab Istio sur GKE](../labs/Istio_GKE.md)**.
