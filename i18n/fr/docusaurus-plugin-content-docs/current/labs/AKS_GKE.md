---
title: "Azure AKS rattaché à une Fleet Google Cloud — Guide de lab"
description: "Lab pratique : rattacher un cluster Azure AKS à une Fleet Google Cloud — enregistrement multicloud, vérification, exploitation et démantèlement."
---

<!-- translated-from: docs/labs/AKS_GKE.md @ 3055034 sha256:7d5c03b35331 -->

# Azure AKS rattaché à une Fleet Google Cloud — Guide de lab {#azure-aks-attached-to-a-google-cloud-fleet--lab-guide}

📖 **[Guide de configuration](https://docs.radmodules.dev/docs/modules/AKS_GKE)**

## Vue d'ensemble {#overview}

**Durée estimée :** 45–90 minutes

Ce lab vous fait parcourir l'intégralité du cycle de vie opérationnel du module **Azure AKS attached to a
Google Cloud Fleet** sur la plateforme RAD. Le module crée un cluster Microsoft Azure
Kubernetes Service (AKS) et l'enregistre auprès de Google Cloud en tant que **GKE Attached
Cluster** — un membre à part entière d'une **GKE Fleet**. À partir de là, le cluster Azure peut être
consulté, observé et gouverné depuis Google Cloud via le **Connect gateway**, **Cloud
Logging** et **Cloud Monitoring**, sans quitter la console Google Cloud et sans
migrer les charges de travail qui s'exécutent dans Azure.

Il s'agit d'un module **bi-cloud** : il provisionne des ressources dans Azure (le Resource Group et le cluster
AKS) et dans Google Cloud (l'appartenance à la fleet et l'observabilité gérée). Vous allez le déployer,
vérifier que le cluster est enregistré et joignable via la passerelle, l'exploiter au quotidien,
l'observer, diagnostiquer les problèmes courants et le démanteler. Le lab se concentre sur l'exploitation du module
et de la plateforme Google Cloud — pour la liste complète des services provisionnés et de chaque
paramètre de configuration (organisés par groupe), consultez le
[Guide de configuration](https://docs.radmodules.dev/docs/modules/AKS_GKE), que ce lab
ne reprend volontairement pas.

## Objectifs {#objectives}

À la fin de ce lab, vous saurez :

- Déployer le module depuis la plateforme RAD et repérer ce qu'il provisionne dans les deux clouds.
- Vérifier que le cluster AKS est enregistré dans la fleet et l'atteindre via le Connect gateway.
- Effectuer les opérations du jour 2 — inspecter le cluster, gérer les accès et mettre à niveau la version de la plateforme.
- Observer le cluster avec Cloud Logging et Cloud Monitoring.
- Diagnostiquer et résoudre les problèmes de rattachement et de connectivité les plus courants.
- Démanteler proprement le déploiement.

## Prérequis {#prerequisites}

- Un **projet Google Cloud** avec la **facturation activée** et le rôle IAM Owner (ou équivalent) sur celui-ci.
- Un **abonnement Azure** et un **principal de service Azure AD** disposant au minimum des droits `Contributor`
  sur cet abonnement. Récupérez son **Client ID**, son **Client Secret**, son **Tenant ID**
  et son **Subscription ID** avant de déployer.
- **gcloud CLI** et **kubectl** installés ; `gcloud auth login` et
  `gcloud auth application-default login` exécutés.
- La **CLI `az` (Azure)** installée, pour inspecter directement le cluster AKS dans Azure.
- **Vous utilisez votre propre projet ?** Avant le premier déploiement dans celui-ci, la boîte de dialogue de confirmation du déploiement vous demande de prouver que vous le contrôlez (**Get verification code**, exécutez les commandes affichées en tant que propriétaire (Owner) du projet, puis **Verify**) et d'attribuer le rôle **Owner** au compte de service de déploiement RAD.
- **Mode avancé pour les modifications ultérieures.** Le formulaire de création ne demande que la première page de paramètres. Tous les autres paramètres du Guide de configuration — y compris les paramètres de mise à l'échelle et de version des tâches du jour 2 — se modifient ensuite avec **Update** sur la page du déploiement après avoir coché **Enable advanced mode**, ce qui exige un solde de crédits couvrant le coût de build estimé de la mise à jour (les mises à jour n'entraînent jamais de frais de module). Dans un environnement de lab, seul un administrateur peut utiliser le mode avancé.
- **Accès à la plateforme RAD** avec l'autorisation de déployer des modules dans le projet.

Définissez une fois ces variables shell ; chaque tâche ci-dessous les réutilise :

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

1. Ouvrez **Solutions → Solution Catalog → RAD modules** dans la navigation supérieure de la plateforme RAD, ouvrez **Azure AKS attached to a Google
   Cloud Fleet** depuis la liste **Platform Modules** pour démarrer la configuration, choisissez **Configuration Form** sous *How would you like to configure this deployment?* (le formulaire s'ouvre sur le **Conversational Assistant** si vous détenez des crédits achetés ou si vous êtes partenaire ou administrateur), puis renseignez
   `project_id`. Fournissez les quatre identifiants Azure obligatoires (`client_id`, `client_secret`,
   `azure_tenant_id`, `subscription_id`) et remplissez `trusted_users` — un paramètre obligatoire sans valeur par défaut ; passez donc une liste vide si vous ne voulez aucun
   administrateur de cluster supplémentaire (l'identité qui déploie reçoit automatiquement les droits d'administration). Ne configurez que ce
   dont vous avez besoin — le
   [Guide de configuration](https://docs.radmodules.dev/docs/modules/AKS_GKE) documente chaque
   paramètre par groupe, avec ses valeurs par défaut. Cliquez sur **Deploy Module**, vérifiez le coût estimé dans la boîte de dialogue **Deployment Confirmation** lorsqu'elle apparaît et cliquez sur **Submit** (si la boîte de dialogue ajoute ensuite une étape de confirmation, comme la vérification d'un projet que vous apportez, effectuez-la et cliquez sur **Confirm**), ce qui ouvre la page d'état du déploiement avec les journaux en temps réel.

2. La plateforme crée le Resource Group Azure et le cluster AKS, y installe l'agent GKE Connect,
   puis enregistre le cluster en tant que GKE Attached Cluster et l'inscrit dans la
   fleet avec la journalisation gérée et Managed Prometheus. Les premiers déploiements prennent environ **12–20
   minutes** — le provisionnement d'AKS dans Azure en représente l'essentiel.

3. Une fois le déploiement terminé, définissez `CLUSTER` sur le `cluster_name_prefix` que vous avez utilisé
   (par défaut `azure-aks-cluster`) et confirmez l'enregistrement :

   ```bash
   gcloud container fleet memberships list --project "$PROJECT"
   ```

---

## Tâche 2 — Accéder et vérifier [Manuel] {#task-2--access--verify-manual}

1. Confirmez que le cluster est enregistré dans la fleet et que l'appartenance est prête :

   ```bash
   gcloud container fleet memberships describe "$CLUSTER" --project "$PROJECT"
   gcloud container attached clusters describe "$CLUSTER" \
     --location "$GCP_LOCATION" --project "$PROJECT"
   ```

   Dans la console, ouvrez **Kubernetes Engine → Clusters** et vérifiez que le cluster Azure apparaît
   avec le type `Attached`, et que **Kubernetes Engine → Fleet** l'affiche comme membre.

2. Configurez `kubectl` via le Connect gateway et atteignez le cluster — notez que cela utilise votre
   identité Google Cloud, sans identifiants Azure ni VPN :

   ```bash
   gcloud container fleet memberships get-credentials "$CLUSTER" --project "$PROJECT"

   kubectl config current-context        # connectgateway_<project>_global_<cluster>
   kubectl get nodes -o wide             # AKS nodes, reachable through the gateway
   kubectl get namespaces
   kubectl get pods -n gke-connect       # the Connect agent should be Running
   ```

3. Confirmez votre niveau d'accès :

   ```bash
   kubectl auth can-i list pods --all-namespaces     # expect: yes
   ```

---

## Tâche 3 — Exploiter (jour 2) [Manuel] {#task-3--operate-day-2-manual}

1. **Inspectez le cluster** via la passerelle — nœuds, espaces de noms et agent Connect :

   ```bash
   kubectl get nodes -o wide
   kubectl get pods --all-namespaces
   kubectl describe pod -n gke-connect -l app=gke-connect-agent
   ```

2. **Accordez l'accès à un collègue** — un modèle à deux niveaux (Google Cloud IAM pour traverser la passerelle,
   RBAC Kubernetes pour les actions sur le cluster) :

   ```bash
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member="user:colleague@example.com" --role="roles/gkehub.gatewayReader"
   kubectl create clusterrolebinding colleague-view \
     --clusterrole=view --user="colleague@example.com"
   ```

3. **Mettez à niveau la version de la plateforme** en modifiant le paramètre `platform_version` puis en cliquant sur
   **Update** sur la page de détails du déploiement. Cela ne met à jour que l'enregistrement du cluster
   rattaché / l'agent Connect — le cluster AKS lui-même n'est pas affecté. Pour redimensionner le pool
   de nœuds, modifiez `node_count` ou `vm_size` puis cliquez sur **Update**.

4. **Inspectez le cluster AKS directement dans Azure** (facultatif) :

   ```bash
   az login --service-principal \
     --username "$ARM_CLIENT_ID" --password "$ARM_CLIENT_SECRET" --tenant "$ARM_TENANT_ID"
   az aks list --subscription "$ARM_SUBSCRIPTION_ID" --output table
   ```

---

## Tâche 4 — Observer [Manuel] {#task-4--observe-manual}

1. **Journaux** — les journaux des composants système et des charges de travail d'AKS arrivent dans Cloud Logging avec le même
   schéma que GKE :

   ```bash
   gcloud logging read 'resource.labels.cluster_name="'"$CLUSTER"'"' \
     --project "$PROJECT" --limit 20
   ```

   Filtre du Logs Explorer :
   `resource.labels.cluster_name="<cluster-name>"`.

2. **Métriques** — Managed Prometheus transmet les métriques Kubernetes à Cloud Monitoring :

   ```bash
   gcloud monitoring metrics list \
     --filter='metric.type=starts_with("kubernetes.io/node")' --project "$PROJECT"
   kubectl top nodes
   ```

   Dans la console, ouvrez **Monitoring → Dashboards** et consultez les tableaux de bord **GKE** intégrés,
   qui se remplissent automatiquement pour le cluster rattaché, ou **Monitoring → Metrics Explorer**
   et filtrez une métrique `kubernetes.io/...` par `cluster_name`.

---

## Tâche 5 — Dépanner [Manuel] {#task-5--troubleshoot-manual}

Des techniques durables pour les modes de défaillance que vous rencontrerez le plus probablement. Il s'agit de diagnostics
au niveau de la plateforme, qui ne changent pas avec les versions du cluster.

- **Appartenance non `READY` / cluster absent :** vérifiez que le rattachement s'est terminé et que
  l'agent Connect est en bonne santé :
  ```bash
  gcloud container fleet memberships describe "$CLUSTER" --project "$PROJECT"
  kubectl get pods -n gke-connect
  kubectl logs -n gke-connect -l app=gke-connect-agent --tail=100
  ```
- **Échec du rattachement au déploiement :** la cause la plus fréquente est une `platform_version` dont la
  version majeure.mineure ne correspond pas à `k8s_version`. Vérifiez les combinaisons prises en charge :
  ```bash
  gcloud container attached get-server-config --location "$GCP_LOCATION" --project "$PROJECT"
  ```
- **Échec du provisionnement Azure :** vérifiez que les identifiants du principal de service sont corrects et disposent
  du rôle `Contributor` au niveau de l'abonnement (le module crée lui-même le Resource Group). Une SKU de VM
  inadaptée à la `azure_region` choisie fait également échouer la création du pool de nœuds.
- **Accès `kubectl` refusé via la passerelle :** vérifiez les deux niveaux — le rôle IAM Google Cloud
  de passerelle sur le projet, et la liaison RBAC Kubernetes sur le cluster :
  ```bash
  kubectl auth can-i list pods --all-namespaces
  gcloud logging read 'protoPayload.serviceName="connectgateway.googleapis.com"' \
    --project "$PROJECT" --limit 10
  ```
- **Erreur transitoire « API not enabled » juste après le premier déploiement :** les API activées ont besoin d'un court
  délai de propagation. Attendez environ une minute et réessayez.

Consultez la section *Configuration Pitfalls* du Guide de configuration pour les pièges propres à chaque paramètre.

---

## Tâche 6 — Démanteler [Automatisé] {#task-6--tear-down-automated}

Sur la page **Deployments**, ouvrez le déploiement et cliquez sur l'icône **Trash** (**Delete**).
Delete exécute `terraform destroy` et est irréversible (l'enregistrement du déploiement est conservé pour
l'historique). Cela désinscrit le cluster de la fleet, supprime l'agent Connect et supprime
le Resource Group Azure et le cluster AKS dans les deux clouds. Les API Google Cloud que le module
a activées restent volontairement activées afin de ne pas perturber les autres charges de travail du projet.

Si un déploiement est bloqué et que la plateforme RAD ne peut plus le gérer (par exemple après des modifications
manuelles en conflit avec l'état Terraform), utilisez plutôt **Purge** (depuis la même boîte de dialogue **Delete**) — cela supprime le
déploiement des enregistrements de RAD **sans** détruire les ressources cloud. Après une purge, nettoyez
manuellement le Resource Group Azure (`az group delete --name "$CLUSTER-rg"`) et l'appartenance à la fleet
afin qu'ils ne subsistent pas.

Après le démantèlement, supprimez le contexte `kubectl` obsolète si vous avez configuré la passerelle :

```bash
kubectl config delete-context "connectgateway_${PROJECT}_global_${CLUSTER}"
```

---

## Récapitulatif {#summary}

| Tâche | Type | Résultat |
|---|---|---|
| 1 — Déployer | Automatisé | Le module crée le cluster Azure AKS et l'enregistre comme membre de la fleet avec journalisation et métriques gérées |
| 2 — Accéder et vérifier | Manuel | L'appartenance est `READY` ; le cluster est joignable via le Connect gateway avec `kubectl get nodes` |
| 3 — Exploiter | Manuel | Inspecter le cluster, accorder l'accès passerelle + RBAC, mettre à niveau la version de la plateforme, redimensionner le pool de nœuds |
| 4 — Observer | Manuel | Interroger les journaux AKS dans Cloud Logging ; consulter les métriques Kubernetes et les tableaux de bord GKE dans Cloud Monitoring |
| 5 — Dépanner | Manuel | Diagnostiquer les problèmes d'appartenance, de rattachement, d'identifiants Azure, d'accès à la passerelle et de propagation des API |
| 6 — Démanteler | Automatisé | Delete (Trash) détruit les ressources Azure et Google Cloud ; Purge retire le déploiement de RAD sans rien détruire |
