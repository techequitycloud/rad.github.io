---
title: "Azure AKS attaché à une flotte Google Cloud — Guide de lab"
description: "Lab pratique : attacher un cluster Azure AKS à une flotte Google Cloud — enregistrement multicloud, vérification, opérations et suppression."
---

<!-- translated-from: docs/labs/AKS_GKE.md @ 15fd4c7 sha256:afa67357b66f -->

# Azure AKS attaché à une flotte Google Cloud — Guide de lab {#azure-aks-attached-to-a-google-cloud-fleet--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/AKS_GKE)**

## Vue d'ensemble {#overview}

**Temps estimé :** 45 à 90 minutes

Ce lab vous guide à travers le cycle de vie opérationnel complet du module **Azure AKS attaché
à une flotte Google Cloud** sur la plateforme RAD. Le module crée un cluster Microsoft Azure
Kubernetes Service (AKS) et l'enregistre auprès de Google Cloud en tant que **cluster GKE
attaché** — un membre à part entière d'une **flotte GKE**. À partir de ce moment, le cluster
Azure peut être accédé, observé et gouverné depuis Google Cloud via la **passerelle Connect**,
**Cloud Logging** et **Cloud Monitoring**, le tout sans quitter la console Google Cloud et sans
migrer les charges de travail exécutées dans Azure.

Il s'agit d'un module **deux-clouds** : il provisionne des ressources dans Azure (le groupe de
ressources et le cluster AKS) et dans Google Cloud (l'adhésion à la flotte et l'observabilité
gérée). Vous le déploierez, vérifierez que le cluster est enregistré et accessible via la
passerelle, l'exploiterez au quotidien, l'observerez, diagnostiquerez les problèmes courants et
le supprimerez. Le lab se concentre sur l'exploitation du module et de la plateforme Google
Cloud — pour la liste complète des services provisionnés et de chaque entrée de configuration
(organisée par groupe), consultez le [Guide de configuration](https://docs.radmodules.dev/docs/modules/AKS_GKE),
que ce lab ne duplique délibérément pas.

## Objectifs {#objectives}

À la fin de ce lab, vous serez capable de :

- Déployer le module depuis la plateforme RAD et localiser ce qu'il provisionne dans les deux
  clouds.
- Vérifier que le cluster AKS est enregistré dans la flotte et l'atteindre via la passerelle
  Connect.
- Effectuer les opérations de jour 2 — inspecter le cluster, gérer l'accès et mettre à niveau la
  version de la plateforme.
- Observer le cluster avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes d'attachement et de connectivité les plus courants.
- Supprimer le déploiement proprement.

## Prérequis {#prerequisites}

- Un **projet Google Cloud** avec la **facturation activée** et un rôle Propriétaire (ou
  équivalent) IAM sur celui-ci.
- Un **abonnement Azure** et un **principal de service Azure AD** avec au moins `Contributor`
  droits sur cet abonnement. Collectez son **ID client**, son **secret client**, son **ID de
  locataire** et son **ID d'abonnement** avant le déploiement.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` terminés.
- L'**interface de ligne de commande `az` (Azure)** installée, pour inspecter le cluster AKS
  directement dans Azure.
- **Votre propre projet uniquement.** Ce module masque l'option **Projet GCP sur RAD** (`enable_rad_gcpproject = false`)
  car il active des API que les politiques du niveau géré par RAD refusent et attache un cluster
  exécuté dans un autre cloud, il se déploie donc toujours dans un projet que vous apportez.
  Avant le premier déploiement, la boîte de dialogue de confirmation de déploiement vous demande
  de prouver que vous le contrôlez (**Obtenir le code de vérification**, exécutez les commandes
  qu'il affiche en tant que Propriétaire du projet, puis **Vérifier**) et de donner le rôle
  **Propriétaire** au compte de service de déploiement RAD.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la
  première page d'entrées. Toutes les autres entrées du Guide de configuration — y compris les
  entrées de mise à l'échelle et de version dans les tâches de jour 2 — sont modifiées
  ultérieurement avec **Mettre à jour** sur la page du déploiement après avoir coché **Activer
  le mode avancé**, ce qui nécessite un solde de crédits couvrant le coût de build estimé de la
  mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement
  de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez ces variables shell une fois ; chaque tâche ci-dessous les réutilise :

```bash
export PROJECT="<your-gcp-project-id>"
export GCP_LOCATION="us-central1"          # fleet region (gcp_location)
export CLUSTER="azure-aks-cluster"         # cluster_name_prefix; confirm the exact name in Task 2

# Azure service principal (for the optional az CLI checks)
export ARM_CLIENT_ID="<azure-client-id>"
export ARM_CLIENT_SECRET="<azure-client-secret>"
export ARM_TENANT_ID="<azure-tenant-id>"
export ARM_SUBSCRIPTION_ID="<azure-subscription-id>"
```

---

## Tâche 1 — Déployer le module [Automatisé] {#task-1--deploy-the-module-automated}

1. Ouvrez **Solutions → Catalogue de solutions → Modules RAD** dans la navigation supérieure de la
   plateforme RAD, ouvrez **Azure AKS attaché à une flotte Google Cloud** depuis la liste
   **Modules de plateforme** pour commencer la configuration, choisissez **Formulaire de
   configuration** sous *Comment souhaitez-vous configurer ce déploiement ?* (le formulaire
   s'ouvre sur l'**Assistant conversationnel** si vous détenez des crédits achetés ou si vous
   êtes partenaire ou administrateur), et définissez `project_id`. Fournissez les quatre
   informations d'identification Azure requises (`client_id`, `client_secret`,
   `azure_tenant_id`, `subscription_id`) et remplissez `trusted_users` — une entrée requise sans valeur
   par défaut, donc passez une liste vide si vous ne voulez pas d'administrateur de cluster
   supplémentaire (l'identité de déploiement est automatiquement accordée en tant
   qu'administrateur). Ne configurez que ce dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/AKS_GKE) documente chaque
   entrée par groupe, avec les valeurs par défaut. Cliquez sur **Déployer le module**, examinez
   le coût estimé dans la boîte de dialogue **Confirmation de déploiement** lorsqu'elle apparaît
   et cliquez sur **Soumettre** (si la boîte de dialogue ajoute ensuite une étape de
   confirmation, comme la vérification d'un projet que vous apportez, complétez-la et cliquez
   sur **Confirmer**), ce qui ouvre la page d'état du déploiement avec les journaux en temps
   réel.

2. La plateforme crée le groupe de ressources Azure et le cluster AKS, y installe l'agent GKE
   Connect, puis enregistre le cluster en tant que cluster GKE attaché et l'inscrit dans la
   flotte avec la journalisation gérée et Managed Prometheus. Les premiers déploiements prennent
   environ **12 à 20 minutes** — le provisionnement AKS dans Azure domine.

3. Lorsque le déploiement est terminé, définissez `CLUSTER` sur le `cluster_name_prefix` que vous avez
   utilisé (par défaut `azure-aks-cluster`) et confirmez l'enregistrement :

   ```bash
   gcloud container fleet memberships list --project "$PROJECT"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le cluster est enregistré dans la flotte et que l'adhésion est prête :

   ```bash
   gcloud container fleet memberships describe "$CLUSTER" --project "$PROJECT"
   gcloud container attached clusters describe "$CLUSTER" \
     --location "$GCP_LOCATION" --project "$PROJECT"
   ```

   Dans la console, ouvrez **Kubernetes Engine → Clusters** et confirmez que le cluster Azure
   apparaît avec le type `Attached`, et que **Kubernetes Engine → Flotte** le montre comme
   membre.

2. Configurez `kubectl` via la passerelle Connect et atteignez le cluster — notez que cela
   utilise votre identité Google Cloud, sans informations d'identification Azure ni VPN :

   ```bash
   gcloud container fleet memberships get-credentials "$CLUSTER" --project "$PROJECT"

   kubectl config current-context        # connectgateway_<project>_global_<cluster>
   kubectl get nodes -o wide             # AKS nodes, reachable through the gateway
   kubectl get namespaces
   kubectl get pods -n gke-connect       # the Connect agent should be Running
   ```

3. Confirmez votre niveau d'accès :

   ```bash
   kubectl auth can-i list pods --all-namespaces     # expect: yes
   ```

---

## Tâche 3 — Opérer (Jour 2) [Manuel] {#task-3--operate-day-2-manual}

1. **Inspectez le cluster** via la passerelle — nœuds, espaces de noms et l'agent Connect :

   ```bash
   kubectl get nodes -o wide
   kubectl get pods --all-namespaces
   kubectl describe pod -n gke-connect -l app=gke-connect-agent
   ```

2. **Accordez l'accès à un collègue** — un modèle à deux couches (IAM Google Cloud pour traverser
   la passerelle, RBAC Kubernetes pour les actions de cluster) :

   ```bash
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member="user:colleague@example.com" --role="roles/gkehub.gatewayReader"
   kubectl create clusterrolebinding colleague-view \
     --clusterrole=view --user="colleague@example.com"
   ```

3. **Mettez à niveau la version de la plateforme** en modifiant l'entrée `platform_version` et en
   cliquant sur **Mettre à jour** sur la page des détails du déploiement. Cela met à jour
   uniquement l'enregistrement du cluster attaché / l'agent Connect — le cluster AKS lui-même
   n'est pas affecté. Pour redimensionner le pool de nœuds, modifiez `node_count` ou `vm_size` et
   **Mettre à jour**.

4. **Inspectez le cluster AKS directement dans Azure** (facultatif) :

   ```bash
   az login --service-principal \
     --username "$ARM_CLIENT_ID" --password "$ARM_CLIENT_SECRET" --tenant "$ARM_TENANT_ID"
   az aks list --subscription "$ARM_SUBSCRIPTION_ID" --output table
   ```

---

## Tâche 4 — Observer [Manuel] {#task-4--observe-manual}

1. **Journaux** — les journaux des composants système et des charges de travail d'AKS arrivent
   dans Cloud Logging avec le même schéma que GKE :

   ```bash
   gcloud logging read 'resource.labels.cluster_name="'"$CLUSTER"'"' \
     --project "$PROJECT" --limit 20
   ```

   Filtre de l'Explorateur de journaux :
   `resource.labels.cluster_name="<cluster-name>"`.

2. **Métriques** — Managed Prometheus transmet les métriques Kubernetes à Cloud Monitoring :

   ```bash
   gcloud monitoring metrics list \
     --filter='metric.type=starts_with("kubernetes.io/node")' --project "$PROJECT"
   kubectl top nodes
   ```

   Dans la console, ouvrez **Monitoring → Tableaux de bord** et examinez les tableaux de bord
   **GKE** intégrés, qui se remplissent automatiquement pour le cluster attaché, ou **Monitoring
   → Explorateur de métriques** et filtrez une métrique `kubernetes.io/...` par `cluster_name`.

---

## Tâche 5 — Dépannage [Manuel] {#task-5--troubleshoot-manual}

Techniques durables pour les modes de défaillance que vous êtes le plus susceptible de rencontrer.
Il s'agit de diagnostics au niveau de la plateforme qui ne changent pas avec les versions de
cluster.

- **Adhésion non `READY` / cluster n'apparaissant pas :** confirmez que l'attachement est
  terminé et que l'agent Connect est sain :
  ```bash
  gcloud container fleet memberships describe "$CLUSTER" --project "$PROJECT"
  kubectl get pods -n gke-connect
  kubectl logs -n gke-connect -l app=gke-connect-agent --tail=100
  ```
- **L'attachement a échoué au déploiement :** la cause la plus courante est un `platform_version` dont
  le major.minor ne correspond pas à `k8s_version`. Vérifiez les paires prises en charge :
  ```bash
  gcloud container attached get-server-config --location "$GCP_LOCATION" --project "$PROJECT"
  ```
- **Le provisionnement Azure a échoué :** confirmez que les informations d'identification du
  principal de service sont correctes et détiennent les droits `Contributor` au niveau de
  l'abonnement (le module crée lui-même le groupe de ressources). Un SKU de VM incorrect pour le
  `azure_region` choisi échoue également à la création du pool de nœuds.
- **Accès `kubectl` refusé via la passerelle :** vérifiez les deux couches — le rôle de
  passerelle IAM Google Cloud sur le projet, et la liaison RBAC Kubernetes sur le cluster :
  ```bash
  kubectl auth can-i list pods --all-namespaces
  gcloud logging read 'protoPayload.serviceName="connectgateway.googleapis.com"' \
    --project "$PROJECT" --limit 10
  ```
- **"API non activée" transitoire juste après le premier déploiement :** les API activées
  nécessitent une courte fenêtre de propagation. Attendez environ une minute et réessayez.

Consultez la section *Pièges de configuration* du Guide de configuration pour les problèmes
spécifiques aux paramètres.

---

## Tâche 6 — Suppression [Automatisé] {#task-6--tear-down-automated}

Sur la page **Déploiements**, ouvrez le déploiement et cliquez sur l'icône **Corbeille**
(**Supprimer**). La suppression exécute `terraform destroy` et est irréversible (l'enregistrement du
déploiement est conservé pour l'historique). Cela désenregistre le cluster de la flotte, supprime
l'agent Connect et supprime le groupe de ressources Azure et le cluster AKS dans les deux clouds.
Les API Google Cloud que le module a activées sont intentionnellement laissées activées afin que
les autres charges de travail du projet ne soient pas perturbées.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après
des modifications manuelles qui entrent en conflit avec l'état Terraform), utilisez plutôt
**Purger** (depuis la même boîte de dialogue **Supprimer**) — cela supprime le déploiement des
enregistrements de RAD **sans** détruire les ressources cloud. Après une purge, nettoyez
manuellement le groupe de ressources Azure (`az group delete --name "$CLUSTER-rg"`) et l'adhésion à la flotte afin qu'ils
ne persistent pas.

Après la suppression, supprimez le contexte `kubectl` obsolète si vous avez configuré la
passerelle :

```bash
kubectl config delete-context "connectgateway_${PROJECT}_global_${CLUSTER}"
```

---

## Résumé {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module crée le cluster Azure AKS et l'enregistre en tant que membre de la flotte avec la journalisation et les métriques gérées |
| 2 — Accéder et vérifier | Manuel | L'adhésion est `READY` ; le cluster est accessible via la passerelle Connect avec `kubectl get nodes` |
| 3 — Opérer | Manuel | Inspecter le cluster, accorder l'accès à la passerelle + RBAC, mettre à niveau la version de la plateforme, redimensionner le pool de nœuds |
| 4 — Observer | Manuel | Interroger les journaux AKS dans Cloud Logging ; examiner les métriques Kubernetes et les tableaux de bord GKE dans Cloud Monitoring |
| 5 — Dépannage | Manuel | Diagnostiquer les problèmes d'adhésion, d'attachement, d'informations d'identification Azure, d'accès à la passerelle et de propagation d'API |
| 6 — Suppression | Automatisé | Supprimer (Corbeille) détruit les ressources Azure et Google Cloud ; Purger supprime de RAD sans détruire |
