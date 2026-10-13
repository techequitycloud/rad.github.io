---
title: "Azure AKS attaché à une flotte Google Cloud"
description: "Référence de configuration pour le déploiement d'AKS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/AKS_GKE.md @ e69407af sha256:745a4c18cbae -->

# Azure AKS attaché à une flotte Google Cloud {#azure-aks-attached-to-a-google-cloud-fleet}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AKS_GKE.png" alt="Azure AKS attaché à une flotte Google Cloud" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce module crée un cluster Microsoft Azure Kubernetes Service (AKS) et l'enregistre auprès de Google Cloud en tant que **cluster GKE attaché** — un membre à part entière d'une **flotte GKE**. Une fois attaché, le cluster AKS apparaît dans la console Google Cloud aux côtés de tous les clusters GKE natifs du projet, et peut être accédé, observé et gouverné via les mêmes outils Google Cloud, le même modèle IAM et la même pile d'observabilité que ceux utilisés pour GKE — sans migrer ni refactoriser les charges de travail qui y sont exécutées.

Contrairement aux modules d'application de ce catalogue, il s'agit d'un **module autonome** sans fondation partagée. Il possède son propre fournisseur Azure et crée des ressources dans **deux clouds** : un groupe de ressources Azure et un cluster AKS côté Azure, et une adhésion à la flotte ainsi qu'une configuration de journalisation et de surveillance gérée côté Google Cloud. Le cluster AKS continue de fonctionner entièrement dans Azure ; Google Cloud n'acquiert qu'un plan de gestion sur celui-ci. La confiance entre les deux clouds est établie avec la fédération OIDC, de sorte qu'aucune clé de compte de service ou secret partagé n'est échangé.

---

## Ce que coûte AKS sur RAD, et comment cela se compare {#what-aks-costs-on-rad-and-how-that-compares}

**Le module GKE Autopilot d'AKS sur RAD coûte environ 24 $ US par mois dans un projet que vous possédez, sans frais de licence pour le logiciel lui-même.** Il n'y a aucun frais de module RAD pour AKS — vous ne payez que les ressources Google Cloud qu'il utilise. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que les quelque 24 $ US par mois deviennent presque rien. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

Vous payez trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 0 crédit — gratuit dans un projet possédé et dans un projet géré par RAD | 0 crédit — gratuit |
| Temps de build | Quelques crédits, facturés à la minute de temps de build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ 24 $ US par mois pour la configuration par défaut (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **43 crédits par jour**, soit environ 1 290 par mois (environ 129 $ US au prix de la recharge, 103 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Pod GKE Autopilot, 0,5x vCPU / 0,5 Gio | 18,04 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| Frais de gestion de cluster GKE | 0 $ US si c'est votre seul cluster Autopilot/zonal sur le compte de facturation, sinon environ 73 $ US (partagés entre toutes les applications GKE du projet) |
| **Total** | **environ 24 $ US** |

### Comment cela se compare {#how-it-compares}

- **Il n'y a pas d'alternative SaaS à nommer ici — ce module est une fine couche de plan de contrôle, pas une application hébergée.** La véritable alternative est de faire le même travail à la main : créer le cluster Azure AKS vous-même et l'enregistrer avec `gcloud container fleet memberships register`, à partir de deux consoles distinctes, sans coût Google Cloud incrémentiel au-delà du petit pod Autopilot que ce module exécute déjà (montré ci-dessus).
- **Ce que vous payez, c'est l'automatisation et la configuration de la confiance inter-cloud, pas un moyen moins cher d'exécuter AKS.** La fédération OIDC entre les deux clouds, l'enregistrement de la flotte et le câblage de la journalisation/surveillance gérée sont ce que les frais de module (zéro, ici) et le temps de build achètent réellement — le coût d'exécution continu côté Google est le même dans les deux cas.
- **Le cluster AKS lui-même est facturé par Microsoft Azure, pas Google Cloud, et les chiffres de ce module ne l'incluent pas.** La propre tarification AKS d'Azure (nœuds de calcul, et ses frais de gestion par cluster en dehors du niveau gratuit) est une facture distincte sur votre compte Azure — consultez la page de tarification Azure AKS pour ce côté.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si AKS s'exécute dans **un projet géré par RAD pour vous**, vous avez une option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet, et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, une démo, un besoin saisonnier — qu'à l'exécution continue d'AKS.

- **Cela met en pause uniquement le côté Google Cloud — l'adhésion à la flotte, la surveillance et le petit pod Autopilot montré ci-dessus. Le cluster AKS lui-même s'exécute dans, et est facturé par, Microsoft Azure, et continue de fonctionner (et de coûter de l'argent sur Azure) jusqu'à ce que vous le mettiez en pause ou le supprimiez séparément.**

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet. Google ne le supprime pas immédiatement : il conserve le projet, récupérable, pendant 30 jours, et comme la facturation est déjà dissociée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet s'arrête simplement, et rien n'est facturé entre-temps.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, seul le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela ne coûte qu'une poignée de crédits au total (moins de 1 $ US), contre le paiement des frais de module et d'une reconstruction complète.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes ne survivent pas.** Tout ce qu'AKS écrit dans un compartiment de sauvegarde à l'intérieur du projet est très probablement perdu dès que vous supprimez le projet, même si le projet lui-même est récupérable pendant 30 jours — la suppression logicielle de Cloud Storage est explicitement désactivée pour ce compartiment. Quiconque a personnalisé le déploiement et souhaite conserver ce travail doit copier une sauvegarde (vers Google Drive, ou un compartiment en dehors du projet) avant de la supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

C'est la solution de secours pour un projet que vous possédez, ou une fois que la fenêtre de restauration de 30 jours ci-dessus est passée : **supprimez le déploiement, et redéployez-le lorsque vous en aurez à nouveau besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds : environ
  5 crédits (environ 0,50 $ US) dans votre propre projet, ou
  5 crédits dans un projet géré par RAD, car RAD reconstruit les ressources
  à partir de zéro. Il n'y a pas de frais de module ici, donc un redéploiement ne coûte que quelques crédits de temps de build — environ 5 crédits (moins de 1 $ US). La suppression entre les utilisations est presque toujours rentable ; il y a très peu de frais à récupérer.
- **Le cluster GKE lui-même est une infrastructure partagée.** Si une autre application utilise le même cluster Autopilot, la suppression d'AKS seule ne sauve que son propre pod ; les frais de gestion du cluster ne diminuent que lorsque plus rien d'autre dans le projet n'en a besoin.
- **Gardez vos données en premier.** Tout ce qu'AKS écrit dans un compartiment de sauvegarde à l'intérieur du déploiement est supprimé avec lui — copiez la dernière sauvegarde (vers Google Drive, ou un compartiment que vous conservez) avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous.** Vous saisissez à nouveau les paramètres lorsque vous redéployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose d'AKS dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute AKS pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Le module provisionne l'infrastructure dans les deux clouds. Lors de l'apply, il (1) crée le groupe de ressources Azure et le cluster AKS, (2) installe l'agent GKE Connect sur le cluster via Helm, et (3) enregistre le cluster en tant que cluster GKE attaché et l'inscrit dans la flotte du projet avec la journalisation gérée, Prometheus géré et une liste d'utilisateurs administrateurs.

| Capacité | Service Cloud | Notes |
|---|---|---|
| Cluster Kubernetes | Azure AKS | Créé dans Azure avec une identité gérée attribuée par le système, un émetteur OIDC activé et un pool de nœuds par défaut (3 nœuds, `Standard_D2s_v3` par défaut). |
| Réseau de cluster | Groupe de ressources Azure + attribution de rôle | Un groupe de ressources contient le cluster ; l'identité gérée du cluster reçoit le rôle de contributeur réseau afin qu'AKS puisse gérer les équilibreurs de charge Azure pour les services `LoadBalancer`. |
| Adhésion à la flotte | Flotte Google Cloud (GKE Hub) | Le cluster AKS est enregistré en tant que cluster attaché et devient membre de la flotte, visible dans la console avec le type de distribution `aks`. |
| Accès `kubectl` distant | Passerelle Connect | Les ingénieurs exécutent `kubectl` sur le cluster AKS en utilisant leur identité Google Cloud — aucune accréditation Azure, distribution kubeconfig ou VPN n'est requise. |
| Confiance inter-cloud | Fédération OIDC | Google Cloud valide les jetons Kubernetes par rapport aux clés publiques de l'émetteur OIDC AKS ; aucun secret partagé entre les clouds. |
| Journalisation centralisée | Cloud Logging | Les journaux des composants système et des charges de travail d'AKS sont acheminés vers l'explorateur de journaux du même projet. |
| Métriques centralisées | Cloud Monitoring (Prometheus géré) | Un collecteur sur AKS transmet les métriques Kubernetes à Cloud Monitoring ; les tableaux de bord GKE intégrés se remplissent automatiquement. |
| Contrôle d'accès | Google Cloud IAM + Kubernetes RBAC | Les utilisateurs listés dans `trusted_users` (plus l'identité de déploiement) reçoivent le rôle d'administrateur de cluster sur le cluster attaché. |

**Choses à savoir d'emblée :**

- **Des identifiants Azure sont requis.** Quatre entrées sensibles — `client_id`, `client_secret`, `azure_tenant_id` et `subscription_id` — identifient un principal de service Azure AD avec au moins les droits de contributeur sur l'abonnement cible. Sans eux, le module ne peut pas créer le cluster AKS. Ils sont marqués comme sensibles et n'apparaissent jamais dans les journaux ou la sortie du plan.
- **Il s'agit d'un module bi-cloud.** Vous avez besoin à la fois d'un projet Google Cloud (facturation activée) et d'un abonnement Azure. Les coûts s'accumulent des deux côtés — Azure pour les nœuds AKS, Google Cloud pour la gestion de la flotte et l'ingestion d'observabilité.
- **Le cluster AKS s'exécute dans Azure.** Le plan de contrôle, les nœuds et le réseau vivent tous dans Azure (`westus2` par défaut). Google Cloud ne stocke que l'enregistrement du cluster attaché et l'adhésion à la flotte (dans `us-central1` par défaut).
- **La version de la plateforme doit être compatible avec la version de Kubernetes.** `platform_version` (la version du composant attaché, par exemple `1.35.0-gke.1`) doit avoir une version mineure égale à `k8s_version` (la version mineure de Kubernetes AKS, par exemple `1.35`) ou exactement une version inférieure.
- **L'utilisateur déployant est toujours un administrateur.** L'identité exécutant le déploiement est automatiquement ajoutée à la liste des administrateurs du cluster, en plus de tout `trusted_users`.
- **Les API sont activées de manière non destructive.** Le module active plusieurs API Google Cloud (GKE Multi-Cloud, GKE Connect, Connect Gateway, GKE Hub, Anthos, Logging, Monitoring et les API de métadonnées associées). Celles-ci restent activées lors de la suppression afin que les autres charges de travail du projet ne soient pas perturbées.

---

## 2. Services Cloud et comment les explorer {#2-cloud-services--how-to-explore-them}

Le côté Google Cloud est exploré avec `gcloud` et `kubectl` ; le côté Azure avec la CLI `az`. Définissez `PROJECT` sur votre projet Google Cloud, `GCP_LOCATION` sur la région de la flotte et `CLUSTER` sur le nom du cluster attaché (la valeur de `cluster_name_prefix`). Confirmez le nom exact de l'adhésion avec `gcloud container fleet memberships list`.

### A. Cluster GKE attaché et adhésion à la flotte (Google Cloud) {#a-gke-attached-cluster--fleet-membership-google-cloud}

Le cluster AKS est enregistré en tant que cluster attaché et inscrit dans la flotte du projet de destination. Il apparaît dans la console avec le type `Attached` / distribution `aks`, aux côtés de tous les clusters GKE natifs.

- **Console :** Kubernetes Engine → Clusters (le cluster Azure affiche une icône Azure et le type `Attached`) ; Kubernetes Engine → Flotte affiche l'adhésion et l'état des fonctionnalités.
- **CLI :**
  ```bash
  # Fleet membership
  gcloud container fleet memberships list --project "$PROJECT"
  gcloud container fleet memberships describe "$CLUSTER" --project "$PROJECT"

  # Attached-cluster registration record (OIDC issuer, platform version, admin users)
  gcloud container attached clusters list --location "$GCP_LOCATION" --project "$PROJECT"
  gcloud container attached clusters describe "$CLUSTER" \
    --location "$GCP_LOCATION" --project "$PROJECT"
  ```

### B. Passerelle Connect — accès `kubectl` (Google Cloud) {#b-connect-gateway--kubectl-access-google-cloud}

L'inscription à la flotte active la passerelle Connect, qui proxyfie `kubectl` vers le cluster AKS en utilisant Google Cloud IAM. L'entrée kubeconfig pointe vers le point de terminaison de la passerelle de Google, et non vers le serveur API AKS, de sorte qu'aucun accès entrant vers Azure n'est nécessaire.

- **Console :** Kubernetes Engine → Clusters → sélectionnez le cluster → Connecter.
- **CLI :**
  ```bash
  # Configure kubectl to reach the cluster through the Connect gateway
  gcloud container fleet memberships get-credentials "$CLUSTER" --project "$PROJECT"

  kubectl config current-context        # connectgateway_<project>_global_<cluster>
  kubectl get nodes -o wide
  kubectl get namespaces
  kubectl get pods --all-namespaces
  ```

### C. Cloud Logging (Google Cloud) {#c-cloud-logging-google-cloud}

Les journaux des composants système et des charges de travail sont collectés depuis AKS vers l'explorateur de journaux du projet en utilisant le même schéma que GKE, de sorte que les requêtes de journaux GKE existantes fonctionnent sans modification.

- **Console :** Logging → Logs Explorer.
- **CLI :**
  ```bash
  # All recent logs from the attached cluster
  gcloud logging read 'resource.labels.cluster_name="'"$CLUSTER"'"' \
    --project "$PROJECT" --limit 20

  # Workload (container) logs in a namespace
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.cluster_name="'"$CLUSTER"'" AND resource.labels.namespace_name="default"' \
    --project "$PROJECT" --limit 20
  ```

### D. Cloud Monitoring et Prometheus géré (Google Cloud) {#d-cloud-monitoring--managed-prometheus-google-cloud}

Le service géré pour Prometheus est activé sur le cluster. Un collecteur sur les nœuds AKS transmet les métriques Kubernetes à Cloud Monitoring ; les tableaux de bord GKE intégrés se remplissent automatiquement.

- **Console :** Monitoring → Metrics Explorer (filtrez une métrique `kubernetes.io/...` par `cluster_name`) ; Monitoring → Dashboards → les tableaux de bord GKE.
- **CLI :**
  ```bash
  gcloud monitoring metrics list \
    --filter='metric.type=starts_with("kubernetes.io/node")' --project "$PROJECT"
  # Through the Connect gateway:
  kubectl top nodes
  kubectl top pods --all-namespaces
  ```

### E. Azure AKS (Azure) {#e-azure-aks-azure}

Le cluster, son groupe de ressources et son pool de nœuds sont gérés dans Azure. Authentifiez la CLI `az` avec le même principal de service fourni au module.

- **Console :** Portail Azure → Services Kubernetes → le cluster AKS ; Groupes de ressources → `<cluster_name_prefix>-rg`.
- **CLI :**
  ```bash
  az login --service-principal \
    --username "$ARM_CLIENT_ID" --password "$ARM_CLIENT_SECRET" --tenant "$ARM_TENANT_ID"

  az aks list --subscription "$ARM_SUBSCRIPTION_ID" --output table
  az aks show --resource-group "<cluster_name_prefix>-rg" \
    --name "<cluster_name_prefix>" --subscription "$ARM_SUBSCRIPTION_ID"
  ```

---

## 3. Comportement {#3-behaviour}

- **Ce que fait l'apply.** Le module crée le groupe de ressources Azure et le cluster AKS, accorde à l'identité gérée du cluster le rôle de contributeur réseau sur le groupe de ressources, installe l'agent GKE Connect sur le cluster via Helm, puis enregistre le cluster en tant que cluster GKE attaché et l'inscrit dans la flotte du projet. Un premier apply prend environ **12 à 20 minutes** ; le provisionnement AKS dans Azure est la phase la plus longue.
- **Connectivité sortante uniquement.** L'agent Connect maintient une connexion sortante persistante et chiffrée d'AKS vers Google Cloud. Le serveur API AKS n'a pas besoin d'un point de terminaison public, et aucune règle de pare-feu entrante ou VPN n'est requise dans Azure.
- **Modèle d'accès à la passerelle Connect.** L'accès est à deux niveaux : un rôle Google Cloud IAM sur le projet (par exemple `roles/gkehub.gatewayReader`, `gatewayEditor` ou `gatewayAdmin`) autorise la traversée de la passerelle, et Kubernetes RBAC sur le cluster autorise les actions API spécifiques. Les utilisateurs dans `trusted_users` (et l'identité de déploiement) reçoivent automatiquement le rôle d'administrateur de cluster.
- **L'observabilité centralisée est activée par défaut.** La journalisation est configurée pour les composants système et les charges de travail, et Prometheus géré est activé, sans configuration supplémentaire après l'attachement.
- **Fédération OIDC.** Google Cloud fait confiance aux jetons émis par l'émetteur OIDC AKS en validant leurs signatures par rapport aux clés publiques publiées du cluster — il n'y a pas de identifiants partagés entre Azure et Google Cloud.
- **Suivi manuel (facultatif).** Un sous-module de maillage de services (Google Cloud Service Mesh / Istio) est livré avec le module mais **n'est pas installé automatiquement**. Son installation est une étape manuelle distincte et ne fait pas partie d'un déploiement standard.
- **Mises à jour.** La modification de `platform_version` met à jour uniquement l'enregistrement du cluster attaché / l'agent Connect — le cluster AKS lui-même n'est pas modifié. La modification de `node_count` ou `vm_size` remodèle le pool de nœuds Azure. La modification de `cluster_name_prefix` force la recréation des ressources dans les deux clouds (le nom du cluster n'incorpore pas l'ID de déploiement, donc deux déploiements avec le même préfixe dans le même abonnement et projet entreront en conflit).
- **Suppression.** La destruction désenregistre le cluster de la flotte, supprime l'agent Connect et supprime le groupe de ressources Azure et le cluster AKS. Les API Google Cloud activées pendant le déploiement sont intentionnellement laissées activées.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud de destination où le cluster est enregistré et où l'adhésion à la flotte est créée. Doit déjà exister. |
| `gcp_location` | `us-central1` | Région Google Cloud où l'enregistrement du cluster attaché et l'adhésion à la flotte sont stockés et affichés dans la console. Doit prendre en charge les clusters attachés. |
| `azure_region` | `westus2` | Région Azure où le cluster AKS et son groupe de ressources sont créés. La disponibilité des fonctionnalités et des SKU de VM varie selon la région. |
| `trusted_users` | _(obligatoire)_ | Adresses e-mail des comptes Google ayant le rôle d'administrateur de cluster sur le cluster AKS via la passerelle Connect. N'a pas de valeur par défaut — fournissez une liste vide `[]` si aucun administrateur supplémentaire n'est nécessaire. L'identité de déploiement est toujours incluse automatiquement. Les entrées doivent être non vides et uniques. |
| `client_id` | _(obligatoire, sensible)_ | ID d'application (client) Azure AD du principal de service utilisé pour créer et gérer les ressources AKS. |
| `client_secret` | _(obligatoire, sensible)_ | Secret client pour le principal de service Azure AD. |
| `azure_tenant_id` | _(obligatoire, sensible)_ | ID de locataire (répertoire) Azure AD pour le compte Azure. |
| `subscription_id` | _(obligatoire, sensible)_ | ID d'abonnement Azure où les ressources AKS sont provisionnées. |

### Groupe 4 — Cluster {#group-4--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cluster_name_prefix` | `azure-aks-cluster` | Préfixe pour le cluster et les noms de ressources associés (lettres minuscules, chiffres, tirets). Utilisé tel quel comme nom de cluster dans Azure et Google Cloud, et pour dériver le groupe de ressources (`<prefix>-rg`) et le préfixe DNS (`<prefix>-dns`). |
| `node_count` | `3` | Nombre de nœuds dans le pool de nœuds par défaut d'AKS. Un minimum de 2 est recommandé pour la haute disponibilité ; des nombres plus élevés augmentent proportionnellement le coût de calcul Azure. |
| `k8s_version` | `1.35` | Version mineure de Kubernetes (`major.minor`) pour le cluster AKS. Doit être prise en charge par AKS dans `azure_region` ; la version de patch est gérée par AKS. |
| `platform_version` | `1.35.0-gke.1` | Version de la plateforme du cluster attaché (l'agent Connect / les composants gérés installés sur AKS). Sa version mineure doit être égale à `k8s_version` ou être exactement une version inférieure. Exécutez `gcloud container attached get-server-config --location=<gcp_location>` pour les versions actuellement proposées. |
| `vm_size` | `Standard_D2s_v3` | SKU de VM Azure pour le pool de nœuds (par exemple `Standard_D2s_v3` = 2 vCPU / 8 Go). Les SKU plus grandes augmentent le coût Azure ; la disponibilité varie selon la région. |

---

## 5. Sorties {#5-outputs}

Le déploiement expose deux valeurs de sortie :

| Sortie | Description |
|---|---|
| `deployment_id` | L'ID de déploiement résolu — le `deployment_id` fourni, ou un hexadécimal aléatoire auto-généré si aucun n'a été fourni. |
| `project_id` | L'ID du projet Google Cloud de destination. |

Aucun n'identifie le cluster, de sorte que les identifiants dont vous avez besoin pour l'exploiter doivent toujours être dérivés ou enregistrés manuellement :

- **Nom du cluster attaché / de l'adhésion** — la valeur de `cluster_name_prefix` (par défaut `azure-aks-cluster`). Confirmez le nom exact avec `gcloud container fleet memberships list --project "$PROJECT"`. Ce nom est requis pour `get-credentials`, `describe` et la plupart des autres commandes.
- **Emplacement de la flotte** — la valeur de `gcp_location` (par défaut `us-central1`), nécessaire pour les commandes `gcloud container attached clusters`.
- **Groupe de ressources Azure** — `<cluster_name_prefix>-rg`, nécessaire pour les opérations `az` et le nettoyage manuel.

Enregistrez le nom de l'adhésion immédiatement après le déploiement ; toutes les commandes du jour 2 et de suppression en dépendent.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `client_id` / `client_secret` / `azure_tenant_id` / `subscription_id` | identifiants de principal de service valides, Contributeur sur l'abonnement | Critique | Des identifiants manquants ou erronés entraînent l'échec de l'apply lors de la création d'AKS ; un principal sous-privilégié provisionne partiellement et laisse des ressources Azure orphelines. Le principal de service a besoin du rôle de Contributeur au niveau de l'abonnement car le module crée lui-même le groupe de ressources. |
| `platform_version` ↔ `k8s_version` | maintenir les versions mineures compatibles (par exemple `1.35.0-gke.1` avec `1.35` ; la version mineure de la plateforme peut également être une version inférieure) | Élevé | Un couplage incompatible entraîne l'échec de l'attachement ou laisse l'agent Connect en mauvaise santé, de sorte que le cluster ne devient jamais gérable depuis Google Cloud. |
| `cluster_name_prefix` | défini une fois, unique par projet/abonnement | Élevé | La modification après le premier déploiement recrée le cluster dans les deux clouds, détruisant le cluster Azure AKS et toutes les charges de travail qu'il contient. La réutilisation d'un préfixe pour un deuxième déploiement entraîne des conflits de ressources. |
| `trusted_users` | les opérateurs qui ont besoin d'accès | Élevé | Omettre un opérateur l'empêche d'atteindre le cluster via la passerelle ; rappelez-vous que l'identité de déploiement est toujours administrateur, et les entrées ne peuvent pas être vides ou dupliquées. |
| `node_count` | `3` (≥2 pour la haute disponibilité) | Moyen | `1` supprime la haute disponibilité — une défaillance ou un drainage d'un seul nœud met hors service les charges de travail du cluster et peut interrompre la connexion de la flotte ; des nombres très élevés augmentent le coût Azure. |
| `vm_size` | `Standard_D2s_v3` | Moyen | Des SKU sous-dimensionnées entraînent une pression de planification et des arrêts par manque de mémoire ; des SKU surdimensionnées augmentent le coût Azure ; certaines SKU ne sont pas disponibles dans certaines régions. |
| `azure_region` / `gcp_location` | régions qui prennent en charge AKS et les clusters attachés respectivement | Moyen | Une région non prise en charge entraîne l'échec du provisionnement ou de l'attachement ; des régions incompatibles ajoutent une latence inter-régions pour le trafic de gestion. |
| API Google Cloud activées | laisser activées lors de la suppression (par défaut) | Faible | Le module ne désactive délibérément pas les API lors de la destruction pour éviter de perturber d'autres charges de travail dans le projet partagé. |

---

Pour les opérations Google Cloud et Azure référencées tout au long — vérification de l'adhésion à la flotte, connexion via la passerelle Connect, exploration des journaux et des métriques, et suppression du déploiement — consultez le **[guide de lab AKS_GKE](https://docs.radmodules.dev/docs/labs/AKS_GKE)**.
