---
title: "Azure AKS rattaché à une flotte Google Cloud"
description: "Référence de configuration pour déployer AKS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/AKS_GKE.md @ 3055034 sha256:851559547794 -->

# Azure AKS rattaché à une flotte Google Cloud {#azure-aks-attached-to-a-google-cloud-fleet}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AKS_GKE.png" alt="Azure AKS rattaché à une flotte Google Cloud" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce module crée un cluster Microsoft Azure Kubernetes Service (AKS) et l'enregistre auprès de Google Cloud en tant que **GKE Attached Cluster** — un membre à part entière d'une **GKE Fleet**. Une fois rattaché, le cluster AKS apparaît dans la console Google Cloud aux côtés des clusters GKE natifs du projet, et peut être consulté, observé et gouverné avec les mêmes outils Google Cloud, le même modèle IAM et la même pile d'observabilité que GKE — sans migrer ni refactoriser les charges de travail qui s'y exécutent.

Contrairement aux modules applicatifs de ce catalogue, il s'agit d'un **module autonome** sans socle partagé. Il possède son propre fournisseur Azure et crée des ressources dans **deux clouds** : un Resource Group Azure et un cluster AKS côté Azure, et une appartenance à la flotte ainsi qu'une configuration de journalisation et de supervision gérées côté Google Cloud. Le cluster AKS continue de s'exécuter entièrement dans Azure ; Google Cloud n'obtient qu'un plan de gestion sur celui-ci. La confiance entre les deux clouds est établie par fédération OIDC, si bien qu'aucune clé de compte de service ni aucun secret partagé n'est échangé.

---

## 1. Vue d'ensemble {#1-overview}

Le module provisionne l'infrastructure dans les deux clouds. Lors de l'apply, il (1) crée le Resource Group Azure et le cluster AKS, (2) installe l'agent GKE Connect sur le cluster via Helm, et (3) enregistre le cluster comme GKE Attached Cluster et l'inscrit dans la flotte du projet avec la journalisation gérée, Managed Prometheus et une liste d'utilisateurs administrateurs.

| Fonctionnalité | Service cloud | Remarques |
|---|---|---|
| Cluster Kubernetes | Azure AKS | Créé dans Azure avec une identité managée attribuée par le système, l'émetteur OIDC activé et un pool de nœuds par défaut (3 nœuds, `Standard_D2s_v3` par défaut). |
| Réseau du cluster | Azure Resource Group + attribution de rôle | Un Resource Group contient le cluster ; l'identité managée du cluster reçoit le rôle Network Contributor afin qu'AKS puisse gérer les équilibreurs de charge Azure pour les Services `LoadBalancer`. |
| Appartenance à la flotte | Google Cloud Fleet (GKE Hub) | Le cluster AKS est enregistré comme cluster rattaché et devient membre de la flotte, visible dans la console avec le type de distribution `aks`. |
| Accès `kubectl` à distance | Connect gateway | Les ingénieurs exécutent `kubectl` sur le cluster AKS avec leur identité Google Cloud — sans identifiants Azure, sans distribution de kubeconfig ni VPN. |
| Confiance inter-cloud | Fédération OIDC | Google Cloud valide les jetons Kubernetes à l'aide des clés publiques de l'émetteur OIDC d'AKS ; aucun secret partagé entre les clouds. |
| Journalisation centralisée | Cloud Logging | Les journaux des composants système et des charges de travail d'AKS arrivent dans le Log Explorer du même projet. |
| Métriques centralisées | Cloud Monitoring (Managed Prometheus) | Un collecteur sur AKS transmet les métriques Kubernetes à Cloud Monitoring ; les tableaux de bord GKE intégrés se remplissent automatiquement. |
| Contrôle d'accès | Google Cloud IAM + Kubernetes RBAC | Les utilisateurs listés dans `trusted_users` (ainsi que l'identité qui déploie) reçoivent le rôle cluster-admin sur le cluster rattaché. |

**À savoir d'emblée :**

- **Des identifiants Azure sont requis.** Quatre entrées sensibles — `client_id`, `client_secret`, `azure_tenant_id` et `subscription_id` — identifient un principal de service Azure AD disposant au moins des droits Contributor sur l'abonnement cible. Sans elles, le module ne peut pas créer le cluster AKS. Elles sont marquées comme sensibles et n'apparaissent jamais dans les journaux ni dans la sortie du plan.
- **Il s'agit d'un module bi-cloud.** Il vous faut à la fois un projet Google Cloud (facturation activée) et un abonnement Azure. Les coûts s'accumulent des deux côtés — Azure pour les nœuds AKS, Google Cloud pour la gestion de la flotte et l'ingestion de l'observabilité.
- **Le cluster AKS s'exécute dans Azure.** Le plan de contrôle, les nœuds et le réseau résident tous dans Azure (`westus2` par défaut). Google Cloud ne stocke que l'enregistrement du cluster rattaché et l'appartenance à la flotte (dans `us-central1` par défaut).
- **La version de plateforme doit être compatible avec la version de Kubernetes.** `platform_version` (la version des composants rattachés, p. ex. `1.35.0-gke.1`) doit avoir une version mineure égale à `k8s_version` (la version mineure de Kubernetes sur AKS, p. ex. `1.35`) ou inférieure d'exactement un.
- **L'utilisateur qui déploie est toujours administrateur.** L'identité qui exécute le déploiement est automatiquement ajoutée à la liste des administrateurs du cluster, en plus des éventuels `trusted_users`.
- **Les API sont activées de manière non destructive.** Le module active plusieurs API Google Cloud (GKE Multi-Cloud, GKE Connect, Connect Gateway, GKE Hub, Anthos, Logging, Monitoring et les API de métadonnées associées). Elles restent activées lors du démantèlement afin de ne pas perturber les autres charges de travail du projet.

---

## 2. Services cloud et comment les explorer {#2-cloud-services--how-to-explore-them}

Le côté Google Cloud s'explore avec `gcloud` et `kubectl` ; le côté Azure avec la CLI `az`. Définissez `PROJECT` sur votre projet Google Cloud, `GCP_LOCATION` sur la région de la flotte et `CLUSTER` sur le nom du cluster rattaché (la valeur de `cluster_name_prefix`). Confirmez le nom exact de l'appartenance avec `gcloud container fleet memberships list`.

### A. GKE Attached Cluster et appartenance à la flotte (Google Cloud) {#a-gke-attached-cluster--fleet-membership-google-cloud}

Le cluster AKS est enregistré comme cluster rattaché et inscrit dans la flotte du projet de destination. Il apparaît dans la console avec le type `Attached` / la distribution `aks`, aux côtés des clusters GKE natifs.

- **Console :** Kubernetes Engine → Clusters (le cluster Azure affiche une icône Azure et le type `Attached`) ; Kubernetes Engine → Fleet affiche l'appartenance et l'état des fonctionnalités.
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

### B. Connect gateway — accès `kubectl` (Google Cloud) {#b-connect-gateway--kubectl-access-google-cloud}

L'inscription dans la flotte active la Connect gateway, qui relaie `kubectl` vers le cluster AKS en s'appuyant sur Google Cloud IAM. L'entrée kubeconfig pointe vers le point de terminaison de la passerelle de Google, et non vers le serveur d'API AKS ; aucun accès entrant vers Azure n'est donc nécessaire.

- **Console :** Kubernetes Engine → Clusters → sélectionnez le cluster → Connect.
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

Les journaux des composants système et des charges de travail sont collectés depuis AKS dans le Log Explorer du projet avec le même schéma que GKE ; les requêtes de journaux GKE existantes fonctionnent donc sans modification.

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

### D. Cloud Monitoring et Managed Prometheus (Google Cloud) {#d-cloud-monitoring--managed-prometheus-google-cloud}

Managed Service for Prometheus est activé sur le cluster. Un collecteur sur les nœuds AKS transmet les métriques Kubernetes à Cloud Monitoring ; les tableaux de bord GKE intégrés se remplissent automatiquement.

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

Le cluster, son Resource Group et son pool de nœuds sont gérés dans Azure. Authentifiez la CLI `az` avec le même principal de service que celui fourni au module.

- **Console :** Azure Portal → Kubernetes services → le cluster AKS ; Resource groups → `<cluster_name_prefix>-rg`.
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

- **Ce que fait l'apply.** Le module crée le Resource Group Azure et le cluster AKS, accorde à l'identité managée du cluster le rôle Network Contributor sur le Resource Group, installe l'agent GKE Connect sur le cluster via Helm, puis enregistre le cluster comme GKE Attached Cluster et l'inscrit dans la flotte du projet. Un premier apply prend environ **12–20 minutes** ; le provisionnement d'AKS dans Azure est la phase la plus longue.
- **Connectivité sortante uniquement.** L'agent Connect maintient une connexion sortante persistante et chiffrée d'AKS vers Google Cloud. Le serveur d'API AKS n'a pas besoin de point de terminaison public, et aucune règle de pare-feu entrante ni aucun VPN n'est requis dans Azure.
- **Modèle d'accès par la Connect gateway.** L'accès repose sur deux couches : un rôle Google Cloud IAM sur le projet (p. ex. `roles/gkehub.gatewayReader`, `gatewayEditor` ou `gatewayAdmin`) autorise le passage par la passerelle, et le RBAC Kubernetes sur le cluster autorise les actions d'API spécifiques. Les utilisateurs de `trusted_users` (et l'identité qui déploie) reçoivent automatiquement le rôle cluster-admin.
- **L'observabilité centralisée est activée par défaut.** La journalisation est configurée pour les composants système et les charges de travail, et Managed Prometheus est activé, sans configuration supplémentaire après le rattachement.
- **Fédération OIDC.** Google Cloud fait confiance aux jetons émis par l'émetteur OIDC d'AKS en validant leurs signatures à l'aide des clés publiques publiées par le cluster — il n'existe aucun identifiant partagé entre Azure et Google Cloud.
- **Suivi manuel (facultatif).** Un sous-module de maillage de services (Google Cloud Service Mesh / Istio) est fourni avec le module mais **n'est pas installé automatiquement**. Son installation est une étape distincte et manuelle, hors du périmètre d'un déploiement standard.
- **Mises à jour.** Modifier `platform_version` ne met à jour que l'enregistrement du cluster rattaché / l'agent Connect — le cluster AKS lui-même n'est pas touché. Modifier `node_count` ou `vm_size` redimensionne le pool de nœuds Azure. Modifier `cluster_name_prefix` force la recréation des ressources dans les deux clouds (le nom du cluster n'intègre pas l'ID de déploiement ; deux déploiements utilisant le même préfixe dans le même abonnement et le même projet entreront donc en conflit).
- **Démantèlement.** La destruction désinscrit le cluster de la flotte, supprime l'agent Connect, puis supprime le Resource Group Azure et le cluster AKS. Les API Google Cloud activées pendant le déploiement restent volontairement activées.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud de destination dans lequel le cluster est enregistré et l'appartenance à la flotte est créée. Il doit déjà exister. |
| `gcp_location` | `us-central1` | Région Google Cloud dans laquelle l'enregistrement du cluster rattaché et l'appartenance à la flotte sont stockés et affichés dans la console. Elle doit prendre en charge les clusters rattachés. |
| `azure_region` | `westus2` | Région Azure dans laquelle le cluster AKS et son Resource Group sont créés. La disponibilité des fonctionnalités et des SKU de VM varie selon la région. |
| `trusted_users` | _(obligatoire)_ | Adresses e-mail de comptes Google recevant le rôle cluster-admin sur le cluster AKS via la Connect gateway. Pas de valeur par défaut — fournissez une liste vide `[]` si aucun administrateur supplémentaire n'est nécessaire. L'identité qui déploie est toujours incluse automatiquement. Les entrées ne doivent pas être vides et doivent être uniques. |
| `client_id` | _(obligatoire, sensible)_ | ID d'application (client) Azure AD du principal de service utilisé pour créer et gérer les ressources AKS. |
| `client_secret` | _(obligatoire, sensible)_ | Secret client du principal de service Azure AD. |
| `azure_tenant_id` | _(obligatoire, sensible)_ | ID de locataire (annuaire) Azure AD du compte Azure. |
| `subscription_id` | _(obligatoire, sensible)_ | ID de l'abonnement Azure dans lequel les ressources AKS sont provisionnées. |

### Groupe 4 — Cluster {#group-4--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cluster_name_prefix` | `azure-aks-cluster` | Préfixe du nom du cluster et des ressources associées (lettres minuscules, chiffres, traits d'union). Utilisé tel quel comme nom du cluster dans Azure et dans Google Cloud, et pour dériver le Resource Group (`<prefix>-rg`) et le préfixe DNS (`<prefix>-dns`). |
| `node_count` | `3` | Nombre de nœuds dans le pool de nœuds par défaut d'AKS. Un minimum de 2 est recommandé pour la haute disponibilité ; un nombre plus élevé augmente proportionnellement le coût de calcul Azure. |
| `k8s_version` | `1.35` | Version mineure de Kubernetes (`major.minor`) pour le cluster AKS. Elle doit être prise en charge par AKS dans `azure_region` ; la version de correctif est gérée par AKS. |
| `platform_version` | `1.35.0-gke.1` | Version de plateforme du cluster rattaché (l'agent Connect / les composants gérés installés sur AKS). Sa version mineure doit être égale à `k8s_version` ou inférieure d'exactement un. Exécutez `gcloud container attached get-server-config --location=<gcp_location>` pour connaître les versions actuellement proposées. |
| `vm_size` | `Standard_D2s_v3` | SKU de VM Azure pour le pool de nœuds (p. ex. `Standard_D2s_v3` = 2 vCPU / 8 GB). Des SKU plus grands augmentent le coût Azure ; la disponibilité varie selon la région. |

---

## 5. Sorties {#5-outputs}

Le déploiement expose deux valeurs de sortie :

| Sortie | Description |
|---|---|
| `deployment_id` | L'ID de déploiement résolu — le `deployment_id` fourni, ou une valeur hexadécimale aléatoire générée automatiquement si aucune n'a été fournie. |
| `project_id` | L'ID du projet Google Cloud de destination. |

Aucune des deux n'identifie le cluster ; les identifiants nécessaires pour l'exploiter doivent donc toujours être dérivés ou consignés manuellement :

- **Nom du cluster rattaché / de l'appartenance** — la valeur de `cluster_name_prefix` (par défaut `azure-aks-cluster`). Confirmez le nom exact avec `gcloud container fleet memberships list --project "$PROJECT"`. Ce nom est requis pour `get-credentials`, `describe` et la plupart des autres commandes.
- **Emplacement de la flotte** — la valeur de `gcp_location` (par défaut `us-central1`), nécessaire pour les commandes `gcloud container attached clusters`.
- **Resource Group Azure** — `<cluster_name_prefix>-rg`, nécessaire pour les opérations `az` et le nettoyage manuel.

Consignez le nom de l'appartenance immédiatement après le déploiement ; toutes les commandes d'exploitation courante (Day-2) et de démantèlement en dépendent.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `client_id` / `client_secret` / `azure_tenant_id` / `subscription_id` | identifiants valides d'un principal de service, Contributor sur l'abonnement | Critique | Des identifiants absents ou erronés font échouer l'apply à la création d'AKS ; un principal insuffisamment privilégié provisionne partiellement et laisse des ressources Azure orphelines. Le principal de service a besoin du rôle Contributor au niveau de l'abonnement, car le module crée lui-même le Resource Group. |
| `platform_version` ↔ `k8s_version` | gardez des versions mineures compatibles (p. ex. `1.35.0-gke.1` avec `1.35` ; la mineure de la plateforme peut aussi être inférieure d'un) | Élevé | Une association incompatible fait échouer le rattachement ou laisse l'agent Connect en mauvais état, de sorte que le cluster ne devient jamais gérable depuis Google Cloud. |
| `cluster_name_prefix` | défini une seule fois, unique par projet/abonnement | Élevé | Le modifier après le premier déploiement recrée le cluster dans les deux clouds, détruisant le cluster AKS Azure et toutes les charges de travail qu'il héberge. Réutiliser un préfixe pour un second déploiement provoque des conflits de ressources. |
| `trusted_users` | les opérateurs qui ont besoin d'un accès | Élevé | Omettre un opérateur l'empêche d'atteindre le cluster via la passerelle ; rappelez-vous que l'identité qui déploie est toujours administratrice, et que les entrées ne peuvent être ni vides ni dupliquées. |
| `node_count` | `3` (≥2 pour la HA) | Moyen | `1` supprime la haute disponibilité — la défaillance ou le drainage d'un seul nœud arrête les charges de travail du cluster et peut interrompre la connexion à la flotte ; un nombre très élevé gonfle le coût Azure. |
| `vm_size` | `Standard_D2s_v3` | Moyen | Des SKU sous-dimensionnés provoquent une pression sur l'ordonnancement et des arrêts OOM ; des SKU surdimensionnés gonflent le coût Azure ; certains SKU ne sont pas disponibles dans certaines régions. |
| `azure_region` / `gcp_location` | des régions prenant en charge respectivement AKS et les clusters rattachés | Moyen | Une région non prise en charge fait échouer le provisionnement ou le rattachement ; des régions éloignées ajoutent de la latence inter-régions au trafic de gestion. |
| API Google Cloud activées | laissez-les activées lors du démantèlement (par défaut) | Faible | Le module ne désactive volontairement pas les API lors de la destruction, afin de ne pas perturber les autres charges de travail du projet partagé. |

---

Pour les opérations Google Cloud et Azure évoquées tout au long de cette page — vérifier l'appartenance à la flotte, se connecter via la Connect gateway, explorer les journaux et les métriques, et démanteler le déploiement — consultez le **[guide de lab AKS_GKE](https://docs.radmodules.dev/docs/labs/AKS_GKE)**.
